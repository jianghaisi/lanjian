import { AppError } from '../../../core/errors/app-error'
import { inspectEventPlanningLedger, type EventPlanningFinding } from './event-planning-review'
import { EVENT_SNAPSHOT_MAX_ROWS, type EventSourceSnapshot, type EventSourceOccurrence } from './event-source-snapshot'
import { assertCanonicalEvents, assertMaterialSources, normalizedMaterialUrl } from '../../worldbuilding/domain/legacy-research-validation'
import { directEventMigrationPayload } from './legacy-event-payload'
import { storyEventSignature } from './story-event'
import { assertStoryEventDisplayMetadata, assertStoryEventVersionPayload, assertStoryIdentifier } from './story-event-version'
import type { WorkspaceCanonicalEventRecord, WorkspaceMaterialSourceRecord } from '../../../core/ports/workspace-database'

export const EVENT_REVIEW_PAGE_SIZE = 100
type RowSource = 'sources' | 'events' | 'timeline'
export type EventReviewOccurrenceRef = {
  source: RowSource
  contentHash: string
  ordinal: number
  originalId: string | null
}
export type EventMigrationReviewRow = {
  index: number
  ref: EventReviewOccurrenceRef
  recordCheck: 'valid' | 'invalid'
  recordProblem: string | null
  legacyStatus: 'source' | 'candidate' | 'approved' | 'direct-unconfirmed' | 'invalid'
  proposedCharacters: string[] | null
  groupIds: number[]
  /** A proposal, not an author decision, alias or destination identity. */
  defaultDisposition: 'retain-source' | 'keep-separate' | null
}
export type EventMigrationReviewGroup = {
  id: number
  kind: 'repeated-source-id' | 'repeated-canonical-id' | 'repeated-direct-id'
    | 'source-hash-collision' | 'source-url-collision' | 'possible-duplicate' | 'possible-slot-conflict'
  severity: 'blocking' | 'review'
  memberCount: number
}
export type EventMigrationReferenceReview = {
  index: number
  owner: { source: 'events' | 'planning'; ordinal: number; path: string }
  targetKind: 'sources' | 'events'
  originalId: string | null
  result: 'resolved' | 'invalid-reference' | 'missing-target' | 'ambiguous-target' | 'invalid-target' | 'candidate-target'
  targetRowIndex: number | null
}
export type EventMigrationPlanningFinding = EventPlanningFinding
export type EventMigrationReviewPage<T> = { fingerprint: string; offset: number; total: number; nextOffset: number | null; items: readonly T[] }

/** Main-process inspection only. Pages are NOT IPC DTOs or migration authorization.
 * Takes one trusted retained snapshot; never rereads files, normalizes stored data,
 * allocates destination IDs, selects links, or claims complete planning validation.
 */
export function inspectEventMigrationSources(snapshot: EventSourceSnapshot) {
  const rows: EventMigrationReviewRow[] = []
  const groups: EventMigrationReviewGroup[] = []
  const groupMembers: number[][] = []
  const references: EventMigrationReferenceReview[] = []
  const planningFindings: EventMigrationPlanningFinding[] = []
  const identities: Record<RowSource, Map<string, number[]>> = { sources: new Map(), events: new Map(), timeline: new Map() }
  const hashes = new Map<string, number[]>()
  const urls = new Map<string, number[]>()
  const signatures = new Map<string, number[]>()
  const slots = new Map<string, number[]>()
  const rowSignatures = new Map<number, string>()
  let inspected = 0
  const count = () => { if (++inspected > EVENT_SNAPSHOT_MAX_ROWS) throw reviewLimit() }

  for (const source of ['sources', 'events', 'timeline'] as const) {
    const document = snapshot.documents[source]
    for (const [ordinal, occurrence] of document.occurrences.entries()) {
      count()
      // These are invariants of the retained acquisition, not renderer validation.
      if (occurrence.ordinal !== ordinal) {
        throw new AppError('INVALID_PROJECT_STATE', '事件核对来源顺序无效。', { recoverable: true })
      }
      const row = inspectRow(source, document.contentHash, occurrence, rows.length)
      rows.push(row)
      if (typeof occurrence.originalId === 'string' && occurrence.originalId.length <= 200) {
        addMember(identities[source], occurrence.originalId, row.index)
      }
      if (row.recordCheck === 'invalid') continue
      if (source === 'sources') {
        const value = occurrence.value as WorkspaceMaterialSourceRecord
        addMember(hashes, value.contentHash, row.index)
        const url = normalizedMaterialUrl(value.url)
        if (url !== null) addMember(urls, url, row.index)
      } else {
        const value = occurrence.value as { time: string; location: string; event: string }
        const identity = { time: value.time, location: value.location, event: value.event, characters: row.proposedCharacters! }
        const signature = storyEventSignature(identity)
        rowSignatures.set(row.index, signature)
        addMember(signatures, signature, row.index)
        addMember(slots, storyEventSignature({ ...identity, event: '' }), row.index)
      }
    }
  }

  function addGroups(index: Map<string, number[]>, kind: EventMigrationReviewGroup['kind'], severity: 'blocking' | 'review') {
    for (const members of index.values()) {
      if (members.length < 2) continue
      if (kind === 'possible-slot-conflict' && members.every(member => rowSignatures.get(member) === rowSignatures.get(members[0]!))) continue
      const id = groups.length
      groups.push({ id, kind, severity, memberCount: members.length })
      groupMembers.push(members)
      for (const member of members) rows[member]!.groupIds.push(id)
    }
  }
  addGroups(identities.sources, 'repeated-source-id', 'blocking')
  addGroups(identities.events, 'repeated-canonical-id', 'blocking')
  addGroups(identities.timeline, 'repeated-direct-id', 'review')
  addGroups(hashes, 'source-hash-collision', 'blocking')
  addGroups(urls, 'source-url-collision', 'blocking')
  addGroups(signatures, 'possible-duplicate', 'review')
  addGroups(slots, 'possible-slot-conflict', 'review')

  const unresolvedEvidenceOwners = new Set<number>()
  const rowBlocked = (row: EventMigrationReviewRow) => row.recordCheck === 'invalid' || unresolvedEvidenceOwners.has(row.index)
    || row.groupIds.some(id => groups[id]!.severity === 'blocking')
  function inspectReference(owner: EventMigrationReferenceReview['owner'], targetKind: 'sources' | 'events', id: unknown) {
    count()
    const reference: EventMigrationReferenceReview = { index: references.length, owner, targetKind,
      originalId: typeof id === 'string' ? id : null, result: 'invalid-reference', targetRowIndex: null }
    references.push(reference)
    try { assertStoryIdentifier(id) } catch (error) { if (validationError(error)) return reference; throw error }
    const matches = identities[targetKind].get(id)
    if (!matches?.length) reference.result = 'missing-target'
    else if (matches.length !== 1) reference.result = 'ambiguous-target'
    else {
      const target = rows[matches[0]!]!
      reference.targetRowIndex = target.index
      reference.result = rowBlocked(target) ? 'invalid-target'
        : targetKind === 'events' && target.legacyStatus !== 'approved' ? 'candidate-target' : 'resolved'
    }
    return reference
  }
  for (const row of rows) {
    if (row.ref.source !== 'events' || row.recordCheck !== 'valid') continue
    const event = snapshot.documents.events.occurrences[row.ref.ordinal]!.value as WorkspaceCanonicalEventRecord
    event.evidenceRefs.forEach((reference, ordinal) => {
      const result = inspectReference({ source: 'events', ordinal: row.ref.ordinal,
        path: `events[${row.ref.ordinal}].evidenceRefs[${ordinal}].sourceId` }, 'sources', reference.sourceId)
      if (result.result !== 'resolved') unresolvedEvidenceOwners.add(row.index)
    })
  }

  // One owner checks raw ledger fields, placements and chapter identity, while
  // this owner still resolves canonical event/evidence authority in the same snapshot.
  for (const finding of inspectEventPlanningLedger(snapshot.documents.planning.value, snapshot.chapterCatalog, count,
    (owner, id) => { inspectReference(owner, 'events', id) })) planningFindings.push(finding)

  // Freeze only owned bounded review structures; the original already-frozen
  // source buffers and arbitrary unknown metadata are neither copied nor walked.
  for (const row of rows) { Object.freeze(row.ref); Object.freeze(row.groupIds); if (row.proposedCharacters) Object.freeze(row.proposedCharacters); Object.freeze(row) }
  for (const reference of references) { Object.freeze(reference.owner); Object.freeze(reference) }
  groups.forEach(Object.freeze); groupMembers.forEach(Object.freeze); planningFindings.forEach(Object.freeze)
  const summary = Object.freeze({ rowCount: rows.length, referenceCount: references.length, groupCount: groups.length,
    invalidRowCount: rows.filter(row => row.recordCheck === 'invalid').length,
    blockedRowCount: rows.filter(rowBlocked).length,
    blockingGroupCount: groups.filter(group => group.severity === 'blocking').length,
    blockedReferenceCount: references.filter(reference => reference.result !== 'resolved').length,
    planningFindingCount: planningFindings.length, inspectedUnits: inspected,
    planningBlockingCount: planningFindings.filter(finding => finding.severity === 'blocking').length,
    planningCoverage: 'ledger-and-chapter-identities' as const, authorReviewRequired: true as const })
  return Object.freeze({ fingerprint: snapshot.fingerprint, summary,
    rowsPage: (offset = 0) => page(rows, offset, snapshot.fingerprint),
    groupsPage: (offset = 0) => page(groups, offset, snapshot.fingerprint),
    groupMembersPage: (groupId: number, offset = 0) => {
      if (!Number.isSafeInteger(groupId) || groupId < 0 || groupId >= groups.length) throw invalidPage()
      return page(groupMembers[groupId]!, offset, snapshot.fingerprint)
    },
    referencesPage: (offset = 0) => page(references, offset, snapshot.fingerprint),
    planningFindingsPage: (offset = 0) => page(planningFindings, offset, snapshot.fingerprint)
  })
}

function inspectRow(source: RowSource, contentHash: string | null, occurrence: EventSourceOccurrence, index: number): EventMigrationReviewRow {
  if (!contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new AppError('INVALID_PROJECT_STATE', '事件核对来源指纹缺失或无效。', { recoverable: true })
  }
  const row: EventMigrationReviewRow = { index, ref: { source, contentHash, ordinal: occurrence.ordinal, originalId: occurrence.originalId },
    recordCheck: 'invalid', recordProblem: null, legacyStatus: 'invalid', proposedCharacters: null, groupIds: [], defaultDisposition: null }
  try {
    const value = occurrence.value
    if (source === 'sources') {
      const values = [value]
      assertMaterialSources(values)
      assertStoryIdentifier(values[0]!.id)
      row.legacyStatus = 'source'
      row.defaultDisposition = 'retain-source'
    } else if (source === 'events') {
      const values = [value]
      assertCanonicalEvents(values)
      const event = values[0]!
      assertStoryIdentifier(event.id)
      assertStoryEventVersionPayload({ content: event, status: event.status, granularity: 'legacy-unknown', phase: 'legacy-unknown', creator: 'legacy-unknown', sources: [] })
      row.legacyStatus = event.status
      row.proposedCharacters = [...event.characters]
      row.defaultDisposition = 'keep-separate'
    } else {
      if (!isRecord(value)) throw invalidDirect()
      assertStoryIdentifier(value.id)
      if (typeof value.characters !== 'string') throw invalidDirect()
      const display = { ...(value.title !== undefined ? { title: value.title } : {}), rawCharacters: value.characters }
      assertStoryEventDisplayMetadata(display)
      // Visible delimiters only; Chinese conjunctions remain part of a name.
      const characters = value.characters.split(/[、,，;；/|\r\n]+/).map(name => name.trim()).filter(Boolean)
      const payload = directEventMigrationPayload(value, characters)
      row.legacyStatus = Object.hasOwn(value, 'status') ? payload.status : 'direct-unconfirmed'
      row.proposedCharacters = characters
      row.defaultDisposition = 'keep-separate'
    }
    row.recordCheck = 'valid'
  } catch (error) {
    if (!validationError(error)) throw error
    row.recordProblem = error.message
  }
  return row
}

function addMember(index: Map<string, number[]>, key: string, member: number) {
  const members = index.get(key)
  if (members) members.push(member)
  else index.set(key, [member])
}
function page<T>(items: readonly T[], offset: number, fingerprint: string): EventMigrationReviewPage<T> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw invalidPage()
  const end = Math.min(items.length, offset + EVENT_REVIEW_PAGE_SIZE)
  return Object.freeze({ fingerprint, offset, total: items.length, nextOffset: end < items.length ? end : null,
    items: Object.freeze(items.slice(offset, end)) })
}
function validationError(error: unknown): error is AppError { return error instanceof AppError && error.code === 'VALIDATION_ERROR' }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function invalidDirect() { return new AppError('VALIDATION_ERROR', '旧纪事记录的结构、标题或人物文本无效；未裁剪原文。', { recoverable: true }) }
function invalidPage() { return new AppError('VALIDATION_ERROR', '事件核对分页位置无效。', { recoverable: true }) }
function reviewLimit() { return new AppError('VALIDATION_ERROR', '事件核对超过 100,000 项记录与引用检查；未截断或迁移任何记录。', { recoverable: true, details: { area: 'eventMigrationReview' } }) }
