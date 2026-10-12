import { decodeParameterPolicy } from './parameter-policy'
import { decodeThinkingLevel } from './thinking-level'
import { AppError } from '../core/app-error'
import { connectionRecord, connectionRevision, globalConnectionId, modelConnectionEndpoint, modelConnectionName } from './model-connection-values'
import { LOCAL_CONNECTION_ID } from './local-model-contracts'
import type { AiTask, ModelProfile } from '../index'

export const BOOK_MODEL_TASKS: readonly AiTask[] = ['outline', 'chapterOutline', 'prose', 'review']
export const MAX_BOOK_MODEL_DOCUMENT_LENGTH = 1_000_000
export const MAX_BOOK_MODEL_REFERENCES = 100
export type BookPrivateConnection = { id: string; name: string; baseUrl: string }
export type BookModelRouting = { routingMode: 'shared' | 'perTask'; shared: ModelProfile; tasks: Record<AiTask, ModelProfile> }
export type LegacyBookModelSettings = BookModelRouting & { version: 2 | 3; connections: BookPrivateConnection[] }
export type BookLegacyReference = { kind: 'legacy-private'; id: string; originalConnectionId: string; name: string; baseUrl: string }
export type BookGlobalReference = { kind: 'global'; id: string; globalConnectionId: string; lastKnownName?: string; lastKnownBaseUrl?: string }
export type BookModelReference = BookLegacyReference | BookGlobalReference
export type ReferencedBookModelSettings = BookModelRouting & { version: 4 | 5; references: BookModelReference[]; defaultRevision?: number }
export type BookModelSettings = LegacyBookModelSettings | ReferencedBookModelSettings
export type BookModelSource = BookModelReference | { kind: 'local'; id: typeof LOCAL_CONNECTION_ID }

function invalid(): AppError { return new AppError('VALIDATION_ERROR', '作品模型配置格式无效，原配置已保留。', { recoverable: true }) }
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw invalid()
  return value
}
function model(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw invalid()
  return value.trim()
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid()
  return value
}
function profile(value: unknown, available: Set<string>, fallback?: ModelProfile, adaptive = false): ModelProfile {
  const r = connectionRecord(value, ['connectionId', 'model', 'temperature', 'topP', 'maxTokens', 'thinkingLevel', ...(adaptive ? ['parameterPolicy'] : [])])
  const p: Record<string, unknown> = { ...fallback, ...r }
  if (typeof p.connectionId !== 'string' || !available.has(p.connectionId)) throw invalid()
  if (Object.hasOwn(r, 'parameterPolicy')) {
    connectionRecord(r, ['connectionId', 'model', 'parameterPolicy'])
    return { connectionId: p.connectionId, model: model(p.model), parameterPolicy: decodeParameterPolicy(p.parameterPolicy) }
  }
  const maxTokens = number(p.maxTokens, 128, 128000)
  if (!Number.isInteger(maxTokens)) throw invalid()
  return { connectionId: p.connectionId, model: model(p.model), temperature: number(p.temperature, 0, 2), topP: number(p.topP, 0, 1), maxTokens,
    ...(Object.hasOwn(p, 'thinkingLevel') ? { thinkingLevel: decodeThinkingLevel(p.thinkingLevel) } : {}) }
}
function routing(r: Record<string, unknown>, ids: string[], legacyDefaults?: BookModelRouting): BookModelRouting {
  const available = new Set([...ids, LOCAL_CONNECTION_ID])
  const routingMode = r.routingMode === undefined ? legacyDefaults?.routingMode : r.routingMode
  if (routingMode !== 'shared' && routingMode !== 'perTask') throw invalid()
  const t = connectionRecord(r.tasks === undefined && legacyDefaults ? {} : r.tasks, BOOK_MODEL_TASKS)
  return { routingMode,
    shared: profile(r.shared === undefined && legacyDefaults ? {} : r.shared, available, legacyDefaults?.shared, r.version === 5),
    tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, profile(t[task] === undefined && legacyDefaults ? {} : t[task], available, legacyDefaults?.tasks[task], r.version === 5)])) as Record<AiTask, ModelProfile>
  }
}

/** Used only for a genuinely absent legacy file, never as error recovery. No write or key lookup. */
export function defaultLegacyBookModelSettings(): LegacyBookModelSettings {
  const p = { connectionId: 'primary', model: 'gpt-4.1-mini', temperature: 0.7, topP: 1, maxTokens: 8192 }
  return { version: 2, connections: [{ id: 'primary', name: '主要接口', baseUrl: 'https://api.openai.com/v1' }], routingMode: 'shared', shared: { ...p },
    tasks: { outline: { ...p, temperature: 0.6 }, chapterOutline: { ...p, temperature: 0.65 }, prose: { ...p, temperature: 0.8 }, review: { ...p, temperature: 0.2 } } }
}

/** Pure portable document decoder. Machine availability and secrets are never accepted fields. */
export function decodeBookModelSettings(value: unknown): BookModelSettings {
  try { return decode(value) }
  catch (error) {
    if (error instanceof AppError && error.code === 'FEATURE_UNAVAILABLE') throw error
    throw invalid()
  }
}
function decode(value: unknown): BookModelSettings {
  const envelope = connectionRecord(value, ['version', 'baseUrl', 'connections', 'references', 'defaultRevision', 'routingMode', 'shared', 'tasks'])
  if (envelope.version !== undefined && (typeof envelope.version !== 'number' || ![1, 2, 3, 4, 5].includes(envelope.version))) {
    throw new AppError('FEATURE_UNAVAILABLE', '模型配置版本不受支持，原配置已保留。', { recoverable: true })
  }
  if (envelope.version === 4 || envelope.version === 5) {
    const r = connectionRecord(value, ['version', 'references', 'defaultRevision', 'routingMode', 'shared', 'tasks'])
    if (!Array.isArray(r.references) || r.references.length > MAX_BOOK_MODEL_REFERENCES) throw invalid()
    const ids = new Set<string>(), originals = new Set<string>()
    const references = Array.from(r.references, item => {
      const c = connectionRecord(item, ['kind', 'id', 'originalConnectionId', 'name', 'baseUrl', 'globalConnectionId', 'lastKnownName', 'lastKnownBaseUrl'])
      const alias = id(c.id)
      if (ids.has(alias)) throw invalid()
      ids.add(alias)
      if (c.kind === 'legacy-private') {
        connectionRecord(item, ['kind', 'id', 'originalConnectionId', 'name', 'baseUrl'])
        const originalConnectionId = id(c.originalConnectionId)
        if (originals.has(originalConnectionId)) throw invalid()
        originals.add(originalConnectionId)
        return { kind: 'legacy-private' as const, id: alias, originalConnectionId, name: modelConnectionName(c.name), baseUrl: modelConnectionEndpoint(c.baseUrl) }
      }
      if (c.kind !== 'global') throw invalid()
      connectionRecord(item, ['kind', 'id', 'globalConnectionId', 'lastKnownName', 'lastKnownBaseUrl'])
      return { kind: 'global' as const, id: alias, globalConnectionId: globalConnectionId(c.globalConnectionId),
        ...(Object.hasOwn(c, 'lastKnownName') ? { lastKnownName: modelConnectionName(c.lastKnownName) } : {}),
        ...(Object.hasOwn(c, 'lastKnownBaseUrl') ? { lastKnownBaseUrl: modelConnectionEndpoint(c.lastKnownBaseUrl) } : {}) }
    })
    return { version: envelope.version, references, ...routing(r, [...ids]),
      ...(Object.hasOwn(r, 'defaultRevision') ? { defaultRevision: connectionRevision(r.defaultRevision, 1) } : {}) }
  }
  if (envelope.version === undefined || envelope.version === 1) {
    const r = connectionRecord(value, ['version', 'baseUrl', 'routingMode', 'shared', 'tasks'])
    const base = defaultLegacyBookModelSettings()
    const routes = routing(r, ['primary'], base)
    return { version: hasLocal(routes) ? 3 : 2, connections: [{ ...base.connections[0], baseUrl: modelConnectionEndpoint(r.baseUrl) }], ...routes }
  }
  const r = connectionRecord(value, ['version', 'connections', 'routingMode', 'shared', 'tasks'])
  if (!Array.isArray(r.connections) || r.connections.length > MAX_BOOK_MODEL_REFERENCES || (!r.connections.length && r.version !== 3)) throw invalid()
  const ids = new Set<string>()
  const connections = Array.from(r.connections, item => {
    const c = connectionRecord(item, ['id', 'name', 'baseUrl', 'kind'])
    if (Object.hasOwn(c, 'kind') && c.kind !== 'openai-compatible') throw invalid()
    const connectionId = id(c.id)
    if (ids.has(connectionId)) throw invalid()
    ids.add(connectionId)
    return { id: connectionId, name: modelConnectionName(c.name), baseUrl: modelConnectionEndpoint(c.baseUrl) }
  })
  const routes = routing(r, [...ids])
  return { version: r.version === 3 || hasLocal(routes) ? 3 : 2, connections, ...routes }
}
function hasLocal(value: BookModelRouting): boolean {
  return [value.shared, ...BOOK_MODEL_TASKS.map(task => value.tasks[task])].some(p => p.connectionId === LOCAL_CONNECTION_ID)
}

export function parseBookModelSettings(content: string): BookModelSettings {
  if (typeof content !== 'string' || content.length > MAX_BOOK_MODEL_DOCUMENT_LENGTH) throw invalid()
  let value: unknown
  try { value = JSON.parse(content) } catch { throw invalid() }
  return decodeBookModelSettings(value)
}
export function serializeBookModelSettings(value: unknown): string {
  return JSON.stringify(decodeBookModelSettings(value))
}

/** Selects portable identity only. Global diagnostic metadata is deliberately not a send target. */
export function bookModelSource(settings: BookModelSettings, connectionId: string): BookModelSource {
  if (connectionId === LOCAL_CONNECTION_ID) return { kind: 'local', id: LOCAL_CONNECTION_ID }
  if (isReferencedBookSettings(settings)) {
    const reference = settings.references.find(c => c.id === connectionId)
    if (reference) return { ...reference }
  } else {
    const connection = settings.connections.find(c => c.id === connectionId)
    if (connection) return { kind: 'legacy-private', ...connection, originalConnectionId: connection.id }
  }
  throw new AppError('NOT_FOUND', '选择的模型接口已经不存在，请重新分配。', { recoverable: true })
}

/** Explicit conversion helper only; callers must bind this operation to the captured book revision. */
export function referenceBookModelSettings(value: unknown): ReferencedBookModelSettings {
  const settings = decodeBookModelSettings(value)
  if (isReferencedBookSettings(settings)) return settings
  return { version: 4, routingMode: settings.routingMode, shared: settings.shared, tasks: settings.tasks,
    references: settings.connections.map(c => ({ kind: 'legacy-private', ...c, originalConnectionId: c.id })) }
}

export function isReferencedBookSettings(settings: BookModelSettings): settings is ReferencedBookModelSettings {
  return settings.version === 4 || settings.version === 5
}
