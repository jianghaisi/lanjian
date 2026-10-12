import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { EventMigrationReceiptService } from '../../../src/main/modules/timeline/application/event-migration-receipt-service'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { eventMigrationMirrorAcknowledgements, reviewEventMigrationDecisions, type EventMigrationDecisionPlan, type EventMigrationDecisionsInput } from '../../../src/main/modules/timeline/domain/event-migration-decisions'
import { inspectEventMigrationSources, type EventMigrationReviewPage } from '../../../src/main/modules/timeline/domain/event-migration-review'
import type { EventSourceSnapshot, EventSnapshotScope } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import type { WorkspaceCanonicalEventRecord, WorkspaceEventReadPort } from '../../../src/main/core/ports/workspace-database'
import type { StoryEventVersionPayload } from '../../../src/main/modules/timeline/domain/story-event-version'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { decodeEventMigrationReceiptEvidence, encodeEventMigrationReceiptEvidence, eventReceiptHash as hash } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { eventSourceFingerprint, LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-18T08:00:00.000Z'
const direct = { id: 'same-id', title: ' 原始标题 ', time: '第二夜', characters: '和田、林与舟', location: '旧城', event: '追踪钟声', result: '' }
const material = { id: 'source-one', provider: 'manual', sourceType: 'manual' as const, title: '资料', capturedAt: stamp, excerpt: '钟声', userNotes: '', contentHash: 'a'.repeat(64) }
const canonical = { id: 'canonical-one', time: '第一夜', characters: ['和田'], location: '旧城', event: '钟响', confidence: 1,
  evidenceRefs: [{ sourceId: material.id, excerpt: '钟声' }], status: 'candidate' as const, createdAt: stamp }

async function fixture(context: TestContext, version?: number) {
  const parent = await canonicalDirectory(tmpdir()), root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-recovery-')))
  context.after(async () => {
    assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'novel-event-recovery-')))
    assert.equal(await canonicalDirectory(root), root)
    await rm(root, { recursive: true, force: true })
  })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp)), path = join(root, '.webnovel', 'workspace.sqlite')
  await mkdir(dirname(path), { recursive: true })
  if (version === undefined) (await factory.open(root)).close()
  const db = new DatabaseSync(path)
  try {
    if (version !== undefined) for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= version)) {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(migration.version, migration.name, stamp, migration.checksum)
      db.exec(`PRAGMA user_version=${migration.version}`)
    }
    db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('book-one','隔离回执','active',?,'sqlite',?,?)")
      .run('b'.repeat(64), stamp, stamp)
  } finally { db.close() }
  await writeFile(join(root, 'notes.md'), '作者内容不随恢复查询改写。\r\n')
  const scope: EventSnapshotScope = { workItemId: root, root, generation: 1 }
  const reader = new LocalEventSourceSnapshotReader(factory), service = new EventMigrationReceiptService(factory, async () => ({ ...scope }), new WorkspaceWriteCoordinator())
  const putTimeline = async (items: unknown[]) => {
    await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
    await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), '\ufeff' + JSON.stringify({ events: items, unknown: '保留原包络' }) + '\r\n')
  }
  const capture = () => reader.capture(scope)
  const claim = async (links = false) => {
    let nonce = 0
    const session = new EventMigrationReviewSession({ capture }, async () => ({ ...scope }), { nonce: () => `receipt-${++nonce}`, sha256: hash, now: () => 1000 })
    const preview = await session.preview(), snapshot = await capture(), input = decisions(snapshot)
    if (links) {
      const first = input.rows.find(row => snapshot.documents.timeline.occurrences.length && row.rowIndex === input.rows.length - snapshot.documents.timeline.occurrences.length)!
      for (const row of input.rows) if (row.rowIndex > first.rowIndex) { row.disposition = 'link-existing'; row.targetRowIndex = first.rowIndex }
    }
    const reviewed = await session.review(preview.previewId, input)
    return session.claimConfirmation(reviewed.token)
  }
  return { root, path, factory, scope, service, reader, putTimeline, capture, claim }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function using<T>(f: Fixture, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA foreign_keys=ON'); return run(db) } finally { db.close() }
}
/** Inject data corruption while restoring the exact trigger definition for read validation. */
function corrupt(f: Fixture, table: string, sql: string) {
  using(f, db => {
    const trigger = `${table}_no_update`, definition = db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(trigger)!.sql as string
    db.exec(`DROP TRIGGER ${trigger}`)
    try { db.exec(sql) } finally { db.exec(definition) }
  })
}
function all<T>(read: (offset: number) => EventMigrationReviewPage<T>): T[] {
  const result: T[] = []; let offset: number | null = 0
  while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset }
  return result
}
function decisions(snapshot: EventSourceSnapshot): EventMigrationDecisionsInput {
  const inspection = inspectEventMigrationSources(snapshot)
  return { fingerprint: snapshot.fingerprint, rows: all(inspection.rowsPage).map(row => ({ rowIndex: row.index, disposition: row.defaultDisposition! })),
    acknowledgedGroups: all(inspection.groupsPage).filter(group => group.severity === 'review').map(group => group.id),
    acknowledgedPlanningFindings: all(inspection.planningFindingsPage).flatMap((finding, index) => finding.severity === 'review' ? [index] : []),
    acknowledgedMirrors: [...eventMigrationMirrorAcknowledgements(snapshot)] }
}
async function files(root: string, dir = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) Object.assign(result, await files(root, path))
    else result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}

/** SQL fixture only. This is deliberately not a production transaction/writer. */
function persist(f: Fixture, claim: { operationId: string; snapshot: EventSourceSnapshot; plan: EventMigrationDecisionPlan }, stage = 4,
  override: Record<string, SQLInputValue> = {}, directOverride: Partial<StoryEventVersionPayload> = {}) {
  const json = encodeEventMigrationReceiptEvidence(claim.snapshot, claim.plan)
  using(f, db => {
    db.exec('BEGIN IMMEDIATE')
    const targets = new Map<number, { eventId: string; versionId: string }>()
    for (const decision of claim.plan.rows) {
      if (decision.ref.source === 'sources' || decision.disposition === 'link-existing') continue
      if (decision.ref.source === 'events') {
        const versions = new CanonicalEventVersions(db, 'book-one', () => `${decision.ref.originalId}-baseline`)
        if (!versions.heads(decision.ref.originalId!)) {
          versions.baseline(claim.snapshot.documents.events.occurrences[decision.ref.ordinal]!.value as WorkspaceCanonicalEventRecord, stamp)
        }
        const heads = versions.heads(decision.ref.originalId!)!
        targets.set(decision.rowIndex, { eventId: decision.ref.originalId!, versionId: heads.approvedVersionId ?? heads.latestVersionId })
      } else {
        const original = claim.snapshot.documents.timeline.occurrences[decision.ref.ordinal]!.value as typeof direct
        const id = `migrated-${decision.rowIndex}`, versionId = `${id}-v1`
        db.prepare(`INSERT INTO canonical_events (id,project_id,time_ref,location_text,event_text,result_text,confidence,status,event_signature,slot_signature,created_at,approved_at)
          VALUES (?,'book-one',?,?,?,?,1,'approved',?,?,?,?)`).run(id, original.time, original.location, original.event, original.result ?? null, id, id, stamp, stamp)
        new CanonicalEventVersions(db, 'book-one', () => versionId).append(id, null, {
          content: { time: original.time, location: original.location, event: original.event, characters: ['和田', '林与舟'],
            title: original.title, rawCharacters: original.characters, ...(original.result === undefined ? {} : { result: original.result }), evidenceRefs: [], confidence: 1 },
          status: 'approved', phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources: [], ...directOverride
        }, stamp)
        targets.set(decision.rowIndex, { eventId: id, versionId })
      }
    }
    const value: Record<string, SQLInputValue> = { operation_id: claim.operationId, project_id: 'book-one', source_fingerprint: claim.snapshot.fingerprint,
      decision_fingerprint: hash(JSON.stringify(claim.plan)), source_snapshot_hash: hash(json), source_snapshot_json: json,
      mapping_count: claim.plan.rows.length, committed_at: stamp, ...override }
    db.prepare(`INSERT INTO event_migration_receipts (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value))
    if (stage >= 2) for (const decision of claim.plan.rows) {
      const target = targets.get(decision.targetRowIndex ?? decision.rowIndex)
      const original = claim.snapshot.documents[decision.ref.source].occurrences[decision.ref.ordinal]!.value as Record<string, unknown>
      db.prepare('INSERT INTO event_migration_source_aliases VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(claim.operationId, decision.rowIndex, 'book-one', decision.ref.source,
        decision.ref.contentHash, decision.ref.ordinal, decision.ref.originalId!, decision.disposition,
        decision.ref.source === 'sources' ? decision.ref.originalId : null, decision.ref.source === 'sources' ? original.contentHash as string : null,
        target?.eventId ?? null, target?.versionId ?? null)
    }
    if (stage >= 3) db.prepare('INSERT INTO event_migration_receipt_seals VALUES (?,?)').run(claim.operationId, 'book-one')
    if (stage >= 4) db.prepare('INSERT INTO event_module_transitions VALUES (?,?)').run('book-one', claim.operationId)
    db.exec('COMMIT')
  })
}

test('absent database and supported old schema return no receipt without creating or upgrading files', async context => {
  const f = await fixture(context, 35), before = await files(f.root)
  assert.equal(await f.service.read(), null); assert.deepEqual(await files(f.root), before)
  const empty = join(f.root, 'empty'); await mkdir(empty)
  const service = new EventMigrationReceiptService(f.factory, async () => ({ workItemId: empty, root: empty, generation: 1 }), new WorkspaceWriteCoordinator())
  assert.equal(await service.read(), null); assert.deepEqual(await files(empty), {})
})

test('empty migration still requires sealed evidence; repeated recovery reads are zero-write and contain no raw sources or root', async context => {
  const f = await fixture(context)
  assert.equal(await f.service.read(), null)
  const claim = await f.claim(); persist(f, claim)
  const before = await files(f.root), result = await f.service.read(claim.operationId)
  assert.equal(result?.operationId, claim.operationId); assert.equal(result?.mappingCount, 0)
  assert.deepEqual(result?.sourceCounts, { sources: 0, events: 0, timeline: 0 })
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result?.sourceCounts), true)
  assert.equal(JSON.stringify(result).includes(f.root), false)
  assert.deepEqual(await f.service.read(), result); assert.deepEqual(await files(f.root), before)
  await assert.rejects(f.service.read('foreign-operation'), { code: 'NOT_FOUND' })
  await assert.rejects(f.service.read(' invalid '), { code: 'VALIDATION_ERROR' })
})

for (const stage of [1, 2, 3]) test(`partial receipt at stage ${stage} is blocked, never absent or repaired`, async context => {
  const f = await fixture(context); await f.putTimeline([direct])
  persist(f, await f.claim(), stage)
  const before = await files(f.root)
  await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await files(f.root), before)
  await assert.rejects(f.claim(), { code: 'FEATURE_UNAVAILABLE' })
})

for (const links of [false, true]) test(`duplicate original IDs survive exact ${links ? 'explicit linking' : 'separate retention'} and original BOM bytes`, async context => {
  const f = await fixture(context); await f.putTimeline([direct, direct])
  const claim = await f.claim(links), json = encodeEventMigrationReceiptEvidence(claim.snapshot, claim.plan)
  const restored = decodeEventMigrationReceiptEvidence(json)
  assert.deepEqual(restored.snapshot, claim.snapshot); assert.deepEqual(restored.plan, claim.plan)
  assert.ok(Buffer.from(restored.snapshot.files.timeline.base64!, 'base64').subarray(0, 3).equals(Buffer.from([239, 187, 191])))
  persist(f, claim)
  const before = await files(f.root), result = await f.service.read()
  assert.equal(result?.mappingCount, 2)
  assert.equal(using(f, db => db.prepare('SELECT count(DISTINCT event_id) AS n FROM event_migration_source_aliases').get()!.n), links ? 1 : 2)
  assert.deepEqual(await files(f.root), before)
  // The durable receipt reads historical bytes, even if the retired source is now damaged.
  await f.putTimeline(['external change'])
  assert.deepEqual(await f.service.read(), result)
})

test('unsupported extensions remain readable historical evidence but cannot receive a new conversion grant', async context => {
  const f = await fixture(context)
  await f.putTimeline([{ ...direct, extra: { retained: ['原文', '未知字段'] } }])
  const before = await files(f.root)
  await assert.rejects(f.claim(), { code: 'CONFLICT' })
  assert.deepEqual(await files(f.root), before)
  // Historical SQL fixture only: no new author grant or product migration writer.
  const snapshot = await f.capture(), plan = reviewEventMigrationDecisions(snapshot, decisions(snapshot))
  assert.deepEqual(decodeEventMigrationReceiptEvidence(encodeEventMigrationReceiptEvidence(snapshot, plan)).snapshot, snapshot)
  persist(f, { operationId: 'historical-extension-evidence', snapshot, plan })
  const stored = await files(f.root)
  assert.equal((await f.service.read())?.mappingCount, 1)
  assert.deepEqual(await files(f.root), stored)
})

for (const scenario of ['candidate-promoted', 'approved-demoted', 'confidence-changed'] as const) {
  test(`receipt rejects a well-hashed, sealed direct version with ${scenario}`, async context => {
    const f = await fixture(context)
    await f.putTimeline([{ ...direct, ...(scenario === 'candidate-promoted' ? { status: 'candidate' } : {}),
      ...(scenario === 'confidence-changed' ? { confidence: 0.25 } : {}) }])
    const claim = await f.claim()
    persist(f, claim, 4, {}, scenario === 'approved-demoted' ? { status: 'candidate' } : {})
    const before = await files(f.root)
    await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
    assert.deepEqual(await files(f.root), before)
  })
}

test('explicit legacy candidate and zero confidence survive conversion, sealed storage and recovery', async context => {
  const f = await fixture(context); await f.putTimeline([{ ...direct, status: 'candidate', confidence: 0 }])
  const claim = await f.claim(), row = claim.payloads.rows[0]!
  if (row.kind !== 'direct') assert.fail('expected direct payload')
  assert.equal(row.payload.status, 'candidate'); assert.equal(row.payload.content.confidence, 0)
  persist(f, claim, 4, {}, row.payload)
  const before = await files(f.root)
  assert.equal((await f.service.read())?.mappingCount, 1)
  assert.deepEqual(await files(f.root), before)
})

test('candidate-only canonical identity and selected historical version survive later approvals and material edits', async context => {
  const f = await fixture(context), db = await f.factory.openExisting(f.root); assert.ok(db)
  db.importMaterialSources([material]); db.importCanonicalEvents([canonical]); db.baselineCanonicalEventVersions(); db.close()
  const claim = await f.claim(); persist(f, claim)
  const result = await f.service.read(); assert.equal(result?.mappingCount, 2)
  const changed = await f.factory.openExisting(f.root); assert.ok(changed)
  try {
    assert.throws(() => changed.approveCanonicalEvent(canonical.id), { code: 'CONFLICT' })
    changed.updateMaterialSource({ ...material, excerpt: '新的来源', contentHash: 'c'.repeat(64) })
  } finally { changed.close() }
  // Historical evidence fixture: a later unified version must not rewrite the
  // original receipt. The retired ID-only legacy approval is not that writer.
  using(f, db => {
    db.exec('BEGIN IMMEDIATE')
    const versions = new CanonicalEventVersions(db, 'book-one', () => 'later-approved')
    const previous = versions.list(canonical.id).at(-1)!
    versions.append(canonical.id, previous.id, { ...previous, status: 'approved', creator: 'author' }, stamp)
    db.prepare("UPDATE canonical_events SET status='approved',approved_at=? WHERE id=?").run(stamp, canonical.id)
    db.exec('COMMIT')
  })
  const before = await files(f.root)
  assert.deepEqual(await f.service.read(), result); assert.deepEqual(await files(f.root), before)
})

test('an unversioned canonical candidate is recoverable only through its exact retained baseline', async context => {
  const f = await fixture(context), db = await f.factory.openExisting(f.root); assert.ok(db)
  db.importMaterialSources([material]); db.importCanonicalEvents([canonical]); db.close()
  const claim = await f.claim(); assert.equal(claim.snapshot.eventHistory[0]!.heads, null)
  persist(f, claim); assert.equal((await f.service.read())?.mappingCount, 2)
  const read = await f.factory.openEventReadOnly(f.root); assert.ok(read)
  try { assert.equal(read.listCanonicalEventVersions(canonical.id)[0]!.status, 'candidate') } finally { read.close() }
})

for (const sql of [
  "UPDATE event_migration_source_aliases SET original_id='wrong-source'",
  "UPDATE event_migration_source_aliases SET source_hash='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'",
  "UPDATE event_migration_source_aliases SET event_id='migrated-1',event_version_id='migrated-1-v1' WHERE ordinal=0"
]) test(`rejects a sealed receipt with inconsistent alias: ${sql.split(' SET ')[1]}`, async context => {
  const f = await fixture(context); await f.putTimeline([direct, direct]); persist(f, await f.claim())
  corrupt(f, 'event_migration_source_aliases', sql)
  const before = await files(f.root)
  await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' }); assert.deepEqual(await files(f.root), before)
})

test('damaged mapped event payload fails recovery even when the receipt itself is intact', async context => {
  const f = await fixture(context); await f.putTimeline([direct]); persist(f, await f.claim())
  corrupt(f, 'canonical_event_versions', "UPDATE canonical_event_versions SET content_hash='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'")
  const before = await files(f.root)
  await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' }); assert.deepEqual(await files(f.root), before)
})

test('foreign migration evidence cannot hide behind a missing current-book receipt', async context => {
  const f = await fixture(context)
  using(f, db => {
    db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('foreign','其他书','active',?,'sqlite',?,?)").run('b'.repeat(64), stamp, stamp)
    db.prepare(`INSERT INTO event_migration_receipts VALUES ('foreign-op','foreign',?,?,?,?,0,?)`).run('a'.repeat(64), 'b'.repeat(64), hash('{}'), '{}', stamp)
  })
  const before = await files(f.root)
  await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' }); assert.deepEqual(await files(f.root), before)
})

for (const field of ['source_snapshot_hash', 'source_fingerprint', 'decision_fingerprint']) test(`corrupt ${field} is rejected with original bytes retained`, async context => {
  const f = await fixture(context), claim = await f.claim(); persist(f, claim, 4, { [field]: 'f'.repeat(64) })
  const before = await files(f.root)
  await assert.rejects(f.service.read(), error => {
    const value = error as Error & { code: string }
    assert.equal(value.code, 'DATABASE_INTEGRITY_FAILED'); assert.equal(value.message.includes(f.root), false); return true
  })
  assert.deepEqual(await files(f.root), before)
})

test('unrelated valid JSON with a matching outer checksum is not a valid source/decision receipt', async context => {
  const f = await fixture(context), claim = await f.claim(), json = '{"raw":"not a source snapshot"}'
  persist(f, claim, 4, { source_snapshot_json: json, source_snapshot_hash: hash(json) })
  await assert.rejects(f.service.read(), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('retained evidence verifies raw bytes, authority, fingerprint, decisions and counts even with recomputed outer hash', async context => {
  const f = await fixture(context); await f.putTimeline([direct]); const claim = await f.claim()
  const original = encodeEventMigrationReceiptEvidence(claim.snapshot, claim.plan)
  const mutators: Array<(value: ReturnType<typeof JSON.parse>) => void> = [
    value => { value.version = 2 }, value => { value.snapshot.files.timeline.base64 += ' ' },
    value => { value.snapshot.files.timeline.byteLength++ }, value => { value.snapshot.documents.timeline.content += ' ' },
    value => { value.snapshot.documents.timeline.authority = 'sqlite' }, value => { value.snapshot.database.hasMigrationEvidence = true },
    value => { value.snapshot.database.projectId = 'other' }, value => { value.snapshot.fingerprint = 'f'.repeat(64) },
    value => { value.decisions.rows = [] }, value => { value.decisions.rows[0].approved = true },
    value => { value.snapshot.chapterCatalog.entries = [{ kind: 'outline', chapterId: 1, revision: null, status: 'active' }] }
  ]
  for (const mutate of mutators) { const value = JSON.parse(original); mutate(value); assert.throws(() => decodeEventMigrationReceiptEvidence(JSON.stringify(value)), { code: 'DATABASE_INTEGRITY_FAILED' }) }
  assert.equal(eventSourceFingerprint(claim.snapshot), claim.snapshot.fingerprint)
})

test('5000 reviewed linked occurrences survive reopening without partial-page success', async context => {
  const f = await fixture(context); await f.putTimeline(Array.from({ length: 5000 }, (_, i) => ({ ...direct, id: `legacy-${i}` })))
  const claim = await f.claim(true); persist(f, claim)
  const before = await files(f.root), start = performance.now(), result = await f.service.read()
  context.diagnostic(`5000-row receipt read ${Math.round(performance.now() - start)} ms`)
  assert.equal(result?.mappingCount, 5000); assert.equal(result?.sourceCounts.timeline, 5000)
  assert.deepEqual(await files(f.root), before)
})

test('book switch during acquisition rejects late receipts and closes the private snapshot', async () => {
  let resolve!: (value: WorkspaceEventReadPort) => void, closed = 0, queried = 0
  const scope = { workItemId: 'one', root: 'one', generation: 1 }
  const service = new EventMigrationReceiptService({ openEventReadOnly: () => new Promise(ok => { resolve = ok }) },
    async () => ({ ...scope }), new WorkspaceWriteCoordinator())
  const pending = service.read()
  while (!resolve) await new Promise<void>(ok => setImmediate(ok))
  scope.generation++
  // Only the narrow methods used after acquisition are instrumented in this race fixture.
  resolve({ eventMigrationReceipt: () => { queried++; return null }, close: () => { closed++ } } as WorkspaceEventReadPort)
  await assert.rejects(pending, { code: 'CONFLICT' }); assert.equal(closed, 1); assert.equal(queried, 0)
})

test('an old book acquisition failure is replaced by a scope conflict without leaking the failure', async () => {
  let reject!: (error: unknown) => void
  const scope = { workItemId: 'one', root: 'one', generation: 1 }
  const service = new EventMigrationReceiptService({ openEventReadOnly: () => new Promise((_ok, fail) => { reject = fail }) },
    async () => ({ ...scope }), new WorkspaceWriteCoordinator())
  const pending = service.read()
  while (!reject) await new Promise<void>(ok => setImmediate(ok))
  scope.workItemId = 'two'; scope.root = 'two'; reject(new Error('private/old-book'))
  await assert.rejects(pending, { code: 'CONFLICT' })
})

test('read-only close errors are safe storage failures, not raw errors or success', async () => {
  const database = { eventMigrationReceipt: () => null, close: () => { throw new Error('private/snapshot') } } as unknown as WorkspaceEventReadPort
  const service = new EventMigrationReceiptService({ openEventReadOnly: async () => database },
    async () => ({ workItemId: 'one', root: 'one', generation: 1 }), new WorkspaceWriteCoordinator())
  await assert.rejects(service.read(), error => {
    assert.equal((error as { code: string }).code, 'STORAGE_ERROR'); assert.equal((error as Error).message.includes('private/'), false); return true
  })
})

test('missing read port fails closed; unknown scope/acquisition errors do not expose raw paths', async () => {
  const scope = async () => ({ workItemId: 'one', root: 'one', generation: 1 }), writes = new WorkspaceWriteCoordinator()
  await assert.rejects(new EventMigrationReceiptService({}, scope, writes).read(), { code: 'FEATURE_UNAVAILABLE' })
  for (const service of [new EventMigrationReceiptService({}, async () => { throw new Error('private/path') }, writes),
    new EventMigrationReceiptService({ openEventReadOnly: async () => { throw new Error('private/path') } }, scope, writes)]) {
    await assert.rejects(service.read(), error => { assert.equal((error as Error).message.includes('private/path'), false); return true })
  }
})
