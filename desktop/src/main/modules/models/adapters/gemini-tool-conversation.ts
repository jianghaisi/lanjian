import { randomUUID } from 'node:crypto'
import { rethrowModelTransport } from './model-service-errors'
import { assertSuccessfulStop } from './provider-transport'
import type { AiFunctionTool, AiToolMessage, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { decodeGeminiParts, geminiRecord, geminiToolInvalid as invalid, geminiToolLimits as limits, geminiVisibleText, validatedGeminiMessage, type GeminiToolPart } from '../../../../contracts/models/gemini-tool-content'

/** Rebuild from durable history, including provider IDs/signatures after a restart. */
export function geminiToolBody(messages: AiToolMessage[], tools: AiFunctionTool[], generationConfig: Record<string, unknown>) {
  const system: string[] = [], contents: Array<{ role: 'user' | 'model'; parts: Array<GeminiToolPart | { functionResponse: Record<string, unknown> }> }> = []
  const pending = new Map<string, NonNullable<GeminiToolPart['functionCall']>>()
  for (const message of messages) {
    if (message.providerContent) return invalid()
    if (message.role === 'system') { if (message.content) system.push(message.content); continue }
    if (message.role === 'tool') {
      const call = pending.get(message.tool_call_id ?? '')
      if (!call) return invalid()
      let result: unknown
      try { result = JSON.parse(message.content ?? 'null') } catch { return invalid() }
      const part = { functionResponse: { name: call.name, ...(call.id === undefined ? {} : { id: call.id }), response: geminiRecord(result) ? result : { result } } }
      const previous = contents.at(-1)
      if (previous?.role === 'user' && previous.parts.every(p => 'functionResponse' in p)) previous.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
      pending.delete(message.tool_call_id!)
      continue
    }
    if (pending.size) return invalid()
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const parts = replayParts(message), calls = parts.flatMap(p => p.functionCall ? [p.functionCall] : [])
      message.tool_calls.forEach((call, i) => pending.set(call.id, calls[i]))
      contents.push({ role: 'model', parts })
    } else contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: message.geminiParts ? replayParts(message) : [{ text: message.content ?? '' }] })
  }
  if (pending.size || !contents.length) return invalid()
  return {
    ...(system.length ? { systemInstruction: { parts: system.map(text => ({ text })) } } : {}), contents, generationConfig,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map(({ function: f }) => ({ name: f.name, description: f.description, parametersJsonSchema: f.parameters })) }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {})
  }
}

function replayParts(message: AiToolMessage): GeminiToolPart[] {
  // Validate before filtering. A signed empty tail is meaningful provider history.
  const parts = validatedGeminiMessage(message).filter(p => p.text !== '' || p.thoughtSignature !== undefined || p.functionCall !== undefined)
  if (!parts.length) return invalid()
  return parts
}

class GeminiToolReply {
  private parts: GeminiToolPart[] = []
  private finished = false
  constructor(private signal: AbortSignal, private onDelta?: (content: string) => void) {}
  accept(payload: unknown) {
    if (!geminiRecord(payload) || payload.error) return invalid()
    if (geminiRecord(payload.promptFeedback) && payload.promptFeedback.blockReason) assertSuccessfulStop('safety', [])
    if (payload.candidates === undefined || Array.isArray(payload.candidates) && !payload.candidates.length) return
    if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) return invalid()
    const candidate = payload.candidates[0]
    if (!geminiRecord(candidate) || candidate.index !== undefined && candidate.index !== 0) return invalid()
    if (candidate.finishReason !== undefined) assertSuccessfulStop(candidate.finishReason, ['STOP'])
    const content = candidate.content
    if (content !== undefined && (!geminiRecord(content) || content.role !== undefined && content.role !== 'model' || !Array.isArray(content.parts))) return invalid()
    const incoming = content === undefined ? [] : decodeGeminiParts((content as Record<string, unknown>).parts)
    const before = geminiVisibleText(this.parts)
    for (const part of incoming) {
      // Some streams finish with an empty text/signature part. Preserve it.
      if (this.finished && (part.text || part.functionCall)) return invalid()
      const previous = this.parts.at(-1)
      if (previous?.text !== undefined && part.text !== undefined && previous.thought === part.thought && !previous.thoughtSignature && !part.thoughtSignature) previous.text += part.text
      else this.parts.push(part)
    }
    this.parts = decodeGeminiParts(this.parts)
    if (candidate.finishReason === 'STOP') this.finished = true
    const text = geminiVisibleText(this.parts)
    this.signal.throwIfAborted()
    if (text !== before) this.onDelta?.(text)
  }
  result(): AiToolStep {
    this.signal.throwIfAborted()
    const content = geminiVisibleText(this.parts)
    const toolCalls = this.parts.flatMap(part => part.functionCall ? [{ id: `gemini_${randomUUID()}`, type: 'function' as const, function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } }] : [])
    if (!this.finished || !content.trim() && !toolCalls.length) return invalid()
    return { content, toolCalls, geminiParts: structuredClone(this.parts) }
  }
}

/** Text is transient; calls only leave this adapter after a complete STOP response. */
export async function consumeGeminiToolResponse(response: Response, signal: AbortSignal, onDelta?: (content: string) => void): Promise<AiToolStep> {
  if (!response.body) return invalid()
  const streaming = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ?? false
  const reply = new GeminiToolReply(signal, streaming ? onDelta : undefined)
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', bytes = 0, terminated = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const json = (raw: string): unknown => { try { return JSON.parse(raw) } catch { return invalid() } }
  const event = (raw: string) => {
    if (raw.length > limits.bytes) return invalid()
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return
    if (data === '[DONE]') { reply.result(); terminated = true; return }
    reply.accept(json(data))
  }
  try {
    while (!terminated) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted(); bytes += value?.byteLength ?? 0
      if (bytes > 2 * 1024 * 1024) return invalid()
      try { buffer += decoder.decode(value, { stream: !done }) } catch { return invalid() }
      if (streaming) {
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? ''
        for (const raw of events) { event(raw); if (terminated) break }
      }
      if (buffer.length > limits.bytes) return invalid()
      if (done) break
    }
    if (!terminated && buffer.trim()) { if (streaming) event(buffer); else reply.accept(json(buffer)) }
    return reply.result()
  } catch (error) { return rethrowModelTransport(error, signal) }
  finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
