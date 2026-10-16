import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { projectDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { createTaskContractSnapshot } from '../../assistant/domain/task-template-contract'
import { decodeCreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { decodePlanningPackageArgs } from '../../../../contracts/planning/ipc'
import type { PlanningJob } from '../../../../contracts/index'
import type { PlanningRecovery } from './planning-draft-service'

export type PlanningRecoveryRecord = { version: 1; storage: 'sqlite' | 'file'; identity: string; operationId: string; parentId?: string; saveOnly?: boolean; baseProposalHash: string; job: PlanningJob; recovery: PlanningRecovery }
const type = 'automatic_planning'
export const planningHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bad = () => new AppError('INVALID_PROJECT_STATE', '谋篇恢复记录损坏或版本不支持，原记录已保留，请重新发起。', { recoverable: true })
const idPattern = /^[a-zA-Z0-9_-]{1,120}$/
function decode(text: string): PlanningRecoveryRecord {
  try { return decodeRecord(text) } catch { throw bad() }
}
function decodeRecord(text: string): PlanningRecoveryRecord {
  if (text.length > 5_000_000) throw bad()
  const envelope = JSON.parse(text), value = envelope.record as PlanningRecoveryRecord
  if (!value || envelope.hash !== planningHash(value) || value.version !== 1 || !['sqlite', 'file'].includes(value.storage)
    || !idPattern.test(value.job?.id) || typeof value.job.workItemId !== 'string' || !idPattern.test(value.operationId)
    || !['running', 'completed', 'failed', 'cancelled'].includes(value.job.status)
    || !['blueprint', 'totalOutline', 'volumePlan'].includes(value.job.stage)
    || !/^[a-f0-9]{64}$/.test(value.identity) || !/^[a-f0-9]{64}$/.test(value.baseProposalHash)
    || value.recovery?.version !== 1 || !value.recovery.stages || typeof value.recovery.stages !== 'object') throw bad()
  if (typeof value.job.startedAt !== 'string' || !Number.isFinite(Date.parse(value.job.startedAt))
    || !value.job.progress || value.job.progress.total !== 3 || !Number.isInteger(value.job.progress.completed)
    || value.job.progress.completed < 0 || value.job.progress.completed > 3
    || typeof value.job.progress.message !== 'string' || value.job.progress.message.length > 1000
    || (value.parentId !== undefined && !idPattern.test(value.parentId))) throw bad()
  for (const hash of [value.recovery.sourceHash, value.recovery.inputHash]) if (hash !== undefined && !/^[a-f0-9]{64}$/.test(hash)) throw bad()
  if (value.recovery.repairAttempts !== undefined && ![0, 1, 2, 3].includes(value.recovery.repairAttempts)) throw bad()
  if (value.recovery.proposal) {
    decodePlanningPackageArgs([value.recovery.proposal])
    if (value.recovery.proposal.workItemId !== value.job.workItemId) throw bad()
  }
  if (value.recovery.policy) decodeCreativePolicySnapshot(value.recovery.policy)
  for (const [key, s] of Object.entries(value.recovery.stages)) {
    if (!['blueprint', 'totalOutline', 'volumePlan'].includes(key) || !s || s.version !== 1
      || !['generation', 'review', 'revision', 'blocked', 'complete'].includes(s.phase) || ![0, 1].includes(s.revisions)
      || typeof s.original !== 'string' || typeof s.last !== 'string' || s.original.length > 1_000_000 || s.last.length > 1_000_000 || !Array.isArray(s.reports)
      || s.reports.length > 3 || s.reports.some(items => !Array.isArray(items) || items.length > 30 || items.some(issue => !issue || typeof issue.needsAuthor !== 'boolean' || ['category', 'quote', 'parentQuote', 'reason'].some(key => typeof (issue as unknown as Record<string, unknown>)[key] !== 'string')))) throw bad()
  }
  return value
}

/** One authority per run. Legacy books use contained JSON without a formal-storage migration. */
export class PlanningRecoveryStore {
  constructor(private readonly projects: { currentPath(): Promise<string> }, private readonly databases: WorkspaceDatabaseFactory,
    private readonly writes = new WorkspaceWriteCoordinator()) {}
  async identity(storage: 'sqlite' | 'file'): Promise<string> {
    const root = await this.projects.currentPath(), info = await stat(root)
    const db = storage === 'sqlite' ? await stat(await projectExistingPath(root, join(root, '.webnovel/workspace.sqlite'))) : undefined
    return planningHash([root, info.dev, info.ino, info.birthtimeMs, db && [db.dev, db.ino, db.birthtimeMs]])
  }
  async backend(): Promise<'sqlite' | 'file'> {
    const db = await this.databases.openExisting(await this.projects.currentPath())
    try { return db ? 'sqlite' : 'file' } finally { db?.close() }
  }
  async save(record: PlanningRecoveryRecord): Promise<void> {
    const root = await this.projects.currentPath()
    return this.writes.run(root, async () => {
      if (record.identity !== await this.identity(record.storage)) throw new AppError('CONFLICT', '谋篇任务的作品存储已变化，未继续保存。', { recoverable: true })
      const text = JSON.stringify({ record, hash: planningHash(record) })
      decode(text)
      if (record.storage === 'file') {
        const file = await projectTargetPath(root, join(root, '.webnovel/planning-recovery', `${record.job.id}.json`))
        await writeJson(file, JSON.parse(text), async () => { await projectTargetPath(root, file); if (record.identity !== await this.identity(record.storage)) throw bad() })
        return
      }
      const db = await this.databases.openExisting(root)
      if (!db) throw bad()
      try {
        let task = db.taskRun(record.job.id)
        if (!task) task = db.createTaskRun({ id: record.job.id, taskType: type, idempotencyKey: record.operationId,
          parentTaskRunId: record.parentId, taskContract: createTaskContractSnapshot(type), checkpointJson: '{}' })
        if (task.taskType !== type || task.id !== record.job.id) throw bad()
        if (task.status === 'queued') task = db.transitionTaskRun({ id: task.id, status: 'running' })
        const artifactType = `${type}:${randomUUID()}`
        db.createGenerationArtifact({ id: randomUUID(), taskRunId: task.id, artifactType, status: 'invalid', content: text,
          contentHash: createHash('sha256').update(text).digest('hex'), schemaValid: false, metadataJson: '{}' })
        const status = record.job.status === 'completed' ? 'succeeded' : record.job.status
        db.transitionTaskRun({ id: task.id, status, checkpointJson: JSON.stringify({ artifactType }), errorCode: record.job.error?.code ?? null, errorMessage: record.job.error?.message ?? null })
      } finally { db.close() }
    })
  }
  async list(): Promise<PlanningRecoveryRecord[]> {
    const root = await this.projects.currentPath(), records: PlanningRecoveryRecord[] = []
    const db = await this.databases.openExisting(root)
    try {
      for (const task of db?.recentTaskRuns(type, undefined, 50) ?? []) {
        const checkpoint = JSON.parse(task.checkpointJson)
        if (!checkpoint.artifactType) continue
        const artifact = db!.generationArtifactForTask(task.id, checkpoint.artifactType)
        if (!artifact) throw bad()
        const record = decode(artifact.content)
        if (record.job.id !== task.id || record.storage !== 'sqlite') throw bad()
        records.push(record)
      }
    } finally { db?.close() }
    const directory = await projectDirectory(root, join(root, '.webnovel/planning-recovery'))
    let files: string[] = []
    try { files = await readdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for (const name of files.filter(n => /^[a-zA-Z0-9_-]{1,120}\.json$/.test(n))) {
      const file = await projectExistingPath(root, join(directory, name))
      if ((await stat(file)).size > 12_000_000) throw bad()
      const record = decode(await readFile(file, 'utf8'))
      if (record.storage !== 'file' || `${record.job.id}.json` !== name || records.some(r => r.job.id === record.job.id)) throw bad()
      records.push(record)
    }
    return records.sort((a, b) => b.job.startedAt.localeCompare(a.job.startedAt))
  }
}
