import type { AiConnectionDraft, AiConnectionTestResult, AiTask } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import type { RemoteModelConnection, RemoteModelSettings, TextCompletionInput } from '../domain/model-provider'
import type { AiFunctionTool, AiToolCall, AiToolMessage, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'

export type PreparedAiCompletion = {
  readonly model: string
  readonly connectionId: string
  complete: (instruction: string, draft?: string, systemContext?: string, signal?: AbortSignal) => Promise<{ content: string }>
  completeMessages?: (messages: TextCompletionInput['messages'], signal?: AbortSignal) => Promise<{content:string}>
}

export class OpenAiCompatibleTextClient {
  constructor(private readonly settings: RemoteModelSettings) {}

  async listModels(draft?: AiConnectionDraft, signal?: AbortSignal): Promise<{ models: string[] }> {
    return this.queryModels(draft, undefined, signal)
  }

  private async queryModels(draft?: AiConnectionDraft, frozenConfig?: RemoteModelConnection, signal?: AbortSignal): Promise<{ models: string[] }> {
    const response = await this.request('/models', 'prose', {}, draft, signal, 30_000, frozenConfig)
    const payload = await response.json() as { data?: Array<{ id?: string }> }
    return { models: (payload.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)) }
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
          temperature: 0,
          max_tokens: 16
        })
      }, draft, undefined, 30_000, connection)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
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

  async complete(instruction: string, draft = '', systemContext = '', task: AiTask = 'prose', signal?: AbortSignal, modelOverride?: string, connectionIdOverride?: string): Promise<{ content: string }> {
    const prepared = await this.prepareCompletion(task, modelOverride, connectionIdOverride)
    return prepared.complete(instruction, draft, systemContext, signal)
  }

  /** Credentials remain in this process-local closure, never in evaluation reports or IPC. */
  async prepareCompletion(task: AiTask, modelOverride?: string, connectionIdOverride?: string): Promise<PreparedAiCompletion> {
    const taskConfig = await this.settings.resolve(task, connectionIdOverride)
    const profile = { ...taskConfig.profile }
    const config = { ...taskConfig, profile }
    const model = modelOverride?.trim() || profile.model
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
    const resolved=await this.settings.resolve(task,connectionIdOverride),config={...resolved,profile:{...resolved.profile}},model=modelOverride?.trim()||config.profile.model
    return {model,connectionId:config.connectionId,step:async(messages:AiToolMessage[],tools:AiFunctionTool[],signal:AbortSignal):Promise<AiToolStep>=>{
      const response=await this.request('/chat/completions',task,{method:'POST',body:JSON.stringify({model,messages,tools,tool_choice:'auto',parallel_tool_calls:false,temperature:config.profile.temperature,top_p:config.profile.topP,max_tokens:config.profile.maxTokens})},undefined,signal,generationTimeoutMs(JSON.stringify(messages).length,config.profile.maxTokens),config)
      const payload=await response.json() as {choices?:Array<{message?:{content?:unknown;tool_calls?:unknown}}>},message=payload.choices?.[0]?.message
      const content=typeof message?.content==='string'?message.content:''
      const raw=message?.tool_calls??[]
      if(!Array.isArray(raw)||raw.length>8||content.length>50000)throw new AppError('AI_RESPONSE_INVALID','模型返回的工具调用无法识别，请重试。',{recoverable:true})
      const toolCalls:AiToolCall[]=raw.map(call=>{
        if(!call||call.type!=='function'||typeof call.id!=='string'||call.id.length>200||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string'||call.function.arguments.length>20000)throw new AppError('AI_RESPONSE_INVALID','模型工具参数无效，当前内容已保留。',{recoverable:true})
        return {id:call.id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}}
      })
      if(!content&&!toolCalls.length)throw new AppError('AI_RESPONSE_INVALID','模型没有返回对话或工具调用，请检查接口是否支持工具调用。',{recoverable:true})
      return {content,toolCalls}
    }}
  }

  private async completeWithConfig(instruction: string, draft: string, systemContext: string, task: AiTask, signal: AbortSignal | undefined, model: string, config: Awaited<ReturnType<RemoteModelSettings['resolve']>>): Promise<{ content: string }> {
    return this.completeMessagesWithConfig([{role:'system',content:systemContext},{role:'user',content:`${instruction.trim()}${draft ? `\n\n当前正文：\n${draft}` : ''}`}],task,signal,model,config)
  }

  private async completeMessagesWithConfig(messages:TextCompletionInput['messages'],task:AiTask,signal:AbortSignal|undefined,model:string,config:Awaited<ReturnType<RemoteModelSettings['resolve']>>):Promise<{content:string}> {
    const { profile } = config
    const response = await this.request('/chat/completions', task, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        temperature: profile.temperature,
        top_p: profile.topP,
        max_tokens: profile.maxTokens
      })
    }, undefined, signal, generationTimeoutMs(messages.reduce((sum,item)=>sum+item.content.length,0), profile.maxTokens), config)
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('AI API 未返回正文内容')
    return { content }
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
    const taskConfig = await this.settings.resolve(task, connectionIdOverride)
    const config = { ...taskConfig, profile: { ...taskConfig.profile } }
    const { profile } = config
    const model = modelOverride?.trim() || profile.model
    const response = await this.request('/chat/completions', task, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: `${instruction.trim()}${draft ? `\n\n当前正文：\n${draft}` : ''}` }
        ],
        temperature: profile.temperature,
        top_p: profile.topP,
        max_tokens: profile.maxTokens,
        stream: true
      })
    }, undefined, signal, generationTimeoutMs(systemContext.length, profile.maxTokens), config)
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    if (contentType.includes('application/json')) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('AI API 未返回正文内容')
      await onDelta?.(content, content)
      return { content }
    }
    const content = await consumeOpenAiStream(response, onDelta)
    if (!content) throw new Error('AI API 未返回正文内容')
    return { content }
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
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new AppError('FEATURE_UNAVAILABLE', `模型服务在 ${Math.ceil(timeoutMs / 1000)} 秒内没有开始返回结果；任务已安全停止，可以重试或缩小作品上下文。`, { recoverable: true, cause: error })
      }
      if (error instanceof TypeError) {
        throw new AppError('FEATURE_UNAVAILABLE', '无法连接模型服务，请检查接口地址、网络和本机代理设置。', { recoverable: true, cause: error })
      }
      throw error
    }
    if (!response.ok) {
      const detail = extractErrorMessage(await response.text())
      throw new AppError('FEATURE_UNAVAILABLE', httpErrorMessage(response.status, detail), { recoverable: true })
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
  onDelta?: (delta: string, content: string) => void | Promise<void>
): Promise<string> {
  if (!response.body) throw new Error('模型服务没有返回可读取的数据流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const consumeEvent = async (event: string): Promise<boolean> => {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data) return false
    if (data === '[DONE]') return true
    let payload: { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }
    try { payload = JSON.parse(data) }
    catch { throw new Error('模型服务返回了无法解析的流式数据') }
    const value = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content
    const delta = typeof value === 'string' ? value : ''
    if (!delta) return false
    content += delta
    if (content.length > 5_000_000) throw new Error('AI 输出超过 500 万字符限制，已停止接收')
    await onDelta?.(delta, content)
    return false
  }
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''
    for (const event of events) if (await consumeEvent(event)) return content
    if (done) break
  }
  if (buffer.trim()) await consumeEvent(buffer)
  return content
}

function extractErrorMessage(raw: string): string {
  const clipped = raw.slice(0, 2_000)
  try {
    const value = JSON.parse(clipped) as { error?: { message?: unknown }; message?: unknown }
    const message = value.error?.message ?? value.message
    return typeof message === 'string' ? message.slice(0, 240) : ''
  } catch {
    return clipped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  }
}

function httpErrorMessage(status: number, detail: string): string {
  const lower = detail.toLowerCase()
  if (status === 401) return '接口密钥无效或已经失效，请重新检查令牌。'
  if (status === 403 || /group|分组|permission|forbidden|unauthorized/.test(lower)) {
    return '令牌没有当前模型或模型分组的调用权限，请在服务控制台授权后重试。'
  }
  if (status === 404) return '接口地址或兼容路径不正确；请确认地址通常以 /v1 结尾。'
  if (status === 429) return '接口当前限流、余额不足或配额已用完，请稍后重试或检查账户额度。'
  if (status === 400) return '请求被服务拒绝，通常是模型名称或接口协议不兼容。'
  return `模型服务返回 ${status}，请稍后重试。`
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '模型服务 30 秒内没有响应，请检查地址、网络或服务状态。'
  if (error instanceof TypeError) return '无法连接模型服务，请检查接口地址、网络和本机代理设置。'
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
