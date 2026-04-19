# 函件生成器

基于 `Tauri + React + TypeScript + Rust` 的桌面函件生成器，目标是交付为无需额外安装 Python 的 Windows 应用，并在打包时内置 LibreOffice 必需组件以支持 PDF 导出。

## 当前实现

- 分步式工作台 UI：
  - 导入 Word 模板
  - 导入 Excel 数据源
  - 配置关键词映射与导出规则
  - 生成并导出函件
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
  - 默认按 `客户名称 + 填报单位 + 客户类型` 分组
  - 默认对 `账面余额` 求和
- PDF 导出：
  - 应用运行时优先使用内置 `LibreOffice` 组件
  - 当前资源目录预留在 `src-tauri/resources/libreoffice/`

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

- 最终 Windows 安装包由 Tauri bundler 生成。
- 在正式打包前，将 LibreOffice 的 Windows 必需运行文件放入：

```text
src-tauri/resources/libreoffice/
```

- 运行时会优先查找：
  - `libreoffice/program/soffice.exe`
  - 开发态兼容 `src-tauri/resources/libreoffice/program/soffice.exe`

## 当前已知限制

- Word 占位符替换目前基于 DOCX 内部 XML 文本替换：
  - 对普通段落、表格、页眉、页脚有效
  - 如果关键词在 Word 中被拆成多个 run，可能无法命中
- 还未实现应用内编辑银行映射的独立设置页，当前读取本地配置文件
- 尚未真正附带 LibreOffice 二进制，只预留了资源目录和调用路径
