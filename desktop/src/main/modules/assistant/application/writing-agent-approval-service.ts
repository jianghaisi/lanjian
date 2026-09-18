import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import type {
  Chapter,
  WritingAgentArtifactApplicationInput,
  WritingAgentArtifactApplicationResult,
} from '../../../../contracts/index'
import { buildWritingAgentApplication } from '../../../../contracts/assistant/writing-application'
import { rebaseWritingAgentText } from '../../../../contracts/assistant/writing-rebase'
import type { DocumentService } from '../../manuscript/application/document-service'
import type { ProjectService } from '../../library/application/project-service'
import type { WritingAgentTaskService } from './writing-agent-task-service'

type ProjectPort = Pick<ProjectService, 'currentPath' | 'currentSummary'>
type DocumentPort = Pick<DocumentService, 'chapter'>
type TaskPort = Pick<WritingAgentTaskService, 'status'>

/**
 * Author Approval Gate for prose. Candidate interpretation happens in the main
 * process, then Artifact status and the append-only body version commit in one
 * SQLite transaction. Markdown remains a post-commit readable mirror.
 */
export class WritingAgentApprovalService {
  constructor(
    private readonly projects: ProjectPort,
    private readonly documents: DocumentPort,
    private readonly tasks: TaskPort,
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly retryMirrors: (workItemPath: string) => Promise<unknown>,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async apply(input: WritingAgentArtifactApplicationInput): Promise<WritingAgentArtifactApplicationResult> {
    const [summary, workItemPath, task] = await Promise.all([
      this.projects.currentSummary(),
      this.projects.currentPath(),
      this.tasks.status(input.taskId)
    ])
    if (task.workItemId !== summary.id || resolve(summary.path) !== resolve(workItemPath)) {
      throw new AppError('CONFLICT', '写作候选不属于当前作品。', { recoverable: true })
    }
    if (task.turn?.candidate && task.turn.candidate.baseDraftFingerprint !== createHash('sha256').update(task.baseDraft).digest('hex')) {
      throw new AppError('CONFLICT', '候选与发起时草稿不一致，未修改正文。', { recoverable: true })
    }
    const application = buildWritingAgentApplication(task, input)
    const stored = await this.writes.run(workItemPath, async () => {
      const database = await this.databases.openExisting(workItemPath)
      if (!database || database.storageMode() !== 'sqlite') {
        throw new AppError('FEATURE_UNAVAILABLE', '统一候选结算需要 SQLite 正式存储；手写和普通保存不受影响。', { recoverable: true })
      }
      try {
        if (resolve(await this.projects.currentPath()) !== resolve(workItemPath)) {
          throw new AppError('CONFLICT', '作品已切换，未采用候选。', { recoverable: true })
        }
        const current = database.formalChapters().find(item => item.legacyChapterId === task.chapterId)
        if (!current || current.revision !== input.expectedRevision) {
          throw new AppError('CONFLICT', '正文在核对后又有变化，请重新合并；候选仍然保留。', { recoverable: true })
        }
        let content = application.content
        if (current.content !== task.baseDraft) {
          if (!input.rebase) throw new AppError('CONFLICT', '你已继续写作，请先核对合并；候选仍可使用。', { recoverable: true })
          const merge = rebaseWritingAgentText(task.baseDraft, current.content, content, input.rebase.choices)
          if (merge.unresolved) throw new AppError('CONFLICT', '还有重叠修改未选择，正文和候选均未改变。', { recoverable: true })
          content = merge.content
        } else if (input.rebase && Object.keys(input.rebase.choices).length) {
          throw new AppError('CONFLICT', '合并依据已经变化，请重新核对。', { recoverable: true })
        }
        return database.applyWritingAgentArtifact({
          taskRunId: task.id,
          artifactId: application.artifactId,
          artifactType: application.artifactType,
          legacyChapterId: task.chapterId,
          title: input.title,
          content,
          expectedRevision: input.expectedRevision,
          metadataJson: JSON.stringify({
            decision: 'applied',
            mode: application.mode,
            partial: application.artifactType === 'writing_agent_stream',
            acceptedChangeIds: input.acceptedChangeIds ?? [],
            formatting: input.formatting,
            ...(input.rebase ? { rebase: input.rebase, rebasedFromRevision: current.revision } : {})
          })
        })
      } finally { database.close() }
    })
    // SQLite is authoritative. A mirror failure is intentionally not allowed to
    // roll back or misreport the already committed body version and Artifact.
    await this.retryMirrors(workItemPath).catch(() => undefined)
    const [chapter, refreshedTask] = await Promise.all([
      this.documents.chapter(task.chapterId),
      this.tasks.status(task.id)
    ])
    if (chapter.bodyVersionId !== stored.chapter.currentVersionId || refreshedTask.artifact?.status !== 'applied' && refreshedTask.partial?.status !== 'applied') {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '写作候选结算后无法核对正式版本。', { recoverable: false })
    }
    return { task: refreshedTask, chapter, insertedVersion: stored.insertedVersion }
  }
}
