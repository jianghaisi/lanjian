import { ChapterStoryContractService } from '../../../../desktop/src/main/modules/planning/application/chapter-story-contract-service'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { projectDirectory } from '../../../../desktop/src/main/platform/storage/project-path'
import type { IpcRegistrar } from '../../../../desktop/src/main/platform/ipc/validated-ipc'
import { registerValidatedIpc } from '../../../../desktop/src/main/platform/ipc/validated-ipc'
import { decodeNoArgs, decodeOptionalChapterIdArgs, decodeAutoBackupRunArgs } from '../../../../desktop/src/contracts/ipc'
import { decodeWorkspaceLoadCheckArgs } from '../../../../desktop/src/contracts/library/ipc'
import { AppError } from '../../../../desktop/src/contracts/core/app-error'
import { WorkspaceBootstrapService } from '../../../../desktop/src/main/modules/library/application/workspace-bootstrap-service'
import { ContinuationAnalysisService } from '../../../../desktop/src/main/modules/library/application/continuation-analysis-service'
import { ChapterSkeletonJobService } from '../../../../desktop/src/main/modules/planning/application/chapter-skeleton-job-service'
import { ChapterDetailJobService } from '../../../../desktop/src/main/modules/planning/application/chapter-detail-job-service'
import { PlanningJobService } from '../../../../desktop/src/main/modules/planning/application/planning-job-service'
import { IdeaGenerationService } from '../../../../desktop/src/main/modules/planning/application/idea-generation-service'
import { OutlineExpansionTaskService } from '../../../../desktop/src/main/modules/planning/application/outline-expansion-task-service'
import { OutlineExpansionAdoptionService } from '../../../../desktop/src/main/modules/planning/application/outline-expansion-adoption-service'
import { WritingAgentPreviewService } from '../../../../desktop/src/main/modules/assistant/application/writing-agent-preview-service'
import { TaskCenterService } from '../../../../desktop/src/main/modules/assistant/application/task-center-service'
import { ConsistencyEvaluationService, ConsistencyEvaluationJobService } from '../../../../desktop/src/main/modules/review/application/consistency-evaluation-service'
import { FactExtractionService } from '../../../../desktop/src/main/modules/review/application/fact-extraction-service'
import { createFactExtractionRuntime } from '../../../../desktop/src/main/modules/review/runtime/fact-extraction-runtime'
import { RealTrialService } from '../../../../desktop/src/main/modules/review/application/real-trial-service'
import { ResearchService } from '../../../../desktop/src/main/modules/worldbuilding/application/research-service'
import { AnnotationRevisionService } from '../../../../desktop/src/main/modules/document-review/application/annotation-revision-service'
import { WorldMapWorkspaceService } from '../../../../desktop/src/main/modules/world-map/application/world-map-workspace-service'
import { WorldMapGenerationService } from '../../../../desktop/src/main/modules/world-map/application/world-map-generation-service'
import { registerManuscriptCommands } from '../../../../desktop/src/main/modules/manuscript/runtime/commands'
import { registerPlanningIpc } from '../../../../desktop/src/main/modules/planning/runtime/commands'
import { registerCharactersIpc } from '../../../../desktop/src/main/modules/characters/runtime/commands'
import { registerReviewIpc } from '../../../../desktop/src/main/modules/review/runtime/commands'
import { registerAssistantIpc } from '../../../../desktop/src/main/modules/assistant/runtime/commands'
import { registerWorldbuildingIpc } from '../../../../desktop/src/main/modules/worldbuilding/runtime/commands'
import { registerTimelineIpc } from '../../../../desktop/src/main/modules/timeline/runtime/commands'
import { registerWorldMapIpc } from '../../../../desktop/src/main/modules/world-map/runtime/commands'
import { registerDocumentReviewIpc } from '../../../../desktop/src/main/modules/document-review/runtime/commands'
import { registerAnnotationRevisionIpc } from '../../../../desktop/src/main/modules/document-review/runtime/generation-commands'
import { registerLibraryImportCommands } from '../../../../desktop/src/main/modules/library/runtime/import-commands'
import type { BookRuntime } from './book-runtime.ts'
import type { HostedJobs } from '../tasks/jobs.ts'
import { fail } from '../http/errors.ts'
import { unwrapValidatedIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import { desktopBookModels } from './desktop-models.ts'
import type { ModelStore } from '../models/model-store.ts'
import { CurrentProjectLegacyWorkspaceSource } from '../../../../desktop/src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../../desktop/src/main/modules/library/application/shadow-import-service'
import { SqliteCutoverSessionService } from '../../../../desktop/src/main/modules/library/application/sqlite-cutover-session-service'
import { WorkspaceBackupService } from '../../../../desktop/src/main/modules/library/application/workspace-backup-service'
import { createAutoBackupRuntime } from '../../../../desktop/src/main/modules/library/runtime/auto-backup-runtime'
import { registerFieldAssistant } from '../../../../desktop/src/main/modules/assistant/runtime/field-assistant-runtime'

/** Original desktop handlers; transport, tenant identity and billing live outside. */
export async function desktopServices(r: BookRuntime, jobs: HostedJobs, models: ModelStore) {
  const settingsRoot = await projectDirectory(r.root, join(r.root, '.webnovel', 'hosted'))
  await mkdir(settingsRoot, { recursive: true, mode: 0o700 })
  await projectDirectory(r.root, settingsRoot)
  const ai = jobs.meter.ai, s = jobs.services(r)
  const { projects, documents, workspace, manuscripts: sqliteManuscripts, databases, writes } = r
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  const ipc: IpcRegistrar = { handle(channel, listener) { if (handlers.has(channel)) throw new Error(`Duplicate command ${channel}`); handlers.set(channel, listener) } }
  const bookModels = desktopBookModels(r, models)
  bookModels.register(ipc)
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const cutovers = new SqliteCutoverSessionService(source, new ShadowImportService(source, databases, writes), databases, sqliteManuscripts, () => projects.currentPath())
  registerValidatedIpc(ipc, 'projects:sqlite-storage-status', decodeNoArgs, () => cutovers.status())
  registerValidatedIpc(ipc, 'projects:status', decodeNoArgs, () => projects.status())
  registerValidatedIpc(ipc, 'projects:migration-preview', decodeNoArgs, () => projects.migrationPreview())
  registerValidatedIpc(ipc, 'workspace:get-chapter-projection', decodeOptionalChapterIdArgs, id => workspace.chapterProjection(id))
  registerValidatedIpc(ipc, 'workspace:get-workflow-status', decodeOptionalChapterIdArgs, id => workspace.workflowStatus(id))
  const workspaceBackups = new WorkspaceBackupService(databases, () => projects.currentPath(), async () => (await projects.currentSummary()).title, () => '0.1.0-web', undefined, undefined, writes)
  const backups = createAutoBackupRuntime({ projects, settings: r.settings, workspaceBackups })
  registerValidatedIpc(ipc, 'projects:auto-backup-get', decodeNoArgs, () => backups.autoBackupStatus())
  registerValidatedIpc(ipc, 'projects:auto-backup-run', decodeAutoBackupRunArgs, force => backups.runAutomaticBackup(force))
  const repairs = async () => (await workspace.contextBudgetPreferences()).structuredRepairAttempts
  const planningJobs = new PlanningJobService({ generate: async (root, signal, progress) => s.packages.save(await s.planning.generate(root, signal, progress)) })
  const chapterSkeletonJobs = new ChapterSkeletonJobService(s.skeletons, async () => (await projects.currentSummary()).id)
  const chapterDetailJobs = new ChapterDetailJobService(s.details, async () => (await projects.currentSummary()).id)
  const continuationAnalysis = new ContinuationAnalysisService(ai, projects, r.imports, workspace, r.characters, r.planning, r.events)
  const ideaGenerations = new IdeaGenerationService(projects, databases, ai, async () => {
    const [profile, materials] = await Promise.all([workspace.bookProfile(), workspace.planningMaterials()])
    return `作品定义与写作风格：\n${JSON.stringify(profile)}\n\n已保存材料与正式设定：\n${materials}`
  }, undefined, root => sqliteManuscripts.retryMirrors(root), writes, repairs)
  const outlineExpansions = new OutlineExpansionTaskService(projects, databases, s.planning, key => workspace.planningOutline(key), () => ai.modelFor('outline'), root => sqliteManuscripts.retryMirrors(root), writes)
  const outlineExpansionAdoptions = new OutlineExpansionAdoptionService(projects, databases, key => workspace.planningOutline(key), root => sqliteManuscripts.retryMirrors(root), undefined, writes)
  const consistencyEvaluations = new ConsistencyEvaluationService(ai, projects, undefined, repairs)
  const consistencyEvaluationJobs = new ConsistencyEvaluationJobService(consistencyEvaluations, projects)
  const { factExtractionJobs } = createFactExtractionRuntime({ sqliteManuscripts, databases, factExtraction: new FactExtractionService(ai, repairs), projects,
    withWorkspaceDatabaseWrite: (root, action, beforeWrite) => writes.run(root, async () => {
      await beforeWrite?.()
      const database = await databases.openExisting(root)
      if (!database) fail('conflict')
      try { await beforeWrite?.(); return await action(database) } finally { database.close() }
    }) })
  const bootstrap = new WorkspaceBootstrapService({ projects, documents, workspace, aiSettings: () => bookModels.service.get(),
    researchSettings: () => r.settings.researchSettings(), researchLibrary: r.research,
    eventProjection: { read: async () => unwrapValidatedIpcResponse('events:projection', { ok: true, value: await r.events.projection.readForConsumer() }) }, outlinePlanning: r.planning, characterStates: r.characters,
    planningDraft: () => s.packages.get(), importRecoveries: () => r.imports.recoverableManifests(), continuation: () => continuationAnalysis.state() })
  const annotations = new AnnotationRevisionService(projects, databases, workspace, ai, writes)
  const worldMapWorkspace = new WorldMapWorkspaceService(projects, workspace, documents, r.worldMap)
  const worldMapGeneration = new WorldMapGenerationService(projects, worldMapWorkspace, workspace, r.worldMap, {
    // An image provider needs its own published price before paid image admission.
    generate: async () => fail('pricing-required')
  })
  registerManuscriptCommands(ipc, { projects, documents, sqliteManuscripts, manuscriptExports: r.exports,
    assertCurrentManuscriptTarget: async target => {
      if (target.workItemId !== r.root || target.workItemPath !== r.root) fail('conflict')
      await projects.currentPath()
    }, reconcileCharacterStates: async (chapters, ids) => {
      // Match desktop: a derived ledger failure cannot turn a committed save
      // into an apparent failure and provoke a destructive retry of author text.
      try { await r.characters.reconcileManuscript(chapters, ids) }
      catch (error) { console.warn(`[character-state] derived reconciliation deferred: ${error instanceof AppError ? error.code : 'INTERNAL_ERROR'}`) }
    } })
  registerPlanningIpc(ipc, { chapterStoryContracts: new ChapterStoryContractService(ai, r.planning, workspace), projects, documents, workspace, sqliteManuscripts, outlinePlanning: r.planning, planningPackages: s.packages,
    planningJobs, chapterSkeletonJobs, chapterDetailJobs, ideaGenerations, outlineExpansions, outlineExpansionAdoptions })
  registerCharactersIpc(ipc, { projects, workspace, sqliteManuscripts })
  registerReviewIpc(ipc, { projects, workspace, sqliteManuscripts, consistencyEvaluations, consistencyEvaluationJobs, factExtractionJobs,
    characterStates: r.characters, realTrials: new RealTrialService(databases, projects, undefined, writes) })
  registerAssistantIpc(ipc, { projects, workspace, documents, sqliteManuscripts, ai, writingAgent: s.agent, writingAgentTasks: s.tasks,
    writingAgentApprovals: s.approvals, writingAgentPreviews: new WritingAgentPreviewService(projects, s.agent), characterStates: r.characters,
    taskCenter: new TaskCenterService(projects, databases) })
  const assistant = registerFieldAssistant(ipc, { projects, workspace, settings: r.settings, ai, applicationAi: ai,
    appRoot: settingsRoot, writing: s.tasks,
    // Hosted guests cannot spawn Electron or arbitrary server code. Builtin and
    // declarative tools use the same registry independently of this native port.
    pluginRunner: { run: async () => ({ ok: false, code: 'unavailable' }), dispose: async () => undefined },
    domains: { projects, workspace, research: r.research, documents, planning: planningJobs, expansion: outlineExpansions, writing: s.tasks, review: s.agent } })
  registerWorldbuildingIpc(ipc, { settings: r.settings, research: new ResearchService(r.settings), researchLibrary: r.research, workspace, foundationDrafts: s.foundation })
  registerTimelineIpc(ipc, { researchLibrary: r.research, workspace, events: r.events })
  registerWorldMapIpc(ipc, { worldMapWorkspace, worldMap: r.worldMap, worldMapGeneration })
  registerDocumentReviewIpc(ipc, s.review)
  registerAnnotationRevisionIpc(ipc, annotations)
  registerLibraryImportCommands(ipc, { bookImports: r.imports, continuationAnalysis })
  registerValidatedIpc(ipc, 'workspace:bootstrap', decodeNoArgs, () => bootstrap.load())
  registerValidatedIpc(ipc, 'workspace:recheck-load-issues', decodeWorkspaceLoadCheckArgs, input => bootstrap.recheck(input))
  return { handlers, bootstrap, assistant, annotations, continuationAnalysis, planningJobs, chapterSkeletonJobs, chapterDetailJobs, ideaGenerations,
    outlineExpansions, consistencyEvaluationJobs, factExtractionJobs, settingsRoot }
}
