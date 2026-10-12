import type { ArgsDecoder } from '../core/validation'
import { exactArgs, record, rejectUnknown, invalid, requiredString, boundedInteger, uuid } from '../core/validation'
import type { ChapterEventDraft, ChapterEventRefinementSource } from './types'

export const MAX_CHAPTER_ADOPTION_EVENTS = 20

export const decodeChapterEventAdoptionArgs: ArgsDecoder<[string, number, ChapterEventDraft | ChapterEventDraft[]]> = args => {
  exactArgs(args, 3)
  const input = args[2]
  let event: ChapterEventDraft | ChapterEventDraft[]
  if (Array.isArray(input)) {
    if (!input.length || input.length > MAX_CHAPTER_ADOPTION_EVENTS) invalid('events', '请选择 1 到 20 个事件')
    event = input.map(decodeChapterEventDraft)
    if (new Set(event.map(e => JSON.stringify(e))).size !== event.length) invalid('events', '本次选中的事件不能完全重复')
    const replaced = event.flatMap(e => e.replaces ? [e.replaces.eventId] : [])
    if (new Set(replaced).size !== replaced.length || event.some(e => e.refines && replaced.includes(e.refines.eventId))) invalid('events', '同一事件不能重复替代，也不能同时作为细化来源')
  } else event = decodeChapterEventDraft(input)
  return [requiredString(args[0], 'proposalId', 200), boundedInteger(args[1], 'chapterId', 1, 1_000_000), event]
}

export function decodeChapterEventDraft(input: unknown): ChapterEventDraft {
  const value = record(input, 'event')
  rejectUnknown(value, 'event', ['time', 'characters', 'location', 'event', 'result', 'refines', 'replaces'])
  if (value.refines !== undefined && value.replaces !== undefined) invalid('event', '请选择细化或替代其中一种操作')
  if (!Array.isArray(value.characters) || !value.characters.length || value.characters.length > 100) invalid('characters', '请填写参与人物')
  const characters = (value.characters as unknown[]).map(c => requiredString(c, 'character', 120))
  if (new Set(characters).size !== characters.length) invalid('characters', '人物不能重复')
  return {
    time: requiredString(value.time, 'time', 500), characters,
    location: requiredString(value.location, 'location', 1000), event: requiredString(value.event, 'event', 5000), result: requiredString(value.result, 'result', 5000),
    ...(value.refines === undefined ? {} : { refines: decodeChapterEventRefinementSource(value.refines) }),
    ...(value.replaces === undefined ? {} : { replaces: decodeChapterEventRefinementSource(value.replaces, 'replaces') })
  }
}

export function decodeChapterEventRefinementSource(input: unknown, path = 'refines'): ChapterEventRefinementSource {
  const value = record(input, path)
  rejectUnknown(value, path, ['eventId', 'eventVersionId'])
  return { eventId: requiredString(value.eventId, `${path}.eventId`, 200), eventVersionId: uuid(value.eventVersionId, `${path}.eventVersionId`) }
}
