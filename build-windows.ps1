# Windows构建脚本
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tauri Windows 构建脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] 检查环境..." -ForegroundColor Green
Write-Host "  Node.js: $(node --version)" -ForegroundColor Gray
Write-Host "  Rust: $(rustc --version)" -ForegroundColor Gray
Write-Host "  Tauri CLI: $(npx tauri --version)" -ForegroundColor Gray
Write-Host ""

Write-Host "[2/5] 安装前端依赖..." -ForegroundColor Green
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: npm install 失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "[3/5] 清理旧的构建文件..." -ForegroundColor Green
if (Test-Path "src-tauri\target\release") {
    Remove-Item -Path "src-tauri\target\release" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  已清理 target/release" -ForegroundColor Gray
}
if (Test-Path "dist") {
    Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  已清理 dist" -ForegroundColor Gray
}
Write-Host ""

Write-Host "[4/5] 开始构建..." -ForegroundColor Green
Write-Host "  这可能需要几分钟时间，请耐心等待..." -ForegroundColor Yellow
Write-Host ""

npx tauri build --target x86_64-pc-windows-msvc

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  构建成功!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "安装包位置:" -ForegroundColor Yellow
    
    # 查找生成的安装包
    $nsisPath = Get-ChildItem -Path "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
    if ($nsisPath) {
        Write-Host "  NSIS安装包: $($nsisPath.FullName)" -ForegroundColor Green
    }
    
    $appPath = Get-ChildItem -Path "src-tauri\target\x86_64-pc-windows-msvc\release\bundle" -Filter "*.msi" -Recurse -ErrorAction SilentlyContinue
    if ($appPath) {
        Write-Host "  MSI安装包: $($appPath.FullName)" -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  构建失败!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "请检查上面的错误信息" -ForegroundColor Yellow
    exit 1
}
