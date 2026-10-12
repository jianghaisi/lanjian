# 岚笺在线体验站部署

四个独立入口共用一个轻量服务：`/` 项目介绍、`/login` 登录、`/app` 原版创作工作台、`/admin` 站点管理。用户以 Linux DO 登录，新身份首次获得 **10 积分**；模型与密钥由站长配置。约 0.5 元是你给每人的运营预算参考，不是充值或现金兑换承诺。

在线版保留总纲 → 事件 → 章纲 → 正文的实际写作流程，AI 结果经作者采用后成为正式内容。服务器不安装本地模型、语音模型或独立桌宠；这些能力在桌面版使用。

## 1. Windows 一键打包

构建机需要 Node.js 24、Python 3、Docker Desktop（Linux 容器模式）和联网下载依赖的能力。双击 `scripts/package-hosted.cmd`，或运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-hosted.ps1
```

输出在 `deploy/hosted/output/版本号.tar.gz`，旁边有 `.sha256`。包内包含 Linux amd64 的 Docker 镜像归档、可选 Caddy 镜像、Compose、运维入口和校验清单；服务器无需 npm 或编译。构建按明确清单收集服务源码和网页产物，不复制作者书稿、配置密钥、宿主 node_modules、本地模型或语音资源。当前只发布验证过的 **Linux amd64** 包。

## 2. 准备服务器和 Linux DO 应用

Linux amd64 主机需已安装 Docker Engine + Compose v2、Python 3.9+。安装与运维命令使用 sudo；应用容器以 UID 10001 运行、只读根文件系统，默认内存上限 768 MiB。另需为 Docker、系统、书稿和备份预留空间；实际承载量取决于主机和作品规模，可在后台降低并发数。

准备自己的域名、Linux DO Connect 应用 Client ID/Client Secret，以及管理员的 **Linux DO 数字 ID**。回调地址必须精确登记为：

```text
https://你的域名/api/auth/linuxdo/callback
```

使用 [Linux DO Connect](https://connect.linux.do/) 申请/管理应用。登录通过服务端交换凭据，浏览器不接触 Client Secret。没有默认管理员密码，也不会把第一个登录者自动设为管理员。

## 3. 上传并安装

上传 `.tar.gz` 和 `.sha256` 后，在空目录解压（替换示例文件名）：

```bash
sha256sum -c v0.1.0-日期.tar.gz.sha256
tar -xzf v0.1.0-日期.tar.gz
cd v0.1.0-日期
sudo bash lanjian.sh install
```

交互填写 HTTPS 域名源（如 `https://novel.example.com`，不带末尾斜线）、Client ID、数字管理员 ID 和 Client Secret。Secret 隐藏输入并写入独立受限文件；主密钥自动随机生成，**不会覆盖已有密钥**。重复 install 会拒绝覆盖。

默认只监听服务器本机 `127.0.0.1:43130`。将已有 Nginx/Caddy/宝塔的 HTTPS 反向代理转发到该地址，保留原 Host。业务请求使用同源 Cookie/CSRF；不要额外公开容器端口。

若没有反向代理、80/443 均空闲且域名已解析到服务器，可以首次安装时使用：

```bash
sudo bash lanjian.sh install --proxy
```

此模式启用随包 Caddy，自动申请 HTTPS；证书申请仍需公网网络和正确 DNS。已有站点占用端口时，请使用自己的反向代理或调整配置，不要停止其他服务。

安装失败会保留已生成配置和数据。修正后用 `sudo bash lanjian.sh up`，不要删除 runtime 再安装。配置位于 `runtime/config.env`，密钥在 `runtime/secrets/`，作品与账本在 `runtime/data/`；这些文件不要加入 Git 或放进公开下载目录。

## 4. 首次配置后台

尚未申请 Linux DO 应用时，可先开放介绍页和完整参考书：

```bash
sudo bash lanjian.sh install --public-only --origin https://你的域名 --memory-limit 384m
```

此时登录、个人书库和后台仍关闭，界面显示登录尚未配置；不创建占位身份或假凭据。`--memory-limit` 默认 `768m`，低内存共享主机可先使用 `384m`，后续结合实际创作负载调整。申请成功后在原部署目录执行：

```bash
sudo bash lanjian.sh configure-auth
```

按提示填写 Client ID、管理员数字 ID 和隐藏输入的 Client Secret。命令先验证、备份并停服，再启用配置；启动失败恢复原配置，主密钥和原有数据保持不变。该命令仅用于首次启用，不会替换已配置的提供商。不要重新安装或删除 runtime。

若使用 Cloudflare，源站有效证书就绪后应把这个站点设为 Full (strict)，确保边缘到源站也使用 HTTPS；同域已有其他子站时，先确认它们的源站证书，或只对本站设置规则，不直接更改全域策略。

以指定管理员的 Linux DO 账号登录，然后打开 `/admin`：

1. **模型与计费**：填写 HTTPS API 地址、协议、模型名和 Key，保存连接；配置渠道/分组名称、倍率、美元余额兑人民币比例及各类 token 单价，核对后启用。在“在线创作使用的唯一模型”中选择并应用。用户端不提供 API、渠道或模型选择，所有 AI 请求使用管理员指定的模型。Key 写入后不回显，换 API 地址需重新填写 Key。
2. **用户与积分**：新账户自动赠送 10 积分；后续手动发放。相同发放重试复用回执；再次发放请填写新的备注。
3. **站点设置**：填写项目地址、安装包下载地址和指南。未配时官网诚实提示；按服务器情况设置全站并发、每日调用、作品数和存储额度。
4. **待核对用量**：上游超时或缺少可信用量的费用会预留，先核对供应商账单再明确结算，避免误扣或重复调用。

积分采用千分之一积分的整数精度。按任务计费在生成可保存候选/部分结果时扣一次；按 tokens 计费会计入任务内规划、审校等多次调用。先预留预算，再按实际用量结算。请根据供应商成本设置费率，**10 积分本身不能保证供应商只收 0.5 元**。旧任务始终使用其受理时的价格版本。

## 5. 运维命令

用户认证采用固定版本 Better Auth 1.7.7（MIT），由其负责 Linux DO OAuth 状态、Cookie 与会话；业务作品与积分仍按稳定 Linux DO ID 归属。无需再部署独立用户中心或数据库服务器。认证数据保存在 `runtime/data/auth.sqlite`，OAuth tokens 使用部署主密钥派生的独立密钥加密；不提供密码/邮箱注册和账号关联。

升级前的手写会话会失效，用户重新登录后仍保留原作品和积分，不重复赠送。完整备份必须同时保留 `auth.sqlite`、`hosted.sqlite`、作品目录和主密钥。旧程序不支持新认证 schema，不能直接降级启动。

`/app/reference` 提供五章完结原创参考书《渡口最后一盏灯》，未登录也能阅读和下载完整设定、章纲与正文；登录后免费复制到个人书库。复制不调用模型、不扣积分，同一示例版本重复复制会打开原副本，保留作者修改。未完成的复制保持隐藏，重试会从已完成阶段继续；若初始化本身因磁盘/权限中断而被 V3 拒绝恢复，联系管理员检查私有目录，不能强行把半成品标记为完成。

```bash
sudo bash lanjian.sh status
sudo bash lanjian.sh logs
sudo bash lanjian.sh stop
sudo bash lanjian.sh up
sudo bash lanjian.sh backup
```

备份会短暂停服务，等待在途任务结束/取消后打包完整 runtime（账户、积分、预留、书稿、历史、OAuth 配置及加密主密钥），再恢复原运行状态。备份与 SHA256 写入 `backups/`，权限为仅管理员可读。请定期复制到另一台机器；备份含密钥，须私密保管。

更新时将**新包解压到另一个目录**，在原部署目录运行：

```bash
sudo bash lanjian.sh update /完整路径/新版本目录
```

先核对包/架构/schema，再加载镜像、停服备份和切换程序。更新不会执行 down -v。启动失败且数据 schema 未变时恢复原程序；schema 已变则保持停止，要求完整恢复到新目录，绝不拿旧程序强行降级数据。旧版本和备份会保留，清理应由你确认后进行。

恢复时，把同版本或兼容的新发布包解压到**没有 runtime 的新目录**，准备备份与相邻 `.sha256`：

```bash
sudo bash lanjian.sh restore /完整路径/lanjian-备份.tar.gz
# 检查 runtime/config.env 的域名和端口，避免与原站冲突
sudo bash lanjian.sh load
sudo bash lanjian.sh up
```

恢复不会自动启动或覆盖原目录。主密钥必须随备份恢复，否则无法解密模型 Key。仅支持单个应用实例；不要让两套容器同时挂载同一数据目录。

## 6. 上线前需要你完成

真实域名/DNS/HTTPS、Linux DO 应用审核与回调配置、管理员 ID、远程模型 Key 和实际费率。先用自己的账号完成一次登录、生成、采用、导出和账单核对，再邀请其他人。工程自动化使用合成身份和模型验证隔离、计费、保存与恢复，不代表真实 OAuth 或供应商已验收。

本仓库未声明项目开源许可；对外放出源码/安装包前，由维护者确认项目素材和代码的发布许可。第三方声明随包保留。


当前在线版直接加载原 V3 AppShell，保留原书库、编辑器和书库看板娘；模型配置由后台统一接管。暂未适配的功能（包括作品删除/回收站、原生文件夹与插件安装等）保留原入口并明确提示暂不可用，不返回虚假成功。本轮用户明确允许按此范围先上线。
# 网页资源与游客（2026-10-06）

登录页提供“以游客身份进入”，地址 `/app?guest=1`。游客在原版工作台查看完整原创样书，不创建账号、不赠积分、不能编辑或调用 AI；登录后仍使用独立账户书库。桌宠入口只在当前页面提示下载完整版。

网页图片/音效使用 `web/media` 派生版本，桌面源资产不变。四首用户提供的音乐按 WELCOME（Suspended in Time）和揭幕（Quiet Wonder）各两首随机选择；首次访问浏览器可能要求点击“开启声音”，也可点击 WELCOME 后播放。音乐失败不阻挡开场，后台标签暂停播放。原工作台完整动画保留，并提供“直接进入”。
