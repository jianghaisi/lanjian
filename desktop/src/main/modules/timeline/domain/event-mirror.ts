import type { EventMigrationReceipt } from './event-migration-receipt'
import type { EventSnapshotScope } from './event-source-snapshot'

export type EventMirrorFeedback =
  | Readonly<{ status: 'synced'; issue: 'none' }>
  | Readonly<{ status: 'pending'; issue: 'none' | 'stale' | 'unavailable' }>
  | Readonly<{ status: 'conflict'; issue: 'external-change' }>
  | Readonly<{ status: 'failed'; issue: 'storage-error' }>

/** Main-private content and CAS identity; never an IPC DTO. */
export type EventMirrorPlan = Readonly<{
  receipt: EventMigrationReceipt
  revision: string
  content: string
  contentHash: string
  expectedFileHash: string | null
  feedback: EventMirrorFeedback
}>

export interface EventMirrorStoragePort {
  read(operationId?: string): EventMirrorPlan
  assertCurrent(plan: EventMirrorPlan): void
  acknowledge(plan: EventMirrorPlan, feedback: EventMirrorFeedback, observedHash: string | null): void
  close(): void
}

export interface EventMirrorPublisherPort {
  publish(scope: EventSnapshotScope, plan: EventMirrorPlan, guard: {
    recheck(): Promise<void>
    assertActive(): void
  }): Promise<{ feedback: EventMirrorFeedback; observedHash: string | null }>
}

export interface EventMirrorSyncPort {
  syncCommitted(scope: EventSnapshotScope, receipt: EventMigrationReceipt): Promise<EventMirrorFeedback>
}

export type EventMigrationCommitResult = Readonly<{ receipt: EventMigrationReceipt; mirror: EventMirrorFeedback }>
