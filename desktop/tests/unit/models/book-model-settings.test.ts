import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID } from '../../../src/contracts/models/local-model-contracts'
import { AppError } from '../../../src/main/core/errors/app-error'
import { BOOK_MODEL_TASKS, MAX_BOOK_MODEL_DOCUMENT_LENGTH, bookModelSource, decodeBookModelSettings,
  defaultLegacyBookModelSettings, parseBookModelSettings, referenceBookModelSettings, serializeBookModelSettings } from '../../../src/main/modules/models/domain/book-model-settings'
import { bookModelConfigInputs } from '../../../src/main/modules/models/adapters/book-model-configs'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
import type { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import type { AiSettings } from '../../../src/contracts/index'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const mirrorContent = (content: string) => `${JSON.stringify(JSON.parse(content), null, 2)}\n`
type MutableFixture = Record<string, unknown> & {
  shared: Record<string, unknown>; tasks: Record<string, Record<string, unknown>>; references: Array<Record<string, unknown>>
}
const profile = (connectionId = 'primary', model = 'fixture-model', maxTokens = 2048) => ({ connectionId, model, temperature: 0.7, topP: 1, maxTokens })
const tasks = (p = profile()) => ({ outline: { ...p }, chapterOutline: { ...p }, prose: { ...p }, review: { ...p } })
const remote = () => ({ version: 2 as const, connections: [{ id: 'primary', name: '隔离接口', baseUrl: 'https://fixture.example.test/v1' }], routingMode: 'shared' as const, shared: profile(), tasks: tasks() })
const local = () => ({ version: 3 as const, connections: [], routingMode: 'shared' as const, shared: profile(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID), tasks: tasks(profile(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID)) })
const referenced = () => ({ version: 4 as const, references: [
  { kind: 'global' as const, id: 'shared-api', globalConnectionId: 'global-fixture', lastKnownName: '诊断标签', lastKnownBaseUrl: 'https://diagnostic-only.example.test/v1' },
  { kind: 'legacy-private' as const, id: 'private-api', originalConnectionId: 'global-fixture', name: '本书私有', baseUrl: 'https://private.example.test/v1' }
], routingMode: 'perTask' as const, shared: profile('shared-api'), tasks: {
  outline: profile('shared-api', 'fixture-gpt'), chapterOutline: profile('shared-api', 'fixture-gpt'),
  prose: profile('private-api', 'fixture-gemini'), review: profile(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID)
}, defaultRevision: 3 })
const legacy = () => ({ version: 1, baseUrl: 'https://legacy.example.test/v1', routingMode: 'shared',
  shared: { model: 'legacy-manual', temperature: 0.5, topP: 1, maxTokens: 4096 } })
const publicSettings = (): AiSettings => ({ ...remote(), apiKeyConfigured: false, connections: remote().connections.map(c => ({ ...c, apiKeyConfigured: false })) })
const safeCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError)
  assert.equal(error.code, expected)
  assert.doesNotMatch(JSON.stringify(error), /secret-sentinel|example\.test|cipher-sentinel/)
  return true
}

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-book-model-'))
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-book-model-'))); await rm(root, { recursive: true, force: true }) })
  const factory = new SqliteWorkspaceDatabaseFactory()
  const initial = await factory.open(root)
  initial.close()
  const file = join(root, '.webnovel', 'workspace.sqlite'), sql = new DatabaseSync(file)
  try {
    sql.prepare('INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('fixture-book', '隔离作品', 'active', 'a'.repeat(64), 'sqlite', '2026-09-12', '2026-09-12')
  } finally { sql.close() }
  return { root, file, factory }
}

test('real SQLite accepts the same v3 local document that file routing already writes', async t => {
  const f = await fixture(t), db = (await f.factory.openExisting(f.root))!
  try {
    const content = JSON.stringify(local())
    db.importAiSettings(content, hash(content))
    assert.equal(db.aiSettings().content, content)
  } finally { db.close() }
})

test('parser retains v1 defaults and v2/v3 source identities without inferring global scope', () => {
  const v1 = decodeBookModelSettings(legacy())
  assert.equal(v1.version, 2); assert.equal(v1.shared.connectionId, 'primary'); assert.equal(v1.shared.model, 'legacy-manual')
  assert.equal(v1.tasks.prose.temperature, 0.8)
  const v2 = remote(); v2.connections[0].id = 'global-fixture'
  v2.shared.connectionId = 'global-fixture'; v2.tasks = tasks(profile('global-fixture'))
  assert.equal(bookModelSource(decodeBookModelSettings(v2), 'global-fixture').kind, 'legacy-private')
  assert.equal(decodeBookModelSettings(local()).version, 3)
  assert.deepEqual(bookModelSource(decodeBookModelSettings(local()), LOCAL_CONNECTION_ID), { kind: 'local', id: LOCAL_CONNECTION_ID })
  assert.throws(() => bookModelSource(decodeBookModelSettings(v2), 'missing'), safeCode('NOT_FOUND'))
})

test('v4 serializes only attached references and preserves all five profiles and copied revision', () => {
  const value = referenced(), decoded = decodeBookModelSettings(value)
  assert.deepEqual(parseBookModelSettings(serializeBookModelSettings(decoded)), value)
  value.tasks.outline.model = 'mutated'; value.references[0].id = 'mutated'
  assert.equal(decoded.tasks.outline.model, 'fixture-gpt')
  assert.equal(bookModelSource(decoded, 'shared-api').kind, 'global')
  assert.deepEqual(bookModelSource(decoded, 'private-api'), referenced().references[1])
  assert.equal('connections' in decoded, false)
  const converted = referenceBookModelSettings(remote())
  assert.deepEqual(converted.references, [{ kind: 'legacy-private', ...remote().connections[0], originalConnectionId: 'primary' }])
  assert.deepEqual(referenceBookModelSettings(converted), converted)
})

test('same model names retain global/private/local source and global diagnostics never become authority', () => {
  const value = referenced()
  value.tasks.outline.model = 'same-model'; value.tasks.prose.model = 'same-model'
  const projection = bookModelConfigInputs(value)
  assert.equal(projection[0].provider, 'global:global-fixture#outline')
  assert.equal(projection[2].provider, 'legacy:global-fixture#prose')
  assert.equal(projection[3].provider, `${LOCAL_CONNECTION_ID}#review`)
  assert.equal(projection[3].inputTokenBudget, 8192 - 2048 - 512)
  assert.equal(projection.filter(p => p.isDefault).length, 1)
  assert.equal(projection.find(p => p.isDefault)?.provider, 'legacy:global-fixture#prose')
  assert.doesNotMatch(JSON.stringify(projection), /diagnostic-only|诊断标签|apiKey|encrypted|credentialState/)
  const v2 = bookModelConfigInputs(remote())
  assert.equal(v2[0].provider, 'primary:https://fixture.example.test/v1#shared')
  assert.equal(v2[0].inputTokenBudget, 2048)
})

for (const [name, change] of Object.entries({
  'dangling profile': (v: MutableFixture) => { v.tasks.prose.connectionId = 'missing' },
  'duplicate alias': (v: MutableFixture) => { v.references[1].id = v.references[0].id },
  'duplicate legacy identity': (v: MutableFixture) => { v.references.push({ ...v.references[1], id: 'duplicate-original' }) },
  'local remote alias': (v: MutableFixture) => { v.references[0].id = LOCAL_CONNECTION_ID },
  'global endpoint injection': (v: MutableFixture) => { v.references[0].baseUrl = 'https://secret-sentinel.example.test' },
  'global original-id injection': (v: MutableFixture) => { v.references[0].originalConnectionId = 'other' },
  'private global-id injection': (v: MutableFixture) => { v.references[1].globalConnectionId = 'global-other' },
  'plaintext secret': (v: MutableFixture) => { v.references[1].apiKey = 'secret-sentinel' },
  'ciphertext secret': (v: MutableFixture) => { v.references[0].encryptedApiKey = 'cipher-sentinel' },
  'live availability': (v: MutableFixture) => { v.references[0].enabled = true },
  'unknown task': (v: MutableFixture) => { v.tasks.map = profile() },
  'missing inactive task': (v: MutableFixture) => { v.routingMode = 'shared'; delete v.tasks.review },
  'unknown profile field': (v: MutableFixture) => { v.shared.authorization = 'secret-sentinel' },
  'non-finite temperature': (v: MutableFixture) => { v.shared.temperature = NaN },
  'infinite topP': (v: MutableFixture) => { v.shared.topP = Infinity },
  'coerced numeric field': (v: MutableFixture) => { v.shared.maxTokens = '2048' },
  'fractional budget': (v: MutableFixture) => { v.shared.maxTokens = 2048.5 },
  'empty model': (v: MutableFixture) => { v.shared.model = ' ' },
  'overlong model': (v: MutableFixture) => { v.shared.model = 'x'.repeat(501) },
  'sparse references': (v: MutableFixture) => { delete v.references[0] },
  'oversized reference list': (v: MutableFixture) => { v.references = Array.from({ length: 101 }, (_, i) => ({ kind: 'global', id: `alias-${i}`, globalConnectionId: 'global-fixture' })) },
  'unknown global identity': (v: MutableFixture) => { v.references[0].globalConnectionId = 'primary' },
  'zero copied revision': (v: MutableFixture) => { v.defaultRevision = 0 },
  'fractional copied revision': (v: MutableFixture) => { v.defaultRevision = 1.5 },
  'mixed document versions': (v: MutableFixture) => { v.connections = remote().connections }
})) test(`strict book decoder rejects ${name} without leaking rejected content`, () => {
  const value = referenced(); change(value)
  assert.throws(() => decodeBookModelSettings(value), safeCode('VALIDATION_ERROR'))
})

test('malformed versions/envelopes/endpoints are not normalized into empty/default configuration', () => {
  for (const value of [null, [], {}, 2, { version: 1 }, { ...remote(), connections: [] }, { ...remote(), connections: new Array(1) },
    { ...legacy(), shared: null }, { ...legacy(), tasks: null }, { ...legacy(), tasks: { prose: null } }, { ...legacy(), routingMode: null },
    { ...remote(), routingMode: 'unknown' }, { ...remote(), apiKeyConfigured: true }, { ...remote(), tasks: {} },
    Object.assign(Object.create({ apiKey: 'secret-sentinel' }), remote())]) {
    assert.throws(() => decodeBookModelSettings(value), safeCode('VALIDATION_ERROR'))
  }
  for (const version of [0, 5, '3', null]) assert.throws(() => decodeBookModelSettings({ ...remote(), version }), safeCode('FEATURE_UNAVAILABLE'))
  for (const baseUrl of ['ftp://example.test', 'https://secret-sentinel@example.test', 'https://example.test?', 'https://example.test#', 'https://example.test?key=secret-sentinel']) {
    assert.throws(() => decodeBookModelSettings({ ...remote(), connections: [{ ...remote().connections[0], baseUrl }] }), safeCode('VALIDATION_ERROR'))
  }
  for (const content of ['{broken', 'null', JSON.stringify({ padding: 'x'.repeat(MAX_BOOK_MODEL_DOCUMENT_LENGTH) })]) assert.throws(() => parseBookModelSettings(content), safeCode('VALIDATION_ERROR'))
})

test('known local write budgets are enforced while portable unknown models remain readable', () => {
  const value = local(); value.shared.maxTokens = 8192
  assert.equal(decodeBookModelSettings(value).shared.maxTokens, 8192)
  assert.throws(() => bookModelConfigInputs(value), safeCode('VALIDATION_ERROR'))
  value.shared.model = 'not-installed-on-this-machine'
  assert.equal(bookModelConfigInputs(value)[0].modelName, value.shared.model)
})

for (const [name, make] of [['v1', legacy], ['v2', remote], ['v3 local', local], ['v4 mixed', referenced]] as const) {
  test(`real SQLite ${name} import, replace and reopen preserve document and exact derived routes`, async t => {
    const f = await fixture(t), content = JSON.stringify(make())
    let db = (await f.factory.openExisting(f.root))!
    try {
      const result = db.importAiSettings(content, hash(content))
      assert.equal(result.document.revision, 1)
      assert.equal(result.document.content, content)
      assert.deepEqual(db.listModelConfigs().filter(p => p.enabled).map(p => [p.provider, p.modelName]).sort(), bookModelConfigInputs(make()).map(p => [p.provider, p.modelName]).sort())
      const next = decodeBookModelSettings(make()); next.shared.model = 'changed-manual-model'
      if (next.routingMode === 'perTask') next.tasks.prose.model = 'changed-prose'
      const replaced = serializeBookModelSettings(next)
      assert.equal(db.replaceAiSettings(hash(content), replaced, hash(replaced)).document.revision, 2)
      assert.throws(() => db.replaceAiSettings(hash(content), content, hash(content)), safeCode('CONFLICT'))
      const unchanged = db.aiSettings()
      assert.equal(db.replaceAiSettings(hash(replaced), replaced, hash(replaced)).mirror, null)
      assert.deepEqual(db.aiSettings(), unchanged)
      db.close(); db = (await f.factory.openExisting(f.root))!
      assert.equal(db.aiSettings().content, replaced)
      assert.equal(db.aiSettings().revision, 2)
      assert.deepEqual(db.listModelConfigs().filter(p => p.enabled).map(p => [p.provider, p.modelName]).sort(), bookModelConfigInputs(next).map(p => [p.provider, p.modelName]).sort())
      assert.equal(db.aiSettingsMirror()?.contentHash, hash(mirrorContent(replaced)))
    } finally { db.close() }
  })
}

for (const operation of ['import', 'replace'] as const) test(`a SQLite projection failure rolls back ${operation}, readiness and mirror together`, async t => {
  const f = await fixture(t), content = JSON.stringify(remote())
  const db = (await f.factory.openExisting(f.root))!
  try {
    if (operation === 'replace') db.importAiSettings(content, hash(content))
    const before = { ready: db.formalAiSettingsReady(), document: operation === 'replace' ? db.aiSettings() : null, models: db.listModelConfigs(), mirror: db.aiSettingsMirror() }
    const sql = new DatabaseSync(f.file)
    try { sql.exec("CREATE TRIGGER fixture_projection_failure BEFORE INSERT ON model_configs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END") } finally { sql.close() }
    const next = JSON.stringify(referenced())
    assert.throws(() => operation === 'import' ? db.importAiSettings(next, hash(next)) : db.replaceAiSettings(hash(content), next, hash(next)), safeCode('STORAGE_ERROR'))
    assert.deepEqual({ ready: db.formalAiSettingsReady(), document: operation === 'replace' ? db.aiSettings() : null, models: db.listModelConfigs(), mirror: db.aiSettingsMirror() }, before)
  } finally { db.close() }
})

test('service saves project document as sole projection authority and does not overwrite an external mirror', async t => {
  const f = await fixture(t), service = new SqliteManuscriptService(f.factory), content = JSON.stringify(referenced())
  const input = publicSettings(); input.shared.model = 'untrusted-independent-projection'
  await service.importAiSettings(f.root, content, input)
  const mirror = join(f.root, '.webnovel', 'ai-settings.json')
  assert.equal(await readFile(mirror, 'utf8'), mirrorContent(content))
  await service.syncModelConfigs(f.root, input)
  let db = (await f.factory.openExisting(f.root))!
  try { assert.doesNotMatch(JSON.stringify(db.listModelConfigs()), /untrusted-independent-projection/) } finally { db.close() }
  const external = 'external author mirror preserved\r\n'
  await writeFile(mirror, external)
  const next = referenced(); next.tasks.prose.model = 'new-prose-model'
  await service.replaceAiSettings(f.root, hash(content), JSON.stringify(next), input)
  assert.equal(await readFile(mirror, 'utf8'), external)
  db = (await f.factory.openExisting(f.root))!
  try {
    assert.equal(db.aiSettings().content, JSON.stringify(next))
    assert.equal(db.aiSettingsMirror()?.status, 'conflict')
    assert.equal(db.listModelConfigs().find(p => p.enabled && p.isDefault)?.modelName, 'new-prose-model')
  } finally { db.close() }
})

test('legacy file reads do not convert v1 or create absent settings; v4 stays preserved until public routing integration', async t => {
  const f = await fixture(t), root = join(f.root, 'file-book'); await mkdir(join(root, '.webnovel'), { recursive: true })
  const projects = { currentPath: async () => root } as ProjectService
  const settings = { projectApiKeyConfigured: async () => false } as unknown as SettingsStore
  const service = new ProjectAiService(projects, settings), file = join(root, '.webnovel', 'ai-settings.json')
  assert.equal((await service.get()).shared.model, defaultLegacyBookModelSettings().shared.model)
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  for (const value of [legacy(), remote(), local()]) {
    const content = JSON.stringify(value); await writeFile(file, content)
    const read = await service.get()
    assert.equal(read.shared.model, decodeBookModelSettings(value).shared.model)
    assert.equal(await readFile(file, 'utf8'), content)
  }
  const content = JSON.stringify(referenced()); await writeFile(file, content)
  await assert.rejects(service.get(), safeCode('FEATURE_UNAVAILABLE'))
  await assert.rejects(service.update({}), safeCode('FEATURE_UNAVAILABLE'))
  assert.equal(await readFile(file, 'utf8'), content)
})

test('all legacy/file profile slots reject dangling or non-finite data rather than silently choosing primary', async t => {
  const f = await fixture(t), projects = { currentPath: async () => f.root } as ProjectService
  const settings = { projectApiKeyConfigured: async () => { throw Error('must validate before key reads') } } as unknown as SettingsStore
  const service = new ProjectAiService(projects, settings), file = join(f.root, '.webnovel', 'ai-settings.json')
  for (const task of BOOK_MODEL_TASKS) {
    const value = remote(); value.tasks[task].connectionId = 'missing'
    const content = JSON.stringify(value); await writeFile(file, content)
    await assert.rejects(service.get(), safeCode('VALIDATION_ERROR'))
    assert.equal(await readFile(file, 'utf8'), content)
  }
})

test('explicit invalid selections never use legacy replacement rebinding', async t => {
  const f = await fixture(t), projects = { currentPath: async () => f.root } as ProjectService
  const service = new ProjectAiService(projects, {} as SettingsStore)
  const file = join(f.root, '.webnovel', 'ai-settings.json'), before = JSON.stringify(remote())
  await writeFile(file, before)
  await assert.rejects(service.update({ connections: [{ id: 'new-api', name: '新接口', baseUrl: 'https://new.example.test' }], shared: { connectionId: 'missing' } }), safeCode('VALIDATION_ERROR'))
  assert.equal(await readFile(file, 'utf8'), before)
})

test('two books with the same shared reference keep independent stored profiles', async t => {
  const a = await fixture(t), b = await fixture(t), content = JSON.stringify(referenced())
  const dbA = (await a.factory.openExisting(a.root))!, dbB = (await b.factory.openExisting(b.root))!
  try {
    dbA.importAiSettings(content, hash(content)); dbB.importAiSettings(content, hash(content))
    const beforeB = { doc: dbB.aiSettings(), models: dbB.listModelConfigs(), mirror: dbB.aiSettingsMirror() }
    const next = referenced(); next.tasks.outline.model = 'book-a-only'
    dbA.replaceAiSettings(hash(content), JSON.stringify(next), hash(JSON.stringify(next)))
    assert.deepEqual({ doc: dbB.aiSettings(), models: dbB.listModelConfigs(), mirror: dbB.aiSettingsMirror() }, beforeB)
    assert.equal(dbA.listModelConfigs().find(p => p.enabled && p.provider.endsWith('#outline'))?.modelName, 'book-a-only')
  } finally { dbA.close(); dbB.close() }
})

test('v4 local-only and missing machine-global references roundtrip without any remote owner', async t => {
  const f = await fixture(t), db = (await f.factory.openExisting(f.root))!
  try {
    const value = referenceBookModelSettings(local())
    assert.deepEqual(value.references, [])
    const content = serializeBookModelSettings(value)
    db.importAiSettings(content, hash(content))
    const next = referenced(); next.references[0].globalConnectionId = 'global-absent-on-this-machine'
    const content2 = serializeBookModelSettings(next)
    db.replaceAiSettings(hash(content), content2, hash(content2))
    assert.equal(db.aiSettings().content, content2)
    assert.ok(db.listModelConfigs().some(p => p.enabled && p.provider.startsWith('global:global-absent-on-this-machine#')))
  } finally { db.close() }
})

test('invalid documents, hash mismatch and invalid known-local budgets do not change existing SQLite data', async t => {
  const f = await fixture(t), db = (await f.factory.openExisting(f.root))!, content = JSON.stringify(remote())
  try {
    db.importAiSettings(content, hash(content))
    const before = { doc: db.aiSettings(), models: db.listModelConfigs(), mirror: db.aiSettingsMirror() }
    const bad = local(); bad.shared.maxTokens = 8192
    for (const next of [JSON.stringify({ ...referenced(), encryptedApiKey: 'cipher-sentinel' }), JSON.stringify({ ...remote(), shared: { ...profile(), topP: null } }), JSON.stringify(bad)]) {
      assert.throws(() => db.replaceAiSettings(hash(content), next, hash(next)), safeCode('VALIDATION_ERROR'))
    }
    assert.throws(() => db.replaceAiSettings(hash(content), JSON.stringify(referenced()), 'a'.repeat(64)), safeCode('VALIDATION_ERROR'))
    assert.deepEqual({ doc: db.aiSettings(), models: db.listModelConfigs(), mirror: db.aiSettingsMirror() }, before)
  } finally { db.close() }
})

test('formal v3 ProjectAiService save/reopen never reads a remote key for local-only routes', async t => {
  const f = await fixture(t), file = join(f.root, '.webnovel', 'ai-settings.json')
  const content = JSON.stringify(local()); await writeFile(file, content)
  let keys = 0
  const settings = { projectApiKeyConfigured: async () => { keys++; throw Error('unused key presence') }, projectApiKey: async () => { keys++; throw Error('unused key') } } as unknown as SettingsStore
  const projects = { currentPath: async () => f.root } as ProjectService
  const authority = new SqliteManuscriptService(f.factory)
  const service = new ProjectAiService(projects, settings, authority)
  assert.equal((await service.resolve('prose')).kind, 'local')
  assert.equal(await authority.aiSettingsReady(f.root), false)
  assert.equal(await readFile(file, 'utf8'), content)
  await service.update({ shared: { maxTokens: 1024 } })
  const reopened = new ProjectAiService(projects, settings, new SqliteManuscriptService(f.factory))
  assert.equal((await reopened.resolve('prose')).profile.maxTokens, 1024)
  assert.equal(keys, 0)
  const db = (await f.factory.openExisting(f.root))!
  try { assert.equal(db.listModelConfigs().find(p => p.enabled)?.inputTokenBudget, 8192 - 1024 - 512) } finally { db.close() }
})
