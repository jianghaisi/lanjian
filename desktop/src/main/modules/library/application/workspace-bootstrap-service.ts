import type { ProjectMetadata } from './project-service'
import { AppError } from '../../../core/errors/app-error'
import { readLoadCheck, settleLoadCheck } from './workspace-load-checks'
import type { WorkspaceLoadCheckInput, WorkspaceLoadCheckResult } from '../../../../contracts/library/types'
import type {
  AiSettings,
  BookProfile,
  CanonicalEvent,
  Chapter,
  CheatSystemData,
  ContinuationAnalysisState,
  DocumentImportRecovery,
  EventProjectionDto,
  FoundationData,
  OutlineList,
  PlanningPackageProposal,
  PowerSystemData,
  ProjectMigrationPreview,
  PromptProfileView,
  RealmLevel,
  ResearchSettings,
  SourceCard,
  TimelineEvent,
  WorkspaceBootstrapProjection
} from '../../../../contracts/index'

export type WorkspaceBootstrapDependencies = {
  projects: {
    currentPath: () => Promise<string>
    currentSummary: (options: { includeManuscript: false }) => Promise<ProjectMetadata>
    migrationPreview: () => Promise<ProjectMigrationPreview>
  }
  documents: {
    chapters: () => Promise<Chapter[]>
    unsequencedChapters?: () => Promise<Chapter[]>
    outlines: () => Promise<OutlineList>
  }
  workspace: {
    timeline: () => Promise<{ events: TimelineEvent[] }>
    realms: () => Promise<{ levels: RealmLevel[] }>
    powerSystem: () => Promise<PowerSystemData>
    cheatSystem: () => Promise<CheatSystemData>
    systemTemplate: () => Promise<{ template: string }>
    foundation: () => Promise<FoundationData>
    bookProfile: (summary?: ProjectMetadata) => Promise<BookProfile>
    promptProfile: (provided?: { profile: BookProfile; summary: ProjectMetadata }) => Promise<PromptProfileView>
    builtInPromptProfile: (provided?: { profile: BookProfile; summary: ProjectMetadata }) => Promise<PromptProfileView>
  }
  aiSettings: () => Promise<AiSettings>
  researchSettings: () => Promise<ResearchSettings>
  researchLibrary: {
    listSources: () => Promise<{ sources: SourceCard[] }>
    listEvents: () => Promise<{ events: CanonicalEvent[] }>
  }
  eventProjection?: { read: () => Promise<EventProjectionDto | null> }
  outlinePlanning?: { validateLedger: () => Promise<void> }
  characterStates?: { validateLedger: () => Promise<void> }
  planningDraft: () => Promise<PlanningPackageProposal | null>
  importRecoveries: () => Promise<DocumentImportRecovery[]>
  continuation: () => Promise<ContinuationAnalysisState>
}

type WorkspaceIdentity = { id: string; path: string; summary: ProjectMetadata }

export class WorkspaceBootstrapService {
  private generation = 0
  constructor(private readonly dependencies: WorkspaceBootstrapDependencies) {}

  invalidate(): void { this.generation++ }

  private async assertScope(identity: { id: string; path: string }, generation: number): Promise<void> {
    const path = await this.dependencies.projects.currentPath()
    if (generation !== this.generation || identity.path !== path) throw changedWorkItem()
  }

  /** Only the two failed projections; no manuscript reload, compatibility import or mirror sync. */
  async recheck(input: WorkspaceLoadCheckInput): Promise<WorkspaceLoadCheckResult> {
    const generation = this.generation
    const path = await this.dependencies.projects.currentPath()
    if (input.workItem.id !== path || input.workItem.path !== path) throw changedWorkItem()
    const workItem = { id: path, path }
    const assertCurrent = () => this.assertScope(workItem, generation)
    await assertCurrent()
    const result: WorkspaceLoadCheckResult = { workItem, checkedIds: [...input.issueIds], issues: [] }
    await Promise.all(input.issueIds.map(async id => {
      if (id === 'modelSettingsUnreadable') {
        const read = () => readLoadCheck(id, this.dependencies.aiSettings)
        const check = await settleLoadCheck(await read(), read, assertCurrent)
        result.aiSettings = check.value
        result.issues.push(...check.issues)
      } else {
        const read = () => readLoadCheck(id, () => this.dependencies.eventProjection?.read() ?? Promise.resolve(null))
        const check = await settleLoadCheck(await read(), read, assertCurrent)
        result.eventProjection = check.value
        result.issues.push(...check.issues)
      }
    }))
    await assertCurrent()
    return result
  }

  async load(): Promise<WorkspaceBootstrapProjection> {
    const generation = this.generation
    const identity = await this.readIdentity()
    await this.assertScope(identity, generation)
    const profile = this.dependencies.workspace.bookProfile(identity.summary)
    const chapters = this.dependencies.documents.chapters()
      .then((value) => ({ value, issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch(async (error: unknown) => {
        if (!isChapterOrderError(error) || !this.dependencies.documents.unsequencedChapters) throw error
        return {
          value: await this.dependencies.documents.unsequencedChapters(),
          issues: [{
            id: 'chapterOrderUnreadable' as const,
            area: 'chapterOrder' as const,
            title: '章节顺序账本需要人工核对',
            message: error.message,
            recovery: 'manualReview' as const
          }]
        }
      })
    const planning = this.dependencies.planningDraft()
      .then((value) => ({ value, issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch((error: unknown) => ({
        value: null,
        issues: [{
          id: 'planningDraftUnreadable' as const,
          area: 'planningDraft' as const,
          title: '自动谋篇候选需要修复',
          message: error instanceof AppError ? error.message : '自动谋篇候选暂时无法读取；原文件保持不变。',
          recovery: 'quarantinePlanningDraft' as const
        }]
      }))
    const promptProfile = profile.then(async (value) => {
      const provided = { profile: value, summary: identity.summary }
      try {
        return { value: await this.dependencies.workspace.promptProfile(provided), issues: [] as WorkspaceBootstrapProjection['issues'] }
      } catch (error) {
        return {
          value: await this.dependencies.workspace.builtInPromptProfile(provided),
          issues: [{
            id: 'promptProfileUnreadable' as const,
            area: 'promptProfile' as const,
            title: '本书自定义提示词需要修复',
            message: error instanceof AppError ? error.message : '本书自定义提示词暂时无法读取；原文件保持不变。',
            recovery: 'quarantinePromptProfile' as const
          }]
        }
      }
    })
    const sources = this.dependencies.researchLibrary.listSources()
      .then((value) => ({ value, issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch((error: unknown) => ({
        value: { sources: [] as SourceCard[] },
        issues: [{
          id: 'researchSourcesUnreadable' as const,
          area: 'researchSources' as const,
          title: '素材来源账本需要人工核对',
          message: error instanceof AppError ? error.message : '素材来源账本暂时无法读取；原文件保持不变。',
          recovery: 'manualReview' as const
        }]
      }))
    const events = this.dependencies.researchLibrary.listEvents()
      .then((value) => ({ value, issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch((error: unknown) => ({
        value: { events: [] as CanonicalEvent[] },
        issues: [{
          id: 'researchEventsUnreadable' as const,
          area: 'researchEvents' as const,
          title: '正式事件账本需要人工核对',
          message: error instanceof AppError ? error.message : '正式事件账本暂时无法读取；原文件保持不变。',
          recovery: 'manualReview' as const
        }]
      }))
    const readEvents = () => readLoadCheck('unifiedEventsUnreadable', () => this.dependencies.eventProjection?.read() ?? Promise.resolve(null))
    const readModels = () => readLoadCheck('modelSettingsUnreadable', this.dependencies.aiSettings)
    const eventProjection = readEvents()
    const outlinePlanning = this.dependencies.outlinePlanning?.validateLedger()
      .then(() => ({ issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch((error: unknown) => ({
        issues: [{
          id: 'outlinePlanningUnreadable' as const,
          area: 'outlinePlanning' as const,
          title: '大纲版本账本需要人工核对',
          message: error instanceof AppError ? error.message : '大纲版本账本暂时无法读取；原文件保持不变。',
          recovery: 'manualReview' as const
        }]
      })) ?? Promise.resolve({ issues: [] as WorkspaceBootstrapProjection['issues'] })
    const characterStates = this.dependencies.characterStates?.validateLedger()
      .then(() => ({ issues: [] as WorkspaceBootstrapProjection['issues'] }))
      .catch((error: unknown) => ({
        issues: [{
          id: 'characterStateUnreadable' as const,
          area: 'characterState' as const,
          title: '人物状态账本需要人工核对',
          message: error instanceof AppError ? error.message : '人物状态账本暂时无法读取；原文件保持不变。',
          recovery: 'manualReview' as const
        }]
      })) ?? Promise.resolve({ issues: [] as WorkspaceBootstrapProjection['issues'] })
    const [
      chapterResult, outlines, timeline, realms, powerSystem, cheatSystem, systemTemplate, foundation, bookProfile,
      aiSettings, researchSettings, migration, sourcesResult, eventsResult, eventProjectionResult, outlinePlanningResult, characterStateResult, planningResult, promptProfileResult, importRecoveries, continuation
    ] = await Promise.all([
      chapters,
      this.dependencies.documents.outlines(),
      this.dependencies.workspace.timeline(),
      this.dependencies.workspace.realms(),
      this.dependencies.workspace.powerSystem(),
      this.dependencies.workspace.cheatSystem(),
      this.dependencies.workspace.systemTemplate(),
      this.dependencies.workspace.foundation(),
      profile,
      readModels(),
      this.dependencies.researchSettings(),
      this.dependencies.projects.migrationPreview(),
      sources,
      events,
      eventProjection,
      outlinePlanning,
      characterStates,
      planning,
      promptProfile,
      this.dependencies.importRecoveries(),
      this.dependencies.continuation()
    ])
    const assertCurrent = () => this.assertScope(identity, generation)
    await assertCurrent()
    // Opening providers can create/close WAL files or finish compatibility work.
    // Retry only acquisition drift after those providers have settled.
    const [settledEvents, settledModels] = await Promise.all([
      settleLoadCheck(eventProjectionResult, readEvents, assertCurrent),
      settleLoadCheck(aiSettings, readModels, assertCurrent)
    ])
    const confirmed = await this.readIdentity()
    await assertCurrent()
    if (identity.id !== confirmed.id || identity.path !== confirmed.path) throw changedWorkItem()
    return {
      version: 1,
      workItem: { id: identity.id, path: identity.path },
      chapters: chapterResult.value,
      outlines,
      timeline,
      realms,
      powerSystem,
      cheatSystem,
      systemTemplate,
      foundation,
      bookProfile,
      aiSettings: settledModels.value,
      researchSettings,
      migration,
      sources: sourcesResult.value,
      events: eventsResult.value,
      eventProjection: settledEvents.value,
      planningDraft: planningResult.value,
      promptProfile: promptProfileResult.value,
      importRecoveries,
      continuation,
      issues: [...planningResult.issues, ...promptProfileResult.issues, ...sourcesResult.issues, ...eventsResult.issues, ...settledEvents.issues, ...outlinePlanningResult.issues, ...characterStateResult.issues, ...chapterResult.issues, ...settledModels.issues]
    }
  }

  private async readIdentity(): Promise<WorkspaceIdentity> {
    const path = await this.dependencies.projects.currentPath()
    const summary = await this.dependencies.projects.currentSummary({ includeManuscript: false })
    const confirmedPath = await this.dependencies.projects.currentPath()
    if (path !== confirmedPath || summary.path !== path) throw changedWorkItem()
    return { id: summary.id, path, summary }
  }
}

function changedWorkItem(): AppError {
  return new AppError('CONFLICT', '作品在读取过程中已经切换，请重新打开当前作品。', { recoverable: true })
}

function isChapterOrderError(error: unknown): error is AppError {
  return error instanceof AppError
    && error.code === 'INVALID_PROJECT_STATE'
    && error.details?.area === 'chapterOrder'
}
