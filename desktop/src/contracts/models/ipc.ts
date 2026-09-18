import { isLocalConnection } from './local-model-contracts'
import type { AiConnectionDraft, AiSettingsUpdate } from '../index'
import type { ArgsDecoder } from '../core/validation'
import { boundedString, exactArgs, invalid, record, rejectUnknown, requiredString } from '../core/validation'
import { aiTasks, httpUrl, modelProfile } from './validation'

export const decodeAiSettingsUpdateArgs: ArgsDecoder<[AiSettingsUpdate]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'settings')
  rejectUnknown(value, 'settings', [
    'connections',
    'removeConnectionIds',
    'baseUrl',
    'apiKey',
    'clearApiKey',
    'routingMode',
    'shared',
    'tasks'
  ])
  const update: AiSettingsUpdate = {}
  if ('connections' in value) {
    if (!Array.isArray(value.connections) || value.connections.length > 20)
      invalid('connections', '必须包含 1 到 20 个接口')
    update.connections = value.connections.map((entry, index) => {
      const connection = record(entry, `connections.${index}`)
      rejectUnknown(connection, `connections.${index}`, ['id', 'name', 'baseUrl', 'apiKey', 'clearApiKey'])
      const id = requiredString(connection.id, `connections.${index}.id`, 80)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) invalid(`connections.${index}.id`, '格式无效')
      const result = {
        id,
        name: requiredString(connection.name, `connections.${index}.name`, 80),
        baseUrl: httpUrl(connection.baseUrl, `connections.${index}.baseUrl`)
      } as NonNullable<AiSettingsUpdate['connections']>[number]
      if ('apiKey' in connection)
        result.apiKey = boundedString(connection.apiKey, `connections.${index}.apiKey`, 4_096).trim()
      if ('clearApiKey' in connection) {
        if (typeof connection.clearApiKey !== 'boolean') invalid(`connections.${index}.clearApiKey`, '必须是布尔值')
        result.clearApiKey = connection.clearApiKey
      }
      return result
    })
  }
  if ('removeConnectionIds' in value) {
    if (!Array.isArray(value.removeConnectionIds) || value.removeConnectionIds.length > 20)
      invalid('removeConnectionIds', '格式无效')
    update.removeConnectionIds = value.removeConnectionIds.map((id, index) => {
      const connectionId = requiredString(id, `removeConnectionIds.${index}`, 80)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(connectionId)) invalid(`removeConnectionIds.${index}`, '格式无效')
      return connectionId
    })
  }
  if ('baseUrl' in value) update.baseUrl = httpUrl(value.baseUrl, 'baseUrl')
  if ('apiKey' in value) update.apiKey = boundedString(value.apiKey, 'apiKey', 4_096).trim()
  if ('clearApiKey' in value) {
    if (typeof value.clearApiKey !== 'boolean') invalid('clearApiKey', '必须是布尔值')
    update.clearApiKey = value.clearApiKey
  }
  if ('routingMode' in value) {
    if (value.routingMode !== 'shared' && value.routingMode !== 'perTask')
      invalid('routingMode', '不是受支持的路由方式')
    update.routingMode = value.routingMode
  }
  if ('shared' in value) update.shared = modelProfile(value.shared, 'shared')
  if ('tasks' in value) {
    const tasks = record(value.tasks, 'tasks')
    rejectUnknown(tasks, 'tasks', aiTasks)
    update.tasks = {}
    for (const task of aiTasks) if (task in tasks) update.tasks[task] = modelProfile(tasks[task], `tasks.${task}`)
  }
  return [update]
}

export const decodeAiConnectionDraftArgs: ArgsDecoder<[AiConnectionDraft | undefined]> = (args) => {
  exactArgs(args, 1)
  if (args[0] === undefined) return [undefined]
  const value = record(args[0], 'connection')
  rejectUnknown(value, 'connection', ['connectionId', 'baseUrl', 'apiKey', 'model'])
  const draft: AiConnectionDraft = {}
  if ('connectionId' in value) draft.connectionId = requiredString(value.connectionId, 'connectionId', 128)
  if ('baseUrl' in value) draft.baseUrl = httpUrl(value.baseUrl, 'baseUrl')
  if ('apiKey' in value) draft.apiKey = boundedString(value.apiKey, 'apiKey', 4_096).trim()
  if ('model' in value) draft.model = requiredString(value.model, 'model', 200)
  if (isLocalConnection(draft.connectionId) && ('baseUrl' in value || 'apiKey' in value))
    invalid('connection', '本地模型不使用接口地址或密钥')
  return [draft]
}
