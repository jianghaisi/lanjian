import assert from 'node:assert/strict'
import test from 'node:test'
import { THINKING_LEVELS } from '../../../src/contracts/models/thinking-level'
import { modelConnectionArgs, modelConnectionResults } from '../../../src/contracts/models/model-connections-contracts'
import { modelProfile } from '../../../src/contracts/models/validation'
import { defaultLegacyBookModelSettings, decodeBookModelSettings, serializeBookModelSettings } from '../../../src/contracts/models/book-model-settings'
import { applyBookModelAssignment } from '../../../src/main/modules/models/domain/book-model-assignments'
import { bookModelConfigInputs } from '../../../src/main/modules/models/adapters/book-model-configs'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { consumeGeminiStream, extractFinalText } from '../../../src/main/modules/models/adapters/gemini-native-text-client'

const base = () => ({ kind: 'gemini-native' as const, connectionId: 'native', connectionName: '合成接口', baseUrl: 'https://native.example.test', apiKey: 'synthetic-secret',
  profile: { connectionId: 'native', model: 'gemini-3.8-flash', temperature: .7, topP: .9, maxTokens: 8192, thinkingLevel: 'high' as const } })
const success = () => Response.json({ candidates: [{ content: { parts: [{ text: '私有思考', thought: true }, { text: '正文' }] }, finishReason: 'STOP' }] })
const probe = { id: 'global-test', revision: 1, model: 'gemini-3.8-flash' }

test('legacy profiles remain byte-stable; optional thinking roundtrips through patch, document and projection', () => {
  const old = defaultLegacyBookModelSettings(), bytes = JSON.stringify(old)
  assert.equal(serializeBookModelSettings(old), bytes)
  assert.equal(Object.hasOwn(decodeBookModelSettings(old).shared, 'thinkingLevel'), false)
  for (const thinkingLevel of THINKING_LEVELS) {
    const patched = applyBookModelAssignment(old, { shared: { thinkingLevel }, tasks: { review: { thinkingLevel } } }).settings
    assert.equal(decodeBookModelSettings(JSON.parse(serializeBookModelSettings(patched))).shared.thinkingLevel, thinkingLevel)
    assert.equal(patched.tasks.review.thinkingLevel, thinkingLevel)
    assert.equal(JSON.parse(bookModelConfigInputs(patched)[0].settingsJson).thinkingLevel, thinkingLevel)
    assert.deepEqual(modelProfile({ thinkingLevel }, 'profile'), { thinkingLevel })
  }
  assert.equal(JSON.stringify(old), bytes)
  const high = applyBookModelAssignment(old, { shared: { thinkingLevel: 'high' } }).settings
  assert.equal(applyBookModelAssignment(high, { shared: { thinkingLevel: 'default' } }).settings.shared.thinkingLevel, 'default')
})

test('strict boundaries reject invalid thinking values instead of treating them as default', () => {
  for (const thinkingLevel of [null, undefined, false, 1, 'HIGH', 'minimal', ' high ', {}, ['high']]) {
    assert.throws(() => modelProfile({ thinkingLevel }, 'profile'), { code: 'VALIDATION_ERROR' })
    assert.throws(() => modelConnectionArgs.test([{ ...probe, thinkingLevel }]), { code: 'VALIDATION_ERROR' })
    const old = defaultLegacyBookModelSettings()
    assert.throws(() => decodeBookModelSettings({ ...old, shared: { ...old.shared, thinkingLevel } }), { code: 'VALIDATION_ERROR' })
    assert.throws(() => modelConnectionResults.test({ ...probe, thinkingLevel, testedAt: '2026-09-20T00:00:00Z', success: true, models: [], message: '完成' }), { code: 'VALIDATION_ERROR' })
  }
  assert.deepEqual(modelConnectionArgs.test([probe]), [probe])
  assert.throws(() => modelConnectionArgs.catalog([{ ...probe, thinkingLevel: 'high' }]), { code: 'VALIDATION_ERROR' })
})

test('native generation uses separate thinking config, snapshots it and preserves exact model IDs', async t => {
  const c = { ...base(), profile: { ...base().profile, thinkingLevel: 'high' as 'high' | 'low' } }, bodies: any[] = [], urls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { urls.push(String(url)); bodies.push(JSON.parse(String(init.body))); return success() })
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  const prepared = await ai.prepareCompletion('prose')
  c.profile.thinkingLevel = 'low'
  assert.equal((await prepared.complete('合成指令')).content, '正文')
  assert.equal((await ai.streamComplete('合成指令')).content, '正文')
  assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, 'high')
  assert.equal(bodies[1].generationConfig.thinkingConfig.thinkingLevel, 'low')
  assert.ok(urls.every(url => url.includes('/gemini-3.8-flash:') && !url.includes('-high')))
  assert.ok(bodies.every(body => body.generationConfig.maxOutputTokens === 8192 && !body.generationConfig.thinkingConfig.includeThoughts))
})

test('default and absent thinking send no new provider field', async t => {
  const bodies: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return success() })
  for (const level of [undefined, 'default'] as const) {
    const c = { ...base(), profile: { ...base().profile, thinkingLevel: level } }
    const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
    await ai.complete('fixture')
  }
  assert.ok(bodies.every(body => !Object.hasOwn(body.generationConfig, 'thinkingConfig')))
})

test('non-native protocols reject explicit thinking before any generation, including local and streaming', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('unsupported request must not send'))
  for (const kind of ['openai-compatible', 'local'] as const) {
    const c = kind === 'local'
      ? { kind: 'local' as const, connectionId: 'local:llama-cpp', connectionName: '本地', profile: base().profile }
      : { ...base(), kind: 'openai-compatible' as const }
    const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
    await assert.rejects(ai.complete('fixture'), { code: 'FEATURE_UNAVAILABLE' })
    await assert.rejects(ai.streamComplete('fixture'), { code: 'FEATURE_UNAVAILABLE' })
    await assert.rejects(ai.prepareToolConversation('review'), { code: 'FEATURE_UNAVAILABLE' })
  }
})

test('provider refusal never retries, downgrades or exposes raw errors; network and auth errors stay distinct', async t => {
  const c = base(), ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  for (const status of [400, 422, 401, 429, 503]) {
    let sends = 0
    t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response('synthetic-secret private-provider-body', { status }) })
    await assert.rejects(ai.complete('fixture'), (error: any) => {
      assert.equal(error.code, 'FEATURE_UNAVAILABLE')
      assert.doesNotMatch(error.message, /synthetic-secret|private-provider-body/)
      if ([400, 422].includes(status)) assert.match(error.message, /思考强度.*未自动降级/)
      else assert.doesNotMatch(error.message, /不支持所选思考强度/)
      return true
    })
    assert.equal(sends, 1)
    t.mock.restoreAll()
  }
  let networkSends = 0
  t.mock.method(globalThis, 'fetch', async () => { networkSends++; throw new TypeError('private-network-data') })
  await assert.rejects(ai.complete('fixture'), /网络和本机代理/)
  assert.equal(networkSends, 1)
})

test('budget exhaustion is actionable even without content and cannot return partial stream as success', async () => {
  assert.throws(() => extractFinalText({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), /思考和正文共用/)
  const response = new Response('data: {"candidates":[{"content":{"parts":[{"text":"片段"}]}}]}\n\ndata: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\n\n')
  await assert.rejects(consumeGeminiStream(response), /结果不完整/)
})

test('cancelled high-thinking request stops once and sends no fallback', async t => {
  const c = base(), controller = new AbortController(), ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  let sends = 0
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sends++; controller.abort(); init.signal!.throwIfAborted(); return success()
  })
  await assert.rejects(ai.complete('fixture', '', '', 'prose', controller.signal), { name: 'AbortError' })
  assert.equal(sends, 1)
})
