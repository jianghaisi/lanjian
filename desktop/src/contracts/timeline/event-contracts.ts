import { AppError } from '../core/app-error'

export type EventMirrorFeedbackDto =
  | { status: 'synced'; issue: 'none' }
  | { status: 'pending'; issue: 'none' | 'stale' | 'unavailable' }
  | { status: 'conflict'; issue: 'external-change' }
  | { status: 'failed'; issue: 'storage-error' }

export type EventContentDto = {
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
  evidenceRefs: Array<{ sourceId: string; excerpt: string }>
  confidence: number
  title?: string
  rawCharacters?: string
}

export type EventOperationInput = { expectedOrderId: string } & (
  | { kind: 'create'; content: EventContentDto; granularity: 'macro' | 'chapter-detail' }
  | { kind: 'edit'; eventId: string; expectedVersionId: string; expectedLifecycleId: string;
    content: EventContentDto; granularity: 'macro' | 'chapter-detail' | 'legacy-unknown' }
  | { kind: 'adopt' | 'archive' | 'restore'; eventId: string; expectedVersionId: string; expectedLifecycleId: string }
  | { kind: 'reorder'; eventIds: string[] }
)

export type EventMaterialCandidateInput = {
  expectedOrderId: string
  sourceId: string
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
}

export type EventModelCandidateGenerationInput = {
  operationId: string
  context: {
    title: string
    genre: string
    subgenre: string
    coreIdea: string
    plannedVolumes: number
    chaptersPerVolume: number
    targetWordsPerChapter: number
    materials: string
    worldView: string
    totalOutline: string
    existingEvents: string
  }
}

export type EventModelCandidatePreviewInput = {
  expectedOrderId: string
  taskId: string
  artifactId: string
  candidateIndex: number
}

export type EventModelCandidateBatchDto = {
  operationId: string
  taskId: string
  artifactId: string
  artifactHash: string
  model: string
  candidates: Array<{
    id: string
    candidateIndex: number
    title: string
    time: string
    characters: string
    location: string
    event: string
    result: string
  }>
}

export type EventOperationPreviewDto = {
  token: string
  operationId: string
  kind: EventOperationInput['kind']
  requestHash: string
  expiresAt: number
}

export type EventOperationReceiptDto = {
  operationId: string
  kind: EventOperationInput['kind']
  requestHash: string
  eventId: string | null
  versionId: string | null
  lifecycleId: string | null
  orderId: string
  noOp: boolean
  committedAt: string
}

import { decodeSettlementStatus } from './prose-event-settlement-contracts'

export type ProjectedEventDto = {
  settlement?: import('./prose-event-settlement-contracts').SettlementStatus
  eventId: string
  versionId: string
  version: number
  content: EventContentDto
  granularity: 'macro' | 'chapter-detail' | 'legacy-unknown'
  phase: 'planned' | 'realized' | 'deviated' | 'legacy-unknown'
  creator: 'author' | 'model-candidate' | 'manuscript-extraction' | 'legacy-unknown'
  sources: Array<{
    relation: 'derived-from' | 'refines' | 'realizes' | 'deviates-from' | 'supersedes'
    source: { kind: 'material' | 'total-outline' | 'volume-outline' | 'chapter-skeleton' | 'chapter-outline' | 'event' | 'manuscript'; id: string; revision: string }
  }>
  createdAt: string
}

export type EventLifecycleDto = {
  id: string
  eventId: string
  revision: number
  expectedEventVersionId: string
  state: 'active' | 'archived'
  createdAt: string
}

export type EventProjectionDto = {
  version: 1
  workItemId: string
  revision: string
  approvedRevision: string
  candidateRevision: string
  operationId: string
  committedAt: string
  ordering: 'author-display'
  state: {
    order: { id: string; revision: number; eventIds: string[]; contentHash: string; createdAt: string }
    lifecycles: EventLifecycleDto[]
  }
  approved: ProjectedEventDto[]
  candidates: ProjectedEventDto[]
  archived: Array<{ lifecycle: EventLifecycleDto; approved: ProjectedEventDto | null; candidate: ProjectedEventDto | null }>
  mirror: EventMirrorFeedbackDto | null
}

export type EventOperationCommitDto = { receipt: EventOperationReceiptDto; mirror: EventMirrorFeedbackDto }

export type EventSourceKindDto = 'sources' | 'events' | 'timeline' | 'planning'
export type EventMigrationPreviewDto = {
  previewId: string
  fingerprint: string
  expiresAt: number
  summary: {
    rowCount: number; referenceCount: number; groupCount: number; invalidRowCount: number; blockedRowCount: number
    blockingGroupCount: number; blockedReferenceCount: number; planningFindingCount: number; inspectedUnits: number
    planningBlockingCount: number; planningCoverage: 'ledger-and-chapter-identities'; authorReviewRequired: true
  }
  requiredMirrorAcknowledgements: EventSourceKindDto[]
}
export type EventMigrationPageInput = {
  previewId: string
  kind: 'rows' | 'groups' | 'group-members' | 'references' | 'planning-findings'
  offset: number
  groupId?: number
}
type EventMigrationPageBase<K extends EventMigrationPageInput['kind'], T> = {
  kind: K
  fingerprint: string
  offset: number
  total: number
  nextOffset: number | null
  items: T[]
}
export type EventMigrationRowDto = { index: number; ref: { source: 'sources' | 'events' | 'timeline'; contentHash: string; ordinal: number; originalId: string | null };
  recordCheck: 'valid' | 'invalid'; recordProblem: string | null; legacyStatus: 'source' | 'candidate' | 'approved' | 'direct-unconfirmed' | 'invalid';
  proposedCharacters: string[] | null; groupIds: number[]; defaultDisposition: 'retain-source' | 'keep-separate' | null }
export type EventMigrationGroupDto = { id: number; kind: 'repeated-source-id' | 'repeated-canonical-id' | 'repeated-direct-id'
  | 'source-hash-collision' | 'source-url-collision' | 'possible-duplicate' | 'possible-slot-conflict'; severity: 'blocking' | 'review'; memberCount: number }
export type EventMigrationReferenceDto = { index: number; owner: { source: 'events' | 'planning'; ordinal: number; path: string };
  targetKind: 'sources' | 'events'; originalId: string | null; result: 'resolved' | 'invalid-reference' | 'missing-target'
  | 'ambiguous-target' | 'invalid-target' | 'candidate-target'; targetRowIndex: number | null }
export type EventMigrationPlanningFindingDto = { path: string; code: 'invalid-collection' | 'invalid-reference-owner' | 'invalid-field'
  | 'duplicate-identity' | 'missing-assignment' | 'missing-volume' | 'missing-chapter-placement' | 'missing-chapter-dependency'
  | 'ambiguous-reference' | 'invalid-reference-target' | 'event-volume-mismatch' | 'chapter-inventory-unavailable' | 'missing-chapter'
  | 'archived-chapter' | 'ambiguous-chapter' | 'future-dependency-revision' | 'stale-dependency' | 'stale-confirmation'; severity: 'blocking' | 'review' }
export type EventMigrationPageDto = EventMigrationPageBase<'rows', EventMigrationRowDto>
  | EventMigrationPageBase<'groups', EventMigrationGroupDto>
  | EventMigrationPageBase<'group-members', number>
  | EventMigrationPageBase<'references', EventMigrationReferenceDto>
  | EventMigrationPageBase<'planning-findings', EventMigrationPlanningFindingDto>
export type EventMigrationReviewInput = {
  previewId: string
  fingerprint: string
  rows: Array<{ rowIndex: number; disposition: 'retain-source' | 'keep-separate' | 'link-existing'; targetRowIndex?: number }>
  acknowledgedGroups: number[]
  acknowledgedPlanningFindings: number[]
  acknowledgedMirrors: EventSourceKindDto[]
}
export type EventMigrationGrantDto = {
  token: string
  operationId: string
  decisionFingerprint: string
  fingerprint: string
  expiresAt: number
  displayOrderRowIndices: number[]
}
export type EventMigrationReceiptDto = {
  operationId: string
  projectId: string
  sourceFingerprint: string
  decisionFingerprint: string
  committedAt: string
  mappingCount: number
  sourceCounts: { sources: number; events: number; timeline: number }
}
export type EventMigrationCommitDto = { receipt: EventMigrationReceiptDto; mirror: EventMirrorFeedbackDto }
export type EventStateInitializationPreviewDto = {
  token: string
  migrationOperationId: string
  eventCount: number
  orderHash: string
  expiresAt: number
}
export type EventStateInitializationResultDto = Omit<EventStateInitializationPreviewDto, 'token' | 'expiresAt'>

export type DesktopEventsApi = import('./prose-event-settlement-contracts').SettlementApi & {
  projection(): Promise<EventProjectionDto>
  previewMigration(): Promise<EventMigrationPreviewDto>
  migrationPage(input: EventMigrationPageInput): Promise<EventMigrationPageDto>
  reviewMigration(input: EventMigrationReviewInput): Promise<EventMigrationGrantDto>
  commitMigration(token: string): Promise<EventMigrationCommitDto>
  previewStateInitialization(): Promise<EventStateInitializationPreviewDto>
  commitStateInitialization(token: string): Promise<EventStateInitializationResultDto>
  cancelMigration(previewId: string): Promise<boolean>
  migrationReceipt(operationId?: string): Promise<EventMigrationReceiptDto | null>
  retryMirror(operationId?: string): Promise<EventMirrorFeedbackDto>
  previewOperation(input: EventOperationInput): Promise<EventOperationPreviewDto>
  previewMaterialCandidate(input: EventMaterialCandidateInput): Promise<EventOperationPreviewDto>
  generateModelCandidates(input: EventModelCandidateGenerationInput): Promise<EventModelCandidateBatchDto>
  previewModelCandidate(input: EventModelCandidatePreviewInput): Promise<EventOperationPreviewDto>
  commitOperation(token: string): Promise<EventOperationCommitDto>
  cancelOperation(): Promise<boolean>
  operationReceipt(operationId: string): Promise<EventOperationReceiptDto | null>
}

const kinds = ['create', 'edit', 'adopt', 'archive', 'restore', 'reorder'] as const
const granularities = ['macro', 'chapter-detail', 'legacy-unknown'] as const
const phases = ['planned', 'realized', 'deviated', 'legacy-unknown'] as const
const creators = ['author', 'model-candidate', 'manuscript-extraction', 'legacy-unknown'] as const
const sourceKinds = ['material', 'total-outline', 'volume-outline', 'chapter-skeleton', 'chapter-outline', 'event', 'manuscript'] as const
const relations = ['derived-from', 'refines', 'realizes', 'deviates-from', 'supersedes'] as const
const eventSourceKinds = ['sources', 'events', 'timeline', 'planning'] as const
const pageKinds = ['rows', 'groups', 'group-members', 'references', 'planning-findings'] as const

export function decodeEventOperationInput(value: unknown): EventOperationInput {
  const input = object(value, ['kind', 'expectedOrderId'], ['eventId', 'expectedVersionId', 'expectedLifecycleId', 'content', 'granularity', 'eventIds'])
  const kind = oneOf(input.kind, kinds)
  const expectedOrderId = identifier(input.expectedOrderId)
  let result: EventOperationInput
  if (kind === 'reorder') {
    exact(input, ['kind', 'expectedOrderId', 'eventIds'])
    const eventIds = array(input.eventIds, identifier, 100_000)
    if (new Set(eventIds).size !== eventIds.length) invalid()
    result = { kind, expectedOrderId, eventIds }
  } else if (kind === 'create') {
    exact(input, ['kind', 'expectedOrderId', 'content', 'granularity'])
    const granularity = oneOf(input.granularity, ['macro', 'chapter-detail'] as const)
    result = { kind, expectedOrderId, content: eventContent(input.content), granularity }
  } else {
    const event = {
      eventId: identifier(input.eventId), expectedVersionId: identifier(input.expectedVersionId),
      expectedLifecycleId: identifier(input.expectedLifecycleId)
    }
    if (kind === 'edit') {
      exact(input, ['kind', 'expectedOrderId', 'eventId', 'expectedVersionId', 'expectedLifecycleId', 'content', 'granularity'])
      result = { kind, expectedOrderId, ...event, content: eventContent(input.content), granularity: oneOf(input.granularity, granularities) }
    } else {
      exact(input, ['kind', 'expectedOrderId', 'eventId', 'expectedVersionId', 'expectedLifecycleId'])
      result = { kind, expectedOrderId, ...event }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16_776_000) invalid()
  return result
}

export function decodeEventMaterialCandidateInput(value: unknown): EventMaterialCandidateInput {
  const input = object(value, ['expectedOrderId', 'sourceId', 'time', 'characters', 'location', 'event'], ['result'])
  exact(input, ['expectedOrderId', 'sourceId', 'time', 'characters', 'location', 'event',
    ...(Object.hasOwn(input, 'result') ? ['result'] : [])])
  const result: EventMaterialCandidateInput = {
    expectedOrderId: identifier(input.expectedOrderId),
    sourceId: identifier(input.sourceId),
    time: boundedText(input.time, 200, false),
    characters: array(input.characters, item => boundedText(item, 120, false), 50, 1),
    location: boundedText(input.location, 500, false),
    event: boundedText(input.event, 20_000, false)
  }
  if (Object.hasOwn(input, 'result')) result.result = boundedText(input.result, 10_000, true)
  return result
}

export function decodeEventModelCandidateGenerationInput(value: unknown): EventModelCandidateGenerationInput {
  const input = object(value, ['operationId', 'context'])
  const context = object(input.context, ['title', 'genre', 'subgenre', 'coreIdea', 'plannedVolumes', 'chaptersPerVolume',
    'targetWordsPerChapter', 'materials', 'worldView', 'totalOutline', 'existingEvents'])
  return {
    operationId: identifier(input.operationId),
    context: {
      title: boundedText(context.title, 500, true),
      genre: boundedText(context.genre, 200, true),
      subgenre: boundedText(context.subgenre, 200, true),
      coreIdea: boundedText(context.coreIdea, 6_000, true),
      plannedVolumes: boundedInteger(context.plannedVolumes, 0, 10_000),
      chaptersPerVolume: boundedInteger(context.chaptersPerVolume, 0, 100_000),
      targetWordsPerChapter: boundedInteger(context.targetWordsPerChapter, 0, 1_000_000),
      materials: boundedText(context.materials, 6_000, true),
      worldView: boundedText(context.worldView, 6_000, true),
      totalOutline: boundedText(context.totalOutline, 12_000, true),
      existingEvents: boundedText(context.existingEvents, 6_000, true)
    }
  }
}

export function decodeEventModelCandidatePreviewInput(value: unknown): EventModelCandidatePreviewInput {
  const input = object(value, ['expectedOrderId', 'taskId', 'artifactId', 'candidateIndex'])
  return { expectedOrderId: identifier(input.expectedOrderId), taskId: identifier(input.taskId), artifactId: identifier(input.artifactId),
    candidateIndex: boundedInteger(input.candidateIndex, 0, 29) }
}

export function decodeEventModelCandidateBatch(value: unknown): EventModelCandidateBatchDto {
  const input = object(value, ['operationId', 'taskId', 'artifactId', 'artifactHash', 'model', 'candidates'])
  const taskId = identifier(input.taskId), artifactId = identifier(input.artifactId)
  const candidates = array(input.candidates, value => {
    const item = object(value, ['id', 'candidateIndex', 'title', 'time', 'characters', 'location', 'event', 'result'])
    return { id: identifier(item.id), candidateIndex: boundedInteger(item.candidateIndex, 0, 29),
      title: boundedText(item.title, 200, false), time: boundedText(item.time, 200, false),
      characters: boundedText(item.characters, 20_000, false), location: boundedText(item.location, 500, false),
      event: boundedText(item.event, 20_000, false), result: boundedText(item.result, 10_000, true) }
  }, 30, 1)
  if (new Set(candidates.map(item => item.candidateIndex)).size !== candidates.length
    || candidates.some(item => item.id !== `${taskId}:${item.candidateIndex}`)) invalid()
  return { operationId: identifier(input.operationId), taskId, artifactId, artifactHash: hash(input.artifactHash),
    model: boundedText(input.model, 500, false), candidates }
}

export function decodeEventOperationGrant(value: unknown): string {
  const result = identifier(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/i.test(result)) invalid()
  return result
}

export function decodeEventMigrationPageInput(value: unknown): EventMigrationPageInput {
  const input = object(value, ['previewId', 'kind', 'offset'], ['groupId'])
  const kind = oneOf(input.kind, pageKinds), offset = boundedInteger(input.offset, 0, 100_000)
  if (kind === 'group-members') {
    exact(input, ['previewId', 'kind', 'offset', 'groupId'])
    return { previewId: decodeEventOperationGrant(input.previewId), kind, offset, groupId: boundedInteger(input.groupId, 0, 99_999) }
  }
  exact(input, ['previewId', 'kind', 'offset'])
  return { previewId: decodeEventOperationGrant(input.previewId), kind, offset }
}

export function decodeEventMigrationReviewInput(value: unknown): EventMigrationReviewInput {
  const input = object(value, ['previewId', 'fingerprint', 'rows', 'acknowledgedGroups', 'acknowledgedPlanningFindings', 'acknowledgedMirrors'])
  const rows = array(input.rows, value => {
    const row = object(value, ['rowIndex', 'disposition'], ['targetRowIndex'])
    const disposition = oneOf(row.disposition, ['retain-source', 'keep-separate', 'link-existing'] as const)
    if (disposition === 'link-existing') {
      exact(row, ['rowIndex', 'disposition', 'targetRowIndex'])
      return { rowIndex: boundedInteger(row.rowIndex, 0, 99_999), disposition, targetRowIndex: boundedInteger(row.targetRowIndex, 0, 99_999) }
    }
    exact(row, ['rowIndex', 'disposition'])
    return { rowIndex: boundedInteger(row.rowIndex, 0, 99_999), disposition }
  }, 100_000)
  const acknowledgedGroups = uniqueIntegers(input.acknowledgedGroups)
  const acknowledgedPlanningFindings = uniqueIntegers(input.acknowledgedPlanningFindings)
  const acknowledgedMirrors = array(input.acknowledgedMirrors, value => oneOf(value, eventSourceKinds), eventSourceKinds.length)
  if (new Set(rows.map(row => row.rowIndex)).size !== rows.length || new Set(acknowledgedMirrors).size !== acknowledgedMirrors.length) invalid()
  return { previewId: decodeEventOperationGrant(input.previewId), fingerprint: hash(input.fingerprint), rows,
    acknowledgedGroups, acknowledgedPlanningFindings, acknowledgedMirrors }
}

export function decodeEventProjection(value: unknown): EventProjectionDto {
  const result = object(value, ['version', 'workItemId', 'revision', 'approvedRevision', 'candidateRevision', 'operationId',
    'committedAt', 'ordering', 'state', 'approved', 'candidates', 'archived', 'mirror'])
  if (result.version !== 1 || result.ordering !== 'author-display') invalid()
  const stateValue = object(result.state, ['order', 'lifecycles'])
  const orderValue = object(stateValue.order, ['id', 'revision', 'eventIds', 'contentHash', 'createdAt'])
  const eventIds = array(orderValue.eventIds, identifier, 100_000)
  if (new Set(eventIds).size !== eventIds.length) invalid()
  const lifecycles = array(stateValue.lifecycles, lifecycle, 100_000)
  if (new Set(lifecycles.map(item => item.eventId)).size !== lifecycles.length
    || lifecycles.some(item => !eventIds.includes(item.eventId))) invalid()
  const approved = array(result.approved, projectedEvent, 100_000)
  const candidates = array(result.candidates, projectedEvent, 100_000)
  const archived = array(result.archived, archivedEvent, 100_000)
  return {
    version: 1,
    workItemId: boundedText(result.workItemId, 32_767, false),
    revision: hash(result.revision), approvedRevision: hash(result.approvedRevision), candidateRevision: hash(result.candidateRevision),
    operationId: decodeEventOperationGrant(result.operationId), committedAt: date(result.committedAt), ordering: 'author-display',
    state: { order: { id: identifier(orderValue.id), revision: positiveInteger(orderValue.revision), eventIds,
      contentHash: hash(orderValue.contentHash), createdAt: date(orderValue.createdAt) }, lifecycles },
    approved, candidates, archived, mirror: result.mirror === null ? null : mirror(result.mirror)
  }
}

export function decodeEventOperationPreview(value: unknown): EventOperationPreviewDto {
  const result = object(value, ['token', 'operationId', 'kind', 'requestHash', 'expiresAt'])
  return { token: decodeEventOperationGrant(result.token), operationId: decodeEventOperationGrant(result.operationId), kind: oneOf(result.kind, kinds),
    requestHash: hash(result.requestHash), expiresAt: nonnegativeInteger(result.expiresAt) }
}

export function decodeEventOperationReceipt(value: unknown): EventOperationReceiptDto {
  const result = object(value, ['operationId', 'kind', 'requestHash', 'eventId', 'versionId', 'lifecycleId', 'orderId', 'noOp', 'committedAt'])
  const kind = oneOf(result.kind, kinds)
  const nullableId = (input: unknown) => input === null ? null : identifier(input)
  const eventId = nullableId(result.eventId), versionId = nullableId(result.versionId), lifecycleId = nullableId(result.lifecycleId)
  if ((kind === 'reorder') !== (eventId === null && versionId === null && lifecycleId === null)) invalid()
  return { operationId: decodeEventOperationGrant(result.operationId), kind, requestHash: hash(result.requestHash), eventId, versionId,
    lifecycleId, orderId: identifier(result.orderId), noOp: boolean(result.noOp), committedAt: date(result.committedAt) }
}

export function decodeEventOperationCommit(value: unknown): EventOperationCommitDto {
  const result = object(value, ['receipt', 'mirror'])
  return { receipt: decodeEventOperationReceipt(result.receipt), mirror: mirror(result.mirror) }
}

export function decodeEventMigrationPreview(value: unknown): EventMigrationPreviewDto {
  const result = object(value, ['previewId', 'fingerprint', 'expiresAt', 'summary', 'requiredMirrorAcknowledgements'])
  const summary = object(result.summary, ['rowCount', 'referenceCount', 'groupCount', 'invalidRowCount', 'blockedRowCount',
    'blockingGroupCount', 'blockedReferenceCount', 'planningFindingCount', 'inspectedUnits', 'planningBlockingCount',
    'planningCoverage', 'authorReviewRequired'])
  const decodedSummary = {
    rowCount: boundedInteger(summary.rowCount, 0, 100_000),
    referenceCount: boundedInteger(summary.referenceCount, 0, 100_000),
    groupCount: boundedInteger(summary.groupCount, 0, 100_000),
    invalidRowCount: boundedInteger(summary.invalidRowCount, 0, 100_000),
    blockedRowCount: boundedInteger(summary.blockedRowCount, 0, 100_000),
    blockingGroupCount: boundedInteger(summary.blockingGroupCount, 0, 100_000),
    blockedReferenceCount: boundedInteger(summary.blockedReferenceCount, 0, 100_000),
    planningFindingCount: boundedInteger(summary.planningFindingCount, 0, 100_000),
    inspectedUnits: boundedInteger(summary.inspectedUnits, 0, 100_000),
    planningBlockingCount: boundedInteger(summary.planningBlockingCount, 0, 100_000),
    planningCoverage: literal(summary.planningCoverage, 'ledger-and-chapter-identities'),
    authorReviewRequired: literal(summary.authorReviewRequired, true)
  }
  if (decodedSummary.invalidRowCount > decodedSummary.rowCount || decodedSummary.blockedRowCount > decodedSummary.rowCount
    || decodedSummary.blockingGroupCount > decodedSummary.groupCount
    || decodedSummary.planningBlockingCount > decodedSummary.planningFindingCount) invalid()
  const acknowledgements = array(result.requiredMirrorAcknowledgements, value => oneOf(value, eventSourceKinds), eventSourceKinds.length)
  if (new Set(acknowledgements).size !== acknowledgements.length) invalid()
  return { previewId: decodeEventOperationGrant(result.previewId), fingerprint: hash(result.fingerprint),
    expiresAt: nonnegativeInteger(result.expiresAt), summary: decodedSummary, requiredMirrorAcknowledgements: acknowledgements }
}

export function decodeEventMigrationPage(value: unknown): EventMigrationPageDto {
  const result = object(value, ['kind', 'fingerprint', 'offset', 'total', 'nextOffset', 'items'])
  const kind = oneOf(result.kind, pageKinds), offset = boundedInteger(result.offset, 0, 100_000)
  const total = boundedInteger(result.total, 0, 100_000)
  if (offset > total) invalid()
  const items = array(result.items, migrationPageItem(kind), 100)
  const end = offset + items.length
  const nextOffset = result.nextOffset === null ? null : boundedInteger(result.nextOffset, 0, 100_000)
  if (end > total || (nextOffset === null ? end !== total : nextOffset !== end || nextOffset >= total)) invalid()
  return { kind, fingerprint: hash(result.fingerprint), offset, total, nextOffset, items } as EventMigrationPageDto
}

export function decodeEventMigrationGrant(value: unknown): EventMigrationGrantDto {
  const result = object(value, ['token', 'operationId', 'decisionFingerprint', 'fingerprint', 'expiresAt', 'displayOrderRowIndices'])
  const indices = uniqueIntegers(result.displayOrderRowIndices)
  return { token: decodeEventOperationGrant(result.token), operationId: decodeEventOperationGrant(result.operationId),
    decisionFingerprint: hash(result.decisionFingerprint), fingerprint: hash(result.fingerprint),
    expiresAt: nonnegativeInteger(result.expiresAt), displayOrderRowIndices: indices }
}

export function decodeEventMigrationReceipt(value: unknown): EventMigrationReceiptDto {
  const result = object(value, ['operationId', 'projectId', 'sourceFingerprint', 'decisionFingerprint', 'committedAt', 'mappingCount', 'sourceCounts'])
  const counts = object(result.sourceCounts, ['sources', 'events', 'timeline'])
  const sourceCounts = { sources: boundedInteger(counts.sources, 0, 100_000), events: boundedInteger(counts.events, 0, 100_000),
    timeline: boundedInteger(counts.timeline, 0, 100_000) }
  const mappingCount = boundedInteger(result.mappingCount, 0, 100_000)
  if (mappingCount > sourceCounts.sources + sourceCounts.events + sourceCounts.timeline) invalid()
  return { operationId: decodeEventOperationGrant(result.operationId), projectId: identifier(result.projectId),
    sourceFingerprint: hash(result.sourceFingerprint), decisionFingerprint: hash(result.decisionFingerprint),
    committedAt: date(result.committedAt), mappingCount, sourceCounts }
}

export function decodeEventMigrationCommit(value: unknown): EventMigrationCommitDto {
  const result = object(value, ['receipt', 'mirror'])
  return { receipt: decodeEventMigrationReceipt(result.receipt), mirror: mirror(result.mirror) }
}

export function decodeEventStateInitializationPreview(value: unknown): EventStateInitializationPreviewDto {
  const result = object(value, ['token', 'migrationOperationId', 'eventCount', 'orderHash', 'expiresAt'])
  return { token: decodeEventOperationGrant(result.token), migrationOperationId: decodeEventOperationGrant(result.migrationOperationId),
    eventCount: boundedInteger(result.eventCount, 0, 100_000), orderHash: hash(result.orderHash),
    expiresAt: nonnegativeInteger(result.expiresAt) }
}

export function decodeEventStateInitializationResult(value: unknown): EventStateInitializationResultDto {
  const result = object(value, ['migrationOperationId', 'eventCount', 'orderHash'])
  return { migrationOperationId: decodeEventOperationGrant(result.migrationOperationId),
    eventCount: boundedInteger(result.eventCount, 0, 100_000), orderHash: hash(result.orderHash) }
}

export const eventIpcValueDecoders: Readonly<Record<string, (value: unknown) => unknown>> = Object.freeze({
  'events:projection': decodeEventProjection,
  'events:migration-preview': decodeEventMigrationPreview,
  'events:migration-page': decodeEventMigrationPage,
  'events:migration-review': decodeEventMigrationGrant,
  'events:migration-commit': decodeEventMigrationCommit,
  'events:state-initialization-preview': decodeEventStateInitializationPreview,
  'events:state-initialization-commit': decodeEventStateInitializationResult,
  'events:migration-cancel': boolean,
  'events:migration-receipt': (value: unknown) => value === null ? null : decodeEventMigrationReceipt(value),
  'events:mirror-retry': mirror,
  'events:operation-preview': decodeEventOperationPreview,
  'events:material-candidate-preview': decodeEventOperationPreview,
  'events:model-candidates-generate': decodeEventModelCandidateBatch,
  'events:model-candidate-preview': decodeEventOperationPreview,
  'events:operation-commit': decodeEventOperationCommit,
  'events:operation-cancel': boolean,
  'events:operation-receipt': (value: unknown) => value === null ? null : decodeEventOperationReceipt(value)
})

function eventContent(value: unknown): EventContentDto {
  const result = object(value, ['time', 'characters', 'location', 'event', 'evidenceRefs', 'confidence'], ['title', 'rawCharacters', 'result'])
  const output: EventContentDto = {
    time: boundedText(result.time, 500, false),
    characters: array(result.characters, item => boundedText(item, 200, false), 100, 1),
    location: boundedText(result.location, 500, false), event: boundedText(result.event, 20_000, false),
    evidenceRefs: array(result.evidenceRefs, evidence => {
      const item = object(evidence, ['sourceId', 'excerpt'])
      return { sourceId: identifier(item.sourceId), excerpt: boundedText(item.excerpt, 2_000, false) }
    }, 100),
    confidence: finite(result.confidence, 0, 1)
  }
  if (Object.hasOwn(result, 'title')) output.title = boundedText(result.title, 200, true)
  if (Object.hasOwn(result, 'rawCharacters')) output.rawCharacters = boundedText(result.rawCharacters, 20_000, true)
  if (Object.hasOwn(result, 'result')) output.result = boundedText(result.result, 20_000, true)
  return output
}

function projectedEvent(value: unknown): ProjectedEventDto {
  const result = object(value, ['eventId', 'versionId', 'version', 'content', 'granularity', 'phase', 'creator', 'sources', 'createdAt'], ['settlement'])
  return { eventId: identifier(result.eventId), versionId: identifier(result.versionId), version: positiveInteger(result.version),
    content: eventContent(result.content), granularity: oneOf(result.granularity, granularities), phase: oneOf(result.phase, phases),
    creator: oneOf(result.creator, creators), sources: array(result.sources, sourceEdge, 200), createdAt: date(result.createdAt),
    ...(result.settlement===undefined?{}:{settlement:decodeSettlementStatus(result.settlement)}) }
}

function sourceEdge(value: unknown): ProjectedEventDto['sources'][number] {
  const result = object(value, ['relation', 'source'])
  const source = object(result.source, ['kind', 'id', 'revision'])
  const kind = oneOf(source.kind, sourceKinds), revision = identifier(source.revision)
  if (kind === 'material' && !/^[a-f0-9]{64}$/.test(revision)) invalid()
  return { relation: oneOf(result.relation, relations), source: { kind, id: identifier(source.id), revision } }
}

function lifecycle(value: unknown): EventLifecycleDto {
  const result = object(value, ['id', 'eventId', 'revision', 'expectedEventVersionId', 'state', 'createdAt'])
  return { id: identifier(result.id), eventId: identifier(result.eventId), revision: positiveInteger(result.revision),
    expectedEventVersionId: identifier(result.expectedEventVersionId), state: oneOf(result.state, ['active', 'archived'] as const),
    createdAt: date(result.createdAt) }
}

function archivedEvent(value: unknown): EventProjectionDto['archived'][number] {
  const result = object(value, ['lifecycle', 'approved', 'candidate'])
  const state = lifecycle(result.lifecycle)
  if (state.state !== 'archived') invalid()
  const approved = result.approved === null ? null : projectedEvent(result.approved)
  const candidate = result.candidate === null ? null : projectedEvent(result.candidate)
  if (approved && approved.eventId !== state.eventId || candidate && candidate.eventId !== state.eventId) invalid()
  return { lifecycle: state, approved, candidate }
}

function migrationPageItem(kind: EventMigrationPageInput['kind']): (value: unknown) => unknown {
  if (kind === 'group-members') return value => boundedInteger(value, 0, 99_999)
  if (kind === 'groups') return value => {
    const result = object(value, ['id', 'kind', 'severity', 'memberCount'])
    return { id: boundedInteger(result.id, 0, 99_999), kind: oneOf(result.kind, ['repeated-source-id', 'repeated-canonical-id',
      'repeated-direct-id', 'source-hash-collision', 'source-url-collision', 'possible-duplicate', 'possible-slot-conflict'] as const),
    severity: oneOf(result.severity, ['blocking', 'review'] as const), memberCount: boundedInteger(result.memberCount, 2, 100_000) }
  }
  if (kind === 'references') return value => {
    const result = object(value, ['index', 'owner', 'targetKind', 'originalId', 'result', 'targetRowIndex'])
    const owner = object(result.owner, ['source', 'ordinal', 'path'])
    return { index: boundedInteger(result.index, 0, 99_999), owner: { source: oneOf(owner.source, ['events', 'planning'] as const),
      ordinal: boundedInteger(owner.ordinal, 0, 99_999), path: boundedText(owner.path, 2_000, false) },
    targetKind: oneOf(result.targetKind, ['sources', 'events'] as const),
    originalId: result.originalId === null ? null : identifier(result.originalId),
    result: oneOf(result.result, ['resolved', 'invalid-reference', 'missing-target', 'ambiguous-target', 'invalid-target', 'candidate-target'] as const),
    targetRowIndex: result.targetRowIndex === null ? null : boundedInteger(result.targetRowIndex, 0, 99_999) }
  }
  if (kind === 'planning-findings') return value => {
    const result = object(value, ['path', 'code', 'severity'])
    return { path: boundedText(result.path, 2_000, false), code: oneOf(result.code, ['invalid-collection', 'invalid-reference-owner',
      'invalid-field', 'duplicate-identity', 'missing-assignment', 'missing-volume', 'missing-chapter-placement',
      'missing-chapter-dependency', 'ambiguous-reference', 'invalid-reference-target', 'event-volume-mismatch',
      'chapter-inventory-unavailable', 'missing-chapter', 'archived-chapter', 'ambiguous-chapter', 'future-dependency-revision',
      'stale-dependency', 'stale-confirmation'] as const), severity: oneOf(result.severity, ['blocking', 'review'] as const) }
  }
  return value => {
    const result = object(value, ['index', 'ref', 'recordCheck', 'recordProblem', 'legacyStatus', 'proposedCharacters', 'groupIds', 'defaultDisposition'])
    const ref = object(result.ref, ['source', 'contentHash', 'ordinal', 'originalId'])
    const groupIds = uniqueIntegers(result.groupIds)
    return { index: boundedInteger(result.index, 0, 99_999), ref: { source: oneOf(ref.source, ['sources', 'events', 'timeline'] as const),
      contentHash: hash(ref.contentHash), ordinal: boundedInteger(ref.ordinal, 0, 99_999),
      originalId: ref.originalId === null ? null : identifier(ref.originalId) },
    recordCheck: oneOf(result.recordCheck, ['valid', 'invalid'] as const),
    recordProblem: result.recordProblem === null ? null : boundedText(result.recordProblem, 10_000, false),
    legacyStatus: oneOf(result.legacyStatus, ['source', 'candidate', 'approved', 'direct-unconfirmed', 'invalid'] as const),
    proposedCharacters: result.proposedCharacters === null ? null : array(result.proposedCharacters, item => boundedText(item, 200, false), 100),
    groupIds, defaultDisposition: result.defaultDisposition === null ? null : oneOf(result.defaultDisposition, ['retain-source', 'keep-separate'] as const) }
  }
}

function mirror(value: unknown): EventMirrorFeedbackDto {
  const result = object(value, ['status', 'issue'])
  const status = oneOf(result.status, ['synced', 'pending', 'conflict', 'failed'] as const)
  const issue = boundedText(result.issue, 32, false)
  if (status === 'synced' && issue === 'none') return { status, issue }
  if (status === 'pending' && ['none', 'stale', 'unavailable'].includes(issue)) return { status, issue: issue as 'none' | 'stale' | 'unavailable' }
  if (status === 'conflict' && issue === 'external-change') return { status, issue }
  if (status === 'failed' && issue === 'storage-error') return { status, issue }
  return invalid()
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const result = value as Record<string, unknown>, allowed = new Set([...required, ...optional])
  if (Object.keys(result).some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(result, key))) invalid()
  return result
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid()
}

function array<T>(value: unknown, decode: (value: unknown) => T, maximum: number, minimum = 0): T[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid()
  return value.map(decode)
}

function boundedText(value: unknown, maximum: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000') || (!allowEmpty && !value.trim())) invalid()
  return value
}

function identifier(value: unknown): string {
  const result = boundedText(value, 200, false)
  if (result !== result.trim() || /[\u0000-\u001f\u007f]/.test(result)) invalid()
  return result
}

function hash(value: unknown): string {
  const result = identifier(value)
  if (!/^[a-f0-9]{64}$/.test(result)) invalid()
  return result
}

function date(value: unknown): string {
  const result = boundedText(value, 100, false)
  if (!Number.isFinite(Date.parse(result))) invalid()
  return result
}

function finite(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid()
  return value
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid()
  return value
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  const result = nonnegativeInteger(value)
  if (result < minimum || result > maximum) invalid()
  return result
}

function uniqueIntegers(value: unknown): number[] {
  const result = array(value, item => boundedInteger(item, 0, 99_999), 100_000)
  if (new Set(result).size !== result.length) invalid()
  return result
}

function positiveInteger(value: unknown): number {
  const result = nonnegativeInteger(value)
  if (result < 1) invalid()
  return result
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid()
  return value
}

function literal<const T extends string | number | boolean>(value: unknown, expected: T): T {
  if (value !== expected) invalid()
  return expected
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid()
  return value as T[number]
}

function invalid(): never {
  throw new AppError('VALIDATION_ERROR', '事件接口请求或结果格式无效。', { recoverable: true })
}
