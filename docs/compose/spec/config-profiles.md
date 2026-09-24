---
feature: config-profiles
status: delivered
updated: 2026-05-15
branch: feat/config-profiles
commits: 2c92982..<short-head-sha>
---

# 可配置完全体（去硬编码敏感信息）

> 恢复说明：若续跑时 Compose Next 指令缺失，请重新加载 `compose-next` skill 后继续。

**Workspace override**：环境禁止 `git worktree add`（会改共享 ref store），故未建 `.worktrees/` linked worktree，改为在主工作区切出 `feat/config-profiles`（基线 `biao` @ `2c92982`）。

## Report

**What was built** — 清空了代码中的敏感默认（函号业务前缀、银行示例账号），扩展 `settings.json` 为 `profile` + `fieldVocabulary` + `bankMappings`，语义槽位固定（4 系统变量 / 3 配置映射）而词面 token 与业务模板可配。首次启动进入四步引导向导（文号 → 词表 → 银行映射可跳过 → 完成），主界面提供设置入口。生成链路按稳定 key 解析，不再匹配中文魔法字符串；预览/生成前对空模板、未配 token、缺银行映射做具体校验；旧配置可加载且不会注入代码默认敏感值。

**Verification** — `npx tsc --noEmit` PASS；`cargo test --lib` PASS（7 tests）。独立评审 2 项 CRITICAL（中文别名碰撞、空绑定误报）修复后复审：全部 FIXED，无新增 CRITICAL。

**Journey log** — 1) 沙箱禁止 `git worktree add`，改为当前工作区功能分支。2) 系统/配置 source_value 必须存稳定 enum key，token 只作展示与模板词面，否则自定义 token 与中文别名会碰撞。3) 空 `source_value` 应留给 missing-bindings，不能进词表校验分支。4) `FieldVocabulary` 缺省与 `{}` 反序列化形状不一致，需在 load 时 normalize 4+3 槽位。5) 向导完成与设置保存都要回写会话 rule，避免 UI 显示与生成用值漂移。

## [S1] Problem

代码中硬编码了组织敏感/业务专属信息，导致产品无法安全复用与分发：

1. **文号前缀** `船物法函` 写死在默认函号模板（`src/App.tsx` `defaultRule`），属单位敏感信息。
2. **银行账号示例**（A公司/B公司 + 假账号）同时写在前端 `defaultSettings` 与后端 `AppSettings::default`，配置缺失时会落盘并可能混入真实生成。
3. **业务字段词表**（`客户名称`/`填报单位`/`账面余额`/`户名`/`账号`/`开户行`/`函号` 等）以魔法字符串散落在 UI 默认值与 `generation.rs` 匹配逻辑中，前后端双份、改名成本高。
4. 无首次启动引导，空配置时用户只能面对空白或残留假数据。

目标：清空全部硬编码敏感默认；业务模板、敏感数据、字段词表全部可配置；首次启动用引导向导写入用户自己的配置。

## [S2] Design

### S2.1 配置模型（settings.json 扩展）

路径不变：`dirs::config_dir()/letter-generator/settings.json`。

```ts
// 概念结构（前后端字段名 camelCase / snake_case 对齐现有 serde 约定）
interface AppSettings {
  helpWidgetPinned: boolean;
  helpWidgetCollapsed: boolean;
  recentTemplatePaths: string[];
  recentDataSourcePaths: string[];
  onboardingCompleted: boolean;          // 新增
  profile: ProfileDefaults;              // 新增：业务模板默认值
  fieldVocabulary: FieldVocabulary;      // 新增：字段词表
  bankMappings: BankMapping[];           // 结构不变；代码默认恒为 []
}

interface ProfileDefaults {
  letterNumberTemplate: string;  // 空字符串 = 未配置；禁止代码写入业务前缀
  fileNameTemplate: string;      // 可为空，生成前校验
  startNumber: number;           // 默认 1
  exportPdf: boolean;            // 默认 false（避免未配置环境静默失败）
}

interface FieldVocabulary {
  /** 系统变量：语义固定，token 可配（Word 占位符 / 绑定下拉显示名） */
  systemVariables: Array<{ key: SystemVariableKey; token: string }>;
  /** 配置映射字段：槽位固定，token 可配 */
  configFields: Array<{ key: ConfigFieldKey; token: string }>;
  /** 银行映射查找列：用数据源哪一列的值去匹配 bankMappings[].key */
  bankLookupColumn: string;
  defaultGroupByFields: string[];
  defaultSumFields: string[];
  defaultManualColumns: string[];
}

type SystemVariableKey = "letter_number" | "date" | "current_year" | "serial";
type ConfigFieldKey = "account_name" | "account_number" | "bank_name";

// BankMapping 不变：key, accountName, accountNumber, bankName
```

**语义固定、词面可配**：系统变量只有 4 个固定语义（函号/日期/当前年份/序号对应的计算值），配置映射只有 3 个固定槽位（户名/账号/开户行）。用户配置的是它们在模板与绑定 UI 中的 **token 名**，而不是任意自定义计算逻辑。

### S2.2 默认值（代码内）

| 项 | 代码默认 | 说明 |
|---|---|---|
| `bankMappings` | `[]` | 前后端均为空；删除 A公司/B公司 |
| `profile.letterNumberTemplate` | `""` | 禁止出现「船物法函」等业务前缀 |
| `profile.fileNameTemplate` | `""` | 由向导填写 |
| `profile.startNumber` | `1` | |
| `profile.exportPdf` | `false` | |
| `systemVariables[].token` | `""` | 四项 key 仍占位，token 由向导填 |
| `configFields[].token` | `""` | 三项槽位占位，token 由向导填 |
| `bankLookupColumn` | `""` | |
| `defaultGroupByFields` / `defaultSumFields` / `defaultManualColumns` | `[]` | |
| `onboardingCompleted` | `false` | |

允许的中性 UI 示例文案（placeholder，不进入 settings、不参与生成）：例如「例如：〔{{当前年份}}〕{{序号}}号」。

### S2.3 生成链路契约

- `resolve_replacements` / `config_value` **不再**匹配字面量 `"函号"`/`"户名"`/`"填报单位"` 等。
- 系统变量：按 `SystemVariableKey` 计算值，写入 map 的 key 为该条目当前 `token`。
- 配置映射：`source_value` 存 `ConfigFieldKey`（或与 token 稳定对应的 id）；查找行字段名 = `fieldVocabulary.bankLookupColumn`；返回 `BankMapping` 对应槽位。
- 字母号模板展开：仅替换词表中 `current_year`/`serial`（以及若存在的 `date`）对应 token；未知 `{{...}}` 保留原样。
- 绑定 UI：`system` 下拉列出 token 非空的系统变量；`config` 下拉列出 token 非空的配置字段。
- 手填默认列、分组、求和字段：启动/重置时读 `fieldVocabulary`，不再写死。

### S2.4 首次启动引导向导

触发：`load_settings` 后 `onboardingCompleted === false`（含新装、旧 settings 缺该字段视为 false）。

步骤（可跳过银行映射，必填项未完成不允许「开始使用」）：

1. **文号与文件名**：函号模板（必填）、文件名模板（必填）、起始序号、是否默认导出 PDF。
2. **字段词表**：4 个系统变量 token、3 个配置字段 token、银行查找列、默认分组/求和/手填列（列表可编辑）。
3. **银行映射**：增删改；允许 0 条并提示「使用配置映射前需维护」。
4. **完成**：`save_settings` 全量写入，`onboardingCompleted = true`，进入四步工作台。

主界面保留「设置」入口，可重开同一套编辑页（非向导流式），修改后立即持久化。Step 3 的规则表单初始值来自 `profile`，会话内改动不回写 profile（除非用户在设置页改）。

### S2.5 校验（预览/生成前）

| 条件 | 行为 |
|---|---|
| `letterNumberTemplate` 或 `fileNameTemplate` 为空 | 阻断，提示完成设置 |
| 任一 `system` 绑定其 token 为空或词表未配置 | 阻断，提示配置系统变量 |
| 任一 `config` 绑定存在，但 `bankLookupColumn` 为空或 `bankMappings` 为空 | 阻断，提示维护配置映射 |
| 绑定 `source_value` 空 | 维持现有 missing 机制 |

校验失败信息需指出缺哪项配置，而不是笼统报错。

### S2.6 迁移

- 旧 settings 无 `onboardingCompleted`/`profile`/`fieldVocabulary`：反序列化用 `#[serde(default)]` 补空结构；`onboardingCompleted` 默认 `false` → 引导用户走完向导（向导可预填旧 `bankMappings` 与旧常用字段名 **仅当其已存在于用户配置**，不从代码播种）。
- 旧 settings 中的 `bankMappings` 原样保留（用户数据不删）。
- 代码中历史默认（A公司、船物法函、写死字段名）全部删除；不自动「清洗」用户已保存的函号模板。

### S2.7 接口变更

| 命令 | 变更 |
|---|---|
| `load_settings` / `save_settings` | 载荷扩展为新 `AppSettings` |
| `preview_generation` / `generate_letters` | 仍读全局 settings；内部改用词表解析；无新增业务参数 |

前端 `types.ts` 与 Rust `models.rs` 保持字段一一对应。

### S2.8 测试边界

- Rust：`config_value`/`resolve_replacements` 在自定义 token、空 token、缺映射时的输出；函号模板展开。
- 迁移：缺省字段的 JSON 反序列化不落业务敏感默认。
- 前端：无强制 E2E；`tsc` 通过 + 手动走查向导与生成路径。

## [S3] Out of Scope

- 多套配置档切换 / 导入导出配置文件（v1 单 profile）。
- 用户自定义 **新的** 系统变量计算逻辑或任意结构配置映射（超出 3 槽位）。
- 修改 `BankMapping` 字段结构、DOCX/PDF 转换链路、Excel 解析、手动表格交互细节。
- 将词表做成独立可视化「字段管理」高级页（向导/设置页内联编辑即可）。
- 云端同步、多用户权限。

## Tasks

- [x] T1: 扩展 settings 模型并清空敏感默认 — acceptance: `models.rs`/`types.ts` 含 `onboardingCompleted`/`profile`/`fieldVocabulary`；默认 `bankMappings` 与函号模板为空；源码树 grep 无「船物法函」「A公司」「1000000000000」等示例敏感串 (covers: S2.1, S2.2, S2.6)
- [x] T2: 生成链路改为词表驱动 — acceptance: `generation.rs` 不再硬编码「函号/户名/账号/开户行/填报单位」等魔法字符串；自定义 token 可完成系统变量替换与配置映射 (covers: S2.3, S2.8; depends: T1)
- [x] T3: 首次启动引导向导 — acceptance: 删除本地 settings 后启动进入向导；必填完成可保存并 `onboardingCompleted=true`；银行映射可跳过 (covers: S2.4; depends: T1)
- [x] T4: 设置编辑入口与规则默认值接线 — acceptance: 主界面可打开设置并改词表/模板/银行映射并持久化；Step 3 初始规则来自 `profile`；手填/分组/求和默认列来自词表 (covers: S2.4, S2.3; depends: T1, T3)
- [x] T5: 预览/生成前配置校验 — acceptance: 空模板、未配系统 token、缺银行查找列或空映射时阻断并提示具体缺失项 (covers: S2.5; depends: T2, T4)
- [x] T6: 迁移与回归验证 — acceptance: 旧 settings.json 可加载且不注入代码默认敏感值；`tsc`/`cargo check`（或项目等价检查）通过并记录命令结果 (covers: S2.6, S2.8; depends: T1–T5)
