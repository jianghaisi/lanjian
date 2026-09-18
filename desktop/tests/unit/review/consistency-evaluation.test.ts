import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildFixedConsistencySamples,
  evaluateFixedConsistencySamples,
  parseSemanticEvaluationResponse,
  semanticEvaluationBatches,
  semanticEvaluationPrompt,
  type SemanticPredictions
} from '../../../src/main/modules/review/domain/consistency-evaluation'
import { AppError } from '../../../src/main/core/errors/app-error'
import { ConsistencyEvaluationService } from '../../../src/main/modules/review/application/consistency-evaluation-service'

test('keeps a fixed 100–300 sample suite across every V2 consistency category', () => {
  const samples = buildFixedConsistencySamples()
  assert.equal(samples.length, 220)
  assert.equal(new Set(samples.map((sample) => sample.id)).size, samples.length)
  assert.deepEqual(new Set(samples.map((sample) => sample.category)), new Set([
    '时间与顺序', '地点与移动', '人物生死/伤势/身份', '资源/物品', '世界规则',
    '知情边界', '能力边界', '因果与动机', '视角/文学性建议', '正常但容易误报的反例'
  ]))
  assert.ok(samples.every((sample) => sample.evidence.trim()))
})

test('semantic fixtures are distinct story cases instead of number-substituted templates', () => {
  const semantic = buildFixedConsistencySamples().filter((sample) => sample.layer === 'semantic')
  const withoutNumbers = semantic.map((sample) => sample.evidence.replace(/[零一二三四五六七八九十百千万\d]+/g, '#'))
  assert.equal(semantic.length, 60)
  assert.ok(new Set(withoutNumbers).size >= 55)
  assert.ok(semantic.every((sample) => sample.evidence.length >= 28))
  assert.ok(semantic.filter((sample) => /章|上一|下一|随后|后来|期间|此前|当晚/.test(sample.evidence)).length >= 24)
})

test('reports local metrics while counting unconfigured semantic samples as unable', () => {
  const report = evaluateFixedConsistencySamples()
  assert.equal(report.sampleCount, 220)
  assert.equal(report.evaluatedCount, 160)
  assert.equal(report.unableToJudgeCount, 60)
  assert.equal(report.evaluators.find((entry) => entry.layer === 'semantic')?.status, 'not-configured')
  assert.ok(report.metrics.filter((metric) => metric.layer !== 'semantic').every((metric) => (
    metric.detectionRate === 1 && metric.falsePositiveRate === 0 && metric.unableToJudge === 0
  )))
  assert.ok(report.metrics.filter((metric) => metric.layer === 'semantic').every((metric) => (
    metric.evaluatedCount === 0 && metric.unableToJudgeRate === 1
    && metric.failedSampleIds.length === 0 && metric.unableSampleIds.length === metric.sampleCount
  )))
})

test('scores supplied semantic predictions separately and records the model version', () => {
  const semantic = buildFixedConsistencySamples().filter((sample) => sample.layer === 'semantic')
  const predictions: Record<string, string[]> = {}
  for (const sample of semantic) predictions[sample.id] = sample.expectedCode ? [sample.expectedCode] : []
  const report = evaluateFixedConsistencySamples({
    semanticPredictions: predictions satisfies SemanticPredictions,
    semanticModelVersion: 'fixture-semantic-v1'
  })
  assert.equal(report.evaluatedCount, 220)
  assert.equal(report.unableToJudgeCount, 0)
  assert.deepEqual(report.evaluators.find((entry) => entry.layer === 'semantic'), {
    layer: 'semantic', implementation: 'external semantic prediction set', version: 'fixture-semantic-v1', status: 'evaluated'
  })
  assert.ok(report.metrics.every((metric) => metric.falseNegative === 0 && metric.falsePositive === 0 && metric.unableToJudge === 0))
})

test('builds a bounded prompt without labels and parses one exact result per sample', () => {
  const batch = semanticEvaluationBatches(8)[0]
  const prompt = semanticEvaluationPrompt(batch)
  assert.doesNotMatch(prompt, /expectedCode|正确答案|预期/)
  const wire = JSON.parse(prompt.split('\n样本：\n')[1]) as Array<{ id: string; evidence: string }>
  assert.ok(wire.every(item => Object.keys(item).join(',') === 'id,evidence'))
  assert.doesNotMatch(prompt, /clear|counterexample|category|时间与顺序|正常但容易误报|反例/)
  assert.ok(batch.every(sample => !prompt.includes(sample.id)))
  assert.deepEqual(wire.map(item => item.evidence), batch.map(item => item.evidence.replace(/^第\d+个反例：/, '')))
  const response = JSON.stringify({ results: wire.map((sample, index) => ({ id: sample.id, codes: index % 2 ? [] : ['TIME_ORDER_CONFLICT'] })).reverse() })
  const parsed = parseSemanticEvaluationResponse(`\`\`\`json\n${response}\n\`\`\``, batch)
  assert.equal(Object.keys(parsed).length, 8)
  batch.forEach((sample, index) => assert.deepEqual(parsed[sample.id], index % 2 ? [] : ['TIME_ORDER_CONFLICT']))
  assert.throws(() => parseSemanticEvaluationResponse(JSON.stringify({ results: [] }), batch), /缺少输入样本/)
  assert.throws(() => parseSemanticEvaluationResponse(JSON.stringify({ results: wire.map((sample) => ({ id: sample.id, codes: ['UNREGISTERED'] })) }), batch), /无效冲突代码/)
  assert.throws(() => parseSemanticEvaluationResponse(JSON.stringify({ results: batch.map(sample => ({ id: sample.id, codes: [] })) }), batch), /未知样本/)
  assert.throws(() => parseSemanticEvaluationResponse(JSON.stringify({ results: [wire[0], wire[0]].map(sample => ({ id: sample.id, codes: [] })) }), batch), /重复返回/)
})

test('blind delivery covers all sixty samples once without answer labels or alternating answer order', () => {
  const batches = semanticEvaluationBatches()
  const original = buildFixedConsistencySamples().filter(sample => sample.layer === 'semantic')
  assert.deepEqual(new Set(batches.flat().map(item => item.id)), new Set(original.map(item => item.id)))
  assert.notDeepEqual(batches.flat().map(item => item.id), original.map(item => item.id))
  assert.deepEqual(batches, semanticEvaluationBatches())
  for (const batch of batches) {
    const prompt = semanticEvaluationPrompt(batch)
    assert.doesNotMatch(prompt, /clear|counterexample|category|反例|expectedCode/)
    assert.ok(batch.every(sample => !prompt.includes(sample.id)))
  }
})

test('runs semantic batches through the review model and writes only a project evaluation report', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-consistency-eval-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const batches = semanticEvaluationBatches()
  let call = 0
  const runner = new ConsistencyEvaluationService({
    prepareCompletion: async () => ({
      model: 'review-model-v3', connectionId: 'fixture-review',
      complete: async () => {
        const batch = batches[call++]
        return { content: JSON.stringify({ results: batch.map((sample, index) => ({ id: `sample-${String(index + 1).padStart(2, '0')}`, codes: sample.id.includes('-clear-') || sample.id.startsWith('normal-counterexample') ? [] : [codeFor(sample.category)] })) }) }
      }
    })
  }, { currentPath: async () => root }, () => new Date('2026-09-03T12:00:00.000Z'))

  const progress: number[] = []
  const summary = await runner.run(new AbortController().signal, (completed) => progress.push(completed))
  assert.equal(call, 5)
  assert.equal(summary.modelVersion, 'review-model-v3')
  assert.equal(summary.semanticEvaluatedCount, 60)
  assert.equal(summary.semanticUnableToJudge, 0)
  assert.equal(summary.semanticFalsePositive, 0)
  assert.equal(summary.semanticFalseNegative, 0)
  assert.equal(summary.warningCount, 0)
  assert.equal(progress.at(-1), 5)
  const stored = JSON.parse(await readFile(join(root, '.webnovel', 'evaluations', 'consistency-fixed-v2.json'), 'utf8'))
  assert.equal(stored.deliveryProtocol, 'anonymous-evidence-v1')
  assert.equal(stored.summary.completedAt, '2026-09-03T12:00:00.000Z')
  assert.equal(stored.report.evaluatedCount, 220)
  assert.equal((await runner.latest())?.modelVersion, 'review-model-v3')
})

test('stops fixed evaluation after the first provider failure instead of spending the remaining batches', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-consistency-provider-failure-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const runner = new ConsistencyEvaluationService({
    prepareCompletion: async () => ({
      model: 'unavailable-review-model', connectionId: 'unavailable-provider',
      complete: async () => {
        calls += 1
        throw new AppError('FEATURE_UNAVAILABLE', '令牌没有当前模型或模型分组的调用权限。', { recoverable: true })
      }
    })
  }, { currentPath: async () => root })

  await assert.rejects(() => runner.run(new AbortController().signal), /令牌没有当前模型/)
  assert.equal(calls, 1)
  await assert.rejects(() => readFile(join(root, '.webnovel', 'evaluations', 'consistency-fixed-v2.json'), 'utf8'), /ENOENT/)
})

function codeFor(category: string): string {
  return ({
    '时间与顺序': 'TIME_ORDER_CONFLICT',
    '人物生死/伤势/身份': 'IDENTITY_OR_INJURY_CONFLICT',
    '资源/物品': 'RESOURCE_CONFLICT',
    '世界规则': 'WORLD_RULE_CONFLICT',
    '知情边界': 'KNOWLEDGE_CONFLICT',
    '因果与动机': 'CAUSAL_OR_MOTIVATION_CONFLICT'
  } as Record<string, string>)[category]
}
