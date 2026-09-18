import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState } from '@codemirror/state'
import { editorSearchExtensions, editorSearchPhrases } from '../../../src/renderer/features/manuscript/services/editor-search'

test('shared editor search localizes commands, fields and screen reader feedback without changing text', () => {
  const text = '第一章\n　　他问：“线索在哪里？”\r\n　　她指了指门。'
  const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of('\n'), editorSearchExtensions()] })
  assert.equal(state.doc.toString(), text)
  for (const [source, localized] of Object.entries(editorSearchPhrases)) {
    assert.equal(state.phrase(source), localized)
  }
  assert.equal(state.phrase('replaced $ matches', 3), '已替换 3 处')
  assert.equal(state.phrase('replaced match on line $', 8), '已替换第 8 行的匹配')
})

test('search extensions preserve read-only state and do not preselect or replace text', () => {
  const state = EditorState.create({ doc: '作者原稿', extensions: [EditorState.readOnly.of(true), editorSearchExtensions()] })
  assert.equal(state.readOnly, true)
  assert.equal(state.doc.toString(), '作者原稿')
  assert.equal(state.selection.main.from, 0)
  assert.equal(state.selection.main.to, 0)
})
