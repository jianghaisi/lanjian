import { InspirationStore } from '../modules/inspiration/adapters/inspiration-store'
import { InspirationService } from '../modules/inspiration/application/inspiration-service'
import { createLibraryCreativePolicyProvider } from '../modules/writing-plugins/runtime/library-policy-provider'
import { InspirationSelectionService } from '../modules/inspiration/application/selection-service'
import { InspirationVideoService } from '../modules/inspiration/application/video-service'
import { NativeVideoAcquisition } from '../modules/inspiration/adapters/native-video'
import { BilibiliSubtitles } from '../modules/inspiration/adapters/bilibili-subtitles'
import { inspirationModels, inspirationBooks } from '../modules/inspiration/adapters/original-ports'
import { registerInspiration } from '../modules/inspiration/runtime/ipc'
import { registerGroupChat } from '../modules/group-chat/runtime/group-chat-runtime'
import { registerNativePluginManagement } from '../modules/writing-plugins/runtime/management-runtime'
import { createNativePluginAuthoring, registerPluginAuthoring } from '../modules/writing-plugins/runtime/authoring-runtime'
import { createNativePluginMarketplace, registerPluginMarketplace } from '../modules/writing-plugins/runtime/marketplace-runtime'
import { createPluginWorkbenchTools } from '../modules/writing-plugins/adapters/builtin/plugin-workbench'
import { bundledPackagePorts } from '../modules/writing-plugins/adapters/bundled-packages'
import { BundledPluginService } from '../modules/writing-plugins/application/bundled-service'
import { registerBundledPlugins } from '../modules/writing-plugins/runtime/bundled-runtime'
import { PluginCompositionService } from '../modules/writing-plugins/application/composition-service'
import { registerLocalModels } from '../modules/models/runtime/local-model-runtime'
import { mainOutputDirectory } from '../platform/processes/main-output-directory'
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
import { ChapterStoryContractService } from '../modules/planning/application/chapter-story-contract-service'
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
import { WorkspaceService, normalizeContextBudgetPreferences } from '../modules/library/application/workspace-service'
import { WorkspaceBootstrapService } from '../modules/library/application/workspace-bootstrap-service'
import { WorldMapService } from '../modules/world-map/application/world-map-service'
import { WorldMapWorkspaceService } from '../modules/world-map/application/world-map-workspace-service'
import { WorldMapGenerationService } from '../modules/world-map/application/world-map-generation-service'
import { OpenAiCompatibleImageClient } from '../modules/models/adapters/openai-compatible-image-client'
import { FoundationDraftService } from '../modules/planning/application/foundation-draft-service'
import { PlanningDraftService } from '../modules/planning/application/planning-draft-service'
import { createContributionContextProvider } from '../modules/writing-plugins/runtime/contribution-context'
import { createCreativePolicyProvider } from '../modules/writing-plugins/runtime/creative-policy-provider'
import type { CreativePolicyRun } from '../modules/writing-plugins/domain/creative-policy'
import { PlanningJobService } from '../modules/planning/application/planning-job-service'
import { PlanningPackageService } from '../modules/planning/application/planning-package-service'
import { CharacterStateService } from '../modules/characters/application/character-state-service'
import { WritingAgentService } from '../modules/assistant/application/writing-agent-service'
import { WritingAgentPreviewService } from '../modules/assistant/application/writing-agent-preview-service'
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
import { createWritingPluginRunHost } from '../modules/writing-plugins/runtime/electron-guest-process'
import { registerCompanionVoice } from '../modules/companion/runtime/companion-voice-runtime'
import { registerLibraryIpc } from '../modules/library/runtime/ipc'
import { registerManuscriptIpc } from '../modules/manuscript/runtime/ipc'
import { registerLibraryImportsIpc } from '../modules/library/runtime/import-ipc'
import { registerPlanningIpc } from '../modules/planning/runtime/ipc'
import { registerModelsIpc } from '../modules/models/runtime/ipc'
import { registerReviewIpc } from '../modules/review/runtime/ipc'
import { registerAssistantIpc } from '../modules/assistant/runtime/ipc'
import { DocumentReviewService } from '../modules/document-review/application/document-review-service'
import { registerDocumentReviewIpc } from '../modules/document-review/runtime/ipc'
import { AnnotationRevisionService } from '../modules/document-review/application/annotation-revision-service'
import { registerAnnotationRevisionIpc } from '../modules/document-review/runtime/generation-ipc'
import { registerWorldbuildingIpc } from '../modules/worldbuilding/runtime/ipc'
import { registerTimelineIpc } from '../modules/timeline/runtime/ipc'
import { createEventRuntime } from '../modules/timeline/runtime/event-runtime'
import { registerCharactersIpc } from '../modules/characters/runtime/ipc'
import { registerWorldMapIpc } from '../modules/world-map/runtime/ipc'
import { createAutoBackupRuntime } from '../modules/library/runtime/auto-backup-runtime'
import { createFactExtractionRuntime } from '../modules/review/runtime/fact-extraction-runtime'
import { createWritingTaskRuntime } from '../modules/assistant/runtime/writing-task-runtime'
import {
  initializeGlobalModelDataRoot,
  resolveGlobalModelDataRoot
} from '../modules/models/adapters/global-model-data-root'
import { WindowsDpapiModelSecrets } from '../modules/models/adapters/windows-dpapi-model-secrets'

export async function createDesktopRuntime() {
  const mainDirectory = mainOutputDirectory(__dirname)
  let companionVoice: ReturnType<typeof registerCompanionVoice> | undefined
  let localModelRuntime: ReturnType<typeof registerLocalModels> | undefined
  let modelConnectionsRuntime: ReturnType<typeof registerModelConnections> | undefined

  const profileSecrets = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  const modelSecrets = process.platform === 'win32' ? new WindowsDpapiModelSecrets() : profileSecrets
  const userData = app.getPath('userData')
  // LANJIAN_USER_DATA_PATH is a developer/smoke profile override. Keep its
  // synthetic credentials contained unless a caller explicitly supplies a
  // shared global root. Ordinary app profiles always use the stable app root.
  const isolatedGlobalRoot = process.env.LANJIAN_GLOBAL_MODEL_DATA_PATH
    ?? (process.env.LANJIAN_USER_DATA_PATH ? join(userData, 'global-model-data', 'v1') : undefined)
  const globalModelRoot = resolveGlobalModelDataRoot({
    appData: app.getPath('appData'),
    ...(isolatedGlobalRoot
      ? { isolatedRoot: isolatedGlobalRoot }
      : {})
  })
  await initializeGlobalModelDataRoot({ targetRoot: globalModelRoot, legacyRoot: userData,
    secrets: profileSecrets, targetSecrets: modelSecrets })
  const settings = new SettingsStore(userData, profileSecrets)
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
    operation: (database: import('../core/ports/workspace-database').WorkspaceDatabasePort) => T | Promise<T>,
    beforeWrite?: () => Promise<void>
  ): Promise<T> =>
    workspaceWrites.run(workItemId, async () => {
      await beforeWrite?.()
      const database = await databases.openExisting(workItemId)
      if (!database) throw new AppError('FEATURE_UNAVAILABLE', '作品数据库不可用。', { recoverable: true })
      try {
        await beforeWrite?.()
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
      : join(mainDirectory, '../../../../.local/companion-voice'),
    join(mainDirectory.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), 'local-models/text-worker.py'),
    app.getPath('userData')
  )
  modelConnectionsRuntime = registerModelConnections(
    ipcMain,
    globalModelRoot,
    userData,
    modelSecrets,
    projects,
    sqliteManuscripts,
    workspaceWrites,
    localModelRuntime.service,
    (operation, preserveCreation) => changeWorkItem(operation, preserveCreation),
    settings,
    profileSecrets,
    () => writingAgentPreviews.cancel()
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
  const events = createEventRuntime(projects, databases, workspaceWrites, ai, { contextBudgetPreferences: () => workspace.contextBudgetPreferences() }, {
    capturePolicy: () => creativePolicy(),
    context: planningPolicyContext,
    runInBook: operation => projects.runInCurrentBook(operation),
    assertBook: async (root, workItemId) => {
      const path = await projects.currentPath(), summary = await projects.currentSummary({ includeManuscript: false })
      if (resolve(path) !== resolve(root) || resolve(summary.path) !== resolve(root) || summary.id !== workItemId) {
        throw new AppError('CONFLICT', '原作品身份已经变化，请重新发起时间线任务。', { recoverable: true })
      }
    }
  }, {
    capturePolicy: () => creativePolicy(),
    context: (readOnly, policy) => planningPolicyContext(readOnly, policy, 'review'),
    profile: () => workspace.bookProfile(),
    budget: readCreativeBudget
  })
  async function readCreativeBudget() {
    const root = await projects.currentPath()
    return workspaceWrites.read(root, async () => {
      const config = await sqliteManuscripts.readProjectWritingConfigForGuard(root)
      return normalizeContextBudgetPreferences(JSON.parse(config.configJson).contextBudgetPreferences)
    })
  }
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
    async () => (await readCreativeBudget()).structuredRepairAttempts,
    { capturePolicy: () => creativePolicy(), profile: () => workspace.bookProfile(), context: (readOnly, policy) => planningPolicyContext(readOnly, policy, 'review') }
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
  const outlinePlanning = new OutlinePlanningService(projects, documents, researchLibrary, sqliteManuscripts, {
    read: () => events.projection.readForConsumer(), sync: async root => (await events.mirrors.retryCaptured(root)).status === 'synced'
  })
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
    sqliteManuscripts,
    { read: () => events.projection.readForConsumer() }
  )
  const worldMap = new WorldMapService(projects, sqliteManuscripts)
  const worldMapWorkspace = new WorldMapWorkspaceService(projects, workspace, {
    chapters: async () => {
      const root = await projects.currentPath()
      return await sqliteManuscripts.active(root) ? sqliteManuscripts.worldMapChaptersForGuard(root) : documents.chapters()
    }
  }, worldMap)
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
    }),
    undefined,
    () => creativePolicy()
  )
  configuredAutosaveMergeWindowMs = async () => (await workspace.bookProfile()).autosaveMergeWindowMs
  const continuationAnalysis = new ContinuationAnalysisService(
    ai,
    projects,
    bookImports,
    workspace,
    characterStates,
    outlinePlanning,
    events,
    { capturePolicy: () => creativePolicy(), context: planningPolicyContext, writes: workspaceWrites }
  )
  const contributionContext = createContributionContextProvider(async () => assistantRuntime.plugins.captureComposition((await projects.currentSummary()).id))
  const creativePolicy = createCreativePolicyProvider(async () => assistantRuntime.plugins.captureComposition((await projects.currentSummary()).id), async version => (await assistantRuntime.plugins.loadAuthorized((await projects.currentSummary()).id, version.manifest.id, version.digest)).files, async ref => assistantRuntime.plugins.loadAuthorized((await projects.currentSummary()).id, ref.pluginId, ref.digest))
  async function planningPolicyContext(readOnly?: boolean, policy?: CreativePolicyRun, task: 'outline' | 'review' = 'outline') {
    const [profile, materials, realms, power, cheat, system, prompts] = await Promise.all([
      workspace.bookProfile(), workspace.planningMaterials(readOnly), workspace.realms(true), workspace.powerSystem(true), workspace.cheatSystem(true), workspace.systemTemplate(true), workspace.promptProfile(undefined, true)
    ])
    policy?.resolve('genre-guidance', { genre: profile.genre || '', subgenre: profile.subgenre || '' })
    const fragments = await contributionContext(task === 'review' ? 'review' : 'planning')
    return `作品定义与写作风格：\n${JSON.stringify(profile)}\n\n已保存材料与正式设定：\n${materials}\n\n境界、力量、金手指与固定系统模板：\n${JSON.stringify({ realms, power, cheat, system })}\n\n作者规划要求：\n${prompts.entries.find(entry => entry.task === task)?.override || ''}\n\n原插件参考资料（非正式事实，不得覆盖以上约束）：\n${JSON.stringify(fragments)}`
  }
  const foundationDrafts = new FoundationDraftService(ai, workspace, () => contributionContext('worldbuilding'), creativePolicy)
  const planningDrafts = new PlanningDraftService(ai, workspace, undefined, undefined, () => contributionContext('planning'), creativePolicy)
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
    eventProjection: {
      read: () => events.projection.readForConsumer() as unknown as Promise<import('../../contracts').EventProjectionDto | null>
    },
    outlinePlanning,
    characterStates,
    planningDraft: () => planningPackages.get(),
    importRecoveries: () => bookImports.recoverableManifests(),
    continuation: () => continuationAnalysis.state()
  })
  const chapterSkeletons = new ChapterSkeletonService(ai, planningPackages, outlinePlanning, workspace, undefined, creativePolicy)
  const chapterSkeletonJobs = new ChapterSkeletonJobService(
    chapterSkeletons,
    async () => (await projects.currentSummary()).id
  )
  const chapterStoryContracts = new ChapterStoryContractService(ai, outlinePlanning, workspace, creativePolicy)
  const chapterDetails = new ChapterDetailService(ai, planningPackages, outlinePlanning, workspace, undefined, creativePolicy)
  const chapterDetailJobs = new ChapterDetailJobService(
    chapterDetails,
    async () => (await projects.currentSummary()).id
  )
  const planningJobs = new PlanningJobService({
    generate: async (workItemId, signal, onProgress) =>
      planningPackages.save(await planningDrafts.generate(workItemId, signal, onProgress))
  })
  const chapterDrafts = new ChapterDraftService(ai, documents, workspace, creativePolicy)
  const writingAgent = new WritingAgentService(ai, projects, documents, workspace, chapterDrafts, undefined, contributionContext, creativePolicy)
  const writingAgentPreviews = new WritingAgentPreviewService(projects, writingAgent)
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
  const annotationRevisions = new AnnotationRevisionService(projects, databases, workspace, ai, workspaceWrites, creativePolicy)
  registerAnnotationRevisionIpc(annotationRevisions)
  registerDocumentReviewIpc(new DocumentReviewService(projects, writingAgentTasks, databases, root => sqliteManuscripts.retryMirrors(root), workspaceWrites,
    (document, blockId) => annotationRevisions.assertContextCurrent(document, blockId)))
  const ideaGenerations = new IdeaGenerationService(
    projects,
    databases,
    ai,
    planningPolicyContext,
    undefined,
    (root) => sqliteManuscripts.retryMirrors(root),
    workspaceWrites,
    async () => (await workspace.contextBudgetPreferences()).structuredRepairAttempts,
    creativePolicy
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
  const inspiration = new InspirationService(new InspirationStore(userData, 'desktop-author'), inspirationModels(profile => modelConnectionsRuntime.groupModels.capture(profile)), createLibraryCreativePolicyProvider(() => assistantRuntime.plugins))
  const inspirationSelection = new InspirationSelectionService(inspiration, inspirationBooks(projects, researchLibrary))
  const inspirationVideoRuntime = new NativeVideoAcquisition(userData, app.isPackaged ? join(userData, 'companion-voice') : join(mainDirectory, '../../../../.local/companion-voice'), join(mainDirectory.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), 'inspiration/worker.py'))
  const inspirationVideo = new InspirationVideoService(inspiration, new BilibiliSubtitles(), inspirationVideoRuntime)
  registerInspiration(ipcMain, inspiration, inspirationSelection, inspirationVideo)
  app.once('before-quit', () => { inspirationVideoRuntime.shutdown(); void inspirationVideo.shutdown().then(() => inspiration.shutdown()) })
  const pluginRunner = createWritingPluginRunHost()
  const groupChat = registerGroupChat(ipcMain, { appRoot: app.getPath('userData'), inspiration, projects, models: modelConnectionsRuntime.groupModels, plugins: { manager: () => assistantRuntime.plugins, runner: pluginRunner }, creativePolicy, creation: modelConnectionsRuntime.groupCreation, workspace, research: researchLibrary, onlineResearch: research,
    adoptionDomains: { characters: { list: async () => sqliteManuscripts.storyEntities(await projects.currentPath()), save: async input => sqliteManuscripts.saveStoryEntity(await projects.currentPath(), input) }, events: { read: () => events.projection.read(), preview: input => events.operations.previewMaterialCandidate(input), prepareAdopt: input => events.operations.preview(input), commit: token => events.operations.commit(token) } },
    domains: { projects, workspace, research: researchLibrary, documents, planning: planningJobs, expansion: outlineExpansions, writing: writingAgentTasks, review: writingAgent } })
  app.once('before-quit', () => groupChat.shutdown())
  const assistantRuntime = registerFieldAssistant(ipcMain, { projects, workspace, settings, ai, creativePolicy, pluginRunner, onPluginRevoked: (id, bookId) => groupChat.revokePlugin(id, bookId), appRoot: app.getPath('userData'), writing: writingAgentTasks, domains: { projects, workspace, research: researchLibrary, documents, planning: planningJobs, expansion: outlineExpansions, writing: writingAgentTasks, review: writingAgent } })
  const pluginAuthoring = createNativePluginAuthoring(app.getPath('userData'), assistantRuntime.plugins)
  registerPluginAuthoring(ipcMain, pluginAuthoring)
  const pluginMarket = createNativePluginMarketplace(app.getPath('userData'), pluginAuthoring, assistantRuntime.plugins)
  registerPluginMarketplace(ipcMain, pluginMarket)
  const bundledPlugins = new BundledPluginService(bundledPackagePorts(app.getPath('userData')), assistantRuntime.plugins, pluginAuthoring)
  registerBundledPlugins(ipcMain, bundledPlugins)
  const pluginManagement = registerNativePluginManagement(ipcMain, assistantRuntime.plugins, projects, { provenance: async (id, digest) => await bundledPlugins.official(id, digest) ? { distribution: 'official', createdByMe: false } : pluginMarket.provenance(id, digest), beforeInstall: plan => pluginMarket.beforeInstall(plan) })
  assistantRuntime.setPluginToolFactory(createPluginWorkbenchTools({ authoring: pluginAuthoring, market: pluginMarket, bundled: bundledPlugins, manager: assistantRuntime.plugins, composition: new PluginCompositionService(assistantRuntime.plugins), choosePackage: () => pluginManagement.choosePackage() }))
  companionVoice = registerCompanionVoice(
    app.isPackaged
      ? join(app.getPath('userData'), 'companion-voice')
      : join(mainDirectory, '../../../../.local/companion-voice'),
    join(mainDirectory, 'companion-voice/worker.py'),
    localModelRuntime.scheduler,
    app.getPath('userData'),
    () => projects.currentSummary()
  )
  // A cancelled save/draft guard leaves the application usable, including pet
  // care IPC. Tear down runtimes only after the windows have actually closed.
  app.on('will-quit', () => {
    writingAgentPreviews.cancel()
    assistantRuntime.abortForShutdown()
    companionVoice?.shutdown()
    events.extraction?.shutdown()
    localModelRuntime?.clear()
    outlineExpansions.abortForShutdown()
    ideaGenerations.abortForShutdown()
    planningJobs.cancelAll()
    chapterSkeletonJobs.cancelAll()
    chapterDetailJobs.cancelAll()
    writingAgentTasks.abortForShutdown()
    annotationRevisions.abortForShutdown()
    consistencyEvaluationJobs.cancelAll()
    void factExtractionJobs.cancelAll()
  })
  const changeWorkItem = async <T>(operation: () => Promise<T>, preserveCreation = false): Promise<T> => {
    workspaceBootstrap.invalidate()
    modelConnectionsRuntime?.beginChange(preserveCreation)
    writingAgentPreviews.beginNavigation()
    try {
      companionVoice?.clear()
      outlineExpansionAdoptions.clear()
      shadowMigrations.clear()
      sqliteCutovers.clear()
      workspaceBackups.clear()
      events.clear()
      return await operation()
    } finally {
      workspaceBootstrap.invalidate()
      modelConnectionsRuntime?.endChange()
      writingAgentPreviews.endNavigation()
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
    chapterStoryContracts,
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
    creativePolicy,
    writingAgent,
    writingAgentPreviews,
    writingAgentTasks,
    writingAgentApprovals,
    projects,
    documents,
    characterStates,
    sqliteManuscripts,
    taskCenter
  })
  registerWorldbuildingIpc({ settings, research, researchLibrary, workspace, foundationDrafts })
  registerTimelineIpc({ researchLibrary, workspace, events })
  registerCharactersIpc({ sqliteManuscripts, projects, workspace })
  registerWorldMapIpc({ worldMapWorkspace, worldMap, worldMapGeneration })
  return {
    companionVoice,
    writingAgentPreviews,
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
      workspaceWrites,
      events
    }
  }
}

export type DesktopRuntime = Awaited<ReturnType<typeof createDesktopRuntime>>
