import assert from 'node:assert/strict'
import test from 'node:test'
const { createPlanningGenerationActions } = await import(new URL('../../../src/renderer/features/planning/composables/create-generation-actions.js', import.meta.url).href)

function fixture() {
  let resolve!: () => void
  const wait = new Promise<void>(done => { resolve = done })
  const notices: string[] = [], statusRequests: unknown[] = []
  const ports = {
    current: { value: { path: 'book-a' } }, workspaceRefreshGeneration: 1,
    planningDraft: { value: { id: 'proposal', text: 'candidate' } },
    selectedId: { value: 1 }, chapterOutline: { value: 'unsaved author edit' }, lastSavedChapterOutline: { value: 'old formal outline' },
    outlinePlanning: { value: { marker: 'old' } }, suppressNextPlanningDraftSave: false,
    desktop: {
      planning: { draft: async () => { await wait; return { id: 'proposal', text: 'candidate', adopted: true } } },
      outlines: { planningStatus: async (id: unknown) => { statusRequests.push(id); return { marker: 'new', chapterId: id } } },
      chapterOutlines: { get: async () => ({ content: 'new formal outline' }) }
    },
    notice: (value: string) => notices.push(value)
  }
  return { ports, notices, statusRequests, resolve, action: createPlanningGenerationActions(ports).refreshJointChapterAdoption }
}

test('joint refresh keeps unsaved author text and reports pending publication', async () => {
  const f = fixture(), pending = f.action({ proposalId: 'proposal', chapterId: 1, mirrorsPending: true, candidateReceiptPending: false })
  f.resolve(); await pending
  assert.equal(f.ports.chapterOutline.value, 'unsaved author edit')
  assert.equal(f.ports.lastSavedChapterOutline.value, 'old formal outline')
  assert.equal(f.ports.suppressNextPlanningDraftSave, true)
  assert.match(f.notices[0], /副本待同步/)
})

test('joint refresh uses the selected chapter and cannot overwrite a later selection or candidate edit', async () => {
  const f = fixture(), pending = f.action({ proposalId: 'proposal', chapterId: 2 })
  f.ports.selectedId.value = 3
  f.ports.planningDraft.value.text = 'later candidate edit'
  f.resolve(); await pending
  assert.deepEqual(f.statusRequests, [1])
  assert.equal(f.ports.outlinePlanning.value.marker, 'old')
  assert.equal(f.ports.planningDraft.value.text, 'later candidate edit')
})

test('a switched book ignores all replies from the previous joint-adoption refresh', async () => {
  const f = fixture(), pending = f.action({ proposalId: 'proposal', chapterId: 1 })
  f.ports.current.value.path = 'book-b'
  f.resolve(); await pending
  assert.equal(f.ports.suppressNextPlanningDraftSave, false)
  assert.equal(f.ports.outlinePlanning.value.marker, 'old')
  assert.deepEqual(f.notices, [])
})
