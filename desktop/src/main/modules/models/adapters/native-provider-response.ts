import type { AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { decodeAnthropicBlocks, decodeResponseItems, providerInvalid, providerRecord, providerVisible, type ProviderToolContent } from '../../../../contracts/models/provider-tool-content'
import type { CompiledRemoteConfig } from '../domain/generation-config'
import { assertSuccessfulStop, consumeProviderResponse, generationDiagnostics, providerScope } from './provider-transport'

function responseItems(value: unknown): unknown[] {
  if (!Array.isArray(value)) return providerInvalid()
  return value.map(item => {
    if (!providerRecord(item)) return providerInvalid()
    // Only documented replay fields survive. Refusals and unsupported tool types fail closed.
    if (item.type === 'message') {
      if (!Array.isArray(item.content)) return providerInvalid()
      return { type: item.type, ...(item.id === undefined ? {} : { id: item.id }), role: item.role, content: item.content.map(part => {
        if (!providerRecord(part) || part.type !== 'output_text') return providerInvalid('模型没有返回完整正文，可能拒绝了本次请求。')
        return { type: part.type, text: part.text }
      }) }
    }
    const keys = item.type === 'reasoning' ? ['type', 'id', 'summary', 'encrypted_content'] : item.type === 'function_call' ? ['type', 'id', 'call_id', 'name', 'arguments'] : []
    if (!keys.length) return providerInvalid()
    return Object.fromEntries(keys.filter(k => item[k] !== undefined).map(k => [k, item[k]]))
  })
}

export async function nativeProviderResponse(response: Response, c: CompiledRemoteConfig, signal: AbortSignal, toolMode: boolean, onDelta?: (content: string) => void | Promise<void>): Promise<AiToolStep> {
  const streaming = response.headers.get('content-type')?.includes('text/event-stream'), anthropic = c.kind === 'anthropic-native'
  let terminal = false, stopped = false, visible = '', final: Record<string, unknown> | undefined
  const blocks = new Map<number, Record<string, unknown>>(), open = new Set<number>(), argumentsByIndex = new Map<number, string>()
  const maxBytes = toolMode ? 200000 : 24 * 1024 * 1024
  const publish = async (delta: unknown) => {
    if (typeof delta !== 'string') return providerInvalid()
    visible += delta
    if (visible.length > (toolMode ? 50000 : 5000000)) return providerInvalid('模型回复超过字符上限。')
    signal.throwIfAborted(); await onDelta?.(visible)
  }
  await consumeProviderResponse(response, signal, async p => {
    if (terminal) { if (p.type !== 'ping') return providerInvalid(); return }
    if (!streaming) { final = p; terminal = true; return }
    if (!anthropic) {
      if (p.type === 'response.output_text.delta') await publish(p.delta)
      else if (p.type === 'response.completed') {
        if (!providerRecord(p.response)) return providerInvalid()
        final = p.response; terminal = true
      } else if (['response.failed', 'response.incomplete', 'error'].includes(String(p.type))) {
        const detail = providerRecord(p.response) && providerRecord(p.response.incomplete_details) ? p.response.incomplete_details.reason : undefined
        assertSuccessfulStop(detail, [])
      }
      return
    }
    if (p.type === 'message_start') {
      if (final || !providerRecord(p.message)) return providerInvalid()
      final = p.message
    } else if (p.type === 'content_block_start') {
      if (stopped || !Number.isSafeInteger(p.index) || Number(p.index) < 0 || Number(p.index) >= 128 || blocks.has(Number(p.index)) || !providerRecord(p.content_block)) return providerInvalid()
      blocks.set(Number(p.index), structuredClone(p.content_block)); open.add(Number(p.index))
      if (p.content_block.type === 'text' && p.content_block.text) await publish(p.content_block.text)
    } else if (p.type === 'content_block_delta') {
      const index = Number(p.index), b = blocks.get(index), d = p.delta
      if (!b || !open.has(index) || !providerRecord(d)) return providerInvalid()
      if (d.type === 'text_delta' && b.type === 'text' && typeof d.text === 'string') { b.text = String(b.text ?? '') + d.text; await publish(d.text) }
      else if (d.type === 'thinking_delta' && b.type === 'thinking' && typeof d.thinking === 'string') b.thinking = String(b.thinking ?? '') + d.thinking
      else if (d.type === 'signature_delta' && b.type === 'thinking' && typeof d.signature === 'string') b.signature = String(b.signature ?? '') + d.signature
      else if (d.type === 'input_json_delta' && b.type === 'tool_use' && typeof d.partial_json === 'string') argumentsByIndex.set(index, (argumentsByIndex.get(index) ?? '') + d.partial_json)
      else return providerInvalid()
    } else if (p.type === 'content_block_stop') {
      const index = Number(p.index), b = blocks.get(index)
      if (!b || !open.delete(index)) return providerInvalid()
      if (argumentsByIndex.has(index)) { try { b.input = JSON.parse(argumentsByIndex.get(index)!) } catch { return providerInvalid() } }
    } else if (p.type === 'message_delta') {
      if (!final || !providerRecord(p.delta) || open.size || stopped) return providerInvalid()
      final.stop_reason = p.delta.stop_reason; final.usage = { ...(providerRecord(final.usage) ? final.usage : {}), ...(providerRecord(p.usage) ? p.usage : {}) }; stopped = true
    } else if (p.type === 'message_stop') {
      if (!final || open.size || !stopped) return providerInvalid()
      final.content = [...blocks].sort(([a], [b]) => a - b).map(([, b]) => b); terminal = true
    } else if (p.type !== 'ping') return providerInvalid()
  }, maxBytes)
  if (!terminal || !final) return providerInvalid('模型回复中断，缺少完整结束状态。已显示的内容保留，请重试；反复出现时请检查接口流式回复兼容性。')
  let envelope: ProviderToolContent, reason: string
  if (anthropic) {
    assertSuccessfulStop(final.stop_reason, ['end_turn', 'stop_sequence', 'tool_use'])
    reason = final.stop_reason
    envelope = { version: 1, protocol: 'anthropic-native', scope: providerScope(c), blocks: decodeAnthropicBlocks(final.content, maxBytes) }
  } else {
    if (final.status !== 'completed') assertSuccessfulStop(providerRecord(final.incomplete_details) ? final.incomplete_details.reason : final.status, [])
    reason = 'completed'; envelope = { version: 1, protocol: 'openai-responses', scope: providerScope(c), items: decodeResponseItems(responseItems(final.output), maxBytes) }
  }
  const result = providerVisible(envelope)
  if (!result.content.trim() && !result.toolCalls.length || !toolMode && result.toolCalls.length) return providerInvalid()
  if (anthropic && (reason === 'tool_use') !== (result.toolCalls.length > 0)) return providerInvalid()
  if (streaming && result.content !== visible) return providerInvalid('流式正文与完成结果不一致，已停止采用。')
  if (!streaming) await onDelta?.(result.content)
  return { ...result, ...(toolMode ? { providerContent: envelope } : {}), diagnostics: generationDiagnostics(c, final, reason) }
}
