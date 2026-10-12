import { connectionRecord } from './model-connection-values'
import { parameterError, parameterNumber } from './parameter-policy'

/** Whitelisted provider metadata; never retain raw responses or credentials. */
export type ModelCatalogEntry = { id: string; displayName?: string; supportedGenerationMethods?: string[];
  inputTokenLimit?: number; outputTokenLimit?: number; temperature?: number; maxTemperature?: number; topP?: number; thinking?: boolean }
export type ModelCatalogSnapshot = { connectionId: string; revision: number; protocol: 'openai-compatible' | 'gemini-native' | 'anthropic-native' | 'openai-responses'; fetchedAt: string; complete: true; entries: ModelCatalogEntry[] }
/** An absent operation list is unknown; an explicit non-text/empty list is not permission to write. */
export function catalogTextSupport(entry?: ModelCatalogEntry): 'supported' | 'unsupported' | 'unknown' {
  if (!entry?.supportedGenerationMethods) return 'unknown'
  return entry.supportedGenerationMethods.includes('generateContent') ? 'supported' : 'unsupported'
}
function safeText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) parameterError('接口返回的型号资料格式无效。')
  return value
}
export function decodeCatalogEntry(value: unknown): ModelCatalogEntry {
  const r = connectionRecord(value, ['id', 'displayName', 'supportedGenerationMethods', 'inputTokenLimit', 'outputTokenLimit', 'temperature', 'maxTemperature', 'topP', 'thinking'])
  const entry: ModelCatalogEntry = { id: safeText(r.id) }
  if (Object.hasOwn(r, 'displayName')) entry.displayName = safeText(r.displayName)
  if (Object.hasOwn(r, 'supportedGenerationMethods')) {
    if (!Array.isArray(r.supportedGenerationMethods) || r.supportedGenerationMethods.length > 30) parameterError()
    entry.supportedGenerationMethods = r.supportedGenerationMethods.map(safeText)
  }
  for (const key of ['inputTokenLimit', 'outputTokenLimit'] as const) if (Object.hasOwn(r, key)) entry[key] = parameterNumber(r[key], 1, 100_000_000, true)
  for (const key of ['temperature', 'maxTemperature'] as const) if (Object.hasOwn(r, key)) entry[key] = parameterNumber(r[key], 0, 2)
  if (Object.hasOwn(r, 'topP')) entry.topP = parameterNumber(r.topP, 0, 1)
  if (Object.hasOwn(r, 'thinking')) { if (typeof r.thinking !== 'boolean') parameterError(); entry.thinking = r.thinking }
  return entry
}
export function decodeCatalogSnapshot(value: unknown): ModelCatalogSnapshot {
  const r = connectionRecord(value, ['connectionId', 'revision', 'protocol', 'fetchedAt', 'complete', 'entries'])
  if (!['openai-compatible', 'gemini-native', 'anthropic-native', 'openai-responses'].includes(String(r.protocol)) || r.complete !== true || typeof r.fetchedAt !== 'string' || !Number.isFinite(Date.parse(r.fetchedAt)) || !Array.isArray(r.entries) || r.entries.length > 2000) parameterError()
  const entries = r.entries.map(decodeCatalogEntry)
  if (new Set(entries.map(e => e.id)).size !== entries.length) parameterError()
  return { connectionId: safeText(r.connectionId), revision: parameterNumber(r.revision, 1, Number.MAX_SAFE_INTEGER, true), protocol: r.protocol as ModelCatalogSnapshot['protocol'], fetchedAt: r.fetchedAt, complete: true, entries }
}
