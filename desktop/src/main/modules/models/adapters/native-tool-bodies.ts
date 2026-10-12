import type { AiFunctionTool, AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { providerInvalid, validatedProviderMessage } from '../../../../contracts/models/provider-tool-content'
import type { CompiledRemoteConfig } from '../domain/generation-config'
import { providerScope } from './provider-transport'

export function nativeToolBody(c: CompiledRemoteConfig, messages: AiToolMessage[], tools: AiFunctionTool[], streaming: boolean): Record<string, unknown> {
  const input: Record<string, unknown>[] = [], system: string[] = [], scope = providerScope(c), pending = new Set<string>()
  const anthropic = c.kind === 'anthropic-native'
  for (const m of messages) {
    if (m.geminiParts) return providerInvalid('当前历史来自其他协议，请重新开始对话。')
    if (m.role === 'system') { if (m.content) system.push(m.content); continue }
    if (m.role === 'tool') {
      if (!m.tool_call_id || !pending.delete(m.tool_call_id)) return providerInvalid()
      if (anthropic) {
        const part = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }, last = input.at(-1)
        if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(p => p.type === 'tool_result')) last.content.push(part)
        else input.push({ role: 'user', content: [part] })
      } else input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content ?? '' })
      continue
    }
    if (pending.size) return providerInvalid()
    if (m.providerContent) {
      const e = validatedProviderMessage(m)
      if (e.protocol !== c.kind || e.scope !== scope) return providerInvalid('型号或参数已变化，不能回传其他请求的思考签名，请重新开始对话。')
      if (e.protocol === 'anthropic-native') input.push({ role: 'assistant', content: e.blocks })
      else if (e.protocol === 'openai-responses') input.push(...e.items)
    } else {
      if (m.tool_calls?.length) return providerInvalid('缺少工具续接所需的模型历史，请重新开始对话。')
      input.push({ role: m.role, content: m.content ?? '' })
    }
    for (const call of m.tool_calls ?? []) { if (pending.has(call.id)) return providerInvalid(); pending.add(call.id) }
  }
  if (pending.size || !input.length) return providerInvalid()
  const parameters = c.generation.parameters
  return anthropic ? { model: c.profile.model, ...(system.length ? { system: system.join('\n\n') } : {}), messages: input, ...parameters, stream: streaming,
    ...(tools.length ? { tools: tools.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters })), tool_choice: { type: 'auto' } } : {}) }
    : { model: c.profile.model, ...(system.length ? { instructions: system.join('\n\n') } : {}), input, ...parameters, store: false, include: ['reasoning.encrypted_content'], stream: streaming,
      ...(tools.length ? { tools: tools.map(({ function: f }) => ({ type: 'function', name: f.name, description: f.description, parameters: f.parameters, strict: false })), tool_choice: 'auto', parallel_tool_calls: false } : {}) }
}
