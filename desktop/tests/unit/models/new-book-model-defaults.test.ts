import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { AppError } from '../../../src/main/core/errors/app-error'
import { BOOK_MODEL_TASKS } from '../../../src/main/modules/models/domain/book-model-settings'
import { decodeGlobalConnectionDocument, type GlobalConnectionRepository } from '../../../src/main/modules/models/domain/model-connections'
import { decodeModelDefaultTemplate, defaultsConflict } from '../../../src/main/modules/models/domain/new-book-model-defaults'
import { NewBookModelDefaults } from '../../../src/main/modules/models/application/new-book-model-defaults'
import { ModelConnectionsService } from '../../../src/main/modules/models/application/model-connections-service'
import { LegacyConnectionReuseService } from '../../../src/main/modules/models/application/legacy-connection-reuse'
import { ModelConnectionsStore, GLOBAL_CONNECTIONS_FILE } from '../../../src/main/modules/models/adapters/model-connections-store'
import { atomicWriteText } from '../../../src/main/platform/storage/atomic-file'
import { bookModelConfigInputs } from '../../../src/main/modules/models/adapters/book-model-configs'
import { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID } from '../../../src/contracts/models/local-model-contracts'

const p = (connectionId = 'planner', model = 'manual-gpt') => ({ connectionId, model, temperature: 0.6, topP: 0.9, maxTokens: 1024 })
const template = () => ({ version: 4, references: [
  { kind: 'global', id: 'planner', globalConnectionId: 'global-gpt' },
  { kind: 'global', id: 'writer', globalConnectionId: 'global-gemini' }
], routingMode: 'perTask', shared: p(), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(t => [t, t === 'prose' ? p('writer', 'manual-gemini') : p()])) })
const localTemplate = () => ({ version: 4, references: [], routingMode: 'shared', shared: p(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID),
  tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(t => [t, p(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID)])) })
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError); assert.equal(error.code, expected)
  assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /secret-sentinel|raw-cause|example\.test|user-data/)
  return true
}
async function hashes(root: string, at = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(at, { withFileTypes: true })) {
    const path = join(at, entry.name)
    if (entry.isDirectory()) Object.assign(result, await hashes(root, path))
    else result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}
async function fixture(t: TestContext, seeded = true) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-defaults-')))
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-defaults-'))); await rm(root, { recursive: true, force: true }) })
  const app = join(root, 'user-data'), book = join(root, 'existing-book')
  await mkdir(app); await mkdir(book)
  await writeFile(join(app, 'settings.json'), '{"unrelated":"secret-sentinel-original-settings"}')
  await writeFile(join(book, 'manuscript.txt'), '原书正文保持不变。')
  const store = new ModelConnectionsStore(app), defaults = new NewBookModelDefaults(store, bookModelConfigInputs)
  const file = join(app, GLOBAL_CONNECTIONS_FILE), ciphertext = randomBytes(64).toString('base64')
  const connections = new ModelConnectionsService(store, {
    available: () => false, encrypt: () => assert.fail('no default encryption'), decrypt: () => assert.fail('no default decryption')
  }, () => 'global-extra')
  if (seeded) {
    const before = await store.read()
    await store.commit(before, { version: 1, revision: 1, connections: [
      { id: 'global-gpt', name: '同名接口', baseUrl: 'https://gpt.example.test/v1', enabled: true, revision: 1, encryptedApiKey: ciphertext },
      { id: 'global-gemini', name: '同名接口', baseUrl: 'https://gemini.example.test/v1', enabled: true, revision: 1 }
    ], reuseReceipts: [{ operationId: 'reuse-fixture-1234567890', sourceIdentity: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), connectionIds: ['global-gpt'] }] })
  }
  const save = async (value: unknown = template()) => {
    const current = await defaults.get()
    return defaults.save({ expectedRevision: current.revision, expectedCatalogRevision: current.catalogRevision, template: value })
  }
  const update = async (id: string, change: Record<string, unknown>) => {
    const view = await connections.list(), c = view.connections.find(c => c.id === id)!
    await connections.update({ expectedRevision: view.revision, connectionRevision: c.revision, id, ...change })
  }
  return { root, app, book, file, ciphertext, store, defaults, connections, save, update }
}

test('absent defaults stay explicit unconfigured with zero reads causing writes and no cloud profile', async t => {
  const f = await fixture(t, false), before = await hashes(f.root)
  assert.deepEqual(await f.defaults.get(), { revision: 0, catalogRevision: 0, template: null, references: [] })
  const captured = await f.defaults.capture(0, () => {})
  assert.equal(await captured.copy(), null)
  await f.defaults.save({ expectedRevision: 0, expectedCatalogRevision: 0, template: null })
  assert.deepEqual(await hashes(f.root), before)
})

test('save/reopen/no-op/clear/recreate preserve keys, receipts, other settings and independent revisions', async t => {
  const f = await fixture(t), before = (await f.store.read()).document, original = await hashes(f.root)
  const first = await f.save()
  assert.equal(first.revision, 1); assert.equal(first.catalogRevision, 2)
  assert.deepEqual(first.template, template())
  assert.doesNotMatch(JSON.stringify(first), /encryptedApiKey|credentialState|secret-sentinel/)
  assert.ok(!JSON.stringify(first).includes(f.ciphertext))
  const stored = (await f.store.read()).document
  assert.deepEqual(stored.connections, before.connections); assert.deepEqual(stored.reuseReceipts, before.reuseReceipts)
  const bytes = await readFile(f.file)
  assert.deepEqual(await f.save(), first); assert.deepEqual(await readFile(f.file), bytes)
  const reopened = new NewBookModelDefaults(new ModelConnectionsStore(f.app), bookModelConfigInputs)
  assert.deepEqual(await reopened.get(), first)
  await f.update('global-gpt', { name: '重新命名' })
  assert.equal((await f.defaults.get()).revision, 1)
  const cleared = await f.save(null)
  assert.equal(cleared.revision, 2); assert.equal(cleared.template, null)
  assert.deepEqual((await f.store.read()).document.newBookDefaults, { revision: 2, template: null })
  assert.equal((await f.save()).revision, 3)
  const final = await hashes(f.root)
  for (const [path, value] of Object.entries(original)) if (!path.endsWith(GLOBAL_CONNECTIONS_FILE)) assert.equal(final[path], value)
})

test('A/B copy one default independently and C sees the later revision without any automatic book writes', async t => {
  const f = await fixture(t); await f.save()
  const before = await hashes(f.root), a = await f.defaults.capture(1, () => {}), b = await f.defaults.capture(1, () => {})
  a.summary.template!.tasks.prose.model = 'changed returned summary'
  const copyA = (await a.copy())!, copyB = (await b.copy())!
  assert.equal(copyA.tasks.prose.model, 'manual-gemini'); assert.equal(copyA.defaultRevision, 1)
  copyA.tasks.prose.model = 'A-only'; assert.equal(copyB.tasks.prose.model, 'manual-gemini')
  assert.equal((await b.copy())!.tasks.prose.model, 'manual-gemini')
  assert.deepEqual(await hashes(f.root), before)
  const next = template(); next.tasks.prose.model = 'new-gemini'
  await f.save(next)
  assert.equal(copyB.tasks.prose.model, 'manual-gemini')
  const c = await f.defaults.capture(2, () => {}), copyC = (await c.copy())!
  assert.equal(copyC.tasks.prose.model, 'new-gemini'); assert.equal(copyC.defaultRevision, 2)
  await assert.rejects(a.copy(), code('CONFLICT')); await assert.rejects(b.guard.recheck(), code('CONFLICT'))
  assert.ok(!JSON.stringify(copyC).includes(f.ciphertext))
})

test('captured absence is invalidated by a later template, including clear back to absence', async t => {
  const f = await fixture(t), old = await f.defaults.capture(0, () => {})
  await f.save(); await f.save(null)
  await assert.rejects(old.copy(), code('CONFLICT'))
  assert.equal(await (await f.defaults.capture(2, () => {})).copy(), null)
})

for (const change of ['disable', 'rename', 'clear-key', 'remove', 'endpoint', 'template-same-revision'] as const) test(`capture rejects selected ${change} drift and preserves the changed authority`, async t => {
  const f = await fixture(t); await f.save()
  const prepared = await f.defaults.capture(1, () => {})
  if (change === 'disable') await f.update('global-gpt', { enabled: false })
  else if (change === 'rename') await f.update('global-gpt', { name: '新名称' })
  else if (change === 'clear-key') await f.update('global-gpt', { clearApiKey: true })
  else {
    const raw = JSON.parse(await readFile(f.file, 'utf8'))
    if (change === 'remove') raw.connections = raw.connections.filter((c: { id: string }) => c.id !== 'global-gemini')
    if (change === 'endpoint') raw.connections[0].baseUrl = 'https://changed.example.test/v1'
    if (change === 'template-same-revision') raw.newBookDefaults.template.tasks.prose.model = 'external-model'
    await writeFile(f.file, JSON.stringify(raw))
  }
  const before = await hashes(f.root)
  await assert.rejects(prepared.copy(), code('CONFLICT'))
  assert.deepEqual(await hashes(f.root), before)
})

test('unrelated connection edits and app settings do not revoke an unchanged copied selection', async t => {
  const f = await fixture(t); await f.save()
  const prepared = await f.defaults.capture(1, () => {})
  await f.connections.create({ expectedRevision: 2, name: '未选择的接口', baseUrl: 'https://extra.example.test/v1', protocol: 'openai-compatible' })
  await writeFile(join(f.app, 'settings.json'), '{"changed":"unrelated"}')
  assert.equal((await prepared.copy())!.defaultRevision, 1)
  assert.equal((await f.defaults.get()).revision, 1)
})

test('unavailable selected references remain visible, block copy/save, and can be cleared explicitly', async t => {
  const f = await fixture(t); await f.save(); await f.update('global-gemini', { enabled: false })
  assert.equal((await f.defaults.get()).references[1].state, 'disabled')
  await assert.rejects(f.defaults.capture(1, () => {}), code('CONFLICT'))
  await assert.rejects(f.save(), code('CONFLICT'))
  await f.save(null)
  const raw = JSON.parse(await readFile(f.file, 'utf8'))
  raw.newBookDefaults = { revision: 3, template: template() }; raw.revision++
  raw.connections = raw.connections.filter((c: { id: string }) => c.id !== 'global-gemini')
  await writeFile(f.file, JSON.stringify(raw))
  assert.equal((await f.defaults.get()).references[1].state, 'missing')
  await assert.rejects(f.defaults.capture(3, () => {}), code('CONFLICT'))
})

test('local defaults validate all inactive budgets, require no catalog entries and retain unknown portable models', async t => {
  const f = await fixture(t, false), local = localTemplate()
  const first = await f.save(local)
  assert.equal(first.references.length, 0)
  assert.equal((await (await f.defaults.capture(1, () => {})).copy())!.shared.connectionId, LOCAL_CONNECTION_ID)
  local.tasks.outline.maxTokens = 4097
  const before = await hashes(f.root)
  await assert.rejects(f.save(local), code('VALIDATION_ERROR')); assert.deepEqual(await hashes(f.root), before)
  local.tasks.outline.model = 'portable-not-installed'
  await f.save(local)
  assert.equal((await (await f.defaults.capture(2, () => {})).copy())!.tasks.outline.model, 'portable-not-installed')
})

const invalidTemplates: Array<[string, (v: ReturnType<typeof template>) => unknown]> = [
  ['private alias', v => ({ ...v, references: [{ kind: 'legacy-private', id: 'planner', originalConnectionId: 'primary', name: 'private', baseUrl: 'https://private.example.test' }] })],
  ['key', v => ({ ...v, apiKey: 'secret-sentinel' })], ['copied revision', v => ({ ...v, defaultRevision: 2 })],
  ['diagnostics', v => ({ ...v, references: v.references.map(r => ({ ...r, lastKnownBaseUrl: 'https://private.example.test' })) })],
  ['catalog dump', v => ({ ...v, references: [...v.references, { kind: 'global', id: 'unused', globalConnectionId: 'global-unused' }] })],
  ['duplicate alias', v => ({ ...v, references: [...v.references, v.references[0]] })],
  ['sparse alias', v => ({ ...v, references: new Array(1) })], ['oversized aliases', v => ({ ...v, references: new Array(101) })],
  ['null', () => null], ['future', v => ({ ...v, version: 6 })],
  ['unknown task', v => ({ ...v, tasks: { ...v.tasks, image: p() } })],
  ['nonfinite', v => ({ ...v, shared: { ...v.shared, temperature: NaN } })],
  ['missing inactive', v => ({ ...v, tasks: { prose: v.tasks.prose } })],
  ['dangling', v => ({ ...v, shared: p('absent') })], ['no global ID', v => ({ ...v, references: [{ kind: 'global', id: 'planner' }] })]
]
for (const [name, change] of invalidTemplates) test(`strict template rejects ${name}`, () => {
  assert.throws(() => decodeModelDefaultTemplate(change(template())), code('VALIDATION_ERROR'))
})

for (const invalid of ['malformed', 'future', 'default-extra', 'default-null', 'default-revision', 'private-template'] as const) test(`corrupt ${invalid} authority never becomes empty defaults`, async t => {
  const f = await fixture(t); await f.save()
  const raw = JSON.parse(await readFile(f.file, 'utf8'))
  if (invalid === 'future') raw.version = 2
  if (invalid === 'default-extra') raw.newBookDefaults.apiKey = 'secret-sentinel'
  if (invalid === 'default-null') raw.newBookDefaults = null
  if (invalid === 'default-revision') raw.newBookDefaults.revision = raw.revision + 1
  if (invalid === 'private-template') raw.newBookDefaults.template = invalidTemplates[0][1](template())
  await writeFile(f.file, invalid === 'malformed' ? '{broken' : JSON.stringify(raw))
  const before = await hashes(f.root)
  await assert.rejects(f.defaults.get(), code('STORAGE_ERROR'))
  await assert.rejects(f.defaults.capture(1, () => {}), code('STORAGE_ERROR'))
  await assert.rejects(f.defaults.save({ expectedRevision: 1, expectedCatalogRevision: 2, template: null }), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})

test('invalid/stale save fields reject without writes and preserve caller draft', async t => {
  const f = await fixture(t), value = template(), before = await hashes(f.root)
  for (const input of [
    { expectedRevision: 1, expectedCatalogRevision: 1, template: value },
    { expectedRevision: 0, expectedCatalogRevision: 0, template: value }
  ]) await assert.rejects(f.defaults.save(input), code('CONFLICT'))
  for (const input of [
    { expectedRevision: 0, expectedCatalogRevision: 1, template: value, apiKey: 'secret-sentinel' },
    { expectedRevision: 0, expectedCatalogRevision: 1 },
    { expectedRevision: '0', expectedCatalogRevision: 1, template: value }
  ]) await assert.rejects(f.defaults.save(input), code('VALIDATION_ERROR'))
  assert.deepEqual(value, template()); assert.deepEqual(await hashes(f.root), before)
})

test('competing writers accept one revision and ordinary connection edits retain defaults', async t => {
  const f = await fixture(t), other = new NewBookModelDefaults(new ModelConnectionsStore(f.app), bookModelConfigInputs)
  const input = { expectedRevision: 0, expectedCatalogRevision: 1, template: template() }
  const results = await Promise.allSettled([f.defaults.save(input), other.save(input)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  for (const r of results) if (r.status === 'rejected') code('CONFLICT')(r.reason)
  await f.connections.create({ expectedRevision: 2, name: '额外接口', baseUrl: 'https://extra.example.test/v1', protocol: 'openai-compatible' })
  await f.update('global-extra', { enabled: false })
  assert.deepEqual((await f.store.read()).document.newBookDefaults, { revision: 1, template: template() })
})

for (const issue of ['publish', 'external', 'scope'] as const) test(`staged ${issue} failure preserves committed/external bytes and cleans only owned staging`, async t => {
  const f = await fixture(t), before = await readFile(f.file), input = { expectedRevision: 0, expectedCatalogRevision: 1, template: template() }
  let active = true, staged = 0
  const publish = async (path: string, content: string, guard: () => Promise<void>) => atomicWriteText(path, content, async () => {
    staged++
    if (issue === 'publish') throw Error('raw-cause secret-sentinel')
    if (issue === 'external') await writeFile(f.file, before.toString() + ' ')
    if (issue === 'scope') active = false
    await guard()
  })
  const service = new NewBookModelDefaults(new ModelConnectionsStore(f.app, publish), bookModelConfigInputs)
  const guard = { recheck: async () => {}, assertActive() { if (!active) throw defaultsConflict() } }
  await assert.rejects(service.save(input, guard), code(issue === 'publish' ? 'STORAGE_ERROR' : 'CONFLICT'))
  assert.equal(staged, 1)
  assert.equal(await readFile(f.file, 'utf8'), before.toString() + (issue === 'external' ? ' ' : ''))
  assert.deepEqual((await readdir(f.app)).sort(), [GLOBAL_CONNECTIONS_FILE, 'settings.json'].sort())
  assert.deepEqual(input.template, template())
})

test('scope changes during snapshot I/O invalidate copy and never publish a replacement default', async t => {
  const f = await fixture(t); await f.save()
  let active = true, changeOnRead = false
  const repository: GlobalConnectionRepository = { commit: (...args) => f.store.commit(...args), read: async () => {
    const snapshot = await f.store.read(); if (changeOnRead) active = false; return snapshot
  } }
  const service = new NewBookModelDefaults(repository, bookModelConfigInputs)
  const assertActive = () => { if (!active) throw defaultsConflict() }
  const old = await service.capture(1, assertActive)
  changeOnRead = true
  await assert.rejects(old.copy(), code('CONFLICT'))
  active = true
  const before = await hashes(f.root)
  await assert.rejects(service.save({ expectedRevision: 1, expectedCatalogRevision: 2, template: null }, { recheck: async () => {}, assertActive }), code('CONFLICT'))
  assert.deepEqual(await hashes(f.root), before)
})

test('storage rejects removal and forged default revisions while preserving prior template', async t => {
  const f = await fixture(t); await f.save()
  const current = await f.store.read(), before = await hashes(f.root)
  const removed = { ...current.document, revision: 3 }; delete removed.newBookDefaults
  const forged = { ...current.document, revision: 3, newBookDefaults: { revision: 2, template: decodeModelDefaultTemplate(template()) } }
  for (const value of [removed, forged]) await assert.rejects(f.store.commit(current, value), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
  assert.throws(() => decodeGlobalConnectionDocument({ version: 1, revision: 0, connections: [], newBookDefaults: { revision: 1, template: null } }), code('VALIDATION_ERROR'))
})

test('legacy reuse appends a receipt without dropping a saved template or rewriting source state', async t => {
  const f = await fixture(t); await f.save()
  const rootIdentity = 'c'.repeat(64), fingerprint = 'd'.repeat(64)
  const reuse = new LegacyConnectionReuseService(f.store, {
    capture: async () => ({ sourceIdentity: rootIdentity, sourceFingerprint: fingerprint,
      connections: [{ id: 'old', name: '旧私有接口', baseUrl: 'https://old.example.test/v1', encryptedApiKey: f.ciphertext }], assertCurrent: async () => {} }),
    identity: async () => rootIdentity
  }, { available: () => true, decrypt: () => 'synthetic-reuse-only', encrypt: () => randomBytes(64).toString('base64') },
  () => ({ windowId: 'defaults-fixture', bookRoot: f.book, generation: 1 }), () => 'global-reused',
  () => 'reuse-defaults-1234567890', () => 1000)
  const preview = await reuse.preview({ selectedIds: ['old'], expectedRevision: 2 })
  await reuse.confirm(preview.token)
  assert.deepEqual((await f.store.read()).document.newBookDefaults, { revision: 1, template: template() })
  assert.equal((await f.store.read()).document.reuseReceipts!.length, 2)
  assert.equal(await readFile(join(f.book, 'manuscript.txt'), 'utf8'), '原书正文保持不变。')
})

test('unchanged saves still reject catalog drift during the asynchronous scope check', async t => {
  const f = await fixture(t); await f.save()
  const guard = { assertActive() {}, recheck: async () => { await f.save(null) } }
  await assert.rejects(f.defaults.save({ expectedRevision: 1, expectedCatalogRevision: 2, template: template() }, guard), code('CONFLICT'))
  assert.deepEqual((await f.store.read()).document.newBookDefaults, { revision: 2, template: null })
})

test('save snapshots caller input before asynchronous reads and sanitizes unknown publication errors', async t => {
  const f = await fixture(t), input = { expectedRevision: 0, expectedCatalogRevision: 1, template: template() }
  let mutate = true
  const repository: GlobalConnectionRepository = {
    read: async () => { const s = await f.store.read(); if (mutate) { input.template.tasks.prose.model = 'mutated-too-late'; mutate = false }; return s },
    commit: (...args) => f.store.commit(...args)
  }
  const result = await new NewBookModelDefaults(repository, bookModelConfigInputs).save(input)
  assert.equal(result.template!.tasks.prose.model, 'manual-gemini')
  const before = await hashes(f.root)
  const failing = new NewBookModelDefaults({ read: () => f.store.read(), commit: async () => { throw Error('raw-cause secret-sentinel') } }, bookModelConfigInputs)
  await assert.rejects(failing.save({ expectedRevision: 1, expectedCatalogRevision: 2, template: null }), code('STORAGE_ERROR'))
  assert.deepEqual(await hashes(f.root), before)
})
