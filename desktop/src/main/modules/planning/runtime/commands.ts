import { decodeUpstreamReviewArgs } from '../../../../contracts/planning/upstream-review-contracts'
import { decodeFormalSkeletonPreviewArgs, decodeFormalSkeletonTokenArgs, decodeChapterEventAdoptionArgs } from '../../../../contracts/planning/ipc'
import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { AppError } from '../../../core/errors/app-error'
import { ChapterSkeletonJobService } from '../application/chapter-skeleton-job-service'
import { ChapterDetailJobService } from '../application/chapter-detail-job-service'
import { DocumentService } from '../../manuscript/application/document-service'
import { ProjectService } from '../../library/application/project-service'
import { OutlinePlanningService } from '../application/outline-planning-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { PlanningJobService } from '../application/planning-job-service'
import { PlanningPackageService } from '../application/planning-package-service'
import { IdeaGenerationService } from '../application/idea-generation-service'
import { OutlineExpansionTaskService } from '../application/outline-expansion-task-service'
import { OutlineExpansionAdoptionService } from '../application/outline-expansion-adoption-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import {
  decodeIdeaSaveArgs,
  decodeIdeaGenerationArgs,
  decodeOutlineExpansionArgs,
  decodePlanningOutlineKeyArgs,
  decodeIdeaPromotionArgs,
  decodeWritingAgentRetryArgs,
  decodeChapterIdArgs,
  decodeChapterOutlineUpdateArgs,
  decodeChapterMirrorRecoveryTokenArgs,
  decodeJobIdArgs,
  decodeNoArgs,
  decodeOptionalChapterIdArgs,
  decodePlanningPackageArgs,
  decodePlanningCharacterSeedAdoptionArgs,
  decodePlanningWorldSeedAdoptionArgs,
  decodePlanningPowerSystemAdoptionArgs,
  decodePlanningCheatSystemAdoptionArgs,
  decodePlanningProposalIdArgs,
  decodePlanningChapterDetailArgs,
  decodePlanningChapterDetailAdoptionArgs,
  decodePlanningChapterDetailAdoptionPreviewArgs,
  decodePlanningTotalAdoptionArgs,
  decodePlanningVolumeOutlineAdoptionArgs,
  decodePlanningVolumeOutlinePreviewArgs,
  decodePlanningVolumeStructureArgs,
  decodeOutlineUpdateArgs,
  decodeOutlineVolumeCreateArgs,
  decodeOutlineStageCreateArgs,
  decodeOutlineStageUpdateArgs,
  decodePlannedChapterUpdateArgs,
  decodePlannedChapterStartArgs,
  decodeOutlineChapterStagePlacementArgs,
  decodeOutlineVolumeRenameArgs,
  decodeOutlineEventPlacementArgs,
  decodeOutlineEventChapterPlacementArgs,
  decodeOutlineChapterPlacementArgs,
  decodeOutlineVolumeArgs,
  decodeResearchEventIdArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

import { ChapterStoryContractService } from '../application/chapter-story-contract-service'

interface Dependencies {
  chapterStoryContracts: ChapterStoryContractService
  documents: DocumentService
  outlinePlanning: OutlinePlanningService
  planningJobs: PlanningJobService
  projects: ProjectService
  planningPackages: PlanningPackageService
  chapterSkeletonJobs: ChapterSkeletonJobService
  chapterDetailJobs: ChapterDetailJobService
  sqliteManuscripts: SqliteManuscriptService
  ideaGenerations: IdeaGenerationService
  outlineExpansions: OutlineExpansionTaskService
  workspace: WorkspaceService
  outlineExpansionAdoptions: OutlineExpansionAdoptionService
}

export function registerPlanningIpc(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const {
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
  } = dependencies
  const ownedJob = async <T extends { workItemId: string }, R>(read: () => T, action: (job: T) => R): Promise<R> => {
    const owner = (await projects.currentSummary()).id
    const job = read()
    if (job.workItemId !== owner) throw new AppError('NOT_FOUND', '任务不属于当前作品。', { recoverable: true })
    return action(job)
  }
  registerValidatedIpc(ipcMain, 'planning:generate-chapter-story', decodeChapterIdArgs, chapterId => projects.runInCurrentBook(() => dependencies.chapterStoryContracts.generate(chapterId)))
  registerValidatedIpc(ipcMain, 'planning:prepare-chapter-story-contract', decodeChapterIdArgs, chapterId => projects.runInCurrentBook(() => dependencies.chapterStoryContracts.prepare(chapterId)))
  registerValidatedIpc(ipcMain, 'planning:adopt-chapter-story-contract', decodeJobIdArgs, token => dependencies.chapterStoryContracts.adopt(token))
  registerValidatedIpc(ipcMain, 'outlines:decide-upstream-review', decodeUpstreamReviewArgs, input => outlinePlanning.decideUpstreamReview(input))
  registerValidatedIpc(ipcMain, 'outlines:list', decodeNoArgs, () => documents.outlines())
  registerValidatedIpc(ipcMain, 'outlines:get', decodeOutlineVolumeArgs, (volume) => documents.outline(volume))
  registerValidatedIpc(ipcMain, 'outlines:update', decodeOutlineUpdateArgs, (volume, content) =>
    outlinePlanning.updateOutline(volume, content)
  )
  registerValidatedIpc(ipcMain, 'outlines:tree', decodeNoArgs, () => documents.outlineTree())
  registerValidatedIpc(ipcMain, 'outlines:planning-status', decodeOptionalChapterIdArgs, (chapterId) =>
    outlinePlanning.status(chapterId)
  )
  registerValidatedIpc(ipcMain, 'outlines:acknowledge-review', decodeOutlineVolumeArgs, (volume) =>
    outlinePlanning.acknowledgeOutlineReview(volume)
  )
  registerValidatedIpc(ipcMain, 'outlines:confirm-planning', decodeOutlineVolumeArgs, (volume) =>
    outlinePlanning.confirmPlanningOutline(volume)
  )
  registerValidatedIpc(ipcMain, 'outlines:assign-event', decodeResearchEventIdArgs, (eventId) =>
    outlinePlanning.assignEvent(eventId)
  )
  registerValidatedIpc(ipcMain, 'outlines:unassign-event', decodeResearchEventIdArgs, (eventId) =>
    outlinePlanning.unassignEvent(eventId)
  )
  registerValidatedIpc(ipcMain, 'outlines:create-volume', decodeOutlineVolumeCreateArgs, (title) =>
    outlinePlanning.createVolume(title)
  )
  registerValidatedIpc(ipcMain, 'outlines:create-stage', decodeOutlineStageCreateArgs, (volume, title) =>
    documents.createStage(volume, title)
  )
  registerValidatedIpc(ipcMain, 'outlines:update-stage', decodeOutlineStageUpdateArgs, (stage, title, content) =>
    documents.updateStage(stage, title, content)
  )
  registerValidatedIpc(ipcMain, 'outlines:get-planned-chapter', decodeChapterIdArgs, (id) =>
    documents.getPlannedChapter(id)
  )
  registerValidatedIpc(ipcMain, 'outlines:update-planned-chapter', decodePlannedChapterUpdateArgs, (input) =>
    documents.updatePlannedChapter(input)
  )
  registerValidatedIpc(ipcMain, 'outlines:start-planned-chapter', decodePlannedChapterStartArgs, (input) =>
    outlinePlanning.startPlannedChapter(input)
  )
  registerValidatedIpc(
    ipcMain,
    'outlines:place-chapter-in-stage',
    decodeOutlineChapterStagePlacementArgs,
    (chapterId, stage, volume) => documents.placeChapterInStage(chapterId, stage, volume)
  )
  registerValidatedIpc(ipcMain, 'outlines:rename-volume', decodeOutlineVolumeRenameArgs, (volume, title) =>
    outlinePlanning.renameVolume(volume, title)
  )
  registerValidatedIpc(ipcMain, 'outlines:place-event', decodeOutlineEventPlacementArgs, (eventId, volume) =>
    outlinePlanning.placeEvent(eventId, volume)
  )
  registerValidatedIpc(
    ipcMain,
    'outlines:place-event-in-chapter',
    decodeOutlineEventChapterPlacementArgs,
    (eventId, chapterId) => outlinePlanning.placeEventInChapter(eventId, chapterId)
  )
  registerValidatedIpc(ipcMain, 'outlines:place-chapter', decodeOutlineChapterPlacementArgs, (chapterId, volume) =>
    outlinePlanning.placeChapter(chapterId, volume)
  )
  registerValidatedIpc(ipcMain, 'outlines:review-chapter', decodeChapterIdArgs, (chapterId) =>
    outlinePlanning.reviewChapterOutline(chapterId)
  )
  registerValidatedIpc(ipcMain, 'outlines:confirm-chapter', decodeChapterIdArgs, (chapterId) =>
    outlinePlanning.confirmChapterOutline(chapterId)
  )
  registerValidatedIpc(ipcMain, 'chapter-outlines:list', decodeNoArgs, () => documents.chapterOutlines())
  registerValidatedIpc(ipcMain, 'chapter-outlines:preview-external-mirror', decodeChapterIdArgs, (id) =>
    documents.previewExternalOutlineMirror(id)
  )
  registerValidatedIpc(
    ipcMain,
    'chapter-outlines:adopt-external-mirror',
    decodeChapterMirrorRecoveryTokenArgs,
    (token) => documents.adoptExternalOutlineMirror(token)
  )
  registerValidatedIpc(ipcMain, 'chapter-outlines:get', decodeChapterIdArgs, (chapterId) =>
    documents.chapterOutline(chapterId)
  )
  registerValidatedIpc(ipcMain, 'chapter-outlines:update', decodeChapterOutlineUpdateArgs, (chapterId, content) =>
    outlinePlanning.updateChapterOutline(chapterId, content)
  )
  registerValidatedIpc(ipcMain, 'planning:start', decodeNoArgs, () =>
    projects.runBookTask('自动谋篇', async () => planningJobs.start((await projects.currentSummary()).id), id => planningJobs.status(id))
  )
  registerValidatedIpc(ipcMain, 'planning:job', decodeJobIdArgs, jobId => projects.runInCurrentBook(async () => planningJobs.read(jobId, (await projects.currentSummary()).id)))
  registerValidatedIpc(ipcMain, 'planning:details', decodeJobIdArgs, jobId => projects.runInCurrentBook(async () => planningJobs.read(jobId, (await projects.currentSummary()).id, true)))
  registerValidatedIpc(ipcMain, 'planning:recent', decodeNoArgs, () => projects.runInCurrentBook(async () => planningJobs.recent((await projects.currentSummary()).id)))
  registerValidatedIpc(ipcMain, 'planning:cancel', decodeJobIdArgs, jobId => projects.runInCurrentBook(async () => planningJobs.cancelSaved(jobId, (await projects.currentSummary()).id)))
  for (const [channel, saveOnly] of [['planning:retry', false], ['planning:retry-save', true]] as const) {
    registerValidatedIpc(ipcMain, channel, decodeWritingAgentRetryArgs, (jobId, operationId) =>
      projects.runBookTask('自动谋篇', async () => planningJobs.retry(jobId, operationId, (await projects.currentSummary()).id, saveOnly), id => planningJobs.status(id)))
  }
  registerValidatedIpc(ipcMain, 'planning:draft', decodeNoArgs, () => planningPackages.get())
  registerValidatedIpc(ipcMain, 'planning:save-draft', decodePlanningPackageArgs, (proposal) =>
    planningPackages.save(proposal)
  )
  registerValidatedIpc(ipcMain, 'planning:discard-draft', decodeNoArgs, () => planningPackages.discard())
  registerValidatedIpc(ipcMain, 'planning:recover-damaged-draft', decodeNoArgs, () =>
    planningPackages.recoverDamagedDraft()
  )
  registerValidatedIpc(ipcMain, 'planning:preview-total-adoption', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.previewTotalAdoption(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-total', decodePlanningTotalAdoptionArgs, (input) =>
    planningPackages.adoptTotal(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-volume-structure', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.previewVolumeStructure(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:initialize-volume-structure', decodePlanningVolumeStructureArgs, (input) =>
    planningPackages.initializeVolumeStructure(input)
  )
  registerValidatedIpc(
    ipcMain,
    'planning:preview-volume-outline-adoption',
    decodePlanningVolumeOutlinePreviewArgs,
    (proposalId, order) => planningPackages.previewVolumeOutlineAdoption(proposalId, order)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-volume-outline', decodePlanningVolumeOutlineAdoptionArgs, (input) =>
    planningPackages.adoptVolumeOutline(input)
  )
  registerValidatedIpc(
    ipcMain,
    'planning:preview-chapter-detail-adoption',
    decodePlanningChapterDetailAdoptionPreviewArgs,
    (proposalId, chapterId) => planningPackages.previewChapterDetailAdoption(proposalId, chapterId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-chapter-detail', decodePlanningChapterDetailAdoptionArgs, (input) =>
    planningPackages.adoptChapterDetail(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-chapter-events', decodePlanningChapterDetailAdoptionPreviewArgs,
    (proposalId, chapterId) => planningPackages.previewChapterEvents(proposalId, chapterId))
  registerValidatedIpc(ipcMain, 'planning:preview-chapter-event-adoption', decodeChapterEventAdoptionArgs,
    (proposalId, chapterId, event) => planningPackages.previewChapterEventAdoption(proposalId, chapterId, event))
  registerValidatedIpc(ipcMain, 'planning:adopt-chapter-event', decodeFormalSkeletonTokenArgs, token => planningPackages.adoptChapterEvent(token))
  registerValidatedIpc(ipcMain, 'planning:recover-chapter-event', decodeFormalSkeletonTokenArgs, operationId => planningPackages.recoverChapterEvent(operationId))
  registerValidatedIpc(
    ipcMain,
    'planning:preview-character-seed-adoption',
    decodePlanningProposalIdArgs,
    (proposalId) => planningPackages.previewCharacterSeedAdoption(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-character-seeds', decodePlanningCharacterSeedAdoptionArgs, (input) =>
    planningPackages.adoptCharacterSeeds(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-world-seed-adoption', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.previewWorldSeedAdoption(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-world-seed', decodePlanningWorldSeedAdoptionArgs, (input) =>
    planningPackages.adoptWorldSeed(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-power-system-adoption', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.previewPowerSystemAdoption(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-power-system', decodePlanningPowerSystemAdoptionArgs, (input) =>
    planningPackages.adoptPowerSystem(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-cheat-system-adoption', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.previewCheatSystemAdoption(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:adopt-cheat-system', decodePlanningCheatSystemAdoptionArgs, (input) =>
    planningPackages.adoptCheatSystem(input)
  )
  registerValidatedIpc(ipcMain, 'planning:preview-formal-skeleton', decodeFormalSkeletonPreviewArgs, (proposalId, volume) => planningPackages.previewFormalSkeleton(proposalId, volume))
  registerValidatedIpc(ipcMain, 'planning:adopt-formal-skeleton', decodeFormalSkeletonTokenArgs, token => planningPackages.adoptFormalSkeleton(token))
  registerValidatedIpc(ipcMain, 'planning:chapter-skeleton-status', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.chapterSkeletonStatus(proposalId)
  )
  registerValidatedIpc(ipcMain, 'planning:start-chapter-skeleton', decodePlanningProposalIdArgs, (proposalId) =>
    projects.runBookTask('章节安排', () => chapterSkeletonJobs.start(proposalId), id => chapterSkeletonJobs.status(id))
  )
  registerValidatedIpc(ipcMain, 'planning:chapter-skeleton-job', decodeJobIdArgs, (jobId) =>
    ownedJob(() => chapterSkeletonJobs.status(jobId), job => job)
  )
  registerValidatedIpc(ipcMain, 'planning:cancel-chapter-skeleton', decodeJobIdArgs, (jobId) =>
    ownedJob(() => chapterSkeletonJobs.status(jobId), () => chapterSkeletonJobs.cancel(jobId))
  )
  registerValidatedIpc(ipcMain, 'planning:chapter-detail-statuses', decodePlanningProposalIdArgs, (proposalId) =>
    planningPackages.chapterDetailStatuses(proposalId)
  )
  registerValidatedIpc(
    ipcMain,
    'planning:start-chapter-detail',
    decodePlanningChapterDetailArgs,
    (proposalId, volume) => projects.runBookTask('详细章纲', () => chapterDetailJobs.start(proposalId, volume), id => chapterDetailJobs.status(id))
  )
  registerValidatedIpc(ipcMain, 'planning:chapter-detail-job', decodeJobIdArgs, (jobId) =>
    ownedJob(() => chapterDetailJobs.status(jobId), job => job)
  )
  registerValidatedIpc(ipcMain, 'planning:cancel-chapter-detail', decodeJobIdArgs, (jobId) =>
    ownedJob(() => chapterDetailJobs.status(jobId), () => chapterDetailJobs.cancel(jobId))
  )
  registerValidatedIpc(ipcMain, 'workspace:list-ideas', decodeNoArgs, async () =>
    sqliteManuscripts.ideas(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'workspace:save-idea', decodeIdeaSaveArgs, async (input) =>
    sqliteManuscripts.saveIdea(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:start-idea-generation', decodeIdeaGenerationArgs, (input) =>
    projects.runBookTask('灵感生成', () => ideaGenerations.start(input), id => ideaGenerations.status(id))
  )
  registerValidatedIpc(ipcMain, 'workspace:retry-idea-generation', decodeWritingAgentRetryArgs, (id, operationId) =>
    projects.runBookTask('灵感生成', () => ideaGenerations.retry(id, operationId), taskId => ideaGenerations.status(taskId))
  )
  registerValidatedIpc(ipcMain, 'workspace:start-outline-expansion', decodeOutlineExpansionArgs, (input) =>
    projects.runBookTask('章纲扩展', () => outlineExpansions.start(input), id => outlineExpansions.status(id))
  )
  registerValidatedIpc(ipcMain, 'workspace:retry-outline-expansion', decodeWritingAgentRetryArgs, (id, operationId) =>
    projects.runBookTask('章纲扩展', () => outlineExpansions.retry(id, operationId), taskId => outlineExpansions.status(taskId))
  )
  registerValidatedIpc(ipcMain, 'workspace:get-planning-outline', decodePlanningOutlineKeyArgs, (key) =>
    workspace.planningOutline(key)
  )
  registerValidatedIpc(ipcMain, 'workspace:list-outline-expansions', decodeNoArgs, () => outlineExpansions.recent())
  registerValidatedIpc(ipcMain, 'workspace:cancel-outline-expansion', decodeJobIdArgs, (id) =>
    outlineExpansions.cancel(id)
  )
  registerValidatedIpc(ipcMain, 'workspace:preview-outline-expansion-adoption', decodeJobIdArgs, (id) =>
    outlineExpansionAdoptions.preview(id)
  )
  registerValidatedIpc(ipcMain, 'workspace:adopt-outline-expansion', decodeJobIdArgs, (token) =>
    outlineExpansionAdoptions.adopt(token)
  )
  registerValidatedIpc(ipcMain, 'workspace:list-idea-generations', decodeNoArgs, () => ideaGenerations.recent())
  registerValidatedIpc(ipcMain, 'workspace:idea-generation', decodeJobIdArgs, (id) => ideaGenerations.status(id))
  registerValidatedIpc(ipcMain, 'workspace:cancel-idea-generation', decodeJobIdArgs, (id) => ideaGenerations.cancel(id))
  registerValidatedIpc(
    ipcMain,
    'workspace:promote-idea-world-rule',
    decodeIdeaPromotionArgs,
    async (ideaId, expectedUpdatedAt) =>
      sqliteManuscripts.promoteIdeaToWorldRule(await projects.currentPath(), ideaId, expectedUpdatedAt)
  )
  registerValidatedIpc(
    ipcMain,
    'workspace:promote-idea-summary',
    decodeIdeaPromotionArgs,
    async (ideaId, expectedUpdatedAt) =>
      sqliteManuscripts.promoteIdeaToSummary(await projects.currentPath(), ideaId, expectedUpdatedAt)
  )
}
