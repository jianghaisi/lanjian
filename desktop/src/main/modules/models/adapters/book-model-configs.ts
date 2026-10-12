import { isReferencedBookSettings } from '../../../../contracts/models/book-model-settings'
import { compileGeneration } from '../../../../contracts/models/generation-parameters'
import { AppError } from '../../../core/errors/app-error'
import { BOOK_MODEL_TASKS, bookModelSource, decodeBookModelSettings } from '../domain/book-model-settings'
import type { WorkspaceModelConfigInput } from '../../../core/ports/workspace-database'
import { localModelCatalog } from './local-models/catalog'

/** Projection of the document, never a public machine catalog or separately supplied settings object. */
export function bookModelConfigInputs(value: unknown): WorkspaceModelConfigInput[] {
  const settings = decodeBookModelSettings(value)
  const profiles = settings.routingMode === 'shared'
    ? [['shared', settings.shared, true] as const]
    : BOOK_MODEL_TASKS.map(task => [task, settings.tasks[task], task === 'prose'] as const)
  return profiles.map(([scope, profile, isDefault]) => {
    const source = bookModelSource(settings, profile.connectionId)
    const local = source.kind === 'local' ? localModelCatalog.find(m => m.id === profile.model) : undefined
    const outputTokens = profile.parameterPolicy ? (local ? compileGeneration(profile, scope === 'shared' ? 'prose' : scope, { protocol: 'local', model: profile.model, localLimits: local }).outputTokens : profile.parameterPolicy.mode === 'custom' ? profile.parameterPolicy.overrides.maxTokens ?? 8192 : 8192) : profile.maxTokens
    if (local && outputTokens > local.maxOutputTokens) throw new AppError('VALIDATION_ERROR', '本地模型输出预算超过上限，原配置已保留。', { recoverable: true })
    const provider = source.kind === 'local' ? `${source.id}#${scope}`
      : source.kind === 'global' ? `global:${source.globalConnectionId}#${scope}`
        : isReferencedBookSettings(settings) ? `legacy:${source.originalConnectionId}#${scope}` : `${source.id}:${source.baseUrl}#${scope}`
    return {
      provider, modelName: profile.model, displayName: scope === 'shared' ? profile.model : `${profile.model} · ${scope}`,
      settingsJson: JSON.stringify({ routingMode: settings.routingMode, scope, connectionId: profile.connectionId,
        ...(source.kind === 'global' ? { connectionScope: 'global', globalConnectionId: source.globalConnectionId }
          : source.kind === 'local' ? { connectionName: '本地推理' }
            : { connectionName: source.name, ...(isReferencedBookSettings(settings) ? { connectionScope: 'legacy-private', originalConnectionId: source.originalConnectionId, baseUrl: source.baseUrl } : {}) }),
        ...(profile.parameterPolicy ? { parameterPolicy: profile.parameterPolicy } : { temperature: profile.temperature, topP: profile.topP, maxTokens: profile.maxTokens,
        ...(profile.thinkingLevel !== undefined ? { thinkingLevel: profile.thinkingLevel } : {}) }) }),
      inputTokenBudget: local ? local.contextTokens - outputTokens - local.systemReserveTokens : outputTokens,
      enabled: true, isDefault
    }
  })
}
