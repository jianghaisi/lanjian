import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { countLinesBeforeOffset, measureManuscript, projectWordCountWithDraft } from '../../../src/contracts/manuscript/manuscript-metrics'

test('keeps manuscript counts compatible without allocating word or line arrays', () => {
  assert.deepEqual(measureManuscript('  陈景安与 AI-2 在示例中学。\n\n第二段 123 test  '), {
    wordCount: 16,
    paragraphCount: 2
  })
  assert.deepEqual(measureManuscript(' \n\t '), { wordCount: 0, paragraphCount: 0 })
  assert.equal(countLinesBeforeOffset('甲\n乙\n丙', 4), 2)
  assert.equal(countLinesBeforeOffset('甲\n乙', 999), 1)
})

test('measures a 20,000-plus-character Chinese chapter within the long-form baseline', () => {
  const paragraph = '陈景安推开窗，晨光落在书页上，所有细节仍须逐字保存。AI draft 2026。'
  const manuscript = Array.from({ length: 600 }, (_, index) => `第${index + 1}段：${paragraph}`).join('\n\n')
  assert.ok(manuscript.length >= 20_000 && manuscript.length <= 30_000)

  const startedAt = performance.now()
  let latest = measureManuscript(manuscript)
  for (let index = 0; index < 99; index += 1) latest = measureManuscript(`${manuscript.slice(0, -1)}${index % 10}`)
  const elapsedMs = performance.now() - startedAt

  assert.equal(latest.paragraphCount, 600)
  assert.ok(latest.wordCount > 15_000)
  assert.ok(elapsedMs < 1_500, `100 次长章统计耗时 ${elapsedMs.toFixed(2)}ms`)
})

test('reconciles the current draft into the persisted project word total', () => {
  assert.equal(projectWordCountWithDraft(12_000, 3_000, '新稿五个汉字'), 9_006)
  assert.equal(projectWordCountWithDraft(0, 500, ''), 0)
  assert.equal(projectWordCountWithDraft(Number.NaN, Number.NaN, 'AI draft 2026'), 3)
})
