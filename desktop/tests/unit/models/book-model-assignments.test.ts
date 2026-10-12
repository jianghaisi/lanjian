import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../src/main/core/errors/app-error'
import { applyBookModelAssignment, assignmentConflict } from '../../../src/main/modules/models/domain/book-model-assignments'
import { BOOK_MODEL_TASKS, decodeBookModelSettings, referenceBookModelSettings } from '../../../src/main/modules/models/domain/book-model-settings'
import type { BookModelRequestScope } from '../../../src/main/modules/models/domain/book-model-resolution'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort } from '../../../src/main/core/ports/workspace-database'
import { BookModelAssignments } from '../../../src/main/modules/models/application/book-model-assignments'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { ModelConnectionsService } from '../../../src/main/modules/models/application/model-connections-service'
import { ModelConnectionsStore } from '../../../src/main/modules/models/adapters/model-connections-store'
import { FileBookModelSource } from '../../../src/main/modules/models/adapters/book-model-source'
import { BookModelAssignmentStore } from '../../../src/main/modules/models/adapters/book-model-assignment-store'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { atomicWriteText } from '../../../src/main/platform/storage/atomic-file'
import { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID } from '../../../src/contracts/models/local-model-contracts'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const p = (connectionId = 'primary', model = 'manual-gpt') => ({ connectionId, model, temperature: 0.6, topP: 0.9, maxTokens: 1024 })
const legacy = (version = 2) => ({ version, connections: [{ id: 'primary', name: '私有旧接口', baseUrl: 'https://private.example.test/v1' }],
  routingMode: 'perTask', shared: p(), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p()])) })
const assignGlobal = () => ({ globalReferences: [{ id: 'writer', globalConnectionId: 'global-gemini' }],
  tasks: { prose: { connectionId: 'writer', model: 'manual-gemini' } }, globalRevisions: [{ id: 'global-gemini', revision: 1 }] })
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError); assert.equal(error.code, expected)
  assert.doesNotMatch(JSON.stringify(error), /secret-sentinel|raw-fixture-error|example\.test|user-data/)
  return true
}
async function hashes(root: string, directory = root): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(values, await hashes(root, path))
    else values[relative(root, path)] = hash(await fs.readFile(path))
  }
  return values
}
async function fixture(t: TestContext, mode: 'files' | 'ready' | 'unready' | 'shadow' | 'old' = 'files') {
  const parent = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(join(parent, 'lanjian-assignment-')))
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-assignment-'))); await fs.rm(root, { recursive: true, force: true }) })
  const book = join(root, 'book-a'), other = join(root, 'book-b'), app = join(root, 'user-data')
  for (const path of [join(book, '.webnovel'), join(other, '.webnovel'), app]) await fs.mkdir(path, { recursive: true })
  const aiFile = join(book, '.webnovel', 'ai-settings.json'), dbFile = join(book, '.webnovel', 'workspace.sqlite')
  const raw = JSON.stringify(legacy(), null, 2) + '\n'
  await fs.writeFile(aiFile, raw); await fs.writeFile(join(other, '.webnovel', 'ai-settings.json'), raw)
  await fs.writeFile(join(book, 'manuscript.txt'), '隔离原稿保持不变。')
  await fs.writeFile(join(app, 'settings.json'), JSON.stringify({ unrelated: 'secret-sentinel-original-settings' }))
  const factory = new SqliteWorkspaceDatabaseFactory(), writes = new WorkspaceWriteCoordinator()
  if (mode !== 'files') {
    if (mode !== 'old') (await factory.open(book)).close()
    const db = new DatabaseSync(dbFile)
    try {
      if (mode === 'old') for (const m of workspaceDatabaseMigrations.filter(m => m.version <= 28)) {
        db.exec(m.sql)
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(m.version, m.name, '2026-09-12', m.checksum)
        db.exec(`PRAGMA user_version = ${m.version}`)
      }
      db.prepare('INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('fixture-a', '隔离书', 'active', 'a'.repeat(64), mode === 'shadow' ? 'shadow' : 'sqlite', '2026-09-12', '2026-09-12')
    } finally { db.close() }
    if (mode === 'ready') {
      const db = (await factory.openExisting(book))!, content = JSON.stringify(legacy())
      try { const result = db.importAiSettings(content, hash(content), hash(raw)); db.acknowledgeMirror(result.mirror!, 'synced', hash(raw)) }
      finally { db.close() }
    }
  }
  const globals = new ModelConnectionsService(new ModelConnectionsStore(app), {
    available: () => true, encrypt: () => assert.fail('assignment must not encrypt'), decrypt: () => assert.fail('assignment must not decrypt')
  }, () => 'global-gemini')
  await globals.create({ expectedRevision: 0, name: 'Gemini 共用接口', baseUrl: 'https://global.example.test/v1', protocol: 'openai-compatible' })
  const scope: BookModelRequestScope = { windowId: 'fixture-window', bookRoot: book, generation: 1 }
  const books = new FileBookModelSource()
  const create = (selectedFactory: WorkspaceDatabaseFactory = factory, publish = atomicWriteText) => {
    const formal = new SqliteManuscriptService(selectedFactory, undefined, writes)
    const store = new BookModelAssignmentStore(formal, writes, publish)
    return new BookModelAssignments(books, store, globals, () => scope)
  }
  const wrapDb = (wrap: (db: WorkspaceDatabasePort) => WorkspaceDatabasePort): WorkspaceDatabaseFactory => ({
    open: path => factory.open(path), openExisting: path => factory.openExisting(path),
    openModelSettingsWrite: async path => wrap(await factory.openModelSettingsWrite(path))
  })
  const changeGlobal = async () => { const v = await globals.list(); await globals.update({ expectedRevision: v.revision, id: 'global-gemini', connectionRevision: v.connections[0].revision, enabled: false }) }
  return { root, book, other, app, aiFile, dbFile, factory, writes, books, globals, scope, create, wrapDb, changeGlobal }
}

for (const mode of ['files', 'ready', 'unready', 'shadow'] as const) test(`${mode}: captured save attaches global routing and preserves private slots, keys and other books`, async t => {
  const f = await fixture(t, mode), before = await hashes(f.root), edit = await f.create().read()
  assert.deepEqual(await hashes(f.root), before)
  edit.settings.tasks.outline.model = 'caller cannot mutate retained baseline'
  const result = await edit.save(assignGlobal())
  assert.equal(result.settings.version, 4)
  if (result.settings.version !== 4) assert.fail()
  assert.deepEqual(result.settings.references[0], { kind: 'legacy-private', ...legacy().connections[0], originalConnectionId: 'primary' })
  assert.equal(result.settings.tasks.prose.model, 'manual-gemini'); assert.equal(result.settings.tasks.outline.model, 'manual-gpt')
  assert.equal(result.scope.bookIdentity, (await f.books.capture(f.book)).sourceIdentity)
  assert.equal(result.authority, mode === 'ready' || mode === 'unready' ? 'sqlite' : 'files')
  assert.equal(result.mirrorStatus, result.authority === 'sqlite' ? 'synced' : 'not-applicable')
  assert.equal(JSON.parse(await fs.readFile(f.aiFile, 'utf8')).tasks.prose.model, 'manual-gemini')
  assert.deepEqual(await hashes(f.app), Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith('user-data')).map(([path, value]) => [relative('user-data', path), value])))
  assert.equal(hash(await fs.readFile(join(f.book, 'manuscript.txt'))), before[join('book-a', 'manuscript.txt')])
  assert.equal(hash(await fs.readFile(join(f.other, '.webnovel', 'ai-settings.json'))), before[join('book-b', '.webnovel', 'ai-settings.json')])
  if (result.authority === 'sqlite') {
    const db = await f.factory.openModelSettingsWrite(f.book)
    try {
      assert.equal(db.aiSettings().contentHash, result.contentHash)
      assert.equal(db.aiSettings().revision, mode === 'ready' ? 2 : 1)
      assert.equal(db.listModelConfigs().find(c => c.provider === 'global:global-gemini#prose')?.modelName, 'manual-gemini')
    } finally { db.close() }
  }
  assert.doesNotMatch(JSON.stringify(result), /secret-sentinel|encrypted|bookRoot/)
  await assert.rejects(edit.save(assignGlobal()), code('CONFLICT'))
})

for (const mode of ['files', 'ready'] as const) for (const drift of ['switch', 'switch-back', 'window', 'source', 'global'] as const) {
  test(`${mode}: ${drift} after read rejects without model writes`, async t => {
    const f = await fixture(t, mode), edit = await f.create().read()
    if (drift === 'switch') { f.scope.bookRoot = f.other; f.scope.generation++ }
    if (drift === 'switch-back') f.scope.generation += 2
    if (drift === 'window') f.scope.windowId = 'another-window'
    if (drift === 'source') {
      if (mode === 'files') await fs.writeFile(f.aiFile, JSON.stringify({ ...legacy(), shared: p('primary', 'external') }))
      else { const db = new DatabaseSync(f.dbFile); try { db.exec('UPDATE ai_settings_documents SET revision = revision + 1') } finally { db.close() } }
    }
    if (drift === 'global') await f.changeGlobal()
    const before = await hashes(f.root)
    await assert.rejects(edit.save(assignGlobal()), code('CONFLICT'))
    assert.deepEqual(await hashes(f.root), before)
  })
}

for (const mode of ['files', 'ready'] as const) test(`${mode}: queued writes retain the original book and two readers cannot overwrite each other`, async t => {
  const f = await fixture(t, mode), edit = await f.create().read()
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(r => { entered = r })
  const busy = f.writes.run(f.book, async () => { entered(); await new Promise<void>(r => { release = r }) })
  await started
  const pending = edit.save(assignGlobal())
  const rejected = assert.rejects(pending, code('CONFLICT'))
  f.scope.generation += 2
  const before = await hashes(f.root)
  release(); await busy; await rejected
  assert.deepEqual(await hashes(f.root), before)
  const a = await f.create().read(), b = await f.create().read()
  const results = await Promise.allSettled([a.save({ tasks: { prose: { model: 'winner-a' } } }), b.save({ tasks: { prose: { model: 'winner-b' } } })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult
  code('CONFLICT')(failure.reason)
})

test('profile patches preserve copied default revision and allow local repair with zero catalog access', async t => {
  const f = await fixture(t), doc = referenceBookModelSettings(legacy())
  doc.defaultRevision = 3
  doc.references.push({ kind: 'global', id: 'missing', globalConnectionId: 'global-missing' })
  await fs.writeFile(f.aiFile, JSON.stringify(doc))
  t.mock.method(f.globals, 'list', async () => assert.fail('local/private save must not read global catalog'))
  const result = await (await f.create().read()).save({ routingMode: 'shared', shared: p(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID) })
  assert.equal(result.settings.version, 4)
  if (result.settings.version !== 4) assert.fail()
  assert.equal(result.settings.defaultRevision, 3); assert.equal(result.settings.references.length, 2)
  assert.equal(result.settings.tasks.prose.connectionId, 'primary')
  const before = await hashes(f.root)
  await assert.rejects((await f.create().read()).save({ shared: { maxTokens: 8192 } }), code('VALIDATION_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

test('private route repair retains an inactive custom profile offline but does not authorize editing or activating it', async t => {
  const f = await fixture(t), doc = referenceBookModelSettings(legacy())
  doc.version = 5
  doc.references.push({ kind: 'global', id: 'missing', globalConnectionId: 'global-missing', lastKnownName: '原接口' })
  doc.shared = { connectionId: 'missing', model: 'old-writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0 } } }
  await fs.writeFile(f.aiFile, JSON.stringify(doc))
  const otherBefore = await hashes(f.other), appBefore = await hashes(f.app)
  t.mock.method(f.globals, 'list', async () => assert.fail('untouched inactive custom parameters need no catalog access'))
  const saved = await (await f.create().read()).save({ tasks: { prose: { model: 'repaired-private-writer' } } })
  assert.deepEqual(saved.settings.shared, doc.shared)
  assert.equal(saved.settings.tasks.prose.model, 'repaired-private-writer')
  const before = await hashes(f.root), edit = await f.create().read()
  await assert.rejects(edit.save({ routingMode: 'shared' }), code('VALIDATION_ERROR'))
  await assert.rejects(edit.save({ shared: { model: 'changed-inactive' } }), code('VALIDATION_ERROR'))
  await assert.rejects(edit.save({ globalReferences: [{ id: 'missing', globalConnectionId: 'global-gemini' }] }), code('VALIDATION_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
  assert.deepEqual(await hashes(f.other), otherBefore)
  assert.deepEqual(await hashes(f.app), appBefore)
})

for (const input of [
  { apiKey: 'secret-sentinel' }, { connections: [] }, { defaultRevision: 9 },
  { shared: { model: 'ok', extra: 'secret-sentinel' } }, { shared: { temperature: NaN } },
  { tasks: { unknown: p() } }, { shared: null },
  { globalReferences: [{ id: 'primary', globalConnectionId: 'global-gemini' }] },
  { globalReferences: [{ id: 'alias', globalConnectionId: 'global-gemini', baseUrl: 'https://injected.example.test' }] },
  { globalReferences: new Array(1) }, { tasks: { prose: { connectionId: 'missing' } } },
  { shared: {}, globalRevisions: [{ id: 'global-gemini', revision: 1 }, { id: 'global-gemini', revision: 1 }] }
]) test('strict assignment input rejects unauthorized fields or invalid shape', () => {
  assert.throws(() => applyBookModelAssignment(decodeBookModelSettings(legacy()), input), code('VALIDATION_ERROR'))
})

test('missing or extra global revision evidence rejects before writes and does not erase input', async t => {
  const f = await fixture(t), before = await hashes(f.root), input = assignGlobal()
  input.globalRevisions = []
  const edit = await f.create().read()
  await assert.rejects(edit.save(input), code('VALIDATION_ERROR'))
  assert.equal(input.tasks.prose.model, 'manual-gemini')
  await assert.rejects(edit.save({ shared: { model: 'manual' }, globalRevisions: [{ id: 'global-gemini', revision: 1 }] }), code('VALIDATION_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

test('file publication rechecks source and scope after staging; failures clean only owned temporary files', async t => {
  const f = await fixture(t), input = assignGlobal()
  const publish: typeof atomicWriteText = async (path, content, recheck, assertActive) => {
    await atomicWriteText(path, content, async () => { await recheck!(); f.scope.generation += 2 }, assertActive)
  }
  const before = await hashes(f.root)
  await assert.rejects((await f.create(f.factory, publish).read()).save(input), code('CONFLICT'))
  assert.deepEqual(await hashes(f.root), before)
  const failing: typeof atomicWriteText = async () => { throw Error('raw-fixture-error secret-sentinel') }
  await assert.rejects((await f.create(f.factory, failing).read()).save(input), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

test('file publish detects an external edit after staging and never overwrites it', async t => {
  const f = await fixture(t)
  const changed = JSON.stringify({ ...legacy(), shared: p('primary', 'external-winner') })
  const publish: typeof atomicWriteText = (path, content, recheck, assertActive) => atomicWriteText(path, content, async () => {
    await fs.writeFile(f.aiFile, changed); await recheck!()
  }, assertActive)
  await assert.rejects((await f.create(f.factory, publish).read()).save(assignGlobal()), code('CONFLICT'))
  assert.equal(await fs.readFile(f.aiFile, 'utf8'), changed)
  assert.ok((await fs.readdir(join(f.book, '.webnovel'))).every(name => !name.endsWith('.tmp')))
})

test('SQLite write open refuses old or absent databases and never calls migrating openExisting', async t => {
  const f = await fixture(t, 'old'), before = await hashes(f.root)
  t.mock.method(f.factory, 'openExisting', async () => assert.fail('no migration lane'))
  await assert.rejects((await f.create().read()).save(assignGlobal()), code('FEATURE_UNAVAILABLE'))
  await assert.rejects(f.factory.openModelSettingsWrite(f.book), code('FEATURE_UNAVAILABLE'))
  await assert.rejects(f.factory.openModelSettingsWrite(f.other), code('CONFLICT'))
  assert.deepEqual(await hashes(f.root), before)
})

test('SQLite save rejects mode drift and uses no fallback for a missing bounded writer', async t => {
  const f = await fixture(t, 'ready'), edit = await f.create().read(), db = new DatabaseSync(f.dbFile)
  try { db.exec("UPDATE projects SET storage_mode = 'shadow'") } finally { db.close() }
  const before = await hashes(f.root)
  await assert.rejects(edit.save(assignGlobal()), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
  const missing = await fixture(t, 'ready')
  const badFactory: WorkspaceDatabaseFactory = { open: async () => assert.fail(), openExisting: async () => assert.fail() }
  await assert.rejects((await missing.create(badFactory).read()).save(assignGlobal()), code('FEATURE_UNAVAILABLE'))
})

test('SQLite transaction guard rejects same-hash revision drift, foreign project and late scope changes', async t => {
  const f = await fixture(t, 'ready'), db = await f.factory.openModelSettingsWrite(f.book)
  try {
    const current = db.aiSettings(), next = JSON.stringify({ ...legacy(), shared: p('primary', 'new') })
    assert.throws(() => db.replaceAiSettings(current.contentHash, next, hash(next), { projectId: 'foreign', revision: current.revision, assertActive() {} }), code('CONFLICT'))
    assert.throws(() => db.replaceAiSettings(current.contentHash, next, hash(next), { projectId: 'fixture-a', revision: current.revision + 1, assertActive() {} }), code('CONFLICT'))
    let checks = 0
    assert.throws(() => db.replaceAiSettings(current.contentHash, next, hash(next), { projectId: 'fixture-a', revision: current.revision,
      assertActive() { if (++checks === 2) throw assignmentConflict() } }), code('CONFLICT'))
    assert.equal(checks, 2); assert.deepEqual(db.aiSettings(), current)
  } finally { db.close() }
})

test('SQLite projection failure rolls back AI document and preserves original mirror', async t => {
  const f = await fixture(t, 'ready'), db = new DatabaseSync(f.dbFile)
  try { db.exec("CREATE TRIGGER fail_assignment BEFORE INSERT ON model_configs BEGIN SELECT RAISE(ABORT, 'raw-fixture-error secret-sentinel'); END") } finally { db.close() }
  const before = await hashes(f.root)
  await assert.rejects((await f.create().read()).save(assignGlobal()), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

for (const issue of ['external', 'switch', 'ack-failure', 'close-failure'] as const) test(`SQLite post-commit ${issue} preserves successful formal result with separate mirror feedback`, async t => {
  const f = await fixture(t, 'ready'), beforeMirror = await fs.readFile(f.aiFile, 'utf8'), beforeOther = await hashes(f.other)
  const wrapped = f.wrapDb(db => {
    const original = db.replaceAiSettings.bind(db)
    t.mock.method(db, 'replaceAiSettings', (...args: Parameters<WorkspaceDatabasePort['replaceAiSettings']>) => {
      const result = original(...args)
      if (issue === 'external') writeFileSync(f.aiFile, '外部镜像编辑不可覆盖。')
      if (issue === 'switch') { f.scope.bookRoot = f.other; f.scope.generation++ }
      return result
    })
    if (issue === 'ack-failure') t.mock.method(db, 'acknowledgeMirror', () => { throw Error('raw-fixture-error') })
    if (issue === 'close-failure') {
      const close = db.close.bind(db)
      t.mock.method(db, 'close', () => { close(); throw Error('raw-fixture-error secret-sentinel') })
    }
    return db
  })
  const result = await (await f.create(wrapped).read()).save(assignGlobal())
  assert.equal(result.settings.tasks.prose.model, 'manual-gemini'); assert.equal(result.revision, 2)
  assert.equal(result.mirrorStatus, issue === 'external' ? 'conflict' : issue === 'switch' ? 'pending' : issue === 'ack-failure' ? 'failed' : 'synced')
  assert.equal(result.scope.generation, 1)
  const formal = await f.factory.openModelSettingsWrite(f.book)
  try { assert.equal(formal.aiSettings().contentHash, result.contentHash) } finally { formal.close() }
  assert.deepEqual(await hashes(f.other), beforeOther)
  if (issue === 'external') assert.equal(await fs.readFile(f.aiFile, 'utf8'), '外部镜像编辑不可覆盖。')
  if (issue === 'switch') assert.equal(await fs.readFile(f.aiFile, 'utf8'), beforeMirror)
})

test('SQLite mirror detects a last-moment external edit while the atomic temporary file is being opened', async t => {
  const f = await fixture(t, 'ready'), original = fs.open.bind(fs)
  let injected = 0
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args)
    if (String(args[0]).replaceAll('\\', '/').startsWith(f.aiFile.replaceAll('\\', '/') + '.') && String(args[0]).endsWith('.tmp')) {
      injected++; writeFileSync(f.aiFile, '迟到的外部镜像。')
    }
    return handle
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const result = await (await f.create().read()).save(assignGlobal())
  assert.equal(injected, 1)
  assert.equal(result.mirrorStatus, 'conflict'); assert.equal(result.settings.tasks.prose.model, 'manual-gemini')
  assert.equal(await fs.readFile(f.aiFile, 'utf8'), '迟到的外部镜像。')
})

test('unknown database-open errors are sanitized and do not claim rollback or expose paths', async t => {
  const f = await fixture(t, 'ready'), before = await hashes(f.root)
  const factory: WorkspaceDatabaseFactory = { ...f.wrapDb(db => db),
    openModelSettingsWrite: async () => { throw Error('raw-fixture-error secret-sentinel user-data') } }
  await assert.rejects((await f.create(factory).read()).save(assignGlobal()), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

test('an unchanged formal save keeps its accepted result when mirror status cannot be read', async t => {
  const f = await fixture(t, 'ready'), wrapped = f.wrapDb(db => {
    t.mock.method(db, 'aiSettingsMirror', () => { throw Error('raw-fixture-error') })
    return db
  })
  const before = await hashes(f.root)
  const result = await (await f.create(wrapped).read()).save({ shared: { model: 'manual-gpt' } })
  assert.equal(result.revision, 1); assert.equal(result.mirrorStatus, 'failed')
  assert.deepEqual(await hashes(f.root), before)
})
