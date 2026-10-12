import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceCanonicalEventRecord, WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import { decodeEventOperation, decodeEventOperationAuthority, type EventOperationReview } from '../domain/event-operations'
import { assertEventCanArchive, type EventSourceAlias } from '../domain/event-archive-guard'
import { assertStoryIdentifier, storyEventVersionPayload, type StoryEventVersion, type StorySourceEdge } from '../domain/story-event-version'
import { eventSourceFingerprint, eventSnapshotFromDatabase } from './event-source-snapshot'
import { eventReceiptHash, timestamp } from './event-migration-receipt-evidence'
import { readEventOperationReceipt } from './event-operation-receipt-reader'
import { CanonicalEventVersions } from './canonical-event-versions'
import { decodeEventModelCandidateArtifact, eventModelCandidateContent, EVENT_MODEL_CANDIDATE_ARTIFACT,
  EVENT_MODEL_CANDIDATE_TASK } from '../domain/event-model-candidates'

type Owners = {
  id(): string
  insertEvent(record: WorkspaceCanonicalEventRecord): void
  updateEvent(eventId: string, version: StoryEventVersion): void
  prepareMirror(): void
}

/** Existing BEGIN IMMEDIATE and live author grant are owned by the caller. */
export function writeReviewedEventOperation(database: DatabaseSync, read: WorkspaceEventReadPort,
  review: EventOperationReview, committedAt: string, owners: Owners) {
  assertStoryIdentifier(review.operationId); timestamp(committedAt)
  const command = decodeEventOperation(review.command), projectId = read.projectId
  const authority = review.authority ? decodeEventOperationAuthority(review.authority) : undefined
  if (authority && command.kind !== 'create') throw conflict()
  const requestJson = JSON.stringify({ version: 1, sourceFingerprint: review.snapshot.fingerprint, command,
    ...(authority ? { authority } : {}) })
  if (!projectId || projectId !== review.snapshot.database?.projectId || eventReceiptHash(requestJson) !== review.requestHash) throw conflict()
  const previous = readEventOperationReceipt(database, read.schemaVersion, projectId, review.operationId)
  if (previous) { if (previous.requestHash !== review.requestHash) throw conflict(); return previous }
  if (eventSourceFingerprint(eventSnapshotFromDatabase(read, review.snapshot.scope, review.snapshot.files)) !== review.snapshot.fingerprint) throw conflict()
  const state = read.eventState()
  if (!state || state.order.id !== command.expectedOrderId) throw conflict()
  if (command.kind === 'create' && state.order.eventIds.length >= 100_000)
    throw new AppError('VALIDATION_ERROR', '事件数量已达核对上限，不能继续新建；未截断或移除任何事件。', { recoverable: true })
  const versions = new CanonicalEventVersions(database, projectId, owners.id)
  const newId = () => { const id = owners.id(); assertStoryIdentifier(id); return id }
  let orderId = state.order.id, eventId: string | null = null, versionId: string | null = null, lifecycleId: string | null = null, noOp = false
  const appendOrder = (ids: readonly string[]) => {
    orderId = newId()
    const json = JSON.stringify(ids)
    database.prepare(`INSERT INTO event_display_order_versions
      (id,project_id,revision,previous_id,event_ids_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(orderId, projectId, state.order.revision + 1, state.order.id, json, eventReceiptHash(json), committedAt)
  }
  if (command.kind === 'reorder') {
    const current = new Set(state.order.eventIds)
    if (command.eventIds.length !== current.size || command.eventIds.some(id => !current.has(id))) throw conflict()
    noOp = JSON.stringify(command.eventIds) === JSON.stringify(state.order.eventIds)
    if (!noOp) appendOrder(command.eventIds)
  } else {
    eventId = command.kind === 'create' ? newId() : command.eventId
    const lifecycle = state.lifecycles.find(item => item.eventId === eventId)
    const history = command.kind === 'create' ? [] : versions.list(eventId)
    const latest = history.at(-1)
    if (command.kind !== 'create' && (!lifecycle || lifecycle.id !== command.expectedLifecycleId || latest?.id !== command.expectedVersionId)) throw conflict()
    versionId = latest?.id ?? null; lifecycleId = lifecycle?.id ?? null
    if (command.kind === 'archive' || command.kind === 'restore') {
      if (command.kind === 'archive') {
        const aliases = database.prepare(`SELECT original_id AS originalId,event_id AS eventId,source_kind AS source
          FROM event_migration_source_aliases WHERE project_id=? AND event_id IS NOT NULL`).all(projectId) as EventSourceAlias[]
        assertEventCanArchive(eventId, review.snapshot, aliases)
      }
      const desired = command.kind === 'archive' ? 'archived' : 'active'
      noOp = lifecycle!.state === desired
      if (!noOp) {
        lifecycleId = newId()
        database.prepare(`INSERT INTO event_lifecycle_versions
          (id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(lifecycleId, projectId, eventId, lifecycle!.revision + 1, lifecycle!.id, latest!.id, desired, committedAt)
      }
    } else {
      if (lifecycle && lifecycle.state !== 'active') throw conflict()
      if (command.kind === 'adopt' && latest!.status !== 'candidate') throw conflict()
      const manuscriptAuthority = authority?.kind === 'verified-manuscript' ? authority : undefined
      const materialAuthority = authority?.kind === 'verified-material-candidate' ? authority : undefined
      const modelAuthority = authority?.kind === 'verified-model-candidate' ? authority : undefined
      const sources: StorySourceEdge[] = command.kind === 'adopt' ? structuredClone(latest!.sources)
        : manuscriptAuthority ? manuscriptAuthority.manuscriptSources.map(({ id, revision }) => ({ relation: 'derived-from', source: { kind: 'manuscript' as const, id, revision } })) : []
      const content = command.kind === 'adopt' ? latest!.content : command.content
      if (modelAuthority) {
        const row = database.prepare(`SELECT artifacts.content,artifacts.content_hash,artifacts.status,artifacts.schema_valid,
          artifacts.artifact_type,runs.status AS task_status,runs.task_type
          FROM generation_artifacts artifacts JOIN task_runs runs ON runs.id=artifacts.task_run_id
          WHERE artifacts.id=? AND artifacts.task_run_id=? AND runs.project_id=?`).get(
          modelAuthority.artifactId, modelAuthority.taskId, projectId)
        if (!row || row.content_hash !== modelAuthority.artifactHash || row.status !== 'complete' || Number(row.schema_valid) !== 1
          || row.artifact_type !== EVENT_MODEL_CANDIDATE_ARTIFACT || row.task_status !== 'succeeded'
          || row.task_type !== EVENT_MODEL_CANDIDATE_TASK) throw conflict()
        const artifact = decodeEventModelCandidateArtifact(row.content)
        const candidate = artifact.candidates[modelAuthority.candidateIndex]
        if (!candidate || JSON.stringify(eventModelCandidateContent(candidate)) !== JSON.stringify(content)) throw conflict()
      }
      if (command.kind !== 'adopt') for (const evidence of content.evidenceRefs) {
        const source = database.prepare('SELECT content_hash FROM material_sources WHERE id=? AND project_id=?').get(evidence.sourceId, projectId)
        if (!source) throw conflict()
        if (materialAuthority && (content.evidenceRefs.length !== 1 || evidence.sourceId !== materialAuthority.sourceId
          || source.content_hash !== materialAuthority.sourceRevision)) throw conflict()
        if (!sources.some(edge => edge.source.kind === 'material' && edge.source.id === evidence.sourceId))
          sources.push({ relation: 'derived-from', source: { kind: 'material', id: evidence.sourceId, revision: String(source.content_hash) } })
      }
      if (latest) sources.push({ relation: 'supersedes', source: { kind: 'event', id: eventId, revision: latest.id } })
      const candidateAuthority = materialAuthority || modelAuthority
      const payload = storyEventVersionPayload({ content, status: candidateAuthority ? 'candidate' : 'approved',
        creator: modelAuthority ? 'model-candidate' : manuscriptAuthority ? 'manuscript-extraction' : 'author', sources,
        phase: command.kind === 'adopt' ? latest!.phase : manuscriptAuthority ? 'realized' : 'planned',
        granularity: command.kind === 'adopt' ? latest!.granularity : command.granularity })
      noOp = command.kind === 'edit' && latest!.status === 'approved'
        && latest!.granularity === payload.granularity && JSON.stringify(latest!.content) === JSON.stringify(payload.content)
      if (!noOp) {
        if (command.kind === 'create') owners.insertEvent({ ...payload.content, id: eventId, status: payload.status,
          createdAt: committedAt, ...(payload.status === 'approved' ? { approvedAt: committedAt } : {}) })
        const version = versions.append(eventId, latest?.id ?? null, payload, committedAt)
        versionId = version.id
        owners.updateEvent(eventId, version)
        if (command.kind === 'create') {
          lifecycleId = newId()
          database.prepare(`INSERT INTO event_lifecycle_versions
            (id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,1,NULL,?,'active',?)`)
            .run(lifecycleId, projectId, eventId, versionId, committedAt)
          appendOrder([...state.order.eventIds, eventId])
        }
        owners.prepareMirror()
      }
    }
  }
  database.prepare(`INSERT INTO event_operation_receipts
    (operation_id,project_id,kind,request_json,request_hash,event_id,version_id,lifecycle_id,order_id,no_op,committed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(review.operationId, projectId, command.kind, requestJson, review.requestHash,
      eventId, versionId, lifecycleId, orderId, noOp ? 1 : 0, committedAt)
  read.eventState()
  return readEventOperationReceipt(database, read.schemaVersion, projectId, review.operationId)!
}

function conflict(): AppError { return new AppError('CONFLICT', '事件、排序、来源或章节安排已变化，请重新核对后保存。', { recoverable: true }) }
