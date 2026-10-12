import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantRunView, AssistantRunStatus } from '../../../src/contracts/assistant/assistant-run-contracts'
import type { FieldTask, FieldCandidate } from '../../../src/contracts/assistant/field-assistant-contracts'
import { assistantRunHistoryState, assistantFieldHistoryState, assistantHistoryDate, assistantHistoryText, matchesAssistantHistoryState } from '../../../src/renderer/features/assistant/services/assistant-history-presentation'

const date = '2026-10-01T03:10:00.000Z'
const run: AssistantRunView = { id: 'r', operationId: 'o', workItemId: 'book', bookTitle: '书', page: 'profile', goal: '要求', status: 'completed', revision: 1, step: 1, message: '回复', tools: [], createdAt: date, updatedAt: date, needsResume: false }
const target = { fieldId: 'definition.coreIdea', instanceId: 'i', editorSessionId: 's', workItemId: 'book', pageId: 'profile', label: '核心设想', revision: 0, value: '原稿' }
const candidate: FieldCandidate = { id: 'c', operationId: 'o', target, before: '原稿', after: '候选', dependencyFingerprint: 'f', model: 'm', connectionId: 'c', createdAt: date, status: 'candidate' }
const field: FieldTask = { id: 'f', target, status: 'completed', createdAt: date, updatedAt: date, candidate }

for (const [status, label, pending] of [
  ['running', '进行中', true], ['waiting-input', '待回答', true], ['waiting-adoption', '待处理', true],
  ['paused-limit', '已暂停', true], ['interrupted', '待恢复', true], ['completed', '已完成', false],
  ['failed', '未完成', false], ['cancelled', '已停止', false]
] as Array<[AssistantRunStatus, string, boolean]>) {
  test(`task directory preserves ${status} meaning and partitions the filters`, () => {
    const state = assistantRunHistoryState({ ...run, status })
    assert.equal(state.label, label); assert.equal(state.pending, pending)
    assert.ok(matchesAssistantHistoryState(state, 'all'))
    assert.equal(matchesAssistantHistoryState(state, 'pending'), pending)
    assert.equal(matchesAssistantHistoryState(state, 'ended'), !pending)
  })
}
test('recovery labels only affect live tasks, never completed/stopped history', () => {
  assert.equal(assistantRunHistoryState({ ...run, status: 'waiting-input', needsResume: true }).label, '待恢复')
  for (const status of ['completed', 'failed', 'cancelled'] as const) assert.equal(assistantRunHistoryState({ ...run, status, needsResume: true }).pending, false)
})
test('generation completion is still pending adoption until the candidate is handled', () => {
  const before = structuredClone(field)
  assert.deepEqual(assistantFieldHistoryState(field), { label: '待采用', pending: true, tone: 'attention' })
  for (const [status, label] of [['applied', '已回填'], ['undone', '已撤销'], ['rejected', '未采用']] as const) {
    const state = assistantFieldHistoryState({ ...field, candidate: { ...candidate, status } })
    assert.equal(state.label, label); assert.equal(state.pending, false)
    assert.notEqual(state.label, '已保存')
  }
  assert.deepEqual(field, before)
})
test('failed or stopped field generation cannot advertise an adoptable candidate', () => {
  for (const status of ['failed', 'cancelled'] as const) assert.equal(assistantFieldHistoryState({ ...field, status }).pending, false)
  assert.equal(assistantFieldHistoryState({ ...field, status: 'running' }).label, '生成中')
  assert.equal(assistantFieldHistoryState({ ...field, candidate: undefined }).pending, false)
})
test('display dates preserve an exact timestamp and remain readable for malformed old records', () => {
  const result = assistantHistoryDate(date)
  assert.equal(result.dateTime, date); assert.ok(result.short); assert.match(result.full, /2026/)
  for (const value of ['', 'invalid']) assert.deepEqual(assistantHistoryDate(value), { short: '时间未记录', full: '时间未记录' })
})

test('copying a task keeps the complete requirement, Markdown answer and both candidate versions', () => {
  const goal = '保留这一行末尾空格  \n继续推敲', answer = '# 人物动机\n\n' + '完整段落。'.repeat(6000) + '\n\n末段。'
  const snapshot = { before: '旧稿\n\n原结尾  ', after: '新稿\n\n🌱结尾  ' }
  const text = assistantHistoryText(goal, answer, snapshot)
  assert.equal(text, `原要求或修改目标\n${goal}\n\n${answer}\n\n修改前\n${snapshot.before}\n\n建议修改为\n${snapshot.after}`)
  assert.equal(assistantHistoryText(goal, answer), `原要求或修改目标\n${goal}\n\n${answer}`)
  assert.deepEqual(snapshot, { before: '旧稿\n\n原结尾  ', after: '新稿\n\n🌱结尾  ' })
})
test('copying scalar candidates preserves false, zero and an intentionally empty field', () => {
  assert.ok(assistantHistoryText('开关', '', { before: false, after: true }).endsWith('修改前\nfalse\n\n建议修改为\ntrue'))
  assert.ok(assistantHistoryText('数值', '', { before: 0, after: '' }).endsWith('修改前\n0\n\n建议修改为\n'))
})
