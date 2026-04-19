use std::{fs, path::PathBuf};

use crate::{error::AppError, models::AppSettings};

fn settings_path() -> Result<PathBuf, AppError> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Message("无法定位本地配置目录".into()))?
        .join("letter-generator");
    fs::create_dir_all(&base)?;
    Ok(base.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, AppError> {
    let path = settings_path()?;
    if !path.exists() {
        let default = AppSettings::default();
        save_settings(default.clone())?;
        return Ok(default);
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn save_settings(settings: AppSettings) -> Result<(), AppError> {
    let path = settings_path()?;
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}
