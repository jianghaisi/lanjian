import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { assertStoryEventVersionPayload, type StoryEventContent } from '../../timeline/domain/story-event-version'
import { planningHash } from './planning-dependencies'
import { MAX_CHAPTER_ADOPTION_EVENTS, decodeChapterEventRefinementSource } from '../../../../contracts/planning/chapter-event-contracts'
import type { ChapterEventRefinementSource } from '../../../../contracts/planning/types'

export type ChapterEventInput = StoryEventContent & { refines?: ChapterEventRefinementSource; replaces?: ChapterEventRefinementSource }
export type ChapterEventItem = { eventId: string; eventVersionId: string; lifecycleId: string; event: StoryEventContent; refines?: ChapterEventRefinementSource; replaces?: ChapterEventRefinementSource; expectedLifecycleId?: string }
export type ChapterEventIdentity = { eventId: string; eventVersionId: string }
export type ChapterEventOutputItem = ChapterEventIdentity & { replacesVersionId?: string }

/** Main-private command retained by the manuscript journal, never renderer authority. */
export type ChapterEventAdoption = {
  operationId: string
  chapterId: number
  volume: number
  title: string
  content: string
  expectedOutlineRevision: string | null
  parents: Array<{ key: string; revision: string }>
  expectedPlanningHash: string
  planningContent: string
  expectedOrderId: string
  eventHeads: Array<{ id: string; revision: string }>
  eventId: string
  eventVersionId: string
  lifecycleId: string
  orderId: string
  event: StoryEventContent
  refines?: ChapterEventRefinementSource
  replaces?: ChapterEventRefinementSource
  expectedLifecycleId?: string
  additionalEvents?: ChapterEventItem[]
  timestamp: string
}

export type ChapterEventOutput = {
  operationId: string
  chapterId: number
  eventId: string
  eventVersionId: string
  requestHash: string
  replacesVersionId?: string
  additionalEvents?: ChapterEventOutputItem[]
}

export function chapterEventItems(input: ChapterEventAdoption): ChapterEventItem[] {
  return [input, ...(input.additionalEvents ?? [])]
}

export function chapterEventOutputItems(output: ChapterEventOutput): ChapterEventOutputItem[] {
  return [output, ...(output.additionalEvents ?? [])].map(e => ({ eventId: e.eventId, eventVersionId: e.eventVersionId,
    ...(e.replacesVersionId ? { replacesVersionId: e.replacesVersionId } : {}) }))
}

export type ChapterEventStorageSnapshot = {
  planning: { content: string; contentHash: string }
  chapter: { revision: string; title: string; parent: string | null } | null
  parents: Array<{ key: string; revision: string }>
  orderId: string
  eventHeads: Array<{ id: string; revision: string }>
  eventStates?: Array<{ eventId: string; latestVersionId: string; lifecycleId: string }>
}

export function chapterEventRequestHash(input: ChapterEventAdoption): string {
  return planningHash(input)
}

export function assertChapterEventOutputs(value: unknown): asserts value is ChapterEventOutput[] {
  if (!Array.isArray(value) || value.length > 100_000) invalid()
  const operations = new Set<string>(), events = new Map<string, number>(), versions = new Set<string>()
  for (const item of value as ChapterEventOutput[]) {
    if (!item || !uuid(item.operationId) || !uuid(item.eventId) || !uuid(item.eventVersionId)
      || !positive(item.chapterId, 1_000_000) || !digest(item.requestHash)
      || operations.has(item.operationId)) invalid()
    if (item.additionalEvents !== undefined && (!Array.isArray(item.additionalEvents) || !item.additionalEvents.length
      || item.additionalEvents.length >= MAX_CHAPTER_ADOPTION_EVENTS)) invalid()
    const batch = new Set<string>()
    for (const output of [item, ...(item.additionalEvents ?? [])]) {
      if (!output || !uuid(output.eventId) || !uuid(output.eventVersionId)) invalid()
      if (batch.has(output.eventId) || versions.has(output.eventVersionId) || events.has(output.eventVersionId)
        || versions.has(output.eventId) || output.eventId === output.eventVersionId) invalid()
      if (output.replacesVersionId !== undefined) {
        if (!uuid(output.replacesVersionId) || output.replacesVersionId === output.eventVersionId || events.get(output.eventId) !== item.chapterId) invalid()
      } else if (events.has(output.eventId)) invalid()
      events.set(output.eventId, item.chapterId); versions.add(output.eventVersionId); batch.add(output.eventId)
    }
    operations.add(item.operationId)
  }
}

export function assertChapterEventOutputsAppend(previous: unknown, next: unknown): void {
  assertChapterEventOutputs(previous); assertChapterEventOutputs(next)
  if (next.length < previous.length || previous.some((item, i) => JSON.stringify(item) !== JSON.stringify(next[i]))) invalid()
}

export function assertChapterEventAdoption(input: ChapterEventAdoption): void {
  if (!input || ![input.operationId, input.eventId, input.eventVersionId, input.lifecycleId, input.orderId].every(uuid)
    || new Set([input.operationId, input.eventId, input.eventVersionId, input.lifecycleId, input.orderId]).size !== 5
    || !positive(input.chapterId, 1_000_000) || !positive(input.volume, 1000)
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500
    || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 500_000
    || !(input.expectedOutlineRevision === null || digest(input.expectedOutlineRevision))
    || !digest(input.expectedPlanningHash) || typeof input.expectedOrderId !== 'string' || !input.expectedOrderId
    || typeof input.planningContent !== 'string' || Buffer.byteLength(input.planningContent) > 16 * 1024 * 1024
    || !Array.isArray(input.parents) || ![2, 3].includes(input.parents.length)
    || input.parents[0]?.key !== 'total' || input.parents[1]?.key !== `volume-${input.volume}`
    || (input.parents.length === 3 && (!/^stage-[1-9]\d{0,6}$/.test(input.parents[2]?.key)
      || !positive(Number(input.parents[2].key.slice(6)), 1_000_000) || input.expectedOutlineRevision === null))
    || input.parents.some(p => !digest(p.revision))
    || !Array.isArray(input.eventHeads) || input.eventHeads.length > 50_000
    || input.eventHeads.some(e => !e || typeof e.id !== 'string' || !e.id || typeof e.revision !== 'string' || !e.revision)
    || new Set(input.eventHeads.map(e => e.id)).size !== input.eventHeads.length
    || typeof input.timestamp !== 'string' || !Number.isFinite(Date.parse(input.timestamp))) invalid()
  if (input.additionalEvents !== undefined && (!Array.isArray(input.additionalEvents) || !input.additionalEvents.length
    || input.additionalEvents.length >= MAX_CHAPTER_ADOPTION_EVENTS)) invalid()
  const ids = new Set([input.operationId, input.orderId]), contents = new Set<string>()
  const replaced = new Set(chapterEventItems(input).flatMap(item => item?.replaces ? [item.replaces.eventId] : []))
  for (const item of chapterEventItems(input)) {
    if (!item) invalid()
    for (const id of [item.eventId, item.eventVersionId, item.lifecycleId]) {
      if (!uuid(id) || ids.has(id)) invalid()
      ids.add(id)
    }
    assertStoryEventVersionPayload({ content: item.event, status: 'approved', phase: 'planned', granularity: 'chapter-detail', creator: 'author', sources: [] })
    if (item.event.evidenceRefs.length || !item.event.time.trim() || !item.event.characters.length || !item.event.location.trim()) invalid()
    if (item.refines !== undefined) {
      const source = decodeChapterEventRefinementSource(item.refines)
      if (item.replaces || replaced.has(source.eventId) || !input.eventHeads.some(e => e.id === source.eventId && e.revision === source.eventVersionId)) invalid()
    }
    if (item.replaces !== undefined) {
      const source = decodeChapterEventRefinementSource(item.replaces, 'replaces')
      if (source.eventId !== item.eventId || !uuid(item.expectedLifecycleId) || source.eventVersionId === item.eventVersionId
        || !input.eventHeads.some(e => e.id === source.eventId && e.revision === source.eventVersionId)) invalid()
    } else if (item.expectedLifecycleId !== undefined || input.eventHeads.some(e => e.id === item.eventId)) invalid()
    const hash = planningHash({ event: item.event, ...(item.refines ? { refines: item.refines } : {}), ...(item.replaces ? { replaces: item.replaces } : {}) })
    if (contents.has(hash)) invalid()
    contents.add(hash)
  }
}

export function chapterContentHash(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n?/g, '\n')).digest('hex')
}
function digest(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
function uuid(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) }
function positive(value: unknown, max: number): boolean { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max }
function invalid(): never { throw new AppError('INVALID_PROJECT_STATE', '章纲与事件的联合采用记录无效，已保留现有内容。', { recoverable: true }) }
