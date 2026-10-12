import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { decodeEventOperation, decodeEventOperationAuthority, type EventOperationReceipt } from '../domain/event-operations'
import { assertStoryIdentifier } from '../domain/story-event-version'
import { CanonicalEventVersions } from './canonical-event-versions'
import { eventReceiptHash, isHash, timestamp } from './event-migration-receipt-evidence'
import { readEventState } from './event-state-reader'
import { decodeEventModelCandidateArtifact, eventModelCandidateContent, EVENT_MODEL_CANDIDATE_ARTIFACT,
  EVENT_MODEL_CANDIDATE_TASK } from '../domain/event-model-candidates'

export function readEventOperationReceipt(database: DatabaseSync, schemaVersion: number, projectId: string | null,
  operationId: string): EventOperationReceipt | null {
  assertStoryIdentifier(operationId)
  if (schemaVersion < 44 || !projectId) return null
  try {
    const row = database.prepare(`SELECT operation_id,project_id,kind,request_hash,event_id,version_id,lifecycle_id,order_id,no_op,committed_at,
      length(CAST(request_json AS BLOB)) AS bytes FROM event_operation_receipts
      WHERE operation_id=? AND project_id=?`).get(operationId, projectId)
    if (!row) return null
    if (typeof row.bytes !== 'number' || row.bytes > 16777216 || !readEventState(database, schemaVersion, projectId)) throw invalid()
    const json = database.prepare('SELECT request_json FROM event_operation_receipts WHERE operation_id=?').get(operationId)?.request_json
    if (typeof json !== 'string' || !isHash(row.request_hash) || eventReceiptHash(json) !== row.request_hash) throw invalid()
    timestamp(row.committed_at)
    const request = JSON.parse(json)
    if (request.version !== 1 || !isHash(request.sourceFingerprint)
      || !['command,sourceFingerprint,version', 'authority,command,sourceFingerprint,version'].includes(Object.keys(request).sort().join(','))) throw invalid()
    const command = decodeEventOperation(request.command)
    const authority = request.authority === undefined ? undefined : decodeEventOperationAuthority(request.authority)
    if (authority && command.kind !== 'create') throw invalid()
    if (command.kind !== row.kind || ![0, 1].includes(Number(row.no_op))) throw invalid()
    assertStoryIdentifier(row.order_id)
    const order = database.prepare('SELECT * FROM event_display_order_versions WHERE id=? AND project_id=?').get(row.order_id, projectId)
    if (!order || eventReceiptHash(String(order.event_ids_json)) !== order.content_hash) throw invalid()
    if (command.kind === 'reorder' || command.kind === 'create') {
      if (row.no_op ? order.id !== command.expectedOrderId : order.previous_id !== command.expectedOrderId) throw invalid()
      if (!row.no_op && order.created_at !== row.committed_at) throw invalid()
    } else if (order.id !== command.expectedOrderId) throw invalid()
    if (command.kind === 'reorder') {
      if (JSON.stringify(command.eventIds) !== order.event_ids_json || row.event_id !== null || row.version_id !== null || row.lifecycle_id !== null) throw invalid()
    } else {
      assertStoryIdentifier(row.event_id); assertStoryIdentifier(row.version_id); assertStoryIdentifier(row.lifecycle_id)
      if (command.kind !== 'create' && row.event_id !== command.eventId) throw invalid()
      const versions = new CanonicalEventVersions(database, projectId, () => { throw invalid() }).list(row.event_id)
      const version = versions.find(item => item.id === row.version_id)
      const lifecycle = database.prepare('SELECT * FROM event_lifecycle_versions WHERE id=? AND project_id=? AND event_id=?')
        .get(row.lifecycle_id, projectId, row.event_id)
      if (!version || !lifecycle) throw invalid()
      if (authority?.kind === 'verified-model-candidate') {
        const artifact = database.prepare(`SELECT artifacts.content,artifacts.content_hash,artifacts.status,artifacts.schema_valid,
          artifacts.artifact_type,runs.status AS task_status,runs.task_type
          FROM generation_artifacts artifacts JOIN task_runs runs ON runs.id=artifacts.task_run_id
          WHERE artifacts.id=? AND artifacts.task_run_id=? AND runs.project_id=?`).get(
          authority.artifactId, authority.taskId, projectId)
        if (!artifact || artifact.content_hash !== authority.artifactHash || artifact.status !== 'complete'
          || Number(artifact.schema_valid) !== 1 || artifact.artifact_type !== EVENT_MODEL_CANDIDATE_ARTIFACT
          || artifact.task_status !== 'succeeded' || artifact.task_type !== EVENT_MODEL_CANDIDATE_TASK) throw invalid()
        const selected = decodeEventModelCandidateArtifact(artifact.content).candidates[authority.candidateIndex]
        if (!selected || JSON.stringify(eventModelCandidateContent(selected)) !== JSON.stringify(version.content)) throw invalid()
      }
      const candidateAuthority = authority?.kind === 'verified-material-candidate' || authority?.kind === 'verified-model-candidate'
      if ((['edit', 'adopt'].includes(command.kind) || command.kind === 'create' && !candidateAuthority) && version.status !== 'approved') throw invalid()
      if (command.kind === 'create' && candidateAuthority && version.status !== 'candidate') throw invalid()
      if (command.kind === 'create') {
        const expectedSources = authority?.kind === 'verified-manuscript' ? authority.manuscriptSources.map(({ id, revision }) => ({
          source: { kind: 'manuscript', id, revision }, relation: 'derived-from'
        })) : authority?.kind === 'verified-material-candidate'
          ? [{ source: { kind: 'material', id: authority.sourceId, revision: authority.sourceRevision }, relation: 'derived-from' }] : null
        const expectedCreator = authority?.kind === 'verified-model-candidate' ? 'model-candidate'
          : authority?.kind === 'verified-manuscript' ? 'manuscript-extraction' : 'author'
        if (row.no_op || version.version !== 1 || lifecycle.revision !== 1 || lifecycle.state !== 'active'
          || lifecycle.expected_event_version_id !== version.id || lifecycle.created_at !== row.committed_at
          || version.createdAt !== row.committed_at || version.creator !== expectedCreator
          || version.phase !== (authority?.kind === 'verified-manuscript' ? 'realized' : 'planned')
          || (expectedSources !== null && JSON.stringify(version.sources) !== JSON.stringify(expectedSources))
          || version.granularity !== command.granularity || JSON.parse(String(order.event_ids_json)).at(-1) !== row.event_id
          || JSON.stringify(version.content) !== JSON.stringify(command.content)) throw invalid()
      } else if (command.kind === 'archive' || command.kind === 'restore') {
        if (version.id !== command.expectedVersionId || lifecycle.state !== (command.kind === 'archive' ? 'archived' : 'active')
          || (row.no_op ? lifecycle.id !== command.expectedLifecycleId : lifecycle.previous_id !== command.expectedLifecycleId)) throw invalid()
        if (!row.no_op && (lifecycle.created_at !== row.committed_at || lifecycle.expected_event_version_id !== version.id)) throw invalid()
      } else {
        if (lifecycle.id !== command.expectedLifecycleId || (row.no_op ? version.id !== command.expectedVersionId : version.previousVersionId !== command.expectedVersionId)) throw invalid()
        if (!row.no_op && (version.createdAt !== row.committed_at || version.creator !== 'author'
          || !version.sources.some(edge => edge.relation === 'supersedes' && edge.source.kind === 'event'
            && edge.source.id === row.event_id && edge.source.revision === command.expectedVersionId))) throw invalid()
        if (command.kind === 'edit' && ((!row.no_op && version.phase !== 'planned') || version.granularity !== command.granularity
          || JSON.stringify(version.content) !== JSON.stringify(command.content))) throw invalid()
        if (command.kind === 'adopt') {
          const candidate = versions.find(item => item.id === command.expectedVersionId)
          if (!candidate || candidate.status !== 'candidate' || JSON.stringify(candidate.content) !== JSON.stringify(version.content)) throw invalid()
          if (version.phase !== candidate.phase || version.granularity !== candidate.granularity
            || JSON.stringify(version.sources) !== JSON.stringify([...candidate.sources,
              { source: { kind: 'event', id: candidate.eventId, revision: candidate.id }, relation: 'supersedes' }])) throw invalid()
        }
      }
    }
    return Object.freeze({ operationId, kind: command.kind, requestHash: row.request_hash,
      eventId: row.event_id as string | null, versionId: row.version_id as string | null, lifecycleId: row.lifecycle_id as string | null,
      orderId: row.order_id, noOp: row.no_op === 1, committedAt: row.committed_at })
  } catch (cause) { throw invalid(cause) }
}

function invalid(cause?: unknown): AppError {
  return new AppError('DATABASE_INTEGRITY_FAILED', '事件操作回执或历史结果校验失败，请核对恢复记录；未重放操作。', { recoverable: false, cause })
}
