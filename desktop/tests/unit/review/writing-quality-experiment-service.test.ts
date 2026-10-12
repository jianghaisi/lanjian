import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WritingQualityRunStore } from '../../../src/main/modules/review/adapters/writing-quality-run-store'
import { WritingQualityExperimentService } from '../../../src/main/modules/review/application/writing-quality-experiment-service'
import {
  calculateSyntheticCost, reduceAttemptEvents, sealAttemptEvent, sha256, stableAnonymousId
} from '../../../src/main/modules/review/domain/writing-quality-protocol'
import {
  createOfflineManifest, DeterministicOfflineWritingAdapter, freezeSlotInput,
  type FrozenSlotInput, type OfflineGenerationAdapter
} from '../../../src/main/modules/review/domain/writing-quality-fixtures'

test('runs 3 genres by 3 arms offline, creates 9 blind pairs and resumes without dispatch', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-service-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
  context.after(() => { globalThis.fetch = originalFetch })
  const store = await WritingQualityRunStore.open(root, 'complete-run')
  const manifest = createOfflineManifest('complete-run', 23)
  const fixedClock = () => new Date('2026-09-20T12:00:00.000Z')
  const first = await new WritingQualityExperimentService(store, new DeterministicOfflineWritingAdapter(), fixedClock).run(manifest)
  assert.equal(first.report.status, 'protocol-complete')
  assert.equal(first.report.successfulSlots, 9)
  assert.equal(first.report.packetCount, 9)
  assert.deepEqual(first.report.judgmentCoverage, { completed: 0, required: 9, ratio: 0 })
  assert.equal(first.events.length, 18)
  assert.match(first.report.scopeNotice, /不证明小说质量/)

  let calls = 0
  const forbiddenAdapter: OfflineGenerationAdapter = { generate: async () => { calls += 1; throw new Error('must not dispatch') } }
  const second = await new WritingQualityExperimentService(store, forbiddenAdapter, fixedClock).run(manifest)
  assert.equal(calls, 0)
  assert.equal(second.events.length, 18)
  assert.equal(second.report.generatedAt, first.report.generatedAt)
  const identity = JSON.parse(await readFile(join(store.runRoot, 'identity-map.json'), 'utf8')) as Record<string, unknown>
  assert.ok(Array.isArray(identity.mappings))
  const packetText = await readFile(join(store.runRoot, 'packets', 'xuanhuan-pair-1.json'), 'utf8')
  assert.equal(packetText.includes('"arm"'), false)
  assert.equal(packetText.includes('direct'), false)
  assert.equal(packetText.includes('outline-first'), false)
  assert.equal(packetText.includes('v3-full-flow'), false)
})

test('retains invalid length, adapter failure and cancellation as terminal evidence', async (context) => {
  for (const scenario of ['short', 'failure', 'cancel'] as const) {
    const root = await mkdtemp(join(tmpdir(), `lanjian-quality-${scenario}-`))
    context.after(() => rm(root, { recursive: true, force: true }))
    const fallback = new DeterministicOfflineWritingAdapter()
    let calls = 0
    const adapter: OfflineGenerationAdapter = {
      async generate(input, signal) {
        calls += 1
        if (input.slot.storyId.endsWith('stone-bell') && input.slot.arm === 'direct') {
          if (scenario === 'short') return { content: '太短', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
          const error = new Error(scenario)
          if (scenario === 'cancel') error.name = 'AbortError'
          throw error
        }
        return fallback.generate(input, signal)
      }
    }
    const store = await WritingQualityRunStore.open(root, `${scenario}-run`)
    const result = await new WritingQualityExperimentService(store, adapter, () => new Date('2026-09-20T12:00:00.000Z')).run(createOfflineManifest(`${scenario}-run`, 24))
    const event = result.events.find(item => item.storyId.endsWith('stone-bell') && item.arm === 'direct' && item.status !== 'reserved')
    assert.equal(event?.status, scenario === 'short' ? 'invalid' : scenario === 'cancel' ? 'cancelled' : 'failed')
    assert.equal(calls, 9)
    assert.equal(result.report.successfulSlots, 8)
    assert.equal(result.report.packetCount, 7)
    assert.equal(result.report.status, 'incomplete')
  }
})

test('rejects over-budget slots before dispatch', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-budget-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const adapter: OfflineGenerationAdapter = { generate: async () => { calls += 1; throw new Error('must not run') } }
  const manifest = createOfflineManifest('budget-run', 25, { perStory: 0.001, wholeRun: 0.001 })
  const result = await new WritingQualityExperimentService(await WritingQualityRunStore.open(root, 'budget-run'), adapter).run(manifest)
  assert.equal(calls, 0)
  assert.equal(result.events.length, 9)
  assert.equal(result.events.every(event => event.status === 'budget-rejected'), true)
  assert.equal(result.report.estimatedSyntheticCostCny, 0)
})

test('closes a dangling reservation as interrupted and never redispatches that slot', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-interrupted-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const manifest = createOfflineManifest('interrupted-run', 26)
  const store = await WritingQualityRunStore.open(root, manifest.runId)
  await store.writeManifest(manifest)
  const slot = manifest.slots[0]!
  const input = freezeSlotInput(manifest, slot)
  const reserveCost = calculateSyntheticCost({ inputTokens: 2000, outputTokens: 3000, totalTokens: 5000 }, manifest.syntheticPriceBasis)
  await store.appendAttempt(sealAttemptEvent({
    version: 1, runId: manifest.runId, eventId: 'dangling-reserved', attemptId: 'dangling-attempt', sequence: 1,
    previousEventHash: null, ...slot, attempt: 1, status: 'reserved', inputHash: input.inputHash,
    outputId: null, outputHash: null, narrativeCharacters: null, usage: null, reservedCostCny: reserveCost,
    actualCostCny: null, startedAt: '2026-09-20T10:00:00.000Z', finishedAt: null, errorCode: null, synthetic: true
  }))
  const called: FrozenSlotInput[] = []
  const fallback = new DeterministicOfflineWritingAdapter()
  const adapter: OfflineGenerationAdapter = { generate: async (value, signal) => { called.push(value); return fallback.generate(value, signal) } }
  const result = await new WritingQualityExperimentService(store, adapter, () => new Date('2026-09-20T12:00:00.000Z')).run(manifest)
  assert.equal(called.some(item => item.slot.storyId === slot.storyId && item.slot.arm === slot.arm), false)
  assert.equal(result.events.some(event => event.attemptId === 'dangling-attempt' && event.status === 'interrupted'), true)
  assert.equal(result.report.successfulSlots, 8)
})

test('detects output tampering on replay', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-tamper-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const manifest = createOfflineManifest('tamper-run', 27)
  const store = await WritingQualityRunStore.open(root, manifest.runId)
  const service = new WritingQualityExperimentService(store, new DeterministicOfflineWritingAdapter(), () => new Date('2026-09-20T12:00:00.000Z'))
  await service.run(manifest)
  const outputId = stableAnonymousId(manifest.seed, manifest.slots[0]!.storyId, manifest.slots[0]!.arm)
  await writeFile(join(store.runRoot, 'outputs', `${outputId}.txt`), 'tampered', 'utf8')
  await assert.rejects(() => service.run(manifest), /实验输出与事件账本不一致/)
  assert.equal(reduceAttemptEvents(await store.readAttemptValues(), manifest).events.length, 18)
  assert.equal(sha256('tampered').length, 64)
})

test('rejects tampered manifest, ledger, blind packet and identity map on resume', async (context) => {
  for (const target of ['manifest', 'ledger', 'packet', 'identity'] as const) {
    const root = await mkdtemp(join(tmpdir(), `lanjian-quality-${target}-tamper-`))
    context.after(() => rm(root, { recursive: true, force: true }))
    const runId = `${target}-tamper-run`
    const manifest = createOfflineManifest(runId, 40)
    const store = await WritingQualityRunStore.open(root, runId)
    const service = new WritingQualityExperimentService(store, new DeterministicOfflineWritingAdapter(), () => new Date('2026-09-20T12:00:00.000Z'))
    await service.run(manifest)
    if (target === 'manifest') {
      const path = join(store.runRoot, 'manifest.json')
      const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      value.seed = 41
      await writeFile(path, JSON.stringify(value), 'utf8')
      await assert.rejects(() => service.run(manifest), /manifest.*不一致/)
    } else if (target === 'ledger') {
      const path = join(store.runRoot, 'attempts.jsonl')
      const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')
      const value = JSON.parse(lines[1]!) as Record<string, unknown>
      value.actualCostCny = 999
      lines[1] = JSON.stringify(value)
      await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
      await assert.rejects(() => service.run(manifest), /event hash/)
    } else if (target === 'packet') {
      const path = join(store.runRoot, 'packets', 'xuanhuan-pair-1.json')
      const value = JSON.parse(await readFile(path, 'utf8')) as { candidates: Array<{ content: string }> }
      value.candidates[0]!.content = 'tampered packet'
      await writeFile(path, JSON.stringify(value), 'utf8')
      await assert.rejects(() => service.run(manifest), /packet hash/)
    } else {
      const path = join(store.runRoot, 'identity-map.json')
      const value = JSON.parse(await readFile(path, 'utf8')) as { mappings: Array<{ arm: string }> }
      value.mappings[0]!.arm = 'v3-full-flow'
      await writeFile(path, JSON.stringify(value), 'utf8')
      await assert.rejects(() => service.run(manifest), /identity hash/)
    }
  }
})
