import { AppError } from '../../../core/errors/app-error'
import { eventMigrationDecisionsInput, eventSourceJsonIsLossless, reviewEventMigrationDecisions,
  type EventMigrationDecisionPlan, type EventMigrationInspection } from './event-migration-decisions'
import { inspectEventMigrationSources, type EventMigrationReviewRow } from './event-migration-review'
import { EVENT_SOURCE_KINDS, type EventSourceKind, type EventSourceSnapshot } from './event-source-snapshot'
import { directEventMigrationPayload } from './legacy-event-payload'
import { assertStoryEventVersionPayload, storyEventVersionPayload, type StoryEventVersionPayload } from './story-event-version'
import type { WorkspaceMaterialSourceRecord } from '../../../core/ports/workspace-database'

export type EventMigrationPayloadRow = Readonly<{ rowIndex: number } & (
  { kind: 'material'; record: WorkspaceMaterialSourceRecord }
  | { kind: 'existing-version'; eventId: string; versionId: string }
  | { kind: 'baseline'; eventId: string; payload: StoryEventVersionPayload }
  | { kind: 'direct'; payload: StoryEventVersionPayload }
  | { kind: 'link'; targetRowIndex: number }
)>
export type EventMigrationPayloads = Readonly<{
  version: 1; sourceFingerprint: string; rows: readonly EventMigrationPayloadRow[]
}>

const materialFields = ['id', 'provider', 'sourceType', 'externalId', 'url', 'title', 'author', 'publishedAt',
  'capturedAt', 'updatedAt', 'excerpt', 'userNotes', 'references', 'contentHash']
const eventFields = ['id', 'time', 'characters', 'location', 'event', 'result', 'evidenceRefs', 'confidence', 'status',
  'conflictGroupId', 'createdAt', 'approvedAt', 'title', 'rawCharacters']
const directFields = ['id', 'title', 'time', 'characters', 'location', 'event', 'result', 'status', 'confidence']

/** Converts only a complete reviewed snapshot. No IDs, dates, source revisions,
 * database changes or author permission are invented here. Unknown row fields
 * remain in the original snapshot and block NEW conversion, never disappear.
 */
export function prepareEventMigrationPayloads(snapshot: EventSourceSnapshot, plan: EventMigrationDecisionPlan,
  retainedInspection?: EventMigrationInspection): EventMigrationPayloads {
  const inspection = retainedInspection ?? inspectEventMigrationSources(snapshot)
  const checked = reviewEventMigrationDecisions(snapshot, eventMigrationDecisionsInput(plan), inspection)
  if (JSON.stringify(plan) !== JSON.stringify(checked)) throw conflict()
  const histories = new Map(snapshot.eventHistory.map(history => [history.eventId, history]))
  const expected = snapshot.documents.events.authority === 'sqlite' ? snapshot.documents.events.occurrences : []
  if (histories.size !== snapshot.eventHistory.length || histories.size !== expected.length
    || expected.some(row => !histories.has(row.originalId!))) throw conflict()
  // Inspect envelopes even when parsing produced zero occurrences. Otherwise a
  // duplicate final `events: []` key could hide records before an empty commit.
  for (const source of EVENT_SOURCE_KINDS) {
    const document = snapshot.documents[source]
    if (document.content !== null && !eventSourceJsonIsLossless(document.content, document.value)) {
      blocked({ source, ordinal: null }, 'json-representation')
    }
  }
  let page = inspection.rowsPage(0)
  const rows = plan.rows.map((decision): EventMigrationPayloadRow => {
    if (decision.rowIndex >= page.offset + page.items.length) page = inspection.rowsPage(decision.rowIndex)
    const row = page.items[decision.rowIndex - page.offset]!
    const document = snapshot.documents[decision.ref.source]
    const value = document.occurrences[decision.ref.ordinal]!.value as Record<string, unknown>
    const rowIndex = row.index
    if (decision.ref.source === 'sources') {
      supported(value, materialFields, row)
      const source = value as WorkspaceMaterialSourceRecord
      source.references?.forEach(ref => supported(ref, ['title', 'url'], row))
      return freeze({ kind: 'material', rowIndex, record: { ...source,
        ...(source.references === undefined ? {} : { references: source.references.map(ref => ({ ...ref })) }) } })
    }
    if (decision.ref.source === 'timeline') {
      supported(value, directFields, row)
      // Validate a linked occurrence too: equality never makes an unsupported
      // authority extension safe to discard.
      const payload = directEventMigrationPayload(value, row.proposedCharacters!)
      return freeze(decision.disposition === 'link-existing'
        ? { kind: 'link', rowIndex, targetRowIndex: decision.targetRowIndex! }
        : { kind: 'direct', rowIndex, payload })
    }
    supported(value, eventFields, row)
    const evidence = value.evidenceRefs as Array<{ sourceId: string; excerpt: string }>
    evidence.forEach(ref => supported(ref, ['sourceId', 'excerpt'], row))
    const baselineInput = { content: value, status: value.status,
      phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources: [] }
    assertStoryEventVersionPayload(baselineInput)
    const baseline = storyEventVersionPayload(baselineInput)
    const history = histories.get(decision.ref.originalId!)
    if (!history?.versions.length) {
      if (history?.heads) throw conflict()
      return freeze({ kind: 'baseline', rowIndex, eventId: decision.ref.originalId!, payload: baseline })
    }
    const latest = history.versions.at(-1)!, approved = history.versions.filter(version => version.status === 'approved').at(-1)
    if (!history.heads || history.heads.latestVersionId !== latest.id || history.heads.approvedVersionId !== (approved?.id ?? null)
      || history.versions.some((version, index) => version.eventId !== history.eventId || version.projectId !== snapshot.database?.projectId
        || version.version !== index + 1 || version.previousVersionId !== (history.versions[index - 1]?.id ?? null))) throw conflict()
    const selected = approved ?? latest, content = storyEventVersionPayload(selected).content
    // Compatibility rows omit optional display fields, but may not disagree
    // with a field they DO retain. The immutable version keeps all metadata.
    const comparable = { ...content }
    if (!Object.hasOwn(value, 'title')) delete comparable.title
    if (!Object.hasOwn(value, 'rawCharacters')) delete comparable.rawCharacters
    if (selected.status !== baseline.status || JSON.stringify(comparable) !== JSON.stringify(baseline.content)) blocked(row.ref, 'history-mismatch')
    return freeze({ kind: 'existing-version', rowIndex, eventId: history.eventId, versionId: selected.id })
  })
  return Object.freeze({ version: 1, sourceFingerprint: snapshot.fingerprint, rows: Object.freeze(rows) })
}

function supported(value: object, keys: readonly string[], row: EventMigrationReviewRow): void {
  if (Object.keys(value).some(key => !keys.includes(key))) blocked(row.ref, 'unsupported-fields')
}
function blocked(ref: { source: EventSourceKind; ordinal: number | null }, reason: 'unsupported-fields' | 'json-representation' | 'history-mismatch'): never {
  throw new AppError('CONFLICT', '旧事件或资料含尚不能无损转换的字段、JSON 表示或版本差异，请核对原始记录；未确认迁移。', {
    recoverable: true, details: { area: 'eventMigrationPayload', source: ref.source, ordinal: ref.ordinal, reason }
  })
}
function conflict(): AppError { return new AppError('CONFLICT', '事件转换依据与已核对记录不一致，请重新预览。', { recoverable: true }) }
function freeze<T>(value: T): T {
  const pending: unknown[] = [value]
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue
    pending.push(...Object.values(item)); Object.freeze(item)
  }
  return value
}
