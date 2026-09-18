import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { EventSourceSnapshotService } from '../../../src/main/modules/timeline/application/event-source-snapshot-service'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { AppError } from '../../../src/main/core/errors/app-error'
import { decodeEventSourceDocument, EVENT_SNAPSHOT_MAX_BYTES, type EventSnapshotScope } from '../../../src/main/modules/timeline/domain/event-source-snapshot'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-11T12:00:00.000Z'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const source = { id: 'source-one', provider: 'manual', sourceType: 'manual' as const, title: '逐字来源', capturedAt: stamp,
  excerpt: '  和田、林与舟发现旧城。\r\n', userNotes: '', contentHash: 'a'.repeat(64) }
const event = { id: 'event-one', time: '第一夜', characters: ['和田', '林与舟'], location: '旧城', event: '发现回音', result: '',
  evidenceRefs: [{ sourceId: source.id, excerpt: source.excerpt }], confidence: 1, status: 'candidate' as const, createdAt: stamp }
const direct = { id: 'same-id', title: ' 原始标题 ', time: ' 第二夜 ', characters: '和田、林与舟', location: ' 旧城 ', event: ' 追踪回音 ', result: '', extra: { notes: ['甲', '乙'] } }
const planning = { version: 1, total: { revision: 2, hash: 'c'.repeat(64) }, assignments: [{ eventId: event.id, assignedAt: stamp }],
  volumes: [{ volume: 1, title: '卷一', eventIds: [event.id], revision: 1, outlineHash: 'd'.repeat(64), createdAt: stamp, updatedAt: stamp }],
  chapterPlacements: [{ chapterId: 7, volume: 1, assignedAt: stamp, updatedAt: stamp }], manuscriptStarts: [],
  eventChapterPlacements: [{ eventId: event.id, chapterId: 7, assignedAt: stamp, updatedAt: stamp }],
  chapters: [], chapterConfirmations: [], outlineReviewAcknowledgements: [], planningConfirmations: [], unknown: { keep: true } }
const paths = { sources: '.webnovel/research/sources.json', events: '.webnovel/research/events.json',
  timeline: '.webnovel/config/timeline.json', planning: '.webnovel/planning/outline-state.json' }

async function fixture(context: TestContext, version: number | null = null) {
  const temporaryParent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(temporaryParent, 'novel-event-source-')))
  context.after(async () => {
    assert.ok(root.startsWith(join(temporaryParent, 'novel-event-source-')))
    await rm(root, { recursive: true, force: true })
  })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp))
  const path = join(root, '.webnovel', 'workspace.sqlite')
  if (version !== null) {
    await mkdir(dirname(path), { recursive: true })
    if (version === WORKSPACE_DATABASE_SCHEMA_VERSION) (await factory.open(root)).close()
    const db = new DatabaseSync(path)
    try {
      for (const migration of workspaceDatabaseMigrations.filter((item) => version !== WORKSPACE_DATABASE_SCHEMA_VERSION && item.version <= version)) {
        db.exec(migration.sql)
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, stamp, migration.checksum)
        db.exec(`PRAGMA user_version = ${migration.version}`)
      }
      db.prepare("INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES ('book-one', '隔离来源快照', 'active', ?, 'sqlite', ?, ?)").run('b'.repeat(64), stamp, stamp)
    } finally { db.close() }
  }
  await writeFile(join(root, 'author-notes.md'), '作者手写，任何核对都不能修改。\r\n')
  const scope: EventSnapshotScope = { workItemId: root, root, generation: 1 }
  const reader = new LocalEventSourceSnapshotReader(factory)
  const writes = new WorkspaceWriteCoordinator()
  const service = new EventSourceSnapshotService(reader, async () => ({ ...scope }), writes)
  const put = async (kind: keyof typeof paths, content: string | Buffer) => {
    const target = join(root, paths[kind])
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const seedFiles = async () => {
    await put('sources', JSON.stringify({ version: 1, sources: [source], unknown: ['保留'] }))
    await put('events', JSON.stringify({ version: 1, events: [event] }))
    await put('timeline', '\uFEFF' + JSON.stringify({ events: [direct, { ...direct, result: undefined }], unknown: '原包络' }) + '\r\n')
    await put('planning', JSON.stringify(planning))
  }
  const seedFormal = async () => {
    const db = await factory.openExisting(root)
    assert.ok(db)
    try {
      db.importMaterialSources([source])
      db.importCanonicalEvents([event])
      db.baselineCanonicalEventVersions()
      db.approveCanonicalEvent(event.id)
      const timeline = JSON.stringify({ events: [{ ...direct, title: '数据库标题' }] })
      db.importWorkspaceConfig('timeline', timeline, hash(timeline))
      const state = JSON.stringify(planning)
      db.importOutlinePlanningState(state, hash(state))
    } finally { db.close() }
  }
  return { root, path, scope, factory, reader, writes, service, put, seedFiles, seedFormal }
}

async function hashes(root: string, dir = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) Object.assign(result, await hashes(root, path))
    else result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}

test('absent snapshot leaves the database and all four optional stores absent', async (context) => {
  const f = await fixture(context)
  const before = await hashes(f.root)
  const result = await f.service.capture()
  assert.equal(result.database, null)
  assert.ok(Object.values(result.files).every((file) => file.base64 === null && file.hash === null))
  assert.ok(Object.values(result.documents).every((doc) => doc.authority === 'file' && doc.content === null))
  assert.deepEqual(await hashes(f.root), before)
})

test('lossless snapshot retains exact bytes, BOM, unknown metadata, duplicate identities and absent versus empty result', async (context) => {
  const f = await fixture(context)
  await f.seedFiles()
  const before = await hashes(f.root)
  const result = await f.service.capture()
  const timeline = result.documents.timeline
  assert.deepEqual(timeline.occurrences.map((item) => [item.ordinal, item.originalId]), [[0, 'same-id'], [1, 'same-id']])
  assert.deepEqual(timeline.occurrences[0]!.value, direct)
  assert.ok(!Object.hasOwn(timeline.occurrences[1]!.value as object, 'result'))
  assert.equal(timeline.value?.unknown, '原包络')
  assert.deepEqual(result.documents.planning.value, planning)
  for (const kind of Object.keys(paths) as Array<keyof typeof paths>) {
    assert.deepEqual(Buffer.from(result.files[kind].base64!, 'base64'), await readFile(join(f.root, paths[kind])))
  }
  assert.throws(() => { (timeline.occurrences[0]!.value as typeof direct).extra.notes.push('污染') }, TypeError)
  assert.equal((await f.service.capture()).fingerprint, result.fingerprint)
  assert.deepEqual(await hashes(f.root), before)
})

test('one formal read retains all module revisions, placements and approved/candidate history without mirror writes', async (context) => {
  const f = await fixture(context, WORKSPACE_DATABASE_SCHEMA_VERSION)
  await f.seedFiles()
  await f.seedFormal()
  await f.put('timeline', Buffer.from([0xff, 0xfe, 0x81])) // broken mirror is evidence, not formal input
  let opens = 0
  const original = f.factory.openEventReadOnly.bind(f.factory)
  f.factory.openEventReadOnly = async (root) => { opens++; return original(root) }
  const before = await hashes(f.root)
  const result = await f.service.capture()
  assert.equal(opens, 1)
  assert.equal(result.database?.projectId, 'book-one')
  assert.ok(Object.values(result.documents).every((doc) => doc.authority === 'sqlite'))
  assert.ok(Object.values(result.mirrors).every((mirror) => mirror?.status === 'pending'))
  assert.equal((result.documents.timeline.occurrences[0]!.value as typeof direct).title, '数据库标题')
  assert.equal(result.documents.planning.revision, 1)
  assert.deepEqual(result.documents.planning.value, planning)
  assert.deepEqual(result.eventHistory[0]!.versions.map((version) => version.status), ['candidate', 'approved'])
  assert.equal(result.eventHistory[0]!.heads?.approvedVersionId, result.eventHistory[0]!.versions[1]!.id)
  assert.deepEqual(await hashes(f.root), before)
})

test('schema 25 snapshot reads compatibility and pre-version events without upgrading or baselining', async (context) => {
  const f = await fixture(context, 25)
  await f.seedFiles()
  const before = await hashes(f.root)
  const result = await f.service.capture()
  assert.equal(result.database?.schemaVersion, 25)
  assert.ok(Object.values(result.documents).every((doc) => doc.authority === 'file'))
  assert.deepEqual(result.eventHistory, [])
  assert.deepEqual(await hashes(f.root), before)
  const raw = new DatabaseSync(f.path)
  try {
    raw.prepare("INSERT INTO material_sources (id, project_id, provider, source_type, title, captured_at, excerpt, user_notes, content_hash) VALUES (?, 'book-one', 'manual', 'manual', ?, ?, ?, '', ?)").run(source.id, source.title, stamp, source.excerpt, source.contentHash)
    raw.prepare("INSERT INTO canonical_events (id, project_id, time_ref, location_text, event_text, result_text, confidence, status, event_signature, slot_signature, created_at) VALUES (?, 'book-one', ?, ?, ?, '', 1, 'approved', 'signature', 'slot', ?)").run(event.id, event.time, event.location, event.event, stamp)
    event.characters.forEach((name, ordinal) => raw.prepare('INSERT INTO canonical_event_characters (event_id, ordinal, name, normalized_name) VALUES (?, ?, ?, ?)').run(event.id, ordinal, name, name))
    raw.prepare('INSERT INTO canonical_event_evidence_refs (event_id, ordinal, source_id, excerpt) VALUES (?, 0, ?, ?)').run(event.id, source.id, source.excerpt)
    raw.exec('UPDATE projects SET material_sources_ready = 1, canonical_events_ready = 1')
  } finally { raw.close() }
  const legacyBefore = await hashes(f.root)
  const legacy = await f.service.capture()
  assert.equal(legacy.documents.events.authority, 'sqlite')
  assert.equal(legacy.documents.planning.authority, 'file')
  assert.deepEqual(legacy.eventHistory, [{ eventId: event.id, versions: [], heads: null }])
  assert.deepEqual(await hashes(f.root), legacyBefore)
})

test('placement-only changes alter the retained fingerprint without changing event history', async (context) => {
  const f = await fixture(context, WORKSPACE_DATABASE_SCHEMA_VERSION)
  await f.seedFormal()
  const before = await f.service.capture()
  const db = await f.factory.openExisting(f.root)
  assert.ok(db)
  try {
    const content = JSON.stringify({ ...planning, eventChapterPlacements: [] })
    db.replaceOutlinePlanningState(db.outlinePlanningState().contentHash, content, hash(content))
  } finally { db.close() }
  const after = await f.service.capture()
  assert.equal(after.documents.planning.revision, 2)
  assert.notEqual(after.fingerprint, before.fingerprint)
  assert.deepEqual(after.eventHistory, before.eventHistory)
})

test('a later database write cannot mix new timeline content into an already pinned source snapshot', async (context) => {
  const f = await fixture(context, WORKSPACE_DATABASE_SCHEMA_VERSION)
  await f.seedFiles()
  await f.seedFormal()
  const original = f.factory.openEventReadOnly.bind(f.factory)
  f.factory.openEventReadOnly = async (root) => {
    const pinned = await original(root)
    try {
      const db = await f.factory.openExisting(root)
      assert.ok(db)
      try {
        const content = JSON.stringify({ events: [{ ...direct, title: '稍后修改' }] })
        db.replaceWorkspaceConfig('timeline', db.workspaceConfig('timeline').contentHash, content, hash(content))
      } finally { db.close() }
      return pinned
    } catch (error) { pinned?.close(); throw error }
  }
  const first = await f.service.capture()
  assert.equal((first.documents.timeline.occurrences[0]!.value as typeof direct).title, '数据库标题')
  f.factory.openEventReadOnly = original
  const second = await f.service.capture()
  assert.equal((second.documents.timeline.occurrences[0]!.value as typeof direct).title, '稍后修改')
  assert.notEqual(first.fingerprint, second.fingerprint)
})

  for (const change of ['edited', 'appeared', 'removed'] as const) {
  test(`source file ${change} during acquisition rejects the retained snapshot`, async (context) => {
    const f = await fixture(context)
    if (change !== 'appeared') await f.seedFiles()
    let changed = false
    f.factory.openEventReadOnly = async () => {
      changed = true
      if (change === 'removed') await rm(join(f.root, paths.timeline))
      else await f.put('timeline', JSON.stringify({ events: [{ ...direct, title: '外部修改' }] }))
      return null
    }
    await assert.rejects(f.service.capture(), { code: 'CONFLICT' })
    assert.equal(changed, true)
  })
}

for (const content of ['', '{broken', '{"events":{}}', Buffer.from([0xff])]) {
  test(`malformed active timeline (${typeof content === 'string' ? content || 'empty file' : 'invalid UTF8'}) fails without source writes`, async (context) => {
    const f = await fixture(context)
    await f.put('timeline', content)
    const before = await hashes(f.root)
    await assert.rejects(f.service.capture(), (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'INVALID_PROJECT_STATE')
      assert.ok(!JSON.stringify(error.details).includes(f.root))
      return true
    })
    assert.deepEqual(await hashes(f.root), before)
  })
}

test('invalid individual rows remain addressable evidence, never silently filtered or marked migration-ready', () => {
  const rows = [null, 17, { id: 'duplicate', malformed: true }, { id: 'duplicate', event: [] }]
  const result = decodeEventSourceDocument('events', JSON.stringify({ version: 1, events: rows }))
  assert.deepEqual(result.occurrences.map((item) => item.value), rows)
  assert.deepEqual(result.occurrences.map((item) => item.originalId), [null, null, 'duplicate', 'duplicate'])
  assert.ok(!Object.hasOwn(result, 'canCommit'))
})

test('global occurrence limit rejects the whole read rather than returning a partial store', async (context) => {
  const f = await fixture(context)
  await f.put('timeline', JSON.stringify({ events: Array.from({ length: 100_000 }, () => null) }))
  await f.put('events', JSON.stringify({ version: 1, events: [event] }))
  const before = await hashes(f.root)
  await assert.rejects(f.service.capture(), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await hashes(f.root), before)
})

test('byte budget fails before reading an oversized legacy source and leaves its bytes intact', async (context) => {
  const f = await fixture(context)
  await f.put('timeline', Buffer.alloc(EVENT_SNAPSHOT_MAX_BYTES + 1, 32))
  const before = await hashes(f.root)
  await assert.rejects(f.service.capture(), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await hashes(f.root), before)
})

test('5000 occurrences retain every index and source field in one acquisition', async (context) => {
  const f = await fixture(context)
  const rows = Array.from({ length: 5000 }, (_, ordinal) => ({ ...direct, title: `第${ordinal}项`, ordinal }))
  await f.put('timeline', JSON.stringify({ events: rows }))
  const started = Date.now()
  const result = await f.service.capture()
  assert.deepEqual(result.documents.timeline.occurrences.map((item) => item.value), rows)
  assert.equal(result.documents.timeline.occurrences.at(-1)?.ordinal, 4999)
  context.diagnostic(JSON.stringify({ occurrences: rows.length, captureMs: Date.now() - started }))
})

test('source path escape is rejected without reading or modifying the external target', async (context) => {
  const f = await fixture(context)
  const outside = await fixture(context)
  await outside.put('timeline', JSON.stringify({ events: [direct] }))
  await mkdir(join(f.root, '.webnovel'), { recursive: true })
  await symlink(join(outside.root, '.webnovel', 'config'), join(f.root, '.webnovel', 'config'), 'junction')
  const before = await hashes(outside.root)
  await assert.rejects(f.service.capture(), { code: 'PATH_ESCAPE' })
  assert.deepEqual(await hashes(outside.root), before)
})

test('missing read capability has no writable database fallback', async (context) => {
  const f = await fixture(context)
  const before = await hashes(f.root)
  await assert.rejects(new LocalEventSourceSnapshotReader({}).capture(f.scope), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await hashes(f.root), before)
})

test('same-root session replacement rejects both late success and late error', async (context) => {
  const f = await fixture(context)
  const before = await hashes(f.root)
  for (const fail of [false, true]) {
    let scope = { ...f.scope }
    let captured = false
    const service = new EventSourceSnapshotService({ capture: async (selected) => {
      const result = await f.reader.capture(selected)
      captured = true
      scope = { ...scope, generation: scope.generation + 1 }
      if (fail) throw new AppError('INVALID_PROJECT_STATE', 'old book error')
      return result
    } }, async () => scope, f.writes)
    await assert.rejects(service.capture(), { code: 'CONFLICT' })
    assert.equal(captured, true)
  }
  assert.deepEqual(await hashes(f.root), before)
})

test('snapshot waits for the same-book write lane and rejects a scope change while queued', async (context) => {
  const f = await fixture(context)
  let release!: () => void
  const hold = f.writes.run(f.root, () => new Promise<void>((resolve) => { release = resolve }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  let reads = 0
  let scope = { ...f.scope }
  const service = new EventSourceSnapshotService({ capture: async (selected) => { reads++; return f.reader.capture(selected) } }, async () => scope, f.writes)
  const pending = service.capture()
  const rejected = assert.rejects(pending, { code: 'CONFLICT' })
  scope = { ...scope, generation: 2 }
  release()
  await hold
  await rejected
  assert.equal(reads, 0)
})

test('invalid internal scopes fail before any source reader is called', async (context) => {
  const f = await fixture(context)
  for (const scope of [{ ...f.scope, workItemId: '' }, { ...f.scope, root: '' }, { ...f.scope, generation: NaN }]) {
    const service = new EventSourceSnapshotService({ capture: async () => assert.fail('invalid scope must not read') }, async () => scope, f.writes)
    await assert.rejects(service.capture(), { code: 'CONFLICT' })
  }
})
