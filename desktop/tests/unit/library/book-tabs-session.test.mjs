import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, watch } from 'vue'
import { createLibraryProjectsActions } from '../../../src/renderer/features/library/composables/create-projects-actions.js'

function fixture() {
  let generation = 0, savesAllowed = true
  const books = [{ id: 'A', path: 'A', title: '甲' }, { id: 'B', path: 'B', title: '乙' }]
  const profile = ref({ idea: '' }), saved = { A: { idea: 'A' }, B: { idea: 'B' } }
  const current = ref(null), selectedId = ref(null), opening = ref(null)
  const notices = [], openings = [], loads = []
  const ports = {
    current, selectedId, active: ref('desk'), sessionFields: { profile }, workspaceOpening: opening,
    modelSettingsDirty: ref(false), projectLibraryRefreshGeneration: 0, projectsLoaded: ref(true), projects: ref(books), continueProjectId: ref('A'),
    desktop: { projects: { switch: async () => {}, list: async () => ({ projects: books }), migrationPreview: async () => null }, modelConnections: { leaveBook: async () => {} } },
    chapters: ref([]), workspaceLoadError: ref(''), migrationPreview: ref(null), selectedVolume: ref(null), volumeOutline: ref(''), stageOutlines: ref([]), selectedStage: ref(null), stageTitle: ref(''), stageOutline: ref(''), lastSavedStageTitle: ref(''), lastSavedStageOutline: ref(''), stageDraftTitle: ref(''),
    notice: message => notices.push(message), guard: work => work(),
    workspaceRequests: { begin: book => ({ generation: ++generation, path: book.path }), invalidate: () => generation++, isCurrent: (request, book) => request.generation === generation && request.path === book?.path },
    prepareOutlineLeave: async () => true, invalidateOutlineRead() {}, worldMapWorkspace: { canLeave: () => true },
    flushPlannedChapterSave: async () => true, flushChapterSaveSafely: async () => savesAllowed,
    flushPlanningDraftSave: async () => {}, clearAutosaveTimer() {}, clearAutosaveFinalizeTimer() {},
    beginWorkspaceOpening: (book, options) => { openings.push({ path: book.path, ...options }); opening.value = { visible: false }; return 1 }, isCurrentWorkspaceOpening: () => true,
    setWorkspaceOpeningPhase() {}, finishWorkspaceOpening: () => { opening.value = null },
    resetWorkItemTransientState: () => { selectedId.value = null }, refreshWorkflow: async () => {},
    loadWorkspace: async (request, chapter) => { loads.push(request.path); profile.value = { ...saved[request.path] }; selectedId.value = chapter ?? 1; return true }
  }
  return { actions: createLibraryProjectsActions(ports), ports, books, profile, saved, notices, openings, loads, failSaves: () => { savesAllowed = false } }
}

test('changed saved data never silently discards a tab draft, even after another round trip', async () => {
  const f = fixture()
  await f.actions.activateWorkItem(f.books[0])
  f.profile.value.idea = '原标签未保存的输入'
  await f.actions.selectBookTab(f.books[1])
  f.saved.A.idea = '更新的正式资料'
  await f.actions.selectBookTab(f.books[0])
  assert.equal(f.profile.value.idea, '更新的正式资料')
  assert.equal(f.actions.bookDraftConflicts.value.length, 1)
  await f.actions.selectBookTab(f.books[1])
  await f.actions.selectBookTab(f.books[0])
  assert.equal(f.actions.bookDraftConflicts.value.length, 1)
  f.actions.resolveBookDraftConflict('profile', true)
  assert.equal(f.profile.value.idea, '原标签未保存的输入')
  assert.equal(f.saved.A.idea, '更新的正式资料')
  assert.equal(f.actions.bookDraftConflicts.value.length, 0)
  await f.actions.selectBookTab(f.books[1])
  f.saved.A.idea = '再次更新'
  await f.actions.selectBookTab(f.books[0])
  f.actions.resolveBookDraftConflict('profile', false)
  assert.equal(f.profile.value.idea, '再次更新')
  assert.equal(f.actions.bookDraftConflicts.value.length, 0)
})

test('book tabs retain independent unsaved form input and last chapter; closing a background tab preserves its draft', async () => {
  const f = fixture()
  await f.actions.activateWorkItem(f.books[0])
  f.profile.value.idea = '甲书未保存想法'; f.ports.selectedId.value = 7
  await f.actions.selectBookTab(f.books[1])
  assert.equal(f.profile.value.idea, 'B')
  f.profile.value.idea = '乙书未保存想法'
  await f.actions.selectBookTab(f.books[0])
  assert.equal(f.profile.value.idea, '甲书未保存想法')
  assert.equal(f.ports.selectedId.value, 7)
  await f.actions.closeBookTab(f.books[1])
  assert.equal(f.actions.openBookTabs.value.length, 1)
  await f.actions.selectBookTab(f.books[1])
  assert.equal(f.profile.value.idea, '乙书未保存想法')
})

test('failed manuscript save and dirty model settings both prevent switching or closing the current tab', async () => {
  const f = fixture()
  await f.actions.activateWorkItem(f.books[0])
  await f.actions.selectBookTab(f.books[1])
  f.ports.modelSettingsDirty.value = true
  await f.actions.closeBookTab(f.books[1])
  assert.equal(f.ports.current.value.path, 'B')
  assert.equal(f.actions.openBookTabs.value.length, 2)
  f.ports.modelSettingsDirty.value = false
  f.failSaves()
  await f.actions.selectBookTab(f.books[0])
  assert.equal(f.ports.current.value.path, 'B')
})

test('A-library-B-library-A skips repeat presentation, restores chapter and reads latest formal data', async () => {
  const f = fixture()
  await f.actions.openProject(f.books[0]); f.ports.selectedId.value = 7
  await f.actions.closeProject()
  await f.actions.openProject(f.books[1]); await f.actions.closeProject()
  f.saved.A.idea = '后台保存的新资料'
  await f.actions.openProject({ ...f.books[0], manuscript: { lastEditedChapter: { id: 1 } } })
  assert.deepEqual(f.openings.map(o => o.replay), [true, true, false])
  assert.deepEqual(f.loads, ['A', 'B', 'A'])
  assert.equal(f.profile.value.idea, '后台保存的新资料')
  assert.equal(f.ports.selectedId.value, 7)
  await f.actions.selectBookTab(f.books[1]); assert.equal(f.openings.at(-1).replay, false)
  await f.actions.closeBookTab(f.books[0]); await f.actions.openProject(f.books[0])
  assert.equal(f.openings.at(-1).replay, true)
})

test('failed and cancelled loads never earn warm entry; failed warm reload invalidates it', async () => {
  const f = fixture(), load = f.ports.loadWorkspace
  for (const outcome of ['throw', 'false']) {
    f.ports.loadWorkspace = async () => { if (outcome === 'throw') throw Error('read failed'); return false }
    await f.actions.openProject(f.books[0]); await f.actions.closeProject()
    f.ports.loadWorkspace = load
    await f.actions.openProject(f.books[0]); assert.equal(f.openings.at(-1).replay, true)
    await f.actions.closeProject()
  }
  f.ports.loadWorkspace = async request => { f.ports.workspaceRequests.invalidate(); return true }
  await f.actions.openProject(f.books[0]); await f.actions.closeProject()
  f.ports.loadWorkspace = load
  await f.actions.openProject(f.books[0]); assert.equal(f.openings.at(-1).replay, true)
})

test('rapid opens serialize before draft flush and same-book selection does not reload', async () => {
  const f = fixture(); let release
  f.ports.prepareOutlineLeave = () => new Promise(resolve => { release = resolve })
  const first = f.actions.openProject(f.books[0])
  await f.actions.openProject(f.books[1]); assert.equal(f.openings.length, 0)
  release(true); await first
  await f.actions.openProject(f.books[0]); assert.deepEqual(f.loads, ['A'])
})

test('explicit retry after cancellation waits for the old switch and does not race or drop the click', async () => {
  const f = fixture(), switched = []
  let release, started, openingGeneration = 0
  const inSwitch = new Promise(resolve => { started = resolve })
  f.ports.beginWorkspaceOpening = (book, options) => {
    f.openings.push({ path: book.path, ...options })
    f.ports.workspaceOpening.value = { generation: ++openingGeneration, visible: false }
    return openingGeneration
  }
  f.ports.isCurrentWorkspaceOpening = generation => f.ports.workspaceOpening.value?.generation === generation
  f.ports.desktop.projects.switch = async path => {
    switched.push(path)
    if (switched.length === 1) await new Promise(resolve => { release = resolve; started() })
  }
  const first = f.actions.openProject(f.books[0])
  await inSwitch
  f.ports.workspaceOpening.value = null
  f.ports.workspaceRequests.invalidate()
  const retry = f.actions.openProject(f.books[1])
  await f.actions.openProject(f.books[0]) // duplicate clicks cannot replace the queued intent
  assert.deepEqual(switched, ['A'])
  release(); await Promise.all([first, retry])
  assert.deepEqual(switched, ['A', 'B'])
  assert.deepEqual(f.loads, ['B'])
  assert.equal(f.ports.current.value.path, 'B')
  assert.equal(f.openings.at(-1).replay, true)
})

test('retry after a cancelled read still applies the normal unsaved-input guard', async () => {
  const f = fixture()
  let release, started
  const inRead = new Promise(resolve => { started = resolve })
  f.ports.loadWorkspace = () => new Promise(resolve => { release = resolve; started() })
  const first = f.actions.openProject(f.books[0])
  await inRead
  f.ports.workspaceOpening.value = null
  f.ports.current.value = null
  f.ports.workspaceRequests.invalidate()
  const retry = f.actions.openProject(f.books[1])
  f.ports.modelSettingsDirty.value = true
  release(true); await Promise.all([first, retry])
  assert.equal(f.ports.current.value, null)
  assert.equal(f.openings.length, 1)
  assert.equal(f.notices.length, 1)
})


test('library continue selects its target once through bootstrap; same chapter stays intact and another chapter still opens', async () => {
  const f = fixture(), selections = [], load = f.ports.loadWorkspace
  f.ports.selectActivity = async id => { f.ports.active.value = id }
  f.ports.selectChapter = async chapter => { selections.push(chapter.id); f.ports.selectedId.value = chapter.id }
  f.ports.loadWorkspace = async (request, preferred) => {
    const result = await load(request, preferred)
    f.ports.chapters.value = [{ id: 1 }, { id: 2 }]
    return result
  }
  await f.actions.openLibraryChapter(f.books[0], 2)
  assert.deepEqual(f.loads, ['A'])
  assert.equal(f.ports.selectedId.value, 2)
  assert.deepEqual(selections, [])
  f.ports.active.value = 'profile'
  await f.actions.openLibraryChapter(f.books[0], 2)
  assert.equal(f.ports.active.value, 'desk')
  assert.deepEqual(selections, [])
  await f.actions.openLibraryChapter(f.books[0], 1)
  assert.deepEqual(selections, [1])
  await f.actions.closeProject()
  await f.actions.openLibraryChapter(f.books[0], 2)
  assert.equal(f.openings.at(-1).replay, false)
  assert.equal(f.ports.selectedId.value, 2)
  assert.deepEqual(selections, [1])
  assert.deepEqual(f.loads, ['A', 'A'])
})

test('library continue does not select an old chapter after desk navigation changes books', async () => {
  const f = fixture()
  await f.actions.activateWorkItem(f.books[0])
  f.ports.chapters.value = [{ id: 1 }, { id: 2 }]
  f.ports.selectActivity = async () => { f.ports.current.value = f.books[1] }
  f.ports.selectChapter = async () => assert.fail('old book chapter selected')
  await f.actions.openLibraryChapter(f.books[0], 2)
})


test('warm activation unlocks fresh editor before scoped workflow completes; cold and failures do not defer', async () => {
  const f = fixture(), options = [], pending = [], load = f.ports.loadWorkspace
  f.ports.loadWorkspace = async (request, chapter, option) => { options.push(option); return load(request, chapter) }
  f.ports.refreshWorkflow = request => {
    assert.equal(f.ports.workspaceOpening.value, null, 'checks start after the opening lock ends')
    return new Promise((resolve, reject) => pending.push({ request, resolve, reject }))
  }
  await f.actions.openProject(f.books[0]); assert.equal(options.at(-1).deferWorkflow, false)
  assert.equal(pending.length, 0)
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  assert.equal(options.at(-1).deferWorkflow, true)
  assert.equal(f.ports.current.value.id, 'A'); assert.equal(f.ports.selectedId.value, 1)
  assert.equal(pending.length, 1)
  await f.actions.openProject(f.books[1])
  pending[0].reject(Error('obsolete A check')); await Promise.resolve()
  assert.equal(f.notices.length, 0)
  pending[1].reject(Error('current B check')); await Promise.resolve()
  assert.equal(f.notices.length, 1)
  f.ports.loadWorkspace = async () => false
  await f.actions.openProject(f.books[0]); assert.equal(pending.length, 2)
})

test('a deferred failure cannot report for a newer chapter or refresh', async () => {
  for (const change of [f => { f.ports.selectedId.value = 9 }, f => { f.ports.workspaceRefreshGeneration = 2 }]) {
    const f = fixture(); let reject
    await f.actions.openProject(f.books[0]); await f.actions.openProject(f.books[1])
    f.ports.refreshWorkflow = () => new Promise((_, no) => { reject = no })
    await f.actions.openProject(f.books[0]); change(f)
    reject(Error('old check')); await Promise.resolve()
    assert.equal(f.notices.length, 0)
  }
})


function memoryFixture() {
  const f = fixture(), cold = f.ports.loadWorkspace, pending = []
  Object.assign(f.ports, { chapterContent: ref(''), chapterTitle: ref(''), manuscriptConflict: ref(null), sqliteStorageStatus: ref(null) })
  f.ports.sessionWorkspaceFields = { chapters: f.ports.chapters, selectedId: f.ports.selectedId,
    chapterContent: f.ports.chapterContent, chapterTitle: f.ports.chapterTitle, profile: f.profile }
  f.ports.loadWorkspace = async (request, preferred) => {
    await cold(request, preferred)
    const chapter = { id: preferred ?? 1, title: request.path, content: request.path + ' prose', revision: request.path + '-r1' }
    f.ports.chapters.value = [chapter]; f.ports.lastSavedChapter = { ...chapter }
    f.ports.chapterContent.value = chapter.content; f.ports.chapterTitle.value = chapter.title
    return true
  }
  f.ports.desktop.workspace = { bootstrap: () => new Promise((resolve, reject) => pending.push({ resolve, reject, book: f.ports.current.value.id })) }
  f.ports.desktop.projects.sqliteStorageStatus = async () => ({ textAuthority: 'files-v1' })
  return { ...f, pending }
}
const memoryBootstrap = (book, content = book + ' prose') => ({
  workItem: { id: book, path: book }, chapters: [{ id: 1, title: book, content, revision: content === book + ' prose' ? book + '-r1' : book + '-r2' }],
  outlines: { volumes: [] }, issues: [], sources: { sources: [] }, events: { events: [] },
  realms: { levels: [] }, systemTemplate: { template: '' }
})
const settleMemory = () => new Promise(resolve => setImmediate(resolve))

test('memory hit restores independent book data without awaiting or repeating bootstrap; disk changes preserve typing', async () => {
  const f = memoryFixture()
  await f.actions.openProject(f.books[0]); f.profile.value.idea = 'unsaved A form'
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  assert.deepEqual(f.loads, ['A', 'B'])
  assert.equal(f.ports.chapterContent.value, 'A prose')
  assert.equal(f.profile.value.idea, 'unsaved A form')
  assert.equal(f.ports.lastSavedChapter.revision, 'A-r1')
  assert.equal(f.ports.workspaceOpening.value, null)
  f.ports.chapterContent.value = 'A prose plus new typing'
  f.pending[0].resolve(memoryBootstrap('A', 'external A prose'))
  await settleMemory()
  assert.equal(f.ports.chapterContent.value, 'A prose plus new typing')
  assert.equal(f.ports.manuscriptConflict.value.externalChapter.content, 'external A prose')
  assert.equal(f.ports.manuscriptConflict.value.expectedRevision, 'A-r1')
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  assert.deepEqual(f.loads, ['A', 'B', 'A'], 'invalidated content cannot be recaptured on leave')
})

test('late memory checks cannot touch another entry and completed local saves supersede older disk reads', async () => {
  const f = memoryFixture()
  await f.actions.openProject(f.books[0]); await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  await f.actions.openProject(f.books[1])
  f.pending[0].reject(Error('old A failure')); await settleMemory()
  assert.equal(f.notices.length, 0); assert.equal(f.ports.chapterContent.value, 'B prose')
  f.ports.lastSavedChapter = { ...f.ports.lastSavedChapter, revision: 'B-r3', content: 'saved new B' }
  f.ports.chapterContent.value = 'saved new B'
  f.pending[1].resolve(memoryBootstrap('B', 'older B read')); await settleMemory()
  assert.equal(f.ports.manuscriptConflict.value, null)
  assert.equal(f.ports.chapterContent.value, 'saved new B')
})

test('memory read failure keeps displayed text but next entry is fresh; close-tab frees content', async () => {
  const f = memoryFixture()
  await f.actions.openProject(f.books[0]); await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  f.pending[0].reject(Error('missing root')); await settleMemory()
  assert.equal(f.ports.chapterContent.value, 'A prose'); assert.equal(f.notices.length, 1)
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  assert.deepEqual(f.loads, ['A', 'B', 'A'])
  await f.actions.closeBookTab(f.books[0]); await f.actions.openProject(f.books[0])
  assert.equal(f.loads.filter(path => path === 'A').length, 3)
})


test('queued book-change resets finish before cached catalog hydration', async () => {
  const f = memoryFixture(), catalog = ref([])
  f.ports.sessionWorkspaceFields.standaloneOutlineEntries = catalog
  const stop = watch(() => f.ports.current.value?.path, () => { catalog.value = [] })
  try {
    await f.actions.openProject(f.books[0]); catalog.value = [{ chapterId: 9 }]
    await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
    assert.deepEqual(catalog.value, [{ chapterId: 9 }])
    assert.deepEqual(f.loads, ['A', 'B'])
  } finally { stop() }
})


test('only a usable same-target memory snapshot suppresses the loading presentation', async () => {
  const f = memoryFixture()
  await f.actions.openProject(f.books[0]); assert.equal(f.openings.at(-1).visible, true)
  await f.actions.openProject(f.books[1]); assert.equal(f.openings.at(-1).visible, true)
  await f.actions.openProject(f.books[0]); assert.equal(f.openings.at(-1).visible, false)
  assert.deepEqual(f.loads, ['A', 'B'])
  await f.actions.openProject(f.books[1])
  await f.actions.openProject(f.books[0], 2)
  assert.equal(f.openings.at(-1).visible, true, 'different explicit chapter requires real loading')
  assert.deepEqual(f.loads, ['A', 'B', 'A'])
  await f.actions.openProject(f.books[1])
  delete f.ports.sessionWorkspaceFields
  await f.actions.openProject(f.books[0])
  assert.equal(f.openings.at(-1).visible, true, 'warm identity alone cannot suppress loading')
})


test('resolved model warning refreshes feedback and preserves memory for the next return', async () => {
  const f = memoryFixture(), issues = ref([])
  f.ports.sessionWorkspaceFields.workspaceBootstrapIssues = issues
  await f.actions.openProject(f.books[0])
  issues.value = [{ id: 'modelSettingsUnreadable', area: 'aiSettings' }]
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  f.pending[0].resolve(memoryBootstrap('A')); await settleMemory()
  assert.deepEqual(issues.value, [])
  assert.equal(f.notices.length, 0)
  await f.actions.openProject(f.books[1]); await f.actions.openProject(f.books[0])
  assert.deepEqual(f.loads, ['A', 'B'])
  assert.equal(f.openings.at(-1).visible, false)
})
