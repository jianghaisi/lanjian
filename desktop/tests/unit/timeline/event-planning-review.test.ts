import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { inspectEventPlanningLedger, type EventPlanningFinding } from '../../../src/main/modules/timeline/domain/event-planning-review'
import { inspectEventMigrationSources } from '../../../src/main/modules/timeline/domain/event-migration-review'
import type { WorkspaceEventChapterCatalog } from '../../../src/main/core/ports/workspace-database'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-12T02:00:00.000Z'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64)
function plan() {
  return { version: 1, total: { revision: 2, hash: a, updatedAt: stamp }, assignments: [{ eventId: 'event-one', assignedAt: stamp }],
    volumes: [{ volume: 1, title: '第一卷', eventIds: ['event-one'], revision: 3, outlineHash: b, createdAt: stamp, updatedAt: stamp }],
    chapterPlacements: [{ chapterId: 7, volume: 1, assignedAt: stamp, updatedAt: stamp }],
    manuscriptStarts: [{ chapterId: 7, revision: a, volume: 1, completed: false }],
    eventChapterPlacements: [{ eventId: 'event-one', chapterId: 7, assignedAt: stamp, updatedAt: stamp }],
    chapters: [{ chapterId: 7, volume: 1, basedOnTotalRevision: 2, basedOnVolumeRevision: 3, outlineHash: c, savedAt: stamp }],
    chapterConfirmations: [{ chapterId: 7, outlineHash: c, basedOnTotalRevision: 2, basedOnVolumeRevision: 3, eventIds: ['event-one'], confirmedAt: stamp }],
    outlineReviewAcknowledgements: [{ scope: 'total', fingerprint: a, issueCodes: ['LEGACY_REVIEW'], acknowledgedAt: stamp }],
    planningConfirmations: [{ scope: 'total', fingerprint: a, confirmedAt: stamp }, { scope: 1, fingerprint: b, basedOnTotalFingerprint: a, confirmedAt: stamp }] }
}
function catalog(entries: WorkspaceEventChapterCatalog['entries'] = [{ kind: 'outline', chapterId: 7, status: 'active', revision: 'outline-version' }]): WorkspaceEventChapterCatalog {
  return { manuscripts: 'sqlite', outlines: 'sqlite', entries }
}
function inspect(value: Record<string, unknown> | null = plan(), chapters = catalog()) {
  let units = 0
  const references: Array<{ path: string; id: unknown }> = []
  const findings = inspectEventPlanningLedger(value, chapters, () => { if (++units > 100_000) throw new AppError('VALIDATION_ERROR', 'review bound') },
    (owner, id) => { units++; references.push({ path: owner.path, id }) })
  return { findings, references, units }
}
const has = (findings: EventPlanningFinding[], code: EventPlanningFinding['code'], path?: string) => findings.some(item => item.code === code && (!path || item.path === path))

test('absent ledger and complete current ledger remain distinct, with no invented planning defaults', () => {
  assert.deepEqual(inspect(null).findings, [])
  const result = inspect()
  assert.deepEqual(result.findings, [])
  assert.equal(result.references.length, 4)
})

test('strict inspection leaves unknown fields, repeated references and raw order unchanged', () => {
  const value = { ...plan(), unknown: { nested: ['保留', '顺序'] }, volumes: [{ ...plan().volumes[0]!, eventIds: ['event-one', 'event-one'] }] }
  const before = JSON.stringify(value)
  const result = inspect(value)
  assert.equal(result.references.length, 5)
  assert.ok(has(result.findings, 'duplicate-identity', 'volumes[0].eventIds'))
  assert.equal(JSON.stringify(value), before)
})

test('total revision is never coerced, reset or repaired to zero', () => {
  for (const revision of ['2', -1, NaN, 0.5]) {
    assert.ok(has(inspect({ ...plan(), total: { revision, hash: a } }).findings, 'invalid-field', 'total.revision'))
  }
  assert.ok(has(inspect({ ...plan(), total: { revision: 2, hash: '' } }).findings, 'invalid-field', 'total.hash'))
  assert.ok(!has(inspect({ ...plan(), total: { revision: 0, hash: '' } }).findings, 'invalid-field', 'total.hash'))
})

test('all nine planning collections validate their fields and explicit malformed owners', () => {
  const cases = [
    ['assignments', { eventId: ' padded ', assignedAt: stamp }, 'eventId'],
    ['volumes', { ...plan().volumes[0]!, title: ' ' }, 'title'],
    ['chapterPlacements', { ...plan().chapterPlacements[0]!, chapterId: 1_000_001 }, 'chapterId'],
    ['manuscriptStarts', { ...plan().manuscriptStarts[0]!, completed: 'true' }, 'completed'],
    ['eventChapterPlacements', { ...plan().eventChapterPlacements[0]!, assignedAt: 'not-a-date' }, 'assignedAt'],
    ['chapters', { ...plan().chapters[0]!, outlineHash: 'bad' }, 'outlineHash'],
    ['chapterConfirmations', { ...plan().chapterConfirmations[0]!, confirmedAt: null }, 'confirmedAt'],
    ['outlineReviewAcknowledgements', { ...plan().outlineReviewAcknowledgements[0]!, fingerprint: 'bad' }, 'fingerprint'],
    ['planningConfirmations', { ...plan().planningConfirmations[0]!, basedOnTotalFingerprint: a }, 'basedOnTotalFingerprint']
  ] as const
  for (const [collection, item, field] of cases) {
    assert.ok(has(inspect({ ...plan(), [collection]: [item] }).findings, 'invalid-field', `${collection}[0].${field}`), collection)
    assert.ok(has(inspect({ ...plan(), [collection]: [null] }).findings, 'invalid-reference-owner', `${collection}[0]`), collection)
    assert.ok(has(inspect({ ...plan(), [collection]: {} }).findings, 'invalid-collection', collection), collection)
  }
})

test('every identity collection rejects repeated keys, including invalid same-key rows', () => {
  const value = plan()
  for (const collection of ['assignments', 'volumes', 'chapterPlacements', 'manuscriptStarts', 'eventChapterPlacements', 'chapters', 'chapterConfirmations', 'outlineReviewAcknowledgements', 'planningConfirmations'] as const) {
    const item = value[collection][0]!
    assert.ok(has(inspect({ ...value, [collection]: [item, item] }).findings, 'duplicate-identity'), collection)
  }
  const findings = inspect({ ...value, assignments: [value.assignments[0], { eventId: 'event-one' }] }).findings
  assert.ok(has(findings, 'ambiguous-reference', 'volumes[0].eventIds[0]'))
})

test('chapter/event volumes must agree, with no inferred chapter from event time', () => {
  const value = plan()
  value.volumes.push({ ...value.volumes[0]!, volume: 2, title: '第二卷', eventIds: [] })
  value.chapterPlacements[0]!.volume = 2
  const result = inspect(value)
  assert.ok(has(result.findings, 'event-volume-mismatch', 'eventChapterPlacements[0]'))
  assert.ok(result.findings.some(item => item.code === 'stale-dependency' && item.severity === 'review'))
})

test('missing assignments, volumes, chapter placement and saved chapter dependency stay visible', () => {
  assert.ok(has(inspect({ ...plan(), assignments: [] }).findings, 'missing-assignment'))
  assert.ok(has(inspect({ ...plan(), volumes: [] }).findings, 'missing-volume'))
  assert.ok(has(inspect({ ...plan(), chapterPlacements: [] }).findings, 'missing-chapter-placement'))
  assert.ok(has(inspect({ ...plan(), chapters: [] }).findings, 'missing-chapter-dependency'))
})

test('one event cannot be placed in multiple volumes, even when chapter volume matches the first', () => {
  const value = plan(); value.volumes.push({ ...value.volumes[0]!, volume: 2, title: '第二卷' })
  const findings = inspect(value).findings
  assert.ok(has(findings, 'duplicate-identity', 'volumes[1].eventIds'))
  assert.ok(has(findings, 'ambiguous-reference', 'eventChapterPlacements[0].eventId'))
})

test('active chapter outline is a valid planned chapter before prose exists', () => {
  assert.deepEqual(inspect(plan(), catalog()).findings, [])
})

test('archived manuscript cannot be rescued by its surviving active chapter outline', () => {
  const chapters = catalog([{ kind: 'outline', chapterId: 7, status: 'active', revision: 'o1' },
    { kind: 'manuscript', chapterId: 7, status: 'archived', revision: 'm1' }])
  const findings = inspect(plan(), chapters).findings
  assert.ok(has(findings, 'archived-chapter', 'eventChapterPlacements[0].chapterId'))
  assert.ok(has(findings, 'archived-chapter', 'chapters[0].chapterId'))
})

test('archived outline, missing chapter and unavailable file identity are not empty successes', () => {
  assert.ok(has(inspect(plan(), catalog([{ kind: 'outline', chapterId: 7, status: 'archived', revision: 'o1' }])).findings, 'archived-chapter'))
  assert.ok(has(inspect(plan(), catalog([])).findings, 'missing-chapter'))
  const unknown: WorkspaceEventChapterCatalog = { manuscripts: 'unavailable', outlines: 'unavailable', entries: [] }
  assert.ok(has(inspect(plan(), unknown).findings, 'chapter-inventory-unavailable'))
  assert.ok(!has(inspect(plan(), unknown).findings, 'missing-chapter'))
})

test('duplicate catalog identities are ambiguous, not resolved by picking one active row', () => {
  const entry = catalog().entries[0]!
  assert.ok(has(inspect(plan(), catalog([entry, entry])).findings, 'ambiguous-chapter'))
})

test('completed manuscript-start receipt requires manuscript identity; incomplete start retains historical outline revision', () => {
  const value = plan(); value.manuscriptStarts[0]!.completed = true
  assert.ok(has(inspect(value).findings, 'missing-chapter', 'manuscriptStarts[0].chapterId'))
  const entries = [...catalog().entries, { kind: 'manuscript' as const, chapterId: 7, status: 'active' as const, revision: 'new-body-version' }]
  assert.deepEqual(inspect(value, catalog(entries)).findings, [])
})

test('past dependencies remain stale review findings, while impossible future revisions block', () => {
  const value = plan(); value.chapters[0]!.basedOnTotalRevision = 1; value.chapters[0]!.basedOnVolumeRevision = 1
  const past = inspect(value).findings
  assert.ok(past.filter(item => item.code === 'stale-dependency').length === 2)
  assert.ok(past.every(item => item.severity === 'review'))
  value.chapters[0]!.basedOnTotalRevision = 9
  assert.ok(has(inspect(value).findings, 'future-dependency-revision'))
})

test('confirmation mismatch is retained for review without rewriting the recorded confirmation', () => {
  const value = plan(); value.chapterConfirmations[0]!.outlineHash = b
  value.planningConfirmations[1]!.basedOnTotalFingerprint = c
  const before = JSON.stringify(value)
  const findings = inspect(value).findings
  assert.ok(findings.filter(item => item.code === 'stale-confirmation').length === 2)
  assert.ok(findings.every(item => item.severity === 'review'))
  assert.equal(JSON.stringify(value), before)
})

test('review issue-code lists and confirmation event lists are checked without deduplication', () => {
  const value = plan(); value.outlineReviewAcknowledgements[0]!.issueCodes = ['LOWER', 'LOWER', 'bad']
  value.chapterConfirmations[0]!.eventIds.push('event-one')
  const findings = inspect(value).findings
  assert.ok(has(findings, 'invalid-field', 'outlineReviewAcknowledgements[0].issueCodes[1]'))
  assert.ok(has(findings, 'invalid-field', 'outlineReviewAcknowledgements[0].issueCodes[2]'))
  assert.ok(has(findings, 'duplicate-identity', 'chapterConfirmations[0].eventIds[1]'))
})

test('legacy optional collections may be absent without pretending that required collections exist', () => {
  const minimum = { version: 1, total: { revision: 0, hash: '' }, assignments: [], chapters: [] }
  assert.deepEqual(inspect(minimum, catalog([])).findings, [])
  assert.ok(has(inspect({ ...minimum, chapters: undefined }).findings, 'invalid-collection', 'chapters'))
})

test('5,000 placed events preserve every edge and avoid pairwise relationship expansion', context => {
  const value = plan(); const ids = Array.from({ length: 5_000 }, (_, index) => `event-${index}`)
  value.assignments = ids.map(eventId => ({ eventId, assignedAt: stamp }))
  value.volumes[0]!.eventIds = ids
  value.eventChapterPlacements = ids.map(eventId => ({ eventId, chapterId: 7, assignedAt: stamp, updatedAt: stamp }))
  value.chapterConfirmations[0]!.eventIds = ids
  const started = performance.now(); const result = inspect(value)
  assert.deepEqual(result.findings, [])
  assert.equal(result.references.length, 20_000)
  assert.ok(result.units < 40_000)
  context.diagnostic(`5,000 placement edges: ${Math.round(performance.now() - started)} ms; no Electron responsiveness claim`)
})

test('malformed unrelated planning rows and issue-code expansion participate in the review budget', () => {
  assert.throws(() => inspect({ ...plan(), manuscriptStarts: Array.from({ length: 100_000 }, () => null) }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => inspect({ ...plan(), outlineReviewAcknowledgements: [{ ...plan().outlineReviewAcknowledgements[0]!, issueCodes: Array.from({ length: 100_000 }, () => 'SAME') }] }), { code: 'VALIDATION_ERROR' })
})

async function fixture(context: TestContext, schema?: number) {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-placement-')))
  context.after(async () => { assert.ok(root.startsWith(join(parent, 'novel-event-placement-'))); await rm(root, { recursive: true, force: true }) })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp))
  const path = join(root, '.webnovel', 'workspace.sqlite')
  if (!schema) (await factory.open(root)).close()
  else {
    const { mkdir } = await import('node:fs/promises'); await mkdir(join(root, '.webnovel'))
  }
  const raw = new DatabaseSync(path)
  try {
    if (schema) for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= schema)) {
      raw.exec(migration.sql)
      raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, stamp, migration.checksum)
      raw.exec(`PRAGMA user_version = ${migration.version}`)
    }
    raw.prepare("INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES ('book-one', '隔离关联测试', 'active', ?, 'sqlite', ?, ?)").run(a, stamp, stamp)
    raw.exec('UPDATE projects SET outline_storage_ready = 1')
  } finally { raw.close() }
  const capture = () => new LocalEventSourceSnapshotReader(factory).capture({ root, workItemId: root, generation: 1 })
  return { root, path, factory, capture }
}
async function manifest(root: string, directory = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(result, await manifest(root, path))
    else result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const db = await f.factory.openExisting(f.root); assert.ok(db)
  try {
    db.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: '隔离总纲' })
    db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '第一卷', content: '隔离卷纲' })
    for (const id of [7, 8]) db.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: id, title: `第${id}章`, content: '隔离章纲' })
    db.writeFormalChapter({ legacyChapterId: 8, title: '已开始正文', content: '隔离作者原文。', reason: 'manual' })
    const content = JSON.stringify(plan()); db.importOutlinePlanningState(content, hash(content))
  } finally { db.close() }
}

test('real chapter catalog captures planned/started/archived identities in the same read facade with exact source preservation', async context => {
  const f = await fixture(context); await seed(f)
  const before = await manifest(f.root)
  let opens = 0; const open = f.factory.openEventReadOnly.bind(f.factory)
  f.factory.openEventReadOnly = async root => { opens++; return open(root) }
  const snapshot = await f.capture()
  assert.equal(opens, 1)
  assert.deepEqual(snapshot.chapterCatalog.entries.map(entry => [entry.kind, entry.chapterId, entry.status]), [
    ['manuscript', 8, 'active'], ['outline', 7, 'active'], ['outline', 8, 'active']])
  assert.ok(snapshot.chapterCatalog.entries.every(entry => entry.revision))
  assert.deepEqual(await manifest(f.root), before)
  assert.deepEqual(inspect(snapshot.documents.planning.value, snapshot.chapterCatalog).findings, [])
  const db = await f.factory.openExisting(f.root); assert.ok(db)
  try { db.archiveFormalChapter(8) } finally { db.close() }
  const archivedBefore = await manifest(f.root); const archived = await f.capture()
  assert.notEqual(archived.fingerprint, snapshot.fingerprint)
  assert.equal(archived.chapterCatalog.entries[0]!.status, 'archived')
  assert.deepEqual(archived.eventHistory, snapshot.eventHistory)
  assert.deepEqual(await manifest(f.root), archivedBefore)
})

test('body and outline revision changes affect the snapshot fingerprint even if placements do not change', async context => {
  const f = await fixture(context); await seed(f); const before = await f.capture()
  const db = await f.factory.openExisting(f.root); assert.ok(db)
  try { db.writeFormalChapter({ legacyChapterId: 8, title: '已开始正文', content: '隔离作者新版本。', reason: 'manual' }) } finally { db.close() }
  const afterBody = await f.capture()
  assert.notEqual(afterBody.fingerprint, before.fingerprint)
  assert.equal(afterBody.documents.planning.contentHash, before.documents.planning.contentHash)
  const outlines = await f.factory.openExisting(f.root); assert.ok(outlines)
  try { outlines.writeFormalOutline({ legacyKey: 'chapter-7', parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: 7, title: '第七章', content: '新章纲版本' }) } finally { outlines.close() }
  assert.notEqual((await f.capture()).fingerprint, afterBody.fingerprint)
})

test('later external chapter archive cannot mix into an already pinned acquisition', async context => {
  const f = await fixture(context); await seed(f)
  const original = f.factory.openEventReadOnly.bind(f.factory); let changed = false
  f.factory.openEventReadOnly = async root => {
    const pinned = await original(root)
    try {
      const writer = await f.factory.openExisting(root); assert.ok(writer)
      try { writer.archiveFormalChapter(8); changed = true } finally { writer.close() }
      return pinned
    } catch (error) { pinned?.close(); throw error }
  }
  const pinned = await f.capture()
  assert.equal(changed, true)
  assert.equal(pinned.chapterCatalog.entries.find(entry => entry.kind === 'manuscript')!.status, 'active')
  f.factory.openEventReadOnly = original
  assert.equal((await f.capture()).chapterCatalog.entries.find(entry => entry.kind === 'manuscript')!.status, 'archived')
})

test('schema-25 chapter identity inspection performs no schema upgrade or history creation', async context => {
  const f = await fixture(context, 25)
  const raw = new DatabaseSync(f.path)
  try { raw.prepare("INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, created_at, updated_at) VALUES ('old-seven', 'book-one', 7, 1, '旧章节', 'archived', ?, ?)").run(stamp, stamp) } finally { raw.close() }
  const before = await manifest(f.root); const snapshot = await f.capture()
  assert.equal(snapshot.database!.schemaVersion, 25)
  assert.deepEqual(snapshot.chapterCatalog.entries, [{ kind: 'manuscript', chapterId: 7, status: 'archived', revision: null }])
  assert.deepEqual(await manifest(f.root), before)
})

test('active legacy chapter without a current version fails safely instead of becoming a valid placement target', async context => {
  const f = await fixture(context, 25)
  const raw = new DatabaseSync(f.path)
  try { raw.prepare("INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, created_at, updated_at) VALUES ('old-seven', 'book-one', 7, 1, '未完成旧章节', 'draft', ?, ?)").run(stamp, stamp) } finally { raw.close() }
  const before = await manifest(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await manifest(f.root), before)
})

test('multiple project roots fail closed before any chapter catalog can be returned', async context => {
  const f = await fixture(context); await seed(f)
  const raw = new DatabaseSync(f.path)
  try {
    raw.prepare("INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES ('book-two', '隔离相邻作品', 'active', ?, 'sqlite', ?, ?)").run(b, stamp, stamp)
    raw.prepare("INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, created_at, updated_at) VALUES ('other-seven', 'book-two', 7, 1, '其他作品章节', 'archived', ?, ?)").run(stamp, stamp)
  } finally { raw.close() }
  const before = await manifest(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await manifest(f.root), before)
})

test('archiving the same chapter number in another book cannot change this book snapshot', async context => {
  const current = await fixture(context), other = await fixture(context)
  await seed(current); await seed(other)
  const before = await current.capture(), originalFiles = await manifest(current.root)
  const writer = await other.factory.openExisting(other.root); assert.ok(writer)
  try { writer.archiveFormalChapter(8) } finally { writer.close() }
  const after = await current.capture(), otherSnapshot = await other.capture()
  assert.equal(after.fingerprint, before.fingerprint)
  assert.equal(after.chapterCatalog.entries[0]!.status, 'active')
  assert.equal(otherSnapshot.chapterCatalog.entries[0]!.status, 'archived')
  assert.deepEqual(await manifest(current.root), originalFiles)
})

test('unready outlines are unavailable, never taken from unadopted rows or inferred from planning', async context => {
  const f = await fixture(context); await seed(f)
  const raw = new DatabaseSync(f.path)
  try { raw.exec('UPDATE projects SET outline_storage_ready = 0') } finally { raw.close() }
  const before = await manifest(f.root); const snapshot = await f.capture()
  assert.equal(snapshot.chapterCatalog.outlines, 'unavailable')
  assert.ok(snapshot.chapterCatalog.entries.every(entry => entry.kind === 'manuscript'))
  const result = inspectEventMigrationSources(snapshot)
  assert.ok(result.planningFindingsPage().items.some(item => item.code === 'chapter-inventory-unavailable'))
  assert.deepEqual(await manifest(f.root), before)
})
