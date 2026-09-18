# 岚笺 · Lanjian

[English](README.en.md) · [开发说明](docs/DEVELOPMENT.md) · [工程结构](docs/PROJECT-STRUCTURE.md) · [产品路线](docs/PRODUCT-ROADMAP.md)

**面向长篇小说创作的本地桌面工作台。**

岚笺把作品定义、素材、世界设定、事件时间线、分层大纲和正文组织在同一部作品中。作者可以手写，也可以配置模型获得可审阅、可舍弃的写作候选。

> **开发状态：V3 持续开发与验证中。** 当前仓库是工程源码快照，不代表 V3 全部功能已经验收，也不是稳定安装包发布。界面目前以中文为主；本页与英文 README 提供双语项目介绍。

## 创作方式

```text
作品定义与素材 → 世界设定
                       ↓
全局总纲 → 卷纲 → 章节安排 → 章纲 → 正文
    ↕          版本化事件时间线          ↕
                   审校与作者确认
```

- **书库与文稿**：本地作品创建、打开、文稿导入，章节编辑、保存、历史与恢复。
- **谋篇与纪事**：总纲、卷纲、阶段纲与章纲；以时间、人物、地点、事件记录故事。
- **设定与约束**：世界观、人物与关系、动态境界、力量边界和固定系统界面模板。
- **AI 助笔**：模型连接与作品分配、上下文、生成任务、差异预览与作者采用。
- **创作辅助**：人物状态、一致性审校、地图、写作伙伴与可选本地推理。

保存、采用候选和正式确认是不同操作。AI 输出不会仅因生成成功就成为作者的正式正文或设定。具体目标与验收状态分别见[产品基线](docs/PRODUCT-BASELINE.md)和[产品路线](docs/PRODUCT-ROADMAP.md)。

## 快速开始

当前开发与桌面回归在 **Windows** 验证。建议使用 **Node.js 24 LTS + npm**；无需另起后端服务器。基础编辑与远端模型调用不依赖 Python。

```powershell
git clone https://github.com/jianghaisi/lanjian.git
cd lanjian/desktop
npm ci
npm run desktop:dev
```

私有仓库需要已获授权的 GitHub 账号。模型调用需要自行配置接口；没有模型密钥也可建立作品并手写。可选本地模型、语音需要独立安装运行环境与权重，这些文件不随源码上传。

首次启动若提示语音或本地模型尚未就绪，可点击“跳过等待，进入作品库”继续手写；之后再配置可选功能。

## 检查与构建

在 `desktop/` 执行：

```powershell
npm run typecheck
npm run check:architecture
npm run test:desktop
npm run desktop:build
```

`npm run desktop:dist` 构建 Windows NSIS 安装包到 `desktop/release/`。其他操作系统、签名安装包和真实模型的全部组合尚未通过本次验证。

为保护正在运行的作者应用，可使用独立输出目录：

```powershell
npx electron-vite build --outDir out-refactor-check
node scripts/directory-layout-smoke.mjs out-refactor-check
node scripts/refactor-workflow-smoke.mjs out-refactor-check
```

这两个检查使用临时用户配置与虚构作品，不读取作者书稿。完整开发烟测的构建模式与更多命令见[开发说明](docs/DEVELOPMENT.md)。

## 工程组织

```text
desktop/
├─ src/
│  ├─ main/
│  │  ├─ bootstrap/   启动、窗口和服务装配
│  │  ├─ modules/     按业务组织的规则、用例、适配与 IPC
│  │  ├─ platform/    文件、SQLite、系统进程、私有设置
│  │  └─ core/        公共端口与跨模块写入协调
│  ├─ preload/        固定名称的受限桥接
│  ├─ renderer/
│  │  ├─ app/         应用壳、导航、布局与模块组合
│  │  ├─ features/    按业务组织的视图、状态与动作
│  │  ├─ ui/          通用界面控件
│  │  └─ assets/      样式和界面资产
│  └─ contracts/      分业务的类型、校验与纯共享规则
├─ tests/             单元、集成、隔离桌面场景与测试素材
├─ scripts/           开发与验证工具
├─ public/            静态运行资源
└─ licenses/          第三方归属说明
docs/                  产品、架构与维护文档
```

业务模块包括 `library`、`worldbuilding`、`planning`、`timeline`、`manuscript`、`characters`、`world-map`、`assistant`、`review`、`models`、`companion`。模块职责和依赖规则见[工程结构](docs/PROJECT-STRUCTURE.md)与[架构](docs/ARCHITECTURE.md)。

## 本地数据与隐私

- 作品保存在作者选择的目录，应用设置保存在 Electron 用户数据目录。
- 当前文件模式以 Markdown 保存正文和大纲，以 SQLite 管理结构化记录与文件引用；旧作品继续遵守其实际存储模式，不因打开或源码重构而自动切换。
- 窗口启用 sandbox 与 context isolation。渲染页面通过命名接口访问主进程，不直接获得文件系统或密钥原文。
- 在线模型与联网采风会把该次请求需要的内容发送给配置的服务；“本地保存”不等于在线 AI 请求完全离线。
- 真实书稿、凭据、备份、模型权重、运行截图和私有任务历史不属于本次上传内容。

详见[数据权威与恢复边界](docs/DATA-AUTHORITY-MATRIX.md)。目录名 `lanjian/desktop` 与应用的既有数据身份是两回事；包内保留的历史 `frontend` 名称用于兼容，不应据此手动移动用户数据。

## 许可与资源

本项目尚未选择开放源码许可证；私有仓库上传不授予额外再分发权。第三方组件各自遵守原有许可证，尤其 Live2D Cubism Core 有独立条款。参见[第三方说明](desktop/licenses/THIRD-PARTY-NOTICES.md)与[资源来源](desktop/src/renderer/assets/visuals/ASSET_SOURCES.md)。

本次快照排除使用条件尚未解决的参考照片及其衍生纹理，并保留可运行的封面后备资源；作者本地原文件不被删除。
