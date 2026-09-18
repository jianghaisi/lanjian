import { registerLocalModels } from '../modules/models/runtime/local-model-runtime'
import { app, ipcMain, safeStorage, shell } from 'electron'
import { mkdir, rename } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { AiClient } from '../modules/models/application/ai-client'
import {
  ConsistencyEvaluationJobService,
  ConsistencyEvaluationService
} from '../modules/review/application/consistency-evaluation-service'
import { FactExtractionService } from '../modules/review/application/fact-extraction-service'
import { BookImportService } from '../modules/library/application/book-import-service'
import { ContinuationAnalysisService } from '../modules/library/application/continuation-analysis-service'
import { ChapterDraftService } from '../modules/manuscript/application/chapter-draft-service'
import { ChapterSkeletonService } from '../modules/planning/application/chapter-skeleton-service'
import { ChapterSkeletonJobService } from '../modules/planning/application/chapter-skeleton-job-service'
import { ChapterDetailService } from '../modules/planning/application/chapter-detail-service'
import { ChapterDetailJobService } from '../modules/planning/application/chapter-detail-job-service'
import { DocumentService } from '../modules/manuscript/application/document-service'
import { LocalRetrievalService } from '../modules/assistant/application/local-retrieval-service'
import { ProjectService } from '../modules/library/application/project-service'
import { NewFileProjectStorage } from '../modules/library/application/new-file-project-storage'
import { registerModelConnections } from '../modules/models/runtime/model-connections-runtime'
import { SettingsStore } from '../platform/settings/settings-store'
import { ResearchService } from '../modules/worldbuilding/application/research-service'
import { ResearchLibraryService } from '../modules/library/application/research-library-service'
import { OutlinePlanningService } from '../modules/planning/application/outline-planning-service'
import { WorkspaceService } from '../modules/library/application/workspace-service'
import { WorkspaceBootstrapService } from '../modules/library/application/workspace-bootstrap-service'
import { WorldMapService } from '../modules/world-map/application/world-map-service'
import { WorldMapWorkspaceService } from '../modules/world-map/application/world-map-workspace-service'
import { WorldMapGenerationService } from '../modules/world-map/application/world-map-generation-service'
import { OpenAiCompatibleImageClient } from '../modules/models/adapters/openai-compatible-image-client'
import { FoundationDraftService } from '../modules/planning/application/foundation-draft-service'
import { PlanningDraftService } from '../modules/planning/application/planning-draft-service'
import { PlanningJobService } from '../modules/planning/application/planning-job-service'
import { PlanningPackageService } from '../modules/planning/application/planning-package-service'
import { CharacterStateService } from '../modules/characters/application/character-state-service'
import { WritingAgentService } from '../modules/assistant/application/writing-agent-service'
import { WritingAgentApprovalService } from '../modules/assistant/application/writing-agent-approval-service'
import { TaskCenterService } from '../modules/assistant/application/task-center-service'
import { IdeaGenerationService } from '../modules/planning/application/idea-generation-service'
import { OutlineExpansionTaskService } from '../modules/planning/application/outline-expansion-task-service'
import { OutlineExpansionAdoptionService } from '../modules/planning/application/outline-expansion-adoption-service'
import { CurrentProjectLegacyWorkspaceSource } from '../modules/library/application/legacy-workspace-source'
import { ShadowMigrationSessionService } from '../modules/library/application/shadow-migration-session-service'
import { SqliteManuscriptService } from '../modules/manuscript/application/sqlite-manuscript-service'
import { SqliteCutoverSessionService } from '../modules/library/application/sqlite-cutover-session-service'
import { WorkspaceBackupService } from '../modules/library/application/workspace-backup-service'
import { ManuscriptExportService } from '../modules/manuscript/application/manuscript-export-service'
import { RealTrialService } from '../modules/review/application/real-trial-service'
import { AppError } from '../core/errors/app-error'
import { ShadowImportService } from '../modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../core/application/workspace-write-coordinator'
import type { Chapter } from '../../contracts/index'
import { decodeNoArgs } from '../../contracts/ipc'
import { registerValidatedIpc } from '../platform/ipc/validated-ipc'
import { registerFieldAssistant } from '../modules/assistant/runtime/field-assistant-runtime'
import { registerCompanionVoice } from '../modules/companion/runtime/companion-voice-runtime'
import { registerLibraryIpc } from '../modules/library/runtime/ipc'
import { registerManuscriptIpc } from '../modules/manuscript/runtime/ipc'
import { registerLibraryImportsIpc } from '../modules/library/runtime/import-ipc'
import { registerPlanningIpc } from '../modules/planning/runtime/ipc'
import { registerModelsIpc } from '../modules/models/runtime/ipc'
import { registerReviewIpc } from '../modules/review/runtime/ipc'
import { registerAssistantIpc } from '../modules/assistant/runtime/ipc'
import { registerWorldbuildingIpc } from '../modules/worldbuilding/runtime/ipc'
import { registerTimelineIpc } from '../modules/timeline/runtime/ipc'
import { registerCharactersIpc } from '../modules/characters/runtime/ipc'
import { registerWorldMapIpc } from '../modules/world-map/runtime/ipc'
import { createAutoBackupRuntime } from '../modules/library/runtime/auto-backup-runtime'
import { createFactExtractionRuntime } from '../modules/review/runtime/fact-extraction-runtime'
import { createWritingTaskRuntime } from '../modules/assistant/runtime/writing-task-runtime'

export function createDesktopRuntime() {
  let companionVoice: ReturnType<typeof registerCompanionVoice> | undefined
  let localModelRuntime: ReturnType<typeof registerLocalModels> | undefined
  let modelConnectionsRuntime: ReturnType<typeof registerModelConnections> | undefined

  const modelSecrets = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  const settings = new SettingsStore(app.getPath('userData'), modelSecrets)
  const smokeTrashRoot = process.env.LANJIAN_SMOKE_TRASH_DIR
  const trashAdapter = {
    trashItem: async (path: string) => {
      const resolved = resolve(path)
      if (!smokeTrashRoot) return shell.trashItem(resolved)
      await mkdir(smokeTrashRoot, { recursive: true })
      await rename(resolved, join(smokeTrashRoot, basename(resolved)))
    }
  }
  const databases = new SqliteWorkspaceDatabaseFactory()
  const newFileProjects = new NewFileProjectStorage(databases)
  const projects = new ProjectService(
    settings,
    trashAdapter,
    (path) => databases.readProjectIdentity(path),
    (root) => newFileProjects.initialize(root)
  )
  const workspaceWrites = new WorkspaceWriteCoordinator()
  const withWorkspaceDatabaseWrite = <T>(
    workItemId: string,
    operation: (database: import('../core/ports/workspace-database').WorkspaceDatabasePort) => T | Promise<T>
  ): Promise<T> =>
    workspaceWrites.run(workItemId, async () => {
      const database = await databases.openExisting(workItemId)
      if (!database) throw new AppError('FEATURE_UNAVAILABLE', '作品数据库不可用。', { recoverable: true })
      try {
        return await operation(database)
      } finally {
        database.close()
      }
    })
  let configuredAutosaveMergeWindowMs = async () => 30_000
  const autosaveMergeWindowMs = () => configuredAutosaveMergeWindowMs()
  const fileDocuments = new DocumentService(projects, trashAdapter, undefined, autosaveMergeWindowMs)
  const legacyWorkspace = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
  const shadowImporter = new ShadowImportService(legacyWorkspace, databases, workspaceWrites)
  const sqliteManuscripts = new SqliteManuscriptService(databases, trashAdapter, workspaceWrites)
  localModelRuntime = registerLocalModels(
    app.isPackaged
      ? join(app.getPath('userData'), 'companion-voice')
      : join(__dirname, '../../../../.local/companion-voice'),
    join(__dirname, 'local-models/text-worker.py'),
    app.getPath('userData')
  )
  modelConnectionsRuntime = registerModelConnections(
    ipcMain,
    app.getPath('userData'),
    modelSecrets,
    projects,
    sqliteManuscripts,
    workspaceWrites,
    localModelRuntime.service,
    (operation, preserveCreation) => changeWorkItem(operation, preserveCreation),
    settings
  )
  const projectAi = modelConnectionsRuntime.projectAi
  const documents = new DocumentService(projects, trashAdapter, sqliteManuscripts, autosaveMergeWindowMs)
  const manuscriptExports = new ManuscriptExportService(projects, documents)
  const shadowMigrations = new ShadowMigrationSessionService(shadowImporter, () => projects.currentPath())
  const sqliteCutovers = new SqliteCutoverSessionService(
    legacyWorkspace,
    shadowImporter,
    databases,
    sqliteManuscripts,
    () => projects.currentPath()
  )
  const workspaceBackups = new WorkspaceBackupService(
    databases,
    () => projects.currentPath(),
    async () => (await projects.currentSummary()).title,
    () => app.getVersion(),
    undefined,
    undefined,
    workspaceWrites
  )
  const { autoBackupStatus, runAutomaticBackup } = createAutoBackupRuntime({ projects, settings, workspaceBackups })
  const localRetrieval = new LocalRetrievalService(projects, documents, undefined, {
    currentDocumentChunksBefore: (workItemId, chapterId, limit) =>
      sqliteManuscripts.currentDocumentChunksBefore(workItemId, chapterId, limit),
    searchCurrentDocumentChunksBefore: (workItemId, chapterId, terms, limit) =>
      sqliteManuscripts.searchCurrentDocumentChunksBefore(workItemId, chapterId, terms, limit),
    active: (workItemId) => sqliteManuscripts.active(workItemId)
  })
  const ai = new AiClient(projectAi, localModelRuntime.service)
  const consistencyEvaluations = new ConsistencyEvaluationService(
    ai,
    projects,
    undefined,
    async () => (await workspace.contextBudgetPreferences()).structuredRepairAttempts
  )
  const consistencyEvaluationJobs = new ConsistencyEvaluationJobService(consistencyEvaluations, projects)
  const realTrials = new RealTrialService(databases, projects, undefined, workspaceWrites)
  const factExtraction = new FactExtractionService(
    ai,
    async () => (await workspace.contextBudgetPreferences()).structuredRepairAttempts
  )
  const { factExtractionJobs } = createFactExtractionRuntime({
    sqliteManuscripts,
    databases,
    factExtraction,
    withWorkspaceDatabaseWrite,
    projects
  })
  const research = new ResearchService(settings)
  const researchLibrary = new ResearchLibraryService(projects, sqliteManuscripts)
  const bookImports = new BookImportService(projects, documents, researchLibrary)
  const outlinePlanning = new OutlinePlanningService(projects, documents, researchLibrary, sqliteManuscripts)
  const characterStates = new CharacterStateService(projects, sqliteManuscripts)
  const assertCurrentManuscriptTarget = async (target: {
    workItemId?: string
    workItemPath?: string
  }): Promise<void> => {
    if (!target.workItemId && !target.workItemPath) return
    const [summary, path] = await Promise.all([projects.currentSummary(), projects.currentPath()])
    if (target.workItemId !== summary.id || !target.workItemPath || resolve(target.workItemPath) !== resolve(path)) {
      throw new AppError('CONFLICT', '保存请求所属的作品已经切换，已拒绝写入以保护当前书稿。', {
        recoverable: true,
        details: { area: 'manuscriptIdentity' }
      })
    }
  }
  const reconcileCharacterStates = async (chapters: Chapter[], scopedChapterIds?: number[]): Promise<void> => {
    try {
      await characterStates.reconcileManuscript(chapters, scopedChapterIds)
    } catch (error) {
      console.warn(
        `[character-state] derived reconciliation deferred: ${error instanceof AppError ? error.code : 'INTERNAL_ERROR'}`
      )
    }
  }
  const workspace = new WorkspaceService(
    projects,
    outlinePlanning,
    researchLibrary,
    documents,
    characterStates,
    localRetrieval,
    sqliteManuscripts
  )
  const worldMap = new WorldMapService(projects, sqliteManuscripts)
  const worldMapWorkspace = new WorldMapWorkspaceService(projects, workspace, documents, worldMap)
  const worldMapGeneration = new WorldMapGenerationService(
    projects,
    worldMapWorkspace,
    workspace,
    worldMap,
    new OpenAiCompatibleImageClient({
      resolveConnection: async (id) => {
        const connection = await projectAi.resolveConnection(id)
        if (connection.kind === 'local')
          throw new AppError('FEATURE_UNAVAILABLE', '当前本地模型不支持图像生成。', { recoverable: true })
        return connection
      }
    })
  )
  configuredAutosaveMergeWindowMs = async () => (await workspace.bookProfile()).autosaveMergeWindowMs
  const continuationAnalysis = new ContinuationAnalysisService(
    ai,
    projects,
    bookImports,
    workspace,
    characterStates,
    outlinePlanning
  )
  const foundationDrafts = new FoundationDraftService(ai, workspace)
  const planningDrafts = new PlanningDraftService(ai, workspace)
  const planningPackages = new PlanningPackageService(
    projects,
    outlinePlanning,
    documents,
    undefined,
    characterStates,
    workspace
  )
  const workspaceBootstrap = new WorkspaceBootstrapService({
    projects,
    documents,
    workspace,
    aiSettings: () => projectAi.get(),
    researchSettings: () => settings.researchSettings(),
    researchLibrary,
    outlinePlanning,
    characterStates,
    planningDraft: () => planningPackages.get(),
    importRecoveries: () => bookImports.recoverableManifests(),
    continuation: () => continuationAnalysis.state()
  })
  const chapterSkeletons = new ChapterSkeletonService(ai, planningPackages, outlinePlanning, workspace)
  const chapterSkeletonJobs = new ChapterSkeletonJobService(
    chapterSkeletons,
    async () => (await projects.currentSummary()).id
  )
  const chapterDetails = new ChapterDetailService(ai, planningPackages, outlinePlanning, workspace)
  const chapterDetailJobs = new ChapterDetailJobService(
    chapterDetails,
    async () => (await projects.currentSummary()).id
  )
  const planningJobs = new PlanningJobService({
    generate: async (workItemId, signal, onProgress) =>
      planningPackages.save(await planningDrafts.generate(workItemId, signal, onProgress))
  })
  const chapterDrafts = new ChapterDraftService(ai, documents, workspace)
  const writingAgent = new WritingAgentService(ai, projects, documents, workspace, chapterDrafts)
  const { writingAgentTasks } = createWritingTaskRuntime({
    writingAgent,
    projects,
    databases,
    sqliteManuscripts,
    projectAi,
    modelConnectionsRuntime,
    ai,
    workspaceWrites
  })
  const writingAgentApprovals = new WritingAgentApprovalService(
    projects,
    documents,
    writingAgentTasks,
    databases,
    (root) => sqliteManuscripts.retryMirrors(root),
    workspaceWrites
  )
  const ideaGenerations = new IdeaGenerationService(
    projects,
    databases,
    ai,
    async () => {
      const [profile, materials] = await Promise.all([workspace.bookProfile(), workspace.planningMaterials()])
      return `作品定义与写作风格：\n${JSON.stringify(profile)}\n\n已保存材料与正式设定：\n${materials}`
    },
    undefined,
    (root) => sqliteManuscripts.retryMirrors(root),
    workspaceWrites,
    async () => (await workspace.contextBudgetPreferences()).structuredRepairAttempts
  )
  const outlineExpansions = new OutlineExpansionTaskService(
    projects,
    databases,
    planningDrafts,
    (key) => workspace.planningOutline(key),
    () => ai.modelFor('outline'),
    (root) => sqliteManuscripts.retryMirrors(root),
    workspaceWrites
  )
  const outlineExpansionAdoptions = new OutlineExpansionAdoptionService(
    projects,
    databases,
    (key) => workspace.planningOutline(key),
    (root) => sqliteManuscripts.retryMirrors(root),
    undefined,
    workspaceWrites
  )
  const taskCenter = new TaskCenterService(projects, databases)
  registerFieldAssistant(ipcMain, { projects, workspace, settings, ai, appRoot: app.getPath('userData') })
  companionVoice = registerCompanionVoice(
    app.isPackaged
      ? join(app.getPath('userData'), 'companion-voice')
      : join(__dirname, '../../../../.local/companion-voice'),
    join(__dirname, 'companion-voice/worker.py'),
    localModelRuntime.scheduler
  )
  app.on('before-quit', () => {
    companionVoice?.shutdown()
    localModelRuntime?.clear()
    outlineExpansions.abortForShutdown()
    ideaGenerations.abortForShutdown()
    planningJobs.cancelAll()
    chapterSkeletonJobs.cancelAll()
    chapterDetailJobs.cancelAll()
    writingAgentTasks.abortForShutdown()
    void factExtractionJobs.cancelAll()
  })
  const changeWorkItem = async <T>(operation: () => Promise<T>, preserveCreation = false): Promise<T> => {
    modelConnectionsRuntime?.beginChange(preserveCreation)
    try {
      companionVoice?.clear()
      localModelRuntime?.clear()
      planningJobs.clear()
      chapterSkeletonJobs.clear()
      chapterDetailJobs.clear()
      await writingAgentTasks.cancelAll()
      await ideaGenerations.cancelAll()
      await outlineExpansions.cancelAll()
      outlineExpansionAdoptions.clear()
      writingAgentTasks.clearProjectInitialization()
      await factExtractionJobs.clear()
      writingAgent.clear()
      shadowMigrations.clear()
      sqliteCutovers.clear()
      workspaceBackups.clear()
      return await operation()
    } finally {
      modelConnectionsRuntime?.endChange()
    }
  }

  registerValidatedIpc(ipcMain, 'app:version', decodeNoArgs, () => app.getVersion())

  registerLibraryIpc({
    projects,
    companionVoice,
    settings,
    modelConnectionsRuntime,
    changeWorkItem,
    smokeTrashRoot,
    shadowMigrations,
    sqliteCutovers,
    sqliteManuscripts,
    projectAi,
    workspaceBackups,
    autoBackupStatus,
    runAutomaticBackup,
    workspaceBootstrap,
    workspace
  })
  registerManuscriptIpc({
    projects,
    manuscriptExports,
    documents,
    sqliteManuscripts,
    assertCurrentManuscriptTarget,
    reconcileCharacterStates
  })
  registerLibraryImportsIpc({ bookImports, continuationAnalysis })
  registerPlanningIpc({
    documents,
    outlinePlanning,
    planningJobs,
    projects,
    planningPackages,
    chapterSkeletonJobs,
    chapterDetailJobs,
    sqliteManuscripts,
    ideaGenerations,
    outlineExpansions,
    workspace,
    outlineExpansionAdoptions
  })
  registerModelsIpc({ projectAi, ai })
  registerReviewIpc({
    consistencyEvaluations,
    consistencyEvaluationJobs,
    realTrials,
    workspace,
    sqliteManuscripts,
    projects,
    factExtractionJobs,
    characterStates
  })
  registerAssistantIpc({
    workspace,
    ai,
    writingAgent,
    writingAgentTasks,
    writingAgentApprovals,
    projects,
    documents,
    characterStates,
    sqliteManuscripts,
    taskCenter
  })
  registerWorldbuildingIpc({ settings, research, researchLibrary, workspace, foundationDrafts })
  registerTimelineIpc({ researchLibrary, workspace })
  registerCharactersIpc({ sqliteManuscripts, projects, workspace })
  registerWorldMapIpc({ worldMapWorkspace, worldMap, worldMapGeneration })
  return {
    companionVoice,
    localModelRuntime,
    modelConnectionsRuntime,
    scenarioServices: {
      projects,
      documents,
      characterStates,
      sqliteManuscripts,
      workspace,
      researchLibrary,
      outlinePlanning,
      databases,
      writingAgent,
      workspaceWrites
    }
  }
}

export type DesktopRuntime = ReturnType<typeof createDesktopRuntime>
