import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createLibraryContinuationActions } from '../../../src/renderer/features/library/composables/create-continuation-actions.js'

function fixture() {
  let resolve, reject
  const pending = new Promise((yes, no) => { resolve = yes; reject = no })
  const a = { id: 'a', path: '/books/a' }, b = { id: 'b', path: '/books/b' }, notices = [], calls = []
  const ports = {
    current: ref(a), workspaceRequests: new WorkspaceRequestGuard(), busy: ref(false),
    continuationBlockedReason: ref(''), continuationManifestId: ref('original-manifest'), continuationAnalysis: ref(null),
    active: ref('profile'), preparationMode: ref('new'), notice: text => notices.push(text),
    guard: async action => { try { return await action() } catch (error) { notices.push(error.message); throw error } },
    desktop: { imports: { generateContinuationAnalysis: async id => { calls.push(id); return pending } } }
  }
  return { ports, notices, calls, a, b, resolve, reject, actions: createLibraryContinuationActions(ports), navigate: book => { ports.workspaceRequests.begin(book); ports.current.value = book } }
}
for (const failed of [false, true]) for (const back of [false, true]) test(`manual analysis ignores stale ${back ? 'A-B-A' : 'A-B'} ${failed ? 'error' : 'candidate'}`, async () => {
  const f = fixture(), pending = f.actions.generateContinuationAnalysis()
  f.navigate(f.b); if (back) f.navigate(f.a)
  f.ports.continuationAnalysis.value = { id: 'new-author-candidate' }; f.ports.continuationManifestId.value = 'new-manifest'; f.ports.active.value = 'research'
  failed ? f.reject(Error('OLD_ERROR')) : f.resolve({ id: 'old-candidate' }); await pending
  assert.deepEqual(f.calls, ['original-manifest']); assert.deepEqual(f.notices, [])
  assert.equal(f.ports.continuationAnalysis.value.id, 'new-author-candidate'); assert.equal(f.ports.continuationManifestId.value, 'new-manifest'); assert.equal(f.ports.active.value, 'research')
})
test('current manual analysis publishes only its captured candidate and reports current errors', async () => {
  const f = fixture(), pending = f.actions.generateContinuationAnalysis(); f.resolve({ id: 'candidate' }); await pending
  assert.equal(f.ports.continuationAnalysis.value.id, 'candidate'); assert.equal(f.ports.continuationManifestId.value, ''); assert.equal(f.ports.active.value, 'preparation'); assert.equal(f.notices.length, 1)
  const bad = fixture(), failed = bad.actions.generateContinuationAnalysis(); bad.reject(Error('CURRENT_ERROR')); await assert.rejects(failed, /CURRENT_ERROR/); assert.deepEqual(bad.notices, ['CURRENT_ERROR'])
})
