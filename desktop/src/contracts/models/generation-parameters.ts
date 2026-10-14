import type { LocalSamplingDefaults } from './local-model-contracts'
import type { AiTask, LegacyModelProfile, ModelProfile } from './types'
import { catalogTextSupport, type ModelCatalogEntry } from './model-catalog-metadata'
import { decodeParameterPolicy, parameterError, type ParameterOverrides } from './parameter-policy'
import { MODEL_RULE_REVISION, modelRule, officialModelRule, type ModelRule, type ParameterStatus } from './model-rule-registry'
import type { RemoteModelProtocol } from './model-connections'
import { validateReasoning, reasoningParameters } from './reasoning-parameters'
import { assertThinkingProtocol, explicitThinkingLevel } from './thinking-level'

export const CAPABILITY_REVISION = MODEL_RULE_REVISION
export const CREATIVE_OUTPUT_BUDGETS: Record<AiTask, number> = { outline: 16384, chapterOutline: 8192, prose: 16384, review: 8192 }
type Status = ParameterStatus
export type ModelCapabilities = {
  revision: string; source: 'official-rule' | 'endpoint-metadata' | 'local-manifest' | 'author-binding' | 'unknown'; checkedAt: string; sourceUrl?: string
  temperature: Status; topP: Status; maxTemperature: number; maxOutputTokens?: number; contextTokens?: number
  thinking: { status: Status; kind?: 'effort' | 'budget'; values?: string[]; min?: number; max?: number; allowZero?: boolean }
  rule?: ModelRule
  samplingRequiresNone?: boolean; tools?: 'unsupported' | 'requires-none'
  outputField: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens' | 'max_output_tokens'
}
export type GenerationTarget = { protocol: RemoteModelProtocol | 'local'; ruleId?: string; baseUrl?: string; model: string; metadata?: ModelCatalogEntry;
  localLimits?: { samplingDefaults?: LocalSamplingDefaults; contextTokens: number; maxOutputTokens: number; recommendedOutputTokens: number; systemReserveTokens: number } }
export type EffectiveGeneration = { revision: string; model: string; task: AiTask; mode: 'legacy' | 'auto' | 'custom'; outputTokens: number;
  policyVersion?: 1 | 2;
  parameters: Record<string, unknown>; capabilities: ModelCapabilities; notes: string[] }

/** Model rules are distinct from endpoint evidence. Explicit binding is author intent, not verification. */
export function modelCapabilities(target: GenerationTarget): ModelCapabilities {
  const c: ModelCapabilities = { revision: CAPABILITY_REVISION, source: 'unknown', checkedAt: '2026-10-05', temperature: 'unknown', topP: 'unknown', maxTemperature: 2,
    thinking: { status: 'unknown' }, outputField: target.protocol === 'gemini-native' ? 'maxOutputTokens' : target.protocol === 'openai-responses' ? 'max_output_tokens' : 'max_tokens' }
  if (target.protocol === 'local' && target.ruleId) parameterError('本地运行时不能绑定云端规则，请解除绑定。')
  if (target.protocol === 'local' && target.localLimits) return { ...c, source: 'local-manifest', temperature: 'supported', topP: 'supported', thinking: { status: 'unsupported' },
    maxOutputTokens: target.localLimits.maxOutputTokens, contextTokens: target.localLimits.contextTokens }
  const explicit = target.ruleId ? modelRule(target.ruleId) : undefined
  if (target.ruleId && !explicit) parameterError('所选型号规则不存在，请重新选择规则或解除绑定。')
  const official = officialModelRule(target.protocol, target.baseUrl, target.model)
  const rule = explicit ?? official
  if (rule) {
    if (target.protocol === 'local' || !rule.protocols.includes(target.protocol)) parameterError(`这条规则需要 ${rule.protocols.join(' / ')} 协议。请在接口管理中新建对应协议连接，再选择它；现有连接不会自动改变。`)
    const r = rule.reasoning
    Object.assign(c, { source: explicit ? 'author-binding' : 'official-rule', rule, sourceUrl: rule.sourceUrl, temperature: rule.temperature.status, topP: rule.topP.status,
      maxTemperature: rule.temperature.max ?? 2, maxOutputTokens: rule.outputTokens, contextTokens: rule.contextTokens,
      thinking: { status: r.wire === 'none' ? 'unknown' : 'supported', ...(r.efforts?.length ? { kind: 'effort', values: [...r.efforts] } : r.budget ? { kind: 'budget', ...r.budget } : {}) },
      // A parameter reference does not establish a gateway's protocol capabilities.
      samplingRequiresNone: rule.samplingRequiresNone, tools: target.protocol === 'openai-compatible' ? official?.toolsChat : undefined })
    if (r.wire === 'none' && rule.vendor === 'OpenAI') c.thinking = { status: 'unsupported' }
    if (target.protocol === 'openai-compatible' && rule.outputField) c.outputField = rule.outputField
  }
  // Endpoint metadata can narrow reference limits, never silently widen them or erase documented limits.
  const m = target.metadata?.id === target.model ? target.metadata : undefined
  if (target.protocol === 'gemini-native' && m) {
    if (c.source === 'unknown') c.source = 'endpoint-metadata'
    if (m.maxTemperature !== undefined) { if (!rule) c.temperature = 'supported'; c.maxTemperature = Math.min(c.maxTemperature, m.maxTemperature) }
    if (m.topP !== undefined && !rule) c.topP = 'supported'
    if (m.thinking === false) c.thinking = { status: 'unsupported' }
    if (m.outputTokenLimit !== undefined) c.maxOutputTokens = Math.min(c.maxOutputTokens ?? Infinity, m.outputTokenLimit)
    if (m.inputTokenLimit !== undefined) c.contextTokens = Math.min(c.contextTokens ?? Infinity, m.inputTokenLimit)
  }
  return c
}

/** One compiler used by renderer previews and all main-process generation paths. */
export function compileGeneration(profile: ModelProfile, task: AiTask, target: GenerationTarget, operation: 'text' | 'tools' | 'probe' = 'text'): EffectiveGeneration {
  const policy = profile.parameterPolicy === undefined ? undefined : decodeParameterPolicy(profile.parameterPolicy)
  const capabilities = modelCapabilities({ ...target, ruleId: policy?.version === 2 ? policy.ruleId : undefined }), notes: string[] = []
  if (catalogTextSupport(target.metadata?.id === target.model ? target.metadata : undefined) === 'unsupported') parameterError('这个型号未声明文本生成能力，请选择文字模型。')
  const legacy = !policy
  const o: ParameterOverrides = legacy ? { temperature: profile.temperature, topP: profile.topP, maxTokens: profile.maxTokens,
    ...(explicitThinkingLevel(profile.thinkingLevel) ? { thinking: { kind: 'effort', value: profile.thinkingLevel! } } : {}) } : policy.mode === 'custom' ? policy.overrides : {}
  if (legacy) assertThinkingProtocol(profile.thinkingLevel, target.protocol)
  const knownBudget = !!capabilities.rule || capabilities.maxOutputTokens !== undefined
  const requested = target.protocol === 'local' ? target.localLimits?.recommendedOutputTokens ?? 2048
    : operation === 'probe' ? (capabilities.source === 'official-rule' && target.protocol === 'openai-compatible' && capabilities.thinking.status === 'unsupported' ? 128 : 8192)
    : knownBudget ? CREATIVE_OUTPUT_BUDGETS[task] * (policy?.version === 2 && capabilities.thinking.status === 'supported' && o.reasoning?.mode !== 'disabled' && o.reasoning?.effort !== 'none' ? 2 : 1) : 8192
  if (operation === 'probe' && o.maxTokens === undefined) notes.push('这是连接测试预算；保存为创作配置后，会按真实创作任务计算输出上限。')
  const outputTokens = o.maxTokens ?? Math.min(requested, capabilities.maxOutputTokens ?? requested, Math.max(128, (capabilities.contextTokens ?? Infinity) - (target.localLimits?.systemReserveTokens ?? 1024)), 128000)
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 128000) parameterError('输出预算必须是有效整数。')
  if (!legacy && capabilities.maxOutputTokens !== undefined && outputTokens > capabilities.maxOutputTokens) parameterError(`最大输出设为 ${outputTokens} tokens，该型号最多输出 ${capabilities.maxOutputTokens} tokens。请降低最大输出，或清空使用自动。`)
  if (outputTokens < requested && o.maxTokens === undefined) notes.push(`已按型号上限调整为 ${outputTokens} tokens。`)
  if (!legacy && target.protocol !== 'local' && !knownBudget) notes.push(o.maxTokens === undefined
    ? '型号输出能力未确认：使用兼容输出预算；未自定义的采样和思考由服务决定。'
    : `型号输出能力未确认：按自定义上限 ${outputTokens} tokens 请求，是否接受以接口响应为准。`)
  if (legacy) notes.push('保留旧配置；切换到自动后才应用按模型参数。')
  if (!legacy || capabilities.rule) {
    if (o.temperature !== undefined && capabilities.temperature !== 'supported') parameterError('该型号的采样随机性尚未确认支持，请获取型号资料或恢复自动。')
    if (o.topP !== undefined && capabilities.topP !== 'supported') parameterError('该型号的采样范围尚未确认支持，请获取型号资料或恢复自动。')
    if (o.temperature !== undefined && o.temperature > capabilities.maxTemperature) parameterError(`采样随机性（temperature）设为 ${o.temperature}，该型号允许 0–${capabilities.maxTemperature}。请降低数值，或清空使用自动。`)
    if (capabilities.samplingRequiresNone && (o.temperature !== undefined || o.topP !== undefined) && !(o.reasoning?.effort === 'none' || (o.thinking?.kind === 'effort' && o.thinking.value === 'none'))) parameterError('该型号仅在关闭思考（none）时支持调整采样。')
    if (o.topP !== undefined && o.topP < (capabilities.rule?.topP.min ?? 0)) parameterError(`采样范围（top_p）至少为 ${capabilities.rule?.topP.min}。请修改或清空使用自动。`)
    if (o.topP !== undefined && capabilities.rule?.topP.exclusiveMin && o.topP <= (capabilities.rule.topP.min ?? 0)) parameterError(`采样范围（top_p）必须大于 ${capabilities.rule.topP.min ?? 0}。请修改或清空使用自动。`)
    if (o.temperature !== undefined && capabilities.rule?.temperature.exclusiveMax && o.temperature >= capabilities.rule.temperature.max!) parameterError(`创造性（temperature）必须小于 ${capabilities.rule.temperature.max}。请修改或清空使用自动。`)
    if (o.thinking) {
      const t = capabilities.thinking
      if (t.status !== 'supported' || t.kind !== o.thinking.kind) parameterError('该型号不支持所选思考参数，请恢复自动。')
      if (o.thinking.kind === 'effort' && !t.values?.includes(o.thinking.value)) parameterError('该型号不支持这个思考档位。')
      if (o.thinking.kind === 'budget' && (!(t.allowZero && o.thinking.tokens === 0) && (o.thinking.tokens < (t.min ?? 0) || o.thinking.tokens > (t.max ?? 0)))) parameterError(`思考预算设为 ${o.thinking.tokens} tokens，该型号允许 ${t.min ?? 0}–${t.max ?? 0} tokens${t.allowZero ? '，也可设为 0 关闭思考' : ''}。请按范围修改，或清空使用自动。`)
      if (o.thinking.kind === 'budget' && o.thinking.tokens >= outputTokens) parameterError(`思考预算为 ${o.thinking.tokens} tokens，当前总输出上限为 ${outputTokens} tokens，需为正文保留空间。请降低思考预算或清空使用自动，也可在型号允许范围内提高最大输出。`)
    }
  }
  if (operation === 'tools' && capabilities.tools === 'unsupported') parameterError('该型号的官方接口需要使用 OpenAI Responses 协议调用工具。请在接口管理中新建对应协议连接并选择它。')
  if (operation === 'tools' && capabilities.tools === 'requires-none' && !(o.reasoning?.effort === 'none' || (o.thinking?.kind === 'effort' && o.thinking.value === 'none'))) parameterError('该型号的官方 Chat 接口仅在关闭思考（none）时支持工具调用。请关闭思考，或新建 OpenAI Responses 协议连接。')
  validateReasoning(o, capabilities, outputTokens)
  if (capabilities.source === 'author-binding') notes.push('已按你选择的官方规则请求；当前中转是否执行这些字段仍需实际验证。')
  if (target.protocol === 'openai-compatible' && capabilities.rule?.toolsChat && !capabilities.tools) notes.push('参考规则的官方工具限制不代表当前接口能力；工具调用将按所选协议请求，是否支持以接口实际响应为准。')
  if (capabilities.rule?.reasoning.defaultEffort) notes.push(`思考默认档位：${capabilities.rule.reasoning.defaultEffort}；留空由服务决定。`)
  if (capabilities.rule?.note) notes.push(capabilities.rule.note)
  if (policy?.version === 2 && knownBudget) notes.push('自动输出预算是应用的创作起点，不是官方最优参数；思考可能占用输出预算。')
  if (['high', 'xhigh', 'max'].includes(o.reasoning?.effort ?? '') && outputTokens < 32768) notes.push('较高思考档位配合较小输出预算，可能挤占正文空间或导致截断。')
  const localDefaults = policy?.version === 2 && target.protocol === 'local' ? target.localLimits?.samplingDefaults : undefined
  if (localDefaults) notes.push(`本机自动采样：temperature ${localDefaults.temperature}，top_p ${localDefaults.topP}。${localDefaults.note}`)
  const parameters: Record<string, unknown> = { [capabilities.outputField]: outputTokens }
  if (localDefaults) { parameters.temperature = localDefaults.temperature; parameters.top_p = localDefaults.topP }
  if (o.temperature !== undefined) parameters.temperature = o.temperature
  if (o.topP !== undefined) parameters[target.protocol === 'gemini-native' ? 'topP' : 'top_p'] = o.topP
  Object.assign(parameters, reasoningParameters(o, capabilities, target.protocol))
  if (o.thinking) {
    if (target.protocol === 'gemini-native') parameters.thinkingConfig = o.thinking.kind === 'effort' ? { thinkingLevel: o.thinking.value } : { thinkingBudget: o.thinking.tokens }
    else if (target.protocol === 'openai-compatible' && o.thinking.kind === 'effort') parameters.reasoning_effort = o.thinking.value
    else if (target.protocol === 'openai-responses' && o.thinking.kind === 'effort') parameters.reasoning = { effort: o.thinking.value }
    else if (target.protocol === 'anthropic-native') parameterError('此协议需要新版思考参数，请切换到自动或重新设置。')
  }
  return { revision: CAPABILITY_REVISION, model: target.model, task, mode: legacy ? 'legacy' : policy.mode, ...(policy ? { policyVersion: policy.version } : {}), outputTokens, parameters, capabilities, notes }
}

/** Internal concrete local/runtime projection; never persist this in place of the author's policy. */
export function runtimeProfile(profile: ModelProfile, effective: EffectiveGeneration): LegacyModelProfile {
  return { connectionId: profile.connectionId, model: effective.model, temperature: typeof effective.parameters.temperature === 'number' ? effective.parameters.temperature : 0.7,
    topP: typeof effective.parameters.top_p === 'number' ? effective.parameters.top_p : typeof effective.parameters.topP === 'number' ? effective.parameters.topP : 0.95, maxTokens: effective.outputTokens,
    ...(profile.thinkingLevel === undefined ? {} : { thinkingLevel: profile.thinkingLevel }) }
}
