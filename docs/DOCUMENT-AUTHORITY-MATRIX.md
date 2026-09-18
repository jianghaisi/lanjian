# 岚笺 V3 文档事实源矩阵

更新：2026-09-09  
用途：说明每类资料能决定什么、不能决定什么，以及冲突时向哪里回溯。本文是治理索引，不复制各文档正文。

## 1. 状态词

| 状态 | 含义 |
| --- | --- |
| `v3-authoritative` | 在声明领域内是当前 V3 权威，可直接约束下游任务。 |
| `v3-supporting` | 已被 V3 接纳的范围性设计或证据，不能覆盖上游权威。 |
| `candidate-for-v3` | 可能复用，但尚未完成 V3 任务接纳和验证，不得驱动实现。 |
| `legacy/superseded` | V1/V2 或已被替代内容，只保留追溯价值，不得驱动 V3。 |
| `unrecognized` | 来源、用途或归属尚不明确，不得提交、删除或晋升。 |
| `task-scoped` | 只约束对应 V3 Trellis 任务；与 V3 基线冲突时必须回到 planning。 |

## 2. 权威链

| 路径 | 角色 | 状态 | 上游/替代关系 | 更新触发 |
| --- | --- | --- | --- | --- |
| `docs/PRODUCT-BASELINE.md` | V3 产品身份、核心闭环、边界和不变量 | `v3-authoritative` | 持久化用户最新确认；是唯一产品最高事实源 | V3 方向、范围或不变量变化 |
| `docs/DOCUMENT-AUTHORITY-MATRIX.md` | V3 文档角色、优先级和替代关系 | `v3-authoritative`（治理索引） | 服从 V3 产品基线；不复制产品需求 | 文档新增、改名、角色或替代关系变化 |
| `docs/PRODUCT-ROADMAP.md` | V3 阶段、优先级和验收状态 | `v3-authoritative`（交付状态） | 服从 V3 产品基线；旧完成状态不继承 | 阶段或验收状态变化 |
| `docs/DATA-AUTHORITY-MATRIX.md` | SQLite、镜像、候选、导入、恢复和报告的数据角色 | `v3-authoritative`（数据安全） | 只晋升跨版本仍有效的数据不变量；实现细节待 spec/代码对账 | 数据角色、迁移或回退契约变化 |
| `AGENTS.md`（外层） | 总分结构、四维事件、境界、系统模板与 Trellis 入口 | `v3-authoritative`（项目约束） | 已由 V3 基线接纳 | 创作 Agent 或开发入口变化 |
| `.trellis/workflow.md` | Trellis 任务生命周期 | `v3-authoritative`（开发流程） | 由 Trellis 管理；项目规则不得绕过其 gate | Trellis 升级或项目定制流程变化 |
| `.trellis/spec/index.md` 及标记为 `verified-current` 的 spec | V3 工程契约与开发路由 | `v3-authoritative`（工程范围） | 服从 V3 基线、路线和当前任务；不能声明产品完成 | V3 工程契约或架构变化 |
| 标记为 `candidate-for-v3` 的 `.trellis/spec/**` | 旧实现细节与功能候选 | `candidate-for-v3` | 不进入当前开发上下文；由后续 V3 功能任务逐项晋升 | 候选被接纳、修订或退出 |

## 3. 入口与架构资料

| 路径 | 角色 | 状态 | 限制/替代关系 |
| --- | --- | --- | --- |
| `README.md` | V3 产品与开发入口 | `v3-supporting` | 只做摘要与导航，不能覆盖 V3 产品基线 |
| `frontend/README.md` | Electron 客户端开发入口 | `candidate-for-v3` | 开发命令和文件角色需要 V3 代码对账 |
| `docs/ARCHITECTURE.md` | Electron/TypeScript 架构摘要 | `candidate-for-v3` | 需核对正式入口、SQLite、任务、地图和独立窗口边界 |
| `docs/REFERENCE-CATALOG.md` 与 `docs/reference-catalog/**` | 外部项目、网址、对话来源和本地材料索引 | `v3-supporting` | 收录不等于采纳；只有具体 V3 Trellis 任务完成来源、许可、范围与验证核对后才可影响实现 |
| `docs/V2-DATA-AUTHORITY-MATRIX.md` | 旧数据权威路径迁移提示 | `legacy/superseded` | 只重定向到 `docs/DATA-AUTHORITY-MATRIX.md`，没有当前权威 |
| `docs/V2-AGENT-BOUNDARY-MATRIX.md` | 旧生成与评审 Agent 边界 | `legacy/superseded` | 只有经 V3 AI 任务重新接纳的规则才能晋升 |
| `docs/V2-GENERATION-TASK-INVENTORY.md` | 旧生成任务分类 | `legacy/superseded` | 不再作为 V3 任务类型或完成声明 |
| `docs/V2-ADJUSTABLE-STARTING-SUGGESTIONS.md` | 旧可调建议与安全上限 | `legacy/superseded` | 数值不得直接进入 V3 产品行为 |

## 4. V3 候选视觉资料

| 路径 | 角色 | 状态 | 限制/替代关系 |
| --- | --- | --- | --- |
| `design-system/approved-2026-09-08/**` | 旧版作者原稿、加载视觉和实施证据 | `candidate-for-v3` | 只有 V3 UI 任务与作者重新验收后才能晋升 |
| `design-system/lanjian-novel-studio/**` | 早期工作台设计系统 | `legacy/superseded` | 不直接驱动 V3 |
| `design-system/narrative-terminal/**` | 离线原型、截图与验证 | `candidate-for-v3` | 不是 V3 正式应用或端到端验收 |
| `design-system/prototypes/**` | 更早期视觉探索 | `legacy/superseded` | 不直接驱动 V3 |
| `design-system/legacy/**` | 集中保存已迁移的旧设计资料 | `legacy/superseded` | 只保留追溯价值；不得作为 approved 或 candidate 视觉入口 |

## 5. Trellis 任务处置

| 任务 | 角色 | 状态 | 限制/后续 |
| --- | --- | --- | --- |
| `.trellis/tasks/archive/2026-09/00-bootstrap-guidelines` | 旧初始 spec 填充 | `legacy/superseded` | 已归档；不继承完成状态 |
| `.trellis/tasks/archive/2026-09/08-25-electron-client-migration` | 旧 Electron 迁移与产品规格 | `legacy/superseded` | 已归档；只允许路径级 V3 晋升 |
| `.trellis/tasks/archive/2026-09/08-26-modular-card-workbench` | 旧模块化工作台计划 | `legacy/superseded` | 已归档；不再承担 V3 路线 |
| `.trellis/tasks/archive/2026-09/09-01-sqlite-readable-mirror-foundation` | 旧 SQLite/镜像任务 | `legacy/superseded` | 已归档；数据安全不变量由 V3 数据矩阵另行接纳 |
| `.trellis/tasks/archive/2026-09/09-07-ui-rebuild-from-approved-images` | 旧 UI、桌宠、人物与地图任务 | `legacy/superseded` | 已归档；功能和视觉仍需 V3 任务验收 |
| `.trellis/tasks/archive/2026-09/09-09-project-rebaseline` 及其归档子任务 | V3-0 重新基线治理与验收证据 | `task-scoped`（completed） | 只证明 V3-0 治理完成；不冒领候选产品能力 |

归档任务位于 `.trellis/tasks/archive/`，默认是历史执行记录，不是当前产品权威。

## 6. 日期化实施与验收证据

以下日期化文件全部默认为 `legacy/superseded`。它们只证明旧版本特定范围曾有设计、实现或测试，不证明 V3 完成；需要复用时必须由 V3 任务逐项晋升。

### 6.1 写作、保存、恢复与大纲

- `ACTIVE-STREAM-EDITING-2026-09-07.md`
- `CORE-WRITING-UI-ACCEPTANCE-2026-09-07.md`
- `EDITOR-PARITY-2026-09-06.md`
- `FINDING-RESOLUTION-2026-09-08.md`
- `GUIDANCE-NAVIGATION-2026-09-06.md`
- `MANUSCRIPT-RECOVERY-REQUEST-GUARD-2026-09-07.md`
- `OUTLINE-GUIDES-2026-09-07.md`
- `OUTLINE-STORAGE-FEEDBACK-2026-09-08.md`
- `QUICK-CHAPTER-OPEN-2026-09-08.md`
- `WRITING-CANDIDATE-REBASE-2026-09-06.md`
- `WRITING-FLOW-GUIDANCE-2026-09-06.md`

### 6.2 AI、检索、评测与任务运行

- `DIRECT-CONVERSATION-EVALUATION-2026-09-07.md`
- `EXPLICIT-MODEL-ROUTING-2026-09-07.md`
- `LIVE-CONSISTENCY-RUNNER-2026-09-07.md`
- `MODEL-PICKER-2026-09-07.md`
- `NATIVE-TASK-PAUSE-2026-09-08.md`
- `NORMALIZED-RETRIEVAL-2026-09-07.md`
- `POSSESSION-HANDOFF-CHECK-2026-09-07.md`
- `PRIOR-HISTORY-CLAIM-REVIEW-2026-09-07.md`
- `QUESTION-RETRIEVAL-2026-09-07.md`
- `SEMANTIC-EVALUATION-BLINDING-2026-09-06.md`
- `SEMANTIC-EVALUATION-DIVERSE-V3-2026-09-08.md`
- `SEMANTIC-EVALUATION-ISOLATION-2026-09-06.md`
- `TASK-CENTER-HISTORY-2026-09-07.md`
- `TEMPORAL-APPROVED-FACTS-2026-09-07.md`
- `VERBATIM-RETRIEVAL-2026-09-07.md`

### 6.3 UI 与视觉实施

- `APPROVED-UI-IMPLEMENTATION-2026-09-08.md`：旧版批准稿实施证据，当前仅为 V3 候选。
- `ARKNIGHTS-UI-MOTION-INVENTORY-2026-09-08.md`：动效研究证据。
- `NARRATIVE-TERMINAL-ARCHITECTURE-2026-09-08.md`：旧叙事终端设计研究，不能替代 V3 正式架构。
- `NARRATIVE-TERMINAL-IMPLEMENTATION-2026-09-08.md`：原型/应用增量证据。
- `UI-REFERENCE-ALIGNMENT-2026-09-08.md`：旧批准图对齐证据。
- `SUPERDESIGN-FIDELITY-2026-09-07.md`、`UI-IMPLEMENTATION-2026-09-07.md`、`UI-REFERENCE-FUSION-2026-09-07.md`、`VISUAL-WORKSPACE-DIRECTION-2026-09-07.md`：`legacy/superseded`，只保留旧测试与研究证据。
- `UI-REDESIGN-IMAGE2-BRIEF-2026-09-06.md`：`legacy/superseded`；后续稿件同样须由 V3 UI 任务重新接纳。

### 6.4 人物、世界与桌宠

- `CHARACTER-ATLAS-IMPLEMENTATION-2026-09-08.md`
- `DESKTOP-PET-REUSE-RESEARCH.md`
- `WORLD-MAP-IMPLEMENTATION-2026-09-08.md`
- `WORLD-VISUALIZATION-DATA-2026-09-08.md`

这些文件是旧实现/研究证据，不代表任何 V3 功能已经完成。

### 6.5 V2 程序级证据与真实作品记录

- `V2-COMPLETION-AUDIT-2026-09-04.md`：大型旧版完成度审计，不能覆盖 V3 路线。
- `V2-ACCEPTANCE-HANDOFF-2026-09-07.md`：旧版作者体验交接证据，不能证明或阻塞 V3 验收。
- `REFERENCE-AI-NOVEL-WRITER-2026-09-05.md`：外部参考研究，不是产品要求。
- 特定作品的私有连续性核对清单与修订回执：保留在作者本地，不随源码上传，也不是全局产品事实。

## 7. 冲突处理与维护

1. 产品方向冲突：先核对用户最新确认并更新 `PRODUCT-BASELINE.md`。
2. 完成状态冲突：只有 `PRODUCT-ROADMAP.md` 中的 `v3-accepted` 和对应 V3 任务证据可以声明完成。
3. 数据写入冲突：以 `DATA-AUTHORITY-MATRIX.md` 的安全不变量为上游；具体实现未完成 V3 对账时停止写入性变更。
4. UI 冲突：所有旧视觉资料先视为候选；由当前 V3 UI 任务和作者验收决定，不从旧批准自动继承。
5. spec 与代码冲突：两者都先视为 V3 候选，记录 reconciliation gap；不能因任一方存在就静默晋升。
6. 新专题文档创建时必须在本矩阵登记或明确链接一个既有角色，避免再次形成孤立权威。
