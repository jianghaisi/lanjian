import type { ThinkingLevel } from './thinking-level'
import type { ParameterPolicy } from './parameter-policy'

export type AiTask = 'outline' | 'chapterOutline' | 'prose' | 'review'

export type LegacyModelProfile = {
  connectionId: string
  model: string
  temperature: number
  topP: number
  maxTokens: number
  thinkingLevel?: ThinkingLevel
  parameterPolicy?: never
}
export type AdaptiveModelProfile = { connectionId: string; model: string; parameterPolicy: ParameterPolicy;
  temperature?: never; topP?: never; maxTokens?: never; thinkingLevel?: never }
export type ModelProfile = LegacyModelProfile | AdaptiveModelProfile

export type RemoteAiProviderConnection = {
  kind?: 'openai-compatible' | 'gemini-native' | 'anthropic-native' | 'openai-responses'
  id: string
  name: string
  baseUrl: string
  apiKeyConfigured: boolean
  scope?: 'global' | 'legacy-private'
  globalConnectionId?: string
  enabled?: boolean
}

export type AiProviderConnection =
  | RemoteAiProviderConnection
  | { kind: 'local'; id: string; name: string; runtimeId: string; baseUrl?: never; apiKeyConfigured?: never }

export type AiProviderConnectionUpdate = {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  clearApiKey?: boolean
}

export type AiSettings = {
  version: 2 | 3 | 4 | 5
  modelConfigured?: boolean
  connections: AiProviderConnection[]
  apiKeyConfigured: boolean
  routingMode: 'shared' | 'perTask'
  shared: ModelProfile
  tasks: Record<AiTask, ModelProfile>
}

export type AiSettingsUpdate = {
  connections?: AiProviderConnectionUpdate[]
  removeConnectionIds?: string[]
  /** Legacy single-connection update accepted during gradual migration. */
  baseUrl?: string
  apiKey?: string
  clearApiKey?: boolean
  routingMode?: 'shared' | 'perTask'
  shared?: Partial<ModelProfile>
  tasks?: Partial<Record<AiTask, Partial<ModelProfile>>>
}

export type AiConnectionDraft = { connectionId?: string; baseUrl?: string; apiKey?: string; model?: string }

export type AiConnectionTestResult = {
  success: boolean
  message: string
  model: string
  models: string[]
  modelListWarning?: string
}
