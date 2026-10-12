import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextAnchor, locateTextAnchor, mapAnchorProjection } from '../../../src/contracts/document-review/anchors'
const hash = 'a'.repeat(64)
test('UTF-16 selection retains Chinese, emoji and CRLF; split surrogate is rejected', () => {
  const text = '序😀\r\n雨中的信。'
  const anchor = createTextAnchor(text, 5, text.length, 'v1', hash)
  assert.equal(anchor.quote, '雨中的信。')
  assert.deepEqual(locateTextAnchor(text, anchor, hash), { start: 5, end: text.length, status: 'located' })
  assert.throws(() => createTextAnchor(text, 2, 3, 'v1', hash))
})
test('recovery requires unique exact quote and context, never matching a repeated quote by proximity', () => {
  const text = '前'.repeat(80) + '信' + '后'.repeat(80)
  const anchor = createTextAnchor(text, 80, 81, 'v1', hash)
  assert.equal(locateTextAnchor('新增\n' + text, anchor).start, 83)
  assert.equal(locateTextAnchor(text + text, anchor).status, 'needs-relocation')
  assert.equal(locateTextAnchor(text.replace('信', '雨'), anchor).status, 'needs-relocation')
})
test('actual edits map repeated anchors safely; overlapping edits invalidate and deleted text stays quoted', () => {
  const anchor = { start: 5, end: 8, status: 'located' as const }
  assert.deepEqual(mapAnchorProjection(anchor, [{ from: 1, to: 3, insert: 'abcd' }]), { start: 7, end: 10, status: 'located' })
  assert.equal(mapAnchorProjection(anchor, [{ from: 6, to: 6, insert: '雨' }]).status, 'needs-relocation')
  assert.equal(mapAnchorProjection(anchor, [{ from: 5, to: 8, insert: '' }]).status, 'needs-relocation')
  assert.equal(mapAnchorProjection({ start: 5, end: 5, status: 'located' }, [{ from: 5, to: 5, insert: 'x' }]).status, 'needs-relocation')
})
