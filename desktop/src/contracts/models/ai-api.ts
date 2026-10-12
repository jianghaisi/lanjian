import type { AiConnectionDraft, AiConnectionTestResult, AiSettings, AiSettingsUpdate, AiTask } from './types'
import type { ConsistencyEvaluationJob, ConsistencyEvaluationSummary } from '../review/types'
import type { GenreCatalogItem } from '../worldbuilding/types'
import type {
  WritingAgentArtifactApplicationInput,
  WritingAgentArtifactApplicationResult,
  WritingAgentArtifactDecision,
  WritingAgentContextPreview,
  WritingAgentRequest,
  WritingAgentTask,
  WritingAgentTaskStart,
  WritingAgentTurn
} from '../assistant/types'
import type { CharacterStateView } from '../characters/types'
import type { BookTaskSummary } from '../assistant/book-task-summary'

export type DirectCompletionOperation = 'timeline'

export type DesktopAiApi = {
  backgroundTasks: () => Promise<BookTaskSummary[]>
  getSettings: () => Promise<AiSettings>
  updateSettings: (input: AiSettingsUpdate) => Promise<AiSettings>
  listModels: (draft?: AiConnectionDraft) => Promise<{ models: string[] }>
  testConnection: (draft?: AiConnectionDraft) => Promise<AiConnectionTestResult>
  latestConsistencyEvaluation: () => Promise<ConsistencyEvaluationSummary | null>
  startConsistencyEvaluation: () => Promise<ConsistencyEvaluationJob>
  consistencyEvaluationJob: (jobId: string) => Promise<ConsistencyEvaluationJob>
  cancelConsistencyEvaluation: (jobId: string) => Promise<ConsistencyEvaluationJob>
  genres: () => Promise<{ genres: GenreCatalogItem[] }>
  complete: (instruction: string, draft?: string, task?: AiTask, chapterId?: number, operation?: DirectCompletionOperation) => Promise<{ content: string }>
  runWritingAgent: (input: WritingAgentRequest) => Promise<WritingAgentTurn>
  previewWritingAgentContext: (input: WritingAgentRequest) => Promise<WritingAgentContextPreview>
  startWritingAgent: (input: WritingAgentTaskStart) => Promise<WritingAgentTask>
  writingAgentTask: (taskId: string) => Promise<WritingAgentTask>
  listWritingAgentTasks: (chapterId: number) => Promise<WritingAgentTask[]>
  pauseWritingAgentTask: (taskId: string) => Promise<WritingAgentTask>
  resumeWritingAgentTask: (taskId: string, operationId: string) => Promise<WritingAgentTask>
  cancelWritingAgentTask: (taskId: string) => Promise<WritingAgentTask>
  retryWritingAgentTask: (taskId: string, operationId: string) => Promise<WritingAgentTask>
  dismissWritingAgentTask: (taskId: string) => Promise<WritingAgentTask>
  decideWritingAgentArtifact: (input: WritingAgentArtifactDecision) => Promise<WritingAgentTask>
  applyWritingAgentArtifact: (
    input: WritingAgentArtifactApplicationInput
  ) => Promise<WritingAgentArtifactApplicationResult>
  settleWritingAgent: (turnId: string) => Promise<CharacterStateView>
}
