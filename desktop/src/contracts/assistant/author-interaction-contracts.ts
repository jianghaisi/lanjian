import { AppError } from '../core/app-error'
import { assertJson } from '@lanjian/writing-plugin-contracts'

export type AuthorQuestion = {
  id: string; prompt: string; detail?: string; mode: 'single' | 'multiple' | 'text'; required: boolean
  options: Array<{ id: string; label: string; description?: string; recommended?: boolean }>
}
export type AuthorActionReview = { title: string; summary: string; sections: Array<{ label: string; content: string }> }
export type AuthorQuestionRequest = { questions: AuthorQuestion[]; review?: AuthorActionReview }
export type AuthorQuestionCard = AuthorQuestionRequest & {
  id: string; version: number; toolCallId: string; pluginId: string; toolId: string
}
export type AuthorAnswer = { id: string; chosenOptionIds: string[]; customText: string; skipped: boolean }
export type AuthorAnswerSubmission = {
  runId: string; questionId: string; questionVersion: number; answerSubmissionId: string; answers: AuthorAnswer[]
}
export type AuthorAnswerReceipt = { runId: string; questionId: string; answerSubmissionId: string; acceptedAt: string }

export const interactionInvalid = (): never => { throw new AppError('VALIDATION_ERROR', '作者问题或回答格式无效，请检查后重新提交。', { recoverable: true }) }
export function interactionRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return interactionInvalid()
  return value as Record<string, unknown>
}
export function interactionText(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) return interactionInvalid()
  return value
}
export function interactionId(value: unknown): string {
  const id = interactionText(value, 200, true)
  return /^[\w.:-]+$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id) ? id : interactionInvalid()
}
export function interactionVersion(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : interactionInvalid()
}
export function interactionArray<T>(value: unknown, max: number, decode: (item: unknown) => T): T[] {
  return Array.isArray(value) && value.length <= max ? value.map(decode) : interactionInvalid()
}
export function decodeAuthorQuestionRequest(value: unknown): AuthorQuestionRequest {
  const v = interactionRecord(value, ['questions', 'review'])
  const questions = interactionArray(v.questions, 3, item => {
    const q = interactionRecord(item, ['id', 'prompt', 'detail', 'mode', 'required', 'options'])
    if (!['single', 'multiple', 'text'].includes(String(q.mode)) || typeof q.required !== 'boolean') return interactionInvalid()
    const options = interactionArray(q.options, 8, item => {
      const o = interactionRecord(item, ['id', 'label', 'description', 'recommended'])
      if (o.recommended !== undefined && typeof o.recommended !== 'boolean') return interactionInvalid()
      return { id: interactionId(o.id), label: interactionText(o.label, 120, true), ...(o.description === undefined ? {} : { description: interactionText(o.description, 500) }), ...(o.recommended === undefined ? {} : { recommended: o.recommended as boolean }) }
    })
    if (new Set(options.map(o => o.id)).size !== options.length || (q.mode === 'text' ? options.length !== 0 : options.length < 2)) return interactionInvalid()
    return { id: interactionId(q.id), prompt: interactionText(q.prompt, 1000, true), mode: q.mode as AuthorQuestion['mode'], required: q.required, options, ...(q.detail === undefined ? {} : { detail: interactionText(q.detail, 2000) }) }
  })
  if (!questions.length || new Set(questions.map(q => q.id)).size !== questions.length) return interactionInvalid()
  return { questions, ...(v.review === undefined ? {} : { review: decodeAuthorActionReview(v.review) }) }
}
export function decodeAuthorActionReview(value: unknown): AuthorActionReview {
  try { assertJson(value, 512 * 1024) } catch { return interactionInvalid() }
  const v = interactionRecord(value, ['title', 'summary', 'sections'])
  return { title: interactionText(v.title, 200, true), summary: interactionText(v.summary, 2000, true), sections: interactionArray(v.sections, 8, item => {
    const section = interactionRecord(item, ['label', 'content'])
    return { label: interactionText(section.label, 120, true), content: interactionText(section.content, 400000, true) }
  }) }
}
export function decodeAuthorQuestionCard(value: unknown): AuthorQuestionCard {
  const v = interactionRecord(value, ['questions', 'review', 'id', 'version', 'toolCallId', 'pluginId', 'toolId'])
  const request = decodeAuthorQuestionRequest({ questions: v.questions, ...(v.review === undefined ? {} : { review: v.review }) })
  if (request.review && v.pluginId !== 'builtin.plugins') return interactionInvalid()
  return { ...request, id: interactionId(v.id), version: interactionVersion(v.version), toolCallId: interactionId(v.toolCallId), pluginId: interactionId(v.pluginId), toolId: interactionId(v.toolId) }
}
export function decodeAuthorAnswerSubmission(value: unknown): AuthorAnswerSubmission {
  const v = interactionRecord(value, ['runId', 'questionId', 'questionVersion', 'answerSubmissionId', 'answers'])
  return { runId: interactionId(v.runId), questionId: interactionId(v.questionId), questionVersion: interactionVersion(v.questionVersion), answerSubmissionId: interactionId(v.answerSubmissionId), answers: decodeAuthorAnswers(v.answers) }
}
export function decodeAuthorAnswers(value: unknown): AuthorAnswer[] {
  return interactionArray(value, 3, item => {
    const a = interactionRecord(item, ['id', 'chosenOptionIds', 'customText', 'skipped'])
    if (typeof a.skipped !== 'boolean') return interactionInvalid()
    const chosenOptionIds = interactionArray(a.chosenOptionIds, 8, interactionId)
    if (new Set(chosenOptionIds).size !== chosenOptionIds.length) return interactionInvalid()
    return { id: interactionId(a.id), chosenOptionIds, customText: interactionText(a.customText, 12000), skipped: a.skipped }
  })
}
export function validateAuthorAnswers(question: AuthorQuestionRequest, answers: AuthorAnswer[]): void {
  if (answers.length !== question.questions.length || new Set(answers.map(a => a.id)).size !== answers.length) interactionInvalid()
  for (const q of question.questions) {
    const a = answers.find(a => a.id === q.id)
    if (!a || a.chosenOptionIds.some(id => !q.options.some(o => o.id === id))) interactionInvalid()
    const hasText = Boolean(a!.customText.trim()), count = a!.chosenOptionIds.length
    if (a!.skipped ? q.required || hasText || count > 0 : !hasText && !count) interactionInvalid()
    if (q.mode === 'text' && count || q.mode === 'single' && (count > 1 || count > 0 && hasText)) interactionInvalid()
  }
}
export function decodeAuthorAnswerReceipt(value: unknown): AuthorAnswerReceipt {
  const v = interactionRecord(value, ['runId', 'questionId', 'answerSubmissionId', 'acceptedAt'])
  return { runId: interactionId(v.runId), questionId: interactionId(v.questionId), answerSubmissionId: interactionId(v.answerSubmissionId), acceptedAt: interactionText(v.acceptedAt, 50, true) }
}
export const decodeAuthorAnswerArgs = (args: unknown[]): [AuthorAnswerSubmission] => args.length === 1 ? [decodeAuthorAnswerSubmission(args[0])] : interactionInvalid()
