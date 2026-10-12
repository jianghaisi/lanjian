# 视觉资产来源

## 当前独立桌宠：透明视频

用户已批准先采用可用视频、暂缓不合格片段并去掉平台logo。`pet-videos/`中17份WebM及同源`poster.png`由本任务已检查的edge-v2透明成果派生，保持960×960/24fps、原动作长度和静音；`manifest.json`绑定源文件和运行文件的SHA-256、帧数、实际时长及循环属性。目录不包含被拒收的握手视频。

来源为 作者保留的 2026-10-02 原始视频目录（不随公开仓库分发）：13份Dola动作加由idle提取的blink，以及用户提供的stretch/listening/drinking原片（服务名未说明）。全帧检查未见独立平台logo图块；候选源区段避开水印覆盖人物的后段，导出仅额外去除人物外的孤立残片，不补绘人物、裁掉动作或移除服饰图案。完整原视频与平台来源记录保留在外部素材目录。

运行文件使用本地WebM透明解码，不需要联网、FFmpeg或Python。处理脚本 `desktop/scripts/prepare-pet-videos.py` 仅用于开发，源码和原始媒体不因来源记录而获得额外第三方授权。当前组件为DesktopPetArtwork的视频播放器；下方原画/程序动画描述为历史来源，资源保留但不再作为独立桌宠当前播放器。

## 新版 Q 桌宠 — 2026-09-20

`character-q-current.png`、`character-q-current-blink.png`、`character-q-current-speaking.png` 由图像工具根据作者新版看板娘 Q 参考生成；分别承担透明主图、闭眼和开口表情。运行时只裁取表情区域，呼吸、拖动、回弹和照料动作使用程序动画，无视频依赖。

三张均为 1254×1254 RGBA，已检查实际 alpha 与原生窗口布局。输入参考、生成原件和验证证据由作者留存于私有开发记录，不随公开仓库分发。这些是本项目素材，未使用 VPet 或其他桌宠项目的人物图片。

## 岚笺四联视觉系统 v2

- 现实层参考：Historical Photographs of China，`Yang Fang in the smaller courtyard of his house, Beijing`，约 1870 年代。
- 来源页：https://hpcbristol.net/visual/PF01-09
- 本地参考：`reference-yang-fang-courtyard.jpg`
- 四联母版：`lanjian-quartet-master-v2.png`
- 界面横向衍生：`lanjian-quartet-workbench-v2.png`
- 生成方法：Starryear-Abstract-Quartet 的现实、编辑记忆、结构抽象、混合重释四阶段。

生成资产不得作为第三方原照片的版权声明替代物。

2026-09-18 核查：来源平台的[使用说明](https://hpcbristol.net/license/what-you-can-and-cannot-do-downloads)标注 CC BY-NC-ND 4.0。项目尚无超出该条件的单独授权记录，因此上述参考照片、四联母版和横向衍生图均不进入首次 GitHub 快照。它们可继续保留在作者本地；`LibraryBookCover` 在缺少本地横向纹理时使用独立生成的 `archive-observatory.png`，保留书名与封面布局。

## 其他运行插画与角色

`archive-observatory.png` 是为岚笺生成的叙事档案馆主题插画，不是历史照片或作品事实地图。其本地设计过程记录在 `design-system/approved-2026-09-08/OBSERVATORY-ASSET.md`，设计历史不随首次工程快照上传。

其余背景、近期作品配图、角色立绘与 Q 版图片为项目本地视觉资产；当前 V3 基线确认复用作者的 `lanjian-rig` 角色。首次快照只纳入实际界面使用的资源，不包含 Cubism 编辑源文件、外部参考照片、设计截图或模型权重。资源不因私有源码上传而获得额外开源授权；第三方运行库见 `desktop/licenses/THIRD-PARTY-NOTICES.md`。
