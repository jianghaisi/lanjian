import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOutlineWhitespace } from '../../../src/renderer/features/planning/services/outline-formatting'

test('outline formatting collapses redundant prose blanks without rewriting text or CRLF', () => {
  const original = '# 卷纲\r\n\r\n\r\n目标：寻回信件。\r\n\r\n\r\n\r\n结尾：进入旧城。'
  assert.equal(formatOutlineWhitespace(original), '# 卷纲\r\n\r\n目标：寻回信件。\r\n\r\n结尾：进入旧城。')
})
test('outline formatting preserves nested lists, code, tables, quotes and hard breaks byte-for-byte', () => {
  const original = [
    '# 章纲', '', '- 线索', '', '', '  - 嵌套', '', '', '    代码缩进',
    '', '', '> 引用', '', '', '| 时间 | 事件 |', '| --- | --- |',
    '', '', '~~~markdown', '', '', '', '# 这是代码', '~~~',
    '前一行  ', '硬换行保留', ''
  ].join('\r\n')
  assert.equal(formatOutlineWhitespace(original), original)
})
test('long fences cannot be closed by shorter markers or matching markers with text', () => {
  const original = '~~~~\n甲\n\n\n乙\n~~~\n丙\n\n\n丁\n~~~~ text\n戊\n\n\n己\n~~~~'
  assert.equal(formatOutlineWhitespace(original), original)
})
test('empty content and repeated formatting have no additional effect', () => {
  for (const original of ['', '\n\n', '普通文字', '甲\n\n\n乙']) {
    const formatted = formatOutlineWhitespace(original)
    assert.equal(formatOutlineWhitespace(formatted), formatted)
  }
})
