import { shallowReactive } from 'vue'
import type { DocumentAnnotation } from '../../../contracts/document-review/annotations'

type AnnotationFormDraft = {
  body: string
  editing: DocumentAnnotation | null
  operation: string
  pending: boolean
  error: string
}

/** Unsubmitted opinions live for this renderer window, independently of editor
 * mounts. This is not the persisted annotation or manuscript recovery store. */
export function createAnnotationFormDrafts() {
  const drafts = shallowReactive(new Map<string, AnnotationFormDraft>())
  return {
    get: (key: string) => drafts.get(key),
    set(key: string, body: string, editing: DocumentAnnotation | null) {
      if (!key) return
      const previous = drafts.get(key)
      if (previous?.pending) return
      if (!body && !editing) { drafts.delete(key); return }
      if (previous?.body === body && previous.editing?.id === editing?.id && previous.editing?.revision === editing?.revision) return
      drafts.set(key, { body, editing, operation: crypto.randomUUID(), pending: false, error: '' })
    },
    begin(key: string) {
      const draft = drafts.get(key)
      if (!draft || draft.pending || !draft.body.trim()) return null
      drafts.set(key, { ...draft, pending: true, error: '' })
      return draft
    },
    finish(key: string, operation: string, error?: string) {
      const current = drafts.get(key)
      if (current?.operation !== operation) return
      if (error) drafts.set(key, { ...current, pending: false, error })
      else drafts.delete(key)
    },
    discard(key: string) {
      if (!drafts.get(key)?.pending) drafts.delete(key)
    }
  }
}

export const annotationFormDrafts = createAnnotationFormDrafts()
