import type { RecoverReviewedDraftInput, OutlineVersionInput } from '../../../../contracts/document-review/api'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ProjectService } from '../../library/application/project-service'
import type { WritingAgentTaskService } from '../../assistant/application/writing-agent-task-service'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort } from '../../../core/ports/workspace-database'
import type { ReviewReadPort } from '../domain/review-storage'
import type { DocumentLocator, DocumentRef } from '../../../../contracts/document-review/types'
import type { AcknowledgeDecisionInput, DiscardDecisionInput, OpenWritingReviewInput, PrepareDecisionInput, SaveReviewedDraftInput, SyncReviewDraftInput } from '../../../../contracts/document-review/api'
import { buildWritingAgentReviewCandidate } from '../../../../contracts/assistant/writing-application'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { AppError } from '../../../core/errors/app-error'
import type { AnnotationChangeInput, AnnotationCreateInput, AnnotationListInput, AnnotationReanchorInput, AnnotationUpdateInput } from '../../../../contracts/document-review/annotations'
import { annotationRevisionType, type AnnotationRevisionCheckpoint } from '../domain/annotation-revision'

/** Named application operations bind every request to a captured book. */
export class DocumentReviewService {
  constructor(private readonly projects: Pick<ProjectService, 'currentSummary' | 'currentPath'>,
    private readonly tasks: Pick<WritingAgentTaskService, 'status'>, private readonly databases: WorkspaceDatabaseFactory,
    private readonly retryMirrors: (path: string) => Promise<unknown>, private readonly writes = new WorkspaceWriteCoordinator(),
    private readonly validateContext?: (document: DocumentRef, blockId?: string) => Promise<void>) {}

  readSnapshot(target: DocumentLocator | DocumentRef) { return this.read(target.workItemId, db => db.documentReviewSnapshot(target)) }
  outlineHistory(document: DocumentRef) { return this.read(document.workItemId, db => db.outlineHistory(document)) }
  outlineVersion(input: OutlineVersionInput) { return this.read(input.document.workItemId, db => db.outlineVersion(input)) }
  listReviews(document: DocumentRef) { return this.read(document.workItemId, db => db.documentReviews(document)) }
  recoverDraft(document: DocumentRef) { return this.read(document.workItemId, db => db.reviewDraft(document)) }
  recoveryHistory(document: DocumentRef) { return this.read(document.workItemId, db => db.reviewRecoveryHistory(document)) }
  useLatestDraft(input: RecoverReviewedDraftInput) { return this.write(input.document.workItemId, db => db.useLatestReviewDraft(input)) }
  listAnnotations(input: AnnotationListInput) { return this.read(input.document.workItemId, db => db.documentAnnotations(input)) }
  createAnnotation(input: AnnotationCreateInput) { return this.write(input.document.workItemId, db => db.createDocumentAnnotation(input)) }
  changeAnnotation(action: 'update' | 'remove' | 'resolve' | 'reopen' | 'reanchor', input: AnnotationChangeInput | AnnotationUpdateInput | AnnotationReanchorInput) {
    return this.write(input.document.workItemId, db => db.changeDocumentAnnotation(action, input))
  }

  async openReview(input: OpenWritingReviewInput) {
    const annotationReview = await this.write(input.document.workItemId, db => {
      const task = db.taskRun(input.taskId)
      if (task?.taskType !== annotationRevisionType) return null
      const c = JSON.parse(task.checkpointJson) as AnnotationRevisionCheckpoint, artifact = db.generationArtifactForTask(task.id, annotationRevisionType)
      if (c.target.ref.documentId !== input.document.documentId || !artifact?.schemaValid) throw conflict('批注候选尚未完成或不属于当前文档。')
      const payload = JSON.parse(artifact.content) as { candidate: string }
      return db.openDocumentReview({ snapshot: c.target, baseDraft: c.draft, candidate: payload.candidate, source: { taskId: task.id, artifactId: artifact.id, artifactType: artifact.artifactType, artifactHash: artifact.contentHash } })
    })
    if (annotationReview) return annotationReview
    const task = await this.tasks.status(input.taskId)
    if (task.workItemId !== input.document.workItemId || input.document.kind !== 'body') throw conflict('写作候选不属于这个文档。')
    const candidate = buildWritingAgentReviewCandidate(task, input.allowFailedReview)
    if (task.turn!.candidate!.baseDraftFingerprint !== createHash('sha256').update(task.baseDraft).digest('hex')) throw conflict('候选的发起草稿无法核对。')
    return this.write(input.document.workItemId, db => {
      const current = db.documentReviewSnapshot(input.document)
      if (current.legacyId !== task.chapterId) throw conflict('写作候选对应另一章。')
      const stored = db.taskRun(task.id), artifact = db.generationArtifactForTask(task.id, 'writing_agent_turn')
      if (!stored?.baseBodyVersionId || !artifact || artifact.id !== task.artifact!.id) throw conflict('候选来源已经变化。')
      const base = db.formalBodyVersion(task.chapterId, stored.baseBodyVersionId)
      return db.openDocumentReview({ snapshot: { ...current, content: base.content, hash: base.contentHash, versionId: base.currentVersionId, revision: base.revision },
        baseDraft: task.baseDraft, candidate, source: { taskId: task.id, artifactId: artifact.id, artifactHash: artifact.contentHash, artifactType: artifact.artifactType } })
    })
  }
  syncDraft(input: SyncReviewDraftInput) { return this.write(input.document.workItemId, db => db.syncReviewDraft(input)) }
  async prepareDecision(input: PrepareDecisionInput) { await this.validateContext?.(input.document, input.blockId); return this.write(input.document.workItemId, db => db.prepareReviewDecision(input)) }
  acknowledgeStage(input: AcknowledgeDecisionInput) { return this.write(input.document.workItemId, db => db.acknowledgeReviewStage(input)) }
  discardDecision(input: DiscardDecisionInput) { return this.write(input.document.workItemId, db => db.discardReviewDecision(input)) }
  async saveReviewedDraft(input: SaveReviewedDraftInput) {
    const path = await this.capture(input.document.workItemId)
    await this.validateContext?.(input.document)
    const result = await this.write(input.document.workItemId, db => db.saveReviewedDraft(input))
    await this.retryMirrors(path).catch(() => undefined)
    return result
  }

  private async capture(workItemId: string): Promise<string> {
    const summary = await this.projects.currentSummary({ includeManuscript: false })
    const path = await this.projects.currentPath()
    if (summary.id !== workItemId || resolve(summary.path) !== resolve(path)) throw conflict('作品已切换，请回到原作品继续处理。')
    return path
  }
  private async read<T>(workItemId: string, operation: (db: ReviewReadPort) => T): Promise<T> {
    const path = await this.capture(workItemId)
    const db = await this.databases.openDocumentReviewReadOnly?.(path)
    if (!db) throw new AppError('FEATURE_UNAVAILABLE', '当前作品尚未启用修订记录。', { recoverable: true })
    try {
      const result = operation(db)
      if (resolve(await this.capture(workItemId)) !== resolve(path)) throw conflict('作品已经变化。')
      return result
    } finally { db.close() }
  }
  private async write<T>(workItemId: string, operation: (db: WorkspaceDatabasePort) => T): Promise<T> {
    const path = await this.capture(workItemId)
    return this.writes.run(path, async () => {
      if (resolve(await this.capture(workItemId)) !== resolve(path)) throw conflict('作品已经变化。')
      const db = await this.databases.openExisting(path)
      if (!db) throw new AppError('FEATURE_UNAVAILABLE', '当前作品尚未建立正式存储。', { recoverable: true })
      try { db.recoverManuscriptCommits(); return operation(db) } finally { db.close() }
    })
  }
}
function conflict(message: string) { return new AppError('CONFLICT', message, { recoverable: true }) }
