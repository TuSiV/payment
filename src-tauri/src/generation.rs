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
        AppSettings, BindingSourceType, GenerationFailure, GenerationMode, GenerationPreview,
        GenerationResult, GenerationRule, PlaceholderBinding,
    },
    template::render_docx,
};

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

fn config_value(settings: &AppSettings, key: &str, row: &HashMap<String, String>, field: &str) -> String {
    let lookup = row.get(key).cloned().unwrap_or_default();
    let found = settings
        .bank_mappings
        .iter()
        .find(|mapping| mapping.key == lookup);
    match (found, field) {
        (Some(mapping), "户名") => mapping.account_name.clone(),
        (Some(mapping), "账号") => mapping.account_number.clone(),
        (Some(mapping), "开户行") => mapping.bank_name.clone(),
        _ => String::new(),
    }
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
    values.insert("函号".into(), letter_number.into());
    values.insert("日期".into(), format_date(date_value));
    values.insert("当前年份".into(), Local::now().year().to_string());
    values.insert("序号".into(), serial_number.to_string());
    for binding in bindings {
        let resolved = match binding.source_type {
            BindingSourceType::Excel => row.get(&binding.source_value).cloned().unwrap_or_default(),
            BindingSourceType::System => values.get(&binding.source_value).cloned().unwrap_or_default(),
            BindingSourceType::Fixed => binding.source_value.clone(),
            BindingSourceType::Config => config_value(settings, "填报单位", row, &binding.source_value),
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
) -> Result<GenerationPreview, AppError> {
    let rows = load_sheet_rows(file_path, &rule.sheet_name)?;
    let grouped = build_grouped_rows(&rows, rule);
    let missing = missing_bindings(bindings);
    let serial_number = rule.start_number as usize;
    let letter_number = rule
        .letter_number_template
        .replace("{{当前年份}}", &Local::now().year().to_string())
        .replace("{{序号}}", &serial_number.to_string());
    let replacements = resolve_replacements(
        grouped.first().ok_or_else(|| AppError::Message("没有可预览的数据".into()))?,
        bindings,
        &AppSettings::default(),
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
) -> Result<GenerationResult, AppError> {
    let missing = missing_bindings(bindings);
    if !missing.is_empty() {
        return Err(AppError::Message(format!(
            "以下关键词尚未完成绑定: {}",
            missing.join("、")
        )));
    }

    let rows = load_sheet_rows(file_path, &rule.sheet_name)?;
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
        let letter_number = rule
            .letter_number_template
            .replace("{{当前年份}}", &Local::now().year().to_string())
            .replace("{{序号}}", &serial_number.to_string());
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
