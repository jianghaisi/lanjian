import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { EventMigrationCommitService } from '../application/event-migration-commit-service'
import { EventMigrationReceiptService } from '../application/event-migration-receipt-service'
import { EventMigrationReviewSession } from '../application/event-migration-review-session'
import { EventMirrorSyncService } from '../application/event-mirror-sync-service'
import { EventOperationService, type TimelineCreativeContext } from '../application/event-operation-service'
import { EventProjectionService } from '../application/event-projection-service'
import { ProseEventSettlementService } from '../application/prose-event-settlement-service'
import { ProseEventExtractionService, type ProseEventCreativeContext } from '../application/prose-event-extraction-service'
import type { ProjectService } from '../../library/application/project-service'
import type { WorkspaceService } from '../../library/application/workspace-service'
import { EventSourceSnapshotService } from '../application/event-source-snapshot-service'
import { EventStateInitializationService } from '../application/event-state-initialization-service'
import { LocalEventMirrorPublisher } from '../adapters/event-mirror-publisher'
import { LocalEventSourceSnapshotReader } from '../adapters/event-source-snapshot'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import type { AiClient } from '../../models/application/ai-client'

type Projects = {
  runBookTask?: ProjectService['runBookTask']
  readonly executionIdentity?: { root: string }
  currentPath(): Promise<string>
  currentSummary(): Promise<{ id: string; path: string }>
}

/** Owns all process-local event grants for the selected book. Changing books
 * invalidates previews immediately; durable operation receipts remain in SQLite. */
export function createEventRuntime(
  projects: Projects,
  databases: WorkspaceDatabaseFactory,
  writes: WorkspaceWriteCoordinator,
  ai?: Pick<AiClient, 'prepareCompletion' | 'captureRun'>,
  context?: Pick<WorkspaceService,'contextBudgetPreferences'>,
  creativity?: TimelineCreativeContext,
  proseCreativity?: ProseEventCreativeContext
) {
  let generation = 0
  const currentScope = async (): Promise<EventSnapshotScope> => {
    const observed = projects.executionIdentity ? 0 : generation
    const root = await projects.currentPath()
    const summary = await projects.currentSummary()
    const current = await projects.currentPath()
    if (observed !== (projects.executionIdentity ? 0 : generation) || !samePath(root, current) || !samePath(root, summary.path)) throw changed()
    if (typeof summary.id !== 'string' || !summary.id.trim()) throw changed()
    return { workItemId: summary.id, root, generation: observed }
  }
  const runtime = {
    nonce: randomUUID,
    now: () => Date.now(),
    sha256: (value: string) => createHash('sha256').update(value).digest('hex')
  }
  const source = new LocalEventSourceSnapshotReader(databases)
  const captured = new EventSourceSnapshotService(source, currentScope, writes)
  const mirrors = new EventMirrorSyncService(databases, new LocalEventMirrorPublisher(), currentScope, writes)
  const reviews = new EventMigrationReviewSession(captured, currentScope, runtime)
  const migrations = new EventMigrationCommitService(reviews, databases, source, currentScope, writes, mirrors)
  const stateInitialization = new EventStateInitializationService(databases, currentScope, writes, runtime)
  const migrationReceipts = new EventMigrationReceiptService(databases, currentScope, writes)
  const projection = new EventProjectionService(databases, currentScope, writes)
  const operations = new EventOperationService(databases, source, currentScope, writes, runtime, mirrors, ai, creativity)
  const settlements = new ProseEventSettlementService(databases,currentScope,writes,mirrors)
  const extraction = ai && context && projects.runBookTask ? new ProseEventExtractionService(
    projects as Projects & Pick<ProjectService,'runBookTask'>,databases,settlements,ai,context,writes,proseCreativity) : null
  return {
    settlements,
    extraction,
    projection,
    operations,
    reviews,
    migrations,
    stateInitialization,
    migrationReceipts,
    mirrors,
    clear() {
      generation++
      reviews.clear()
      stateInitialization.clear()
      operations.cancel()
      settlements.cancel()
    }
  }
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left), b = resolve(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b
}

function changed(): AppError {
  return new AppError('CONFLICT', '作品已经切换，请从当前作品重新读取事件。', { recoverable: true })
}
