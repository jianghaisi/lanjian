import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm, link, symlink, truncate, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { AppError } from '../../../src/main/core/errors/app-error'
import {
  decodeConnectionCreate, decodeConnectionUpdate, decodeGlobalConnectionDocument,
  emptyGlobalConnections, MAX_MODEL_CONNECTION_BYTES, MAX_GLOBAL_CONNECTIONS,
  type ModelConnectionSecrets, type GlobalConnectionDocument
} from '../../../src/main/modules/models/domain/model-connections'
import { ModelConnectionsService } from '../../../src/main/modules/models/application/model-connections-service'
import { GLOBAL_CONNECTIONS_FILE, ModelConnectionsStore } from '../../../src/main/modules/models/adapters/model-connections-store'
import { atomicWriteBuffer, atomicWriteText, replaceWindowsEncryptedFile } from '../../../src/main/platform/storage/atomic-file'

const key = 'fixture-key-never-an-author-credential'
const endpoint = 'https://provider.example.test/v1'
const errorCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError)
  assert.equal(error.code, expected)
  assert.equal(error.recoverable, true)
  assert.doesNotMatch(error.message, /fixture-key|secret-error|user-data|\.tmp|provider\.example/)
  return true
}

function codec() {
  const machineKey = randomBytes(32)
  const state = { available: true, encrypts: 0, decrypts: 0, failEncrypt: false, failDecrypt: false }
  const secrets: ModelConnectionSecrets = {
    available: () => state.available,
    encrypt(value) {
      state.encrypts++
      if (state.failEncrypt) throw Error('secret-error: ' + value)
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', machineKey, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
    },
    decrypt(value) {
      state.decrypts++
      if (state.failDecrypt) throw Error('secret-error: ' + value)
      const bytes = Buffer.from(value, 'base64')
      const decipher = createDecipheriv('aes-256-gcm', machineKey, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
  return { state, secrets }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-global-connections-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { state, secrets } = codec()
  const store = new ModelConnectionsStore(root)
  let sequence = 0
  const service = new ModelConnectionsService(store, secrets, () => `global-fixture-${++sequence}`)
  const file = join(root, GLOBAL_CONNECTIONS_FILE)
  return { root, file, store, service, state, secrets }
}

const createInput = () => ({ expectedRevision: 0, name: '共用接口', baseUrl: endpoint, protocol: 'openai-compatible' as const, apiKey: key })

test('absent listing is zero-write and zero-decrypt, with no book dependency', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.service.list(), { revision: 0, connections: [] })
  assert.deepEqual(await readdir(f.root), [])
  assert.equal(f.state.decrypts, 0)
  assert.equal(f.state.encrypts, 0)
})

test('an interrupted Windows EFS replacement fails closed instead of projecting empty authority', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, `${GLOBAL_CONNECTIONS_FILE}.interrupted.efs-backup`), JSON.stringify({ version: 1, revision: 1, connections: [] }))
  await assert.rejects(f.service.list(), errorCode('STORAGE_ERROR'))
})

test('Windows EFS fallback publishes synced replacement and removes recovery artifacts', async t => {
  const f = await fixture(t)
  const staging = join(f.root, 'staged.tmp')
  await writeFile(f.file, 'old authority')
  await writeFile(staging, 'new authority')
  await replaceWindowsEncryptedFile(staging, f.file)
  assert.equal(await readFile(f.file, 'utf8'), 'new authority')
  assert.deepEqual(await readdir(f.root), [GLOBAL_CONNECTIONS_FILE])
})

test('creates an encrypted connection, returns only safe fields and survives reopen', async t => {
  const f = await fixture(t)
  const view = await f.service.create({ ...createInput(), name: '  共用接口  ', baseUrl: endpoint + '///' })
  assert.deepEqual(view.connections[0], { id: 'global-fixture-1', name: '共用接口', baseUrl: endpoint, protocol: 'openai-compatible', enabled: true, revision: 1, credentialState: 'stored' })
  const bytes = await readFile(f.file, 'utf8')
  const encrypted = JSON.parse(bytes).connections[0].encryptedApiKey
  decodeGlobalConnectionDocument(JSON.parse(bytes))
  assert.ok(encrypted)
  assert.ok(!bytes.includes(key))
  assert.ok(!JSON.stringify(view).includes(encrypted))
  assert.equal(f.state.decrypts, 0)
  const reopened = new ModelConnectionsService(new ModelConnectionsStore(f.root), f.secrets, () => 'global-unused')
  assert.deepEqual(await reopened.list(), view)
  const prepared = await reopened.prepareCredential('global-fixture-1', 1)
  assert.ok(!JSON.stringify(prepared).includes(encrypted))
  assert.equal(await prepared.use(async secret => { assert.equal(secret, key); return 'provider-result' }), 'provider-result')
  assert.equal(f.state.decrypts, 1)
  assert.deepEqual(await readdir(f.root), [GLOBAL_CONNECTIONS_FILE])
})

test('legacy rows project as OpenAI without read migration while new native rows roundtrip explicitly', async t => {
  const f = await fixture(t)
  const legacy = JSON.stringify({ version: 1, revision: 1, connections: [{ id: 'global-legacy', name: '旧接口', baseUrl: endpoint, enabled: true, revision: 1 }] })
  await writeFile(f.file, legacy)
  const view = await f.service.list()
  assert.equal(view.connections[0].protocol, 'openai-compatible')
  assert.equal(await readFile(f.file, 'utf8'), legacy)
  const saved = await f.service.create({ expectedRevision: 1, name: '原生接口', baseUrl: 'https://native.example.test', protocol: 'gemini-native' })
  assert.equal(saved.connections[1].protocol, 'gemini-native')
  const reopened = new ModelConnectionsService(new ModelConnectionsStore(f.root), f.secrets, () => 'unused')
  assert.deepEqual(await reopened.list(), saved)
  assert.equal((await f.store.read()).document.connections[0].protocol, undefined)
  assert.equal((await f.store.read()).document.connections[1].protocol, 'gemini-native')
})

test('same name and endpoint are distinct identities; updating one never changes the other', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const second = await f.service.create({ ...createInput(), expectedRevision: 1 })
  assert.equal(second.connections.length, 2)
  const before = (await f.store.read()).document.connections[1]
  await f.service.update({ expectedRevision: 2, id: 'global-fixture-1', connectionRevision: 1, name: '重命名', enabled: false })
  assert.deepEqual((await f.store.read()).document.connections[1], before)
})

test('renames without changing key and no-op updates do not write or advance revisions', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const prior = (await f.store.read()).document.connections[0].encryptedApiKey
  const view = await f.service.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', name: '新名称' })
  assert.equal(view.revision, 2)
  assert.equal(view.connections[0].revision, 2)
  assert.equal((await f.store.read()).document.connections[0].encryptedApiKey, prior)
  const before = await readFile(f.file)
  assert.deepEqual(await f.service.update({ expectedRevision: 2, connectionRevision: 2, id: 'global-fixture-1', name: '新名称' }), view)
  assert.deepEqual(await readFile(f.file), before)
  assert.equal(f.state.encrypts, 1)
})

test('clear, disable and restore are explicit, reversible and never return a fallback key', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  await f.service.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', enabled: false })
  await assert.rejects(f.service.prepareCredential('global-fixture-1', 2), errorCode('FEATURE_UNAVAILABLE'))
  await f.service.update({ expectedRevision: 2, connectionRevision: 2, id: 'global-fixture-1', enabled: true })
  const prepared = await f.service.prepareCredential('global-fixture-1', 3)
  assert.equal(await prepared.use(async value => value === key), true)
  const cleared = await f.service.update({ expectedRevision: 3, connectionRevision: 3, id: 'global-fixture-1', clearApiKey: true })
  assert.equal(cleared.connections[0].credentialState, 'missing')
  await assert.rejects(prepared.use(async () => assert.fail('revoked send')), errorCode('CONFLICT'))
  await assert.rejects(f.service.prepareCredential('global-fixture-1', 4), errorCode('FEATURE_UNAVAILABLE'))
})

test('key rotation rejects prepared sends and tool follow-ups, but unrelated connection creation does not', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const prepared = await f.service.prepareCredential('global-fixture-1', 1)
  await f.service.create({ ...createInput(), expectedRevision: 1 })
  await prepared.use(async value => assert.equal(value, key))
  await f.service.update({ expectedRevision: 2, connectionRevision: 1, id: 'global-fixture-1', apiKey: 'rotated-test-key' })
  const decrypts = f.state.decrypts
  await assert.rejects(prepared.use(async () => assert.fail('old send')), errorCode('CONFLICT'))
  assert.equal(f.state.decrypts, decrypts)
  const newer = await f.service.prepareCredential('global-fixture-1', 2)
  await newer.use(async value => assert.equal(value, 'rotated-test-key'))
})

test('detects externally altered credential even with the same connection revision', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const prepared = await f.service.prepareCredential('global-fixture-1', 1)
  const doc = (await f.store.read()).document
  doc.connections[0].encryptedApiKey = f.secrets.encrypt('external-key')
  await writeFile(f.file, JSON.stringify(doc))
  await assert.rejects(prepared.use(async () => assert.fail('changed send')), errorCode('CONFLICT'))
})

test('OS unavailable still permits safe listing, disables credential use and preserves save state', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const before = await readFile(f.file)
  const prepared = await f.service.prepareCredential('global-fixture-1', 1)
  f.state.available = false
  assert.equal((await f.service.list()).connections[0].credentialState, 'unavailable')
  await assert.rejects(prepared.use(async () => assert.fail('unavailable send')), errorCode('FEATURE_UNAVAILABLE'))
  await assert.rejects(f.service.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', apiKey: 'new-test-key' }), errorCode('FEATURE_UNAVAILABLE'))
  assert.deepEqual(await readFile(f.file), before)
  assert.equal(f.state.decrypts, 0)
})

test('encryption and decryption failures are safe and do not leak codec messages', async t => {
  const f = await fixture(t)
  f.state.failEncrypt = true
  await assert.rejects(f.service.create(createInput()), errorCode('FEATURE_UNAVAILABLE'))
  assert.deepEqual(await readdir(f.root), [])
  f.state.failEncrypt = false
  await f.service.create(createInput())
  f.state.failDecrypt = true
  assert.equal((await f.service.list()).connections[0].credentialState, 'stored')
  const prepared = await f.service.prepareCredential('global-fixture-2', 1)
  await assert.rejects(prepared.use(async () => assert.fail('bad codec')), errorCode('FEATURE_UNAVAILABLE'))
})

test('keyless metadata is allowed without OS encryption but unavailable is not tested connectivity', async t => {
  const f = await fixture(t)
  f.state.available = false
  const view = await f.service.create({ expectedRevision: 0, name: '稍后填密钥', baseUrl: endpoint, protocol: 'openai-compatible' })
  assert.equal(view.connections[0].credentialState, 'missing')
  assert.equal(f.state.encrypts, 0)
  assert.equal(f.state.decrypts, 0)
  assert.ok(!('testResult' in view.connections[0]))
})

for (const [label, input] of [
  ['plaintext extra key', { ...emptyGlobalConnections(), apiKey: key }],
  ['unknown schema', { ...emptyGlobalConnections(), version: 2 }],
  ['invalid revision', { ...emptyGlobalConnections(), revision: -1 }],
  ['not an object', []]
] as const) test(`invalid authority (${label}) is preserved and blocks list/write`, async t => {
  const f = await fixture(t)
  const bytes = JSON.stringify(input)
  await writeFile(f.file, bytes)
  await assert.rejects(f.service.list(), errorCode('STORAGE_ERROR'))
  await assert.rejects(f.service.create(createInput()), errorCode('STORAGE_ERROR'))
  assert.equal(await readFile(f.file, 'utf8'), bytes)
})

test('malformed JSON and invalid UTF-8 are not treated as empty defaults', async t => {
  const f = await fixture(t)
  for (const bytes of [Buffer.from('{broken'), Buffer.from([0xff, 0x7b, 0x7d])]) {
    await writeFile(f.file, bytes)
    await assert.rejects(f.store.read(), errorCode('STORAGE_ERROR'))
    assert.deepEqual(await readFile(f.file), bytes)
  }
})

test('over-limit authority is refused without reading it unbounded or rewriting', async t => {
  const f = await fixture(t)
  await writeFile(f.file, '{}')
  await truncate(f.file, MAX_MODEL_CONNECTION_BYTES + 1)
  await assert.rejects(f.store.read(), errorCode('STORAGE_ERROR'))
})

test('stale document and connection revisions fail before key encryption or write', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const before = await readFile(f.file)
  await assert.rejects(f.service.create(createInput()), errorCode('CONFLICT'))
  await assert.rejects(f.service.update({ expectedRevision: 1, connectionRevision: 2, id: 'global-fixture-1', apiKey: 'wrong-test-key' }), errorCode('CONFLICT'))
  assert.equal(f.state.encrypts, 1)
  assert.deepEqual(await readFile(f.file), before)
})

test('same-instance and cross-instance writers cannot lose an accepted connection', async t => {
  const f = await fixture(t)
  const other = new ModelConnectionsService(new ModelConnectionsStore(f.root), f.secrets, () => 'global-other')
  const results = await Promise.allSettled([f.service.create(createInput()), f.service.create(createInput()), other.create(createInput())])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  for (const result of results) if (result.status === 'rejected') errorCode('CONFLICT')(result.reason)
  assert.equal((await f.service.list()).connections.length, 1)
  assert.deepEqual(await readdir(f.root), [GLOBAL_CONNECTIONS_FILE])
})

test('lock held by another process is never stolen or deleted', async t => {
  const f = await fixture(t)
  const lockFile = f.file + '.lock'
  await writeFile(lockFile, 'another-owner')
  await assert.rejects(f.service.create(createInput()), errorCode('CONFLICT'))
  assert.equal(await readFile(lockFile, 'utf8'), 'another-owner')
  assert.deepEqual(await f.service.list(), { revision: 0, connections: [] })
})

test('failed publication preserves ciphertext and source settings, then allows retry', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  await writeFile(join(f.root, 'settings.json'), 'untouched legacy ciphertext fixture')
  const before = await readFile(f.file)
  const failing = new ModelConnectionsService(new ModelConnectionsStore(f.root, async () => { throw Error('secret-error'); }), f.secrets, () => 'global-next')
  await assert.rejects(failing.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', apiKey: 'new-test-key' }), errorCode('STORAGE_ERROR'))
  assert.deepEqual(await readFile(f.file), before)
  assert.equal(await readFile(join(f.root, 'settings.json'), 'utf8'), 'untouched legacy ciphertext fixture')
  await f.service.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', name: '重试成功' })
  assert.equal((await f.service.list()).revision, 2)
})

test('external edit during staging is preserved and staging is cleaned', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const external = (await f.store.read()).document
  external.connections[0].name = '外部修改'
  const bytes = JSON.stringify(external)
  const store = new ModelConnectionsStore(f.root, async (file, content, guard) => {
    await atomicWriteText(file, content, async () => { await writeFile(file, bytes); await guard() })
  })
  const service = new ModelConnectionsService(store, f.secrets, () => 'global-next')
  await assert.rejects(service.update({ expectedRevision: 1, connectionRevision: 1, id: 'global-fixture-1', name: '不能覆盖' }), errorCode('CONFLICT'))
  assert.equal(await readFile(f.file, 'utf8'), bytes)
  assert.deepEqual(await readdir(f.root), [GLOBAL_CONNECTIONS_FILE])
})

test('store refuses endpoint mutation and revision forgery even through private port', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const before = await f.store.read(), bytes = await readFile(f.file)
  const attempts: GlobalConnectionDocument[] = [
    { ...before.document, revision: 2, connections: [{ ...before.document.connections[0], baseUrl: 'https://other.example.test/v1', revision: 2 }] },
    { ...before.document, revision: 2, connections: [{ ...before.document.connections[0], protocol: 'gemini-native', revision: 2 }] },
    { ...before.document, revision: 2, connections: [{ ...before.document.connections[0], name: 'changed-without-revision' }] }
  ]
  for (const next of attempts) {
    await assert.rejects(f.store.commit(before, next), errorCode('STORAGE_ERROR'))
    assert.deepEqual(await readFile(f.file), bytes)
  }
})

test('raw-byte snapshot detects formatting drift as well as semantic changes', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const snapshot = await f.store.read()
  const next = { ...snapshot.document, revision: 2, connections: [...snapshot.document.connections, { id: 'global-next', name: 'next', baseUrl: endpoint, enabled: true, revision: 1 }] }
  const external = JSON.stringify(snapshot.document)
  await writeFile(f.file, external)
  await assert.rejects(f.store.commit(snapshot, next), errorCode('CONFLICT'))
  assert.equal(await readFile(f.file, 'utf8'), external)
})

test('hardlinked settings do not expose or overwrite another file', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'author-file.json')
  const bytes = JSON.stringify(emptyGlobalConnections())
  await writeFile(target, bytes)
  await link(target, f.file)
  await assert.rejects(f.store.read(), errorCode('STORAGE_ERROR'))
  await assert.rejects(f.service.create(createInput()), errorCode('STORAGE_ERROR'))
  assert.equal(await readFile(target, 'utf8'), bytes)
})

test('symlinked settings do not expose or overwrite another file', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'author-file.json')
  const bytes = JSON.stringify(emptyGlobalConnections())
  await writeFile(target, bytes)
  try { await symlink(target, f.file, 'file') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('OS denies file symlink creation (EPERM)'); return }
    throw error
  }
  await assert.rejects(f.store.read(), errorCode('STORAGE_ERROR'))
  await assert.rejects(f.service.create(createInput()), errorCode('STORAGE_ERROR'))
  assert.equal(await readFile(target, 'utf8'), bytes)
})

test('relative and missing app roots fail without creating a directory', async t => {
  const f = await fixture(t)
  assert.throws(() => new ModelConnectionsStore('relative-user-data'), errorCode('STORAGE_ERROR'))
  const store = new ModelConnectionsStore(join(f.root, 'absent'))
  await assert.rejects(store.read(), errorCode('STORAGE_ERROR'))
  await assert.rejects(store.commit({ document: emptyGlobalConnections(), fingerprint: null }, { ...emptyGlobalConnections(), revision: 1 }), errorCode('STORAGE_ERROR'))
  assert.deepEqual(await readdir(f.root), [])
})

test('entry bounds reject additions before encryption and preserve the full catalog', async t => {
  const f = await fixture(t)
  const connections = Array.from({ length: MAX_GLOBAL_CONNECTIONS }, (_, i) => ({
    id: `global-bound-${i}`, name: '连接', baseUrl: endpoint, enabled: true, revision: 1
  }))
  const document = { version: 1, revision: 1, connections }
  decodeGlobalConnectionDocument(document)
  await writeFile(f.file, JSON.stringify(document))
  const before = await readFile(f.file)
  await assert.rejects(f.service.create({ ...createInput(), expectedRevision: 1 }), errorCode('VALIDATION_ERROR'))
  assert.equal(f.state.encrypts, 0)
  assert.deepEqual(await readFile(f.file), before)
  assert.throws(() => decodeGlobalConnectionDocument({ ...document, connections: [...connections, { ...connections[0], id: 'global-overflow' }] }), errorCode('VALIDATION_ERROR'))
})

test('unprotected or malformed codec output cannot be published', async t => {
  const f = await fixture(t)
  for (const encrypt of [(value: string) => value, () => 'not-base64!']) {
    const service = new ModelConnectionsService(f.store, { available: () => true, encrypt, decrypt: () => '' }, () => 'global-invalid-codec')
    await assert.rejects(service.create({ ...createInput(), apiKey: 'YWJj' }), errorCode('FEATURE_UNAVAILABLE'))
    assert.deepEqual(await readdir(f.root), [])
  }
})

test('prepared credential refuses endpoint drift without decrypting or invoking a sender', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  const prepared = await f.service.prepareCredential('global-fixture-1', 1)
  const document = (await f.store.read()).document
  document.connections[0].baseUrl = 'https://changed.example.test/v1'
  await writeFile(f.file, JSON.stringify(document))
  await assert.rejects(prepared.assertCurrent(), errorCode('CONFLICT'))
  await assert.rejects(prepared.use(async () => assert.fail('wrong endpoint')), errorCode('CONFLICT'))
  assert.equal(f.state.decrypts, 0)
})

test('failure cleanup never removes a replacement lock owned by another operation', async t => {
  const f = await fixture(t)
  const store = new ModelConnectionsStore(f.root, async file => {
    await rename(file + '.lock', join(f.root, 'retained-original.lock'))
    await writeFile(file + '.lock', 'replacement-owner')
    throw Error('secret-error')
  })
  const service = new ModelConnectionsService(store, f.secrets, () => 'global-lock-swap')
  await assert.rejects(service.create(createInput()), errorCode('STORAGE_ERROR'))
  assert.equal(await readFile(f.file + '.lock', 'utf8'), 'replacement-owner')
  assert.deepEqual((await store.read()).document, emptyGlobalConnections())
})

test('existing atomic text/binary callers work unchanged and guard rejection cleans staging', async t => {
  const f = await fixture(t)
  await atomicWriteText(f.file, 'first')
  await atomicWriteBuffer(f.file, Buffer.from([0, 1, 2, 255]))
  assert.deepEqual(await readFile(f.file), Buffer.from([0, 1, 2, 255]))
  await assert.rejects(atomicWriteText(f.file, 'forbidden', async () => { throw Error('stale') }), /stale/)
  assert.deepEqual(await readFile(f.file), Buffer.from([0, 1, 2, 255]))
  assert.deepEqual(await readdir(f.root), [GLOBAL_CONNECTIONS_FILE])
})

test('input decoders reject endpoint mutation, ambiguous key actions and nonfinite revisions', () => {
  for (const input of [
    { expectedRevision: 0, name: '缺少协议', baseUrl: endpoint },
    { ...createInput(), protocol: 'unknown' },
    { ...createInput(), baseUrl: 'https://name:pass@example.test/v1' },
    { ...createInput(), baseUrl: endpoint + '?' },
    { ...createInput(), baseUrl: endpoint + '#fragment' },
    { ...createInput(), baseUrl: 'file:///bad' },
    { ...createInput(), expectedRevision: NaN },
    { ...createInput(), apiKey: '' },
    { ...createInput(), encryptedApiKey: 'forged' }
  ]) assert.throws(() => decodeConnectionCreate(input), errorCode('VALIDATION_ERROR'))
  const update = { expectedRevision: 1, connectionRevision: 1, id: 'global-one' }
  for (const input of [update, { ...update, baseUrl: endpoint }, { ...update, apiKey: key, clearApiKey: true }, { ...update, enabled: 1 }, { ...update, id: 'local:llama-cpp', name: 'bad' }]) {
    assert.throws(() => decodeConnectionUpdate(input), errorCode('VALIDATION_ERROR'))
  }
})

test('strict authority decoder rejects duplicates, secrets, sparse arrays and non-normalized endpoints', () => {
  const c = { id: 'global-one', name: '连接', baseUrl: endpoint, enabled: true, revision: 1 }
  for (const connections of [[c, c], [{ ...c, protocol: 'unknown' }], [{ ...c, apiKey: key }], [{ ...c, baseUrl: endpoint + '/' }], [{ ...c, encryptedApiKey: key }], [{ ...c, revision: 2 }], Array(1)]) {
    assert.throws(() => decodeGlobalConnectionDocument({ version: 1, revision: 1, connections }), errorCode('VALIDATION_ERROR'))
  }
})


test('remove persists exact target deletion, erases ciphertext and revokes prepared send without decryption', async t => {
  const f = await fixture(t)
  await f.service.create(createInput())
  await f.service.create({ ...createInput(), expectedRevision: 1 })
  const before = await f.store.read(), retained = before.document.connections[1]
  const prepared = await f.service.prepareCredential('global-fixture-1', 1)
  f.state.available = false // Deleting a saved key must not require decryption support.
  const result = await f.service.remove({ expectedRevision: 2, id: 'global-fixture-1', connectionRevision: 1 })
  assert.equal(result.revision, 3)
  assert.deepEqual(result.connections.map(c => c.id), ['global-fixture-2'])
  const reopened = await new ModelConnectionsStore(f.root).read()
  assert.deepEqual(reopened.document.connections, [retained])
  assert.ok(!(await readFile(f.file, 'utf8')).includes(before.document.connections[0].encryptedApiKey!))
  await assert.rejects(prepared.use(async () => assert.fail('removed sender invoked')), errorCode('CONFLICT'))
  await assert.rejects(f.service.prepareCredential('global-fixture-1', 1), errorCode('NOT_FOUND'))
  assert.equal(f.state.decrypts, 0)
})

for (const [label, patch, code] of [
  ['stale catalog', { expectedRevision: 0 }, 'CONFLICT'],
  ['stale entry', { connectionRevision: 2 }, 'CONFLICT'],
  ['unknown id', { id: 'global-absent' }, 'NOT_FOUND'],
  ['forged field', { apiKey: key }, 'VALIDATION_ERROR'],
  ['invalid revision', { expectedRevision: -1 }, 'VALIDATION_ERROR']
] as const) test(`remove rejects ${label} without changing stored bytes`, async t => {
  const f = await fixture(t); await f.service.create(createInput()); const before = await readFile(f.file)
  await assert.rejects(f.service.remove({ expectedRevision: 1, id: 'global-fixture-1', connectionRevision: 1, ...patch }), errorCode(code))
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.state.decrypts, 0)
})

test('remove publication failure preserves the original connection and key', async t => {
  const f = await fixture(t); await f.service.create(createInput()); const before = await readFile(f.file)
  const service = new ModelConnectionsService(new ModelConnectionsStore(f.root, async () => { throw Error('synthetic failure') }), f.secrets, () => 'global-unused')
  await assert.rejects(service.remove({ expectedRevision: 1, id: 'global-fixture-1', connectionRevision: 1 }), errorCode('STORAGE_ERROR'))
  assert.deepEqual(await readFile(f.file), before)
})

test('remove cannot bypass publication guard or race another writer', async t => {
  const f = await fixture(t); await f.service.create(createInput()); const before = await readFile(f.file)
  await assert.rejects(f.service.remove({ expectedRevision: 1, id: 'global-fixture-1', connectionRevision: 1 }, {
    assertActive() {}, async recheck() { throw new AppError('CONFLICT', 'revoked', { recoverable: true }) }
  }), errorCode('CONFLICT'))
  assert.deepEqual(await readFile(f.file), before)
  const input = { expectedRevision: 1, id: 'global-fixture-1', connectionRevision: 1 }
  const results = await Promise.allSettled([f.service.remove(input), f.service.update({ ...input, name: 'changed' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await f.store.read()).document.revision, 2)
})

test('storage accepts only one isolated removal and rejects collateral edits', async t => {
  const f = await fixture(t); await f.service.create(createInput()); await f.service.create({ ...createInput(), expectedRevision: 1 })
  const before = await f.store.read(), bytes = await readFile(f.file)
  for (const connections of [[], [{ ...before.document.connections[1], name: 'collateral', revision: 2 }],
    [before.document.connections[1], { ...before.document.connections[0], id: 'global-new' }]]) {
    await assert.rejects(f.store.commit(before, { ...before.document, revision: 3, connections }), errorCode('STORAGE_ERROR'))
    assert.deepEqual(await readFile(f.file), bytes)
  }
})
