import { AnimatePresence, motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  BindingSourceType,
  ExcelInspectionResult,
  GenerationPreview,
  GenerationResult,
  GenerationRule,
  PlaceholderBinding,
  TemplateInspectionResult
} from "./lib/types";

type StepId = "template" | "data" | "mapping" | "generate";

const stepOrder: StepId[] = ["template", "data", "mapping", "generate"];

const stepMeta: Record<StepId, { title: string; kicker: string }> = {
  template: { title: "导入函件模板", kicker: "Step 1" },
  data: { title: "导入数据源 / 添加数据", kicker: "Step 2" },
  mapping: { title: "配置关键词和规则", kicker: "Step 3" },
  generate: { title: "生成并导出", kicker: "Step 4" }
};

const helpContent: Record<StepId, string[]> = {
  template: [
    "选择 .docx 模板后，系统会自动解析正文、表格、页眉和页脚中的关键词。",
    "推荐使用 {{客户名称}} 这类占位符，也兼容旧格式 %客户名称%。",
    "如果没有识别到关键词，仍可继续，但最终函件不会替换动态内容。"
  ],
  data: [
    "支持两种数据来源：导入 Excel 文件或在软件内手动填写。",
    "手动填写时可从 Excel 复制数据直接粘贴，支持整行、整列或多行多列区域。",
    "粘贴数据只保留文本值，行和列会自动扩展以匹配数据量。",
    "分组生成默认会按客户名称、填报单位、客户类型聚合。"
  ],
  mapping: [
    "每个关键词都可以映射到 Excel 列、系统变量、固定文本或配置映射值。",
    "系统变量适合函号、日期、年份、序号。",
    "配置映射值适合按填报单位自动带出户名、账号、开户行。"
  ],
  generate: [
    "生成时会先导出 DOCX，如勾选 PDF 会再调用内置 LibreOffice 转换。",
    "可以自定义输出目录；不选择时将自动生成时间戳目录。",
    "即使部分 PDF 转换失败，已生成的 DOCX 也会保留。"
  ]
};

const systemOptions = ["函号", "日期", "当前年份", "序号"];
const configOptions = ["户名", "账号", "开户行"];

const defaultRule = (): GenerationRule => ({
  mode: "grouped",
  sheetName: "",
  groupByFields: ["客户名称", "填报单位", "客户类型"],
  sumFields: ["账面余额"],
  startNumber: 1,
  letterNumberTemplate: "船物法函〔{{当前年份}}〕{{序号}}号",
  fileNameTemplate: "{{函号}}_{{填报单位}}_{{客户名称}}.docx",
  dateValue: new Date().toISOString().slice(0, 10),
  exportPdf: true,
  outputDir: null
});

const defaultSettings: AppSettings = {
  helpWidgetPinned: true,
  helpWidgetCollapsed: false,
  recentTemplatePaths: [],
  recentDataSourcePaths: [],
  bankMappings: [
    {
      key: "A公司",
      accountName: "A公司",
      accountNumber: "1000000000000",
      bankName: "中国银行"
    },
    {
      key: "B公司",
      accountName: "B公司",
      accountNumber: "10000000000000",
      bankName: "中国银行"
    }
  ]
};

function App() {
  const [currentStep, setCurrentStep] = useState<StepId>("template");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [templateInfo, setTemplateInfo] = useState<TemplateInspectionResult | null>(null);
  const [excelInfo, setExcelInfo] = useState<ExcelInspectionResult | null>(null);
  const [rule, setRule] = useState<GenerationRule>(defaultRule);
  const [bindings, setBindings] = useState<PlaceholderBinding[]>([]);
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBankMappingModal, setShowBankMappingModal] = useState(false);
  const [editingBankMappingIndex, setEditingBankMappingIndex] = useState<number | null>(null);
  const [bankMappingForm, setBankMappingForm] = useState({
    key: "",
    accountName: "",
    accountNumber: "",
    bankName: ""
  });

  const [dataSourceMode, setDataSourceMode] = useState<"excel" | "manual">("excel");
  const [manualColumns, setManualColumns] = useState<string[]>(["填报单位", "客户名称", "账面余额"]);
  const [manualRows, setManualRows] = useState<Record<string, string>[]>([]);
  const [editingColIndex, setEditingColIndex] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => setSettings(loaded))
      .catch(() => setSettings(defaultSettings));
  }, []);

  useEffect(() => {
    if (!excelInfo || !templateInfo) {
      return;
    }
    setBindings((current) => {
        const next = templateInfo.placeholders.map((placeholder) => {
          const existing = current.find((item) => item.placeholder === placeholder);
          const exactColumn = excelInfo.columns.find((column) => column === placeholder);
          if (existing) {
            return existing;
          }
          const sourceType: BindingSourceType = exactColumn ? "excel" : "fixed";
          return {
            placeholder,
            sourceType,
            sourceValue: exactColumn ?? ""
          };
        });
      return next;
    });
  }, [excelInfo, templateInfo]);

  async function persistSettings(next: AppSettings) {
    setSettings(next);
    try {
      await invoke("save_settings", { settings: next });
    } catch (saveError) {
      console.error(saveError);
    }
  }

  async function chooseTemplate() {
    setError(null);
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Word Template", extensions: ["docx"] }]
    });
    if (!path || Array.isArray(path)) {
      return;
    }
    setBusyMessage("正在解析函件模板...");
    try {
      const inspected = await invoke<TemplateInspectionResult>("inspect_word_template", {
        templatePath: path
      });
      setTemplateInfo(inspected);
      setCurrentStep("data");
      setResult(null);
      setPreview(null);
      await persistSettings({
        ...settings,
        recentTemplatePaths: [path, ...settings.recentTemplatePaths.filter((item) => item !== path)].slice(
          0,
          5
        )
      });
    } catch (inspectError) {
      setError(String(inspectError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function chooseExcel() {
    setError(null);
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Excel Workbook", extensions: ["xlsx", "xls"] }]
    });
    if (!path || Array.isArray(path)) {
      return;
    }
    setBusyMessage("正在解析数据源...");
    try {
      const inspected = await invoke<ExcelInspectionResult>("inspect_excel_source", {
        filePath: path
      });
      setExcelInfo(inspected);
      setRule((current) => ({
        ...current,
        sheetName: inspected.sheets[0] ?? ""
      }));
      setCurrentStep("mapping");
      await persistSettings({
        ...settings,
        recentDataSourcePaths: [path, ...settings.recentDataSourcePaths.filter((item) => item !== path)].slice(
          0,
          5
        )
      });
    } catch (inspectError) {
      setError(String(inspectError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function chooseOutputDir() {
    const path = await open({
      directory: true,
      multiple: false
    });
    if (!path || Array.isArray(path)) {
      return;
    }
    setRule((current) => ({ ...current, outputDir: path }));
  }

  async function runPreview() {
    if (!templateInfo || !excelInfo) {
      return;
    }
    setBusyMessage("正在预估生成结果...");
    setError(null);
    try {
      const nextPreview = await invoke<GenerationPreview>("preview_generation", {
        templatePath: templateInfo.templatePath,
        filePath: excelInfo.filePath,
        bindings,
        rule,
        manualRows: dataSourceMode === "manual" && manualRows.length > 0 ? manualRows : null
      });
      setPreview(nextPreview);
      setCurrentStep("generate");
    } catch (previewError) {
      setError(String(previewError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function generateLetters() {
    if (!templateInfo || !excelInfo) {
      return;
    }
    setBusyMessage("正在生成函件...");
    setError(null);
    try {
      const generated = await invoke<GenerationResult>("generate_letters", {
        templatePath: templateInfo.templatePath,
        filePath: excelInfo.filePath,
        bindings,
        rule,
        manualRows: dataSourceMode === "manual" && manualRows.length > 0 ? manualRows : null
      });
      setResult(generated);
    } catch (generationError) {
      setError(String(generationError));
    } finally {
      setBusyMessage(null);
    }
  }

  async function openOutputDir() {
    if (!result) {
      return;
    }
    await invoke("open_output_dir", { path: result.outputDir });
  }

  function handleEditBankMapping(index: number) {
    const mapping = settings.bankMappings[index];
    setBankMappingForm(mapping);
    setEditingBankMappingIndex(index);
    setShowBankMappingModal(true);
  }

  function handleDeleteBankMapping(index: number) {
    if (window.confirm("确定要删除这个银行映射吗？")) {
      const updatedMappings = settings.bankMappings.filter((_, i) => i !== index);
      persistSettings({ ...settings, bankMappings: updatedMappings });
    }
  }

  function handleBankMappingFormChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setBankMappingForm(prev => ({
      ...prev,
      [name]: value
    }));
  }

  function handleBankMappingSubmit() {
    if (!bankMappingForm.key || !bankMappingForm.accountName || !bankMappingForm.accountNumber || !bankMappingForm.bankName) {
      alert("请填写所有必填字段");
      return;
    }

    let updatedMappings;
    if (editingBankMappingIndex !== null) {
      updatedMappings = [...settings.bankMappings];
      updatedMappings[editingBankMappingIndex] = bankMappingForm;
    } else {
      // 检查是否已存在相同的key
      if (settings.bankMappings.some(mapping => mapping.key === bankMappingForm.key)) {
        alert("已存在相同的映射键，请使用不同的键");
        return;
      }
      updatedMappings = [...settings.bankMappings, bankMappingForm];
    }

    persistSettings({ ...settings, bankMappings: updatedMappings });
    handleCloseBankMappingModal();
  }

  function handleCloseBankMappingModal() {
    setShowBankMappingModal(false);
    setEditingBankMappingIndex(null);
    setBankMappingForm({
      key: "",
      accountName: "",
      accountNumber: "",
      bankName: ""
    });
  }

  const stepReady = useMemo(
    () => ({
      template: Boolean(templateInfo),
      data: Boolean(excelInfo),
      mapping: bindings.length > 0,
      generate: Boolean(preview)
    }),
    [templateInfo, excelInfo, bindings, preview]
  );

  const canPreview = templateInfo && excelInfo && bindings.every((item) => item.sourceValue.trim().length > 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Letter Studio</p>
          <h1>函件生成器</h1>
          <p className="sidebar-copy">按模板、数据、规则、导出四步完成整批函件生成。</p>
        </div>
        <div className="step-list">
          {stepOrder.map((step) => (
            <button
              key={step}
              className={`step-item ${currentStep === step ? "active" : ""}`}
              onClick={() => {
                if (step === "template" || stepReady[stepOrder[stepOrder.indexOf(step) - 1]]) {
                  setCurrentStep(step);
                }
              }}
            >
              <span>{stepMeta[step].kicker}</span>
              <strong>{stepMeta[step].title}</strong>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">{stepMeta[currentStep].kicker}</p>
            <h2>{stepMeta[currentStep].title}</h2>
          </div>
          {busyMessage ? <div className="status-chip busy">{busyMessage}</div> : <div className="status-chip">就绪</div>}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <AnimatePresence mode="wait">
          <motion.section
            key={currentStep}
            className="panel"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {currentStep === "template" ? (
              <div className="stack">
                <button className="hero-dropzone" onClick={chooseTemplate}>
                  <span className="eyebrow">Word 模板</span>
                  <strong>选择 .docx 函件模板</strong>
                  <span>解析正文、表格、页眉、页脚中的关键词</span>
                </button>
                {templateInfo ? (
                  <div className="summary-card">
                    <h3>{templateInfo.templatePath}</h3>
                    <p>识别到 {templateInfo.placeholders.length} 个关键词</p>
                    <div className="token-list">
                      {templateInfo.placeholders.map((placeholder) => (
                        <span key={placeholder} className="token">
                          {placeholder}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentStep === "data" ? (
              <div className="stack">
                <div className="data-source-toggle">
                  <button
                    className={`toggle-button ${dataSourceMode === "excel" ? "active" : ""}`}
                    onClick={() => {
                      setDataSourceMode("excel");
                      setManualRows([]);
                      setManualColumns(["填报单位", "客户名称", "账面余额"]);
                      setExcelInfo(null);
                    }}
                  >
                    导入 Excel
                  </button>
                  <button
                    className={`toggle-button ${dataSourceMode === "manual" ? "active" : ""}`}
                    onClick={() => {
                      setDataSourceMode("manual");
                      setExcelInfo(null);
                    }}
                  >
                    手动填写
                  </button>
                </div>

                {dataSourceMode === "excel" ? (
                  <>
                    <button className="hero-dropzone" onClick={chooseExcel}>
                      <span className="eyebrow">Excel 数据源</span>
                      <strong>选择 .xlsx 或 .xls 文件</strong>
                      <span>读取工作表、表头和前几行预览</span>
                    </button>
                    {excelInfo ? (
                      <div className="summary-card">
                        <h3>{excelInfo.filePath}</h3>
                        <p>共 {excelInfo.sheets.length} 个工作表，当前默认选择 {rule.sheetName}</p>
                        <label className="field">
                          <span>工作表</span>
                          <select
                            value={rule.sheetName}
                            onChange={async (event) => {
                              const newSheetName = event.target.value;
                              setBusyMessage("正在解析工作表...");
                              setError(null);
                              try {
                                const reInspected = await invoke<ExcelInspectionResult>("inspect_sheet", {
                                  filePath: excelInfo.filePath,
                                  sheetName: newSheetName
                                });
                                setExcelInfo(reInspected);
                                setRule((current) => ({ ...current, sheetName: newSheetName }));
                              } catch (err) {
                                setError(String(err));
                              } finally {
                                setBusyMessage(null);
                              }
                            }}
                          >
                            {excelInfo.sheets.map((sheet) => (
                              <option key={sheet} value={sheet}>
                                {sheet}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="preview-table">
                          <div className="table-head">
                            {excelInfo.columns.map((column) => (
                              <span key={column}>{column}</span>
                            ))}
                          </div>
                          {excelInfo.previewRows.map((row, index) => (
                            <div className="table-row" key={index}>
                              {excelInfo.columns.map((column) => (
                                <span key={column}>{row[column] ?? ""}</span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div
                      className="summary-card"
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text/plain");
                        if (!text) return;
                        e.preventDefault();

                        const parsed = text.split(/\r?\n/).filter((line) => line.length > 0);
                        const grid = parsed.map((line) => line.split("\t"));

                        const startRow = focusedCell?.row ?? 0;
                        const startCol = focusedCell?.col ?? 0;

                        const pasteRows = grid.length;
                        const pasteCols = Math.max(...grid.map((r) => r.length));

                        // Expand columns if needed
                        let currentCols = [...manualColumns];
                        const neededCols = startCol + pasteCols;
                        if (neededCols > currentCols.length) {
                          for (let i = currentCols.length; i < neededCols; i++) {
                            currentCols.push(`新列${i + 1}`);
                          }
                          setManualColumns(currentCols);
                        }

                        // Expand rows if needed
                        let currentRows = [...manualRows];
                        const neededRows = startRow + pasteRows;
                        if (neededRows > currentRows.length) {
                          for (let i = currentRows.length; i < neededRows; i++) {
                            const emptyRow: Record<string, string> = {};
                            currentCols.forEach((col) => (emptyRow[col] = ""));
                            currentRows.push(emptyRow);
                          }
                        }

                        // Fill values
                        for (let r = 0; r < pasteRows; r++) {
                          for (let c = 0; c < grid[r].length; c++) {
                            const targetRow = startRow + r;
                            const targetCol = startCol + c;
                            if (targetRow < currentRows.length && targetCol < currentCols.length) {
                              currentRows[targetRow] = {
                                ...currentRows[targetRow],
                                [currentCols[targetCol]]: grid[r][c]
                              };
                            }
                          }
                        }

                        setManualRows(currentRows);
                        // Move focus to end of pasted region
                        setFocusedCell({ row: startRow + pasteRows, col: startCol });
                      }}
                    >
                      <h3>手动填写数据</h3>
                      <p className="manual-table-hint">支持直接输入，也可从 Excel 复制粘贴数据（自动扩展行列）</p>

                      <div className="manual-table-container" style={{ "--col-count": manualColumns.length } as React.CSSProperties}>
                        {/* Table header */}
                        <div className="manual-table-head">
                          <span />
                          {manualColumns.map((col, colIdx) => (
                            <div className="col-header" key={colIdx}>
                              {editingColIndex === colIdx ? (
                                <input
                                  className="col-name"
                                  autoFocus
                                  value={col}
                                  onChange={(e) => {
                                    const newName = e.target.value;
                                    setManualColumns((prev) => prev.map((c, i) => (i === colIdx ? newName : c)));
                                  }}
                                  onBlur={() => setEditingColIndex(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "Escape") setEditingColIndex(null);
                                  }}
                                />
                              ) : (
                                <span className="col-name" onDoubleClick={() => setEditingColIndex(colIdx)}>
                                  {col}
                                </span>
                              )}
                              {manualColumns.length > 1 && (
                                <button
                                  className="delete-col-btn"
                                  title="删除此列"
                                  onClick={() => {
                                    const removedCol = manualColumns[colIdx];
                                    setManualColumns((prev) => prev.filter((_, i) => i !== colIdx));
                                    setManualRows((prev) =>
                                      prev.map((row) => {
                                        const next = { ...row };
                                        delete next[removedCol];
                                        return next;
                                      })
                                    );
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            className="delete-col-btn"
                            style={{ opacity: 0, cursor: "default" }}
                            tabIndex={-1}
                          />
                        </div>

                        {/* Data rows */}
                        {manualRows.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "var(--text-soft)" }}>
                            暂无数据，点击下方"添加行"开始输入，或从 Excel 复制粘贴
                          </div>
                        ) : (
                          manualRows.map((row, rowIdx) => (
                            <div className="manual-table-row" key={rowIdx}>
                              <button
                                className="delete-row-btn"
                                title="删除此行"
                                onClick={() => {
                                  setManualRows((prev) => prev.filter((_, i) => i !== rowIdx));
                                }}
                              >
                                ×
                              </button>
                              {manualColumns.map((col, colIdx) => (
                                <input
                                  key={colIdx}
                                  value={row[col] ?? ""}
                                  onFocus={() => setFocusedCell({ row: rowIdx, col: colIdx })}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setManualRows((prev) =>
                                      prev.map((r, i) => (i === rowIdx ? { ...r, [col]: val } : r))
                                    );
                                  }}
                                />
                              ))}
                              <span />
                            </div>
                          ))
                        )}
                      </div>

                      <div className="manual-table-actions">
                        <button
                          className="add-row-btn"
                          onClick={() => {
                            const emptyRow: Record<string, string> = {};
                            manualColumns.forEach((col) => (emptyRow[col] = ""));
                            setManualRows((prev) => [...prev, emptyRow]);
                          }}
                        >
                          + 添加行
                        </button>
                        <button
                          className="add-col-btn"
                          onClick={() => {
                            const newColName = `新列${manualColumns.length + 1}`;
                            setManualColumns((prev) => [...prev, newColName]);
                            setManualRows((prev) => prev.map((row) => ({ ...row, [newColName]: "" })));
                          }}
                        >
                          + 添加列
                        </button>
                      </div>
                    </div>

                    {manualRows.length > 0 && (
                      <div className="action-row">
                        <button
                          className="primary-button"
                          onClick={() => {
                            // Build ExcelInspectionResult from manual data
                            const result: ExcelInspectionResult = {
                              filePath: "",
                              sheets: ["手动输入"],
                              columns: manualColumns,
                              previewRows: manualRows
                            };
                            setExcelInfo(result);
                            setRule((current) => ({ ...current, sheetName: "手动输入" }));
                            setCurrentStep("mapping");
                          }}
                        >
                          确认数据并继续
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {currentStep === "mapping" ? (
              <div className="stack">
                <div className="summary-card">
                  <h3>关键词映射</h3>
                  <div className="binding-grid">
                    {bindings.map((binding) => (
                      <div key={binding.placeholder} className="binding-row">
                        <div>
                          <strong>{binding.placeholder}</strong>
                          <p>选择该关键词的来源</p>
                        </div>
                        <select
                          value={binding.sourceType}
                          onChange={(event) => {
                            const sourceType = event.target.value as PlaceholderBinding["sourceType"];
                            setBindings((current) =>
                              current.map((item) =>
                                item.placeholder === binding.placeholder
                                  ? { ...item, sourceType, sourceValue: "" }
                                  : item
                              )
                            );
                          }}
                        >
                          <option value="excel">Excel 列</option>
                          <option value="system">系统变量</option>
                          <option value="fixed">固定文本</option>
                          <option value="config">配置映射值</option>
                        </select>
                        {binding.sourceType === "excel" ? (
                          <select
                            value={binding.sourceValue}
                            onChange={(event) =>
                              setBindings((current) =>
                                current.map((item) =>
                                  item.placeholder === binding.placeholder
                                    ? { ...item, sourceValue: event.target.value }
                                    : item
                                )
                              )
                            }
                          >
                            <option value="">选择列</option>
                            {excelInfo?.columns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {binding.sourceType === "system" ? (
                          <select
                            value={binding.sourceValue}
                            onChange={(event) =>
                              setBindings((current) =>
                                current.map((item) =>
                                  item.placeholder === binding.placeholder
                                    ? { ...item, sourceValue: event.target.value }
                                    : item
                                )
                              )
                            }
                          >
                            <option value="">选择系统变量</option>
                            {systemOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {binding.sourceType === "config" ? (
                          <select
                            value={binding.sourceValue}
                            onChange={(event) =>
                              setBindings((current) =>
                                current.map((item) =>
                                  item.placeholder === binding.placeholder
                                    ? { ...item, sourceValue: event.target.value }
                                    : item
                                )
                              )
                            }
                          >
                            <option value="">选择配置映射值</option>
                            {configOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {binding.sourceType === "fixed" ? (
                          <input
                            value={binding.sourceValue}
                            onChange={(event) =>
                              setBindings((current) =>
                                current.map((item) =>
                                  item.placeholder === binding.placeholder
                                    ? { ...item, sourceValue: event.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="输入固定文本"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="summary-card">
                  <div className="flex-between">
                    <h3>配置映射值管理</h3>
                    <button className="ghost-button" onClick={() => setShowBankMappingModal(true)}>
                      添加映射
                    </button>
                  </div>
                  <div className="bank-mapping-grid">
                    {settings.bankMappings.map((mapping, index) => (
                      <div key={mapping.key} className="bank-mapping-item">
                        <div className="bank-mapping-details">
                          <strong>{mapping.key}</strong>
                          <p>户名: {mapping.accountName}</p>
                          <p>账号: {mapping.accountNumber}</p>
                          <p>开户行: {mapping.bankName}</p>
                        </div>
                        <div className="bank-mapping-actions">
                          <button 
                            className="icon-button" 
                            onClick={() => handleEditBankMapping(index)}
                          >
                            编辑
                          </button>
                          <button 
                            className="icon-button danger" 
                            onClick={() => handleDeleteBankMapping(index)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rule-grid">
                  <label className="field">
                    <span>生成模式</span>
                    <select
                      value={rule.mode}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, mode: event.target.value as GenerationRule["mode"] }))
                      }
                    >
                      <option value="grouped">分组生成</option>
                      <option value="row">逐行生成</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>起始函号</span>
                    <input
                      type="number"
                      value={rule.startNumber}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, startNumber: Number(event.target.value) || 1 }))
                      }
                    />
                  </label>
                  <label className="field wide">
                    <span>函号模板</span>
                    <input
                      value={rule.letterNumberTemplate}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, letterNumberTemplate: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field wide">
                    <span>文件名模板</span>
                    <input
                      value={rule.fileNameTemplate}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, fileNameTemplate: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>日期</span>
                    <input
                      type="date"
                      value={rule.dateValue}
                      onChange={(event) => setRule((current) => ({ ...current, dateValue: event.target.value }))}
                    />
                  </label>
                  <label className="field field-inline">
                    <span>导出 PDF</span>
                    <input
                      type="checkbox"
                      checked={rule.exportPdf}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, exportPdf: event.target.checked }))
                      }
                    />
                  </label>
                </div>

                <div className="action-row">
                  <button className="ghost-button" onClick={chooseOutputDir}>
                    {rule.outputDir ? "重新选择导出目录" : "选择导出目录"}
                  </button>
                  <button className="primary-button" disabled={!canPreview} onClick={runPreview}>
                    预览生成结果
                  </button>
                </div>
              </div>
            ) : null}

            {currentStep === "generate" ? (
              <div className="stack">
                <div className="summary-card">
                  <h3>导出预览</h3>
                  {preview ? (
                    <div className="result-grid">
                      <div>
                        <span>输入记录</span>
                        <strong>{preview.totalInputRows}</strong>
                      </div>
                      <div>
                        <span>预计函件数</span>
                        <strong>{preview.totalLetters}</strong>
                      </div>
                      <div>
                        <span>文件名示例</span>
                        <strong>{preview.sampleFileName}</strong>
                      </div>
                    </div>
                  ) : (
                    <p>先在上一步运行预览。</p>
                  )}
                </div>

                {result ? (
                  <div className="summary-card">
                    <h3>生成完成</h3>
                    <div className="result-grid">
                      <div>
                        <span>DOCX 成功</span>
                        <strong>{result.docxSuccessCount}</strong>
                      </div>
                      <div>
                        <span>PDF 成功</span>
                        <strong>{result.pdfSuccessCount}</strong>
                      </div>
                      <div className="output-dir-item">
                        <span>输出目录</span>
                        <strong>{result.outputDir}</strong>
                      </div>
                    </div>
                    {/* 如果没有找到 PDF 转换工具但生成了 DOCX 文件，显示提示 */}
                    {rule.exportPdf && result.docxSuccessCount > 0 && result.pdfSuccessCount === 0 && result.failures.length === 0 ? (
                      <div className="info-banner">
                        <strong>提示：</strong>未找到 PDF 转换工具，只生成了 DOCX 文件。请安装 LibreOffice 或 unoconv 以启用 PDF 导出功能。
                      </div>
                    ) : null}
                    {result.failures.length > 0 ? (
                      <div className="failure-list">
                        {result.failures.map((failure) => (
                          <div key={`${failure.target}-${failure.reason}`}>
                            <strong>{failure.target}</strong>
                            <p>{failure.reason}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="action-row">
                      <button className="ghost-button" onClick={openOutputDir}>
                        打开导出目录
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="action-row">
                  <button className="primary-button" disabled={!preview || Boolean(busyMessage)} onClick={generateLetters}>
                    开始生成函件
                  </button>
                </div>
              </div>
            ) : null}
          </motion.section>
        </AnimatePresence>
      </main>

      <aside className={`help-panel ${settings.helpWidgetCollapsed ? "collapsed" : ""}`}>
        <div className="help-panel-header">
          <div>
            <p className="eyebrow">Floating Guide</p>
            <h3>操作指引</h3>
          </div>
          <button
            className="icon-button"
            onClick={() =>
              persistSettings({
                ...settings,
                helpWidgetCollapsed: !settings.helpWidgetCollapsed
              })
            }
          >
            {settings.helpWidgetCollapsed ? "展开" : "收起"}
          </button>
        </div>
        {!settings.helpWidgetCollapsed ? (
          <div className="help-panel-body">
            {helpContent[currentStep].map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        ) : null}
      </aside>

      {showBankMappingModal && (
        <div className="modal-overlay" onClick={handleCloseBankMappingModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingBankMappingIndex !== null ? "编辑银行映射" : "添加银行映射"}</h3>
              <button className="icon-button" onClick={handleCloseBankMappingModal}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label className="field">
                  <span>映射键</span>
                  <input
                    type="text"
                    name="key"
                    value={bankMappingForm.key}
                    onChange={handleBankMappingFormChange}
                    placeholder="例如：A公司"
                  />
                </label>
                <label className="field">
                  <span>户名</span>
                  <input
                    type="text"
                    name="accountName"
                    value={bankMappingForm.accountName}
                    onChange={handleBankMappingFormChange}
                    placeholder="填写银行账户户名"
                  />
                </label>
                <label className="field">
                  <span>账号</span>
                  <input
                    type="text"
                    name="accountNumber"
                    value={bankMappingForm.accountNumber}
                    onChange={handleBankMappingFormChange}
                    placeholder="填写银行账号"
                  />
                </label>
                <label className="field">
                  <span>开户行</span>
                  <input
                    type="text"
                    name="bankName"
                    value={bankMappingForm.bankName}
                    onChange={handleBankMappingFormChange}
                    placeholder="填写开户行名称"
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="ghost-button" onClick={handleCloseBankMappingModal}>
                取消
              </button>
              <button className="primary-button" onClick={handleBankMappingSubmit}>
                {editingBankMappingIndex !== null ? "保存修改" : "添加映射"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 版权声明 */}
      <div className="copyright">
        <p>© 2026 Yongzhe Chen. All rights reserved.</p>
      </div>
    </div>
  );
}

export default App;
