# 岚笺工程目录

应用仓库为 `lanjian/`，桌面包为 `desktop/`。当前产品是一个 Electron 桌面应用；界面、主进程和通信契约在同一工程内构建。

```text
lanjian/
├─ desktop/
│  ├─ src/
│  │  ├─ main/
│  │  │  ├─ bootstrap/       启动、窗口安全、IPC 装配
│  │  │  ├─ modules/         按业务分组的领域规则、用例和适配
│  │  │  ├─ platform/        文件、SQLite、系统进程及私有设置
│  │  │  └─ core/            公共错误、存储端口、写入协调
│  │  ├─ preload/            类型化、固定名称的 IPC 桥接
│  │  ├─ renderer/
│  │  │  ├─ app/             应用壳、启动、全局导航和主题
│  │  │  ├─ features/        按业务分组的组件、状态和客户端
│  │  │  ├─ ui/              通用组件
│  │  │  └─ assets/          界面样式和静态图像
│  │  └─ contracts/          跨进程类型、数据校验和纯共享逻辑
│  ├─ tests/
│  │  ├─ unit/              按业务分类的单元及组件检查
│  │  ├─ integration/       跨模块流程和安全边界检查
│  │  ├─ smoke/             隔离 Electron 场景
│  │  └─ fixtures/          测试数据和测试进程
│  ├─ scripts/              开发、验证、迁移及打包辅助
│  ├─ public/               运行时公开资源
│  ├─ licenses/             第三方归属说明
│  └─ electron.vite.config.ts
├─ docs/                    产品、路线、架构和开发说明
└─ .trellis/spec/           当前维护规格
```

## 业务模块

2026-10-05 获批的在线模式增加 `packages/hosted-contracts/`（纯 HTTP 契约）、`services/hosted-app/`（身份、私有书库、账本与创作用例）、`web/`（官网/体验/后台）和 `deploy/hosted/`（预构建部署包）。目录按子任务逐步建立；不复用 Electron 启动器或把本地模型 worker 部署到服务器。桌面目录与作者本地数据保持原职责。

| 目录名 | 职责 |
| --- | --- |
| library | 书库、作品创建/打开/导入、工作区加载与备份 |
| worldbuilding | 定义、研究资料、世界设定、境界与系统模板 |
| planning | 总纲、卷纲、章节骨架、章纲与规划采用 |
| timeline | 时间线、事件身份、事件版本和迁移 |
| manuscript | 章节编辑、保存、历史、恢复和导出 |
| characters | 人物档案与状态 |
| world-map | 地点投影、沙盘与地图候选 |
| assistant | 写作助笔、工具调用、上下文和生成任务 |
| review | 一致性审校、事实候选、问题与证据 |
| models | 模型连接、分配、协议适配和本地推理 |
| companion | 看板娘、语音及独立桌宠 |

主进程模块按实际需要包含 `domain/`、`application/`、`adapters/` 和 `runtime/`。界面模块按实际需要包含 `components/`、`composables/` 和 `services/`。不要为空目录搭建模板。

界面通过 preload 使用固定名称的接口；主进程负责文件、数据库与凭据。目录归属不改变作品事实权威、作者采用流程或 UI 导航。跨模块的公共能力应有明确用途，不能把新增业务重新堆入通用 services。

## 开发入口

在使用 Trellis 管理的本地开发工作区，先从仓库根执行任务门禁，再进入桌面包。私有开发任务和会话状态不随首次源码快照发布；新协作环境需建立自己的任务上下文。

```powershell
python scripts/trellis_preflight.py --intent code
cd desktop
npm run desktop:dev
npm run typecheck
npm run check:architecture
npm run test:desktop
npm run desktop:build
```

`npm run test:desktop` 递归发现 `tests/unit/` 和 `tests/integration/` 内的 `.test.ts`；`node scripts/test-desktop.mjs --list` 可检查实际发现清单。`tests/smoke/` 由对应隔离桌面场景启动，不混入纯 Node 测试。

`out/` 是标准构建产物；验证其他目录时使用 `node node_modules/electron-vite/bin/electron-vite.js build --outDir out-directory-check`。不要在构建未结束时启动同一输出目录。

构建结束后，可运行 `node scripts/directory-layout-smoke.mjs out-directory-check`，用临时配置检查 worker 输出、窗口隔离、preload 通信和书库启动；证据写入已忽略的 `artifacts/directory-layout/`。

## 与本地数据的关系

作品、作品备份、模型安装和交付资料位于用户选择的本地目录，独立于应用源码；目录整理不会把它们搬进 Git 仓库。应用的既有 `userData` 路径、加密身份、appId 和包名暂时保持兼容，源码目录名不能被当作数据迁移命令。

## 内部职责拆分

- `main/bootstrap/index.ts` 保留生命周期，服务装配与窗口分别位于 `create-desktop-runtime.ts`、`create-main-window.ts`。业务 IPC、备份、事实提取和写作任务的接线属于对应 feature；共用 IPC 校验包装属于 `platform/ipc/`。
- `renderer/app/use-workspace-controller.js` 连接显式依赖与共同生命周期，各业务的 `composables/create-*-actions.js` 和 `create-workspace-state.js` 分别拥有操作与状态。共享 ref 不复制成第二套草稿，静态模板引用需显式返回给 AppShell。
- `WorkspaceExplorer`、`SettingsWorkbench` 与各 feature 的工作台和对话框承接界面区域，原有导航与作者操作语义保持一致。
- `contracts/<feature>/types.ts`、`*-api.ts` 与 `ipc.ts` 分别组织 DTO、接口和参数校验；根 `index.ts`、`ipc.ts` 是兼容导出，不再堆放实现。
- 开发场景位于 `tests/smoke/` 和 `tests/smoke/scenarios/`；正常生产构建删除场景入口，开发服务或 `--mode smoke` 才启用。

`npm run check:architecture` 检查禁止的跨层访问、间接 Node 依赖与运行时循环。目录和内部拆分不代表 V3 全部产品能力已验收。
