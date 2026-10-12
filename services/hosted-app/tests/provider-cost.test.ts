import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeProviderTokenPolicy, type ProviderTokenPolicy } from '@lanjian/hosted-contracts'
import { usageBudget, usageCost } from '../src/credits/ledger.ts'
import { decodeUsage, UsageStream } from '../src/models/usage.ts'
import { fixture } from './helpers.ts'

export const policy: ProviderTokenPolicy = {
  mode: 'provider-tokens', currency: 'USD', usdToCny: '6.64', pointsPerCny: '20', groupName: '测试分组', groupMultiplier: '0.3', sourceVersion: 'synthetic-v1',
  tiers: [{ name: 'base', through: null, rates: { input: '2', output: '10', cacheRead: '0.1', cacheWrite: '2.5', cacheWrite1h: '4' } }]
}
test('6.64 conversion, distinct cache categories and one final ceiling are exact', () => {
  assert.equal(usageCost(policy, 1_000_000, 0), 79680)
  assert.equal(usageCost(policy, 0, 1_000_000), 398400)
  assert.equal(usageCost(policy, 1000, 100, { input: 1000, output: 100, cacheRead: 600, cacheWrite: 200, cacheWrite1h: 100 }), 87)
  assert.equal(usageCost(policy, 1, 1), 1)
  assert.equal(usageCost(policy, 0, 0), 0)
  const precise = { ...policy, groupMultiplier: '1', usdToCny: '1', pointsPerCny: '1000', tiers: [{ name: 'exact', through: null, rates: { input: '0.50000000000025', output: '0' } }] }
  assert.equal(usageCost(precise, 2, 0), 2)
  assert.throws(() => usageCost(policy, 10, 0, { input: 10, output: 0, cacheRead: 9, cacheWrite: 2 }), /usage-unconfirmed/)
})
test('tier uses full context inclusive of caches; reserve covers all possible input categories', () => {
  const tiered: ProviderTokenPolicy = { ...policy, tiers: [{ ...policy.tiers[0]!, through: 1000 }, { name: 'long', through: null, rates: { input: '4', output: '15', cacheRead: '0.2', cacheWrite1h: '8' } }] }
  assert.equal(usageCost(tiered, 1000, 0, { input: 1000, output: 0, cacheRead: 1000 }), 4)
  assert.equal(usageCost(tiered, 1001, 0, { input: 1001, output: 0, cacheRead: 1001 }), 8)
  const budget = usageBudget(tiered, 1200, 100)
  for (const input of [0, 1, 1000, 1001, 1200]) for (const key of ['cacheRead', 'cacheWrite', 'cacheWrite1h'] as const) {
    assert.ok(budget >= usageCost(tiered, input, 100, { input, output: 100, [key]: input }))
  }
})
test('provider policy validates decimals and ordered tiers, and ledger retains the old conversion', async t => {
  assert.deepEqual(decodeProviderTokenPolicy(policy), policy)
  for (const invalid of [0, '0', '6.64e0', '-1', '1.0000000000000001', '1001']) assert.throws(() => decodeProviderTokenPolicy({ ...policy, usdToCny: invalid }))
  for (const tiers of [[], [{ ...policy.tiers[0], through: 20 }], [policy.tiers[0], policy.tiers[0]], [{ ...policy.tiers[0], rates: { input: '2', output: '3', injected: '1' } }]]) assert.throws(() => decodeProviderTokenPolicy({ ...policy, tiers }))
  const f = fixture(t)
  f.credits.updatePrice('admin', 'test', { expectedVersion: 0, policy })
  f.credits.updatePrice('admin', 'test', { expectedVersion: 1, policy: { ...policy, usdToCny: '7' } })
  assert.equal(usageCost(f.credits.price('test', 1).policy, 1_000_000, 0), 79680)
  assert.equal(usageCost(f.credits.price('test').policy, 1_000_000, 0), 84000)
})
test('OpenAI inclusive counts and canonical Claude exclusive counts produce the same bill', () => {
  const expected = { input: 1000, output: 100, cacheRead: 600, cacheWrite: 200, cacheWrite1h: 100 }
  const anthropic = { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 600, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 } }
  const openai = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, usage_semantic: 'openai', prompt_tokens_details: { cached_tokens: 600, cached_creation_tokens: 300, cache_write_tokens: 300 }, claude_cache_creation_5_m_tokens: 200, claude_cache_creation_1_h_tokens: 100 }
  assert.deepEqual(decodeUsage({ usage: openai }, 'openai-compatible'), expected)
  assert.deepEqual(decodeUsage({ usage: { ...openai, prompt_tokens: 100, total_tokens: 200, usage_semantic: 'anthropic' } }, 'openai-compatible'), expected)
  assert.deepEqual(decodeUsage({ usage: { billing_usage: { semantic: 'anthropic', estimated: false, claude_usage: anthropic } } }, 'openai-compatible'), expected)
  assert.equal(decodeUsage({ usage: { billing_usage: { semantic: 'anthropic', estimated: true, claude_usage: anthropic } } }, 'openai-compatible'), null)
  assert.equal(decodeUsage({ usage: { ...openai, usage_semantic: undefined } }, 'openai-compatible'), null)
  assert.equal(decodeUsage({ usage: { ...openai, total_tokens: 1099 } }, 'openai-compatible'), null)
})
test('Gemini includes thoughts, discounts cached input, and refuses unsupported billable dimensions', () => {
  const raw = { promptTokenCount: 1000, candidatesTokenCount: 80, thoughtsTokenCount: 20, cachedContentTokenCount: 600, totalTokenCount: 1100 }
  assert.deepEqual(decodeUsage({ usageMetadata: raw }, 'gemini-native'), { input: 1000, output: 100, cacheRead: 600 })
  for (const extra of [{ totalTokenCount: 1080 }, { cachedContentTokenCount: 1001 }, { toolUsePromptTokenCount: 4 }, { promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 1 }] }]) assert.equal(decodeUsage({ usageMetadata: { ...raw, ...extra } }, 'gemini-native'), null)
})
test('chunked usage replaces earlier counts and invalid final evidence cannot retain a stale bill', () => {
  const stream = new UsageStream('openai-compatible'), encoder = new TextEncoder()
  const raw = 'data: {"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\ndata: {"usage":{"prompt_tokens":500,"completion_tokens":100,"prompt_tokens_details":{"cached_tokens":300}}}\n\n'
  const bytes = encoder.encode(raw)
  for (let i = 0; i < bytes.length; i += 7) stream.push(bytes.slice(i, i + 7))
  assert.deepEqual(stream.usage, { input: 500, output: 100, cacheRead: 300 })
  stream.push(encoder.encode('data: {"usage":{"prompt_tokens":500,"completion_tokens":100,"total_tokens":1}}\n\ndata: [DONE]\n\n'), true)
  assert.equal(stream.usage, null); assert.equal(stream.done, true)
})
