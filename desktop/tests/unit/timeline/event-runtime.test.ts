import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { createEventRuntime } from '../../../src/main/modules/timeline/runtime/event-runtime'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'

const stamp = '2026-09-20T10:00:00.000Z'
const content = { time: '第三夜', characters: ['林舟'], location: '钟楼', event: '听见倒流钟声', evidenceRefs: [], confidence: 1 }

async function createBook(t: TestContext, factory: SqliteWorkspaceDatabaseFactory, name: string) {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, `lanjian-event-runtime-${name}-`)))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, `lanjian-event-runtime-${name}-`)))
    await rm(root, { recursive: true, force: true })
  })
  ;(await factory.open(root)).close()
  const database = new DatabaseSync(join(root, '.webnovel', 'workspace.sqlite'))
  database.prepare(`INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(`project-${name}`, name, 'active', 'a'.repeat(64), 'sqlite', stamp, stamp)
  database.close()
  await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
  const timeline = JSON.stringify({ version: 1, events: [
    { id: `old-${name}`, title: `${name}旧事`, time: '第一夜', characters: '林舟', location: name, event: '敲门' }
  ] })
  const timelinePath = join(root, '.webnovel', 'config', 'timeline.json')
  await writeFile(timelinePath, timeline)
  return { root, timelinePath, timeline }
}

function collect<T>(read: (offset: number) => { items: readonly T[]; nextOffset: number | null }): T[] {
  const result: T[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const page = read(offset)
    result.push(...page.items)
    offset = page.nextOffset
  }
  return result
}

test('two selected books migrate and accept independent reviewed operations while stale cross-book grants fail', async t => {
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp), randomUUID)
  const a = await createBook(t, factory, 'a'), b = await createBook(t, factory, 'b')
  let current = a.root
  const projects = {
    currentPath: async () => current,
    currentSummary: async () => ({ id: current === a.root ? 'book-a' : 'book-b', path: current })
  }
  const runtime = createEventRuntime(projects, factory, new WorkspaceWriteCoordinator())
  const select = (root: string) => { current = root; runtime.clear() }
  const migrate = async () => {
    const preview = await runtime.reviews.preview()
    const inspection = await runtime.reviews.inspection(preview.previewId)
    const rows = collect(inspection.rowsPage)
    const groups = collect(inspection.groupsPage)
    const findings = collect(inspection.planningFindingsPage)
    const grant = await runtime.reviews.review(preview.previewId, {
      fingerprint: preview.fingerprint,
      rows: rows.map(row => ({ rowIndex: row.index, disposition: row.ref.source === 'sources' ? 'retain-source' : 'keep-separate' })),
      acknowledgedGroups: groups.filter(group => group.severity === 'review').map(group => group.id),
      acknowledgedPlanningFindings: findings.flatMap((finding, index) => finding.severity === 'review' ? [index] : []),
      acknowledgedMirrors: [...preview.requiredMirrorAcknowledgements]
    })
    return runtime.migrations.commit(grant.token)
  }
  const create = async () => {
    const projection = await runtime.projection.read()
    const preview = await runtime.operations.preview({ kind: 'create', expectedOrderId: projection.state.order.id,
      content, granularity: 'macro' })
    return { preview, result: await runtime.operations.commit(preview.token) }
  }

  const migratedA = await migrate()
  assert.equal((await runtime.projection.read()).approved.length, 1)
  const stale = await runtime.operations.preview({ kind: 'create', expectedOrderId: (await runtime.projection.read()).state.order.id,
    content, granularity: 'macro' })
  select(b.root)
  await assert.rejects(runtime.operations.commit(stale.token), { code: 'CONFLICT' })

  const migratedB = await migrate()
  const createdB = await create()
  assert.equal((await runtime.projection.read()).approved.length, 2)
  assert.deepEqual(await runtime.operations.receipt(createdB.preview.operationId), createdB.result.receipt)
  assert.equal(await runtime.operations.receipt(migratedA.receipt.operationId), null)

  select(a.root)
  const createdA = await create()
  const projectionA = await runtime.projection.read()
  assert.equal(projectionA.workItemId, 'book-a')
  assert.equal(projectionA.approved.length, 2)
  assert.deepEqual(await runtime.operations.receipt(createdA.preview.operationId), createdA.result.receipt)
  assert.equal(await runtime.operations.receipt(createdB.preview.operationId), null)

  select(b.root)
  const projectionB = await runtime.projection.read()
  assert.equal(projectionB.workItemId, 'book-b')
  assert.equal(projectionB.approved.length, 2)
  assert.ok(projectionB.approved.every(event => event.content.location !== 'a'))
  assert.deepEqual(await runtime.migrationReceipts.read(migratedB.receipt.operationId), migratedB.receipt)
  assert.deepEqual(await readFile(a.timelinePath, 'utf8'), a.timeline)
  assert.deepEqual(await readFile(b.timelinePath, 'utf8'), b.timeline)
})
