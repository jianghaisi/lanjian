import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantNavigationActions } from '../../../src/renderer/features/assistant/composables/create-navigation-actions.js'

function fixture() {
  const calls = []
  const current = { value: { id: 'book-A' } }, selectedId = { value: 1 }, activeWorkspaceLeaf = { value: { id: 'profile' } }
  const ports = {
    current, selectedId, activeWorkspaceLeaf, chapters: { value: [] }, embeddedWritingAgent: { value: null },
    desktop: { ai: { async writingAgentTask(id) { calls.push('read'); return { id, workItemId: 'book-A', chapterId: 2, status: 'succeeded' } } }, chapters: { async get(id) { return { id } } } },
    async selectWorkspaceLeaf(id) { activeWorkspaceLeaf.value.id = id },
    async selectChapter(chapter) { selectedId.value = chapter.id },
    syncWritingAgentTask(task) { calls.push('show:' + task.id) },
    pollWritingAgentTask(id) { calls.push('poll:' + id) }
  }
  return { ports, calls, action: createAssistantNavigationActions(ports) }
}
test('reviewing an existing prose task opens its real chapter and original candidate without starting a task', async () => {
  const f = fixture()
  await f.action.sendAssistantProse({ taskId: 'existing', message: '核对候选' })
  assert.equal(f.ports.selectedId.value, 2); assert.deepEqual(f.calls, ['read', 'show:existing'])
})
test('candidate review respects a refused draft navigation and a book change during lookup', async () => {
  const f = fixture()
  f.ports.selectWorkspaceLeaf = async () => {}
  await assert.rejects(f.action.sendAssistantProse({ taskId: 'existing', message: '核对候选' }), /草稿已保留/)
  assert.deepEqual(f.calls, ['read']); assert.equal(f.ports.selectedId.value, 1)
  const g = fixture(), lookup = g.ports.desktop.ai.writingAgentTask
  g.ports.desktop.ai.writingAgentTask = async id => { const result = await lookup(id); g.ports.current.value.id = 'book-B'; return result }
  await assert.rejects(g.action.sendAssistantProse({ taskId: 'existing', message: '核对候选' }), /当前作品/)
  assert.deepEqual(g.calls, ['read'])
})
