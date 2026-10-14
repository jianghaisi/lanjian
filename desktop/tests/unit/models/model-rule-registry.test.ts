import test from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_RULES } from '../../../src/contracts/models/model-rule-registry'
import { compileGeneration, modelCapabilities, type GenerationTarget } from '../../../src/contracts/models/generation-parameters'
import { decodeParameterPolicy, type ParameterOverrides } from '../../../src/contracts/models/parameter-policy'
import type { ModelProfile } from '../../../src/contracts/models/types'
import { decodeBookModelSettings, defaultLegacyBookModelSettings } from '../../../src/contracts/models/book-model-settings'
import { applyBookModelAssignment } from '../../../src/main/modules/models/domain/book-model-assignments'

function compile(ruleId: string, overrides: ParameterOverrides = {}, protocol?: GenerationTarget['protocol']) {
  const r = MODEL_RULES.find(r => r.id === ruleId)!
  const profile: ModelProfile = { connectionId: 'test', model: 'retained-alias-HIGH-20261005', parameterPolicy: { version: 2, ruleId, mode: 'custom', overrides } }
  return compileGeneration(profile, 'prose', { protocol: protocol ?? r.protocols[0], baseUrl: 'https://gateway.invalid/v1', model: profile.model })
}
test('registry has unique, documented exact rules; gateways remain unknown until explicit binding', () => {
  assert.equal(new Set(MODEL_RULES.map(r => r.id)).size, MODEL_RULES.length)
  for (const rule of MODEL_RULES) {
    assert.match(rule.sourceUrl, /^https:\/\//); assert.ok(rule.models.length)
    const target = { model: rule.models[0], protocol: rule.protocols[0], baseUrl: rule.endpoints[0] }
    assert.equal(modelCapabilities(target).rule?.id, rule.id)
    assert.equal(modelCapabilities({ ...target, baseUrl: 'https://gateway.invalid/v1' }).source, 'unknown')
    const result = compile(rule.id)
    assert.equal(result.model, 'retained-alias-HIGH-20261005'); assert.equal(result.capabilities.source, 'author-binding')
    assert.equal(Object.keys(result.parameters).length, 1)
  }
})
test('Claude 5.5 only supports Messages adaptive thinking and effort; invalid sampling cannot silently degrade', () => {
  assert.deepEqual(compile('claude-opus-5-5', { reasoning: { mode: 'adaptive', effort: 'high' } }).parameters, { max_tokens: 32768, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
  for (const overrides of [{ temperature: 0.7 }, { topP: .9 }, { topK: 40 }, { reasoning: { mode: 'disabled' as const } }, { reasoning: { budgetTokens: 1000 } }]) assert.throws(() => compile('claude-opus-5-5', overrides))
  assert.throws(() => compile('claude-opus-5-5', {}, 'openai-compatible'), /Messages|anthropic-native/)
  assert.equal(compile('claude-opus-5-5', { maxTokens: 4096 }).outputTokens, 4096)
})
test('GPT Responses nests effort; Chat tools restrictions and sampling are mode dependent', () => {
  assert.deepEqual(compile('gpt-6.1-sol', { reasoning: { effort: 'high' } }, 'openai-responses').parameters, { max_output_tokens: 32768, reasoning: { effort: 'high' } })
  assert.throws(() => compile('gpt-6.1-sol', { temperature: 0 }))
  const value = compile('gpt-6-sol', { temperature: 0, topP: 0, reasoning: { effort: 'none' } })
  assert.equal(value.parameters.temperature, 0); assert.equal(value.outputTokens, 16384)
  assert.throws(() => compileGeneration({ connectionId: 'c', model: 'gpt-6.1-sol', parameterPolicy: { version: 2, ruleId: 'gpt-6.1-sol', mode: 'auto' } }, 'outline', { protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol' }, 'tools'), /OpenAI Responses/)
})

test('gateway parameter bindings do not assert official Chat tool restrictions or rewrite request intent', () => {
  for (const ruleId of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
    for (const model of [ruleId, 'gateway-alias']) {
      const p: ModelProfile = { connectionId: 'c', model, parameterPolicy: { version: 2, ruleId, mode: 'custom', overrides: { maxTokens: 2048, reasoning: { effort: 'high' } } } }
      const before = JSON.stringify(p)
      for (const baseUrl of ['https://gateway.invalid/v1', 'https://api.openai.com.gateway.invalid/v1', undefined]) {
        const result = compileGeneration(p, 'prose', { protocol: 'openai-compatible', baseUrl, model }, 'tools')
        assert.equal(result.capabilities.tools, undefined)
        assert.equal(result.capabilities.source, 'author-binding')
        assert.equal(result.model, model)
        assert.deepEqual(result.parameters, { max_completion_tokens: 2048, reasoning_effort: 'high' })
        assert.ok(result.notes.some(note => note.includes('以接口实际响应为准')))
      }
      assert.equal(JSON.stringify(p), before)
    }
  }
  const unbound: ModelProfile = { connectionId: 'c', model: 'gpt-6.1-sol', parameterPolicy: { version: 2, mode: 'auto' } }
  const result = compileGeneration(unbound, 'prose', { protocol: 'openai-compatible', baseUrl: 'https://gateway.invalid/v1', model: unbound.model }, 'tools')
  assert.equal(result.capabilities.source, 'unknown')
  assert.deepEqual(result.parameters, { max_tokens: 8192 })
})

test('exact official endpoints keep their tool restrictions even with an alternate parameter binding', () => {
  const baseUrl = 'https://api.openai.com/v1/'
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    for (const ruleId of [undefined, model, 'gpt-5.6-sol']) {
      const p: ModelProfile = { connectionId: 'c', model, parameterPolicy: { version: 2, mode: 'auto', ...(ruleId ? { ruleId } : {}) } }
      assert.throws(() => compileGeneration(p, 'prose', { protocol: 'openai-compatible', baseUrl, model }, 'tools'), /官方接口.*OpenAI Responses/)
      assert.doesNotThrow(() => compileGeneration(p, 'prose', { protocol: 'openai-responses', baseUrl, model }, 'tools'))
    }
  }
  for (const model of ['gpt-6-sol', 'gpt-6-luna']) {
    for (const effort of ['high', 'none']) {
      const p: ModelProfile = { connectionId: 'c', model, parameterPolicy: { version: 2, ruleId: 'gpt-5.6-sol', mode: 'custom', overrides: { reasoning: { effort } } } }
      const run = () => compileGeneration(p, 'prose', { protocol: 'openai-compatible', baseUrl, model }, 'tools')
      if (effort === 'high') assert.throws(run, /关闭思考.*none/)
      else assert.equal(run().parameters.reasoning_effort, 'none')
    }
  }
})
test('Gemini levels and token budgets stay separate and endpoint metadata narrows rule limits', () => {
  assert.deepEqual(compile('gemini-3.8-flash', { reasoning: { effort: 'medium' } }).parameters, { maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'medium' } })
  assert.throws(() => compile('gemini-3.8-flash', { reasoning: { effort: 'minimal' } }))
  assert.equal((compile('gemini-2.5-flash', { reasoning: { budgetTokens: 0 } }).parameters.thinkingConfig as any).thinkingBudget, 0)
  assert.throws(() => compile('gemini-2.5-pro', { reasoning: { budgetTokens: 0 } }))
  const p: ModelProfile = { connectionId: 'c', model: 'alias', parameterPolicy: { version: 2, ruleId: 'gemini-3.8-flash', mode: 'custom', overrides: { reasoning: { effort: 'high' } } } }
  assert.throws(() => compileGeneration(p, 'prose', { model: 'alias', protocol: 'gemini-native', metadata: { id: 'alias', thinking: false } }))
})
test('DeepSeek, Kimi, Qwen, GLM and Doubao reject ignored or incompatible knobs', () => {
  assert.throws(() => compile('qwen3.8-dashscope', { topP: 0 }), /大于 0/)
  assert.throws(() => compile('qwen3.8-dashscope', { temperature: 2 }), /小于 2/)
  assert.equal(compile('qwen3.8-dashscope', { temperature: 0, topP: .01 }).parameters.temperature, 0)
  assert.throws(() => compile('deepseek-v4', { temperature: .7 }))
  assert.equal(compile('deepseek-v4', { temperature: .7, reasoning: { mode: 'disabled' } }).parameters.temperature, .7)
  assert.throws(() => compile('deepseek-v4', { topP: .9 }))
  assert.throws(() => compile('deepseek-v4', { topP: 1, reasoning: { mode: 'disabled' } }))
  assert.throws(() => compile('kimi-k3', { temperature: 1 }))
  assert.equal(compile('kimi-k3', { reasoning: { effort: 'max' } }).parameters.reasoning_effort, 'max')
  assert.deepEqual(compile('kimi-k2.6', { reasoning: { mode: 'disabled' } }).parameters.thinking, { type: 'disabled' })
  assert.throws(() => compile('kimi-k2.7-code', { reasoning: { mode: 'disabled' } }))
  assert.equal(compile('qwen3.8-dashscope', { reasoning: { mode: 'disabled' } }).parameters.enable_thinking, false)
  assert.throws(() => compile('qwen3.8-dashscope', { reasoning: { effort: 'low', budgetTokens: 4096 } }))
  assert.equal(compile('glm5.3-dashscope', { reasoning: { effort: 'low' } }).parameters.reasoning_effort, 'low')
  assert.throws(() => compile('glm5.3-dashscope', { reasoning: { mode: 'disabled' } }))
  assert.throws(() => compile('doubao-seed-2.0', { topP: .7 }))
})
test('v2 strict union, unknown rules and output budgets fail closed without altering saved intent', () => {
  for (const policy of [{ version: 3, mode: 'auto' }, { version: 1, mode: 'auto', ruleId: 'gpt-6.1-sol' }, { version: 2, mode: 'auto', overrides: {} }, { version: 2, mode: 'custom', overrides: { thinking: { kind: 'effort', value: 'high' } } }, { version: 2, mode: 'custom', overrides: { reasoning: { mode: 'disabled', effort: 'high' } } }]) assert.throws(() => decodeParameterPolicy(policy))
  const p: ModelProfile = { connectionId: 'c', model: 'm', parameterPolicy: { version: 2, ruleId: 'removed-rule', mode: 'auto' } }
  assert.throws(() => compileGeneration(p, 'prose', { protocol: 'openai-compatible', model: 'm' }))
  assert.throws(() => compile('claude-opus-5-5', { maxTokens: 128001 }))
  assert.throws(() => compile('gemini-2.5-pro', { maxTokens: 1024, reasoning: { budgetTokens: 1024 } }))
  const old = defaultLegacyBookModelSettings(), bytes = JSON.stringify(old)
  const settings = applyBookModelAssignment(old, { shared: { connectionId: old.shared.connectionId, model: 'retained-alias', parameterPolicy: { version: 2, ruleId: 'gpt-6.1-sol', mode: 'auto' } } }).settings
  assert.deepEqual(decodeBookModelSettings(settings), settings); assert.equal(JSON.stringify(old), bytes); assert.deepEqual(settings.tasks, old.tasks)
})
