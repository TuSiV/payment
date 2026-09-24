import { AnimatePresence, motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  BankMapping,
  BindingSourceType,
  ConfigFieldDef,
  ConfigFieldKey,
  ExcelInspectionResult,
  FieldVocabulary,
  GenerationPreview,
  GenerationResult,
  GenerationRule,
  PlaceholderBinding,
  ProfileDefaults,
  SystemVariableDef,
  SystemVariableKey,
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
    "推荐使用 {{关键词}} 这类占位符，也兼容旧格式 %关键词%。",
    "系统变量与配置映射的词面名称在「设置」中维护，不在代码里写死。"
  ],
  data: [
    "支持两种数据来源：导入 Excel 文件或在软件内手动填写。",
    "手动填写时可从 Excel 复制数据直接粘贴，支持整行、整列或多行多列区域。",
    "手填默认列来自设置中的字段词表。"
  ],
  mapping: [
    "每个关键词都可以映射到数据列、系统变量、固定文本或配置映射值。",
    "系统变量与配置映射的可选项来自设置中的字段词表。",
    "使用配置映射前需维护银行映射，并设置银行查找列。"
  ],
  generate: [
    "生成时会先导出 DOCX，如勾选 PDF 会再调用本机 LibreOffice 转换。",
    "可以自定义输出目录；不选择时将自动生成时间戳目录。",
    "预览与生成前会校验函号模板、文件名模板和映射配置是否完整。"
  ]
};

const SYSTEM_KEY_LABELS: Record<SystemVariableKey, string> = {
  letter_number: "函号/文号",
  date: "日期",
  current_year: "当前年份",
  serial: "序号"
};

const CONFIG_KEY_LABELS: Record<ConfigFieldKey, string> = {
  account_name: "户名",
  account_number: "账号",
  bank_name: "开户行"
};

const SYSTEM_KEYS: SystemVariableKey[] = ["letter_number", "date", "current_year", "serial"];
const CONFIG_KEYS: ConfigFieldKey[] = ["account_name", "account_number", "bank_name"];

function emptyFieldVocabulary(): FieldVocabulary {
  return {
    systemVariables: SYSTEM_KEYS.map((key) => ({ key, token: "" })),
    configFields: CONFIG_KEYS.map((key) => ({ key, token: "" })),
    bankLookupColumn: "",
    defaultGroupByFields: [],
    defaultSumFields: [],
    defaultManualColumns: []
  };
}

function emptyProfile(): ProfileDefaults {
  return {
    letterNumberTemplate: "",
    fileNameTemplate: "",
    startNumber: 1,
    exportPdf: false
  };
}

function emptySettings(): AppSettings {
  return {
    helpWidgetPinned: true,
    helpWidgetCollapsed: false,
    recentTemplatePaths: [],
    recentDataSourcePaths: [],
    onboardingCompleted: false,
    profile: emptyProfile(),
    fieldVocabulary: emptyFieldVocabulary(),
    bankMappings: []
  };
}

function normalizeSettings(raw: AppSettings): AppSettings {
  const base = emptySettings();
  return {
    ...base,
    ...raw,
    profile: { ...base.profile, ...(raw.profile ?? {}) },
    fieldVocabulary: {
      ...base.fieldVocabulary,
      ...(raw.fieldVocabulary ?? {}),
      systemVariables: SYSTEM_KEYS.map((key) => {
        const found = raw.fieldVocabulary?.systemVariables?.find((item) => item.key === key);
        return { key, token: found?.token ?? "" };
      }),
      configFields: CONFIG_KEYS.map((key) => {
        const found = raw.fieldVocabulary?.configFields?.find((item) => item.key === key);
        return { key, token: found?.token ?? "" };
      }),
      defaultGroupByFields: raw.fieldVocabulary?.defaultGroupByFields ?? [],
      defaultSumFields: raw.fieldVocabulary?.defaultSumFields ?? [],
      defaultManualColumns: raw.fieldVocabulary?.defaultManualColumns ?? []
    },
    bankMappings: raw.bankMappings ?? []
  };
}

function ruleFromProfile(profile: ProfileDefaults, vocabulary: FieldVocabulary): GenerationRule {
  return {
    mode: "grouped",
    sheetName: "",
    groupByFields: [...vocabulary.defaultGroupByFields],
    sumFields: [...vocabulary.defaultSumFields],
    startNumber: profile.startNumber || 1,
    letterNumberTemplate: profile.letterNumberTemplate,
    fileNameTemplate: profile.fileNameTemplate,
    dateValue: new Date().toISOString().slice(0, 10),
    exportPdf: profile.exportPdf,
    outputDir: null
  };
}

function parseList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateConfig(settings: AppSettings, bindings: PlaceholderBinding[], rule: GenerationRule): string | null {
  if (!rule.letterNumberTemplate.trim()) {
    return "函号模板未配置，请在设置中填写后重试";
  }
  if (!rule.fileNameTemplate.trim()) {
    return "文件名模板未配置，请在设置中填写后重试";
  }
  for (const binding of bindings) {
    if (!binding.sourceValue.trim()) {
      continue;
    }
    if (binding.sourceType === "system") {
      const def = settings.fieldVocabulary.systemVariables.find((item) => item.key === binding.sourceValue);
      if (!def) {
        return `系统变量绑定「${binding.placeholder}」使用了未知标识`;
      }
      if (!def.token.trim()) {
        return `系统变量 token 未配置，无法解析「${binding.placeholder}」`;
      }
    }
    if (binding.sourceType === "config") {
      const def = settings.fieldVocabulary.configFields.find((item) => item.key === binding.sourceValue);
      if (!def) {
        return `配置映射绑定「${binding.placeholder}」使用了未知标识`;
      }
      if (!def.token.trim()) {
        return `配置映射 token 未配置，无法解析「${binding.placeholder}」`;
      }
      if (!settings.fieldVocabulary.bankLookupColumn.trim()) {
        return "银行查找列未配置，请在设置的字段词表中填写";
      }
      if (settings.bankMappings.length === 0) {
        return "配置映射为空，请先在设置中维护银行映射";
      }
    }
  }
  return null;
}

function onboardingIssues(settings: AppSettings): string[] {
  const issues: string[] = [];
  if (!settings.profile.letterNumberTemplate.trim()) issues.push("函号模板");
  if (!settings.profile.fileNameTemplate.trim()) issues.push("文件名模板");
  if (settings.fieldVocabulary.systemVariables.some((item) => !item.token.trim())) {
    issues.push("系统变量 token");
  }
  if (settings.fieldVocabulary.configFields.some((item) => !item.token.trim())) {
    issues.push("配置映射 token");
  }
  return issues;
}

type OnboardingStep = "profile" | "vocabulary" | "bank" | "done";

function App() {
  const [currentStep, setCurrentStep] = useState<StepId>("template");
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("profile");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [templateInfo, setTemplateInfo] = useState<TemplateInspectionResult | null>(null);
  const [excelInfo, setExcelInfo] = useState<ExcelInspectionResult | null>(null);
  const [rule, setRule] = useState<GenerationRule>(() => ruleFromProfile(emptyProfile(), emptyFieldVocabulary()));
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
  const [manualColumns, setManualColumns] = useState<string[]>([]);
  const [manualRows, setManualRows] = useState<Record<string, string>[]>([]);
  const [editingColIndex, setEditingColIndex] = useState<number | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => {
        const normalized = normalizeSettings(loaded);
        setSettings(normalized);
        setRule((current) => ({
          ...ruleFromProfile(normalized.profile, normalized.fieldVocabulary),
          sheetName: current.sheetName,
          dateValue: current.dateValue,
          outputDir: current.outputDir
        }));
        setManualColumns([...normalized.fieldVocabulary.defaultManualColumns]);
        if (!normalized.onboardingCompleted) {
          setShowOnboarding(true);
          setOnboardingStep("profile");
        }
      })
      .catch(() => {
        setSettings(emptySettings());
        setShowOnboarding(true);
        setOnboardingStep("profile");
      })
      .finally(() => setSettingsLoaded(true));
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
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    try {
      await invoke("save_settings", { settings: normalized });
    } catch (saveError) {
      console.error(saveError);
    }
  }

  function updateFieldVocabulary(patch: Partial<FieldVocabulary>) {
    setSettings((current) => ({
      ...current,
      fieldVocabulary: { ...current.fieldVocabulary, ...patch }
    }));
  }

  function updateProfile(patch: Partial<ProfileDefaults>) {
    setSettings((current) => ({
      ...current,
      profile: { ...current.profile, ...patch }
    }));
  }

  function updateSystemToken(key: SystemVariableKey, token: string) {
    setSettings((current) => ({
      ...current,
      fieldVocabulary: {
        ...current.fieldVocabulary,
        systemVariables: current.fieldVocabulary.systemVariables.map((item: SystemVariableDef) =>
          item.key === key ? { ...item, token } : item
        )
      }
    }));
  }

  function updateConfigToken(key: ConfigFieldKey, token: string) {
    setSettings((current) => ({
      ...current,
      fieldVocabulary: {
        ...current.fieldVocabulary,
        configFields: current.fieldVocabulary.configFields.map((item: ConfigFieldDef) =>
          item.key === key ? { ...item, token } : item
        )
      }
    }));
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
        recentTemplatePaths: [path, ...settings.recentTemplatePaths.filter((item) => item !== path)].slice(0, 5)
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
        recentDataSourcePaths: [path, ...settings.recentDataSourcePaths.filter((item) => item !== path)].slice(0, 5)
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
    const configError = validateConfig(settings, bindings, rule);
    if (configError) {
      setError(configError);
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
    const configError = validateConfig(settings, bindings, rule);
    if (configError) {
      setError(configError);
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
    setBankMappingForm((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  function handleBankMappingSubmit() {
    if (!bankMappingForm.key || !bankMappingForm.accountName || !bankMappingForm.accountNumber || !bankMappingForm.bankName) {
      alert("请填写所有必填字段");
      return;
    }

    let updatedMappings: BankMapping[];
    if (editingBankMappingIndex !== null) {
      updatedMappings = [...settings.bankMappings];
      updatedMappings[editingBankMappingIndex] = bankMappingForm;
    } else {
      if (settings.bankMappings.some((mapping) => mapping.key === bankMappingForm.key)) {
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

  function completeOnboarding() {
    const issues = onboardingIssues(settings);
    if (issues.length > 0) {
      setError(`请先完成：${issues.join("、")}`);
      return;
    }
    const next = { ...settings, onboardingCompleted: true };
    persistSettings(next);
    setRule((current) => ({
      ...current,
      letterNumberTemplate: next.profile.letterNumberTemplate,
      fileNameTemplate: next.profile.fileNameTemplate,
      startNumber: next.profile.startNumber || current.startNumber,
      exportPdf: next.profile.exportPdf,
      groupByFields: [...next.fieldVocabulary.defaultGroupByFields],
      sumFields: [...next.fieldVocabulary.defaultSumFields]
    }));
    setManualColumns([...next.fieldVocabulary.defaultManualColumns]);
    setShowOnboarding(false);
    setError(null);
  }

  const systemOptions = useMemo(
    () => settings.fieldVocabulary.systemVariables.filter((item) => item.token.trim()),
    [settings.fieldVocabulary.systemVariables]
  );
  const configOptions = useMemo(
    () => settings.fieldVocabulary.configFields.filter((item) => item.token.trim()),
    [settings.fieldVocabulary.configFields]
  );

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

  function renderVocabularyFields() {
    return (
      <>
        <div className="summary-card">
          <h3>系统变量 token</h3>
          <p className="manual-table-hint">用于 Word 占位符与绑定选项；语义固定，词面可改</p>
          <div className="form-grid">
            {SYSTEM_KEYS.map((key) => {
              const def = settings.fieldVocabulary.systemVariables.find((item) => item.key === key)!;
              return (
                <label className="field" key={key}>
                  <span>{SYSTEM_KEY_LABELS[key]}</span>
                  <input
                    value={def.token}
                    onChange={(event) => updateSystemToken(key, event.target.value)}
                    placeholder="在模板中显示的名称"
                  />
                </label>
              );
            })}
          </div>
        </div>
        <div className="summary-card">
          <h3>配置映射 token</h3>
          <div className="form-grid">
            {CONFIG_KEYS.map((key) => {
              const def = settings.fieldVocabulary.configFields.find((item) => item.key === key)!;
              return (
                <label className="field" key={key}>
                  <span>{CONFIG_KEY_LABELS[key]}</span>
                  <input
                    value={def.token}
                    onChange={(event) => updateConfigToken(key, event.target.value)}
                    placeholder="绑定下拉显示名"
                  />
                </label>
              );
            })}
            <label className="field wide">
              <span>银行查找列</span>
              <input
                value={settings.fieldVocabulary.bankLookupColumn}
                onChange={(event) => updateFieldVocabulary({ bankLookupColumn: event.target.value })}
                placeholder="数据源中用于匹配映射键的列名"
              />
            </label>
          </div>
        </div>
        <div className="summary-card">
          <h3>默认字段列表</h3>
          <div className="form-grid">
            <label className="field wide">
              <span>默认分组字段</span>
              <input
                value={settings.fieldVocabulary.defaultGroupByFields.join(", ")}
                onChange={(event) => updateFieldVocabulary({ defaultGroupByFields: parseList(event.target.value) })}
                placeholder="逗号分隔"
              />
            </label>
            <label className="field wide">
              <span>默认求和字段</span>
              <input
                value={settings.fieldVocabulary.defaultSumFields.join(", ")}
                onChange={(event) => updateFieldVocabulary({ defaultSumFields: parseList(event.target.value) })}
                placeholder="逗号分隔"
              />
            </label>
            <label className="field wide">
              <span>手填默认列</span>
              <input
                value={settings.fieldVocabulary.defaultManualColumns.join(", ")}
                onChange={(event) => updateFieldVocabulary({ defaultManualColumns: parseList(event.target.value) })}
                placeholder="逗号分隔"
              />
            </label>
          </div>
        </div>
      </>
    );
  }

  function renderProfileFields() {
    return (
      <div className="summary-card">
        <h3>文号与文件名</h3>
        <div className="form-grid">
          <label className="field wide">
            <span>函号模板</span>
            <input
              value={settings.profile.letterNumberTemplate}
              onChange={(event) => updateProfile({ letterNumberTemplate: event.target.value })}
              placeholder="例如：〔{{当前年份}}〕{{序号}}号（token 以词表为准）"
            />
          </label>
          <label className="field wide">
            <span>文件名模板</span>
            <input
              value={settings.profile.fileNameTemplate}
              onChange={(event) => updateProfile({ fileNameTemplate: event.target.value })}
              placeholder="例如：{{函号}}_{{客户名称}}.docx"
            />
          </label>
          <label className="field">
            <span>起始序号</span>
            <input
              type="number"
              value={settings.profile.startNumber}
              onChange={(event) => updateProfile({ startNumber: Number(event.target.value) || 1 })}
            />
          </label>
          <label className="field field-inline">
            <span>默认导出 PDF</span>
            <input
              type="checkbox"
              checked={settings.profile.exportPdf}
              onChange={(event) => updateProfile({ exportPdf: event.target.checked })}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderBankManager() {
    return (
      <div className="summary-card">
        <div className="flex-between">
          <h3>配置映射值管理</h3>
          <button className="ghost-button" onClick={() => setShowBankMappingModal(true)}>
            添加映射
          </button>
        </div>
        <p className="manual-table-hint">可暂不配置；使用「配置映射」绑定前必须维护</p>
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
                <button className="icon-button" onClick={() => handleEditBankMapping(index)}>
                  编辑
                </button>
                <button className="icon-button danger" onClick={() => handleDeleteBankMapping(index)}>
                  删除
                </button>
              </div>
            </div>
          ))}
          {settings.bankMappings.length === 0 ? <p>暂无映射</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Letter Studio</p>
          <h1>函件生成器</h1>
          <p className="sidebar-copy">按模板、数据、规则、导出四步完成整批函件生成。</p>
          <button className="ghost-button" onClick={() => setShowSettingsModal(true)}>
            设置
          </button>
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
                      setManualColumns([...settings.fieldVocabulary.defaultManualColumns]);
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

                        let currentCols = [...manualColumns];
                        const neededCols = startCol + pasteCols;
                        if (neededCols > currentCols.length) {
                          for (let i = currentCols.length; i < neededCols; i++) {
                            currentCols.push(`新列${i + 1}`);
                          }
                          setManualColumns(currentCols);
                        }

                        let currentRows = [...manualRows];
                        const neededRows = startRow + pasteRows;
                        if (neededRows > currentRows.length) {
                          for (let i = currentRows.length; i < neededRows; i++) {
                            const emptyRow: Record<string, string> = {};
                            currentCols.forEach((col) => (emptyRow[col] = ""));
                            currentRows.push(emptyRow);
                          }
                        }

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
                        setFocusedCell({ row: startRow + pasteRows, col: startCol });
                      }}
                    >
                      <h3>手动填写数据</h3>
                      <p className="manual-table-hint">支持直接输入，也可从 Excel 复制粘贴数据（自动扩展行列）</p>

                      <div className="manual-table-container" style={{ "--col-count": manualColumns.length } as React.CSSProperties}>
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

                        {manualRows.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "var(--text-soft)" }}>
                            暂无数据，点击下方“添加行”开始输入，或从 Excel 复制粘贴
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
                              <option key={option.key} value={option.key}>
                                {option.token}
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
                              <option key={option.key} value={option.key}>
                                {option.token}
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

                {renderBankManager()}

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
                      placeholder="例如：〔{{当前年份}}〕{{序号}}号"
                    />
                  </label>
                  <label className="field wide">
                    <span>文件名模板</span>
                    <input
                      value={rule.fileNameTemplate}
                      onChange={(event) =>
                        setRule((current) => ({ ...current, fileNameTemplate: event.target.value }))
                      }
                      placeholder="例如：{{函号}}_{{客户名称}}.docx"
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

      {(showOnboarding || showSettingsModal) && settingsLoaded ? (
        <div className="modal-overlay" onClick={() => { if (showSettingsModal) setShowSettingsModal(false); }}>
          <div className="modal-content onboarding-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{showOnboarding ? "首次启动配置" : "应用设置"}</h3>
              {showSettingsModal && !showOnboarding ? (
                <button className="icon-button" onClick={() => setShowSettingsModal(false)}>
                  关闭
                </button>
              ) : null}
            </div>
            <div className="modal-body">
              {showOnboarding ? (
                <div className="onboarding-steps">
                  {(["profile", "vocabulary", "bank", "done"] as OnboardingStep[]).map((step, index) => (
                    <span key={step} className={`onboarding-step ${onboardingStep === step ? "active" : ""}`}>
                      {index + 1}. {step === "profile" ? "文号" : step === "vocabulary" ? "词表" : step === "bank" ? "银行映射" : "完成"}
                    </span>
                  ))}
                </div>
              ) : null}

              {!showOnboarding || onboardingStep === "profile" ? renderProfileFields() : null}
              {!showOnboarding || onboardingStep === "vocabulary" ? renderVocabularyFields() : null}
              {!showOnboarding || onboardingStep === "bank" ? renderBankManager() : null}
              {showOnboarding && onboardingStep === "done" ? (
                <div className="summary-card">
                  <h3>确认并开始</h3>
                  <p>函号模板：{settings.profile.letterNumberTemplate || "（未填）"}</p>
                  <p>文件名模板：{settings.profile.fileNameTemplate || "（未填）"}</p>
                  <p>银行映射：{settings.bankMappings.length} 条（可稍后在设置中维护）</p>
                  <p>提示：业务文号、账号等敏感信息仅保存在本机配置，请勿写入代码仓库。</p>
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              {showOnboarding ? (
                <>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      const order: OnboardingStep[] = ["profile", "vocabulary", "bank", "done"];
                      const idx = order.indexOf(onboardingStep);
                      if (idx > 0) setOnboardingStep(order[idx - 1]);
                    }}
                    disabled={onboardingStep === "profile"}
                  >
                    上一步
                  </button>
                  {onboardingStep !== "done" ? (
                    <button
                      className="primary-button"
                      onClick={() => {
                        const order: OnboardingStep[] = ["profile", "vocabulary", "bank", "done"];
                        const idx = order.indexOf(onboardingStep);
                        if (onboardingStep === "profile") {
                          if (!settings.profile.letterNumberTemplate.trim() || !settings.profile.fileNameTemplate.trim()) {
                            setError("请填写函号模板与文件名模板");
                            return;
                          }
                        }
                        setOnboardingStep(order[idx + 1]);
                        setError(null);
                      }}
                    >
                      下一步
                    </button>
                  ) : (
                    <button className="primary-button" onClick={completeOnboarding}>
                      开始使用
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="ghost-button" onClick={() => setShowSettingsModal(false)}>
                    取消
                  </button>
                  <button
                    className="primary-button"
                    onClick={async () => {
                      await persistSettings(settings);
                      setRule((current) => ({
                        ...current,
                        letterNumberTemplate: settings.profile.letterNumberTemplate,
                        fileNameTemplate: settings.profile.fileNameTemplate,
                        startNumber: settings.profile.startNumber || current.startNumber,
                        exportPdf: settings.profile.exportPdf,
                        groupByFields: [...settings.fieldVocabulary.defaultGroupByFields],
                        sumFields: [...settings.fieldVocabulary.defaultSumFields]
                      }));
                      setManualColumns([...settings.fieldVocabulary.defaultManualColumns]);
                      setShowSettingsModal(false);
                    }}
                  >
                    保存设置
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                    placeholder="与银行查找列的值一致"
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
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
