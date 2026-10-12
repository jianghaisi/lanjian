import { EditorState, Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'

/** One independently undoable formatting command; never applies to read-only text. */
export function formatEditorTransaction(state: EditorState, format: (text: string) => string): Transaction | null {
  if (state.readOnly) return null
  const before = state.doc.toString()
  const after = format(before)
  if (before === after) return null
  const selected = state.selection.main
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: after },
    selection: { anchor: Math.min(selected.anchor, after.length), head: Math.min(selected.head, after.length) },
    annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')]
  })
}
