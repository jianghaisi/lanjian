import { connectionRecord } from './model-connection-values'
import { parameterError, parameterNumber } from './parameter-policy'
export type GenerationDiagnostics = {
  stopReason?: string; responseModel?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number
  ruleRevision: string; ruleId?: string; parameters: Record<string, unknown>
}
export type GeneratedText = { content: string; diagnostics?: GenerationDiagnostics }

export function decodeGenerationDiagnostics(value: unknown): GenerationDiagnostics {
  const v = connectionRecord(value, ['stopReason', 'responseModel', 'inputTokens', 'outputTokens', 'reasoningTokens', 'ruleRevision', 'ruleId', 'parameters'])
  const text = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x) ? x : parameterError()
  const keys = ['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'maxOutputTokens', 'temperature', 'top_p', 'topP', 'top_k', 'topK', 'reasoning_effort', 'thinking_budget', 'enable_thinking', 'thinking', 'thinkingConfig', 'reasoning', 'output_config']
  const p = connectionRecord(v.parameters, keys)
  for (const [key, item] of Object.entries(p)) {
    if (item && typeof item === 'object') {
      const allowed = key === 'thinkingConfig' ? ['thinkingLevel', 'thinkingBudget'] : key === 'thinking' ? ['type', 'budget_tokens'] : ['reasoning', 'output_config'].includes(key) ? ['effort'] : []
      const nested = connectionRecord(item, allowed)
      for (const n of Object.values(nested)) { if (typeof n === 'number') parameterNumber(n, 0, 128000); else if (typeof n !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(n)) parameterError() }
    } else if (typeof item === 'number') parameterNumber(item, 0, 128000)
    else if (key === 'enable_thinking' && typeof item === 'boolean') continue
    else if (key !== 'reasoning_effort' || typeof item !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(item)) parameterError()
  }
  const result: GenerationDiagnostics = { ruleRevision: text(v.ruleRevision, 100), parameters: structuredClone(p) }
  if (v.ruleId !== undefined) result.ruleId = text(v.ruleId, 100)
  if (v.stopReason !== undefined) result.stopReason = text(v.stopReason, 80)
  if (v.responseModel !== undefined) result.responseModel = text(v.responseModel, 500)
  for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens'] as const) if (v[key] !== undefined) result[key] = parameterNumber(v[key], 0, Number.MAX_SAFE_INTEGER, true)
  return result
}
