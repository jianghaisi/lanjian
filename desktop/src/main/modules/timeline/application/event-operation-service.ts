import { AppError, isAppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import type { WorkspaceGenerationArtifactRecord, WorkspaceTaskRunRecord } from '../../../core/ports/workspace-database'
import { decodeEventOperation, decodeVerifiedManuscriptAuthority, type EventOperationAuthority, type EventOperationReview, type VerifiedManuscriptAuthority } from '../domain/event-operations'
import type { EventSnapshotScope, EventSourceSnapshot, EventSourceSnapshotPort } from '../domain/event-source-snapshot'
import { assertEventCanArchive } from '../domain/event-archive-guard'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import type { EventMirrorFeedback, EventMirrorSyncPort } from '../domain/event-mirror'
import { assertStoryIdentifier } from '../domain/story-event-version'
import type { StoryEventContent } from '../domain/story-event-version'
import { decodeEventModelCandidateGenerationInput, type EventModelCandidateGenerationInput, type EventModelCandidatePreviewInput } from '../../../../contracts/timeline/event-contracts'
import type { AiClient } from '../../models/application/ai-client'
import { createTaskContractSnapshot } from '../../assistant/domain/task-template-contract'
import { creativePolicyRun, type CaptureCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { creativePolicyContext } from '../../writing-plugins/domain/creative-policy-context'
import { decodeCreativePolicySnapshot, type CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { timelineCandidateInstruction } from '../domain/timeline-candidate-instruction'
import { decodeEventModelCandidateArtifact, eventModelCandidateContent, parseEventModelCandidateOutput,
  EVENT_MODEL_CANDIDATE_ARTIFACT, EVENT_MODEL_CANDIDATE_TASK } from '../domain/event-model-candidates'

type Runtime = { nonce(): string; now(): number; sha256(value: string): string }
type Pending = { token: string; expiresAt: number; generation: number; review: EventOperationReview; migration: EventMigrationReceipt }
type ModelTaskCheckpoint = { version: 1; request: EventModelCandidateGenerationInput; model: string; connectionId: string; promptHash: string;
  creativePolicy?: CreativePolicySnapshot; methodHash?: string; contextHash?: string; modelIdentity?: string }
export type TimelineCreativeContext = {
  capturePolicy: CaptureCreativePolicy
  context(readOnly: boolean, policy: CreativePolicyRun): Promise<string>
  runInBook?<T>(operation: () => Promise<T>): Promise<T>
  assertBook?(root: string, workItemId: string): Promise<void>
}
type ExistingWorkspaceDatabase = NonNullable<Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openExisting']>>>>

/** Main-private, one active reviewed intent; no paths, raw files or provenance
 * grants cross the eventual named desktop boundary. */
export class EventOperationService {
  private generation = 0
  private pending: Pending | null = null
  private serial = 0
  private modelController: AbortController | null = null
  constructor(
    private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly' | 'openEventOperationWrite'>
      & Partial<Pick<WorkspaceDatabaseFactory, 'openExisting'>>,
    private readonly sources: EventSourceSnapshotPort & { assertUnchanged(snapshot: EventSourceSnapshot): Promise<void> },
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly writes: WorkspaceWriteCoordinator,
    private readonly runtime: Runtime,
    private readonly mirrors?: EventMirrorSyncPort,
    private readonly ai?: Pick<AiClient, 'prepareCompletion'> & Partial<Pick<AiClient, 'captureRun' | 'completionIdentity'>>,
    private readonly creativity?: TimelineCreativeContext
  ) {}

  async preview(input: unknown) {
    return this.previewInternal(input)
  }

  async previewVerifiedManuscript(input: {
    expectedOrderId: string
    content: StoryEventContent
    manifestId: string
    sourceFingerprint: string
    evidenceFingerprint: string
    manuscriptSources: Array<{ chapterId: number; revision: string }>
  }) {
    this.cancel()
    if (!Array.isArray(input.manuscriptSources) || !input.manuscriptSources.length || input.manuscriptSources.length > 100
      || input.manuscriptSources.some((source) => !Number.isSafeInteger(source.chapterId) || source.chapterId < 1 || typeof source.revision !== 'string')) {
      throw new AppError('VALIDATION_ERROR', '已有剧情缺少可验证的正式正文版本。', { recoverable: true })
    }
    const scope = await this.scope(), read = await this.databases.openEventReadOnly?.(scope.root)
    let manuscriptSources: Array<{ chapterId: number; id: string; revision: string }>
    try {
      if (!read || read.bookRoot !== scope.root) throw conflict()
      manuscriptSources = input.manuscriptSources.map((source) => ({ chapterId: source.chapterId,
        ...(read.eventManuscriptSource(source.chapterId, source.revision) ?? unavailableSource()) }))
      await this.assertScope(scope, this.generation)
    } finally { read?.close() }
    const authority = decodeVerifiedManuscriptAuthority({
      kind: 'verified-manuscript',
      manifestId: input.manifestId,
      sourceFingerprint: input.sourceFingerprint,
      evidenceFingerprint: input.evidenceFingerprint,
      manuscriptSources
    })
    return this.previewInternal({
      kind: 'create', expectedOrderId: input.expectedOrderId, content: input.content, granularity: 'macro'
    }, authority)
  }

  async previewMaterialCandidate(input: {
    expectedOrderId: string
    sourceId: string
    time: string
    characters: string[]
    location: string
    event: string
    result?: string
  }) {
    return this.previewInternal(undefined, undefined, (snapshot) => {
      const candidate = materialCandidate(input)
      const occurrence = snapshot.documents.sources.occurrences.find(item => item.originalId === candidate.sourceId)
      const source = materialSource(occurrence?.value, candidate.sourceId)
      const excerpt = (source.excerpt.trim() || source.userNotes.trim()).slice(0, 2_000)
      if (!excerpt) throw new AppError('VALIDATION_ERROR', '所选资料没有可核对的原始摘录或作者整理。', { recoverable: true })
      return {
        input: {
          kind: 'create', expectedOrderId: candidate.expectedOrderId, granularity: 'macro',
          content: { time: candidate.time, characters: candidate.characters, location: candidate.location,
            event: candidate.event, ...(candidate.result === undefined ? {} : { result: candidate.result }),
            evidenceRefs: [{ sourceId: candidate.sourceId, excerpt }], confidence: 1 }
        },
        authority: { kind: 'verified-material-candidate', sourceId: candidate.sourceId,
          sourceRevision: source.contentHash } as const
      }
    })
  }

  async generateModelCandidates(input: EventModelCandidateGenerationInput) {
    const request = structuredClone(input)
    return this.creativity?.runInBook ? this.creativity.runInBook(() => this.generateModelCandidatesInBook(request)) : this.generateModelCandidatesInBook(request)
  }

  private async generateModelCandidatesInBook(input: EventModelCandidateGenerationInput) {
    this.cancel()
    if (!this.ai || !this.databases.openExisting) throw unavailable()
    const liveAi = this.ai
    const generation = this.generation, scope = await this.scope(), instruction = timelineCandidateInstruction(input.context)
    const controller = new AbortController()
    this.modelController = controller
    let taskId: string | undefined, rawOutput: string | undefined, guard: (() => Promise<void>) | undefined
    try {
      const read = await this.databases.openEventReadOnly?.(scope.root)
      try {
        if (!read || read.bookRoot !== scope.root || read.schemaVersion < 44 || !read.eventMigrationReceipt() || !read.eventState()) throw unavailable()
      } finally { read?.close() }
      await this.assertScope(scope, generation)
      const duplicate = await this.withDatabase(scope.root, database => database.taskRunByOperationKey(input.operationId))
      if (duplicate) return this.existingModelBatch(scope, generation, input, duplicate)
      const policy = await (this.creativity?.capturePolicy() ?? creativePolicyRun())
      const ai = liveAi.captureRun ? await liveAi.captureRun(['outline']) : liveAi
      const completion = await ai.prepareCompletion('outline')
      const identity = async (modelAi: typeof liveAi) => modelAi.completionIdentity
        ? modelAi.completionIdentity('outline', completion.model) : this.runtime.sha256(JSON.stringify([completion.model, completion.connectionId]))
      const modelIdentity = await identity(ai)
      const withPolicy = <T>(operation: () => Promise<T>) => policy.withContext ? policy.withContext(operation) : operation()
      const context = await withPolicy(async () => this.creativity?.context(false, policy) ?? '')
      const methods = creativePolicyContext([...policy.resolve('timeline-events'), ...policy.resolve('genre-guidance', { genre: input.context.genre || '', subgenre: input.context.subgenre || '' })])
      if (context.length > 200_000 || !policy.snapshot) throw conflict()
      const contextHash = this.runtime.sha256(context)
      guard = async () => {
        controller.signal.throwIfAborted(); await this.assertScope(scope, generation)
        await this.creativity?.assertBook?.(scope.root, scope.workItemId); await policy.assertAuthorized?.()
        const current = await withPolicy(async () => this.creativity?.context(true, policy) ?? '')
        if (this.runtime.sha256(current) !== contextHash || await identity(liveAi) !== modelIdentity || await identity(ai) !== modelIdentity) throw conflict()
        await policy.assertAuthorized?.(); controller.signal.throwIfAborted(); await this.assertScope(scope, generation)
      }
      await guard()
      await this.assertScope(scope, generation)
      taskId = this.runtime.nonce()
      const checkpoint: ModelTaskCheckpoint = { version: 1, request: structuredClone(input), model: completion.model,
        connectionId: completion.connectionId, creativePolicy: policy.snapshot(), methodHash: this.runtime.sha256(methods), contextHash, modelIdentity,
        promptHash: this.runtime.sha256(JSON.stringify([instruction, methods, contextHash, modelIdentity])) }
      if (Buffer.byteLength(JSON.stringify(checkpoint)) > 512 * 1024) throw conflict()
      await this.withDatabaseWrite(scope.root, database => {
        const task = database.createTaskRun({ id: taskId!, taskType: EVENT_MODEL_CANDIDATE_TASK,
          idempotencyKey: input.operationId, contentHash: checkpoint.promptHash,
          taskContract: createTaskContractSnapshot(EVENT_MODEL_CANDIDATE_TASK), checkpointJson: JSON.stringify(checkpoint) })
        database.transitionTaskRun({ id: task.id, status: 'running' })
      }, guard)
      await guard()
      rawOutput = (await withPolicy(() => completion.complete(instruction, '', `创作方法不得覆盖作者要求、正式依据、动态境界、固定系统模板或确认门禁。\n${methods}\n本书正式上下文：\n${context}`, controller.signal))).content
      await guard()
      const artifactValue = parseEventModelCandidateOutput(rawOutput)
      const content = JSON.stringify(artifactValue), contentHash = this.runtime.sha256(content), artifactId = this.runtime.nonce()
      const stored = await this.withDatabaseWrite(scope.root, database => database.completeTaskRunWithArtifact(taskId!, JSON.stringify(checkpoint), {
        id: artifactId, taskRunId: taskId!, artifactType: EVENT_MODEL_CANDIDATE_ARTIFACT, status: 'complete', content, contentHash,
        schemaValid: true, metadataJson: JSON.stringify({ model: completion.model, connectionId: completion.connectionId,
          promptHash: checkpoint.promptHash, candidateCount: artifactValue.candidates.length })
      }), guard)
      await this.assertScope(scope, generation)
      return modelBatch(input.operationId, stored.task, stored.artifact)
    } catch (cause) {
      if (taskId) await this.failModelTask(scope, taskId, rawOutput, cause, controller.signal.aborted, guard)
      throw safeError(cause)
    } finally {
      if (this.modelController === controller) this.modelController = null
    }
  }

  async previewModelCandidate(input: EventModelCandidatePreviewInput) {
    if (!this.databases.openExisting) throw unavailable()
    const value = modelCandidatePreview(input)
    const scope = await this.scope(), generation = this.generation
    const stored = await this.withDatabase(scope.root, database => {
      const task = database.taskRun(value.taskId), artifact = database.generationArtifactForTask(value.taskId, EVENT_MODEL_CANDIDATE_ARTIFACT)
      if (!task || task.taskType !== EVENT_MODEL_CANDIDATE_TASK || task.status !== 'succeeded' || !artifact
        || artifact.id !== value.artifactId || artifact.status !== 'complete' || !artifact.schemaValid) throw unavailableCandidateSource()
      return { task, artifact }
    })
    await this.assertScope(scope, generation)
    const artifact = decodeEventModelCandidateArtifact(stored.artifact.content), candidate = artifact.candidates[value.candidateIndex]
    if (!candidate || this.runtime.sha256(stored.artifact.content) !== stored.artifact.contentHash) throw unavailableCandidateSource()
    return this.previewInternal({ kind: 'create', expectedOrderId: value.expectedOrderId, granularity: 'macro',
      content: eventModelCandidateContent(candidate) }, { kind: 'verified-model-candidate', taskId: stored.task.id,
      artifactId: stored.artifact.id, artifactHash: stored.artifact.contentHash, candidateIndex: value.candidateIndex })
  }

  private async previewInternal(input: unknown, authority?: EventOperationAuthority,
    prepare?: (snapshot: EventSourceSnapshot) => { input: unknown; authority?: EventOperationAuthority }) {
    this.cancel()
    const generation = this.generation
    try {
      const scope = await this.scope()
      return await this.writes.run(scope.root, async () => {
        await this.assertScope(scope, generation)
        const snapshot = await this.sources.capture(scope)
        if (snapshot.scope.root !== scope.root || snapshot.scope.workItemId !== scope.workItemId || snapshot.scope.generation !== scope.generation) throw conflict()
        const prepared = prepare ? prepare(snapshot) : { input, authority }
        const command = decodeEventOperation(prepared.input)
        authority = prepared.authority
        await this.assertScope(scope, generation)
        const read = await this.databases.openEventReadOnly?.(scope.root)
        try {
          await this.assertScope(scope, generation)
          if (!read || read.bookRoot !== scope.root || read.projectId !== snapshot.database?.projectId || read.schemaVersion < 44) throw unavailable()
        const migration = read.eventMigrationReceipt(), state = read.eventState()
        if (!migration || !state) throw unavailable()
        if (state.order.id !== command.expectedOrderId) throw conflict()
        if (command.kind === 'create' && state.order.eventIds.length >= 100_000)
          throw new AppError('VALIDATION_ERROR', '事件数量已达核对上限，不能继续新建；未截断或移除任何事件。', { recoverable: true })
          if (command.kind === 'reorder') {
            const ids = new Set(state.order.eventIds)
            if (command.eventIds.length !== ids.size || command.eventIds.some(id => !ids.has(id))) throw conflict()
          } else if (command.kind !== 'create') {
            const lifecycle = state.lifecycles.find(item => item.eventId === command.eventId)
            const latest = snapshot.eventHistory.find(item => item.eventId === command.eventId)?.versions.at(-1)
            if (!lifecycle || lifecycle.id !== command.expectedLifecycleId || latest?.id !== command.expectedVersionId) throw conflict()
            if (['edit', 'adopt'].includes(command.kind) && lifecycle.state !== 'active') throw conflict()
            if (command.kind === 'adopt' && latest.status !== 'candidate') throw conflict()
            if (command.kind === 'archive') assertEventCanArchive(command.eventId, snapshot, read.eventSourceAliases())
          }
          if (command.kind === 'create' || command.kind === 'edit') {
            const sourceIds = new Set(snapshot.documents.sources.occurrences.map(item => item.originalId))
            if (command.content.evidenceRefs.some(item => !sourceIds.has(item.sourceId))) throw conflict()
          }
          if (authority?.kind === 'verified-manuscript' && authority.manuscriptSources.some((source) => !snapshot.chapterCatalog.entries.some((entry) =>
            entry.kind === 'manuscript' && entry.chapterId === source.chapterId && entry.status === 'active' && entry.revision === source.revision))) throw conflict()
          const requestHash = this.runtime.sha256(JSON.stringify({ version: 1, sourceFingerprint: snapshot.fingerprint, command,
            ...(authority ? { authority } : {}) }))
          if (!/^[a-f0-9]{64}$/.test(requestHash)) throw unavailable()
          const token = this.nonce(), operationId = this.nonce(), expiresAt = this.time() + 15 * 60_000
          await this.assertScope(scope, generation)
          this.pending = { token, expiresAt, generation, review: { operationId, requestHash, command, snapshot,
            ...(authority ? { authority } : {}) }, migration }
          return Object.freeze({ token, operationId, kind: command.kind, requestHash, expiresAt })
        } finally { read?.close() }
      })
    } catch (cause) {
      if (this.pending?.generation === generation) this.pending = null
      throw safeError(cause)
    }
  }

  cancel(): void { this.generation++; this.pending = null; this.modelController?.abort(); this.modelController = null }

  async commit(token: string) {
    return this.commitInternal(token)
  }

  async commitVerifiedManuscript(token: string, verifyEvidence: () => Promise<void>) {
    return this.commitInternal(token, verifyEvidence, true)
  }

  private async commitInternal(token: string, verifyEvidence?: () => Promise<void>, requireAuthority = false) {
    assertStoryIdentifier(token)
    const pending = this.pending
    if (!pending || pending.token !== token) throw conflict()
    if (requireAuthority && pending.review.authority?.kind !== 'verified-manuscript') throw conflict()
    this.pending = null
    const scope = pending.review.snapshot.scope
    const active = () => { if (pending.generation !== this.generation || this.time() >= pending.expiresAt) throw conflict() }
    const receipt = await this.writes.run(scope.root, async () => {
      active(); await this.assertScope(scope, pending.generation)
      if (verifyEvidence) { await verifyEvidence(); active(); await this.assertScope(scope, pending.generation) }
      if (!this.databases.openEventOperationWrite) throw unavailable()
      let database: Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openEventOperationWrite']>>> | undefined
      try {
        database = await this.databases.openEventOperationWrite(scope.root)
        await this.sources.assertUnchanged(pending.review.snapshot)
        await this.assertScope(scope, pending.generation); active()
        return database.commit(pending.review, active)
      } catch (cause) {
        if (isAppError(cause)) throw cause
        throw new AppError('STORAGE_ERROR', '事件操作暂未完成，请核对本次回执后重试。', { recoverable: true, cause })
      } finally {
        try { database?.close() } catch (cause) {
          throw new AppError('STORAGE_ERROR', '事件连接未正常结束，请查询本次操作回执确认是否保存成功。', { recoverable: true, cause })
        }
      }
    })
    let mirror: EventMirrorFeedback = { status: 'pending', issue: 'unavailable' }
    const changesReadableMirror = !receipt.noOp && ['create', 'edit', 'adopt'].includes(receipt.kind)
    if (this.mirrors && changesReadableMirror) {
      try { mirror = await this.mirrors.syncCommitted(scope, pending.migration) }
      catch (error) { mirror = isAppError(error) && error.code === 'CONFLICT' ? { status: 'pending', issue: 'stale' } : { status: 'failed', issue: 'storage-error' } }
    }
    return Object.freeze({ receipt, mirror: Object.freeze(mirror) })
  }

  async receipt(operationId: string) {
    try {
      assertStoryIdentifier(operationId)
      const scope = await this.scope(), generation = this.generation
      return await this.writes.run(scope.root, async () => {
        await this.assertScope(scope, generation)
        if (!this.databases.openEventReadOnly) throw unavailable()
        const read = await this.databases.openEventReadOnly(scope.root)
        try {
          if (read && read.bookRoot !== scope.root) throw conflict()
          const result = read?.eventOperationReceipt(operationId) ?? null
          await this.assertScope(scope, generation)
          return result
        } finally { read?.close() }
      })
    } catch (cause) { throw safeError(cause) }
  }

  private async scope(): Promise<EventSnapshotScope> {
    try {
      const scope = { ...await this.currentScope() }
      if (typeof scope.workItemId !== 'string' || !scope.workItemId || typeof scope.root !== 'string' || !scope.root
        || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw conflict()
      return scope
    } catch (cause) { throw safeError(cause) }
  }
  private async assertScope(scope: EventSnapshotScope, generation: number) {
    const current = await this.scope()
    if (generation !== this.generation || current.workItemId !== scope.workItemId || current.root !== scope.root || current.generation !== scope.generation) throw conflict()
  }
  private time(): number {
    const now = this.runtime.now()
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 900_000) throw unavailable()
    return now
  }
  private nonce(): string { const id = `${this.runtime.nonce()}:${++this.serial}`; assertStoryIdentifier(id); return id }

  private async existingModelBatch(scope: EventSnapshotScope, generation: number, input: EventModelCandidateGenerationInput, task: WorkspaceTaskRunRecord) {
    if (task.taskType !== EVENT_MODEL_CANDIDATE_TASK || task.status !== 'succeeded') throw conflict()
    const checkpoint = modelCheckpoint(task)
    if (JSON.stringify(checkpoint.request) !== JSON.stringify(input)) throw conflict()
    const artifact = await this.withDatabase(scope.root, database => database.generationArtifactForTask(task.id, EVENT_MODEL_CANDIDATE_ARTIFACT))
    if (!artifact || artifact.status !== 'complete' || !artifact.schemaValid) throw conflict()
    await this.assertScope(scope, generation)
    return modelBatch(input.operationId, task, artifact)
  }

  private async failModelTask(scope: EventSnapshotScope, taskId: string, rawOutput: string | undefined, cause: unknown, cancelled: boolean, guard?: () => Promise<void>) {
    if (!this.databases.openExisting) return
    const transition = (database: ExistingWorkspaceDatabase) => database.transitionTaskRun({ id: taskId, status: cancelled ? 'cancelled' : 'failed',
      errorCode: cancelled ? 'GENERATION_CANCELLED' : 'MODEL_CANDIDATE_FAILED',
      errorMessage: cause instanceof AppError ? cause.message : 'AI 事件候选未完成，正式事件没有变化。' })
    const assertBook = () => this.creativity?.assertBook?.(scope.root, scope.workItemId) ?? Promise.resolve()
    await this.withDatabaseWrite(scope.root, database => {
      const task = database.taskRun(taskId)
      if (!task || !['queued', 'preparing', 'running', 'streaming'].includes(task.status)) return
      if (rawOutput && !cancelled && !database.generationArtifactForTask(taskId, EVENT_MODEL_CANDIDATE_ARTIFACT)) {
        database.createGenerationArtifact({ id: this.runtime.nonce(), taskRunId: taskId, artifactType: EVENT_MODEL_CANDIDATE_ARTIFACT,
          status: 'invalid', content: rawOutput.slice(0, 5_000_000), contentHash: this.runtime.sha256(rawOutput.slice(0, 5_000_000)),
          schemaValid: false, metadataJson: JSON.stringify({ failure: 'invalid-model-output' }) })
      }
      transition(database)
    }, async () => { await assertBook(); if (rawOutput && !cancelled) await guard?.() }).catch(async () => {
      // Lost candidate authority can still preserve history in the same physical book.
      await this.withDatabaseWrite(scope.root, database => { if (['queued', 'preparing', 'running', 'streaming'].includes(database.taskRun(taskId)?.status ?? '')) transition(database) }, assertBook).catch(() => undefined)
    })
  }

  private async withDatabase<T>(root: string, action: (database: ExistingWorkspaceDatabase) => T): Promise<T> {
    const database = await this.databases.openExisting?.(root)
    if (!database) throw unavailable()
    try { return action(database) } finally { database.close() }
  }

  private withDatabaseWrite<T>(root: string, action: (database: ExistingWorkspaceDatabase) => T, beforeWrite?: () => Promise<void>): Promise<T> {
    return this.writes.run(root, async () => { await beforeWrite?.(); return this.withDatabase(root, action) })
  }
}

function conflict(): AppError { return new AppError('CONFLICT', '作品、事件或核对会话已变化，请重新核对后保存。', { recoverable: true }) }
function unavailable(): AppError { return new AppError('FEATURE_UNAVAILABLE', '当前作品的统一事件操作尚未就绪，未改动作品。', { recoverable: true }) }
function unavailableSource(): never { throw new AppError('CONFLICT', '已有剧情引用的正式正文版本已经变化，请重新预览。', { recoverable: true }) }
function materialCandidate(input: unknown): {
  expectedOrderId: string; sourceId: string; time: string; characters: string[]; location: string; event: string; result?: string
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidCandidate()
  const value = input as Record<string, unknown>
  const required = ['expectedOrderId', 'sourceId', 'time', 'characters', 'location', 'event']
  const allowed = new Set([...required, 'result'])
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))
    || typeof value.expectedOrderId !== 'string' || typeof value.sourceId !== 'string'
    || typeof value.time !== 'string' || typeof value.location !== 'string' || typeof value.event !== 'string'
    || !Array.isArray(value.characters) || !value.characters.length || value.characters.some(item => typeof item !== 'string')
    || (value.result !== undefined && typeof value.result !== 'string')) throw invalidCandidate()
  return structuredClone(value) as ReturnType<typeof materialCandidate>
}
function materialSource(value: unknown, sourceId: string): { excerpt: string; userNotes: string; contentHash: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailableCandidateSource()
  const source = value as Record<string, unknown>
  if (source.id !== sourceId || typeof source.excerpt !== 'string' || typeof source.userNotes !== 'string'
    || typeof source.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.contentHash)) throw unavailableCandidateSource()
  return { excerpt: source.excerpt, userNotes: source.userNotes, contentHash: source.contentHash }
}
function invalidCandidate(): AppError { return new AppError('VALIDATION_ERROR', '事件候选内容无效，请补齐时间、人物、地点和事件。', { recoverable: true }) }
function unavailableCandidateSource(): AppError { return new AppError('CONFLICT', '事件候选引用的资料已经变化，请重新选择资料。', { recoverable: true }) }

function modelCandidatePreview(input: EventModelCandidatePreviewInput): EventModelCandidatePreviewInput {
  if (!input || typeof input !== 'object' || typeof input.expectedOrderId !== 'string' || typeof input.taskId !== 'string'
    || typeof input.artifactId !== 'string' || !Number.isSafeInteger(input.candidateIndex)
    || input.candidateIndex < 0 || input.candidateIndex > 29) throw invalidCandidate()
  return structuredClone(input)
}

function modelBatch(operationId: string, task: WorkspaceTaskRunRecord, artifact: WorkspaceGenerationArtifactRecord) {
  const value = decodeEventModelCandidateArtifact(artifact.content)
  const checkpoint = modelCheckpoint(task)
  if (checkpoint.version !== 1 || checkpoint.request.operationId !== operationId || !checkpoint.model
    || artifact.contentHash.length !== 64) throw unavailableCandidateSource()
  return Object.freeze({ operationId, taskId: task.id, artifactId: artifact.id, artifactHash: artifact.contentHash, model: checkpoint.model,
    candidates: Object.freeze(value.candidates.map((candidate, candidateIndex) => Object.freeze({ id: `${task.id}:${candidateIndex}`,
      candidateIndex, title: candidate.title, time: candidate.time, characters: candidate.characters.join('、'), location: candidate.location,
      event: candidate.event, result: candidate.result ?? '' }))) })
}

function modelCheckpoint(task: WorkspaceTaskRunRecord): ModelTaskCheckpoint {
  let checkpoint: ModelTaskCheckpoint
  try { checkpoint = JSON.parse(task.checkpointJson) as ModelTaskCheckpoint } catch { throw unavailableCandidateSource() }
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) || checkpoint.version !== 1 || !checkpoint.request || typeof checkpoint.model !== 'string' || !checkpoint.model || typeof checkpoint.connectionId !== 'string' || !checkpoint.connectionId
    || !/^[a-f0-9]{64}$/.test(checkpoint.promptHash)) throw unavailableCandidateSource()
  if (Buffer.byteLength(task.checkpointJson) > 512 * 1024 || Object.keys(checkpoint).some(key => !['version', 'request', 'model', 'connectionId', 'promptHash', 'creativePolicy', 'methodHash', 'contextHash', 'modelIdentity'].includes(key))) throw unavailableCandidateSource()
  const recovery = [checkpoint.creativePolicy, checkpoint.methodHash, checkpoint.contextHash, checkpoint.modelIdentity]
  try { checkpoint.request = decodeEventModelCandidateGenerationInput(checkpoint.request) } catch { throw unavailableCandidateSource() }
  if (recovery.some(value => value !== undefined)) {
    if (recovery.some(value => value === undefined) || ![checkpoint.methodHash, checkpoint.contextHash, checkpoint.modelIdentity].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) || task.contentHash !== checkpoint.promptHash) throw unavailableCandidateSource()
    checkpoint.creativePolicy = decodeCreativePolicySnapshot(checkpoint.creativePolicy)
  }
  return checkpoint
}
function safeError(cause: unknown): AppError {
  return isAppError(cause) ? cause : new AppError('STORAGE_ERROR', '事件操作暂时无法安全核对，请稍后重试；未返回原始存储信息。', { recoverable: true, cause })
}
