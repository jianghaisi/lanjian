import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createLibraryImportsActions } from '../../../src/renderer/features/library/composables/create-imports-actions.js'
import { createLibraryContinuationActions } from '../../../src/renderer/features/library/composables/create-continuation-actions.js'

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const a = { id: 'a', path: '/books/a' }, b = { id: 'b', path: '/books/b' }
const result = { ownership: 'owned', importedChapterIds: [1] }
function fixture() {
  const gate = deferred(), entered = deferred(), calls = [], notices = []
  const ports = {
    current: ref(a), workspaceRequests: new WorkspaceRequestGuard(), txtCanImport: ref(true),
    txtImport: ref({ ownership: 'owned', creationMethod: 'human', destination: 'current', title: '临时正文', selectedChapterIndexes: [0] }),
    txtPreview: ref({ token: 'token-a' }), importManifest: ref(null), manifestRoles: ref({}), manifestChapterSelections: ref({}),
    txtMaterialPreview: ref(null), importCreatedProject: ref(null), showTxtImport: ref(true), active: ref('desk'),
    continuationAnalysis: ref(null), continuationManifestId: ref(''), preparationMode: ref(''), recoveryBusyId: ref(''),
    guard: async action => { try { return await action() } catch (error) { notices.push(error.message); throw error } },
    notice: text => notices.push(text), refreshProjects: async () => calls.push('refresh'),
    loadWorkspace: async request => { calls.push(['load', request.path]); return true },
    desktop: { imports: {
      commitText: async input => { calls.push(['commit', input]); entered.resolve(); return gate.promise },
      resumeManifest: async (...args) => { calls.push(['resume', ...args]); entered.resolve(); return gate.promise },
      generateContinuationAnalysis: async () => { calls.push('analysis'); return {} }
    } }
  }
  const navigate = book => { ports.workspaceRequests.begin(book); ports.current.value = book }
  return { ports, gate, entered, calls, notices, navigate, actions: createLibraryImportsActions(ports) }
}
for (const failed of [false, true]) test(`A-B-A ignores stale import ${failed ? 'failure' : 'success'}`, async () => {
  const f = fixture(), pending = f.actions.commitTxtImport()
  await f.entered.promise
  f.navigate(b); f.navigate(a)
  f.ports.txtPreview.value = { token: 'new-author-form' }; f.ports.active.value = 'research'
  failed ? f.gate.reject(new Error('旧操作失败')) : f.gate.resolve(result)
  await pending
  assert.equal(f.calls.length, 1); assert.deepEqual(f.notices, [])
  assert.equal(f.ports.txtPreview.value.token, 'new-author-form')
  assert.equal(f.ports.showTxtImport.value, true); assert.equal(f.ports.active.value, 'research')
})
test('repeated clicks submit once, snapshot the selection, and current success reloads only its captured book', async () => {
  const f = fixture(), pending = f.actions.commitTxtImport()
  await f.entered.promise
  f.ports.txtImport.value.selectedChapterIndexes.push(3)
  await f.actions.commitTxtImport(); f.gate.resolve(result); await pending
  assert.equal(f.calls.filter(call => call[0] === 'commit').length, 1)
  assert.equal(f.calls[0][1].expectedWorkItemId, a.path)
  assert.deepEqual(f.calls[0][1].selectedChapterIndexes, [0])
  assert.deepEqual(f.calls.at(-1), ['load', a.path]); assert.equal(f.notices.length, 1)
  assert.equal(f.ports.showTxtImport.value, false)
})
test('delayed manifest recovery neither reloads nor clears another book recovery state', async () => {
  const f = fixture(), actions = createLibraryContinuationActions(f.ports)
  const pending = actions.resumeImportManifest({ id: 'manifest-a', canResume: true })
  await f.entered.promise; f.navigate(b); f.ports.recoveryBusyId.value = 'manifest-b'
  f.gate.resolve({ results: [result] }); await pending
  assert.deepEqual(f.calls, [['resume', 'manifest-a', a.path]])
  assert.equal(f.ports.recoveryBusyId.value, 'manifest-b'); assert.deepEqual(f.notices, [])
})
test('new-book import can intentionally transition and use the new captured destination', async () => {
  const f = fixture()
  f.ports.current.value = null
  f.ports.txtImport.value.destination = 'new'
  f.ports.importModelsPreview = ref({ token: 'models' }); f.ports.partialImportCreation = ref(null)
  f.ports.prepareWorkItemTransition = async () => true
  f.ports.desktop.modelConnections = { createProject: async () => ({ status: 'complete', project: b }) }
  f.ports.activateWorkItem = async book => { f.navigate(book); return true }
  const pending = f.actions.commitTxtImport(); await f.entered.promise
  f.gate.resolve(result); await pending
  assert.equal(f.calls[0][1].expectedWorkItemId, b.path)
  assert.equal(f.ports.showTxtImport.value, false)
})

test('new-book activation cannot recapture a newer B-A-B navigation generation', async () => {
  const f = fixture(), activation = deferred(), entered = deferred()
  f.ports.txtImport.value.destination = 'new'; f.ports.importCreatedProject.value = b
  f.ports.activateWorkItem = async book => { f.navigate(book); entered.resolve(); await activation.promise }
  const pending = f.actions.commitTxtImport(); await entered.promise
  f.navigate(a); f.navigate(b); activation.resolve(); await pending
  assert.deepEqual(f.calls, []); assert.deepEqual(f.notices, [])
  assert.equal(f.ports.showTxtImport.value, true)
})
