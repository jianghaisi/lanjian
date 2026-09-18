import { AppError } from '../../../core/errors/app-error'
import type { RemoteModelConnection, RemoteModelSettings, TextCompletionInput } from '../domain/model-provider'
import type { AiConnectionTestResult, AiTask } from '../../../../contracts/index'
import { generationTimeoutMs } from './openai-compatible-text-client'

const MAX_OUTPUT_CHARACTERS = 5_000_000
// The product allows very large long-form outputs. Keep the transport ceiling
// above that author-facing character limit while still bounding hostile input.
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024

type NativeConfig = RemoteModelConnection & { profile: Awaited<ReturnType<RemoteModelSettings['resolve']>>['profile'] }

export type PreparedGeminiCompletion = {
  readonly model: string
  readonly connectionId: string
  complete: (instruction: string, draft?: string, systemContext?: string, signal?: AbortSignal) => Promise<{ content: string }>
  completeMessages: (messages: TextCompletionInput['messages'], signal?: AbortSignal) => Promise<{ content: string }>
}

/** Gemini generateContent text subset. Credentials and provider payloads remain process-private. */
export class GeminiNativeTextClient {
  constructor(private readonly settings: RemoteModelSettings) {}

  async listModels(signal?: AbortSignal): Promise<{ models: string[] }> {
    const config = await this.resolve('prose')
    return this.listModelsWithConfig(config, signal)
  }

  async testConnection(): Promise<AiConnectionTestResult> {
    const config = await this.resolve('prose')
    const model = config.profile.model
    let models: string[] = []
    let modelListWarning: string | undefined
    try {
      try { models = (await this.listModelsWithConfig(config)).models }
      catch (error) { modelListWarning = friendlyError(error, '模型列表接口不可用') }
      await this.completeMessagesWithConfig([{ role: 'user', content: '这是连接测试。请只回复：连接正常' }], model, config, undefined, 30_000)
      return {
        success: true,
        message: modelListWarning ? `“${model}”已完成 Gemini 原生生成；但服务没有提供可用的模型列表。` : `“${model}”已完成 Gemini 原生生成，连接可用。`,
        model,
        models,
        modelListWarning
      }
    } catch (error) {
      return { success: false, message: friendlyError(error, 'Gemini 原生生成失败'), model, models, modelListWarning }
    }
  }

  async prepareCompletion(task: AiTask, modelOverride?: string, connectionIdOverride?: string): Promise<PreparedGeminiCompletion> {
    const resolved = await this.resolve(task, connectionIdOverride)
    const config = Object.freeze({ ...resolved, profile: Object.freeze({ ...resolved.profile }) })
    const model = modelOverride?.trim() || config.profile.model
    return Object.freeze({
      model,
      connectionId: config.connectionId,
      complete: (instruction: string, draft = '', systemContext = '', signal?: AbortSignal) =>
        this.completeMessagesWithConfig(this.messages(instruction, draft, systemContext), model, config, signal),
      completeMessages: (messages: TextCompletionInput['messages'], signal?: AbortSignal) =>
        this.completeMessagesWithConfig(messages, model, config, signal)
    })
  }

  async streamComplete(
    instruction: string,
    draft = '',
    systemContext = '',
    task: AiTask = 'prose',
    signal?: AbortSignal,
    modelOverride?: string,
    onDelta?: (delta: string, content: string) => void | Promise<void>,
    connectionIdOverride?: string
  ): Promise<{ content: string }> {
    const config = await this.resolve(task, connectionIdOverride)
    const model = modelOverride?.trim() || config.profile.model
    const messages = this.messages(instruction, draft, systemContext)
    const response = await this.request(
      `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      config,
      { method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify(geminiBody(messages, config.profile)) },
      signal,
      generationTimeoutMs(messages.reduce((sum, item) => sum + item.content.length, 0), config.profile.maxTokens)
    )
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType.includes('application/json')) {
      const content = extractFinalText(await readJson(response))
      await onDelta?.(content, content)
      return { content }
    }
    const content = await consumeGeminiStream(response, onDelta)
    if (!content) throw invalidResponse('Gemini 原生接口没有返回可用的最终文本。')
    return { content }
  }

  prepareToolConversation(): never {
    throw new AppError('FEATURE_UNAVAILABLE', '当前 Gemini 原生连接暂不支持工具调用，请为助笔工具选择 OpenAI 兼容接口。', { recoverable: true })
  }

  private async resolve(task: AiTask, connectionId?: string): Promise<NativeConfig> {
    const config = await this.settings.resolve(task, connectionId)
    if (config.kind !== 'gemini-native') throw new AppError('VALIDATION_ERROR', '模型连接协议与 Gemini 原生客户端不匹配。', { recoverable: true })
    return config
  }

  private async listModelsWithConfig(config: NativeConfig, signal?: AbortSignal): Promise<{ models: string[] }> {
    const payload = await readJson(await this.request('/v1beta/models', config, {}, signal, 30_000))
    if (!isRecord(payload) || !Array.isArray(payload.models)) throw invalidResponse('Gemini 原生型号列表格式无效。')
    const models = payload.models.flatMap(value => isRecord(value) && typeof value.name === 'string'
      ? [value.name.replace(/^models\//, '')] : [])
    return { models }
  }

  private async completeMessagesWithConfig(
    messages: TextCompletionInput['messages'],
    model: string,
    config: NativeConfig,
    signal?: AbortSignal,
    timeoutMs = generationTimeoutMs(messages.reduce((sum, item) => sum + item.content.length, 0), config.profile.maxTokens)
  ): Promise<{ content: string }> {
    const response = await this.request(
      `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      config,
      { method: 'POST', body: JSON.stringify(geminiBody(messages, config.profile)) },
      signal,
      timeoutMs
    )
    return { content: extractFinalText(await readJson(response)) }
  }

  private messages(instruction: string, draft: string, systemContext: string): TextCompletionInput['messages'] {
    return [
      { role: 'system', content: systemContext },
      { role: 'user', content: `${instruction.trim()}${draft ? `\n\n当前正文：\n${draft}` : ''}` }
    ]
  }

  private async request(path: string, config: NativeConfig, init: RequestInit, signal?: AbortSignal, timeoutMs = 30_000): Promise<Response> {
    signal?.throwIfAborted()
    await config.requestGuard?.recheck()
    signal?.throwIfAborted()
    let response: Response
    try {
      config.requestGuard?.assertActive()
      response = await fetch(geminiEndpoint(config.baseUrl, path), {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
          ...init.headers
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new AppError('FEATURE_UNAVAILABLE', `Gemini 服务在 ${Math.ceil(timeoutMs / 1000)} 秒内没有开始返回结果；任务已安全停止。`, { recoverable: true, cause: error })
      }
      if (error instanceof TypeError) {
        throw new AppError('FEATURE_UNAVAILABLE', '无法连接 Gemini 原生服务，请检查服务根地址、网络和本机代理设置。', { recoverable: true, cause: error })
      }
      throw error
    }
    if (!response.ok) {
      await discardBounded(response)
      throw new AppError('FEATURE_UNAVAILABLE', nativeHttpErrorMessage(response.status), { recoverable: true })
    }
    return response
  }
}

/**
 * Official Gemini roots omit the version; NewAPI-style gateways may expose
 * Gemini at the exact configured /v1 or /v1beta prefix. Preserve an explicit
 * version instead of producing /v1/v1beta, while defaulting bare roots to the
 * official /v1beta path.
 */
export function geminiEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return /\/v1(?:beta)?$/i.test(base) ? `${base}${path.replace(/^\/v1beta/i, '')}` : `${base}${path}`
}

function geminiBody(messages: TextCompletionInput['messages'], profile: NativeConfig['profile']): Record<string, unknown> {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).filter(Boolean)
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }))
  if (!contents.length) throw new AppError('VALIDATION_ERROR', 'Gemini 原生请求至少需要一条用户或模型消息。', { recoverable: true })
  return {
    ...(system.length ? { systemInstruction: { parts: system.map(text => ({ text })) } } : {}),
    contents,
    generationConfig: { temperature: profile.temperature, topP: profile.topP, maxOutputTokens: profile.maxTokens }
  }
}

export function extractFinalText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || !payload.candidates.length) throw invalidResponse('Gemini 原生接口没有返回候选结果。')
  const candidate = payload.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) throw invalidResponse('Gemini 原生候选结构无效。')
  if (typeof candidate.finishReason === 'string' && candidate.finishReason !== 'STOP') throw invalidResponse('Gemini 原生生成未正常完成，请调整内容或输出预算后重试。')
  let content = ''
  for (const part of candidate.content.parts) {
    if (!isRecord(part) || part.thought === true || typeof part.text !== 'string') continue
    content += part.text
    if (content.length > MAX_OUTPUT_CHARACTERS) throw invalidResponse('AI 输出超过 500 万字符限制，已停止接收。')
  }
  if (!content.trim()) throw invalidResponse('Gemini 原生接口没有返回可用的最终文本。')
  return content
}

export async function consumeGeminiStream(
  response: Response,
  onDelta?: (delta: string, content: string) => void | Promise<void>
): Promise<string> {
  if (!response.body) throw invalidResponse('Gemini 原生服务没有返回可读取的数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', content = '', bytes = 0
  const consumeEvent = async (event: string): Promise<boolean> => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return false
    if (data === '[DONE]') return true
    let payload: unknown
    try { payload = JSON.parse(data) }
    catch { throw invalidResponse('Gemini 原生服务返回了无法解析的流式数据。') }
    const delta = extractStreamText(payload)
    if (!delta) return false
    content += delta
    if (content.length > MAX_OUTPUT_CHARACTERS) throw invalidResponse('AI 输出超过 500 万字符限制，已停止接收。')
    await onDelta?.(delta, content)
    return false
  }
  while (true) {
    const { value, done } = await reader.read()
    bytes += value?.byteLength ?? 0
    if (bytes > MAX_RESPONSE_BYTES) throw invalidResponse('Gemini 原生响应超过安全大小限制。')
    buffer += decoder.decode(value, { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const event of events) if (await consumeEvent(event)) return content
    if (done) break
  }
  if (buffer.trim()) await consumeEvent(buffer)
  return content
}

function extractStreamText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || !payload.candidates.length) return ''
  const candidate = payload.candidates[0]
  if (!isRecord(candidate)) throw invalidResponse('Gemini 原生流式候选结构无效。')
  if (typeof candidate.finishReason === 'string' && candidate.finishReason !== 'STOP') throw invalidResponse('Gemini 原生生成未正常完成，请调整内容或输出预算后重试。')
  if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return ''
  return candidate.content.parts.flatMap(part => isRecord(part) && part.thought !== true && typeof part.text === 'string' ? [part.text] : []).join('')
}

async function readJson(response: Response): Promise<unknown> {
  const bytes = await readBounded(response)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw invalidResponse('Gemini 原生服务返回了无法解析的数据。') }
}

async function readBounded(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) throw invalidResponse('Gemini 原生响应超过安全大小限制。')
    chunks.push(value)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

async function discardBounded(response: Response): Promise<void> {
  try { await readBounded(response) } catch { /* provider error bodies are deliberately discarded */ }
}

function nativeHttpErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Gemini 原生接口密钥无效或没有当前模型权限，请检查令牌分组。'
  if (status === 404) return 'Gemini 原生服务根地址或型号路径不正确；请填写服务根地址，不要附加 /v1。'
  if (status === 429) return 'Gemini 原生接口当前限流、余额不足或配额已用完，请稍后重试。'
  if (status === 400 || status === 422) return '请求被 Gemini 原生服务拒绝，请检查型号名称和连接协议。'
  return `Gemini 原生服务返回 ${status}，请稍后重试。`
}

function friendlyError(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback
}

function invalidResponse(message: string): AppError {
  return new AppError('AI_RESPONSE_INVALID', message, { recoverable: true })
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
