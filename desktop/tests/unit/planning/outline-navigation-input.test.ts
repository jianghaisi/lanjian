import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'

const { createPlanningOutlinesActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-outlines-actions.js', import.meta.url).href)
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function fixture() {
  const current = ref({ id: 'A', path: 'A-path' }), workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value)
  const calls: string[] = [], notices: string[] = []
  const hooks = { read: async () => {}, flush: async () => {} }
  const ports = {
    current, workspaceRequests, outlineNavigationGeneration: 0, outlineLoading: ref(''), outlineOpenError: ref(''),
    retryOutlineOpen: null as null | (() => Promise<boolean>), active: ref('desk'), outlineMode: ref('total'),
    selectedId: ref(1), chapterTitle: ref('原章名'), chapterContent: ref('原正文'),
    selectedVolume: ref(1), selectedStage: ref(1), totalOutline: ref('原总纲'), volumeOutline: ref('原卷纲'),
    stageTitle: ref('原阶段名'), stageOutline: ref('原阶段纲'), chapterOutline: ref('原章纲'),
    plannedChapter: ref(null), plannedChapterTitle: ref(''), plannedChapterContent: ref(''),
    manuscriptEditor: ref({ flush: async () => { calls.push('flush'); await hooks.flush() } }),
    worldMapWorkspace: { canLeave: () => true, cancelRead() {} }, modelSettingsDirty: ref(false),
    flushPlannedChapterSave: async () => true, flushChapterSaveSafely: async () => { calls.push('save'); return true },
    outlineComposing: ref(false), busy: ref(false), planningOutlineDirty: ref(false), chapterOutlineDirty: ref(false),
    timelineMode: ref(''), editorFocusMode: ref(true), outlineStorageFeedback: { refresh: async () => { calls.push('status') } },
    notice: (message: string) => notices.push(message)
  }
  const actions = createPlanningOutlinesActions(ports)
  const open = () => actions.runOutlineNavigation('总纲', async () => {
    calls.push('read'); await hooks.read()
    return () => { calls.push('commit'); ports.totalOutline.value = '目标总纲'; ports.outlineMode.value = 'total' }
  })
  return { ports, actions, open, hooks, calls, notices }
}

for (const field of ['chapterTitle', 'chapterContent'] as const) test(`opening an outline keeps ${field} typed during reading and gives a prose notice`, async () => {
  const f = fixture(), gate = deferred(); f.hooks.read = () => gate.promise
  const opening = f.open(); await tick(); f.ports[field].value = '读期间新增'; gate.resolve()
  assert.equal(await opening, false); assert.equal(f.ports.active.value, 'desk'); assert.equal(f.ports[field].value, '读期间新增')
  assert.equal(f.ports.totalOutline.value, '原总纲'); assert.equal(f.ports.editorFocusMode.value, true)
  assert.match(f.ports.outlineOpenError.value, /正文.*新修改/); assert.equal(f.ports.outlineLoading.value, '')
  assert.equal(f.calls.includes('commit'), false)
  assert.equal(await f.ports.retryOutlineOpen!(), true); assert.equal(f.ports.active.value, 'outline')
  assert.equal(f.calls.filter(call => call === 'save').length, 2)
})

test('opening an outline publishes buffered prose before committing the target', async () => {
  const f = fixture(), gate = deferred(); f.hooks.read = () => gate.promise
  const opening = f.open(); await tick()
  f.hooks.flush = async () => { f.ports.chapterContent.value = '尚未同步的输入' }; gate.resolve()
  assert.equal(await opening, false); assert.equal(f.ports.active.value, 'desk')
  assert.equal(f.ports.chapterContent.value, '尚未同步的输入'); assert.equal(f.ports.totalOutline.value, '原总纲')
  assert.match(f.notices.at(-1)!, /正文.*新修改/)
})

for (const change of ['book', 'reopen', 'navigation', 'editor', 'chapter', 'activity'] as const) test(`an obsolete outline read cannot flush the source after ${change} changes`, async () => {
  const f = fixture(), gate = deferred(); f.hooks.read = () => gate.promise
  const opening = f.open(); await tick()
  if (change === 'book') { f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value) }
  if (change === 'reopen') f.ports.workspaceRequests.begin(f.ports.current.value)
  if (change === 'navigation') f.actions.invalidateOutlineRead()
  if (change === 'editor') f.ports.manuscriptEditor.value = { flush: async () => { assert.fail('new editor flushed by old request') } }
  if (change === 'chapter') f.ports.selectedId.value = 2
  if (change === 'activity') f.ports.active.value = 'settings'
  gate.resolve(); assert.equal(await opening, false)
  assert.equal(f.calls.includes('flush'), false); assert.equal(f.calls.includes('commit'), false); assert.deepEqual(f.notices, [])
})

test('a source changed while its editor flushes cannot receive an old outline result', async () => {
  const f = fixture(), gate = deferred(); f.hooks.flush = () => gate.promise
  const opening = f.open(); await tick(); assert.equal(f.calls.at(-1), 'flush')
  f.actions.invalidateOutlineRead(); gate.resolve()
  assert.equal(await opening, false); assert.equal(f.ports.active.value, 'desk'); assert.equal(f.calls.includes('commit'), false)
})

test('opening waits for composition flush and then keeps the newly published text', async () => {
  const f = fixture(), gate = deferred()
  f.hooks.flush = async () => { await gate.promise; f.ports.chapterContent.value = '组字完成的新输入' }
  const opening = f.open(); await tick()
  assert.equal(f.ports.active.value, 'desk'); assert.equal(f.calls.includes('commit'), false)
  gate.resolve(); assert.equal(await opening, false)
  assert.equal(f.ports.chapterContent.value, '组字完成的新输入'); assert.match(f.notices.at(-1)!, /正文.*新修改/)
})

test('a flush rejection belonging to a replaced editor does not report an error in the new editor', async () => {
  const f = fixture(), gate = deferred()
  f.hooks.flush = async () => { await gate.promise; throw new Error('旧编辑器已卸载') }
  const opening = f.open(); await tick()
  f.ports.manuscriptEditor.value = { flush: async () => {} }; gate.resolve()
  assert.equal(await opening, false); assert.deepEqual(f.notices, []); assert.equal(f.ports.outlineOpenError.value, '')
})

test('an unchanged manuscript opens the outline after flush without changing its prose', async () => {
  const f = fixture(); assert.equal(await f.open(), true)
  assert.deepEqual(f.calls, ['save', 'read', 'flush', 'commit', 'status'])
  assert.equal(f.ports.chapterContent.value, '原正文'); assert.equal(f.ports.active.value, 'outline'); assert.equal(f.ports.editorFocusMode.value, false)
})

test('outline-only input retains its original navigation protection without flushing a hidden manuscript', async () => {
  const f = fixture(), gate = deferred(); f.ports.active.value = 'outline'; f.hooks.read = () => gate.promise
  const opening = f.open(); await tick(); f.ports.totalOutline.value = '未保存总纲'; gate.resolve()
  assert.equal(await opening, false); assert.equal(f.ports.totalOutline.value, '未保存总纲')
  assert.match(f.notices.at(-1)!, /大纲.*新修改/); assert.deepEqual(f.calls, ['read'])
})

test('a normal outline-to-outline read keeps the existing explicit save boundary', async () => {
  const f = fixture(); f.ports.active.value = 'outline'
  assert.equal(await f.open(), true); assert.deepEqual(f.calls, ['read', 'commit', 'status'])
})

for (const phase of ['read', 'flush'] as const) test(`a current ${phase} failure keeps input and reports a retryable open error`, async () => {
  const f = fixture(); f.hooks[phase] = async () => { throw new Error('合成读取或输入同步失败') }
  assert.equal(await f.open(), false); assert.equal(f.ports.active.value, 'desk'); assert.equal(f.ports.chapterContent.value, '原正文')
  assert.match(f.ports.outlineOpenError.value, /合成读取或输入同步失败/); assert.equal(f.calls.includes('commit'), false)
  f.hooks[phase] = async () => {}; assert.equal(await f.ports.retryOutlineOpen!(), true)
})
