use std::collections::HashMap;

use calamine::{open_workbook_auto, Data, Reader};
use serde_json::{Map, Value};

use crate::{error::AppError, models::ExcelInspectionResult};

fn data_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.clone(),
        Data::Float(value) => {
            if value.fract() == 0.0 {
                format!("{}", *value as i64)
            } else {
                value.to_string()
            }
        }
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => value.to_string(),
        Data::DateTimeIso(value) => value.clone(),
        Data::DurationIso(value) => value.clone(),
        Data::Error(value) => format!("{value:?}"),
    }
}

pub fn inspect_excel_source(file_path: &str) -> Result<ExcelInspectionResult, AppError> {
    let mut workbook = open_workbook_auto(file_path)?;
    let sheets = workbook.sheet_names().to_vec();
    let active = sheets
        .first()
        .cloned()
        .ok_or_else(|| AppError::Message("Excel 文件中没有可用工作表".into()))?;

    let range = workbook.worksheet_range(&active)?;
    let mut rows = range.rows();
    let headers = rows
        .next()
        .ok_or_else(|| AppError::Message("工作表为空，无法读取表头".into()))?
        .iter()
        .map(data_to_string)
        .collect::<Vec<_>>();

    let preview_rows = rows
        .take(5)
        .map(|row| {
            let mut map = Map::new();
            for (index, header) in headers.iter().enumerate() {
                map.insert(
                    header.clone(),
                    Value::String(row.get(index).map(data_to_string).unwrap_or_default()),
                );
            }
            map
        })
        .collect::<Vec<_>>();

    Ok(ExcelInspectionResult {
        file_path: file_path.into(),
        sheets,
        columns: headers,
        preview_rows,
    })
}

pub fn inspect_sheet(file_path: &str, sheet_name: &str) -> Result<ExcelInspectionResult, AppError> {
    let mut workbook = open_workbook_auto(file_path)?;
    let sheets = workbook.sheet_names().to_vec();
    
    // 验证工作表是否存在
    if !sheets.contains(&sheet_name.to_string()) {
        return Err(AppError::Message(format!("工作表 '{}' 不存在", sheet_name)));
    }

    let range = workbook.worksheet_range(sheet_name)?;
    let mut rows = range.rows();
    let headers = rows
        .next()
        .ok_or_else(|| AppError::Message("工作表为空，无法读取表头".into()))?
        .iter()
        .map(data_to_string)
        .collect::<Vec<_>>();

    let preview_rows = rows
        .take(5)
        .map(|row| {
            let mut map = Map::new();
            for (index, header) in headers.iter().enumerate() {
                map.insert(
                    header.clone(),
                    Value::String(row.get(index).map(data_to_string).unwrap_or_default()),
                );
            }
            map
        })
        .collect::<Vec<_>>();

    Ok(ExcelInspectionResult {
        file_path: file_path.into(),
        sheets,
        columns: headers,
        preview_rows,
    })
}

pub fn load_sheet_rows(
    file_path: &str,
    sheet_name: &str,
) -> Result<Vec<HashMap<String, String>>, AppError> {
    let mut workbook = open_workbook_auto(file_path)?;
    let resolved_sheet = if sheet_name.is_empty() {
        workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| AppError::Message("Excel 文件中没有工作表".into()))?
    } else {
        sheet_name.to_string()
    };
    let range = workbook.worksheet_range(&resolved_sheet)?;
    let mut rows = range.rows();
    let headers = rows
        .next()
        .ok_or_else(|| AppError::Message("工作表为空，无法读取数据".into()))?
        .iter()
        .map(data_to_string)
        .collect::<Vec<_>>();

    let data_rows = rows
        .filter(|row| row.iter().any(|cell| !matches!(cell, Data::Empty)))
        .map(|row| {
            let mut map = HashMap::new();
            for (index, header) in headers.iter().enumerate() {
                map.insert(
                    header.clone(),
                    row.get(index).map(data_to_string).unwrap_or_default(),
                );
            }
            map
        })
        .collect::<Vec<_>>();

    if data_rows.is_empty() {
        return Err(AppError::Message("工作表中没有有效数据行".into()));
    }

    Ok(data_rows)
}
