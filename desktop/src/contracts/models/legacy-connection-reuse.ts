import { isReferencedBookSettings } from './book-model-settings'
import { AppError } from '../core/app-error'
import { decodeBookModelSettings } from './book-model-settings'
import { connectionRecord, connectionRevision, MAX_CONNECTION_REUSE_SELECTION, MAX_GLOBAL_CONNECTIONS,
  modelConnectionCiphertext, modelConnectionEndpoint, modelConnectionName } from './model-connections'

export const CONNECTION_REUSE_TTL_MS = 15 * 60 * 1000
export type LegacyConnection = { id: string; name: string; baseUrl: string; encryptedApiKey?: string }
export type LegacyConnectionSnapshot = {
  sourceIdentity: string
  sourceFingerprint: string
  connections: LegacyConnection[]
  assertCurrent(): Promise<void>
}
export interface LegacyConnectionSource {
  identity(bookRoot: string): Promise<string>
  capture(bookRoot: string, selectedIds: string[]): Promise<LegacyConnectionSnapshot>
}
/** Supplied by main's window/book lifecycle, never from a renderer request. */
export type LegacyReuseScope = { windowId: string; generation: number; bookRoot: string }
export type LegacyReusePreview = {
  token: string
  expiresAt: number
  expectedRevision: number
  connections: Array<{ sourceConnectionId: string; name: string; baseUrl: string; credentialState: 'missing' | 'stored' | 'unavailable' }>
}
export type LegacyReuseResult = { operationId: string; connectionIds: string[] }

export function legacyConnectionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw invalid()
  return value
}
export function decodeLegacyReusePreview(value: unknown): { selectedIds: string[]; expectedRevision: number } {
  const r = connectionRecord(value, ['selectedIds', 'expectedRevision'])
  if (!Array.isArray(r.selectedIds) || !r.selectedIds.length || r.selectedIds.length > MAX_CONNECTION_REUSE_SELECTION) throw invalid()
  const selectedIds = Array.from(r.selectedIds, legacyConnectionId)
  if (new Set(selectedIds).size !== selectedIds.length) throw invalid()
  return { selectedIds, expectedRevision: connectionRevision(r.expectedRevision) }
}

/** Validates only connection metadata needed for reuse, not the book's routing profiles. */
export function decodeLegacyConnections(value: unknown): LegacyConnection[] {
  if (value && typeof value === 'object' && 'version' in value && (value.version === 4 || value.version === 5)) {
    const book = decodeBookModelSettings(value)
    if (!isReferencedBookSettings(book)) throw invalid()
    return book.references.flatMap(r => r.kind === 'legacy-private' ? [{ id: r.originalConnectionId, name: r.name, baseUrl: r.baseUrl }] : [])
  }
  const r = connectionRecord(value, ['version', 'baseUrl', 'connections', 'routingMode', 'shared', 'tasks'])
  if (r.version === undefined || r.version === 1) {
    if (Object.hasOwn(r, 'connections')) throw invalid()
    return [{ id: 'primary', name: '主要接口', baseUrl: modelConnectionEndpoint(r.baseUrl) }]
  }
  if (r.version !== 2 && r.version !== 3) throw invalid()
  if (!Array.isArray(r.connections) || r.connections.length > MAX_GLOBAL_CONNECTIONS || (!r.connections.length && r.version !== 3)) throw invalid()
  const ids = new Set<string>()
  return Array.from(r.connections, item => {
    const c = connectionRecord(item, ['id', 'name', 'baseUrl'])
    const id = legacyConnectionId(c.id)
    if (ids.has(id)) throw invalid()
    ids.add(id)
    return { id, name: modelConnectionName(c.name), baseUrl: modelConnectionEndpoint(c.baseUrl) }
  })
}

/** Only reads the exact selected book map; app ai/research and other book keys are not fallbacks. */
export function selectedLegacyCredentials(value: unknown, bookRoot: string, ids: string[]): Map<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const settings = value as Record<string, unknown>
  const result = new Map<string, string>()
  if (!Object.hasOwn(settings, 'projectApiKeys')) return result
  const maps = settings.projectApiKeys
  if (!maps || typeof maps !== 'object' || Array.isArray(maps)) throw invalid()
  if (!Object.hasOwn(maps, bookRoot)) return result
  const keys = (maps as Record<string, unknown>)[bookRoot]
  if (typeof keys === 'string') {
    const encrypted = modelConnectionCiphertext(keys)
    if (ids.includes('primary')) result.set('primary', encrypted)
    return result
  }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length > MAX_GLOBAL_CONNECTIONS) throw invalid()
  for (const id of ids) if (Object.hasOwn(keys, id)) result.set(id, modelConnectionCiphertext((keys as Record<string, unknown>)[id]))
  return result
}

export function legacyReuseConflict(): AppError {
  return new AppError('CONFLICT', '接口复用预览已变化、取消或过期，请重新预览；原作品没有改动。', { recoverable: true })
}
function invalid(): AppError { return new AppError('VALIDATION_ERROR', '旧接口复用数据格式无效。', { recoverable: true }) }
