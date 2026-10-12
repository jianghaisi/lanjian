import type { GenerationTarget, ModelCapabilities } from './generation-parameters'
import { parameterError, type ParameterOverrides } from './parameter-policy'

export function validateReasoning(o: ParameterOverrides, c: ModelCapabilities, outputTokens: number): void {
  const t = o.reasoning, r = c.rule?.reasoning
  if (o.topK !== undefined && (c.rule?.topK?.status !== 'supported' || o.topK < (c.rule.topK.min ?? 1) || o.topK > (c.rule.topK.max ?? 1024))) parameterError('该型号未确认支持此候选词数（top_k），请清空使用自动。')
  if (t) {
    if (!r || c.thinking.status !== 'supported') parameterError('尚未确认这个接口支持所选思考参数，请选择匹配的型号规则或恢复自动。')
    if (t.mode !== undefined && !r.modes?.includes(t.mode)) parameterError('该型号不支持这个思考模式，请按型号规则选择或清空。')
    if (t.effort !== undefined && !r.efforts?.includes(t.effort)) parameterError('该型号不支持这个思考档位。')
    if (t.budgetTokens !== undefined) {
      const b = r.budget
      if (!b || (!(b.allowZero && t.budgetTokens === 0) && (t.budgetTokens < b.min || t.budgetTokens > b.max))) parameterError('思考预算超出此型号的允许范围，请修改或清空使用自动。')
      if (t.budgetTokens >= outputTokens) parameterError(`思考预算为 ${t.budgetTokens} tokens，当前总输出上限为 ${outputTokens} tokens，需为正文保留空间。`)
      if (r.exclusiveBudget && t.effort !== undefined) parameterError('此型号的思考档位与思考预算不能同时设置，请只保留一项。')
    }
  }
  if (c.rule?.id === 'deepseek-v4') {
    const disabled = t?.mode === 'disabled'
    if (o.temperature !== undefined && !disabled) parameterError('DeepSeek 的温度仅在关闭思考时生效；请关闭思考或清空温度。')
    if (o.topP !== undefined && disabled) parameterError('DeepSeek 非思考模式的 top_p 固定为 1，请清空使用默认。')
  }
}

export function reasoningParameters(o: ParameterOverrides, c: ModelCapabilities, protocol: GenerationTarget['protocol']): Record<string, unknown> {
  const p: Record<string, unknown> = {}, t = o.reasoning, r = c.rule?.reasoning
  if (o.topK !== undefined) p[protocol === 'gemini-native' ? 'topK' : 'top_k'] = o.topK
  if (!t || !r) return p
  if (r.wire === 'openai') {
    if (t.effort !== undefined) {
      if (protocol === 'openai-responses') p.reasoning = { effort: t.effort }
      else p.reasoning_effort = t.effort
    }
  } else if (r.wire === 'anthropic') {
    if (t.mode !== undefined) p.thinking = { type: t.mode }
    if (t.effort !== undefined) p.output_config = { effort: t.effort }
  } else if (r.wire === 'gemini') {
    p.thinkingConfig = { ...(t.effort === undefined ? {} : { thinkingLevel: t.effort }), ...(t.budgetTokens === undefined ? {} : { thinkingBudget: t.budgetTokens }) }
  } else if (r.wire === 'thinking' || r.wire === 'qwen') {
    if (t.mode !== undefined) {
      if (r.wire === 'qwen') p.enable_thinking = t.mode === 'enabled'
      else p.thinking = { type: t.mode }
    }
    if (t.effort !== undefined) p.reasoning_effort = t.effort
    if (t.budgetTokens !== undefined) p.thinking_budget = t.budgetTokens
  }
  return p
}
