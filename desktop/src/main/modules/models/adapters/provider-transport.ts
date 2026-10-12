import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { providerInvalid, providerRecord } from '../../../../contracts/models/provider-tool-content'
import type { GenerationDiagnostics } from '../../../../contracts/models/generation-diagnostics'
import type { CompiledRemoteConfig } from '../domain/generation-config'
import type { RemoteModelConnection } from '../domain/model-provider'

export const RESPONSE_BYTES = 24 * 1024 * 1024
export function providerScope(c: CompiledRemoteConfig): string {
  return createHash('sha256').update(JSON.stringify([c.kind, c.connectionId, c.baseUrl, c.profile.model, c.generation.revision, c.generation.parameters])).digest('hex')
}
export async function providerRequest(c: RemoteModelConnection, path: string, body: unknown | undefined, signal: AbortSignal, transport: typeof fetch = fetch): Promise<Response> {
  signal.throwIfAborted(); await c.requestGuard?.recheck(); signal.throwIfAborted()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (c.kind === 'anthropic-native') { headers['x-api-key'] = c.apiKey; headers['anthropic-version'] = '2023-06-01' }
  else headers.Authorization = `Bearer ${c.apiKey}`
  const base = c.baseUrl.replace(/\/$/, ''), suffix = c.kind === 'anthropic-native' && !base.endsWith('/v1') ? `/v1${path}` : path
  let response: Response
  try {
    c.requestGuard?.assertActive()
    response = await transport(`${base}${suffix}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, redirect: 'error' })
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof AppError) throw error
    throw new AppError('FEATURE_UNAVAILABLE', '无法连接模型服务，请检查地址、网络和协议；未自动切换接口。', { recoverable: true, cause: error })
  }
  signal.throwIfAborted(); c.requestGuard?.assertActive()
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    const message = response.status === 401 ? '接口密钥无效或已失效，请检查令牌。' : response.status === 403 ? '令牌没有当前型号的调用权限。'
      : response.status === 429 ? '接口当前限流、余额不足或配额用尽，请检查账户后重试。'
        : response.status === 400 || response.status === 422 ? '服务拒绝了型号、参数或上下文；请核对协议、规则与输出预算后主动重试。'
          : response.status === 404 ? '接口路径或型号不存在，请核对服务地址与所选协议。' : `模型服务返回 ${response.status}，请稍后重试。`
    throw new AppError('FEATURE_UNAVAILABLE', message, { recoverable: true })
  }
  return response
}

/** One bounded reader for JSON and SSE; the caller still has to verify a successful terminal state. */
export async function consumeProviderResponse(response: Response, signal: AbortSignal, accept: (payload: Record<string, unknown>) => void | Promise<void>, maxBytes = RESPONSE_BYTES, streamingOverride?: boolean): Promise<void> {
  if (!response.body) return providerInvalid()
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const streaming = streamingOverride ?? response.headers.get('content-type')?.includes('text/event-stream')
  let buffer = '', bytes = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const parse = async (raw: string) => {
    const data = streaming ? raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n').trim() : raw
    if (!data || data === '[DONE]') return
    let value: unknown
    try { value = JSON.parse(data) } catch { return providerInvalid('模型返回的数据无法解析，已停止接收。') }
    if (!providerRecord(value) || value.error) return providerInvalid()
    signal.throwIfAborted(); await accept(value)
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted(); bytes += value?.byteLength ?? 0
      if (bytes > maxBytes) return providerInvalid('模型回复超过读取上限，已停止接收。')
      try { buffer += decoder.decode(value, { stream: !done }) } catch { return providerInvalid() }
      if (streaming) { const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? ''; for (const e of events) await parse(e) }
      if (done) break
    }
    if (buffer.trim()) await parse(buffer)
    signal.throwIfAborted()
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export function generationDiagnostics(c: CompiledRemoteConfig, payload: Record<string, unknown>, reason?: string): GenerationDiagnostics {
  const u = providerRecord(payload.usage) ? payload.usage : {}, detail = providerRecord(u.output_tokens_details) ? u.output_tokens_details : providerRecord(u.completion_tokens_details) ? u.completion_tokens_details : {}
  const result: GenerationDiagnostics = { ruleRevision: c.generation.revision, ...(c.generation.capabilities.rule ? { ruleId: c.generation.capabilities.rule.id } : {}), parameters: structuredClone(c.generation.parameters) }
  if (typeof payload.model === 'string' && payload.model.length > 0 && payload.model.length <= 500 && !/[\u0000-\u001f\u007f]/.test(payload.model)) result.responseModel = payload.model
  if (reason && reason.length <= 80 && !/[\u0000-\u001f\u007f]/.test(reason)) result.stopReason = reason
  for (const [key, value] of [['inputTokens', u.input_tokens ?? u.prompt_tokens], ['outputTokens', u.output_tokens ?? u.completion_tokens], ['reasoningTokens', detail.reasoning_tokens ?? u.thinking_tokens]] as const) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value
  }
  return result
}
export async function readProviderJson(response: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> | undefined
  await consumeProviderResponse(response, signal ?? AbortSignal.timeout(300000), value => { result = value }, RESPONSE_BYTES, false)
  return result ?? providerInvalid()
}
export function assertSuccessfulStop(reason: unknown, allowed: string[]): asserts reason is string {
  if (typeof reason === 'string' && allowed.includes(reason)) return
  if (['max_tokens', 'length', 'max_output_tokens'].includes(String(reason))) return providerInvalid('输出达到预算上限，内容未完整返回。请提高输出预算后重试。')
  if (['model_context_window_exceeded', 'context_length_exceeded'].includes(String(reason))) return providerInvalid('输入与输出超出上下文容量，请缩小本次上下文后重试。')
  if (['refusal', 'content_filter', 'safety'].includes(String(reason))) return providerInvalid('模型拒绝了本次请求，未生成完整正文。请调整要求后重试。')
  return providerInvalid('模型回复缺少成功结束状态或已中断，已显示片段不能视为完整结果。')
}
