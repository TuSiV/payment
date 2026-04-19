use calamine::{open_workbook_auto, Reader};

fn main() {
    let file_path = "/Users/chen/Documents/Playground/payment/source/model.xlsx";
    let mut workbook = open_workbook_auto(file_path).expect("Failed to open Excel file");
    
    // 打印所有工作表名称
    let sheets = workbook.sheet_names().to_vec();
    println!("Sheets: {:?}", sheets);
    
    // 读取第一个工作表
    if let Some(sheet_name) = sheets.first() {
        println!("\nReading sheet: {}", sheet_name);
        let range = workbook.worksheet_range(sheet_name).expect("Failed to read worksheet");
        
        // 打印表头
        if let Some(row) = range.rows().next() {
            println!("Columns: {:?}", row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>());
        }
        
        // 打印前5行数据
        println!("\nFirst 5 rows:");
        for (i, row) in range.rows().enumerate().take(6) {
            if i == 0 {
                continue; // 跳过表头
            }
            println!("Row {}: {:?}", i, row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>());
        }
    }
}