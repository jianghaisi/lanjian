# V3 公开发布与 Windows 安装验证

## 1. 范围与触发
适用于公开源码、GitHub Release 和 Windows 安装包。发布号不代表 V3 整体验收。原开发仓库的作者数据、私有任务与历史不进入公开分支；从已审计的公开快照进行普通快进更新。

## 2. 命令与接口
- `node scripts/ci.mjs all`：按共享包依赖顺序安装、测试和构建。
- `npm --prefix desktop run desktop:dist`：构建 Windows x64 NSIS。
- 在 desktop 中运行 `node scripts/release-smoke.mjs <安装后的exe> <独立验证目录>`。
- Windows Release workflow_dispatch 接收已有 `vMAJOR.MINOR.PATCH` 标签，只创建草稿预发布。已有 Release 或资产拒绝覆盖。

## 3. 契约
版本号、lock、标签、源码提交和安装包必须一致。保留 appId、协议和用户数据身份。Windows app / installer / uninstaller 使用项目 ICO，不能遗漏后回退 Electron 图标。
验证同时指定 LANJIAN_USER_DATA_PATH 与 LANJIAN_GLOBAL_MODEL_DATA_PATH，只操作新建合成作品；无真实模型请求或作者大纲确认。
用属于被测页面的 BrowserWindow.close() 执行关闭，等待应用保存握手和进程退出后重启。原生捕获须检查非空和尺寸，再实际检查图片。
源码按精确清单暂存，审计完整公开历史与最终树。凭据仅通过已有凭据管理器进入授权请求内存，不能写日志、源码或命令参数。

## 4. 验证与错误矩阵
| 情况 | 处理 |
| --- | --- |
| 测试、构建、秘密扫描失败 | 阻止公开；保留首轮证据，修复后重验 |
| 无签名证书 | 明确未签名；SHA-256 不等于身份签名 |
| 已有作者安装、原配置或作品 | 隔离测试，不覆盖作者安装或操作作者数据 |
| 覆盖安装 / 卸载 | 比较合成作品与配置的字节摘要；卸载不能删除作品 |
| Windows 高核机器 I/O 争用 | 桌面测试默认最多 4 个文件并发，可显式 --test-concurrency 调整；不跳过失败断言 |
| 下载失败 | 验证网络与构建缓存；不能拿未完成包当成可用 Release |

## 5. 正确、基础与错误案例
正确：同一提交构建，真实安装、手工保存、原生关闭、重启恢复、卸载保留数据、下载 SHA-256 全部验证后发布。
基础：文档更改只检查内容、链接和图片，不虚报原生验证。
错误：上传 Actions artifact 就宣称 Release 可下载；只检查 IPC 中的草稿值就断言已落盘。

## 6. 必须断言
确认 app.isPackaged、app.getVersion、实际隔离目录、sandbox/contextIsolation、必需 preload/worker/WASM 资源；手工输入按编辑器实际格式保存，完整字节在新进程中相同；升级与卸载保留合成数据。验证匿名仓库与附件下载，并检查摘要一致。保留首次失败与最终结果，不推断未测试的平台或真实 OAuth/模型已通过。

## 7. 常见错误与修正
错误：用 Playwright Page.close() 关闭 Electron 页面，可能直接销毁 webContents，绕过窗口关闭前的保存握手。
修正：获取当前页面对应的 BrowserWindow，调用 close() 并等待进程正常退出。
错误：全局忽略 runtime/，导致 src 下业务运行模块漏入发布树。
修正：仅忽略 services/*/runtime 与明确的生成目录；用干净构建和测试验证发布清单。


## 实际草稿安装包验收（2026-10-15）

`Windows Installer Validation` 手动流程接收已有草稿标签，下载该 Release 的 EXE 与 SHA256SUMS，核对版本/摘要后在临时 Windows runner 执行现有 release-smoke。必须检查实际安装、手工保存、新进程恢复、覆盖安装与卸载前后合成数据的字节摘要；保存 installation.json、verification.json 与实际截图，查看截图后再发布。

同一应用身份的 NSIS 即使指定临时 /D，也会查找并卸载已有安装；不能以此隔离作者本机安装。优先使用全新 runner，保持原安装和作者数据不变。草稿对只读令牌不可见，验收流程为此使用 contents: write，令牌只进入下载步骤，checkout 关闭凭据持久化；流程无发布/资产变更命令。API 重定向至下载主机时必须移除 Authorization。

标签运行源码须与安装包和完整 CI 对齐；后续仅工作流或文档的提交可单独记录，不能借此绕过运行源码验证。
