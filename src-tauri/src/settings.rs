use std::{fs, path::PathBuf};

use crate::{
    error::AppError,
    models::{
        AppSettings, ConfigFieldDef, ConfigFieldKey, FieldVocabulary, SystemVariableDef,
        SystemVariableKey,
    },
};

fn settings_path() -> Result<PathBuf, AppError> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Message("无法定位本地配置目录".into()))?
        .join("letter-generator");
    fs::create_dir_all(&base)?;
    Ok(base.join("settings.json"))
}

/// 保证 4+3 语义槽位始终齐全，避免 `{}` 反序列化成空 Vec。
fn normalize_vocabulary(mut vocab: FieldVocabulary) -> FieldVocabulary {
    for key in [
        SystemVariableKey::LetterNumber,
        SystemVariableKey::Date,
        SystemVariableKey::CurrentYear,
        SystemVariableKey::Serial,
    ] {
        if !vocab.system_variables.iter().any(|item| item.key == key) {
            vocab.system_variables.push(SystemVariableDef {
                key,
                token: String::new(),
            });
        }
    }
    for key in [
        ConfigFieldKey::AccountName,
        ConfigFieldKey::AccountNumber,
        ConfigFieldKey::BankName,
    ] {
        if !vocab.config_fields.iter().any(|item| item.key == key) {
            vocab.config_fields.push(ConfigFieldDef {
                key,
                token: String::new(),
            });
        }
    }
    vocab
}

pub fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        let default = AppSettings::default();
        save_settings(default.clone())?;
        return Ok(default);
    }
    let content = fs::read_to_string(path)?;
    let mut settings: AppSettings = serde_json::from_str(&content)?;
    settings.field_vocabulary = normalize_vocabulary(settings.field_vocabulary);
    Ok(settings)
}

pub fn save_settings(settings: AppSettings) -> Result<(), AppError> {
    let path = settings_path()?;
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}
