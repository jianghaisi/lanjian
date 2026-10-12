import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../src/main/core/errors/app-error'
import { CONNECTION_REUSE_TTL_MS, decodeLegacyConnections, decodeLegacyReusePreview,
  type LegacyReuseScope, type LegacyConnectionSource } from '../../../src/main/modules/models/domain/legacy-connection-reuse'
import { decodeGlobalConnectionDocument, MAX_MODEL_CONNECTION_BYTES, type ModelConnectionSecrets } from '../../../src/main/modules/models/domain/model-connections'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { LegacyConnectionReuseService } from '../../../src/main/modules/models/application/legacy-connection-reuse'
import { ModelConnectionsService } from '../../../src/main/modules/models/application/model-connections-service'
import { FileLegacyConnectionSource } from '../../../src/main/modules/models/adapters/legacy-connection-source'
import { ModelConnectionsStore, GLOBAL_CONNECTIONS_FILE } from '../../../src/main/modules/models/adapters/model-connections-store'
import { atomicWriteText } from '../../../src/main/platform/storage/atomic-file'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const endpoint = 'https://legacy.example.test/v1'
const secret = 'synthetic-reuse-key-not-an-author-key'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const metadata = (id = 'primary') => ({ id, name: '同名接口', baseUrl: endpoint })
const document = (version = 2, ids = ['primary']) => ({ version, connections: ids.map(metadata), routingMode: 'shared',
  shared: { connectionId: ids[0], model: 'fixture-gpt', temperature: 0.7, topP: 1, maxTokens: 8192 },
  tasks: Object.fromEntries(['outline', 'chapterOutline', 'prose', 'review'].map(task => [task, {
    connectionId: ids[0], model: task === 'prose' ? 'fixture-gemini' : 'fixture-gpt', temperature: 0.7, topP: 1, maxTokens: 8192
  }])) })
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError)
  assert.equal(error.code, expected)
  assert.equal(error.recoverable, true)
  assert.doesNotMatch(JSON.stringify(error), /synthetic-reuse|private-cause|legacy\.example|user-data|\.tmp/)
  return true
}

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir())
  const root = await realpath(await mkdtemp(join(parent, 'lanjian-legacy-reuse-')))
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-legacy-reuse-'))); await rm(root, { recursive: true, force: true }) })
  const book = join(root, 'book'), app = join(root, 'user-data'), other = join(root, 'other-book')
  for (const dir of [join(book, '.webnovel'), app, other]) await mkdir(dir, { recursive: true })
  await writeFile(join(book, 'manuscript.txt'), '隔离正文保持原样。\r\n')
  const aiFile = join(book, '.webnovel', 'ai-settings.json'), settingsFile = join(app, 'settings.json')
  await writeFile(aiFile, JSON.stringify(document()))
  const state = { available: true, decrypts: 0, encrypts: 0, failDecrypt: false, failEncrypt: false, time: 1000 }
  const machineKey = randomBytes(32)
  const secrets: ModelConnectionSecrets = {
    available: () => state.available,
    encrypt(value) {
      state.encrypts++
      if (state.failEncrypt) throw Error('private-cause ' + value)
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', machineKey, iv)
      const bytes = Buffer.concat([c.update(value, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), bytes]).toString('base64')
    },
    decrypt(value) {
      state.decrypts++
      if (state.failDecrypt) throw Error('private-cause ' + value)
      const bytes = Buffer.from(value, 'base64'), d = createDecipheriv('aes-256-gcm', machineKey, bytes.subarray(0, 12))
      d.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8')
    }
  }
  const settings = new SettingsStore(app, secrets)
  await settings.updateProjectApiKey(book, secret)
  state.encrypts = 0
  const source = new FileLegacyConnectionSource(app), store = new ModelConnectionsStore(app)
  const scope: LegacyReuseScope = { windowId: 'main-fixture', generation: 1, bookRoot: book }
  let id = 0, token = 0
  const serviceFor = (repository = store, reader: LegacyConnectionSource = source) => new LegacyConnectionReuseService(
    repository, reader, secrets, () => ({ ...scope }), () => `global-reused-${++id}`, () => `reuse-fixture-operation-token-${++token}`, () => state.time)
  const reuse = serviceFor()
  return { root, book, app, other, aiFile, settingsFile, state, secrets, settings, source, store, scope, reuse, serviceFor,
    globalFile: join(app, GLOBAL_CONNECTIONS_FILE), preview: () => reuse.preview({ selectedIds: ['primary'], expectedRevision: 0 }) }
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

test('v1 single-key preview is zero-write/zero-decrypt and confirmation retains all source bytes', async t => {
  const f = await fixture(t)
  await writeFile(f.aiFile, JSON.stringify({ version: 1, baseUrl: endpoint }))
  const legacy = { projectApiKeys: { [f.book]: f.secrets.encrypt(secret) }, ai: { encryptedApiKey: f.secrets.encrypt('unrelated-app-key') } }
  await writeFile(f.settingsFile, JSON.stringify(legacy))
  const before = await hashes(f.root)
  const preview = await f.preview()
  assert.equal(f.state.decrypts, 0)
  assert.deepEqual(await hashes(f.root), before)
  assert.equal(preview.connections[0].credentialState, 'stored')
  assert.doesNotMatch(JSON.stringify(preview), /encrypted|sourceIdentity|sourceFingerprint|synthetic-reuse|bookRoot/)
  assert.ok(!JSON.stringify(preview).includes(f.book))
  const result = await f.reuse.confirm(preview.token)
  assert.equal(f.state.decrypts, 1)
  assert.equal(result.connectionIds.length, 1)
  assert.deepEqual(await hashes(f.book), Object.fromEntries(Object.entries(before).filter(([p]) => p.startsWith('book')).map(([p, h]) => [relative('book', p), h])))
  assert.equal(hash(await readFile(f.settingsFile)), before[relative(f.root, f.settingsFile)])
  const globalText = await readFile(f.globalFile, 'utf8')
  assert.ok(!globalText.includes(secret) && !globalText.includes(f.book))
  const global = new ModelConnectionsService(f.store, f.secrets, () => 'global-extra')
  const credential = await global.prepareCredential(result.connectionIds[0], 1)
  await credential.use(async key => assert.equal(key, secret))
})

for (const version of [2, 3]) test(`v${version} selected maps preserve same-name identities and ignore local routes`, async t => {
  const f = await fixture(t)
  const doc = document(version, ['primary', 'second'])
  if (version === 3) doc.shared.connectionId = 'local:llama-cpp'
  await writeFile(f.aiFile, JSON.stringify(doc))
  await f.settings.updateProjectApiKey(f.book, 'second-synthetic-key', false, 'second')
  const before = await hashes(f.book), oldKeys = await readFile(f.settingsFile)
  const preview = await f.reuse.preview({ selectedIds: ['second', 'primary'], expectedRevision: 0 })
  assert.equal(f.state.decrypts, 0)
  const receipt = await f.reuse.confirm(preview.token)
  assert.equal(new Set(receipt.connectionIds).size, 2)
  const global = new ModelConnectionsService(f.store, f.secrets, () => 'global-extra')
  await (await global.prepareCredential(receipt.connectionIds[0], 1)).use(async key => assert.equal(key, 'second-synthetic-key'))
  await (await global.prepareCredential(receipt.connectionIds[1], 1)).use(async key => assert.equal(key, secret))
  assert.deepEqual(await hashes(f.book), before)
  assert.deepEqual(await readFile(f.settingsFile), oldKeys)
})

test('duplicate confirm, retry and restart return one durable receipt without extra decryption', async t => {
  const f = await fixture(t), preview = await f.preview()
  const [first, duplicate] = await Promise.all([f.reuse.confirm(preview.token), f.reuse.confirm(preview.token)])
  assert.deepEqual(first, duplicate)
  assert.notEqual(first.connectionIds, duplicate.connectionIds)
  const before = await readFile(f.globalFile), decrypts = f.state.decrypts
  assert.deepEqual(await f.reuse.confirm(preview.token), first)
  const restarted = f.serviceFor(new ModelConnectionsStore(f.app))
  assert.deepEqual(await restarted.confirm(preview.token), first)
  assert.equal(f.state.decrypts, decrypts)
  assert.deepEqual(await readFile(f.globalFile), before)
  f.scope.bookRoot = f.other; f.scope.generation++
  assert.equal(await restarted.receipt(preview.token), null)
  await assert.rejects(restarted.confirm(preview.token), code('CONFLICT'))
})

for (const reason of ['cancel', 'switch-back', 'window', 'expiry', 'new-preview', 'restart'] as const) {
  test(`pending preview rejects ${reason} without decrypting or publishing`, async t => {
    const f = await fixture(t), preview = await f.preview(), before = await hashes(f.root)
    let service = f.reuse
    if (reason === 'cancel') service.cancel()
    if (reason === 'switch-back') f.scope.generation += 2
    if (reason === 'window') f.scope.windowId = 'different-window'
    if (reason === 'expiry') f.state.time += CONNECTION_REUSE_TTL_MS
    if (reason === 'new-preview') await f.preview()
    if (reason === 'restart') service = f.serviceFor()
    await assert.rejects(service.confirm(preview.token), code('CONFLICT'))
    assert.equal(f.state.decrypts, 0)
    assert.deepEqual(await hashes(f.root), before)
  })
}

for (const changed of ['metadata', 'credential', 'destination'] as const) test(`${changed} drift invalidates confirmation before decryption`, async t => {
  const f = await fixture(t), preview = await f.preview()
  if (changed === 'metadata') await writeFile(f.aiFile, JSON.stringify(document()).replace(endpoint, 'https://changed.example.test/v1'))
  if (changed === 'credential') await f.settings.updateProjectApiKey(f.book, 'rotated-source-key')
  if (changed === 'destination') await new ModelConnectionsService(f.store, f.secrets, () => 'global-other').create({ expectedRevision: 0, name: 'other', baseUrl: endpoint, protocol: 'openai-compatible' })
  const before = await hashes(f.root)
  await assert.rejects(f.reuse.confirm(preview.token), code('CONFLICT'))
  assert.equal(f.state.decrypts, 0)
  assert.deepEqual(await hashes(f.root), before)
})

for (const failure of ['missing', 'unavailable', 'decrypt', 'encrypt'] as const) test(`${failure} credentials fail safely without app fallback or partial save`, async t => {
  const f = await fixture(t)
  if (failure === 'missing') {
    await writeFile(f.settingsFile, JSON.stringify({ projectApiKeys: {}, ai: { encryptedApiKey: f.secrets.encrypt(secret) } }))
  }
  const preview = await f.preview()
  if (failure === 'unavailable') f.state.available = false
  if (failure === 'decrypt') f.state.failDecrypt = true
  if (failure === 'encrypt') f.state.failEncrypt = true
  const before = await hashes(f.root)
  await assert.rejects(f.reuse.confirm(preview.token), code('FEATURE_UNAVAILABLE'))
  assert.deepEqual(await hashes(f.root), before)
})

test('ordinary global create/update preserve receipts and storage refuses receipt tampering', async t => {
  const f = await fixture(t), preview = await f.preview()
  const receipt = await f.reuse.confirm(preview.token)
  const original = (await f.store.read()).document.reuseReceipts
  const global = new ModelConnectionsService(f.store, f.secrets, () => 'global-extra')
  await global.create({ expectedRevision: 1, name: 'extra', baseUrl: endpoint, protocol: 'openai-compatible' })
  await global.update({ expectedRevision: 2, id: receipt.connectionIds[0], connectionRevision: 1, enabled: false })
  const snapshot = await f.store.read(), bytes = await readFile(f.globalFile)
  assert.deepEqual(snapshot.document.reuseReceipts, original)
  const changed = structuredClone(snapshot.document); changed.revision++; changed.reuseReceipts![0].sourceIdentity = '0'.repeat(64)
  await assert.rejects(f.store.commit(snapshot, changed), code('STORAGE_ERROR'))
  await assert.rejects(f.store.commit(snapshot, { ...snapshot.document, revision: 4, reuseReceipts: [] }), code('STORAGE_ERROR'))
  assert.deepEqual(await readFile(f.globalFile), bytes)
})

test('source change during staging and cancellation during guard prevent publication', async t => {
  for (const action of ['change', 'cancel']) {
    const f = await fixture(t)
    const store = new ModelConnectionsStore(f.app, async (path, text, guard) => {
      if (action === 'change') await writeFile(f.aiFile, JSON.stringify(document()).replace('同名接口', '外部新名称'))
      else reuse.cancel()
      await atomicWriteText(path, text, guard)
    })
    const reuse = f.serviceFor(store), preview = await reuse.preview({ selectedIds: ['primary'], expectedRevision: 0 })
    const oldKeys = await readFile(f.settingsFile)
    await assert.rejects(reuse.confirm(preview.token), code('CONFLICT'))
    assert.deepEqual((await store.read()).document.connections, [])
    assert.deepEqual(await readdir(f.app), ['settings.json'])
    assert.deepEqual(await readFile(f.settingsFile), oldKeys)
  }
})

test('pre-publication failure allows retry; lost reply after publication never duplicates an import', async t => {
  for (const afterPublish of [false, true]) {
    const f = await fixture(t)
    let fail = true
    const store = new ModelConnectionsStore(f.app, async (path, text, guard) => {
      if (afterPublish || !fail) await atomicWriteText(path, text, guard)
      if (fail) { fail = false; throw Error('private-cause') }
    })
    const reuse = f.serviceFor(store), preview = await reuse.preview({ selectedIds: ['primary'], expectedRevision: 0 })
    await assert.rejects(reuse.confirm(preview.token), code('STORAGE_ERROR'))
    assert.equal((await store.read()).document.connections.length, afterPublish ? 1 : 0)
    const result = await reuse.confirm(preview.token)
    assert.equal(result.connectionIds.length, 1)
    assert.equal((await store.read()).document.connections.length, 1)
    assert.equal((await store.read()).document.reuseReceipts?.length, 1)
  }
})

test('late preview results cannot replace a newer request or survive cancel', async t => {
  const f = await fixture(t)
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const source: LegacyConnectionSource = { identity: root => f.source.identity(root), capture: async (root, ids) => {
    const snapshot = await f.source.capture(root, ids); await blocked; return snapshot
  } }
  const reuse = f.serviceFor(f.store, source)
  const pending = reuse.preview({ selectedIds: ['primary'], expectedRevision: 0 })
  reuse.cancel(); release()
  await assert.rejects(pending, code('CONFLICT'))
  assert.equal(f.state.decrypts, 0)
})

test('publication rechecks catalog after slow source I/O and synchronously rejects an inactive scope', async t => {
  for (const mode of ['catalog-drift', 'scope-cancel']) {
    const f = await fixture(t)
    const snapshot = await f.store.read()
    const next = { ...snapshot.document, revision: 1, connections: [{ ...metadata('global-direct'), enabled: true, revision: 1 }] }
    let activeChecked = false
    await assert.rejects(f.store.commit(snapshot, next, {
      recheck: async () => { if (mode === 'catalog-drift') await writeFile(f.globalFile, JSON.stringify({ ...snapshot.document, revision: 1 })) },
      assertActive: () => { activeChecked = true; throw new AppError('CONFLICT', 'fixture stopped') }
    }), code('CONFLICT'))
    assert.equal(activeChecked, mode === 'scope-cancel')
    assert.deepEqual((await f.store.read()).document.connections, [])
    assert.ok((await readdir(f.app)).every(name => !name.endsWith('.tmp') && !name.endsWith('.lock')))
  }
})

test('an in-flight duplicate from a switched window cannot acquire the original receipt', async t => {
  const f = await fixture(t)
  let reached!: () => void, release!: () => void
  const staged = new Promise<void>(resolve => { reached = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const store = new ModelConnectionsStore(f.app, async (path, text, guard) => {
    reached(); await blocked; await atomicWriteText(path, text, guard)
  })
  const reuse = f.serviceFor(store), preview = await reuse.preview({ selectedIds: ['primary'], expectedRevision: 0 })
  const pending = reuse.confirm(preview.token)
  const rejected = assert.rejects(pending, code('CONFLICT'))
  await staged
  f.scope.windowId = 'different-main-window'
  await assert.rejects(reuse.confirm(preview.token), code('CONFLICT'))
  release(); await rejected
  assert.deepEqual((await store.read()).document.connections, [])
})

test('twenty selected connections publish atomically and capacity rejection happens before source/secret work', async t => {
  const f = await fixture(t), ids = Array.from({ length: 20 }, (_, i) => `source-${i}`)
  await writeFile(f.aiFile, JSON.stringify(document(2, ids)))
  const ciphertext = f.secrets.encrypt(secret)
  await writeFile(f.settingsFile, JSON.stringify({ projectApiKeys: { [f.book]: Object.fromEntries(ids.map(id => [id, ciphertext])) } }))
  const preview = await f.reuse.preview({ selectedIds: ids, expectedRevision: 0 })
  assert.equal(f.state.decrypts, 0)
  assert.equal((await f.reuse.confirm(preview.token)).connectionIds.length, 20)
  const saved = (await f.store.read()).document
  await writeFile(f.globalFile, JSON.stringify({ ...saved, connections: [
    ...saved.connections, ...Array.from({ length: 80 }, (_, i) => ({ ...metadata(`global-cap-${i}`), enabled: true, revision: 1 }))
  ] }))
  const before = await hashes(f.root), decrypts = f.state.decrypts
  await assert.rejects(f.reuse.preview({ selectedIds: [ids[0]], expectedRevision: 1 }), code('VALIDATION_ERROR'))
  assert.equal(f.state.decrypts, decrypts)
  assert.deepEqual(await hashes(f.root), before)
})

test('strict selections, metadata and receipts reject unsafe or ambiguous input', () => {
  for (const selectedIds of [[], ['primary', 'primary'], ['local:llama-cpp'], ['../key'], Array(21).fill('primary'), Array(1)]) {
    assert.throws(() => decodeLegacyReusePreview({ selectedIds, expectedRevision: 0 }), code('VALIDATION_ERROR'))
  }
  assert.throws(() => decodeLegacyReusePreview({ selectedIds: ['primary'], expectedRevision: 0, bookRoot: 'forged' }), code('VALIDATION_ERROR'))
  for (const value of [{ version: 4 }, { version: 1 }, { version: 2, connections: [metadata(), metadata()] }, { version: 3, connections: [{ ...metadata(), apiKey: secret }] }]) {
    assert.throws(() => decodeLegacyConnections(value), code('VALIDATION_ERROR'))
  }
  const connection = { ...metadata('global-one'), enabled: true, revision: 1 }
  const receipt = { operationId: 'reuse-fixture-operation-token-1', sourceIdentity: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), connectionIds: ['global-one'] }
  for (const reuseReceipts of [[receipt, receipt], [{ ...receipt, sourceIdentity: 'raw-path' }], [{ ...receipt, apiKey: secret }], Array(1)]) {
    assert.throws(() => decodeGlobalConnectionDocument({ version: 1, revision: 1, connections: [connection], reuseReceipts }), code('VALIDATION_ERROR'))
  }
})

async function seedDatabase(book: string, version: number, content?: string, mode = 'sqlite') {
  const file = join(book, '.webnovel', 'workspace.sqlite')
  if (version === WORKSPACE_DATABASE_SCHEMA_VERSION) (await new SqliteWorkspaceDatabaseFactory().open(book)).close()
  const database = new DatabaseSync(file)
  try {
    if (version !== WORKSPACE_DATABASE_SCHEMA_VERSION) for (const migration of workspaceDatabaseMigrations.filter(m => m.version <= version)) {
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, '2026-09-12', migration.checksum)
      database.exec(`PRAGMA user_version = ${migration.version}`)
    }
    database.prepare('INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('fixture-book', '隔离作品', 'active', 'a'.repeat(64), mode, '2026-09-12', '2026-09-12')
    if (content) {
      database.prepare('INSERT INTO ai_settings_documents (project_id, revision, content_json, content_hash, updated_at) VALUES (?, 1, ?, ?, ?)').run('fixture-book', content, hash(content), '2026-09-12')
      database.prepare('UPDATE projects SET ai_settings_ready = 1').run()
    }
  } finally { database.close() }
  return file
}

for (const version of [2, 3]) test(`formal SQLite v${version} metadata wins over damaged mirror without changing source files or WAL`, async t => {
  const f = await fixture(t)
  const file = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION, JSON.stringify(document(version)))
  await writeFile(f.aiFile, 'broken readable mirror must not be parsed')
  const live = new DatabaseSync(file)
  try {
    live.exec("PRAGMA journal_mode = WAL; UPDATE projects SET name = 'pending WAL fixture'")
    const before = await hashes(f.book), settings = await readFile(f.settingsFile)
    const preview = await f.preview()
    assert.equal(preview.connections[0].baseUrl, endpoint)
    assert.deepEqual(await hashes(f.book), before)
    await f.reuse.confirm(preview.token)
    assert.deepEqual(await hashes(f.book), before)
    assert.deepEqual(await readFile(f.settingsFile), settings)
  } finally { live.close() }
})

for (const state of ['old-schema', 'unready', 'shadow'] as const) test(`${state} database keeps file authority without upgrade or import`, async t => {
  const f = await fixture(t)
  await seedDatabase(f.book, state === 'old-schema' ? 28 : WORKSPACE_DATABASE_SCHEMA_VERSION, undefined, state === 'shadow' ? 'shadow' : 'sqlite')
  const before = await hashes(f.book)
  await f.preview()
  assert.deepEqual(await hashes(f.book), before)
})

test('database or credential corruption blocks preview instead of falling back to readable/default data', async t => {
  for (const area of ['database', 'settings', 'future', 'missing-ready-row']) {
    const f = await fixture(t)
    if (area === 'settings') await writeFile(f.settingsFile, '{broken')
    else if (area === 'database') await writeFile(join(f.book, '.webnovel', 'workspace.sqlite'), 'not SQLite')
    else {
      const file = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION)
      const db = new DatabaseSync(file)
      try { db.exec(area === 'future' ? `PRAGMA user_version = ${WORKSPACE_DATABASE_SCHEMA_VERSION + 1}` : 'UPDATE projects SET ai_settings_ready = 1') }
      finally { db.close() }
    }
    const before = await hashes(f.root)
    await assert.rejects(f.preview(), code('STORAGE_ERROR'))
    assert.deepEqual(await hashes(f.root), before)
    assert.equal(f.state.decrypts, 0)
  }
})

test('formal document size/hash failure and later WAL changes invalidate reuse without repairs', async t => {
  for (const mode of ['size', 'hash', 'wal-drift']) {
    const f = await fixture(t)
    const file = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION, JSON.stringify(document()))
    const preview = mode === 'wal-drift' ? await f.preview() : null
    const db = new DatabaseSync(file)
    try {
      if (mode === 'size') db.prepare('UPDATE ai_settings_documents SET content_json = ?').run(JSON.stringify({ padding: ' '.repeat(MAX_MODEL_CONNECTION_BYTES + 1) }))
      if (mode === 'hash') db.prepare('UPDATE ai_settings_documents SET content_hash = ?').run('f'.repeat(64))
      if (mode === 'wal-drift') db.exec("PRAGMA journal_mode = WAL; UPDATE projects SET name = 'changed after preview'")
      const before = await hashes(f.book)
      if (preview) await assert.rejects(f.reuse.confirm(preview.token), code('CONFLICT'))
      else await assert.rejects(f.preview(), code('STORAGE_ERROR'))
      assert.deepEqual(await hashes(f.book), before)
      assert.equal(f.state.decrypts, 0)
    } finally { db.close() }
  }
})

test('a junction out of the selected book is rejected without following its credentials/configuration', async t => {
  const f = await fixture(t)
  const escaped = join(f.root, 'escaped-book'), external = join(f.root, 'external-metadata')
  await mkdir(escaped); await mkdir(external)
  await writeFile(join(external, 'ai-settings.json'), JSON.stringify(document()))
  await symlink(external, join(escaped, '.webnovel'), 'junction')
  f.scope.bookRoot = escaped; f.scope.generation++
  const before = await readFile(join(external, 'ai-settings.json'))
  await assert.rejects(f.preview(), code('STORAGE_ERROR'))
  assert.deepEqual(await readFile(join(external, 'ai-settings.json')), before)
})


test('deleting a reused connection keeps historical receipts and retries never resurrect it', async t => {
  const f = await fixture(t), preview = await f.preview(), receipt = await f.reuse.confirm(preview.token)
  const before = await f.store.read(), bookBefore = await readFile(f.aiFile), keysBefore = await readFile(f.settingsFile)
  const service = new ModelConnectionsService(f.store, f.secrets, () => 'global-fresh')
  await service.remove({ expectedRevision: before.document.revision, id: receipt.connectionIds[0], connectionRevision: 1 })
  const after = await new ModelConnectionsStore(f.app).read()
  assert.deepEqual(after.document.connections, [])
  assert.deepEqual(after.document.reuseReceipts, before.document.reuseReceipts)
  // New dangling receipts and reuse of a deleted receipt identity remain forbidden.
  const forgedReceipt = { ...after.document.reuseReceipts![0], operationId: 'reuse-forged-operation-token', connectionIds: ['global-absent'] }
  await assert.rejects(f.store.commit(after, { ...after.document, revision: after.document.revision + 1,
    reuseReceipts: [...after.document.reuseReceipts!, forgedReceipt] }), code('STORAGE_ERROR'))
  await assert.rejects(f.store.commit(after, { ...after.document, revision: after.document.revision + 1,
    connections: [before.document.connections[0]] }), code('STORAGE_ERROR'))
  const decrypts = f.state.decrypts
  assert.deepEqual(await f.reuse.confirm(preview.token), receipt)
  assert.equal(f.state.decrypts, decrypts)
  assert.deepEqual((await service.list()).connections, [])
  assert.deepEqual(await readFile(f.aiFile), bookBefore); assert.deepEqual(await readFile(f.settingsFile), keysBefore)
  await service.create({ expectedRevision: after.document.revision, name: 'next', baseUrl: endpoint, protocol: 'openai-compatible' })
  assert.equal((await service.list()).connections[0].id, 'global-fresh')
})
