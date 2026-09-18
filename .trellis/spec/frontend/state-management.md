> V3 status: `candidate-for-v3`. Historical feature state scenarios are not active V3 contracts. Use `v3-state-authority.md`.

# State management

## Standalone outline recovery

- Reuse the snapshot store with `kind: 'planned-outline'`, a separate storage key from manuscript drafts. Identity includes the current work item and stable chapter ID; snapshots include title/content and the saved outline revision.
- Unlike the legacy manuscript reader, outline recovery fails closed on malformed JSON, invalid/duplicate entries or read errors. Preserve the original bytes, report the problem, and never silently rebuild that namespace from an empty projection.
- Pending recovery is a read-only comparison against the current formal outline. Leaving it unresolved retains the snapshot. Restoring first re-reads the formal revision; a changed baseline requires explicit confirmation. Restoration changes editor state only; formal persistence remains the existing revision-checked save path.
- A successful save clears only its exact acknowledged snapshot. New input during a save must retain a newer recovery snapshot. Discard likewise compares the exact selected snapshot, not just the chapter identity.
- Test renderer reload with actual unsaved input, a concurrently updated formal outline, visible comparison, cancel, explicit restore and explicit save. Do not describe renderer reload as proof of full-process kill/cold-start durability.
- The isolated `LANJIAN_SMOKE_PLANNED_COLD=1` smoke path additionally exits the first Electron process with an unsaved native-input snapshot and launches a new PID against the same temporary userData/project. It verifies recovery discovery plus cancel/confirm discard without formal changes. Restart only on the expected test exit code, bound the second process lifetime, and never target an author's running process. This proves that exit/cold-start path, not power-loss or OS hard-kill durability.

- Main/application storage is authoritative; renderer state is a cache/view model.
- Do not store project paths or secrets in sessionStorage/localStorage.
- Current project identity comes from the desktop client on boot.
- 所有跨 `await` 的 renderer 作品请求必须绑定会话 generation、`workItemId` 与规范路径；章级请求还必须绑定目标 chapter id/选择代次。响应返回后先复核身份，再写界面状态或执行错误回退。关闭、再次开书和作品重置必须使旧请求失效；相同 ID 的不同路径不得视为同一工作项。
- 正文恢复列表通过 `createManuscriptRecoveryRefresh` 绑定现有 `WorkspaceRequestGuard`，并单独排序同一作品内的刷新请求。过期成功/失败均不得调用列表投影，因为投影同时包含 localStorage 已归档草稿清理；不能仅在弹窗赋值前检查身份。当前请求读取 SQLite 失败仍允许本地草稿恢复，正常 conflict 快照原样交给显式恢复流程。延迟测试覆盖切书、关闭后同书重开、同 ID 不同路径、乱序回复和迟到错误。
- Feature stores/composables reload after mutations and handle external file changes.
- After a confirmed persisted operation, do not suppress its result refresh using a potentially stale cached storage-mode flag. The owning main service determines current availability; real click tests must verify candidate rendering, not only database persistence.
- Automatic planning controls use the main-projected materials workflow state, not a second `sourceNotes`-only gate. Idea save/approval/promotion refreshes this projection; an empty optional full-book note must not disable planning when approved ideas or formal settings exist.
- 同一次界面刷新若多个面板依赖同一份 main 状态，应由 main 返回带章/作品身份的强类型组合投影；renderer 不得用多个独立 IPC 拼出可能跨版本的正式状态。组合投影只用于一致读取，不成为持久化副本；昂贵正文证据仍按指纹按需加载。
- 首次开书使用 `WorkspaceBootstrapProjection` 一次取得启动视图；main 必须在聚合读取前后复核作品 ID/路径，renderer 再与当前 generation 复核。启动投影不得纳入正文证据、人物状态或事实包，也不得替代保存后的细粒度刷新。
- Manuscript editor tracks `saved`, `dirty`, `saving`, `conflict` and `error` explicitly.
- Manuscript component-local drafts are authoritative during active typing and IME composition. A parent save or navigation first awaits the component flush, then awaits the serialized main-process save queue; the visible workspace may change only after both handoffs complete. Composition interim text is never a save snapshot.
- A failed manuscript write never advances the saved baseline. Keep the component draft, parent unsaved snapshot and last successful main snapshot distinct; show a persistent retry action until the latest snapshot succeeds. Save results and failures may update the view only when `workItemId + canonical path + chapterId` still match, and a success is `saved` only when its title/content snapshot still equals the latest draft.
- Chapter, activity and work-item navigation must treat manuscript flush as a fallible gate. On failure, remain on the current chapter/workspace and preserve the editable draft; native window close answers `readyToClose(false)` until a later successful retry.
- AI jobs are keyed by jobId and follow the shared state machine; partial output is separate from the manuscript.
- AI candidates and their manuscript baselines are scoped by `workItemId + chapterId`, never by chapterId alone. Changing the active book clears all transient candidate/job state.
- Project transitions flush the old book before invoking create/import/switch because those main-process operations change the authoritative current project. Never save the old editor after that boundary has moved.
- A candidate also records the renderer's manuscript input baseline. If the author edits while the task runs, the completed candidate is stale and requires explicit review rather than silently appending to the new text.
- Use a global store only for cross-feature project/session/job state; local component state stays local.
- 独立章纲（尚无正文）必须拥有独立选中ID、草稿和保存基线，不可复用正文selectedId。目录合并按稳定章ID去重，保留无正文标识；展示或采用章纲绝不能创建正文。导航/关闭保存失败必须保留原草稿并留在编辑器，冲突重新读取须明确确认放弃未保存编辑。
- 逐章采用预览是一次性 renderer 状态，关闭、成功、切书或候选变化时清空。编辑某章候选只清该章 receipt；重生成一卷清该卷 receipts；上游设定/总纲/卷纲变化清全部下游 receipts，但不得删除正式作者文件。
- 旧稿世界观影响预览同样是一次性 renderer 状态；成功、关闭或切书即清空。候选保存后必须使用 main 返回的新 candidate，世界观采用后必须使用 main 返回的新 Foundation，禁止 renderer 拼接正式设定。
- 旧稿力量体系影响预览也是一次性 renderer 状态；成功、关闭或切书即清空。采用后使用 main 返回的新 `PowerSystemData`，不得由 renderer 合并境界表或 Foundation 开关。
- 旧稿特殊优势影响预览同样只存在于 renderer 会话；采用后使用 main 返回的新 `CheatSystemData`。renderer 不得拼接系统启用开关或固定显示模板。
- 旧稿卷纲影响预览只存在于 renderer 会话并绑定一个作者显式选择的现有卷号；成功、关闭、切书或重新选择后必须丢弃。renderer 只使用 main 返回的 candidate、planning status 和目标卷正文，不得本地拼接回执或推断卷号。
- 旧稿章纲影响预览同样只存在于 renderer 会话，并绑定稳定 chapter id；作者可见章序只用于展示。采用后使用 main 返回的 candidate/planning，当前选中章再从 main 同步已保存章纲；不得用 renderer 的候选正文拼接正式章纲。

> **Warning**: any saved baseline read by a Vue `computed` must itself be reactive (`ref`/store field). A plain `let lastSaved = ...` can change without invalidating the computed cache, leaving real save/confirm buttons incorrectly disabled even though service tests pass. Electron click smoke must cover the transition from dirty -> saved -> actionable.

## Ephemeral candidate over a persisted projection

### 1. Context

一致性总览由 main 聚合正式大纲、事件与章契，但 AI 正文候选在作者采用前只存在于 renderer 会话中。

### 2. Problem

把候选状态写入持久化总览会产生双真相；完全不展示又会让作者无法从统一视图判断候选是否可用。

### 3. Rule

renderer 可以把当前候选作为只读视觉覆盖叠加在 main 投影后，但不得把覆盖状态写回 main、作品文件或正式书稿。

### 4. State derivation

- 无候选：`deferred`。
- 审校通过且正文基线、章纲快照、章契指纹未变化：`ready`。
- 审校失败或任一基线失效：`blocked`。

### 5. Lifecycle

切书、取消、放弃或采用候选时必须清空相应 `workItemId + chapterId` 会话项；正式投影随后独立刷新。

### 6. Verification

Electron 真点击至少覆盖未生成、取消无残留、成功生成，以及成功后显示节点覆盖率；失败与失效计算由 ChapterContract 审校回归保护。

### 7. Non-goals

这一覆盖层不是人物账本、正文 revision 或检查报告持久化方案，也不能绕过作者采用确认。

## Degraded auxiliary state during workspace bootstrap

- 启动投影只能对明确列入契约的辅助数据降级；自动谋篇候选损坏时返回 `planningDraft: null` 与 `planningDraftUnreadable` issue，不能伪装成“从未生成候选”。
- 正文、正式设定、总纲/卷纲/章纲及版本账本错误不得降级为绿灯或空状态，仍须阻断对应工作区。
- renderer 只展示 main 返回的 issue。候选恢复必须经过作者确认并调用 main 的恢复事务；成功前不得提前移除提示，成功后只使用 main 返回的相对恢复路径。
- 切书或关闭作品时清空所有 bootstrap issues；迟到恢复结果仍受现有作品 generation 与 main 路径复核保护。
- 每书提示词损坏时，bootstrap 可以显示当前题材的内置基线，但必须同时保留 `promptProfileUnreadable` issue。该投影只供作者查看；AI 上下文继续读取严格路径并在恢复前失败，避免无提示地忽略作者自定义。
- 多个辅助 issue 必须独立寻址和恢复；完成谋篇候选恢复不能移除提示词警示，反之亦然。每个恢复成功后只接受 main 返回的相对路径与新投影。
- `researchSourcesUnreadable` 只锁来源资料子域：来源计数显示“待核对”，自备/采风页显示锁定态，事件页保留既有事件但禁止创建新的来源事件。不能用 bootstrap 的空投影渲染“还没有资料”。
- 来源账本损坏时，章级 workflow 可以继续投影正文与正式结构，但必须把“素材来源账本待核对”列入 AI 缺口；renderer 不再请求依赖该账本的事实包，手写与本地保存不受影响。
- `researchEventsUnreadable` 允许无关正文、总纲、来源资料与作者直接纪事继续显示；正式事件计数、素材事件页和纪事正式事件区必须显示“待核对/锁定”，不能用空投影渲染“还没有事件”。该状态还必须阻止右栏事实包与 AI 谋篇/正文再次读取不完整 canon。
- `outlinePlanningUnreadable` 允许正文和大纲原文继续显示，但 renderer 必须跳过依赖版本账本的 planning/consistency/fact-pack 刷新，并用保守工作流锁住谋篇与 AI。正文保存属于独立正式写事务，不能因谋篇版本损坏而被错误禁用。
- `characterStateUnreadable` 绝不能投影成空人物列表。renderer 跳过人物连续性与事实包读取、关闭 AI 正文并显示锁定证据；正文手写保存仍独立完成，main 的人物读取/结算/采用保持严格失败。
- `chapterOrderUnreadable` 只允许投影按稳定物理 ID 枚举的“顺序未知”正文清单。该清单不得驱动章序、章纲或 AI；renderer 必须把标题和正文设为只读并关闭所有正文/章序写动作。只有不依赖章序的总纲、卷纲等原文可以继续显示。
- bootstrap issue 的“在文件管理器中定位”只传固定 issue ID；路径选择完全由 main 根据当前作品映射并校验，renderer 不持有可写入任意路径的定位 API。
