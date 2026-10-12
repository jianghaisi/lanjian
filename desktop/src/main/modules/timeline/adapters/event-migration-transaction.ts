import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceCanonicalEventRecord, WorkspaceEventReadPort, WorkspaceMaterialSourceRecord } from '../../../core/ports/workspace-database'
import type { ClaimedEventMigrationReview } from '../domain/event-migration-commit'
import { prepareEventMigrationPayloads } from '../domain/event-migration-payloads'
import { eventMigrationDisplayOrder } from '../domain/event-migration-decisions'
import { assertStoryIdentifier } from '../domain/story-event-version'
import { CanonicalEventVersions } from './canonical-event-versions'
import { encodeEventMigrationReceiptEvidence, eventReceiptHash, timestamp } from './event-migration-receipt-evidence'
import { readEventMigrationReceipt } from './event-migration-receipt-reader'
import { unifiedEventMirrorContent } from './event-mirror-plan'
import { eventSnapshotFromDatabase, eventSourceFingerprint } from './event-source-snapshot'
import { initializeMigratedEventState } from './event-state-initialization'
import { readEventState } from './event-state-reader'

type TransactionOwners = {
  id(): string
  insertMaterial(source: WorkspaceMaterialSourceRecord): void
  insertEvent(event: WorkspaceCanonicalEventRecord): void
  prepareSourcesMirror(observedHash: string | null): void
  prepareMirror(content: string, observedHash: string | null): void
}

/** Caller owns BEGIN IMMEDIATE, schema validation and authorization. All live
 * reads and inserts below share that transaction. No async work or file IO. */
export function writeReviewedEventMigration(database: DatabaseSync, read: WorkspaceEventReadPort,
  review: ClaimedEventMigrationReview, committedAt: string, owners: TransactionOwners) {
  const { snapshot, plan, operationId, decisionFingerprint } = review
  assertStoryIdentifier(operationId)
  timestamp(committedAt)
  if (!read.projectId || snapshot.database?.projectId !== read.projectId
    || decisionFingerprint !== eventReceiptHash(JSON.stringify(plan))) throw changed()
  const payloads = prepareEventMigrationPayloads(snapshot, plan)
  if (JSON.stringify(payloads) !== JSON.stringify(review.payloads)) throw changed()
  const existing = readEventMigrationReceipt(database, read.schemaVersion, read.projectId)
  if (existing) {
    if (existing.operationId !== operationId || existing.sourceFingerprint !== snapshot.fingerprint
      || existing.decisionFingerprint !== decisionFingerprint) throw changed()
    return existing
  }
  const current = eventSnapshotFromDatabase(read, snapshot.scope, snapshot.files)
  if (eventSourceFingerprint(current) !== snapshot.fingerprint) throw changed()
  // Unready tables are not in the retained formal snapshot. Never hide or merge
  // pre-existing rows from a partially completed import.
  for (const [kind, table] of [['sources', 'material_sources'], ['events', 'canonical_events']] as const) {
    if (snapshot.documents[kind].authority === 'file' && database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw changed()
  }
  const archive = encodeEventMigrationReceiptEvidence(snapshot, plan)
  const projectId = read.projectId
  const versions = new CanonicalEventVersions(database, projectId, owners.id)
  const targets = new Map<number, { eventId: string; versionId: string }>()
  for (const row of payloads.rows) if (row.kind === 'material' && snapshot.documents.sources.authority === 'file') owners.insertMaterial(row.record)
  for (const row of payloads.rows) {
    if (row.kind === 'existing-version') targets.set(row.rowIndex, { eventId: row.eventId, versionId: row.versionId })
    if (row.kind === 'baseline') {
      const decision = plan.rows[row.rowIndex]!
      const original = snapshot.documents.events.occurrences[decision.ref.ordinal]!.value as WorkspaceCanonicalEventRecord
      if (snapshot.documents.events.authority === 'file') owners.insertEvent(original)
      const version = versions.append(row.eventId, null, row.payload, committedAt)
      targets.set(row.rowIndex, { eventId: row.eventId, versionId: version.id })
    }
    if (row.kind === 'direct') {
      const eventId = owners.id()
      assertStoryIdentifier(eventId)
      owners.insertEvent({ ...row.payload.content, id: eventId, status: row.payload.status, createdAt: committedAt,
        ...(row.payload.status === 'approved' ? { approvedAt: committedAt } : {}) })
      const version = versions.append(eventId, null, row.payload, committedAt)
      targets.set(row.rowIndex, { eventId, versionId: version.id })
    }
  }
  database.prepare('UPDATE projects SET material_sources_ready=1, canonical_events_ready=1, updated_at=? WHERE id=?').run(committedAt, projectId)
  if (snapshot.documents.sources.authority === 'file') owners.prepareSourcesMirror(snapshot.files.sources.hash)
  database.prepare(`INSERT INTO event_migration_receipts
    (operation_id,project_id,source_fingerprint,decision_fingerprint,source_snapshot_hash,source_snapshot_json,mapping_count,committed_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(operationId, projectId, snapshot.fingerprint, decisionFingerprint, eventReceiptHash(archive), archive, plan.rows.length, committedAt)
  const alias = database.prepare(`INSERT INTO event_migration_source_aliases
    (operation_id,ordinal,project_id,source_kind,source_hash,source_ordinal,original_id,disposition,material_source_id,material_content_hash,event_id,event_version_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (const decision of plan.rows) {
    const row = payloads.rows[decision.rowIndex]!
    const target = targets.get(decision.targetRowIndex ?? decision.rowIndex)
    alias.run(operationId, decision.rowIndex, projectId, decision.ref.source, decision.ref.contentHash, decision.ref.ordinal,
      decision.ref.originalId!, decision.disposition, row.kind === 'material' ? row.record.id : null,
      row.kind === 'material' ? row.record.contentHash : null, target?.eventId ?? null, target?.versionId ?? null)
  }
  database.prepare('INSERT INTO event_migration_receipt_seals (operation_id,project_id) VALUES (?,?)').run(operationId, projectId)
  // Retire previously queued legacy writes while still holding the same lock.
  // Keep workspace_config_documents and the original timeline file untouched.
  database.prepare(`DELETE FROM mirror_entries WHERE project_id=? AND
    (source_type='canonical_events_json' OR (source_type='workspace_config_json' AND source_id='timeline'))`).run(projectId)
  database.prepare('INSERT INTO event_module_transitions (project_id,operation_id) VALUES (?,?)').run(projectId, operationId)
  initializeMigratedEventState(database, projectId, eventMigrationDisplayOrder(plan).map(rowIndex => {
    const target = targets.get(rowIndex)
    if (!target) throw changed()
    return target.eventId
  }), committedAt, owners.id)
  readEventState(database, read.schemaVersion, projectId)
  owners.prepareMirror(unifiedEventMirrorContent(read), snapshot.files.events.hash)
  // Independently verify the actual persisted map and all historical targets
  // before COMMIT, not just the values we intended to insert.
  return readEventMigrationReceipt(database, read.schemaVersion, projectId, operationId)!
}

function changed(): AppError {
  return new AppError('CONFLICT', '事件、资料、章节安排或迁移状态已变化，请重新核对；未提交这次迁移。', { recoverable: true })
}
