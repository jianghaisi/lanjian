import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createAppNavigationActions } from '../../../src/renderer/app/composables/create-navigation-actions.js'
import { firstSettingsSection } from '../../../src/renderer/app/services/settings-navigation.ts'

globalThis.document = { querySelector: () => null }
globalThis.HTMLElement = class {}

function fixture(activity = 'desk') {
  const book = { id: 'A', path: 'A' }, notices = [], calls = []
  const ports = {
    desktop: { app: { platform: 'win32' } },
    current: ref(book), workspaceRequests: new WorkspaceRequestGuard(), active: ref(activity),
    selectedId: ref('chapter-7'), outlineMode: ref('plannedChapter'), plannedChapter: ref({ chapterId: 'plan-4' }),
    modelSettingsDirty: ref(false), editorFocusMode: ref(false), settingsSection: ref('connection'),
    autoBackupLoading: ref(false), autoBackupSettingsLoadGeneration: 0, autoBackupRefreshGeneration: 0,
    prepareOutlineLeave: async () => { calls.push('outline'); return true },
    flushPlannedChapterSave: async () => { calls.push('planned'); return true },
    flushChapterSaveSafely: async () => { calls.push('prose'); return true },
    worldMapWorkspace: { canLeave: () => true }, invalidateOutlineRead() {},
    outlineStorageFeedback: { refresh: async () => {} }, refreshStandaloneOutlineCatalog: async () => {},
    notice: value => notices.push(value)
  }
  ports.workspaceRequests.begin(book)
  return { ports, calls, notices, actions: createAppNavigationActions(ports) }
}

test('library model return obeys dirty guard and returns to the retained settings host', () => {
  const f = fixture()
  f.ports.current.value = null
  f.ports.libraryModelsOpen = ref(true)
  let closed = 0, opened = 0, prevented = 0
  f.ports.libraryModelsDialog = ref({ close() { closed++ } })
  f.ports.localAppearanceDialog = ref({ showModal() { opened++ } })
  f.ports.modelSettingsDirty.value = true
  f.actions.closeLibraryModels({ preventDefault() { prevented++ } }, true)
  assert.equal(prevented, 1); assert.equal(opened, 0); assert.equal(closed, 0)
  assert.equal(f.ports.libraryModelsOpen.value, true)
  f.ports.modelSettingsDirty.value = false
  f.actions.closeLibraryModels(undefined, true)
  assert.equal(closed, 1); assert.equal(opened, 1)
  assert.equal(f.ports.libraryModelsOpen.value, false)
})

test('AI entry begins with shared API; settings return preserves original chapter or outline', async () => {
  assert.equal(firstSettingsSection('ai'), 'connection')
  for (const origin of ['desk', 'outline']) {
    const f = fixture(origin)
    await f.actions.selectActivity('settings')
    await f.actions.selectSettingsSection('routing')
    assert.match(f.actions.modelReturnLabel.value, origin === 'desk' ? /正文/ : /大纲/)
    await f.actions.returnFromModelSettings()
    assert.equal(f.ports.active.value, origin)
    assert.equal(f.ports.selectedId.value, 'chapter-7')
    assert.equal(f.ports.plannedChapter.value.chapterId, 'plan-4')
    assert.equal(f.ports.outlineMode.value, 'plannedChapter')
    assert.ok(f.calls.includes('planned'))
  }
})

test('failed manuscript flush blocks opening settings; dirty models block return and retain intent', async () => {
  const f = fixture()
  f.ports.flushChapterSaveSafely = async () => false
  await f.actions.selectActivity('settings')
  assert.equal(f.ports.active.value, 'desk')
  f.ports.flushChapterSaveSafely = async () => true
  await f.actions.selectActivity('settings')
  f.ports.modelSettingsDirty.value = true
  await f.actions.returnFromModelSettings()
  assert.equal(f.ports.active.value, 'settings')
  assert.match(f.notices.at(-1), /未保存/)
  f.ports.modelSettingsDirty.value = false
  await f.actions.returnFromModelSettings()
  assert.equal(f.ports.active.value, 'desk')
})

test('A to B to A expires the old origin, even when the book identity matches again', async () => {
  const f = fixture('outline'), book = f.ports.current.value
  await f.actions.selectActivity('settings')
  f.ports.workspaceRequests.invalidate()
  f.ports.current.value = { id: 'B', path: 'B' }
  f.ports.workspaceRequests.begin(book)
  f.ports.current.value = book
  assert.equal(f.actions.modelReturnLabel.value, '返回书稿')
  await f.actions.returnFromModelSettings()
  assert.equal(f.ports.active.value, 'desk')
})

test('a book switch during a pending return cannot change the new book view', async () => {
  const f = fixture('outline')
  await f.actions.selectActivity('settings')
  let finish
  f.ports.flushPlannedChapterSave = () => new Promise(resolve => { finish = resolve })
  const returning = f.actions.returnFromModelSettings()
  await Promise.resolve()
  f.ports.workspaceRequests.invalidate()
  f.ports.current.value = { id: 'B', path: 'B' }
  f.ports.active.value = 'profile'
  finish(true)
  await returning
  assert.equal(f.ports.active.value, 'profile')
})

test('formal story materials can return to their settings-hosted view with dirty protection', async () => {
  const f = fixture('settings')
  f.ports.settingsSection.value = 'story'
  f.ports.loadStoryEntities = async () => {}
  await f.actions.selectSettingsSection('connection')
  assert.equal(f.actions.modelReturnLabel.value, '返回正式资料')
  f.ports.modelSettingsDirty.value = true
  await f.actions.returnFromModelSettings()
  assert.equal(f.ports.settingsSection.value, 'connection')
  f.ports.modelSettingsDirty.value = false
  await f.actions.returnFromModelSettings()
  assert.equal(f.ports.settingsSection.value, 'story')
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function modelFixture() {
  const f = fixture(), pending = []
  f.ports.ai = ref({ shared: { model: 'original' }, connections: [] })
  f.ports.oneOffGlobalConnections = ref([])
  f.ports.desktop = { ...f.ports.desktop, modelConnections: { list: async () => ({ connections: [] }) }, ai: { getSettings: () => { const d = deferred(); pending.push(d); return d.promise } } }
  return { ...f, pending }
}
const projection = model => ({ shared: { model }, connections: [] })

test('latest confirmed model refresh wins when same-book reads finish in reverse order', async () => {
  const f = modelFixture()
  const older = f.actions.refreshModelAssignments()
  await new Promise(setImmediate)
  const newer = f.actions.refreshModelAssignments()
  await new Promise(setImmediate)
  assert.equal(f.pending.length, 2)
  f.pending[1].resolve(projection('new-writer')); await newer
  f.pending[0].resolve(projection('old-writer')); await older
  assert.equal(f.ports.ai.value.shared.model, 'new-writer')
})

test('book identity is captured before the shared API read, including A to B to A', async () => {
  const f = modelFixture(), catalog = deferred(), original = f.ports.current.value
  f.ports.desktop.modelConnections.list = () => catalog.promise
  const pending = f.actions.refreshModelAssignments()
  f.ports.current.value = { id: 'B', path: 'B' }; f.ports.workspaceRequests.begin(f.ports.current.value)
  f.ports.current.value = original; f.ports.workspaceRequests.begin(original)
  f.ports.ai.value = projection('reopened-A')
  catalog.resolve({ connections: [{ id: 'old-catalog' }] }); await pending
  assert.equal(f.pending.length, 0, 'an obsolete refresh must not start a new-book settings read')
  assert.equal(f.ports.ai.value.shared.model, 'reopened-A')
  assert.deepEqual(f.ports.oneOffGlobalConnections.value, [])
})

test('a late refresh error cannot overwrite newer feedback or notify a different book', async () => {
  const f = modelFixture(), older = f.actions.refreshModelAssignments()
  await new Promise(setImmediate)
  const newer = f.actions.refreshModelAssignments()
  await new Promise(setImmediate)
  f.pending[1].resolve(projection('new-writer')); await newer
  f.pending[0].reject(Error('obsolete failure')); await older
  assert.deepEqual(f.notices, [])
  const switching = f.actions.refreshModelAssignments()
  await new Promise(setImmediate)
  f.ports.current.value = { id: 'B', path: 'B' }; f.ports.workspaceRequests.begin(f.ports.current.value)
  f.pending[2].reject(Error('failure for A')); await switching
  assert.deepEqual(f.notices, [])
})

test('an older failed API refresh cannot clear the newer list, and a library refresh never reads book settings', async () => {
  const f = modelFixture(), first = deferred(), second = deferred()
  let calls = 0
  f.ports.desktop.modelConnections.list = () => (++calls === 1 ? first.promise : second.promise)
  const older = f.actions.refreshOneOffConnections(), newer = f.actions.refreshOneOffConnections()
  second.resolve({ connections: [{ id: 'new-api' }] }); await newer
  first.reject(Error('old-list-failure')); await older
  assert.deepEqual(f.ports.oneOffGlobalConnections.value, [{ id: 'new-api' }])
  f.ports.current.value = null; f.ports.workspaceRequests.invalidate()
  await f.actions.refreshModelAssignments()
  assert.equal(f.pending.length, 0)
  assert.deepEqual(f.ports.oneOffGlobalConnections.value, [{ id: 'new-api' }])
})
