> V3 status: `candidate-for-v3`. 地图属于 V3-5；当前 schema、服务与测试不构成 V3 完成。

# 作者标注沙盘与事件投影

## 1. 范围

纪事中的二维沙盘共用已保存作者纪事、已批准资料事件和现有章节目录。地图新增数据限于布局、底图元数据及显式地标关联；不创建故事地点事实，不推断距离、地形或人物关系。

## 2. 签名

- `workspace.getWorldMap(): Promise<WorldMapView>` / IPC `workspace:get-world-map`。
- `workspace.saveWorldMap(input: WorldMapWriteInput): Promise<WorldMapLayoutView>` / IPC `workspace:save-world-map`。
- `WorldMapMarker = { location: string; x: number; y: number; sourceLocations?: string[] }`；v1 文档只有 version/markers，v2 另有 background。
- `WorldMapService(projects, authority)` 保存；`WorldMapWorkspaceService.read()` 聚合；`createWorldMapWorkspace()` 管理 renderer 请求代次；`WorldMap.vue` 管理未提交调整。

## 3. 契约

- 坐标为作者平面布局的 0–100 百分比，不是经纬度。地点名 trim 后唯一；最多 2,000 个，坐标必须有限。未定位地点不能按列表序号、地名子串或未经核对的图像文字自动落点；经作者授权、核对小说来源与具体底图后可显式保存地标关联，见下节。
- 数据库 v37 扩展 `workspace_config_documents.kind = world_map`；正式库优先，镜像是 `.webnovel/config/world-map.json`。未建立该模块时兼容读取旧 JSON；缺失返回空图但不创建文件。首次明确保存才写入正式模块。
- 写入携带当前 workItemId、expectedRevision 和完整地图；revision 绑定规范路径、作品身份、存储模式及持久化版本/hash。排队后及数据库提交前复核，不能只比较 renderer 传入的 ID。
- 地图操作队列与 SQLite 写入协调器必须不同，不能嵌套同一写入 lane。正式提交成功以 DB 回执为准，镜像失败/冲突单独报告，不把已提交操作误报为失败。
- 聚合两次完整来源快照并比较，期间与异常后检查当前作品；删除章节的关联不再可打开，但原关联仍参加变更比较。候选排除、同签名纪事去重；只使用明确事件→章节绑定。
- 时间保留故事原文；截止范围按目录 position，不按 chapterId。未绑定事件仅在全书范围显示。人物点击只匹配唯一已有姓名，无匹配/歧义不猜测身份。
- renderer 读取与保存校验作品、路径和请求代次。保存成功仅确认所提交版本，提交期间的新调整必须保留。未保存/正在保存阻止离开；作者明确保存或放弃后再导航。

## 4. 错误矩阵

| 情形 | 行为 |
| --- | --- |
| 格式、重复地点、无穷坐标或越界 | VALIDATION_ERROR，无写入 |
| 切书、版本变动、聚合来源变化 | CONFLICT，不覆盖；保留当前调整 |
| 损坏 JSON / 正式记录 | INVALID_PROJECT_STATE，保留原字节，不静默清空 |
| 正式库可读但镜像 I/O 失败 | 展示正式地图并标记 failed；PATH_ESCAPE 仍拒绝 |
| 保存失败 | 留稿与明确重试，不假称成功 |
| 外部 revision 在编辑期间改变 | 保留草稿并阻止覆盖；明确放弃后接受新版本 |

## 5. 示例

Good：作者把“旧城门”标为 `{x:25,y:60}`，保存后 JSON 与正式库一致；“雨夜”仍显示为故事时间原文。

Base：某事件没有章节绑定，展示事件和地点，但不出现虚构的“打开第 1 章”。

Bad：按列表索引造地图坐标；把同时出现当作朋友关系；按数据库 ID 判断前后章；外部 JSON 反向覆盖正式库。

## 6. 验证

- `world-map-service.test.ts`：文件兼容、正式库、镜像、旧 revision、损坏、跨作品、真实协调器组合。
- `world-map-workspace-service.test.ts`：来源、批准状态、身份和聚合一致性。
- `world-map-ipc.test.ts`：参数及两个不同响应 DTO 边界。
- `world-map-renderer.test.ts` / `world-map-component.test.ts`：请求乱序、失败留稿、提交后续编辑、外部冲突、显式放弃。
- `LANJIAN_SMOKE_STORAGE_ONLY=1` + `LANJIAN_SMOKE_WORLD_MAP_ONLY=1` 执行原生隔离验收。仅临时 profile/book；真实鼠标和键盘、保存重开、JSON 比对、章序筛选、导航、缩放截图及原文版本不变检查。

## 7. 边界与后续

当前 Beta 是“AI 生成的完整底图 + 作者坐标标注”，不是 Three.js 地形。地点实体身份融合、时间轴联动与真正的三维几何仍是后续能力。当前章节投影复用 `chapters()` 两次读取后只返回目录元数据；不能宣称长书读取已优化。既有底层服务可能惰性导入或重建缓存，不宣称全链路绝无写入，但地图不会改正文、标题和正文版本。

## Scenario: AI 小说地图底图 Beta

### 1. Scope / Trigger

- 当地图需要根据当前作品内容生成可缩放、可拖动的视觉底图时使用；状态仍为 `candidate-for-v3 Beta`。

### 2. Signatures

- `generateWorldMapImage(input): Promise<WorldMapImageCandidate>`
- `cancelWorldMapImage(operationId): Promise<{ cancelled: boolean }>`
- `adoptWorldMapImage(input): Promise<WorldMapLayoutView>`
- `getWorldMapBackground(): Promise<WorldMapBackgroundView>`
- `WorldMapDocument` 兼容 v1，并新增 v2 `{ version: 2, markers, background }`。

### 3. Contracts

- 生成请求只含 operation/workItem/revision、已保存 connection ID、model 和 `stylePreset: 'paper-atlas'`；renderer 不传 URL、密钥、prompt 或文件路径。2026-09-11 撤下旧四预设生成，输入 decoder 拒绝旧风格；文档/background decoder 仍可读取已有五种风格，打开不迁移不替换。
- prompt 由作品定义、世界观、正式事件、地点及作者已有粗略布局确定性构造；采用作者原纸雕视觉描述，替换示例地名为本书地点。建筑时代、区域规模和用途服从本书。12,000 字符预算通过删去完整末尾来源条目实现，不能截断末尾纸雕风格/负约束；来源指纹在裁剪后计算。
- 中文标签仍是 DOM，图像不能包含软件 UI、统一图钉、数字徽章、常驻橙色路线或烘焙的选中圆环。2D 图片与 markers 在同一个保持底图纵横比的变换容器内；2026-09-11 最新作者修订：可见已定位地点常驻橙色圆点与地面双椭圆，只有当前选中地点显示细光柱，选中地名牌独立突出，真实 3D 为未开放 Beta。
- 预览只保存在主进程内存 30 分钟；只有 `adopt` 将图片写到 `.webnovel/assets/world-map/<sha256>.<format>`，地图文档只保存哈希元数据。
- adapter 只接受单张 base64 PNG/JPEG/WebP；上限 12 MB、8192 边、2000 万像素。背景读取不接受 renderer path。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 作品、revision 或 prompt source 改变 | `CONFLICT`，丢弃候选，不覆盖旧底图 |
| 无正式地点/事件 | `FEATURE_UNAVAILABLE`，提示先补地点 |
| URL-only、HTTP/网络/超时 | 可恢复错误，不下载远程 URL |
| base64、magic bytes、尺寸、哈希不符 | `AI_RESPONSE_INVALID` 或 `INVALID_PROJECT_STATE` |
| 预览过期或已丢弃 | `FEATURE_UNAVAILABLE`，要求重新生成 |

### 5. Good/Base/Bad Cases

- Good：根据小说地点和事件生成纸雕底图，预览确认后采用，旧未来工业底图也仍可读取，不会被隐式替换。
- Base：无底图时继续显示克制网格，地点、事件、坐标编辑完全可用。
- Bad：预览一返回就写项目；把 prompt、密钥、绝对路径写进地图 JSON；用图片中的生成文字充当正式地点名。

### 6. Tests Required

- prompt：小说事实入参、仅纸雕新请求/五种旧文档兼容、时代/范围约束、无示例地名注入、长输入不截断美术要求、source fingerprint 稳定。
- provider：请求体、base64、URL-only 与图片边界。
- service：预览零写入、明确采用、内容哈希资产、受控背景读取、revision/source 冲突。
- renderer/IPC：迟到结果、取消、切书、窄 DTO、v1/v2 兼容；Electron 检查 1440×900 与 125% 无外层溢出。

### 7. Wrong vs Correct

#### Wrong

```ts
await writeFile(userSuppliedPath, generatedBytes) // renderer 路径 + 未确认即写入
```

#### Correct

```ts
const candidate = await generateFromCurrentNovel(input) // 内存预览
await adoptContentAddressedCandidate(candidate.candidateId, input.expectedRevision)
```

## Scenario: nonblocking reads and mutation completion

### 1. Scope / Trigger

Map read, background read, generation, cancellation, adoption and coordinate save can overlap with navigation.

### 2. Signatures

`createWorldMapWorkspace` exposes `cancelRead(): void`; `load(): Promise<void>` uses `readGeneration`, while mutations use a separate `generation`. Existing IPC signatures are unchanged.

### 3. Contracts

- `cancelRead` increments only readGeneration and clears local loading synchronously. Late views/assets cannot replace the current screen.
- Load refuses while saving/generating/adopting; mutations refuse while a map view read is loading, and invalidate any remaining background read before starting.
- `cancelGeneration` first invalidates its ticket and clears local waiting, then best-effort calls cancellation IPC. IPC failure or delay must not strand navigation. This does not promise that the provider cancels billing.
- Dirty coordinates/saving/adopting remain leave guards. Cancelling a read is not permission to discard an author draft or interrupt a formal commit.
- Generator is a native nonmodal popover; no persistent height allocation above the map. Canvas pan/zoom/center are transient and cannot save coordinates. Zoom range 50–300%; fit resets scale and position; center retains scale.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unresolved read + leave | Navigate; ignore late result |
| Load during generation/adoption | No new read; completion still clears busy state |
| Unresolved cancel IPC | Release local waiting; ignore late generation |
| Dirty/save/adopt + leave | Refuse; keep author state/commit visible |

### 5. Good/Base/Bad Cases

Good: cancel a read without invalidating a generation receipt. Base: failed map read retains prior formal data and offers retry. Bad: share one counter so a reload makes generating/adopting stay true forever.

### 6. Tests Required

Composable deferred reads/generation/cancel, save protection and stale receipts. Native Electron verifies pending-read navigation, repeated map visits, 57 events/55 locations, zoom/pan/save, reduced motion, sidebar width and canvas height ≥80% of map workspace at supported sizes. Screenshot pixels must be inspected independently of DOM geometry assertions.

### 7. Wrong vs Correct

Wrong: `await loadOldMap(); timelineMode = 'events'`. Correct: pass explicit target mode through protected navigation, cancel the old read ticket, then initialize only the new page.

## Scenario: browse / annotate and local undo

### 1. Scope / Trigger

2026-09-11 interaction refinement of the existing 2D atlas; still `candidate-for-v3 Beta`. Image artwork is not a source of formal location identities or automatically inferred coordinates.

### 2. Signatures

`WorldMap.vue` owns `setEditMode(boolean)`, `undoMarkerChange()`, `focusOnLocation(location?)` and `onMapKeydown(KeyboardEvent)`. Existing map IPC, document versions and save authority are unchanged.

### 3. Contracts

- Default browse mode selects locations, pans/zooms and opens dossiers, but cannot move markers. Placement enters annotate mode explicitly. Modes, label visibility, zoom/pan and undo history are transient; book changes reset them.
- Marker mutations still require explicit save. Undo retains at most 50 marker snapshots, preserves the background and never edits event/person/prose data. Each coordinate apply, placement, removal or key nudge is one action. A pointer drag records one snapshot only after moving more than 4 CSS pixels; cancellation restores its original marker and removes that history step.
- Save acknowledgement removes only pre-submit history; edits made after submission remain undoable to the newly saved baseline. Undo is disabled during pending/saving/active drag. History rollover adjusts the submitted boundary, not the formal revision.
- Prevent native text/image drag from stealing annotation gestures: canvas is nonselectable; accepted pointer-down prevents default, focuses the gesture owner and captures the pointer. Pointer cancellation must roll back without depending on current edit permission.
- Placement outside the actual transformed image rectangle displays a local error and creates no edge-clamped marker. A location list/event selection centers its actual transformed coordinate after the inspector's layout update; selecting an unplaced location never invents one.
- Canvas-focused arrows pan, +/- zoom, 0 fits and Home centers. Escape cancels placement, exits annotation (rolling back an active drag), or closes the dossier in that order. Ctrl/Cmd+Z undoes local annotation only; native fields, IME, open generation popover and candidate dialog keep their own keyboard behavior. Modified/IME pin arrows cannot nudge a marker.
- Label visibility controls DOM overlays only; baked text inside an adopted image cannot be hidden by this switch. An unbound-image hint explicitly explains that the bitmap alone has no interactive location identities.
- A visible nameplate, including its overflow beyond the circle's 44px target, participates in native pointer hit-testing and bubbles to the same pin action. Clicking text or the circle opens/reopens its dossier without panning or saving; Enter/Space use the same native button. Nameplates are not separate nested buttons. Decorative beams/rings remain pointer-events:none, so they cannot intercept neighboring text or canvas gestures. Hiding labels leaves the circle and its constant ground rings usable; baked raster text is not automatically an interactive hotspot.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Browse drag/arrow on a marker | No coordinate mutation or dirty state |
| Off-image placement | Inline error, no marker and no history step |
| Pointer cancel / Escape while dragging | Restore original coordinate; no phantom undo |
| Save receipt with later edits | Keep later draft/history; do not clear them |
| Outside revision conflict | Existing conflict guard applies; no undo over formal data |
| History exceeds 50 actions | Drop oldest local undo step; explicit discard still restores formal baseline |

### 5. Good/Base/Bad Cases

Good: pan a labeled image freely, explicitly bind an existing event location, undo its drag and save only when satisfied. Base: an unbound image remains a browsable illustration. Bad: infer interactive hotspots from image text or let everyday browsing silently move author coordinates.

### 6. Tests Required

Component tests cover browse guards, modifier/IME handling, one-action drag, cancellation, image bounds, post-submit history and 50-step rollover, centering and book reset. `scripts/chronicle-design-smoke.mjs [--bitmap <PNG>]` uses a fresh temporary profile/book, optionally copies a read-only raster fixture after containment checks, and exercises real mouse/keyboard input without model calls. Assert clipped canvas pixels may exceed its internal scrollWidth when panned, while outer layout must never overflow; visually inspect native screenshots, not geometry alone.

### 7. Wrong vs Correct

Wrong: push undo on every pointermove, or clear all history when a save returns. Correct: capture once when a drag becomes a movement; on the matching receipt, trim only snapshots preceding the submitted boundary.

## Scenario: explicit many-to-many landmark bindings

### 1. Scope / Trigger

2026-09-11 author-authorized binding of an approved raster to novel locations. Still `candidate-for-v3 Beta`; not a general vision/geocoding pipeline. A map association is a spatial reading aid, not an edit to canonical events or world facts.

### 2. Signatures

`WorldMapMarker.sourceLocations?: string[]`; `createWorldMapLocationIndex(markers).locationsFor(rawLocation): string[]`; `copyWorldMapMarker(marker): WorldMapMarker`. Existing read/save IPC and document versions remain unchanged; this additive marker field needs the updated application decoder. New readers accept old documents, but old strict readers need not accept new bindings.

### 3. Contracts

- Each binding stores an exact, trimmed source location field, including compound fields. The same source may occur under multiple markers. Marker names themselves also match exactly. No substring matching, splitting on punctuation, or equating a hometown/ruin/ship at sea with a similarly named visible building.
- `sourceLocations`, when present, contains 1–256 distinct nonempty strings of at most 2,000 characters; total source characters across a document ≤200,000. Unknown keys remain invalid. Returned markers/source arrays are detached.
- A single pure projection drives search, location index, selected-location events, event-place chips, external raw-location focus and chapter cutoff. Unbound raw fields remain visible; missing/changed source text does not acquire new guessed bindings. A removed marker drops only its map association; the underlying event is unchanged. Partial compound associations explicitly say “不代表全部场景” and retain “地点原文”.
- Coordinate edits, drag rollback, undo, save acknowledgement and reload copy/preserve bindings. Dirty/pending fingerprints include source arrays, not just x/y. Existing source changes can leave a saved marker with zero current events; do not silently delete it or bind new text.
- Pins have a 44 CSS-pixel circle target plus clickable nameplates and inverse terrain scale compensation; dark ink/paper labels with orange edges stay readable from 50–300%. Every visible placed pin has a persistent deep orange-red circle (#E13E20) and two small ground ellipses. Only the selected visible pin has a 104 × 3 CSS-pixel warm-core beam with a narrow orange halo (latest author revision, 2026-09-11: reduce text obstruction). No selection or hover alone means no beam; switching location removes the old beam. Dossier closing retains the existing selection. Selected nameplates use paper fill/ink text and an orange outline; aria-pressed and keyboard focus remain independent. Label visibility never removes dots/rings or changes selection. No entry animation, continuous pulse, permanent route or baked selected state; reduced-motion preference disables other transitions and animations.
- Native text observers must not mutate ancestor reactive state during capture before descendant v-model/IME listeners commit text. AppShell companion quiet-state input/composition listeners use bubbling; map dossier opening observes committed query, not raw composing input. Native Chinese input and IME commit must retain the string and filter bound aliases.
- The one-book operational command defaults to read-only preflight. Explicit commit requires current canonical root/book UUID, exact approved image hash, previously reviewed timeline hash, synchronized mirror, empty preexisting marker set, identical full preflight snapshot and unchanged service source hashes. Normal `WorldMapService`/SQLite authority perform CAS and mirror writes. No raw SQL writes, runtime schema upgrade/downgrade or author-book tests. Save the previous map and formal receipt before final audit. A retry after successful binding refuses duplicate adoption.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid/empty/duplicate/oversized bindings, extra keys | `VALIDATION_ERROR`; no write |
| Similar name or new compound text without exact binding | Preserve unbound raw location; no guessed marker |
| One compound source linked to two landmarks | Both dossiers include that event once; one event detail retains original text |
| Chapter cutoff excludes the source event | Its projected pins are hidden unless another in-scope event justifies them |
| Author book/schema/source/image/mirror/runtime changed before commit | Stop the one-off command; preserve original data, inspect before any retry |
| Formal commit succeeds but a later protected-data audit detects concurrent work | Retain receipt and report audit failure; never undo or overwrite concurrent author work |

### 5. Good/Base/Bad Cases

Good: a reviewed “学舍、桥边住处与电车” source links to two observed buildings while transport remains in the event's original text. Base: “某外地车站” stays unbound. Bad: map every “李家老家” event onto present-day 李家, or use the current novel's nine coordinates as new-book defaults.

### 6. Tests Required

- `world-map-locations.test.ts`: exact many-to-many lookup, unbound/ambiguous preservation, legacy/additive roundtrip and all field limits.
- `world-map-component.test.ts`: bound-name search, source-based focus, cross-place event chips, cutoff, detached edits/undo/save, source immutability.
- `world-map-service.test.ts`: source arrays roundtrip through both file and SQLite authority/mirrors; CAS, conflicts and post-submit protection still apply. Migration test targets current exported schema, not a stale hard-coded final number.
- `chronicle-design-smoke.mjs` plus `world-map-landmark-smoke.mjs`: only fresh temporary books/profile, synthetic multi-place events on the read-only bitmap fixture, nine hit targets, constant-size zoom, native select/chips/search/edit-save, untouched synthetic timeline, 1440/1100/125% and dark theme. Inspect screenshot pixels.

### 7. Wrong vs Correct

Wrong: `event.location.includes(marker.location)` and `{ location, x, y }` reconstruction that drops binding metadata. Correct: exact reviewed `sourceLocations` projection; copy the full marker and replace only its coordinates.
