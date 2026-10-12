import { shallowReactive } from 'vue'
import type { DocumentRef } from '../../../contracts/document-review/types'
import { decodeAuthorQuestionDraft, type AuthorQuestionDraft } from '../assistant/services/author-question-draft'

type AnswerDraft = { draft: AuthorQuestionDraft; operation: string; pending: boolean; acknowledged: boolean; error: string }
type QuestionIdentity = Pick<AuthorQuestionDraft, 'runId' | 'questionId' | 'questionVersion'>

/** Window-local input only. Persisted questions and task status remain main-owned. */
export function createAnnotationAnswerDrafts() {
  const entries = shallowReactive(new Map<string, AnswerDraft>())
  const key = (document: DocumentRef, draft: QuestionIdentity) => JSON.stringify([
    document.workItemId, document.kind, document.documentId, draft.runId, draft.questionId, draft.questionVersion
  ])
  const get = (document: DocumentRef, draft: QuestionIdentity) => entries.get(key(document, draft))
  function set(document: DocumentRef, value: AuthorQuestionDraft) {
    const draft = decodeAuthorQuestionDraft(value)!
    const identity = key(document, draft), previous = entries.get(identity)
    if (previous?.pending || previous?.acknowledged || previous && JSON.stringify(previous.draft) === JSON.stringify(draft)) return
    entries.set(identity, { draft, operation: crypto.randomUUID(), pending: false, acknowledged: false, error: '' })
  }
  return {
    get, set,
    begin(document: DocumentRef, value: AuthorQuestionDraft) {
      set(document, value)
      const previous = get(document, value)
      if (!previous || previous.pending || previous.acknowledged) return null
      const submitted = { ...previous, pending: true, error: '' }
      entries.set(key(document, value), submitted)
      return submitted
    },
    finish(document: DocumentRef, submitted: AnswerDraft, error?: string) {
      const identity = key(document, submitted.draft), current = entries.get(identity)
      if (current?.operation !== submitted.operation) return
      if (current.acknowledged) return
      entries.set(identity, { ...current, pending: false, acknowledged: !error, error: error || '' })
    }
  }
}

export const annotationAnswerDrafts = createAnnotationAnswerDrafts()
