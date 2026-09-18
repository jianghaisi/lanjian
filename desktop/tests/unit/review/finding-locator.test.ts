import assert from 'node:assert/strict'
import test from 'node:test'
import { findingChapterPositions, findingEvidenceSearchTerms } from '../../../src/contracts/review/finding-locator'

test('prefers exact prose evidence and excludes stable-anchor metadata', () => {
  assert.deepEqual(findingEvidenceSearchTerms([
    '既有人物锚点：沈家后人',
    '正文中的新声明：并非沈家后人',
    '正文逐字证据：沈砚说：“我并非沈家后人。”',
    '锚点来源：人物卡-沈砚'
  ]), ['沈砚说：“我并非沈家后人。”', '并非沈家后人'])
})

test('turns literary evidence labels into searchable manuscript text', () => {
  assert.deepEqual(findingEvidenceSearchTerms([
    '第 7 段：雨水顺着旧城墙落下。',
    '命中：“总而言之”'
  ]), ['雨水顺着旧城墙落下。', '总而言之'])
})

test('visits the newer chapter first and does not duplicate same-chapter findings', () => {
  assert.deepEqual(findingChapterPositions({ fromChapter: 4, toChapter: 5 }), [5, 4])
  assert.deepEqual(findingChapterPositions({ fromChapter: 7, toChapter: 7 }), [7])
})
