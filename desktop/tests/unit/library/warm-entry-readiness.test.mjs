import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createManuscriptChapterCardsActions } from '../../../src/renderer/features/manuscript/composables/create-chapter-cards-actions.js'
import { createLibraryWorkflowActions } from '../../../src/renderer/features/library/composables/create-workflow-actions.js'
import { createLibraryWorkspaceLoadingActions } from '../../../src/renderer/features/library/composables/create-workspace-loading-actions.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const request = { workItemId: 'A', path: 'A' }
  const fields = {
    current: ref({ id: 'A', path: 'A' }), selectedId: ref(null), chapterSelectionGeneration: 0, workspaceRefreshGeneration: 0,
    chapterContent: ref(''), chapterTitle: ref(''), consistencyEvaluationPollTimer: 0,
    workspaceRequests: { capture: () => request, isCurrent: (r, book) => r === request && book?.path === 'A' },
    worldMapWorkspace: { canLeave: () => true, reset() {} },
    prepareOutlineLeave: async () => true, flushPlannedChapterSave: async () => true, flushChapterSaveSafely: async () => true,
    invalidateOutlineRead() {}, outlineDraftSnapshot: () => '', clearAutosaveTimer() {}, clearAutosaveFinalizeTimer() {},
    loadWritingAgentTasks: async () => {}, refreshWorkflow: async () => {},
    desktop: { chapterOutlines: { get: async () => ({ content: 'outline' }) }, chapters: { getPlanning: async () => ({}) } }
  }
  const ports = new Proxy(fields, { get(target, key) { return key in target ? target[key] : (target[key] = ref(null)) } })
  return { ports, request, chapter: { id: 1, title: 'title', content: 'text', revision: 'r1', bodyVersionId: 'v1' } }
}
test('deferred chapter selection retains fresh outline/save barriers; ordinary selection waits for failed checks', async () => {
  const { ports, request, chapter } = fixture(), outline = deferred()
  ports.desktop.chapterOutlines.get = () => outline.promise
  ports.refreshWorkflow = () => assert.fail('warm selection must not duplicate checks')
  const actions = createManuscriptChapterCardsActions(ports)
  let done = false
  const opening = actions.selectChapter(chapter, request, null, { deferWorkflow: true }).then(value => { done = true; return value })
  await Promise.resolve(); assert.equal(done, false)
  outline.resolve({ content: 'fresh outline' }); assert.equal(await opening, true)
  assert.equal(ports.chapterContent.value, 'text'); assert.equal(ports.lastSavedChapter.revision, 'r1')
  ports.flushPlannedChapterSave = async () => false
  assert.equal(await actions.selectChapter({ ...chapter, id: 2 }, request, null, { deferWorkflow: true }), false)
  ports.flushPlannedChapterSave = async () => true
  const check = deferred(), started = deferred()
  ports.refreshWorkflow = () => { started.resolve(); return check.promise }
  const cold = actions.selectChapter(chapter); await started.promise
  let finished = false; void cold.then(() => { finished = true }, () => { finished = true })
  await Promise.resolve(); assert.equal(finished, false)
  check.reject(Error('read failed')); await assert.rejects(cold, /read failed/)
})
test('pending workflow stays unknown and discards changed book/chapter/title/body/generation', async () => {
  for (const change of [null, p => { p.current.value.path = 'B' }, p => { p.selectedId.value = 2 },
    p => { p.chapterContent.value = 'typing' }, p => { p.chapterTitle.value = 'new' }, p => { p.workspaceRefreshGeneration++ }]) {
    const { ports, request } = fixture(), check = deferred()
    ports.selectedId.value = 1
    ports.desktop.workspace = { getChapterProjection: () => check.promise }
    const refresh = createLibraryWorkflowActions(ports).refreshWorkflow(request)
    assert.equal(ports.workflowStatus.value, null)
    change?.(ports)
    check.resolve({ workflow: { readyForProse: true }, planning: { totalRevision: 1 }, consistency: { items: [] } })
    await refresh; assert.equal(ports.workflowStatus.value?.readyForProse ?? false, !change)
  }
})
test('entry reset clears old findings, planning projection and AI readiness', () => {
  const { ports } = fixture()
  for (const name of ['resetPlannedChapter', 'clearPlanningPoll', 'clearPlanningSkeletonPoll', 'clearPlanningDetailPoll', 'clearPlanningDraftSave']) ports[name] = () => {}
  ports.realTrialDraftDefaults = ports.realTrialConclusionDefaults = () => ({})
  ports.outlineStorageFeedback = { reset() {} }
  ports.workflowStatus.value = { readyForProse: true }; ports.findingHistory.value = { bodyVersionId: 'old' }
  ports.outlinePlanning.value = { chapterPlacements: ['old'] }
  createLibraryWorkspaceLoadingActions(ports).resetWorkItemTransientState()
  assert.equal(ports.workflowStatus.value, null); assert.equal(ports.findingHistory.value, null)
  assert.deepEqual(ports.outlinePlanning.value.chapterPlacements, [])
})
