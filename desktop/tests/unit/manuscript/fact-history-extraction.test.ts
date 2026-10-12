import test from 'node:test'
import assert from 'node:assert/strict'
import { extractFactClaimCandidates } from '../../../src/main/modules/manuscript/application/chapter-draft-service'

test('adverb 还 does not fabricate a prior return-of-property claim', () => {
  for (const text of [
    '不过我平时只管日常文书登记，钟楼这批陈年卷宗我还没翻过，不知道具体存了多少、缺没缺漏。',
    '许棠虽然嘴上这么说，但还是重新撑开伞，不过她并没有猜出缘由。',
    '天还没有亮过来，沈砚把灯挪近了。'
  ]) assert.deepEqual(extractFactClaimCandidates(text, 'balanced'), [], text)
})

test('directional 过来 does not turn a nearby 借阅 into prior loan history', () => {
  assert.deepEqual(extractFactClaimCandidates('交接时多签了两张借阅单子，紧赶慢赶过来的。', 'balanced'), [])
})

test('actual prior loans, returns, help and promises remain review candidates', () => {
  for (const text of [
    '许棠以前借过沈砚的银壳怀表。',
    '沈砚还过许棠那把黑色的长柄雨伞。',
    '沈砚还给许棠之前借走的雨伞。',
    '沈砚曾经帮助许棠修好怀表。',
    '许棠答应过沈砚去查值班册。'
  ]) assert.ok(extractFactClaimCandidates(text, 'balanced').some(item => item.kind === 'priorHistory'), text)
})
