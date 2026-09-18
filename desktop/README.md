# 岚笺桌面工程 / Lanjian desktop

Electron、Vue 与 TypeScript 的完整桌面包。主进程、preload、界面与跨进程契约统一构建，业务分为 11 个 feature。

- [中文项目介绍](../README.md) / [English overview](../README.en.md)
- [目录与模块关系](../docs/PROJECT-STRUCTURE.md)
- [开发、构建与验证](../docs/DEVELOPMENT.md)
- [第三方说明](licenses/THIRD-PARTY-NOTICES.md)

```powershell
npm ci
npm run desktop:dev
```

`out/` 是普通构建产物，不是源文件。验证时不要覆盖作者正在运行的输出目录；详细隔离检查命令见开发说明。
