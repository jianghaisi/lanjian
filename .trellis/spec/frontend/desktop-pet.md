> V3 status: `candidate-for-v3`. 独立桌宠属于 V3-5；当前窗口、IPC、视觉与测试细节尚未被 V3 接纳。

# 独立桌面伙伴

## 1. Scope / Trigger

2026-09-09：作者确认先实现独立窗口、写作联动与离线娱乐，正式 Q 版图片后补。Vue 第二入口 `pet.html` 是应用的一部分，不是新 Demo。只选择性适配 OpenDesktop-Pet 窗口机制，不整包引入模型、摄像头或屏幕读取。

## 2. Signatures

- `attachDesktopPet(owner: BrowserWindow): { dispose(): void }`，位于 `desktop/src/main/modules/companion/desktop-pet-window.ts`。
- `DesktopPetApi.get(): Promise<DesktopPetState>`。
- `updateContext(context: DesktopPetContext): Promise<DesktopPetState>` 仅 owner 主 frame 可调用。
- `command(command: DesktopPetCommand): Promise<DesktopPetState>` 与 `onState`；动作回到主界面使用 `onAction`，不传正文写入指令。
- 类型唯一来源：`desktop/src/contracts/companion/desktop-pet.ts`；运行时校验：`desktop-pet-policy.ts`。

## 3. Contracts

- Context：mode、scope、taskId、taskStatus、quiet、reducedMotion、followPointer、autoBlink、stateFeedback、intensity、focusHidden。两种渲染共用 Controller，不各自创建任务。
- Command：toggle/hide/locate/return-to-writing/settings/drag-start/drag-end；mode 仅 detailed/chibi；hover 为布尔；regions 最多24个局部可交互矩形；configure 传完整 preferences。
- Preferences：scale 0.6–1.8、alwaysOnTop、clickThrough、reminderMinutes 0–240整数。原子保存到 userData/desktop-pet.json，位置为屏幕 DIP；角色外观沿用原本全局/按作品偏好。
- State：open、context、preferences、position 或 null、error 或 null。配置失败不把内存状态当已保存；locate 可临时解锁找回并报告保存失败。
- 独立 preload 自包含、sandbox/contextIsolation 开启、nodeIntegration 关闭；不暴露 novelDesktop。禁止新窗/导航/权限请求。owner 真正 closed 才清理，保持原保存退出保护。
- 写作顶栏和作品库顶栏互斥挂载同一入口，不能在返回作品库后丢失 onAction 订阅。库中 settings 使用本机外观弹窗；return-to-writing 提示选作品，不自动打开任意书。找回入口不能只存在于已打开的作品中。
- Windows 首次鼠标事件可能不穿透转发：renderer 报告裁剪后的矩形，main 每40ms用屏幕鼠标与缩放命中；已有 regions 后忽略 hover 的交互判断，避免透明 root 的转发事件造成来回穿透。隐藏/崩溃/关闭停止轮询，重新打开只启一个。
- 离线摸摸、骰子、灵感签不使用 API，不改小说；休息提醒默认关闭，仅窗口内消息。连续输入和减少动态设置抑制动作。菜单内消息使用文档流，不盖住设置。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 非 owner/pet 来源或 subframe | 拒绝 IPC |
| pet 写 context / 未知动作 / 额外字段 / 非有限数 | 拒绝，不修改状态 |
| 坏 JSON、符号链接、超大偏好文件 | 安全错误，保留原文件，不覆盖 |
| 异步读取后 owner 已销毁 | 再校验来源；不能创建孤儿窗口 |
| 配置保存排队期间 dispose | 不启动后续写入；不再应用已在途保存结果 |
| 显示器断开或位置失效 | 恢复到有效工作区；负坐标显示器不可误夹到0 |
| 完全穿透或宠物隐藏 | 主窗口顶栏找回可显示并恢复点击 |

## 5. Good / Base / Bad Cases

- Good：AI 任务上下文广播给桌宠，写作仍走原服务；返回书稿发语义导航动作。
- Base：没有正式 Q 图仍能用明确标记的 Q 版占位验证窗口/状态，不伪造 Live2D。
- Bad：将 preload 复用成完整 novelDesktop、从桌宠直接采用正文、把页面 Teleport 宣称窗口外拖动。

## 6. Tests Required

- policy/window 单测：严格字段、范围、原子保存、坏记录保护、跨屏坐标；可信 frame、sandbox、生命周期、异步竞态、缩放命中和转发事件不能反向覆盖。
- Companion Controller/偏好回归；类型检查与 desktop build。
- `LANJIAN_SMOKE_STORAGE_ONLY=1 LANJIAN_SMOKE_DESKTOP_PET_ONLY=1 node scripts/electron-smoke.mjs`：仅临时烟测书，真实 Windows 鼠标拖出主窗、菜单娱乐/形态切换、透明/完全穿透、最小化后可见、隐藏/找回、落盘及正文/标题/版本不变。报告与截图在 artifacts/ui/desktop-pet-*。
- 真实多显示器拔插尚需额外设备验收；坐标单测不是物理跨屏验收。离线提醒计时与正式角色资产不是本次全覆盖测试。

## 7. Wrong vs Correct

Wrong：`hover(false)` 总是覆盖主进程命中状态，Windows 转发到透明 root 后宠物变成无法点击。

Correct：已有精确 regions 后以 main 的屏幕位置命中为准，hover 仅作为尚无 regions 时的回退；只在 ignore 值变化时调用 setIgnoreMouseEvents。
