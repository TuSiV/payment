use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{Cursor, Read, Write},
    path::Path,
};

use regex::Regex;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::{
    error::AppError,
    models::{PlaceholderSyntax, TemplateInspectionResult},
};

fn xml_entries(path: &str) -> Result<Vec<(String, Vec<u8>)>, AppError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        entries.push((name, bytes));
    }
    Ok(entries)
}

pub fn inspect_word_template(template_path: &str) -> Result<TemplateInspectionResult, AppError> {
    let entries = xml_entries(template_path)?;
    let double_brace = Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").expect("valid regex");
    let legacy_percent = Regex::new(r"%([^%]+)%").expect("valid regex");
    let xml_tag_regex = Regex::new(r"<[^>]+>").expect("valid regex");
    let mut placeholders = BTreeSet::new();
    let mut syntaxes = BTreeSet::new();

    for (name, bytes) in entries {
        if !is_target_entry(&name) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        for capture in double_brace.captures_iter(&content) {
            let raw_placeholder = capture[1].trim().to_string();
            let clean_placeholder = xml_tag_regex.replace_all(&raw_placeholder, "").trim().to_string();
            if !clean_placeholder.is_empty() {
                placeholders.insert(clean_placeholder);
                syntaxes.insert(PlaceholderSyntax::DoubleBrace);
            }
        }
        for capture in legacy_percent.captures_iter(&content) {
            let raw_placeholder = capture[1].trim().to_string();
            let clean_placeholder = xml_tag_regex.replace_all(&raw_placeholder, "").trim().to_string();
            if !clean_placeholder.is_empty() {
                placeholders.insert(clean_placeholder);
                syntaxes.insert(PlaceholderSyntax::LegacyPercent);
            }
        }
    }

    Ok(TemplateInspectionResult {
        template_path: template_path.into(),
        placeholders: placeholders.into_iter().collect(),
        placeholder_syntaxes: syntaxes.into_iter().collect(),
    })
}

fn is_target_entry(name: &str) -> bool {
    name == "word/document.xml"
        || (name.starts_with("word/header") && name.ends_with(".xml"))
        || (name.starts_with("word/footer") && name.ends_with(".xml"))
}

pub fn render_docx(
    template_path: &str,
    target_path: &Path,
    replacements: &HashMap<String, String>,
) -> Result<(), AppError> {
    let entries = xml_entries(template_path)?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, bytes) in entries {
        writer.start_file(name.clone(), options)?;
        if is_target_entry(&name) {
            let mut content = String::from_utf8_lossy(&bytes).into_owned();
            
            // 对每个关键词进行替换，使用更灵活的方法处理XML标签干扰
            for (key, value) in replacements {
                // 处理双花括号语法
                let clean_content = content.clone();
                // 移除所有XML标签
                let xml_tag_regex = Regex::new(r"<[^>]+>").expect("valid regex");
                let cleaned = xml_tag_regex.replace_all(&clean_content, "").to_string();
                
                // 检查是否包含双花括号语法的关键词
                let double_brace_pattern = format!(r"\{{\{{\s*{}\s*\}}\}}", regex::escape(key));
                let double_brace_regex = Regex::new(&double_brace_pattern).expect("valid regex");
                if double_brace_regex.is_match(&cleaned) {
                    // 构建更灵活的正则表达式，允许标签和空格的干扰
                    let mut pattern_parts = Vec::new();
                    for c in key.chars() {
                        pattern_parts.push(format!(r"(?:<[^>]*>)*\s*{}(?:<[^>]*>)*\s*", regex::escape(&c.to_string())));
                    }
                    let pattern = format!(r"\{{\{{{}\}}\}}", pattern_parts.join(""));
                    let regex = Regex::new(&pattern).expect("valid regex");
                    content = regex.replace_all(&content, value).to_string();
                }
                
                // 检查是否包含百分号语法的关键词
                let percent_pattern = format!(r"%\s*{}\s*%", regex::escape(key));
                let percent_regex = Regex::new(&percent_pattern).expect("valid regex");
                if percent_regex.is_match(&cleaned) {
                    // 构建更灵活的正则表达式，允许标签和空格的干扰
                    let mut pattern_parts = Vec::new();
                    for c in key.chars() {
                        pattern_parts.push(format!(r"(?:<[^>]*>)*\s*{}(?:<[^>]*>)*\s*", regex::escape(&c.to_string())));
                    }
                    let pattern = format!(r"%{}(?:<[^>]*>)*\s*%", pattern_parts.join(""));
                    let regex = Regex::new(&pattern).expect("valid regex");
                    content = regex.replace_all(&content, value).to_string();
                }
            }
            
            writer.write_all(content.as_bytes())?;
        } else {
            writer.write_all(&bytes)?;
        }
    }

    let buffer = writer.finish()?.into_inner();
    std::fs::write(target_path, buffer)?;
    Ok(())
}
