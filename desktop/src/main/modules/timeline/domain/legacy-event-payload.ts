import { assertStoryEventVersionPayload, storyEventVersionPayload, type StoryEventVersionPayload } from './story-event-version'

/** Interpret known legacy direct fields consistently for review, conversion and
 * historical evidence checks. No approval is issued by constructing a payload.
 * New conversion separately rejects unsupported fields; receipt reads preserve
 * historical extensions without granting a new conversion permission.
 */
export function directEventMigrationPayload(value: Record<string, unknown>, characters: readonly string[]): StoryEventVersionPayload {
  const payload = { content: { time: value.time, location: value.location, event: value.event,
    characters: [...characters], rawCharacters: value.characters,
    ...(Object.hasOwn(value, 'title') ? { title: value.title } : {}),
    ...(Object.hasOwn(value, 'result') ? { result: value.result } : {}), evidenceRefs: [],
    confidence: Object.hasOwn(value, 'confidence') ? value.confidence : 1 },
    status: Object.hasOwn(value, 'status') ? value.status : 'approved',
    phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources: [] }
  assertStoryEventVersionPayload(payload)
  return storyEventVersionPayload(payload)
}
