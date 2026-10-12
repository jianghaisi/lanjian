import { currentModelExecution } from './model-execution-context'
import type { GeneratedText } from '../../../../contracts/models/generation-diagnostics'
import { NativeMessagesTextClient } from '../adapters/native-messages-text-client'
import { compileGeneration, runtimeProfile } from '../../../../contracts/models/generation-parameters'
import { compileRemoteConfig, intentForModel } from '../domain/generation-config'
import type { LegacyModelProfile } from '../../../../contracts/models/types'
import { assertThinkingProtocol } from '../../../../contracts/models/thinking-level'
import type { AiConnectionDraft,AiConnectionTestResult,AiTask,ModelProfile } from '../../../../contracts/index'
import type { AiFunctionTool,AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { LocalTextProvider,ModelRequestGuard,ModelSettingsResolver,RemoteModelConnection,TextCompletionInput } from '../domain/model-provider'
import { AppError } from '../../../core/errors/app-error'
import { isLocalConnection,LOCAL_CONNECTION_ID } from '../../../../contracts/models/local-model-contracts'
import { OpenAiCompatibleTextClient } from '../adapters/openai-compatible-text-client'
import { GeminiNativeTextClient } from '../adapters/gemini-native-text-client'
import { createHash } from 'node:crypto'
export { consumeOpenAiStream, generationTimeoutMs } from '../adapters/openai-compatible-text-client'
export type PreparedAiCompletion={readonly model:string;readonly connectionId:string;complete:(instruction:string,draft?:string,systemContext?:string,signal?:AbortSignal)=>Promise<GeneratedText>;completeMessages?:(messages:TextCompletionInput['messages'],signal?:AbortSignal)=>Promise<GeneratedText>}
export class AiClient {
  private remote:OpenAiCompatibleTextClient
  constructor(private settings:ModelSettingsResolver,private local?:LocalTextProvider,private frozenLocalGuard?:ModelRequestGuard,private readonly transport?:typeof fetch){
    this.remote=new OpenAiCompatibleTextClient({
      resolve:async(task,id)=>{const c=await settings.resolve(task,id);if(c.kind==='local')throw this.unavailable();return c as RemoteModelConnection & {profile:ModelProfile}},
      resolveConnection:async id=>{const c=await settings.resolveConnection(id);if(c.kind==='local')throw this.unavailable();return c as RemoteModelConnection}
    },this.transport)
  }
  private async resolve(task: AiTask, id?: string) {
    const captured = currentModelExecution()
    if (!captured) return this.settings.resolve(task, id)
    if (id !== undefined && id !== captured.connectionId) throw new AppError('CONFLICT', '接口不属于本次成员执行。', { recoverable: true })
    await captured.requestGuard?.recheck(); captured.requestGuard?.assertActive()
    return captured
  }
  private frozenOpenAi(c:RemoteModelConnection & {profile:ModelProfile}) {
    const snapshot={...c,profile:structuredClone(c.profile)}
    return new OpenAiCompatibleTextClient({resolve:async()=>snapshot,resolveConnection:async()=>snapshot},this.transport)
  }
  private frozenGemini(c:RemoteModelConnection & {profile:ModelProfile}) {
    const snapshot={...c,profile:structuredClone(c.profile)}
    return new GeminiNativeTextClient({resolve:async()=>snapshot,resolveConnection:async()=>snapshot},this.transport)
  }
  private native(c:RemoteModelConnection & {profile:ModelProfile}) {
    const snapshot={...c,profile:structuredClone(c.profile)}
    return new NativeMessagesTextClient({resolve:async()=>snapshot,resolveConnection:async()=>snapshot},this.transport)
  }
  private remoteClient(c:RemoteModelConnection & {profile:ModelProfile}) {
    return c.kind==='gemini-native'?this.frozenGemini(c):c.kind==='anthropic-native'||c.kind==='openai-responses'?this.native(c):this.frozenOpenAi(c)
  }
  private unavailable(){return new AppError('FEATURE_UNAVAILABLE','本地模型尚不可用，请到模型超市检测。',{recoverable:true})}
  private provider(){if(!this.local)throw this.unavailable();return this.local}
  private async dispatch<T>(guard:ModelRequestGuard|undefined,send:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    signal?.throwIfAborted()
    if(guard)await guard.recheck()
    signal?.throwIfAborted()
    guard?.assertActive()
    return send()
  }
  async listModels(draft?:AiConnectionDraft,signal?:AbortSignal){
    const result=await this.listCatalog(draft,signal)
    return {models:result.models}
  }
  async listCatalog(draft?:AiConnectionDraft,signal?:AbortSignal){
    if (!draft) { const c=await this.resolve('prose'); if(c.kind==='local')return {models:await this.dispatch(c.requestGuard,()=>this.provider().listModels())}; return c.kind==='anthropic-native'||c.kind==='openai-responses'?this.native(c).listModels(signal):c.kind==='gemini-native'?this.frozenGemini(c).listModels(signal):this.frozenOpenAi(c).listModels(undefined,signal) }
    if(isLocalConnection(draft?.connectionId))return {models:await this.provider().listModels()}
    if(draft.connectionId&&!draft.baseUrl?.trim()&&!draft.apiKey?.trim()){
      const c=await this.settings.resolveConnection(draft.connectionId)
      if(c.kind==='local')return {models:await this.dispatch(c.requestGuard,()=>this.provider().listModels())}
      if(c.kind==='anthropic-native'||c.kind==='openai-responses')return this.native({...c,profile:{connectionId:c.connectionId,model:draft.model?.trim()||'',parameterPolicy:{version:2,mode:'auto'}}}).listModels(signal)
      if(c.kind==='gemini-native')return this.frozenGemini({...c,profile:{connectionId:c.connectionId,model:draft.model?.trim()||'',parameterPolicy:{version:1 as const,mode:'auto' as const}}}).listModels(signal)
      return this.remote.listModels(draft,signal)
    }
    return this.remote.listModels(draft,signal)
  }
  async testConnection(draft?:AiConnectionDraft):Promise<AiConnectionTestResult>{
    if (draft && !isLocalConnection(draft.connectionId) && (draft.baseUrl?.trim()||draft.apiKey?.trim()||!draft.connectionId)) return this.remote.testConnection(draft)
    if(draft?.connectionId&&!isLocalConnection(draft.connectionId)){
      const c=await this.settings.resolveConnection(draft.connectionId)
      if(c.kind==='local')return this.testConnection({connectionId:c.connectionId,model:draft.model})
      const resolved={...c,profile:{connectionId:c.connectionId,model:draft.model?.trim()||'',parameterPolicy:{version:1 as const,mode:'auto' as const}}}
      if(c.kind==='anthropic-native'||c.kind==='openai-responses')return this.native(resolved).testConnection()
      if(c.kind==='gemini-native')return this.frozenGemini(resolved).testConnection()
      return this.frozenOpenAi(resolved).testConnection(draft)
    }
    const c=await this.resolve('prose',draft?.connectionId)
    if(c.kind!=='local')return c.kind==='anthropic-native'||c.kind==='openai-responses'?this.native(c).testConnection():c.kind==='gemini-native'?this.frozenGemini(c).testConnection():this.frozenOpenAi(c).testConnection(draft)
    const model=draft?.model?.trim()||c.profile.model,models=await this.dispatch(c.requestGuard,()=>this.provider().listModels())
    try{
      await this.dispatch(c.requestGuard,()=>this.provider().complete({model,profile:{...this.profile(c.profile,model,undefined,'prose'),maxTokens:32},messages:[{role:'user',content:'请只回复：连接正常'}]}))
      return {success:true,model,models,message:'本地模型已完成真实生成。'}
    }catch(error){return {success:false,model,models,message:error instanceof AppError?error.message:'本地模型检测失败，请重试。'}}
  }
  async modelFor(task:AiTask,override?:string,connectionIdOverride?:string){const c=await this.resolve(task,connectionIdOverride);const model=override?.trim()||c.profile.model;if(c.kind==='local')this.provider().limits(model);return model}
  async contextLimits(task:AiTask,modelOverride?:string,connectionIdOverride?:string,maxTokensOverride?:number){
    const c=await this.resolve(task,connectionIdOverride)
    if(c.kind!=='local')return undefined
    const model=modelOverride?.trim()||c.profile.model,limits=this.provider().limits(model)
    const profile=this.profile(c.profile,model,maxTokensOverride,task)
    return {...limits,outputTokens:profile.maxTokens,profile}
  }
  /** Output ceiling of the captured route, without dispatching or exposing credentials. */
  async generationFor(task: AiTask, modelOverride?: string, connectionIdOverride?: string) {
    const c = await this.resolve(task, connectionIdOverride)
    const model = modelOverride?.trim() || c.profile.model
    return c.kind === 'local' ? compileGeneration(intentForModel(c.profile, model), task, { protocol: 'local', model, localLimits: this.provider().limits(model) }) : compileRemoteConfig(c, task, modelOverride).generation
  }
  async outputTokensFor(task: AiTask, modelOverride?: string, connectionIdOverride?: string): Promise<number> {
    return (await this.generationFor(task, modelOverride, connectionIdOverride)).outputTokens
  }
  /** Process-private request scope; callers must not serialize this provider capability. */
  async captureRun(tasks:AiTask[],connectionIdOverride?:string):Promise<AiClient> {
    const snapshots = new Map<AiTask, Awaited<ReturnType<ModelSettingsResolver['resolve']>>>()
    for (const task of tasks) {
      const c = await this.resolve(task,connectionIdOverride)
      snapshots.set(task,Object.freeze({...c, ...(c.kind === 'local' ? {} : { catalogEntries: structuredClone(c.catalogEntries), generation: deepFreeze(compileRemoteConfig(c, task).generation) }), profile:deepFreeze(structuredClone(c.profile))}))
    }
    for (const c of snapshots.values()) { await c.requestGuard?.recheck(); c.requestGuard?.assertActive() }
    const resolve = async (task:AiTask,id?:string) => {
      const c = snapshots.get(task)
      if (!c || (id !== undefined && id !== c.connectionId)) throw new AppError('CONFLICT','本次模型快照已失效，请重新开始任务。',{recoverable:true})
      return c
    }
    return new AiClient({resolve,resolveConnection:async id=>{
      const c = [...snapshots.values()].find(value=>value.connectionId===id)
      if (!c) throw new AppError('CONFLICT','接口不属于本次任务。',{recoverable:true})
      return c
    }},this.local,[...snapshots.values()].find(c=>c.kind==='local')?.requestGuard,this.transport)
  }
  withLocalProfile(profile:ModelProfile):AiClient {
    const snapshot=deepFreeze(structuredClone(profile)),c={kind:'local' as const,connectionId:LOCAL_CONNECTION_ID,connectionName:'本地推理',profile:snapshot,requestGuard:this.frozenLocalGuard}
    return new AiClient({resolve:async()=>c,resolveConnection:async id=>{if(!isLocalConnection(id))throw this.unavailable();return c}},this.provider(),this.frozenLocalGuard,this.transport)
  }
  private profile(intent:ModelProfile,model:string,maxTokensOverride:number|undefined,task:AiTask):LegacyModelProfile{
    intent = intentForModel(intent, model)
    const profile=runtimeProfile(intent,compileGeneration(intent,task,{protocol:'local',model,localLimits:this.provider().limits(model)}))
    assertThinkingProtocol(profile.thinkingLevel, 'local')
    const limits=this.provider().limits(model),maxTokens=maxTokensOverride??profile.maxTokens
    if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>limits.maxOutputTokens)throw new AppError('VALIDATION_ERROR','本地模型最多输出 '+limits.maxOutputTokens+' tokens，请调整本次输出预算。',{recoverable:true})
    return {...profile,connectionId:LOCAL_CONNECTION_ID,model,maxTokens}
  }
  async prepareCompletion(task:AiTask,modelOverride?:string,connectionIdOverride?:string,maxTokensOverride?:number):Promise<PreparedAiCompletion>{
    const c=await this.resolve(task,connectionIdOverride)
    if(c.kind!=='local'){if(maxTokensOverride!==undefined)throw new AppError('VALIDATION_ERROR','本次预算只适用于本地模型。',{recoverable:true});return this.remoteClient(c).prepareCompletion(task,modelOverride,connectionIdOverride)}
    const model=modelOverride?.trim()||c.profile.model,profile=this.profile(c.profile,model,maxTokensOverride,task),provider=this.provider()
    return Object.freeze({model,connectionId:c.connectionId,complete:(instruction:string,draft='',systemContext='',signal?:AbortSignal)=>this.dispatch(c.requestGuard,()=>provider.complete({model,profile,messages:this.messages(instruction,draft,systemContext),signal}),signal),completeMessages:(messages:TextCompletionInput['messages'],signal?:AbortSignal)=>this.dispatch(c.requestGuard,()=>provider.complete({model,profile,messages,signal}),signal)})
  }
  async complete(instruction:string,draft='',systemContext='',task:AiTask='prose',signal?:AbortSignal,modelOverride?:string,connectionIdOverride?:string,maxTokensOverride?:number){
    return (await this.prepareCompletion(task,modelOverride,connectionIdOverride,maxTokensOverride)).complete(instruction,draft,systemContext,signal)
  }
  async streamComplete(instruction:string,draft='',systemContext='',task:AiTask='prose',signal?:AbortSignal,modelOverride?:string,onDelta?:(delta:string,content:string)=>void|Promise<void>,connectionIdOverride?:string,maxTokensOverride?:number):Promise<GeneratedText>{
    const c=await this.resolve(task,connectionIdOverride)
    if(c.kind!=='local'){if(maxTokensOverride!==undefined)throw new AppError('VALIDATION_ERROR','本次预算只适用于本地模型。',{recoverable:true});return this.remoteClient(c).streamComplete(instruction,draft,systemContext,task,signal,modelOverride,onDelta,connectionIdOverride)}
    const model=modelOverride?.trim()||c.profile.model
    const profile=this.profile(c.profile,model,maxTokensOverride,task)
    return this.dispatch(c.requestGuard,()=>this.provider().complete({model,profile,messages:this.messages(instruction,draft,systemContext),signal,onDelta}),signal)
  }
  async prepareToolConversation(task:AiTask,modelOverride?:string,connectionIdOverride?:string,maxTokensOverride?:number){
    const c=await this.resolve(task,connectionIdOverride)
    if(c.kind!=='local'){if(maxTokensOverride!==undefined)throw new AppError('VALIDATION_ERROR','本次预算只适用于本地模型。',{recoverable:true});return this.remoteClient(c).prepareToolConversation(task,modelOverride,connectionIdOverride)}
    const model=modelOverride?.trim()||c.profile.model,profile=this.profile(c.profile,model,maxTokensOverride,task),provider=this.provider()
    return {model,connectionId:c.connectionId,step:(messages:AiToolMessage[],tools:AiFunctionTool[],signal:AbortSignal)=>this.dispatch(c.requestGuard,()=>provider.toolStep(model,profile,messages,tools,signal),signal)}
  }
  /** Safe identity for an explicitly resumed interaction; never serializes credentials. */
  async toolConversationIdentity(modelOverride?: string, connectionIdOverride?: string, maxTokensOverride?: number): Promise<string> {
    return this.completionIdentity('outline', modelOverride, connectionIdOverride, maxTokensOverride)
  }
  async completionIdentity(task: AiTask, modelOverride?: string, connectionIdOverride?: string, maxTokensOverride?: number): Promise<string> {
    const c = await this.resolve(task, connectionIdOverride)
    await c.requestGuard?.recheck(); c.requestGuard?.assertActive()
    return createHash('sha256').update(JSON.stringify({ kind: c.kind, connectionId: c.connectionId, baseUrl: c.kind === 'local' ? null : c.baseUrl, intent: c.profile, generation: c.kind === 'local' ? this.profile(c.profile,modelOverride?.trim()||c.profile.model,maxTokensOverride,task) : compileRemoteConfig(c,task,modelOverride).generation })).digest('hex')
  }
  private messages(instruction:string,draft:string,systemContext:string):Array<{role:'system'|'user';content:string}>{
    return [{role:'system',content:systemContext},{role:'user',content:instruction.trim()+(draft?'\n\n当前正文：\n'+draft:'')}]
  }
}

function deepFreeze<T>(value:T):T {
  if(value && typeof value==='object') { for(const item of Object.values(value)) deepFreeze(item); Object.freeze(value) }
  return value
}
