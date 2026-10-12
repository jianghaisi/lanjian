import assert from 'node:assert/strict'
import test from 'node:test'
import { compileGeneration, modelCapabilities } from '../../../src/contracts/models/generation-parameters'
import { decodeParameterPolicy, type ParameterOverrides } from '../../../src/contracts/models/parameter-policy'
import { decodeCatalogEntry } from '../../../src/contracts/models/model-catalog-metadata'
import { decodeBookModelSettings, defaultLegacyBookModelSettings, referenceBookModelSettings } from '../../../src/contracts/models/book-model-settings'
import { decodeModelDefaultTemplate } from '../../../src/contracts/models/new-book-model-defaults'
import { applyBookModelAssignment } from '../../../src/main/modules/models/domain/book-model-assignments'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import type { AdaptiveModelProfile } from '../../../src/contracts/models/types'
import { LOCAL_QWEN_LIMITS } from '../../../src/contracts/models/local-model-contracts'
import { validateBookParameters } from '../../../src/main/modules/models/domain/validate-book-parameters'
import { BOOK_MODEL_TASKS, type ReferencedBookModelSettings } from '../../../src/contracts/models/book-model-settings'

const auto = (model = 'gemini-3.8-flash'): AdaptiveModelProfile => ({ connectionId: 'writer', model, parameterPolicy: { version: 1, mode: 'auto' } })
const custom = (overrides: ParameterOverrides, model = 'gemini-3.8-flash'): AdaptiveModelProfile => ({ ...auto(model), parameterPolicy: { version: 1, mode: 'custom', overrides } })
const google = { protocol: 'gemini-native' as const, baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.8-flash' }
const openai = { protocol: 'openai-compatible' as const, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }

function budgetSettings(): ReferencedBookModelSettings {
  const p = auto('gemini-2.5-flash')
  return { version: 5, routingMode: 'shared', references: [{ kind: 'global', id: 'writer', globalConnectionId: 'global-budget' }], shared: p,
    tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, structuredClone(p)])) as ReferencedBookModelSettings['tasks'] }
}
const budgetSource = [{ id: 'global-budget', revision: 1, protocol: 'gemini-native' as const, baseUrl: google.baseUrl }]

for (const entry of [
  { key: 'temperature', label: /采样随机性.*temperature/, range: /0.*2/, values: [-.1, 2.1, NaN] },
  { key: 'topP', label: /采样范围.*top_p/, range: /0.*1/, values: [-.1, 1.1, Infinity] },
  { key: 'maxTokens', label: /最大输出/, range: /128.*128000.*整数/, values: [127, 128001, 128.5] },
  { key: 'thinking', label: /思考预算/, range: /0.*128000.*整数/, values: [-1, 128001, 128.5] },
]) {
  test(`invalid ${entry.key} identifies the field, permitted range and explicit recovery without reflecting raw input`, () => {
    for (const value of [...entry.values, 'synthetic-secret-sentinel', null, undefined, {}]) {
      const overrides = { [entry.key]: entry.key === 'thinking' ? { kind: 'budget', tokens: value } : value }
      assert.throws(() => decodeParameterPolicy({ version: 1, mode: 'custom', overrides }), (cause: unknown) => {
        assert.ok(cause instanceof Error)
        assert.match(cause.message, entry.label); assert.match(cause.message, entry.range)
        assert.match(cause.message, /清空.*自动/)
        assert.doesNotMatch(cause.message, /synthetic-secret-sentinel|NaN|Infinity|undefined|\[object Object\]/)
        return true
      })
    }
  })
}

test('endpoint numeric metadata errors do not masquerade as author parameter guidance', () => {
  assert.throws(() => decodeCatalogEntry({ id: 'writer', outputTokenLimit: 0 }), { message: '模型参数无效，请检查后重试。' })
})

test('confirmed model limits report the selected value, allowed bound and correction without modifying intent', () => {
  const target = { ...google, metadata: { id: google.model, maxTemperature: 1, outputTokenLimit: 4096 } }
  for (const entry of [
    { profile: custom({ temperature: 1.5 }), message: /temperature.*1\.5.*0.*1.*清空/ },
    { profile: custom({ maxTokens: 8192 }), message: /8192.*4096.*清空/ },
  ]) {
    const before = structuredClone(entry.profile)
    assert.throws(() => compileGeneration(entry.profile, 'prose', target), { code: 'VALIDATION_ERROR', message: entry.message })
    assert.deepEqual(entry.profile, before)
  }
  const thinking = { ...google, model: 'gemini-2.5-pro' }
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'budget', tokens: 0 } }, thinking.model), 'prose', thinking),
    { code: 'VALIDATION_ERROR', message: /思考预算.*0.*128.*32768.*清空/ })
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'budget', tokens: 32769 } }, thinking.model), 'prose', thinking),
    { code: 'VALIDATION_ERROR', message: /思考预算.*32769.*128.*32768/ })
})

test('thinking/output conflicts explain both budgets without promising a larger model limit', () => {
  const target = { ...google, model: 'gemini-2.5-flash' }, p = custom({ thinking: { kind: 'budget', tokens: 12000 } }, target.model)
  assert.throws(() => compileGeneration(p, 'review', target), { code: 'VALIDATION_ERROR', message: /12000.*8192.*降低思考预算.*清空/ })
  assert.throws(() => compileGeneration(p, 'prose', { ...target, metadata: { id: target.model, outputTokenLimit: 4096 } }),
    { code: 'VALIDATION_ERROR', message: /12000.*4096.*型号.*范围/ })
  assert.equal(p.parameterPolicy.mode, 'custom')
})

test('shared adaptive thinking must fit chapter/review automatic budgets as well as prose', () => {
  const settings = budgetSettings()
  settings.shared = custom({ thinking: { kind: 'budget', tokens: 12000 } }, 'gemini-2.5-flash')
  assert.equal(compileGeneration(settings.shared, 'prose', { ...google, model: settings.shared.model }).outputTokens, 16384)
  assert.throws(() => validateBookParameters(settings, budgetSource), /思考预算/)
  settings.shared = custom({ maxTokens: 16384, thinking: { kind: 'budget', tokens: 12000 } }, 'gemini-2.5-flash')
  assert.doesNotThrow(() => validateBookParameters(settings, budgetSource))
  for (const task of BOOK_MODEL_TASKS) assert.equal(compileGeneration(settings.shared, task, { ...google, model: settings.shared.model }).outputTokens, 16384)
})

test('independent prose may keep a larger thinking budget; untouched inactive shared intent is checked on activation', () => {
  const baseline = budgetSettings(); baseline.routingMode = 'perTask'
  baseline.shared = custom({ thinking: { kind: 'budget', tokens: 12000 } }, 'gemini-2.5-flash')
  const changed = structuredClone(baseline); changed.tasks.prose = structuredClone(baseline.shared)
  assert.doesNotThrow(() => validateBookParameters(changed, budgetSource, undefined, baseline))
  const active = { ...changed, routingMode: 'shared' as const }
  assert.throws(() => validateBookParameters(active, budgetSource, undefined, changed), /思考预算/)
  changed.shared = custom({ thinking: { kind: 'budget', tokens: 10000 } }, 'gemini-2.5-flash')
  assert.throws(() => validateBookParameters(changed, budgetSource, undefined, baseline), /思考预算/)
})

test('legacy shared settings retain their original budget without adaptive migration', () => {
  const settings = budgetSettings()
  settings.shared = { connectionId: 'writer', model: 'gemini-2.5-flash', temperature: .5, topP: 1, maxTokens: 12000 }
  const before = JSON.stringify(settings)
  validateBookParameters(settings, budgetSource)
  assert.equal(JSON.stringify(settings), before)
})

test('unknown output notes distinguish explicit budgets from automatic compatibility budgets', () => {
  const target = { ...google, baseUrl: 'https://gateway.example.test' }
  const explicit = compileGeneration(custom({ maxTokens: 3072 }), 'prose', target)
  assert.equal(explicit.parameters.maxOutputTokens, 3072)
  assert.match(explicit.notes.join(' '), /自定义.*3072/)
  assert.doesNotMatch(explicit.notes.join(' '), /使用兼容输出预算/)
  for (const policy of [auto(), custom({})]) {
    const automatic = compileGeneration(policy, 'prose', target)
    assert.equal(automatic.parameters.maxOutputTokens, 8192)
    assert.match(automatic.notes.join(' '), /兼容输出预算/)
  }
})

test('automatic creative budgets vary by task and omit optional sampling/thinking; unknown gateways never inherit official identity', () => {
  assert.deepEqual(compileGeneration(auto(), 'prose', google).parameters, { maxOutputTokens: 16384 })
  assert.deepEqual(compileGeneration(auto(), 'review', google).parameters, { maxOutputTokens: 8192 })
  assert.deepEqual(compileGeneration(auto(), 'prose', google, 'probe').parameters, { maxOutputTokens: 8192 })
  assert.equal(compileGeneration(auto('gpt-4.1'), 'prose', { ...openai, model: 'gpt-4.1' }, 'probe').outputTokens, 128)
  const gateway = { ...google, baseUrl: 'https://my-gateway.example.test' }
  assert.equal(modelCapabilities(gateway).thinking.status, 'unknown')
  assert.deepEqual(compileGeneration(auto(), 'prose', gateway).parameters, { maxOutputTokens: 8192 })
  assert.deepEqual(compileGeneration(auto(), 'prose', { ...gateway, metadata: { id: google.model } }).parameters, { maxOutputTokens: 8192 })
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'effort', value: 'high' } }), 'prose', gateway))
  assert.equal(modelCapabilities({ ...google, baseUrl: 'https://generativelanguage.googleapis.com.evil.test' }).source, 'unknown')
  assert.equal(modelCapabilities({ ...google, model: 'gemini-3.8-flash-high' }).thinking.status, 'unknown')
})

test('explicit zero survives and automatic tokens clamp to endpoint metadata; thinking boolean is not an enum', () => {
  const target = { ...google, baseUrl: 'https://gateway.example.test', metadata: { id: google.model, outputTokenLimit: 4096, maxTemperature: 2, topP: .95, thinking: true } }
  const effective = compileGeneration(custom({ temperature: 0, topP: 0 }), 'prose', target)
  assert.deepEqual(effective.parameters, { maxOutputTokens: 4096, temperature: 0, topP: 0 })
  assert.equal(effective.capabilities.thinking.status, 'unknown')
  assert.throws(() => compileGeneration(custom({ maxTokens: 8192 }), 'prose', target), /4096/)
  assert.throws(() => compileGeneration(auto(), 'prose', { ...target, metadata: { id: google.model, supportedGenerationMethods: ['embedContent'] } }), /文字模型/)
})

test('Gemini exact-model thinking levels and budgets use distinct wire fields and validate combinations', () => {
  assert.deepEqual(compileGeneration(custom({ thinking: { kind: 'effort', value: 'medium' } }), 'prose', google).parameters.thinkingConfig, { thinkingLevel: 'medium' })
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'effort', value: 'minimal' } }), 'prose', google))
  const target = { ...google, model: 'gemini-2.5-flash' }
  assert.deepEqual(compileGeneration(custom({ thinking: { kind: 'budget', tokens: 0 } }, target.model), 'prose', target).parameters.thinkingConfig, { thinkingBudget: 0 })
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'budget', tokens: 16384 } }, target.model), 'prose', target), /正文/)
  assert.throws(() => compileGeneration(custom({ thinking: { kind: 'budget', tokens: 0 } }, 'gemini-2.5-pro'), 'prose', { ...target, model: 'gemini-2.5-pro' }))
})

test('OpenAI reasoning uses completion ceiling, validates sampling combinations and tools compatibility', () => {
  assert.deepEqual(compileGeneration(custom({ thinking: { kind: 'effort', value: 'high' } }, 'gpt-5'), 'prose', openai).parameters, { max_completion_tokens: 16384, reasoning_effort: 'high' })
  assert.throws(() => compileGeneration(custom({ temperature: .8 }, 'gpt-5'), 'prose', openai))
  assert.throws(() => compileGeneration(custom({ temperature: .8 }, 'gpt-5.6-sol'), 'prose', { ...openai, model: 'gpt-5.6-sol' }), /none/)
  assert.equal(compileGeneration(custom({ temperature: .8, thinking: { kind: 'effort', value: 'none' } }, 'gpt-5.6-sol'), 'prose', { ...openai, model: 'gpt-5.6-sol' }).parameters.temperature, .8)
  assert.throws(() => compileGeneration(auto('gpt-6.1-sol'), 'prose', { ...openai, model: 'gpt-6.1-sol' }, 'tools'), /工具/)
})

test('local automatic parameters use manifest output limits', () => {
  const result = compileGeneration(auto('local'), 'prose', { protocol: 'local', model: 'local', localLimits: LOCAL_QWEN_LIMITS })
  assert.equal(result.outputTokens, 2048)
  assert.throws(() => compileGeneration(custom({ maxTokens: 8192 }, 'local'), 'prose', { protocol: 'local', model: 'local', localLimits: LOCAL_QWEN_LIMITS }))
})

test('strict intent decoder rejects nulls, nonfinite values, incompatible union fields and unknown fields', () => {
  for (const value of [null, {}, { version: 3, mode: 'auto' }, { version: 1, mode: 'auto', overrides: {} }, ...[null, NaN, Infinity, -1, '0'].map(temperature => ({ version: 1, mode: 'custom', overrides: { temperature } })),
    { version: 1, mode: 'custom', overrides: { maxTokens: 128.5 } }, { version: 1, mode: 'custom', overrides: { extra: true } },
    { version: 1, mode: 'custom', overrides: { thinking: { kind: 'effort', value: 'high', tokens: 100 } } }]) assert.throws(() => decodeParameterPolicy(value))
  assert.throws(() => decodeCatalogEntry({ id: 'm', outputTokenLimit: '4096' }))
  assert.throws(() => decodeCatalogEntry({ id: 'm', temperature: null }))
  assert.throws(() => decodeCatalogEntry({ id: 'm', apiKey: 'secret' }))
})

test('v5 explicit upgrade preserves inactive legacy slots and private references, reads and defaults roundtrip', () => {
  const old = defaultLegacyBookModelSettings(), bytes = JSON.stringify(old)
  const next = applyBookModelAssignment(old, { shared: { ...auto(), connectionId: 'primary' } }).settings
  assert.equal(next.version, 5)
  assert.deepEqual(next.tasks, old.tasks)
  assert.deepEqual(decodeBookModelSettings(JSON.parse(JSON.stringify(next))), next)
  assert.equal(JSON.stringify(old), bytes)
  const refs = referenceBookModelSettings(next)
  assert.equal(refs.references[0].kind, 'legacy-private')
  assert.throws(() => decodeBookModelSettings({ ...next, version: 4 }))
  assert.throws(() => decodeBookModelSettings({ ...next, shared: { ...next.shared, temperature: .5 } }))
  const template = { ...next, references: [{ kind: 'global', id: 'primary', globalConnectionId: 'global-a' }] }
  assert.equal(decodeModelDefaultTemplate(template).version, 5)
})

test('ordinary, streaming and tools send identical effective parameters, with no legacy leakage', async t => {
  const requests: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return Response.json({ choices: [{ message: { content: '正文' }, finish_reason: 'stop' }] }) })
  const c = { kind: 'openai-compatible' as const, connectionId: 'writer', connectionName: 'test', baseUrl: openai.baseUrl, apiKey: 'synthetic', profile: custom({ thinking: { kind: 'effort', value: 'high' } }, 'gpt-5') }
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  await ai.complete('test'); await ai.streamComplete('test')
  await (await ai.prepareToolConversation('prose')).step([{ role: 'user', content: 'test' }], [], new AbortController().signal)
  for (const body of requests) {
    assert.equal(body.reasoning_effort, 'high'); assert.equal(body.max_completion_tokens, 16384)
    assert.equal('temperature' in body, false); assert.equal('top_p' in body, false); assert.equal('max_tokens' in body, false)
  }
})

test('run snapshots deep-copy intent and metadata; one-off model override recompiles automatic parameters', async t => {
  const requests: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return Response.json({ choices: [{ message: { content: 'text' } }] }) })
  const c = { kind: 'openai-compatible' as const, connectionId: 'writer', connectionName: 'test', baseUrl: openai.baseUrl, apiKey: 'synthetic', profile: custom({ temperature: .5, maxTokens: 12000 }, 'gpt-4.1-mini') }
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c }), run = await ai.captureRun(['prose'])
  const identity = await run.completionIdentity('prose')
  if (c.profile.parameterPolicy.mode === 'custom') { c.profile.parameterPolicy.overrides.temperature = 1; c.profile.parameterPolicy.overrides.maxTokens = 8192 }
  assert.equal(await run.outputTokensFor('prose'), 12000)
  assert.equal(await run.completionIdentity('prose'), identity)
  assert.notEqual(await ai.completionIdentity('prose'), identity)
  await run.complete('test')
  await run.complete('test', '', '', 'prose', undefined, 'gpt-5')
  assert.equal(requests[0].temperature, .5); assert.equal(requests[0].max_completion_tokens, 12000)
  assert.equal('temperature' in requests[1], false); assert.equal(requests[1].max_completion_tokens, 16384)
})

test('length finishes fail instead of presenting truncated text as complete on JSON and SSE', async t => {
  const c = { kind: 'openai-compatible' as const, connectionId: 'writer', connectionName: 'test', baseUrl: 'https://fixture.test/v1', apiKey: 'synthetic', profile: auto('alias') }
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }))
  await assert.rejects(ai.complete('test'), /预算上限/)
  await assert.rejects(ai.streamComplete('test'), /预算上限/)
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
  await assert.rejects(ai.streamComplete('test'), /预算上限/)
})
