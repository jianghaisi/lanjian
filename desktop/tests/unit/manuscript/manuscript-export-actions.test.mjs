import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createLibraryStorageActions } from '../../../src/renderer/features/library/composables/create-storage-actions.js'

function fixture() {
  const current = ref({ id: 'a', path: 'book-a' }), workspaceRequests = new WorkspaceRequestGuard()
  workspaceRequests.begin(current.value)
  const events = [], notices = []
  const result = { chapterCount: 2, characterCount: 35 }
  const ports = { current, workspaceRequests, flushChapterSave: async () => { events.push('save') },
    guard: operation => operation(), notice: text => notices.push(text),
    desktop: { projects: { exportManuscript: async input => { events.push(input || 'whole-book'); return result } } } }
  return { ports, events, notices, result, actions: createLibraryStorageActions(ports), selection: { workItemId: 'a', workItemPath: 'book-a', chapterIds: [3, 1] } }
}

test('selection waits for the editor save and sends a copied book-bound selection', async () => {
  const f = fixture()
  assert.equal(await f.actions.exportSelectedChapters(f.selection), f.result)
  assert.equal(f.events[0], 'save')
  assert.deepEqual(f.events[1], f.selection)
  assert.notEqual(f.events[1].chapterIds, f.selection.chapterIds)
  assert.match(f.notices[0], /2 章.*35/)
})

test('a failed save cannot start export or show success; legacy whole-book export still waits for save', async () => {
  const f = fixture()
  f.ports.flushChapterSave = async () => { throw Error('保存失败') }
  await assert.rejects(f.actions.exportSelectedChapters(f.selection), /保存失败/)
  assert.deepEqual(f.events, []); assert.deepEqual(f.notices, [])
  f.ports.flushChapterSave = async () => { f.events.push('save') }
  await f.actions.exportManuscript()
  assert.deepEqual(f.events, ['save', 'whole-book'])
})

test('switching A to B to A during save invalidates the export and foreign selection is rejected before saving', async () => {
  const f = fixture()
  await assert.rejects(f.actions.exportSelectedChapters({ ...f.selection, workItemId: 'b' }), /作品已切换/)
  assert.deepEqual(f.events, [])
  f.ports.flushChapterSave = async () => { f.ports.workspaceRequests.invalidate(); f.ports.workspaceRequests.begin(f.ports.current.value) }
  await assert.rejects(f.actions.exportSelectedChapters(f.selection), /保存期间作品已切换/)
  assert.deepEqual(f.events, []); assert.deepEqual(f.notices, [])
})

test('cancelled export stays quiet and an old completed request never reports success in the next book', async () => {
  const f = fixture()
  f.ports.desktop.projects.exportManuscript = async () => null
  assert.equal(await f.actions.exportSelectedChapters(f.selection), null)
  assert.deepEqual(f.notices, [])
  f.ports.desktop.projects.exportManuscript = async () => {
    f.ports.current.value = { id: 'b', path: 'book-b' }; f.ports.workspaceRequests.begin(f.ports.current.value)
    return f.result
  }
  await f.actions.exportSelectedChapters(f.selection)
  assert.deepEqual(f.notices, [])
})
