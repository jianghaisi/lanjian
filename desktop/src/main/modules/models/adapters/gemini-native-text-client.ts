import { consumeProviderResponse, generationDiagnostics, assertSuccessfulStop } from './provider-transport'
import type { GeneratedText } from '../../../../contracts/models/generation-diagnostics'
import type { AiFunctionTool, AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { consumeGeminiToolResponse, geminiToolBody } from './gemini-tool-conversation'
import { compileRemoteConfig, type CompiledRemoteConfig } from '../domain/generation-config'
import { decodeCatalogEntry, type ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'
import { explicitThinkingLevel } from '../../../../contracts/models/thinking-level'
import { AppError } from '../../../core/errors/app-error'
import type { RemoteModelConnection, RemoteModelSettings, TextCompletionInput } from '../domain/model-provider'
import type { AiConnectionTestResult, AiTask } from '../../../../contracts/index'
import { generationTimeoutMs } from './openai-compatible-text-client'

const MAX_OUTPUT_CHARACTERS = 5_000_000
// The product allows very large long-form outputs. Keep the transport ceiling
// above that author-facing character limit while still bounding hostile input.
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024

type NativeConfig = CompiledRemoteConfig

export type PreparedGeminiCompletion = {
  readonly model: string
  readonly connectionId: string
  complete: (instruction: string, draft?: string, systemContext?: string, signal?: AbortSignal) => Promise<GeneratedText>
  completeMessages: (messages: TextCompletionInput['messages'], signal?: AbortSignal) => Promise<GeneratedText>
}

/** Gemini generateContent text subset. Credentials and provider payloads remain process-private. */
export class GeminiNativeTextClient {
  constructor(private readonly settings: RemoteModelSettings, private readonly transport?: typeof fetch) {}

  async listModels(signal?: AbortSignal): Promise<{ models: string[]; entries: ModelCatalogEntry[] }> {
    const config = await this.resolve('prose')
    return this.listModelsWithConfig(config, signal)
  }

  async testConnection(): Promise<AiConnectionTestResult> {
    const config = await this.resolve('prose', undefined, undefined, 'probe')
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
    const config = await this.resolve(task, connectionIdOverride, modelOverride)
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
  ): Promise<GeneratedText> {
    const config = await this.resolve(task, connectionIdOverride, modelOverride)
    const model = modelOverride?.trim() || config.profile.model
    const messages = this.messages(instruction, draft, systemContext)
    return this.streamMessagesWithConfig(messages, model, config, signal,
      generationTimeoutMs(messages.reduce((sum, item) => sum + item.content.length, 0), config.profile.maxTokens), onDelta)
  }

  async prepareToolConversation(task: AiTask, modelOverride?: string, connectionIdOverride?: string) {
    const config = await this.resolve(task, connectionIdOverride, modelOverride, 'tools')
    const model = config.profile.model
    return Object.freeze({
      model, connectionId: config.connectionId,
      step: async (messages: AiToolMessage[], tools: AiFunctionTool[], signal: AbortSignal, onDelta?: (content: string) => void) => {
        const body = geminiToolBody(messages, tools, config.generation.parameters)
        const timeoutMs = generationTimeoutMs(JSON.stringify(body).length, config.profile.maxTokens)
        const response = await this.request(
          `/v1beta/models/${encodeURIComponent(model)}:${onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
          config, { method: 'POST', ...(onDelta ? { headers: { Accept: 'text/event-stream' } } : {}), body: JSON.stringify(body) }, signal, timeoutMs
        )
        return consumeGeminiToolResponse(response, signal, onDelta)
      }
    })
  }

  private async resolve(task: AiTask, connectionId?: string, modelOverride?: string, operation?: 'probe' | 'tools'): Promise<NativeConfig> {
    const config = await this.settings.resolve(task, connectionId)
    if (config.kind !== 'gemini-native') throw new AppError('VALIDATION_ERROR', '模型连接协议与 Gemini 原生客户端不匹配。', { recoverable: true })
    return compileRemoteConfig(config, task, modelOverride, operation)
  }

  private async listModelsWithConfig(config: NativeConfig, signal?: AbortSignal): Promise<{ models: string[]; entries: ModelCatalogEntry[] }> {
    const models = new Map<string, ModelCatalogEntry>(), tokens = new Set<string>()
    const timeout = AbortSignal.timeout(30_000)
    const catalogSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let pageToken = '', entries = 0
    for (let page = 0; page < 40; page++) {
      catalogSignal.throwIfAborted()
      const path = `/v1beta/models${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const payload = await readJson(await this.request(path, config, {}, catalogSignal, 30_000))
      catalogSignal.throwIfAborted()
      if (!isRecord(payload) || !Array.isArray(payload.models)) throw invalidResponse('Gemini 原生型号列表格式无效。')
      entries += payload.models.length
      if (entries > 2000) throw invalidResponse('模型目录超过读取上限，无法显示完整列表，请联系服务商核对。')
      for (const value of payload.models) {
        if (!isRecord(value) || typeof value.name !== 'string') throw invalidResponse('Gemini 原生型号列表格式无效。')
        const model = value.name.replace(/^models\//, '')
        if (!model || model.length > 500 || /[\u0000-\u001f\u007f]/.test(model)) throw invalidResponse('Gemini 原生型号列表格式无效。')
        const fields = ['displayName', 'supportedGenerationMethods', 'inputTokenLimit', 'outputTokenLimit', 'temperature', 'maxTemperature', 'topP', 'thinking']
        // Gateways may serialize absent optional metadata as null. Keep it unknown,
        // while preserving explicit false/0/[] and strictly rejecting invalid non-null values.
        const entry = decodeCatalogEntry({ id: model, ...Object.fromEntries(fields.filter(k => Object.hasOwn(value, k) && value[k] !== null).map(k => [k, value[k]])) })
        models.set(model, entry)
      }
      const next = payload.nextPageToken
      if (next === undefined || next === null || next === '') return { models: [...models.keys()], entries: [...models.values()] }
      if (typeof next !== 'string' || next.length > 4096 || /[\u0000-\u001f\u007f]/.test(next) || tokens.has(next)) {
        throw invalidResponse('模型目录分页无效，未返回不完整列表，请重新获取。')
      }
      tokens.add(next); pageToken = next
    }
    throw invalidResponse('模型目录分页超过读取上限，无法显示完整列表，请联系服务商核对。')
  }

  private async completeMessagesWithConfig(
    messages: TextCompletionInput['messages'],
    model: string,
    config: NativeConfig,
    signal?: AbortSignal,
    timeoutMs = generationTimeoutMs(messages.reduce((sum, item) => sum + item.content.length, 0), config.profile.maxTokens)
  ): Promise<GeneratedText> {
    try {
      const response = await this.request(
        `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        config,
        { method: 'POST', body: JSON.stringify(geminiBody(messages, config)) },
        signal,
        timeoutMs
      )
      const payload = await readJson(response)
      if (config.generation.policyVersion === 2) assertSuccessfulStop(isRecord(payload) ? payload.candidates?.[0]?.finishReason : undefined, ['STOP'])
      return { content: extractFinalText(payload), diagnostics: geminiDiagnostics(config,payload) }
    } catch (error) {
      // A strength-specific request may already have reached the provider;
      // never replay it through another transport after an ambiguous failure.
      if (config.generation.parameters.thinkingConfig || !canRetryAsStream(error)) throw error
      return this.streamMessagesWithConfig(messages, model, config, signal, timeoutMs)
    }
  }

  private async streamMessagesWithConfig(
    messages: TextCompletionInput['messages'],
    model: string,
    config: NativeConfig,
    signal?: AbortSignal,
    timeoutMs = generationTimeoutMs(messages.reduce((sum, item) => sum + item.content.length, 0), config.profile.maxTokens),
    onDelta?: (delta: string, content: string) => void | Promise<void>
  ): Promise<GeneratedText> {
    const response = await this.request(
      `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      config,
      { method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify(geminiBody(messages, config)) },
      signal,
      timeoutMs
    )
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType.includes('application/json')) {
      const payload = await readJson(response), content = extractFinalText(payload)
      if (config.generation.policyVersion === 2) assertSuccessfulStop(isRecord(payload) ? payload.candidates?.[0]?.finishReason : undefined, ['STOP'])
      await onDelta?.(content, content)
      return { content, diagnostics: geminiDiagnostics(config,payload) }
    }
    let last: Record<string, unknown> = {}
    const content = await consumeGeminiStream(response, onDelta, p => { last = { ...last, ...p } }, signal)
    if (!content) throw invalidResponse('Gemini 原生接口没有返回可用的最终文本。')
    return { content, diagnostics: geminiDiagnostics(config,last) }
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
      response = await (this.transport ?? fetch)(geminiEndpoint(config.baseUrl, path), {
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
      throw new AppError('FEATURE_UNAVAILABLE', nativeHttpErrorMessage(response.status, init.method === 'POST' && Boolean(config.generation.parameters.thinkingConfig)), { recoverable: true })
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

function geminiBody(messages: TextCompletionInput['messages'], config: NativeConfig): Record<string, unknown> {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).filter(Boolean)
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }))
  if (!contents.length) throw new AppError('VALIDATION_ERROR', 'Gemini 原生请求至少需要一条用户或模型消息。', { recoverable: true })
  return {
    ...(system.length ? { systemInstruction: { parts: system.map(text => ({ text })) } } : {}),
    contents,
    generationConfig: config.generation.parameters
  }
}

export function extractFinalText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || !payload.candidates.length) throw invalidResponse('Gemini 原生接口没有返回候选结果。')
  const candidate = payload.candidates[0]
  if (!isRecord(candidate)) throw invalidResponse('Gemini 原生候选结构无效。')
  assertFinishReason(candidate.finishReason)
  if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) throw invalidResponse('Gemini 原生候选结构无效。')
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
  onDelta?: (delta: string, content: string) => void | Promise<void>,
  onMetadata?: (payload: Record<string, unknown>) => void,
  signal: AbortSignal = new AbortController().signal
): Promise<string> {
  let content = '', finished = false
  await consumeProviderResponse(response, signal, async payload => {
    onMetadata?.(payload)
    const delta = extractStreamText(payload)
    if (finished && delta) throw invalidResponse('Gemini 在结束后继续返回正文，无法采用。')
    content += delta
    if (content.length > MAX_OUTPUT_CHARACTERS) throw invalidResponse('AI 输出超过 500 万字符限制，已停止接收。')
    if (delta) await onDelta?.(delta, content)
    if (Array.isArray(payload.candidates) && payload.candidates[0]?.finishReason === 'STOP') finished = true
  }, 24 * 1024 * 1024, true)
  if (!finished) throw invalidResponse('Gemini 回复中断，缺少完整结束状态。')
  return content
}

function geminiDiagnostics(config: NativeConfig, payload: unknown) {
  const p = isRecord(payload) ? payload : {}, u = isRecord(p.usageMetadata) ? p.usageMetadata : {}
  return generationDiagnostics(config, { model: p.modelVersion, usage: { input_tokens: u.promptTokenCount,
    output_tokens: typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount + (typeof u.thoughtsTokenCount === 'number' ? u.thoughtsTokenCount : 0) : undefined, thinking_tokens: u.thoughtsTokenCount } }, p.candidates?.[0]?.finishReason)
}

function assertFinishReason(reason: unknown): void {
  if (reason === 'MAX_TOKENS') throw invalidResponse('Gemini 已耗尽输出预算（思考和正文共用），结果不完整。请提高最大输出 tokens 或手动降低思考强度后重试；未自动重试。')
  if (typeof reason === 'string' && reason !== 'STOP') throw invalidResponse('Gemini 原生生成未正常完成，请调整内容或输出预算后重试。')
}

function extractStreamText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || !payload.candidates.length) return ''
  const candidate = payload.candidates[0]
  if (!isRecord(candidate)) throw invalidResponse('Gemini 原生流式候选结构无效。')
  assertFinishReason(candidate.finishReason)
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

function nativeHttpErrorMessage(status: number, explicitThinking = false): string {
  if ((status === 400 || status === 422) && explicitThinking) return 'Gemini 服务拒绝了请求，可能不支持所选思考强度或其他生成参数。请核对型号和参数，或手动选择“默认”后重试；未自动降级或重复请求。'
  if (status === 401 || status === 403) return 'Gemini 原生接口密钥无效或没有当前模型权限，请检查令牌分组。'
  if (status === 404) return 'Gemini 原生服务根地址或型号路径不正确；请填写服务根地址，不要附加 /v1。'
  if (status === 429) return 'Gemini 原生接口当前限流、余额不足或配额已用完，请稍后重试。'
  if (status === 400 || status === 422) return '请求被 Gemini 原生服务拒绝，请检查型号名称和连接协议。'
  return `Gemini 原生服务返回 ${status}，请稍后重试。`
}

function canRetryAsStream(error: unknown): boolean {
  return error instanceof AppError && error.code === 'FEATURE_UNAVAILABLE'
    && (/无法连接 Gemini 原生服务/.test(error.message) || /没有开始返回结果/.test(error.message))
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
