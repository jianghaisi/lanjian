import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWritingAgentDiff, mergeWritingAgentDiff } from '../../../src/contracts/assistant/writing-diff'

test('builds stable sentence-level change blocks and reconstructs both original and candidate exactly', () => {
  const before = '雨落在旧城。沈砚停下脚步。\n他没有回头。'
  const after = '雨落在旧城。沈砚握紧钥匙。\n他没有回头。'
  const blocks = buildWritingAgentDiff(before, after)
  const changes = blocks.filter((block) => block.kind === 'change')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].before, '沈砚停下脚步。')
  assert.equal(changes[0].after, '沈砚握紧钥匙。')
  assert.equal(mergeWritingAgentDiff(blocks, new Set()), before)
  assert.equal(mergeWritingAgentDiff(blocks, new Set(changes.map((block) => block.id))), after)
})

test('supports partial acceptance across independent semantic changes', () => {
  const before = '第一句。第二句不变。第三句。'
  const after = '第一句已改。第二句不变。第三句也改。'
  const blocks = buildWritingAgentDiff(before, after)
  const changes = blocks.filter((block) => block.kind === 'change')
  assert.equal(changes.length, 2)
  assert.equal(mergeWritingAgentDiff(blocks, new Set([changes[0].id])), '第一句已改。第二句不变。第三句。')
  assert.equal(mergeWritingAgentDiff(blocks, new Set([changes[1].id])), '第一句。第二句不变。第三句也改。')
})

test('falls back to one bounded change block for oversized comparisons', () => {
  const before = Array.from({ length: 501 }, (_, index) => `原句${index}。`).join('')
  const after = Array.from({ length: 501 }, (_, index) => `新句${index}。`).join('')
  const blocks = buildWritingAgentDiff(before, after)
  assert.deepEqual(blocks, [{ id: 'diff-1', kind: 'change', before, after }])
})
