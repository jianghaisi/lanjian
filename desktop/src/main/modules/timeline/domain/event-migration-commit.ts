import type { EventMigrationDecisionPlan } from './event-migration-decisions'
import type { EventMigrationPayloads } from './event-migration-payloads'
import type { EventMigrationReceipt } from './event-migration-receipt'
import type { EventSourceSnapshot } from './event-source-snapshot'

/** Main-owned evidence, never accepted from a renderer. Authorization also needs
 * the live session guard, checked inside the synchronous write transaction. */
export type ClaimedEventMigrationReview = Readonly<{
  operationId: string
  decisionFingerprint: string
  plan: EventMigrationDecisionPlan
  snapshot: EventSourceSnapshot
  payloads: EventMigrationPayloads
}>

export interface EventMigrationWritePort {
  commit(review: ClaimedEventMigrationReview, assertActive: () => void): EventMigrationReceipt
  close(): void
}

export interface EventMigrationFilesPort {
  assertUnchanged(snapshot: EventSourceSnapshot): Promise<void>
}
