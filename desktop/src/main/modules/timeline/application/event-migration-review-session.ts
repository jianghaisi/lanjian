import { AppError, isAppError } from '../../../core/errors/app-error'
import { assertEventMigrationReviewable, eventMigrationDisplayOrder, eventMigrationMirrorAcknowledgements, reviewEventMigrationDecisions,
  type EventMigrationDecisionPlan, type EventMigrationInspection } from '../domain/event-migration-decisions'
import { inspectEventMigrationSources } from '../domain/event-migration-review'
import { prepareEventMigrationPayloads, type EventMigrationPayloads } from '../domain/event-migration-payloads'
import type { EventSnapshotScope, EventSourceSnapshot } from '../domain/event-source-snapshot'
import type { ClaimedEventMigrationReview } from '../domain/event-migration-commit'
import { assertStoryIdentifier } from '../domain/story-event-version'

export type { ClaimedEventMigrationReview } from '../domain/event-migration-commit'

export const EVENT_MIGRATION_REVIEW_TTL_MS = 15 * 60 * 1000
export const EVENT_MIGRATION_MAX_CAPTURES = 3

export interface EventMigrationReviewRuntime {
  /** Main-owned cryptographically unpredictable nonce; never supplied by the renderer. */
  nonce(): string
  sha256(content: string): string
  now(): number
}
type Confirmation = { token: string; operationId: string; decisionFingerprint: string; plan: EventMigrationDecisionPlan; payloads: EventMigrationPayloads }
type Pending = {
  previewId: string; snapshot: EventSourceSnapshot; inspection: EventMigrationInspection
  expiresAt: number; reviewSequence: number; confirmation: Confirmation | null
}

/** Main-private review owner. withConfirmation keeps its one-use grant live
 * through an injected submit operation; claiming alone never commits data. */
export class EventMigrationReviewSession {
  private pending: Pending | null = null
  private claimingPreviewId: string | null = null
  private generation = 0
  private serial = 0
  private captures = 0

  constructor(
    private readonly sources: { capture(): Promise<EventSourceSnapshot> },
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly runtime: EventMigrationReviewRuntime
  ) {}

  async preview() {
    // A new preview supersedes previous review/authorization immediately, even on failure.
    this.clear()
    const generation = this.generation
    const snapshot = await this.capture(generation)
    assertEventMigrationReviewable(snapshot)
    if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.scope)) throw integrity()
    const inspection = inspectEventMigrationSources(snapshot)
    const previewId = this.identifier()
    const expiresAt = this.time() + EVENT_MIGRATION_REVIEW_TTL_MS
    this.assertGeneration(generation)
    this.pending = { previewId, snapshot, inspection, expiresAt, reviewSequence: 0, confirmation: null }
    return Object.freeze({ previewId, fingerprint: snapshot.fingerprint, expiresAt, summary: inspection.summary,
      requiredMirrorAcknowledgements: eventMigrationMirrorAcknowledgements(snapshot) })
  }

  /** Private immutable paged inspection. This is not a renderer DTO or write capability. */
  async inspection(previewId: string): Promise<EventMigrationInspection> {
    const pending = this.resolve(previewId)
    await this.assertScope(pending.snapshot.scope)
    this.assertPending(pending)
    return pending.inspection
  }

  async review(previewId: string, decisions: unknown) {
    const pending = this.resolve(previewId)
    // Invalid/stale decisions must also invalidate an earlier confirmation token.
    pending.confirmation = null
    const sequence = ++pending.reviewSequence
    await this.assertScope(pending.snapshot.scope)
    this.assertPending(pending)
    if (sequence !== pending.reviewSequence) throw conflict()
    const plan = reviewEventMigrationDecisions(pending.snapshot, decisions, pending.inspection)
    const payloads = prepareEventMigrationPayloads(pending.snapshot, plan, pending.inspection)
    const decisionFingerprint = this.runtime.sha256(JSON.stringify(plan))
    if (!/^[0-9a-f]{64}$/.test(decisionFingerprint)) throw integrity()
    const token = this.identifier(), operationId = this.identifier()
    this.assertPending(pending)
    pending.confirmation = { token, operationId, decisionFingerprint, plan, payloads }
    return Object.freeze({ token, operationId, decisionFingerprint, fingerprint: pending.snapshot.fingerprint, expiresAt: pending.expiresAt,
      displayOrderRowIndices: eventMigrationDisplayOrder(plan) })
  }

  async claimConfirmation(token: string): Promise<ClaimedEventMigrationReview> {
    return this.withConfirmation(token, async review => review)
  }

  /** Keeps cancellation and expiry live through queueing and the final commit. */
  async withConfirmation<T>(token: string, submit: (review: ClaimedEventMigrationReview, assertActive: () => void) => Promise<T>): Promise<T> {
    assertStoryIdentifier(token)
    const pending = this.pending, confirmation = pending?.confirmation
    if (!pending || !confirmation || confirmation.token !== token) throw conflict()
    // Consume before ANY await: simultaneous callers cannot both obtain the same grant.
    this.pending = null
    this.claimingPreviewId = pending.previewId
    const generation = this.generation
    try {
      if (this.time() >= pending.expiresAt) throw conflict()
      await this.assertScope(pending.snapshot.scope)
      this.assertGeneration(generation)
      const current = await this.capture(generation)
      this.assertGeneration(generation)
      if (!sameScope(current.scope, pending.snapshot.scope) || current.fingerprint !== pending.snapshot.fingerprint || this.time() >= pending.expiresAt) throw conflict()
      assertEventMigrationReviewable(current)
      // Keep the ORIGINAL reviewed snapshot, not a refreshed replacement.
      const review = Object.freeze({ operationId: confirmation.operationId, decisionFingerprint: confirmation.decisionFingerprint,
        plan: confirmation.plan, snapshot: pending.snapshot, payloads: confirmation.payloads })
      const assertActive = () => {
        this.assertGeneration(generation)
        if (this.claimingPreviewId !== pending.previewId || this.time() >= pending.expiresAt) throw conflict()
      }
      assertActive()
      return await submit(review, assertActive)
    } finally {
      if (this.claimingPreviewId === pending.previewId) this.claimingPreviewId = null
    }
  }

  cancel(previewId: string): void {
    assertStoryIdentifier(previewId)
    if (this.pending?.previewId === previewId || this.claimingPreviewId === previewId) this.clear()
  }

  clear(): void {
    this.pending = null
    this.claimingPreviewId = null
    this.generation++
  }

  private async capture(generation: number): Promise<EventSourceSnapshot> {
    if (this.captures >= EVENT_MIGRATION_MAX_CAPTURES) throw new AppError('CONFLICT', '事件核对请求仍在读取，请等待后重试。', { recoverable: true })
    this.captures++
    let scope: EventSnapshotScope | null = null
    try {
      scope = await this.readScope()
      this.assertGeneration(generation)
      const snapshot = await this.sources.capture()
      await this.assertScope(scope)
      this.assertGeneration(generation)
      if (!sameScope(scope, snapshot.scope)) throw conflict()
      return snapshot
    } catch (error) {
      this.assertGeneration(generation)
      if (scope) await this.assertScope(scope)
      if (isAppError(error)) throw error
      throw new AppError('STORAGE_ERROR', '事件核对暂时无法完成，未提交任何迁移。', { recoverable: true, cause: error })
    } finally { this.captures-- }
  }

  private resolve(previewId: string): Pending {
    assertStoryIdentifier(previewId)
    const pending = this.pending
    if (!pending || pending.previewId !== previewId) throw conflict()
    this.assertPending(pending)
    return pending
  }
  private assertPending(pending: Pending): void {
    if (this.pending !== pending || this.time() >= pending.expiresAt) {
      if (this.pending === pending) this.clear()
      throw conflict()
    }
  }
  private async assertScope(scope: EventSnapshotScope): Promise<void> {
    const current = await this.readScope()
    if (!sameScope(scope, current)) throw conflict()
  }
  private async readScope(): Promise<EventSnapshotScope> {
    try {
      const scope = { ...await this.currentScope() }
      if (typeof scope.workItemId !== 'string' || !scope.workItemId || typeof scope.root !== 'string' || !scope.root
        || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw conflict()
      return scope
    } catch (error) {
      if (isAppError(error)) throw error
      throw new AppError('STORAGE_ERROR', '作品会话暂时无法核对，未提交任何迁移。', { recoverable: true, cause: error })
    }
  }
  private assertGeneration(generation: number): void { if (generation !== this.generation) throw conflict() }
  private identifier(): string {
    const nonce = this.runtime.nonce()
    if (typeof nonce !== 'string' || nonce.length > 160 || !Number.isSafeInteger(++this.serial)) throw integrity()
    assertStoryIdentifier(nonce)
    // A fresh serial also prevents an accidentally repeated injected nonce from
    // reauthorizing an old token within this process session.
    return `${nonce}:${this.serial}`
  }
  private time(): number {
    const value = this.runtime.now()
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - EVENT_MIGRATION_REVIEW_TTL_MS) throw integrity()
    return value
  }
}

function sameScope(left: EventSnapshotScope, right: EventSnapshotScope): boolean {
  return left.workItemId === right.workItemId && left.root === right.root && left.generation === right.generation
}
function conflict(): AppError { return new AppError('CONFLICT', '这次事件核对已过期、被替换或来源已变化，请重新核对。', { recoverable: true }) }
function integrity(): AppError { return new AppError('INTERNAL_ERROR', '事件核对会话无法安全建立，未提交迁移。', { recoverable: false }) }
