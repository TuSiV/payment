use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum PlaceholderSyntax {
    DoubleBrace,
    LegacyPercent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInspectionResult {
    pub template_path: String,
    pub placeholders: Vec<String>,
    pub placeholder_syntaxes: Vec<PlaceholderSyntax>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelInspectionResult {
    pub file_path: String,
    pub sheets: Vec<String>,
    pub columns: Vec<String>,
    pub preview_rows: Vec<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BindingSourceType {
    Excel,
    System,
    Fixed,
    Config,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceholderBinding {
    pub placeholder: String,
    pub source_type: BindingSourceType,
    pub source_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BankMapping {
    pub key: String,
    pub account_name: String,
    pub account_number: String,
    pub bank_name: String,
}

/// 固定语义系统变量；token 为模板/绑定中的词面，由用户配置。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SystemVariableKey {
    LetterNumber,
    Date,
    CurrentYear,
    Serial,
}

/// 固定槽位配置映射字段；token 为绑定下拉中的词面，由用户配置。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFieldKey {
    AccountName,
    AccountNumber,
    BankName,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVariableDef {
    pub key: SystemVariableKey,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFieldDef {
    pub key: ConfigFieldKey,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldVocabulary {
    #[serde(default)]
    pub system_variables: Vec<SystemVariableDef>,
    #[serde(default)]
    pub config_fields: Vec<ConfigFieldDef>,
    #[serde(default)]
    pub bank_lookup_column: String,
    #[serde(default)]
    pub default_group_by_fields: Vec<String>,
    #[serde(default)]
    pub default_sum_fields: Vec<String>,
    #[serde(default)]
    pub default_manual_columns: Vec<String>,
}

impl Default for FieldVocabulary {
    fn default() -> Self {
        Self {
            system_variables: vec![
                SystemVariableDef { key: SystemVariableKey::LetterNumber, token: String::new() },
                SystemVariableDef { key: SystemVariableKey::Date, token: String::new() },
                SystemVariableDef { key: SystemVariableKey::CurrentYear, token: String::new() },
                SystemVariableDef { key: SystemVariableKey::Serial, token: String::new() },
            ],
            config_fields: vec![
                ConfigFieldDef { key: ConfigFieldKey::AccountName, token: String::new() },
                ConfigFieldDef { key: ConfigFieldKey::AccountNumber, token: String::new() },
                ConfigFieldDef { key: ConfigFieldKey::BankName, token: String::new() },
            ],
            bank_lookup_column: String::new(),
            default_group_by_fields: Vec::new(),
            default_sum_fields: Vec::new(),
            default_manual_columns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDefaults {
    #[serde(default)]
    pub letter_number_template: String,
    #[serde(default)]
    pub file_name_template: String,
    #[serde(default = "default_start_number")]
    pub start_number: u32,
    #[serde(default)]
    pub export_pdf: bool,
}

fn default_start_number() -> u32 {
    1
}

impl Default for ProfileDefaults {
    fn default() -> Self {
        Self {
            letter_number_template: String::new(),
            file_name_template: String::new(),
            start_number: default_start_number(),
            export_pdf: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub help_widget_pinned: bool,
    pub help_widget_collapsed: bool,
    pub recent_template_paths: Vec<String>,
    pub recent_data_source_paths: Vec<String>,
    /// 首次启动引导向导是否完成；旧配置缺省视为 false。
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub profile: ProfileDefaults,
    #[serde(default)]
    pub field_vocabulary: FieldVocabulary,
    pub bank_mappings: Vec<BankMapping>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            help_widget_pinned: true,
            help_widget_collapsed: false,
            recent_template_paths: Vec::new(),
            recent_data_source_paths: Vec::new(),
            onboarding_completed: false,
            profile: ProfileDefaults::default(),
            field_vocabulary: FieldVocabulary::default(),
            bank_mappings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GenerationMode {
    Row,
    Grouped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRule {
    pub mode: GenerationMode,
    pub sheet_name: String,
    pub group_by_fields: Vec<String>,
    pub sum_fields: Vec<String>,
    pub start_number: u32,
    pub letter_number_template: String,
    pub file_name_template: String,
    pub date_value: String,
    pub export_pdf: bool,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationPreview {
    pub total_input_rows: usize,
    pub total_letters: usize,
    pub sample_file_name: String,
    pub missing_bindings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationFailure {
    pub target: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub total_input_rows: usize,
    pub total_letters: usize,
    pub docx_success_count: usize,
    pub pdf_success_count: usize,
    pub failures: Vec<GenerationFailure>,
    pub output_dir: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_have_no_sensitive_seeds() {
        let settings = AppSettings::default();
        assert!(settings.bank_mappings.is_empty());
        assert!(settings.profile.letter_number_template.is_empty());
        assert!(!settings.onboarding_completed);
        let json = serde_json::to_string(&settings).unwrap();
        assert!(!json.contains("船物法函"));
        assert!(!json.contains("A公司"));
        assert!(!json.contains("1000000000000"));
    }

    #[test]
    fn legacy_settings_json_loads_with_empty_profile() {
        let legacy = r#"{
            "helpWidgetPinned": true,
            "helpWidgetCollapsed": false,
            "recentTemplatePaths": [],
            "recentDataSourcePaths": [],
            "bankMappings": [{"key":"旧客户","accountName":"旧户名","accountNumber":"1","bankName":"某行"}]
        }"#;
        let settings: AppSettings = serde_json::from_str(legacy).unwrap();
        assert!(!settings.onboarding_completed);
        assert!(settings.profile.letter_number_template.is_empty());
        assert_eq!(settings.bank_mappings.len(), 1);
        assert_eq!(settings.bank_mappings[0].key, "旧客户");
        assert_eq!(settings.field_vocabulary.system_variables.len(), 4);
    }
}
