import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState, Transaction } from '@codemirror/state'
import { history, undo, redo, undoDepth } from '@codemirror/commands'
import { formatEditorTransaction } from '../../../src/renderer/features/manuscript/services/editor-commands'
import { formatOutlineWhitespace } from '../../../src/renderer/features/planning/services/outline-formatting'

test('formatting is a separate undo step and redo preserves the exact result', () => {
  const original = '# 大纲\n\n\n事件：写一封信。'
  let state = EditorState.create({ doc: original, extensions: [history()] })
  state = state.update({ changes: { from: state.doc.length, insert: '后来收到回信。' }, annotations: Transaction.userEvent.of('input.type') }).state
  const typed = state.doc.toString()
  const transaction = formatEditorTransaction(state, formatOutlineWhitespace)
  assert.ok(transaction)
  state = transaction.state
  const formatted = state.doc.toString()
  const dispatch = (next: Transaction) => { state = next.state }
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(state.doc.toString(), typed)
  assert.equal(redo({ state, dispatch }), true)
  assert.equal(state.doc.toString(), formatted)
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(state.doc.toString(), original)
})
test('read-only and unchanged format do not create history; a new document starts clean', () => {
  const readonly = EditorState.create({ doc: '甲\n\n\n乙', extensions: [history(), EditorState.readOnly.of(true)] })
  assert.equal(formatEditorTransaction(readonly, formatOutlineWhitespace), null)
  const current = EditorState.create({ doc: '独立章纲', extensions: [history()] })
  assert.equal(formatEditorTransaction(current, formatOutlineWhitespace), null)
  assert.equal(undoDepth(current), 0)
})
