import { createHash, randomUUID } from 'node:crypto'
import { FactExtractionService } from '../application/fact-extraction-service'
import { FactExtractionJobService } from '../application/fact-extraction-job-service'
import { ProjectService } from '../../library/application/project-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import { StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import { AppError } from '../../../core/errors/app-error'
import { SqliteWorkspaceDatabaseFactory } from '../../../platform/storage/workspace-database'
import { createTaskContractSnapshot } from '../../assistant/domain/task-template-contract'

interface Dependencies {
  sqliteManuscripts: SqliteManuscriptService
  databases: SqliteWorkspaceDatabaseFactory
  factExtraction: FactExtractionService
  withWorkspaceDatabaseWrite: <T>(
    workItemId: string,
    operation: (database: import('../../../core/ports/workspace-database').WorkspaceDatabasePort) => T | Promise<T>
  ) => Promise<T>
  projects: ProjectService
}

export function createFactExtractionRuntime(dependencies: Dependencies) {
  const { sqliteManuscripts, databases, factExtraction, withWorkspaceDatabaseWrite, projects } = dependencies
  const toFactExtractionJob = (
    task: import('../../../core/ports/workspace-database').WorkspaceTaskRunRecord,
    database?: import('../../../core/ports/workspace-database').WorkspaceDatabasePort
  ): import('../../../../contracts/index').FactExtractionJob => ({
    id: task.id,
    workItemId: checkpointWorkItemId(task.checkpointJson),
    chapterId: task.legacyChapterId ?? 0,
    status:
      task.status === 'succeeded'
        ? 'completed'
        : task.status === 'interrupted'
          ? 'interrupted'
          : task.status === 'cancelled'
            ? 'cancelled'
            : task.status === 'failed'
              ? 'failed'
              : 'running',
    startedAt: task.startedAt || task.createdAt,
    attempt: task.attempt,
    ...(task.parentTaskRunId ? { parentTaskId: task.parentTaskRunId } : {}),
    ...(task.endedAt ? { completedAt: task.endedAt } : {}),
    ...(task.errorCode ? { error: { code: task.errorCode, message: task.errorMessage || '变化提炼未完成。' } } : {}),
    ...(() => {
      const artifact = database?.generationArtifactForTask(task.id, 'fact_extraction')
      return artifact && !artifact.schemaValid ? { rawResult: artifact.content } : {}
    })()
  })
  const factExtractionJobs = new FactExtractionJobService(
    {
      extract: async (workItemId, chapterId, signal, taskId) => {
        if (!(await sqliteManuscripts.active(workItemId)))
          throw new AppError('CONFLICT', '请先切换为 SQLite 正式数据后再提炼事实。', { recoverable: true })
        const database = await databases.openExisting(workItemId)
        if (!database) throw new AppError('FEATURE_UNAVAILABLE', '变化提炼任务数据库不可用。', { recoverable: true })
        let bodyVersionId = ''
        try {
          const task = database.taskRun(taskId)
          bodyVersionId = task?.baseBodyVersionId ?? ''
        } finally {
          database.close()
        }
        if (!bodyVersionId) throw new AppError('CONFLICT', '变化提炼任务没有绑定确认正文版本。', { recoverable: true })
        const chapter = await sqliteManuscripts.bodyVersion(workItemId, chapterId, bodyVersionId)
        let changes
        try {
          changes = await factExtraction.extract(chapter, signal)
        } catch (error) {
          if (error instanceof StructuredResponseFailure && !signal.aborted) {
            await withWorkspaceDatabaseWrite(workItemId, (database) =>
              database.createGenerationArtifact({
                id: randomUUID(),
                taskRunId: taskId,
                artifactType: 'fact_extraction',
                status: 'invalid',
                content: error.originalContent,
                contentHash: createHash('sha256').update(error.originalContent).digest('hex'),
                schemaValid: false,
                metadataJson: JSON.stringify({
                  chapterId,
                  bodyVersionId,
                  repairAttempts: error.repairAttempts,
                  failure: 'structured-response-invalid'
                })
              })
            )
          }
          throw error
        }
        return sqliteManuscripts.recordCharacterFactCandidates(workItemId, chapter, changes, taskId, taskId)
      }
    },
    {
      initialize: async (workItemId) => {
        await withWorkspaceDatabaseWrite(workItemId, (database) => {
          for (const task of database.recentTaskRuns('fact_extraction', undefined, 100)) {
            if (!['queued', 'preparing', 'running', 'streaming'].includes(task.status)) continue
            database.transitionTaskRun({
              id: task.id,
              status: 'interrupted',
              errorCode: 'APP_RESTARTED',
              errorMessage: '应用重启前的变化提炼已安全中断，可重新发起。'
            })
          }
        })
      },
      create: async ({ id, workItemId, chapterId, parentTaskId }) => {
        if (!(await sqliteManuscripts.active(workItemId)))
          throw new AppError('CONFLICT', '请先切换为 SQLite 正式数据后再提炼事实。', { recoverable: true })
        return withWorkspaceDatabaseWrite(workItemId, (database) => {
          const planning = database.chapterPlanning(chapterId)
          if (!planning.confirmedBodyVersionId)
            throw new AppError('CONFLICT', '请先确认本章正文，再提炼重要变化。', { recoverable: true })
          const chapter = database.formalBodyVersion(chapterId, planning.confirmedBodyVersionId)
          const parent = parentTaskId ? database.taskRun(parentTaskId) : null
          if (
            parentTaskId &&
            (!parent || parent.taskType !== 'fact_extraction' || parent.legacyChapterId !== chapterId)
          ) {
            throw new AppError('CONFLICT', '变化提炼的来源任务不一致，请重新打开本章。', { recoverable: true })
          }
          database.createTaskRun({
            id,
            legacyChapterId: chapterId,
            taskType: 'fact_extraction',
            taskContract: parent?.taskContract ?? createTaskContractSnapshot('fact_extraction'),
            idempotencyKey: id,
            ...(parentTaskId ? { parentTaskRunId: parentTaskId } : {}),
            ...(parent ? { attempt: parent.attempt + 1 } : {}),
            baseBodyVersionId: planning.confirmedBodyVersionId,
            contentHash: createHash('sha256').update(chapter.content).digest('hex'),
            checkpointJson: JSON.stringify({
              version: 1,
              workItemId,
              chapterId,
              bodyVersionId: chapter.currentVersionId,
              phase: 'queued'
            })
          })
          const preparing = database.transitionTaskRun({ id, status: 'preparing' })
          return toFactExtractionJob(database.transitionTaskRun({ id: preparing.id, status: 'running' }), database)
        })
      },
      read: async (workItemId, id) => {
        const database = await databases.openExisting(workItemId)
        if (!database) return null
        try {
          const task = database.taskRun(id)
          return task?.taskType === 'fact_extraction' ? toFactExtractionJob(task, database) : null
        } finally {
          database.close()
        }
      },
      find: async (id) => {
        const database = await databases.openExisting(await projects.currentPath())
        if (!database) return null
        try {
          const task = database.taskRun(id)
          return task?.taskType === 'fact_extraction' ? toFactExtractionJob(task, database) : null
        } finally {
          database.close()
        }
      },
      list: async (workItemId, chapterId) => {
        const database = await databases.openExisting(workItemId)
        if (!database) return []
        try {
          return database
            .recentTaskRuns('fact_extraction', chapterId, 50)
            .map((task) => toFactExtractionJob(task, database))
        } finally {
          database.close()
        }
      },
      transition: async ({ workItemId, id, status, error }) => {
        return withWorkspaceDatabaseWrite(workItemId, (database) => {
          const current = database.taskRun(id)
          if (!current || current.taskType !== 'fact_extraction')
            throw new AppError('NOT_FOUND', '变化提炼任务不存在。', { recoverable: true })
          const target = status === 'completed' ? 'succeeded' : status
          return toFactExtractionJob(
            database.transitionTaskRun({
              id,
              status: target,
              ...(error ? { errorCode: error.code, errorMessage: error.message } : {})
            }),
            database
          )
        })
      }
    }
  )
  return { factExtractionJobs }
}

function checkpointWorkItemId(value: string): string {
  try {
    const parsed = JSON.parse(value) as { workItemId?: unknown }
    return typeof parsed.workItemId === 'string' ? parsed.workItemId : ''
  } catch {
    return ''
  }
}
