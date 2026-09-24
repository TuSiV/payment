export type PlaceholderSyntax = "double_brace" | "legacy_percent";

export interface TemplateInspectionResult {
  templatePath: string;
  placeholders: string[];
  placeholderSyntaxes: PlaceholderSyntax[];
}

export interface ExcelInspectionResult {
  filePath: string;
  sheets: string[];
  columns: string[];
  previewRows: Record<string, string>[];
}

export type BindingSourceType = "excel" | "system" | "fixed" | "config";

export interface PlaceholderBinding {
  placeholder: string;
  sourceType: BindingSourceType;
  sourceValue: string;
}

export interface BankMapping {
  key: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
}

export type SystemVariableKey = "letter_number" | "date" | "current_year" | "serial";
export type ConfigFieldKey = "account_name" | "account_number" | "bank_name";

export interface SystemVariableDef {
  key: SystemVariableKey;
  token: string;
}

export interface ConfigFieldDef {
  key: ConfigFieldKey;
  token: string;
}

export interface FieldVocabulary {
  systemVariables: SystemVariableDef[];
  configFields: ConfigFieldDef[];
  bankLookupColumn: string;
  defaultGroupByFields: string[];
  defaultSumFields: string[];
  defaultManualColumns: string[];
}

export interface ProfileDefaults {
  letterNumberTemplate: string;
  fileNameTemplate: string;
  startNumber: number;
  exportPdf: boolean;
}

export interface AppSettings {
  helpWidgetPinned: boolean;
  helpWidgetCollapsed: boolean;
  recentTemplatePaths: string[];
  recentDataSourcePaths: string[];
  onboardingCompleted: boolean;
  profile: ProfileDefaults;
  fieldVocabulary: FieldVocabulary;
  bankMappings: BankMapping[];
}

export type GenerationMode = "row" | "grouped";

export interface GenerationRule {
  mode: GenerationMode;
  sheetName: string;
  groupByFields: string[];
  sumFields: string[];
  startNumber: number;
  letterNumberTemplate: string;
  fileNameTemplate: string;
  dateValue: string;
  exportPdf: boolean;
  outputDir?: string | null;
}

export interface GenerationPreview {
  totalInputRows: number;
  totalLetters: number;
  sampleFileName: string;
  missingBindings: string[];
}

export interface GenerationFailure {
  target: string;
  reason: string;
}

export interface GenerationResult {
  totalInputRows: number;
  totalLetters: number;
  docxSuccessCount: number;
  pdfSuccessCount: number;
  failures: GenerationFailure[];
  outputDir: string;
}
