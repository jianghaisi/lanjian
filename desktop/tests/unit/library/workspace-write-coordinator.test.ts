import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'

test('serializes writes for the same work item and continues after a failed write', async () => {
  const writes = new WorkspaceWriteCoordinator()
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })

  const first = writes.run('E:\\作品\\同一本书', async () => {
    order.push('first:start')
    markFirstStarted()
    await firstGate
    order.push('first:end')
    throw new Error('expected failure')
  })
  const second = writes.run('E:\\作品\\同一本书', () => { order.push('second'); return 2 })

  await firstStarted
  assert.deepEqual(order, ['first:start'])
  assert.equal(writes.pending('E:\\作品\\同一本书'), true)
  releaseFirst()
  await assert.rejects(first, /expected failure/)
  assert.equal(await second, 2)
  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
  assert.equal(writes.pending('E:\\作品\\同一本书'), false)
})

test('allows different work items to proceed independently', async () => {
  const writes = new WorkspaceWriteCoordinator()
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let otherCompleted = false

  const first = writes.run('E:\\作品\\甲', () => firstGate)
  const other = writes.run('E:\\作品\\乙', () => { otherCompleted = true })
  await other
  assert.equal(otherCompleted, true)
  releaseFirst()
  await first
})

test('serializes independent service owners through one shared work-item lane', async () => {
  const writes = new WorkspaceWriteCoordinator()
  const order: string[] = []
  let releaseManuscript!: () => void
  const manuscriptGate = new Promise<void>((resolve) => { releaseManuscript = resolve })
  let manuscriptStarted!: () => void
  const started = new Promise<void>((resolve) => { manuscriptStarted = resolve })
  const manuscriptService = () => writes.run('E:\\作品\\共享作品', async () => {
    order.push('manuscript:start')
    manuscriptStarted()
    await manuscriptGate
    order.push('manuscript:commit')
  })
  const taskService = () => writes.run('e:\\作品\\共享作品\\.', () => { order.push('task:commit') })

  const manuscriptWrite = manuscriptService()
  const taskWrite = taskService()
  await started
  await Promise.resolve()
  assert.deepEqual(order, ['manuscript:start'])
  releaseManuscript()
  await Promise.all([manuscriptWrite, taskWrite])
  assert.deepEqual(order, ['manuscript:start', 'manuscript:commit', 'task:commit'])
})

test('composition root injects the same coordinator into every direct SQLite writer', () => {
  const source = readFileSync(new URL('../../../src/main/bootstrap/create-desktop-runtime.ts', import.meta.url), 'utf8')
  const compact = source.replace(/\s+/g, ' ')
  assert.equal((source.match(/new WorkspaceWriteCoordinator\(\)/g) || []).length, 1)
  for (const pattern of [
    /new ShadowImportService\(legacyWorkspace, databases, workspaceWrites\)/,
    /new SqliteManuscriptService\(databases, trashAdapter, workspaceWrites\)/,
    /new WorkspaceBackupService\([^;]+workspaceWrites \)/,
    /new RealTrialService\(databases, projects, undefined, workspaceWrites\)/,
    /new IdeaGenerationService\([^;]+workspaceWrites\s*[,)]/,
    /new OutlineExpansionTaskService\([^;]+workspaceWrites\s*\)/,
    /new OutlineExpansionAdoptionService\([^;]+workspaceWrites\s*\)/
  ]) assert.match(compact, pattern)

  assert.match(compact, /createWritingTaskRuntime\(\{[^}]+workspaceWrites \}\)/)
  const writingTaskWiring = readFileSync(new URL('../../../src/main/modules/assistant/runtime/writing-task-runtime.ts', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(writingTaskWiring, /}, workspaceWrites\s*\)/)
  assert.match(compact, /const withWorkspaceDatabaseWrite = <T>[^;]+workspaceWrites\.run\(workItemId/)
  assert.match(writingTaskWiring, /workspaceWrites\.run\(workItemPath/)
})
