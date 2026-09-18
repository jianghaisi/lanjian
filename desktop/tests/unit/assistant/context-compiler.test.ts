import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compileContext,
  heuristicContextTokenEstimator,
  type ContextCandidate,
  type ContextTokenEstimator
} from '../../../src/main/modules/assistant/domain/context-compiler'

const characterEstimator: ContextTokenEstimator = {
  metadata: { id: 'test-character-estimator', method: 'tokenizer', errorMargin: null, description: '每个 Unicode 字符视为一个 token。' },
  estimate: (content) => [...content].length
}

function candidate(id: string, authority: ContextCandidate['authority'], content: string, input: Partial<ContextCandidate> = {}): ContextCandidate {
  return {
    id,
    sourceType: 'test',
    sourceId: `source-${id}`,
    label: `候选 ${id}`,
    content,
    authority,
    ...input
  }
}

function request(candidates: ContextCandidate[], input: Partial<Parameters<typeof compileContext>[0]> = {}) {
  return {
    task: 'prose',
    candidates,
    modelContextLimit: 100,
    outputReserveTokens: 10,
    systemReserveTokens: 10,
    estimator: characterEstimator,
    ...input
  }
}

test('sorts deterministically by authority, priority, chapter proximity, update time and id', () => {
  const values = [
    candidate('optional', 'optional', 'O'),
    candidate('related-old', 'related', 'R1', { priority: 3, chapterDistance: 1, updatedAt: '2026-09-01T00:00:00.000Z' }),
    candidate('required', 'required', 'Q'),
    candidate('promoted', 'optional', 'P'),
    candidate('related-new', 'related', 'R2', { priority: 3, chapterDistance: 1, updatedAt: '2026-09-02T00:00:00.000Z' }),
    candidate('related-near', 'related', 'R3', { priority: 3, chapterDistance: 0 }),
    candidate('related-priority', 'related', 'R4', { priority: 4, chapterDistance: 9 })
  ]
  const first = compileContext(request(values, { pinnedIds: ['promoted'] }))
  const second = compileContext(request([...values].reverse(), { pinnedIds: ['promoted'] }))

  assert.equal(first.status, 'ready')
  assert.deepEqual(first.included.map((item) => item.id), ['required', 'promoted', 'related-priority', 'related-near', 'related-new', 'related-old', 'optional'])
  assert.deepEqual(second.included.map((item) => item.id), first.included.map((item) => item.id))
  assert.equal(second.contentHash, first.contentHash)
  assert.equal(first.included[1].authority, 'pinned')
})

test('subtracts output and system reserves and applies the smaller project input budget', () => {
  const result = compileContext(request([
    candidate('required', 'required', '1234567890'),
    candidate('related', 'related', 'abcdefghij')
  ], {
    modelContextLimit: 100,
    outputReserveTokens: 20,
    systemReserveTokens: 15,
    projectInputBudget: 18
  }))

  assert.equal(result.status, 'ready')
  assert.deepEqual(result.included.map((item) => item.id), ['required'])
  assert.equal(result.excluded[0].reason, 'drop_policy')
  assert.deepEqual(result.budget, {
    modelContextLimit: 100,
    outputReserveTokens: 20,
    systemReserveTokens: 15,
    modelInputLimit: 65,
    projectInputBudget: 18,
    availableInputTokens: 18,
    usedInputTokens: 10,
    remainingInputTokens: 8
  })
})

test('blocks instead of truncating required context when required material exceeds the input budget', () => {
  const result = compileContext(request([
    candidate('instruction', 'required', '作者本次不可截断的指令', { truncationPolicy: 'truncate' }),
    candidate('selection', 'required', '作者选区同样不可截断', { truncationPolicy: 'compress', compressedContent: '短' })
  ], {
    modelContextLimit: 24,
    outputReserveTokens: 5,
    systemReserveTokens: 5
  }))

  assert.equal(result.status, 'blocked')
  assert.equal(result.blocked?.code, 'REQUIRED_CONTEXT_EXCEEDS_BUDGET')
  assert.deepEqual(result.blocked?.candidateIds, ['instruction', 'selection'])
  assert.equal(result.included.length, 0)
  assert.equal(result.truncation.truncated, false)
})

test('returns a structured block when reserves leave no model input budget', () => {
  const result = compileContext(request([candidate('required', 'required', '必须')], {
    modelContextLimit: 20,
    outputReserveTokens: 12,
    systemReserveTokens: 8
  }))
  assert.equal(result.status, 'blocked')
  assert.equal(result.blocked?.code, 'NO_INPUT_BUDGET')
  assert.equal(result.budget.availableInputTokens, 0)
})

test('applies never, compress, truncate and drop policies with a visible report', () => {
  const result = compileContext(request([
    candidate('required', 'required', 'RRRRR'),
    candidate('compressed', 'related', 'C'.repeat(30), { priority: 4, truncationPolicy: 'compress', compressedContent: 'CCC' }),
    candidate('truncated', 'related', `😀${'T'.repeat(40)}`, { priority: 3, truncationPolicy: 'truncate' }),
    candidate('never', 'related', 'NNNNNN', { priority: 2, truncationPolicy: 'never' }),
    candidate('drop', 'optional', 'DDDDDD', { truncationPolicy: 'drop' })
  ], {
    modelContextLimit: 35,
    outputReserveTokens: 5,
    systemReserveTokens: 5,
    projectInputBudget: 25
  }))

  assert.equal(result.status, 'ready')
  assert.deepEqual(result.included.map((item) => [item.id, item.mode]), [
    ['required', 'full'],
    ['compressed', 'compressed'],
    ['truncated', 'truncated']
  ])
  assert.match(result.included[2].content, /因上下文预算截断/)
  assert.doesNotMatch(result.included[2].content, /\ud83d(?!\ude00)/)
  assert.deepEqual(result.excluded.map((item) => [item.id, item.reason]), [['never', 'budget'], ['drop', 'drop_policy']])
  assert.deepEqual(result.truncation.items.map((item) => item.action), ['compressed', 'truncated', 'excluded', 'excluded'])
  assert.ok(result.budget.usedInputTokens <= result.budget.availableInputTokens)
})

test('user exclusion wins over pinning for non-required items but cannot remove required guardrails', () => {
  const result = compileContext(request([
    candidate('guardrail', 'required', 'G'),
    candidate('reference', 'optional', 'P'),
    candidate('other', 'optional', 'O')
  ], {
    pinnedIds: ['reference'],
    excludedIds: ['guardrail', 'reference']
  }))

  assert.deepEqual(result.included.map((item) => item.id), ['guardrail', 'other'])
  assert.deepEqual(result.excluded.map((item) => [item.id, item.authority, item.reason]), [['reference', 'pinned', 'user_excluded']])
})

test('reports unavailable or oversized compression distinctly', () => {
  const result = compileContext(request([
    candidate('base', 'required', '12345678'),
    candidate('missing', 'related', 'abcdefghij', { priority: 2, truncationPolicy: 'compress' }),
    candidate('large', 'related', 'klmnopqrst', { priority: 1, truncationPolicy: 'compress', compressedContent: 'stilllarge' })
  ], {
    projectInputBudget: 10
  }))
  assert.deepEqual(result.excluded.map((item) => [item.id, item.reason]), [
    ['missing', 'compression_unavailable'],
    ['large', 'compressed_over_budget']
  ])
})

test('exposes heuristic estimator metadata and stable hashes while source-version changes alter the package hash', () => {
  const base = candidate('chapter', 'related', '临江酒馆旧案', {
    sourceVersion: 'version-a',
    contentHash: 'a'.repeat(64),
    relevanceReasons: ['实体匹配：临江酒馆'],
    untrusted: true
  })
  const first = compileContext(request([base], { estimator: heuristicContextTokenEstimator }))
  const repeated = compileContext(request([{ ...base }], { estimator: heuristicContextTokenEstimator }))
  const changed = compileContext(request([{ ...base, sourceVersion: 'version-b' }], { estimator: heuristicContextTokenEstimator }))

  assert.equal(first.estimator.method, 'heuristic')
  assert.equal(first.estimator.errorMargin, 0.25)
  assert.ok(first.included[0].estimatedTokens > 0)
  assert.equal(first.included[0].untrusted, true)
  assert.equal(first.contentHash, repeated.contentHash)
  assert.notEqual(first.contentHash, changed.contentHash)
})

test('rejects duplicate candidate ids because pin and exclusion decisions would be ambiguous', () => {
  assert.throws(() => compileContext(request([
    candidate('same', 'related', '甲'),
    candidate('same', 'optional', '乙')
  ])), /候选编号重复/)
})
