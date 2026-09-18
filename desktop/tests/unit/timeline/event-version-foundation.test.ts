import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import {
  assertAppendStoryEventVersionInput, assertStoryRevisionRef, type AppendStoryEventVersionInput, type StoryEventVersion
} from '../../../src/main/modules/timeline/domain/story-event-version'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION, type WorkspaceCanonicalEventRecord, type WorkspaceDatabasePort } from '../../../src/main/core/ports/workspace-database'
import { canonicalEventVersionTables, CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const timestamp = '2026-09-11T02:00:00.000Z'
const sourceHash = 'a'.repeat(64)
const event: WorkspaceCanonicalEventRecord = {
  id: 'event-one', time: '第一夜', characters: ['沈砚', '守钟人'], location: '旧钟楼', event: '听见延迟七秒的回音',
  result: '决定次夜调查', evidenceRefs: [{ sourceId: 'material-one', excerpt: '  原始摘录\n保留逐字证据。  ' }],
  confidence: 0.9, status: 'candidate', createdAt: timestamp
}

function insertProject(raw: DatabaseSync, id = 'book-one') {
  raw.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES (?, '隔离事件测试', 'active', ?, 'sqlite', ?, ?)`).run(id, 'b'.repeat(64), timestamp, timestamp)
}

function insertSource(raw: DatabaseSync, project = 'book-one', id = 'material-one') {
  raw.prepare(`INSERT INTO material_sources (id, project_id, provider, source_type, title, captured_at, excerpt, user_notes, content_hash)
    VALUES (?, ?, 'manual', 'manual', '原始资料', ?, ?, '', ?)`).run(id, project, timestamp, event.evidenceRefs[0]!.excerpt, sourceHash)
}

function insertLegacyEvent(raw: DatabaseSync, id = event.id, status = event.status) {
  raw.prepare(`INSERT INTO canonical_events (id, project_id, time_ref, location_text, event_text, result_text, confidence, status, event_signature, slot_signature, created_at, approved_at)
    VALUES (?, 'book-one', ?, ?, ?, ?, ?, ?, ?, 'legacy-slot', ?, ?)`)
    .run(id, event.time, event.location, event.event, event.result!, event.confidence, status, id, timestamp, status === 'approved' ? timestamp : null)
  event.characters.forEach((name, ordinal) => raw.prepare('INSERT INTO canonical_event_characters VALUES (?, ?, ?, ?)').run(id, ordinal, name, name))
  raw.prepare('INSERT INTO canonical_event_evidence_refs VALUES (?, 0, ?, ?)').run(id, 'material-one', event.evidenceRefs[0]!.excerpt)
}

async function fixture(context: TestContext, oldSchema = false) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-event-version-'))
  await mkdir(join(root, '.webnovel', 'research'), { recursive: true })
  const mirrorPath = join(root, '.webnovel', 'research', 'events.json')
  const bodyPath = join(root, 'isolated-manuscript.md')
  const timelinePath = join(root, '.webnovel', 'timeline.json')
  await writeFile(mirrorPath, JSON.stringify({ version: 1, events: [event] }) + '\r\n')
  await writeFile(bodyPath, '# 第一章\r\n原始正文。\r\n')
  await writeFile(timelinePath, '{"events":[{"id":"old-direct"}]}\r\n')
  const path = join(root, WORKSPACE_DATABASE_RELATIVE_PATH)
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(timestamp))
  const opened: WorkspaceDatabasePort[] = []
  const openExisting = factory.openExisting.bind(factory)
  factory.openExisting = async (workItemId: string) => {
    const database = await openExisting(workItemId)
    if (database) opened.push(database)
    return database
  }
  if (!oldSchema) (await factory.open(root)).close()
  const raw = new DatabaseSync(path, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  if (oldSchema) {
    for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 25)) {
      raw.exec(migration.sql)
      raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, timestamp, migration.checksum)
      raw.exec(`PRAGMA user_version = ${migration.version}`)
    }
  }
  insertProject(raw)
  insertSource(raw)
  raw.exec('UPDATE projects SET canonical_events_ready = 1, material_sources_ready = 1')
  const bytes = async () => Promise.all([mirrorPath, bodyPath, timelinePath].map((file) => readFile(file, 'utf8')))
  context.after(async () => {
    opened.forEach((database) => database.close())
    raw.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, path, raw, factory, bytes }
}

function appendInput(version: Pick<StoryEventVersion, 'id' | 'eventId' | 'content'>, overrides: Partial<AppendStoryEventVersionInput> = {}): AppendStoryEventVersionInput {
  return {
    eventId: version.eventId, expectedVersionId: version.id, content: { ...version.content, event: '细化为三个场景' },
    status: 'candidate', phase: 'planned', granularity: 'chapter-detail', creator: 'model-candidate',
    sources: [{ relation: 'derived-from', source: { kind: 'material', id: 'material-one', revision: sourceHash } }], ...overrides
  }
}

function counts(raw: DatabaseSync) {
  return [...canonicalEventVersionTables, 'canonical_events', 'canonical_event_characters', 'canonical_event_evidence_refs', 'mirror_entries']
    .map((table) => raw.prepare(`SELECT * FROM ${table}`).all())
}

test('validates exact revision references, enums, bounds and candidate authority in the pure domain', () => {
  const valid = appendInput({ id: 'v1', eventId: event.id, content: event })
  assert.doesNotThrow(() => assertAppendStoryEventVersionInput(valid))
  const bad: unknown[] = [null, { ...valid, status: ['approved'] }, { ...valid, creator: ['author'] },
    { ...valid, phase: ['planned'] }, { ...valid, granularity: ['macro'] }, { ...valid, expectedVersionId: '' },
    { ...valid, status: 'approved' }, { ...valid, content: { ...valid.content, time: ' ' } },
    { ...valid, content: { ...valid.content, characters: [] } }, { ...valid, content: { ...valid.content, confidence: NaN } },
    { ...valid, content: { ...valid.content, event: 'x'.repeat(20_001) } }, { ...valid, sources: [] },
    { ...valid, phase: 'realized' }, { ...valid, sources: [valid.sources[0], valid.sources[0]] }]
  for (const value of bad) assert.throws(() => assertAppendStoryEventVersionInput(value), { code: 'VALIDATION_ERROR' })
  for (const ref of [{ kind: ['event'], id: 'event', revision: 'v1' }, { kind: 'event', id: ' ', revision: 'v1' },
    { kind: 'event', id: 'event', revision: 'v\n1' }, { kind: 'material', id: 'source', revision: 'not-a-hash' }]) {
    assert.throws(() => assertStoryRevisionRef(ref), { code: 'VALIDATION_ERROR' })
  }
})

test('upgrades old schema without story conversion; explicit legacy baseline preserves unknown provenance and exact bytes', async (context) => {
  const { root, raw, factory, bytes } = await fixture(context, true)
  insertLegacyEvent(raw)
  insertLegacyEvent(raw, 'approved-legacy', 'approved')
  raw.prepare('UPDATE material_sources SET content_hash = ?, excerpt = ? WHERE id = ?').run('c'.repeat(64), '资料已被作者修改', 'material-one')
  const original = await bytes()
  const legacyRows = raw.prepare('SELECT * FROM canonical_events ORDER BY id').all()
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  assert.equal(database.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.deepEqual(database.listCanonicalEventVersions(event.id), [])
  assert.equal(database.canonicalEventVersionHeads(event.id), null)
  assert.deepEqual(raw.prepare('SELECT * FROM canonical_events ORDER BY id').all(), legacyRows)
  const baseline = database.baselineCanonicalEventVersions()
  assert.equal(baseline.length, 2)
  for (const version of baseline) {
    assert.equal(version.version, 1)
    assert.equal(version.phase, 'legacy-unknown')
    assert.equal(version.granularity, 'legacy-unknown')
    assert.equal(version.creator, 'legacy-unknown')
    assert.deepEqual(version.sources, [])
    assert.deepEqual(version.content.evidenceRefs, event.evidenceRefs)
    assert.deepEqual(version.content.characters, event.characters)
    assert.equal(version.content.result, event.result)
  }
  assert.deepEqual(database.baselineCanonicalEventVersions(), baseline)
  assert.equal(database.canonicalEventVersionHeads(event.id)?.approvedVersionId, null)
  assert.ok(database.canonicalEventVersionHeads('approved-legacy')?.approvedVersionId)
  assert.deepEqual(raw.prepare('SELECT * FROM canonical_events ORDER BY id').all(), legacyRows)
  assert.deepEqual(await bytes(), original)
  assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('reading legacy events through the research library leaves both import and history pending until explicit writes', async (context) => {
  const { root, raw, factory, bytes } = await fixture(context)
  raw.exec('UPDATE projects SET canonical_events_ready = 0')
  const database = await factory.openExisting(root)
  assert.ok(database)
  const settings = new SettingsStore(join(root, 'isolated-user-data'), {
    available: () => false,
    encrypt: () => assert.fail('this read path must not access credentials'),
    decrypt: () => assert.fail('this read path must not access credentials')
  })
  await settings.setCurrentProject(root)
  const projects = new ProjectService(settings)
  const library = new ResearchLibraryService(projects, {
    readMaterialSources: async () => database.formalMaterialSourcesReady() ? database.listMaterialSources() : null,
    readCanonicalEvents: async () => database.formalCanonicalEventsReady() ? database.listCanonicalEvents() : null,
    active: async (workItemId) => {
      assert.equal(workItemId, await projects.currentPath())
      return database.storageMode() === 'sqlite'
    },
    materialSourcesReady: async () => database.formalMaterialSourcesReady(),
    materialSources: async () => database.listMaterialSources(),
    searchMaterialSources: async (_, terms, pinned, limit) => database.searchMaterialSources(terms, pinned, limit),
    importMaterialSources: async (_, sources, observedHash) => database.importMaterialSources(sources, observedHash).sources,
    addMaterialSources: async (_, sources) => database.addMaterialSources(sources).sources,
    updateMaterialSource: async (_, source) => database.updateMaterialSource(source).source,
    canonicalEventsReady: async () => database.formalCanonicalEventsReady(),
    canonicalEvents: async () => database.listCanonicalEvents(),
    importCanonicalEvents: async (_, events, observedHash) => database.importCanonicalEvents(events, observedHash).events,
    createCanonicalEvent: async (_, candidate) => database.createCanonicalEvent(candidate).event,
    approveCanonicalEvent: async (_, id) => database.approveCanonicalEvent(id).event
  })
  const originalBytes = await bytes()
  assert.deepEqual(await library.listEvents(), { events: [event] })
  assert.equal(database.formalCanonicalEventsReady(), false)
  assert.equal(raw.prepare('SELECT COUNT(*) AS total FROM canonical_events').get()?.total, 0)
  assert.deepEqual(await library.listEvents(), { events: [event] })
  assert.equal(database.formalCanonicalEventsReady(), false)
  database.importCanonicalEvents([event])
  assert.deepEqual(database.listCanonicalEventVersions(event.id), [])
  assert.equal(database.canonicalEventVersionHeads(event.id), null)
  const baseline = database.baselineCanonicalEventVersions()
  assert.equal(baseline.length, 1)
  assert.equal(baseline[0]?.version, 1)
  assert.equal(baseline[0]?.eventId, event.id)
  assert.equal(baseline[0]?.status, event.status)
  assert.equal(baseline[0]?.phase, 'legacy-unknown')
  assert.deepEqual(baseline[0]?.sources, [])
  assert.deepEqual(baseline[0]?.content, {
    time: event.time, characters: event.characters, location: event.location, event: event.event,
    result: event.result, evidenceRefs: event.evidenceRefs, confidence: event.confidence
  })
  assert.deepEqual(database.baselineCanonicalEventVersions(), baseline)
  assert.deepEqual(await bytes(), originalBytes)
})

test('create and approval retain candidate history; pending edits do not advance formal content or formal head', async (context) => {
  const { root, raw, factory } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  database.createCanonicalEvent(event)
  const candidate = database.listCanonicalEventVersions(event.id)[0]!
  assert.equal(candidate.status, 'candidate')
  assert.equal(candidate.sources[0]?.source.revision, sourceHash)
  assert.equal(database.canonicalEventVersionHeads(event.id)?.approvedVersionId, null)
  database.approveCanonicalEvent(event.id)
  const approved = database.listCanonicalEventVersions(event.id)[1]!
  assert.equal(approved.status, 'approved')
  assert.equal(approved.phase, 'legacy-unknown')
  assert.deepEqual(database.listCanonicalEventVersions(event.id)[0], candidate)
  const mirrorBefore = database.canonicalEventsMirror()
  const pending = database.appendCanonicalEventVersion(appendInput(approved))
  assert.equal(pending.mirror, null)
  assert.equal(pending.heads.approvedVersionId, approved.id)
  assert.equal(database.listCanonicalEvents()[0]?.event, event.event)
  assert.deepEqual(database.canonicalEventsMirror(), mirrorBefore)
  const legacyNoop = database.approveCanonicalEvent(event.id)
  assert.equal(legacyNoop.mirror, null)
  assert.equal(legacyNoop.event.event, event.event)
  assert.equal(database.listCanonicalEventVersions(event.id).length, 3)
  database.appendCanonicalEventVersion(appendInput(pending.version, { status: 'approved', creator: 'author' }))
  assert.equal(database.listCanonicalEventVersions(event.id).length, 4)
  assert.equal(database.listCanonicalEvents()[0]?.event, '细化为三个场景')
  assert.equal(database.listCanonicalEventVersions(event.id).at(-1)?.phase, 'planned')
  const before = counts(raw)
  assert.throws(() => database.appendCanonicalEventVersion(appendInput(approved)), { code: 'CONFLICT' })
  assert.deepEqual(counts(raw), before)
})

test('source guards reject missing, changed, unsupported and foreign references with no partial writes', async (context) => {
  const { root, raw, factory } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  database.createCanonicalEvent(event)
  const candidate = database.listCanonicalEventVersions(event.id)[0]!
  const before = counts(raw)
  for (const source of [
    { kind: 'material' as const, id: 'material-one', revision: 'd'.repeat(64) },
    { kind: 'event' as const, id: 'foreign-event', revision: 'foreign-version' },
    { kind: 'chapter-skeleton' as const, id: 'skeleton-one', revision: 'v1' },
    { kind: 'manuscript' as const, id: 'chapter-one', revision: 'missing' },
    { kind: 'total-outline' as const, id: 'outline-one', revision: 'missing' }
  ]) {
    const input = appendInput(candidate)
    input.sources.push({ relation: 'derived-from', source })
    assert.throws(() => database.appendCanonicalEventVersion(input), { code: 'CONFLICT' })
    assert.deepEqual(counts(raw), before)
  }
  raw.exec('BEGIN IMMEDIATE')
  try {
    insertProject(raw, 'book-two')
    insertSource(raw, 'book-two', 'foreign-material')
    const helper = new CanonicalEventVersions(raw, 'book-one', () => 'foreign-test-version')
    const input = appendInput(candidate, { content: { ...event, evidenceRefs: [{ sourceId: 'foreign-material', excerpt: '外书资料' }] },
      sources: [{ relation: 'derived-from', source: { kind: 'material', id: 'foreign-material', revision: sourceHash } }] })
    assert.throws(() => helper.append(event.id, candidate.id, input, timestamp), { code: 'CONFLICT' })
    const json = JSON.stringify(input)
    assert.throws(() => raw.prepare(`INSERT INTO canonical_event_versions VALUES ('cross-book-version', 'book-two', ?, 2, ?, ?, ?, ?)`)
      .run(event.id, candidate.id, json, createHash('sha256').update(json).digest('hex'), timestamp), /cross-project event version/)
    const originOnly = { ...input, content: { ...input.content, evidenceRefs: [] } }
    const originJson = JSON.stringify(originOnly)
    raw.prepare(`INSERT INTO canonical_event_versions VALUES ('cross-source-version', 'book-one', ?, 2, ?, ?, ?, ?)`)
      .run(event.id, candidate.id, originJson, createHash('sha256').update(originJson).digest('hex'), timestamp)
    assert.throws(() => raw.prepare('INSERT INTO canonical_event_version_sources VALUES (?, 0, ?, ?, ?, ?)')
      .run('cross-source-version', 'derived-from', 'material', 'foreign-material', sourceHash), /cross-project event source/)
    assert.throws(() => raw.prepare('INSERT INTO canonical_event_version_seals VALUES (?)').run('cross-source-version'), /incomplete/)
  } finally { raw.exec('ROLLBACK') }
  assert.deepEqual(counts(raw), before)
})

test('sealed history rejects updates, deletes, new source edges and invalid formal heads at the SQLite boundary', async (context) => {
  const { root, raw, factory } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  database.createCanonicalEvent(event)
  const candidate = database.listCanonicalEventVersions(event.id)[0]!
  for (const table of canonicalEventVersionTables.slice(0, 3)) {
    assert.throws(() => raw.exec(`UPDATE ${table} SET ${table === 'canonical_event_versions' ? 'created_at = created_at' : 'version_id = version_id'}`), /append-only/)
    assert.throws(() => raw.exec(`DELETE FROM ${table}`), /append-only/)
  }
  assert.throws(() => raw.prepare('INSERT INTO canonical_event_version_sources VALUES (?, 1, ?, ?, ?, ?)')
    .run(candidate.id, 'derived-from', 'material', 'material-one', sourceHash), /sealed/)
  assert.throws(() => raw.prepare('UPDATE canonical_event_version_heads SET approved_version_id = ? WHERE event_id = ?').run(candidate.id, event.id), /approved version/)
  assert.throws(() => raw.exec('DELETE FROM canonical_event_version_heads'), /cannot be deleted/)
  database.createCanonicalEvent({ ...event, id: 'event-two', event: '第二个事件' })
  const other = database.listCanonicalEventVersions('event-two')[0]!
  assert.throws(() => raw.prepare('UPDATE canonical_event_version_heads SET latest_version_id = ? WHERE event_id = ?').run(other.id, event.id), /latest version/)
  database.approveCanonicalEvent(event.id)
  assert.throws(() => raw.prepare('UPDATE canonical_event_version_heads SET approved_version_id = NULL WHERE event_id = ?').run(event.id), /cannot be cleared/)
})

test('failure after version and sources rolls back creation, approval, baseline and mirrors together', async (context) => {
  const { root, raw, factory, bytes } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  const originals = await bytes()
  raw.exec(`CREATE TRIGGER inject_version_failure BEFORE INSERT ON canonical_event_version_heads BEGIN SELECT RAISE(ABORT, 'injected head failure'); END`)
  const empty = counts(raw)
  assert.throws(() => database.createCanonicalEvent(event), { code: 'STORAGE_ERROR' })
  assert.deepEqual(counts(raw), empty)
  raw.exec('DROP TRIGGER inject_version_failure')
  database.createCanonicalEvent(event)
  raw.exec(`CREATE TRIGGER inject_version_failure BEFORE UPDATE ON canonical_event_version_heads BEGIN SELECT RAISE(ABORT, 'injected head failure'); END`)
  const candidate = counts(raw)
  assert.throws(() => database.approveCanonicalEvent(event.id), { code: 'STORAGE_ERROR' })
  assert.deepEqual(counts(raw), candidate)
  assert.throws(() => database.appendCanonicalEventVersion(appendInput(database.listCanonicalEventVersions(event.id)[0]!)), { code: 'STORAGE_ERROR' })
  assert.deepEqual(counts(raw), candidate)
  raw.exec('DROP TRIGGER inject_version_failure')
  insertLegacyEvent(raw, 'legacy-extra')
  raw.exec(`CREATE TRIGGER inject_version_failure BEFORE INSERT ON canonical_event_version_heads BEGIN SELECT RAISE(ABORT, 'injected baseline failure'); END`)
  const legacy = counts(raw)
  assert.throws(() => database.baselineCanonicalEventVersions(), { code: 'STORAGE_ERROR' })
  assert.deepEqual(counts(raw), legacy)
  assert.deepEqual(await bytes(), originals)
})

test('schema migration failure leaves pre-version story rows and schema version intact', async (context) => {
  const { root, raw, factory, bytes } = await fixture(context, true)
  insertLegacyEvent(raw)
  const original = await bytes()
  const oldRows = raw.prepare('SELECT * FROM canonical_events').all()
  raw.exec('CREATE TABLE canonical_event_versions (collision TEXT)')
  await assert.rejects(factory.openExisting(root), { code: 'DATABASE_MIGRATION_FAILED' })
  assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 37)
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 38').get()?.count, 0)
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'canonical_event_version_heads'").get()?.count, 0)
  assert.ok(raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'projects_schema_version_v37_after_insert'").get())
  assert.deepEqual(raw.prepare('SELECT * FROM canonical_events').all(), oldRows)
  assert.deepEqual(await bytes(), original)
})

test('reads fail closed on tampered version payload and leave original mirrors untouched', async (context) => {
  const { root, raw, factory, bytes } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  context.after(() => database.close())
  database.createCanonicalEvent(event)
  const original = await bytes()
  raw.exec('DROP TRIGGER canonical_event_versions_no_update')
  raw.exec(`UPDATE canonical_event_versions SET payload_json = json_set(payload_json, '$.content.event', '伪造内容')`)
  assert.throws(() => database.listCanonicalEventVersions(event.id), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.throws(() => database.approveCanonicalEvent(event.id), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await bytes(), original)
})

test('canonical reads and writes reject projections that differ from their sealed selected version', async (context) => {
  const mutations = [
    ['event content', "UPDATE canonical_events SET event_text = '篡改的正式事件'"],
    ['characters', "UPDATE canonical_event_characters SET name = '陌生人' WHERE ordinal = 0"],
    ['missing evidence', 'DELETE FROM canonical_event_evidence_refs'],
    ['approval state', "UPDATE canonical_events SET status = 'candidate'"],
    ['empty result', "UPDATE canonical_events SET result_text = ''"]
  ] as const
  for (const [name, sql] of mutations) {
    await context.test(name, async (scenario) => {
      const { root, raw, factory, bytes } = await fixture(scenario)
      const database = await factory.openExisting(root)
      assert.ok(database)
      database.createCanonicalEvent(event)
      database.approveCanonicalEvent(event.id)
      const approved = database.listCanonicalEventVersions(event.id).at(-1)!
      const originalBytes = await bytes()
      raw.exec(sql)
      const corrupted = counts(raw)
      assert.throws(() => database.listCanonicalEvents(), { code: 'DATABASE_INTEGRITY_FAILED' })
      assert.throws(() => database.appendCanonicalEventVersion(appendInput(approved, { status: 'approved', creator: 'author' })), { code: 'DATABASE_INTEGRITY_FAILED' })
      assert.throws(() => database.approveCanonicalEvent(event.id), { code: 'DATABASE_INTEGRITY_FAILED' })
      assert.deepEqual(counts(raw), corrupted)
      assert.deepEqual(await bytes(), originalBytes)
    })
  }
})

test('legacy baseline and approval retain an explicitly empty optional result', async (context) => {
  const { root, raw, factory } = await fixture(context)
  insertLegacyEvent(raw)
  raw.exec("UPDATE canonical_events SET result_text = ''")
  const database = await factory.openExisting(root)
  assert.ok(database)
  assert.equal(database.listCanonicalEvents()[0]?.result, '')
  assert.equal(database.baselineCanonicalEventVersions()[0]?.content.result, '')
  database.approveCanonicalEvent(event.id)
  assert.equal(database.listCanonicalEvents()[0]?.result, '')
  assert.equal(database.listCanonicalEventVersions(event.id).at(-1)?.content.result, '')
})

test('a sealed but damaged source event cannot authorize a new provenance link', async (context) => {
  const { root, raw, factory } = await fixture(context)
  const database = await factory.openExisting(root)
  assert.ok(database)
  database.createCanonicalEvent(event)
  const source = database.listCanonicalEventVersions(event.id)[0]!
  database.createCanonicalEvent({ ...event, id: 'target-event', event: '目标事件' })
  database.approveCanonicalEvent('target-event')
  const target = database.listCanonicalEventVersions('target-event').at(-1)!
  const input = appendInput(target)
  input.sources.push({ relation: 'derived-from', source: { kind: 'event', id: event.id, revision: source.id } })
  raw.exec('DROP TRIGGER canonical_event_versions_no_update')
  raw.prepare("UPDATE canonical_event_versions SET payload_json = json_set(payload_json, '$.content.event', '损坏的来源事件') WHERE id = ?").run(source.id)
  const before = counts(raw)
  assert.throws(() => database.appendCanonicalEventVersion(input), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(counts(raw), before)
})

test('binds exact outline and manuscript versions while preserving planned history alongside realized candidates', async (context) => {
  const { root, raw, factory } = await fixture(context)
  raw.prepare(`INSERT INTO outline_nodes (id, project_id, legacy_key, node_type, seq, title, content, content_hash, status, created_at, updated_at)
    VALUES ('outline-one', 'book-one', 'total', 'summary', 1, '总纲', '宏观事件', ?, 'draft', ?, ?)`)
    .run('d'.repeat(64), timestamp, timestamp)
  raw.prepare(`INSERT INTO outline_versions (id, outline_node_id, version_no, content, content_hash, source_type, created_at)
    VALUES ('outline-v1', 'outline-one', 1, '宏观事件', ?, 'manual', ?)`)
    .run('d'.repeat(64), timestamp)
  raw.prepare(`INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, created_at, updated_at)
    VALUES ('chapter-one', 'book-one', 1, 1, '第一章', 'draft', ?, ?)`).run(timestamp, timestamp)
  raw.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, source_type, created_at)
    VALUES ('body-v1', 'chapter-one', 1, '实际发生的事件', ?, 'manual', ?)`).run('e'.repeat(64), timestamp)
  const database = await factory.openExisting(root)
  assert.ok(database)
  database.createCanonicalEvent(event)
  const first = database.listCanonicalEventVersions(event.id)[0]!
  const plannedInput = appendInput(first, { status: 'approved', creator: 'author', granularity: 'macro' })
  plannedInput.sources.push({ relation: 'derived-from', source: { kind: 'total-outline', id: 'outline-one', revision: 'outline-v1' } })
  const planned = database.appendCanonicalEventVersion(plannedInput).version
  const actualInput = appendInput(planned, { creator: 'manuscript-extraction', phase: 'realized' })
  actualInput.sources.push({ relation: 'derived-from', source: { kind: 'manuscript', id: 'chapter-one', revision: 'body-v1' } },
    { relation: 'realizes', source: { kind: 'event', id: event.id, revision: planned.id } })
  const actual = database.appendCanonicalEventVersion(actualInput)
  assert.equal(actual.version.phase, 'realized')
  assert.equal(actual.heads.approvedVersionId, planned.id)
  assert.deepEqual(database.listCanonicalEventVersions(event.id)[1], planned)
  assert.equal(actual.version.sources.at(-1)?.source.revision, planned.id)
  const invalidKind = appendInput(actual.version)
  invalidKind.sources.push({ relation: 'derived-from', source: { kind: 'volume-outline', id: 'outline-one', revision: 'outline-v1' } })
  assert.throws(() => database.appendCanonicalEventVersion(invalidKind), { code: 'CONFLICT' })
})
