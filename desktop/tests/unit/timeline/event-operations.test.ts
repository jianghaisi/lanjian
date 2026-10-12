import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { EventOperationService } from '../../../src/main/modules/timeline/application/event-operation-service'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventMigrationCommitService } from '../../../src/main/modules/timeline/application/event-migration-commit-service'
import { EventProjectionService } from '../../../src/main/modules/timeline/application/event-projection-service'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { eventReceiptHash } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { intermediateEventOperationSchema44Checksum } from '../../../src/main/modules/timeline/adapters/event-operation-schema'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { decodeEventOperation, type EventOperation, type EventOperationReview } from '../../../src/main/modules/timeline/domain/event-operations'
import type { EventSnapshotScope } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { removeEmptyReviewSchema } from '../../fixtures/remove-empty-review-schema'

const stamp = '2026-09-20T10:00:00.000Z'
const content = { time: '第二夜', characters: ['林舟'], location: '古城', event: '寻找线索', evidenceRefs: [], confidence: 1 }
type Fixture = Awaited<ReturnType<typeof fixture>>

async function fixture(t: TestContext) {
  const parent = await canonicalDirectory(tmpdir()), root = await canonicalDirectory(await mkdtemp(join(parent, 'lanjian-event-operations-')))
  t.after(async () => { assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'lanjian-event-operations-'))); await rm(root, { recursive: true, force: true }) })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp), randomUUID)
  ;(await factory.open(root)).close()
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const raw = new DatabaseSync(path)
  raw.prepare(`INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at)
    VALUES ('book','隔离作品','active',?,'sqlite',?,?)`).run('a'.repeat(64), stamp, stamp)
  raw.close()
  await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
  await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), JSON.stringify({ version: 1, events: [
    { id: 'old-one', title: '旧事', time: '第一夜', characters: '林舟', location: '古城', event: '敲门' }
  ] }))
  const scope: EventSnapshotScope = { root, workItemId: 'work', generation: 1 }, currentScope = async () => ({ ...scope })
  const writes = new WorkspaceWriteCoordinator(), reader = new LocalEventSourceSnapshotReader(factory)
  let now = 1000
  const runtime = { nonce: randomUUID, now: () => now, sha256: eventReceiptHash }
  const reviews = new EventMigrationReviewSession({ capture: () => reader.capture(scope) }, currentScope, runtime)
  const migration = new EventMigrationCommitService(reviews, factory, reader, currentScope, writes)
  const preview = await reviews.preview()
  const grant = await reviews.review(preview.previewId, { fingerprint: preview.fingerprint,
    rows: [{ rowIndex: 0, disposition: 'keep-separate' }], acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [] })
  await migration.commit(grant.token)
  let lastReview: EventOperationReview | undefined
  const hooks = { beforeFiles: async () => {}, afterFiles: async () => {}, closeFailure: false }
  const operationsFactory = {
    openEventReadOnly: factory.openEventReadOnly.bind(factory),
    openEventOperationWrite: async (root: string) => {
      const writer = await factory.openEventOperationWrite(root)
      return { close: () => { writer.close(); if (hooks.closeFailure) throw new Error(root) }, commit: (review: EventOperationReview, active: () => void) => {
        lastReview = review; return writer.commit(review, active)
      } }
    }
  }
  const service = new EventOperationService(operationsFactory, { capture: reader.capture.bind(reader), assertUnchanged: async snapshot => {
    await hooks.beforeFiles(); await reader.assertUnchanged(snapshot); await hooks.afterFiles()
  } }, currentScope, writes, runtime)
  const projection = new EventProjectionService(factory, currentScope, writes)
  return { root, path, factory, scope, service, projection, hooks, reader, currentScope, writes, runtime,
    lastReview: () => lastReview!, expire: () => { now += 900_000 } }
}
function raw<T>(f: Fixture, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA foreign_keys=ON'); return action(db) } finally { db.close() }
}
function logical(f: Fixture) {
  return raw(f, db => Object.fromEntries(['canonical_events','canonical_event_versions','canonical_event_version_heads',
    'event_lifecycle_versions','event_display_order_versions','event_operation_receipts','mirror_entries'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()])))
}
async function selected(f: Fixture, eventId?: string) {
  const projection = await f.projection.read(), lifecycle = projection.state.lifecycles.find(item => !eventId || item.eventId === eventId)!
  const read = (await f.factory.openEventReadOnly(f.root))!
  try { return { eventId: lifecycle.eventId, expectedLifecycleId: lifecycle.id,
    expectedVersionId: read.canonicalEventVersionHeads(lifecycle.eventId)!.latestVersionId, expectedOrderId: projection.state.order.id } }
  finally { read.close() }
}
async function commit(f: Fixture, command: EventOperation) {
  const preview = await f.service.preview(command), result = await f.service.commit(preview.token)
  assert.deepEqual(await f.service.receipt(preview.operationId), result.receipt)
  await assert.rejects(f.service.commit(preview.token), { code: 'CONFLICT' })
  return result.receipt
}

test('create/edit/no-op/reorder/archive/restore retain identities, versions and durable receipts across reopen', async t => {
  const f = await fixture(t), original = await readFile(join(f.root, '.webnovel', 'config', 'timeline.json'))
  let view = await f.projection.read()
  const created = await commit(f, { kind: 'create', content, granularity: 'macro', expectedOrderId: view.state.order.id })
  assert.equal(created.noOp, false)
  const duplicate = await commit(f, { kind: 'create', content, granularity: 'macro', expectedOrderId: (await f.projection.read()).state.order.id })
  assert.notEqual(created.eventId, duplicate.eventId)
  const edit = { kind: 'edit' as const, ...await selected(f, created.eventId!), content: { ...content, event: '找到第一条线索', title: '追踪' }, granularity: 'macro' as const }
  const edited = await commit(f, edit)
  assert.notEqual(edited.versionId, created.versionId)
  const noOp = await commit(f, { ...edit, ...await selected(f, created.eventId!) })
  assert.equal(noOp.noOp, true); assert.equal(noOp.versionId, edited.versionId)
  view = await f.projection.read()
  const order = [...view.state.order.eventIds].reverse()
  await commit(f, { kind: 'reorder', eventIds: order, expectedOrderId: view.state.order.id })
  await commit(f, { kind: 'archive', ...await selected(f, created.eventId!) })
  assert.ok((await f.projection.read()).archived.some(item => item.approved?.eventId === created.eventId))
  await commit(f, { kind: 'restore', ...await selected(f, created.eventId!) })
  const restored = await f.projection.read()
  assert.deepEqual(restored.state.order.eventIds, order)
  assert.equal(restored.approved.find(item => item.eventId === created.eventId)!.versionId, edited.versionId)
  const restarted = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime)
  assert.deepEqual(await restarted.receipt(created.operationId), created)
  assert.deepEqual(await readFile(join(f.root, '.webnovel', 'config', 'timeline.json')), original)
  const before = logical(f), writer = await f.factory.openEventOperationWrite(f.root)
  try { assert.deepEqual(writer.commit(f.lastReview(), () => {}), await f.service.receipt(f.lastReview().operationId)) } finally { writer.close() }
  assert.deepEqual(logical(f), before)
})

test('candidate adoption takes exact stored content and preserves model provenance through history', async t => {
  const f = await fixture(t), initial = await selected(f)
  const pending = raw(f, db => {
    const versions = new CanonicalEventVersions(db, 'book', randomUUID), base = versions.list(initial.eventId)[0]!
    db.exec('BEGIN IMMEDIATE')
    const candidate = versions.append(initial.eventId, base.id, { ...base, content: { ...base.content, event: '模型提出的新线索' },
      creator: 'model-candidate', status: 'candidate', sources: [{ relation: 'supersedes', source: { kind: 'event', id: base.eventId, revision: base.id } }] }, stamp)
    db.exec('COMMIT'); return candidate
  })
  const result = await commit(f, { kind: 'adopt', ...await selected(f) })
  const read = (await f.factory.openEventReadOnly(f.root))!
  try {
    const history = read.listCanonicalEventVersions(initial.eventId), approved = history.at(-1)!
    assert.equal(history.length, 3); assert.equal(history[1]!.creator, 'model-candidate')
    assert.deepEqual(approved.content, pending.content); assert.equal(approved.id, result.versionId)
    assert.ok(approved.sources.some(edge => edge.source.revision === pending.id && edge.relation === 'supersedes'))
    assert.deepEqual(approved.sources.slice(0, -1), pending.sources)
  } finally { read.close() }
})

test('material candidate creation and adoption preserve the exact source revision through durable receipts', async t => {
  const f = await fixture(t)
  const sourceId = randomUUID(), excerpt = '城志记载：旧钟楼每逢无月之夜会多响一声。'
  const sourceRevision = eventReceiptHash(excerpt)
  const database = await f.factory.openExisting(f.root)
  assert.ok(database)
  try {
    assert.ok(database.materialSourcesMirror(), 'migration must initialize the empty source ledger mirror')
    database.addMaterialSources([{ id: sourceId, provider: 'manual', sourceType: 'manual', title: '旧城地方志',
      capturedAt: stamp, excerpt, userNotes: '', contentHash: sourceRevision }])
  } finally { database.close() }

  const before = await f.projection.read()
  const preview = await f.service.previewMaterialCandidate({ expectedOrderId: before.state.order.id, sourceId,
    time: '无月之夜', characters: ['林舟'], location: '旧钟楼', event: '听见第十三声钟响', result: '决定追查钟楼旧案' })
  const created = await f.service.commit(preview.token)
  assert.deepEqual(await f.service.receipt(preview.operationId), created.receipt)
  const pending = (await f.projection.read()).candidates.find(item => item.eventId === created.receipt.eventId)
  assert.ok(pending)
  assert.equal(pending.versionId, created.receipt.versionId)
  assert.equal(pending.creator, 'author')
  assert.equal(pending.phase, 'planned')
  assert.deepEqual(pending.content.evidenceRefs, [{ sourceId, excerpt }])
  assert.deepEqual(pending.sources, [{ relation: 'derived-from', source: { kind: 'material', id: sourceId, revision: sourceRevision } }])

  const adopted = await commit(f, { kind: 'adopt', ...await selected(f, pending.eventId) })
  const approved = (await f.projection.read()).approved.find(item => item.eventId === pending.eventId)
  assert.ok(approved)
  assert.equal(approved.versionId, adopted.versionId)
  assert.deepEqual(approved.content, pending.content)
  assert.deepEqual(approved.sources.slice(0, -1), pending.sources)
  const restarted = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime)
  assert.deepEqual(await restarted.receipt(preview.operationId), created.receipt)
})

test('model timeline generation persists its raw Artifact before exact candidate creation and adoption', async t => {
  const f = await fixture(t)
  let instructions = 0
  const service = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime, undefined, {
    prepareCompletion: async (task: any) => {
      assert.equal(task, 'outline')
      return { model: 'fixture-outline-model', connectionId: 'fixture-connection', complete: async (instruction: string) => {
        instructions += 1
        assert.match(instruction, /全局事件时间线/)
        return { content: JSON.stringify([{ title: '钟楼异响', time: '第三夜', characters: '林舟、顾岚', location: '旧钟楼',
          event: '两人在封锁后听见第十三声钟响', result: '确认旧案并未结束' }]) }
      } }
    }
  } as any)
  const request = { operationId: randomUUID(), context: {
    title: '旧城疑案', genre: '悬疑', subgenre: '', coreIdea: '追查旧案', plannedVolumes: 3, chaptersPerVolume: 20,
    targetWordsPerChapter: 3000, materials: '', worldView: '旧城', totalOutline: '钟楼旧案贯穿全书', existingEvents: '第一夜｜敲门'
  } }
  const generated = await service.generateModelCandidates(request)
  assert.equal(instructions, 1)
  assert.equal(generated.model, 'fixture-outline-model')
  assert.equal(generated.candidates[0]?.characters, '林舟、顾岚')
  assert.deepEqual(await service.generateModelCandidates(request), generated)
  assert.equal(instructions, 1)
  await assert.rejects(service.generateModelCandidates({ ...request, context: { ...request.context, genre: '都市' } }), { code: 'CONFLICT' })
  raw(f, db => {
    const task = db.prepare('SELECT * FROM task_runs WHERE id=?').get(generated.taskId)
    const artifact = db.prepare('SELECT * FROM generation_artifacts WHERE id=?').get(generated.artifactId)
    assert.equal(task?.status, 'succeeded'); assert.equal(task?.task_type, 'timeline_candidate_generation')
    assert.equal(artifact?.status, 'complete'); assert.equal(artifact?.content_hash, generated.artifactHash)
    assert.match(String(artifact?.content), /第十三声钟响/)
  })

  const preview = await service.previewModelCandidate({ expectedOrderId: (await f.projection.read()).state.order.id,
    taskId: generated.taskId, artifactId: generated.artifactId, candidateIndex: 0 })
  const created = await service.commit(preview.token)
  const candidate = (await f.projection.read()).candidates.find(item => item.eventId === created.receipt.eventId)!
  assert.equal(candidate.creator, 'model-candidate')
  assert.equal(candidate.content.event, '两人在封锁后听见第十三声钟响')
  assert.deepEqual(candidate.sources, [])
  raw(f, db => {
    const receipt = db.prepare('SELECT request_json FROM event_operation_receipts WHERE operation_id=?').get(preview.operationId)
    const authority = JSON.parse(String(receipt?.request_json)).authority
    assert.deepEqual(authority, { kind: 'verified-model-candidate', taskId: generated.taskId, artifactId: generated.artifactId,
      artifactHash: generated.artifactHash, candidateIndex: 0 })
  })

  const target = await selected(f, candidate.eventId)
  const adoptionPreview = await service.preview({ kind: 'adopt', ...target })
  await service.commit(adoptionPreview.token)
  const approved = (await f.projection.read()).approved.find(item => item.eventId === candidate.eventId)!
  assert.equal(approved.content.event, candidate.content.event)
  assert.ok(approved.sources.some(edge => edge.relation === 'supersedes' && edge.source.revision === candidate.versionId))

  raw(f, db => db.prepare("UPDATE generation_artifacts SET content='{}' WHERE id=?").run(generated.artifactId))
  await assert.rejects(service.receipt(preview.operationId), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('invalid model timeline output is retained for diagnosis without creating an event candidate', async t => {
  const f = await fixture(t), operationId = randomUUID(), before = logical(f)
  const service = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime, undefined, {
    prepareCompletion: async () => ({ model: 'fixture-outline-model', connectionId: 'fixture-connection',
      complete: async () => ({ content: '只有解释，没有事件数组' }) })
  } as any)
  await assert.rejects(service.generateModelCandidates({ operationId, context: {
    title: '失败样本', genre: '都市', subgenre: '', coreIdea: '', plannedVolumes: 0, chaptersPerVolume: 0,
    targetWordsPerChapter: 0, materials: '', worldView: '', totalOutline: '', existingEvents: ''
  } }), { code: 'VALIDATION_ERROR' })
  raw(f, db => {
    const task = db.prepare('SELECT * FROM task_runs WHERE idempotency_key=?').get(operationId)
    assert.ok(task)
    const artifact = db.prepare('SELECT * FROM generation_artifacts WHERE task_run_id=?').get(String(task.id))
    assert.equal(task.status, 'failed'); assert.equal(task.error_code, 'MODEL_CANDIDATE_FAILED')
    assert.equal(artifact?.status, 'invalid'); assert.equal(artifact?.schema_valid, 0)
    assert.equal(artifact?.content, '只有解释，没有事件数组')
  })
  assert.deepEqual(logical(f), before)
})

test('verified manuscript adoption creates a realized approved version with durable private provenance', async t => {
  const f = await fixture(t)
  raw(f, db => {
    db.prepare(`INSERT INTO chapters (id,project_id,legacy_chapter_id,seq,title,status,created_at,updated_at)
      VALUES ('chapter-one','book',1,1,'第一章','draft',?,?)`).run(stamp, stamp)
    db.prepare(`INSERT INTO body_versions (id,chapter_id,version_no,content,content_hash,source_type,created_at)
      VALUES ('body-one','chapter-one',1,'林舟寻找线索',?,'manual',?)`).run(eventReceiptHash('林舟寻找线索'), stamp)
    db.prepare("UPDATE chapters SET current_body_version_id='body-one' WHERE id='chapter-one'").run()
  })
  const projection = await f.projection.read()
  const sourceFingerprint = 'b'.repeat(64), evidenceFingerprint = 'c'.repeat(64)
  const preview = await f.service.previewVerifiedManuscript({
    expectedOrderId: projection.state.order.id,
    content: { ...content, rawCharacters: '林舟' },
    manifestId: 'manifest-one',
    sourceFingerprint,
    evidenceFingerprint,
    manuscriptSources: [{ chapterId: 1, revision: 'body-one' }]
  })
  let verified = 0
  const result = await f.service.commitVerifiedManuscript(preview.token, async () => { verified++ })
  assert.equal(verified, 1)
  const adopted = (await f.projection.read()).approved.find(item => item.eventId === result.receipt.eventId)!
  assert.equal(adopted.versionId, result.receipt.versionId)
  assert.equal(adopted.creator, 'manuscript-extraction')
  assert.equal(adopted.phase, 'realized')
  assert.deepEqual(adopted.sources, [{ relation: 'derived-from', source: {
    kind: 'manuscript', id: 'chapter-one', revision: 'body-one'
  } }])
  const restarted = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime)
  assert.deepEqual(await restarted.receipt(preview.operationId), result.receipt)
  await assert.rejects(f.service.preview({
    kind: 'create', expectedOrderId: (await f.projection.read()).state.order.id,
    content, granularity: 'macro', authority: { kind: 'verified-manuscript', manifestId: 'forged',
      sourceFingerprint, evidenceFingerprint }
  }), { code: 'VALIDATION_ERROR' })
})

test('verified manuscript evidence drift consumes the grant without writing a partial event', async t => {
  const f = await fixture(t)
  raw(f, db => {
    db.prepare(`INSERT INTO chapters (id,project_id,legacy_chapter_id,seq,title,status,created_at,updated_at)
      VALUES ('chapter-one','book',1,1,'第一章','draft',?,?)`).run(stamp, stamp)
    db.prepare(`INSERT INTO body_versions (id,chapter_id,version_no,content,content_hash,source_type,created_at)
      VALUES ('body-one','chapter-one',1,'林舟寻找线索',?,'manual',?)`).run(eventReceiptHash('林舟寻找线索'), stamp)
    db.prepare("UPDATE chapters SET current_body_version_id='body-one' WHERE id='chapter-one'").run()
  })
  const before = logical(f)
  const preview = await f.service.previewVerifiedManuscript({
    expectedOrderId: (await f.projection.read()).state.order.id,
    content,
    manifestId: 'manifest-one',
    sourceFingerprint: 'b'.repeat(64),
    evidenceFingerprint: 'c'.repeat(64),
    manuscriptSources: [{ chapterId: 1, revision: 'body-one' }]
  })
  await assert.rejects(f.service.commitVerifiedManuscript(preview.token, async () => {
    throw new AppError('CONFLICT', 'evidence changed', { recoverable: true })
  }), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
  assert.equal(await f.service.receipt(preview.operationId), null)
  await assert.rejects(f.service.commitVerifiedManuscript(preview.token, async () => {}), { code: 'CONFLICT' })
})

test('saving an unchanged legacy event is a no-op and does not invent a planned phase or provenance', async t => {
  const f = await fixture(t), target = await selected(f)
  const original = raw(f, db => new CanonicalEventVersions(db, 'book', randomUUID).list(target.eventId)[0]!)
  const result = await commit(f, { kind: 'edit', ...target, content: original.content, granularity: 'legacy-unknown' })
  assert.equal(result.noOp, true); assert.equal(result.versionId, original.id)
  const current = (await f.projection.read()).approved[0]!
  assert.equal(current.phase, 'legacy-unknown'); assert.equal(current.creator, 'legacy-unknown')
  assert.deepEqual(current.sources, [])
})

test('lost post-commit connection response recovers the receipt without replay or duplicate creation', async t => {
  const f = await fixture(t), preview = await f.service.preview({ kind: 'create', content, granularity: 'macro', expectedOrderId: (await f.projection.read()).state.order.id })
  f.hooks.closeFailure = true
  await assert.rejects(f.service.commit(preview.token), error => {
    assert.equal((error as { code: string }).code, 'STORAGE_ERROR'); assert.equal((error as Error).message.includes(f.root), false); return true
  })
  const receipt = await f.service.receipt(preview.operationId)
  assert.equal(receipt!.kind, 'create')
  assert.equal((await f.projection.read()).approved.length, 2)
  await assert.rejects(f.service.commit(preview.token), { code: 'CONFLICT' })
})

test('a placement appearing after preview blocks archive and preserves the new planning file', async t => {
  const f = await fixture(t), target = await selected(f), preview = await f.service.preview({ kind: 'archive', ...target })
  const path = join(f.root, '.webnovel', 'planning', 'outline-state.json')
  const planning = JSON.stringify({ version: 1, total: { revision: 0, hash: '' }, assignments: [{ eventId: target.eventId, assignedAt: stamp }], chapters: [] })
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, planning)
  const before = logical(f)
  await assert.rejects(f.service.commit(preview.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before); assert.equal(await readFile(path, 'utf8'), planning)
})

test('mirror failure remains separate from a successfully committed content version', async t => {
  const f = await fixture(t)
  const service = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime,
    { syncCommitted: async () => { throw new Error(f.root) } })
  const preview = await service.preview({ kind: 'edit', ...await selected(f), content, granularity: 'macro' })
  const result = await service.commit(preview.token)
  assert.deepEqual(result.mirror, { status: 'failed', issue: 'storage-error' })
  assert.deepEqual(await service.receipt(preview.operationId), result.receipt)
  assert.equal((await f.projection.read()).approved[0]!.content.event, content.event)
})

test('order and lifecycle operations do not republish an unchanged readable mirror', async t => {
  const f = await fixture(t)
  let mirrorCalls = 0
  const service = new EventOperationService(f.factory, f.reader, f.currentScope, f.writes, f.runtime,
    { syncCommitted: async () => { mirrorCalls += 1; return { status: 'synced', issue: 'none' } } })
  let view = await f.projection.read()
  let preview = await service.preview({ kind: 'create', content, granularity: 'macro', expectedOrderId: view.state.order.id })
  const created = await service.commit(preview.token)
  assert.equal(mirrorCalls, 1)

  view = await f.projection.read()
  preview = await service.preview({ kind: 'reorder', expectedOrderId: view.state.order.id, eventIds: [...view.state.order.eventIds].reverse() })
  assert.deepEqual((await service.commit(preview.token)).mirror, { status: 'pending', issue: 'unavailable' })
  preview = await service.preview({ kind: 'archive', ...await selected(f, created.receipt.eventId!) })
  assert.deepEqual((await service.commit(preview.token)).mirror, { status: 'pending', issue: 'unavailable' })
  preview = await service.preview({ kind: 'restore', ...await selected(f, created.receipt.eventId!) })
  assert.deepEqual((await service.commit(preview.token)).mirror, { status: 'pending', issue: 'unavailable' })
  assert.equal(mirrorCalls, 1)
})

for (const reference of ['canonical', 'legacy', 'prefixed']) test(`archive refuses ${reference} planning references before authorization`, async t => {
  const f = await fixture(t), target = await selected(f)
  await mkdir(join(f.root, '.webnovel', 'planning'))
  await writeFile(join(f.root, '.webnovel', 'planning', 'outline-state.json'), JSON.stringify({ version: 1, total: { revision: 0, hash: '' },
    assignments: [{ eventId: reference === 'canonical' ? target.eventId : reference === 'legacy' ? 'old-one' : 'direct:old-one', assignedAt: stamp }], chapters: [] }))
  const before = logical(f)
  await assert.rejects(f.service.preview({ kind: 'archive', ...target }), error => {
    assert.equal((error as { code: string }).code, 'CONFLICT'); assert.match((error as Error).message, /已关联/); return true
  })
  assert.deepEqual(logical(f), before)
})

for (const change of ['scope', 'cancel', 'expiry', 'file', 'order', 'version'] as const) test(`${change} drift rejects the consumed confirmation without partial writes`, async t => {
  const f = await fixture(t), target = await selected(f), preview = await f.service.preview({ kind: 'archive', ...target })
  if (change === 'scope') f.scope.generation++
  if (change === 'cancel') f.service.cancel()
  if (change === 'expiry') f.expire()
  if (change === 'file') f.hooks.beforeFiles = async () => { await writeFile(join(f.root, '.webnovel', 'config', 'timeline.json'), '{"version":1,"events":[]}') }
  if (change === 'order') raw(f, db => {
    const old = db.prepare('SELECT * FROM event_display_order_versions').get()!
    db.prepare('INSERT INTO event_display_order_versions VALUES (?,?,2,?,?,?,?)').run(randomUUID(),'book',old.id!,old.event_ids_json!,old.content_hash!,stamp)
  })
  if (change === 'version') raw(f, db => {
    const versions = new CanonicalEventVersions(db, 'book', randomUUID), old = versions.list(target.eventId)[0]!
    versions.append(target.eventId, old.id, { ...old, status: 'candidate' }, stamp)
  })
  const before = logical(f)
  await assert.rejects(f.service.commit(preview.token), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
  await assert.rejects(f.service.commit(preview.token), { code: 'CONFLICT' })
})

for (const table of ['canonical_event_versions', 'event_lifecycle_versions', 'event_display_order_versions', 'event_operation_receipts']) {
  test(`failure inserting ${table} rolls the complete create back`, async t => {
    const f = await fixture(t)
    raw(f, db => db.exec(`CREATE TRIGGER inject_operation_failure AFTER INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`))
    const before = logical(f), preview = await f.service.preview({ kind: 'create', content, granularity: 'macro', expectedOrderId: (await f.projection.read()).state.order.id })
    await assert.rejects(f.service.commit(preview.token), { code: 'STORAGE_ERROR' })
    assert.deepEqual(logical(f), before); assert.equal(await f.service.receipt(preview.operationId), null)
  })
}

test('operation receipt rejects mutation/replacement and a corrupted request fails recovery', async t => {
  const f = await fixture(t), receipt = await commit(f, { kind: 'archive', ...await selected(f) })
  raw(f, db => {
    assert.throws(() => db.exec('UPDATE event_operation_receipts SET no_op=1'), /immutable/)
    assert.throws(() => db.exec('DELETE FROM event_operation_receipts'), /immutable/)
    db.exec('PRAGMA recursive_triggers=OFF')
    assert.throws(() => db.exec('INSERT OR REPLACE INTO event_operation_receipts SELECT * FROM event_operation_receipts'), /already recorded/)
    const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='event_operation_receipts_no_update'").get()!.sql as string
    db.exec('DROP TRIGGER event_operation_receipts_no_update')
    db.prepare('UPDATE event_operation_receipts SET request_hash=?').run('0'.repeat(64))
    db.exec(sql)
  })
  await assert.rejects(f.service.receipt(receipt.operationId), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('narrow input cannot smuggle candidate approval, origin, phase or replacement content into adoption', () => {
  const expected = { kind: 'adopt', expectedOrderId: 'order', eventId: 'event', expectedVersionId: 'version', expectedLifecycleId: 'life' }
  for (const extra of [{ creator: 'author' }, { status: 'approved' }, { phase: 'realized' }, { content }, { sources: [] }])
    assert.throws(() => decodeEventOperation({ ...expected, ...extra }), { code: 'VALIDATION_ERROR' })
  const source = { kind: 'create', content, granularity: 'macro', expectedOrderId: 'order' }
  const bytes = JSON.stringify(source), decoded = decodeEventOperation(source)
  assert.equal(JSON.stringify(source), bytes); assert.notEqual(decoded, source)
  assert.throws(() => decodeEventOperation({ kind: 'reorder', expectedOrderId: 'order', eventIds: ['same','same'] }), { code: 'VALIDATION_ERROR' })
})

function schema43(f: Fixture): void {
  raw(f, db => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM event_operation_receipts').get()!.n, 0)
    removeEmptyReviewSchema(db)
    db.exec(`DROP TABLE event_operation_receipts;
      DROP TRIGGER projects_schema_version_v${WORKSPACE_DATABASE_SCHEMA_VERSION}_after_insert;
      CREATE TRIGGER projects_schema_version_v43_after_insert AFTER INSERT ON projects
      BEGIN UPDATE projects SET current_schema_version = 43 WHERE id = NEW.id; END;
      UPDATE projects SET current_schema_version=43;
      DELETE FROM schema_migrations WHERE version>43;
      PRAGMA user_version=43;`)
  })
}

test('schema 43 reads remain byte-identical; explicit 44 preparation preserves event history and creates no operations', async t => {
  const f = await fixture(t); schema43(f)
  const before = await readFile(f.path)
  const read = (await f.factory.openEventReadOnly(f.root))!
  try { assert.equal(read.schemaVersion, 43); assert.equal(read.eventOperationReceipt('unknown'), null) } finally { read.close() }
  assert.deepEqual(await readFile(f.path), before)
  await assert.rejects(f.factory.openEventOperationWrite(f.root), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await readFile(f.path), before)
  const histories = raw(f, db => db.prepare('SELECT * FROM canonical_event_versions').all())
  const checksums = raw(f, db => db.prepare('SELECT * FROM schema_migrations').all())
  ;(await f.factory.openExisting(f.root))!.close()
  raw(f, db => {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    assert.deepEqual(db.prepare('SELECT * FROM canonical_event_versions').all(), histories)
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<44').all(), checksums)
    assert.equal(db.prepare('SELECT count(*) AS n FROM event_operation_receipts').get()!.n, 0)
  })
})

test('schema 44 ledger failure rolls back the numbered migration and preserves schema 43 data', async t => {
  const f = await fixture(t); schema43(f)
  raw(f, db => db.exec("CREATE TRIGGER fail_operation_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=44 BEGIN SELECT RAISE(ABORT,'injected'); END"))
  const history = raw(f, db => db.prepare('SELECT * FROM canonical_event_versions').all())
  await assert.rejects(f.factory.openExisting(f.root))
  raw(f, db => {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 43)
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='event_operation_receipts'").get()!.n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=44').get()!.n, 0)
    assert.deepEqual(db.prepare('SELECT * FROM canonical_event_versions').all(), history)
  })
})

test('unknown schema name collision survives failed preparation and altered current guards fail closed', async t => {
  const f = await fixture(t); schema43(f)
  raw(f, db => db.exec("CREATE TABLE event_operation_receipts(author_note TEXT); INSERT INTO event_operation_receipts VALUES ('保留未知资料')"))
  await assert.rejects(f.factory.openExisting(f.root))
  assert.equal(raw(f, db => db.prepare('SELECT author_note FROM event_operation_receipts').get()!.author_note), '保留未知资料')
  const current = await fixture(t)
  raw(current, db => db.exec("DROP TRIGGER event_operation_receipts_no_update; CREATE TRIGGER event_operation_receipts_no_update BEFORE UPDATE ON event_operation_receipts BEGIN SELECT 1; END"))
  await assert.rejects(current.factory.openEventReadOnly(current.root), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('the verified intermediate schema 44 checksum reopens, while altered guards still fail closed', async t => {
  const f = await fixture(t)
  raw(f, db => db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=44').run(intermediateEventOperationSchema44Checksum))
  ;(await f.factory.openEventReadOnly(f.root))!.close()
  raw(f, db => db.exec("DROP TRIGGER event_operation_receipts_no_update; CREATE TRIGGER event_operation_receipts_no_update BEFORE UPDATE ON event_operation_receipts BEGIN SELECT 1; END"))
  await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('malformed placement ledger cannot be normalized away to permit archive', async t => {
  const f = await fixture(t), target = await selected(f)
  await mkdir(join(f.root, '.webnovel', 'planning'))
  await writeFile(join(f.root, '.webnovel', 'planning', 'outline-state.json'), JSON.stringify({ version: 1, total: { revision: 0, hash: '' }, assignments: 'damaged', chapters: [] }))
  const before = logical(f)
  await assert.rejects(f.service.preview({ kind: 'archive', ...target }), { code: 'CONFLICT' })
  assert.deepEqual(logical(f), before)
})
