import { ipcMain } from 'electron'
import {
  ConsistencyEvaluationJobService,
  ConsistencyEvaluationService
} from '../application/consistency-evaluation-service'
import { FactExtractionJobService } from '../application/fact-extraction-job-service'
import { ProjectService } from '../../library/application/project-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { CharacterStateService } from '../../characters/application/character-state-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import { RealTrialService } from '../application/real-trial-service'
import {
  decodeFactReviewDecisionArgs,
  decodeConsistencyFindingDecisionArgs,
  decodeChapterSummaryArgs,
  decodeWritingAgentRetryArgs,
  decodeChapterIdArgs,
  decodeRealTrialChapterArgs,
  decodeRealTrialConclusionArgs,
  decodeCharacterConflictIdArgs,
  decodeJobIdArgs,
  decodeNoArgs,
  decodeOptionalChapterIdArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  consistencyEvaluations: ConsistencyEvaluationService
  consistencyEvaluationJobs: ConsistencyEvaluationJobService
  realTrials: RealTrialService
  workspace: WorkspaceService
  sqliteManuscripts: SqliteManuscriptService
  projects: ProjectService
  factExtractionJobs: FactExtractionJobService
  characterStates: CharacterStateService
}

export function registerReviewIpc(dependencies: Dependencies): void {
  const {
    consistencyEvaluations,
    consistencyEvaluationJobs,
    realTrials,
    workspace,
    sqliteManuscripts,
    projects,
    factExtractionJobs,
    characterStates
  } = dependencies
  registerValidatedIpc(ipcMain, 'ai:latest-consistency-evaluation', decodeNoArgs, () => consistencyEvaluations.latest())
  registerValidatedIpc(ipcMain, 'ai:start-consistency-evaluation', decodeNoArgs, () =>
    consistencyEvaluationJobs.start()
  )
  registerValidatedIpc(ipcMain, 'ai:consistency-evaluation-job', decodeJobIdArgs, (jobId) =>
    consistencyEvaluationJobs.status(jobId)
  )
  registerValidatedIpc(ipcMain, 'ai:cancel-consistency-evaluation', decodeJobIdArgs, (jobId) =>
    consistencyEvaluationJobs.cancel(jobId)
  )
  registerValidatedIpc(ipcMain, 'projects:real-trial-report', decodeNoArgs, () => realTrials.report())
  registerValidatedIpc(ipcMain, 'projects:save-real-trial-chapter', decodeRealTrialChapterArgs, (input) =>
    realTrials.saveChapter(input)
  )
  registerValidatedIpc(ipcMain, 'projects:save-real-trial-conclusion', decodeRealTrialConclusionArgs, (input) =>
    realTrials.saveConclusion(input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-consistency-overview', decodeOptionalChapterIdArgs, (chapterId) =>
    workspace.consistencyOverview(chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:list-fact-batches', decodeOptionalChapterIdArgs, async (chapterId) =>
    sqliteManuscripts.factBatches(await projects.currentPath(), chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:decide-fact-changes', decodeFactReviewDecisionArgs, async (input) =>
    sqliteManuscripts.decideFacts(await projects.currentPath(), input)
  )
  registerValidatedIpc(
    ipcMain,
    'workspace:decide-consistency-finding',
    decodeConsistencyFindingDecisionArgs,
    async (input) => sqliteManuscripts.decideConsistencyFinding(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:save-chapter-summary', decodeChapterSummaryArgs, async (input) => {
    const result = await sqliteManuscripts.saveApprovedChapterSummary(await projects.currentPath(), input)
    return {
      chapterId: result.legacyChapterId,
      bodyVersionId: result.bodyVersionId,
      content: result.content,
      createdAt: result.createdAt
    }
  })
  registerValidatedIpc(ipcMain, 'workspace:get-chapter-summary', decodeChapterIdArgs, async (chapterId) => {
    const result = await sqliteManuscripts.latestSummaryForChapter(await projects.currentPath(), chapterId)
    return result
      ? {
          chapterId: result.legacyChapterId,
          bodyVersionId: result.bodyVersionId,
          content: result.content,
          createdAt: result.createdAt,
          status: result.status
        }
      : null
  })
  registerValidatedIpc(ipcMain, 'workspace:approved-facts-before', decodeChapterIdArgs, async (chapterId) =>
    sqliteManuscripts.approvedFactsBefore(await projects.currentPath(), chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:start-fact-extraction', decodeChapterIdArgs, async (chapterId) =>
    factExtractionJobs.start(await projects.currentPath(), chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:fact-extraction-job', decodeJobIdArgs, (jobId) =>
    factExtractionJobs.status(jobId)
  )
  registerValidatedIpc(ipcMain, 'workspace:cancel-fact-extraction', decodeJobIdArgs, (jobId) =>
    factExtractionJobs.cancel(jobId)
  )
  registerValidatedIpc(ipcMain, 'workspace:retry-fact-extraction', decodeWritingAgentRetryArgs, (jobId, operationId) =>
    factExtractionJobs.retry(jobId, operationId)
  )
  registerValidatedIpc(ipcMain, 'workspace:list-fact-extraction-jobs', decodeOptionalChapterIdArgs, async (chapterId) =>
    factExtractionJobs.recent(await projects.currentPath(), chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:dismiss-character-conflict', decodeCharacterConflictIdArgs, (conflictId) =>
    characterStates.dismissConflict(conflictId)
  )
}
