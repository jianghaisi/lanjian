import { validateAuthorAnswers, type AuthorAnswer, type AuthorAnswerReceipt, type AuthorAnswerSubmission, type AuthorQuestionCard } from '../../../../contracts/assistant/author-interaction-contracts'
import type { AssistantTurn } from './assistant-presentation'

// A readable conversation record, never an alternative answer/adoption receipt.
export function assistantAnswerText(question: AuthorQuestionCard, answers: AuthorAnswer[]): string {
  validateAuthorAnswers(question, answers)
  return '回答助笔的问题\n\n' + question.questions.map((item, index) => {
    const answer = answers.find(value => value.id === item.id)!
    const lines = [`${index + 1}. ${item.prompt}`]
    if (answer.skipped) lines.push('已主动跳过')
    else {
      if (answer.chosenOptionIds.length) lines.push('选择：' + item.options.filter(option => answer.chosenOptionIds.includes(option.id)).map(option => option.label).join('；'))
      if (answer.customText) lines.push((answer.chosenOptionIds.length ? '补充：\n' : '回答：\n') + answer.customText)
    }
    return lines.join('\n')
  }).join('\n\n')
}

export function recordAssistantAnswer(turns: AssistantTurn[], submission: AuthorAnswerSubmission, receipt: AuthorAnswerReceipt, content: string): void {
  if (receipt.runId !== submission.runId || receipt.questionId !== submission.questionId || receipt.answerSubmissionId !== submission.answerSubmissionId) throw new Error('回答回执与本次提交不符，请重新读取任务进度。')
  if (turns.some(turn => turn.runId === receipt.runId && turn.answerSubmissionId === receipt.answerSubmissionId)) return
  const turn: AssistantTurn = { role: 'user', content, runId: receipt.runId, answerSubmissionId: receipt.answerSubmissionId }
  // A concurrent explicit status read may have already delivered the result.
  const result = turns.findIndex(value => value.runId === receipt.runId && value.role === 'assistant')
  turns.splice(result < 0 ? turns.length : result, 0, turn)
}
