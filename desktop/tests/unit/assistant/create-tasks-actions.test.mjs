import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantTasksActions } from '../../../src/renderer/features/assistant/composables/create-tasks-actions.js'

test('a late A preview cannot replace the view after A to B to A navigation', async () => {
  let completePreview
  let generation = 1
  const notices = []
  const submitted = []
  const ports = {
    selectedId: { value: 7 },
    current: { value: { id: 'book-a', path: 'C:/books/a' } },
    chapterContent: { value: '' },
    manuscriptEditor: { value: null },
    manuscriptInsertionAnchor: { value: null },
    writingAgentContextPreviewRequest: 0,
    writingAgentContextPreviewBusy: { value: false },
    writingAgentContextPreview: { value: null },
    get chapterSelectionGeneration() { return generation },
    desktop: { ai: { previewWritingAgentContext(input) {
      submitted.push(input)
      return new Promise(resolve => { completePreview = resolve })
    } } },
    notice(message) { notices.push(message) }
  }
  const actions = createAssistantTasksActions(ports)
  const request = actions.previewWritingAgentContext({ message: '核对当前章' })
  assert.equal(submitted[0].expectedWorkItemId, 'book-a')
  ports.current.value = { id: 'book-b', path: 'C:/books/b' }
  generation += 1
  ports.current.value = { id: 'book-a', path: 'C:/books/a' }
  generation += 1
  completePreview({ workItemId: 'book-a', contentHash: 'old' })
  await request
  assert.equal(ports.writingAgentContextPreview.value, null)
  assert.deepEqual(notices, [])
})
