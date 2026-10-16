import { mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { assertChapterEventAdoption, chapterEventOutputItems, type ChapterEventAdoption, type ChapterEventInput, type ChapterEventOutput } from '../domain/chapter-event-adoption'
import type { ChapterStoryConstraints } from '../../../../contracts/planning/chapter-story-contract'
import type { ChapterEventDraft, ChapterEventAdoptionPreview, ChapterEventAdoptionResult, ChapterEventReplacementImpact } from '../../../../contracts/planning/types'
import { decodeChapterEventAdoptionArgs } from '../../../../contracts/planning/ipc'
import type { ChapterEventPreview, ChapterEventReference, FormalSkeletonPreview, FormalSkeletonView, PlanningChapterSkeletonEntry } from '../../../../contracts/planning/types'
import { join, relative } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { renderPlanningChapterDetail, chapterDetailFingerprint } from '../domain/planning-chapter-detail'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { CharacterStateView, CheatSystemData, FoundationData, OutlineDocument, OutlinePlanningStatus, OutlineUpdateResult, PlanningChapterDetailAdoptionPreview, PlanningChapterDetailAdoptionResult, PlanningChapterDetailStatus, PlanningChapterDetailVolumeProposal, PlanningChapterSkeletonProposal, PlanningChapterSkeletonStatus, PlanningCharacterSeed, PlanningCharacterSeedPreview, PlanningCharacterSeedResult, PlanningCheatSystemPreview, PlanningCheatSystemResult, PlanningDraftRecoveryResult, PlanningPackageProposal, PlanningPowerSystemPreview, PlanningPowerSystemResult, PlanningTotalAdoptionPreview, PlanningTotalAdoptionResult, PlanningVolumeOutlinePreview, PlanningVolumeOutlineResult, PlanningVolumeProposal, PlanningVolumeStructurePreview, PlanningVolumeStructureResult, PlanningWorldSeedPreview, PlanningWorldSeedResult, PowerSystemData, ProjectSummary, RealmLevel } from '../../../../contracts/index'
import { decodePlanningPackageArgs } from '../../../../contracts/ipc'
import { writeJson } from '../../../platform/storage/json-store'

type CurrentProject = {
  currentPath: () => Promise<string>
  currentSummary: () => Promise<ProjectSummary>
}

type StoredPlanningDraft = { version: 1; proposal: PlanningPackageProposal; updatedAt: string }
type OutlinePlanningPort = {
  recoverChapterEvent?: (operationId: string) => Promise<{ output: ChapterEventOutput; mirrorsPending: boolean }>
  prepareChapterEvent?: (chapterId: number, volume: number, title: string, content: string, event: ChapterEventInput | ChapterEventInput[], constraints?: ChapterStoryConstraints) => Promise<{ root: string; command: ChapterEventAdoption; replacementImpact?: ChapterEventReplacementImpact }>
  commitChapterEvent?: (root: string, command: ChapterEventAdoption, guard?: () => Promise<void>) => Promise<{ output: ChapterEventOutput; mirrorsPending: boolean; planningMirrorsPending: boolean }>
  inspectChapterEvents?: (chapterId: number) => Promise<ChapterEventReference[]>
  inspectFormalSkeleton?: (entries: PlanningChapterSkeletonEntry[], volume: number) => Promise<FormalSkeletonView>
  adoptFormalSkeleton?: (entries: PlanningChapterSkeletonEntry[], volume: number, fingerprint: string) => Promise<FormalSkeletonView>
  status: (chapterId?: number) => Promise<OutlinePlanningStatus>
  updateOutline: (volume: 'total' | number, content: string) => Promise<OutlineUpdateResult>
  initializeVolumeStructure: (input: Array<{ order: number; title: string }>) => Promise<OutlinePlanningStatus>
  updateChapterOutline?: (chapterId: number, content: string, plannedVolume?: number, constraints?: ChapterStoryConstraints) => Promise<{ chapterId: number; content: string }>
}
type OutlineDocumentPort = {
  outline: (volume: 'total' | number) => Promise<OutlineDocument>
  chapterOutlines: () => Promise<Array<{ chapterId: number; content: string }>>
  chapterOutline?: (chapterId: number) => Promise<{ chapterId: number; content: string }>
}
type CharacterStatePort = {
  previewPlanningSeeds: (proposalId: string, seeds: PlanningCharacterSeed[]) => Promise<PlanningCharacterSeedPreview>
  adoptPlanningSeeds: (input: { proposalId: string; seeds: PlanningCharacterSeed[]; candidateFingerprint: string; currentFingerprint: string }) => Promise<{ state: CharacterStateView; anchorFingerprint: string }>
}
type FoundationPort = {
  foundationSnapshot: () => Promise<{ data: FoundationData; fingerprint: string }>
  adoptPlanningWorldView: (input: { worldView: string; currentFingerprint: string }) => Promise<{ data: FoundationData; fingerprint: string }>
  powerSystemSnapshot: () => Promise<{ data: PowerSystemData; fingerprint: string }>
  adoptPlanningPowerSystem: (input: { overview: string; currentFingerprint: string }) => Promise<{ data: PowerSystemData; fingerprint: string }>
  cheatSystemSnapshot: () => Promise<{ data: CheatSystemData; fingerprint: string }>
  adoptPlanningCheatSystem: (input: { overview: string; currentFingerprint: string }) => Promise<{ data: CheatSystemData; fingerprint: string }>
  realms: () => Promise<{ levels: RealmLevel[] }>
  systemTemplate: () => Promise<{ template: string }>
}

export class PlanningPackageService {
  private mutation: Promise<void> = Promise.resolve()
  private chapterEventPreviews = new Map<string, { root: string; proposalId: string; candidate: string; command: ChapterEventAdoption; expires: number }>()
  private skeletonPreviews = new Map<string, { root: string; proposalId: string; volume: number; candidate: string; fingerprint: string; expires: number }>()

  constructor(
    private readonly projects: CurrentProject,
    private readonly planning?: OutlinePlanningPort,
    private readonly documents?: OutlineDocumentPort,
    private readonly now = () => new Date(),
    private readonly characters?: CharacterStatePort,
    private readonly foundation?: FoundationPort
  ) {}

  previewChapterEventAdoption(proposalId: string, chapterId: number, event: ChapterEventDraft | ChapterEventDraft[]): Promise<ChapterEventAdoptionPreview> {
    return this.serialize(async () => {
      ;[proposalId, chapterId, event] = decodeChapterEventAdoptionArgs([proposalId, chapterId, event])
      const root = await this.projects.currentPath(), proposal = await this.requiredProposal(proposalId)
      await this.chapterDetailAdoptionPreview(proposal, chapterId)
      const detail = this.chapterDetailEntry(proposal, chapterId), planning = this.requirePlanning()
      if (!planning.prepareChapterEvent || !planning.commitChapterEvent) throw new AppError('FEATURE_UNAVAILABLE', '联合采用暂不可用。', { recoverable: true })
      const candidate = fingerprint(JSON.stringify(proposal))
      const events = Array.isArray(event) ? event : [event]
      const prepared = await planning.prepareChapterEvent(chapterId, detail.volume, detail.title, renderPlanningChapterDetail(detail), events.map(e => ({ ...e, evidenceRefs: [], confidence: 1 })), detail.storyContent !== undefined ? detailConstraints(detail) : undefined)
      if (prepared.root !== root || await this.projects.currentPath() !== root
        || fingerprint(JSON.stringify(await this.requiredProposal(proposalId))) !== candidate) throw new AppError('CONFLICT', '候选或作品在读取中变化，请重新核对。', { recoverable: true })
      for (const [token, p] of this.chapterEventPreviews) if (p.expires <= this.now().getTime() || (p.root === root && p.command.chapterId === chapterId)) this.chapterEventPreviews.delete(token)
      if (this.chapterEventPreviews.size >= 32) this.chapterEventPreviews.delete(this.chapterEventPreviews.keys().next().value!)
      const token = randomUUID(), command = prepared.command
      assertChapterEventAdoption(command)
      this.chapterEventPreviews.set(token, { root, proposalId, candidate, command, expires: this.now().getTime() + 300_000 })
      return { token, operationId: command.operationId, proposalId, chapterId, event: events[0], ...(events.length > 1 ? { events } : {}), chapterContent: command.content,
        replacesChapter: command.expectedOutlineRevision !== null, existingEventCount: command.eventHeads.length,
        ...(prepared.replacementImpact ? { replacementImpact: prepared.replacementImpact } : {}) }
    })
  }

  adoptChapterEvent(token: string): Promise<ChapterEventAdoptionResult> {
    const grant = this.chapterEventPreviews.get(token)
    this.chapterEventPreviews.delete(token)
    return this.serialize(async () => {
      if (!grant) throw new AppError('CONFLICT', '核对已失效或已使用，请重新预览。', { recoverable: true })
      const guard = async () => {
        if (this.now().getTime() >= grant.expires || await this.projects.currentPath() !== grant.root
          || fingerprint(JSON.stringify(await this.requiredProposal(grant.proposalId))) !== grant.candidate) throw new AppError('CONFLICT', '候选、作品或核对期限已变化，未执行采用。', { recoverable: true })
      }
      await guard()
      const proposal = await this.requiredProposal(grant.proposalId)
      await this.chapterDetailAdoptionPreview(proposal, grant.command.chapterId)
      const planning = this.requirePlanning()
      if (!planning.commitChapterEvent) throw new AppError('FEATURE_UNAVAILABLE', '联合采用暂不可用。', { recoverable: true })
      const committed = await planning.commitChapterEvent(grant.root, grant.command, guard)
      const chapterId = grant.command.chapterId, detail = this.chapterDetailEntry(proposal, chapterId)
      let candidateReceiptPending = false
      try {
        await guard()
        proposal.adoption = { ...(proposal.adoption || {}), chapterOutlines: [
          ...(proposal.adoption?.chapterOutlines ?? []).filter(item => item.chapter !== chapterId),
          { chapter: chapterId, candidateFingerprint: chapterDetailFingerprint(detail), adoptedAt: this.now().toISOString(),
            totalFingerprint: fingerprint(renderPlanningTotalOutline(proposal)),
            volumeFingerprint: fingerprint(renderPlanningVolumeOutline(proposal.volumes.find(v => v.order === detail.volume)!)) }
        ].sort((a, b) => a.chapter - b.chapter) }
        await this.writeStored(proposal)
      } catch { candidateReceiptPending = true }
      return { chapterId, eventId: committed.output.eventId, eventVersionId: committed.output.eventVersionId,
        ...(committed.output.additionalEvents ? { events: chapterEventOutputItems(committed.output).map(({ eventId, eventVersionId }) => ({ eventId, eventVersionId })) } : {}),
        mirrorsPending: committed.mirrorsPending, candidateReceiptPending }
    })
  }

  async recoverChapterEvent(operationId: string): Promise<ChapterEventAdoptionResult> {
    const planning = this.requirePlanning()
    if (!planning.recoverChapterEvent) throw new AppError('FEATURE_UNAVAILABLE', '联合采用恢复暂不可用。', { recoverable: true })
    const { output, mirrorsPending } = await planning.recoverChapterEvent(operationId)
    return { chapterId: output.chapterId, eventId: output.eventId, eventVersionId: output.eventVersionId,
      ...(output.additionalEvents ? { events: chapterEventOutputItems(output).map(({ eventId, eventVersionId }) => ({ eventId, eventVersionId })) } : {}), mirrorsPending, candidateReceiptPending: true }
  }

  get(): Promise<PlanningPackageProposal | null> {
    return this.serialize(async () => {
      return this.readStored()
    })
  }

  save(input: PlanningPackageProposal, guard?: (existing: PlanningPackageProposal | null) => Promise<void>): Promise<PlanningPackageProposal> {
    return this.serialize(async () => {
      const [proposal] = decodePlanningPackageArgs([input])
      await this.assertOwner(proposal)
      const existing = await this.readStored()
      const claimedAdoption = proposal.adoption?.totalOutline
      const storedAdoption = existing?.id === proposal.id ? existing.adoption?.totalOutline : undefined
      if (claimedAdoption && (JSON.stringify(claimedAdoption) !== JSON.stringify(storedAdoption) || claimedAdoption.fingerprint !== fingerprint(renderPlanningTotalOutline(proposal)))) {
        throw new AppError('CONFLICT', '总纲采用状态只能由正式采用事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const claimedStructure = proposal.adoption?.volumeStructure
      const storedStructure = existing?.id === proposal.id ? existing.adoption?.volumeStructure : undefined
      if (claimedStructure && (JSON.stringify(claimedStructure) !== JSON.stringify(storedStructure) || claimedStructure.fingerprint !== fingerprint(renderPlanningVolumeStructure(proposal)))) {
        throw new AppError('CONFLICT', '篇卷目录采用状态只能由正式初始化事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const claimedVolumeOutlines = proposal.adoption?.volumeOutlines || []
      const storedVolumeOutlines = existing?.id === proposal.id ? existing.adoption?.volumeOutlines || [] : []
      for (const claimed of claimedVolumeOutlines) {
        const stored = storedVolumeOutlines.find((item) => item.order === claimed.order)
        const volume = proposal.volumes.find((item) => item.order === claimed.order)
        if (!stored || !volume || JSON.stringify(claimed) !== JSON.stringify(stored) || claimed.fingerprint !== fingerprint(renderPlanningVolumeOutline(volume)) || !claimedAdoption || !claimedStructure) {
          throw new AppError('CONFLICT', '卷纲采用状态只能由正式逐卷采用事务更新，已阻止候选伪造状态。', { recoverable: true })
        }
      }
      const claimedChapterOutlines = proposal.adoption?.chapterOutlines || []
      const storedChapterOutlines = existing?.id === proposal.id ? existing.adoption?.chapterOutlines || [] : []
      for (const claimed of claimedChapterOutlines) {
        const stored = storedChapterOutlines.find((item) => item.chapter === claimed.chapter)
        const detail = proposal.chapterDetails?.flatMap((item) => item.chapters).find((item) => item.chapter === claimed.chapter)
        const volume = detail && proposal.volumes.find((item) => item.order === detail.volume)
        if (!stored || !detail || !volume || JSON.stringify(claimed) !== JSON.stringify(stored)
          || claimed.candidateFingerprint !== chapterDetailFingerprint(detail)
          || claimed.totalFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
          || claimed.volumeFingerprint !== fingerprint(renderPlanningVolumeOutline(volume))) {
          throw new AppError('CONFLICT', '章纲采用状态只能由正式逐章采用事务更新，已阻止候选伪造状态。', { recoverable: true })
        }
      }
      const claimedCharacterSeeds = proposal.adoption?.characterSeeds
      const storedCharacterSeeds = existing?.id === proposal.id ? existing.adoption?.characterSeeds : undefined
      if (claimedCharacterSeeds && (JSON.stringify(claimedCharacterSeeds) !== JSON.stringify(storedCharacterSeeds) || claimedCharacterSeeds.fingerprint !== fingerprint(renderPlanningCharacterSeeds(proposal)))) {
        throw new AppError('CONFLICT', '人物种子采用状态只能由正式人物锚点事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const claimedWorldSeed = proposal.adoption?.worldSeed
      const storedWorldSeed = existing?.id === proposal.id ? existing.adoption?.worldSeed : undefined
      if (claimedWorldSeed && (JSON.stringify(claimedWorldSeed) !== JSON.stringify(storedWorldSeed) || claimedWorldSeed.fingerprint !== fingerprint(renderPlanningWorldSeed(proposal)))) {
        throw new AppError('CONFLICT', '世界种子采用状态只能由正式世界观事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const claimedPowerSystem = proposal.adoption?.powerSystem
      const storedPowerSystem = existing?.id === proposal.id ? existing.adoption?.powerSystem : undefined
      if (claimedPowerSystem && (JSON.stringify(claimedPowerSystem) !== JSON.stringify(storedPowerSystem) || claimedPowerSystem.fingerprint !== fingerprint(renderPlanningPowerSystem(proposal)))) {
        throw new AppError('CONFLICT', '力量体系采用状态只能由正式采用事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const claimedCheatSystem = proposal.adoption?.cheatSystem
      const storedCheatSystem = existing?.id === proposal.id ? existing.adoption?.cheatSystem : undefined
      if (claimedCheatSystem && (JSON.stringify(claimedCheatSystem) !== JSON.stringify(storedCheatSystem) || claimedCheatSystem.fingerprint !== fingerprint(renderPlanningCheatSystem(proposal)))) {
        throw new AppError('CONFLICT', '金手指或特殊优势采用状态只能由正式采用事务更新，已阻止候选伪造状态。', { recoverable: true })
      }
      const stored: StoredPlanningDraft = { version: 1, proposal, updatedAt: this.now().toISOString() }
      await guard?.(existing)
      await writeJson(await this.path(), stored, guard ? async () => guard(await this.readStored()) : undefined)
      return structuredClone(proposal)
    })
  }

  discard(): Promise<{ success: true }> {
    return this.serialize(async () => {
      await unlink(await this.path()).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      return { success: true as const }
    })
  }

  recoverDamagedDraft(): Promise<PlanningDraftRecoveryResult> {
    return this.serialize(async () => {
      const root = await this.projects.currentPath()
      let failure: unknown
      try {
        const current = await this.readStored()
        if (!current) throw new AppError('NOT_FOUND', '当前作品没有需要恢复的自动谋篇候选。', { recoverable: true })
      } catch (error) {
        failure = error
      }
      if (!failure) throw new AppError('CONFLICT', '当前自动谋篇候选可以正常读取，不需要恢复。', { recoverable: true })
      if (!(failure instanceof AppError) || !['INVALID_PROJECT_STATE', 'CONFLICT'].includes(failure.code)) throw failure
      const confirmedRoot = await this.projects.currentPath()
      if (confirmedRoot !== root) throw new AppError('CONFLICT', '作品已经切换，未移动任何候选文件。', { recoverable: true })
      const source = await projectDirectory(root, join(root, '.webnovel', 'planning', 'automatic-planning-draft.json'))
      const recoveryRoot = await projectDirectory(root, join(root, '.webnovel', 'planning', 'recovery'))
      await mkdir(recoveryRoot, { recursive: true })
      const stamp = this.now().toISOString().replace(/[:.]/g, '-')
      const target = await projectDirectory(root, join(recoveryRoot, `${stamp}-automatic-planning-draft.json`))
      await rename(source, target)
      return { success: true, recoveryRelativePath: relative(root, target).replaceAll('\\', '/') }
    })
  }

  chapterSkeletonStatus(proposalId: string): Promise<PlanningChapterSkeletonStatus> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const skeleton = proposal.chapterSkeleton
      if (!skeleton) return { exists: false, stale: false, chapterCount: 0, volumeCount: 0 }
      const stale = skeleton.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
        || skeleton.basedOn.volumePlanFingerprint !== fingerprint(renderPlanningVolumePlan(proposal))
      return {
        exists: true,
        stale,
        chapterCount: skeleton.chapters.length,
        volumeCount: new Set(skeleton.chapters.map((item) => item.volume)).size,
        ...(stale ? { reason: '总纲或篇卷候选已在章节骨架生成后变化，请重新生成骨架。' } : {})
      }
    })
  }

  previewFormalSkeleton(proposalId: string, volume: number): Promise<FormalSkeletonPreview> {
    return this.serialize(async () => {
      const root = await this.projects.currentPath()
      const proposal = await this.requiredProposal(proposalId)
      const entries = this.formalSkeletonCandidate(proposal, volume)
      const planning = this.requirePlanning()
      if (!planning.inspectFormalSkeleton) throw new AppError('FEATURE_UNAVAILABLE', '正式骨架服务不可用。', { recoverable: true })
      const view = await planning.inspectFormalSkeleton(entries, volume)
      if (root !== await this.projects.currentPath()) throw new AppError('CONFLICT', '作品已切换，请重新预览。', { recoverable: true })
      for (const [key, value] of this.skeletonPreviews) if (value.expires <= Date.now() || (value.root === root && value.volume === volume)) this.skeletonPreviews.delete(key)
      if (this.skeletonPreviews.size >= 32) this.skeletonPreviews.delete(this.skeletonPreviews.keys().next().value!)
      const token = randomUUID()
      this.skeletonPreviews.set(token, { root, proposalId, volume, candidate: fingerprint(JSON.stringify(entries)), fingerprint: view.fingerprint, expires: Date.now() + 300_000 })
      return { ...view, proposalId, token }
    })
  }

  adoptFormalSkeleton(token: string): Promise<FormalSkeletonView> {
    return this.serialize(async () => {
      const grant = this.skeletonPreviews.get(token)
      this.skeletonPreviews.delete(token)
      if (!grant || grant.expires <= Date.now() || grant.root !== await this.projects.currentPath()) throw new AppError('CONFLICT', '骨架预览已失效，请重新预览。', { recoverable: true })
      const proposal = await this.requiredProposal(grant.proposalId)
      const entries = this.formalSkeletonCandidate(proposal, grant.volume)
      if (fingerprint(JSON.stringify(entries)) !== grant.candidate) throw new AppError('CONFLICT', '候选已修改，请重新预览后采用。', { recoverable: true })
      const planning = this.requirePlanning()
      if (!planning.adoptFormalSkeleton) throw new AppError('FEATURE_UNAVAILABLE', '正式骨架服务不可用。', { recoverable: true })
      return planning.adoptFormalSkeleton(entries, grant.volume, grant.fingerprint)
    })
  }

  assertFormalSkeletonForDetails(proposalId: string, volume: number): Promise<string> {
    return this.serialize(async () => this.formalSkeletonForDetails(await this.requiredProposal(proposalId), volume))
  }

  private async formalSkeletonForDetails(proposal: PlanningPackageProposal, volume: number): Promise<string> {
    const entries = this.formalSkeletonCandidate(proposal, volume)
    const planning = this.requirePlanning()
    if (!planning.inspectFormalSkeleton) throw new AppError('FEATURE_UNAVAILABLE', '正式骨架服务不可用。', { recoverable: true })
    const view = await planning.inspectFormalSkeleton(entries, volume)
    if (!view.canAdopt || view.entries.some(e => e.status !== 'current')) {
      throw new AppError('CONFLICT', '请先在章节安排中核对并采用本卷骨架，再生成详细章纲。', { recoverable: true })
    }
    return fingerprint(JSON.stringify(view.entries.map(e => [e.chapter, e.revision])))
  }

  private async assertDetailSources(proposal: PlanningPackageProposal, detail: PlanningChapterDetailVolumeProposal): Promise<void> {
    if (!this.planning?.inspectFormalSkeleton) return // Compatibility adapters; production always supplies the reader.
    const current = await this.formalSkeletonForDetails(proposal, detail.volume)
    if (current !== detail.basedOn.formalSkeletonFingerprint) {
      throw new AppError('CONFLICT', '详细章纲未绑定当前正式骨架版本，请重新生成本卷候选。', { recoverable: true })
    }
  }

  private formalSkeletonCandidate(proposal: PlanningPackageProposal, volume: number): PlanningChapterSkeletonEntry[] {
    const skeleton = proposal.chapterSkeleton
    if (!skeleton || skeleton.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
      || skeleton.basedOn.volumePlanFingerprint !== fingerprint(renderPlanningVolumePlan(proposal))) {
      throw new AppError('CONFLICT', '章节安排候选的上游已变化，请先重新生成并核对。', { recoverable: true })
    }
    const entries = skeleton.chapters.filter(entry => entry.volume === volume)
    if (!entries.length) throw new AppError('NOT_FOUND', '当前卷没有章节安排候选。', { recoverable: true })
    return entries
  }

  storeChapterSkeleton(proposalId: string, skeleton: PlanningChapterSkeletonProposal): Promise<PlanningPackageProposal> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      if (skeleton.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
        || skeleton.basedOn.volumePlanFingerprint !== fingerprint(renderPlanningVolumePlan(proposal))) {
        throw new AppError('CONFLICT', '总纲或篇卷候选在章节骨架生成期间发生变化，本次结果没有保存。', { recoverable: true })
      }
      const [validated] = decodePlanningPackageArgs([{ ...proposal, chapterSkeleton: skeleton }])
      await this.writeStored(validated)
      return structuredClone(validated)
    })
  }

  chapterDetailStatuses(proposalId: string): Promise<PlanningChapterDetailStatus[]> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      return Promise.all(proposal.volumes.map(async (volume) => {
        const detail = proposal.chapterDetails?.find((item) => item.volume === volume.order)
        if (!detail) return { volume: volume.order, exists: false, stale: false, chapterCount: 0 }
        let stale = !proposal.chapterSkeleton
          || detail.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
          || detail.basedOn.volumeOutlineFingerprint !== fingerprint(renderPlanningVolumeOutline(volume))
          || detail.basedOn.skeletonFingerprint !== fingerprint(renderPlanningChapterSkeletonVolume(proposal, volume.order))
        if (!stale) {
          try { await this.assertDetailSources(proposal, detail) }
          catch (error) { if (error instanceof AppError && error.code === 'CONFLICT') stale = true; else throw error }
        }
        return { volume: volume.order, exists: true, stale, chapterCount: detail.chapters.length, ...(stale ? { reason: '总纲、卷纲或正式骨架版本已变化，请重新生成本卷详细章纲。' } : {}) }
      }))
    })
  }

  storeChapterDetail(proposalId: string, detail: PlanningChapterDetailVolumeProposal): Promise<PlanningPackageProposal> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const volume = proposal.volumes.find((item) => item.order === detail.volume)
      if (!volume || !proposal.chapterSkeleton
        || detail.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
        || detail.basedOn.volumeOutlineFingerprint !== fingerprint(renderPlanningVolumeOutline(volume))
        || detail.basedOn.skeletonFingerprint !== fingerprint(renderPlanningChapterSkeletonVolume(proposal, detail.volume))) {
        throw new AppError('CONFLICT', '总纲、卷纲或章节骨架在生成期间发生变化，本卷详细章纲没有保存。', { recoverable: true })
      }
      await this.assertDetailSources(proposal, detail)
      const regeneratedChapters = new Set(detail.chapters.map((item) => item.chapter))
      const next = {
        ...proposal,
        chapterDetails: [...(proposal.chapterDetails || []).filter((item) => item.volume !== detail.volume), detail].sort((a, b) => a.volume - b.volume),
        adoption: proposal.adoption ? { ...proposal.adoption, chapterOutlines: (proposal.adoption.chapterOutlines || []).filter((item) => !regeneratedChapters.has(item.chapter)) } : undefined
      }
      const [validated] = decodePlanningPackageArgs([next])
      await this.writeStored(validated)
      return structuredClone(validated)
    })
  }

  previewTotalAdoption(proposalId: string): Promise<PlanningTotalAdoptionPreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      this.assertFoundationAdoptions(proposal)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const candidateContent = renderPlanningTotalOutline(proposal)
      const currentContent = (await documents.outline('total')).content
      const status = await planning.status()
      return {
        proposalId: proposal.id,
        candidateFingerprint: fingerprint(candidateContent),
        currentFingerprint: fingerprint(currentContent),
        changes: candidateContent !== currentContent,
        current: {
          exists: Boolean(currentContent.trim()), excerpt: excerpt(currentContent), characterCount: currentContent.length,
          revision: status.totalRevision, confirmed: status.totalApproval.status === 'confirmed'
        },
        candidate: { title: proposal.totalOutline.title, excerpt: excerpt(candidateContent), characterCount: candidateContent.length },
        affected: {
          chapterOutlines: (await documents.chapterOutlines()).filter((item) => item.content.trim()).length,
          confirmedVolumes: status.volumes.filter((item) => item.approval.status === 'confirmed').length,
          totalConfirmation: status.totalApproval.status === 'confirmed'
        }
      }
    })
  }

  adoptTotal(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningTotalAdoptionResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      this.assertFoundationAdoptions(proposal)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const candidateContent = renderPlanningTotalOutline(proposal)
      const currentContent = (await documents.outline('total')).content
      if (fingerprint(candidateContent) !== input.candidateFingerprint || fingerprint(currentContent) !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '候选或正式总纲已在预览后发生变化，请重新查看影响后再采用。', { recoverable: true })
      }
      await planning.updateOutline('total', candidateContent)
      const status = await planning.status()
      proposal.adoption = { ...preserveFoundationAdoptions(proposal), totalOutline: {
        fingerprint: input.candidateFingerprint,
        adoptedAt: this.now().toISOString(),
        revision: status.totalRevision
      } }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), planning: status }
    })
  }

  previewVolumeStructure(proposalId: string): Promise<PlanningVolumeStructurePreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const totalContent = (await documents.outline('total')).content
      this.assertCurrentAdoptedTotal(proposal, totalContent)
      const status = await planning.status()
      return volumeStructurePreview(proposal, status, fingerprint(totalContent))
    })
  }

  initializeVolumeStructure(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string; totalFingerprint: string }): Promise<PlanningVolumeStructureResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const totalContent = (await documents.outline('total')).content
      this.assertCurrentAdoptedTotal(proposal, totalContent)
      const status = await planning.status()
      const preview = volumeStructurePreview(proposal, status, fingerprint(totalContent))
      if (preview.candidateFingerprint !== input.candidateFingerprint || preview.currentFingerprint !== input.currentFingerprint || preview.totalFingerprint !== input.totalFingerprint) {
        throw new AppError('CONFLICT', '候选篇卷、正式篇卷或总纲已在预览后发生变化，请重新查看影响。', { recoverable: true })
      }
      if (preview.conflicts.length) throw new AppError('CONFLICT', preview.conflicts[0], { recoverable: true })
      const nextStatus = await planning.initializeVolumeStructure(proposal.volumes.map((item) => ({ order: item.order, title: item.title })))
      proposal.adoption = { ...(proposal.adoption || {}), volumeStructure: {
        fingerprint: input.candidateFingerprint,
        initializedAt: this.now().toISOString(),
        totalRevision: nextStatus.totalRevision
      }, volumeOutlines: [] }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), planning: nextStatus }
    })
  }

  previewVolumeOutlineAdoption(proposalId: string, order: number): Promise<PlanningVolumeOutlinePreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const status = await planning.status()
      const volume = this.assertVolumeOutlineReady(proposal, status, order)
      const currentContent = (await documents.outline(order)).content
      const candidateContent = renderPlanningVolumeOutline(volume)
      const placedChapterIds = new Set(status.chapterPlacements.filter((item) => item.volume === order).map((item) => item.chapterId))
      return {
        proposalId: proposal.id,
        order,
        parentFingerprint: status.totalApproval.fingerprint,
        candidateFingerprint: fingerprint(candidateContent),
        currentFingerprint: fingerprint(currentContent),
        changes: candidateContent !== currentContent,
        current: {
          exists: Boolean(currentContent.trim()), excerpt: excerpt(currentContent), characterCount: currentContent.length,
          revision: status.volumes.find((item) => item.volume === order)?.revision || 0,
          confirmed: status.volumes.find((item) => item.volume === order)?.approval.status === 'confirmed'
        },
        candidate: { title: volume.title, excerpt: excerpt(candidateContent), characterCount: candidateContent.length },
        affected: {
          chapterOutlines: (await documents.chapterOutlines()).filter((item) => placedChapterIds.has(item.chapterId) && item.content.trim()).length,
          volumeConfirmation: status.volumes.find((item) => item.volume === order)?.approval.status === 'confirmed'
        }
      }
    })
  }

  adoptVolumeOutline(input: { proposalId: string; order: number; parentFingerprint: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningVolumeOutlineResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const planning = this.requirePlanning()
      const documents = this.requireDocuments()
      const status = await planning.status()
      const volume = this.assertVolumeOutlineReady(proposal, status, input.order)
      const currentContent = (await documents.outline(input.order)).content
      const candidateContent = renderPlanningVolumeOutline(volume)
      if (status.totalApproval.fingerprint !== input.parentFingerprint || fingerprint(candidateContent) !== input.candidateFingerprint || fingerprint(currentContent) !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '父级总纲、候选卷纲或正式卷纲已在预览后发生变化，请重新查看影响。', { recoverable: true })
      }
      await planning.updateOutline(input.order, candidateContent)
      const nextStatus = await planning.status()
      const adoptedVolume = nextStatus.volumes.find((item) => item.volume === input.order)
      if (!adoptedVolume) throw new AppError('INVALID_PROJECT_STATE', '卷纲写入后篇卷状态缺失，已停止记录采用状态。', { recoverable: false })
      const previous = proposal.adoption?.volumeOutlines || []
      proposal.adoption = { ...(proposal.adoption || {}), volumeOutlines: [
        ...previous.filter((item) => item.order !== input.order),
        {
          order: input.order,
          fingerprint: input.candidateFingerprint,
          adoptedAt: this.now().toISOString(),
          revision: adoptedVolume.revision,
          totalFingerprint: input.parentFingerprint
        }
      ].sort((left, right) => left.order - right.order) }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), planning: nextStatus }
    })
  }

  previewChapterDetailAdoption(proposalId: string, chapterId: number): Promise<PlanningChapterDetailAdoptionPreview> {
    return this.serialize(async () => this.chapterDetailAdoptionPreview(await this.requiredProposal(proposalId), chapterId))
  }

  previewChapterEvents(proposalId: string, chapterId: number): Promise<ChapterEventPreview> {
    return this.serialize(async () => {
      const root = await this.projects.currentPath()
      const planning = this.requirePlanning()
      if (!planning.inspectChapterEvents || !planning.inspectFormalSkeleton) throw new AppError('FEATURE_UNAVAILABLE', '章纲事件核对服务不可用。', { recoverable: true })
      const read = async () => {
        const proposal = await this.requiredProposal(proposalId)
        const detail = this.chapterDetailEntry(proposal, chapterId)
        const volume = proposal.chapterDetails!.find(item => item.volume === detail.volume)!
        const entries = proposal.chapterSkeleton!.chapters.filter(item => item.volume === detail.volume)
        const skeleton = entries.find(item => item.chapter === chapterId)!
        const formal = await planning.inspectFormalSkeleton!(entries, detail.volume)
        const events = await planning.inspectChapterEvents!(chapterId)
        return { proposal, detail, volume, skeleton, formal, events }
      }
      const first = await read()
      const digest = fingerprint(JSON.stringify(first))
      if (root !== await this.projects.currentPath() || digest !== fingerprint(JSON.stringify(await read())) || root !== await this.projects.currentPath()) {
        throw new AppError('CONFLICT', '作品、候选或正式来源在读取中发生变化，请重新核对。', { recoverable: true })
      }
      const { proposal, detail, volume, skeleton, formal, events } = first
      const heads = fingerprint(JSON.stringify(formal.entries.map(entry => [entry.chapter, entry.revision])))
      const stale = !formal.canAdopt || formal.entries.some(entry => entry.status !== 'current')
        || volume.basedOn.formalSkeletonFingerprint !== heads
        || volume.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
        || volume.basedOn.volumeOutlineFingerprint !== fingerprint(renderPlanningVolumeOutline(proposal.volumes[detail.volume - 1]))
        || volume.basedOn.skeletonFingerprint !== fingerprint(renderPlanningChapterSkeletonVolume(proposal, detail.volume))
        || proposal.chapterSkeleton!.basedOn.volumePlanFingerprint !== fingerprint(renderPlanningVolumePlan(proposal))
        || proposal.chapterSkeleton!.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
      const freshness = !volume.basedOn.formalSkeletonFingerprint ? 'untracked' : stale ? 'stale' : 'current'
      const findings: ChapterEventPreview['findings'] = [
        { code: 'TIME_UNSPECIFIED', message: '本章候选没有独立的时间字段；关联事件的时间不能自动当成本章新增事件的时间。' },
        { code: 'SEMANTIC_REVIEW_REQUIRED', message: '请核对节拍与骨架、关联事件的因果和先后关系。来源版本有效不代表语义没有矛盾。' }
      ]
      if (freshness !== 'current') findings.unshift(freshness === 'untracked'
        ? { code: 'UNTRACKED_CANDIDATE', message: '旧候选未绑定正式骨架版本，保留供核对；重新生成后才能建立可靠来源。' }
        : { code: 'SOURCE_CHANGED', message: '候选依据已变化或上游尚未确认，请重新核对正式骨架并生成详细章纲。' })
      return { workItemId: proposal.workItemId, proposalId, chapterId, fingerprint: digest, freshness,
        candidate: { title: detail.title, time: null, characters: [...skeleton.characters], location: skeleton.location,
          coreEvent: skeleton.coreEvent, plannedResult: skeleton.result, entryState: detail.entryState, beats: [...detail.beats], exitState: detail.exitState },
        formalEvents: events, findings }
    })
  }

  adoptChapterDetail(input: { proposalId: string; chapterId: number; upstreamFingerprint: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningChapterDetailAdoptionResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const preview = await this.chapterDetailAdoptionPreview(proposal, input.chapterId)
      if (preview.upstreamFingerprint !== input.upstreamFingerprint || preview.candidateFingerprint !== input.candidateFingerprint || preview.currentFingerprint !== input.currentFingerprint) {
        throw new AppError('CONFLICT', '上游大纲、详细章纲候选或正式章纲已在预览后变化，请重新查看影响。', { recoverable: true })
      }
      const detail = this.chapterDetailEntry(proposal, input.chapterId)
      const planning = this.requirePlanning()
      if (!planning.updateChapterOutline) throw new AppError('INVALID_PROJECT_STATE', '正式章纲写入服务尚未就绪。', { recoverable: true })
      await planning.updateChapterOutline(input.chapterId, renderPlanningChapterDetail(detail), detail.volume, detail.storyContent !== undefined ? detailConstraints(detail) : undefined)
      const status = await planning.status(input.chapterId)
      const previous = proposal.adoption?.chapterOutlines || []
      proposal.adoption = { ...(proposal.adoption || {}), chapterOutlines: [
        ...previous.filter((item) => item.chapter !== input.chapterId),
        {
          chapter: input.chapterId,
          candidateFingerprint: input.candidateFingerprint,
          adoptedAt: this.now().toISOString(),
          totalFingerprint: fingerprint(renderPlanningTotalOutline(proposal)),
          volumeFingerprint: fingerprint(renderPlanningVolumeOutline(proposal.volumes[detail.volume - 1]))
        }
      ].sort((left, right) => left.chapter - right.chapter) }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), planning: status }
    })
  }

  previewCharacterSeedAdoption(proposalId: string): Promise<PlanningCharacterSeedPreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      return this.requireCharacters().previewPlanningSeeds(proposal.id, proposal.blueprint.characters)
    })
  }

  adoptCharacterSeeds(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningCharacterSeedResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      if (fingerprint(renderPlanningCharacterSeeds(proposal)) !== input.candidateFingerprint) {
        throw new AppError('CONFLICT', '人物种子已在预览后变化，请重新核对。', { recoverable: true })
      }
      const result = await this.requireCharacters().adoptPlanningSeeds({
        proposalId: proposal.id,
        seeds: proposal.blueprint.characters,
        candidateFingerprint: input.candidateFingerprint,
        currentFingerprint: input.currentFingerprint
      })
      proposal.adoption = { ...preserveFoundationAdoptions(proposal), characterSeeds: {
        fingerprint: input.candidateFingerprint,
        adoptedAt: this.now().toISOString(),
        anchorFingerprint: result.anchorFingerprint
      } }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), characters: result.state }
    })
  }

  previewWorldSeedAdoption(proposalId: string): Promise<PlanningWorldSeedPreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const candidate = renderPlanningWorldSeed(proposal)
      const current = await this.requireFoundation().foundationSnapshot()
      return {
        proposalId: proposal.id,
        candidateFingerprint: fingerprint(candidate),
        currentFingerprint: current.fingerprint,
        changes: candidate !== current.data.worldView,
        current: { exists: Boolean(current.data.worldView), excerpt: excerpt(current.data.worldView), characterCount: current.data.worldView.length },
        candidate: { excerpt: excerpt(candidate), characterCount: candidate.length },
        preserved: { sourceNotes: Boolean(current.data.sourceNotes), useRealms: current.data.useRealms, useSystem: current.data.useSystem }
      }
    })
  }

  adoptWorldSeed(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningWorldSeedResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const candidate = renderPlanningWorldSeed(proposal)
      if (fingerprint(candidate) !== input.candidateFingerprint) {
        throw new AppError('CONFLICT', '世界种子已在预览后发生变化，请重新查看影响。', { recoverable: true })
      }
      const result = await this.requireFoundation().adoptPlanningWorldView({ worldView: candidate, currentFingerprint: input.currentFingerprint })
      proposal.adoption = { ...preserveFoundationAdoptions(proposal), worldSeed: {
        fingerprint: input.candidateFingerprint,
        adoptedAt: this.now().toISOString(),
        foundationFingerprint: result.fingerprint
      } }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), foundation: result.data }
    })
  }

  previewPowerSystemAdoption(proposalId: string): Promise<PlanningPowerSystemPreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const candidate = renderPlanningPowerSystem(proposal)
      const workspace = this.requireFoundation()
      const [current, foundation, realms] = await Promise.all([workspace.powerSystemSnapshot(), workspace.foundationSnapshot(), workspace.realms()])
      return {
        proposalId: proposal.id,
        candidateFingerprint: fingerprint(candidate),
        currentFingerprint: current.fingerprint,
        changes: candidate !== current.data.overview,
        current: { exists: Boolean(current.data.overview), excerpt: excerpt(current.data.overview), characterCount: current.data.overview.length },
        candidate: { exists: Boolean(candidate), excerpt: excerpt(candidate), characterCount: candidate.length },
        preserved: { realmLevels: realms.levels.length, realmsEnabled: foundation.data.useRealms }
      }
    })
  }

  adoptPowerSystem(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningPowerSystemResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const candidate = renderPlanningPowerSystem(proposal)
      if (fingerprint(candidate) !== input.candidateFingerprint) {
        throw new AppError('CONFLICT', '力量体系候选已在预览后发生变化，请重新查看影响。', { recoverable: true })
      }
      const result = await this.requireFoundation().adoptPlanningPowerSystem({ overview: candidate, currentFingerprint: input.currentFingerprint })
      proposal.adoption = { ...preserveFoundationAdoptions(proposal), powerSystem: {
        fingerprint: input.candidateFingerprint,
        adoptedAt: this.now().toISOString(),
        powerSystemFingerprint: result.fingerprint
      } }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), powerSystem: result.data }
    })
  }

  previewCheatSystemAdoption(proposalId: string): Promise<PlanningCheatSystemPreview> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(proposalId)
      const candidate = renderPlanningCheatSystem(proposal)
      const workspace = this.requireFoundation()
      const [current, foundation, systemUi] = await Promise.all([workspace.cheatSystemSnapshot(), workspace.foundationSnapshot(), workspace.systemTemplate()])
      return {
        proposalId: proposal.id,
        candidateFingerprint: fingerprint(candidate),
        currentFingerprint: current.fingerprint,
        changes: candidate !== current.data.overview,
        current: { exists: Boolean(current.data.overview), excerpt: excerpt(current.data.overview), characterCount: current.data.overview.length },
        candidate: { exists: Boolean(candidate), excerpt: excerpt(candidate), characterCount: candidate.length },
        preserved: { templateCharacters: systemUi.template.length, systemEnabled: foundation.data.useSystem }
      }
    })
  }

  adoptCheatSystem(input: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }): Promise<PlanningCheatSystemResult> {
    return this.serialize(async () => {
      const proposal = await this.requiredProposal(input.proposalId)
      const candidate = renderPlanningCheatSystem(proposal)
      if (fingerprint(candidate) !== input.candidateFingerprint) {
        throw new AppError('CONFLICT', '金手指或特殊优势候选已在预览后发生变化，请重新查看影响。', { recoverable: true })
      }
      const result = await this.requireFoundation().adoptPlanningCheatSystem({ overview: candidate, currentFingerprint: input.currentFingerprint })
      proposal.adoption = { ...preserveFoundationAdoptions(proposal), cheatSystem: {
        fingerprint: input.candidateFingerprint,
        adoptedAt: this.now().toISOString(),
        cheatSystemFingerprint: result.fingerprint
      } }
      await this.writeStored(proposal)
      return { proposal: structuredClone(proposal), cheatSystem: result.data }
    })
  }

  private async assertOwner(proposal: PlanningPackageProposal): Promise<void> {
    const current = await this.projects.currentSummary()
    if (proposal.workItemId !== current.id) {
      throw new AppError('CONFLICT', '自动谋篇候选不属于当前作品，已阻止保存。', { recoverable: true })
    }
  }

  private async requiredProposal(proposalId: string): Promise<PlanningPackageProposal> {
    const proposal = await this.readStored()
    if (!proposal || proposal.id !== proposalId) throw new AppError('NOT_FOUND', '当前作品没有可采用的自动谋篇候选。', { recoverable: true })
    return proposal
  }

  private assertCurrentAdoptedTotal(proposal: PlanningPackageProposal, currentContent: string): void {
    const adoption = proposal.adoption?.totalOutline
    const candidateFingerprint = fingerprint(renderPlanningTotalOutline(proposal))
    if (!adoption || adoption.fingerprint !== candidateFingerprint || fingerprint(currentContent) !== adoption.fingerprint) {
      throw new AppError('CONFLICT', '请先采用当前候选总纲；总纲变化后需要重新采用，才能初始化篇卷目录。', { recoverable: true })
    }
  }

  private assertFoundationAdoptions(proposal: PlanningPackageProposal): void {
    const adoption = proposal.adoption
    const missing = [
      !adoption?.characterSeeds && '人物种子',
      !adoption?.worldSeed && '世界种子',
      !adoption?.powerSystem && '力量体系',
      !adoption?.cheatSystem && '金手指或特殊优势'
    ].filter((item): item is string => Boolean(item))
    if (missing.length) {
      throw new AppError('CONFLICT', `请先逐项核对并采用前置设定：${missing.join('、')}。设定明确后才能采用总纲。`, { recoverable: true })
    }
  }

  private assertVolumeOutlineReady(proposal: PlanningPackageProposal, status: OutlinePlanningStatus, order: number): PlanningVolumeProposal {
    const volume = proposal.volumes.find((item) => item.order === order)
    if (!volume) throw new AppError('NOT_FOUND', '候选中没有这一卷。', { recoverable: true })
    const structure = proposal.adoption?.volumeStructure
    const structureCurrent = proposal.volumes.every((item) => status.volumes.find((current) => current.volume === item.order)?.title === item.title.trim())
    if (!structure || structure.fingerprint !== fingerprint(renderPlanningVolumeStructure(proposal)) || !structureCurrent) {
      throw new AppError('CONFLICT', '篇卷目录已经变化，请先重新预览并建立目录。', { recoverable: true })
    }
    if (status.totalApproval.status !== 'confirmed') {
      throw new AppError('CONFLICT', '请先复核并正式确认当前总纲，再逐卷采用候选卷纲。', { recoverable: true })
    }
    return volume
  }

  private chapterDetailEntry(proposal: PlanningPackageProposal, chapterId: number) {
    const detail = proposal.chapterDetails?.flatMap((item) => item.chapters).find((item) => item.chapter === chapterId)
    if (!detail) throw new AppError('NOT_FOUND', '候选中没有这一章的详细章纲。', { recoverable: true })
    return detail
  }

  private async chapterDetailAdoptionPreview(proposal: PlanningPackageProposal, chapterId: number): Promise<PlanningChapterDetailAdoptionPreview> {
    const detail = this.chapterDetailEntry(proposal, chapterId)
    const volume = proposal.volumes.find((item) => item.order === detail.volume)
    const detailVolume = proposal.chapterDetails?.find((item) => item.volume === detail.volume)
    const adoptedVolume = proposal.adoption?.volumeOutlines?.find((item) => item.order === detail.volume)
    if (!volume || !detailVolume || detailVolume.basedOn.totalOutlineFingerprint !== fingerprint(renderPlanningTotalOutline(proposal))
      || detailVolume.basedOn.volumeOutlineFingerprint !== fingerprint(renderPlanningVolumeOutline(volume))
      || detailVolume.basedOn.skeletonFingerprint !== fingerprint(renderPlanningChapterSkeletonVolume(proposal, detail.volume))) {
      throw new AppError('CONFLICT', '这章详细章纲的上游已经变化，请先重新生成本卷候选。', { recoverable: true })
    }
    await this.assertDetailSources(proposal, detailVolume)
    const planning = this.requirePlanning()
    const documents = this.requireDocuments()
    if (!documents.chapterOutline) throw new AppError('INVALID_PROJECT_STATE', '正式章纲读取服务尚未就绪。', { recoverable: true })
    const status = await planning.status(chapterId)
    const formalVolume = status.volumes.find((item) => item.volume === detail.volume)
    if (!adoptedVolume || adoptedVolume.fingerprint !== fingerprint(renderPlanningVolumeOutline(volume)) || formalVolume?.approval.status !== 'confirmed') {
      throw new AppError('CONFLICT', '目标卷纲必须已采用并正式确认，才能逐章写入详细章纲。', { recoverable: true })
    }
    const currentContent = (await documents.chapterOutline(chapterId)).content
    const candidateContent = renderPlanningChapterDetail(detail)
    const upstreamFingerprint = fingerprint(JSON.stringify({
      chapterId,
      volume: detail.volume,
      detail: detailVolume.basedOn,
      totalApproval: status.totalApproval.fingerprint,
      volumeApproval: formalVolume.approval.fingerprint
    }))
    return {
      proposalId: proposal.id,
      chapterId,
      volume: detail.volume,
      upstreamFingerprint,
      candidateFingerprint: chapterDetailFingerprint(detail),
      currentFingerprint: fingerprint(currentContent),
      changes: candidateContent !== currentContent,
      current: { exists: Boolean(currentContent.trim()), excerpt: excerpt(currentContent), characterCount: currentContent.length, confirmed: status.chapter?.review.status === 'confirmed' },
      candidate: { title: detail.title, excerpt: excerpt(candidateContent), characterCount: candidateContent.length, beatCount: detail.beats.length },
      affected: { confirmation: status.chapter?.review.status === 'confirmed', formalEvents: status.eventChapterPlacements.filter((item) => item.chapterId === chapterId).length }
    }
  }

  private async readStored(): Promise<PlanningPackageProposal | null> {
    const path = await this.path()
    let raw: string
    try { raw = await readFile(path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let stored: unknown
    try { stored = JSON.parse(raw) } catch { throw invalidState() }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw invalidState()
    const record = stored as Record<string, unknown>
    if (record.version !== 1 || !('proposal' in record)) throw invalidState()
    let proposal: PlanningPackageProposal
    try { [proposal] = decodePlanningPackageArgs([record.proposal]) } catch { throw invalidState() }
    await this.assertOwner(proposal)
    return proposal
  }

  private async writeStored(proposal: PlanningPackageProposal): Promise<void> {
    const stored: StoredPlanningDraft = { version: 1, proposal, updatedAt: this.now().toISOString() }
    await writeJson(await this.path(), stored)
  }

  private requirePlanning(): OutlinePlanningPort {
    if (!this.planning) throw new AppError('INVALID_PROJECT_STATE', '总纲采用服务尚未就绪。', { recoverable: true })
    return this.planning
  }

  private requireDocuments(): OutlineDocumentPort {
    if (!this.documents) throw new AppError('INVALID_PROJECT_STATE', '总纲文档服务尚未就绪。', { recoverable: true })
    return this.documents
  }

  private requireCharacters(): CharacterStatePort {
    if (!this.characters) throw new AppError('INVALID_PROJECT_STATE', '人物锚点服务尚未就绪。', { recoverable: true })
    return this.characters
  }

  private requireFoundation(): FoundationPort {
    if (!this.foundation) throw new AppError('INVALID_PROJECT_STATE', '世界观采用服务尚未就绪。', { recoverable: true })
    return this.foundation
  }

  private async path(): Promise<string> {
    const root = await this.projects.currentPath()
    return projectDirectory(root, join(root, '.webnovel', 'planning', 'automatic-planning-draft.json'))
  }

  private async serialize<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await action() } finally { release() }
  }
}

export function renderPlanningTotalOutline(proposal: PlanningPackageProposal): string {
  return `# ${proposal.totalOutline.title.trim()}\n\n> ${proposal.totalOutline.summary.trim()}\n\n${proposal.totalOutline.content.trim()}\n`
}

export function renderPlanningVolumeStructure(proposal: PlanningPackageProposal): string {
  return JSON.stringify(proposal.volumes.map((item) => ({ order: item.order, title: item.title.trim() })))
}

export function renderPlanningVolumePlan(proposal: PlanningPackageProposal): string {
  return JSON.stringify(proposal.volumes.map((item) => ({
    order: item.order,
    title: item.title.trim(),
    goal: item.goal.trim(),
    summary: item.summary.trim(),
    ending: item.ending.trim(),
    ...(item.storyContent !== undefined ? { storyContent: item.storyContent.trim() } : {})
  })))
}

export function renderPlanningVolumeOutline(volume: PlanningVolumeProposal): string {
  if (volume.storyContent !== undefined) return `# 第 ${volume.order} 卷 · ${volume.title.trim()}\n\n${volume.storyContent.trim()}\n`
  return `# 第 ${volume.order} 卷 · ${volume.title.trim()}\n\n> 本卷目标：${volume.goal.trim()}\n\n## 事件链\n\n${volume.summary.trim()}\n\n## 卷末状态\n\n${volume.ending.trim()}\n`
}

export function renderPlanningChapterSkeletonVolume(proposal: PlanningPackageProposal, volume: number): string {
  return JSON.stringify(proposal.chapterSkeleton?.chapters.filter((item) => item.volume === volume) || [])
}

export function renderPlanningCharacterSeeds(proposal: PlanningPackageProposal): string {
  return JSON.stringify(proposal.blueprint.characters.map((seed) => ({
    name: seed.name.trim(), role: seed.role.trim(), arcSeed: seed.arcSeed.trim()
  })))
}

export function renderPlanningWorldSeed(proposal: PlanningPackageProposal): string {
  return proposal.blueprint.worldView.trim()
}

export function renderPlanningPowerSystem(proposal: PlanningPackageProposal): string {
  return proposal.blueprint.powerSystem.trim()
}

export function renderPlanningCheatSystem(proposal: PlanningPackageProposal): string {
  return proposal.blueprint.cheatSystem.trim()
}

function preserveFoundationAdoptions(proposal: PlanningPackageProposal): NonNullable<PlanningPackageProposal['adoption']> {
  const { totalOutline: _totalOutline, volumeStructure: _volumeStructure, volumeOutlines: _volumeOutlines, chapterOutlines: _chapterOutlines, ...foundationAdoptions } = proposal.adoption || {}
  return foundationAdoptions
}

function volumeStructurePreview(proposal: PlanningPackageProposal, status: OutlinePlanningStatus, totalFingerprint: string): PlanningVolumeStructurePreview {
  const candidateOrders = new Set(proposal.volumes.map((item) => item.order))
  const actions = proposal.volumes.map((item) => {
    const current = status.volumes.find((volume) => volume.volume === item.order)
    return {
      order: item.order,
      action: !current ? 'create' as const : current.title === item.title.trim() ? 'keep' as const : 'rename' as const,
      ...(current ? { fromTitle: current.title } : {}),
      toTitle: item.title.trim(),
      outlineExists: current?.outlineExists || false
    }
  })
  const preservedExtraVolumes = status.volumes.filter((item) => !candidateOrders.has(item.volume)).map((item) => ({ order: item.volume, title: item.title }))
  const finalTitles = new Map(status.volumes.map((item) => [item.volume, item.title]))
  proposal.volumes.forEach((item) => finalTitles.set(item.order, item.title.trim()))
  const keys = [...finalTitles.values()].map((item) => item.normalize('NFKC').toLocaleLowerCase('zh-CN'))
  const conflicts: string[] = []
  if (proposal.volumes.some((item) => !item.title.trim() || item.title.trim().length > 120)) conflicts.push('候选卷名需要 1 到 120 个字符，请先修改候选。')
  if (new Set(keys).size !== keys.length) conflicts.push('候选卷名与当前书稿保留的篇卷重名，请先调整后再初始化。')
  return {
    proposalId: proposal.id,
    candidateFingerprint: fingerprint(renderPlanningVolumeStructure(proposal)),
    currentFingerprint: fingerprint(JSON.stringify(status.volumes.map((item) => ({ order: item.volume, title: item.title })))),
    totalFingerprint,
    changes: actions.some((item) => item.action !== 'keep'),
    actions,
    preservedExtraVolumes,
    conflicts,
    affected: {
      placedChapters: status.chapterPlacements.length,
      confirmedVolumes: status.volumes.filter((item) => item.approval.status === 'confirmed').length,
      totalConfirmation: status.totalApproval.status === 'confirmed'
    }
  }
}

function fingerprint(content: string): string { return createHash('sha256').update(content).digest('hex') }
function excerpt(content: string): string { return content.trim().slice(0, 800) }

function invalidState(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '自动谋篇候选文件已损坏；为保护作品，应用不会覆盖它。', { recoverable: false })
}

function detailConstraints(detail: ChapterStoryConstraints): ChapterStoryConstraints {
  const { entryState, beats, exitState, allowedFacts, forbiddenEvents, foreshadowActions } = detail
  return { entryState, beats, exitState, allowedFacts, forbiddenEvents, foreshadowActions }
}
