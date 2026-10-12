import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { AnchorProjection } from '../../../contracts/document-review/types'
import { mapAnchorProjection, type TextChange } from '../../../contracts/document-review/anchors'
export type AnnotationMark = { id: string; position: AnchorProjection }
export const setAnnotationMarks = StateEffect.define<readonly AnnotationMark[]>()
export function annotationMarkExtension(select: (id: string) => void): Extension {
  const marks = StateField.define<readonly AnnotationMark[]>({
    create: () => [],
    update(value, transaction) {
      if (transaction.docChanged) {
        const changes: TextChange[] = []
        transaction.changes.iterChanges((from, to, _b, _c, insert) => changes.push({ from, to, insert: insert.toString() }))
        value = value.map(mark => ({ ...mark, position: mapAnchorProjection(mark.position, changes) }))
      }
      for (const effect of transaction.effects) if (effect.is(setAnnotationMarks)) value = effect.value
      return value
    },
    provide: field => EditorView.decorations.from(field, values => Decoration.set(values.filter(mark => mark.position.status === 'located' && mark.position.end > mark.position.start)
      .map(mark => Decoration.mark({ class: 'document-annotation-mark', attributes: { 'data-annotation-id': mark.id, title: '点击查看批注' } }).range(mark.position.start, mark.position.end)), true))
  })
  return [marks, EditorView.domEventHandlers({ click(event) {
    const mark = (event.target as HTMLElement)?.closest<HTMLElement>('[data-annotation-id]')
    if (mark?.dataset.annotationId) select(mark.dataset.annotationId)
    return false
  } }), EditorView.baseTheme({ '.document-annotation-mark': { backgroundColor: 'color-mix(in srgb, var(--gold, #c49242) 14%, transparent)',
    textDecoration: 'underline dotted var(--gold, #c49242)', textUnderlineOffset: '4px', cursor: 'pointer' } })]
}
