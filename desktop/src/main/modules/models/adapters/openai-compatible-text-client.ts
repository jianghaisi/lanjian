import { modelHttpError, readModelError, rethrowModelTransport } from './model-service-errors'
import { chatToolHistory } from './chat-tool-history'
import { generationDiagnostics, providerScope, assertSuccessfulStop, consumeProviderResponse, readProviderJson } from './provider-transport'
import type { GeneratedText } from '../../../../contracts/models/generation-diagnostics'
import { providerInvalid } from '../../../../contracts/models/provider-tool-content'
import { consumeToolStream } from './openai-tool-stream'
import { compileRemoteConfig, type CompiledRemoteConfig } from '../domain/generation-config'
import { decodeCatalogEntry, type ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'
import { compileGeneration } from '../../../../contracts/models/generation-parameters'
import type { AiConnectionDraft, AiConnectionTestResult, AiTask } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import type { RemoteModelConnection, RemoteModelSettings, TextCompletionInput } from '../domain/model-provider'
import type { AiFunctionTool, AiToolCall, AiToolMessage, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'

export type PreparedAiCompletion = {
  readonly model: string
  readonly connectionId: string
  complete: (instruction: string, draft?: string, systemContext?: string, signal?: AbortSignal) => Promise<GeneratedText>
  completeMessages?: (messages: TextCompletionInput['messages'], signal?: AbortSignal) => Promise<GeneratedText>
}

export class OpenAiCompatibleTextClient {
  constructor(private readonly settings: RemoteModelSettings, private readonly transport?: typeof fetch) {}

  async listModels(draft?: AiConnectionDraft, signal?: AbortSignal): Promise<{ models: string[]; entries: ModelCatalogEntry[] }> {
    return this.queryModels(draft, undefined, signal)
  }

  private async queryModels(draft?: AiConnectionDraft, frozenConfig?: RemoteModelConnection, signal?: AbortSignal): Promise<{ models: string[]; entries: ModelCatalogEntry[] }> {
    const response = await this.request('/models', 'prose', {}, draft, signal, 30_000, frozenConfig)
    const payload = await readProviderJson(response, signal) as { data?: Array<{ id?: string }> }
    if (!Array.isArray(payload.data) || payload.data.length > 2000) throw new AppError('AI_RESPONSE_INVALID', '接口返回的型号列表无效。', { recoverable: true })
    const entries = [...new Map(payload.data.map(item => { const entry = decodeCatalogEntry({ id: item?.id }); return [entry.id, entry] as const })).values()]
    return { models: entries.map(e => e.id), entries }
  }

  async testConnection(draft?: AiConnectionDraft): Promise<AiConnectionTestResult> {
    draft = draft ? { ...draft } : undefined
    let model = draft?.model?.trim() || ''
    let models: string[] = []
    let modelListWarning: string | undefined
    try {
      let connection: RemoteModelConnection | undefined
      if (!model) {
        const resolved = await this.settings.resolve('prose', draft?.connectionId)
        model = resolved.profile.model
        connection = { ...resolved }
      } else if (!draft?.baseUrl?.trim() || !draft?.apiKey?.trim()) {
        connection = { ...(draft?.connectionId
          ? await this.settings.resolveConnection(draft.connectionId)
          : await this.settings.resolve('prose')) }
      }
      // The catalog probe and generation probe share one saved credential capability.
      // A rotation/disable between them must stop, not silently test a different key.
      try {
        models = (await this.queryModels(draft, connection)).models
      } catch (error) {
        modelListWarning = friendlyError(error, '模型列表接口不可用')
      }
      const response = await this.request('/chat/completions', 'prose', {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '这是连接测试。请只回复：连接正常' }],
          ...compileGeneration({ connectionId: connection?.connectionId ?? 'probe', model, parameterPolicy: { version: 1, mode: 'auto' } }, 'prose', { protocol: 'openai-compatible', baseUrl: draft?.baseUrl?.trim() || connection?.baseUrl, model }, 'probe').parameters
        })
      }, draft, undefined, 30_000, connection)
      const payload = await readProviderJson(response) as { choices?: Array<{ message?: { content?: string } }> }
      if (!payload.choices?.[0]?.message?.content?.trim()) throw new Error('接口响应成功，但没有返回可用文本')
      return {
        success: true,
        message: modelListWarning ? `“${model}”已完成真实生成；但服务没有提供可用的模型列表。` : `“${model}”已完成真实生成，连接可用。`,
        model,
        models,
        modelListWarning
      }
    } catch (error) {
      return { success: false, message: friendlyError(error, '模型实际生成失败'), model, models, modelListWarning }
    }
  }

  async modelFor(task: AiTask, override?: string, connectionIdOverride?: string): Promise<string> {
    const { profile } = await this.settings.resolve(task, connectionIdOverride)
    return override?.trim() || profile.model
  }

  async complete(instruction: string, draft = '', systemContext = '', task: AiTask = 'prose', signal?: AbortSignal, modelOverride?: string, connectionIdOverride?: string): Promise<GeneratedText> {
    const prepared = await this.prepareCompletion(task, modelOverride, connectionIdOverride)
    return prepared.complete(instruction, draft, systemContext, signal)
  }

  /** Credentials remain in this process-local closure, never in evaluation reports or IPC. */
  async prepareCompletion(task: AiTask, modelOverride?: string, connectionIdOverride?: string): Promise<PreparedAiCompletion> {
    const taskConfig = await this.settings.resolve(task, connectionIdOverride)
    const config = compileRemoteConfig(taskConfig, task, modelOverride)
    const model = config.profile.model
    return Object.freeze({
      model,
      connectionId: config.connectionId,
      complete: (instruction: string, draft = '', systemContext = '', signal?: AbortSignal) =>
        this.completeWithConfig(instruction, draft, systemContext, task, signal, model, config),
      completeMessages: (messages:TextCompletionInput['messages'],signal?:AbortSignal) => this.completeMessagesWithConfig(messages,task,signal,model,config)
    })
  }

  /** Real function calling; tools execute only in the bounded application dispatcher. */
  async prepareToolConversation(task:AiTask,modelOverride?:string,connectionIdOverride?:string) {
    const resolved=await this.settings.resolve(task,connectionIdOverride),config=compileRemoteConfig(resolved,task,modelOverride,'tools'),model=config.profile.model
    return {model,connectionId:config.connectionId,step:async(messages:AiToolMessage[],tools:AiFunctionTool[],signal:AbortSignal,onDelta?:(content:string)=>void):Promise<AiToolStep>=>{
      const response=await this.request('/chat/completions',task,{method:'POST',body:JSON.stringify({model,messages:chatToolHistory(config,messages),tools,tool_choice:'auto',parallel_tool_calls:false,...config.generation.parameters,...(onDelta?{stream:true}:{})})},undefined,signal,generationTimeoutMs(JSON.stringify(messages).length,config.profile.maxTokens),config)
      if(onDelta&&response.headers.get('content-type')?.includes('text/event-stream'))return consumeToolStream(response,signal,onDelta,config)
      const payload=await readProviderJson(response,signal) as {choices?:Array<{finish_reason?:string;message?:{content?:unknown;tool_calls?:unknown;reasoning_content?:unknown}}>},message=payload.choices?.[0]?.message
      assertOpenAiFinishReason(payload.choices?.[0]?.finish_reason)
      const content=typeof message?.content==='string'?message.content:''
      const raw=message?.tool_calls??[]
      if(!Array.isArray(raw)||raw.length>8||content.length>50000)throw new AppError('AI_RESPONSE_INVALID','模型返回的工具调用无法识别，请重试。',{recoverable:true})
      const toolCalls:AiToolCall[]=raw.map(call=>{
        if(!call||call.type!=='function'||typeof call.id!=='string'||call.id.length>200||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string'||call.function.arguments.length>20000)throw new AppError('AI_RESPONSE_INVALID','模型工具参数无效，当前内容已保留。',{recoverable:true})
        return {id:call.id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}}
      })
      if(!content&&!toolCalls.length)throw new AppError('AI_RESPONSE_INVALID','模型没有返回对话或工具调用，请检查接口是否支持工具调用。',{recoverable:true})
      if(config.generation.policyVersion===2)assertSuccessfulStop(payload.choices?.[0]?.finish_reason,[toolCalls.length?'tool_calls':'stop'])
      const reasoning = message?.reasoning_content
      if (reasoning !== undefined && (typeof reasoning !== 'string' || reasoning.length > 131072)) return providerInvalid()
      return {content,toolCalls,diagnostics:generationDiagnostics(config,payload,payload.choices?.[0]?.finish_reason),
        ...(typeof reasoning === 'string' && config.generation.capabilities.rule?.preserveReasoning ? {providerContent:{version:1 as const,protocol:'openai-compatible' as const,scope:providerScope(config),reasoningContent:reasoning}} : {})}
    }}
  }

  private async completeWithConfig(instruction: string, draft: string, systemContext: string, task: AiTask, signal: AbortSignal | undefined, model: string, config: CompiledRemoteConfig): Promise<GeneratedText> {
    return this.completeMessagesWithConfig([{role:'system',content:systemContext},{role:'user',content:`${instruction.trim()}${draft ? `\n\n当前正文：\n${draft}` : ''}`}],task,signal,model,config)
  }

  private async completeMessagesWithConfig(messages:TextCompletionInput['messages'],task:AiTask,signal:AbortSignal|undefined,model:string,config:CompiledRemoteConfig):Promise<GeneratedText> {
    const { profile } = config
    const response = await this.request('/chat/completions', task, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        ...config.generation.parameters
      })
    }, undefined, signal, generationTimeoutMs(messages.reduce((sum,item)=>sum+item.content.length,0), profile.maxTokens), config)
    const payload = await readProviderJson(response, signal) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
    assertOpenAiFinishReason(payload.choices?.[0]?.finish_reason)
    if (config.generation.policyVersion === 2) assertSuccessfulStop(payload.choices?.[0]?.finish_reason, ['stop'])
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('AI API 未返回正文内容')
    return { content, diagnostics: generationDiagnostics(config,payload,payload.choices?.[0]?.finish_reason) }
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
    const taskConfig = await this.settings.resolve(task, connectionIdOverride)
    const config = compileRemoteConfig(taskConfig, task, modelOverride)
    const { profile } = config
    const model = modelOverride?.trim() || profile.model
    const messages: TextCompletionInput['messages'] = [
      { role: 'system', content: systemContext },
      { role: 'user', content: `${instruction.trim()}${draft ? `\n\n当前正文：\n${draft}` : ''}` }
    ]
    let response: Response
    try {
      response = await this.request('/chat/completions', task, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        body: JSON.stringify({
          model,
          messages,
          ...config.generation.parameters,
          stream: true
        })
      }, undefined, signal, generationTimeoutMs(systemContext.length, profile.maxTokens), config)
    } catch (error) {
      if (!isExplicitStreamServerFailure(error)) throw error
      const fallback = await this.completeMessagesWithConfig(messages, task, signal, model, config)
      await onDelta?.(fallback.content, fallback.content)
      return fallback
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    if (contentType.includes('application/json')) {
      const payload = await readProviderJson(response, signal) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
      assertOpenAiFinishReason(payload.choices?.[0]?.finish_reason)
      if (config.generation.policyVersion === 2) assertSuccessfulStop(payload.choices?.[0]?.finish_reason, ['stop'])
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('AI API 未返回正文内容')
      await onDelta?.(content, content)
      return { content, diagnostics: generationDiagnostics(config,payload,payload.choices?.[0]?.finish_reason) }
    }
    let lastPayload: Record<string, unknown> = {}, lastReason: string | undefined
    const content = await consumeOpenAiStream(response, onDelta, (payload, reason) => { lastPayload = { ...lastPayload, ...payload }; if(reason) lastReason = reason }, signal)
    if (!content) throw new Error('AI API 未返回正文内容')
    return { content, diagnostics: generationDiagnostics(config,lastPayload,lastReason) }
  }

  private async request(
    path: string,
    task: AiTask,
    init: RequestInit = {},
    draft?: AiConnectionDraft,
    signal?: AbortSignal,
    timeoutMs = 30_000,
    frozenConfig?: RemoteModelConnection
  ): Promise<Response> {
    const draftBaseUrl = draft?.baseUrl?.trim().replace(/\/$/, '')
    const draftApiKey = draft?.apiKey?.trim()
    let connection: RemoteModelConnection | undefined
    if (!draftBaseUrl || !draftApiKey) {
      connection = frozenConfig || (draft?.connectionId
        ? await this.settings.resolveConnection(draft.connectionId)
        : await this.settings.resolve(task))
    }
    const baseUrl = draftBaseUrl || connection!.baseUrl
    if (!draftApiKey && draftBaseUrl && draftBaseUrl !== connection!.baseUrl) {
      throw new AppError('VALIDATION_ERROR', '接口地址已经修改。为防止把旧密钥发送到新的地址，请同时输入该接口的密钥，或先保存接口后再测试。', { recoverable: true })
    }
    const apiKey = draftApiKey || connection!.apiKey
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('模型接口地址必须以 http:// 或 https:// 开头')
    signal?.throwIfAborted()
    if (connection?.requestGuard) await connection.requestGuard.recheck()
    signal?.throwIfAborted()
    let response: Response
    try {
      // No await between this scope assertion and actual dispatch.
      connection?.requestGuard?.assertActive()
      response = await (this.transport ?? fetch)(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      rethrowModelTransport(error, signal)
    }
    if (!response.ok) {
      const detail = await readModelError(response, signal)
      if (signal?.aborted) rethrowModelTransport(signal.reason, signal)
      throw new AppError('FEATURE_UNAVAILABLE', modelHttpError(response.status, detail), { recoverable: true })
    }
    return response
  }
}

export function generationTimeoutMs(contextCharacters: number, maxOutputTokens: number): number {
  const contextAllowance = Math.ceil(Math.max(0, contextCharacters) / 1_000) * 1_000
  const outputAllowance = Math.ceil(Math.max(0, maxOutputTokens) / 1_000) * 3_000
  return Math.min(300_000, Math.max(120_000, 120_000 + contextAllowance + outputAllowance))
}

export async function consumeOpenAiStream(
  response: Response,
  onDelta?: (delta: string, content: string) => void | Promise<void>,
  onMetadata?: (payload: Record<string, unknown>, reason?: string) => void,
  signal: AbortSignal = new AbortController().signal
): Promise<string> {
  let content = '', finished = false
  await consumeProviderResponse(response, signal, async payload => {
    const choices = payload.choices
    if (choices === undefined || Array.isArray(choices) && !choices.length) { onMetadata?.(payload); return }
    if (!Array.isArray(choices) || choices.length !== 1) return providerInvalid()
    const choice = choices[0], delta = choice?.delta?.content ?? choice?.message?.content
    if (finished && delta) return providerInvalid()
    if (delta !== undefined && delta !== null) {
      if (typeof delta !== 'string') return providerInvalid()
      content += delta
      if (content.length > 5000000) return providerInvalid('AI 输出超过 500 万字符限制，已停止接收')
      await onDelta?.(delta, content)
    }
    const reason = choice?.finish_reason
    if (reason) { assertSuccessfulStop(reason, ['stop']); finished = true }
    onMetadata?.(payload, reason)
  }, 24 * 1024 * 1024, true)
  if (!finished) assertSuccessfulStop(undefined, [])
  return content
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '模型服务 30 秒内没有响应，请检查地址、网络或服务状态。'
  if (error instanceof TypeError) return '无法连接模型服务，请检查接口地址、网络和本机代理设置。'
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function isExplicitStreamServerFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === 'FEATURE_UNAVAILABLE' && error.message.startsWith('模型服务返回 500')
}

function assertOpenAiFinishReason(reason: string | undefined) {
  if (reason === 'content_filter' || reason === 'refusal') assertSuccessfulStop(reason, [])
  if (reason === 'length') throw new AppError('AI_RESPONSE_INVALID', '输出达到预算上限，内容未完整返回。请提高输出预算后重试。', { recoverable: true })
}
