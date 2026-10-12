import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import type { EventMirrorFeedback, EventMirrorPlan } from '../domain/event-mirror'
import { eventReceiptHash, isHash } from './event-migration-receipt-evidence'

export const EVENT_MIRROR_RELATIVE_PATH = '.webnovel/research/events.json'

/** Compatibility metadata plus the complete selected immutable payload. A
 * candidate-only event stays labelled candidate; it is not promoted by export. */
export function unifiedEventMirrorContent(read: WorkspaceEventReadPort): string {
  const events = read.listCanonicalEvents().map(event => {
    const history = read.listCanonicalEventVersions(event.id), heads = read.canonicalEventVersionHeads(event.id)
    const selected = history.find(version => version.id === (heads?.approvedVersionId ?? heads?.latestVersionId))
    if (!selected) throw invalid()
    return { ...event, ...selected.content }
  })
  return `${JSON.stringify({ version: 1, authority: 'sqlite-unified-events', events }, null, 2)}\n`
}

/** Caller pins one SQLite read/write transaction. Never repairs registrations. */
export function readEventMirrorPlan(database: DatabaseSync, read: WorkspaceEventReadPort, operationId?: string): EventMirrorPlan | null {
  const receipt = read.eventMigrationReceipt(operationId)
  if (!receipt) return null
  const row = database.prepare("SELECT * FROM mirror_entries WHERE project_id=? AND source_type='canonical_events_json' AND source_id=?")
    .get(receipt.projectId, receipt.projectId)
  if (!row || row.relative_path !== EVENT_MIRROR_RELATIVE_PATH || !isHash(row.content_hash)
    || row.source_version_id !== row.content_hash || (row.observed_hash !== null && !isHash(row.observed_hash))
    || (row.previous_observed_hash !== null && !isHash(row.previous_observed_hash))) throw invalid()
  const content = unifiedEventMirrorContent(read), contentHash = eventReceiptHash(content)
  if (contentHash !== row.content_hash) throw invalid()
  const status = row.status
  if (!['synced', 'pending', 'conflict', 'failed'].includes(String(status))) throw invalid()
  if (status === 'synced') {
    if (row.observed_hash !== contentHash || row.last_error_code !== null
      || row.previous_relative_path !== null || row.previous_observed_hash !== null) throw invalid()
  } else if (row.previous_relative_path !== EVENT_MIRROR_RELATIVE_PATH) throw invalid()
  if (status === 'pending' && row.last_error_code !== null && row.last_error_code !== 'MIRROR_STALE') throw invalid()
  if (status === 'conflict' && row.last_error_code !== 'MIRROR_EXTERNAL_CHANGE') throw invalid()
  if (status === 'failed' && row.last_error_code !== 'MIRROR_WRITE_FAILED') throw invalid()
  const feedback: EventMirrorFeedback = status === 'conflict'
    ? Object.freeze({ status: 'conflict', issue: 'external-change' })
    : status === 'failed'
      ? Object.freeze({ status: 'failed', issue: 'storage-error' })
      : status === 'pending'
        ? Object.freeze({ status: 'pending', issue: row.last_error_code === 'MIRROR_STALE' ? 'stale' : 'none' })
        : Object.freeze({ status: 'synced', issue: 'none' })
  return Object.freeze({ receipt, content, contentHash,
    expectedFileHash: status === 'synced' ? contentHash : row.previous_observed_hash as string | null,
    // Bind the registered state as well as the exact current selected content.
    revision: eventReceiptHash(JSON.stringify({ operationId: receipt.operationId, row, contentHash })), feedback })
}

export function assertSameEventMirror(expected: EventMirrorPlan, actual: EventMirrorPlan | null): void {
  if (!actual || actual.receipt.projectId !== expected.receipt.projectId || actual.receipt.operationId !== expected.receipt.operationId
    || actual.revision !== expected.revision || actual.contentHash !== expected.contentHash || actual.content !== expected.content
    || actual.expectedFileHash !== expected.expectedFileHash) {
    throw new AppError('CONFLICT', '事件可读副本或正式版本已变化，请重新同步。', { recoverable: true })
  }
}

function invalid(): AppError {
  return new AppError('DATABASE_INTEGRITY_FAILED', '事件可读副本与已提交版本的记录不一致，已停止同步。', { recoverable: false })
}
