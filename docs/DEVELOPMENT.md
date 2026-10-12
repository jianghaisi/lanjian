# 开发与验证

使用 Node.js 24 LTS 与 npm。根目录 README 的快速开始列出共享包安装顺序；不要省略共享包构建后直接运行 Electron。

桌面集成测试会导入 `services/plugin-marketplace/dist`。即使不运行该服务，执行桌面类型检查或安装包构建前，也需要先在该目录运行 `npm ci` 和 `npm run build`。

在仓库根目录运行 `node scripts/ci.mjs all` 可依次安装、测试与构建所有包；`install` 只安装并准备共享包，`check` 使用已有依赖执行检查。桌面测试默认最多 4 个文件并发，避免高核 Windows 主机的磁盘争用；可用 `npm run test:desktop -- --test-concurrency=2` 显式调整。

## 常用命令
| 目录 | 命令 | 用途 |
| --- | --- | --- |
| desktop | npm run desktop:dev | 桌面开发 |
| desktop | npm run typecheck | TypeScript 检查 |
| desktop | npm run check:architecture | 导入、权限边界和循环检查 |
| desktop | npm run test:desktop | 全部已发现的单元/集成测试 |
| desktop | npm run desktop:build | 生产构建 |
| desktop | npm run desktop:dist | NSIS 安装包 |
| web | npm run typecheck / npm test / npm run build | 网页检查与构建 |
| services/hosted-app | npm run typecheck / npm test / npm run build | 托管服务检查与构建 |
| services/plugin-marketplace | npm run typecheck / npm test / npm run build | 可选分发服务 |

在 desktop 执行 node scripts/test-desktop.mjs --list 可以核对发现的测试。可选 Python 运行时与私有作者操作脚本不随源码发布，对应不可用的专项必须明确跳过，不能当作通过。

## 隔离原则
不要在作者正在运行的 out 上重建。必要时用 npx electron-vite build --outDir out-release-check，随后运行相应 smoke。普通生产构建不包含环境驱动开发场景；需要时显式使用 --mode smoke。

Electron 检查必须同时将 LANJIAN_USER_DATA_PATH 与 LANJIAN_GLOBAL_MODEL_DATA_PATH 指向临时目录，使用合成作品和假模型。单独指定 userData 不应被当成已隔离全局模型凭据。先检查旧 smoke 的实际实现再运行，不复制真实用户配置。

## 干净发布树
公共代码来自逐文件审计的 V3 源码快照。后续提交延续 main 的历史，不导入私有开发任务、作者书稿、数据库、密钥、模型权重或未确认许可的媒体。内部使用 Trellis 的工作区继续遵守其自身门禁；公开构建不要求私有任务目录。

新增测试验证实际边界与失败恢复，不通过伪造模型响应宣称真实文学质量。界面、安装、数据恢复等声明需要相应的真实应用检查。

## 提交
只提交认领路径，并检查 diff 与敏感信息扫描。代码、版本、Release 标签和安装包必须对应同一发布提交，详见 [发布流程](RELEASE.md)。
