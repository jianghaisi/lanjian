import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'

const { createManuscriptRecoveryActions } = await import(new URL('../../../src/renderer/features/manuscript/composables/create-recovery-actions.js', import.meta.url).href)
const { createManuscriptChapterCardsActions } = await import(new URL('../../../src/renderer/features/manuscript/composables/create-chapter-cards-actions.js', import.meta.url).href)
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

function fixture() {
  const current = ref({ id: 'A', path: 'A-path' }), workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value)
  const calls: string[] = [], notices: string[] = []
  const hooks = { flush: async () => {}, idle: async () => {}, save: async () => {}, finalize: async () => {}, read: async () => ({ content: '目标章纲' }), workflow: async () => {} }
  const ports = {
    current, workspaceRequests, selectedId: ref<number | null>(1), chapterSelectionGeneration: 1,
    chapterTitle: ref('原章名'), chapterContent: ref('原正文'), lastSavedChapter: { id: 1, title: '原章名', content: '原正文', revision: 'r1', bodyVersionId: 'v1' },
    manuscriptEditor: ref({ flush: async () => { calls.push('flush'); await hooks.flush() } }),
    manuscriptSaves: { idle: async () => { calls.push('idle'); await hooks.idle() } },
    clearAutosaveTimer: () => { calls.push('clear-timer') }, clearAutosaveFinalizeTimer() {},
    activeAutosaveCheckpoint: null as { id: string } | null, pendingSaveReason: 'autosave',
    chapterIsDirty: () => ports.chapterTitle.value !== ports.lastSavedChapter.title || ports.chapterContent.value !== ports.lastSavedChapter.content,
    persistChapter: async () => { calls.push('save'); const saved = { ...ports.lastSavedChapter, title: ports.chapterTitle.value, content: ports.chapterContent.value }; await hooks.save(); ports.lastSavedChapter = saved },
    finalizeAutosaveCheckpoint: async () => { calls.push('finalize'); await hooks.finalize(); ports.activeAutosaveCheckpoint = null },
    notice: (message: string) => notices.push(message),
    worldMapWorkspace: { canLeave: () => true }, invalidateOutlineRead() {}, prepareOutlineLeave: async () => true, flushPlannedChapterSave: async () => true,
    flushChapterSaveSafely: async (): Promise<boolean> => true,
    outlineDraftSnapshot: (): string => JSON.stringify([ports.chapterOutline.value, ports.chapterTitle.value, ports.chapterContent.value]), chapterOutline: ref('原章纲'),
    desktop: { chapterOutlines: { get: async () => { calls.push('read'); return hooks.read() } }, chapters: { getPlanning: async () => null } },
    stagedRecoverySnapshot: null, showRevisions: ref(false), chapterCardAdoption: ref(null), manuscriptSelection: ref(null), manuscriptInsertionAnchor: ref(null),
    suppressManuscriptAutosave: false, saveState: ref('saved'), manuscriptSaveError: ref(null), manuscriptConflict: ref(null), lastSavedAt: ref<Date | null>(null),
    chapterPlanning: ref(null), lastSavedChapterOutline: ref('原章纲'), refreshWorkflow: () => hooks.workflow(), loadWritingAgentTasks: async () => {}
  }
  const recovery = createManuscriptRecoveryActions(ports), selection = createManuscriptChapterCardsActions(ports)
  ports.flushChapterSaveSafely = recovery.flushChapterSaveSafely
  const target = { id: 2, position: 2, title: '目标章名', content: '目标正文', revision: 'r2', bodyVersionId: 'v2' }
  return { ports, hooks, calls, notices, recovery, selection, target }
}

test('new prose typed while saving blocks leave, keeps acknowledged baseline and succeeds on explicit retry', async () => {
  const f = fixture(), gate = deferred<void>(); f.hooks.save = () => gate.promise
  f.ports.chapterContent.value = '提交稿'
  const leaving = f.recovery.flushChapterSaveSafely(); await tick()
  f.ports.chapterContent.value = '保存期间新输入'; gate.resolve()
  assert.equal(await leaving, false); assert.equal(f.ports.chapterContent.value, '保存期间新输入')
  assert.equal(f.ports.lastSavedChapter.content, '提交稿'); assert.equal(f.calls.filter(call => call === 'save').length, 1)
  assert.match(f.notices.at(-1)!, /正文.*新修改/)
  assert.equal(await f.recovery.flushChapterSaveSafely(), true); assert.equal(f.ports.lastSavedChapter.content, '保存期间新输入')
})

test('unpublished editor text at the end of saving is flushed before allowing leave', async () => {
  const f = fixture(), gate = deferred<void>(); f.hooks.save = () => gate.promise
  f.ports.chapterContent.value = '提交稿'; let buffered = ''
  f.hooks.flush = async () => { if (buffered) f.ports.chapterContent.value = buffered }
  const leaving = f.recovery.flushChapterSaveSafely(); await tick()
  buffered = '尚在编辑器缓冲的新文字'; gate.resolve()
  assert.equal(await leaving, false); assert.equal(f.ports.chapterContent.value, buffered)
  assert.equal(f.ports.lastSavedChapter.content, '提交稿')
})

test('input during checkpoint finalization blocks leave without repeating finalization', async () => {
  const f = fixture(), gate = deferred<void>(); f.ports.activeAutosaveCheckpoint = { id: 'checkpoint' }; f.hooks.finalize = () => gate.promise
  const leaving = f.recovery.flushChapterSaveSafely(); await tick()
  f.ports.chapterTitle.value = '保存期间新标题'; gate.resolve()
  assert.equal(await leaving, false); assert.equal(f.calls.filter(call => call === 'finalize').length, 1)
  assert.equal(f.ports.chapterTitle.value, '保存期间新标题')
})

for (const change of ['book', 'reopen', 'chapter', 'editor'] as const) test(`leave stops after ${change} changes while the editor is flushing`, async () => {
  const f = fixture(), gate = deferred<void>(); f.hooks.flush = () => gate.promise
  const leaving = f.recovery.flushChapterSaveSafely(); await tick()
  if (change === 'book') { f.ports.current.value = { id: 'B', path: 'B-path' }; f.ports.workspaceRequests.begin(f.ports.current.value) }
  if (change === 'reopen') f.ports.workspaceRequests.begin(f.ports.current.value)
  if (change === 'chapter') { f.ports.selectedId.value = 2; f.ports.chapterSelectionGeneration++ }
  if (change === 'editor') f.ports.manuscriptEditor.value = { flush: async () => { f.calls.push('new-editor') } }
  gate.resolve(); assert.equal(await leaving, false); assert.deepEqual(f.calls, ['flush'])
})

test('unchanged text and a real write failure retain their original leave behavior', async () => {
  const f = fixture(); assert.equal(await f.recovery.flushChapterSaveSafely(), true)
  f.ports.chapterContent.value = '未保存稿'; f.hooks.save = async () => { throw new Error('写入失败') }
  assert.equal(await f.recovery.flushChapterSaveSafely(), false); assert.equal(f.ports.lastSavedChapter.content, '原正文')
  assert.equal(f.ports.chapterContent.value, '未保存稿'); assert.equal(f.notices.at(-1), '写入失败')
})

for (const field of ['chapterTitle', 'chapterContent'] as const) test(`target read cannot replace ${field} typed while switching chapters`, async () => {
  const f = fixture(), gate = deferred<{ content: string }>(); f.hooks.read = () => gate.promise
  const switching = f.selection.selectChapter(f.target); await tick()
  f.ports[field].value = '读取期间新增'; gate.resolve({ content: '目标章纲' })
  assert.equal(await switching, false); assert.equal(f.ports.selectedId.value, 1); assert.equal(f.ports[field].value, '读取期间新增')
  assert.equal(f.ports.chapterOutline.value, '原章纲'); assert.match(f.notices.at(-1)!, /正文.*新修改/)
  assert.equal(await f.selection.selectChapter(f.target), true); assert.equal(f.ports.selectedId.value, 2)
  assert.equal(f.ports.chapterContent.value, '目标正文'); assert.equal(f.ports.chapterOutline.value, '目标章纲')
})

test('target read publishes buffered text before checking the aggregate draft snapshot', async () => {
  const f = fixture(), gate = deferred<{ content: string }>(); f.hooks.read = () => gate.promise
  const switching = f.selection.selectChapter(f.target); await tick()
  f.hooks.flush = async () => { f.ports.chapterContent.value = '未发布的输入' }
  gate.resolve({ content: '目标章纲' })
  assert.equal(await switching, false); assert.equal(f.ports.selectedId.value, 1)
  assert.equal(f.ports.chapterContent.value, '未发布的输入'); assert.equal(f.ports.chapterOutline.value, '原章纲')
  assert.match(f.notices.at(-1)!, /正文.*新修改/)
})

test('target read retains the existing guard and correct notice for changes only to an outline', async () => {
  const f = fixture(), gate = deferred<{ content: string }>(); f.hooks.read = () => gate.promise
  const switching = f.selection.selectChapter(f.target); await tick()
  f.ports.chapterOutline.value = '读取期间新章纲'; gate.resolve({ content: '目标章纲' })
  assert.equal(await switching, false); assert.equal(f.ports.selectedId.value, 1)
  assert.equal(f.ports.chapterOutline.value, '读取期间新章纲'); assert.match(f.notices.at(-1)!, /大纲.*新修改/)
})

test('an obsolete target read never flushes or modifies the newly mounted editor', async () => {
  const f = fixture(), gate = deferred<{ content: string }>(); f.hooks.read = () => gate.promise
  const switching = f.selection.selectChapter(f.target); await tick()
  f.ports.chapterSelectionGeneration++; f.ports.manuscriptEditor.value = { flush: async () => { assert.fail('stale navigation flushed the new editor') } }
  gate.resolve({ content: '目标章纲' }); assert.equal(await switching, false); assert.equal(f.ports.chapterContent.value, '原正文')
})

for (const change of ['book', 'selection', 'title', 'content'] as const) test(`post-selection check failure is obsolete after ${change} changes`, async () => {
  const f = fixture(), gate = deferred<void>()
  f.hooks.workflow = async () => { await gate.promise; throw new Error('旧检查失败') }
  const switching = f.selection.selectChapter(f.target); await tick()
  assert.equal(f.ports.selectedId.value, 2)
  if (change === 'book') f.ports.workspaceRequests.begin(f.ports.current.value)
  if (change === 'selection') f.ports.chapterSelectionGeneration++
  if (change === 'title') f.ports.chapterTitle.value = '继续改名'
  if (change === 'content') f.ports.chapterContent.value = '继续写正文'
  gate.resolve(); assert.equal(await switching, false)
  if (change === 'title') assert.equal(f.ports.chapterTitle.value, '继续改名')
  if (change === 'content') assert.equal(f.ports.chapterContent.value, '继续写正文')
  assert.deepEqual(f.notices, [])
})
