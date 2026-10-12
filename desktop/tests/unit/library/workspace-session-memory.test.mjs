import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { captureWorkspaceMemory, restoreWorkspaceMemory, compareWorkspaceMemory } from '../../../src/renderer/features/library/services/workspace-session-memory.js'

test('memory snapshots isolate nested refs and refuse another id/path', () => {
  const project = { id: 'A', path: '/A' }, fields = { chapters: ref([{ id: 1, content: 'old' }]), form: ref({ text: 'draft' }) }
  const snapshot = captureWorkspaceMemory(project, fields, { id: 1, revision: 'r1' })
  fields.chapters.value[0].content = 'new'
  assert.equal(snapshot.fields.chapters[0].content, 'old')
  assert.equal(restoreWorkspaceMemory(snapshot, { id: 'B', path: '/A' }, fields), false)
  assert.equal(fields.chapters.value[0].content, 'new')
  assert.equal(restoreWorkspaceMemory(snapshot, project, fields), true)
  fields.form.value.text = 'typing'
  assert.equal(snapshot.fields.form.text, 'draft')
})

test('disk comparison distinguishes unchanged files, external edits, deletion, and persisted form drift', () => {
  const chapter = { id: 1, title: 'one', content: 'text', revision: 'r1' }
  const fields = { chapters: ref([chapter]), selectedId: ref(1) }
  const snapshot = captureWorkspaceMemory({ id: 'A', path: '/A' }, fields, chapter, { foundation: JSON.stringify({ world: 'base' }) })
  const fresh = { workItem: { id: 'A', path: '/A' }, chapters: [chapter], outlines: { volumes: [] },
    sources: { sources: [] }, events: { events: [] }, realms: { levels: [] }, systemTemplate: { template: '' }, foundation: { world: 'base' } }
  assert.equal(compareWorkspaceMemory(snapshot, fresh).changed, false)
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, foundation: { world: 'external' } }).changed, true)
  const difference = compareWorkspaceMemory(snapshot, { ...fresh, chapters: [{ ...chapter, content: 'external', revision: 'r2' }] })
  assert.equal(difference.selectedChanged, true)
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, chapters: [] }).selected, null)
  assert.throws(() => compareWorkspaceMemory(snapshot, { ...fresh, workItem: { id: 'B', path: '/B' } }), /身份/)
  snapshot.fields.foundation = { world: 'saved here' }
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, foundation: { world: 'saved here' } }).changed, false,
    'a form saved after initial load is not an external conflict')
})

test('an empty book cannot inherit the previous book saved-chapter identity', () => {
  const memory = captureWorkspaceMemory({ id: 'empty', path: '/empty' }, { selectedId: ref(null), chapters: ref([]) },
    { id: 1, revision: 'other-book', content: 'other book text' })
  assert.equal(memory.lastSavedChapter.id, null)
  assert.equal(memory.lastSavedChapter.content, '')
})


test('resolved global-model diagnostics do not masquerade as book-file drift; new errors remain guarded', () => {
  const chapter = { id: 1, title: 'one', content: 'text', revision: 'r1' }
  const modelIssue = { id: 'modelSettingsUnreadable', area: 'aiSettings' }
  const bookIssue = { id: 'outlinePlanningUnreadable', area: 'outlinePlanning' }
  const fields = { chapters: ref([chapter]), selectedId: ref(1), workspaceBootstrapIssues: ref([modelIssue]) }
  const snapshot = captureWorkspaceMemory({ id: 'A', path: '/A' }, fields, chapter)
  const fresh = { workItem: { id: 'A', path: '/A' }, chapters: [chapter], outlines: { volumes: [] }, issues: [],
    sources: { sources: [] }, events: { events: [] }, realms: { levels: [] }, systemTemplate: { template: '' } }
  assert.equal(compareWorkspaceMemory(snapshot, fresh).changed, false)
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, issues: [modelIssue] }).changed, false)
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, chapters: [] }).changed, true)
  snapshot.fields.workspaceBootstrapIssues = []
  assert.equal(compareWorkspaceMemory(snapshot, { ...fresh, issues: [modelIssue] }).changed, true)
  snapshot.fields.workspaceBootstrapIssues = [bookIssue]
  assert.equal(compareWorkspaceMemory(snapshot, fresh).changed, true)
})
