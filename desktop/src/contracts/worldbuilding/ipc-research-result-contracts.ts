import type { IpcValueDecoder } from '../core/ipc-result-contracts'

export const researchIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  'research:get-settings': researchSettings,
  'research:update-settings': researchSettings,
  'research:search': researchResult,
  'research:list-sources': sourceList,
  'research:create-source': sourceCardResult,
  'research:update-source': sourceCardResult,
  'research:list-events': eventList,
  'research:create-event-candidate': canonicalEventExpected('candidate'),
  'research:approve-event': canonicalEventExpected('approved')
}

export function researchSettings(value: unknown, path: string): unknown {
  const result = object(value, path)
  httpUrl(result.baseUrl, `${path}.baseUrl`)
  identifier(result.model, `${path}.model`, 500)
  bool(result.apiKeyConfigured, `${path}.apiKeyConfigured`)
  return value
}

export function sourceCardResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`, 512)
  identifier(result.provider, `${path}.provider`, 500)
  oneOf(result.sourceType, ['manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other'], `${path}.sourceType`)
  if (result.externalId !== undefined) identifier(result.externalId, `${path}.externalId`, 2_000)
  if (result.url !== undefined) httpUrl(result.url, `${path}.url`)
  text(result.title, `${path}.title`, 500)
  if (result.author !== undefined) text(result.author, `${path}.author`, 2_000)
  if (result.publishedAt !== undefined) text(result.publishedAt, `${path}.publishedAt`, 500)
  date(result.capturedAt, `${path}.capturedAt`)
  if (result.updatedAt !== undefined) date(result.updatedAt, `${path}.updatedAt`)
  text(result.excerpt, `${path}.excerpt`, 20_000)
  text(result.userNotes, `${path}.userNotes`, 20_000)
  if (result.references !== undefined) {
    const references = array(result.references, `${path}.references`)
    if (references.length > 100) invalid(`${path}.references`)
    references.forEach((item, index) => researchSource(item, `${path}.references[${index}]`))
  }
  hash(result.contentHash, `${path}.contentHash`)
  if (result.sourceType === 'web' && result.url === undefined && (!Array.isArray(result.references) || result.references.length === 0)) {
    invalid(`${path}.references`)
  }
  return value
}

export function canonicalEventResult(value: unknown, path: string, allowApprovedWithoutEvidence = false): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`, 512)
  identifier(result.time, `${path}.time`, 500)
  const characters = array(result.characters, `${path}.characters`)
  if (characters.length === 0 || characters.length > 100) invalid(`${path}.characters`)
  characters.forEach((item, index) => identifier(item, `${path}.characters[${index}]`, 200))
  identifier(result.location, `${path}.location`, 500)
  identifier(result.event, `${path}.event`, 20_000)
  if (result.result !== undefined) text(result.result, `${path}.result`, 20_000)
  const evidence = array(result.evidenceRefs, `${path}.evidenceRefs`)
  if (evidence.length > 100 || (evidence.length === 0 && (!allowApprovedWithoutEvidence || result.status !== 'approved'))) {
    invalid(`${path}.evidenceRefs`)
  }
  evidence.forEach((item, index) => {
    const ref = object(item, `${path}.evidenceRefs[${index}]`)
    identifier(ref.sourceId, `${path}.evidenceRefs[${index}].sourceId`, 512)
    identifier(ref.excerpt, `${path}.evidenceRefs[${index}].excerpt`, 2_000)
  })
  finite(result.confidence, `${path}.confidence`, 0, 1)
  oneOf(result.status, ['candidate', 'approved'], `${path}.status`)
  if (result.conflictGroupId !== undefined) identifier(result.conflictGroupId, `${path}.conflictGroupId`, 512)
  date(result.createdAt, `${path}.createdAt`)
  if (result.approvedAt !== undefined) date(result.approvedAt, `${path}.approvedAt`)
  return value
}

function canonicalEventExpected(expected: 'candidate' | 'approved'): IpcValueDecoder {
  return (value, path) => {
    canonicalEventResult(value, path)
    const result = object(value, path)
    if (result.status !== expected) invalid(`${path}.status`)
    if (expected === 'approved') date(result.approvedAt, `${path}.approvedAt`)
    return value
  }
}

function researchResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.query, `${path}.query`, 500)
  identifier(result.content, `${path}.content`, 2_000_000)
  const sources = array(result.sources, `${path}.sources`)
  if (sources.length > 10_000) invalid(`${path}.sources`)
  sources.forEach((item, index) => researchSource(item, `${path}.sources[${index}]`))
  stringArray(result.searchedQueries, `${path}.searchedQueries`, 10_000, 500)
  count(result.webSearchCalls, `${path}.webSearchCalls`)
  identifier(result.model, `${path}.model`, 500)
  return value
}

function researchSource(value: unknown, path: string): void {
  const result = object(value, path)
  text(result.title, `${path}.title`, 500)
  httpUrl(result.url, `${path}.url`)
}

function sourceList(value: unknown, path: string): unknown {
  const result = object(value, path)
  const sources = array(result.sources, `${path}.sources`)
  if (sources.length > 100_000) invalid(`${path}.sources`)
  sources.forEach((item, index) => sourceCardResult(item, `${path}.sources[${index}]`))
  return value
}

function eventList(value: unknown, path: string): unknown {
  const result = object(value, path)
  const events = array(result.events, `${path}.events`)
  if (events.length > 100_000) invalid(`${path}.events`)
  // Unified author-created events have author provenance rather than material
  // evidence. They remain readable through this compatibility list after the
  // event module switches, while research candidates still require evidence.
  events.forEach((item, index) => canonicalEventResult(item, `${path}.events[${index}]`, true))
  return value
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path)
  return value
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) invalid(path)
  return value
}

function identifier(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  if (!result.trim()) invalid(path)
  return result
}

function httpUrl(value: unknown, path: string): string {
  const result = identifier(value, path, 2_000)
  let parsed: URL
  try { parsed = new URL(result) } catch { invalid(path) }
  if (!['http:', 'https:'].includes(parsed.protocol)) invalid(path)
  return result
}

function hash(value: unknown, path: string): string {
  const result = text(value, path, 64)
  if (!/^[a-f0-9]{64}$/i.test(result)) invalid(path)
  return result
}

function date(value: unknown, path: string): string {
  const result = text(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) invalid(path)
  return result
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path)
  return value
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path)
  return Number(value)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid(path)
  return value
}

function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(path)
  return value
}

function stringArray(value: unknown, path: string, maximumItems: number, maximumText: number): void {
  const result = array(value, path)
  if (result.length > maximumItems) invalid(path)
  result.forEach((item, index) => text(item, `${path}[${index}]`, maximumText))
}

function invalid(path: string): never {
  throw new TypeError(`Invalid IPC result at ${path}`)
}
