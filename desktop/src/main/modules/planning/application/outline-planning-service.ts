import { assertUpstreamReviewHistory, reviewRefinements } from '../domain/upstream-review'
import { decodeUpstreamReviewArgs, type UpstreamReviewInput, type UpstreamReviewRecord } from '../../../../contracts/planning/upstream-review-contracts'
import { assertPlanningSources, assertSkeletonHistory, assertSkeletonHistoryAppend, changedPlanningSources, planningHash, skeletonHeads, skeletonRevision, type FormalSkeletonRevision, type PlanningSources } from '../domain/planning-dependencies'
import { assertChapterEventOutputs, chapterEventOutputItems, chapterContentHash, type ChapterEventAdoption, type ChapterEventInput, type ChapterEventOutput, type ChapterEventStorageSnapshot } from '../domain/chapter-event-adoption'
import { MAX_CHAPTER_ADOPTION_EVENTS } from '../../../../contracts/planning/chapter-event-contracts'
import { randomUUID } from 'node:crypto'
import type { ChapterEventReference, ChapterEventReplacementImpact, FormalSkeletonView, PlanningChapterSkeletonEntry } from '../../../../contracts/planning/types'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { decodeChapterStoryConstraints, type ChapterStoryConstraints } from '../../../../contracts/planning/chapter-story-contract'
import { auditChapterOutline, parseChapterOutline } from '../domain/chapter-outline'
import { auditPlanningOutline } from '../domain/outline-quality'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { CanonicalEvent, ChapterOutlineDocument, ChapterOutlineReview, OutlineList, OutlinePlanningStatus, OutlinePlanningVolume, OutlineUpdateResult, OutlineVolume, PlanningOutlineApproval, PlanningOutlineReview, VolumeOutline } from '../../../../contracts/index'
import { DocumentService } from '../../manuscript/application/document-service'
import { writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from '../../library/application/project-service'
import { ResearchLibraryService } from '../../library/application/research-library-service'
import type { PlannedChapterStartInput, PlannedChapterStartResult } from '../../../../contracts/index'
import type { ProjectedStoryEvent, UnifiedEventProjection } from '../../timeline/domain/event-projection'

type OutlineAssignment = { eventId: string; assignedAt: string }
type PlannedVolume = { volume: number; title: string; eventIds: string[]; revision: number; outlineHash: string; createdAt: string; updatedAt: string }
type ChapterPlacement = { chapterId: number; volume: number; assignedAt: string; updatedAt: string }
type ManuscriptStart = { chapterId: number; revision: string; volume: number | null; completed: boolean }
type EventChapterPlacement = { eventId: string; chapterId: number; assignedAt: string; updatedAt: string }
type ChapterDependency = { sources?: PlanningSources; chapterId: number; volume?: number; basedOnTotalRevision: number; basedOnVolumeRevision?: number; outlineHash: string; savedAt: string }
type PlanningEventVersion = { eventId: string; versionId: string; phase: NonNullable<PlanningApprovedEvent['phase']> }
type ChapterConfirmation = { sources?: PlanningSources; chapterId: number; outlineHash: string; basedOnTotalRevision: number; basedOnVolumeRevision?: number; eventIds: string[]; eventVersions?: PlanningEventVersion[]; eventApprovedRevision?: string; confirmedAt: string }
type PlanningReviewAcknowledgement = { scope: OutlineVolume; fingerprint: string; issueCodes: string[]; acknowledgedAt: string }
type PlanningConfirmation = { scope: OutlineVolume; fingerprint: string; basedOnTotalFingerprint?: string; confirmedAt: string }
type EffectiveVolume = Omit<OutlinePlanningVolume, 'review' | 'approval'>
type PlanningApprovedEvent = CanonicalEvent & {
  title?: string
  versionId?: string
  phase?: ProjectedStoryEvent['phase'] | 'legacy-unknown'
  granularity?: ProjectedStoryEvent['granularity']
}
type OutlineState = {
  version: 1
  total: { revision: number; hash: string; updatedAt?: string }
  assignments: OutlineAssignment[]
  volumes: PlannedVolume[]
  chapterPlacements: ChapterPlacement[]
  manuscriptStarts: ManuscriptStart[]
  eventChapterPlacements: EventChapterPlacement[]
  chapters: ChapterDependency[]
  chapterStoryContracts?: Array<{ chapterId: number; outlineHash: string; sources: PlanningSources; constraints: ChapterStoryConstraints }>
  chapterConfirmations: ChapterConfirmation[]
  outlineReviewAcknowledgements: PlanningReviewAcknowledgement[]
  planningConfirmations: PlanningConfirmation[]
  formalSkeleton?: FormalSkeletonRevision[]
  chapterEventOutputs?: ChapterEventOutput[]
  upstreamReviewDecisions?: UpstreamReviewRecord[]
}

type FormalOutlinePlanningStatePort = {
  recoverChapterEvent?(workItemId: string, operationId: string, guard?: () => Promise<void>): Promise<{ output: ChapterEventOutput; mirrorsPending: boolean; planningMirrorsPending: boolean }>
  chapterEventSnapshot?(workItemId: string, chapterId: number, volume: number): Promise<ChapterEventStorageSnapshot>
  adoptChapterEvent?(workItemId: string, input: ChapterEventAdoption, guard?: () => Promise<void>): Promise<{ output: ChapterEventOutput; mirrorsPending: boolean; planningMirrorsPending: boolean }>
  readOutlinePlanningState?(workItemId: string): Promise<{ content: string; contentHash: string } | null>
  active(workItemId: string): Promise<boolean>
  outlinePlanningStateReady(workItemId: string): Promise<boolean>
  outlinePlanningState(workItemId: string): Promise<{ content: string; contentHash: string }>
  importOutlinePlanningState(workItemId: string, content: string, observedMirrorHash?: string): Promise<{ content: string; contentHash: string }>
  replaceOutlinePlanningState(workItemId: string, expectedContentHash: string, content: string): Promise<{ content: string; contentHash: string }>
}

const emptyState = (): OutlineState => ({
  version: 1,
  total: { revision: 0, hash: '' },
  assignments: [],
  volumes: [],
  chapterPlacements: [],
  manuscriptStarts: [],
  eventChapterPlacements: [],
  chapters: [],
  chapterConfirmations: [],
  outlineReviewAcknowledgements: [],
  planningConfirmations: []
})

export class OutlinePlanningService {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly stateSources = new WeakMap<OutlineState, { root: string; contentHash?: string; history?: FormalSkeletonRevision[] }>()

  constructor(
    private readonly projects: ProjectService,
    private readonly documents: DocumentService,
    private readonly research: ResearchLibraryService,
    private readonly formalStates?: FormalOutlinePlanningStatePort,
    private readonly unifiedEvents?: { read: () => Promise<UnifiedEventProjection | null>; sync?: (root: string) => Promise<boolean> }
  ) {}

  async storyContractSnapshot(chapterId: number) {
    const state = await this.inspectState()
    const root = this.stateSources.get(state)!.root
    const chapter = await this.documents.chapterOutline(chapterId)
    const sources = await this.chapterSources(state, chapterId)
    if (root !== await this.projects.currentPath()) throw new AppError('CONFLICT', '章纲为空或作品已切换。', { recoverable: true })
    return { root, chapterId, content: chapter.content, outlineHash: hashText(chapter.content), sources, fingerprint: planningHash({ root, chapterId, content: chapter.content, sources }) }
  }

  async bindStoryContract(chapterId: number, expected: string, constraints: ChapterStoryConstraints): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const snapshot = await this.storyContractSnapshot(chapterId)
      if (snapshot.fingerprint !== expected) throw new AppError('CONFLICT', '作品、章纲或来源已变化，请重新准备写作约束。', { recoverable: true })
      const state = await this.state()
      const fresh = await this.storyContractSnapshot(chapterId)
      if (fresh.fingerprint !== expected || this.stateSources.get(state)?.root !== fresh.root) throw new AppError('CONFLICT', '依据在核对中变化。', { recoverable: true })
      state.chapterStoryContracts = [...(state.chapterStoryContracts ?? []).filter(c => c.chapterId !== chapterId), { chapterId, outlineHash: fresh.outlineHash, sources: fresh.sources, constraints: decodeChapterStoryConstraints(constraints) }]
      state.chapterConfirmations = state.chapterConfirmations.filter(c => c.chapterId !== chapterId)
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async status(chapterId?: number): Promise<OutlinePlanningStatus> {
    const state = await this.inspectState()
    return this.projectStatus(state, chapterId)
  }

  /** Map guards need saved placement identities, never outline synchronization. */
  async worldMapEventChapterPlacements(): Promise<Pick<OutlinePlanningStatus, 'eventChapterPlacements'>> {
    const state = await this.inspectState()
    if (this.stateSources.get(state)?.root !== await this.projects.currentPath()) {
      throw new AppError('CONFLICT', '地图章节关联所属的作品已变化，请重新读取。', { recoverable: true })
    }
    return { eventChapterPlacements: state.eventChapterPlacements.map(({ eventId, chapterId }) => ({ eventId, chapterId })) }
  }

  async inspectFormalSkeleton(entries: PlanningChapterSkeletonEntry[], volume: number): Promise<FormalSkeletonView> {
    const state = await this.inspectState()
    return (await this.skeletonReview(state, entries, volume)).view
  }

  async adoptFormalSkeleton(entries: PlanningChapterSkeletonEntry[], volume: number, fingerprint: string): Promise<FormalSkeletonView> {
    return this.serialize(async () => {
      const state = await this.inspectState()
      const root = this.stateSources.get(state)!.root
      const reviewed = await this.skeletonReview(state, entries, volume)
      if (reviewed.view.fingerprint !== fingerprint || !reviewed.view.canAdopt) {
        throw new AppError('CONFLICT', '章节安排或正式依据已变化，请重新预览后采用。', { recoverable: true })
      }
      // Inspection is zero-write. Initialize the legacy state only after explicit adoption.
      const writable = await this.state()
      if (root !== await this.projects.currentPath()
        || planningHash(writable) !== planningHash(state)) throw new AppError('CONFLICT', '谋篇状态已变化，未采用骨架。', { recoverable: true })
      if ((await this.skeletonReview(writable, entries, volume)).view.fingerprint !== fingerprint) {
        throw new AppError('CONFLICT', '正式依据在核对期间变化，请重新预览。', { recoverable: true })
      }
      const heads = skeletonHeads(writable.formalSkeleton ?? [])
      const history = [...(writable.formalSkeleton ?? [])]
      for (const entry of entries) {
        const sources = reviewed.sources.get(entry.chapter)!
        const old = heads.get(entry.chapter)
        if (old && planningHash(old.entry) === planningHash(entry) && !changedPlanningSources(old.sources, sources).length) continue
        const previous = old?.revision ?? null
        history.push({ entryId: `chapter:${entry.chapter}`, revision: skeletonRevision(entry, sources, previous), previous,
          entry: structuredClone(entry), sources, adoptedAt: new Date().toISOString() })
      }
      writable.formalSkeleton = history
      await this.saveState(writable)
      return (await this.skeletonReview(writable, entries, volume)).view
    })
  }

  private async skeletonReview(state: OutlineState, entries: PlanningChapterSkeletonEntry[], volume: number) {
    if (!entries.length || entries.length > 50_000 || entries.some(e => e.volume !== volume)
      || new Set(entries.map(e => e.chapter)).size !== entries.length) throw new AppError('VALIDATION_ERROR', '章节安排的卷或章序无效。', { recoverable: true })
    const context = await this.sourceContext(state, entries.map(e => e.chapter))
    const status = await this.projectStatus(state)
    const formalVolume = status.volumes.find(v => v.volume === volume)
    const heads = skeletonHeads(state.formalSkeleton ?? [])
    const sources = new Map(entries.map(entry => [entry.chapter, this.sourcesForChapter(state, entry.chapter, volume, context, true)]))
    const rows: FormalSkeletonView['entries'] = entries.map(entry => {
      const old = heads.get(entry.chapter)
      const reasons = old ? changedPlanningSources(old.sources, sources.get(entry.chapter)!) : []
      const changed = old && planningHash(old.entry) !== planningHash(entry)
      return { chapter: entry.chapter, title: entry.title, revision: old?.revision ?? null,
        status: !old ? 'untracked' : reasons.length ? 'stale' : changed ? 'changed' : 'current', reasons }
    })
    const omitted = [...heads.values()].some(h => h.entry.volume === volume && !entries.some(e => e.chapter === h.entry.chapter))
    const missingEvent = [...sources.values()].some(s => s.events.some(e => e.revision === 'missing'))
    const canAdopt = status.totalApproval.status === 'confirmed' && formalVolume?.approval.status === 'confirmed' && !omitted && !missingEvent
    const view: FormalSkeletonView = {
      volume, canAdopt,
      fingerprint: planningHash({ state, entries, sources: [...sources], total: status.totalApproval, volume: formalVolume?.approval }),
      reason: missingEvent ? '关联的正式事件缺失或已归档，请先核对事件归属。'
        : omitted ? '候选缺少已采用的章节；请保留这些条目，不能通过重新生成删除正式骨架。'
        : !canAdopt ? '请先确认当前总纲与本卷卷纲，再采用章节安排。' : '逐章保存正式版本；不会改写章纲或正文。',
      entries: rows,
      affectedChapterIds: rows.filter(row => row.status !== 'current' && state.chapters.some(c => c.chapterId === row.chapter)).map(row => row.chapter)
    }
    if (await this.projects.currentPath() !== this.stateSources.get(state)?.root) throw new AppError('CONFLICT', '作品已切换，请重新读取章节安排。', { recoverable: true })
    return { view, sources }
  }

  private async sourceContext(state: OutlineState, chapterIds: number[], providedOutlines?: OutlineList) {
    const root = this.stateSources.get(state)?.root
    const documents = providedOutlines ?? await this.documents.outlines()
    const events = state.eventChapterPlacements.some(p => chapterIds.includes(p.chapterId)) ? await this.approvedEvents(root) : []
    if (root && await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，未读取上一部作品的依据。', { recoverable: true })
    const chapterStages = new Map((documents.chapterOutlines ?? []).map(chapter => [chapter.chapterId, chapter.stage]))
    const stages = new Map<number, NonNullable<PlanningSources['stage']>>()
    // StageOutline.stage is display sequence in older books. Resolve stable identity
    // from each chapter's actual parent, using the stage's explicit child membership.
    for (const stage of documents.stages ?? []) for (const chapterId of stage.chapterIds) {
      const id = chapterStages.get(chapterId)
      if (id) stages.set(chapterId, { id, volume: stage.volume, revision: hashText(`stage-${id}\u0000${stage.title}\u0000${stage.content}`) })
    }
    return {
      total: hashText(documents.total?.content ?? ''),
      volumes: new Map(documents.volumes.map(v => [v.volume, planningHash({ content: v.content.replace(/\r\n?/g, '\n'), title: state.volumes.find(p => p.volume === v.volume)?.title ?? v.title })])),
      stages, chapterStages,
      events: new Map(events.map(e => [e.id, e.versionId ?? planningHash({ time: e.time, characters: e.characters, location: e.location, event: e.event, result: e.result })]))
    }
  }

  private sourcesForChapter(state: OutlineState, chapterId: number, volume: number | null, context: Awaited<ReturnType<OutlinePlanningService['sourceContext']>>, skeleton = false): PlanningSources {
    const outputs = new Set(skeleton ? (state.chapterEventOutputs ?? []).filter(o => o.chapterId === chapterId).flatMap(o => chapterEventOutputItems(o).map(e => e.eventId)) : [])
    const events = chapterEventIds(state, chapterId).filter(id => !outputs.has(id)).map(id => ({ id, revision: context.events.get(id) ?? 'missing' })).sort((a, b) => a.id.localeCompare(b.id))
    const stageId = skeleton ? null : context.chapterStages.get(chapterId)
    const stage = stageId ? context.stages.get(chapterId) : undefined
    if (stageId && !stage) throw new AppError('INVALID_PROJECT_STATE', '本章所属阶段缺失，请先核对大纲层级。', { recoverable: true })
    return { total: context.total, volume, volumeHash: volume === null ? null : context.volumes.get(volume) ?? hashText(''), events, ...(stage ? { stage } : {}) }
  }

  private async skeletonSources(state: OutlineState, entry: PlanningChapterSkeletonEntry, providedOutlines?: OutlineList): Promise<PlanningSources> {
    return this.sourcesForChapter(state, entry.chapter, entry.volume, await this.sourceContext(state, [entry.chapter], providedOutlines), true)
  }

  private async chapterSources(state: OutlineState, chapterId: number, providedOutlines?: OutlineList): Promise<PlanningSources> {
    const sources = this.sourcesForChapter(state, chapterId, state.chapterPlacements.find(p => p.chapterId === chapterId)?.volume ?? null, await this.sourceContext(state, [chapterId], providedOutlines))
    const head = skeletonHeads(state.formalSkeleton ?? []).get(chapterId)
    return { ...sources, ...(head ? { skeleton: head.revision } : {}) }
  }

  async prepareChapterEvent(chapterId: number, volume: number, title: string, content: string, event: ChapterEventInput | ChapterEventInput[], constraints?: ChapterStoryConstraints): Promise<{ root: string; command: ChapterEventAdoption; replacementImpact?: ChapterEventReplacementImpact }> {
    const events = Array.isArray(event) ? event : [event]
    if (!events.length || events.length > MAX_CHAPTER_ADOPTION_EVENTS) throw new AppError('VALIDATION_ERROR', '请选择 1 到 20 个细节事件。', { recoverable: true })
    const root = await this.projects.currentPath()
    if (!this.formalStates?.chapterEventSnapshot || !this.formalStates.adoptChapterEvent) throw new AppError('FEATURE_UNAVAILABLE', '本书暂不支持章纲与事件联合采用。', { recoverable: true })
    const snapshot = await this.formalStates.chapterEventSnapshot(root, chapterId, volume)
    const state = normalizeState(JSON.parse(snapshot.planning.content))
    this.stateSources.set(state, { root, contentHash: snapshot.planning.contentHash })
    const head = skeletonHeads(state.formalSkeleton ?? []).get(chapterId)
    const status = await this.projectStatus(state, chapterId)
    const formalVolume = status.volumes.find(v => v.volume === volume)
    if (!head || head.entry.volume !== volume || changedPlanningSources(head.sources, await this.skeletonSources(state, head.entry)).length
      || status.totalApproval.status !== 'confirmed' || formalVolume?.approval.status !== 'confirmed') throw new AppError('CONFLICT', '正式骨架或上游尚未确认，请重新核对。', { recoverable: true })
    const storedVolume = state.volumes.find(v => v.volume === volume)
    if (!storedVolume) throw new AppError('CONFLICT', '章纲归卷已变化，请先调整归属。', { recoverable: true })
    if (events.some(event => event.refines || event.replaces)) {
      const linked = await this.inspectChapterEvents(chapterId)
      for (const event of events) {
        const selected = event.replaces ?? event.refines
        if (!selected) continue
        if (!linked.some(source => source.id === selected.eventId && source.version === selected.eventVersionId && source.phase === 'planned'
          && snapshot.eventHeads.some(head => head.id === source.id && head.revision === source.version)
          && (!event.replaces || (source.replaceable && snapshot.eventStates?.some(s => s.eventId === source.id && s.latestVersionId === source.version))))) {
          throw new AppError('CONFLICT', '事件来源已变化或存在待审版本；替代仅限本章联合采纳的细节计划事件，请重新核对。', { recoverable: true })
        }
      }
    }
    const replaced = new Set(events.flatMap(e => e.replaces ? [e.replaces.eventId] : []))
    const replacementImpact = replaced.size ? {
      chapterIds: state.chapters.filter(c => c.chapterId !== chapterId && c.sources?.events.some(e => replaced.has(e.id))).map(c => c.chapterId).sort((a, b) => a - b),
      skeletonChapterIds: [...skeletonHeads(state.formalSkeleton ?? []).values()].filter(s => s.sources.events.some(e => replaced.has(e.id))).map(s => s.entry.chapter).sort((a, b) => a - b)
    } : undefined
    const items = events.map(({ refines, replaces, ...event }) => ({ eventId: replaces?.eventId ?? randomUUID(), eventVersionId: randomUUID(), lifecycleId: randomUUID(), event,
      ...(refines ? { refines: { ...refines } } : {}),
      ...(replaces ? { replaces: { ...replaces }, expectedLifecycleId: snapshot.eventStates!.find(s => s.eventId === replaces.eventId)!.lifecycleId } : {}) }))
    const created = items.filter(e => !e.replaces)
    const timestamp = new Date().toISOString()
    const sources = this.sourcesForChapter(state, chapterId, volume, await this.sourceContext(state, [chapterId]))
    const stageParent = snapshot.parents[2]
    if (sources.stage?.id !== (stageParent ? Number(stageParent.key.slice(6)) : undefined)
      || sources.stage?.revision !== stageParent?.revision || (sources.stage && sources.stage.volume !== volume)) {
      throw new AppError('CONFLICT', '本章阶段在读取中变化，请重新核对。', { recoverable: true })
    }
    if (JSON.stringify(sources.events) !== JSON.stringify(snapshot.eventHeads)) throw new AppError('CONFLICT', '事件版本在读取中变化，请重试。', { recoverable: true })
    sources.skeleton = head.revision
    sources.events = [...sources.events.filter(e => !replaced.has(e.id)), ...items.map(e => ({ id: e.eventId, revision: e.eventVersionId }))].sort((a, b) => a.id.localeCompare(b.id))
    if (sources.events.length > 50_000) throw new AppError('VALIDATION_ERROR', '本章事件关联已达上限。', { recoverable: true })
    state.assignments.push(...created.map(e => ({ eventId: e.eventId, assignedAt: timestamp })))
    storedVolume.eventIds.push(...created.map(e => e.eventId))
    state.chapterPlacements = [...state.chapterPlacements.filter(p => p.chapterId !== chapterId), { chapterId, volume, assignedAt: timestamp, updatedAt: timestamp }]
    state.eventChapterPlacements.push(...created.map(e => ({ chapterId, eventId: e.eventId, assignedAt: timestamp, updatedAt: timestamp })))
    state.chapters = [...state.chapters.filter(c => c.chapterId !== chapterId), { chapterId, volume, basedOnTotalRevision: state.total.revision,
      basedOnVolumeRevision: storedVolume.revision, sources, outlineHash: chapterContentHash(content), savedAt: timestamp }]
    state.chapterConfirmations = state.chapterConfirmations.filter(c => c.chapterId !== chapterId)
    if (constraints) state.chapterStoryContracts = [...(state.chapterStoryContracts ?? []).filter(c => c.chapterId !== chapterId), { chapterId, outlineHash: chapterContentHash(content), sources, constraints: decodeChapterStoryConstraints(constraints) }]
    if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，请重试。', { recoverable: true })
    return { root, ...(replacementImpact ? { replacementImpact } : {}), command: { operationId: randomUUID(), chapterId, volume, title: snapshot.chapter?.title ?? title, content,
      expectedOutlineRevision: snapshot.chapter?.revision ?? null, parents: snapshot.parents, expectedPlanningHash: snapshot.planning.contentHash,
      planningContent: JSON.stringify(state), expectedOrderId: snapshot.orderId, eventHeads: snapshot.eventHeads,
      ...items[0], ...(items.length > 1 ? { additionalEvents: items.slice(1) } : {}), orderId: randomUUID(), timestamp } }
  }

  async recoverChapterEvent(operationId: string) {
    return this.serialize(async () => {
      const root = await this.projects.currentPath()
      if (!this.formalStates?.recoverChapterEvent) throw new AppError('FEATURE_UNAVAILABLE', '联合采用恢复暂不可用。', { recoverable: true })
      const result = await this.formalStates.recoverChapterEvent(root, operationId, async () => {
        if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，请重新核对。', { recoverable: true })
      })
      if (this.unifiedEvents?.sync) {
        try { if (await this.unifiedEvents.sync(root)) result.mirrorsPending = result.planningMirrorsPending } catch { /* Retain pending status. */ }
      }
      return result
    })
  }

  async commitChapterEvent(root: string, command: ChapterEventAdoption, guard?: () => Promise<void>): Promise<{ output: ChapterEventOutput; mirrorsPending: boolean; planningMirrorsPending: boolean }> {
    return this.serialize(async () => {
      if (await this.projects.currentPath() !== root || !this.formalStates?.adoptChapterEvent) throw new AppError('CONFLICT', '作品已切换，请重新核对。', { recoverable: true })
      const result = await this.formalStates.adoptChapterEvent(root, command, async () => {
        await guard?.()
        if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，请重新核对。', { recoverable: true })
      })
      if (this.unifiedEvents?.sync) {
        try { if (await this.unifiedEvents.sync(root)) result.mirrorsPending = result.planningMirrorsPending } catch { /* Formal commit remains durable. */ }
      }
      return result
    })
  }

  private async inspectState(): Promise<OutlineState> {
    const root = await this.projects.currentPath()
    const formal = await this.formalStates?.readOutlinePlanningState?.(root)
    if (formal) {
      const state = normalizeState(JSON.parse(formal.content))
      this.stateSources.set(state, { root, contentHash: formal.contentHash, history: structuredClone(state.formalSkeleton ?? []) })
      return state
    }
    // Compatibility adapters without the read port keep their existing state reader.
    if (this.formalStates && !this.formalStates.readOutlinePlanningState) return this.state()
    const legacy = await this.readLegacy(root)
    this.stateSources.set(legacy.state, { root, history: structuredClone(legacy.state.formalSkeleton ?? []) })
    return legacy.state
  }

  async validateLedger(): Promise<void> {
    await this.state()
  }

  async startPlannedChapter(input: PlannedChapterStartInput): Promise<PlannedChapterStartResult> {
    const root = await this.projects.currentPath()
    const file = await projectDirectory(root, join(root, '.webnovel', 'planning', 'outline-state.json'))
    return this.serialize(async () => {
      const state = await this.state(file)
      const source = await this.documents.getPlannedChapter(input.chapterId)
      if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，请重新操作。', { recoverable: true })
      let receipt = state.manuscriptStarts.find(item => item.chapterId === input.chapterId)
      // Existing manuscripts without an unfinished receipt belong to the author, not this handoff.
      if (receipt?.completed || (!receipt && source.hasManuscript)) return this.documents.startPlannedChapter(input, root)
      if (!source.hasManuscript && (source.revision !== input.expectedRevision || !source.content.trim())) {
        throw new AppError('CONFLICT', '请重新读取并保存非空章纲，再开始正文。', { recoverable: true })
      }
      if (receipt && !source.hasManuscript && receipt.revision !== source.revision) {
        // A previous attempt failed before creating a body; this explicit click may adopt the new saved source.
        receipt.revision = source.revision
        receipt.volume = source.volume
      }
      if (!receipt) {
        receipt = { chapterId: input.chapterId, revision: source.revision, volume: source.volume, completed: false }
        state.manuscriptStarts.push(receipt)
      }
      if (receipt.volume !== null && !(await this.effectiveVolumes(state)).some(item => item.volume === receipt.volume)) {
        throw new AppError('CONFLICT', '原章纲所属篇卷已不存在，请先调整归属。', { recoverable: true })
      }
      if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，请重新操作。', { recoverable: true })
      // Durable intent precedes SQLite creation; replay can finish a lost cross-store response.
      await this.saveState(state)
      const result = await this.documents.startPlannedChapter(input, root)
      if (!state.chapterPlacements.some(item => item.chapterId === input.chapterId) && receipt.volume !== null) {
        const now = new Date().toISOString()
        state.chapterPlacements.push({ chapterId: input.chapterId, volume: receipt.volume, assignedAt: now, updatedAt: now })
      }
      receipt.completed = true
      try { await this.saveState(state) }
      catch {
        throw new AppError('STORAGE_ERROR', '正文已创建，归卷交接尚未保存。请重试，不会覆盖已有正文。', { recoverable: true, details: { chapterId: input.chapterId, manuscriptCreated: true } })
      }
      return result
    })
  }

  async decideUpstreamReview(raw: UpstreamReviewInput): Promise<OutlinePlanningStatus> {
    const [input] = decodeUpstreamReviewArgs([raw])
    return this.serialize(async () => {
      if ((await this.projects.currentSummary()).id !== input.workItemId) throw new AppError('CONFLICT', '作品已切换，请重新读取复核项。', { recoverable: true })
      const state = await this.inspectState()
      const status = await this.projectStatus(state, input.chapterId)
      const finding = status.chapter?.review.upstream?.findings.find(f => f.fingerprint === input.fingerprint)
      if (!finding || finding.status === 'blocked' || !finding.sourceVersion) throw new AppError('CONFLICT', '复核依据已变化或来源不可用，请重新核对。', { recoverable: true })
      if ((await this.projects.currentSummary()).id !== input.workItemId) throw new AppError('CONFLICT', '作品已切换，未保存判断。', { recoverable: true })
      if (finding.decision?.decision === input.decision && finding.decision.reason === input.reason) return status
      state.upstreamReviewDecisions = [...(state.upstreamReviewDecisions ?? []), {
        chapterId: input.chapterId, eventId: finding.eventId, sourceId: finding.sourceId, fingerprint: finding.fingerprint,
        decision: input.decision, reason: input.reason, decidedAt: new Date().toISOString(),
        evidence: { eventVersion: finding.eventVersion, sourceVersion: finding.sourceVersion,
          provenanceRevision: finding.provenanceRevision, fields: structuredClone(finding.fields) }
      }]
      assertUpstreamReviewHistory(state.upstreamReviewDecisions)
      await this.saveState(state)
      // A concurrent event edit can only make this an historical decision. Recompute
      // before reporting success; confirmation also derives its gate from current heads.
      return this.projectStatus(state, input.chapterId)
    })
  }

  async reviewChapterOutline(chapterId: number): Promise<ChapterOutlineReview> {
    await this.documents.chapter(chapterId)
    const status = await this.status(chapterId)
    return status.chapter!.review
  }

  async confirmChapterOutline(chapterId: number): Promise<OutlinePlanningStatus> {
    await this.documents.chapter(chapterId)
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const projected = await this.projectStatus(state, chapterId)
      const chapter = projected.chapter!
      if (!chapter.review.canConfirm) {
        const reason = chapter.review.issues.find((item) => item.level === 'error')?.message
          || (chapter.stale ? '请先保存当前章纲，使它重新绑定最新总纲与卷纲。' : '当前章纲尚未通过结构审核。')
        throw new AppError('CONFLICT', reason, { recoverable: true, details: { chapterId } })
      }
      const dependency = state.chapters.find((item) => item.chapterId === chapterId)
      if (!dependency) throw new AppError('INVALID_PROJECT_STATE', '当前章纲没有可确认的版本记录。', { recoverable: true })
      const eventIds = chapterEventIds(state, chapterId)
      const eventSnapshot = await this.chapterEventDependencies(state, chapterId)
      state.chapterConfirmations = state.chapterConfirmations.filter((item) => item.chapterId !== chapterId)
      state.chapterConfirmations.push({
        chapterId,
        outlineHash: dependency.outlineHash,
        ...(dependency.sources ? { sources: dependency.sources } : {}),
        basedOnTotalRevision: dependency.basedOnTotalRevision,
        ...(dependency.basedOnVolumeRevision !== undefined ? { basedOnVolumeRevision: dependency.basedOnVolumeRevision } : {}),
        eventIds,
        ...(eventSnapshot.eventVersions.length ? { eventVersions: eventSnapshot.eventVersions } : {}),
        ...(eventSnapshot.approvedRevision ? { eventApprovedRevision: eventSnapshot.approvedRevision } : {}),
        confirmedAt: new Date().toISOString()
      })
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async acknowledgeOutlineReview(scope: OutlineVolume): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const state = await this.state()
      const projected = await this.projectStatus(state)
      const review = scope === 'total'
        ? projected.totalReview
        : projected.volumes.find((item) => item.volume === scope)?.review
      if (!review) throw new AppError('NOT_FOUND', '要核对的篇卷不存在。', { recoverable: true })
      if (!review.issues.length) throw new AppError('CONFLICT', '当前版本没有需要暂略的提示。', { recoverable: true })
      const acknowledgedAt = new Date().toISOString()
      state.outlineReviewAcknowledgements = state.outlineReviewAcknowledgements.filter((item) => item.scope !== scope)
      state.outlineReviewAcknowledgements.push({
        scope,
        fingerprint: review.fingerprint,
        issueCodes: review.issues.map((item) => item.code).sort(),
        acknowledgedAt
      })
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async confirmPlanningOutline(scope: OutlineVolume): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const state = await this.state()
      const projected = await this.projectStatus(state)
      const approval = scope === 'total'
        ? projected.totalApproval
        : projected.volumes.find((item) => item.volume === scope)?.approval
      if (!approval) throw new AppError('NOT_FOUND', '要确认的篇卷不存在。', { recoverable: true })
      if (!approval.canConfirm) throw new AppError('CONFLICT', approval.reason, { recoverable: true })
      const confirmedAt = new Date().toISOString()
      state.planningConfirmations = state.planningConfirmations.filter((item) => item.scope !== scope)
      state.planningConfirmations.push({
        scope,
        fingerprint: approval.fingerprint,
        ...(scope !== 'total' ? { basedOnTotalFingerprint: projected.totalApproval.fingerprint } : {}),
        confirmedAt
      })
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async updateOutline(volume: OutlineVolume, content: string): Promise<OutlineUpdateResult> {
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      if (volume !== 'total') {
        const target = (await this.effectiveVolumes(state)).find((item) => item.volume === volume)
        if (!target) throw new AppError('NOT_FOUND', '要编辑的篇卷不存在。', { recoverable: true })
        const persisted = await this.materializeVolume(state, target)
        const before = volumeSnapshot(persisted, (await this.documents.outline(volume)).content)
        const result = await this.documents.updateOutline(volume, content)
        const nextHash = hashText(content)
        if (nextHash !== before.hash) {
          persisted.revision = Math.max(1, before.revision + 1)
          persisted.outlineHash = nextHash
          persisted.updatedAt = new Date().toISOString()
        }
        await this.saveState(state)
        return result
      }
      const result = await this.documents.updateOutline(volume, content)
      const nextHash = hashText(content)
      if (nextHash !== snapshot.hash) {
        bumpTotalRevision(state)
        state.total.hash = nextHash
      }
      await this.saveState(state)
      return result
    })
  }

  async importedTotalOutlineSnapshot(): Promise<{ content: string; fingerprint: string; revision: number; confirmed: boolean; volumeOutlines: number; chapterOutlines: number }> {
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const status = await this.projectStatus(state)
      return {
        content: snapshot.content,
        fingerprint: snapshot.hash,
        revision: status.totalRevision,
        confirmed: status.totalApproval.status === 'confirmed',
        volumeOutlines: status.volumes.filter((item) => item.outlineExists).length,
        chapterOutlines: (await this.documents.chapterOutlines()).filter((item) => item.content.trim()).length
      }
    })
  }

  async adoptImportedTotalOutline(input: { content: string; currentFingerprint: string }): Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }> {
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      if (snapshot.hash !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '正式总纲已在预览后发生变化，请重新查看影响后再采用。', { recoverable: true })
      }
      const content = input.content.trim()
      await this.documents.updateOutline('total', content)
      const nextHash = hashText(content)
      if (nextHash !== snapshot.hash) {
        bumpTotalRevision(state)
        state.total.hash = nextHash
      }
      await this.saveState(state)
      return { content, fingerprint: nextHash, status: await this.projectStatus(state) }
    })
  }

  async importedVolumeOutlineSnapshot(volume: number): Promise<{
    volume: number; title: string; content: string; fingerprint: string; revision: number; confirmed: boolean
    parentTotalFingerprint: string; parentTotalConfirmed: boolean; siblingVolumeOutlines: number; chapterOutlines: number
  }> {
    return this.serialize(async () => {
      const state = await this.state()
      const total = await this.totalSnapshot(state)
      await this.reconcileState(state, total)
      const status = await this.projectStatus(state)
      const target = status.volumes.find((item) => item.volume === volume)
      if (!target) throw new AppError('NOT_FOUND', '目标篇卷不存在，请先在谋篇中建立篇卷目录。', { recoverable: true })
      const content = (await this.documents.outline(volume)).content
      return {
        volume,
        title: target.title,
        content,
        fingerprint: hashText(content),
        revision: target.revision,
        confirmed: target.approval.status === 'confirmed',
        parentTotalFingerprint: status.totalApproval.fingerprint,
        parentTotalConfirmed: status.totalApproval.status === 'confirmed',
        siblingVolumeOutlines: status.volumes.filter((item) => item.volume !== volume && item.outlineExists).length,
        chapterOutlines: (await this.documents.chapterOutlines()).filter((item) => item.content.trim()).length
      }
    })
  }

  async adoptImportedVolumeOutline(input: {
    volume: number; content: string; currentFingerprint: string; parentTotalFingerprint: string
  }): Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }> {
    return this.serialize(async () => {
      const state = await this.state()
      const total = await this.totalSnapshot(state)
      await this.reconcileState(state, total)
      const status = await this.projectStatus(state)
      if (status.totalApproval.status !== 'confirmed' || status.totalApproval.fingerprint !== input.parentTotalFingerprint) {
        throw new AppError('CONFLICT', '正式总纲已变化或尚未确认，请先重新确认总纲再采用卷纲。', { recoverable: true })
      }
      const target = (await this.effectiveVolumes(state)).find((item) => item.volume === input.volume)
      if (!target) throw new AppError('NOT_FOUND', '目标篇卷不存在，请先在谋篇中建立篇卷目录。', { recoverable: true })
      const persisted = await this.materializeVolume(state, target)
      const beforeContent = (await this.documents.outline(input.volume)).content
      const before = volumeSnapshot(persisted, beforeContent)
      if (before.hash !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '目标卷纲已在预览后发生变化，请重新查看影响后再采用。', { recoverable: true })
      }
      const content = input.content.trim()
      await this.documents.updateOutline(input.volume, content)
      const nextHash = hashText(content)
      if (nextHash !== before.hash) {
        persisted.revision = Math.max(1, before.revision + 1)
        persisted.outlineHash = nextHash
        persisted.updatedAt = new Date().toISOString()
      }
      await this.saveState(state)
      return { content, fingerprint: nextHash, status: await this.projectStatus(state) }
    })
  }

  async importedChapterOutlineSnapshot(chapterId: number): Promise<{
    chapterId: number; position: number; title: string; wordCount: number; content: string; fingerprint: string
    volume: number; volumeTitle: string; parentTotalFingerprint: string; parentTotalConfirmed: boolean
    parentVolumeFingerprint: string; parentVolumeConfirmed: boolean; chapterConfirmed: boolean; siblingChapterOutlines: number
  }> {
    return this.serialize(async () => {
      const state = await this.state()
      const total = await this.totalSnapshot(state)
      await this.reconcileState(state, total)
      const chapter = await this.documents.chapter(chapterId)
      const status = await this.projectStatus(state, chapterId)
      const placement = state.chapterPlacements.find((item) => item.chapterId === chapterId)
      if (!placement) throw new AppError('CONFLICT', '目标章节尚未归入篇卷，请先在谋篇中明确本章所属篇卷。', { recoverable: true })
      const volume = status.volumes.find((item) => item.volume === placement.volume)
      if (!volume) throw new AppError('INVALID_PROJECT_STATE', '目标章节引用的篇卷不存在，已停止采用章纲。', { recoverable: true })
      const content = (await this.documents.chapterOutline(chapterId)).content
      return {
        chapterId,
        position: chapter.position,
        title: chapter.title,
        wordCount: chapter.word_count,
        content,
        fingerprint: hashText(content),
        volume: volume.volume,
        volumeTitle: volume.title,
        parentTotalFingerprint: status.totalApproval.fingerprint,
        parentTotalConfirmed: status.totalApproval.status === 'confirmed',
        parentVolumeFingerprint: volume.approval.fingerprint,
        parentVolumeConfirmed: volume.approval.status === 'confirmed',
        chapterConfirmed: status.chapter?.review.status === 'confirmed',
        siblingChapterOutlines: (await this.documents.chapterOutlines()).filter((item) => item.chapterId !== chapterId && item.content.trim()).length
      }
    })
  }

  async adoptImportedChapterOutline(input: {
    chapterId: number; content: string; currentFingerprint: string; parentTotalFingerprint: string; parentVolumeFingerprint: string
  }): Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }> {
    return this.serialize(async () => {
      const state = await this.state()
      const total = await this.totalSnapshot(state)
      await this.reconcileState(state, total)
      const status = await this.projectStatus(state, input.chapterId)
      const placement = state.chapterPlacements.find((item) => item.chapterId === input.chapterId)
      if (!placement) throw new AppError('CONFLICT', '目标章节尚未归卷，请先在谋篇中确认章节落点。', { recoverable: true })
      const volume = status.volumes.find((item) => item.volume === placement.volume)
      if (status.totalApproval.status !== 'confirmed' || status.totalApproval.fingerprint !== input.parentTotalFingerprint) {
        throw new AppError('CONFLICT', '正式总纲已变化或尚未确认，请重新确认总纲后再采用章纲。', { recoverable: true })
      }
      if (!volume || volume.approval.status !== 'confirmed' || volume.approval.fingerprint !== input.parentVolumeFingerprint) {
        throw new AppError('CONFLICT', '目标卷纲已变化或尚未确认，请重新确认本卷后再采用章纲。', { recoverable: true })
      }
      const before = await this.documents.chapterOutline(input.chapterId)
      if (hashText(before.content) !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '目标章纲已在预览后发生变化，请重新查看影响后再采用。', { recoverable: true })
      }
      const content = input.content.trim()
      await this.documents.updateChapterOutline(input.chapterId, content, placement.volume)
      const nextHash = hashText(content)
      state.chapters = state.chapters.filter((item) => item.chapterId !== input.chapterId)
      if (content) {
        state.chapters.push({
          chapterId: input.chapterId,
          volume: placement.volume,
          basedOnVolumeRevision: volume.revision,
          basedOnTotalRevision: state.total.revision,
          sources: await this.chapterSources(state, input.chapterId),
          outlineHash: nextHash,
          savedAt: new Date().toISOString()
        })
      }
      await this.saveState(state)
      return { content, fingerprint: nextHash, status: await this.projectStatus(state, input.chapterId) }
    })
  }

  async updateChapterOutline(chapterId: number, content: string, plannedVolume?: number, constraints?: ChapterStoryConstraints): Promise<ChapterOutlineDocument> {
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const previousPlacement = state.chapterPlacements.find((item) => item.chapterId === chapterId)
      if (plannedVolume !== undefined) {
        if (!(await this.effectiveVolumes(state)).some((item) => item.volume === plannedVolume)) {
          throw new AppError('NOT_FOUND', '详细章纲对应的篇卷不存在，已停止写入。', { recoverable: true })
        }
        const now = new Date().toISOString()
        state.chapterPlacements = state.chapterPlacements.filter((item) => item.chapterId !== chapterId)
        state.chapterPlacements.push({ chapterId, volume: plannedVolume, assignedAt: previousPlacement?.assignedAt || now, updatedAt: now })
        const receipt = state.manuscriptStarts.find(item => item.chapterId === chapterId)
        if (receipt) receipt.completed = true
      }
      const placement = state.chapterPlacements.find((item) => item.chapterId === chapterId)
      let volumeRevision: number | undefined
      if (placement) {
        const volume = (await this.effectiveVolumes(state)).find((item) => item.volume === placement.volume)
        if (!volume) throw new AppError('INVALID_PROJECT_STATE', '章节引用的篇卷不存在，已停止写入章纲。', { recoverable: true })
        volumeRevision = (await this.materializeVolume(state, volume)).revision
      }
      // A failed ledger write can be retried without appending the same manuscript again.
      const existing = constraints ? await this.documents.chapterOutline(chapterId) : undefined
      const result = existing?.content === content ? existing : await this.documents.updateChapterOutline(chapterId, content, placement?.volume)
      state.chapters = state.chapters.filter((item) => item.chapterId !== chapterId)
      if (content.trim()) {
        state.chapters.push({
          chapterId,
          ...(placement ? { volume: placement.volume, basedOnVolumeRevision: volumeRevision } : {}),
          basedOnTotalRevision: state.total.revision,
          sources: await this.chapterSources(state, chapterId),
          outlineHash: hashText(content),
          savedAt: new Date().toISOString()
        })
      } else state.chapterConfirmations = state.chapterConfirmations.filter((item) => item.chapterId !== chapterId)
      if (constraints) {
        state.chapterStoryContracts = [...(state.chapterStoryContracts ?? []).filter(c => c.chapterId !== chapterId), { chapterId, outlineHash: hashText(content), sources: await this.chapterSources(state, chapterId), constraints: decodeChapterStoryConstraints(constraints) }]
        state.chapterConfirmations = state.chapterConfirmations.filter(c => c.chapterId !== chapterId)
      }
      await this.saveState(state)
      return result
    })
  }

  async assignEvent(eventId: string): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const state = await this.state()
      await this.approvedEvent(eventId, this.stateSources.get(state)?.root)
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      if (state.assignments.some((item) => item.eventId === eventId)) return this.projectStatus(state)
      state.assignments.push({ eventId, assignedAt: new Date().toISOString() })
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async unassignEvent(eventId: string): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const next = state.assignments.filter((item) => item.eventId !== eventId)
      if (next.length === state.assignments.length) return this.projectStatus(state)
      state.assignments = next
      const now = new Date().toISOString()
      state.volumes.forEach((volume) => {
        const next = volume.eventIds.filter((id) => id !== eventId)
        if (next.length !== volume.eventIds.length) volume.updatedAt = now
        volume.eventIds = next
      })
      state.eventChapterPlacements = state.eventChapterPlacements.filter((item) => item.eventId !== eventId)
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async createVolume(title: string): Promise<OutlinePlanningStatus> {
    const normalizedTitle = title.trim()
    if (!normalizedTitle || normalizedTitle.length > 120) throw new AppError('VALIDATION_ERROR', '卷名需要 1 到 120 个字符。', { recoverable: true })
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const volumes = await this.effectiveVolumes(state)
      if (volumes.some((item) => item.title.normalize('NFKC').toLocaleLowerCase('zh-CN') === normalizedTitle.normalize('NFKC').toLocaleLowerCase('zh-CN'))) {
        throw new AppError('CONFLICT', '已经有同名篇卷，请换一个名称。', { recoverable: true })
      }
      const nextVolume = Math.max(0, ...volumes.map((item) => item.volume)) + 1
      if (nextVolume > 1_000) throw new AppError('VALIDATION_ERROR', '篇卷数量已达到 1000 卷上限。', { recoverable: true })
      const now = new Date().toISOString()
      state.volumes.push({ volume: nextVolume, title: normalizedTitle, eventIds: [], revision: 0, outlineHash: hashText(''), createdAt: now, updatedAt: now })
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async initializeVolumeStructure(input: Array<{ order: number; title: string }>): Promise<OutlinePlanningStatus> {
    if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
      throw new AppError('VALIDATION_ERROR', '篇卷目录需要包含 1 到 100 卷。', { recoverable: true })
    }
    const candidate = input.map((item, index) => {
      const title = item.title.trim()
      if (item.order !== index + 1 || !title || title.length > 120) {
        throw new AppError('VALIDATION_ERROR', '候选卷序必须从 1 连续排列，卷名需要 1 到 120 个字符。', { recoverable: true })
      }
      return { order: item.order, title }
    })
    const candidateKeys = candidate.map((item) => volumeTitleKey(item.title))
    if (new Set(candidateKeys).size !== candidateKeys.length) {
      throw new AppError('CONFLICT', '自动谋篇候选包含重复卷名，请先修改后再初始化。', { recoverable: true })
    }
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const effective = await this.effectiveVolumes(state)
      const finalTitles = new Map(effective.map((item) => [item.volume, item.title]))
      candidate.forEach((item) => finalTitles.set(item.order, item.title))
      const finalKeys = [...finalTitles.values()].map(volumeTitleKey)
      if (new Set(finalKeys).size !== finalKeys.length) {
        throw new AppError('CONFLICT', '候选卷名与当前书稿保留的其他篇卷重名，请先调整候选或正式篇卷。', { recoverable: true })
      }
      let changed = false
      const now = new Date().toISOString()
      for (const item of candidate) {
        const current = effective.find((volume) => volume.volume === item.order)
        if (!current) {
          state.volumes.push({ volume: item.order, title: item.title, eventIds: [], revision: 0, outlineHash: hashText(''), createdAt: now, updatedAt: now })
          changed = true
          continue
        }
        if (current.title === item.title) continue
        const persisted = await this.materializeVolume(state, current)
        persisted.title = item.title
        persisted.updatedAt = now
        changed = true
      }
      if (!changed) return this.projectStatus(state)
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async renameVolume(volumeNumber: number, title: string): Promise<OutlinePlanningStatus> {
    const normalizedTitle = title.trim()
    if (!Number.isInteger(volumeNumber) || volumeNumber < 1 || volumeNumber > 1_000) throw new AppError('VALIDATION_ERROR', '卷号必须在 1 到 1000 之间。', { recoverable: true })
    if (!normalizedTitle || normalizedTitle.length > 120) throw new AppError('VALIDATION_ERROR', '卷名需要 1 到 120 个字符。', { recoverable: true })
    return this.serialize(async () => {
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const volumes = await this.effectiveVolumes(state)
      const target = volumes.find((item) => item.volume === volumeNumber)
      if (!target) throw new AppError('NOT_FOUND', '要改名的篇卷不存在。', { recoverable: true })
      const normalizedKey = normalizedTitle.normalize('NFKC').toLocaleLowerCase('zh-CN')
      if (volumes.some((item) => item.volume !== volumeNumber && item.title.normalize('NFKC').toLocaleLowerCase('zh-CN') === normalizedKey)) {
        throw new AppError('CONFLICT', '已经有同名篇卷，请换一个名称。', { recoverable: true })
      }
      if (target.title === normalizedTitle) return this.projectStatus(state)
      const now = new Date().toISOString()
      let persisted = state.volumes.find((item) => item.volume === volumeNumber)
      if (!persisted) {
        const content = (await this.documents.outline(volumeNumber)).content
        const snapshot = volumeSnapshot(undefined, content)
        persisted = { volume: volumeNumber, title: normalizedTitle, eventIds: [...target.eventIds], revision: snapshot.revision, outlineHash: snapshot.hash, createdAt: now, updatedAt: now }
        state.volumes.push(persisted)
      } else {
        persisted.title = normalizedTitle
        persisted.updatedAt = now
      }
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async placeEvent(eventId: string, volumeNumber: number | null): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      const state = await this.state()
      await this.approvedEvent(eventId, this.stateSources.get(state)?.root)
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const effectiveVolumes = await this.effectiveVolumes(state)
      const target = volumeNumber === null ? undefined : effectiveVolumes.find((item) => item.volume === volumeNumber)
      if (volumeNumber !== null && !target) throw new AppError('NOT_FOUND', '要分配的篇卷不存在。', { recoverable: true })
      const previousVolume = effectiveVolumes.find((item) => item.eventIds.includes(eventId))?.volume
      const alreadyInTotal = state.assignments.some((item) => item.eventId === eventId)
      const chapterPlacement = state.eventChapterPlacements.find((item) => item.eventId === eventId)
      if (!chapterPlacement && alreadyInTotal && previousVolume === (volumeNumber ?? undefined)) return this.projectStatus(state)
      const now = new Date().toISOString()
      state.eventChapterPlacements = state.eventChapterPlacements.filter((item) => item.eventId !== eventId)
      if (!alreadyInTotal) state.assignments.push({ eventId, assignedAt: now })
      state.volumes.forEach((item) => {
        const next = item.eventIds.filter((id) => id !== eventId)
        if (next.length !== item.eventIds.length) item.updatedAt = now
        item.eventIds = next
      })
      if (target) {
        let persisted = state.volumes.find((item) => item.volume === target.volume)
        if (!persisted) {
          const content = (await this.documents.outline(target.volume)).content
          const snapshot = volumeSnapshot(undefined, content)
          persisted = { volume: target.volume, title: target.title, eventIds: [], revision: snapshot.revision, outlineHash: snapshot.hash, createdAt: now, updatedAt: now }
          state.volumes.push(persisted)
        }
        persisted.eventIds.push(eventId)
        persisted.updatedAt = now
      }
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async placeChapter(chapterId: number, volumeNumber: number | null): Promise<OutlinePlanningStatus> {
    await this.documents.chapter(chapterId)
    return this.serialize(async () => {
      const state = await this.state()
      const total = await this.totalSnapshot(state)
      await this.reconcileState(state, total)
      if (volumeNumber !== null && !(await this.effectiveVolumes(state)).some((item) => item.volume === volumeNumber)) {
        throw new AppError('NOT_FOUND', '要分配的篇卷不存在。', { recoverable: true })
      }
      const previous = state.chapterPlacements.find((item) => item.chapterId === chapterId)
      const receipt = state.manuscriptStarts.find(item => item.chapterId === chapterId && !item.completed)
      if (receipt) {
        receipt.completed = true
      }
      if (previous?.volume === volumeNumber || (!previous && volumeNumber === null)) {
        // Even an explicit no-op unassignment cancels any pending automatic placement.
        if (receipt) await this.saveState(state)
        return this.projectStatus(state, chapterId)
      }
      state.chapterPlacements = state.chapterPlacements.filter((item) => item.chapterId !== chapterId)
      if (volumeNumber !== null) {
        const now = new Date().toISOString()
        state.chapterPlacements.push({ chapterId, volume: volumeNumber, assignedAt: previous?.assignedAt || now, updatedAt: now })
      }
      const linkedEventIds = state.eventChapterPlacements.filter((item) => item.chapterId === chapterId).map((item) => item.eventId)
      if (linkedEventIds.length) {
        state.volumes.forEach((volume) => { volume.eventIds = volume.eventIds.filter((eventId) => !linkedEventIds.includes(eventId)) })
        if (volumeNumber === null) {
          state.eventChapterPlacements = state.eventChapterPlacements.filter((item) => item.chapterId !== chapterId)
        } else {
          const effectiveTarget = (await this.effectiveVolumes(state)).find((item) => item.volume === volumeNumber)
          if (!effectiveTarget) throw new AppError('INVALID_PROJECT_STATE', '章节所属篇卷不存在。', { recoverable: true })
          const target = await this.materializeVolume(state, effectiveTarget)
          target.eventIds.push(...linkedEventIds.filter((eventId) => !target.eventIds.includes(eventId)))
          target.updatedAt = new Date().toISOString()
        }
      }
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async placeEventInChapter(eventId: string, chapterId: number): Promise<OutlinePlanningStatus> {
    await this.documents.chapter(chapterId)
    return this.serialize(async () => {
      const state = await this.state()
      await this.approvedEvent(eventId, this.stateSources.get(state)?.root)
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      const chapter = state.chapterPlacements.find((item) => item.chapterId === chapterId)
      if (!chapter) throw new AppError('CONFLICT', '请先把章节归入篇卷，再把事件放入该章。', { recoverable: true })
      const effectiveTarget = (await this.effectiveVolumes(state)).find((item) => item.volume === chapter.volume)
      if (!effectiveTarget) throw new AppError('INVALID_PROJECT_STATE', '章节所属篇卷不存在。', { recoverable: true })
      const target = await this.materializeVolume(state, effectiveTarget)
      const previous = state.eventChapterPlacements.find((item) => item.eventId === eventId)
      if (previous?.chapterId === chapterId) return this.projectStatus(state, chapterId)
      const now = new Date().toISOString()
      if (!state.assignments.some((item) => item.eventId === eventId)) state.assignments.push({ eventId, assignedAt: now })
      state.volumes.forEach((volume) => { volume.eventIds = volume.eventIds.filter((id) => id !== eventId) })
      target.eventIds.push(eventId)
      target.updatedAt = now
      state.eventChapterPlacements = state.eventChapterPlacements.filter((item) => item.eventId !== eventId)
      state.eventChapterPlacements.push({ eventId, chapterId, assignedAt: previous?.assignedAt || now, updatedAt: now })
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async chapterEvents(chapterId: number): Promise<PlanningApprovedEvent[]> {
    const state = await this.state()
    const ids = state.eventChapterPlacements.filter((item) => item.chapterId === chapterId).map((item) => item.eventId)
    if (!ids.length) return []
    const events = new Map((await this.approvedEvents(this.stateSources.get(state)?.root)).map((item) => [item.id, item]))
    const missing = ids.filter((id) => !events.has(id))
    if (missing.length) throw new AppError('INVALID_PROJECT_STATE', '本章引用的正式事件已归档、缺失或损坏，请先在谋篇中核对。', { recoverable: true, details: { eventIds: missing } })
    return ids.map((id) => events.get(id)!)
  }

  async inspectChapterEvents(chapterId: number): Promise<ChapterEventReference[]> {
    const state = await this.inspectState()
    const root = this.stateSources.get(state)?.root
    const ids = chapterEventIds(state, chapterId)
    if (ids.length > 200) throw new AppError('VALIDATION_ERROR', '本章关联事件超过单次核对上限，请在纪事中核对。', { recoverable: true })
    const events = ids.length ? new Map((await this.approvedEvents(root)).map(event => [event.id, event])) : new Map<string, PlanningApprovedEvent>()
    if (root !== await this.projects.currentPath()) throw new AppError('CONFLICT', '作品已切换，请重新核对。', { recoverable: true })
    return ids.map(id => {
      const event = events.get(id)
      if (!event) throw new AppError('INVALID_PROJECT_STATE', '本章关联的正式事件缺失或已归档，请先核对纪事。', { recoverable: true })
      return { id, version: event.versionId ?? null, phase: event.phase ?? 'legacy-unknown', time: event.time,
        replaceable: event.phase === 'planned' && event.granularity === 'chapter-detail' && (state.chapterEventOutputs ?? []).some(o => o.chapterId === chapterId && chapterEventOutputItems(o).some(e => e.eventId === id)),
        characters: [...event.characters], location: event.location, event: event.event, result: event.result ?? null }
    })
  }

  async chapterVolumeContext(chapterId: number, statusSnapshot?: OutlinePlanningStatus): Promise<{ volume: number; title: string; content: string } | null> {
    if (statusSnapshot?.chapter?.chapterId !== undefined && statusSnapshot.chapter.chapterId !== chapterId)
      throw new AppError('CONFLICT', '章节规划在上下文读取期间发生变化，请重新预览。', { recoverable: true })
    const status = statusSnapshot ?? await this.status(chapterId)
    const volumeNumber = status.chapter?.volume
    if (!volumeNumber) return null
    const volume = status.volumes.find((item) => item.volume === volumeNumber)
    if (!volume) return null
    return { volume: volumeNumber, title: volume.title, content: (await this.documents.outline(volumeNumber)).content }
  }

  private async projectStatus(state: OutlineState, chapterId?: number): Promise<OutlinePlanningStatus> {
    const outlineDocuments = await this.documents.outlines()
    const snapshot = await this.totalSnapshot(state, outlineDocuments.total?.content || '')
    const totalRevision = snapshot.revision
    const effectiveVolumes = await this.effectiveVolumes(state, outlineDocuments.volumes)
    const placedEventIds = new Set(effectiveVolumes.flatMap((item) => item.eventIds))
    const unplacedEventIds = state.assignments.map((item) => item.eventId).filter((id) => !placedEventIds.has(id))
    const totalReview = planningReview(
      state,
      'total',
      snapshot.content,
      state.assignments.map((item) => item.eventId),
      state.chapterPlacements.map((item) => item.chapterId),
      [
        `total-revision:${totalRevision}`,
        ...effectiveVolumes.map((item) => `volume:${item.volume}:${[...item.eventIds].sort().join(',')}`),
        ...state.chapterPlacements.map((item) => `chapter:${item.chapterId}:${item.volume}`)
      ],
      { volumeCount: effectiveVolumes.length, unplacedEventCount: unplacedEventIds.length }
    )
    const reviewedVolumes = effectiveVolumes.map((volume) => {
      const chapterIds = state.chapterPlacements.filter((item) => item.volume === volume.volume).map((item) => item.chapterId)
      const content = outlineDocuments.volumes.find((item) => item.volume === volume.volume)?.content || ''
      return {
        ...volume,
        content,
        review: planningReview(state, volume.volume, content, volume.eventIds, chapterIds, [
          `volume-title:${volume.title}`,
          `volume-revision:${volume.revision}`
        ], {})
      }
    })
    const totalApproval = planningApproval(state, 'total', Boolean(snapshot.content.trim()), totalReview, undefined, undefined, hashText(JSON.stringify({ scope: 'total', content: snapshot.hash })))
    const volumes: OutlinePlanningVolume[] = reviewedVolumes.map(({ content, ...volume }) => ({
      ...volume,
      approval: planningApproval(state, volume.volume, Boolean(content.trim()), volume.review, totalApproval, totalApproval.fingerprint, hashText(JSON.stringify({ scope: volume.volume, title: volume.title, content: hashText(content) })))
    }))
    const status: OutlinePlanningStatus = {
      totalRevision,
      totalOutlineExists: Boolean(snapshot.content.trim()),
      externalChangeDetected: snapshot.externalChange,
      totalReview,
      totalApproval,
      assignedEventIds: state.assignments.map((item) => item.eventId),
      unplacedEventIds,
      volumes,
      chapterPlacements: state.chapterPlacements.map(({ chapterId, volume }) => ({ chapterId, volume })),
      eventChapterPlacements: state.eventChapterPlacements.map(({ eventId, chapterId }) => ({ eventId, chapterId }))
    }
    if (!chapterId) return status
    const chapter = await this.documents.chapterOutline(chapterId)
    const dependency = state.chapters.find((item) => item.chapterId === chapterId)
    const placement = state.chapterPlacements.find((item) => item.chapterId === chapterId)
    const placedVolume = placement ? volumes.find((item) => item.volume === placement.volume) : undefined
    const hasContent = Boolean(chapter.content.trim())
    const legacyBaseline = hasContent && state.total.revision === 0 && snapshot.revision > 0
    const contentChangedOutsideApp = Boolean(dependency && dependency.outlineHash !== hashText(chapter.content))
    const basedOnTotalRevision = dependency?.basedOnTotalRevision ?? (legacyBaseline ? totalRevision : undefined)
    const volumeChanged = dependency?.volume !== placement?.volume
    const volumeStale = Boolean(placement && (
      !placedVolume || dependency?.basedOnVolumeRevision === undefined
      || dependency.basedOnVolumeRevision !== placedVolume.revision
      || placedVolume.externalChangeDetected
    ))
    // One status uses the outlines it just read; independent mutations still
    // acquire fresh sources and every event/root check remains in the helpers.
    const currentSources = await this.chapterSources(state, chapterId, outlineDocuments)
    const sourceReasons = dependency?.sources ? changedPlanningSources(dependency.sources, currentSources) : []
    const skeleton = skeletonHeads(state.formalSkeleton ?? []).get(chapterId)
    if (skeleton) {
      const latestSkeletonSources = await this.skeletonSources(state, skeleton.entry, outlineDocuments)
      if (changedPlanningSources(skeleton.sources, latestSkeletonSources).length) sourceReasons.push('本章正式骨架的上游已变化，请先复核章节安排')
    }
    const stale = hasContent && (dependency?.sources
      ? sourceReasons.length > 0 || contentChangedOutsideApp
      : (basedOnTotalRevision === undefined || basedOnTotalRevision !== totalRevision || snapshot.externalChange || contentChangedOutsideApp || volumeChanged || volumeStale))
    const eventIds = chapterEventIds(state, chapterId)
    const eventSnapshot = await this.chapterEventDependencies(state, chapterId)
    const record = state.chapterStoryContracts?.find(c => c.chapterId === chapterId)
    const contractCurrent = record && record.outlineHash === hashText(chapter.content) && !changedPlanningSources(record.sources, currentSources).length
    const parsed = parseChapterOutline(chapter.content)
    const legacy = !record && Boolean(parsed.entryState || parsed.exitState || parsed.allowedFacts.length || parsed.forbiddenEvents.length)
    const audit = auditChapterOutline(chapter.content, eventIds.length, contractCurrent ? record.constraints : undefined)
    if (hasContent && !contractCurrent && !legacy) audit.issues = [{ code: 'STORY_CONTRACT_REQUIRED', level: 'error', message: record ? '故事章纲或其依据已变化，请重新准备并核对写作约束。' : '请准备并核对写作约束；故事章纲无需添加机器标签。' }]
    const upstreamIssue = totalApproval.status !== 'confirmed'
      ? { code: 'TOTAL_OUTLINE_UNCONFIRMED', level: 'error' as const, message: '请先确认当前总纲版本，再确认章纲。' }
      : placement && placedVolume?.approval.status !== 'confirmed'
        ? { code: 'VOLUME_OUTLINE_UNCONFIRMED', level: 'error' as const, message: '请先确认当前卷纲版本，再确认本章章纲。' }
        : null
    const projection = await this.unifiedProjection(this.stateSources.get(state)?.root)
    const upstream = reviewRefinements({ chapterId, outlineHash: hashText(chapter.content), sources: currentSources,
      eventIds, approved: projection?.approved ?? [], history: state.upstreamReviewDecisions ?? [] })
    const upstreamPending = upstream.findings.some(f => f.status !== 'clear' && f.status !== 'no-conflict')
    const reviewIssue = upstreamPending ? [{ code: 'UPSTREAM_REVIEW_REQUIRED', level: 'error' as const, message: '本章细化事件与来源需要作者复核；请在上行复核中记录判断。' }] : []
    const issues = [ ...audit.issues, ...reviewIssue, ...(upstreamIssue ? [upstreamIssue] : []), ...sourceReasons.map(message => ({ code: 'PLANNING_SOURCE_CHANGED', level: 'error' as const, message })) ]
    const confirmation = state.chapterConfirmations.find((item) => item.chapterId === chapterId)
    const confirmationCurrent = Boolean(confirmation && dependency
      && confirmation.outlineHash === hashText(chapter.content)
      && (confirmation.sources ? changedPlanningSources(confirmation.sources, currentSources).length === 0 : confirmation.basedOnTotalRevision === totalRevision)
      && confirmation.basedOnVolumeRevision === dependency.basedOnVolumeRevision
      && sameStrings(confirmation.eventIds, eventIds)
      && sameEventVersions(confirmation.eventVersions ?? [], eventSnapshot.eventVersions)
      && !upstreamIssue && !upstreamPending)
    const hasAuditErrors = audit.issues.some((item) => item.level === 'error')
    const reviewStatus: ChapterOutlineReview['status'] = !hasContent
      ? 'missing'
      : hasAuditErrors
        ? 'needs-changes'
        : confirmationCurrent && !stale
          ? 'confirmed'
          : stale || confirmation
            ? 'stale'
            : upstreamIssue || upstreamPending ? 'needs-changes' : 'ready'
    const contractVersion = confirmationCurrent && !stale && !hasAuditErrors && confirmation ? {
      ...(contractCurrent ? { storyConstraints: structuredClone(record.constraints) } : {}),
      totalFingerprint: totalApproval.fingerprint,
      ...(placedVolume ? { volumeFingerprint: placedVolume.approval.fingerprint } : {}),
      outlineHash: confirmation.outlineHash,
      eventIds: [...eventIds].sort(),
      ...(eventSnapshot.eventVersions.length ? { eventVersions: eventSnapshot.eventVersions.map((item) => ({ ...item })) } : {}),
      ...(eventSnapshot.approvedRevision ? { eventApprovedRevision: eventSnapshot.approvedRevision } : {}),
      confirmedAt: confirmation.confirmedAt,
      fingerprint: hashText(JSON.stringify({
        chapterId,
        totalFingerprint: totalApproval.fingerprint,
        volumeFingerprint: placedVolume?.approval.fingerprint || '',
        outlineHash: confirmation.outlineHash,
        eventIds: [...eventIds].sort(),
        eventVersions: eventSnapshot.eventVersions,
        sources: currentSources,
        ...(contractCurrent ? { storyConstraints: record.constraints } : {}),
        confirmedAt: confirmation.confirmedAt
      }))
    } : undefined
    status.chapter = {
      chapterId,
      hasContent,
      ...(placement ? { volume: placement.volume, volumeRevision: placedVolume?.revision } : {}),
      ...(basedOnTotalRevision !== undefined ? { basedOnTotalRevision } : {}),
      ...(dependency?.basedOnVolumeRevision !== undefined ? { basedOnVolumeRevision: dependency.basedOnVolumeRevision } : {}),
      stale,
      reason: !hasContent ? 'missing' : (!dependency && !legacyBaseline) || contentChangedOutsideApp ? 'untracked' : stale ? 'upstream-changed' : 'current',
      review: {
        status: reviewStatus,
        canConfirm: hasContent && !stale && !hasAuditErrors && !upstreamIssue && !upstreamPending,
        ...(upstream.findings.length || upstream.history.length ? { upstream } : {}),
        issues,
        metrics: audit.metrics,
        ...(confirmation ? { confirmedAt: confirmation.confirmedAt } : {})
      },
      ...(contractVersion ? { contractVersion } : {})
    }
    return status
  }

  private async approvedEvent(eventId: string, expectedRoot?: string): Promise<PlanningApprovedEvent> {
    const unified = await this.unifiedProjection(expectedRoot)
    if (unified) {
      const event = unified.approved.find((item) => item.eventId === eventId)
      if (event) return projectedPlanningEvent(event)
      if (unified.candidates.some((item) => item.eventId === eventId)) {
        throw new AppError('CONFLICT', '事件仍是候选，必须先确认入库才能参与谋篇。', { recoverable: true })
      }
      if (unified.archived.some((item) => item.lifecycle.eventId === eventId)) {
        throw new AppError('CONFLICT', '事件已归档，恢复后才能参与谋篇。', { recoverable: true })
      }
      throw new AppError('NOT_FOUND', '要分配的事件不存在。', { recoverable: true })
    }
    const event = (await this.research.listEvents()).events.find((item) => item.id === eventId)
    if (expectedRoot && await this.projects.currentPath() !== expectedRoot) throw new AppError('CONFLICT', '作品已切换，请重新操作。', { recoverable: true })
    if (!event) throw new AppError('NOT_FOUND', '要分配的事件不存在。', { recoverable: true })
    if (event.status !== 'approved') throw new AppError('CONFLICT', '事件仍是候选，必须先确认入库才能参与谋篇。', { recoverable: true })
    return event
  }

  private async approvedEvents(expectedRoot?: string): Promise<PlanningApprovedEvent[]> {
    const unified = await this.unifiedProjection(expectedRoot)
    if (unified) return unified.approved.map(projectedPlanningEvent)
    const events = (await this.research.listEvents()).events.filter((item) => item.status === 'approved')
    if (expectedRoot && await this.projects.currentPath() !== expectedRoot) throw new AppError('CONFLICT', '作品已切换，请重新操作。', { recoverable: true })
    return events
  }

  private async chapterEventDependencies(state: OutlineState, chapterId: number): Promise<{ approvedRevision: string | null; eventVersions: PlanningEventVersion[] }> {
    const ids = chapterEventIds(state, chapterId)
    if (!ids.length) return { approvedRevision: null, eventVersions: [] }
    const expectedRoot = this.stateSources.get(state)?.root
    const unified = await this.unifiedProjection(expectedRoot)
    if (!unified) return { approvedRevision: null, eventVersions: [] }
    const events = new Map(unified.approved.map((item) => [item.eventId, item]))
    const missing = ids.filter((id) => !events.has(id))
    if (missing.length) throw new AppError('INVALID_PROJECT_STATE', '本章引用的正式事件已归档、缺失或损坏，请先在谋篇中核对。', { recoverable: true, details: { eventIds: missing } })
    return {
      approvedRevision: unified.approvedRevision,
      eventVersions: ids.map((eventId) => {
        const event = events.get(eventId)!
        return { eventId, versionId: event.versionId, phase: event.phase }
      })
    }
  }

  private async unifiedProjection(expectedRoot?: string): Promise<UnifiedEventProjection | null> {
    const projection = await this.unifiedEvents?.read() ?? null
    if (expectedRoot && await this.projects.currentPath() !== expectedRoot) throw new AppError('CONFLICT', '作品已切换，请重新操作。', { recoverable: true })
    return projection
  }

  private async effectiveVolumes(state: OutlineState, existingOutlines?: VolumeOutline[]): Promise<EffectiveVolume[]> {
    const existing = existingOutlines ?? (await this.documents.outlineTree()).volumes
    const planned = new Map(state.volumes.map((item) => [item.volume, item]))
    const numbers = new Set([...state.volumes.map((item) => item.volume), ...existing.map((item) => item.volume)])
    return [...numbers].sort((left, right) => left - right).map((volume) => {
      const stored = planned.get(volume)
      const legacy = existing.find((item) => item.volume === volume)
      const snapshot = volumeSnapshot(stored, legacy?.content || '')
      return {
        volume,
        title: stored?.title || legacy?.title || `第${volume}卷`,
        eventIds: [...(stored?.eventIds || [])],
        origin: stored ? 'planned' : 'existing-outline',
        revision: snapshot.revision,
        outlineExists: Boolean((legacy?.content || '').trim()),
        externalChangeDetected: snapshot.externalChange
      }
    })
  }

  private async materializeVolume(state: OutlineState, volume: EffectiveVolume): Promise<PlannedVolume> {
    const content = (await this.documents.outline(volume.volume)).content
    const existing = state.volumes.find((item) => item.volume === volume.volume)
    const snapshot = volumeSnapshot(existing, content)
    const now = new Date().toISOString()
    if (existing) {
      if (existing.revision !== snapshot.revision || existing.outlineHash !== snapshot.hash) {
        existing.revision = snapshot.revision
        existing.outlineHash = snapshot.hash
        existing.updatedAt = now
      }
      return existing
    }
    const created: PlannedVolume = {
      volume: volume.volume,
      title: volume.title,
      eventIds: [...volume.eventIds],
      revision: snapshot.revision,
      outlineHash: snapshot.hash,
      createdAt: now,
      updatedAt: now
    }
    state.volumes.push(created)
    return created
  }

  private async totalSnapshot(state: OutlineState, providedContent?: string): Promise<{ content: string; hash: string; revision: number; externalChange: boolean }> {
    const content = providedContent === undefined ? (await this.documents.outline('total')).content : providedContent
    const hash = hashText(content)
    if (state.total.revision === 0) return { content, hash, revision: content.trim() ? 1 : 0, externalChange: false }
    const externalChange = state.total.hash !== hash
    return { content, hash, revision: externalChange ? state.total.revision + 1 : state.total.revision, externalChange }
  }

  private async reconcileState(state: OutlineState, snapshot: { hash: string; revision: number; externalChange: boolean }): Promise<void> {
    const needsLegacyBaseline = state.total.revision === 0 && snapshot.revision > 0
    reconcileTotal(state, snapshot)
    if (!needsLegacyBaseline) return
    const existing = await this.documents.chapterOutlines()
    for (const chapter of existing) {
      if (!chapter.content.trim() || state.chapters.some((item) => item.chapterId === chapter.chapterId)) continue
      state.chapters.push({
        chapterId: chapter.chapterId,
        basedOnTotalRevision: snapshot.revision,
        outlineHash: hashText(chapter.content),
        savedAt: new Date().toISOString()
      })
    }
  }

  private async state(file?: string): Promise<OutlineState> {
    const root = await this.projects.currentPath()
    if (this.formalStates && await this.formalStates.active(root)) {
      if (!await this.formalStates.outlinePlanningStateReady(root)) {
        const legacy = await this.readLegacy(root, file)
        await this.formalStates.importOutlinePlanningState(root, JSON.stringify(legacy.state), legacy.observedHash)
      }
      const formal = await this.formalStates.outlinePlanningState(root)
      let state: OutlineState
      try { state = normalizeState(JSON.parse(formal.content)) }
      catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError('INVALID_PROJECT_STATE', 'SQLite 中的谋篇工作流损坏，已停止写入。', { recoverable: false })
      }
      this.stateSources.set(state, { root, contentHash: formal.contentHash, history: structuredClone(state.formalSkeleton ?? []) })
      return state
    }
    const legacy = await this.readLegacy(root, file)
    this.stateSources.set(legacy.state, { root, history: structuredClone(legacy.state.formalSkeleton ?? []) })
    return legacy.state
  }

  private async readLegacy(root: string, file?: string): Promise<{ state: OutlineState; observedHash?: string }> {
    try {
      const raw = await readFile(file ?? await this.file(root), 'utf8')
      return { state: normalizeState(JSON.parse(raw)), observedHash: hashText(raw) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyState() }
      if (error instanceof AppError) throw error
      throw new AppError('INVALID_PROJECT_STATE', '大纲版本账本损坏，已停止写入以保护现有总纲与章纲。', { recoverable: true })
    }
  }

  private async saveState(state: OutlineState): Promise<void> {
    const source = this.stateSources.get(state)
    const root = source?.root ?? await this.projects.currentPath()
    if (await this.projects.currentPath() !== root) throw new AppError('CONFLICT', '作品已切换，未写入上一部作品的谋篇状态。', { recoverable: true })
    assertSkeletonHistoryAppend(source?.history ?? [], state.formalSkeleton ?? [])
    const content = JSON.stringify(state)
    if (this.formalStates && await this.formalStates.active(root)) {
      const expectedContentHash = source?.contentHash ?? hashText(content)
      const saved = await this.formalStates.replaceOutlinePlanningState(root, expectedContentHash, content)
      this.stateSources.set(state, { root, contentHash: saved.contentHash, history: structuredClone(state.formalSkeleton ?? []) })
      return
    }
    await writeJson(await this.file(root), state)
  }

  private async file(selectedRoot?: string): Promise<string> {
    const root = selectedRoot ?? await this.projects.currentPath()
    return projectDirectory(root, join(root, '.webnovel', 'planning', 'outline-state.json'))
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release = (): void => undefined
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

function reconcileTotal(state: OutlineState, snapshot: { hash: string; revision: number; externalChange: boolean }): void {
  if (state.total.revision === snapshot.revision && !snapshot.externalChange && state.total.hash === snapshot.hash) return
  state.total.revision = snapshot.revision
  state.total.hash = snapshot.hash
  state.total.updatedAt = new Date().toISOString()
}

function planningReview(
  state: OutlineState,
  scope: OutlineVolume,
  content: string,
  eventIds: string[],
  chapterIds: number[],
  structureKeys: string[],
  extra: { volumeCount?: number; unplacedEventCount?: number }
): PlanningOutlineReview {
  const sortedEventIds = [...eventIds].sort()
  const sortedChapterIds = [...chapterIds].sort((left, right) => left - right)
  const audit = auditPlanningOutline({
    scope: scope === 'total' ? 'total' : 'volume',
    content,
    eventCount: sortedEventIds.length,
    chapterCount: sortedChapterIds.length,
    ...extra
  })
  const fingerprint = hashText(JSON.stringify({
    scope,
    outlineHash: hashText(content),
    eventIds: sortedEventIds,
    chapterIds: sortedChapterIds,
    structureKeys: [...structureKeys].sort()
  }))
  const issueCodes = audit.issues.map((item) => item.code).sort()
  const acknowledgement = state.outlineReviewAcknowledgements.find((item) => item.scope === scope)
  const acknowledged = Boolean(acknowledgement
    && acknowledgement.fingerprint === fingerprint
    && sameStrings(acknowledgement.issueCodes, issueCodes))
  return {
    scope,
    status: issueCodes.length ? acknowledged ? 'acknowledged' : 'attention' : 'clear',
    issues: audit.issues,
    metrics: audit.metrics,
    fingerprint,
    ...(acknowledged ? { acknowledgedAt: acknowledgement?.acknowledgedAt } : {})
  }
}

function planningApproval(
  state: OutlineState,
  scope: OutlineVolume,
  hasContent: boolean,
  review: PlanningOutlineReview,
  totalApproval?: PlanningOutlineApproval,
  totalFingerprint?: string,
  approvalFingerprint = review.fingerprint
): PlanningOutlineApproval {
  const confirmation = state.planningConfirmations.find((item) => item.scope === scope)
  const reviewReady = review.status === 'clear' || review.status === 'acknowledged'
  const parentReady = scope === 'total' || totalApproval?.status === 'confirmed'
  const current = Boolean(confirmation
    && confirmation.fingerprint === approvalFingerprint
    && (scope === 'total' || confirmation.basedOnTotalFingerprint === totalFingerprint)
    && parentReady)
  const status: PlanningOutlineApproval['status'] = !hasContent
    ? 'missing'
    : current
      ? 'confirmed'
      : confirmation
        ? 'stale'
        : !reviewReady
          ? 'needs-review'
          : !parentReady
            ? 'blocked'
            : 'ready'
  const reason = status === 'missing'
    ? '请先保存当前大纲正文。'
    : status === 'needs-review'
      ? '请先处理或标记当前预审提示，再正式确认。'
      : status === 'blocked'
        ? '请先确认当前总纲版本。'
        : status === 'stale'
          ? '大纲正文或层级结构已经变化，请重新核对并确认。'
          : status === 'confirmed'
            ? '当前正文与层级结构已经正式确认。'
            : '当前版本可以正式确认。'
  return {
    scope,
    status,
    canConfirm: hasContent && reviewReady && parentReady && !current,
    reason,
    fingerprint: approvalFingerprint,
    ...(current ? { confirmedAt: confirmation?.confirmedAt } : {})
  }
}

function normalizeState(value: unknown): OutlineState {
  if (!value || typeof value !== 'object') throw corruptState()
  const candidate = value as Partial<OutlineState>
  if (candidate.version !== 1 || !candidate.total || typeof candidate.total !== 'object') throw corruptState()
  const records = candidate.chapterStoryContracts
  if (records !== undefined) {
    if (!Array.isArray(records) || records.length > 50_000 || new Set(records.map(r => r?.chapterId)).size !== records.length) throw corruptState()
    for (const r of records) {
      if (!r || !Number.isSafeInteger(r.chapterId) || r.chapterId < 1 || r.chapterId > 1_000_000 || !/^[a-f0-9]{64}$/.test(r.outlineHash)) throw corruptState()
      assertPlanningSources(r.sources)
      try { decodeChapterStoryConstraints(r.constraints) } catch { throw corruptState() }
    }
  }
  const revision = Number(candidate.total.revision)
  const manuscriptStarts = candidate.manuscriptStarts === undefined ? [] : candidate.manuscriptStarts
  if (!Array.isArray(manuscriptStarts) || !manuscriptStarts.every(item => item
    && Number.isSafeInteger(item.chapterId) && item.chapterId > 0 && item.chapterId <= 1_000_000
    && typeof item.revision === 'string' && /^[a-f0-9]{64}$/.test(item.revision)
    && (item.volume === null || (Number.isInteger(item.volume) && item.volume > 0 && item.volume <= 1_000))
    && typeof item.completed === 'boolean')
    || new Set(manuscriptStarts.map(item => item.chapterId)).size !== manuscriptStarts.length) throw corruptState()
  if (!Array.isArray(candidate.assignments) || !candidate.assignments.every((item) => item && typeof item.eventId === 'string' && typeof item.assignedAt === 'string')) throw corruptState()
  const rawVolumes = candidate.volumes === undefined ? [] : candidate.volumes
  if (!Array.isArray(rawVolumes) || !rawVolumes.every((item) => (
    item && Number.isInteger(item.volume) && item.volume > 0 && item.volume <= 1_000
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 120
    && Array.isArray(item.eventIds) && item.eventIds.every((id) => typeof id === 'string' && id.length > 0)
    && (item.revision === undefined || (Number.isInteger(item.revision) && item.revision >= 0))
    && (item.outlineHash === undefined || typeof item.outlineHash === 'string')
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'
  ))) throw corruptState()
  if (new Set(rawVolumes.map((item) => item.volume)).size !== rawVolumes.length) throw corruptState()
  const rawPlacements = candidate.chapterPlacements === undefined ? [] : candidate.chapterPlacements
  if (!Array.isArray(rawPlacements) || !rawPlacements.every((item) => (
    item && Number.isInteger(item.chapterId) && item.chapterId > 0
    && Number.isInteger(item.volume) && item.volume > 0 && item.volume <= 1_000
    && typeof item.assignedAt === 'string' && typeof item.updatedAt === 'string'
  ))) throw corruptState()
  if (new Set(rawPlacements.map((item) => item.chapterId)).size !== rawPlacements.length) throw corruptState()
  const rawEventChapterPlacements = candidate.eventChapterPlacements === undefined ? [] : candidate.eventChapterPlacements
  if (!Array.isArray(rawEventChapterPlacements) || !rawEventChapterPlacements.every((item) => (
    item && typeof item.eventId === 'string' && item.eventId.length > 0
    && Number.isInteger(item.chapterId) && item.chapterId > 0
    && typeof item.assignedAt === 'string' && typeof item.updatedAt === 'string'
  ))) throw corruptState()
  if (new Set(rawEventChapterPlacements.map((item) => item.eventId)).size !== rawEventChapterPlacements.length) throw corruptState()
  if (!Array.isArray(candidate.chapters) || !candidate.chapters.every((item) => (
    item && Number.isInteger(item.chapterId) && item.chapterId > 0 && Number.isInteger(item.basedOnTotalRevision)
    && (item.volume === undefined || (Number.isInteger(item.volume) && item.volume > 0 && item.volume <= 1_000))
    && (item.basedOnVolumeRevision === undefined || (Number.isInteger(item.basedOnVolumeRevision) && item.basedOnVolumeRevision >= 0))
    && typeof item.outlineHash === 'string' && typeof item.savedAt === 'string'
  ))) throw corruptState()
  const assignments = candidate.assignments as OutlineAssignment[]
  const volumes = rawVolumes.map((item) => ({ ...item, revision: item.revision ?? 0, outlineHash: item.outlineHash ?? hashText('') })) as PlannedVolume[]
  const chapterPlacements = rawPlacements as ChapterPlacement[]
  const eventChapterPlacements = rawEventChapterPlacements as EventChapterPlacement[]
  const chapters = candidate.chapters as ChapterDependency[]
  for (const item of chapters) if (item.sources !== undefined) assertPlanningSources(item.sources)
  if (candidate.upstreamReviewDecisions !== undefined) assertUpstreamReviewHistory(candidate.upstreamReviewDecisions)
  if (candidate.formalSkeleton !== undefined) assertSkeletonHistory(candidate.formalSkeleton)
  if (candidate.chapterEventOutputs !== undefined) assertChapterEventOutputs(candidate.chapterEventOutputs)
  const rawConfirmations = candidate.chapterConfirmations === undefined ? [] : candidate.chapterConfirmations
  if (!Array.isArray(rawConfirmations) || !rawConfirmations.every((item) => (
    item && Number.isInteger(item.chapterId) && item.chapterId > 0
    && typeof item.outlineHash === 'string' && /^[a-f0-9]{64}$/.test(item.outlineHash)
    && Number.isInteger(item.basedOnTotalRevision) && item.basedOnTotalRevision >= 0
    && (item.basedOnVolumeRevision === undefined || (Number.isInteger(item.basedOnVolumeRevision) && item.basedOnVolumeRevision >= 0))
    && Array.isArray(item.eventIds) && item.eventIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(item.eventIds).size === item.eventIds.length
    && (item.eventVersions === undefined || (Array.isArray(item.eventVersions)
      && item.eventVersions.every((entry) => entry && typeof entry.eventId === 'string' && item.eventIds.includes(entry.eventId)
        && typeof entry.versionId === 'string' && entry.versionId.length > 0
        && (entry.phase === 'planned' || entry.phase === 'realized' || entry.phase === 'deviated' || entry.phase === 'legacy-unknown'))
      && new Set(item.eventVersions.map((entry) => entry.eventId)).size === item.eventVersions.length))
    && (item.eventApprovedRevision === undefined || (typeof item.eventApprovedRevision === 'string' && /^[a-f0-9]{64}$/.test(item.eventApprovedRevision)))
    && typeof item.confirmedAt === 'string' && !Number.isNaN(Date.parse(item.confirmedAt))
  ))) throw corruptState()
  for (const item of rawConfirmations) if (item.sources !== undefined) assertPlanningSources(item.sources)
  const chapterConfirmations = rawConfirmations.map((item) => ({
    ...item,
    eventIds: [...item.eventIds].sort(),
    ...(item.eventVersions ? { eventVersions: [...item.eventVersions].sort((left, right) => left.eventId.localeCompare(right.eventId)) } : {})
  })) as ChapterConfirmation[]
  if (new Set(chapterConfirmations.map((item) => item.chapterId)).size !== chapterConfirmations.length) throw corruptState()
  const rawAcknowledgements = candidate.outlineReviewAcknowledgements === undefined ? [] : candidate.outlineReviewAcknowledgements
  if (!Array.isArray(rawAcknowledgements) || !rawAcknowledgements.every((item) => (
    item && (item.scope === 'total' || (Number.isInteger(item.scope) && item.scope > 0 && item.scope <= 1_000))
    && typeof item.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.fingerprint)
    && Array.isArray(item.issueCodes) && item.issueCodes.length > 0
    && item.issueCodes.every((code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code))
    && new Set(item.issueCodes).size === item.issueCodes.length
    && typeof item.acknowledgedAt === 'string' && !Number.isNaN(Date.parse(item.acknowledgedAt))
  ))) throw corruptState()
  const outlineReviewAcknowledgements = rawAcknowledgements.map((item) => ({ ...item, issueCodes: [...item.issueCodes].sort() })) as PlanningReviewAcknowledgement[]
  if (new Set(outlineReviewAcknowledgements.map((item) => String(item.scope))).size !== outlineReviewAcknowledgements.length) throw corruptState()
  const rawPlanningConfirmations = candidate.planningConfirmations === undefined ? [] : candidate.planningConfirmations
  if (!Array.isArray(rawPlanningConfirmations) || !rawPlanningConfirmations.every((item) => (
    item && (item.scope === 'total' || (Number.isInteger(item.scope) && item.scope > 0 && item.scope <= 1_000))
    && typeof item.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.fingerprint)
    && (item.scope === 'total'
      ? item.basedOnTotalFingerprint === undefined
      : typeof item.basedOnTotalFingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.basedOnTotalFingerprint))
    && typeof item.confirmedAt === 'string' && !Number.isNaN(Date.parse(item.confirmedAt))
  ))) throw corruptState()
  const planningConfirmations = rawPlanningConfirmations as PlanningConfirmation[]
  if (new Set(planningConfirmations.map((item) => String(item.scope))).size !== planningConfirmations.length) throw corruptState()
  if (new Set(chapters.map((item) => item.chapterId)).size !== chapters.length) throw corruptState()
  if (chapterConfirmations.some((item) => !chapters.some((chapter) => chapter.chapterId === item.chapterId))) throw corruptState()
  const assignedEventIds = assignments.map((item) => item.eventId)
  if (new Set(assignedEventIds).size !== assignedEventIds.length) throw corruptState()
  const placedEventIds = volumes.flatMap((item) => item.eventIds)
  if (new Set(placedEventIds).size !== placedEventIds.length || placedEventIds.some((id) => !assignedEventIds.includes(id))) throw corruptState()
  const chapterIds = new Set(chapterPlacements.map((item) => item.chapterId))
  if (eventChapterPlacements.some((item) => !assignedEventIds.includes(item.eventId) || !placedEventIds.includes(item.eventId) || !chapterIds.has(item.chapterId))) throw corruptState()
  const eventVolume = new Map(volumes.flatMap((volume) => volume.eventIds.map((eventId) => [eventId, volume.volume] as const)))
  const chapterVolume = new Map(chapterPlacements.map((item) => [item.chapterId, item.volume]))
  if (eventChapterPlacements.some((item) => eventVolume.get(item.eventId) !== chapterVolume.get(item.chapterId))) throw corruptState()
  return {
    version: 1,
    total: {
      revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      hash: typeof candidate.total.hash === 'string' ? candidate.total.hash : '',
      ...(typeof candidate.total.updatedAt === 'string' ? { updatedAt: candidate.total.updatedAt } : {})
    },
    assignments,
    volumes,
    chapterPlacements,
    manuscriptStarts,
    eventChapterPlacements,
    chapters,
    chapterConfirmations,
    ...(records !== undefined ? { chapterStoryContracts: records } : {}),
    outlineReviewAcknowledgements,
    planningConfirmations,
    ...(candidate.upstreamReviewDecisions !== undefined ? { upstreamReviewDecisions: candidate.upstreamReviewDecisions } : {}),
    ...(candidate.formalSkeleton !== undefined ? { formalSkeleton: candidate.formalSkeleton } : {}),
    ...(candidate.chapterEventOutputs !== undefined ? { chapterEventOutputs: candidate.chapterEventOutputs } : {})
  }
}

function volumeSnapshot(volume: PlannedVolume | undefined, content: string): { hash: string; revision: number; externalChange: boolean } {
  const hash = hashText(content)
  if (!volume || volume.revision === 0) return { hash, revision: content.trim() ? 1 : 0, externalChange: false }
  const externalChange = volume.outlineHash !== hash
  return { hash, revision: externalChange ? volume.revision + 1 : volume.revision, externalChange }
}

function corruptState(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '大纲版本账本结构无效，已停止写入以保护现有总纲与章纲。', { recoverable: true })
}

function hashText(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
}

function projectedPlanningEvent(item: ProjectedStoryEvent): PlanningApprovedEvent {
  return {
    id: item.eventId,
    time: item.content.time,
    characters: [...item.content.characters],
    location: item.content.location,
    event: item.content.event,
    ...(item.content.result !== undefined ? { result: item.content.result } : {}),
    evidenceRefs: item.content.evidenceRefs.map((reference) => ({ ...reference })),
    confidence: item.content.confidence,
    status: 'approved',
    createdAt: item.createdAt,
    approvedAt: item.createdAt,
    ...(item.content.title !== undefined ? { title: item.content.title } : {}),
    versionId: item.versionId,
    phase: item.phase,
    granularity: item.granularity
  }
}

function volumeTitleKey(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function bumpTotalRevision(state: OutlineState): void {
  state.total.revision = Math.max(1, state.total.revision + 1)
  state.total.updatedAt = new Date().toISOString()
}

function chapterEventIds(state: OutlineState, chapterId: number): string[] {
  return state.eventChapterPlacements.filter((item) => item.chapterId === chapterId).map((item) => item.eventId).sort()
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEventVersions(left: PlanningEventVersion[], right: PlanningEventVersion[]): boolean {
  const normalized = (items: PlanningEventVersion[]) => [...items].sort((a, b) => a.eventId.localeCompare(b.eventId))
  const leftItems = normalized(left), rightItems = normalized(right)
  return leftItems.length === rightItems.length && leftItems.every((item, index) => {
    const other = rightItems[index]
    return other?.eventId === item.eventId && other.versionId === item.versionId && other.phase === item.phase
  })
}
