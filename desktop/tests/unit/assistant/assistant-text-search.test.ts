import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantSearchLimit, assistantTextMatches, nextAssistantMatch } from '../../../src/renderer/features/assistant/services/assistant-text-search'

test('first previous starts at the last match; first next starts at the first', () => {
  assert.equal(nextAssistantMatch(-1, 5, -1), 4)
  assert.equal(nextAssistantMatch(-1, 5, 1), 0)
  assert.equal(nextAssistantMatch(9, 5, -1), 4)
})
test('both directions wrap without skipping and empty results cannot navigate', () => {
  assert.equal(nextAssistantMatch(0, 5, -1), 4)
  assert.equal(nextAssistantMatch(4, 5, 1), 0)
  assert.equal(nextAssistantMatch(0, 1, -1), 0)
  assert.equal(nextAssistantMatch(-1, 0, 1), -1)
})
test('Chinese terms retain exact original offsets without mutating text', () => {
  const text = '雨夜听见旧物记忆，又遇见雨夜。'
  const matches = assistantTextMatches(text, '雨夜')
  assert.deepEqual(matches, [{ start: 0, end: 2 }, { start: 12, end: 14 }])
  assert.ok(matches.every(match => text.slice(match.start, match.end) === '雨夜'))
})
test('length-changing lowercase characters before a match never shift its DOM range', () => {
  const text = 'İ😀人物 OFFSET offset 终'
  const matches = assistantTextMatches(text, 'offset')
  assert.deepEqual(matches.map(match => text.slice(match.start, match.end)), ['OFFSET', 'offset'])
  assert.equal(matches[0].start, text.indexOf('OFFSET'))
  assert.equal(matches[1].end, text.indexOf('offset') + 6)
})
test('emoji and astral letters use DOM UTF-16 coordinates and Unicode case matching', () => {
  const text = '甲😀乙😀 𐐀'
  assert.deepEqual(assistantTextMatches(text, '😀'), [{ start: 1, end: 3 }, { start: 4, end: 6 }])
  const match = assistantTextMatches(text, '𐐨')[0]
  assert.equal(text.slice(match.start, match.end), '𐐀')
})
test('regex punctuation is always searched literally, including backslashes', () => {
  for (const query of ['[a.*]', '$^', '(x)+?', 'a|b', '{2}', '\\path']) {
    const text = `之前 ${query} 之后 ${query}`
    assert.deepEqual(assistantTextMatches(text, query).map(match => text.slice(match.start, match.end)), [query, query])
  }
})
test('empty, absent and repeated overlapping terms have deterministic results', () => {
  assert.deepEqual(assistantTextMatches('雨夜', ''), [])
  assert.deepEqual(assistantTextMatches('雨夜', '晴天'), [])
  assert.deepEqual(assistantTextMatches('aaaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }])
})
test('dense results expose only the bounded lookahead needed for the limit notice', () => {
  const text = '字'.repeat(50000)
  assert.equal(assistantTextMatches(text, '字').length, assistantSearchLimit + 1)
  assert.equal(assistantTextMatches(text, '字', 2).length, 2)
  assert.deepEqual(assistantTextMatches(text, '字', 0), [])
  assert.equal(assistantTextMatches('稀疏'.repeat(5000) + '末尾', '末尾')[0].start, 10000)
})
