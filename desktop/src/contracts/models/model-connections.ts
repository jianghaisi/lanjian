import { AppError } from '../core/app-error'
import { connectionRecord, connectionRevision, nextConnectionRevision, globalConnectionId, modelConnectionName,
  modelConnectionEndpoint, modelConnectionKey, modelConnectionCiphertext } from './model-connection-values'
import { decodeStoredModelDefaults, assertModelDefaultsTransition, type StoredModelDefaults } from './new-book-model-defaults'
export * from './model-connection-values'

export const MAX_GLOBAL_CONNECTIONS = 100
export const MAX_MODEL_CONNECTION_BYTES = 4 * 1024 * 1024
export const MAX_CONNECTION_REUSE_SELECTION = 20
export const MAX_CONNECTION_REUSE_RECEIPTS = 100

export type RemoteModelProtocol = 'openai-compatible' | 'gemini-native' | 'anthropic-native' | 'openai-responses'

export function remoteModelProtocol(value: unknown): RemoteModelProtocol {
  if (value !== 'openai-compatible' && value !== 'gemini-native' && value !== 'anthropic-native' && value !== 'openai-responses') invalid()
  return value
}

export function effectiveRemoteModelProtocol(value: StoredGlobalConnection): RemoteModelProtocol {
  return value.protocol ?? 'openai-compatible'
}

export type ConnectionReuseReceipt = {
  operationId: string
  sourceIdentity: string
  sourceFingerprint: string
  connectionIds: string[]
}

/** Private machine authority. Never expose this record through IPC or book data. */
export type StoredGlobalConnection = {
  id: string
  name: string
  baseUrl: string
  /** Absent only for byte-compatible legacy rows; it projects as OpenAI-compatible. */
  protocol?: RemoteModelProtocol
  enabled: boolean
  revision: number
  encryptedApiKey?: string
}

export type GlobalConnectionDocument = {
  version: 1
  revision: number
  connections: StoredGlobalConnection[]
  reuseReceipts?: ConnectionReuseReceipt[]
  newBookDefaults?: StoredModelDefaults
}

export type GlobalConnectionView = {
  id: string
  name: string
  baseUrl: string
  protocol: RemoteModelProtocol
  enabled: boolean
  revision: number
  credentialState: 'missing' | 'stored' | 'unavailable'
}

export type GlobalConnectionsView = { revision: number; connections: GlobalConnectionView[] }
export type ConnectionCreate = { expectedRevision: number; name: string; baseUrl: string; protocol: RemoteModelProtocol; apiKey?: string }
export type ConnectionRemove = { expectedRevision: number; id: string; connectionRevision: number }
export type ConnectionUpdate = {
  expectedRevision: number
  id: string
  connectionRevision: number
  name?: string
  enabled?: boolean
  apiKey?: string
  clearApiKey?: boolean
}

/** Private snapshot fingerprint is not a UI revision or an authorization grant. */
export type GlobalConnectionSnapshot = { document: GlobalConnectionDocument; fingerprint: string | null }
export type GlobalConnectionCommitGuard = { recheck(): Promise<void>; assertActive(): void }
export interface GlobalConnectionRepository {
  read(): Promise<GlobalConnectionSnapshot>
  commit(expected: GlobalConnectionSnapshot, next: GlobalConnectionDocument, beforePublish?: GlobalConnectionCommitGuard): Promise<GlobalConnectionSnapshot>
}

/** Structurally compatible with the existing OS-backed SettingsStore SecretCodec. */
export interface ModelConnectionSecrets {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}

export function emptyGlobalConnections(): GlobalConnectionDocument {
  return { version: 1, revision: 0, connections: [] }
}

function invalid(): never {
  throw new AppError('VALIDATION_ERROR', '全局模型接口数据格式无效。', { recoverable: true })
}

export function decodeConnectionCreate(value: unknown): ConnectionCreate {
  const r = connectionRecord(value, ['expectedRevision', 'name', 'baseUrl', 'protocol', 'apiKey'])
  return {
    expectedRevision: connectionRevision(r.expectedRevision), name: modelConnectionName(r.name),
    baseUrl: modelConnectionEndpoint(r.baseUrl), protocol: remoteModelProtocol(r.protocol),
    ...(Object.hasOwn(r, 'apiKey') ? { apiKey: modelConnectionKey(r.apiKey) } : {})
  }
}

export function decodeConnectionRemove(value: unknown): ConnectionRemove {
  const r = connectionRecord(value, ['expectedRevision', 'id', 'connectionRevision'])
  return { expectedRevision: connectionRevision(r.expectedRevision), id: globalConnectionId(r.id),
    connectionRevision: connectionRevision(r.connectionRevision, 1) }
}

export function decodeConnectionUpdate(value: unknown): ConnectionUpdate {
  const r = connectionRecord(value, ['expectedRevision', 'id', 'connectionRevision', 'name', 'enabled', 'apiKey', 'clearApiKey'])
  const result: ConnectionUpdate = {
    expectedRevision: connectionRevision(r.expectedRevision), id: globalConnectionId(r.id),
    connectionRevision: connectionRevision(r.connectionRevision, 1)
  }
  if (Object.hasOwn(r, 'name')) result.name = modelConnectionName(r.name)
  if (Object.hasOwn(r, 'enabled')) {
    if (typeof r.enabled !== 'boolean') invalid()
    result.enabled = r.enabled
  }
  if (Object.hasOwn(r, 'apiKey')) result.apiKey = modelConnectionKey(r.apiKey)
  if (Object.hasOwn(r, 'clearApiKey')) {
    if (typeof r.clearApiKey !== 'boolean') invalid()
    result.clearApiKey = r.clearApiKey
  }
  if (result.clearApiKey && result.apiKey !== undefined) invalid()
  if (result.name === undefined && result.enabled === undefined && result.apiKey === undefined && !result.clearApiKey) invalid()
  return result
}

export function decodeGlobalConnectionDocument(value: unknown): GlobalConnectionDocument {
  const r = connectionRecord(value, ['version', 'revision', 'connections', 'reuseReceipts', 'newBookDefaults'])
  if (r.version !== 1 || !Array.isArray(r.connections) || r.connections.length > MAX_GLOBAL_CONNECTIONS) invalid()
  const revision = connectionRevision(r.revision)
  const ids = new Set<string>()
  const connections = Array.from(r.connections, item => {
    const c = connectionRecord(item, ['id', 'name', 'baseUrl', 'protocol', 'enabled', 'revision', 'encryptedApiKey'])
    const id = globalConnectionId(c.id)
    if (ids.has(id) || typeof c.enabled !== 'boolean') invalid()
    ids.add(id)
    const result: StoredGlobalConnection = {
      id, name: modelConnectionName(c.name), baseUrl: modelConnectionEndpoint(c.baseUrl),
      enabled: c.enabled, revision: connectionRevision(c.revision, 1)
    }
    if (Object.hasOwn(c, 'protocol')) result.protocol = remoteModelProtocol(c.protocol)
    // Stored authority must already be normalized, never repaired by reading.
    if (result.name !== c.name || result.baseUrl !== c.baseUrl || result.revision > revision) invalid()
    if (Object.hasOwn(c, 'encryptedApiKey')) result.encryptedApiKey = modelConnectionCiphertext(c.encryptedApiKey)
    return result
  })
  if (revision === 0 && connections.length) invalid()
  const result: GlobalConnectionDocument = { version: 1, revision, connections }
  if (Object.hasOwn(r, 'newBookDefaults')) result.newBookDefaults = decodeStoredModelDefaults(r.newBookDefaults, revision)
  if (Object.hasOwn(r, 'reuseReceipts')) {
    if (!Array.isArray(r.reuseReceipts) || r.reuseReceipts.length > MAX_CONNECTION_REUSE_RECEIPTS) invalid()
    const operations = new Set<string>(), claimedIds = new Set<string>()
    result.reuseReceipts = Array.from(r.reuseReceipts, value => {
      const receipt = decodeConnectionReuseReceipt(value)
      if (operations.has(receipt.operationId)) invalid()
      operations.add(receipt.operationId)
      for (const id of receipt.connectionIds) {
        if (claimedIds.has(id)) invalid() // Historical receipts survive explicit connection removal.
        claimedIds.add(id)
      }
      return receipt
    })
  }
  return result
}

export function connectionReuseOperationId(value: unknown): string {
  if (typeof value !== 'string' || !/^reuse-[a-zA-Z0-9_-]{16,80}$/.test(value)) invalid()
  return value
}

export function connectionFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid()
  return value
}

export function decodeConnectionReuseReceipt(value: unknown): ConnectionReuseReceipt {
  const r = connectionRecord(value, ['operationId', 'sourceIdentity', 'sourceFingerprint', 'connectionIds'])
  if (!Array.isArray(r.connectionIds) || !r.connectionIds.length || r.connectionIds.length > MAX_CONNECTION_REUSE_SELECTION) invalid()
  const connectionIds = Array.from(r.connectionIds, globalConnectionId)
  if (new Set(connectionIds).size !== connectionIds.length) invalid()
  return { operationId: connectionReuseOperationId(r.operationId), sourceIdentity: connectionFingerprint(r.sourceIdentity),
    sourceFingerprint: connectionFingerprint(r.sourceFingerprint), connectionIds }
}

/** Enforces immutable identities and isolated single-connection removal at persistence. */
export function assertGlobalConnectionTransition(before: GlobalConnectionDocument, after: GlobalConnectionDocument): void {
  if (after.revision !== nextConnectionRevision(before.revision)) invalid()
  const removed = before.connections.filter(c => !after.connections.some(next => next.id === c.id))
  if (removed.length) {
    const expected = { ...before, revision: after.revision, connections: before.connections.filter(c => c.id !== removed[0].id) }
    if (removed.length !== 1 || JSON.stringify(after) !== JSON.stringify(expected)) invalid()
    return
  }
  assertModelDefaultsTransition(before.newBookDefaults, after.newBookDefaults)
  for (const previous of before.connections) {
    const next = after.connections.find(c => c.id === previous.id)
    if (!next || next.baseUrl !== previous.baseUrl || next.protocol !== previous.protocol) invalid()
    const changed = previous.name !== next.name || previous.enabled !== next.enabled || previous.encryptedApiKey !== next.encryptedApiKey
    if (next.revision !== (changed ? nextConnectionRevision(previous.revision) : previous.revision)) invalid()
  }
  for (const next of after.connections) {
    if (!before.connections.some(c => c.id === next.id)
      && (next.revision !== 1 || before.reuseReceipts?.some(r => r.connectionIds.includes(next.id)))) invalid()
  }
  const beforeReceipts = before.reuseReceipts ?? [], afterReceipts = after.reuseReceipts ?? []
  for (const previous of beforeReceipts) {
    const next = afterReceipts.find(r => r.operationId === previous.operationId)
    if (!next || JSON.stringify(next) !== JSON.stringify(previous)) invalid()
  }
  for (const receipt of afterReceipts) {
    if (!beforeReceipts.some(r => r.operationId === receipt.operationId)
      && receipt.connectionIds.some(id => !after.connections.some(c => c.id === id) || before.connections.some(c => c.id === id))) invalid()
  }
}
