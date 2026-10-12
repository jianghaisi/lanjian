import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import { localPromptProfiles, type ModelManifest, type VerifiedModelAssets } from '../../../src/main/modules/models/domain/local-models'
import { decodeLocalModel, type LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { compileGeneration } from '../../../src/contracts/models/generation-parameters'
import { LOCAL_CONNECTION_ID } from '../../../src/contracts/models/local-model-contracts'

const first = localModelCatalog[0], second = localModelCatalog.find(m => m.id === 'deepseek-r1-distill-qwen-7b-q4_k_m')!
const assets = { root: 'fixture', modelPath: 'unused', python: 'unused', sitePackages: 'unused', fingerprint: 'fixture' }
test('all local manifests expose matching v2 preview limits and defaults; overriding the final model clears old custom numbers', async () => {
  for (const m of localModelCatalog) {
    const generation = compileGeneration({ connectionId: LOCAL_CONNECTION_ID, model: m.id, parameterPolicy: { version: 2, mode: 'auto' } }, 'prose', { protocol: 'local', model: m.id, localLimits: m })
    assert.equal(generation.outputTokens, m.recommendedOutputTokens)
    assert.equal(generation.parameters.temperature, m.samplingDefaults!.temperature)
    assert.equal(generation.parameters.top_p, m.samplingDefaults!.topP)
    assert.equal(generation.capabilities.contextTokens, m.contextTokens)
  }
  const f = fixture(); await f.service.inspect(second.id); f.calls.length = 0
  const c = { kind: 'local' as const, connectionId: LOCAL_CONNECTION_ID, connectionName: '本地', profile: { connectionId: LOCAL_CONNECTION_ID, model: first.id, parameterPolicy: { version: 2 as const, mode: 'custom' as const, overrides: { temperature: 0, topP: .1, maxTokens: 128 } } } }
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c }, f.service)
  const preview = await ai.generationFor('prose', second.id)
  await ai.complete('合成正文', '', '', 'prose', undefined, second.id)
  const sent = f.calls.at(-1)!.input
  assert.equal(sent.maxTokens, preview.outputTokens); assert.equal(sent.temperature, second.samplingDefaults!.temperature)
  assert.equal(sent.topP, second.samplingDefaults!.topP); assert.equal(c.profile.parameterPolicy.overrides.temperature, 0)
})
function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function fixture(wait?: (manifest: ModelManifest, signal: AbortSignal) => Promise<void>) {
  let stored: LocalModelView[] = []
  const calls: Array<{ assets: VerifiedModelAssets; input: LocalTextRequest }> = []
  const service = new LocalModelService([first, second], {
    discover: async () => true,
    installationInfo: async m => { await wait?.(m, new AbortController().signal); return { canDownload: true, downloadBytes: 1, requiredDiskBytes: 2 } },
    prepare: async m => ({ ...assets, modelPath: m.id, fingerprint: m.id }),
    install: async m => ({ ...assets, modelPath: m.id, fingerprint: m.id })
  }, {
    run: async (a, input) => {
      calls.push({ assets: a, input })
      return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 4, seconds: 0 }
    }, stop() {}
  }, { read: async () => stored, save: async rows => { stored = structuredClone(rows) } })
  return { service, calls, stored: () => stored }
}

test('catalog preserves installed identity and only offers pinned single-file manifests with explicit provenance', () => {
  assert.equal(localModelCatalog.length, 16)
  assert.equal(new Set(localModelCatalog.map(m => m.id)).size, 16)
  assert.equal(first.id, 'qwen3-1.7b-q8_0')
  assert.equal(first.files[0].sha256, '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a')
  assert.equal(first.revision, '90862c4b9d2787eaed51d12237eafdfe7c5f6077')
  assert.equal(localModelCatalog.filter(m => m.developmentStatus === 'tested').length, 1)
  for (const m of localModelCatalog) {
    assert.ok(localPromptProfiles.includes(m.promptProfile!)); assert.ok(m.publisher)
    assert.ok(['official', 'community'].includes(m.publisherKind!))
    assert.equal(m.files.length, 1); assert.match(m.revision, /^[a-f0-9]{40}$/)
    const file = m.files[0], url = new URL(file.url)
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'huggingface.co')
    assert.ok(url.pathname.includes('/resolve/' + m.revision + '/'))
    assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0)
  }
})

test('metadata projection upgrades old records without writing and does not convert untested inventory to readiness', async () => {
  const f = fixture(), [row] = await f.service.list()
  assert.equal(f.calls.length, 0); assert.equal(row.state, 'detected'); assert.deepEqual(row.capabilities, [])
  const { publisher, publisherKind, developmentStatus, ...legacy } = row
  assert.equal(decodeLocalModel(legacy).id, first.id)
  for (const value of [{ ...row, publisherKind: 'unknown' }, { ...row, developmentStatus: 'ready' }, { ...row, publisher: 2 }, { ...row, downloadUrl: 'https://wrong.example' }]) assert.throws(() => decodeLocalModel(value))
  assert.deepEqual(f.stored(), [])
})

test('different model cannot enter during preflight; closing owner releases only its pending claim', async () => {
  const entered = barrier(), held = barrier()
  const f = fixture(async m => { if (m.id === first.id) { entered.release(); await held.promise } })
  const pending = f.service.install(first.id, 7)
  await entered.promise
  await assert.rejects(f.service.install(second.id, 8), /另一模型/)
  assert.throws(() => f.service.inspect(second.id, 8), /另一模型/)
  const cancelled = assert.rejects(pending, { name: 'AbortError' })
  f.service.clearOwner(7)
  const next = await f.service.install(second.id, 8)
  assert.ok(next.operationId)
  held.release(); await cancelled; await setImmediate()
  assert.equal(f.stored().find(m => m.id === second.id)?.state, 'ready')
  assert.equal(f.stored().find(m => m.id === first.id)?.state, 'not-installed')
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls.every(c => c.assets.promptProfile === 'deepseek-r1' && c.assets.modelPath === second.id))
})

test('active inspection blocks another model, stale cancellation cannot stop it and failure releases admission', async () => {
  const entered = barrier(), held = barrier()
  const f = fixture()
  const service = new LocalModelService([first, second], {
    discover: async () => true,
    prepare: async (m, signal) => { if (m.id === first.id) { entered.release(); await held.promise; signal.throwIfAborted() }; return assets }
  }, { run: async () => { throw Error('fixture failure') }, stop() {} }, { read: async () => [], save: async () => {} })
  const pending = service.inspect(first.id, 7); await entered.promise
  assert.throws(() => service.inspect(second.id, 8), /另一模型/)
  const row = (await service.list()).find(m => m.id === first.id)!
  assert.equal(service.cancel(second.id, 8, row.operationId), false)
  assert.equal(service.cancel(first.id, 7, row.operationId), true)
  held.release(); assert.equal((await pending).state, 'cancelled')
  assert.equal((await service.inspect(second.id, 8)).state, 'failed')
  assert.equal((await service.inspect(first.id, 7)).state, 'failed')
  assert.equal(f.calls.length, 0)
})

test('inspection and generation bind each model profile, with a bounded R1 thought budget and independent states', async () => {
  const f = fixture()
  await f.service.inspect(first.id)
  await f.service.inspect(second.id)
  assert.deepEqual(f.calls.slice(0, 3).map(c => c.assets.promptProfile), ['qwen3', 'qwen3', 'qwen3'])
  assert.deepEqual(f.calls.slice(3).map(c => c.assets.promptProfile), ['deepseek-r1', 'deepseek-r1', 'deepseek-r1'])
  assert.equal(f.calls[3].input.maxTokens, 512)
  await f.service.complete({ model: second.id, profile: { connectionId: 'local:llama-cpp', model: second.id, maxTokens: 256, temperature: .6, topP: .9 }, messages: [{ role: 'user', content: '写一段' }] })
  assert.equal(f.calls.at(-1)?.assets.promptProfile, 'deepseek-r1')
  assert.equal(f.calls.at(-1)?.assets.fingerprint, second.id)
  assert.ok(f.stored().every(m => m.state === 'ready'))
})

test('a failed generation cannot persist stale progress over a different model becoming ready', async () => {
  const seed = fixture(); await seed.service.inspect(first.id)
  let stored = seed.stored(), failFirst = false
  const savingSecond = barrier(), releaseSave = barrier(), generationFailed = barrier()
  const service = new LocalModelService([first, second], {
    discover: async () => true,
    prepare: async m => {
      if (m.id === first.id && failFirst) { generationFailed.release(); throw Error('damaged fixture') }
      return { ...assets, fingerprint: m.id }
    }
  }, {
    run: async (_a, input) => ({ content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 4, seconds: 0 }), stop() {}
  }, {
    read: async () => stored,
    save: async rows => {
      if (rows.some(row => row.id === second.id && row.state === 'ready') && !stored.some(row => row.id === second.id && row.state === 'ready')) { savingSecond.release(); await releaseSave.promise }
      stored = structuredClone(rows)
    }
  })
  const inspection = service.inspect(second.id); await savingSecond.promise
  failFirst = true
  const generation = assert.rejects(service.complete({ model: first.id, profile: { connectionId: 'local:llama-cpp', model: first.id, maxTokens: 128, temperature: .5, topP: .9 }, messages: [{ role: 'user', content: '写作' }] }))
  await generationFailed.promise; await setImmediate(); releaseSave.release()
  await inspection; await generation
  assert.equal(stored.find(row => row.id === first.id)?.state, 'failed')
  assert.equal(stored.find(row => row.id === second.id)?.state, 'ready')
  assert.equal((await service.list()).find(row => row.id === second.id)?.state, 'ready')
})
