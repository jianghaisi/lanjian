import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { eventMigrationDecisionsInput, reviewEventMigrationDecisions, type EventMigrationDecisionPlan } from '../domain/event-migration-decisions'
import { inspectEventMigrationSources } from '../domain/event-migration-review'
import { decodeEventSourceDocument, EVENT_SNAPSHOT_MAX_BYTES, EVENT_SNAPSHOT_MAX_ROWS, EVENT_SOURCE_KINDS,
  type EventSourceSnapshot } from '../domain/event-source-snapshot'
import { assertStoryIdentifier, storyEventVersionPayload, type StoryEventVersion } from '../domain/story-event-version'
import { eventSourceFingerprint } from './event-source-snapshot'

// Raw input has a 64 MiB budget. Base64 plus JSON escaping of retained text can
// expand it; decoded graphs are reconstructed, never duplicated in the archive.
export const EVENT_RECEIPT_MAX_BYTES = EVENT_SNAPSHOT_MAX_BYTES * 4 + 1024 * 1024
export const eventReceiptHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

/** Encode evidence for the future transaction owner, not an authorization or writer. */
export function encodeEventMigrationReceiptEvidence(snapshot: EventSourceSnapshot, plan: EventMigrationDecisionPlan): string {
  const documents = Object.fromEntries(EVENT_SOURCE_KINDS.map(kind => {
    const { authority, content, contentHash, revision } = snapshot.documents[kind]
    return [kind, { authority, content, contentHash, revision }]
  }))
  const json = JSON.stringify({ version: 1, snapshot: { ...snapshot, documents }, decisions: eventMigrationDecisionsInput(plan) })
  const decoded = decodeEventMigrationReceiptEvidence(json)
  if (JSON.stringify(decoded.plan) !== JSON.stringify(plan)) throw invalidReceipt()
  return json
}

/** Decode only retained bytes. Never inspect current files or substitute current heads. */
export function decodeEventMigrationReceiptEvidence(json: string) {
  try {
    if (typeof json !== 'string' || Buffer.byteLength(json) > EVENT_RECEIPT_MAX_BYTES) throw invalidReceipt()
    const archive = object(JSON.parse(json), ['version', 'snapshot', 'decisions'])
    if (archive.version !== 1) throw invalidReceipt()
    const raw = object(archive.snapshot, ['version', 'scope', 'database', 'documents', 'files', 'mirrors', 'eventHistory', 'chapterCatalog', 'fingerprint'])
    if (raw.version !== 1 || !isHash(raw.fingerprint)) throw invalidReceipt()
    const scope = object(raw.scope, ['workItemId', 'root', 'generation'])
    for (const key of ['workItemId', 'root']) {
      if (typeof scope[key] !== 'string' || !scope[key] || (scope[key] as string).length > 32768 || (scope[key] as string).includes('\0')) throw invalidReceipt()
    }
    integer(scope.generation)
    const database = object(raw.database, ['projectId', 'schemaVersion', 'storageMode', 'hasMigrationEvidence'])
    assertStoryIdentifier(database.projectId)
    integer(database.schemaVersion, 1)
    if (database.storageMode !== 'sqlite' || database.hasMigrationEvidence !== false) throw invalidReceipt()
    const documents = object(raw.documents, [...EVENT_SOURCE_KINDS]), files = object(raw.files, [...EVENT_SOURCE_KINDS])
    const mirrors = object(raw.mirrors, [...EVENT_SOURCE_KINDS])
    let bytes = 0, rows = 0
    const decoded = {} as EventSourceSnapshot['documents']
    for (const kind of EVENT_SOURCE_KINDS) {
      const doc = object(documents[kind], ['authority', 'content', 'contentHash', 'revision'])
      const file = object(files[kind], ['base64', 'hash', 'byteLength'])
      integer(file.byteLength)
      let fileText: string | null = null
      if (file.base64 === null) {
        if (file.hash !== null || file.byteLength !== 0) throw invalidReceipt()
      } else {
        if (typeof file.base64 !== 'string' || !isHash(file.hash) || Number(file.byteLength) > EVENT_SNAPSHOT_MAX_BYTES) throw invalidReceipt()
        const buffer = Buffer.from(file.base64, 'base64')
        if (buffer.toString('base64') !== file.base64 || buffer.length !== file.byteLength || eventReceiptHash(buffer) !== file.hash) throw invalidReceipt()
        bytes += buffer.length
        fileText = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      }
      if (doc.authority === 'file') {
        if (doc.content !== fileText || doc.contentHash !== file.hash || doc.revision !== null || mirrors[kind] !== null) throw invalidReceipt()
      } else if (doc.authority === 'sqlite') {
        if (typeof doc.content !== 'string' || !isHash(doc.contentHash) || eventReceiptHash(doc.content) !== doc.contentHash) throw invalidReceipt()
        bytes += Buffer.byteLength(doc.content)
        if (kind === 'timeline' || kind === 'planning') integer(doc.revision, 1)
        else if (doc.revision !== null) throw invalidReceipt()
      } else throw invalidReceipt()
      if (doc.content !== null && typeof doc.content !== 'string') throw invalidReceipt()
      const content = doc.content as string | null
      decoded[kind] = { ...doc, ...decodeEventSourceDocument(kind, content) } as EventSourceSnapshot['documents'][typeof kind]
      rows += decoded[kind].occurrences.length
      if (mirrors[kind] !== null) {
        const mirror = object(mirrors[kind], ['relativePath', 'contentHash', 'status'])
        const expected = { sources: '.webnovel/research/sources.json', events: '.webnovel/research/events.json',
          timeline: '.webnovel/config/timeline.json', planning: '.webnovel/planning/outline-state.json' }[kind]
        if (mirror.relativePath !== expected || !isHash(mirror.contentHash)
          || !['pending', 'synced', 'conflict', 'failed'].includes(String(mirror.status))) throw invalidReceipt()
      }
      if (bytes > EVENT_SNAPSHOT_MAX_BYTES || rows > EVENT_SNAPSHOT_MAX_ROWS) throw invalidReceipt()
    }
    if (!Array.isArray(raw.eventHistory)) throw invalidReceipt()
    const historyIds = new Set<string>(), versionIds = new Set<string>()
    for (const value of raw.eventHistory) {
      const history = object(value, ['eventId', 'versions', 'heads'])
      assertStoryIdentifier(history.eventId)
      if (historyIds.has(history.eventId) || !Array.isArray(history.versions)) throw invalidReceipt()
      historyIds.add(history.eventId)
      rows += history.versions.length
      bytes += Buffer.byteLength(JSON.stringify(history.versions))
      if (bytes > EVENT_SNAPSHOT_MAX_BYTES || rows > EVENT_SNAPSHOT_MAX_ROWS) throw invalidReceipt()
      let previous: string | null = null, approved: string | null = null
      for (const [index, item] of history.versions.entries()) {
        const version = object(item) as StoryEventVersion
        assertStoryIdentifier(version.id)
        if (versionIds.has(version.id) || version.eventId !== history.eventId || version.projectId !== database.projectId
          || version.version !== index + 1 || version.previousVersionId !== previous || !isHash(version.contentHash)
          || eventReceiptHash(JSON.stringify(storyEventVersionPayload(version))) !== version.contentHash) throw invalidReceipt()
        timestamp(version.createdAt)
        versionIds.add(version.id); previous = version.id
        if (version.status === 'approved') approved = version.id
      }
      if (previous === null) { if (history.heads !== null) throw invalidReceipt() }
      else {
        const heads = object(history.heads, ['latestVersionId', 'approvedVersionId'])
        if (heads.latestVersionId !== previous || heads.approvedVersionId !== approved) throw invalidReceipt()
      }
    }
    const expectedIds = decoded.events.authority === 'sqlite' ? decoded.events.occurrences.map(row => row.originalId) : []
    if (historyIds.size !== expectedIds.length || expectedIds.some(id => id === null || !historyIds.has(id))) throw invalidReceipt()
    const catalog = object(raw.chapterCatalog, ['manuscripts', 'outlines', 'entries'])
    if (!['sqlite', 'unavailable'].includes(String(catalog.manuscripts)) || !['sqlite', 'unavailable'].includes(String(catalog.outlines))
      || !Array.isArray(catalog.entries)) throw invalidReceipt()
    const chapters = new Set<string>()
    for (const item of catalog.entries) {
      const entry = object(item, ['kind', 'chapterId', 'status', 'revision'])
      integer(entry.chapterId, 1)
      if (!['manuscript', 'outline'].includes(String(entry.kind)) || !['active', 'archived'].includes(String(entry.status))) throw invalidReceipt()
      if (catalog[entry.kind === 'manuscript' ? 'manuscripts' : 'outlines'] !== 'sqlite') throw invalidReceipt()
      if (entry.revision !== null) assertStoryIdentifier(entry.revision)
      else if (entry.status !== 'archived') throw invalidReceipt()
      const key = `${entry.kind}:${entry.chapterId}`
      if (chapters.has(key)) throw invalidReceipt()
      chapters.add(key)
    }
    bytes += Buffer.byteLength(JSON.stringify(catalog)); rows += catalog.entries.length
    if (bytes > EVENT_SNAPSHOT_MAX_BYTES || rows > EVENT_SNAPSHOT_MAX_ROWS) throw invalidReceipt()
    const snapshot = { ...raw, documents: decoded } as EventSourceSnapshot
    if (eventSourceFingerprint(snapshot) !== snapshot.fingerprint) throw invalidReceipt()
    const inspection = inspectEventMigrationSources(snapshot)
    const plan = reviewEventMigrationDecisions(snapshot, archive.decisions, inspection)
    return { snapshot, plan, inspection }
  } catch (cause) { throw invalidReceipt(cause) }
}

export function invalidReceipt(cause?: unknown): AppError {
  return new AppError('DATABASE_INTEGRITY_FAILED', '事件迁移回执不完整或校验失败；原始资料已保留，请先核对恢复记录，勿重复迁移。', { recoverable: true, cause })
}
export function isHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
export function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalidReceipt()
}
function integer(value: unknown, minimum = 0): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalidReceipt()
}
function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidReceipt()
  const result = value as Record<string, unknown>
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) throw invalidReceipt()
  return result
}
