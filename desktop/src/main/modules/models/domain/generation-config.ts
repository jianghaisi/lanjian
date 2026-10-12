import type { AiTask, ModelProfile, LegacyModelProfile } from '../../../../contracts/models/types'
import { compileGeneration, runtimeProfile, type EffectiveGeneration } from '../../../../contracts/models/generation-parameters'
import type { RemoteModelConnection } from './model-provider'

export type CompiledRemoteConfig = RemoteModelConnection & { profile: LegacyModelProfile; generation: EffectiveGeneration }
export function intentForModel(profile: ModelProfile, model: string): ModelProfile {
  return model === profile.model ? profile : { connectionId: profile.connectionId, model, parameterPolicy: { version: profile.parameterPolicy?.version === 2 ? 2 : 1, mode: 'auto' } }
}
export function compileRemoteConfig(c: RemoteModelConnection & { profile: ModelProfile }, task: AiTask, modelOverride?: string, operation: 'text' | 'tools' | 'probe' = 'text'): CompiledRemoteConfig {
  const model = modelOverride?.trim() || c.profile.model
  const intent = intentForModel(c.profile, model)
  const generation = c.generation?.model === model && c.generation.task === task && operation === 'text'
    ? structuredClone(c.generation)
    : compileGeneration(intent, task, { protocol: c.kind, baseUrl: c.baseUrl, model, metadata: c.catalogEntries?.find(e => e.id === model) }, operation)
  return { ...c, profile: runtimeProfile(intent, generation), generation }
}
