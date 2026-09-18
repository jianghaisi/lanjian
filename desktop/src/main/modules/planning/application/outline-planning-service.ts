import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { auditChapterOutline } from '../domain/chapter-outline'
import { auditPlanningOutline } from '../domain/outline-quality'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { CanonicalEvent, ChapterOutlineDocument, ChapterOutlineReview, OutlinePlanningStatus, OutlinePlanningVolume, OutlineUpdateResult, OutlineVolume, PlanningOutlineApproval, PlanningOutlineReview, VolumeOutline } from '../../../../contracts/index'
import { DocumentService } from '../../manuscript/application/document-service'
import { writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from '../../library/application/project-service'
import { ResearchLibraryService } from '../../library/application/research-library-service'
import type { PlannedChapterStartInput, PlannedChapterStartResult } from '../../../../contracts/index'

type OutlineAssignment = { eventId: string; assignedAt: string }
type PlannedVolume = { volume: number; title: string; eventIds: string[]; revision: number; outlineHash: string; createdAt: string; updatedAt: string }
type ChapterPlacement = { chapterId: number; volume: number; assignedAt: string; updatedAt: string }
type ManuscriptStart = { chapterId: number; revision: string; volume: number | null; completed: boolean }
type EventChapterPlacement = { eventId: string; chapterId: number; assignedAt: string; updatedAt: string }
type ChapterDependency = { chapterId: number; volume?: number; basedOnTotalRevision: number; basedOnVolumeRevision?: number; outlineHash: string; savedAt: string }
type ChapterConfirmation = { chapterId: number; outlineHash: string; basedOnTotalRevision: number; basedOnVolumeRevision?: number; eventIds: string[]; confirmedAt: string }
type PlanningReviewAcknowledgement = { scope: OutlineVolume; fingerprint: string; issueCodes: string[]; acknowledgedAt: string }
type PlanningConfirmation = { scope: OutlineVolume; fingerprint: string; basedOnTotalFingerprint?: string; confirmedAt: string }
type EffectiveVolume = Omit<OutlinePlanningVolume, 'review' | 'approval'>
type OutlineState = {
  version: 1
  total: { revision: number; hash: string; updatedAt?: string }
  assignments: OutlineAssignment[]
  volumes: PlannedVolume[]
  chapterPlacements: ChapterPlacement[]
  manuscriptStarts: ManuscriptStart[]
  eventChapterPlacements: EventChapterPlacement[]
  chapters: ChapterDependency[]
  chapterConfirmations: ChapterConfirmation[]
  outlineReviewAcknowledgements: PlanningReviewAcknowledgement[]
  planningConfirmations: PlanningConfirmation[]
}

type FormalOutlinePlanningStatePort = {
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
  private readonly stateSources = new WeakMap<OutlineState, { root: string; contentHash?: string }>()

  constructor(
    private readonly projects: ProjectService,
    private readonly documents: DocumentService,
    private readonly research: ResearchLibraryService,
    private readonly formalStates?: FormalOutlinePlanningStatePort
  ) {}

  async status(chapterId?: number): Promise<OutlinePlanningStatus> {
    const state = await this.state()
    return this.projectStatus(state, chapterId)
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
      state.chapterConfirmations = state.chapterConfirmations.filter((item) => item.chapterId !== chapterId)
      state.chapterConfirmations.push({
        chapterId,
        outlineHash: dependency.outlineHash,
        basedOnTotalRevision: dependency.basedOnTotalRevision,
        ...(dependency.basedOnVolumeRevision !== undefined ? { basedOnVolumeRevision: dependency.basedOnVolumeRevision } : {}),
        eventIds,
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
        ...(scope !== 'total' ? { basedOnTotalFingerprint: projected.totalReview.fingerprint } : {}),
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
          outlineHash: nextHash,
          savedAt: new Date().toISOString()
        })
      }
      await this.saveState(state)
      return { content, fingerprint: nextHash, status: await this.projectStatus(state, input.chapterId) }
    })
  }

  async updateChapterOutline(chapterId: number, content: string, plannedVolume?: number): Promise<ChapterOutlineDocument> {
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
      const result = await this.documents.updateChapterOutline(chapterId, content, placement?.volume)
      state.chapters = state.chapters.filter((item) => item.chapterId !== chapterId)
      if (content.trim()) {
        state.chapters.push({
          chapterId,
          ...(placement ? { volume: placement.volume, basedOnVolumeRevision: volumeRevision } : {}),
          basedOnTotalRevision: state.total.revision,
          outlineHash: hashText(content),
          savedAt: new Date().toISOString()
        })
      } else state.chapterConfirmations = state.chapterConfirmations.filter((item) => item.chapterId !== chapterId)
      await this.saveState(state)
      return result
    })
  }

  async assignEvent(eventId: string): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      await this.approvedEvent(eventId)
      const state = await this.state()
      const snapshot = await this.totalSnapshot(state)
      await this.reconcileState(state, snapshot)
      if (state.assignments.some((item) => item.eventId === eventId)) return this.projectStatus(state)
      state.assignments.push({ eventId, assignedAt: new Date().toISOString() })
      bumpTotalRevision(state)
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
      bumpTotalRevision(state)
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
      bumpTotalRevision(state)
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
      bumpTotalRevision(state)
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
      bumpTotalRevision(state)
      await this.saveState(state)
      return this.projectStatus(state)
    })
  }

  async placeEvent(eventId: string, volumeNumber: number | null): Promise<OutlinePlanningStatus> {
    return this.serialize(async () => {
      await this.approvedEvent(eventId)
      const state = await this.state()
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
      bumpTotalRevision(state)
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
        bumpTotalRevision(state)
      }
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async placeEventInChapter(eventId: string, chapterId: number): Promise<OutlinePlanningStatus> {
    await this.approvedEvent(eventId)
    await this.documents.chapter(chapterId)
    return this.serialize(async () => {
      const state = await this.state()
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
      bumpTotalRevision(state)
      await this.saveState(state)
      return this.projectStatus(state, chapterId)
    })
  }

  async chapterEvents(chapterId: number): Promise<CanonicalEvent[]> {
    const state = await this.state()
    const ids = state.eventChapterPlacements.filter((item) => item.chapterId === chapterId).map((item) => item.eventId)
    if (!ids.length) return []
    const events = new Map((await this.research.listEvents()).events.filter((item) => item.status === 'approved').map((item) => [item.id, item]))
    return ids.map((id) => events.get(id)).filter((item): item is CanonicalEvent => Boolean(item))
  }

  async chapterVolumeContext(chapterId: number): Promise<{ volume: number; title: string; content: string } | null> {
    const status = await this.status(chapterId)
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
    const totalApproval = planningApproval(state, 'total', Boolean(snapshot.content.trim()), totalReview)
    const volumes: OutlinePlanningVolume[] = reviewedVolumes.map(({ content, ...volume }) => ({
      ...volume,
      approval: planningApproval(state, volume.volume, Boolean(content.trim()), volume.review, totalApproval, totalReview.fingerprint)
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
    const stale = hasContent && (basedOnTotalRevision === undefined || basedOnTotalRevision !== totalRevision || snapshot.externalChange || contentChangedOutsideApp || volumeChanged || volumeStale)
    const eventIds = chapterEventIds(state, chapterId)
    const audit = auditChapterOutline(chapter.content, eventIds.length)
    const upstreamIssue = totalApproval.status !== 'confirmed'
      ? { code: 'TOTAL_OUTLINE_UNCONFIRMED', level: 'error' as const, message: '请先确认当前总纲版本，再确认章纲。' }
      : placement && placedVolume?.approval.status !== 'confirmed'
        ? { code: 'VOLUME_OUTLINE_UNCONFIRMED', level: 'error' as const, message: '请先确认当前卷纲版本，再确认本章章纲。' }
        : null
    const issues = upstreamIssue ? [...audit.issues, upstreamIssue] : audit.issues
    const confirmation = state.chapterConfirmations.find((item) => item.chapterId === chapterId)
    const confirmationCurrent = Boolean(confirmation && dependency
      && confirmation.outlineHash === hashText(chapter.content)
      && confirmation.basedOnTotalRevision === totalRevision
      && confirmation.basedOnVolumeRevision === dependency.basedOnVolumeRevision
      && sameStrings(confirmation.eventIds, eventIds)
      && !upstreamIssue)
    const hasAuditErrors = audit.issues.some((item) => item.level === 'error')
    const reviewStatus: ChapterOutlineReview['status'] = !hasContent
      ? 'missing'
      : hasAuditErrors
        ? 'needs-changes'
        : confirmationCurrent && !stale
          ? 'confirmed'
          : stale || confirmation
            ? 'stale'
            : upstreamIssue ? 'needs-changes' : 'ready'
    const contractVersion = confirmationCurrent && !stale && confirmation ? {
      totalFingerprint: totalApproval.fingerprint,
      ...(placedVolume ? { volumeFingerprint: placedVolume.approval.fingerprint } : {}),
      outlineHash: confirmation.outlineHash,
      eventIds: [...eventIds].sort(),
      confirmedAt: confirmation.confirmedAt,
      fingerprint: hashText(JSON.stringify({
        chapterId,
        totalFingerprint: totalApproval.fingerprint,
        volumeFingerprint: placedVolume?.approval.fingerprint || '',
        outlineHash: confirmation.outlineHash,
        eventIds: [...eventIds].sort(),
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
        canConfirm: hasContent && !stale && !hasAuditErrors && !upstreamIssue,
        issues,
        metrics: audit.metrics,
        ...(confirmation ? { confirmedAt: confirmation.confirmedAt } : {})
      },
      ...(contractVersion ? { contractVersion } : {})
    }
    return status
  }

  private async approvedEvent(eventId: string): Promise<CanonicalEvent> {
    const event = (await this.research.listEvents()).events.find((item) => item.id === eventId)
    if (!event) throw new AppError('NOT_FOUND', '要分配的事件不存在。', { recoverable: true })
    if (event.status !== 'approved') throw new AppError('CONFLICT', '事件仍是候选，必须先确认入库才能参与谋篇。', { recoverable: true })
    return event
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
      this.stateSources.set(state, { root, contentHash: formal.contentHash })
      return state
    }
    const legacy = await this.readLegacy(root, file)
    this.stateSources.set(legacy.state, { root })
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
    const content = JSON.stringify(state)
    if (this.formalStates && await this.formalStates.active(root)) {
      const expectedContentHash = source?.contentHash ?? hashText(content)
      const saved = await this.formalStates.replaceOutlinePlanningState(root, expectedContentHash, content)
      this.stateSources.set(state, { root, contentHash: saved.contentHash })
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
  totalFingerprint?: string
): PlanningOutlineApproval {
  const confirmation = state.planningConfirmations.find((item) => item.scope === scope)
  const reviewReady = review.status === 'clear' || review.status === 'acknowledged'
  const parentReady = scope === 'total' || totalApproval?.status === 'confirmed'
  const current = Boolean(confirmation
    && confirmation.fingerprint === review.fingerprint
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
    fingerprint: review.fingerprint,
    ...(current ? { confirmedAt: confirmation?.confirmedAt } : {})
  }
}

function normalizeState(value: unknown): OutlineState {
  if (!value || typeof value !== 'object') throw corruptState()
  const candidate = value as Partial<OutlineState>
  if (candidate.version !== 1 || !candidate.total || typeof candidate.total !== 'object') throw corruptState()
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
  const rawConfirmations = candidate.chapterConfirmations === undefined ? [] : candidate.chapterConfirmations
  if (!Array.isArray(rawConfirmations) || !rawConfirmations.every((item) => (
    item && Number.isInteger(item.chapterId) && item.chapterId > 0
    && typeof item.outlineHash === 'string' && /^[a-f0-9]{64}$/.test(item.outlineHash)
    && Number.isInteger(item.basedOnTotalRevision) && item.basedOnTotalRevision >= 0
    && (item.basedOnVolumeRevision === undefined || (Number.isInteger(item.basedOnVolumeRevision) && item.basedOnVolumeRevision >= 0))
    && Array.isArray(item.eventIds) && item.eventIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(item.eventIds).size === item.eventIds.length
    && typeof item.confirmedAt === 'string' && !Number.isNaN(Date.parse(item.confirmedAt))
  ))) throw corruptState()
  const chapterConfirmations = rawConfirmations.map((item) => ({ ...item, eventIds: [...item.eventIds].sort() })) as ChapterConfirmation[]
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
    outlineReviewAcknowledgements,
    planningConfirmations
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
