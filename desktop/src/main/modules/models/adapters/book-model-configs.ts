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
    if (local && profile.maxTokens > local.maxOutputTokens) throw new AppError('VALIDATION_ERROR', '本地模型输出预算超过上限，原配置已保留。', { recoverable: true })
    const provider = source.kind === 'local' ? `${source.id}#${scope}`
      : source.kind === 'global' ? `global:${source.globalConnectionId}#${scope}`
        : settings.version === 4 ? `legacy:${source.originalConnectionId}#${scope}` : `${source.id}:${source.baseUrl}#${scope}`
    return {
      provider, modelName: profile.model, displayName: scope === 'shared' ? profile.model : `${profile.model} · ${scope}`,
      settingsJson: JSON.stringify({ routingMode: settings.routingMode, scope, connectionId: profile.connectionId,
        ...(source.kind === 'global' ? { connectionScope: 'global', globalConnectionId: source.globalConnectionId }
          : source.kind === 'local' ? { connectionName: '本地推理' }
            : { connectionName: source.name, ...(settings.version === 4 ? { connectionScope: 'legacy-private', originalConnectionId: source.originalConnectionId, baseUrl: source.baseUrl } : {}) }),
        temperature: profile.temperature, topP: profile.topP, maxTokens: profile.maxTokens }),
      inputTokenBudget: local ? local.contextTokens - profile.maxTokens - local.systemReserveTokens : profile.maxTokens,
      enabled: true, isDefault
    }
  })
}
