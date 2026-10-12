import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { AiClient } from '../../models/application/ai-client'
import { DocumentService } from '../../manuscript/application/document-service'
import { ProjectService } from '../../library/application/project-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { CharacterStateService } from '../../characters/application/character-state-service'
import { WritingAgentService } from '../application/writing-agent-service'
import { WritingAgentPreviewService } from '../application/writing-agent-preview-service'
import { WritingAgentTaskService } from '../application/writing-agent-task-service'
import { WritingAgentApprovalService } from '../application/writing-agent-approval-service'
import { TaskCenterService } from '../application/task-center-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import { AppError } from '../../../core/errors/app-error'
import { DirectCompletionService } from '../application/direct-completion-service'
import type { CaptureCreativePolicy } from '../../writing-plugins/domain/creative-policy'
import type { DirectCompletionOperation } from '../../../../contracts/models/ai-api'
import {
  decodeAiCompleteArgs,
  decodeWritingAgentArtifactDecisionArgs,
  decodeWritingAgentArtifactApplicationArgs,
  decodeWritingAgentArgs,
  decodeWritingAgentRetryArgs,
  decodeWritingAgentStartArgs,
  decodeChapterIdArgs,
  decodeContextBudgetPreferencesArgs,
  decodeJobIdArgs,
  decodeNoArgs,
  decodeOptionalChapterIdArgs,
  decodePromptOverrideArgs,
  decodePromptTaskArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  workspace: WorkspaceService
  ai: AiClient
  writingAgent: WritingAgentService
  writingAgentPreviews: WritingAgentPreviewService
  writingAgentTasks: WritingAgentTaskService
  writingAgentApprovals: WritingAgentApprovalService
  projects: ProjectService
  documents: DocumentService
  characterStates: CharacterStateService
  sqliteManuscripts: SqliteManuscriptService
  taskCenter: TaskCenterService
  creativePolicy?: CaptureCreativePolicy
}

export function registerAssistantIpc(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const {
    workspace,
    ai,
    writingAgent,
    writingAgentPreviews,
    writingAgentTasks,
    writingAgentApprovals,
    projects,
    documents,
    characterStates,
    sqliteManuscripts,
    taskCenter
  } = dependencies
  const direct = new DirectCompletionService(projects, workspace, ai, dependencies.creativePolicy)
  registerValidatedIpc(ipcMain, 'ai:complete', decodeAiCompleteArgs, (instruction, draft, task, chapterId, operation?: DirectCompletionOperation) =>
    projects.runInCurrentBook(() => direct.complete(instruction, draft, task, chapterId, operation))
  )
  registerValidatedIpc(ipcMain, 'ai:run-writing-agent', decodeWritingAgentArgs, (input) =>
    projects.runInCurrentBook(() => writingAgent.run(input))
  )
  registerValidatedIpc(ipcMain, 'ai:preview-writing-agent-context', decodeWritingAgentArgs, (input) =>
    writingAgentPreviews.preview(input)
  )
  registerValidatedIpc(ipcMain, 'ai:start-writing-agent', decodeWritingAgentStartArgs, (input) =>
    projects.runBookTask('正文写作', () => writingAgentTasks.start(input), id => writingAgentTasks.status(id))
  )
  registerValidatedIpc(ipcMain, 'ai:background-tasks', decodeNoArgs, () => projects.backgroundTasks.list())
  registerValidatedIpc(ipcMain, 'ai:writing-agent-task', decodeJobIdArgs, (taskId) => writingAgentTasks.status(taskId))
  registerValidatedIpc(ipcMain, 'ai:list-writing-agent-tasks', decodeChapterIdArgs, (chapterId) =>
    writingAgentTasks.recent(chapterId)
  )
  registerValidatedIpc(ipcMain, 'ai:pause-writing-agent-task', decodeJobIdArgs, (taskId) =>
    writingAgentTasks.pause(taskId)
  )
  registerValidatedIpc(ipcMain, 'ai:resume-writing-agent-task', decodeWritingAgentRetryArgs, (taskId, operationId) =>
    projects.runBookTask('正文写作', () => writingAgentTasks.resume(taskId, operationId), id => writingAgentTasks.status(id))
  )
  registerValidatedIpc(ipcMain, 'ai:cancel-writing-agent-task', decodeJobIdArgs, (taskId) =>
    writingAgentTasks.cancel(taskId)
  )
  registerValidatedIpc(ipcMain, 'ai:retry-writing-agent-task', decodeWritingAgentRetryArgs, (taskId, operationId) =>
    projects.runBookTask('正文写作', () => writingAgentTasks.retry(taskId, operationId), id => writingAgentTasks.status(id))
  )
  registerValidatedIpc(ipcMain, 'ai:dismiss-writing-agent-task', decodeJobIdArgs, (taskId) =>
    writingAgentTasks.dismiss(taskId)
  )
  registerValidatedIpc(ipcMain, 'ai:decide-writing-agent-artifact', decodeWritingAgentArtifactDecisionArgs, (input) =>
    writingAgentTasks.decide(input)
  )
  registerValidatedIpc(ipcMain, 'ai:apply-writing-agent-artifact', decodeWritingAgentArtifactApplicationArgs, (input) =>
    writingAgentApprovals.apply(input)
  )
  registerValidatedIpc(ipcMain, 'ai:settle-writing-agent', decodeJobIdArgs, async (turnId) => {
    const turn = await writingAgentTasks.proposal(turnId)
    const summary = await projects.currentSummary()
    if (!turn || turn.workItemId !== summary.id) {
      throw new AppError('CONFLICT', '写作 Agent 候选不属于当前作品，已拒绝结算。', { recoverable: true })
    }
    const root = await projects.currentPath()
    const chapter = await documents.chapter(turn.chapterId)
    const result =
      turn.proposal.report.reviewMode === 'fast'
        ? await workspace.characterState()
        : await characterStates.settleAcceptedProposal({
            workItemId: root,
            chapter,
            proposal: turn.proposal,
            sources: await workspace.characterEvidenceSources()
          })
    if (await sqliteManuscripts.active(root)) {
      await sqliteManuscripts.recordCharacterFactCandidates(
        root,
        chapter,
        turn.proposal.report.characterChanges,
        turnId
      )
      await sqliteManuscripts.settleForeshadowActions(root, chapter, turn.proposal, 'writing_agent', turnId)
    }
    writingAgent.forget(turnId)
    return result
  })
  registerValidatedIpc(ipcMain, 'workspace:list-task-center', decodeNoArgs, () => taskCenter.list())
  registerValidatedIpc(ipcMain, 'workspace:get-context-budget-preferences', decodeNoArgs, () =>
    workspace.contextBudgetPreferences()
  )
  registerValidatedIpc(
    ipcMain,
    'workspace:save-context-budget-preferences',
    decodeContextBudgetPreferencesArgs,
    (data) => workspace.saveContextBudgetPreferences(data)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-context-fact-pack', decodeOptionalChapterIdArgs, (chapterId) =>
    workspace.contextFactPack(chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-prompt-profile', decodeNoArgs, () => workspace.promptProfile())
  registerValidatedIpc(ipcMain, 'workspace:recover-damaged-prompt-profile', decodeNoArgs, () =>
    workspace.recoverDamagedPromptProfile()
  )
  registerValidatedIpc(ipcMain, 'workspace:save-prompt-override', decodePromptOverrideArgs, (input) =>
    workspace.savePromptOverride(input)
  )
  registerValidatedIpc(ipcMain, 'workspace:reset-prompt-override', decodePromptTaskArgs, (task) =>
    workspace.resetPromptOverride(task)
  )
}
