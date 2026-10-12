import { createHash, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertJson } from '@lanjian/writing-plugin-contracts'
import { FactExtractionService, decodeFactExtractionRecovery, type FactExtractionPrepared, type FactExtractionRecovery } from '../application/fact-extraction-service'
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
    operation: (database: import('../../../core/ports/workspace-database').WorkspaceDatabasePort) => T | Promise<T>,
    beforeWrite?: () => Promise<void>
  ) => Promise<T>
  projects: ProjectService
}

export function createFactExtractionRuntime(dependencies: Dependencies) {
  const { sqliteManuscripts, databases, factExtraction, withWorkspaceDatabaseWrite, projects } = dependencies
  const prepared = new Map<string, FactExtractionPrepared>()
  const key = (root: string, id: string) => JSON.stringify([resolve(root), id])
  const bookIdentity = async (root: string) => {
    if (resolve(await projects.currentPath()) !== resolve(root)) throw stale()
    const physical = await stat(join(root, '.webnovel', 'workspace.sqlite'), { bigint: true })
    return hash(JSON.stringify([resolve(root), projects.executionIdentity?.physicalIdentity ?? null, String(physical.dev), String(physical.ino), String(physical.birthtimeNs)]))
  }
  const assertPhysical = async (root: string, original?: string) => { if (original && await bookIdentity(root) !== original) throw stale() }
  const readTask = async (root: string, id: string) => {
    const db = await databases.openDocumentReviewReadOnly(root)
    if (!db) throw stale()
    try { return db.taskRun(id) } finally { db.close() }
  }
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
        const run = prepared.get(key(workItemId, taskId))
        if (!run || run.chapter.id !== chapterId) throw stale()
        const chapter = run.chapter, bodyVersionId = chapter.bodyVersionId!
        const guard = () => factExtraction.assertPrepared(run, signal)
        let changes
        try {
          changes = await factExtraction.extract(chapter, signal, run)
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
              }), guard
            )
          }
          throw error
        }
        return sqliteManuscripts.recordCharacterFactCandidates(workItemId, chapter, changes, taskId, taskId, guard)
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
        const parent = parentTaskId ? await readTask(workItemId, parentTaskId) : null
        if (parentTaskId && (!parent || parent.taskType !== 'fact_extraction' || parent.legacyChapterId !== chapterId)) throw stale()
        const previous = parent ? checkpoint(parent.checkpointJson) : undefined
        if (parent && (!previous?.recovery || previous.workItemId !== workItemId || previous.chapterId !== chapterId || parent.baseBodyVersionId !== previous.bodyVersionId)) throw stale()
        // Pin the real policy/model before asynchronous source and formal reads.
        const captured = await factExtraction.capture(previous?.recovery)
        const chapter = await sqliteManuscripts.factExtractionSource(workItemId, chapterId, previous?.bodyVersionId)
        if (parent && parent.contentHash !== hash(chapter.content)) throw stale()
        const physical = await bookIdentity(workItemId), chapterHash = hash(JSON.stringify(chapter))
        const assertSource = async () => {
          const source = await sqliteManuscripts.factExtractionSource(workItemId, chapterId, chapter.bodyVersionId)
          if (hash(JSON.stringify(source)) !== chapterHash) throw stale()
          await assertPhysical(workItemId, physical)
        }
        const run = await factExtraction.prepare(chapter, physical, assertSource, captured), recovery = factExtraction.snapshotForRecovery(run)
        const saved = { version: 1, workItemId, chapterId, bodyVersionId: chapter.bodyVersionId!, phase: 'queued', recovery }
        assertJson(saved, 384 * 1024)
        const job = await withWorkspaceDatabaseWrite(workItemId, (database) => {
          if (database.chapterPlanning(chapterId).confirmedBodyVersionId !== chapter.bodyVersionId) throw stale()
          database.createTaskRun({
            id,
            legacyChapterId: chapterId,
            taskType: 'fact_extraction',
            taskContract: parent?.taskContract ?? createTaskContractSnapshot('fact_extraction'),
            idempotencyKey: id,
            ...(parentTaskId ? { parentTaskRunId: parentTaskId } : {}),
            ...(parent ? { attempt: parent.attempt + 1 } : {}),
            baseBodyVersionId: chapter.bodyVersionId!,
            contentHash: createHash('sha256').update(chapter.content).digest('hex'),
            checkpointJson: JSON.stringify(saved)
          })
          const preparing = database.transitionTaskRun({ id, status: 'preparing' })
          return toFactExtractionJob(database.transitionTaskRun({ id: preparing.id, status: 'running' }), database)
        }, () => factExtraction.assertPrepared(run))
        prepared.set(key(workItemId, id), run)
        return job
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
        const run = prepared.get(key(workItemId, id)), task = await readTask(workItemId, id)
        if (!task || task.taskType !== 'fact_extraction') throw stale()
        const original = checkpoint(task.checkpointJson).recovery?.bookIdentity
        const guard = async () => {
          await assertPhysical(workItemId, original)
          if (status === 'completed') { if (!run) throw stale(); await factExtraction.assertPrepared(run) }
        }
        const result = await withWorkspaceDatabaseWrite(workItemId, (database) => {
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
        }, guard)
        if (status !== 'running') prepared.delete(key(workItemId, id))
        return result
      }
    }
  )
  return { factExtractionJobs }
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const stale = () => new AppError('CONFLICT', '原事实提取依据或方法版本无法继续，请保留历史并从当前章节重新发起。', { recoverable: true })
function checkpoint(json: string): { version: 1; workItemId: string; chapterId: number; bodyVersionId: string; phase: string; recovery?: FactExtractionRecovery } {
  try {
    if (Buffer.byteLength(json) > 384 * 1024) throw stale()
    const value = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['version', 'workItemId', 'chapterId', 'bodyVersionId', 'phase', 'recovery'].includes(k))
      || value.version !== 1 || typeof value.workItemId !== 'string' || !value.workItemId || !Number.isSafeInteger(value.chapterId) || value.chapterId < 1
      || typeof value.bodyVersionId !== 'string' || !value.bodyVersionId || value.phase !== 'queued') throw stale()
    if (value.recovery !== undefined) value.recovery = decodeFactExtractionRecovery(value.recovery)
    return value
  } catch { throw stale() }
}

function checkpointWorkItemId(value: string): string {
  try {
    const parsed = JSON.parse(value) as { workItemId?: unknown }
    return typeof parsed.workItemId === 'string' ? parsed.workItemId : ''
  } catch {
    return ''
  }
}
