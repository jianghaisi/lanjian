import { AppError } from '../../../../desktop/src/contracts/core/app-error'
import type { AiSettings } from '../../../../desktop/src/contracts/index'
import { BOOK_MODEL_TASKS } from '../../../../desktop/src/contracts/models/book-model-settings'
import { globalConnectionId, type GlobalConnectionsView } from '../../../../desktop/src/contracts/models/model-connections'
import { modelConnectionArgs, type ModelCatalogQuery } from '../../../../desktop/src/contracts/models/model-connections-contracts'
import { decodeNoArgs } from '../../../../desktop/src/contracts/ipc'
import { registerValidatedIpc, type IpcRegistrar } from '../../../../desktop/src/main/platform/ipc/validated-ipc'
import type { ModelStore } from '../models/model-store.ts'
import type { BookRuntime } from './book-runtime.ts'

/** One operator-selected model; portable book settings are not online authority. */
export function desktopAiSettings(models: ModelStore): AiSettings {
  const model = models.selected(), profile = { connectionId: model?.id ?? 'hosted', model: model?.model ?? 'unconfigured',
    maxTokens: model?.maxOutputTokens ?? 4096, temperature: .7, topP: .95 }
  return { version: 4, routingMode: 'shared', shared: profile,
    tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, { ...profile }])) as AiSettings['tasks'],
    apiKeyConfigured: Boolean(model), modelConfigured: Boolean(model),
    connections: model ? [{ kind: model.protocol, id: model.id, name: model.name, baseUrl: model.baseUrl,
      scope: 'global', globalConnectionId: globalConnectionId(`global-hosted-${model.id}`), enabled: true, apiKeyConfigured: true }] : [] }
}

export function desktopModelCatalog(models: ModelStore) {
  const list = async (): Promise<GlobalConnectionsView> => {
    const entry = models.selected()
    return { revision: models.selection().revision + (entry?.revision ?? 0), connections: entry ? [{
      id: globalConnectionId(`global-hosted-${entry.id}`), name: entry.name, baseUrl: entry.baseUrl, protocol: entry.protocol,
      enabled: true, revision: entry.revision, credentialState: 'stored'
    }] : [] }
  }
  const catalog = async (input: ModelCatalogQuery) => {
    const entry = models.selected()
    if (!entry || `global-hosted-${entry.id}` !== input.id || input.revision !== entry.revision) throw new AppError('CONFLICT', '在线模型已变化，请刷新。', { recoverable: true })
    return { id: input.id, revision: entry.revision, model: entry.model, testedAt: new Date().toISOString(),
      success: true, message: '当前在线创作模型。', models: [entry.model],
      catalog: { connectionId: input.id, revision: entry.revision, protocol: entry.protocol, fetchedAt: new Date().toISOString(), complete: true, entries: [{ id: entry.model }] } }
  }
  return { list, catalog }
}

export function desktopBookModels(_r: BookRuntime, models: ModelStore) {
  const globals = desktopModelCatalog(models), service = { get: async () => desktopAiSettings(models) }
  function register(ipc: IpcRegistrar) {
    registerValidatedIpc(ipc, 'ai:get-settings', decodeNoArgs, service.get)
    registerValidatedIpc(ipc, 'model-connections:list', modelConnectionArgs.list, globals.list)
    registerValidatedIpc(ipc, 'model-connections:catalog', modelConnectionArgs.catalog, globals.catalog)
  }
  return { service, register }
}
