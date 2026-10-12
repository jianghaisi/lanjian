import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantReplyChoices, reconcileAssistantReplyPair } from '../../../src/renderer/features/assistant/services/assistant-reply-comparison'
import type { AssistantTurn } from '../../../src/renderer/features/assistant/services/assistant-presentation'

const reply = (content: string, runId?: string): AssistantTurn => ({ role: 'assistant', content, runId })
const request = (content: string, runId?: string): AssistantTurn => ({ role: 'user', content, runId })

test('run requests remain correctly paired when responses arrive out of order and answers intervene', () => {
  const a = reply('A回复', 'a'), b = reply('B回复', 'b')
  const choices = assistantReplyChoices([request('原要求A', 'a'), request('原要求B', 'b'), { ...request('作者的选项答案', 'a'), answerSubmissionId: 'answer' }, a, b])
  assert.deepEqual(choices.map(item => item.request), ['原要求A', '原要求B'])
  assert.equal(choices[0]!.turn, a)
})

test('legacy requests use conversation order; missing or mismatched sources are not invented', () => {
  const choices = assistantReplyChoices([reply('无要求'), request('旧要求'), reply('旧回答'), request('不同任务', 'other'), reply('孤立回答', 'missing')])
  assert.deepEqual(choices.map(item => item.request), [null, '旧要求', null])
})

test('only complete replies enter comparison and source/reply text remains intact', () => {
  const original = '完整要求\n' + '很长的要求😀'.repeat(50), answer = '甲 😀\n乙'
  const turns: AssistantTurn[] = [request(original, 'a'), { ...reply('未完成片段', 'a'), incomplete: true }, reply(answer, 'a')]
  const before = JSON.stringify(turns), [choice] = assistantReplyChoices(turns)
  assert.equal(choice!.number, 1); assert.equal(choice!.request, original); assert.equal(choice!.turn.content, answer)
  assert.equal(choice!.characters, 3); assert.ok(choice!.label.endsWith('…')); assert.equal(JSON.stringify(turns), before)
})

test('initial pair chooses the last two complete replies; fewer than two has no pair', () => {
  const a = reply('A'), b = reply('B'), c = reply('C')
  assert.deepEqual(reconcileAssistantReplyPair(assistantReplyChoices([a, b, c]), [null, null]), [b, c])
  assert.deepEqual(reconcileAssistantReplyPair(assistantReplyChoices([a]), [a, null]), [null, null])
})

test('new output preserves a manually chosen pair, including equal-content replies', () => {
  const a = reply('相同', 'a'), b = reply('相同', 'b'), c = reply('新回复', 'c')
  assert.deepEqual(reconcileAssistantReplyPair(assistantReplyChoices([a, b, c]), [b, a]), [b, a])
})

test('replacing a missing selection preserves the other side and never duplicates it', () => {
  const a = reply('A'), b = reply('B'), c = reply('C')
  assert.deepEqual(reconcileAssistantReplyPair(assistantReplyChoices([b, c]), [a, b]), [c, b])
  assert.deepEqual(reconcileAssistantReplyPair(assistantReplyChoices([a, b]), [a, a]), [a, b])
})

test('new transcript objects cannot reuse selections from a previous scope with equal text or run IDs', () => {
  const a = reply('A', 'same'), b = reply('B', 'same'), c = reply('A', 'same'), d = reply('B', 'same')
  const result = reconcileAssistantReplyPair(assistantReplyChoices([c, d]), [a, b])
  assert.equal(result[0], c); assert.equal(result[1], d)
})
