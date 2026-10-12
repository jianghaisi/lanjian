import { decodeAuthorAnswers, interactionId, interactionRecord, interactionVersion, validateAuthorAnswers, type AuthorAnswer, type AuthorQuestionCard } from '../../../../contracts/assistant/author-interaction-contracts'

export type AuthorQuestionDraft = { runId: string; questionId: string; questionVersion: number; answers: AuthorAnswer[] }

export function decodeAuthorQuestionDraft(value: unknown): AuthorQuestionDraft | null {
  if (value === undefined || value === null) return null
  const v = interactionRecord(value, ['runId', 'questionId', 'questionVersion', 'answers'])
  const answers = decodeAuthorAnswers(v.answers)
  if (new Set(answers.map(answer => answer.id)).size !== answers.length) throw new Error('回答草稿格式异常，已有记录未覆盖。')
  return { runId: interactionId(v.runId), questionId: interactionId(v.questionId), questionVersion: interactionVersion(v.questionVersion), answers }
}

export function restoreAuthorQuestionDraft(runId: string | undefined, question: AuthorQuestionCard, draft?: AuthorQuestionDraft | null): AuthorAnswer[] | null {
  if (!runId || !draft || draft.runId !== runId || draft.questionId !== question.id || draft.questionVersion !== question.version) return null
  const answers = decodeAuthorAnswers(draft.answers)
  if (answers.length !== question.questions.length || new Set(answers.map(a => a.id)).size !== answers.length) return null
  for (const q of question.questions) {
    const a = answers.find(answer => answer.id === q.id)
    if (!a || a.chosenOptionIds.some(id => !q.options.some(option => option.id === id)) || q.mode === 'text' && a.chosenOptionIds.length || q.mode === 'single' && (a.chosenOptionIds.length > 1 || a.chosenOptionIds.length && a.customText.trim()) || a.skipped && (q.required || a.chosenOptionIds.length || a.customText.trim())) return null
  }
  return answers
}

export function authorAnswerProgress(question: AuthorQuestionCard, answers: AuthorAnswer[]) {
  let answered = 0, skipped = 0
  for (const q of question.questions) {
    const a = answers.find(answer => answer.id === q.id)
    try {
      const decoded = decodeAuthorAnswers(a ? [a] : [])
      validateAuthorAnswers({ questions: [q] }, decoded)
      if (a!.skipped) skipped++; else answered++
    } catch { /* An unfinished draft is valid local input, not a submitted answer. */ }
  }
  return { answered, skipped, total: question.questions.length, ready: answered + skipped === question.questions.length }
}
