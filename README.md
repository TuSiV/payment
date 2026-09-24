# 函件生成器

基于 `Tauri + React + TypeScript + Rust` 的桌面函件生成器，目标是交付为无需额外安装 Python 的跨平台桌面应用。

## 当前实现

- 首次启动引导向导：配置函号/文件名模板、字段词表、银行映射（可跳过）
- 分步式工作台 UI：
  - 导入 Word 模板
  - 导入数据源（Excel 或软件内手动填写/粘贴）
  - 配置关键词映射与导出规则
  - 生成并导出函件
- 可配置（不硬编码业务敏感信息）：
  - 函号模板、文件名模板
  - 系统变量 / 配置映射的 token 词面
  - 银行查找列、默认分组/求和/手填列
  - 银行映射（户名、账号、开户行）保存在本机 `settings.json`
- 模板解析：
  - 支持 `{{关键词}}`
  - 兼容 `%关键词%`
  - 扫描正文、页眉、页脚
- Excel 解析：
  - 列出工作表
  - 读取表头
  - 预览前几行
- 生成逻辑：
  - 逐行生成
  - 分组生成
  - 分组字段与求和字段由设置中的词表决定
- PDF 导出：
  - 使用本机 LibreOffice 或 unoconv 进行 PDF 转换
  - 支持 Windows 和 macOS 平台

## 本地开发

1. 安装 Node 和 Rust。
2. 在项目根目录执行：

```bash
npm install
```

3. 启动前端和 Tauri 开发环境：

```bash
npm run tauri dev
```

## 打包说明

- 最终安装包由 Tauri bundler 生成。
- Windows: 生成 NSIS 安装包
- macOS: 生成 DMG 安装包

## 依赖说明

### PDF 导出依赖

应用需要用户本地安装 LibreOffice 才能使用 PDF 导出功能：

- **Windows**: 安装后需确保 `soffice.exe` 在系统 PATH 中
- **macOS**: 安装到 `/Applications/LibreOffice.app` 即可自动识别

如果未安装 LibreOffice，应用仍可正常生成 DOCX 文件，但无法导出 PDF。

## 当前已知限制

- Word 占位符替换目前基于 DOCX 内部 XML 文本替换：
  - 对普通段落、表格、页眉、页脚有效
  - 如果关键词在 Word 中被拆成多个 run，可能无法命中
- 配置保存在本机 `letter-generator/settings.json`，无多套配置档/云同步
- 业务文号、账号等敏感信息请在向导/设置中填写，不要写入代码仓库
