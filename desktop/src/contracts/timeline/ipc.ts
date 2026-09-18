import type { EventCandidateCreateInput, TimelineEvent } from '../index'
import type { ArgsDecoder } from '../core/validation'
import { boundedString, exactArgs, invalid, record, rejectUnknown, requiredString, uuid } from '../core/validation'
import { planningLimits } from '../planning/validation'

export const decodeEventCandidateCreateArgs: ArgsDecoder<[EventCandidateCreateInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'eventCandidate')
  rejectUnknown(value, 'eventCandidate', ['sourceId', 'time', 'characters', 'location', 'event', 'result'])
  if (!Array.isArray(value.characters) || value.characters.length < 1 || value.characters.length > 50)
    invalid('characters', '必须包含 1 到 50 个人物')
  const characters = value.characters.map((item, index) => requiredString(item, `characters[${index}]`, 120))
  return [
    {
      sourceId: uuid(value.sourceId, 'sourceId'),
      time: requiredString(value.time, 'time', 200),
      characters,
      location: requiredString(value.location, 'location', 500),
      event: requiredString(value.event, 'event', 20_000),
      result: value.result === undefined ? undefined : boundedString(value.result, 'result', 10_000).trim() || undefined
    }
  ]
}

export const decodeResearchEventIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [uuid(args[0], 'eventId')]
}

export const decodeTimelineArgs: ArgsDecoder<[TimelineEvent[]]> = (args) => {
  exactArgs(args, 1)
  if (!Array.isArray(args[0])) invalid('events', '必须是数组')
  if (args[0].length > planningLimits.maxTimelineEvents)
    invalid('events', `数量不能超过 ${planningLimits.maxTimelineEvents}`)
  return [
    args[0].map((item, index) => {
      const value = record(item, `events[${index}]`)
      rejectUnknown(value, `events[${index}]`, ['id', 'title', 'time', 'characters', 'location', 'event', 'result'])
      return {
        id: requiredString(value.id, `events[${index}].id`, 128),
        ...(value.title === undefined ? {} : { title: boundedString(value.title, `events[${index}].title`, 200) }),
        time: requiredString(value.time, `events[${index}].time`, 200),
        characters: requiredString(value.characters, `events[${index}].characters`, 1_000),
        location: requiredString(value.location, `events[${index}].location`, 500),
        event: requiredString(value.event, `events[${index}].event`, 20_000),
        ...(value.result === undefined
          ? {}
          : { result: boundedString(value.result, `events[${index}].result`, 20_000) })
      }
    })
  ]
}
