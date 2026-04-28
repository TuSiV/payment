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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub help_widget_pinned: bool,
    pub help_widget_collapsed: bool,
    pub recent_template_paths: Vec<String>,
    pub recent_data_source_paths: Vec<String>,
    pub bank_mappings: Vec<BankMapping>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            help_widget_pinned: true,
            help_widget_collapsed: false,
            recent_template_paths: Vec::new(),
            recent_data_source_paths: Vec::new(),
            bank_mappings: vec![
                BankMapping {
                    key: "A公司".into(),
                    account_name: "A公司".into(),
                    account_number: "1000000000000".into(),
                    bank_name: "中国银行".into(),
                },
                BankMapping {
                    key: "B公司".into(),
                    account_name: "B公司".into(),
                    account_number: "10000000000000".into(),
                    bank_name: "中国银行".into(),
                },
            ],
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
