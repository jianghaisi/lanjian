import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import {
  decodeEventSourceDocument, EVENT_SNAPSHOT_MAX_BYTES, EVENT_SNAPSHOT_MAX_ROWS, EVENT_SOURCE_KINDS,
  eventSnapshotLimit, invalidEventSource,
  type EventSnapshotScope, type EventSourceDocument, type EventSourceKind, type EventSourceSnapshot,
  type EventSourceSnapshotPort, type RetainedEventSourceFile
} from '../domain/event-source-snapshot'
import type { WorkspaceDatabaseFactory, WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'

const sourcePaths: Record<EventSourceKind, string[]> = {
  sources: ['.webnovel', 'research', 'sources.json'],
  events: ['.webnovel', 'research', 'events.json'],
  timeline: ['.webnovel', 'config', 'timeline.json'],
  planning: ['.webnovel', 'planning', 'outline-state.json']
}

/** Private retained source data; never return this object directly through IPC. */
export class LocalEventSourceSnapshotReader implements EventSourceSnapshotPort {
  constructor(private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'>) {}

  async capture(scope: EventSnapshotScope): Promise<EventSourceSnapshot> {
    if (!this.databases.openEventReadOnly) {
      throw new AppError('FEATURE_UNAVAILABLE', '只读事件快照暂不可用，未尝试迁移或修改作品。', { recoverable: true })
    }
    const root = await canonicalDirectory(scope.root)
    if (root !== scope.root) throw changedSources()
    const files = {} as Record<EventSourceKind, RetainedEventSourceFile>
    let bytes = 0
    for (const kind of EVENT_SOURCE_KINDS) {
      files[kind] = await readSourceFile(root, kind, EVENT_SNAPSHOT_MAX_BYTES - bytes, true)
      bytes += files[kind].byteLength
    }
    // All SQLite modules, event histories and placements use this ONE private
    // read connection. No service getter, lazy import, baseline or mirror retry.
    const db = await this.databases.openEventReadOnly(root)
    let snapshot: Omit<EventSourceSnapshot, 'fingerprint'>
    try {
      const formal = db?.storageMode() === 'sqlite'
      const documents = {} as Record<EventSourceKind, EventSourceDocument>
      const mirrors = {} as EventSourceSnapshot['mirrors']
      let rows = 0
      for (const kind of EVENT_SOURCE_KINDS) {
        const stored = formal && db ? formalDocument(db, kind) : null
        if (stored) {
          bytes += Buffer.byteLength(stored.content, 'utf8')
          if (bytes > EVENT_SNAPSHOT_MAX_BYTES) throw eventSnapshotLimit()
          if (hash(stored.content) !== stored.contentHash) throw invalidEventSource(kind)
        }
        const content = stored?.content ?? fileText(kind, files[kind])
        const decoded = decodeEventSourceDocument(kind, content)
        documents[kind] = {
          authority: stored ? 'sqlite' : 'file', content,
          contentHash: stored?.contentHash ?? files[kind].hash,
          revision: stored?.revision ?? null, ...decoded
        }
        rows += decoded.occurrences.length
        if (rows > EVENT_SNAPSHOT_MAX_ROWS) throw eventSnapshotLimit()
        mirrors[kind] = stored && db ? mirror(db, kind) : null
      }
      const eventHistory: EventSourceSnapshot['eventHistory'] = []
      if (documents.events.authority === 'sqlite' && db) {
        for (const occurrence of documents.events.occurrences) {
          if (occurrence.originalId === null) throw invalidEventSource('events')
          const versions = db.listCanonicalEventVersions(occurrence.originalId)
          rows += versions.length
          bytes += Buffer.byteLength(JSON.stringify(versions), 'utf8')
          if (rows > EVENT_SNAPSHOT_MAX_ROWS || bytes > EVENT_SNAPSHOT_MAX_BYTES) throw eventSnapshotLimit()
          eventHistory.push({ eventId: occurrence.originalId, versions, heads: db.canonicalEventVersionHeads(occurrence.originalId) })
        }
      }
      const chapterCatalog = db ? db.eventChapterCatalog() : { manuscripts: 'unavailable' as const, outlines: 'unavailable' as const, entries: [] }
      rows += chapterCatalog.entries.length
      bytes += Buffer.byteLength(JSON.stringify(chapterCatalog), 'utf8')
      if (rows > EVENT_SNAPSHOT_MAX_ROWS || bytes > EVENT_SNAPSHOT_MAX_BYTES) throw eventSnapshotLimit()
      snapshot = { version: 1, scope: { ...scope }, database: db ? {
        projectId: db.projectId, schemaVersion: db.schemaVersion, storageMode: db.storageMode(), hasMigrationEvidence: db.hasEventMigrationEvidence()
      } : null, documents, files, mirrors, eventHistory, chapterCatalog }
    } finally { db?.close() }
    // Parse only the retained buffers; this second pass hashes current bytes to
    // reject a changed/missing/appeared file across acquisition, not to refresh it.
    for (const kind of EVENT_SOURCE_KINDS) {
      const after = await readSourceFile(root, kind, EVENT_SNAPSHOT_MAX_BYTES, false)
      if (after.hash !== files[kind].hash || after.byteLength !== files[kind].byteLength) throw changedSources()
    }
    if (await canonicalDirectory(scope.root) !== root) throw changedSources()
    // Hash retained content once, not repeated decoded object graphs. This also
    // avoids recursive reserialization of arbitrary unknown legacy metadata.
    const fingerprint = eventSourceFingerprint(snapshot)
    return freeze({ ...snapshot, fingerprint })
  }
}

/** The persisted receipt and live acquisition must use the same fingerprint contract. */
export function eventSourceFingerprint(snapshot: Omit<EventSourceSnapshot, 'fingerprint'>): string {
  return hash(JSON.stringify({
    version: snapshot.version, scope: snapshot.scope, database: snapshot.database,
    documents: EVENT_SOURCE_KINDS.map((kind) => {
      const { authority, contentHash, revision } = snapshot.documents[kind]
      return { kind, authority, contentHash, revision }
    }),
    files: EVENT_SOURCE_KINDS.map((kind) => ({ kind, hash: snapshot.files[kind].hash, byteLength: snapshot.files[kind].byteLength })),
    mirrors: snapshot.mirrors, historyHash: hash(JSON.stringify(snapshot.eventHistory)), chapterCatalog: snapshot.chapterCatalog
  }))
}

function formalDocument(db: WorkspaceEventReadPort, kind: EventSourceKind): { content: string; contentHash: string; revision?: number } | null {
  switch (kind) {
    case 'sources': {
      if (!db.formalMaterialSourcesReady()) return null
      const content = JSON.stringify({ version: 1, sources: db.listMaterialSources() })
      return { content, contentHash: hash(content) }
    }
    case 'events': {
      if (!db.formalCanonicalEventsReady()) return null
      const content = JSON.stringify({ version: 1, events: db.listCanonicalEvents() })
      return { content, contentHash: hash(content) }
    }
    case 'timeline': return db.formalWorkspaceConfigReady('timeline') ? db.workspaceConfig('timeline') : null
    case 'planning': return db.formalOutlinePlanningStateReady() ? db.outlinePlanningState() : null
  }
}

function mirror(db: WorkspaceEventReadPort, kind: EventSourceKind): EventSourceSnapshot['mirrors'][EventSourceKind] {
  switch (kind) {
    case 'sources': return db.materialSourcesMirror()
    case 'events': return db.canonicalEventsMirror()
    case 'timeline': return db.workspaceConfigMirror('timeline')
    case 'planning': return db.outlinePlanningStateMirror()
  }
}

async function readSourceFile(root: string, kind: EventSourceKind, maximum: number, retain: boolean): Promise<RetainedEventSourceFile> {
  const target = await projectTargetPath(root, join(root, ...sourcePaths[kind]))
  try {
    const path = await projectExistingPath(root, target)
    const before = await stat(path)
    if (!before.isFile()) throw invalidEventSource(kind)
    if (before.size > maximum) throw eventSnapshotLimit()
    const digest = createHash('sha256')
    const chunks: Buffer[] = []
    let byteLength = 0
    // Read at most limit + 1 bytes, even if an external writer grows the file.
    for await (const chunk of createReadStream(path, { end: maximum })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteLength += bytes.length
      if (byteLength > maximum) throw eventSnapshotLimit()
      digest.update(bytes)
      if (retain) chunks.push(bytes)
    }
    const currentPath = await projectExistingPath(root, target)
    const after = await stat(currentPath)
    if (currentPath !== path || byteLength !== before.size || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev) throw changedSources()
    return { base64: retain ? Buffer.concat(chunks).toString('base64') : null, hash: digest.digest('hex'), byteLength }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Recheck the containing directory even for absent optional files.
      await projectTargetPath(root, target)
      return { base64: null, hash: null, byteLength: 0 }
    }
    if (error instanceof AppError) throw error
    throw new AppError('STORAGE_ERROR', '事件核对资料暂时无法读取；原文件没有被改写。', { recoverable: true, cause: error })
  }
}

function fileText(kind: EventSourceKind, file: RetainedEventSourceFile): string | null {
  if (file.base64 === null) return null
  // Reject malformed UTF-8 instead of replacing bytes with U+FFFD. Original
  // bytes (including a UTF-8 BOM) remain in the private retained file record.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.base64, 'base64')) }
  catch { throw invalidEventSource(kind) }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

function changedSources(): AppError {
  return new AppError('CONFLICT', '事件核对期间原始资料发生变化，请重新核对；未迁移任何内容。', { recoverable: true })
}

function freeze<T>(value: T): T {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object' || seen.has(item)) continue
    seen.add(item)
    for (const child of Object.values(item)) pending.push(child)
    Object.freeze(item)
  }
  return value
}
