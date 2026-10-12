# 在线试用与自托管

现有在线入口：[岚笺](https://lanjian.jiangai.space/)；工作区：[进入创作](https://lanjian.jiangai.space/app)。游客入口用于阅读公开参考，登录及可用模型以站点实际配置为准。

## 为什么不能直接用 GitHub Pages
网页复用桌面界面，但创作依赖 Fastify 服务、账号身份、持久化存储和模型计量。GitHub Pages 可承载静态介绍，不能替代这些能力。本次复用已有站点，不新增付费平台或域名。

## 本地开发在线版
按 README 先构建共享包，再分别在 web 与 services/hosted-app 执行 npm ci。网页 dev 的 /api 代理指向 127.0.0.1:43130。开发服务也需要明确的独立数据目录与主密钥文件；不能复用生产密钥或用户数据。

服务端读取：
- LANJIAN_PUBLIC_ORIGIN：准确的 HTTPS origin；本机开发可显式设 LANJIAN_DEVELOPMENT=1 并使用 localhost/127.0.0.1。
- LANJIAN_MASTER_KEY_FILE：绝对路径；文件内容为 32 个随机字节的 Base64 表示。
- LANJIAN_DATA_DIR：持久化数据目录。
- LANJIAN_WEB_DIR：指向构建后的 web/dist，用于由服务端提供网页。
- LINUXDO_CLIENT_ID 与 LINUXDO_CLIENT_SECRET_FILE：同时提供；secret 仅置于受限文件。
- LANJIAN_ADMIN_LINUXDO_IDS：明确的数字 ID 列表。不会把首个访客自动提升为管理员。
- LANJIAN_HOST / LANJIAN_PORT：默认 127.0.0.1:43130。

不配置 OAuth 时不要填写假值。公开只读模式和登录未就绪状态由服务真实表达。

## 生产部署
现有 deploy/hosted 提供 Linux amd64 Docker、Caddy/已有反代兼容、独立 secrets、备份、更新与恢复工具。先按 [托管运维说明](HOSTED-DEPLOYMENT.md) 生成对应部署包，再使用其中的 lanjian.sh；不要把源码目录误当成已经包含镜像和清单的部署包。

需要提前准备：
1. 服务器或可运行 Node 24 / Docker 的平台，持久化存储和 HTTPS 域名。
2. 独立主密钥文件；启用登录时提供 Linux DO 应用配置，回调为站点 origin 加 /api/auth/linuxdo/callback。
3. 启用 AI 时，由管理员配置模型连接、费用与积分规则。

.env、模型密钥、OAuth secret 和备份不进入 Git。使用仓库里的 config.example 只作字段模板，不包含真实凭据。更换主密钥会影响已有数据，更新时必须保留。

本次 0.1 Windows Release 不包含新的托管镜像发布，也不承诺现有站点与桌面提交完全同步。配置后分别验证 HTTPS、匿名阅读、本人登录、账号隔离、备份恢复与实际模型计量。
