import type { ChapterUpstreamReview, UpstreamReviewRecord } from '../../../../contracts/planning/upstream-review-contracts'
import { decodeUpstreamReviewRecord } from '../../../../contracts/planning/upstream-review-contracts'
import { AppError } from '../../../core/errors/app-error'
import type { ProjectedStoryEvent } from '../../timeline/domain/event-projection'
import { planningHash, type PlanningSources } from './planning-dependencies'

export function assertUpstreamReviewHistory(value: unknown): asserts value is UpstreamReviewRecord[] {
  if (!Array.isArray(value) || value.length > 50_000) throw new AppError('INVALID_PROJECT_STATE', '上行复核记录无效。', { recoverable: true })
  try { value.forEach(decodeUpstreamReviewRecord) } catch { throw new AppError('INVALID_PROJECT_STATE', '上行复核记录损坏，已保留原数据。', { recoverable: true }) }
}

export function assertUpstreamReviewAppend(before: unknown, after: unknown): void {
  assertUpstreamReviewHistory(before); assertUpstreamReviewHistory(after)
  if (after.length < before.length || before.some((row, i) => JSON.stringify(row) !== JSON.stringify(after[i]))) {
    throw new AppError('CONFLICT', '历史上行复核判断不可移除或改写。', { recoverable: true })
  }
}

/** Text differences are prompts for author review, never proof of semantic contradiction. */
export function reviewRefinements(input: { chapterId: number; outlineHash: string; sources: PlanningSources; eventIds: string[];
  approved: readonly ProjectedStoryEvent[]; history: UpstreamReviewRecord[] }): ChapterUpstreamReview {
  const events = new Map(input.approved.map(e => [e.eventId, e]))
  const findings: ChapterUpstreamReview['findings'] = []
  for (const id of input.eventIds) {
    const detail = events.get(id)
    if (!detail || detail.granularity !== 'chapter-detail' || detail.phase !== 'planned') continue
    for (const edge of detail.sources.filter(e => e.relation === 'refines' && e.source.kind === 'event')) {
      const source = events.get(edge.source.id)
      const fields = (['time', 'characters', 'location', 'event', 'result'] as const).map(field => {
        const text = (event?: ProjectedStoryEvent) => field === 'characters' ? [...(event?.content.characters ?? [])].sort().join('\n') : event?.content[field] ?? ''
        return { field, source: text(source), detail: text(detail), changed: text(source) !== text(detail) }
      })
      const fingerprint = planningHash({ chapterId: input.chapterId, outlineHash: input.outlineHash, sources: input.sources,
        eventId: id, version: detail.versionId, sourceId: edge.source.id, provenance: edge.source.revision, sourceVersion: source?.versionId ?? null, sourcePhase: source?.phase ?? null, fields })
      const decision = [...input.history].reverse().find(h => h.chapterId === input.chapterId && h.fingerprint === fingerprint) ?? null
      if (decision && (decision.eventId !== id || decision.sourceId !== edge.source.id)) {
        throw new AppError('INVALID_PROJECT_STATE', '上行复核记录的事件身份不一致，已停止确认。', { recoverable: true })
      }
      if (decision?.evidence && planningHash(decision.evidence) !== planningHash({ eventVersion: detail.versionId,
        sourceVersion: source?.versionId ?? null, provenanceRevision: edge.source.revision, fields })) {
        throw new AppError('INVALID_PROJECT_STATE', '上行复核的历史对照与当前判断依据不一致，已停止确认。', { recoverable: true })
      }
      const blocked = !source || source.phase !== 'planned'
      findings.push({ eventId: id, eventVersion: detail.versionId, sourceId: edge.source.id, provenanceRevision: edge.source.revision,
        sourceVersion: source?.versionId ?? null, fingerprint, fields, decision,
        status: blocked ? 'blocked' : decision?.decision ?? (fields.some(f => f.changed) || edge.source.revision !== source.versionId ? 'pending' : 'clear') })
      if (findings.length > 200) throw new AppError('INVALID_PROJECT_STATE', '本章细化来源过多，请先整理事件归属。', { recoverable: true })
    }
  }
  return { findings, history: input.history.filter(h => h.chapterId === input.chapterId).slice(-20).reverse() }
}
