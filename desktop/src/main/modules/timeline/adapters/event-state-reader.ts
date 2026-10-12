import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { EventDisplayOrder, EventLifecycle, EventStateSnapshot } from '../domain/event-state'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import { assertStoryIdentifier } from '../domain/story-event-version'
import { EVENT_SNAPSHOT_MAX_ROWS } from '../domain/event-source-snapshot'
import { eventReceiptHash, timestamp } from './event-migration-receipt-evidence'
import { readEventMigrationReceipt } from './event-migration-receipt-reader'

/** Caller pins a read snapshot and validates schema. null is explicitly
 * uninitialized, never permission to fill defaults or repair history. */
export function readEventState(database: DatabaseSync, schemaVersion: number, projectId: string | null,
  readReceipt: () => EventMigrationReceipt | null = () => readEventMigrationReceipt(database, schemaVersion, projectId)): EventStateSnapshot | null {
  if (schemaVersion < 43) return null
  try { return verified(database, projectId, readReceipt) } catch (cause) {
    throw new AppError('DATABASE_INTEGRITY_FAILED', '事件排序或归档历史校验失败，已停止读取且未改动作品。', { recoverable: false, cause })
  }
}

function verified(database: DatabaseSync, projectId: string | null, readReceipt: () => EventMigrationReceipt | null): EventStateSnapshot | null {
  const hasLifecycle = !!database.prepare('SELECT 1 FROM event_lifecycle_versions LIMIT 1').get()
  const hasOrder = !!database.prepare('SELECT 1 FROM event_display_order_versions LIMIT 1').get()
  if (!hasLifecycle && !hasOrder) return null
  const receipt = readReceipt()
  if (!projectId || !receipt || receipt.projectId !== projectId || !hasOrder) throw new Error('incomplete event state')
  const identities = new Set<string>()
  for (const row of database.prepare('SELECT id,project_id FROM canonical_events').iterate()) {
    assertStoryIdentifier(row.id)
    if (row.project_id !== projectId || identities.size >= EVENT_SNAPSHOT_MAX_ROWS) throw new Error('invalid event scope')
    identities.add(row.id)
  }
  const migratedIds = [...new Set(database.prepare(`SELECT event_id FROM event_migration_source_aliases
    WHERE event_id IS NOT NULL ORDER BY ordinal`).all().map(row => String(row.event_id)))]
  const migrated = new Set(migratedIds)
  const lifecycles = new Map<string, EventLifecycle>()
  const heldVersions = new Map<string, number>()
  // Validate every retained transition, including obsolete rows, against the
  // same-book sealed version it held; later content edits are allowed.
  for (const row of database.prepare(`SELECT l.*, v.event_id AS version_event_id, v.project_id AS version_project_id, v.version_no AS held_version,
      s.version_id AS sealed_version_id FROM event_lifecycle_versions l
    LEFT JOIN canonical_event_versions v ON v.id=l.expected_event_version_id
    LEFT JOIN canonical_event_version_seals s ON s.version_id=v.id ORDER BY l.event_id,l.revision`).iterate()) {
    assertStoryIdentifier(row.id); assertStoryIdentifier(row.event_id); assertStoryIdentifier(row.expected_event_version_id)
    timestamp(row.created_at)
    const previous = lifecycles.get(row.event_id)
    if (row.project_id !== projectId || !identities.has(row.event_id)
      || row.version_event_id !== row.event_id || row.version_project_id !== projectId || row.sealed_version_id !== row.expected_event_version_id
      || typeof row.held_version !== 'number' || !Number.isSafeInteger(row.held_version) || row.held_version < 1
      || row.held_version < (heldVersions.get(row.event_id) ?? 0)
      || !Number.isSafeInteger(row.revision) || row.revision !== (previous?.revision ?? 0) + 1
      || row.previous_id !== (previous?.id ?? null) || !['active', 'archived'].includes(String(row.state))
      || (previous ? previous.state === row.state : row.state !== 'active')
      || (!previous && migrated.has(row.event_id) && row.created_at !== receipt.committedAt)) throw new Error('invalid lifecycle chain')
    lifecycles.set(row.event_id, Object.freeze({ id: row.id, eventId: row.event_id, revision: row.revision as number,
      expectedEventVersionId: row.expected_event_version_id, state: row.state as EventLifecycle['state'], createdAt: row.created_at }))
    heldVersions.set(row.event_id, row.held_version)
  }
  if (lifecycles.size !== identities.size) throw new Error('missing lifecycle')
  let order: EventDisplayOrder | null = null
  // Bound bytes before fetching each JSON; stream retained history rather than
  // loading all order payloads together. SQL's character bound is not a byte bound.
  const payload = database.prepare('SELECT event_ids_json FROM event_display_order_versions WHERE id=?')
  for (const row of database.prepare(`SELECT id,project_id,revision,previous_id,content_hash,created_at,
    length(CAST(event_ids_json AS BLOB)) AS bytes FROM event_display_order_versions ORDER BY revision`).iterate()) {
    const previous: EventDisplayOrder | null = order
    assertStoryIdentifier(row.id); timestamp(row.created_at)
    if (row.project_id !== projectId || !Number.isSafeInteger(row.revision) || row.revision !== nextRevision(previous)
      || row.previous_id !== previousId(previous) || typeof row.bytes !== 'number' || row.bytes < 2 || row.bytes > 16777216) throw new Error('invalid order chain')
    const json = payload.get(row.id)?.event_ids_json
    if (typeof json !== 'string' || eventReceiptHash(json) !== row.content_hash) throw new Error('invalid order hash')
    const ids: unknown = JSON.parse(json)
    if (!Array.isArray(ids) || ids.length > EVENT_SNAPSHOT_MAX_ROWS) throw new Error('invalid order payload')
    for (const id of ids) { assertStoryIdentifier(id); if (!identities.has(id)) throw new Error('foreign order identity') }
    const set = new Set<string>(ids)
    if (set.size !== ids.length || (order ? order.eventIds.some(id => !set.has(id))
      : JSON.stringify(ids) !== JSON.stringify(migratedIds) || row.created_at !== receipt.committedAt)) throw new Error('lost order identity')
    order = Object.freeze({ id: row.id, revision: row.revision as number, eventIds: Object.freeze(ids as string[]),
      contentHash: row.content_hash as string, createdAt: row.created_at })
  }
  if (!order || order.eventIds.length !== identities.size) throw new Error('incomplete display order')
  return Object.freeze({ order, lifecycles: Object.freeze(order.eventIds.map(id => lifecycles.get(id)!)) })
}

function nextRevision(previous: EventDisplayOrder | null): number { return (previous?.revision ?? 0) + 1 }
function previousId(previous: EventDisplayOrder | null): string | null { return previous?.id ?? null }
