import { AppError } from '../../../core/errors/app-error'
import type { StoryEventVersion, StoryEventVersionHeads } from './story-event-version'
import type { WorkspaceEventChapterCatalog, WorkspaceMirrorStatus, WorkspaceStorageMode } from '../../../core/ports/workspace-database'

export const EVENT_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024
export const EVENT_SNAPSHOT_MAX_ROWS = 100_000
export const EVENT_SOURCE_KINDS = ['sources', 'events', 'timeline', 'planning'] as const
export type EventSourceKind = typeof EVENT_SOURCE_KINDS[number]

/** Main-process scope, never a renderer-supplied grant of authority. */
export type EventSnapshotScope = { workItemId: string; root: string; generation: number }
export type EventSourceOccurrence = { ordinal: number; originalId: string | null; value: unknown }
export type EventSourceDocument = {
  authority: 'file' | 'sqlite'
  content: string | null
  contentHash: string | null
  revision: number | null
  value: Record<string, unknown> | null
  occurrences: EventSourceOccurrence[]
}
export type RetainedEventSourceFile = {
  /** Null distinguishes absent from a present empty or malformed file. */
  base64: string | null
  hash: string | null
  byteLength: number
}
export type EventSourceSnapshot = {
  version: 1
  scope: EventSnapshotScope
  database: { projectId: string | null; schemaVersion: number; storageMode: WorkspaceStorageMode | null; hasMigrationEvidence: boolean } | null
  documents: Record<EventSourceKind, EventSourceDocument>
  files: Record<EventSourceKind, RetainedEventSourceFile>
  mirrors: Record<EventSourceKind, { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null>
  eventHistory: Array<{ eventId: string; versions: StoryEventVersion[]; heads: StoryEventVersionHeads | null }>
  chapterCatalog: WorkspaceEventChapterCatalog
  /** Exact governing content, including missing markers, scope and placement document. */
  fingerprint: string
}

export interface EventSourceSnapshotPort {
  capture(scope: EventSnapshotScope): Promise<EventSourceSnapshot>
}

/** Lossless envelope decoding only; this is NOT migration eligibility or approval. */
export function decodeEventSourceDocument(kind: EventSourceKind, content: string | null): Pick<EventSourceDocument, 'value' | 'occurrences'> {
  if (content === null) return { value: null, occurrences: [] }
  let value: unknown
  try { value = JSON.parse(content) } catch { throw invalidEventSource(kind) }
  if (!isRecord(value) || (kind !== 'timeline' && value.version !== 1)) throw invalidEventSource(kind)
  // Placements and all unknown planning fields are retained verbatim. Their
  // semantic interpretation belongs to the reviewed migration/operation owner.
  if (kind === 'planning') return { value, occurrences: [] }
  const rows = value[kind === 'sources' ? 'sources' : 'events']
  if (!Array.isArray(rows)) throw invalidEventSource(kind)
  if (rows.length > EVENT_SNAPSHOT_MAX_ROWS) throw eventSnapshotLimit()
  return { value, occurrences: rows.map((item: unknown, ordinal) => ({
    ordinal, originalId: isRecord(item) && typeof item.id === 'string' ? item.id : null, value: item
  })) }
}

export function invalidEventSource(kind: EventSourceKind): AppError {
  return new AppError('INVALID_PROJECT_STATE', '事件核对所需账本无法完整读取；原始资料没有被改写。', {
    recoverable: true, details: { area: 'eventSourceSnapshot', source: kind }
  })
}

export function eventSnapshotLimit(): AppError {
  return new AppError('VALIDATION_ERROR', '事件核对资料超过单次限制（64 MiB 或 100,000 项）；未截断或迁移任何记录。', {
    recoverable: true, details: { area: 'eventSourceSnapshot' }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
