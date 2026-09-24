use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{Datelike, Local};

use crate::{
    error::AppError,
    excel::load_sheet_rows,
    models::{
        AppSettings, BindingSourceType, ConfigFieldKey, GenerationFailure, GenerationMode,
        GenerationPreview, GenerationResult, GenerationRule, PlaceholderBinding, SystemVariableKey,
    },
    template::render_docx,
};

fn system_token(vocab: &crate::models::FieldVocabulary, key: SystemVariableKey) -> &str {
    vocab
        .system_variables
        .iter()
        .find(|item| item.key == key)
        .map(|item| item.token.as_str())
        .unwrap_or("")
}

/// 仅接受稳定语义 key（serde snake_case），不与用户 token 词面抢匹配。
fn parse_config_field_key(value: &str) -> Option<ConfigFieldKey> {
    match value.trim() {
        "account_name" => Some(ConfigFieldKey::AccountName),
        "account_number" => Some(ConfigFieldKey::AccountNumber),
        "bank_name" => Some(ConfigFieldKey::BankName),
        _ => None,
    }
}

fn parse_system_variable_key(value: &str) -> Option<SystemVariableKey> {
    match value.trim() {
        "letter_number" => Some(SystemVariableKey::LetterNumber),
        "date" => Some(SystemVariableKey::Date),
        "current_year" => Some(SystemVariableKey::CurrentYear),
        "serial" => Some(SystemVariableKey::Serial),
        _ => None,
    }
}

fn sanitize_file_name(value: &str) -> String {
    value.chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
}

fn format_decimal(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    format!("{rounded:.2}")
}

fn parse_decimal(value: &str) -> f64 {
    value.replace(',', "").trim().parse::<f64>().unwrap_or(0.0)
}

fn resolve_output_dir(rule: &GenerationRule, template_path: &str) -> Result<PathBuf, AppError> {
    if let Some(output_dir) = &rule.output_dir {
        let path = PathBuf::from(output_dir);
        std::fs::create_dir_all(&path)?;
        return Ok(path);
    }
    let base = Path::new(template_path)
        .parent()
        .ok_or_else(|| AppError::Message("无法定位模板所在目录".into()))?;
    let dir = base.join(format!("生成结果_{}", Local::now().format("%Y%m%d_%H%M%S")));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn apply_template_string(template: &str, values: &HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in values {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
        result = result.replace(&format!("%{key}%"), value);
    }
    sanitize_file_name(&result)
}

fn build_grouped_rows(
    rows: &[HashMap<String, String>],
    rule: &GenerationRule,
) -> Vec<HashMap<String, String>> {
    match rule.mode {
        GenerationMode::Row => rows.to_vec(),
        GenerationMode::Grouped => {
            let mut grouped: HashMap<String, HashMap<String, String>> = HashMap::new();
            for row in rows {
                let key = rule
                    .group_by_fields
                    .iter()
                    .map(|field| row.get(field).cloned().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join("||");
                if let Some(entry) = grouped.get_mut(&key) {
                    // 如果分组已存在，将当前行的值加到分组中
                    for field in &rule.sum_fields {
                        let current = parse_decimal(entry.get(field).map(String::as_str).unwrap_or("0"));
                        let incoming = parse_decimal(row.get(field).map(String::as_str).unwrap_or("0"));
                        entry.insert(field.clone(), format_decimal(current + incoming));
                    }
                } else {
                    // 如果分组不存在，创建一个新的分组
                    grouped.insert(key, row.clone());
                }
            }
            grouped.into_values().collect()
        }
    }
}

fn missing_bindings(bindings: &[PlaceholderBinding]) -> Vec<String> {
    bindings
        .iter()
        .filter(|binding| binding.source_value.trim().is_empty())
        .map(|binding| binding.placeholder.clone())
        .collect()
}

fn config_value(
    settings: &AppSettings,
    row: &HashMap<String, String>,
    field: &str,
) -> String {
    let lookup_column = settings.field_vocabulary.bank_lookup_column.trim();
    if lookup_column.is_empty() {
        return String::new();
    }
    let lookup = row.get(lookup_column).cloned().unwrap_or_default();
    let found = settings
        .bank_mappings
        .iter()
        .find(|mapping| mapping.key == lookup);
    let field_key = match parse_config_field_key(field) {
        Some(key) => key,
        None => return String::new(),
    };
    match (found, field_key) {
        (Some(mapping), ConfigFieldKey::AccountName) => mapping.account_name.clone(),
        (Some(mapping), ConfigFieldKey::AccountNumber) => mapping.account_number.clone(),
        (Some(mapping), ConfigFieldKey::BankName) => mapping.bank_name.clone(),
        _ => String::new(),
    }
}

fn system_value(
    source_value: &str,
    letter_number: &str,
    date_value: &str,
    serial_number: usize,
) -> String {
    match parse_system_variable_key(source_value) {
        Some(SystemVariableKey::LetterNumber) => letter_number.to_string(),
        Some(SystemVariableKey::Date) => format_date(date_value),
        Some(SystemVariableKey::CurrentYear) => Local::now().year().to_string(),
        Some(SystemVariableKey::Serial) => serial_number.to_string(),
        None => String::new(),
    }
}

fn expand_letter_number(
    template: &str,
    settings: &AppSettings,
    date_value: &str,
    serial_number: usize,
) -> String {
    let mut result = template.to_string();
    let year = Local::now().year().to_string();
    let serial = serial_number.to_string();
    let formatted_date = format_date(date_value);
    for (key, value) in [
        (SystemVariableKey::CurrentYear, year.as_str()),
        (SystemVariableKey::Serial, serial.as_str()),
        (SystemVariableKey::Date, formatted_date.as_str()),
    ] {
        let token = system_token(&settings.field_vocabulary, key);
        if token.is_empty() {
            continue;
        }
        result = result.replace(&format!("{{{{{token}}}}}"), value);
        result = result.replace(&format!("%{token}%"), value);
    }
    result
}

pub fn validate_generation_inputs(
    settings: &AppSettings,
    bindings: &[PlaceholderBinding],
    rule: &GenerationRule,
) -> Result<(), AppError> {
    if rule.letter_number_template.trim().is_empty() {
        return Err(AppError::Message(
            "函号模板未配置，请在设置中填写后重试".into(),
        ));
    }
    if rule.file_name_template.trim().is_empty() {
        return Err(AppError::Message(
            "文件名模板未配置，请在设置中填写后重试".into(),
        ));
    }
    for binding in bindings {
        // 空 source_value 由 missing_bindings 路径报「尚未完成绑定」
        if binding.source_value.trim().is_empty() {
            continue;
        }
        match binding.source_type {
            BindingSourceType::System => {
                let key = parse_system_variable_key(&binding.source_value).ok_or_else(|| {
                    AppError::Message(format!(
                        "系统变量绑定「{}」使用了未知标识",
                        binding.placeholder
                    ))
                })?;
                let token = system_token(&settings.field_vocabulary, key);
                if token.trim().is_empty() {
                    return Err(AppError::Message(format!(
                        "系统变量 token 未配置，无法解析「{}」",
                        binding.placeholder
                    )));
                }
            }
            BindingSourceType::Config => {
                let key = parse_config_field_key(&binding.source_value).ok_or_else(|| {
                    AppError::Message(format!(
                        "配置映射绑定「{}」使用了未知标识",
                        binding.placeholder
                    ))
                })?;
                let token = settings
                    .field_vocabulary
                    .config_fields
                    .iter()
                    .find(|item| item.key == key)
                    .map(|item| item.token.as_str())
                    .unwrap_or("");
                if token.trim().is_empty() {
                    return Err(AppError::Message(format!(
                        "配置映射 token 未配置，无法解析「{}」",
                        binding.placeholder
                    )));
                }
                if settings.field_vocabulary.bank_lookup_column.trim().is_empty() {
                    return Err(AppError::Message(
                        "银行查找列未配置，请在设置的字段词表中填写".into(),
                    ));
                }
                if settings.bank_mappings.is_empty() {
                    return Err(AppError::Message(
                        "配置映射为空，请先在设置中维护银行映射".into(),
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn format_date(date_str: &str) -> String {
    // 将 "YYYY-MM-DD" 格式转换为 "YYYY年MM月DD日" 格式
    if date_str.len() == 10 && date_str.chars().nth(4) == Some('-') && date_str.chars().nth(7) == Some('-') {
        let parts: Vec<&str> = date_str.split('-').collect();
        if parts.len() == 3 {
            return format!("{}年{}月{}日", parts[0], parts[1], parts[2]);
        }
    }
    date_str.to_string()
}

fn resolve_replacements(
    row: &HashMap<String, String>,
    bindings: &[PlaceholderBinding],
    settings: &AppSettings,
    letter_number: &str,
    date_value: &str,
    serial_number: usize,
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for def in &settings.field_vocabulary.system_variables {
        if def.token.trim().is_empty() {
            continue;
        }
        let computed = match def.key {
            SystemVariableKey::LetterNumber => letter_number.to_string(),
            SystemVariableKey::Date => format_date(date_value),
            SystemVariableKey::CurrentYear => Local::now().year().to_string(),
            SystemVariableKey::Serial => serial_number.to_string(),
        };
        values.insert(def.token.clone(), computed);
    }
    for binding in bindings {
        let resolved = match binding.source_type {
            BindingSourceType::Excel => row.get(&binding.source_value).cloned().unwrap_or_default(),
            BindingSourceType::System => system_value(
                &binding.source_value,
                letter_number,
                date_value,
                serial_number,
            ),
            BindingSourceType::Fixed => binding.source_value.clone(),
            BindingSourceType::Config => config_value(settings, row, &binding.source_value),
        };
        values.insert(binding.placeholder.clone(), resolved);
    }
    values
}

fn libreoffice_binary(_base_resource_dir: &Path) -> Option<PathBuf> {
    let binary_name = if cfg!(target_os = "windows") {
        "soffice.exe"
    } else {
        "soffice"
    };
    
    // Windows: 尝试在系统PATH中查找
    if cfg!(target_os = "windows") {
        if let Ok(output) = std::process::Command::new("where")
            .arg(binary_name)
            .output() {
            if output.status.success() {
                if let Ok(path_str) = std::str::from_utf8(&output.stdout) {
                    let first_line = path_str.lines().next().unwrap_or("").trim();
                    if !first_line.is_empty() {
                        let system_path = PathBuf::from(first_line);
                        if system_path.exists() {
                            println!("Found LibreOffice in system PATH: {}", system_path.display());
                            return Some(system_path);
                        }
                    }
                }
            }
        }
    } else {
        // macOS/Linux: 使用 which 命令
        if let Ok(output) = std::process::Command::new("which")
            .arg(binary_name)
            .output() {
            if output.status.success() {
                if let Ok(path_str) = std::str::from_utf8(&output.stdout) {
                    let system_path = PathBuf::from(path_str.trim());
                    if system_path.exists() {
                        println!("Found LibreOffice in system PATH: {}", system_path.display());
                        return Some(system_path);
                    }
                }
            }
        }
    }
    
    // macOS: 尝试默认安装路径
    if cfg!(target_os = "macos") {
        let macos_candidates = vec![
            PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
            PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice.bin"),
        ];
        for path in &macos_candidates {
            if path.exists() {
                println!("Found LibreOffice at: {}", path.display());
                return Some(path.clone());
            }
        }
    }
    
    println!("LibreOffice not found in system PATH");
    None
}

pub fn preview_generation(
    _template_path: &str,
    file_path: &str,
    bindings: &[PlaceholderBinding],
    rule: &GenerationRule,
    manual_rows: Option<Vec<HashMap<String, String>>>,
    settings: &AppSettings,
) -> Result<GenerationPreview, AppError> {
    validate_generation_inputs(settings, bindings, rule)?;
    let rows = match manual_rows {
        Some(rows) if !rows.is_empty() => rows,
        _ => load_sheet_rows(file_path, &rule.sheet_name)?,
    };
    let grouped = build_grouped_rows(&rows, rule);
    let missing = missing_bindings(bindings);
    let serial_number = rule.start_number as usize;
    let letter_number = expand_letter_number(&rule.letter_number_template, settings, &rule.date_value, serial_number);
    let replacements = resolve_replacements(
        grouped.first().ok_or_else(|| AppError::Message("没有可预览的数据".into()))?,
        bindings,
        settings,
        &letter_number,
        &rule.date_value,
        serial_number,
    );

    Ok(GenerationPreview {
        total_input_rows: rows.len(),
        total_letters: grouped.len(),
        sample_file_name: apply_template_string(&rule.file_name_template, &replacements),
        missing_bindings: missing,
    })
}

pub fn generate_letters(
    resource_dir: &Path,
    settings: &AppSettings,
    template_path: &str,
    file_path: &str,
    bindings: &[PlaceholderBinding],
    rule: &GenerationRule,
    manual_rows: Option<Vec<HashMap<String, String>>>,
) -> Result<GenerationResult, AppError> {
    validate_generation_inputs(settings, bindings, rule)?;
    let missing = missing_bindings(bindings);
    if !missing.is_empty() {
        return Err(AppError::Message(format!(
            "以下关键词尚未完成绑定: {}",
            missing.join("、")
        )));
    }

    let rows = match manual_rows {
        Some(rows) if !rows.is_empty() => rows,
        _ => load_sheet_rows(file_path, &rule.sheet_name)?,
    };
    let grouped = build_grouped_rows(&rows, rule);
    let output_dir = resolve_output_dir(rule, template_path)?;
    let mut failures = Vec::new();
    let mut docx_success_count = 0;
    let mut pdf_success_count = 0;
    let mut pdf_converter_available = rule.export_pdf;

    // 检查是否有可用的 PDF 转换工具
    if rule.export_pdf {
        if let Ok(output) = Command::new("unoconv").arg("--version").output() {
            if !output.status.success() {
                pdf_converter_available = false;
            }
        } else if let None = libreoffice_binary(resource_dir) {
            pdf_converter_available = false;
        }
    }

    for (index, row) in grouped.iter().enumerate() {
        let serial_number = rule.start_number as usize + index;
        let letter_number = expand_letter_number(&rule.letter_number_template, settings, &rule.date_value, serial_number);
        let replacements =
            resolve_replacements(row, bindings, settings, &letter_number, &rule.date_value, serial_number);
        let file_name = apply_template_string(&rule.file_name_template, &replacements);
        let target_docx = output_dir.join(if file_name.ends_with(".docx") {
            file_name.clone()
        } else {
            format!("{file_name}.docx")
        });

        match render_docx(template_path, &target_docx, &replacements) {
            Ok(()) => {
                docx_success_count += 1;
                if rule.export_pdf && pdf_converter_available {
                    match convert_to_pdf(resource_dir, &target_docx, &output_dir) {
                        Ok(()) => pdf_success_count += 1,
                        Err(error) => failures.push(GenerationFailure {
                            target: target_docx.to_string_lossy().into_owned(),
                            reason: error.to_string(),
                        }),
                    }
                }
            }
            Err(error) => failures.push(GenerationFailure {
                target: target_docx.to_string_lossy().into_owned(),
                reason: error.to_string(),
            }),
        }
    }

    // 如果没有可用的 PDF 转换工具但用户要求导出 PDF，添加提示信息
    if rule.export_pdf && !pdf_converter_available && docx_success_count > 0 {
        println!("警告：未找到 PDF 转换工具，只生成了 DOCX 文件。请安装 LibreOffice 或 unoconv 以启用 PDF 导出功能。");
    }

    Ok(GenerationResult {
        total_input_rows: rows.len(),
        total_letters: grouped.len(),
        docx_success_count,
        pdf_success_count,
        failures,
        output_dir: output_dir.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        ConfigFieldDef, FieldVocabulary, ProfileDefaults, SystemVariableDef,
    };

    fn sample_settings() -> AppSettings {
        AppSettings {
            help_widget_pinned: true,
            help_widget_collapsed: false,
            recent_template_paths: vec![],
            recent_data_source_paths: vec![],
            onboarding_completed: true,
            profile: ProfileDefaults {
                letter_number_template: "TEST〔{{Y}}{{S}}〕".into(),
                file_name_template: "{{L}}.docx".into(),
                start_number: 1,
                export_pdf: false,
            },
            field_vocabulary: FieldVocabulary {
                system_variables: vec![
                    SystemVariableDef { key: SystemVariableKey::LetterNumber, token: "L".into() },
                    SystemVariableDef { key: SystemVariableKey::Date, token: "D".into() },
                    SystemVariableDef { key: SystemVariableKey::CurrentYear, token: "Y".into() },
                    SystemVariableDef { key: SystemVariableKey::Serial, token: "S".into() },
                ],
                config_fields: vec![
                    ConfigFieldDef { key: ConfigFieldKey::AccountName, token: "NM".into() },
                    ConfigFieldDef { key: ConfigFieldKey::AccountNumber, token: "AC".into() },
                    ConfigFieldDef { key: ConfigFieldKey::BankName, token: "BK".into() },
                ],
                bank_lookup_column: "Org".into(),
                default_group_by_fields: vec![],
                default_sum_fields: vec![],
                default_manual_columns: vec![],
            },
            bank_mappings: vec![crate::models::BankMapping {
                key: "OrgA".into(),
                account_name: "Acct Name".into(),
                account_number: "999".into(),
                bank_name: "Some Bank".into(),
            }],
        }
    }

    #[test]
    fn expand_letter_number_uses_configured_tokens() {
        let settings = sample_settings();
        let expanded = expand_letter_number("TEST〔{{Y}}{{S}}〕", &settings, "2026-05-15", 7);
        assert!(expanded.starts_with("TEST〔"));
        assert!(expanded.contains('7'));
        let with_date = expand_letter_number("D{{D}}", &settings, "2026-05-15", 1);
        assert_eq!(with_date, "D2026年05月15日");
    }

    #[test]
    fn resolve_replacements_uses_vocabulary_and_config_slots() {
        let settings = sample_settings();
        let mut row = HashMap::new();
        row.insert("Org".to_string(), "OrgA".to_string());
        let bindings = vec![
            PlaceholderBinding {
                placeholder: "who".into(),
                source_type: BindingSourceType::Config,
                source_value: "account_name".into(),
            },
            PlaceholderBinding {
                placeholder: "num".into(),
                source_type: BindingSourceType::System,
                source_value: "serial".into(),
            },
        ];
        let values = resolve_replacements(
            &row,
            &bindings,
            &settings,
            "LETTER-1",
            "2026-05-15",
            3,
        );
        assert_eq!(values.get("who").map(String::as_str), Some("Acct Name"));
        assert_eq!(values.get("num").map(String::as_str), Some("3"));
        assert_eq!(values.get("S").map(String::as_str), Some("3"));
    }

    #[test]
    fn validate_rejects_empty_templates_and_unconfigured_config_binding() {
        let settings = sample_settings();
        let empty_rule = GenerationRule {
            mode: GenerationMode::Row,
            sheet_name: String::new(),
            group_by_fields: vec![],
            sum_fields: vec![],
            start_number: 1,
            letter_number_template: String::new(),
            file_name_template: String::new(),
            date_value: "2026-05-15".into(),
            export_pdf: false,
            output_dir: None,
        };
        assert!(validate_generation_inputs(&settings, &[], &empty_rule).is_err());

        let mut rule = empty_rule.clone();
        rule.letter_number_template = "X{{S}}".into();
        rule.file_name_template = "f.docx".into();
        let config_binding = vec![PlaceholderBinding {
            placeholder: "acc".into(),
            source_type: BindingSourceType::Config,
            source_value: "account_name".into(),
        }];
        let mut no_maps = sample_settings();
        no_maps.bank_mappings.clear();
        assert!(validate_generation_inputs(&no_maps, &config_binding, &rule).is_err());
        assert!(validate_generation_inputs(&settings, &config_binding, &rule).is_ok());
    }

    #[test]
    fn empty_source_value_falls_through_to_missing_bindings() {
        let settings = sample_settings();
        let rule = GenerationRule {
            mode: GenerationMode::Row,
            sheet_name: String::new(),
            group_by_fields: vec![],
            sum_fields: vec![],
            start_number: 1,
            letter_number_template: "X{{S}}".into(),
            file_name_template: "f.docx".into(),
            date_value: "2026-05-15".into(),
            export_pdf: false,
            output_dir: None,
        };
        let bindings = vec![PlaceholderBinding {
            placeholder: "who".into(),
            source_type: BindingSourceType::System,
            source_value: String::new(),
        }];
        assert!(validate_generation_inputs(&settings, &bindings, &rule).is_ok());
        assert_eq!(missing_bindings(&bindings), vec!["who".to_string()]);
    }

    #[test]
    fn parse_keys_reject_chinese_literals() {
        assert!(parse_system_variable_key("函号").is_none());
        assert!(parse_system_variable_key("日期").is_none());
        assert!(parse_config_field_key("户名").is_none());
        assert!(parse_config_field_key("account_name").is_some());
    }
}

fn convert_to_pdf(resource_dir: &Path, target_docx: &Path, output_dir: &Path) -> Result<(), AppError> {
    // 尝试使用 unoconv
    if let Ok(output) = Command::new("unoconv")
        .arg("-f")
        .arg("pdf")
        .arg("-o")
        .arg(output_dir)
        .arg(target_docx)
        .output() {
        if output.status.success() {
            println!("Successfully converted using unoconv");
            return Ok(());
        }
    }
    
    // 尝试使用 LibreOffice
    match libreoffice_binary(resource_dir) {
        Some(soffice) => {
            let output = Command::new(&soffice)
                .arg("--headless")
                .arg("--convert-to")
                .arg("pdf")
                .arg("--outdir")
                .arg(output_dir)
                .arg(target_docx)
                .output()?;
            if !output.status.success() {
                return Err(AppError::Message(String::from_utf8_lossy(&output.stderr).into_owned()));
            }
            Ok(())
        },
        None => {
            Err(AppError::Message(
                "未找到 PDF 转换工具。请安装 LibreOffice 或 unoconv。".into()
            ))
        }
    }
}
