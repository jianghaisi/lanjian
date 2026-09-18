import assert from 'node:assert/strict'
import test from 'node:test'
import type { WritingAgentTask, WritingAgentArtifactApplicationInput } from '../../../src/contracts/index'
import { workflowIpcValueDecoders } from '../../../src/contracts/core/ipc-result-contracts'
import { buildWritingAgentApplication } from '../../../src/contracts/assistant/writing-application'

const task: WritingAgentTask = {
  id: '10000000-0000-4000-8000-000000000001', workItemId: 'isolated-book', chapterId: 1,
  status: 'paused', attempt: 1, message: '改写', baseDraft: '旧句。', skill: 'rewrite',
  selection: { start: 0, end: 3, text: '旧句。' },
  partial: { id: '10000000-0000-4000-8000-000000000002', status: 'partial', content: '新句。', updatedAt: '2026-09-09T00:00:00.000Z' }
}
const input: WritingAgentArtifactApplicationInput = { taskId: task.id, title: '首章', expectedRevision: 'a'.repeat(64), formatting: { firstLineIndent: false, paragraphSpacing: false } }

test('writing IPC round trips native paused and resuming and rejects unknown status', () => {
  for (const status of ['paused', 'resuming'] as const) {
    const value = { ...task, status }
    for (const channel of ['ai:writing-agent-task', 'ai:pause-writing-agent-task', 'ai:resume-writing-agent-task']) {
      assert.equal(workflowIpcValueDecoders[channel]!(value, 'value'), value)
    }
    assert.deepEqual(workflowIpcValueDecoders['ai:list-writing-agent-tasks']!([value], 'value'), [value])
  }
  assert.throws(() => workflowIpcValueDecoders['ai:writing-agent-task']!({ ...task, status: 'silently-done' }, 'value'))
})

test('paused partial uses the explicit adoption formatter but active or readonly partial cannot be adopted', () => {
  assert.equal(buildWritingAgentApplication(task, input).content, '新句。')
  for (const status of ['resuming', 'streaming', 'running'] as const) {
    assert.throws(() => buildWritingAgentApplication({ ...task, status }, input), { code: 'CONFLICT' })
  }
  for (const skill of ['query', 'plan', 'review'] as const) {
    assert.throws(() => buildWritingAgentApplication({ ...task, skill }, input), { code: 'CONFLICT' })
  }
  assert.throws(() => buildWritingAgentApplication({ ...task, selection: { start: 0, end: 3, text: '错句。' } }, input), { code: 'CONFLICT' })
})
