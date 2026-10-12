import { AppError } from '../../../core/errors/app-error'
import { inspectEventPlanningLedger } from './event-planning-review'
import type { EventSourceSnapshot } from './event-source-snapshot'

export type EventSourceAlias = { originalId: string; eventId: string; source: 'events' | 'timeline' }

/** Never detach a placement to make an archive succeed. Raw malformed ledgers
 * and ambiguous legacy identities must be resolved before removing any event. */
export function assertEventCanArchive(eventId: string, snapshot: EventSourceSnapshot, aliases: readonly EventSourceAlias[]): void {
  const targets = new Map<string, Set<string>>()
  const add = (ref: string, id: string) => { const values = targets.get(ref) ?? new Set<string>(); values.add(id); targets.set(ref, values) }
  for (const event of snapshot.eventHistory) { add(event.eventId, event.eventId); add(`canonical:${event.eventId}`, event.eventId) }
  for (const alias of aliases) {
    add(alias.originalId, alias.eventId)
    add(`${alias.source === 'timeline' ? 'direct' : 'canonical'}:${alias.originalId}`, alias.eventId)
  }
  const reasons: string[] = []
  let units = 0, unresolved = false
  const count = () => { if (++units > 100_000) throw conflict('章节关联超过核对上限，未归档事件。') }
  const findings = inspectEventPlanningLedger(snapshot.documents.planning.value, snapshot.chapterCatalog, count,
    (owner, reference) => {
      count()
      const matches = typeof reference === 'string' ? targets.get(reference) : undefined
      if (!matches || matches.size !== 1) unresolved = true
      if (matches?.has(eventId)) reasons.push(owner.path)
    })
  if (reasons.length) throw new AppError('CONFLICT', '该事件已关联大纲或章节，暂不能归档；请先核对关联安排。',
    { recoverable: true, details: { area: 'eventPlacements', count: reasons.length, references: reasons.slice(0, 20) } })
  if (unresolved || findings.some(finding => finding.severity === 'blocking')) throw conflict('大纲或章节关联尚不能完整核对，未归档事件。')
}

function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
