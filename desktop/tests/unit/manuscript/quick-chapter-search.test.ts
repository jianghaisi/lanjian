import assert from 'node:assert/strict'
import test from 'node:test'
import { isQuickChapterShortcut, searchQuickChapters } from '../../../src/renderer/features/manuscript/services/quick-chapter-search'

const chapters = [{ id: 90, position: 1, title: '雨夜追迹', wordCount: 30 }, { id: 2, position: 12, title: '雨夜的另一个名字 ABC', wordCount: 40 }]
test('quick search uses display order rather than storage ID, supports fullwidth and trimmed title', () => {
  assert.deepEqual(searchQuickChapters(chapters, '第 １２ 章'), [chapters[1]])
  assert.deepEqual(searchQuickChapters(chapters, '90'), [])
  assert.deepEqual(searchQuickChapters(chapters, '雨夜'), chapters)
  assert.deepEqual(searchQuickChapters(chapters, ' abc '), [chapters[1]])
  assert.deepEqual(searchQuickChapters(chapters, ''), chapters)
  assert.deepEqual(searchQuickChapters([], '雨夜'), [])
})
test('quick shortcut excludes composition, repeats, consumed keys and system modifier variants', () => {
  const event = { key: 'p', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, defaultPrevented: false }
  assert.equal(isQuickChapterShortcut(event), true)
  assert.equal(isQuickChapterShortcut({ ...event, ctrlKey: false, metaKey: true, key: 'P' }), true)
  for (const key of ['isComposing', 'repeat', 'defaultPrevented', 'altKey', 'shiftKey']) assert.equal(isQuickChapterShortcut({ ...event, [key]: true }), false)
  assert.equal(isQuickChapterShortcut({ ...event, ctrlKey: false }), false)
  assert.equal(isQuickChapterShortcut({ ...event, key: 'f' }), false)
})
