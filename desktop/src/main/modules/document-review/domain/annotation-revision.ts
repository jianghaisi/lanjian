import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { DocumentAnnotation } from '../../../../contracts/document-review/annotations'
import type { DocumentSnapshot } from '../../../../contracts/document-review/types'
import type { AnnotationRevisionStart } from '../../../../contracts/document-review/generation'
import type { ContextCompileResult } from '../../assistant/domain/context-compiler'
import type { AuthorQuestionCard, AuthorAnswer } from '../../../../contracts/assistant/author-interaction-contracts'
import { boundedString, exactRecord, invalid } from '../../../../contracts/core/validation'
import { decodeAuthorQuestionRequest } from '../../../../contracts/assistant/author-interaction-contracts'
import type { CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
export const annotationRevisionType = 'annotation_revision'
export const revisionHash = (text: string) => createHash('sha256').update(text).digest('hex')
export function revisionConflict(message: string): never { throw new AppError('CONFLICT', message, { recoverable: true }) }
export type AnnotationRevisionCheckpoint = {
  version: 1; request: AnnotationRevisionStart; annotations: DocumentAnnotation[]; target: DocumentSnapshot; draft: string; originDraftHash: string;
  dependencies: Array<{ ref: DocumentSnapshot['ref']; revision: string }>; context: ContextCompileResult; contextFingerprint: string;
  model: string; connectionId: string; modelIdentity: string; route: 'prose' | 'chapterOutline' | 'outline'; chapterId?: number;
  question?: AuthorQuestionCard; answers?: AuthorAnswer[]; answeredQuestionId?: string;
  creativePolicy?: CreativePolicySnapshot; contractFingerprint?: string
}
export function parseAnnotationRevision(text: string, target: DocumentSnapshot, draft: string): { candidate: string } | { question: ReturnType<typeof decodeAuthorQuestionRequest> } {
  let value: unknown
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) } catch { invalid('result', '模型结果不是有效 JSON') }
  if (value && typeof value === 'object' && 'ask_author' in value) {
    const r = exactRecord(value, 'result', ['ask_author']); const question = decodeAuthorQuestionRequest(r.ask_author)
    if (question.review) invalid('ask_author', '修改意见不授予正式写入权')
    return { question }
  }
  const r = exactRecord(value, 'result', ['documentId', 'changes'])
  if (r.documentId !== target.ref.documentId || !Array.isArray(r.changes) || !r.changes.length || r.changes.length > 100) invalid('changes', '修改目标或数量无效')
  const edits = r.changes.map(item => {
    const c = exactRecord(item, 'change', ['quote', 'replacement']), quote = boundedString(c.quote, 'quote', 200_000), replacement = boundedString(c.replacement, 'replacement', 200_000)
    if (!quote || quote === replacement) invalid('quote', '必须引用非空原文并包含实际修改')
    const start = draft.indexOf(quote)
    if (start < 0 || draft.indexOf(quote, start + 1) >= 0) invalid('quote', '原文不存在或有重复，请引用更完整的段落')
    return { start, end: start + quote.length, replacement }
  }).sort((a, b) => a.start - b.start)
  let result = '', end = 0
  for (const edit of edits) { if (edit.start < end) invalid('changes', '修改范围重叠'); result += draft.slice(end, edit.start) + edit.replacement; end = edit.end }
  result += draft.slice(end)
  if (result.length > 2_000_000) invalid('result', '候选过长')
  return { candidate: result }
}
