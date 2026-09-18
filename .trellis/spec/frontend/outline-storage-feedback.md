> V3 status: `candidate-for-v3`. The safety intent remains in active V3 state/data contracts; this exact UI behavior awaits V3-2/V3-4.

# 大纲保存反馈与快照基线

## 1. 范围

总纲、卷纲、阶段纲与普通章纲共用存储反馈。不改变 main 保存事务或 SQLite/Markdown 权威关系；修复未知/过期缓存误报文件模式，以及保存期间继续输入被错误计入保存基线。

## 2. 签名

`createOutlineStorageFeedback(read: () => Promise<SqliteStorageStatus>, current, requests)` 返回 `refresh/reset/record/describe`。`record(key, Pick<OutlineUpdateResult,'storageMode'|'mirrorStatus'>)` 接受既有已验证保存回执；键为 total、volume:N、stage:N、chapter:N。

## 3. 契约

- null/失败的存储状态不是 files，不能显示“已保存为 Markdown”。进入大纲主动核对，不要求先进入设置。
- 独立读取代次与 WorkspaceRequestGuard 共同防止迟到成功/失败污染另一作品或同 ID 的副本。保存回执使更早读取失效。
- 当前文档的保存回执优先。mirrorStatus 缺失时明确未知，不能借用保存之前的“全部同步”来证明新写入同步。
- 外部模式变化与回执冲突时清除旧汇总，不把一个文档的镜像结果套用到所有文档。明确重读后使用新汇总，清除旧回执警告。
- 保存前冻结内容及目标。成功只推进 result.content 基线，保留保存期间的新输入；回执不是最新草稿已提交的证明。
- 阶段纲成功后更新目录条目和对应基线，不重新打开文档来覆盖当前输入。仅标题仍等于提交值时应用 main 返回的标准化标题。

## 4. 错误与状态

| 情况 | 行为 |
| --- | --- |
| 未读取/读取失败 | 存储状态待确认；提供核对按钮 |
| 当前读取中 | 正在核对，不伪装成功 |
| files | 明确 Markdown 文件模式 |
| sqlite + synced | 已存入 SQLite，Markdown 已同步 |
| sqlite + failed/conflict/pending | 正式库已保存，镜像待处理 |
| sqlite + 未给镜像结果 | 已存入 SQLite，同步状态待确认 |
| 保存失败 | 既有 guard 重抛，不推进基线 |
| 保存期间切书/副本 | 不更新当前基线、目录和成功提示 |

## 5. 示例

Good：提交 A，继续写成 AB，回执仍是 A；基线为 A，编辑器保持 AB 且显示待保存。

Base：后台已激活 SQLite，旧界面缓存仍为 files；进入大纲后核对状态即可更新，不绕道设置。

Bad：保存结束执行 `lastSaved = draft.value`；或数据库回执缺镜像结果时套用保存前同步状态。

## 6. 验证

- `outline-storage-feedback.test.ts`：未知/失败、代次、不同文档、模式变化、缺镜像字段、显式重读与工作区失效。
- `outline-save-feedback.test.ts`：从真实 AppShell AST 提取保存函数与 guard，控制 Promise 验证提交快照、错误、选择变化和阶段纲新输入。
- 隔离原生：`LANJIAN_SMOKE_STORAGE_ONLY=1`、`LANJIAN_SMOKE_OUTLINE_STORAGE_FEEDBACK_ONLY=1`，真实编辑/保存总纲卷纲、重载回读、状态可见及正文版本不变。测试不使用先进入设置刷新缓存的捷径。

## 7. 错误与正确方式

错误：烟测在 renderer 外调用激活 SQLite，再使用退休设置选择器刷新，最后只根据文字失败认定数据库写入错误。

正确：分开验证真实存储回执与界面状态来源；新用例直接进入大纲，真实点击保存，比较正式原文、镜像状态及屏幕提示。
