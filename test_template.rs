use std::collections::HashMap;
use std::path::Path;

use letter_generator::template::render_docx;

fn main() {
    let template_path = "/Users/chen/Documents/Playground/payment/source/template.docx";
    let target_path = Path::new("/Users/chen/Documents/Playground/payment/test_output.docx");
    
    let mut replacements = HashMap::new();
    replacements.insert("账面余额".to_string(), "10000.00".to_string());
    
    match render_docx(template_path, target_path, &replacements) {
        Ok(_) => println!("测试成功: 生成了测试文件 {}", target_path.display()),
        Err(e) => println!("测试失败: {:?}", e),
    }
}