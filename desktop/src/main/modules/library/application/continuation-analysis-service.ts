import { createHash, randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import type {
  BookProfile,
  CheatSystemData,
  ContinuationAnalysisArea,
  ContinuationAnalysisCandidate,
  ContinuationAnalysisEdits,
  ContinuationAnalysisSection,
  ContinuationAnalysisState,
  ContextBudgetPreferences,
  ContinuationCharacterAdoptionInput,
  ContinuationCharacterAdoptionResult,
  ContinuationCharacterPreview,
  ContinuationCharacterPreviewInput,
  ContinuationChapterOutlineAdoptionInput,
  ContinuationChapterOutlineAdoptionResult,
  ContinuationChapterOutlinePreview,
  ContinuationCheatSystemAdoptionInput,
  ContinuationCheatSystemAdoptionResult,
  ContinuationCheatSystemPreview,
  ContinuationEvidenceRef,
  ContinuationExistingPlotAdoptionInput,
  ContinuationExistingPlotAdoptionResult,
  ContinuationExistingPlotPreview,
  ContinuationGap,
  ContinuationProjectDefinitionAdoptionInput,
  ContinuationProjectDefinitionAdoptionResult,
  ContinuationProjectDefinitionPreview,
  ContinuationPowerSystemAdoptionInput,
  ContinuationPowerSystemAdoptionResult,
  ContinuationPowerSystemPreview,
  ContinuationWorldViewAdoptionInput,
  ContinuationWorldViewAdoptionResult,
  ContinuationWorldViewPreview,
  ContinuationTotalOutlineAdoptionInput,
  ContinuationTotalOutlineAdoptionResult,
  ContinuationTotalOutlinePreview,
  ContinuationVolumeOutlineAdoptionInput,
  ContinuationVolumeOutlineAdoptionResult,
  ContinuationVolumeOutlinePreview,
  FoundationData,
  PowerSystemData,
  RealmLevel,
  OutlinePlanningStatus,
  TimelineEvent
} from '../../../../contracts/index'
import type { BookImportService, CompletedManifestEvidence } from './book-import-service'
import type { CharacterStateService } from '../../characters/application/character-state-service'
import { writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from './project-service'
import { completeStructured, StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import type { AiClient } from '../../models/application/ai-client'
import { creativePolicyRun, type CaptureCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { creativePolicyContext } from '../../writing-plugins/domain/creative-policy-context'
import { policyRecords, validatePolicyRecords } from '@lanjian/writing-plugin-contracts'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import type { EventOperationService } from '../../timeline/application/event-operation-service'
import type { EventProjectionService } from '../../timeline/application/event-projection-service'

type TextGenerator = Pick<AiClient, 'complete'> & Partial<Pick<AiClient, 'captureRun' | 'modelFor' | 'completionIdentity'>>
type ContinuationCreativeContext = { capturePolicy: CaptureCreativePolicy; context(readOnly: boolean, policy: CreativePolicyRun): Promise<string>; writes: WorkspaceWriteCoordinator }

type WorkspaceStore = {
  bookProfile: () => Promise<BookProfile>
  saveBookProfile: (input: BookProfile) => Promise<BookProfile>
  timeline: () => Promise<{ events: TimelineEvent[] }>
  saveTimeline: (events: TimelineEvent[]) => Promise<{ events: TimelineEvent[] }>
  foundationSnapshot: () => Promise<{ data: FoundationData; fingerprint: string }>
  adoptPlanningWorldView: (input: { worldView: string; currentFingerprint: string }) => Promise<{ data: FoundationData; fingerprint: string }>
  powerSystemSnapshot: () => Promise<{ data: PowerSystemData; fingerprint: string }>
  adoptPlanningPowerSystem: (input: { overview: string; currentFingerprint: string }) => Promise<{ data: PowerSystemData; fingerprint: string }>
  realms: () => Promise<{ levels: RealmLevel[] }>
  cheatSystemSnapshot: () => Promise<{ data: CheatSystemData; fingerprint: string }>
  adoptPlanningCheatSystem: (input: { overview: string; currentFingerprint: string }) => Promise<{ data: CheatSystemData; fingerprint: string }>
  systemTemplate: () => Promise<{ template: string }>
  contextBudgetPreferences: () => Promise<ContextBudgetPreferences>
}

type OutlineStore = {
  importedTotalOutlineSnapshot: () => Promise<{ content: string; fingerprint: string; revision: number; confirmed: boolean; volumeOutlines: number; chapterOutlines: number }>
  adoptImportedTotalOutline: (input: { content: string; currentFingerprint: string }) => Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }>
  importedVolumeOutlineSnapshot: (volume: number) => Promise<{
    volume: number; title: string; content: string; fingerprint: string; revision: number; confirmed: boolean
    parentTotalFingerprint: string; parentTotalConfirmed: boolean; siblingVolumeOutlines: number; chapterOutlines: number
  }>
  adoptImportedVolumeOutline: (input: { volume: number; content: string; currentFingerprint: string; parentTotalFingerprint: string }) => Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }>
  importedChapterOutlineSnapshot: (chapterId: number) => Promise<{
    chapterId: number; position: number; title: string; wordCount: number; content: string; fingerprint: string
    volume: number; volumeTitle: string; parentTotalFingerprint: string; parentTotalConfirmed: boolean
    parentVolumeFingerprint: string; parentVolumeConfirmed: boolean; chapterConfirmed: boolean; siblingChapterOutlines: number
  }>
  adoptImportedChapterOutline: (input: { chapterId: number; content: string; currentFingerprint: string; parentTotalFingerprint: string; parentVolumeFingerprint: string }) => Promise<{ content: string; fingerprint: string; status: OutlinePlanningStatus }>
}

type ExistingPlotEvents = {
  projection: Pick<EventProjectionService, 'read'>
  operations: Pick<EventOperationService, 'previewVerifiedManuscript' | 'commitVerifiedManuscript' | 'receipt'>
}

type ExistingPlotPending = {
  version: 1
  candidateId: string
  candidateFingerprint: string
  eventFingerprint: string
  event: TimelineEvent
  operationId: string
  requestHash: string
  manifestId: string
  sourceFingerprint: string
  evidenceFingerprint: string
  createdAt: string
}

const areas: ContinuationAnalysisArea[] = ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline']
const requiredAreas = new Set<ContinuationAnalysisArea>(['projectDefinition', 'existingPlot', 'characters'])
const labels: Record<ContinuationAnalysisArea, string> = {
  projectDefinition: '作品定义', existingPlot: '已有剧情', characters: '人物', worldView: '世界观', powerSystem: '力量或境界',
  cheatSystem: '金手指或特殊优势', totalOutline: '总纲碎片', volumeOutline: '卷纲碎片', chapterOutline: '章纲碎片'
}

export class ContinuationAnalysisService {
  private readonly writes: WorkspaceWriteCoordinator
  constructor(
    private readonly ai: TextGenerator,
    private readonly projects: ProjectService,
    private readonly imports: BookImportService,
    private readonly workspace: WorkspaceStore,
    private readonly characterStates: CharacterStateService,
    private readonly outlines: OutlineStore,
    private readonly events?: ExistingPlotEvents,
    private readonly creativity?: ContinuationCreativeContext
  ) { this.writes = creativity?.writes ?? new WorkspaceWriteCoordinator() }

  async state(): Promise<ContinuationAnalysisState> {
    const latest = await this.imports.latestCompletedManifestId()
    let candidate: ContinuationAnalysisCandidate | null = null
    let blockedReason: string | undefined
    try {
      candidate = await this.readCandidate()
    }
    catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') blockedReason = error.message
      else throw error
    }
    return {
      candidate,
      ...(!blockedReason && (!candidate || candidate.manifestId !== latest) && latest ? { availableManifestId: latest } : {}),
      ...(blockedReason ? { blockedReason } : {})
    }
  }

  async generate(manifestId: string): Promise<ContinuationAnalysisCandidate> {
    return this.projects.runInCurrentBook ? this.projects.runInCurrentBook(() => this.generateInBook(manifestId)) : this.generateInBook(manifestId)
  }

  private async generateInBook(manifestId: string): Promise<ContinuationAnalysisCandidate> {
    // A malformed candidate is evidence. Never replace it through a new model
    // run; the author must first preserve and repair or remove it deliberately.
    await this.readCandidate()
    const root = await this.projects.currentPath(), physicalIdentity = this.projects.executionIdentity?.physicalIdentity
    const path = await this.candidatePath(), before = await candidateFileHash(path)
    const policy = await (this.creativity?.capturePolicy() ?? creativePolicyRun())
    const ai = this.ai.captureRun ? await this.ai.captureRun(['outline']) : this.ai
    const model = await ai.modelFor?.('outline'), identity = await ai.completionIdentity?.('outline', model)
    const [evidence, project] = await Promise.all([this.imports.completedManifestEvidence(manifestId), this.projects.currentSummary()])
    const profile = await this.workspace.bookProfile(), profileHash = contentFingerprint(JSON.stringify(profile))
    const withPolicy = <T>(operation: () => Promise<T>) => policy.withContext ? policy.withContext(operation) : operation()
    const context = await withPolicy(async () => this.creativity?.context(false, policy) ?? '')
    const sources = [...policy.resolve('continuation-analysis'), ...policy.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' })]
    const methods = creativePolicyContext(sources), contextHash = contentFingerprint(context)
    if (context.length > 200_000) throw staleAnalysis('旧稿整理的正式材料超出预算，请缩小材料范围。')
    const guard = async () => {
      if (resolve(await this.projects.currentPath()) !== resolve(root) || this.projects.executionIdentity?.physicalIdentity !== physicalIdentity) throw staleAnalysis('原作品身份已经变化，请重新发起。')
      await policy.assertAuthorized?.()
      const formal = await withPolicy(async () => this.creativity?.context(true, policy) ?? '')
      if (contentFingerprint(formal) !== contextHash || contentFingerprint(JSON.stringify(await this.workspace.bookProfile())) !== profileHash) throw staleAnalysis('正式依据或作品定义已经变化，请重新发起。')
      const current = await this.imports.completedManifestEvidence(manifestId)
      if (current.id !== evidence.id || current.sourceFingerprint !== evidence.sourceFingerprint) throw staleAnalysis('原导入证据已经变化，请重新核对。')
      if (await this.ai.completionIdentity?.('outline', model) !== identity || await ai.completionIdentity?.('outline', model) !== identity) throw staleAnalysis('原模型配置已经变化，请重新发起。')
      await policy.assertAuthorized?.()
      if (resolve(await this.projects.currentPath()) !== resolve(root) || this.projects.executionIdentity?.physicalIdentity !== physicalIdentity) throw staleAnalysis('原作品身份已经变化，请重新发起。')
    }
    const beforeCommit = async () => { await guard(); if (await candidateFileHash(path) !== before) throw staleAnalysis('接续候选已经被编辑或采用，请保留新内容并重新发起。'); await policy.assertAuthorized?.() }
    const instruction = buildInstruction(evidence)
    let parsed: ReturnType<typeof parseContinuationAnalysis>
    try {
      parsed = await completeStructured({
        ai: { complete: async (...args: Parameters<AiClient['complete']>) => { await beforeCommit(); const result = await withPolicy(() => ai.complete(...args)); await beforeCommit(); return result } }, instruction, model,
        systemContext: `只返回候选，原证据/作者要求/正式设定/动态境界和固定系统模板优先；创作方法不能确认事实或大纲。\n${methods}\n本书正式上下文：\n${context}`,
        task: 'outline', repairAttempts: (await this.workspace.contextBudgetPreferences()).structuredRepairAttempts,
        parse: (content) => parseContinuationAnalysis(content, evidence)
      })
    } catch (error) {
      if (error instanceof StructuredResponseFailure && Buffer.byteLength(error.originalContent) <= 5 * 1024 * 1024) {
        await this.writes.run(root, async () => {
          await beforeCommit()
          const target = before === null ? path : await projectDirectory(root, join(root, '.webnovel', 'imports', `continuation-analysis-failed-${randomUUID()}.txt`))
          await atomicWriteText(target, error.originalContent, beforeCommit)
        })
      }
      throw error
    }
    const now = new Date().toISOString()
    const candidate: ContinuationAnalysisCandidate = {
      version: 1,
      id: randomUUID(),
      workItemId: project.id,
      manifestId,
      sourceFingerprint: evidence.sourceFingerprint,
      createdAt: now,
      updatedAt: now,
      status: 'candidate',
      sections: parsed.sections,
      gaps: buildGaps(parsed.sections),
      rationale: parsed.rationale,
      creativePolicy: policyRecords(sources)
    }
    await this.writes.run(root, async () => { await beforeCommit(); await writeJson(path, candidate, beforeCommit) })
    return structuredClone(candidate)
  }

  async saveEdits(input: ContinuationAnalysisEdits): Promise<ContinuationAnalysisCandidate> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw new AppError('CONFLICT', '接续分析候选已经变化，请重新打开作品后再编辑', { recoverable: true })
    const edits = new Map(input.sections.map((section) => [section.area, section.content.trim()]))
    if (edits.size !== areas.length || areas.some((area) => !edits.has(area))) throw new AppError('VALIDATION_ERROR', '接续分析编辑缺少必要类别', { recoverable: true })
    candidate.sections = candidate.sections.map((section) => ({ ...section, content: edits.get(section.area) || '' }))
    const projectDefinition = candidate.sections.find((section) => section.area === 'projectDefinition')?.content || ''
    if (candidate.adoption?.projectDefinition?.candidateFingerprint !== contentFingerprint(projectDefinition)) {
      delete candidate.adoption?.projectDefinition
    }
    const existingPlot = candidate.sections.find((section) => section.area === 'existingPlot')?.content || ''
    if (candidate.adoption?.existingPlot) {
      candidate.adoption.existingPlot = candidate.adoption.existingPlot.filter((item) => item.candidateFingerprint === contentFingerprint(existingPlot))
      if (!candidate.adoption.existingPlot.length) delete candidate.adoption.existingPlot
    }
    const characters = candidate.sections.find((section) => section.area === 'characters')?.content || ''
    if (candidate.adoption?.characters) {
      candidate.adoption.characters = candidate.adoption.characters.filter((item) => item.candidateFingerprint === contentFingerprint(characters))
      if (!candidate.adoption.characters.length) delete candidate.adoption.characters
    }
    const worldView = candidate.sections.find((section) => section.area === 'worldView')?.content || ''
    if (candidate.adoption?.worldView?.candidateFingerprint !== contentFingerprint(worldView)) delete candidate.adoption?.worldView
    const powerSystem = candidate.sections.find((section) => section.area === 'powerSystem')?.content || ''
    if (candidate.adoption?.powerSystem?.candidateFingerprint !== contentFingerprint(powerSystem)) delete candidate.adoption?.powerSystem
    const cheatSystem = candidate.sections.find((section) => section.area === 'cheatSystem')?.content || ''
    if (candidate.adoption?.cheatSystem?.candidateFingerprint !== contentFingerprint(cheatSystem)) delete candidate.adoption?.cheatSystem
    const totalOutline = candidate.sections.find((section) => section.area === 'totalOutline')?.content || ''
    if (candidate.adoption?.totalOutline?.candidateFingerprint !== contentFingerprint(totalOutline)
      || !hasAllContinuationPrerequisiteReceipts(candidate)) delete candidate.adoption?.totalOutline
    const volumeOutline = candidate.sections.find((section) => section.area === 'volumeOutline')?.content || ''
    if (!candidate.adoption?.totalOutline || candidate.adoption?.volumeOutlines?.some((item) => item.candidateFingerprint !== contentFingerprint(volumeOutline))) {
      delete candidate.adoption?.volumeOutlines
    }
    const chapterOutline = candidate.sections.find((section) => section.area === 'chapterOutline')?.content || ''
    if (!candidate.adoption?.volumeOutlines?.length || candidate.adoption?.chapterOutlines?.some((item) => item.candidateFingerprint !== contentFingerprint(chapterOutline))) {
      delete candidate.adoption?.chapterOutlines
    }
    if (candidate.adoption && !Object.keys(candidate.adoption).length) delete candidate.adoption
    candidate.rationale = input.rationale.trim()
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return structuredClone(candidate)
  }

  async previewProjectDefinition(candidateId: string): Promise<ContinuationProjectDefinitionPreview> {
    const [candidate, profile] = await Promise.all([this.readCandidate(), this.workspace.bookProfile()])
    if (!candidate || candidate.id !== candidateId) throw new AppError('CONFLICT', '接续分析候选已经变化，请重新打开作品后再预览', { recoverable: true })
    const content = candidate.sections.find((section) => section.area === 'projectDefinition')?.content.trim() || ''
    return {
      candidateId: candidate.id,
      area: 'projectDefinition',
      currentCoreIdea: profile.coreIdea,
      candidateCoreIdea: content,
      candidateFingerprint: contentFingerprint(content),
      currentProfileFingerprint: profileFingerprint(profile),
      preserved: [
        `主类别：${profile.genre}`,
        `细分类：${profile.subgenre || '暂不细分'}`,
        `预计卷数：${profile.plannedVolumes}`,
        `每卷章数：${profile.chaptersPerVolume}`,
        `单章目标字数：${profile.targetWordsPerChapter}`
      ],
      canAdopt: Boolean(content),
      ...(!content ? { reason: '作品定义候选还是空白，请先补写并保存候选。' } : {})
    }
  }

  async adoptProjectDefinition(input: ContinuationProjectDefinitionAdoptionInput): Promise<ContinuationProjectDefinitionAdoptionResult> {
    const [candidate, profile] = await Promise.all([this.readCandidate(), this.workspace.bookProfile()])
    if (!candidate || candidate.id !== input.candidateId) throw staleAdoption()
    const content = candidate.sections.find((section) => section.area === 'projectDefinition')?.content.trim() || ''
    if (!content) throw new AppError('VALIDATION_ERROR', '作品定义候选还是空白，无法采用', { recoverable: true })
    if (contentFingerprint(content) !== input.candidateFingerprint || profileFingerprint(profile) !== input.currentProfileFingerprint) throw staleAdoption()
    const savedProfile = await this.workspace.saveBookProfile({ ...profile, coreIdea: content })
    candidate.adoption = {
      ...candidate.adoption,
      projectDefinition: {
        candidateFingerprint: input.candidateFingerprint,
        profileFingerprint: profileFingerprint(savedProfile),
        adoptedAt: new Date().toISOString()
      }
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), profile: structuredClone(savedProfile) }
  }

  async previewExistingPlot(candidateId: string): Promise<ContinuationExistingPlotPreview> {
    if (!this.events) return this.previewExistingPlotCompatibility(candidateId)
    let candidate = await this.readCandidate()
    if (!candidate || candidate.id !== candidateId) throw new AppError('CONFLICT', '接续分析候选已经变化，请重新打开作品后再预览', { recoverable: true })
    const projection = await this.eventStore().projection.read()
    const section = candidate.sections.find((item) => item.area === 'existingPlot')
    const content = section?.content.trim() || ''
    const alreadyConfirmed = Boolean(candidate.adoption?.existingPlot?.some((item) => item.candidateFingerprint === contentFingerprint(content)))
    const canAdopt = Boolean(content && section?.evidence.length && !alreadyConfirmed)
    return {
      candidateId: candidate.id,
      area: 'existingPlot',
      candidateEvent: content,
      candidateFingerprint: contentFingerprint(content),
      currentTimelineFingerprint: projection.approvedRevision,
      evidence: structuredClone(section?.evidence || []),
      canAdopt,
      ...(!content ? { reason: '已有剧情候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '已有剧情没有可核对的原文证据，不能写入正式纪事。' }
          : alreadyConfirmed ? { reason: '这项已有剧情已经确认过，请勿重复写入。' } : {})
    }
  }

  async adoptExistingPlot(input: ContinuationExistingPlotAdoptionInput): Promise<ContinuationExistingPlotAdoptionResult> {
    if (!this.events) return this.adoptExistingPlotCompatibility(input)
    let candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw stalePlotAdoption()
    const store = this.eventStore(), projection = await store.projection.read()
    const section = candidate.sections.find((item) => item.area === 'existingPlot')
    const content = section?.content.trim() || ''
    if (!content || !section?.evidence.length) throw new AppError('VALIDATION_ERROR', '已有剧情必须同时具备候选内容和原文证据', { recoverable: true })
    if (contentFingerprint(content) !== input.candidateFingerprint || projection.approvedRevision !== input.currentTimelineFingerprint) throw stalePlotAdoption()
    const event: TimelineEvent = {
      id: '',
      time: input.event.time.trim(),
      characters: input.event.characters.trim(),
      location: input.event.location.trim(),
      event: input.event.event.trim()
    }
    if (!event.time || !event.characters || !event.location || !event.event) throw new AppError('VALIDATION_ERROR', '请完整填写时间、人物、地点和事件', { recoverable: true })
    const eventFingerprintValue = timelineEventFingerprint(event)
    const previousAdoptions = candidate.adoption?.existingPlot || []
    if (previousAdoptions.some((item) => item.eventFingerprint === eventFingerprintValue)) {
      throw new AppError('CONFLICT', '这项已有剧情已经确认过，请勿重复写入', { recoverable: true })
    }
    const verified = await this.verifiedExistingPlotEvidence(candidate, section.evidence)
    const characters = event.characters.split(/[、,，;；\n]+/u).map((name) => name.trim()).filter(Boolean)
    if (!characters.length || characters.length > 100 || new Set(characters).size !== characters.length) {
      throw new AppError('VALIDATION_ERROR', '人物请使用顿号、逗号、分号或换行分隔，且不要重复', { recoverable: true })
    }
    const preview = await store.operations.previewVerifiedManuscript({
      expectedOrderId: projection.state.order.id,
      content: { time: event.time, characters, rawCharacters: event.characters, location: event.location,
        event: event.event, evidenceRefs: [], confidence: 1 },
      manifestId: verified.id,
      sourceFingerprint: verified.sourceFingerprint,
      evidenceFingerprint: verified.evidenceFingerprint,
      manuscriptSources: verified.manuscriptSources
    })
    const pending: ExistingPlotPending = {
      version: 1, candidateId: candidate.id, candidateFingerprint: input.candidateFingerprint,
      eventFingerprint: eventFingerprintValue, event, operationId: preview.operationId, requestHash: preview.requestHash,
      manifestId: verified.id, sourceFingerprint: verified.sourceFingerprint,
      evidenceFingerprint: verified.evidenceFingerprint, createdAt: new Date().toISOString()
    }
    await writeJson(await this.existingPlotPendingPath(), pending)
    await store.operations.commitVerifiedManuscript(preview.token, async () => {
      const current = await this.verifiedExistingPlotEvidence(candidate!, section.evidence)
      if (current.id !== pending.manifestId || current.sourceFingerprint !== pending.sourceFingerprint
        || current.evidenceFingerprint !== pending.evidenceFingerprint) throw stalePlotAdoption()
    })
    candidate = await this.recoverExistingPlot(candidate)
    const current = await store.projection.read()
    const adopted = current.approved.find((item) => item.eventId === candidate.adoption?.existingPlot?.at(-1)?.timelineEventId)
    if (!adopted) throw new AppError('DATABASE_INTEGRITY_FAILED', '已有剧情回执存在，但统一事件投影缺少对应版本。', { recoverable: false })
    const timeline = { events: current.approved.map(projectedTimelineEvent) }
    return { candidate: structuredClone(candidate), event: projectedTimelineEvent(adopted), timeline: structuredClone(timeline) }
  }

  async previewCharacter(input: ContinuationCharacterPreviewInput): Promise<ContinuationCharacterPreview> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleCharacterAdoption()
    const section = candidate.sections.find((item) => item.area === 'characters')
    const content = section?.content.trim() || ''
    const character = normalizedCharacter(input.character)
    if (!character.name || !character.role || !character.arcSeed) {
      throw new AppError('VALIDATION_ERROR', '请完整填写人物名、初始定位和人物弧方向', { recoverable: true })
    }
    const anchorPreview = await this.characterStates.previewStableAnchor(characterSourceId(candidate.id, character.name), character)
    const action = anchorPreview.actions[0]
    const alreadyConfirmed = Boolean(candidate.adoption?.characters?.some((item) => normalizedName(item.name) === normalizedName(character.name)))
    return {
      candidateId: candidate.id,
      area: 'characters',
      candidateSummary: content,
      sectionFingerprint: contentFingerprint(content),
      characterFingerprint: anchorPreview.candidateFingerprint,
      currentAnchorFingerprint: anchorPreview.currentFingerprint,
      character,
      action: action.action,
      ...(action.current ? { current: action.current } : {}),
      evidence: structuredClone(section?.evidence || []),
      affected: structuredClone(anchorPreview.affected),
      canAdopt: Boolean(content && section?.evidence.length && !anchorPreview.conflicts.length && !alreadyConfirmed),
      ...(!content ? { reason: '人物候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '人物候选没有可核对的原文证据，不能建立正式锚点。' }
          : alreadyConfirmed ? { reason: '这个人物已经逐人确认过，请在正式人物锚点中继续维护。' }
            : anchorPreview.conflicts.length ? { reason: anchorPreview.conflicts[0] } : {})
    }
  }

  async adoptCharacter(input: ContinuationCharacterAdoptionInput): Promise<ContinuationCharacterAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleCharacterAdoption()
    const section = candidate.sections.find((item) => item.area === 'characters')
    const content = section?.content.trim() || ''
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.sectionFingerprint) throw staleCharacterAdoption()
    const character = normalizedCharacter(input.character)
    if (!character.name || !character.role || !character.arcSeed) {
      throw new AppError('VALIDATION_ERROR', '请完整填写人物名、初始定位和人物弧方向', { recoverable: true })
    }
    const previousAdoptions = candidate.adoption?.characters || []
    if (previousAdoptions.some((item) => normalizedName(item.name) === normalizedName(character.name))) {
      throw new AppError('CONFLICT', '这个人物已经逐人确认过，请在正式人物锚点中继续维护', { recoverable: true })
    }
    const adopted = await this.characterStates.adoptStableAnchor({
      sourceId: characterSourceId(candidate.id, character.name),
      seed: character,
      candidateFingerprint: input.characterFingerprint,
      currentFingerprint: input.currentAnchorFingerprint
    })
    candidate.adoption = {
      ...candidate.adoption,
      characters: [...previousAdoptions, {
        candidateFingerprint: input.sectionFingerprint,
        anchorFingerprint: input.characterFingerprint,
        name: character.name,
        adoptedAt: new Date().toISOString()
      }]
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), characters: adopted.state }
  }

  async previewWorldView(candidateId: string): Promise<ContinuationWorldViewPreview> {
    const [candidate, foundation] = await Promise.all([this.readCandidate(), this.workspace.foundationSnapshot()])
    if (!candidate || candidate.id !== candidateId) throw staleWorldViewAdoption()
    const section = candidate.sections.find((item) => item.area === 'worldView')
    const content = section?.content.trim() || ''
    const canAdopt = Boolean(content && section?.evidence.length)
    return {
      candidateId: candidate.id,
      area: 'worldView',
      currentWorldView: foundation.data.worldView,
      candidateWorldView: content,
      candidateFingerprint: contentFingerprint(content),
      currentFoundationFingerprint: foundation.fingerprint,
      evidence: structuredClone(section?.evidence || []),
      preserved: [
        `作者札记：${foundation.data.sourceNotes ? '原样保留' : '当前为空'}`,
        `素材路径：${foundation.data.creationPath === 'research' ? '采风为主' : '自备素材为主'}`,
        `境界开关：${foundation.data.useRealms ? '保持启用' : '保持关闭'}`,
        `系统开关：${foundation.data.useSystem ? '保持启用' : '保持关闭'}`,
        '力量体系、境界表与特殊优势：全部保留'
      ],
      changes: foundation.data.worldView.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '世界观候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '世界观候选没有可核对的原文证据，不能写入正式设定。' } : {})
    }
  }

  async adoptWorldView(input: ContinuationWorldViewAdoptionInput): Promise<ContinuationWorldViewAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleWorldViewAdoption()
    const section = candidate.sections.find((item) => item.area === 'worldView')
    const content = section?.content.trim() || ''
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.candidateFingerprint) throw staleWorldViewAdoption()
    const saved = await this.workspace.adoptPlanningWorldView({ worldView: content, currentFingerprint: input.currentFoundationFingerprint })
    candidate.adoption = {
      ...candidate.adoption,
      worldView: {
        candidateFingerprint: input.candidateFingerprint,
        foundationFingerprint: saved.fingerprint,
        adoptedAt: new Date().toISOString()
      }
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), foundation: structuredClone(saved.data) }
  }

  async previewPowerSystem(candidateId: string): Promise<ContinuationPowerSystemPreview> {
    const [candidate, powerSystem, realms, foundation] = await Promise.all([
      this.readCandidate(), this.workspace.powerSystemSnapshot(), this.workspace.realms(), this.workspace.foundationSnapshot()
    ])
    if (!candidate || candidate.id !== candidateId) throw stalePowerSystemAdoption()
    const section = candidate.sections.find((item) => item.area === 'powerSystem')
    const content = section?.content.trim() || ''
    const canAdopt = Boolean(content && section?.evidence.length)
    return {
      candidateId: candidate.id,
      area: 'powerSystem',
      currentOverview: powerSystem.data.overview,
      candidateOverview: content,
      candidateFingerprint: contentFingerprint(content),
      currentPowerSystemFingerprint: powerSystem.fingerprint,
      evidence: structuredClone(section?.evidence || []),
      preserved: { realmLevels: realms.levels.length, realmsEnabled: foundation.data.useRealms },
      changes: powerSystem.data.overview.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '力量体系候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '力量体系候选没有可核对的原文证据，不能写入正式设定。' } : {})
    }
  }

  async adoptPowerSystem(input: ContinuationPowerSystemAdoptionInput): Promise<ContinuationPowerSystemAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw stalePowerSystemAdoption()
    const section = candidate.sections.find((item) => item.area === 'powerSystem')
    const content = section?.content.trim() || ''
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.candidateFingerprint) throw stalePowerSystemAdoption()
    const saved = await this.workspace.adoptPlanningPowerSystem({ overview: content, currentFingerprint: input.currentPowerSystemFingerprint })
    candidate.adoption = {
      ...candidate.adoption,
      powerSystem: {
        candidateFingerprint: input.candidateFingerprint,
        powerSystemFingerprint: saved.fingerprint,
        adoptedAt: new Date().toISOString()
      }
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), powerSystem: structuredClone(saved.data) }
  }

  async previewCheatSystem(candidateId: string): Promise<ContinuationCheatSystemPreview> {
    const [candidate, cheatSystem, foundation, systemTemplate] = await Promise.all([
      this.readCandidate(), this.workspace.cheatSystemSnapshot(), this.workspace.foundationSnapshot(), this.workspace.systemTemplate()
    ])
    if (!candidate || candidate.id !== candidateId) throw staleCheatSystemAdoption()
    const section = candidate.sections.find((item) => item.area === 'cheatSystem')
    const content = section?.content.trim() || ''
    const canAdopt = Boolean(content && section?.evidence.length)
    return {
      candidateId: candidate.id,
      area: 'cheatSystem',
      currentOverview: cheatSystem.data.overview,
      candidateOverview: content,
      candidateFingerprint: contentFingerprint(content),
      currentCheatSystemFingerprint: cheatSystem.fingerprint,
      evidence: structuredClone(section?.evidence || []),
      preserved: { systemEnabled: foundation.data.useSystem, templateConfigured: Boolean(systemTemplate.template.trim()) },
      changes: cheatSystem.data.overview.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '特殊优势候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '特殊优势候选没有可核对的原文证据，不能写入正式设定。' } : {})
    }
  }

  async adoptCheatSystem(input: ContinuationCheatSystemAdoptionInput): Promise<ContinuationCheatSystemAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleCheatSystemAdoption()
    const section = candidate.sections.find((item) => item.area === 'cheatSystem')
    const content = section?.content.trim() || ''
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.candidateFingerprint) throw staleCheatSystemAdoption()
    const saved = await this.workspace.adoptPlanningCheatSystem({ overview: content, currentFingerprint: input.currentCheatSystemFingerprint })
    candidate.adoption = {
      ...candidate.adoption,
      cheatSystem: {
        candidateFingerprint: input.candidateFingerprint,
        cheatSystemFingerprint: saved.fingerprint,
        adoptedAt: new Date().toISOString()
      }
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), cheatSystem: structuredClone(saved.data) }
  }

  async previewTotalOutline(candidateId: string): Promise<ContinuationTotalOutlinePreview> {
    const [candidate, outline] = await Promise.all([this.readCandidate(), this.outlines.importedTotalOutlineSnapshot()])
    if (!candidate || candidate.id !== candidateId) throw staleTotalOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'totalOutline')
    const content = section?.content.trim() || ''
    const prerequisite = await this.continuationPrerequisiteSnapshot(candidate)
    const canAdopt = Boolean(content && section?.evidence.length && prerequisite.fingerprint)
    return {
      candidateId: candidate.id,
      area: 'totalOutline',
      currentOutline: outline.content,
      candidateOutline: content,
      candidateFingerprint: contentFingerprint(content),
      currentOutlineFingerprint: outline.fingerprint,
      prerequisiteFingerprint: prerequisite.fingerprint,
      evidence: structuredClone(section?.evidence || []),
      affected: { currentRevision: outline.revision, totalConfirmed: outline.confirmed, volumeOutlines: outline.volumeOutlines, chapterOutlines: outline.chapterOutlines },
      changes: outline.content.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '总纲候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '总纲候选没有可核对的原文证据，不能写入正式总纲。' }
          : !prerequisite.fingerprint ? { reason: `请先完成前置确认：${prerequisite.missing.join('、')}。` } : {})
    }
  }

  async adoptTotalOutline(input: ContinuationTotalOutlineAdoptionInput): Promise<ContinuationTotalOutlineAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleTotalOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'totalOutline')
    const content = section?.content.trim() || ''
    const prerequisite = await this.continuationPrerequisiteSnapshot(candidate)
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.candidateFingerprint
      || !prerequisite.fingerprint || prerequisite.fingerprint !== input.prerequisiteFingerprint) throw staleTotalOutlineAdoption()
    const saved = await this.outlines.adoptImportedTotalOutline({ content, currentFingerprint: input.currentOutlineFingerprint })
    candidate.adoption = {
      ...candidate.adoption,
      totalOutline: {
        candidateFingerprint: input.candidateFingerprint,
        outlineFingerprint: saved.fingerprint,
        prerequisiteFingerprint: input.prerequisiteFingerprint,
        revision: saved.status.totalRevision,
        adoptedAt: new Date().toISOString()
      }
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), planning: saved.status, content: saved.content }
  }

  async previewVolumeOutline(candidateId: string, volume: number): Promise<ContinuationVolumeOutlinePreview> {
    const [candidate, outline] = await Promise.all([this.readCandidate(), this.outlines.importedVolumeOutlineSnapshot(volume)])
    if (!candidate || candidate.id !== candidateId) throw staleVolumeOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'volumeOutline')
    const content = section?.content.trim() || ''
    const candidateFingerprint = contentFingerprint(content)
    const receipt = candidate.adoption?.volumeOutlines?.find((item) => item.volume === volume)
    const otherReceipt = candidate.adoption?.volumeOutlines?.find((item) => item.volume !== volume && item.candidateFingerprint === candidateFingerprint)
    const canAdopt = Boolean(content && section?.evidence.length && candidate.adoption?.totalOutline && outline.parentTotalConfirmed && !receipt && !otherReceipt)
    return {
      candidateId: candidate.id,
      area: 'volumeOutline',
      volume,
      volumeTitle: outline.title,
      currentOutline: outline.content,
      candidateOutline: content,
      candidateFingerprint,
      currentOutlineFingerprint: outline.fingerprint,
      parentTotalFingerprint: outline.parentTotalFingerprint,
      evidence: structuredClone(section?.evidence || []),
      affected: {
        currentRevision: outline.revision,
        volumeConfirmed: outline.confirmed,
        siblingVolumeOutlines: outline.siblingVolumeOutlines,
        chapterOutlines: outline.chapterOutlines
      },
      changes: outline.content.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '卷纲候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '卷纲候选没有可核对的原文证据，不能写入正式卷纲。' }
          : !candidate.adoption?.totalOutline ? { reason: '请先采用旧稿总纲候选，并在谋篇中正式确认当前总纲。' }
            : !outline.parentTotalConfirmed ? { reason: '当前总纲尚未正式确认，请先在谋篇中复核确认。' }
              : receipt ? { reason: `这段候选已经采用到第 ${volume} 卷，请前往谋篇复核。` }
                : otherReceipt ? { reason: `这段卷纲碎片已用于第 ${otherReceipt.volume} 卷；如需用于另一卷，请先修改候选内容。` } : {})
    }
  }

  async adoptVolumeOutline(input: ContinuationVolumeOutlineAdoptionInput): Promise<ContinuationVolumeOutlineAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleVolumeOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'volumeOutline')
    const content = section?.content.trim() || ''
    const candidateFingerprint = contentFingerprint(content)
    if (!candidate.adoption?.totalOutline || !content || !section?.evidence.length || candidateFingerprint !== input.candidateFingerprint) throw staleVolumeOutlineAdoption()
    if (candidate.adoption.volumeOutlines?.some((item) => item.volume === input.volume || (item.volume !== input.volume && item.candidateFingerprint === candidateFingerprint))) {
      throw new AppError('CONFLICT', '这段卷纲候选已经采用，请先复核现有落点或修改候选内容。', { recoverable: true })
    }
    const saved = await this.outlines.adoptImportedVolumeOutline({
      volume: input.volume,
      content,
      currentFingerprint: input.currentOutlineFingerprint,
      parentTotalFingerprint: input.parentTotalFingerprint
    })
    const target = saved.status.volumes.find((item) => item.volume === input.volume)
    if (!target) throw new AppError('INVALID_PROJECT_STATE', '卷纲已写入但版本账本没有目标篇卷，已停止记录采用凭据。', { recoverable: true })
    candidate.adoption = {
      ...candidate.adoption,
      volumeOutlines: [
        ...(candidate.adoption.volumeOutlines || []),
        {
          volume: input.volume,
          candidateFingerprint,
          outlineFingerprint: saved.fingerprint,
          parentTotalFingerprint: input.parentTotalFingerprint,
          revision: target.revision,
          adoptedAt: new Date().toISOString()
        }
      ]
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), planning: saved.status, content: saved.content }
  }

  async previewChapterOutline(candidateId: string, chapterId: number): Promise<ContinuationChapterOutlinePreview> {
    const [candidate, outline] = await Promise.all([this.readCandidate(), this.outlines.importedChapterOutlineSnapshot(chapterId)])
    if (!candidate || candidate.id !== candidateId) throw staleChapterOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'chapterOutline')
    const content = section?.content.trim() || ''
    const candidateFingerprint = contentFingerprint(content)
    const parentReceipt = candidate.adoption?.volumeOutlines?.find((item) => item.volume === outline.volume)
    const receipt = candidate.adoption?.chapterOutlines?.find((item) => item.chapterId === chapterId)
    const otherReceipt = candidate.adoption?.chapterOutlines?.find((item) => item.chapterId !== chapterId && item.candidateFingerprint === candidateFingerprint)
    const canAdopt = Boolean(content && section?.evidence.length && parentReceipt && outline.parentTotalConfirmed && outline.parentVolumeConfirmed && !receipt && !otherReceipt)
    return {
      candidateId: candidate.id,
      area: 'chapterOutline',
      chapterId,
      chapterPosition: outline.position,
      chapterTitle: outline.title,
      volume: outline.volume,
      volumeTitle: outline.volumeTitle,
      currentOutline: outline.content,
      candidateOutline: content,
      candidateFingerprint,
      currentOutlineFingerprint: outline.fingerprint,
      parentTotalFingerprint: outline.parentTotalFingerprint,
      parentVolumeFingerprint: outline.parentVolumeFingerprint,
      evidence: structuredClone(section?.evidence || []),
      affected: { chapterConfirmed: outline.chapterConfirmed, siblingChapterOutlines: outline.siblingChapterOutlines, manuscriptWordCount: outline.wordCount },
      changes: outline.content.trim() !== content,
      canAdopt,
      ...(!content ? { reason: '章纲候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '章纲候选没有可核对的原文证据，不能写入正式章纲。' }
          : !parentReceipt ? { reason: `请先把旧稿卷纲候选采用到第 ${outline.volume} 卷，并完成本卷复核。` }
            : !outline.parentTotalConfirmed ? { reason: '当前总纲尚未正式确认，请先在谋篇中复核确认。' }
              : !outline.parentVolumeConfirmed ? { reason: `第 ${outline.volume} 卷卷纲尚未正式确认，请先完成本卷复核。` }
                : receipt ? { reason: `这段候选已经采用到第 ${outline.position} 章，请前往谋篇复核。` }
                  : otherReceipt ? { reason: `这段章纲碎片已用于第 ${otherReceipt.chapterId} 号章节；如需用于另一章，请先修改候选内容。` } : {})
    }
  }

  async adoptChapterOutline(input: ContinuationChapterOutlineAdoptionInput): Promise<ContinuationChapterOutlineAdoptionResult> {
    const candidate = await this.readCandidate()
    if (!candidate || candidate.id !== input.candidateId) throw staleChapterOutlineAdoption()
    const section = candidate.sections.find((item) => item.area === 'chapterOutline')
    const content = section?.content.trim() || ''
    const candidateFingerprint = contentFingerprint(content)
    if (!content || !section?.evidence.length || candidateFingerprint !== input.candidateFingerprint) throw staleChapterOutlineAdoption()
    if (candidate.adoption?.chapterOutlines?.some((item) => item.chapterId === input.chapterId || (item.chapterId !== input.chapterId && item.candidateFingerprint === candidateFingerprint))) {
      throw new AppError('CONFLICT', '这段章纲候选已经采用，请先复核现有落点或修改候选内容。', { recoverable: true })
    }
    const saved = await this.outlines.adoptImportedChapterOutline({
      chapterId: input.chapterId,
      content,
      currentFingerprint: input.currentOutlineFingerprint,
      parentTotalFingerprint: input.parentTotalFingerprint,
      parentVolumeFingerprint: input.parentVolumeFingerprint
    })
    candidate.adoption = {
      ...candidate.adoption,
      chapterOutlines: [
        ...(candidate.adoption?.chapterOutlines || []),
        {
          chapterId: input.chapterId,
          candidateFingerprint,
          outlineFingerprint: saved.fingerprint,
          parentTotalFingerprint: input.parentTotalFingerprint,
          parentVolumeFingerprint: input.parentVolumeFingerprint,
          adoptedAt: new Date().toISOString()
        }
      ]
    }
    candidate.updatedAt = new Date().toISOString()
    await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), planning: saved.status, content: saved.content }
  }

  private async continuationPrerequisiteSnapshot(candidate: ContinuationAnalysisCandidate): Promise<{ fingerprint: string; missing: string[] }> {
    const missing = missingContinuationPrerequisiteReceipts(candidate)
    if (missing.length) return { fingerprint: '', missing }
    const [profile, timeline, foundation, powerSystem, cheatSystem, characters] = await Promise.all([
      this.workspace.bookProfile(), this.workspace.timeline(), this.workspace.foundationSnapshot(), this.workspace.powerSystemSnapshot(),
      this.workspace.cheatSystemSnapshot(), this.characterStates.state()
    ])
    return {
      fingerprint: createHash('sha256').update(JSON.stringify({
        adoption: candidate.adoption,
        profile,
        timeline: timeline.events,
        foundation: foundation.data,
        powerSystem: powerSystem.data,
        cheatSystem: cheatSystem.data,
        characterAnchors: characters.anchors
      })).digest('hex'),
      missing: []
    }
  }

  private eventStore(): ExistingPlotEvents {
    if (!this.events) throw new AppError('FEATURE_UNAVAILABLE', '当前作品尚未接通统一事件采用入口，请先完成事件迁移。', { recoverable: true })
    return this.events
  }

  /** Test/legacy composition seam. The desktop runtime always injects the unified event store. */
  private async previewExistingPlotCompatibility(candidateId: string): Promise<ContinuationExistingPlotPreview> {
    const [candidate, timeline] = await Promise.all([this.readCandidate(), this.workspace.timeline()])
    if (!candidate || candidate.id !== candidateId) throw stalePlotAdoption()
    const section = candidate.sections.find((item) => item.area === 'existingPlot'), content = section?.content.trim() || ''
    const alreadyConfirmed = Boolean(candidate.adoption?.existingPlot?.some((item) => item.candidateFingerprint === contentFingerprint(content)))
    return {
      candidateId: candidate.id, area: 'existingPlot', candidateEvent: content,
      candidateFingerprint: contentFingerprint(content), currentTimelineFingerprint: timelineFingerprint(timeline.events),
      evidence: structuredClone(section?.evidence || []), canAdopt: Boolean(content && section?.evidence.length && !alreadyConfirmed),
      ...(!content ? { reason: '已有剧情候选还是空白，请先补写并保存候选。' }
        : !section?.evidence.length ? { reason: '已有剧情没有可核对的原文证据，不能写入正式纪事。' }
          : alreadyConfirmed ? { reason: '这项已有剧情已经确认过，请勿重复写入。' } : {})
    }
  }

  private async adoptExistingPlotCompatibility(input: ContinuationExistingPlotAdoptionInput): Promise<ContinuationExistingPlotAdoptionResult> {
    const [candidate, currentTimeline] = await Promise.all([this.readCandidate(), this.workspace.timeline()])
    if (!candidate || candidate.id !== input.candidateId) throw stalePlotAdoption()
    const section = candidate.sections.find((item) => item.area === 'existingPlot'), content = section?.content.trim() || ''
    if (!content || !section?.evidence.length || contentFingerprint(content) !== input.candidateFingerprint
      || timelineFingerprint(currentTimeline.events) !== input.currentTimelineFingerprint) throw stalePlotAdoption()
    const event: TimelineEvent = { id: deterministicTimelineEventId(candidate.id, input.event),
      time: input.event.time.trim(), characters: input.event.characters.trim(), location: input.event.location.trim(), event: input.event.event.trim() }
    if (!event.time || !event.characters || !event.location || !event.event) throw new AppError('VALIDATION_ERROR', '请完整填写时间、人物、地点和事件', { recoverable: true })
    const eventFingerprintValue = timelineEventFingerprint(event), existing = currentTimeline.events.find((item) => item.id === event.id)
    if (existing && timelineEventFingerprint(existing) !== eventFingerprintValue) throw stalePlotAdoption()
    const previous = candidate.adoption?.existingPlot || []
    if (previous.some((item) => item.eventFingerprint === eventFingerprintValue)) throw new AppError('CONFLICT', '这项已有剧情已经确认过，请勿重复写入', { recoverable: true })
    const timeline = existing ? currentTimeline : await this.workspace.saveTimeline([...currentTimeline.events, event])
    candidate.adoption = { ...candidate.adoption, existingPlot: [...previous, { candidateFingerprint: input.candidateFingerprint,
      eventFingerprint: eventFingerprintValue, timelineEventId: event.id, adoptedAt: new Date().toISOString() }] }
    candidate.updatedAt = new Date().toISOString(); await writeJson(await this.candidatePath(), candidate)
    return { candidate: structuredClone(candidate), event: structuredClone(event), timeline: structuredClone(timeline) }
  }

  private async verifiedExistingPlotEvidence(candidate: ContinuationAnalysisCandidate, refs: ContinuationEvidenceRef[]) {
    const evidence = await this.imports.completedManifestEvidence(candidate.manifestId, true)
    if (evidence.id !== candidate.manifestId || evidence.sourceFingerprint !== candidate.sourceFingerprint) throw stalePlotAdoption()
    const manuscriptSources = new Map<string, { chapterId: number; revision: string }>()
    const normalizedRefs = refs.map((reference) => {
      const matches = evidence.files.flatMap((file) => file.fileName === reference.fileName && file.ownership === 'owned'
        && normalizeEvidence(file.content).includes(normalizeEvidence(reference.excerpt))
        ? (file.chapters ?? []).filter((chapter) => chapter.bodyVersionId
          && normalizeEvidence(chapter.content).includes(normalizeEvidence(reference.excerpt))) : [])
      if (matches.length !== 1) {
        throw new AppError('CONFLICT', `“${reference.fileName}”中的已有剧情证据无法唯一对应当前正式正文版本，请重新分析。`, { recoverable: true })
      }
      const match = matches[0]!
      manuscriptSources.set(`${match.id}\0${match.bodyVersionId}`, { chapterId: match.id, revision: match.bodyVersionId! })
      return { fileName: reference.fileName, excerpt: reference.excerpt }
    })
    const sources = [...manuscriptSources.values()]
    return {
      id: evidence.id,
      sourceFingerprint: evidence.sourceFingerprint,
      evidenceFingerprint: createHash('sha256').update(JSON.stringify({
        manifestId: evidence.id, sourceFingerprint: evidence.sourceFingerprint, refs: normalizedRefs, sources
      })).digest('hex'),
      manuscriptSources: sources
    }
  }

  private async recoverExistingPlot(candidate: ContinuationAnalysisCandidate): Promise<ContinuationAnalysisCandidate> {
    const pending = await this.readExistingPlotPending()
    if (!pending) return candidate
    if (pending.candidateId !== candidate.id) {
      throw new AppError('CONFLICT', '存在属于另一份接续分析的未决剧情采用记录，已停止覆盖。', { recoverable: true })
    }
    const receipt = await this.eventStore().operations.receipt(pending.operationId)
    if (!receipt) {
      await this.removeExistingPlotPending()
      return candidate
    }
    if (receipt.kind !== 'create' || receipt.requestHash !== pending.requestHash || !receipt.eventId || !receipt.versionId) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '未决剧情采用记录与统一事件回执不一致，已停止恢复。', { recoverable: false })
    }
    const section = candidate.sections.find((item) => item.area === 'existingPlot')
    if (!section || contentFingerprint(section.content) !== pending.candidateFingerprint) {
      throw new AppError('CONFLICT', '已有剧情候选在提交后发生变化，统一事件已保留，请先核对未决采用记录。', { recoverable: true })
    }
    const previous = candidate.adoption?.existingPlot || []
    if (!previous.some((item) => item.operationId === pending.operationId)) {
      candidate.adoption = {
        ...candidate.adoption,
        existingPlot: [...previous, {
          candidateFingerprint: pending.candidateFingerprint,
          eventFingerprint: pending.eventFingerprint,
          timelineEventId: receipt.eventId,
          eventVersionId: receipt.versionId,
          operationId: receipt.operationId,
          sourceManifestId: pending.manifestId,
          sourceFingerprint: pending.sourceFingerprint,
          adoptedAt: receipt.committedAt
        }]
      }
      candidate.updatedAt = new Date().toISOString()
      await writeJson(await this.candidatePath(), candidate)
    }
    await this.removeExistingPlotPending()
    return structuredClone(candidate)
  }

  private async readExistingPlotPending(): Promise<ExistingPlotPending | null> {
    let raw: string
    try { raw = await readFile(await this.existingPlotPendingPath(), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      const value = JSON.parse(raw) as ExistingPlotPending
      const keys = ['candidateFingerprint', 'candidateId', 'createdAt', 'event', 'eventFingerprint', 'evidenceFingerprint',
        'manifestId', 'operationId', 'requestHash', 'sourceFingerprint', 'version']
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')
        || value.version !== 1 || typeof value.candidateId !== 'string' || typeof value.operationId !== 'string'
        || !/^[0-9a-f]{64}$/i.test(value.candidateFingerprint) || !/^[0-9a-f]{64}$/i.test(value.eventFingerprint)
        || !/^[0-9a-f]{64}$/i.test(value.requestHash) || !/^[0-9a-f]{64}$/i.test(value.sourceFingerprint)
        || !/^[0-9a-f]{64}$/i.test(value.evidenceFingerprint) || typeof value.manifestId !== 'string'
        || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
        || !value.event || typeof value.event !== 'object' || timelineEventFingerprint(value.event) !== value.eventFingerprint) throw new Error('invalid')
      return value
    } catch {
      throw new AppError('CONFLICT', '未决剧情采用记录已损坏，已停止覆盖以保护统一事件回执。', { recoverable: true })
    }
  }

  private async removeExistingPlotPending(): Promise<void> {
    try { await unlink(await this.existingPlotPendingPath()) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  private async existingPlotPendingPath(): Promise<string> {
    const root = await this.projects.currentPath()
    return projectDirectory(root, join(root, '.webnovel', 'imports', 'continuation-existing-plot-pending.json'))
  }

  private async readCandidate(): Promise<ContinuationAnalysisCandidate | null> {
    const path = await this.candidatePath()
    let raw: string
    try { raw = await readFile(path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let value: unknown
    try { value = JSON.parse(raw) }
    catch { throw new AppError('CONFLICT', '接续分析候选文件已损坏，已停止覆盖以保护现有内容', { recoverable: true }) }
    const project = await this.projects.currentSummary()
    if (!validStoredCandidate(value) || value.workItemId !== project.id) {
      throw new AppError('CONFLICT', '接续分析候选格式或作品归属异常，已停止覆盖', { recoverable: true })
    }
    return this.recoverExistingPlot(structuredClone(value))
  }

  private async candidatePath(): Promise<string> {
    const root = await this.projects.currentPath()
    return projectDirectory(root, join(root, '.webnovel', 'imports', 'continuation-analysis-candidate.json'))
  }
}

export function parseContinuationAnalysis(content: string, evidence: CompletedManifestEvidence): { sections: ContinuationAnalysisSection[]; rationale: string } {
  let raw: unknown
  try { raw = JSON.parse(extractJsonObject(content)) }
  catch { throw invalidResponse('模型返回的接续分析不是有效 JSON，请重试。') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidResponse('模型返回的接续分析结构无效，请重试。')
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.sections) || value.sections.length !== areas.length) throw invalidResponse('接续分析必须完整覆盖九类内容。')
  const sourceByName = new Map(evidence.files.map((file) => [file.fileName, normalizeEvidence(file.content)]))
  const sections = value.sections.map((item, index): ContinuationAnalysisSection => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidResponse(`第 ${index + 1} 类分析结构无效。`)
    const section = item as Record<string, unknown>
    if (typeof section.area !== 'string' || !areas.includes(section.area as ContinuationAnalysisArea)) throw invalidResponse(`第 ${index + 1} 类分析名称无效。`)
    if (section.status !== 'found' && section.status !== 'missing' && section.status !== 'conflict') throw invalidResponse(`“${section.area}”缺少合法状态。`)
    const sectionContent = cleanString(section.content, 100_000)
    if (section.status !== 'missing' && !sectionContent) throw invalidResponse(`“${section.area}”有识别结果却没有内容。`)
    if (!Array.isArray(section.evidence) || section.evidence.length > 8) throw invalidResponse(`“${section.area}”的证据格式无效。`)
    const refs = section.evidence.map((reference, evidenceIndex): ContinuationEvidenceRef => {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw invalidResponse(`“${section.area}”第 ${evidenceIndex + 1} 条证据无效。`)
      const record = reference as Record<string, unknown>
      const fileName = cleanString(record.fileName, 260)
      const excerpt = cleanString(record.excerpt, 500)
      const source = sourceByName.get(fileName)
      if (!fileName || !excerpt || !source || !source.includes(normalizeEvidence(excerpt))) throw invalidResponse(`“${section.area}”引用了无法在原文件中定位的证据。`)
      return { fileName, excerpt }
    })
    if (section.status !== 'missing' && !refs.length) throw invalidResponse(`“${section.area}”必须保留至少一条原文证据。`)
    return { area: section.area as ContinuationAnalysisArea, status: section.status, content: sectionContent, evidence: refs }
  })
  if (new Set(sections.map((section) => section.area)).size !== areas.length) throw invalidResponse('接续分析包含重复或缺失类别。')
  sections.sort((left, right) => areas.indexOf(left.area) - areas.indexOf(right.area))
  const rationale = cleanString(value.rationale, 20_000)
  if (!rationale) throw invalidResponse('接续分析缺少整体判断说明。')
  return { sections, rationale }
}

function staleAnalysis(message: string) { return new AppError('CONFLICT', message, { recoverable: true }) }
async function candidateFileHash(path: string): Promise<string | null> {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

function buildInstruction(evidence: CompletedManifestEvidence): string {
  let remaining = 120_000
  const files = evidence.files.map((file, index) => {
    const excerpt = file.content.slice(0, Math.max(0, Math.min(remaining, 40_000)))
    remaining -= excerpt.length
    return [`【文件 ${index + 1}】${file.fileName}`, `作者确认用途：${file.ownership === 'owned' ? '正文' : file.ownership === 'material' ? '作品资料' : '外部参考（不得当作本书事实）'}`, `作者标题：${file.title}`, '---', excerpt].join('\n')
  }).join('\n\n')
  return [
    '根据以下已经由作者确认用途的文件，生成“旧稿接续分析候选”。只输出 JSON，不要 Markdown。',
    '必须返回九个 sections，area 依次为 projectDefinition、existingPlot、characters、worldView、powerSystem、cheatSystem、totalOutline、volumeOutline、chapterOutline。',
    '每项格式：{"area":"...","status":"found|missing|conflict","content":"可编辑整理结果","evidence":[{"fileName":"原文件名","excerpt":"必须能在该文件中逐字定位的短句"}]}。',
    'found/conflict 必须给原文逐字证据；missing 的 evidence=[]。外部参考只能标为灵感来源，不能证明本书已有剧情或设定。',
    '不要补写正式设定，不要替作者裁决冲突。content 可以整理和提出候选表达，但必须明确不确定处。',
    '顶层还要有 rationale，说明现有材料是否足以接续，以及建议作者先核对什么。',
    files
  ].join('\n\n')
}

function buildGaps(sections: ContinuationAnalysisSection[]): ContinuationGap[] {
  return sections.flatMap((section): ContinuationGap[] => {
    if (section.status === 'found') return []
    const level: ContinuationGap['level'] = section.status === 'conflict' ? 'conflict' : requiredAreas.has(section.area) ? 'required' : 'recommended'
    return [{
      id: `${level}:${section.area}`,
      level,
      area: section.area,
      title: section.status === 'conflict' ? `${labels[section.area]}存在待核冲突` : `${labels[section.area]}尚不完整`,
      suggestion: section.status === 'conflict'
        ? '请对照逐字证据选择、合并或改写；系统不会自动裁决。'
        : level === 'required'
          ? '这是安全接续正文前必须由作者确认的内容。'
          : '可以先由模型提出候选，再由作者修改确认。'
    }]
  })
}

function validStoredCandidate(value: unknown): value is ContinuationAnalysisCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as ContinuationAnalysisCandidate
  if (candidate.creativePolicy !== undefined) { try { validatePolicyRecords(candidate.creativePolicy) } catch { return false } }
  return candidate.version === 1 && candidate.status === 'candidate' && typeof candidate.id === 'string' && typeof candidate.workItemId === 'string'
    && typeof candidate.manifestId === 'string' && /^[0-9a-f]{64}$/i.test(candidate.sourceFingerprint)
    && Array.isArray(candidate.sections) && candidate.sections.length === areas.length && Array.isArray(candidate.gaps)
    && typeof candidate.rationale === 'string' && validAdoption(candidate.adoption)
}

function validAdoption(value: ContinuationAnalysisCandidate['adoption']): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'projectDefinition' && key !== 'existingPlot' && key !== 'characters' && key !== 'worldView' && key !== 'powerSystem' && key !== 'cheatSystem' && key !== 'totalOutline' && key !== 'volumeOutlines' && key !== 'chapterOutlines')) return false
  const item = value.projectDefinition
  const projectDefinitionValid = item === undefined || (typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).every((key) => key === 'candidateFingerprint' || key === 'profileFingerprint' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(item.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(item.profileFingerprint)
    && typeof item.adoptedAt === 'string' && !Number.isNaN(Date.parse(item.adoptedAt)))
  const existingPlot = value.existingPlot
  const existingPlotValid = existingPlot === undefined || (Array.isArray(existingPlot) && existingPlot.every((entry) => entry && typeof entry === 'object'
    && Object.keys(entry).every((key) => ['candidateFingerprint', 'eventFingerprint', 'timelineEventId', 'eventVersionId',
      'operationId', 'sourceManifestId', 'sourceFingerprint', 'adoptedAt'].includes(key))
    && /^[0-9a-f]{64}$/i.test(entry.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(entry.eventFingerprint)
    && typeof entry.timelineEventId === 'string' && entry.timelineEventId.trim() === entry.timelineEventId && entry.timelineEventId.length <= 200
    && (entry.eventVersionId === undefined || (typeof entry.eventVersionId === 'string' && entry.eventVersionId.trim() === entry.eventVersionId && entry.eventVersionId.length <= 200))
    && (entry.operationId === undefined || (typeof entry.operationId === 'string' && entry.operationId.trim() === entry.operationId && entry.operationId.length <= 200))
    && (entry.sourceManifestId === undefined || (typeof entry.sourceManifestId === 'string' && entry.sourceManifestId.trim() === entry.sourceManifestId && entry.sourceManifestId.length <= 200))
    && (entry.sourceFingerprint === undefined || /^[0-9a-f]{64}$/i.test(entry.sourceFingerprint))
    && typeof entry.adoptedAt === 'string' && !Number.isNaN(Date.parse(entry.adoptedAt))))
  const characters = value.characters
  const charactersValid = characters === undefined || (Array.isArray(characters) && characters.every((entry) => entry && typeof entry === 'object'
    && Object.keys(entry).every((key) => key === 'candidateFingerprint' || key === 'anchorFingerprint' || key === 'name' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(entry.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(entry.anchorFingerprint)
    && typeof entry.name === 'string' && entry.name.trim().length >= 1 && entry.name.length <= 120
    && typeof entry.adoptedAt === 'string' && !Number.isNaN(Date.parse(entry.adoptedAt))))
  const worldView = value.worldView
  const worldViewValid = worldView === undefined || (typeof worldView === 'object' && !Array.isArray(worldView)
    && Object.keys(worldView).every((key) => key === 'candidateFingerprint' || key === 'foundationFingerprint' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(worldView.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(worldView.foundationFingerprint)
    && typeof worldView.adoptedAt === 'string' && !Number.isNaN(Date.parse(worldView.adoptedAt)))
  const powerSystem = value.powerSystem
  const powerSystemValid = powerSystem === undefined || (typeof powerSystem === 'object' && !Array.isArray(powerSystem)
    && Object.keys(powerSystem).every((key) => key === 'candidateFingerprint' || key === 'powerSystemFingerprint' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(powerSystem.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(powerSystem.powerSystemFingerprint)
    && typeof powerSystem.adoptedAt === 'string' && !Number.isNaN(Date.parse(powerSystem.adoptedAt)))
  const cheatSystem = value.cheatSystem
  const cheatSystemValid = cheatSystem === undefined || (typeof cheatSystem === 'object' && !Array.isArray(cheatSystem)
    && Object.keys(cheatSystem).every((key) => key === 'candidateFingerprint' || key === 'cheatSystemFingerprint' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(cheatSystem.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(cheatSystem.cheatSystemFingerprint)
    && typeof cheatSystem.adoptedAt === 'string' && !Number.isNaN(Date.parse(cheatSystem.adoptedAt)))
  const totalOutline = value.totalOutline
  const totalOutlineValid = totalOutline === undefined || (typeof totalOutline === 'object' && !Array.isArray(totalOutline)
    && Object.keys(totalOutline).every((key) => key === 'candidateFingerprint' || key === 'outlineFingerprint' || key === 'prerequisiteFingerprint' || key === 'revision' || key === 'adoptedAt')
    && /^[0-9a-f]{64}$/i.test(totalOutline.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(totalOutline.outlineFingerprint)
    && /^[0-9a-f]{64}$/i.test(totalOutline.prerequisiteFingerprint) && Number.isInteger(totalOutline.revision) && totalOutline.revision >= 0
    && typeof totalOutline.adoptedAt === 'string' && !Number.isNaN(Date.parse(totalOutline.adoptedAt)))
  const volumeOutlines = value.volumeOutlines
  const volumeOutlinesValid = volumeOutlines === undefined || (Array.isArray(volumeOutlines)
    && new Set(volumeOutlines.map((entry) => entry?.volume)).size === volumeOutlines.length
    && volumeOutlines.every((entry) => entry && typeof entry === 'object'
      && Object.keys(entry).every((key) => key === 'volume' || key === 'candidateFingerprint' || key === 'outlineFingerprint' || key === 'parentTotalFingerprint' || key === 'revision' || key === 'adoptedAt')
      && Number.isInteger(entry.volume) && entry.volume >= 1 && entry.volume <= 1_000
      && /^[0-9a-f]{64}$/i.test(entry.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(entry.outlineFingerprint)
      && /^[0-9a-f]{64}$/i.test(entry.parentTotalFingerprint) && Number.isInteger(entry.revision) && entry.revision >= 0
      && typeof entry.adoptedAt === 'string' && !Number.isNaN(Date.parse(entry.adoptedAt))))
  const chapterOutlines = value.chapterOutlines
  const chapterOutlinesValid = chapterOutlines === undefined || (Array.isArray(chapterOutlines)
    && new Set(chapterOutlines.map((entry) => entry?.chapterId)).size === chapterOutlines.length
    && chapterOutlines.every((entry) => entry && typeof entry === 'object'
      && Object.keys(entry).every((key) => key === 'chapterId' || key === 'candidateFingerprint' || key === 'outlineFingerprint' || key === 'parentTotalFingerprint' || key === 'parentVolumeFingerprint' || key === 'adoptedAt')
      && Number.isInteger(entry.chapterId) && entry.chapterId >= 1
      && /^[0-9a-f]{64}$/i.test(entry.candidateFingerprint) && /^[0-9a-f]{64}$/i.test(entry.outlineFingerprint)
      && /^[0-9a-f]{64}$/i.test(entry.parentTotalFingerprint) && /^[0-9a-f]{64}$/i.test(entry.parentVolumeFingerprint)
      && typeof entry.adoptedAt === 'string' && !Number.isNaN(Date.parse(entry.adoptedAt))))
  return projectDefinitionValid && existingPlotValid && charactersValid && worldViewValid && powerSystemValid && cheatSystemValid && totalOutlineValid && volumeOutlinesValid && chapterOutlinesValid
}

function contentFingerprint(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex')
}

function staleChapterOutlineAdoption(): AppError {
  return new AppError('CONFLICT', '章纲候选、目标章节或父级大纲已经变化，请重新预览后再采用。', { recoverable: true })
}

function normalizedCharacter(character: ContinuationCharacterPreviewInput['character']): ContinuationCharacterPreviewInput['character'] {
  return { name: character.name.trim(), role: character.role.trim(), arcSeed: character.arcSeed.trim() }
}

function normalizedName(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function characterSourceId(candidateId: string, name: string): string {
  return `${candidateId}:${normalizedName(name)}`
}

function profileFingerprint(profile: BookProfile): string {
  return createHash('sha256').update(JSON.stringify({
    genre: profile.genre,
    subgenre: profile.subgenre,
    coreIdea: profile.coreIdea,
    plannedVolumes: profile.plannedVolumes,
    chaptersPerVolume: profile.chaptersPerVolume,
    targetWordsPerChapter: profile.targetWordsPerChapter
  })).digest('hex')
}

function timelineEventFingerprint(event: TimelineEvent): string {
  return createHash('sha256').update(JSON.stringify({ time: event.time, characters: event.characters, location: event.location, event: event.event })).digest('hex')
}

function timelineFingerprint(events: TimelineEvent[]): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}

function deterministicTimelineEventId(candidateId: string, event: Omit<TimelineEvent, 'id'>): string {
  const hex = createHash('sha256').update(`${candidateId}\n${timelineEventFingerprint({ id: '', ...event })}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function projectedTimelineEvent(item: Awaited<ReturnType<EventProjectionService['read']>>['approved'][number]): TimelineEvent {
  return {
    id: item.eventId,
    ...(item.content.title !== undefined ? { title: item.content.title } : {}),
    time: item.content.time,
    characters: item.content.rawCharacters ?? item.content.characters.join('、'),
    location: item.content.location,
    event: item.content.event,
    ...(item.content.result !== undefined ? { result: item.content.result } : {})
  }
}

function staleAdoption(): AppError {
  return new AppError('CONFLICT', '作品定义候选或当前作品设置已经变化，请重新预览后再采用', { recoverable: true })
}

function stalePlotAdoption(): AppError {
  return new AppError('CONFLICT', '已有剧情候选或当前正式纪事已经变化，请重新预览后再确认', { recoverable: true })
}

function staleCharacterAdoption(): AppError {
  return new AppError('CONFLICT', '人物候选或正式人物锚点已经变化，请重新预览后再确认', { recoverable: true })
}

function staleWorldViewAdoption(): AppError {
  return new AppError('CONFLICT', '世界观候选或当前本书设定已经变化，请重新预览后再采用', { recoverable: true })
}

function stalePowerSystemAdoption(): AppError {
  return new AppError('CONFLICT', '力量体系候选或当前力量体系总述已经变化，请重新预览后再采用', { recoverable: true })
}

function staleCheatSystemAdoption(): AppError {
  return new AppError('CONFLICT', '特殊优势候选或当前特殊优势总述已经变化，请重新预览后再采用', { recoverable: true })
}

function staleTotalOutlineAdoption(): AppError {
  return new AppError('CONFLICT', '总纲候选、前置设定或当前正式总纲已经变化，请重新预览后再采用', { recoverable: true })
}

function staleVolumeOutlineAdoption(): AppError {
  return new AppError('CONFLICT', '卷纲候选、父级总纲或目标正式卷纲已经变化，请重新预览后再采用', { recoverable: true })
}

function missingContinuationPrerequisiteReceipts(candidate: ContinuationAnalysisCandidate): string[] {
  const adoption = candidate.adoption
  return [
    !adoption?.projectDefinition ? '作品定义' : '',
    !adoption?.existingPlot?.length ? '已有剧情' : '',
    !adoption?.characters?.length ? '人物' : '',
    !adoption?.worldView ? '世界观' : '',
    !adoption?.powerSystem ? '力量体系' : '',
    !adoption?.cheatSystem ? '特殊优势' : ''
  ].filter(Boolean)
}

function hasAllContinuationPrerequisiteReceipts(candidate: ContinuationAnalysisCandidate): boolean {
  return missingContinuationPrerequisiteReceipts(candidate).length === 0
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

function cleanString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function invalidResponse(message: string): AppError {
  return new AppError('AI_RESPONSE_INVALID', message, { recoverable: true })
}
