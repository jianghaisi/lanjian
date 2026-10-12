import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'

const { createPlanningOutlinesActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-outlines-actions.js', import.meta.url).href)
const { createPlanningChapterOutlineActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-chapter-outline-actions.js', import.meta.url).href)
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function identity() {
  const current = ref({ id: 'A', path: 'A-path' }), workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value)
  return { current, workspaceRequests }
}

for (const kind of ['stage', 'chapter'] as const) test(`${kind}: confirmed review save needs no second document read and preserves later input`, async () => {
  const scope = identity(), gate = deferred<void>(), calls: string[] = []
  const stage = { stage: 1, volume: 1, title: '旧标题', content: '原稿', chapterIds: [3], mirrorStatus: 'synced' }
  const ports = {
    ...scope, busy: ref(false), chapterOrderIssue: ref(''), selectedStage: ref(1), selectedId: ref(3),
    stageTitle: ref('新标题'), stageOutline: ref('提交稿'), stageOutlines: ref([stage]),
    lastSavedStageTitle: ref('旧标题'), lastSavedStageOutline: ref('原稿'), chapterOutline: ref('提交稿'), lastSavedChapterOutline: ref('原稿'),
    guard: async (operation: () => Promise<unknown>) => operation(), notice() {}, refreshWorkflow: async () => {},
    outlineStorageFeedback: { record: () => assert.fail('review results do not contain storage receipts'), refresh: async () => { calls.push('storage-read') } },
    outlineEditor: ref({ saveReviewedDraft: async () => { calls.push('review-save'); await gate.promise; return { snapshot: { title: '主进程标题', content: '主进程确认稿' } } } }),
    desktop: { outlines: { list: async () => { calls.push('document-read'); throw new Error('保存后文档读取中断') } }, chapterOutlines: { get: async () => { calls.push('document-read'); throw new Error('保存后文档读取中断') } } }
  }
  const actions = createPlanningOutlinesActions(ports)
  const saving = kind === 'stage' ? actions.saveStageOutline() : actions.saveChapterOutline()
  ports.stageTitle.value = '保存后新标题'; ports.stageOutline.value = '保存后新输入'; ports.chapterOutline.value = '保存后新输入'
  ports.stageOutlines.value = [{ ...stage, volume: 2, chapterIds: [4] }]
  gate.resolve(); await saving
  assert.deepEqual(calls, ['review-save', 'storage-read'])
  assert.equal(kind === 'stage' ? ports.lastSavedStageOutline.value : ports.lastSavedChapterOutline.value, '主进程确认稿')
  assert.equal(ports.stageOutline.value, '保存后新输入'); assert.equal(ports.chapterOutline.value, '保存后新输入'); assert.equal(ports.stageTitle.value, '保存后新标题')
  if (kind === 'stage') { assert.equal(ports.lastSavedStageTitle.value, '主进程标题'); assert.deepEqual(ports.stageOutlines.value[0].chapterIds, [4]); assert.equal(ports.stageOutlines.value[0].volume, 2); assert.equal(ports.stageOutlines.value[0].mirrorStatus, undefined) }
})

function plannedFixture() {
  const scope = identity(), writes: Array<{ expectedRevision: string }> = [], calls: string[] = []
  const old = { chapterId: 900, title: '旧章名', content: '原稿', revision: 'r1', volume: 1, stage: 2, hasManuscript: false, mirrorStatus: 'synced' }
  const latest = { ...old, title: '新章名', content: '提交稿', revision: 'r2' }
  const hooks = { save: async () => ({ snapshot: { title: latest.title, content: latest.content, revision: latest.revision } }), read: async () => latest }
  const plannedChapter = ref({ ...old }), plannedChapterTitle = ref(latest.title), plannedChapterContent = ref(latest.content)
  const dirty = computed(() => plannedChapterTitle.value !== plannedChapter.value.title || plannedChapterContent.value !== plannedChapter.value.content)
  const ports = {
    ...scope, plannedChapter, plannedChapterTitle, plannedChapterContent, plannedChapterDirty: dirty,
    plannedChapterGeneration: 1, plannedChapterBusy: ref(false), plannedChapterComposing: ref(false), plannedChapterStarting: ref(false),
    plannedChapterError: ref(''), plannedOutlineRecovery: ref(null), plannedOutlineRecoveryError: ref(''),
    standaloneOutlineEntries: ref([{ ...old }]), worldMapWorkspace: { canLeave: () => true }, notice() {},
    plannedOutlineRecoveryStore: { read: () => ({ id: 'recovery' }), clearIfSnapshotMatches: () => { calls.push('clear-recovery') } },
    outlineEditor: ref({ saveReviewedDraft: async (input: { expectedRevision: string }) => { writes.push(input); return hooks.save() } }),
    desktop: { outlines: {
      getPlannedChapter: async () => { calls.push('read'); return hooks.read() },
      updatePlannedChapter: async () => assert.fail('a confirmed review save must not issue a normal save')
    } }
  }
  return { ports, writes, calls, old, latest, hooks, actions: createPlanningChapterOutlineActions(ports) }
}

test('standalone review save advances its confirmed revision even if metadata read fails; retry only reads and keeps new typing', async () => {
  const f = plannedFixture(); f.hooks.read = async () => { throw new Error('文档信息暂不可读') }
  assert.equal(await f.actions.flushPlannedChapterSave(), true); await tick()
  assert.equal(f.ports.plannedChapterError.value, ''); assert.equal(f.ports.plannedChapterDirty.value, false)
  assert.equal(f.ports.plannedChapter.value.revision, 'r2'); assert.equal(f.ports.plannedChapter.value.content, '提交稿')
  assert.equal(f.ports.plannedChapter.value.mirrorStatus, undefined); assert.equal(f.calls.filter(call => call === 'clear-recovery').length, 1)
  f.ports.plannedChapterContent.value = '保存后继续写'; f.ports.plannedChapterTitle.value = '保存后改名'
  f.hooks.read = async () => f.latest; await f.actions.reloadPlannedChapter(true)
  assert.equal(f.ports.plannedChapter.value.mirrorStatus, 'synced'); assert.equal(f.ports.standaloneOutlineEntries.value[0].revision, 'r2')
  assert.equal(f.ports.plannedChapterContent.value, '保存后继续写'); assert.equal(f.ports.plannedChapterTitle.value, '保存后改名')
  assert.equal(f.writes.length, 1); assert.equal(f.calls.filter(call => call === 'read').length, 2)
})

test('unconfirmed standalone review save keeps original baseline, recovery and input', async () => {
  const f = plannedFixture(); f.hooks.save = async () => { throw new Error('正式写入失败') }
  assert.equal(await f.actions.flushPlannedChapterSave(), false)
  assert.equal(f.ports.plannedChapter.value.revision, 'r1'); assert.equal(f.ports.plannedChapterContent.value, '提交稿')
  assert.match(f.ports.plannedChapterError.value, /正式写入失败/); assert.deepEqual(f.calls, [])
})

test('standalone save keeps newer input dirty while advancing only acknowledged content and revision', async () => {
  const f = plannedFixture(), gate = deferred<Awaited<ReturnType<typeof f.hooks.save>>>()
  f.hooks.save = () => gate.promise
  const saving = f.actions.flushPlannedChapterSave()
  f.ports.plannedChapterContent.value = '后来正文'; f.ports.plannedChapterTitle.value = '后来标题'
  gate.resolve({ snapshot: { title: '确认标题', content: '确认稿', revision: 'r2' } })
  assert.equal(await saving, false); await tick()
  assert.equal(f.ports.plannedChapter.value.content, '确认稿'); assert.equal(f.ports.plannedChapter.value.title, '确认标题')
  assert.equal(f.ports.plannedChapterContent.value, '后来正文'); assert.equal(f.ports.plannedChapterTitle.value, '后来标题')
  assert.equal(f.ports.plannedChapterDirty.value, true); assert.equal(f.ports.plannedChapterError.value, '')
})

for (const change of ['book', 'document', 'revision'] as const) test(`slow metadata cannot block standalone save or replace a changed ${change}`, async () => {
  const f = plannedFixture(), gate = deferred<typeof f.latest>(); f.hooks.read = () => gate.promise
  assert.equal(await f.actions.flushPlannedChapterSave(), true)
  assert.equal(f.ports.plannedChapterBusy.value, false)
  if (change === 'book') { f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value) }
  if (change === 'document') { f.ports.plannedChapterGeneration++; f.ports.plannedChapter.value = { ...f.old, chapterId: 901 } }
  if (change === 'revision') f.ports.plannedChapter.value = { ...f.old, revision: 'r3' }
  const before = f.ports.plannedChapter.value
  gate.resolve(f.latest); await tick()
  assert.equal(f.ports.plannedChapter.value, before)
})

test('metadata from a newer formal version cannot silently change the confirmed standalone baseline', async () => {
  const f = plannedFixture(); f.hooks.read = async () => ({ ...f.latest, title: '外部标题', content: '外部稿', revision: 'external' })
  assert.equal(await f.actions.flushPlannedChapterSave(), true); await tick()
  assert.equal(f.ports.plannedChapter.value.revision, 'r2'); assert.equal(f.ports.plannedChapter.value.content, '提交稿')
  assert.equal(f.ports.plannedChapter.value.mirrorStatus, undefined)
})

test('next standalone review save uses the acknowledged revision despite unavailable metadata', async () => {
  const f = plannedFixture(); f.hooks.read = async () => { throw new Error('读取失败') }
  assert.equal(await f.actions.flushPlannedChapterSave(), true); await tick()
  f.ports.plannedChapterContent.value = '第二稿'
  f.hooks.save = async () => ({ snapshot: { title: '新章名', content: '第二稿', revision: 'r3' } })
  assert.equal(await f.actions.flushPlannedChapterSave(), true); await tick()
  assert.deepEqual(f.writes.map(input => input.expectedRevision), ['r1', 'r2'])
  assert.equal(f.ports.plannedChapter.value.revision, 'r3'); assert.equal(f.ports.plannedChapterDirty.value, false)
})

for (const change of ['book', 'document'] as const) test(`standalone save acknowledgement after ${change} change cannot clear another draft or recovery`, async () => {
  const f = plannedFixture(), gate = deferred<Awaited<ReturnType<typeof f.hooks.save>>>()
  f.hooks.save = () => gate.promise
  const saving = f.actions.flushPlannedChapterSave()
  if (change === 'book') { f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value) }
  else f.ports.plannedChapterGeneration++
  f.ports.plannedChapter.value = { ...f.old, chapterId: 901, content: '另一文档' }; f.ports.plannedChapterContent.value = '另一文档输入'
  gate.resolve({ snapshot: { title: '新章名', content: '提交稿', revision: 'r2' } })
  assert.equal(await saving, false); assert.equal(f.ports.plannedChapter.value.chapterId, 901)
  assert.equal(f.ports.plannedChapterContent.value, '另一文档输入'); assert.deepEqual(f.calls, [])
  assert.equal(f.ports.plannedChapterBusy.value, true)
})

test('a newer metadata retry wins without allowing an older same-version result to change its status', async () => {
  const f = plannedFixture(), older = deferred<typeof f.latest>(), newer = deferred<typeof f.latest>()
  f.hooks.read = () => older.promise
  assert.equal(await f.actions.flushPlannedChapterSave(), true)
  f.hooks.read = () => newer.promise
  const retry = f.actions.reloadPlannedChapter(true)
  newer.resolve(f.latest); await retry
  older.resolve({ ...f.latest, mirrorStatus: 'conflict' }); await tick()
  assert.equal(f.ports.plannedChapter.value.mirrorStatus, 'synced'); assert.equal(f.writes.length, 1)
})
