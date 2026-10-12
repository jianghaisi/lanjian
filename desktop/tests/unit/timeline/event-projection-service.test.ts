import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory } from '../../../src/main/core/ports/workspace-database'
import { EventMigrationCommitService } from '../../../src/main/modules/timeline/application/event-migration-commit-service'
import { EventProjectionService } from '../../../src/main/modules/timeline/application/event-projection-service'
import { EventMirrorSyncService } from '../../../src/main/modules/timeline/application/event-mirror-sync-service'
import { LocalEventMirrorPublisher } from '../../../src/main/modules/timeline/adapters/event-mirror-publisher'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventSourceSnapshotService } from '../../../src/main/modules/timeline/application/event-source-snapshot-service'
import { eventMigrationMirrorAcknowledgements, type EventMigrationDecisionsInput } from '../../../src/main/modules/timeline/domain/event-migration-decisions'
import { inspectEventMigrationSources, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import type { EventSnapshotScope } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { eventReceiptHash } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-19T08:00:00.000Z'

type Book = { root: string; scope: EventSnapshotScope; operationId: string }

async function harness(t: TestContext) {
  const parent = await canonicalDirectory(tmpdir())
  const workspace = await canonicalDirectory(await mkdtemp(join(parent, 'lanjian-event-projection-')))
  t.after(async () => {
    assert.equal(dirname(workspace), parent)
    assert.ok(workspace.startsWith(join(parent, 'lanjian-event-projection-')))
    await rm(workspace, { recursive: true, force: true })
  })
  let current: EventSnapshotScope = { workItemId: '', root: '', generation: 0 }
  let serial = 0
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp), () => `projection-${++serial}`)
  const writes = new WorkspaceWriteCoordinator()
  const currentScope = async () => ({ ...current })

  const createBook = async (name: string, rows: unknown[]): Promise<Book> => {
    const candidate = join(workspace, name)
    await mkdir(join(candidate, '.webnovel', 'config'), { recursive: true })
    const root = await canonicalDirectory(candidate)
    const database = await factory.open(root)
    database.close()
    const raw = new DatabaseSync(join(root, '.webnovel', 'workspace.sqlite'))
    try {
      raw.prepare('INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(`internal-${name}`, name, 'active', eventReceiptHash(name), 'sqlite', stamp, stamp)
    } finally { raw.close() }
    await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), JSON.stringify({ version: 1, events: rows }))
    current = { workItemId: `work-${name}`, root, generation: current.generation + 1 }
    const reader = new LocalEventSourceSnapshotReader(factory)
    const sources = new EventSourceSnapshotService(reader, currentScope, writes)
    const reviews = new EventMigrationReviewSession(sources, currentScope, {
      nonce: () => `nonce-${name}-${++serial}`,
      sha256: eventReceiptHash,
      now: () => 1_000
    })
    const commit = new EventMigrationCommitService(reviews, factory, reader, currentScope, writes)
    const preview = await reviews.preview()
    const snapshot = await sources.capture()
    const inspection = inspectEventMigrationSources(snapshot)
    const input: EventMigrationDecisionsInput = {
      fingerprint: snapshot.fingerprint,
      rows: all(inspection.rowsPage).map(row => ({ rowIndex: row.index, disposition: row.defaultDisposition! })),
      acknowledgedGroups: all(inspection.groupsPage).filter(group => group.severity === 'review').map(group => group.id),
      acknowledgedPlanningFindings: all(inspection.planningFindingsPage).flatMap((row, index) => row.severity === 'review' ? [index] : []),
      acknowledgedMirrors: [...eventMigrationMirrorAcknowledgements(snapshot)]
    }
    const reviewed = await reviews.review(preview.previewId, input)
    const result = await commit.commit(reviewed.token)
    return { root, scope: { ...current }, operationId: result.receipt.operationId }
  }

  return {
    factory,
    writes,
    currentScope,
    createBook,
    select(book: Book) { current = { ...book.scope, generation: current.generation + 1 } },
    current: () => ({ ...current })
  }
}

function all<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const page = read(offset)
    result.push(...page.items)
    offset = page.nextOffset
  }
  return result
}

const direct = (id: string, event: string, status?: 'candidate') => ({
  id,
  title: `${event}标题`,
  time: '第一夜',
  characters: '甲、乙',
  location: '城门',
  event,
  result: '',
  ...(status ? { status, confidence: 0 } : {})
})

test('reviewed source order survives migration and reopen instead of sorting generated identities', async t => {
  const h = await harness(t)
  const rows = Array.from({ length: 12 }, (_, index) => direct(`old-${index}`, `顺序${index}`))
  const book = await h.createBook('order', rows)
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const first = await service.read()
  assert.equal(first.ordering, 'author-display')
  assert.deepEqual(first.approved.map(item => item.content.event), rows.map(row => row.event))
  assert.equal(first.state.lifecycles.length, 12)
  assert.ok(first.state.lifecycles.every(item => item.state === 'active' && item.revision === 1))
  h.select(book)
  assert.deepEqual(await service.read(), first)
})

test('an empty migrated book has a verified empty order and lifecycle snapshot', async t => {
  const h = await harness(t)
  await h.createBook('empty-state', [])
  const result = await new EventProjectionService(h.factory, h.currentScope, h.writes).read()
  assert.equal(result.ordering, 'author-display')
  assert.deepEqual(result.state.order.eventIds, [])
  assert.deepEqual(result.state.lifecycles, [])
  assert.deepEqual(result.archived, [])
})

test('5,000 distinct migrated identities preserve the complete order across reorder and reopen', async t => {
  const h = await harness(t)
  const rows = Array.from({ length: 5000 }, (_, index) => direct(`event-${index}`, `第${index}项独立事件`))
  const book = await h.createBook('long-order', rows)
  const timings = new Map<string, { calls: number; ms: number }>()
  const measured: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'> = {
    openEventReadOnly: async root => {
      const start = performance.now(), database = (await h.factory.openEventReadOnly(root))!
      timings.set('open', { calls: 1, ms: performance.now() - start })
      return new Proxy({ ...database }, { get(target, property) {
        const value = Reflect.get(target, property)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const started = performance.now()
          try { return Reflect.apply(value, target, args) } finally {
            const key = String(property), previous = timings.get(key) ?? { calls: 0, ms: 0 }
            timings.set(key, { calls: previous.calls + 1, ms: previous.ms + performance.now() - started })
          }
        }
      } })
    }
  }
  const service = new EventProjectionService(measured, h.currentScope, h.writes)
  const start = performance.now(), initial = await service.read()
  t.diagnostic(`5000-identity verified projection: ${Math.round(performance.now() - start)} ms`)
  t.diagnostic(JSON.stringify(Object.fromEntries([...timings].map(([key, value]) => [key, { calls: value.calls, ms: Math.round(value.ms) }]))))
  assert.deepEqual(initial.approved.map(item => item.content.event), rows.map(item => item.event))
  assert.equal(initial.state.lifecycles.length, 5000)
  const reversed = [...initial.state.order.eventIds].reverse()
  appendOrder(book, reversed)
  h.select(book)
  const after = await service.read()
  assert.deepEqual(after.state.order.eventIds, reversed)
  assert.deepEqual(after.approved.map(item => item.content.event), rows.map(item => item.event).reverse())
})

function rawBook<T>(book: Book, run: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(join(book.root, '.webnovel', 'workspace.sqlite'))
  try { database.exec('PRAGMA foreign_keys=ON'); return run(database) } finally { database.close() }
}

// Storage fixtures only: public archive/reorder authorization and placement
// checks are a separate application gate, never bypassed by a product endpoint.
function appendLifecycle(book: Book, eventId: string, state: 'active' | 'archived') {
  rawBook(book, db => {
    const previous = db.prepare('SELECT * FROM event_lifecycle_versions WHERE event_id=? ORDER BY revision DESC LIMIT 1').get(eventId)!
    const head = db.prepare('SELECT latest_version_id FROM canonical_event_version_heads WHERE event_id=?').get(eventId)!
    db.prepare(`INSERT INTO event_lifecycle_versions
      (id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), previous.project_id!, eventId, Number(previous.revision) + 1, previous.id!, head.latest_version_id!, state, stamp)
  })
}

function appendOrder(book: Book, eventIds: readonly string[]) {
  rawBook(book, db => {
    const previous = db.prepare('SELECT * FROM event_display_order_versions ORDER BY revision DESC LIMIT 1').get()!
    const json = JSON.stringify(eventIds)
    db.prepare(`INSERT INTO event_display_order_versions
      (id,project_id,revision,previous_id,event_ids_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), previous.project_id!, Number(previous.revision) + 1, previous.id!, json, eventReceiptHash(json), stamp)
  })
}

function corruptHistory(book: Book, table: 'event_lifecycle_versions' | 'event_display_order_versions', action: 'update' | 'delete', sql: string) {
  rawBook(book, db => {
    const name = `${table}_no_${action}`
    const definition = db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)!.sql as string
    db.exec(`DROP TRIGGER ${name}`)
    try { db.exec(sql) } finally { db.exec(definition) }
  })
}

test('archive and restore preserve approved/pending heads, while display order changes independently', async t => {
  const h = await harness(t)
  const book = await h.createBook('lifecycle', [direct('a', '甲'), direct('b', '乙')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const initial = await service.read(), firstId = initial.approved[0]!.eventId
  const pending = appendPending(book, firstId, '甲的新候选')
  const before = await service.read()
  appendLifecycle(book, firstId, 'archived')
  const archived = await service.read()
  assert.deepEqual(archived.approved, [before.approved[1]])
  assert.deepEqual(archived.candidates, [])
  assert.deepEqual(archived.archived[0]!.approved, before.approved[0])
  assert.equal(archived.archived[0]!.candidate!.versionId, pending.id)
  assert.notEqual(archived.approvedRevision, before.approvedRevision)
  assert.deepEqual(archived.state.order, before.state.order)
  assert.ok(Object.isFrozen(archived.archived[0]))
  assert.ok(Object.isFrozen(archived.state.lifecycles[0]))
  assert.ok(Object.isFrozen(archived.state.order.eventIds))
  const reversed = [...before.state.order.eventIds].reverse()
  appendOrder(book, reversed)
  const reordered = await service.read()
  assert.deepEqual(reordered.state.order.eventIds, reversed)
  assert.deepEqual(reordered.archived, archived.archived)
  assert.equal(reordered.approvedRevision, archived.approvedRevision)
  assert.notEqual(reordered.revision, archived.revision)
  appendLifecycle(book, firstId, 'active')
  const restored = await service.read()
  assert.deepEqual(restored.archived, [])
  assert.deepEqual(restored.approved, [...before.approved].reverse())
  assert.deepEqual(restored.candidates, before.candidates)
  assert.equal(restored.state.lifecycles.find(item => item.eventId === firstId)!.revision, 3)
  assert.equal(restored.state.order.revision, 2)
  assert.deepEqual(rawBook(book, db => db.prepare('SELECT id FROM canonical_event_versions WHERE event_id=? ORDER BY version_no').all(firstId)).map(row => row.id),
    [initial.approved[0]!.versionId, pending.id])
})

test('old transitioned books without state are unavailable and reads never invent defaults', async t => {
  const h = await harness(t), book = await h.createBook('uninitialized', [direct('a', '甲')])
  corruptHistory(book, 'event_lifecycle_versions', 'delete', 'DELETE FROM event_lifecycle_versions')
  corruptHistory(book, 'event_display_order_versions', 'delete', 'DELETE FROM event_display_order_versions')
  const bytes = await readFile(join(book.root, '.webnovel', 'workspace.sqlite'))
  const entries = await readdir(join(book.root, '.webnovel'))
  await assert.rejects(new EventProjectionService(h.factory, h.currentScope, h.writes).read(), { code: 'FEATURE_UNAVAILABLE' })
  await assert.rejects(new EventProjectionService(h.factory, h.currentScope, h.writes).readForConsumer(), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await readFile(join(book.root, '.webnovel', 'workspace.sqlite')), bytes)
  assert.deepEqual(await readdir(join(book.root, '.webnovel')), entries)
})

test('a retained lifecycle chain cannot move its held content version backwards', async t => {
  const h = await harness(t), book = await h.createBook('regressing-version', [direct('a', '甲')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const original = (await service.read()).approved[0]!
  appendPending(book, original.eventId, '较新的待审版本')
  appendLifecycle(book, original.eventId, 'archived')
  appendLifecycle(book, original.eventId, 'active')
  corruptHistory(book, 'event_lifecycle_versions', 'update',
    `UPDATE event_lifecycle_versions SET expected_event_version_id='${original.versionId}' WHERE revision=3`)
  await assert.rejects(service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
})

for (const damage of ['old-order-hash', 'old-lifecycle-version', 'missing-lifecycle', 'missing-order', 'broken-order-chain', 'altered-initial-order'] as const) {
  test(`state history corruption fails closed: ${damage}`, async t => {
    const h = await harness(t), book = await h.createBook(`damage-${damage}`, [direct('a', '甲'), direct('b', '乙')])
    const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
    const initial = await service.read()
    appendOrder(book, [...initial.state.order.eventIds].reverse())
    appendLifecycle(book, initial.approved[0]!.eventId, 'archived')
    if (damage === 'old-order-hash') corruptHistory(book, 'event_display_order_versions', 'update',
      `UPDATE event_display_order_versions SET content_hash='${'0'.repeat(64)}' WHERE revision=1`)
    if (damage === 'old-lifecycle-version') corruptHistory(book, 'event_lifecycle_versions', 'update',
      `UPDATE event_lifecycle_versions SET expected_event_version_id='${initial.approved[1]!.versionId}' WHERE event_id='${initial.approved[0]!.eventId}' AND revision=1`)
    if (damage === 'missing-lifecycle') corruptHistory(book, 'event_lifecycle_versions', 'delete',
      `DELETE FROM event_lifecycle_versions WHERE event_id='${initial.approved[1]!.eventId}'`)
    if (damage === 'missing-order') corruptHistory(book, 'event_display_order_versions', 'delete',
      'DELETE FROM event_display_order_versions WHERE revision=2; DELETE FROM event_display_order_versions WHERE revision=1')
    if (damage === 'broken-order-chain') corruptHistory(book, 'event_display_order_versions', 'update',
      'UPDATE event_display_order_versions SET previous_id=NULL WHERE revision=2')
    if (damage === 'altered-initial-order') {
      const json = JSON.stringify([...initial.state.order.eventIds].reverse())
      corruptHistory(book, 'event_display_order_versions', 'update',
        `UPDATE event_display_order_versions SET event_ids_json='${json}',content_hash='${eventReceiptHash(json)}' WHERE revision=1`)
    }
    const bytes = await readFile(join(book.root, '.webnovel', 'workspace.sqlite'))
    await assert.rejects(service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
    assert.deepEqual(await readFile(join(book.root, '.webnovel', 'workspace.sqlite')), bytes)
  })
}

// Fixture-only append: compatibility content and mirror still point at the approved head.
function appendPending(book: Book, eventId: string, event: string) {
  const raw = new DatabaseSync(join(book.root, '.webnovel', 'workspace.sqlite'))
  try {
    const projectId = raw.prepare('SELECT id FROM projects').get()!.id as string
    const versions = new CanonicalEventVersions(raw, projectId, randomUUID)
    const heads = versions.heads(eventId)!
    const approved = versions.list(eventId).find(version => version.id === heads.approvedVersionId)!
    raw.exec('BEGIN IMMEDIATE')
    const pending = versions.append(eventId, heads.latestVersionId, {
      content: { ...approved.content, event }, status: 'candidate',
      granularity: approved.granularity, phase: approved.phase, creator: 'model-candidate',
      sources: [{ relation: 'supersedes', source: { kind: 'event', id: eventId, revision: approved.id } }]
    }, stamp)
    raw.exec('COMMIT')
    return pending
  } finally { raw.close() }
}

test('verified read reuse stays inside one immutable snapshot and never shares caller mutations', async t => {
  const h = await harness(t), book = await h.createBook('pinned', [direct('a', '固定快照')])
  const initial = await new EventProjectionService(h.factory, h.currentScope, h.writes).read()
  const eventId = initial.approved[0]!.eventId
  const pending = appendPending(book, eventId, '第一次待审')
  const snapshot = (await h.factory.openEventReadOnly(book.root))!
  try {
    const first = snapshot.listCanonicalEventVersions(eventId)
    first[0]!.content.characters.push('伪造人物')
    first[1]!.sources[0]!.source.revision = 'forged'
    first.pop()
    const next = snapshot.listCanonicalEventVersions(eventId)
    assert.equal(next.length, 2)
    assert.deepEqual(next[0]!.content.characters, initial.approved[0]!.content.characters)
    assert.deepEqual(next[1], pending)
    next[1]!.content.event = '调用方临时修改'
    const heads = snapshot.canonicalEventVersionHeads(eventId)!
    heads.latestVersionId = 'forged'
    assert.equal(snapshot.canonicalEventVersionHeads(eventId)!.latestVersionId, pending.id)
    const receipt = snapshot.eventMigrationReceipt()!
    assert.throws(() => { (receipt.sourceCounts as { timeline: number }).timeline = 99 }, TypeError)
    assert.throws(() => snapshot.eventMigrationReceipt('unknown-operation'), { code: 'NOT_FOUND' })
    assert.deepEqual(snapshot.eventMigrationReceipt(), receipt)
    const later = appendPending(book, eventId, '第二次待审')
    assert.deepEqual(snapshot.listCanonicalEventVersions(eventId)[1], pending)
    assert.equal(snapshot.canonicalEventVersionHeads(eventId)!.latestVersionId, pending.id)
    const fresh = (await h.factory.openEventReadOnly(book.root))!
    try {
      assert.equal(fresh.listCanonicalEventVersions(eventId).length, 3)
      assert.equal(fresh.canonicalEventVersionHeads(eventId)!.latestVersionId, later.id)
    } finally { fresh.close() }
  } finally { snapshot.close() }
  assert.throws(() => snapshot.eventMigrationReceipt(), { code: 'STORAGE_ERROR' })
  assert.throws(() => snapshot.listCanonicalEventVersions(eventId), { code: 'STORAGE_ERROR' })
  assert.throws(() => snapshot.canonicalEventVersionHeads(eventId), { code: 'STORAGE_ERROR' })
  snapshot.close()
})

test('an ordinary version reader observes every write on the same connection', async t => {
  const h = await harness(t), book = await h.createBook('live-writer', [direct('a', '正式内容')])
  const eventId = (await new EventProjectionService(h.factory, h.currentScope, h.writes).read()).approved[0]!.eventId
  rawBook(book, database => {
    const projectId = database.prepare('SELECT id FROM projects').get()!.id as string
    assert.throws(() => new CanonicalEventVersions(database, projectId, randomUUID, true), { code: 'FEATURE_UNAVAILABLE' })
    const versions = new CanonicalEventVersions(database, projectId, randomUUID)
    const first = versions.list(eventId)[0]!
    database.exec('BEGIN IMMEDIATE')
    const next = versions.append(eventId, first.id, { ...first, content: { ...first.content, event: '新增待审' },
      status: 'candidate', creator: 'model-candidate' }, stamp)
    assert.equal(versions.list(eventId).length, 2)
    assert.equal(versions.heads(eventId)!.latestVersionId, next.id)
    database.exec('ROLLBACK')
    assert.equal(versions.list(eventId).length, 1)
    assert.equal(versions.heads(eventId)!.latestVersionId, first.id)
  })
})

test('pending revisions remain visible beside the approved head without changing approved dependencies', async t => {
  const h = await harness(t)
  const book = await h.createBook('pending', [direct('event', '正式内容')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const before = await service.read()
  const eventId = before.approved[0]!.eventId
  const pending = appendPending(book, eventId, '待审修改')
  const bytes = await readFile(join(book.root, '.webnovel', 'workspace.sqlite'))
  const entries = await readdir(join(book.root, '.webnovel'))
  const after = await service.read()
  assert.deepEqual(await readFile(join(book.root, '.webnovel', 'workspace.sqlite')), bytes)
  assert.deepEqual(await readdir(join(book.root, '.webnovel')), entries)
  assert.deepEqual(after.approved, before.approved)
  assert.deepEqual(after.candidates.map(item => item.versionId), [pending.id])
  assert.deepEqual(after.candidates[0]!.sources, pending.sources)
  assert.ok(Object.isFrozen(after.candidates[0]!.sources))
  assert.ok(Object.isFrozen(after.candidates[0]!.sources[0]))
  assert.ok(Object.isFrozen(after.candidates[0]!.sources[0]!.source))
  assert.match(before.approvedRevision, /^[a-f0-9]{64}$/)
  assert.equal(after.approvedRevision, before.approvedRevision)
  assert.notEqual(after.candidateRevision, before.candidateRevision)
  assert.notEqual(after.revision, before.revision)

  const next = appendPending(book, eventId, '第二次待审修改')
  const latest = await service.read()
  assert.deepEqual(latest.candidates.map(item => item.versionId), [next.id])
  assert.equal(latest.approvedRevision, before.approvedRevision)
  const database = await h.factory.openEventReadOnly(book.root)
  try { assert.equal(database!.listCanonicalEventVersions(eventId).length, 3) } finally { database?.close() }
})

test('mirror acknowledgement changes presentation without invalidating event dependencies', async t => {
  const h = await harness(t)
  await h.createBook('mirror', [direct('event', '正式内容'), direct('candidate', '待审内容', 'candidate')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const before = await service.read()
  const mirrors = new EventMirrorSyncService(h.factory, new LocalEventMirrorPublisher(), h.currentScope, h.writes)
  await mirrors.retry()
  const after = await service.read()
  assert.notDeepEqual(after.mirror, before.mirror)
  assert.match(before.approvedRevision, /^[a-f0-9]{64}$/)
  assert.match(before.candidateRevision, /^[a-f0-9]{64}$/)
  assert.equal(after.approvedRevision, before.approvedRevision)
  assert.equal(after.candidateRevision, before.candidateRevision)
  assert.notEqual(after.revision, before.revision)
})

test('a missing database is unavailable, not a book-switch conflict', async t => {
  const h = await harness(t)
  const seed = await h.createBook('seed', [direct('seed', '已迁移')])
  const candidate = join(seed.root, '..', 'missing')
  await mkdir(candidate)
  const root = await canonicalDirectory(candidate)
  h.select({ root, scope: { workItemId: 'work-missing', root, generation: 99 }, operationId: '' })
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  await assert.rejects(service.read(), { code: 'FEATURE_UNAVAILABLE' })
  assert.equal(await service.readForConsumer(), null)
  assert.deepEqual(await readdir(root), [])
})

test('A → B → A while opening invalidates the original generation and closes its snapshot', async t => {
  const h = await harness(t)
  const a = await h.createBook('aba-a', [direct('a', '甲书事件')])
  const b = await h.createBook('aba-b', [direct('b', '乙书事件')])
  h.select(a)
  let closes = 0
  const switching: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'> = {
    openEventReadOnly: async root => {
      const database = (await h.factory.openEventReadOnly(root))!
      h.select(b)
      h.select(a)
      return { ...database, close() { closes++; database.close() } }
    }
  }
  await assert.rejects(new EventProjectionService(switching, h.currentScope, h.writes).read(), { code: 'CONFLICT' })
  assert.equal(closes, 1)
})

test('corrupt pending history is rejected even when an approved head exists', async t => {
  const h = await harness(t)
  const book = await h.createBook('corrupt', [direct('event', '正式内容')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  const before = await service.read()
  const pending = appendPending(book, before.approved[0]!.eventId, '待审修改')
  const raw = new DatabaseSync(join(book.root, '.webnovel', 'workspace.sqlite'))
  try {
    const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'canonical_event_versions_no_update'").get()!.sql as string
    raw.exec('DROP TRIGGER canonical_event_versions_no_update')
    raw.prepare("UPDATE canonical_event_versions SET payload_json = json_set(payload_json, '$.content.event', '损坏内容') WHERE id = ?").run(pending.id)
    raw.exec(trigger)
  } finally { raw.close() }
  await assert.rejects(service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('a close failure cannot return a successful projection', async t => {
  const h = await harness(t)
  await h.createBook('close', [direct('event', '正式内容')])
  let closes = 0
  const failing: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'> = {
    openEventReadOnly: async root => {
      const database = (await h.factory.openEventReadOnly(root))!
      return { ...database, close() { closes++; database.close(); throw new Error(root) } }
    }
  }
  await assert.rejects(new EventProjectionService(failing, h.currentScope, h.writes).read(), error => {
    assert.equal((error as { code: string }).code, 'STORAGE_ERROR')
    assert.equal((error as Error).message.includes(h.current().root), false)
    return true
  })
  assert.equal(closes, 1)
})

test('A → B → A reads stay isolated and keep approved/candidate versions separate', async t => {
  const h = await harness(t)
  const a = await h.createBook('book-a', [direct('a-approved', '甲书正式事件'), direct('a-candidate', '甲书候选事件', 'candidate')])
  const b = await h.createBook('book-b', [direct('b-approved', '乙书正式事件')])
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)

  h.select(a)
  const firstA = await service.read()
  assert.equal(firstA.workItemId, a.scope.workItemId)
  assert.equal(firstA.operationId, a.operationId)
  assert.deepEqual(firstA.approved.map(item => item.content.event), ['甲书正式事件'])
  assert.deepEqual(firstA.candidates.map(item => item.content.event), ['甲书候选事件'])
  assert.throws(() => (firstA.approved[0]!.content.characters as string[]).push('跨书修改'))
  assert.throws(() => (firstA.approved[0]!.content.evidenceRefs as Array<{ sourceId: string; excerpt: string }>).push({ sourceId: 'x', excerpt: 'x' }))

  h.select(b)
  const onlyB = await service.read()
  assert.equal(onlyB.workItemId, b.scope.workItemId)
  assert.equal(onlyB.operationId, b.operationId)
  assert.deepEqual(onlyB.approved.map(item => item.content.event), ['乙书正式事件'])
  assert.deepEqual(onlyB.candidates, [])

  h.select(a)
  const secondA = await service.read()
  assert.equal(secondA.revision, firstA.revision)
  assert.deepEqual(secondA, { ...firstA, workItemId: a.scope.workItemId })
  assert.equal(JSON.stringify([firstA, onlyB, secondA]).includes(h.current().root), false)
})

test('a book switch while the snapshot opens rejects the late result', async t => {
  const h = await harness(t)
  const a = await h.createBook('book-a', [direct('a', '甲书事件')])
  const b = await h.createBook('book-b', [direct('b', '乙书事件')])
  h.select(a)
  const switching: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'> = {
    openEventReadOnly: async root => {
      const database = await h.factory.openEventReadOnly(root)
      h.select(b)
      return database
    }
  }
  await assert.rejects(new EventProjectionService(switching, h.currentScope, h.writes).read(), { code: 'CONFLICT' })
})

test('a reader returning another book is rejected before projection', async t => {
  const h = await harness(t)
  const a = await h.createBook('book-a', [direct('a', '甲书事件')])
  const b = await h.createBook('book-b', [direct('b', '乙书事件')])
  h.select(a)
  const wrongBook: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'> = {
    openEventReadOnly: async () => h.factory.openEventReadOnly(b.root)
  }
  await assert.rejects(new EventProjectionService(wrongBook, h.currentScope, h.writes).read(), { code: 'CONFLICT' })
})

test('an untransitioned book stays unavailable without creating migration evidence', async t => {
  const h = await harness(t)
  const candidate = join((await h.createBook('seed', [direct('seed', '已迁移')])).root, '..', 'plain')
  await mkdir(candidate, { recursive: true })
  const root = await canonicalDirectory(candidate)
  const database = await h.factory.open(root)
  database.close()
  const raw = new DatabaseSync(join(root, '.webnovel', 'workspace.sqlite'))
  try {
    raw.prepare('INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('internal-plain', 'plain', 'active', eventReceiptHash('plain'), 'sqlite', stamp, stamp)
  } finally { raw.close() }
  const plain: Book = { root, scope: { workItemId: 'work-plain', root, generation: 99 }, operationId: '' }
  h.select(plain)
  const service = new EventProjectionService(h.factory, h.currentScope, h.writes)
  await assert.rejects(service.read(), { code: 'FEATURE_UNAVAILABLE' })
  assert.equal(await service.readForConsumer(), null)
  const verify = new DatabaseSync(join(root, '.webnovel', 'workspace.sqlite'), { readOnly: true })
  try { assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM event_module_transitions').get()!.n, 0) } finally { verify.close() }
})
