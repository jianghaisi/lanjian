import type { LocalSamplingDefaults } from '../../../../contracts/models/local-model-contracts'
import type { AiFunctionTool, AiToolMessage, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { ModelProfile, AiTask } from '../../../../contracts/index'
import type { RemoteModelProtocol } from './model-connections'
import type { LegacyModelProfile } from '../../../../contracts/models/types'
import type { ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'
import type { EffectiveGeneration } from '../../../../contracts/models/generation-parameters'
/** Process-private capability. Recheck persistent state, then assert scope synchronously at dispatch. */
export type ModelRequestGuard = { recheck(): Promise<void>; assertActive(): void }
export type RemoteModelConnection = { kind:RemoteModelProtocol; connectionId:string; connectionName:string; baseUrl:string; apiKey:string; requestGuard?:ModelRequestGuard; catalogEntries?: ModelCatalogEntry[]; generation?: EffectiveGeneration }
export type LocalModelConnection = { kind:'local'; connectionId:string; connectionName:string; baseUrl?:never; apiKey?:never; requestGuard?:ModelRequestGuard }
export type ResolvedModelConnection = RemoteModelConnection | LocalModelConnection
export type RemoteModelSettings = { resolve(task:AiTask,connectionId?:string):Promise<RemoteModelConnection & {profile:ModelProfile}>;resolveConnection(id:string):Promise<RemoteModelConnection> }
export type ModelSettingsResolver = { resolve(task:AiTask,connectionId?:string):Promise<ResolvedModelConnection & {profile:ModelProfile}>;resolveConnection(id:string):Promise<ResolvedModelConnection> }
export type TextCompletionInput = {
  model: string; profile: LegacyModelProfile; messages: Array<{role: 'system'|'user'|'assistant'; content: string}>
  signal?: AbortSignal; onDelta?: (delta: string, content: string) => void | Promise<void>
}
export interface LocalTextProvider {
  listModels(): Promise<string[]>
  ready(model: string): Promise<boolean>
  limits(model: string): { samplingDefaults?: LocalSamplingDefaults; contextTokens: number; systemReserveTokens: number; maxOutputTokens: number; recommendedOutputTokens: number }
  complete(input: TextCompletionInput): Promise<{ content: string }>
  toolStep(model: string, profile: LegacyModelProfile, messages: AiToolMessage[], tools: AiFunctionTool[], signal: AbortSignal): Promise<AiToolStep>
}

export type LocalTextRequest = { action:'complete'|'tokenize'; messages:Array<{role:'system'|'user'|'assistant';content:string}>;maxTokens:number;temperature:number;topP:number;schema?:Record<string,unknown> }
export type LocalTextResult={content:string;finishReason:'stop'|'length';promptTokens:number;completionTokens:number;seconds:number;firstTextSeconds?:number|null}
