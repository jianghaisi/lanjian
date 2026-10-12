import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { mapAnchorProjection } from '../../../contracts/document-review/anchors'
import type { AnchorProjection, ReviewBlock } from '../../../contracts/document-review/types'

export type InlineReviewItem = { block: ReviewBlock; position: AnchorProjection; busy?: boolean }
export type InlineReviewAction = (id: string, action: 'retain' | 'reject') => void
export const setInlineReviews = StateEffect.define<readonly InlineReviewItem[]>()

class RevisionWidget extends WidgetType {
  constructor(readonly item: InlineReviewItem, readonly action: InlineReviewAction) { super() }
  eq(other: RevisionWidget) {
    return other.action === this.action && other.item.block.id === this.item.block.id
      && other.item.block.replacement === this.item.block.replacement
      && other.item.position.status === this.item.position.status && other.item.busy === this.item.busy
  }
  toDOM() {
    const element = document.createElement('section')
    element.className = 'inline-review'
    element.dataset.reviewBlock = this.item.block.id
    element.contentEditable = 'false'
    element.setAttribute('aria-label', 'AI 修订建议')
    const text = element.appendChild(document.createElement('div'))
    text.className = 'inline-review-text'
    text.textContent = this.item.block.replacement || '建议删去这段原文'
    const tools = element.appendChild(document.createElement('div'))
    tools.className = 'inline-review-actions'
    const label = tools.appendChild(document.createElement('span'))
    const conflicted = this.item.position.status === 'needs-relocation'
    label.textContent = conflicted ? '原文已变化，请重新核对位置' : 'AI 建议 · 尚未采用'
    for (const [action, caption] of [['retain', '保留'], ['reject', '撤销']] as const) {
      const button = tools.appendChild(document.createElement('button'))
      button.type = 'button'
      button.textContent = caption
      button.dataset.reviewAction = action
      button.disabled = Boolean(this.item.busy) || action === 'retain' && conflicted
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () => this.action(this.item.block.id, action))
    }
    return element
  }
  ignoreEvent() { return true }
}

/** Decorations never enter the document, its undo history, copy text or export. */
export function inlineReviewExtension(action: InlineReviewAction): Extension {
  const items = StateField.define<readonly InlineReviewItem[]>({
    create: () => [],
    update(current, transaction) {
      let result = current
      if (transaction.docChanged) {
        const changes: Array<{ from: number; to: number; insert: string }> = []
        transaction.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert: insert.toString() }))
        result = current.map(item => ({ ...item, position: mapAnchorProjection(item.position, changes) }))
      }
      for (const effect of transaction.effects) if (effect.is(setInlineReviews)) result = effect.value
      return result
    }
  })
  const decorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_previous, transaction) {
      const ranges = transaction.state.field(items).filter(item => ['pending', 'conflicted'].includes(item.block.status)).map(item => {
        const offset = Math.max(0, Math.min(transaction.state.doc.length, item.position.end))
        return Decoration.widget({ widget: new RevisionWidget(item, action), block: true, side: 1 })
          .range(transaction.state.doc.lineAt(offset).to)
      })
      return Decoration.set(ranges, true)
    },
    provide: field => EditorView.decorations.from(field)
  })
  return [items, decorations, EditorView.baseTheme({
    '.inline-review': { margin: '8px clamp(20px, 4vw, 56px) 18px', padding: '10px 14px', borderLeft: '2px solid var(--cinnabar, #bd4a42)',
      color: 'var(--color-danger, #bd4a42)', background: 'color-mix(in srgb, var(--color-danger, #bd4a42) 5%, transparent)', userSelect: 'none', fontFamily: 'inherit' },
    '.inline-review-text': { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
    '.inline-review-actions': { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', font: '12px/1.6 var(--sans)', paddingTop: '6px' },
    '.inline-review-actions span': { marginRight: 'auto', opacity: '.8' },
    '.inline-review-actions button': { border: '1px solid currentColor', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: '3px 12px', opacity: '.65' },
    '.inline-review:hover button, .inline-review:focus-within button': { opacity: '1' },
    '.inline-review-actions button:disabled': { opacity: '.4', cursor: 'default' },
    '.inline-review-actions button:focus-visible': { outline: '2px solid currentColor', outlineOffset: '2px' }
  })]
}
