# 开发与验证 / Development

## 环境

已验证环境为 Windows、Node.js 24.11.1 与 npm。依赖以 `desktop/package-lock.json` 固定，首次安装使用 `npm ci`。核心桌面功能不需要独立服务器或 Python；可选本地文本/语音推理另需相应 Python 环境、模型及其依赖。

不要把 `node_modules`、模型权重、作品、密钥、运行输出或安装包提交为应用源码。当前工程内部保留 `frontend` 包名及既有 appId/userData 身份，避免用户设置与加密凭据因源目录改名失联。

## 日常命令

在 `desktop/` 运行：

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run desktop:dev` | Electron 与 Vite 开发模式 |
| `npm run typecheck` | 主进程、桥接和界面 TypeScript 检查 |
| `npm run check:architecture` | 检查器自测、依赖边界和运行时循环 |
| `npm run test:desktop` | 递归运行 unit/integration 的 .test.ts |
| `node scripts/test-desktop.mjs --list` | 列出实际测试发现清单 |
| `npm run desktop:build` | 类型检查与普通生产构建 |
| `npm run desktop:dist` | 构建 Windows NSIS 安装包 |
| `npm run test:workspace-migration` | 本机开发环境路径重绑定回归 |

普通构建不会包含开发场景入口。需要环境变量驱动的完整开发烟测时，使用 `npm run test:smoke`，或先运行 `npx electron-vite build --mode smoke --outDir out-smoke-check`。场景使用合成数据与本地模型响应桩；可选真实模型评测需要额外配置。

作者旧批处理脚本不随工程快照分发。与它们对应的两项门禁回归在完整本地工作区继续运行，在快照中明确跳过；通用路径/存储模式门禁测试仍正常执行。可选 Python 运行时缺失时，其依赖的子进程检查也会明确跳过。

## 保护作者当前会话

普通构建覆盖 `out/`，不可与作者正在使用该目录的应用并行。验证重构使用独立输出：

```powershell
npx electron-vite build --outDir out-refactor-check
node scripts/directory-layout-smoke.mjs out-refactor-check
node scripts/refactor-workflow-smoke.mjs out-refactor-check
```

第一项验证固定 worker、窗口隔离、preload 和书库启动。第二项通过真实界面在临时目录创建虚构作品，验证定义输入、中文正文保存、快速打开、历史命名、导入预览、工作台切换和重开后的正文。两者不使用作者资料，报告和截图进入 `desktop/artifacts/`，不随源码发布。

不要同时构建与启动同一输出目录。测试结束后保留临时证据以便诊断；它们不是产品资料。

## 代码归属

新增业务先确定所属 feature。main 的装配入口不承载用例；renderer 动作与草稿状态按业务归属，模板引用必须显式连接回控制器。复用 IPC DTO 时区分只含类型的导入和运行时校验，避免把 Node 解码器带进 renderer/preload。

使用 Trellis 管理的本地开发工作区仍须遵守其 `AGENTS.md`、current task 和 preflight 门禁。首次源码快照只收录维护规格，不携带作者身份、开发日志、任务历史与会话运行状态；在新的协作环境中应建立自己的任务上下文。

## 发布边界

GitHub 首发是经过筛选的当前工程快照。真实作品、历史 Git 分支、私有开发任务、凭据、模型、截图和未经核查的资源不进入首发。源码整理不切换作品存储模式，也不把候选产品能力自动标为已验收。

本地原有开发历史与暂存区保留；首发提交使用独立发布引用。后续更新应在发布分支的提交链上追加，不把旧的开发历史整包推送。

## English notes

Use Node.js 24 and `npm ci` in `desktop/`. The command table above covers development, type checking, architecture validation, unit/integration tests and packaging. Optional local inference requires separate runtimes and weights.

Keep the author's running `out/` untouched during verification. Build to an isolated directory, then run the two smoke scripts shown above. They exercise a temporary profile and synthetic book through the real Electron UI. Normal production builds exclude the environment-driven development scenario driver; opt in with `--mode smoke`.

The initial private source snapshot excludes author data, credentials, model weights and private development history. It is not a declaration that every V3 feature has passed acceptance.
