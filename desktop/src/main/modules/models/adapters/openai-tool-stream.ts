import type { CompiledRemoteConfig } from '../domain/generation-config'
import { generationDiagnostics, providerScope } from './provider-transport'
import type { AiToolCall, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { AppError } from '../../../core/errors/app-error'
const invalid = (message = '模型回复中断或格式不完整，已保留已显示的内容，未执行不完整的工具调用。请重试；如反复出现，请检查接口的流式回复和工具调用兼容性。'): never => { throw new AppError('AI_RESPONSE_INVALID', message, { recoverable: true }) }
type Chunk = { error?: unknown; choices?: Array<{ finish_reason?: string; delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: Array<{ index: number; type?: string; id?: string; function?: { name?: string; arguments?: string } }> } }> }
/** Assemble tool arguments before returning a step. Partial calls can never be dispatched. */
export async function consumeToolStream(response: Response, signal: AbortSignal, onDelta: (content: string) => void, config?: CompiledRemoteConfig): Promise<AiToolStep> {
  if (!response.body) return invalid()
  const reader = response.body.getReader(), decoder = new TextDecoder(), calls = new Map<number, AiToolCall>()
  let buffer = '', content = '', reasoning = '', totalBytes = 0, lastPayload: Record<string, unknown> = {}, lastReason: string | undefined, finished = false, terminated = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  function event(raw: string) {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return
    if (data === '[DONE]') { if (!finished) invalid(); terminated = true; return }
    let payload: Chunk
    try { payload = JSON.parse(data) } catch { return invalid('模型返回了无法解析的流式回复。') }
    if (!payload || payload.error) return invalid()
    lastPayload = { ...lastPayload, ...payload }
    const choice = payload.choices?.[0]
    if (!choice) return
    if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') return invalid('回复未完整生成，已保留已显示的片段；请调整要求或输出预算后重试。')
    if (choice.finish_reason) lastReason = choice.finish_reason
    const delta = choice.delta
    if (delta?.reasoning_content !== undefined && delta.reasoning_content !== null) {
      if (finished || typeof delta.reasoning_content !== 'string') return invalid()
      reasoning += delta.reasoning_content
      if (reasoning.length > 131072) return invalid()
    }
    if (finished && (delta?.content || delta?.tool_calls?.length)) return invalid()
    if (delta?.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') return invalid()
      content += delta.content
      if (content.length > 50000) return invalid('回复超过 50000 字符上限，已停止接收。')
      signal.throwIfAborted(); onDelta(content)
    }
    if (delta?.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) return invalid()
      for (const piece of delta.tool_calls) {
        if (!piece || !Number.isSafeInteger(piece.index) || piece.index < 0 || piece.index >= 8) return invalid()
        const call = calls.get(piece.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (piece.type !== undefined && piece.type !== 'function') return invalid()
        for (const value of [piece.id, piece.function?.name, piece.function?.arguments]) if (value !== undefined && typeof value !== 'string') return invalid()
        call.id += piece.id ?? ''; call.function.name += piece.function?.name ?? ''; call.function.arguments += piece.function?.arguments ?? ''
        if (call.id.length > 200 || call.function.name.length > 200 || call.function.arguments.length > 20000) return invalid()
        calls.set(piece.index, call)
      }
    }
    if (choice.finish_reason) { if (!['stop', 'tool_calls'].includes(choice.finish_reason)) return invalid(); finished = true }
  }
  try {
    while (!terminated) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      totalBytes += value?.byteLength ?? 0
      if (totalBytes > 2 * 1024 * 1024) return invalid()
      signal.throwIfAborted(); buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? ''
      if (buffer.length > 200000) return invalid()
      for (const raw of events) { if(raw.length>200000)return invalid(); event(raw); if (terminated) break }
      if (done) { if (buffer.trim() && !terminated) event(buffer); break }
    }
    if (!finished || !content && !calls.size) return invalid()
    const toolCalls = [...calls].sort(([a], [b]) => a-b).map(([, call]) => call)
    if (toolCalls.some(call => !call.id || !call.function.name || !call.function.arguments) || new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) return invalid()
    for (const call of toolCalls) { try { JSON.parse(call.function.arguments) } catch { return invalid() } }
    return { content, toolCalls, ...(config ? { diagnostics: generationDiagnostics(config,lastPayload,lastReason) } : {}), ...(config?.generation.capabilities.rule?.preserveReasoning ? { providerContent: { version:1 as const, protocol:'openai-compatible' as const, scope:providerScope(config), reasoningContent:reasoning } } : {}) }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
