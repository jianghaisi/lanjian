import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAuthorQuestionRequest, decodeAuthorAnswerSubmission, validateAuthorAnswers } from '../../../src/contracts/assistant/author-interaction-contracts'

const question = decodeAuthorQuestionRequest({ questions: [
  { id: 'single', prompt: '单选', mode: 'single', required: true, options: [{ id: 'a', label: '甲', recommended: true }, { id: 'b', label: '乙' }] },
  { id: 'multiple', prompt: '多选', mode: 'multiple', required: true, options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }] },
  { id: 'text', prompt: '补充', mode: 'text', required: false, options: [] }
] })
const answers = [{ id: 'single', chosenOptionIds: [], customText: '我想走第三条路', skipped: false }, { id: 'multiple', chosenOptionIds: ['a', 'b'], customText: '最后再反转', skipped: false }, { id: 'text', chosenOptionIds: [], customText: '', skipped: true }]
test('single custom replaces selection, multiple permits supplemental text, skip is explicit', () => {
  validateAuthorAnswers(question, answers)
  assert.throws(() => validateAuthorAnswers(question, [{ ...answers[0], chosenOptionIds: ['a'] }, ...answers.slice(1)]))
  assert.throws(() => validateAuthorAnswers(question, [{ ...answers[0], customText: '' }, ...answers.slice(1)]))
  assert.throws(() => validateAuthorAnswers(question, [{ ...answers[0], skipped: true, customText: '' }, ...answers.slice(1)]))
  assert.throws(() => validateAuthorAnswers(question, [answers[0], { ...answers[1], chosenOptionIds: ['forged'] }, answers[2]]))
})
test('question and answer boundaries reject excessive, duplicate and approval-shaped data', () => {
  assert.throws(() => decodeAuthorQuestionRequest({ questions: [...question.questions, question.questions[0]] }))
  assert.throws(() => decodeAuthorQuestionRequest({ questions: [question.questions[0], question.questions[0]] }))
  assert.throws(() => decodeAuthorQuestionRequest({ questions: [{ ...question.questions[0], options: [{ id: 'a', label: '<script>literal</script>' }, { id: 'a', label: '重复' }] }] }))
  const input = { runId: 'run', questionId: 'question', questionVersion: 1, answerSubmissionId: 'submission', answers }
  assert.deepEqual(decodeAuthorAnswerSubmission(input).answers, answers)
  assert.throws(() => decodeAuthorAnswerSubmission({ ...input, approvalToken: 'forged' }))
  assert.throws(() => decodeAuthorAnswerSubmission({ ...input, answers: [{ ...answers[0], customText: '字'.repeat(12001) }] }))
})
