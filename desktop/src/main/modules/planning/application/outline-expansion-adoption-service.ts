import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort, WorkspaceOutlineChildrenAppendInput } from '../../../core/ports/workspace-database'
import type { OutlineExpansionAdoptionPreview, OutlineExpansionAdoptionResult, OutlineExpansionProposal, OutlineExpansionTaskInput, PlanningOutlineSource } from '../../../../contracts/index'
import { decodeOutlineExpansionArgs } from '../../../../contracts/ipc'
import { parseOutlineExpansion } from './planning-draft-service'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

type Plan = { input: WorkspaceOutlineChildrenAppendInput; fingerprint: string; directory: string; parentTitle: string }
type Pending = { root: string; taskId: string; fingerprint: string; expires: number }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Explicit candidate adoption; preview is read-only and confirmation never invokes AI. */
export class OutlineExpansionAdoptionService {
  private readonly pending = new Map<string, Pending>()
  constructor(
    private readonly projects: { currentPath(): Promise<string> },
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly source: (key: string) => Promise<PlanningOutlineSource | null>,
    private readonly syncMirrors: (root: string) => Promise<{ pending: number; conflicts: number; failed: number }>,
    private readonly now: () => number = Date.now,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  clear(): void { this.pending.clear() }

  async preview(taskId: string): Promise<OutlineExpansionAdoptionPreview> {
    const root = await this.projects.currentPath()
    const plan = await this.plan(root, taskId)
    for (const [key, value] of this.pending) if (value.expires <= this.now()) this.pending.delete(key)
    while (this.pending.size >= 3) this.pending.delete(this.pending.keys().next().value!)
    const token = randomUUID()
    this.pending.set(token, { root, taskId, fingerprint: plan.fingerprint, expires: this.now() + 15 * 60_000 })
    return { token, taskId, parentTitle: plan.parentTitle,
      children: plan.input.children.map(child => ({ key: child.legacyKey, title: child.title, content: child.content })) }
  }

  async adopt(token: string): Promise<OutlineExpansionAdoptionResult> {
    const pending = this.pending.get(token)
    this.pending.delete(token)
    if (!pending || pending.expires <= this.now()) throw this.conflict('预览已失效，请重新预览后采用。')
    await this.assertCurrent(pending.root)
    const plan = await this.plan(pending.root, pending.taskId)
    if (plan.fingerprint !== pending.fingerprint) throw this.conflict('大纲或候选已经变化，请重新预览后采用。')
    const keys = await this.withDatabaseWrite(pending.root, db => {
      // Recheck the directory after async source reads and database acquisition.
      if (this.directoryFingerprint(db) !== plan.directory) throw this.conflict('目录已经变化，请重新预览后采用。')
      return db.appendFormalOutlineChildren(plan.input).map(node => node.legacyKey)
    })
    // SQLite is already committed. File failure is not an adoption failure or a reason to duplicate nodes.
    let mirrorPending = true
    try { const state = await this.syncMirrors(pending.root); mirrorPending = state.pending + state.conflicts + state.failed > 0 } catch { /* recover through Project Data mirror retry */ }
    return { keys, mirrorPending }
  }

  private async plan(root: string, taskId: string): Promise<Plan> {
    const record = await this.withDatabase(root, db => {
      const task = db.taskRun(taskId)
      const artifact = db.generationArtifactForTask(taskId, 'outline_expansion')
      if (!task || task.taskType !== 'outline_expansion' || task.status !== 'succeeded' || !artifact?.schemaValid || artifact.status !== 'complete') {
        throw this.conflict('这条候选不可采用或已经采用，请重新读取。')
      }
      const checkpoint = JSON.parse(task.checkpointJson) as { methodVersion?: 'story-v1'; request: OutlineExpansionTaskInput; source: PlanningOutlineSource }
      decodeOutlineExpansionArgs([checkpoint.request])
      const proposal = JSON.parse(artifact.content) as OutlineExpansionProposal
      const children = parseOutlineExpansion(JSON.stringify({ children: proposal.children }), checkpoint.request.count, checkpoint.methodVersion === 'story-v1' && proposal.methodVersion === 'story-v1')
      if (hash(proposal.source) !== hash(checkpoint.source) || checkpoint.request.parentKey !== checkpoint.source.key
        || checkpoint.request.expectedRevision !== checkpoint.source.revision) throw this.conflict('候选来源不一致，未执行采用。')
      return { artifact, proposal: { ...proposal, children }, checkpoint }
    })
    const current = await this.source(record.checkpoint.source.key)
    if (!current || hash(current) !== hash(record.checkpoint.source)) throw this.conflict('父稿或作品已经变化，请重新生成候选。')
    return this.withDatabase(root, db => {
      const nodes = db.formalOutlines()
      const parent = nodes.find(node => node.legacyKey === current.key)
      if (!parent || parent.revision !== current.revision) throw this.conflict('父稿已经变化，请重新预览。')
      const kind = parent.nodeType === 'summary' ? 'volume' : parent.nodeType === 'volume' ? 'stage' : parent.nodeType === 'stage' ? 'chapter' : null
      if (!kind || record.proposal.childType !== kind) throw this.conflict('候选层级与父稿不一致。')
      const reserved = db.reservedOutlineKeys().filter(key => key.startsWith(`${kind}-`)).map(key => Number(key.split('-')[1]))
      // A future chapter outline must not silently attach itself to an existing manuscript identity.
      if (kind === 'chapter') reserved.push(...db.formalChapterIds())
      const start = Math.max(0, ...reserved, ...nodes.filter(node => node.nodeType === kind).map(node => node.seq)) + 1
      if (!Number.isSafeInteger(start + record.proposal.children.length)) throw this.conflict('目录编号超出范围。')
      const input: WorkspaceOutlineChildrenAppendInput = {
        parentLegacyKey: current.key, expectedParentRevision: current.revision,
        expectedChildKeys: nodes.filter(node => node.parentLegacyKey === current.key).map(node => node.legacyKey),
        adoption: { taskId, artifactId: record.artifact.id, artifactHash: record.artifact.contentHash },
        children: record.proposal.children.map((child, index) => ({
          legacyKey: `${kind}-${start + index}`, parentLegacyKey: current.key, nodeType: kind, seq: start + index,
          title: child.title, content: this.compile(child), planning: { metadataJson: JSON.stringify({ events: child.events }) }
        }))
      }
      const directory = this.directoryFingerprint(db)
      return { input, parentTitle: parent.title, directory, fingerprint: hash({ directory, input }) }
    })
  }

  private compile(child: OutlineExpansionProposal['children'][number]): string {
    return `# ${child.title}\n\n${child.content.trim()}\n`
  }
  private directoryFingerprint(db: WorkspaceDatabasePort): string {
    return hash({ nodes: db.formalOutlines().map(({ mirrorStatus, ...node }) => node), reserved: db.reservedOutlineKeys(), chapters: db.formalChapterIds() })
  }
  private async withDatabase<T>(root: string, action: (db: WorkspaceDatabasePort) => T): Promise<T> {
    const db = await this.databases.openExisting(root)
    if (!db) throw this.conflict('请先启用本书 SQLite 正式大纲。')
    try { await this.assertCurrent(root); return action(db) } finally { db.close() }
  }
  private async withDatabaseWrite<T>(root: string, action: (db: WorkspaceDatabasePort) => T): Promise<T> {
    return this.writes.run(root, () => this.withDatabase(root, action))
  }
  private async assertCurrent(root: string): Promise<void> {
    if (resolve(root) !== resolve(await this.projects.currentPath())) throw this.conflict('作品已经切换，本次未采用。')
  }
  private conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
}
