import { AppError } from '../../../core/errors/app-error'
import type {
  AiSettings,
  BookProfile,
  CanonicalEvent,
  Chapter,
  CheatSystemData,
  ContinuationAnalysisState,
  DocumentImportRecovery,
  FoundationData,
  OutlineList,
  PlanningPackageProposal,
  PowerSystemData,
  ProjectMigrationPreview,
  ProjectSummary,
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
    currentSummary: () => Promise<ProjectSummary>
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
    bookProfile: (summary?: ProjectSummary) => Promise<BookProfile>
    promptProfile: (provided?: { profile: BookProfile; summary: ProjectSummary }) => Promise<PromptProfileView>
    builtInPromptProfile: (provided?: { profile: BookProfile; summary: ProjectSummary }) => Promise<PromptProfileView>
  }
  aiSettings: () => Promise<AiSettings>
  researchSettings: () => Promise<ResearchSettings>
  researchLibrary: {
    listSources: () => Promise<{ sources: SourceCard[] }>
    listEvents: () => Promise<{ events: CanonicalEvent[] }>
  }
  outlinePlanning?: { validateLedger: () => Promise<void> }
  characterStates?: { validateLedger: () => Promise<void> }
  planningDraft: () => Promise<PlanningPackageProposal | null>
  importRecoveries: () => Promise<DocumentImportRecovery[]>
  continuation: () => Promise<ContinuationAnalysisState>
}

type WorkspaceIdentity = { id: string; path: string; summary: ProjectSummary }

export class WorkspaceBootstrapService {
  constructor(private readonly dependencies: WorkspaceBootstrapDependencies) {}

  async load(): Promise<WorkspaceBootstrapProjection> {
    const identity = await this.readIdentity()
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
      aiSettings, researchSettings, migration, sourcesResult, eventsResult, outlinePlanningResult, characterStateResult, planningResult, promptProfileResult, importRecoveries, continuation
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
      this.dependencies.aiSettings().then(value => ({ value, issues: [] as WorkspaceBootstrapProjection['issues'] })).catch(() => ({
        value: null, issues: [{ id: 'modelSettingsUnreadable' as const, area: 'aiSettings' as const,
          title: '模型分配暂不可用', message: '模型配置或共享接口库无法读取；原配置已保留，请到模型设置核对。正文仍可读写，不会自动更换接口。', recovery: 'manualReview' as const }]
      })),
      this.dependencies.researchSettings(),
      this.dependencies.projects.migrationPreview(),
      sources,
      events,
      outlinePlanning,
      characterStates,
      planning,
      promptProfile,
      this.dependencies.importRecoveries(),
      this.dependencies.continuation()
    ])
    const confirmed = await this.readIdentity()
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
      aiSettings: aiSettings.value,
      researchSettings,
      migration,
      sources: sourcesResult.value,
      events: eventsResult.value,
      planningDraft: planningResult.value,
      promptProfile: promptProfileResult.value,
      importRecoveries,
      continuation,
      issues: [...planningResult.issues, ...promptProfileResult.issues, ...sourcesResult.issues, ...eventsResult.issues, ...outlinePlanningResult.issues, ...characterStateResult.issues, ...chapterResult.issues, ...aiSettings.issues]
    }
  }

  private async readIdentity(): Promise<WorkspaceIdentity> {
    const path = await this.dependencies.projects.currentPath()
    const summary = await this.dependencies.projects.currentSummary()
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
