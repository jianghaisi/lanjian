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
<p align="center"><a href="https://github.com/jianghaisi/lanjian/releases/tag/v0.1.5"><strong>下载 Windows 安装包 ↗</strong></a> · <a href="https://lanjian.jiangai.space/"><strong>在线试用 ↗</strong></a> · <a href="README.en.md">English</a></p>

岚笺是一款本地小说写作工具，将正文、资料、人物设定、大纲和故事事件集中在同一部作品中管理。你可以独立创作，也可以接入模型，与智能助笔讨论情节，再自行决定保留哪些内容。

目前发布的是 **0.1 开发预览版**，提供 Windows x64 安装包。许多细节仍在打磨，欢迎结合实际写作体验提出问题和建议。重要作品请注意保留备份。

## 赞助商

| 合作伙伴 | 介绍 |
| --- | --- |
| [<img src="desktop/src/renderer/assets/sponsors/fastaitoken.png" width="48" height="48" alt="FastAIToken Logo">](https://www.fastaitoken.com/register?aff=YD326MA7UYAU)<br>**[FastAIToken](https://www.fastaitoken.com/register?aff=YD326MA7UYAU)**<br>AI API 聚合平台 | 感谢 FastAIToken 对岚笺的支持！FastAIToken 面向开发者提供 AI API 聚合服务，可用于接入 OpenAI、Claude、Gemini 等模型。**[通过岚笺邀请链接注册 ↗](https://www.fastaitoken.com/register?aff=YD326MA7UYAU)** |

*赞助推广 · 模型、渠道与价格以平台说明为准；第三方充值不计入岚笺站内积分。*

## 为什么做岚笺

写长篇小说时，除了正文创作，还经常需要处理许多琐事：回查人物之前说过什么、找回几天前记下的灵感、核对事件发生的先后顺序，或是将调整过的设定同步到大纲。随着资料不断积累，在文档、笔记和聊天记录之间反复翻找，很容易打断写作思路。

岚笺希望把这些工作集中在一个地方。打开一本书，就能找到对应的正文、人物、资料和创作规划；遇到卡壳的地方，也可以结合已有的故事背景展开讨论，不用每次都从头解释。

AI 可以参与创作，但最终的决定权仍在作者手中。讨论结果可以先检查，修改过程有迹可查，确认采用后再写入作品。即使完全不用 AI，也可以从空白文稿开始，按照自己的节奏一页一页写下去。

## 从岚笺沉淀的设计 Skill

我很喜欢《明日方舟》的界面设计。在开发岚笺的过程中，我把设计讨论、UI 改造和动效迭代中的经验整理成了 **[Design Style Library · 由人把控方向的设计 Skill](https://github.com/jianghaisi/lanjian-arknights-ui)**，供 Codex 在其他项目中复用。

它支持风格选择、完整设计图、现有项目 UI 改造和组件动效：先结合原始参考讨论方向，再按用户选择推进，也支持其他风格与自由描述。具体方向和取舍始终由使用它的人决定。

**[查看设计 Skill、安装方式与生成效果 →](https://github.com/jianghaisi/lanjian-arknights-ui#readme)**

## 看看桌面端

以下均为 **Windows 桌面版 0.1.0 安装后的实际截图**，拍摄于 2026-10-12。图中的作品、人物和资料均为专门录入的独立示例，不包含私人书稿，也没有伪造模型回复。[截图来源](docs/assets/README.md)

### 书库与封面

打开岚笺，首先看到的是自己的作品。书库会保留上次写到的章节、字数和最近编辑时间，方便随时继续创作，也可以导入已有文稿。每本书都有独立的卡片和封面，封面样式与排版还会继续完善。

![桌面书库：继续创作、作品封面与三部示例作品](docs/assets/desktop-library.png)

### 正文编辑

左侧是章节目录，中间是文稿编辑区。查找替换、版式设置、批注、跟随输入和专注模式等功能都安排在编辑区附近，保存状态和历史版本也可以随时查看。想推敲一句话或一段情节时，可以打开右侧的智能助笔。

无需配置模型即可手工编辑。已有文稿可以从 TXT、Markdown 或 Word 导入，写好的内容也可以导出。

![桌面正文编辑器：章节目录、说明文字、保存状态与智能助笔](docs/assets/desktop-editor.png)

### 作品定义

可以先写下这本书的核心设想，再逐步补充题材、篇幅、视角和文风。卷数、每卷章数和每章字数只是规划参考，后续可以随着故事发展灵活调整。不希望每次都向模型重复说明的写作要求，也可以提前记录在这里。

![作品定义：核心设想、题材和篇幅计划](docs/assets/desktop-definition.png)

### 资料与灵感

一张资料卡可以同时记录原文、来源和自己的判断。随手记下的灵感、手工整理的材料，以及联网采风收集的内容，都有各自的入口。找到一份资料，不代表它已经成为小说设定，是否采用仍由作者自行决定。

![自备资料：资料目录、原文与作者备注](docs/assets/desktop-materials.png)

### 人物与世界设定

可以分别为人物、地点、物品、组织和世界规则建立档案。公开设定、作者备注和尚未揭开的秘密分开记录，写到后面需要回查时也更方便。对于仙侠、玄幻或系统题材，还提供境界与力量、金手指与固定系统模板的入口。

![人物与世界书：示例人物档案、公开设定和秘密记录入口](docs/assets/desktop-worldbook.png)

### 总纲、卷纲与章纲

全书的故事走向、每一卷的主要情节，以及具体章节的内容安排，适合分层推敲。谋篇页将这几层规划组织在同一棵目录树中，即使正文已经写到一半，也可以回头调整大纲、对照历史版本。

使用模型生成正文前，需要先由作者确认当前总纲及对应的卷纲、章纲。如果上游内容发生改动，受影响的部分需要重新确认；保存大纲并不等于确认大纲。

![谋篇：全书总纲、三卷规划与章节目录](docs/assets/desktop-outlines.png)

### 事件纪事

将事件发生的时间、涉及的人物和地点、具体经过及后续影响记录在一起，回顾故事时就多了一条线索。既可以按事件、人物或地点查找，也能从事件直接跳转到地图。这里记录的是故事中的变化，修改事件记录不会直接改写章节正文。

![事件纪事：三条示例事件及来信抵达的完整档案](docs/assets/desktop-events.png)

### 地图

可以将故事中的地点标注在地图上，点击地点即可查看相关事件和人物。下图展示的是同一示例作品的实际标注界面：旧邮局、南岸码头和灯塔的位置由演示数据指定，底图使用默认网格。

地图功能仍在完善。AI 底图生成目前处于 Beta 阶段，需要另外配置模型；本次截图没有调用生图服务。

![地图：三个地点标注与旧邮局关联事件](docs/assets/desktop-map.png)

### 共创室与智能助笔

共创室以单部作品为单位组织讨论。主编、世界观设定师、人物设计师等成员各有分工，也可以分别选择模型；讨论中产生的筹备内容会保留在这本书中，方便后续核对。编辑页面的智能助笔则更适合围绕当前正在写作的内容反复推敲和修改。

图中展示的是尚未配置模型的初始团队，不包含模拟对话或生成成果。实际使用时，需要先配置相应接口。

![共创室：七位预设成员、讨论区和筹备成果区](docs/assets/desktop-team.png)

### 写作插件

不同题材和写作方式，所需的辅助工具也各不相同。应用自带的插件库包含悬疑线索编排、人物动机核对、对白与人物声线、伏笔核对等工具，可以按用途查找，再根据需要决定安装哪些插件、开放哪些能力。

插件还提供本书使用范围和个人创作入口。安装、更新、版本兼容性以及公共市场体验，都是后续持续完善的部分。

![写作插件：本地插件库、分类筛选与随应用提供的插件](docs/assets/desktop-plugins.png)

### 写作伙伴

书库里的看板娘也可以作为小桌宠，陪在写作窗口旁。大小、位置、动作、提醒，以及专注时是否隐藏，都可以自行调整；想安静写作时，也能随时把它收起来。设置页面支持直接预览动作。

语音和本地模型都是可选功能，需要单独准备，不影响基础写作。桌宠互动、养成和启动动画还会继续打磨。

![写作伙伴：桌宠位置、显示设置和真实动作预览](docs/assets/desktop-companion.png)

## 创作流程与架构

从前期筹备到正式落笔，可以参考下面的流程。以下为**流程与架构示意**。

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

1. 打开 [v0.1.5 Release](https://github.com/jianghaisi/lanjian/releases/tag/v0.1.5)，下载 **Lanjian-0.1.5-Setup-x64.exe**。
2. 安装并启动应用，创建空白作品，选择自己的作品保存目录。
3. 即使没有模型密钥，也可以手工编辑。需要使用 AI 时，再在应用内配置接口和模型。
4. 本地语音、模型商店下载等均为可选功能，基础编辑不需要提前准备这些组件。

当前安装包面向 **Windows x64**。有关签名状态、验证范围及已知问题，请参阅 [发布说明](docs/releases/v0.1.5.md)。可通过 PowerShell 校验 SHA-256：

~~~powershell
Get-FileHash .\Lanjian-0.1.5-Setup-x64.exe -Algorithm SHA256
~~~

将校验结果与 Release 中的 SHA256SUMS.txt 对照。安装包不需要用户另行安装 Node.js；Python 和模型权重不随安装包分发。

### 从源码运行

源码开发使用 **Node.js 24 LTS + npm**。克隆仓库后，需要先构建共享包：

运行完整测试还需要 **Python 3.10+**（CI 使用 3.12），只需标准库，无需下载模型。默认从 PATH 查找 Python；如果系统安装了多个版本，可以通过 `LANJIAN_TEST_PYTHON` 指定 Python 可执行文件。安装后的桌面应用不要求用户提前安装这些开发工具。

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

桌面端开发无需启动远程后端。请勿将真实书稿放入源码仓库。

### 检查与打包

~~~powershell
npm --prefix desktop run typecheck
npm --prefix desktop run check:architecture
npm --prefix desktop run test:desktop
npm --prefix desktop run desktop:dist
~~~

打包产物输出到 desktop/release。运行测试时，请使用临时作品和独立配置；详细命令见 [开发指南](docs/DEVELOPMENT.md)。

## 环境变量与模型配置

**普通桌面用户可以通过界面配置模型，无需 .env。** 请勿将 API Key 放入源码、作品目录或截图中。

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

表中仅说明变量名称及用途，不包含真实凭据。部署模板与具体配置步骤见 [部署指南](docs/DEPLOYMENT.md)。

## 使用说明

1. **建书**：填写书名和种类，选择保存位置；无需提前配置模型。
2. **筹备**：整理参考资料、人物和世界设定，按需进入本书群聊。
3. **谋篇**：编写总纲、卷纲和章纲，结合时间线核对因果关系与事件顺序。
4. **确认**：作者核对当前版本；上游内容改动后，重新审阅受影响的部分。
5. **写作**：手工编辑，或在允许生成后获取正文候选，再自行决定是否采用。
6. **保存与审校**：检查保存状态、历史版本和事件结算；在重要节点另行备份。

## 在线试用与部署

**[打开在线试用](https://lanjian.jiangai.space/)** · [进入工作区](https://lanjian.jiangai.space/app)

| | 桌面版 | 在线版 |
| --- | --- | --- |
| 数据 | 作者选择的本地目录 | 登录账号的服务器私有书库 |
| 模型 | 作者自行配置；可选本地模型 | 站长开放的模型与积分规则 |
| 游客 | 可无密钥手工编辑 | 公开参考书只读体验 |
| 原生能力 | 文件选择、桌宠和可选本地运行时 | 浏览器权限内的功能 |
| 版本 | 本仓库 v0.1.5 安装包 | 独立上线，以实际站点为准 |

完整的在线创作功能需要后端、身份配置和持久化存储，不能只将静态文件上传到 GitHub Pages。可以使用现有的 Node.js 24 / Docker 自托管方案，具体说明见 [部署指南](docs/DEPLOYMENT.md) 和 [托管运维说明](docs/HOSTED-DEPLOYMENT.md)。

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

**不用 AI 能写吗？** 可以。创建作品后就能手工编辑，无需提前配置模型密钥。

**在线版会自动读取我的桌面书稿吗？** 不会。桌面版和在线版使用不同的存储位置，本地书稿不会自动上传。

**可以离线使用吗？** 可以。本地文件和基础编辑功能不依赖在线模型，但远端 AI、采风、模型下载等操作仍需要网络。

**为什么仍能看到“小说写作助手”或 frontend？** 首版为兼容历史安装与数据身份，保留了部分旧名称。产品名称为岚笺，请勿因此手动移动或清空应用数据。

**安装包为什么可能出现发布者提示？** 0.1 版本的 Windows 安装包尚未签名，因此系统可能显示“未知发布者”。请从本仓库 Release 下载，并使用附带的 SHA-256 校验文件是否完整。

**能直接生成整本高质量小说吗？** 目前还无法做出这样的承诺。故事是否成立、人物是否有趣、长篇前后是否连贯，仍需要作者逐步阅读和修改。岚笺也会继续完善这些环节。

**如何报告问题？** 请在 [Issues](https://github.com/jianghaisi/lanjian/issues) 中提供版本、系统环境、最小复现步骤和脱敏日志；不要上传 Key、Cookie 或私人稿件。

## 后续更新计划

0.1 只是起点，后续将持续完善以下方向：

- **UI 完善与书籍封面**：统一界面体验，丰富封面展示与书库表现。
- **插件系统与写作流程优化**：持续改进插件使用体验，以及从资料、大纲到正文的创作与审阅流程。
- **开机动画与桌宠互动**：优化启动体验、动作反馈、专注陪伴及可选语音功能。
- **地图系统**：完善地图创作、地点与事件关联及可视化交互。
- **稳定性与数据保护**：持续改进保存、恢复、备份和安装升级。

详见 **[完整后续更新计划](docs/PRODUCT-ROADMAP.md)**。以上为持续建设方向，具体已交付内容以 [Release 发布说明](https://github.com/jianghaisi/lanjian/releases) 为准。

## 贡献指南

欢迎提交可复现的缺陷报告、完善中文文档，或贡献经过测试的小范围改进。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。当前范围与后续方向见 [产品基线](docs/PRODUCT-BASELINE.md) 和 [路线](docs/PRODUCT-ROADMAP.md)。

## 友情链接

[LINUX DO](https://linux.do/) —— 一个有温度的社区，欢迎交流

## License

项目原创**源码**采用 [MIT License](LICENSE)。第三方依赖以及角色、音乐、视频等非代码资源仍适用各自的许可条件，不能据此认定所有资源均获得 MIT 授权。详情参见 [资源许可边界](ASSETS.md)、[桌面第三方说明](desktop/licenses/THIRD-PARTY-NOTICES.md) 和 [网页第三方说明](web/THIRD-PARTY-NOTICES.md)。
