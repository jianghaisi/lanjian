import { AppError } from '../../../core/errors/app-error'
import type { StoryEventContent } from './story-event-version'

export const EVENT_MODEL_CANDIDATE_TASK = 'timeline_candidate_generation'
export const EVENT_MODEL_CANDIDATE_ARTIFACT = 'timeline_candidates'

export type EventModelCandidate = Readonly<{
  title: string
  time: string
  characters: readonly string[]
  location: string
  event: string
  result?: string
}>

export type EventModelCandidateArtifact = Readonly<{
  version: 1
  rawOutput: string
  candidates: readonly EventModelCandidate[]
}>

export function parseEventModelCandidateOutput(rawOutput: string): EventModelCandidateArtifact {
  if (typeof rawOutput !== 'string' || !rawOutput.trim() || rawOutput.length > 1_000_000 || rawOutput.includes('\u0000')) invalid()
  const unfenced = rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = unfenced.indexOf('['), end = unfenced.lastIndexOf(']')
  if (start < 0 || end <= start) invalid()
  let parsed: unknown
  try { parsed = JSON.parse(unfenced.slice(start, end + 1)) } catch { invalid() }
  if (!Array.isArray(parsed)) invalid()
  const seen = new Set<string>(), candidates: EventModelCandidate[] = []
  for (const item of parsed.slice(0, 30)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const value = item as Record<string, unknown>
    const time = text(value.time, 200), location = text(value.location, 500), event = text(value.event, 20_000)
    const characters = characterNames(value.characters)
    if (!time || !location || !event || !characters.length) continue
    const key = `${time}\n${characters.join('\n')}\n${location}\n${event}`.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) continue
    seen.add(key)
    const title = text(value.title, 200, true) || eventTitle(event)
    const result = text(value.result, 10_000, true)
    candidates.push(Object.freeze({ title, time, characters: Object.freeze(characters), location, event,
      ...(result ? { result } : {}) }))
  }
  if (!candidates.length) invalid()
  return Object.freeze({ version: 1, rawOutput, candidates: Object.freeze(candidates) })
}

export function decodeEventModelCandidateArtifact(value: unknown): EventModelCandidateArtifact {
  if (typeof value !== 'string' || value.length > 5_000_000) invalid()
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { invalid() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid()
  const artifact = parsed as Record<string, unknown>
  if (Object.keys(artifact).sort().join(',') !== 'candidates,rawOutput,version' || artifact.version !== 1
    || typeof artifact.rawOutput !== 'string' || !Array.isArray(artifact.candidates)) invalid()
  const regenerated = parseEventModelCandidateOutput(artifact.rawOutput)
  if (JSON.stringify(regenerated.candidates) !== JSON.stringify(artifact.candidates)) invalid()
  return regenerated
}

export function eventModelCandidateContent(candidate: EventModelCandidate): StoryEventContent {
  return {
    time: candidate.time,
    characters: [...candidate.characters],
    location: candidate.location,
    event: candidate.event,
    ...(candidate.result === undefined ? {} : { result: candidate.result }),
    evidenceRefs: [],
    confidence: 1,
    title: candidate.title
  }
}

function characterNames(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[、,，]/) : []
  const names = items.map(item => text(item, 200)).filter((item): item is string => Boolean(item)).slice(0, 100)
  return [...new Set(names)]
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000')) return ''
  const result = value.trim()
  return result || (allowEmpty ? '' : '')
}

function eventTitle(event: string): string {
  const first = event.replace(/\s+/g, ' ').split(/[。！？!?；;\n]/, 1)[0]?.trim() || event
  return first.length > 28 ? `${first.slice(0, 28)}…` : first
}

function invalid(): never {
  throw new AppError('VALIDATION_ERROR', '模型没有生成完整且可核对的事件数组，请重试或调整本书资料。', { recoverable: true })
}
