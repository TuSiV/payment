mod error;
mod excel;
mod generation;
mod models;
mod settings;
mod template;

use std::path::{Path, PathBuf};

use std::collections::HashMap;

use models::{
    AppSettings, ExcelInspectionResult, GenerationPreview, GenerationResult, GenerationRule,
    PlaceholderBinding, TemplateInspectionResult,
};
use tauri::{Manager, State};

struct AppState {
    resource_dir: PathBuf,
}

#[tauri::command]
fn inspect_word_template(template_path: String) -> Result<TemplateInspectionResult, String> {
    template::inspect_word_template(&template_path).map_err(String::from)
}

#[tauri::command]
fn inspect_excel_source(file_path: String) -> Result<ExcelInspectionResult, String> {
    excel::inspect_excel_source(&file_path).map_err(String::from)
}

#[tauri::command]
fn inspect_sheet(file_path: String, sheet_name: String) -> Result<ExcelInspectionResult, String> {
    excel::inspect_sheet(&file_path, &sheet_name).map_err(String::from)
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, String> {
    settings::load_settings().map_err(String::from)
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings::save_settings(settings).map_err(String::from)
}

#[tauri::command]
fn preview_generation(
    template_path: String,
    file_path: String,
    bindings: Vec<PlaceholderBinding>,
    rule: GenerationRule,
    manual_rows: Option<Vec<HashMap<String, String>>>,
) -> Result<GenerationPreview, String> {
    let settings = settings::load_settings().map_err(String::from)?;
    generation::preview_generation(&template_path, &file_path, &bindings, &rule, manual_rows, &settings)
        .map_err(String::from)
}

#[tauri::command]
fn generate_letters(
    state: State<AppState>,
    template_path: String,
    file_path: String,
    bindings: Vec<PlaceholderBinding>,
    rule: GenerationRule,
    manual_rows: Option<Vec<HashMap<String, String>>>,
) -> Result<GenerationResult, String> {
    let settings = settings::load_settings().map_err(String::from)?;
    generation::generate_letters(
        Path::new(&state.resource_dir),
        &settings,
        &template_path,
        &file_path,
        &bindings,
        &rule,
        manual_rows,
    )
    .map_err(String::from)
}

#[tauri::command]
fn open_output_dir(path: String) -> Result<(), String> {
    open::that(path).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| PathBuf::from("src-tauri"));
            app.manage(AppState { resource_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
        inspect_word_template,
        inspect_excel_source,
        inspect_sheet,
        load_settings,
        save_settings,
        preview_generation,
        generate_letters,
        open_output_dir
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
