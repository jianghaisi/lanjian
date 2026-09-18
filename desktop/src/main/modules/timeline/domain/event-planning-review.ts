import { assertStoryIdentifier } from './story-event-version'
import type { WorkspaceEventChapterCatalog } from '../../../core/ports/workspace-database'

export type EventPlanningFinding = {
  path: string
  code: 'invalid-collection' | 'invalid-reference-owner' | 'invalid-field' | 'duplicate-identity'
    | 'missing-assignment' | 'missing-volume' | 'missing-chapter-placement' | 'missing-chapter-dependency'
    | 'ambiguous-reference' | 'invalid-reference-target' | 'event-volume-mismatch'
    | 'chapter-inventory-unavailable' | 'missing-chapter' | 'archived-chapter' | 'ambiguous-chapter'
    | 'future-dependency-revision' | 'stale-dependency' | 'stale-confirmation'
  severity: 'blocking' | 'review'
}
type Collection = typeof collections[number]
type Row = { value: Record<string, unknown>; path: string; ordinal: number; valid: boolean }
type Ref = { row: Row; path: string; id: string }
type Rule = (value: unknown) => boolean
const collections = ['assignments', 'volumes', 'chapterPlacements', 'manuscriptStarts', 'eventChapterPlacements',
  'chapters', 'chapterConfirmations', 'outlineReviewAcknowledgements', 'planningConfirmations'] as const
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const volume: Rule = value => integer(value, 1, 1_000)
const chapter: Rule = value => integer(value, 1, 1_000_000)
const hash: Rule = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const stamp: Rule = value => typeof value === 'string' && value.length <= 100 && !Number.isNaN(Date.parse(value)) && !value.includes('\u0000')
const optional = (rule: Rule): Rule => value => value === undefined || rule(value)
const identifier: Rule = value => { try { assertStoryIdentifier(value); return true } catch { return false } }
const scope: Rule = value => value === 'total' || volume(value)
const rules: Record<Collection, Record<string, Rule>> = {
  assignments: { eventId: identifier, assignedAt: stamp },
  volumes: { volume, title: value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 120 && !value.includes('\u0000'),
    revision: optional(integer), outlineHash: optional(hash), createdAt: stamp, updatedAt: stamp },
  chapterPlacements: { chapterId: chapter, volume, assignedAt: stamp, updatedAt: stamp },
  manuscriptStarts: { chapterId: chapter, revision: hash, volume: value => value === null || volume(value), completed: value => typeof value === 'boolean' },
  eventChapterPlacements: { eventId: identifier, chapterId: chapter, assignedAt: stamp, updatedAt: stamp },
  chapters: { chapterId: chapter, volume: optional(volume), basedOnTotalRevision: integer, basedOnVolumeRevision: optional(integer), outlineHash: hash, savedAt: stamp },
  chapterConfirmations: { chapterId: chapter, outlineHash: hash, basedOnTotalRevision: integer, basedOnVolumeRevision: optional(integer), confirmedAt: stamp },
  outlineReviewAcknowledgements: { scope, fingerprint: hash, acknowledgedAt: stamp },
  planningConfirmations: { scope, fingerprint: hash, confirmedAt: stamp }
}

/** Strict retained-ledger inspection, not the lossy compatibility normalizer.
 * Owns migration's raw planning fields and event-reference traversal together.
 * Historical dependencies are findings, never automatically reset or confirmed.
 */
export function inspectEventPlanningLedger(
  value: Record<string, unknown> | null,
  catalog: WorkspaceEventChapterCatalog,
  count: () => void,
  eventReference: (owner: { source: 'planning'; ordinal: number; path: string }, id: unknown) => void
): EventPlanningFinding[] {
  const findings: EventPlanningFinding[] = []
  const add = (path: string, code: EventPlanningFinding['code'], severity: EventPlanningFinding['severity'] = 'blocking') => {
    count(); findings.push({ path, code, severity })
  }
  if (value === null) return findings
  count()
  const total = record(value.total)
  if (value.version !== 1) add('version', 'invalid-field')
  if (!total) add('total', 'invalid-field')
  else {
    if (!integer(total.revision)) add('total.revision', 'invalid-field')
    if (!hash(total.hash) && !(total.revision === 0 && total.hash === '')) add('total.hash', 'invalid-field')
    if (!optional(stamp)(total.updatedAt)) add('total.updatedAt', 'invalid-field')
  }
  const rows = {} as Record<Collection, Row[]>
  const eventLists = new Map<Row, Ref[]>()
  for (const collection of collections) {
    rows[collection] = []
    const items = value[collection]
    if (items === undefined && collection !== 'assignments' && collection !== 'chapters') continue
    if (!Array.isArray(items)) { add(collection, 'invalid-collection'); continue }
    for (let ordinal = 0; ordinal < items.length; ordinal++) {
      count()
      const path = `${collection}[${ordinal}]`
      const item = record(items[ordinal])
      if (!item) { add(path, 'invalid-reference-owner'); continue }
      const row: Row = { value: item, path, ordinal, valid: true }
      rows[collection].push(row)
      const invalid = (field: string, code: EventPlanningFinding['code'] = 'invalid-field') => { row.valid = false; add(`${path}.${field}`, code) }
      for (const [field, rule] of Object.entries(rules[collection])) if (!rule(item[field])) invalid(field)
      if (collection === 'assignments' || collection === 'eventChapterPlacements') {
        eventReference({ source: 'planning', ordinal, path: `${path}.eventId` }, item.eventId)
      }
      if (collection === 'volumes' || collection === 'chapterConfirmations') {
        const refs: Ref[] = []; eventLists.set(row, refs)
        if (!Array.isArray(item.eventIds)) invalid('eventIds', 'invalid-collection')
        else for (let index = 0; index < item.eventIds.length; index++) {
          const id = item.eventIds[index]; const refPath = `${path}.eventIds[${index}]`
          eventReference({ source: 'planning', ordinal, path: refPath }, id)
          if (identifier(id)) refs.push({ row, path: refPath, id: id as string })
          else invalid(`eventIds[${index}]`)
        }
      }
      if (collection === 'outlineReviewAcknowledgements') {
        if (!Array.isArray(item.issueCodes) || !item.issueCodes.length) invalid('issueCodes', 'invalid-collection')
        else {
          const seen = new Set<string>()
          for (let index = 0; index < item.issueCodes.length; index++) {
            count(); const code = item.issueCodes[index]
            if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || seen.has(code)) invalid(`issueCodes[${index}]`)
            else seen.add(code)
          }
        }
      }
      if (collection === 'planningConfirmations' && (item.scope === 'total' ? item.basedOnTotalFingerprint !== undefined : !hash(item.basedOnTotalFingerprint))) invalid('basedOnTotalFingerprint')
    }
  }

  // Index ALL well-formed keys, even on invalid rows: never pick a valid first
  // row to hide a same-key invalid occurrence. No pairwise duplicate expansion.
  function index(collection: Collection, field: string, validKey: Rule) {
    const result = new Map<unknown, Row[]>()
    for (const row of rows[collection]) if (validKey(row.value[field])) append(result, row.value[field], row)
    for (const matches of result.values()) if (matches.length > 1) for (const row of matches) add(`${row.path}.${field}`, 'duplicate-identity')
    return result
  }
  const assignments = index('assignments', 'eventId', identifier)
  const volumes = index('volumes', 'volume', volume)
  const placements = index('chapterPlacements', 'chapterId', chapter)
  const dependencies = index('chapters', 'chapterId', chapter)
  index('manuscriptStarts', 'chapterId', chapter)
  index('eventChapterPlacements', 'eventId', identifier)
  index('chapterConfirmations', 'chapterId', chapter)
  index('outlineReviewAcknowledgements', 'scope', scope)
  const confirmations = index('planningConfirmations', 'scope', scope)
  function target(index: Map<unknown, Row[]>, key: unknown, path: string, missing: EventPlanningFinding['code']): Row | null {
    const matches = index.get(key)
    if (!matches?.length) { add(path, missing); return null }
    if (matches.length > 1) { add(path, 'ambiguous-reference'); return null }
    if (!matches[0]!.valid) { add(path, 'invalid-reference-target'); return null }
    return matches[0]!
  }
  const eventVolumes = new Map<unknown, Row[]>()
  for (const row of rows.volumes) for (const ref of eventLists.get(row) ?? []) {
    target(assignments, ref.id, ref.path, 'missing-assignment')
    append(eventVolumes, ref.id, row)
  }
  for (const matches of eventVolumes.values()) if (matches.length > 1) for (const row of matches) add(`${row.path}.eventIds`, 'duplicate-identity')
  for (const row of rows.chapterConfirmations) {
    const seen = new Set<string>()
    for (const ref of eventLists.get(row) ?? []) {
      if (seen.has(ref.id)) add(ref.path, 'duplicate-identity')
      seen.add(ref.id)
    }
  }
  for (const row of rows.chapterPlacements) if (volume(row.value.volume)) target(volumes, row.value.volume, `${row.path}.volume`, 'missing-volume')
  for (const row of rows.eventChapterPlacements) {
    if (identifier(row.value.eventId)) {
      target(assignments, row.value.eventId, `${row.path}.eventId`, 'missing-assignment')
      const eventVolume = target(eventVolumes, row.value.eventId, `${row.path}.eventId`, 'missing-volume')
      const chapterPlacement = chapter(row.value.chapterId) ? target(placements, row.value.chapterId, `${row.path}.chapterId`, 'missing-chapter-placement') : null
      if (eventVolume && chapterPlacement && eventVolume.value.volume !== chapterPlacement.value.volume) add(row.path, 'event-volume-mismatch')
    }
  }

  const chapterIndex = new Map<number, WorkspaceEventChapterCatalog['entries']>()
  for (const entry of catalog.entries) { count(); append(chapterIndex, entry.chapterId, entry) }
  function chapterTarget(row: Row, required: 'either' | 'outline' | 'manuscript') {
    if (!chapter(row.value.chapterId)) return
    const path = `${row.path}.chapterId`
    const entries = chapterIndex.get(row.value.chapterId as number) ?? []
    if (new Set(entries.map(entry => entry.kind)).size !== entries.length) { add(path, 'ambiguous-chapter'); return }
    // Archived prose must not be revived by a still-active chapter outline.
    if (entries.some(entry => entry.status === 'archived')) { add(path, 'archived-chapter'); return }
    if (entries.some(entry => entry.status === 'active' && (required === 'either' || entry.kind === required))) return
    const available = required === 'either' ? catalog.manuscripts === 'sqlite' && catalog.outlines === 'sqlite'
      : required === 'outline' ? catalog.outlines === 'sqlite' : catalog.manuscripts === 'sqlite'
    add(path, available ? 'missing-chapter' : 'chapter-inventory-unavailable')
  }
  for (const row of rows.chapterPlacements) chapterTarget(row, 'either')
  for (const row of rows.eventChapterPlacements) chapterTarget(row, 'either')
  for (const row of rows.chapters) chapterTarget(row, 'outline')
  for (const row of rows.chapterConfirmations) chapterTarget(row, 'outline')
  for (const row of rows.manuscriptStarts) chapterTarget(row, row.value.completed === true ? 'manuscript' : 'outline')

  function dependencyRevision(row: Row, revision: unknown, current: unknown, field: string) {
    if (!integer(revision) || !integer(current)) return
    if (revision > current) add(`${row.path}.${field}`, 'future-dependency-revision')
    else if (revision < current) add(`${row.path}.${field}`, 'stale-dependency', 'review')
  }
  for (const row of rows.chapters) {
    dependencyRevision(row, row.value.basedOnTotalRevision, total?.revision, 'basedOnTotalRevision')
    if (row.value.volume !== undefined && volume(row.value.volume)) {
      const savedVolume = target(volumes, row.value.volume, `${row.path}.volume`, 'missing-volume')
      if (savedVolume) dependencyRevision(row, row.value.basedOnVolumeRevision, savedVolume.value.revision ?? 0, 'basedOnVolumeRevision')
      const currentPlacement = placements.get(row.value.chapterId)
      if (currentPlacement?.length === 1 && currentPlacement[0]!.value.volume !== row.value.volume) add(`${row.path}.volume`, 'stale-dependency', 'review')
    }
  }
  for (const row of rows.chapterConfirmations) if (chapter(row.value.chapterId)) {
    const dependency = target(dependencies, row.value.chapterId, `${row.path}.chapterId`, 'missing-chapter-dependency')
    if (dependency && ['outlineHash', 'basedOnTotalRevision', 'basedOnVolumeRevision'].some(field => row.value[field] !== dependency.value[field])) add(row.path, 'stale-confirmation', 'review')
  }
  for (const collection of ['planningConfirmations', 'outlineReviewAcknowledgements'] as const) for (const row of rows[collection]) {
    if (volume(row.value.scope)) target(volumes, row.value.scope, `${row.path}.scope`, 'missing-volume')
    if (collection === 'planningConfirmations' && row.value.scope !== 'total') {
      const totalConfirmation = confirmations.get('total')
      if (!totalConfirmation || totalConfirmation.length !== 1 || totalConfirmation[0]!.value.fingerprint !== row.value.basedOnTotalFingerprint) add(row.path, 'stale-confirmation', 'review')
    }
  }
  return findings
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function append<K, T>(index: Map<K, T[]>, key: K, value: T) { const values = index.get(key); if (values) values.push(value); else index.set(key, [value]) }
