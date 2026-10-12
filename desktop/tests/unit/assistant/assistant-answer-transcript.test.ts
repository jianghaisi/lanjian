import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantAnswerText, recordAssistantAnswer } from '../../../src/renderer/features/assistant/services/assistant-answer-transcript'
import { assistantContext } from '../../../src/renderer/features/assistant/services/assistant-context'
import { emptyAssistantMemory, validateAssistantMemory } from '../../../src/renderer/features/assistant/services/assistant-memory'
import type { AssistantTurn } from '../../../src/renderer/features/assistant/services/assistant-presentation'
import type { AuthorAnswer, AuthorAnswerSubmission, AuthorQuestionCard } from '../../../src/contracts/assistant/author-interaction-contracts'

const question: AuthorQuestionCard = { id: 'question', version: 1, toolCallId: 'call', pluginId: 'builtin.core', toolId: 'ask', questions: [
  { id: 'tone', prompt: '怎样开始？', mode: 'single', required: true, options: [{ id: 'warm', label: '温暖', recommended: true }, { id: 'mystery', label: '悬疑' }] },
  { id: 'elements', prompt: '保留什么？', mode: 'multiple', required: true, options: [{ id: 'rain', label: '雨夜' }, { id: 'memory', label: '旧物记忆' }] },
  { id: 'note', prompt: '其他想法？', mode: 'text', required: false, options: [] }
] }
const answers = (): AuthorAnswer[] => [
  { id: 'tone', chosenOptionIds: ['mystery'], customText: '', skipped: false },
  { id: 'elements', chosenOptionIds: ['rain', 'memory'], customText: '  保留犹豫\n再让他行动。  ', skipped: false },
  { id: 'note', chosenOptionIds: [], customText: '', skipped: true }
]
const submission = (): AuthorAnswerSubmission => ({ runId: 'run', questionId: question.id, questionVersion: 1, answerSubmissionId: 'submission', answers: answers() })
const receipt = { runId: 'run', questionId: question.id, answerSubmissionId: 'submission', acceptedAt: '2026-09-30T00:00:00Z' }

test('transcript retains question order, readable choices, exact text and explicit skips', () => {
  const input = answers().reverse()
  assert.equal(assistantAnswerText(question, input), '回答助笔的问题\n\n1. 怎样开始？\n选择：悬疑\n\n2. 保留什么？\n选择：雨夜；旧物记忆\n补充：\n  保留犹豫\n再让他行动。  \n\n3. 其他想法？\n已主动跳过')
  assert.equal(input[0].id, 'note')
})

test('a free answer does not turn a recommendation into the author choice', () => {
  const input = answers(); input[0].chosenOptionIds = []; input[0].customText = '从告别开始'
  const text = assistantAnswerText(question, input)
  assert.ok(text.includes('回答：\n从告别开始')); assert.ok(!text.includes('温暖')); assert.ok(!text.includes('选择：悬疑'))
})

test('incomplete or no-longer-compatible answers cannot become a transcript', () => {
  const input = answers(); input[0].chosenOptionIds = ['removed']
  assert.throws(() => assistantAnswerText(question, input))
  input[0].chosenOptionIds = []; assert.throws(() => assistantAnswerText(question, input))
})

test('maximum-size author text remains complete locally and context explicitly excerpts it', () => {
  const input = answers(); input[1].customText = '字'.repeat(12000); input[2].customText = '尾'.repeat(12000); input[2].skipped = false
  const text = assistantAnswerText(question, input), turns: AssistantTurn[] = []
  recordAssistantAnswer(turns, submission(), receipt, text)
  assert.ok(turns[0].content.endsWith('尾'.repeat(12000))); assert.doesNotThrow(() => validateAssistantMemory({ ...emptyAssistantMemory(), turns }))
  const context = assistantContext(turns)
  assert.equal(context.excerpted, 1); assert.ok(context.history[0].content.length <= 12000)
  assert.equal(turns[0].content, text)
})

test('confirmed receipt records once before an already-arrived result, with no extra context metadata', () => {
  const text = assistantAnswerText(question, answers())
  const turns: AssistantTurn[] = [{ role: 'user', content: '讨论开篇', runId: 'run' }, { role: 'assistant', content: '继续原目标', runId: 'run' }]
  recordAssistantAnswer(turns, submission(), receipt, text); recordAssistantAnswer(turns, submission(), receipt, text)
  assert.equal(turns.length, 3); assert.equal(turns[1].content, text); assert.equal(turns[1].role, 'user')
  assert.deepEqual(assistantContext(turns).history[1], { role: 'user', content: text })
  assert.doesNotThrow(() => validateAssistantMemory({ ...emptyAssistantMemory(), turns: JSON.parse(JSON.stringify(turns)) }))
})

test('mismatched receipts never claim the answer was confirmed', () => {
  for (const key of ['runId', 'questionId', 'answerSubmissionId'] as const) {
    const turns: AssistantTurn[] = []
    assert.throws(() => recordAssistantAnswer(turns, submission(), { ...receipt, [key]: 'other' }, 'answer'), /回执/)
    assert.equal(turns.length, 0)
  }
})

test('old conversations load; malformed answer identity refuses save without deleting content', () => {
  assert.doesNotThrow(() => validateAssistantMemory({ ...emptyAssistantMemory(), turns: [{ role: 'user', content: '以前的要求' }] }))
  const turn: AssistantTurn = { role: 'user', content: '保留原字', runId: 'run', answerSubmissionId: 'submission' }
  for (const invalid of [{ role: 'assistant' }, { runId: '' }, { answerSubmissionId: '' }, { answerSubmissionId: 'x'.repeat(201) }, { answerSubmissionId: 'constructor' }, { answerSubmissionId: 3 }]) {
    assert.throws(() => validateAssistantMemory({ ...emptyAssistantMemory(), turns: [{ ...turn, ...invalid } as AssistantTurn] }), /未覆盖/)
    assert.equal(turn.content, '保留原字')
  }
})
