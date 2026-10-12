<p align="center"><img src="docs/assets/logo.svg" width="96" alt="岚笺 Logo"></p>

<h1 align="center">岚笺 · Lanjian</h1>
<p align="center">面向长篇小说创作的本地桌面工作台。</p>
<p align="center">
<a href="https://github.com/jianghaisi/lanjian/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/jianghaisi/lanjian?style=flat-square"></a>
<a href="https://github.com/jianghaisi/lanjian/forks"><img alt="Forks" src="https://img.shields.io/github/forks/jianghaisi/lanjian?style=flat-square"></a>
<a href="LICENSE"><img alt="源码 MIT" src="https://img.shields.io/badge/code-MIT-356653?style=flat-square"></a>
<a href="https://github.com/jianghaisi/lanjian/actions/workflows/ci.yml"><img alt="Build" src="https://github.com/jianghaisi/lanjian/actions/workflows/ci.yml/badge.svg?branch=main"></a>
<a href="https://lanjian.jiangai.space/"><img alt="在线试用" src="https://img.shields.io/badge/在线试用-立即打开-d89b38?style=flat-square"></a>
</p>
<p align="center"><a href="https://lanjian.jiangai.space/"><strong>在线试用 ↗</strong></a> · <a href="https://github.com/jianghaisi/lanjian/releases/tag/v0.1.0"><strong>下载 Windows 安装包 ↗</strong></a> · <a href="README.en.md">English</a></p>

岚笺把资料、世界设定、事件时间线、分层大纲与正文放在同一部作品中。你可以独立手写，也可以接入模型，与预设创作团队讨论，逐项审阅并采用写作候选。

> **0.1 开发预览版。** 发布号为 0.1.0，当前产品按 V3 路线持续开发。预览版不代表全部功能或真实模型文学质量已经验收；请保留作品备份。桌面版与在线部署的版本和可用能力可能不同。

## 界面预览

下图为现有网页版中**游客公开参考书**的真实界面截图（2026-10-11），不是当前桌面安装包的截图，不含作者私有书稿。

![书库：继续创作、作品卡片和新建作品](docs/assets/product-library.webp)

![编辑器：章节目录、正文与编辑工具](docs/assets/product-editor.webp)

图片与标志的来源见 [素材说明](docs/assets/README.md)。

## 功能特性

- **作品与文稿**：本地作品管理，多书标签，TXT / Markdown / Word 导入，章节编辑、保存、历史与导出。
- **资料与知识库**：按小说、视频和题材整理参考材料；提取结果保留来源，作者决定是否取用。
- **世界与人物**：人物、关系、世界书、可配置境界表和固定系统提示框模板。
- **谋篇与纪事**：总纲、卷纲、章纲与事件时间线逐层展开，记录时间、人物、地点、事件及其依赖。
- **AI 助笔与团队**：接口配置、模型分工、群聊讨论、候选预览、批注与逐处修订。
- **可选创作辅助**：方法插件、桌宠、地图、本地模型与语音；部分能力仍处于 Beta 或需单独准备环境。

**保存、采用候选、确认大纲是三个不同操作。** 总纲及对应卷纲、章纲的当前版本经作者确认后，才允许发起对应正文生成；上游修改会使相关确认失效。AI 生成成功不会自动变成正式稿件。

## 创作流程与架构

以下为**架构示意图**，不是界面截图。

~~~mermaid
flowchart LR
  A[作品定义与参考资料] --> B[世界与人物设定]
  B --> C[总纲]
  C --> D[卷纲]
  D --> E[章纲]
  E --> F[作者确认当前版本]
  F --> G[正文候选与手工编辑]
  G --> H[作者审阅与采用]
  C <--> T[四要素事件时间线]
  E <--> T
  H --> I[审校与事件核对]
  I --> T
~~~

~~~mermaid
flowchart TB
  UI[Vue 桌面界面] --> Bridge[受限 preload 接口]
  Bridge --> Main[Electron 主进程与领域服务]
  Main --> Local[本地文件与 SQLite]
  Main --> Model[作者配置的模型服务]
  Browser[浏览器工作区] --> API[Fastify 托管服务]
  API --> Account[账号私有书库与积分]
  API --> HostedModel[站长配置的模型服务]
~~~

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 桌面应用 | Electron、Vue 3、TypeScript、electron-vite |
| 编辑与视觉 | CodeMirror 6、Three.js、PixiJS、Live2D 可选组件 |
| 本地存储 | Markdown / 文件、SQLite、操作系统保护的模型设置 |
| 在线版 | Vue / Vite、Fastify、Better Auth、Node.js 24 |
| 插件 | 类型化契约、受限工具接口、QuickJS |
| 交付 | electron-builder、Windows NSIS、GitHub Actions |

## 快速开始

### 下载安装

1. 打开 [v0.1.0 Release](https://github.com/jianghaisi/lanjian/releases/tag/v0.1.0)，下载 **Lanjian-0.1.0-Setup-x64.exe**。
2. 安装并启动应用；建立空白作品，选择自己的作品保存目录。
3. 没有模型密钥也可以手工编辑。需要 AI 时，在应用内配置接口与模型。
4. 本地语音、模型商店下载等为可选功能；不要求先准备这些组件才能使用基础编辑。

首版针对 **Windows x64**。签名状态、验证范围与已知问题以 [发布说明](docs/releases/v0.1.0.md) 为准。SHA-256 可用 PowerShell 校验：

~~~powershell
Get-FileHash .\Lanjian-0.1.0-Setup-x64.exe -Algorithm SHA256
~~~

将输出与 Release 的 SHA256SUMS.txt 对照。安装包无需用户安装 Node.js；Python 与模型权重不随包分发。

### 从源码运行

开发使用 **Node.js 24 LTS + npm**，Git 克隆后先构建共享包：

~~~powershell
git clone https://github.com/jianghaisi/lanjian.git
cd lanjian
npm --prefix packages/hosted-contracts ci
npm --prefix packages/hosted-contracts run build
npm --prefix packages/writing-plugin-contracts ci
npm --prefix packages/writing-plugin-contracts run build
npm --prefix packages/writing-plugin-package ci
npm --prefix packages/writing-plugin-package run build
npm --prefix services/plugin-marketplace ci
npm --prefix services/plugin-marketplace run build
npm --prefix desktop ci
npm --prefix desktop run desktop:dev
~~~

桌面开发无需启动远程后端。不要把真实书稿放入源码仓库。

### 检查与打包

~~~powershell
npm --prefix desktop run typecheck
npm --prefix desktop run check:architecture
npm --prefix desktop run test:desktop
npm --prefix desktop run desktop:dist
~~~

安装产物输出到 desktop/release。运行测试请使用临时作品和独立配置；详细命令见 [开发指南](docs/DEVELOPMENT.md)。

## 环境变量与模型配置

**普通桌面用户通过界面配置模型，无需 .env。** 不要把 API Key 放进源码、作品目录或截图。

| 变量 | 用途 |
| --- | --- |
| LANJIAN_USER_DATA_PATH | 显式指定独立桌面配置目录，主要用于隔离验证 |
| LANJIAN_GLOBAL_MODEL_DATA_PATH | 隔离模型配置与凭据根目录，测试必须单独设置 |
| LANJIAN_WEB_BASE | 托管静态资源前缀，默认 / |
| LANJIAN_PUBLIC_ORIGIN | 托管站点的准确 HTTPS origin |
| LANJIAN_DATA_DIR | 托管版数据目录 |
| LANJIAN_MASTER_KEY_FILE | 托管主密钥文件的绝对路径 |
| LINUXDO_CLIENT_ID / LINUXDO_CLIENT_SECRET_FILE | Linux DO 应用标识与单独的秘密文件路径 |
| LANJIAN_ADMIN_LINUXDO_IDS | 明确配置的管理员数字 ID，逗号分隔 |
| LANJIAN_HOST / LANJIAN_PORT | 托管监听地址与端口，默认 127.0.0.1:43130 |

表中只描述变量名，不提供真实凭据。部署模板与配置步骤见 [部署指南](docs/DEPLOYMENT.md)。

## 使用说明

1. **建书**：填写书名和种类，选择保存位置；可以先不配置模型。
2. **筹备**：整理参考资料、人物和世界，按需进入本书群聊。
3. **谋篇**：完成总纲、卷纲与章纲，对照时间线检查因果和顺序。
4. **确认**：作者核对当前版本；改动上游后重新审阅受影响部分。
5. **写作**：手工编辑，或在允许生成后取得候选，再决定采用。
6. **保存与审校**：检查状态、历史和事件结算；重要节点另做备份。

## 在线试用与部署

**[打开在线试用](https://lanjian.jiangai.space/)** · [进入工作区](https://lanjian.jiangai.space/app)

| | 桌面版 | 在线版 |
| --- | --- | --- |
| 数据 | 作者选择的本地目录 | 登录账号的服务器私有书库 |
| 模型 | 作者自行配置；可选本地模型 | 站长开放的模型与积分规则 |
| 游客 | 可无密钥手工编辑 | 公开参考书只读体验 |
| 原生能力 | 文件选择、桌宠和可选本地运行时 | 浏览器权限内的功能 |
| 版本 | 本仓库 v0.1.0 安装包 | 独立上线，以实际站点为准 |

完整在线创作需要后端、身份配置与持久化存储，不能只上传静态文件到 GitHub Pages。可使用已有 Node.js 24 / Docker 自托管方案；详见 [部署指南](docs/DEPLOYMENT.md) 和 [托管运维说明](docs/HOSTED-DEPLOYMENT.md)。

## 项目结构

~~~text
desktop/                    Electron 桌面应用
  src/main/                 领域服务、存储与系统能力
  src/preload/              命名、受限的桌面桥接
  src/renderer/             Vue 界面
  src/contracts/            共享类型与校验
  tests/                    合成数据测试
  licenses/                 第三方许可
packages/                   托管与插件共享契约
web/                        浏览器界面与官网
services/hosted-app/        托管身份、书库、模型与计量服务
services/plugin-marketplace/ 可选插件分发服务
deploy/hosted/              自托管部署与恢复工具
docs/                       使用、开发、发布和素材说明
.github/workflows/          检查与 Release 构建
~~~

## FAQ

**不用 AI 能写吗？** 可以。建立作品后即可手工编辑；没有配置密钥时不应伪报模型就绪。

**在线版会自动读取我的桌面书稿吗？** 不会。两个存储位置不同，不会自动上传本地书稿。

**可以离线使用吗？** 本地文件与基础编辑不依赖在线模型。远端 AI、采风、模型下载等操作需要网络。

**为什么仍能看到“小说写作助手”或 frontend？** 首版保留部分历史安装与数据身份以保护兼容，产品名称为岚笺。请勿因此手动移动或清空应用数据。

**安装包为什么可能出现发布者提示？** 首版没有承诺代码签名。请只从本仓库 Release 下载并校验 SHA-256；不要把提示当作已签名证明。

**能直接生成整本高质量小说吗？** 0.1 不承诺这一点。大纲确认、文学质量、长篇一致性与真实模型效果需要作者逐步审阅。

**如何报告问题？** 在 [Issues](https://github.com/jianghaisi/lanjian/issues) 提供版本、系统、最小复现和脱敏日志；不要贴 Key、Cookie 或私人稿件。

## 后续更新计划

0.1 是起点，后续将持续完善以下方向：

- **UI 完善与书籍封面**：统一界面体验，丰富封面展示与书库表现。
- **插件系统与写作流程优化**：打磨插件使用，以及从资料、大纲到正文的创作与审阅流程。
- **开机动画与桌宠互动**：优化启动体验、动作反馈、专注陪伴及可选语音。
- **地图系统**：完善地图创作、地点与事件关联、可视化交互。
- **稳定性与数据保护**：持续改进保存、恢复、备份与安装升级。

详见 **[完整后续更新计划](docs/PRODUCT-ROADMAP.md)**。这些是持续建设方向，具体已交付内容以 [Release 发布说明](https://github.com/jianghaisi/lanjian/releases) 为准。

## 贡献指南

欢迎可复现的缺陷报告、中文文档完善和经过测试的小范围改进。提交前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。当前范围与后续方向见 [产品基线](docs/PRODUCT-BASELINE.md) 和 [路线](docs/PRODUCT-ROADMAP.md)。

## 友情链接
[LINUX DO](https://linux.do/) —— 一个有温度的社区，欢迎交流

## License

项目原创**源码**使用 [MIT License](LICENSE)。第三方依赖及角色、音乐、视频等非代码资源保留各自条件，不能推定全部资源都获得 MIT 授权。参见 [资源许可边界](ASSETS.md)、[桌面第三方说明](desktop/licenses/THIRD-PARTY-NOTICES.md) 和 [网页第三方说明](web/THIRD-PARTY-NOTICES.md)。
