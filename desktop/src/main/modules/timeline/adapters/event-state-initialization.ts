import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { assertStoryIdentifier } from '../domain/story-event-version'
import type { EventStateInitializationPlan } from '../domain/event-state-initialization'
import { EVENT_SNAPSHOT_MAX_ROWS } from '../domain/event-source-snapshot'
import { eventReceiptHash, timestamp } from './event-migration-receipt-evidence'
import { readEventMigrationReceipt } from './event-migration-receipt-reader'
import { readEventState } from './event-state-reader'

/** Derives the only valid initial order from sealed migration aliases. The
 * result contains no renderer-controlled authority and can be rechecked in a
 * later write transaction. */
export function readEventStateInitializationPlan(database: DatabaseSync, schemaVersion: number,
  projectId: string | null): EventStateInitializationPlan {
  const receipt = readEventMigrationReceipt(database, schemaVersion, projectId)
  if (!projectId || !receipt) throw new AppError('FEATURE_UNAVAILABLE', '当前作品没有可用于恢复事件状态的已封存迁移记录。', { recoverable: true })
  if (readEventState(database, schemaVersion, projectId, () => receipt)) {
    throw new AppError('CONFLICT', '当前作品已经具有事件排序和归档状态，无需再次初始化。', { recoverable: true })
  }
  const eventIds = [...new Set(database.prepare(`SELECT event_id FROM event_migration_source_aliases
    WHERE project_id=? AND event_id IS NOT NULL ORDER BY ordinal`).all(projectId).map(row => String(row.event_id)))]
  if (eventIds.length > EVENT_SNAPSHOT_MAX_ROWS) throw invalid()
  const identities = database.prepare('SELECT id FROM canonical_events WHERE project_id=? ORDER BY id').all(projectId).map(row => String(row.id))
  const orderedIdentities = new Set(eventIds)
  if (identities.length !== eventIds.length || identities.some(id => !orderedIdentities.has(id))) throw invalid()
  for (const eventId of eventIds) {
    assertStoryIdentifier(eventId)
    const head = database.prepare(`SELECT h.latest_version_id,s.version_id AS sealed_version_id FROM canonical_event_version_heads h
      LEFT JOIN canonical_event_version_seals s ON s.version_id=h.latest_version_id WHERE h.project_id=? AND h.event_id=?`).get(projectId, eventId)
    if (!head || head.latest_version_id !== head.sealed_version_id) throw invalid()
    assertStoryIdentifier(head.latest_version_id)
  }
  const orderHash = eventReceiptHash(JSON.stringify(eventIds))
  return Object.freeze({ operationId: receipt.operationId, projectId, committedAt: receipt.committedAt,
    eventIds: Object.freeze(eventIds), orderHash })
}

/** Only the reviewed migration transaction calls this, after sealing its module
 * transition. No schema/read path can seed or repair state. */
export function initializeMigratedEventState(database: DatabaseSync, projectId: string,
  eventIds: readonly string[], committedAt: string, id: () => string): void {
  timestamp(committedAt)
  if (database.prepare('SELECT 1 FROM event_lifecycle_versions LIMIT 1').get()
    || database.prepare('SELECT 1 FROM event_display_order_versions LIMIT 1').get()) {
    throw new AppError('CONFLICT', '已有事件状态记录，请核对迁移状态；未覆盖原记录。', { recoverable: true })
  }
  const nextId = () => { const value = id(); assertStoryIdentifier(value); return value }
  const head = database.prepare('SELECT latest_version_id FROM canonical_event_version_heads WHERE project_id=? AND event_id=?')
  const insert = database.prepare(`INSERT INTO event_lifecycle_versions
    (id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,1,NULL,?,'active',?)`)
  for (const eventId of eventIds) {
    const versionId = head.get(projectId, eventId)?.latest_version_id
    assertStoryIdentifier(versionId)
    insert.run(nextId(), projectId, eventId, versionId, committedAt)
  }
  const json = JSON.stringify(eventIds)
  database.prepare(`INSERT INTO event_display_order_versions
    (id,project_id,revision,previous_id,event_ids_json,content_hash,created_at) VALUES (?,?,1,NULL,?,?,?)`)
    .run(nextId(), projectId, json, eventReceiptHash(json), committedAt)
}

function invalid(): AppError {
  return new AppError('DATABASE_INTEGRITY_FAILED', '迁移记录与当前事件身份不一致，已停止恢复且未改动作品。', { recoverable: false })
}
