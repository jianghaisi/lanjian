import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import { directEventMigrationPayload } from '../domain/legacy-event-payload'
import { assertStoryIdentifier, storyEventVersionPayload, type StoryEventVersion } from '../domain/story-event-version'
import { EVENT_SNAPSHOT_MAX_ROWS } from '../domain/event-source-snapshot'
import { CanonicalEventVersions } from './canonical-event-versions'
import { eventMigrationReceiptTables } from './event-migration-receipt-schema'
import { decodeEventMigrationReceiptEvidence, EVENT_RECEIPT_MAX_BYTES, eventReceiptHash, invalidReceipt, isHash, timestamp } from './event-migration-receipt-evidence'

/** Caller owns a pinned read transaction and schema validation. Never opens,
 * upgrades, repairs or replays anything; this result does not switch consumers. */
export function readEventMigrationReceipt(database: DatabaseSync, schemaVersion: number,
  projectId: string | null, operationId?: string): EventMigrationReceipt | null {
  if (operationId !== undefined) assertStoryIdentifier(operationId)
  if (schemaVersion < 40) return null
  let receipt: EventMigrationReceipt | null
  try { receipt = readVerified(database, projectId) } catch (cause) { throw invalidReceipt(cause) }
  if (receipt && operationId !== undefined && operationId !== receipt.operationId) {
    throw new AppError('NOT_FOUND', '当前作品没有这次事件迁移的回执，请核对作品和操作记录。', { recoverable: true })
  }
  return receipt
}

function readVerified(database: DatabaseSync, projectId: string | null): EventMigrationReceipt | null {
  const counts = eventMigrationReceiptTables.map(table => Number(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n))
  if (counts.every(count => count === 0)) return null
  if (!projectId || counts[0] !== 1 || counts[2] !== 1 || counts[3] !== 1 || counts[1]! > EVENT_SNAPSHOT_MAX_ROWS) throw invalidReceipt()
  assertStoryIdentifier(projectId)
  if (database.prepare('SELECT storage_mode FROM projects WHERE id=?').get(projectId)?.storage_mode !== 'sqlite') throw invalidReceipt()
  // Check byte bounds BEFORE loading the retained JSON into JS.
  const row = database.prepare(`SELECT operation_id, project_id, source_fingerprint, decision_fingerprint,
    source_snapshot_hash, length(CAST(source_snapshot_json AS BLOB)) AS bytes, mapping_count, committed_at
    FROM event_migration_receipts`).get()!
  assertStoryIdentifier(row.operation_id)
  if (row.project_id !== projectId || !isHash(row.source_fingerprint) || !isHash(row.decision_fingerprint)
    || !isHash(row.source_snapshot_hash) || typeof row.bytes !== 'number' || row.bytes < 1 || row.bytes > EVENT_RECEIPT_MAX_BYTES
    || row.mapping_count !== counts[1]) throw invalidReceipt()
  timestamp(row.committed_at)
  const seal = database.prepare('SELECT * FROM event_migration_receipt_seals').get()!
  const transition = database.prepare('SELECT * FROM event_module_transitions').get()!
  if ([seal, transition].some(item => item.project_id !== projectId || item.operation_id !== row.operation_id)) throw invalidReceipt()
  const json = database.prepare('SELECT source_snapshot_json FROM event_migration_receipts').get()!.source_snapshot_json
  if (typeof json !== 'string' || eventReceiptHash(json) !== row.source_snapshot_hash) throw invalidReceipt()
  const { snapshot, plan, inspection } = decodeEventMigrationReceiptEvidence(json)
  if (snapshot.database?.projectId !== projectId || snapshot.fingerprint !== row.source_fingerprint
    || eventReceiptHash(JSON.stringify(plan)) !== row.decision_fingerprint || plan.rows.length !== row.mapping_count) throw invalidReceipt()

  const aliases = database.prepare('SELECT * FROM event_migration_source_aliases ORDER BY ordinal').all()
  const versions = new CanonicalEventVersions(database, projectId, () => { throw invalidReceipt() })
  const histories = new Map<string, StoryEventVersion[]>()
  const historical = new Map(snapshot.eventHistory.map(history => [history.eventId, history]))
  const keptEventIds = new Set<string>()
  const sourceCounts = { sources: 0, events: 0, timeline: 0 }
  let reviewPage = inspection.rowsPage(0)
  for (const [index, alias] of aliases.entries()) {
    if (index >= reviewPage.offset + reviewPage.items.length) reviewPage = inspection.rowsPage(index)
    const reviewedRow = reviewPage.items[index - reviewPage.offset]!
    const decision = plan.rows[index]!
    if (alias.ordinal !== index || alias.operation_id !== row.operation_id || alias.project_id !== projectId
      || alias.source_kind !== decision.ref.source || alias.source_hash !== decision.ref.contentHash
      || alias.source_ordinal !== decision.ref.ordinal || alias.original_id !== decision.ref.originalId
      || alias.disposition !== decision.disposition) throw invalidReceipt()
    sourceCounts[decision.ref.source]++
    const original = snapshot.documents[decision.ref.source].occurrences[decision.ref.ordinal]!.value as Record<string, unknown>
    if (decision.ref.source === 'sources') {
      if (alias.material_source_id !== decision.ref.originalId || alias.material_content_hash !== original.contentHash
        || alias.event_id !== null || alias.event_version_id !== null || !isHash(alias.material_content_hash)
        || !database.prepare('SELECT id FROM material_sources WHERE project_id=? AND id=?').get(projectId, alias.material_source_id)) throw invalidReceipt()
      // A later source hash is valid: preserve the reviewed historical hash.
      continue
    }
    assertStoryIdentifier(alias.event_id); assertStoryIdentifier(alias.event_version_id)
    if (alias.material_source_id !== null || alias.material_content_hash !== null) throw invalidReceipt()
    if (!histories.has(alias.event_id)) histories.set(alias.event_id, versions.list(alias.event_id))
    const history = histories.get(alias.event_id)!
    const target = history.find(version => version.id === alias.event_version_id)
    if (!target) throw invalidReceipt()
    if (decision.disposition === 'keep-separate') {
      if (keptEventIds.has(alias.event_id)) throw invalidReceipt()
      keptEventIds.add(alias.event_id)
    } else {
      const kept = aliases[decision.targetRowIndex!]
      if (!kept || kept.disposition !== 'keep-separate' || kept.event_id !== alias.event_id || kept.event_version_id !== alias.event_version_id) throw invalidReceipt()
    }
    if (decision.ref.source === 'events') {
      if (alias.event_id !== decision.ref.originalId) throw invalidReceipt()
      const retained = historical.get(alias.event_id)
      if (retained?.heads) {
        const selected = retained.heads.approvedVersionId ?? retained.heads.latestVersionId
        if (target.id !== selected || retained.versions.some(previous => {
          const current = history.find(version => version.id === previous.id)
          return !current || JSON.stringify(current) !== JSON.stringify(previous)
        })) throw invalidReceipt()
      } else {
        // An unversioned canonical record is retained as a baseline, not approved anew.
        const content = target.content
        if (target.version !== 1 || target.status !== original.status || target.phase !== 'legacy-unknown'
          || target.granularity !== 'legacy-unknown' || target.creator !== 'legacy-unknown' || target.sources.length
          || content.time !== original.time || content.location !== original.location || content.event !== original.event
          || content.result !== original.result || content.confidence !== original.confidence
          || JSON.stringify(content.characters) !== JSON.stringify(original.characters)
          || JSON.stringify(content.evidenceRefs) !== JSON.stringify(original.evidenceRefs)
          || content.title !== original.title || content.rawCharacters !== original.rawCharacters) throw invalidReceipt()
      }
    } else {
      const expected = directEventMigrationPayload(original, reviewedRow.proposedCharacters!)
      if (target.version !== 1 || JSON.stringify(storyEventVersionPayload(target)) !== JSON.stringify(expected)) throw invalidReceipt()
    }
  }
  // Later heads and relocated book paths do not replace historical commit evidence.
  return Object.freeze({ operationId: row.operation_id, projectId, sourceFingerprint: row.source_fingerprint,
    decisionFingerprint: row.decision_fingerprint, committedAt: row.committed_at, mappingCount: row.mapping_count as number,
    sourceCounts: Object.freeze(sourceCounts) })
}
