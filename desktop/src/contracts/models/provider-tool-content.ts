import { AppError } from '../core/app-error'
import type { AiToolCall, AiToolMessage } from '../assistant/assistant-conversation-contracts'

export type AnthropicBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ResponseItem = { type: 'reasoning'; id: string; summary: Array<{ type: 'summary_text'; text: string }>; encrypted_content?: string }
  | { type: 'function_call'; id?: string; call_id: string; name: string; arguments: string }
  | { type: 'message'; id?: string; role: 'assistant'; content: Array<{ type: 'output_text'; text: string }> }
export type ProviderToolContent = { version: 1; scope: string } & (
  { protocol: 'anthropic-native'; blocks: AnthropicBlock[] } | { protocol: 'openai-responses'; items: ResponseItem[] }
  | { protocol: 'openai-compatible'; reasoningContent: string })
export const providerRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function providerInvalid(message = '模型回复未完整返回或工具历史无效，未执行不完整的工具调用。'): never {
  throw new AppError('AI_RESPONSE_INVALID', message, { recoverable: true })
}
function record(v: unknown, keys: string[]): Record<string, unknown> {
  if (!providerRecord(v) || Object.keys(v).some(k => !keys.includes(k))) return providerInvalid()
  return v
}
function text(v: unknown, max = 131072): string { return typeof v === 'string' && v.length <= max ? v : providerInvalid() }
const id = (v: unknown) => { const s = text(v, 200); if (!s || /[\u0000-\u001f\u007f]/.test(s)) return providerInvalid(); return s }
export function decodeAnthropicBlocks(value: unknown, maxBytes = 200000): AnthropicBlock[] {
  if (!Array.isArray(value) || value.length > 128 || new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) return providerInvalid()
  return value.map((v): AnthropicBlock => {
    if (!providerRecord(v)) return providerInvalid()
    if (v.type === 'text') { record(v, ['type', 'text']); return { type: 'text', text: text(v.text, maxBytes) } }
    if (v.type === 'thinking') { record(v, ['type', 'thinking', 'signature']); return { type: 'thinking', thinking: text(v.thinking, maxBytes), signature: text(v.signature) } }
    if (v.type === 'redacted_thinking') { record(v, ['type', 'data']); return { type: 'redacted_thinking', data: text(v.data) } }
    if (v.type === 'tool_use') {
      record(v, ['type', 'id', 'name', 'input'])
      if (!providerRecord(v.input) || JSON.stringify(v.input).length > 20000) return providerInvalid()
      return { type: 'tool_use', id: id(v.id), name: id(v.name), input: structuredClone(v.input) }
    }
    return providerInvalid()
  })
}
export function decodeResponseItems(value: unknown, maxBytes = 200000): ResponseItem[] {
  if (!Array.isArray(value) || value.length > 128 || new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) return providerInvalid()
  return value.map((v): ResponseItem => {
    if (!providerRecord(v)) return providerInvalid()
    if (v.type === 'reasoning') {
      record(v, ['type', 'id', 'summary', 'encrypted_content'])
      if (!Array.isArray(v.summary) || v.summary.length > 128) return providerInvalid()
      return { type: 'reasoning', id: id(v.id), summary: v.summary.map(s => { const r = record(s, ['type', 'text']); if (r.type !== 'summary_text') return providerInvalid(); return { type: 'summary_text', text: text(r.text) } }),
        ...(v.encrypted_content === undefined ? {} : { encrypted_content: text(v.encrypted_content) }) }
    }
    if (v.type === 'function_call') {
      record(v, ['type', 'id', 'call_id', 'name', 'arguments'])
      const args = text(v.arguments, 20000)
      try { if (!providerRecord(JSON.parse(args))) return providerInvalid() } catch { return providerInvalid() }
      return { type: 'function_call', ...(v.id === undefined ? {} : { id: id(v.id) }), call_id: id(v.call_id), name: id(v.name), arguments: args }
    }
    if (v.type === 'message') {
      record(v, ['type', 'id', 'role', 'content'])
      if (v.role !== 'assistant' || !Array.isArray(v.content) || v.content.length > 128) return providerInvalid()
      return { type: 'message', ...(v.id === undefined ? {} : { id: id(v.id) }), role: 'assistant', content: v.content.map(p => { const r = record(p, ['type', 'text']); if (r.type !== 'output_text') return providerInvalid(); return { type: 'output_text', text: text(r.text, maxBytes) } }) }
    }
    return providerInvalid()
  })
}
export function providerVisible(envelope: ProviderToolContent): { content: string; toolCalls: AiToolCall[] } {
  if (envelope.protocol === 'openai-compatible') return { content: '', toolCalls: [] }
  const content = envelope.protocol === 'anthropic-native' ? envelope.blocks.map(b => b.type === 'text' ? b.text : '').join('')
    : envelope.items.map(i => i.type === 'message' ? i.content.map(c => c.text).join('') : '').join('')
  const toolCalls: AiToolCall[] = envelope.protocol === 'anthropic-native'
    ? envelope.blocks.flatMap(b => b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }] : [])
    : envelope.items.flatMap(i => i.type === 'function_call' ? [{ id: i.call_id, type: 'function' as const, function: { name: i.name, arguments: i.arguments } }] : [])
  if (toolCalls.length > 8 || new Set(toolCalls.map(c => c.id)).size !== toolCalls.length) return providerInvalid()
  return { content, toolCalls }
}
export function decodeProviderToolContent(value: unknown): ProviderToolContent {
  const v = record(value, ['version', 'scope', 'protocol', 'blocks', 'items', 'reasoningContent'])
  if (v.version !== 1 || typeof v.scope !== 'string' || !/^[a-f0-9]{64}$/.test(v.scope)) return providerInvalid()
  const base = { version: 1 as const, scope: v.scope }
  if (v.protocol === 'anthropic-native') { record(v, ['version', 'scope', 'protocol', 'blocks']); return { ...base, protocol: v.protocol, blocks: decodeAnthropicBlocks(v.blocks) } }
  if (v.protocol === 'openai-responses') { record(v, ['version', 'scope', 'protocol', 'items']); return { ...base, protocol: v.protocol, items: decodeResponseItems(v.items) } }
  if (v.protocol === 'openai-compatible') { record(v, ['version', 'scope', 'protocol', 'reasoningContent']); return { ...base, protocol: v.protocol, reasoningContent: text(v.reasoningContent) } }
  return providerInvalid()
}
export function validatedProviderMessage(message: AiToolMessage): ProviderToolContent {
  const e = decodeProviderToolContent(message.providerContent)
  if (message.role !== 'assistant' || message.geminiParts) return providerInvalid()
  if (e.protocol !== 'openai-compatible') {
    const actual = providerVisible(e)
    if (actual.content !== (message.content ?? '') || JSON.stringify(actual.toolCalls) !== JSON.stringify(message.tool_calls ?? [])) return providerInvalid()
  }
  return e
}
