import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { EventMigrationCommitService } from '../../../src/main/modules/timeline/application/event-migration-commit-service'
import { EventMigrationReviewSession, EVENT_MIGRATION_REVIEW_TTL_MS } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventSourceSnapshotService } from '../../../src/main/modules/timeline/application/event-source-snapshot-service'
import { EventMigrationReceiptService } from '../../../src/main/modules/timeline/application/event-migration-receipt-service'
import { EventMirrorSyncService } from '../../../src/main/modules/timeline/application/event-mirror-sync-service'
import { EventStateInitializationService } from '../../../src/main/modules/timeline/application/event-state-initialization-service'
import { eventMigrationMirrorAcknowledgements, type EventMigrationDecisionsInput } from '../../../src/main/modules/timeline/domain/event-migration-decisions'
import { inspectEventMigrationSources, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import type { EventSnapshotScope, EventSourceSnapshot } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { eventReceiptHash as hash, decodeEventMigrationReceiptEvidence } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { LocalEventMirrorPublisher } from '../../../src/main/modules/timeline/adapters/event-mirror-publisher'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'

const stamp = '2026-09-18T09:00:00.000Z'
const direct = { id: 'same-id', title: ' 原标题 ', time: '第二夜', characters: '和田、林与舟', location: '旧城', event: '钟声', result: '' }
const material = { id: 'material-one', provider: 'manual', sourceType: 'manual' as const, title: '资料', capturedAt: stamp, excerpt: '钟声', userNotes: '', contentHash: 'a'.repeat(64) }
const canonical = { id: 'canonical-one', time: '第一夜', characters: ['和田'], location: '旧城', event: '旧事', confidence: 0,
  evidenceRefs: [{ sourceId: material.id, excerpt: '钟声' }], status: 'candidate' as const, createdAt: stamp }

async function fixture(t: TestContext, schema?: number, syncAfterCommit = false) {
  const parent = await canonicalDirectory(tmpdir()), root = await canonicalDirectory(await mkdtemp(join(parent, 'lanjian-event-commit-')))
  t.after(async () => {
    assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'lanjian-event-commit-')))
    assert.equal(await canonicalDirectory(root), root)
    await rm(root, { recursive: true, force: true })
  })
  let serial = 0, now = 1000
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp), () => `created-${++serial}`)
  const path = join(root, '.webnovel', 'workspace.sqlite')
  await mkdir(dirname(path), { recursive: true })
  if (schema === undefined) (await factory.open(root)).close()
  const db = new DatabaseSync(path)
  try {
    if (schema !== undefined) for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= schema)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(migration.version, migration.name, stamp, migration.checksum)
      db.exec(`PRAGMA user_version=${migration.version}`)
    }
    db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('book-one','隔离提交','active',?,'sqlite',?,?)")
      .run('b'.repeat(64), stamp, stamp)
  } finally { db.close() }
  await writeFile(join(root, 'notes.md'), '作者资料不改变。\r\n')
  const scope: EventSnapshotScope = { workItemId: root, root, generation: 1 }
  const currentScope = async () => ({ ...scope }), writes = new WorkspaceWriteCoordinator()
  const reader = new LocalEventSourceSnapshotReader(factory), sources = new EventSourceSnapshotService(reader, currentScope, writes)
  const reviews = new EventMigrationReviewSession(sources, currentScope, { nonce: () => `nonce-${++serial}`, sha256: hash, now: () => now })
  const hooks = { beforeFiles: async () => {}, afterFiles: async () => {} }
  const mirrors = new EventMirrorSyncService(factory, new LocalEventMirrorPublisher(), currentScope, writes)
  const service = new EventMigrationCommitService(reviews, factory, { assertUnchanged: async snapshot => {
    await hooks.beforeFiles(); await reader.assertUnchanged(snapshot); await hooks.afterFiles()
  } }, currentScope, writes, syncAfterCommit ? mirrors : undefined)
  const recovery = new EventMigrationReceiptService(factory, currentScope, writes)
  const put = async (kind: 'sources' | 'events' | 'timeline', rows: unknown[]) => {
    const path = join(root, '.webnovel', kind === 'timeline' ? 'config' : 'research', `${kind}.json`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '\uFEFF' + JSON.stringify({ version: 1, [kind === 'timeline' ? 'events' : kind]: rows }) + '\r\n')
  }
  const prepare = async (edit?: (input: EventMigrationDecisionsInput) => void) => {
    const preview = await reviews.preview(), snapshot = await sources.capture(), inspection = inspectEventMigrationSources(snapshot)
    const input: EventMigrationDecisionsInput = {
      fingerprint: snapshot.fingerprint, rows: all(inspection.rowsPage).map(row => ({ rowIndex: row.index, disposition: row.defaultDisposition! })),
      acknowledgedGroups: all(inspection.groupsPage).filter(group => group.severity === 'review').map(group => group.id),
      acknowledgedPlanningFindings: all(inspection.planningFindingsPage).flatMap((row, index) => row.severity === 'review' ? [index] : []),
      acknowledgedMirrors: [...eventMigrationMirrorAcknowledgements(snapshot)]
    }
    edit?.(input)
    return { ...await reviews.review(preview.previewId, input), previewId: preview.previewId, snapshot }
  }
  return { root, path, factory, scope, currentScope, reader, writes, reviews, service, recovery, mirrors, put, prepare, hooks,
    expire: () => { now += EVENT_MIGRATION_REVIEW_TTL_MS } }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function using<T>(f: Fixture, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100;'); return run(db) } finally { db.close() }
}
function all<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []; let offset: number | null = 0
  while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset }
  return result
}
function logical(f: Fixture) {
  return using(f, db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map(row => [String(row.name), db.prepare(`SELECT * FROM "${row.name}"`).all()])))
}
async function files(root: string, dir = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) Object.assign(result, await files(root, path))
    else if (!item.name.startsWith('workspace.sqlite')) result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}
async function mirrorStatus(f: Fixture) {
  const read = await f.factory.openEventReadOnly(f.root)
  try { return read?.eventMirrorStatus() ?? null } finally { read?.close() }
}
async function seedFiles(f: Fixture) { await f.put('sources', [material]); await f.put('events', [canonical]); await f.put('timeline', [direct]) }

function removeInitialEventState(f: Fixture, tables = ['event_lifecycle_versions', 'event_display_order_versions']) {
  using(f, db => {
    for (const table of tables) {
      const trigger = `${table}_no_delete`
      const sql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(trigger)!.sql)
      db.exec(`DROP TRIGGER ${trigger}`)
      db.exec(`DELETE FROM ${table}`)
      db.exec(sql)
    }
  })
}

test('real commit imports all sources, keeps duplicate identities, resolves forward links and preserves exact files', async t => {
  const f = await fixture(t); await seedFiles(f)
  await f.put('timeline', [direct, direct, direct, { ...direct, id: 'candidate', status: 'candidate', confidence: 0 }])
  const review = await f.prepare(input => { input.rows[2] = { rowIndex: 2, disposition: 'link-existing', targetRowIndex: 4 } })
  const before = await files(f.root), result = await f.service.commit(review.token)
  assert.deepEqual(review.displayOrderRowIndices, [1, 4, 3, 5])
  assert.equal(result.receipt.mappingCount, 6); assert.deepEqual(result.receipt.sourceCounts, { sources: 1, events: 1, timeline: 4 })
  assert.deepEqual(result.mirror, { status: 'pending', issue: 'unavailable' })
  assert.deepEqual(await files(f.root), before)
  using(f, db => {
    const aliases = db.prepare('SELECT * FROM event_migration_source_aliases ORDER BY ordinal').all()
    assert.equal(aliases[2]!.event_id, aliases[4]!.event_id)
    assert.notEqual(aliases[3]!.event_id, aliases[4]!.event_id)
    const order = JSON.parse(String(db.prepare('SELECT event_ids_json FROM event_display_order_versions').get()!.event_ids_json))
    assert.deepEqual(order, review.displayOrderRowIndices.map(index => aliases[index]!.event_id))
    const payload = JSON.parse(String(db.prepare('SELECT payload_json FROM canonical_event_versions WHERE id=?').get(aliases[5]!.event_version_id)!.payload_json))
    assert.equal(payload.status, 'candidate'); assert.equal(payload.content.confidence, 0)
    assert.equal(payload.content.rawCharacters, direct.characters); assert.equal(payload.content.title, direct.title)
    const archived = decodeEventMigrationReceiptEvidence(String(db.prepare('SELECT source_snapshot_json FROM event_migration_receipts').get()!.source_snapshot_json))
    assert.deepEqual(archived.snapshot, review.snapshot)
    const mirror = db.prepare("SELECT * FROM mirror_entries WHERE source_type='canonical_events_json'").get()!
    assert.equal(mirror.status, 'pending'); assert.equal(mirror.previous_observed_hash, review.snapshot.files.events.hash)
  })
  assert.deepEqual(await f.recovery.read(review.operationId), result.receipt)
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(await f.recovery.read(), result.receipt)
  assert.equal(JSON.stringify(result).includes(f.root), false)
})

test('explicit state recovery rebuilds only the sealed migration order and rejects token replay', async t => {
  const f = await fixture(t); await seedFiles(f)
  const reviewed = await f.prepare(), migrated = await f.service.commit(reviewed.token)
  const expectedOrder = using(f, db => JSON.parse(String(db.prepare('SELECT event_ids_json FROM event_display_order_versions').get()!.event_ids_json)))
  removeInitialEventState(f)
  const before = await files(f.root)
  const service = new EventStateInitializationService(f.factory, f.currentScope, f.writes,
    { nonce: () => 'state-recovery-token', now: () => 20_000 })
  const preview = await service.preview()
  assert.equal(preview.token, 'state-recovery-token:1')
  assert.equal(preview.migrationOperationId, migrated.receipt.operationId)
  assert.equal(preview.eventCount, expectedOrder.length)
  assert.equal(preview.orderHash, hash(JSON.stringify(expectedOrder)))
  await service.commit(preview.token)
  assert.deepEqual(await files(f.root), before)
  const read = await f.factory.openEventReadOnly(f.root)
  try {
    assert.deepEqual(read!.eventState()!.order.eventIds, expectedOrder)
    assert.deepEqual(read!.eventState()!.lifecycles.map(item => item.createdAt), expectedOrder.map(() => migrated.receipt.committedAt))
  } finally { read?.close() }
  await assert.rejects(service.commit(preview.token), { code: 'CONFLICT' })
})

test('state recovery refuses partial state instead of repairing around it', async t => {
  const f = await fixture(t); await f.put('timeline', [direct])
  const reviewed = await f.prepare(); await f.service.commit(reviewed.token)
  removeInitialEventState(f, ['event_display_order_versions'])
  const service = new EventStateInitializationService(f.factory, f.currentScope, f.writes,
    { nonce: () => 'partial-state-token', now: () => 20_000 })
  await assert.rejects(service.preview(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.equal(using(f, db => Number(db.prepare('SELECT count(*) AS n FROM event_lifecycle_versions').get()!.n)), 1)
  assert.equal(using(f, db => Number(db.prepare('SELECT count(*) AS n FROM event_display_order_versions').get()!.n)), 0)
})

test('existing approved head, later candidate and unversioned canonical metadata remain unchanged', async t => {
  const f = await fixture(t), db = await f.factory.open(f.root)
  try {
    db.importMaterialSources([material]); db.importCanonicalEvents([canonical, { ...canonical, id: 'unversioned', event: '另一事', conflictGroupId: 'conflict-retained' }])
    db.approveCanonicalEvent(canonical.id)
    const head = db.canonicalEventVersionHeads(canonical.id)!
    db.appendCanonicalEventVersion({ ...db.listCanonicalEventVersions(canonical.id).at(-1)!, expectedVersionId: head.latestVersionId,
      content: { ...canonical, event: '尚待核对的更改' }, status: 'candidate', creator: 'author',
      sources: [{ relation: 'derived-from', source: { kind: 'material', id: material.id, revision: material.contentHash } }] })
  } finally { db.close() }
  const review = await f.prepare(), before = using(f, db => db.prepare('SELECT * FROM canonical_events ORDER BY id').all())
  const result = await f.service.commit(review.token)
  assert.equal(result.receipt.mappingCount, 3)
  assert.deepEqual(using(f, db => db.prepare('SELECT * FROM canonical_events ORDER BY id').all()), before)
  using(f, db => {
    const selected = db.prepare("SELECT event_version_id FROM event_migration_source_aliases WHERE original_id=?").get(canonical.id)!.event_version_id
    const old = review.snapshot.eventHistory.find(item => item.eventId === canonical.id)!
    assert.equal(selected, old.heads!.approvedVersionId)
    assert.equal(db.prepare('SELECT expected_event_version_id FROM event_lifecycle_versions WHERE event_id=?').get(canonical.id)!.expected_event_version_id,
      old.heads!.latestVersionId)
    const versions = new CanonicalEventVersions(db, 'book-one', () => 'never')
    assert.deepEqual(versions.list(canonical.id), old.versions)
    const baseline = versions.list('unversioned')[0]!
    assert.equal(baseline.status, 'candidate'); assert.deepEqual(baseline.sources, [])
  })
})

test('empty commit is sealed, can be recovered and exact private retry never allocates another identity', async t => {
  const f = await fixture(t), review = await f.prepare(), claim = await f.reviews.claimConfirmation(review.token)
  const db = await f.factory.openEventMigrationWrite(f.root)
  try {
    const first = db.commit(claim, () => {}), before = logical(f)
    assert.equal(first.mappingCount, 0); assert.deepEqual(db.commit(claim, () => {}), first)
    assert.deepEqual(logical(f), before)
    assert.throws(() => db.commit({ ...claim, operationId: 'wrong-operation' }, () => {}), { code: 'CONFLICT' })
    assert.deepEqual(logical(f), before)
  } finally { db.close() }
})

for (const [table, action] of [
  ['material_sources', 'INSERT'], ['canonical_events', 'INSERT'], ['canonical_event_versions', 'INSERT'],
  ['canonical_event_version_seals', 'INSERT'], ['canonical_event_version_heads', 'INSERT'], ['projects', 'UPDATE'],
  ['event_migration_receipts', 'INSERT'], ['event_migration_source_aliases', 'INSERT'],
  ['event_migration_receipt_seals', 'INSERT'], ['event_module_transitions', 'INSERT'], ['mirror_entries', 'INSERT'],
  ['event_lifecycle_versions', 'INSERT'], ['event_display_order_versions', 'INSERT']
]) test(`failure after ${table} ${action} rolls back the entire real transaction`, async t => {
  const f = await fixture(t); await seedFiles(f)
  using(f, db => db.exec(`CREATE TRIGGER inject_commit_fault AFTER ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected commit fault'); END`))
  const review = await f.prepare(), before = logical(f), originals = await files(f.root)
  await assert.rejects(f.service.commit(review.token), { code: 'STORAGE_ERROR' })
  assert.deepEqual(logical(f), before); assert.deepEqual(await files(f.root), originals)
  assert.equal(await f.recovery.read(), null)
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
})

for (const kind of ['sources', 'events', 'timeline'] as const) test(`changed ${kind} bytes after claim reject before write`, async t => {
  const f = await fixture(t); await seedFiles(f)
  const review = await f.prepare(), before = logical(f)
  f.hooks.beforeFiles = async () => { await f.put(kind, []) }
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
})

for (const mode of ['cancel', 'switch', 'expiry'] as const) test(`${mode} after claim remains active through the commit boundary`, async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare(), before = logical(f)
  f.hooks.afterFiles = async () => {
    if (mode === 'cancel') f.reviews.cancel(review.previewId)
    if (mode === 'switch') f.scope.generation++
    if (mode === 'expiry') f.expire()
  }
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
})

for (const change of ['readiness', 'timeline-revision', 'planning', 'head', 'material', 'chapter', 'partial-import'] as const) {
  test(`live ${change} drift after last file check is rejected under the write lock`, async t => {
    const f = await fixture(t), db = await f.factory.open(f.root)
    try {
      db.importMaterialSources([material]); db.importCanonicalEvents([canonical]); db.baselineCanonicalEventVersions()
      const content = JSON.stringify({ version: 1, events: [direct] }); db.importWorkspaceConfig('timeline', content, hash(content))
    } finally { db.close() }
    const review = await f.prepare()
    let changed: ReturnType<typeof logical>
    f.hooks.afterFiles = async () => {
      const db = await f.factory.open(f.root)
      try {
        if (change === 'readiness') using(f, sql => sql.exec('UPDATE projects SET canonical_events_ready=0'))
        if (change === 'timeline-revision') using(f, sql => sql.exec("UPDATE workspace_config_documents SET revision=revision+1 WHERE kind='timeline'"))
        if (change === 'planning') {
          const content = JSON.stringify({ version: 1, total: { revision: 0, hash: '' }, volumes: [], assignments: [], chapters: [], chapterPlacements: [], manuscriptStarts: [], eventChapterPlacements: [], chapterConfirmations: [], outlineReviewAcknowledgements: [], planningConfirmations: [] })
          db.importOutlinePlanningState(content, hash(content))
        }
        if (change === 'head') db.approveCanonicalEvent(canonical.id)
        if (change === 'material') db.updateMaterialSource({ ...material, excerpt: '已修改', contentHash: 'c'.repeat(64) })
        if (change === 'chapter') db.createFormalChapter()
        if (change === 'partial-import') using(f, sql => sql.exec('UPDATE projects SET material_sources_ready=0'))
      } finally { db.close() }
      changed = logical(f)
    }
    await assert.rejects(f.service.commit(review.token), error => error instanceof AppError && ['CONFLICT', 'DATABASE_INTEGRITY_FAILED'].includes(error.code))
    assert.deepEqual(logical(f), changed!)
  })
}

test('another SQLite writer blocks commit without leaking rows or an untyped busy error', async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare(), before = logical(f)
  const lock = new DatabaseSync(f.path)
  try {
    f.hooks.afterFiles = async () => { lock.exec('BEGIN IMMEDIATE') }
    await assert.rejects(f.service.commit(review.token), { code: 'STORAGE_ERROR' })
  } finally { lock.exec('ROLLBACK'); lock.close() }
  assert.deepEqual(logical(f), before)
})

test('final authorization failure after rows were inserted rolls everything back', async t => {
  const f = await fixture(t); await seedFiles(f); const review = await f.prepare(), claim = await f.reviews.claimConfirmation(review.token), before = logical(f)
  const db = await f.factory.openEventMigrationWrite(f.root); let checks = 0
  try { assert.throws(() => db.commit(claim, () => { if (++checks === 3) throw new AppError('CONFLICT', '测试取消') }), { code: 'CONFLICT' }) }
  finally { db.close() }
  assert.equal(checks, 3); assert.deepEqual(logical(f), before)
})

test('a source absent during review cannot appear before commit', async t => {
  const f = await fixture(t), review = await f.prepare(), before = logical(f)
  f.hooks.beforeFiles = async () => {
    const path = join(f.root, '.webnovel', 'planning', 'outline-state.json')
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, '{}')
  }
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
})

test('a connection-close failure after commit has safe wording and recovers the actual receipt without replay', async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare()
  const service = new EventMigrationCommitService(f.reviews, {
    openEventMigrationWrite: async root => {
      const port = await f.factory.openEventMigrationWrite(root)
      return { commit: port.commit, close: () => { port.close(); throw new Error('PRIVATE-PATH-AND-CONTENT') } }
    }
  }, f.reader, async () => ({ ...f.scope }), f.writes)
  await assert.rejects(service.commit(review.token), error => error instanceof AppError && error.code === 'STORAGE_ERROR'
    && !error.message.includes('PRIVATE') && error.message.includes('回执') && !error.message.includes('未提交'))
  const receipt = await f.recovery.read(review.operationId)
  assert.equal(receipt?.mappingCount, 1)
  await assert.rejects(service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(await f.recovery.read(), receipt)
})

test('pre-existing hidden material rows in an unready module cannot be silently merged', async t => {
  const f = await fixture(t), db = await f.factory.open(f.root)
  try { db.importMaterialSources([material]) } finally { db.close() }
  using(f, db => db.exec('UPDATE projects SET material_sources_ready=0'))
  const review = await f.prepare(), before = logical(f)
  await assert.rejects(f.service.commit(review.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
})

test('simultaneous confirmations consume one token and create one receipt', async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare()
  const results = await Promise.allSettled([f.service.commit(review.token), f.service.commit(review.token)])
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1)
  const failure = results.find(value => value.status === 'rejected') as PromiseRejectedResult
  assert.equal(failure.reason.code, 'CONFLICT')
  assert.equal(using(f, db => db.prepare('SELECT count(*) AS n FROM event_migration_receipts').get()!.n), 1)
})

test('cancel while queued after claim blocks the transaction when its write lane becomes available', async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare(), before = logical(f)
  const originalRun = f.writes.run.bind(f.writes)
  let calls = 0, release!: () => void, queued!: () => void
  const occupied = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { queued = resolve })
  f.writes.run = async (root, action) => {
    if (++calls === 2) { void originalRun(root, () => occupied); queued() }
    return originalRun(root, action)
  }
  const result = f.service.commit(review.token), rejected = assert.rejects(result, { code: 'CONFLICT' })
  await ready
  f.reviews.cancel(review.previewId); release()
  await rejected
  assert.deepEqual(logical(f), before)
})

test('forged payload or decision fingerprint fails even at the private transaction boundary', async t => {
  const f = await fixture(t); await f.put('timeline', [direct]); const review = await f.prepare(), claim = await f.reviews.claimConfirmation(review.token)
  const before = logical(f), db = await f.factory.openEventMigrationWrite(f.root)
  try {
    assert.throws(() => db.commit({ ...claim, decisionFingerprint: '0'.repeat(64) }, () => {}), { code: 'CONFLICT' })
    assert.throws(() => db.commit({ ...claim, payloads: { ...claim.payloads, rows: [] } }, () => {}), { code: 'CONFLICT' })
  } finally { db.close() }
  assert.deepEqual(logical(f), before)
})

test('migration retires old timeline writes and held mirrors while retaining the exact SQLite document', async t => {
  const f = await fixture(t), db = await f.factory.open(f.root), content = JSON.stringify({ version: 1, events: [direct] })
  try {
    const old = db.importWorkspaceConfig('timeline', content, hash(content)).mirror!
    db.importMaterialSources([]); db.importCanonicalEvents([])
    const eventPlan = db.readableMirrorPlans({ sourceTypes: ['canonical_events_json'] })[0]!
    const before = db.workspaceConfig('timeline'), review = await f.prepare()
    await f.service.commit(review.token)
    assert.deepEqual(db.workspaceConfig('timeline'), before)
    assert.equal(db.workspaceConfigMirror('timeline'), null)
    assert.equal(db.readableMirrorPlans({ sourceTypes: ['canonical_events_json'] }).length, 0)
    assert.throws(() => db.replaceWorkspaceConfig('timeline', hash(content), content, hash(content)), { code: 'CONFLICT' })
    assert.throws(() => db.importWorkspaceConfig('timeline', content, hash(content)), { code: 'CONFLICT' })
    assert.throws(() => db.importCanonicalEvents([]), { code: 'CONFLICT' })
    assert.throws(() => db.createCanonicalEvent(canonical), { code: 'CONFLICT' })
    assert.throws(() => db.approveCanonicalEvent(canonical.id), { code: 'CONFLICT' })
    assert.throws(() => db.baselineCanonicalEventVersions(), { code: 'CONFLICT' })
    assert.throws(() => db.assertMirrorPlanCurrent(old), { code: 'CONFLICT' })
    assert.throws(() => db.assertMirrorPlanCurrent(eventPlan), { code: 'CONFLICT' })
    // Exercise the existing filesystem publisher with an already-held old plan.
    const publisher = Object.create(SqliteManuscriptService.prototype) as { syncPlan(root: string, database: typeof db, plan: typeof old): Promise<unknown> }
    const originals = await files(f.root)
    await assert.rejects(publisher.syncPlan(f.root, db, old), { code: 'CONFLICT' })
    assert.deepEqual(await files(f.root), originals)
  } finally { db.close() }
})

test('write opening rejects absent and old databases without creating or upgrading them', async t => {
  const f = await fixture(t, 35), before = logical(f), originals = await readFile(f.path)
  await assert.rejects(f.factory.openEventMigrationWrite(f.root), { code: 'FEATURE_UNAVAILABLE' })
  await assert.rejects(f.factory.openEventMirrorWrite(f.root), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(logical(f), before); assert.deepEqual(await readFile(f.path), originals)
  const absent = join(f.root, '作品 %23 #未建库'); await mkdir(join(absent, '.webnovel'), { recursive: true })
  await assert.rejects(f.factory.openEventMigrationWrite(absent), { code: 'STORAGE_ERROR' })
  await assert.rejects(f.factory.openEventMirrorWrite(absent), { code: 'STORAGE_ERROR' })
  assert.deepEqual(await readdir(join(absent, '.webnovel')), [])
})

test('a migration between mirror staging and replacement prevents publication of the already-staged legacy file', async t => {
  const f = await fixture(t), db = await f.factory.open(f.root), content = JSON.stringify({ version: 1, events: [direct] })
  const old = db.importWorkspaceConfig('timeline', content, hash(content)).mirror!
  const review = await f.prepare(), claim = await f.reviews.claimConfirmation(review.token)
  const migration = await f.factory.openEventMigrationWrite(f.root), originals = await files(f.root)
  const assertCurrent = db.assertMirrorPlanCurrent.bind(db)
  let checks = 0
  db.assertMirrorPlanCurrent = plan => {
    if (++checks === 2) migration.commit(claim, () => {})
    assertCurrent(plan)
  }
  try {
    const publisher = Object.create(SqliteManuscriptService.prototype) as { syncPlan(root: string, database: typeof db, plan: typeof old): Promise<unknown> }
    assert.equal(await publisher.syncPlan(f.root, db, old), 'pending')
    assert.equal(checks, 2)
    assert.equal((await f.recovery.read())?.operationId, review.operationId)
    assert.deepEqual(await files(f.root), originals)
  } finally { migration.close(); db.close() }
})

test('5,000 reviewed occurrences all commit, including forward links and the last row', async t => {
  const f = await fixture(t); await f.put('timeline', Array.from({ length: 5000 }, (_, index) => ({ ...direct, id: `legacy-${index}` })))
  const review = await f.prepare(input => { for (const row of input.rows.slice(0, -1)) { row.disposition = 'link-existing'; row.targetRowIndex = 4999 } })
  const before = await files(f.root), start = performance.now(), result = await f.service.commit(review.token)
  t.diagnostic(`5000-occurrence complete commit: ${Math.round(performance.now() - start)} ms`)
  assert.equal(result.receipt.mappingCount, 5000)
  assert.equal(using(f, db => db.prepare('SELECT count(*) AS n FROM canonical_events').get()!.n), 1)
  assert.equal(using(f, db => db.prepare('SELECT max(ordinal) AS n FROM event_migration_source_aliases').get()!.n), 4999)
  assert.deepEqual(await files(f.root), before); assert.deepEqual(await f.recovery.read(), result.receipt)
})

test('post-commit publication writes the unified mirror and reports its result separately from the receipt', async t => {
  const f = await fixture(t, undefined, true); await f.put('timeline', [direct])
  const timelinePath = join(f.root, '.webnovel', 'config', 'timeline.json'), timelineBefore = await readFile(timelinePath)
  const review = await f.prepare(), result = await f.service.commit(review.token)
  assert.deepEqual(result.mirror, { status: 'synced', issue: 'none' })
  assert.equal(result.receipt.operationId, review.operationId)
  assert.deepEqual(await f.recovery.read(review.operationId), result.receipt)
  assert.deepEqual(await readFile(timelinePath), timelineBefore)
  const content = await readFile(join(f.root, '.webnovel', 'research', 'events.json'), 'utf8')
  const document = JSON.parse(content)
  assert.equal(document.authority, 'sqlite-unified-events')
  assert.equal(document.events.length, 1)
  assert.deepEqual(await mirrorStatus(f), { status: 'synced', issue: 'none' })
  using(f, db => {
    const row = db.prepare("SELECT * FROM mirror_entries WHERE source_type='canonical_events_json'").get()!
    assert.equal(row.status, 'synced'); assert.equal(row.content_hash, hash(content)); assert.equal(row.observed_hash, hash(content))
    assert.equal(row.previous_relative_path, null); assert.equal(row.previous_observed_hash, null)
  })
})

test('external event-file changes are preserved as conflicts and a restored expected file can be retried', async t => {
  const f = await fixture(t); await f.put('sources', [material]); await f.put('events', [canonical])
  const eventPath = join(f.root, '.webnovel', 'research', 'events.json'), expected = await readFile(eventPath)
  const review = await f.prepare(), committed = await f.service.commit(review.token)
  assert.deepEqual(committed.mirror, { status: 'pending', issue: 'unavailable' })
  const external = Buffer.from('{"external":"author edit"}\r\n')
  await writeFile(eventPath, external)
  assert.deepEqual(await f.mirrors.retry(review.operationId), { status: 'conflict', issue: 'external-change' })
  assert.deepEqual(await readFile(eventPath), external)
  assert.deepEqual(await mirrorStatus(f), { status: 'conflict', issue: 'external-change' })
  await writeFile(eventPath, expected)
  assert.deepEqual(await f.mirrors.retry(review.operationId), { status: 'synced', issue: 'none' })
  assert.notDeepEqual(await readFile(eventPath), expected)
  assert.deepEqual(await f.recovery.read(review.operationId), committed.receipt)
})

test('filesystem publication failure is persisted without replaying migration and remains retryable', async t => {
  const f = await fixture(t); await f.put('timeline', [direct])
  const review = await f.prepare(), committed = await f.service.commit(review.token)
  const eventPath = join(f.root, '.webnovel', 'research', 'events.json')
  await mkdir(eventPath, { recursive: true })
  assert.deepEqual(await f.mirrors.retry(review.operationId), { status: 'failed', issue: 'storage-error' })
  assert.deepEqual(await mirrorStatus(f), { status: 'failed', issue: 'storage-error' })
  assert.deepEqual(await f.recovery.read(), committed.receipt)
  await rm(eventPath, { recursive: true })
  assert.deepEqual(await f.mirrors.retry(review.operationId), { status: 'synced', issue: 'none' })
  assert.equal(JSON.parse(await readFile(eventPath, 'utf8')).events.length, 1)
})

test('book generation change during publication returns stale without writing or changing the pending registration', async t => {
  const f = await fixture(t); await f.put('timeline', [direct])
  const review = await f.prepare(); await f.service.commit(review.token)
  const mirrors = new EventMirrorSyncService(f.factory, {
    publish: async (_scope, _plan, guard) => {
      f.scope.generation += 1
      await guard.recheck()
      return { feedback: { status: 'synced', issue: 'none' }, observedHash: null }
    }
  }, f.currentScope, f.writes)
  assert.deepEqual(await mirrors.retry(review.operationId), { status: 'pending', issue: 'stale' })
  await assert.rejects(readFile(join(f.root, '.webnovel', 'research', 'events.json')), error => (error as NodeJS.ErrnoException).code === 'ENOENT')
  assert.deepEqual(await mirrorStatus(f), { status: 'pending', issue: 'none' })
})

test('an external edit between the initial hash and atomic replacement is preserved', async t => {
  const f = await fixture(t); await f.put('sources', [material]); await f.put('events', [canonical])
  const eventPath = join(f.root, '.webnovel', 'research', 'events.json'), review = await f.prepare()
  await f.service.commit(review.token)
  const external = Buffer.from('{"external":"race"}\n')
  let checks = 0
  const currentScope = async () => {
    if (++checks === 5) await writeFile(eventPath, external)
    return { ...f.scope }
  }
  const mirrors = new EventMirrorSyncService(f.factory, new LocalEventMirrorPublisher(), currentScope, f.writes)
  assert.deepEqual(await mirrors.retry(review.operationId), { status: 'conflict', issue: 'external-change' })
  assert.deepEqual(await readFile(eventPath), external)
  assert.ok(checks >= 5)
})

test('a lost mirror acknowledgement is recovered from already-published bytes without replaying migration', async t => {
  const f = await fixture(t); await f.put('timeline', [direct])
  const review = await f.prepare(), committed = await f.service.commit(review.token)
  let rejected = false
  const uncertain = new EventMirrorSyncService({
    openEventMirrorWrite: async root => {
      const storage = await f.factory.openEventMirrorWrite(root)
      return {
        read: storage.read,
        assertCurrent: storage.assertCurrent,
        acknowledge: () => { rejected = true; throw new AppError('CONFLICT', '模拟回包丢失', { recoverable: true }) },
        close: storage.close
      }
    }
  }, new LocalEventMirrorPublisher(), f.currentScope, f.writes)
  assert.deepEqual(await uncertain.retry(review.operationId), { status: 'pending', issue: 'stale' })
  assert.equal(rejected, true)
  const published = await readFile(join(f.root, '.webnovel', 'research', 'events.json'))
  assert.deepEqual(await f.mirrors.retry(review.operationId), { status: 'synced', issue: 'none' })
  assert.deepEqual(await readFile(join(f.root, '.webnovel', 'research', 'events.json')), published)
  assert.deepEqual(await f.recovery.read(), committed.receipt)
  assert.equal(using(f, db => db.prepare('SELECT count(*) AS n FROM event_migration_receipts').get()!.n), 1)
})

test('damaged persisted mirror feedback fails closed instead of reporting a usable status', async t => {
  const f = await fixture(t); await f.put('timeline', [direct])
  const review = await f.prepare(); await f.service.commit(review.token)
  using(f, db => db.exec("UPDATE mirror_entries SET status='conflict', last_error_code=NULL WHERE source_type='canonical_events_json'"))
  await assert.rejects(mirrorStatus(f), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.equal((await f.recovery.read())?.operationId, review.operationId)
})
