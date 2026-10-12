# 岚笺插件市场服务

独立的插件分发服务。只接收作者在发布预览中明确提交的插件包、清单和派生引用；不接收小说、写作历史或模型连接。离线个人创建和已安装插件不依赖这个服务，也无需市场账号。

## 本地构建

要求 Node 24。按顺序在下列三个目录执行 `npm ci`、`npm run build`：

1. `packages/writing-plugin-contracts`：纯 TypeScript 契约，无 Node/Electron 依赖。
2. `packages/writing-plugin-package`：Node ZIP 校验器，桌面与服务共用。
3. `services/plugin-marketplace`：Fastify、node:sqlite、jose。

`npm run typecheck`、`npm test` 验证真实 HTTP、签名身份校验、所有权、不可变版本、包校验、上传限额、下架与恢复。锁文件固定依赖；SQLite 在本次 Node 24.11.1 环境仍有 experimental 提示。

## 测试身份与桌面联通

在本目录执行：

```sh
docker compose -f deploy/compose.yaml --profile test up -d keycloak-test
# 等待 http://127.0.0.1:43121/realms/lanjian-plugins-test/.well-known/openid-configuration 可用
npm run test:oidc
npm run test:recovery
docker compose -f deploy/compose.yaml --profile test stop keycloak-test
```

先构建桌面：在 `desktop` 执行 `npx electron-vite build --outDir out-plugin-marketplace-check`。OIDC 测试使用 desktop 的 Playwright 与已安装的 Microsoft Edge；启动临时市场服务和两个独立 Electron profile，使用真实 Keycloak 浏览器登录、发布、下载、实际 QuickJS 工具执行和下架竞态。它不使用作者的 profile、模型账号或稿件。

测试账号仅用于此本地 realm：`author-a / author-a-test-only`、`author-b / author-b-test-only`。禁止将测试 realm 或 `start-dev` 用于生产。测试回调使用真实浏览器获得的一次 code，经 Electron 的 `second-instance` 处理器注入；不修改本机协议关联。因此该测试不代表安装包的 OS 协议注册/默认浏览器往返验收。发行前须另行验证该项。

当前机器 Docker daemon 不可用，实测使用相同的官方 Keycloak 26.7.4 ZIP 和 Java 25，在隔离 WSL 测试环境运行；Docker Compose 只验证配置解析，未声称容器运行通过。镜像摘要由 Docker Hub/Quay registry 核对并固定，见 `deploy`。

## 身份契约

- Public OIDC client：Authorization Code、PKCE S256，关闭密码直授和 service account。
- 精确回调：`cn.zuolan.novelwriter:/oauth/callback`，不使用通配符。
- 请求 scope：`openid plugins:publish`；access token 必须有 `sub`、受信任 `iss`、市场 `aud`、`iat`、`exp` 和 `plugins:publish` scope。
- 服务允许 RS256/ES256；JWKS 与配置的 issuer 同源，不能由包或 renderer 指定。
- Keycloak 26 的 access token 需要 Subject mapper，示例 realm 显式启用 `oidc-sub-mapper`。参见 [Keycloak protocol mappers](https://www.keycloak.org/admin-api/protocol-mappers)。`session_state` 可作为回调附加字段，仍严格校验 state、nonce、签名和一次性 code。
- 桌面 token 只驻留 main 内存，不跨重启保存。退出、超时、迟到回调不能恢复旧会话；插件 worker 不接触 token。
- 发布者身份为受验证 `[issuer, subject]` 的 SHA-256；同一 issuer/subject 必须保持稳定。包内作者文字不证明所有权。

## 配置与生产部署门禁

参考 `deploy/env.example`。服务配置：`MARKET_OIDC_ISSUER`、`MARKET_OIDC_JWKS`、`MARKET_OIDC_AUDIENCE`、绝对路径 `MARKET_DATA_DIR`，可选监听 host/port。桌面通过受控启动/发行配置提供 `LANJIAN_MARKET_ORIGIN`、`LANJIAN_MARKET_ISSUER`、`LANJIAN_MARKET_CLIENT_ID`。未配置时显示尚未连接市场，本地功能继续可用。

生产只接受 HTTPS identity/market 地址。开发 HTTP 仅限显式隔离 profile、未打包应用和 `LANJIAN_MARKET_TEST_LOOPBACK=1` 的 127.0.0.1；服务对应 `MARKET_TEST_LOOPBACK=1`。不得在生产配置这些测试开关。

```sh
docker compose --env-file /absolute/private/market.env -f deploy/compose.yaml --profile production up -d --build market
```

Compose 的默认 example.invalid 地址只是占位符。上线前提供真实域名/HTTPS、OIDC issuer/client、持久卷和备份位置，并验证打包应用协议关联。市场只绑定宿主 loopback；由受控 HTTPS 反向代理转发。反向代理不得记录 Authorization、OAuth code、ticket、请求正文或令牌；配置上传大小 10 MiB、请求超时和流量限额。应用 logger 默认关闭，仅错误码返回客户端，不回显上传代码或凭据。健康检查 `/health` 不返回身份或目录内容。

生产镜像为普通 node 用户、只读根文件系统、独立持久卷，根构建上下文通过 Dockerfile 专用 ignore 限制为两个包和此服务。此仓库没有自动部署或购买资源脚本；当前交付不表示公共市场已经上线。

## API 与状态

固定路由：GET `/health`、`/categories`；POST `/catalog`、`/versions`；POST `/mine`（已登录，`{offset,limit}`）；POST `/uploads/prepare`；PUT `/uploads/:operation`；GET `/releases/:operation`；POST `/releases/:operation/withdraw`；GET `/public/:operation`、`/download/:operation/:digest`。

作者在桌面核对实际文件、清单与摘要后提交：`uploading → validating → published | validation-failed`。校验通过即公开，无逐版人工门禁，公开页如实显示“未人工审核”。下架为 `withdrawn`，停止新下载且保留既有对象/安装。自动校验不会在服务执行上传代码，也不代表文学质量。

- 同一 operationId 幂等；同一 pluginId/version 永不替换，失败版本也不能改写。未知结果先查询原 operation，再继续原上传。
- 准备阶段验证所有权；实际 bytes 验证 SHA-256、清单、ZIP CRC/路径/资源上限、声明文件集和支持能力。
- 单包 10 MiB；查询每页最多 10、响应最多 3 MiB；ticket 10 分钟；每作者最多 8 个未过期上传；同时接收/校验最多 2 个；IP 每分钟 120 请求。
- 首版服务总配额为 10,000 个版本 / 1 GiB 声明包字节，失败/下架版本保留并计入。容量扩展须制定保留/配额策略，不能靠删除所有权或已提交版本掩盖失败。
- 官方标识来自服务目录中受运维控制的 publisher policy。普通上传、包清单和派生操作都不能设官方。所有新发布者默认社区；首版没有开放管理接口或自动精选。
- 安装回到桌面既有安装器，重新核对公开状态及字节摘要。新安装默认关闭、零授权；更新保留旧版，新增权限需要作者选择；下架不强制删除本地安装。

## 备份、恢复与回退

服务数据目录包含 `catalog.sqlite`（WAL 模式）、`packages/<sha256>.zip` 和可能的上传暂存。SQLite `user_version=1`，拒绝未知更高版本，不擅自降级。只运行一个服务实例管理此 SQLite/包目录。

首版采用停服一致性备份：停止自己的 market 实例并确认退出，完整复制数据目录（含可能存在的 WAL/SHM）到新的带时间戳目录；另行备份 OIDC 配置和数据库。不要在服务写入期间仅复制主 SQLite 文件。不要把 token、作者本地稿件或模型配置放进备份。

恢复到**新空目录**，保留原数据与备份，使用同一受信任 issuer/subject 设置。启动时逐一对账 `validating`：对象存在且校验通过才转公开，否则标失败；过期上传不公开。验证 `/health`、目录、确切版本下载摘要和原账号所有权后再切换代理。`npm run test:recovery` 在独立临时目录实际演练对象先落盘的崩溃、停服拷贝、恢复和篡改检测。

代码回退保留数据目录、草稿、安装索引、来源记录和所有已提交版本。数据库版本不兼容时恢复到另一个目录并人工核对新旧服务间新增版本，禁止直接覆盖原目录或删除远程版本。桌面发行中若撤下市场连接，本地创建和已安装插件继续工作。
