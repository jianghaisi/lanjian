import type { AiFunctionTool, AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { AiConnectionTestResult, AiTask } from '../../../../contracts/models/types'
import { decodeCatalogEntry, type ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'
import type { GeneratedText } from '../../../../contracts/models/generation-diagnostics'
import { providerInvalid, providerRecord } from '../../../../contracts/models/provider-tool-content'
import { compileRemoteConfig, type CompiledRemoteConfig } from '../domain/generation-config'
import type { RemoteModelSettings, TextCompletionInput } from '../domain/model-provider'
import { generationTimeoutMs } from './openai-compatible-text-client'
import { consumeProviderResponse, providerRequest } from './provider-transport'
import { nativeToolBody } from './native-tool-bodies'
import { nativeProviderResponse } from './native-provider-response'

/** Explicit Messages / Responses transport; no protocol guessing or downgrade retries. */
export class NativeMessagesTextClient {
  constructor(private readonly settings: RemoteModelSettings, private readonly transport?: typeof fetch) {}
  private async resolve(task: AiTask, model?: string, id?: string, operation: 'text' | 'tools' | 'probe' = 'text') {
    const c = await this.settings.resolve(task, id)
    if (c.kind !== 'anthropic-native' && c.kind !== 'openai-responses') return providerInvalid()
    return compileRemoteConfig(c, task, model, operation)
  }
  async listModels(signal?: AbortSignal): Promise<{ models: string[]; entries: ModelCatalogEntry[] }> {
    const c = await this.settings.resolve('prose'), entries = new Map<string, ModelCatalogEntry>(), cursors = new Set<string>()
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
    let cursor = '', count = 0
    for (let page = 0; page < 40; page++) {
      let payload: Record<string, unknown> | undefined
      await consumeProviderResponse(await providerRequest(c, `/models${cursor ? `?after_id=${encodeURIComponent(cursor)}` : ''}`, undefined, bounded, this.transport), bounded, p => { if (payload) return providerInvalid(); payload = p }, 2 * 1024 * 1024)
      if (!payload || !Array.isArray(payload.data)) return providerInvalid('接口返回的型号列表无效。')
      count += payload.data.length
      if (count > 2000) return providerInvalid('目录超过读取上限，未返回不完整列表。')
      for (const raw of payload.data) {
        if (!providerRecord(raw)) return providerInvalid()
        const entry = decodeCatalogEntry({ id: raw.id, ...(c.kind === 'anthropic-native' && typeof raw.display_name === 'string' ? { displayName: raw.display_name } : {}) })
        entries.set(entry.id, entry)
      }
      if (!payload.has_more) return { models: [...entries.keys()], entries: [...entries.values()] }
      if (c.kind !== 'anthropic-native' || typeof payload.last_id !== 'string' || !payload.last_id || payload.last_id.length > 500 || cursors.has(payload.last_id)) return providerInvalid('目录分页无效，请重新获取。')
      cursor = payload.last_id; cursors.add(cursor)
    }
    return providerInvalid('目录分页超过上限，未返回不完整列表。')
  }
  async testConnection(): Promise<AiConnectionTestResult> {
    const c = await this.resolve('prose', undefined, undefined, 'probe'), model = c.profile.model
    let models: string[] = [], modelListWarning: string | undefined
    try {
      try { models = (await this.listModels()).models } catch { modelListWarning = '型号列表不可用，可保留手工型号。' }
      await this.send(c, [{ role: 'user', content: '这是连接测试。请只回复：连接正常' }], [], false, undefined, undefined, 30000)
      return { success: true, message: `“${model}”已完成真实生成；这不代表全部参数或创作质量已验收。`, model, models, modelListWarning }
    } catch (error) { return { success: false, message: error instanceof Error ? error.message : '原生协议测试失败。', model, models, modelListWarning } }
  }
  async prepareCompletion(task: AiTask, modelOverride?: string, connectionIdOverride?: string) {
    const c = await this.resolve(task, modelOverride, connectionIdOverride)
    const completeMessages = (messages: TextCompletionInput['messages'], signal?: AbortSignal): Promise<GeneratedText> => this.send(c, messages, [], false, signal)
    return Object.freeze({ model: c.profile.model, connectionId: c.connectionId, completeMessages,
      complete: (instruction: string, draft = '', systemContext = '', signal?: AbortSignal) => completeMessages(this.messages(instruction, draft, systemContext), signal) })
  }
  async streamComplete(instruction: string, draft = '', systemContext = '', task: AiTask = 'prose', signal?: AbortSignal, modelOverride?: string,
    onDelta?: (delta: string, content: string) => void | Promise<void>, connectionIdOverride?: string): Promise<GeneratedText> {
    const c = await this.resolve(task, modelOverride, connectionIdOverride)
    let previous = ''
    return this.send(c, this.messages(instruction, draft, systemContext), [], false, signal, async content => { const delta = content.slice(previous.length); previous = content; await onDelta?.(delta, content) })
  }
  async prepareToolConversation(task: AiTask, modelOverride?: string, connectionIdOverride?: string) {
    const c = await this.resolve(task, modelOverride, connectionIdOverride, 'tools')
    return Object.freeze({ model: c.profile.model, connectionId: c.connectionId, step: (messages: AiToolMessage[], tools: AiFunctionTool[], signal: AbortSignal, onDelta?: (content: string) => void) => this.send(c, messages, tools, true, signal, onDelta) })
  }
  private async send(c: CompiledRemoteConfig, messages: AiToolMessage[], tools: AiFunctionTool[], toolMode: boolean, signal?: AbortSignal, onDelta?: (content: string) => void | Promise<void>, timeout?: number) {
    const bound = AbortSignal.timeout(timeout ?? generationTimeoutMs(JSON.stringify(messages).length, c.generation.outputTokens))
    const bounded = signal ? AbortSignal.any([signal, bound]) : bound
    const body = nativeToolBody(c, messages, tools, !!onDelta)
    const response = await providerRequest(c, c.kind === 'anthropic-native' ? '/messages' : '/responses', body, bounded, this.transport)
    const result = await nativeProviderResponse(response, c, bounded, toolMode, onDelta)
    await c.requestGuard?.recheck(); bounded.throwIfAborted(); c.requestGuard?.assertActive()
    return result
  }
  private messages(instruction: string, draft: string, system: string): TextCompletionInput['messages'] {
    return [{ role: 'system', content: system }, { role: 'user', content: instruction.trim() + (draft ? `\n\n当前正文：\n${draft}` : '') }]
  }
}
