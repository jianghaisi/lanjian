import { AppError } from '../core/app-error'
import { connectionRecord } from './model-connection-values'

export type ThinkingChoice = { kind: 'effort'; value: string } | { kind: 'budget'; tokens: number }
export type ReasoningChoice = { mode?: 'enabled' | 'disabled' | 'adaptive' | 'auto'; effort?: string; budgetTokens?: number }
export type ParameterOverrides = { temperature?: number; topP?: number; topK?: number; maxTokens?: number; thinking?: ThinkingChoice; reasoning?: ReasoningChoice }
export type ParameterPolicy = ({ version: 1 } | { version: 2; ruleId?: string }) & ({ mode: 'auto' } | { mode: 'custom'; overrides: ParameterOverrides })

export function parameterError(message = '模型参数无效，请检查后重试。'): never {
  throw new AppError('VALIDATION_ERROR', message, { recoverable: true })
}
export function parameterNumber(value: unknown, min: number, max: number, integer = false, label?: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    // Only author-policy callers supply a label; metadata failures retain the generic boundary error.
    parameterError(label ? `${label}：请输入 ${min}–${max} 范围内的${integer ? '整数' : '数字'}，或清空使用自动。` : undefined)
  }
  return value
}
export function decodeParameterPolicy(value: unknown): ParameterPolicy {
  const r = connectionRecord(value, ['version', 'mode', 'overrides', 'ruleId'])
  if (r.version !== 1 && r.version !== 2) parameterError('此参数版本无法读取，请使用支持它的版本，不要覆盖原配置。')
  if (r.version === 1 && Object.hasOwn(r, 'ruleId')) parameterError()
  if (Object.hasOwn(r, 'ruleId') && (typeof r.ruleId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,99}$/.test(r.ruleId))) parameterError()
  const base = r.version === 1 ? { version: 1 as const } : { version: 2 as const, ...(r.ruleId === undefined ? {} : { ruleId: r.ruleId as string }) }
  if (r.mode === 'auto') {
    connectionRecord(value, r.version === 1 ? ['version', 'mode'] : ['version', 'mode', 'ruleId'])
    return { ...base, mode: 'auto' }
  }
  if (r.mode !== 'custom') parameterError()
  const o = connectionRecord(r.overrides, r.version === 1 ? ['temperature', 'topP', 'maxTokens', 'thinking'] : ['temperature', 'topP', 'topK', 'maxTokens', 'reasoning'])
  const overrides: ParameterOverrides = {}
  if (Object.hasOwn(o, 'temperature')) overrides.temperature = parameterNumber(o.temperature, 0, 2, false, '采样随机性（temperature）')
  if (Object.hasOwn(o, 'topP')) overrides.topP = parameterNumber(o.topP, 0, 1, false, '采样范围（top_p）')
  if (Object.hasOwn(o, 'topK')) overrides.topK = parameterNumber(o.topK, 0, 1024, true, '候选词数（top_k）')
  if (Object.hasOwn(o, 'maxTokens')) overrides.maxTokens = parameterNumber(o.maxTokens, 128, 128000, true, '最大输出（tokens）')
  if (Object.hasOwn(o, 'thinking')) {
    const t = connectionRecord(o.thinking, ['kind', 'value', 'tokens'])
    if (t.kind === 'effort') {
      connectionRecord(t, ['kind', 'value'])
      if (typeof t.value !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(t.value)) parameterError()
      overrides.thinking = { kind: 'effort', value: t.value }
    } else if (t.kind === 'budget') {
      connectionRecord(t, ['kind', 'tokens'])
      overrides.thinking = { kind: 'budget', tokens: parameterNumber(t.tokens, 0, 128000, true, '思考预算（tokens）') }
    } else parameterError()
  }
  if (Object.hasOwn(o, 'reasoning')) {
    const t = connectionRecord(o.reasoning, ['mode', 'effort', 'budgetTokens'])
    if (!Object.keys(t).length) parameterError()
    const reasoning: ReasoningChoice = {}
    if (Object.hasOwn(t, 'mode')) {
      if (!['enabled', 'disabled', 'adaptive', 'auto'].includes(String(t.mode))) parameterError()
      reasoning.mode = t.mode as ReasoningChoice['mode']
    }
    if (Object.hasOwn(t, 'effort')) {
      if (typeof t.effort !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(t.effort)) parameterError()
      reasoning.effort = t.effort
    }
    if (Object.hasOwn(t, 'budgetTokens')) reasoning.budgetTokens = parameterNumber(t.budgetTokens, 0, 128000, true, '思考预算（tokens）')
    if (reasoning.mode === 'disabled' && (reasoning.effort !== undefined || reasoning.budgetTokens !== undefined)) parameterError('关闭思考时不能同时指定思考档位或预算。')
    overrides.reasoning = reasoning
  }
  return { ...base, mode: 'custom', overrides }
}
