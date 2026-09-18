import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import type { WorkspaceTaskRunRecord } from '../../../src/main/core/ports/workspace-database'
import { IdeaGenerationService } from '../../../src/main/modules/planning/application/idea-generation-service'
import { OutlineExpansionTaskService } from '../../../src/main/modules/planning/application/outline-expansion-task-service'

test('idea and outline projections reject writing-only pause states before reading artifacts or modifying records', () => {
  for (const [Service, method] of [[IdeaGenerationService, 'snapshotFromDatabase'], [OutlineExpansionTaskService, 'project']] as const) {
    // Exercise the real projection boundary without initializing an app, provider or database.
    const service = Object.create(Service.prototype) as Record<string, (db: unknown, task: WorkspaceTaskRunRecord, sources: Map<string, never>) => unknown>
    let reads = 0
    const db = { generationArtifactForTask: () => { reads++; throw new Error('must not read artifact') } }
    for (const status of ['paused', 'resuming'] as const) {
      const task = { status, checkpointJson: 'not even decoded for an unsupported state' } as WorkspaceTaskRunRecord
      const before = structuredClone(task)
      assert.throws(() => service[method](db, task, new Map<string, never>()), (error: unknown) =>
        error instanceof AppError && error.code === 'DATABASE_INTEGRITY_FAILED' && error.recoverable === true)
      assert.deepEqual(task, before)
      assert.equal(reads, 0)
    }
  }
})
