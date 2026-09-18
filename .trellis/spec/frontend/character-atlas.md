> V3 status: `candidate-for-v3`. 人物档案属于 V3-5；当前组件、DTO 与测试不构成 V3 完成。

# 人物状态档案与来源章导航

## 1. 范围

纪事的“人物卡 / 状态轨迹”共用一次 `CharacterLinesView` 读取与当前目录。这是已批准/已采用人物状态的展示，不是新建第二份人物事实、静态身份库或地图坐标。

## 2. 签名

- `projectCharacterAtlas(lines, throughPosition: number | null, validChapterIds?: ReadonlySet<number>): CharacterAtlasCard[]`
- `characterStateDetails(point: CharacterLinePoint | null): { label: string; value: string }[]`
- `createChapterOpenNavigation<T>().open(id, callbacks): Promise<boolean>`；可 `invalidate()`。
- 沿用 `workspace.getCharacterLines()`，无新增 IPC、数据库字段或模型调用。

## 3. 契约

- null 明确表示全书；其他值按显示章序 `point.chapterPosition <= cutoff`，不是按稳定 chapterId 比较。
- 先去掉目录中不存在的章、范围外的点，再计算姓名/地点/计数/最近点。姓名取范围内最后点，不能从全书 line.name 泄露未来别名。
- 左侧人物列表与卡片使用同一截至范围。组件姓名/历史地点筛选会清空不可见详情，但作者显式点外侧另一个范围内人物时应清除冲突筛选并展示该人。
- appearanceCount 仅统计 `present=true` 的不同章节；承接状态不能当作一次出场。字段原文、source、sourceId、lastEventId、throughChapter 不改写。
- 来源身份是事实/人物状态事件，不是纪事 ID；没有时间戳或地理坐标时不造值。标注“截至章的已批准记录”，不宣称已重新核对当前正文。
- AppShell 人物读取绑定 WorkspaceRequestGuard、当前 ID/路径及独立刷新代次；reset 失效旧成功与错误。读取失败显示错误/重试，不宣称零人物。

## 4. 错误矩阵

| 条件 | 行为 |
| --- | --- |
| 非有限/负截止值、无过去点 | 空投影，不回退全书 |
| 当前作品读取失败或返回错误作品 ID | 明确错误与重试，清掉旧可选详情 |
| 切书/重开/被新读取取代 | 迟到成功/失败都忽略 |
| 无来源章 | 不显示可打开按钮，不重建章节 |
| 导航保存失败 | 不读/不选来源章，保留原稿 |
| A 先点慢返回，B 后点先返回 | B 获胜；A 不再 select/reveal 或弹迟到错误 |

## 5. 实例

Good：稳定 ID 90 的第 1 章在 ID 3 的第 2 章之前，截止第 1 章仍应只显示前者的地点。

Base：没有地点字段显示“地点未记录”；初始身份/肖像不在该投影中，不用假数据补满卡片。

Bad：搜索 A 后点左侧 B，watch 又清空 B；或按全书姓名/地点生成筛选后才截章。

## 6. 验证

- `character-atlas.test.ts`：稳定章序、删除章、同章顺序、未来姓名与地点、出场计数、来源字段、不修改输入。
- `chapter-open-navigation.test.ts`：乱序、直接切章、关闭/重开、保存失败、迟到异常及自身选择导致的代次变化。
- 原生隔离：`LANJIAN_SMOKE_STORAGE_ONLY=1` + `LANJIAN_SMOKE_CHARACTER_ATLAS_ONLY=1`。由已验证临时书的 main 服务保存原文、创建事实候选并批准，不能注入 renderer 假状态。原生搜索、外侧选择、截至章、地点选择、打开原文、卡片/轨迹、紧凑和缩放；比较正文/版本不变并查看截图。
- 加载组件仍可能在退场：等待其实际卸载、inert 解除与按钮真命中，不移除保护层。Windows 原生 select 键盘驱动必须确认焦点/实际 value，不能写 DOM value 假装真实选择。

## 7. 错误与正确做法

错误：章节读取完成后才建立导航代次，旧请求会覆盖新点击。

正确：`createChapterOpenNavigation` 从调用开始排序意图，每段 await 后校验；`selectChapter` 在首次保存等待前捕获作品与递增选择代次，再校验后提交界面。包装器不替代被调用函数内部的等待保护。

现有 getCharacterLines 底层可重建派生快照缓存；不能把“展示不修改正文/正式事实”宣传成整个底层绝无写入。
