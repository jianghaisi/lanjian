import assert from 'node:assert/strict'
import test from 'node:test'
import { ManuscriptEditHistory, type ManuscriptEditSnapshot } from '../../../src/renderer/features/manuscript/services/manuscript-edit-history'

function snapshot(content: string, selectionStart = content.length, title = '第一章'): ManuscriptEditSnapshot {
  return { title, content, selectionStart, selectionEnd: selectionStart }
}

test('coalesces continuous typing into one undo step and restores it with redo', () => {
  const history = new ManuscriptEditHistory()
  history.record(snapshot(''), { group: 'content:typing', coalesceMs: 900, at: 1000 })
  history.record(snapshot('你'), { group: 'content:typing', coalesceMs: 900, at: 1400 })
  history.record(snapshot('你好'), { group: 'content:typing', coalesceMs: 900, at: 1750 })

  const current = snapshot('你好呀')
  assert.deepEqual(history.undo(current), snapshot(''))
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, true)
  assert.deepEqual(history.redo(snapshot('')), current)
})

test('keeps commands separate and clears redo after a new edit', () => {
  const history = new ManuscriptEditHistory()
  history.record(snapshot('原文'), { group: 'external', at: 1000 })
  history.record(snapshot('AI 改写'), { group: 'command:format', at: 1100 })
  assert.deepEqual(history.undo(snapshot('排版后正文')), snapshot('AI 改写'))
  assert.equal(history.canRedo, true)

  history.record(snapshot('AI 改写'), { group: 'content:typing', coalesceMs: 900, at: 2000 })
  assert.equal(history.canRedo, false)
  assert.deepEqual(history.undo(snapshot('AI 改写后手写')), snapshot('AI 改写'))
})

test('treats a programmatic AI candidate application as one reversible step', () => {
  const history = new ManuscriptEditHistory()
  const before = snapshot('作者原稿')
  const candidate = snapshot('模型候选改写')

  history.record(before, { group: 'external', at: 1_000 })

  assert.deepEqual(history.undo(candidate), before)
  assert.deepEqual(history.redo(before), candidate)
})

test('bounds retained history without losing the newest edits', () => {
  const history = new ManuscriptEditHistory(2)
  history.record(snapshot('一'), { group: 'one', at: 1 })
  history.record(snapshot('二'), { group: 'two', at: 2 })
  history.record(snapshot('三'), { group: 'three', at: 3 })
  assert.deepEqual(history.undo(snapshot('四')), snapshot('三'))
  assert.deepEqual(history.undo(snapshot('三')), snapshot('二'))
  assert.equal(history.undo(snapshot('二')), null)
})
