import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../src/main/core/errors/app-error'
import { BOOK_MODEL_TASKS, type BookModelSettings, type ReferencedBookModelSettings } from '../../../src/main/modules/models/domain/book-model-settings'
import type { BookModelRequestScope, BookModelSourceReader } from '../../../src/main/modules/models/domain/book-model-resolution'
import type { ModelConnectionSecrets } from '../../../src/main/modules/models/domain/model-connections'
import type { LocalTextProvider, ModelRequestGuard, TextCompletionInput } from '../../../src/main/modules/models/domain/model-provider'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { BookModelResolver } from '../../../src/main/modules/models/application/book-model-resolver'
import { ModelConnectionsService } from '../../../src/main/modules/models/application/model-connections-service'
import { FileBookModelSource } from '../../../src/main/modules/models/adapters/book-model-source'
import { FilePrivateModelCredentials } from '../../../src/main/modules/models/adapters/private-model-credentials'
import { FileLegacyConnectionSource } from '../../../src/main/modules/models/adapters/legacy-connection-source'
import { ModelConnectionsStore, GLOBAL_CONNECTIONS_FILE } from '../../../src/main/modules/models/adapters/model-connections-store'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID } from '../../../src/contracts/models/local-model-contracts'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'

const endpoint = 'https://routing.example.test/v1'
const secret = 'synthetic-routing-key'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const profile = (connectionId = 'shared-api', model = 'manual-unknown-gemini', maxTokens = 1024) => ({ connectionId, model, maxTokens, temperature: 0.6, topP: 0.9 })
function document(model = 'manual-unknown-gemini'): ReferencedBookModelSettings {
  return { version: 4, routingMode: 'perTask',
    references: [{ kind: 'global', id: 'shared-api', globalConnectionId: 'global-shared', lastKnownName: '过时名称', lastKnownBaseUrl: 'https://obsolete.example.test/v1' }],
    shared: profile('shared-api', model), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task,
      profile('shared-api', task === 'prose' ? model : 'manual-unknown-gpt')])) as ReferencedBookModelSettings['tasks'] }
}
function localDocument(): BookModelSettings {
  const p = profile(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID)
  return { version: 3, connections: [], routingMode: 'shared', shared: p,
    tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, { ...p }])) as ReferencedBookModelSettings['tasks'] }
}
const errorCode = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof AppError)
  assert.equal(error.code, expected)
  assert.equal(error.recoverable, true)
  assert.doesNotMatch(JSON.stringify(error), /synthetic-routing|private-cause|routing\.example|user-data/)
  return true
}

async function hashes(root: string, dir = root): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(values, await hashes(root, path))
    else values[relative(root, path)] = hash(await readFile(path))
  }
  return values
}

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-model-routing-')))
  t.after(async () => {
    assert.ok(root.startsWith(join(parent, 'lanjian-model-routing-')))
    await rm(root, { recursive: true, force: true })
  })
  const book = join(root, 'book-a'), other = join(root, 'book-b'), app = join(root, 'user-data')
  for (const dir of [join(book, '.webnovel'), join(other, '.webnovel'), app]) await mkdir(dir, { recursive: true })
  const aiFile = join(book, '.webnovel', 'ai-settings.json'), settingsFile = join(app, 'settings.json')
  await writeFile(aiFile, JSON.stringify(document()))
  await writeFile(join(other, '.webnovel', 'ai-settings.json'), JSON.stringify(document('book-b-model')))
  await writeFile(join(book, 'manuscript.txt'), '原稿不变。\r\n')
  const state = { decrypts: 0, available: true }, machine = randomBytes(32)
  const secrets: ModelConnectionSecrets = {
    available: () => state.available,
    encrypt(value) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', machine, iv)
      const bytes = Buffer.concat([c.update(value, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), bytes]).toString('base64')
    },
    decrypt(value) {
      state.decrypts++
      const bytes = Buffer.from(value, 'base64'), d = createDecipheriv('aes-256-gcm', machine, bytes.subarray(0, 12))
      d.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8')
    }
  }
  await writeFile(settingsFile, JSON.stringify({ projectApiKeys: { [book]: { 'global-shared': secrets.encrypt('synthetic-private-a') },
    [other]: { 'global-shared': secrets.encrypt('synthetic-private-b') } }, ai: { encryptedApiKey: secrets.encrypt('synthetic-unused-app') } }))
  const store = new ModelConnectionsStore(app), globals = new ModelConnectionsService(store, secrets, () => 'global-shared')
  await globals.create({ expectedRevision: 0, name: '共用接口', baseUrl: endpoint, protocol: 'openai-compatible', apiKey: secret })
  const scope: BookModelRequestScope = { windowId: 'fixture-window', generation: 1, bookRoot: book }
  const books = new FileBookModelSource(), keys = new FilePrivateModelCredentials(app)
  const resolver = (reader: BookModelSourceReader = books) => new BookModelResolver(reader, keys, globals, secrets, () => ({ ...scope }))
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
  let afterSend: (() => Promise<void>) | undefined
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.ok(url.startsWith('https://') && url.includes('.example.test/'), 'only synthetic provider URLs')
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : {} })
    await afterSend?.()
    return new Response(JSON.stringify(url.endsWith('/models') ? { data: [{ id: 'manual-unknown-gemini' }] }
      : { choices: [{ message: { content: '隔离生成结果', tool_calls: [] } }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  const change = async (patch: Record<string, unknown>) => {
    const view = await globals.list(), selected = view.connections.find(c => c.id === 'global-shared')!
    return globals.update({ expectedRevision: view.revision, id: selected.id, connectionRevision: selected.revision, ...patch })
  }
  return { root, book, other, app, aiFile, settingsFile, secrets, state, store, globals, scope, books, keys, resolver, calls,
    ai: new AiClient(resolver()), change, afterSend: (callback: () => Promise<void>) => { afterSend = callback } }
}

async function seedDatabase(book: string, version: number, content?: string, mode = 'sqlite') {
  const file = join(book, '.webnovel', 'workspace.sqlite')
  if (version === WORKSPACE_DATABASE_SCHEMA_VERSION) (await new SqliteWorkspaceDatabaseFactory().open(book)).close()
  const db = new DatabaseSync(file)
  try {
    if (version !== WORKSPACE_DATABASE_SCHEMA_VERSION) for (const m of workspaceDatabaseMigrations.filter(m => m.version <= version)) {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(m.version, m.name, '2026-09-12', m.checksum)
      db.exec(`PRAGMA user_version = ${m.version}`)
    }
    db.prepare('INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('fixture-book', '隔离作品', 'active', 'a'.repeat(64), mode, '2026-09-12', '2026-09-12')
    if (content) {
      db.prepare('INSERT INTO ai_settings_documents (project_id, revision, content_json, content_hash, updated_at) VALUES (?, 1, ?, ?, ?)')
        .run('fixture-book', content, hash(content), '2026-09-12')
      db.exec('UPDATE projects SET ai_settings_ready = 1')
    }
  } finally { db.close() }
  return file
}

test('A/B reuse one global credential with independent GPT/Gemini profiles and zero source writes', async t => {
  const f = await fixture(t), before = await hashes(f.root)
  for (const task of BOOK_MODEL_TASKS) await f.ai.complete('写作', '', '', task)
  assert.deepEqual(f.calls.map(c => c.body.model), ['manual-unknown-gpt', 'manual-unknown-gpt', 'manual-unknown-gemini', 'manual-unknown-gpt'])
  f.scope.bookRoot = f.other; f.scope.generation++
  const prepared = await f.ai.prepareCompletion('prose')
  assert.equal(prepared.connectionId, 'shared-api')
  assert.doesNotMatch(JSON.stringify(prepared), /apiKey|synthetic|requestGuard|bookRoot|baseUrl/)
  await prepared.completeMessages!([{ role: 'system', content: '约束' }, { role: 'assistant', content: '旧文' }, { role: 'user', content: '继续' }])
  assert.equal(f.calls.at(-1)!.body.model, 'book-b-model')
  assert.equal((f.calls.at(-1)!.body.messages as TextCompletionInput['messages'])[1].role, 'assistant')
  for (const call of f.calls) {
    assert.equal(call.url, endpoint + '/chat/completions')
    assert.equal(new Headers(call.init.headers).get('Authorization'), 'Bearer ' + secret)
  }
  assert.equal(f.state.decrypts, 5)
  assert.deepEqual(await hashes(f.root), before)
})

test('private/global ID collisions use exact canonical book and original ID, never another book or app key', async t => {
  const f = await fixture(t), doc = document()
  doc.references.push({ kind: 'legacy-private', id: 'global-shared', originalConnectionId: 'global-shared', name: '私有', baseUrl: 'https://private.example.test/v1' })
  await writeFile(f.aiFile, JSON.stringify(doc))
  const before = await hashes(f.root)
  await f.ai.complete('写', '', '', 'prose', undefined, undefined, 'global-shared')
  assert.equal(f.calls[0].url, 'https://private.example.test/v1/chat/completions')
  assert.equal(new Headers(f.calls[0].init.headers).get('Authorization'), 'Bearer synthetic-private-a')
  await f.ai.complete('写')
  assert.equal(new Headers(f.calls[1].init.headers).get('Authorization'), 'Bearer ' + secret)
  assert.deepEqual(await hashes(f.root), before)
  const value = JSON.parse(await readFile(f.settingsFile, 'utf8'))
  delete value.projectApiKeys[f.book]
  await writeFile(f.settingsFile, JSON.stringify(value))
  await assert.rejects(f.ai.prepareCompletion('prose', undefined, 'global-shared'), errorCode('FEATURE_UNAVAILABLE'))
  assert.equal(f.calls.length, 2)
})

for (const version of [1, 2, 3]) test(`legacy v${version} routes remain private and use the exact original key`, async t => {
  const f = await fixture(t), p = profile('primary')
  const value = version === 1 ? { version, baseUrl: endpoint } : { version, routingMode: 'shared', shared: p,
    tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p])), connections: [{ id: 'primary', name: '私有', baseUrl: endpoint }] }
  await writeFile(f.aiFile, JSON.stringify(value))
  await writeFile(f.settingsFile, JSON.stringify({ projectApiKeys: { [f.book]: version === 1 ? f.secrets.encrypt(secret) : { primary: f.secrets.encrypt(secret) } } }))
  const before = await hashes(f.root)
  await f.ai.complete('写')
  assert.equal(new Headers(f.calls[0].init.headers).get('Authorization'), 'Bearer ' + secret)
  assert.deepEqual(await hashes(f.root), before)
})

for (const drift of ['switch', 'switch-back', 'window', 'route', 'root', 'rotate', 'disable', 'clear', 'remove', 'ciphertext', 'endpoint'] as const) {
  test(`prepared completion rejects ${drift} before dispatch`, async t => {
    const f = await fixture(t), prepared = await f.ai.prepareCompletion('prose')
    if (drift === 'switch') { f.scope.bookRoot = f.other; f.scope.generation++ }
    if (drift === 'switch-back') f.scope.generation += 2
    if (drift === 'window') f.scope.windowId = 'another-window'
    if (drift === 'route') await writeFile(f.aiFile, JSON.stringify(document('changed-model')))
    if (drift === 'root') {
      // Rename only this fixture-owned leaf; retain original content for identity comparison.
      assert.equal(relative(f.root, f.book), 'book-a')
      await rename(f.book, join(f.root, 'retained-book-a'))
      await mkdir(join(f.book, '.webnovel'), { recursive: true })
      await writeFile(f.aiFile, JSON.stringify(document()))
    }
    if (drift === 'rotate') await f.change({ apiKey: 'synthetic-rotated-key' })
    if (drift === 'disable') await f.change({ enabled: false })
    if (drift === 'clear') await f.change({ clearApiKey: true })
    if (['remove', 'ciphertext', 'endpoint'].includes(drift)) {
      const path = join(f.app, GLOBAL_CONNECTIONS_FILE), value = JSON.parse(await readFile(path, 'utf8'))
      if (drift === 'remove') value.connections = []
      if (drift === 'ciphertext') value.connections[0].encryptedApiKey = f.secrets.encrypt('synthetic-outside-rotation')
      if (drift === 'endpoint') value.connections[0].baseUrl = 'https://changed.example.test/v1'
      await writeFile(path, JSON.stringify(value))
    }
    await assert.rejects(prepared.complete('写'), errorCode('CONFLICT'))
    await assert.rejects(prepared.completeMessages!([{ role: 'user', content: '继续' }]), errorCode('CONFLICT'))
    assert.equal(f.calls.length, 0)
    assert.equal(f.state.decrypts, 1)
  })
}

test('unrelated catalog/settings/manuscript edits do not revoke; private key rotation does', async t => {
  const f = await fixture(t), global = await f.ai.prepareCompletion('prose'), doc = document()
  const extra = new ModelConnectionsService(f.store, f.secrets, () => 'global-unrelated')
  await extra.create({ expectedRevision: 1, name: '其他', baseUrl: endpoint, protocol: 'openai-compatible' })
  await global.complete('写')
  doc.references.push({ kind: 'legacy-private', id: 'private', originalConnectionId: 'global-shared', name: '私有', baseUrl: endpoint })
  await writeFile(f.aiFile, JSON.stringify(doc))
  const privateRequest = await f.ai.prepareCompletion('prose', undefined, 'private')
  const settings = JSON.parse(await readFile(f.settingsFile, 'utf8'))
  settings.theme = 'dark'; settings.projectApiKeys[f.other]['global-shared'] = f.secrets.encrypt('synthetic-other-change')
  await writeFile(f.settingsFile, JSON.stringify(settings))
  await writeFile(join(f.book, 'manuscript.txt'), '无关正文编辑。')
  await privateRequest.complete('写')
  settings.projectApiKeys[f.book]['global-shared'] = f.secrets.encrypt('synthetic-private-rotation')
  await writeFile(f.settingsFile, JSON.stringify(settings))
  await assert.rejects(privateRequest.complete('继续'), errorCode('CONFLICT'))
  assert.equal(f.calls.length, 2)
})

test('tool steps recheck credentials each time and never replay an already-sent request', async t => {
  const f = await fixture(t), tool = await f.ai.prepareToolConversation('outline')
  f.afterSend(async () => { await f.change({ apiKey: 'synthetic-tool-rotation' }) })
  assert.equal((await tool.step([{ role: 'user', content: '规划' }], [], new AbortController().signal)).content, '隔离生成结果')
  await assert.rejects(tool.step([{ role: 'user', content: '继续' }], [], new AbortController().signal), errorCode('CONFLICT'))
  assert.equal(f.calls.length, 1)
  assert.equal(f.state.decrypts, 1)
})

test('stream dispatch, cancellation, and final synchronous scope checks cannot bypass guards', async t => {
  const f = await fixture(t), deltas: string[] = []
  await f.ai.streamComplete('写', '', '', 'prose', undefined, undefined, delta => { deltas.push(delta) })
  assert.deepEqual(deltas, ['隔离生成结果'])
  assert.equal(f.calls[0].body.stream, true)
  const abort = new AbortController()
  const guard: ModelRequestGuard = { recheck: async () => { abort.abort() }, assertActive: () => assert.fail('aborted request must stop before final check') }
  const c = { kind: 'openai-compatible' as const, connectionId: 'remote', connectionName: '隔离', baseUrl: endpoint, apiKey: secret, profile: profile(), requestGuard: guard }
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  await assert.rejects((await ai.prepareCompletion('prose')).complete('写', '', '', abort.signal), { name: 'AbortError' })
  c.requestGuard = { recheck: async () => {}, assertActive: () => { throw new AppError('CONFLICT', '已切书', { recoverable: true }) } }
  await assert.rejects(ai.streamComplete('写'), errorCode('CONFLICT'))
  assert.equal(f.calls.length, 1)
})

test('scope changes during source acquisition stop before credential lookup or decryption', async t => {
  const f = await fixture(t)
  const reader: BookModelSourceReader = { capture: async root => { const snapshot = await f.books.capture(root); f.scope.generation += 2; return snapshot } }
  await assert.rejects(new AiClient(f.resolver(reader)).prepareCompletion('prose'), errorCode('CONFLICT'))
  assert.equal(f.state.decrypts, 0)
  assert.equal(f.calls.length, 0)
})

test('local requests read no global/private store or keys and preserve roles, limits and revocation', async t => {
  const f = await fixture(t)
  await writeFile(f.aiFile, JSON.stringify(localDocument()))
  await writeFile(f.settingsFile, '{broken remote settings')
  await writeFile(join(f.app, GLOBAL_CONNECTIONS_FILE), '{broken remote catalog')
  const calls: TextCompletionInput[] = []
  let tools = 0
  const local: LocalTextProvider = {
    listModels: async () => [LOCAL_QWEN_ID], ready: async () => true,
    limits: () => ({ contextTokens: 8192, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 1024 }),
    complete: async input => { calls.push(input); await input.onDelta?.('本地', '本地'); return { content: '本地' } },
    toolStep: async () => { tools++; return { content: '本地工具', toolCalls: [] } }
  }
  const resolver = new BookModelResolver(f.books,
    { capture: async () => assert.fail('local must not read private keys') },
    { list: async () => assert.fail('local must not list global keys'), prepareCredential: async () => assert.fail('local must not resolve remote') },
    { available: () => assert.fail('local must not touch secrets'), encrypt: () => assert.fail(), decrypt: () => assert.fail() }, () => f.scope)
  const ai = new AiClient(resolver, local), before = await hashes(f.root)
  assert.deepEqual(await ai.listModels(), { models: [LOCAL_QWEN_ID] })
  const prepared = await ai.prepareCompletion('prose', undefined, undefined, 512)
  await prepared.completeMessages!([{ role: 'assistant', content: '旧文' }, { role: 'user', content: '继续' }])
  assert.equal(calls[0].profile.maxTokens, 512); assert.equal(calls[0].messages[0].role, 'assistant')
  const tool = await ai.prepareToolConversation('outline')
  await tool.step([], [], new AbortController().signal)
  assert.equal(tools, 1)
  await assert.rejects(ai.prepareCompletion('prose', undefined, undefined, 8192), errorCode('VALIDATION_ERROR'))
  f.scope.generation += 2
  await assert.rejects(prepared.complete('继续'), errorCode('CONFLICT'))
  await assert.rejects(tool.step([], [], new AbortController().signal), errorCode('CONFLICT'))
  assert.equal(calls.length, 1); assert.equal(tools, 1); assert.equal(f.calls.length, 0); assert.equal(f.state.decrypts, 0)
  assert.deepEqual(await hashes(f.root), before)
})

test('explicit remote test works with local default and freezes catalog/generation credential', async t => {
  const f = await fixture(t), doc = document(), local = profile(LOCAL_CONNECTION_ID, LOCAL_QWEN_ID)
  doc.routingMode = 'shared'; doc.shared = local
  await writeFile(f.aiFile, JSON.stringify(doc))
  f.afterSend(async () => { await f.change({ apiKey: 'synthetic-probe-rotation' }) })
  const result = await f.ai.testConnection({ connectionId: 'shared-api', model: 'manual-unknown-gemini' })
  assert.equal(result.success, false)
  assert.match(result.message, /变化/)
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith('/models')); assert.equal(f.state.decrypts, 1)
})

test('new draft endpoints never receive a saved key, and fully explicit drafts need no saved settings', async t => {
  const f = await fixture(t)
  const rejected = await f.ai.testConnection({ connectionId: 'shared-api', model: 'draft-model', baseUrl: 'https://new.example.test/v1' })
  assert.equal(rejected.success, false); assert.match(rejected.message, /旧密钥/); assert.equal(f.calls.length, 0)
  const ai = new AiClient({ resolve: async () => assert.fail('unused settings'), resolveConnection: async () => assert.fail('unused saved key') })
  assert.equal((await ai.testConnection({ model: 'draft-model', baseUrl: 'https://new.example.test/v1', apiKey: 'synthetic-draft' })).success, true)
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every(c => new Headers(c.init.headers).get('Authorization') === 'Bearer synthetic-draft'))
})

test('formal SQLite AI authority ignores broken mirror and unrelated WAL edits without changing source bytes', async t => {
  const f = await fixture(t), path = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION, JSON.stringify(document()))
  await writeFile(f.aiFile, '{broken mirror')
  const db = new DatabaseSync(path)
  try {
    db.exec("PRAGMA journal_mode = WAL; UPDATE projects SET name = 'pending WAL'")
    const before = await hashes(f.root), prepared = await f.ai.prepareCompletion('prose')
    await prepared.complete('写')
    assert.deepEqual(await hashes(f.root), before)
    db.exec("UPDATE projects SET name = 'unrelated manuscript metadata'")
    const changed = await hashes(f.root)
    await prepared.complete('继续')
    assert.deepEqual(await hashes(f.root), changed)
    db.exec('UPDATE ai_settings_documents SET revision = revision + 1')
    await assert.rejects(prepared.complete('停止'), errorCode('CONFLICT'))
    assert.equal(f.calls.length, 2)
  } finally { db.close() }
})

test('legacy reuse retains whole-DB fingerprint while model requests use only AI authority', async t => {
  const f = await fixture(t), p = profile('global-shared')
  const content = JSON.stringify({ version: 2, connections: [{ id: p.connectionId, name: '私有', baseUrl: endpoint }],
    routingMode: 'shared', shared: p, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p])) })
  const file = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION, content)
  const reuse = await new FileLegacyConnectionSource(f.app).capture(f.book, ['global-shared'])
  const prepared = await f.ai.prepareCompletion('prose'), db = new DatabaseSync(file)
  try { db.exec("UPDATE projects SET name = 'unrelated edit'") } finally { db.close() }
  await prepared.complete('写')
  await assert.rejects(reuse.assertCurrent(), errorCode('CONFLICT'))
})

for (const state of ['old-schema', 'unready', 'shadow'] as const) test(`${state} keeps file authority with no creation, upgrade or mirror write`, async t => {
  const f = await fixture(t)
  await seedDatabase(f.book, state === 'old-schema' ? 28 : WORKSPACE_DATABASE_SCHEMA_VERSION, undefined, state === 'shadow' ? 'shadow' : 'sqlite')
  const before = await hashes(f.root)
  await f.ai.complete('写')
  assert.deepEqual(await hashes(f.root), before)
})

for (const corruption of ['file', 'future-file', 'database', 'future-schema', 'missing-ready-row', 'hash', 'unready-row', 'formal-document'] as const) {
  test(`corrupt ${corruption} fails closed without fallback, repair, decryption or send`, async t => {
    const f = await fixture(t)
    if (corruption === 'file') await writeFile(f.aiFile, '{broken')
    else if (corruption === 'future-file') await writeFile(f.aiFile, JSON.stringify({ ...document(), version: 99 }))
    else if (corruption === 'database') await writeFile(join(f.book, '.webnovel', 'workspace.sqlite'), 'not SQLite')
    else {
      const path = await seedDatabase(f.book, WORKSPACE_DATABASE_SCHEMA_VERSION,
        corruption === 'missing-ready-row' || corruption === 'future-schema' ? undefined : JSON.stringify(document()))
      const db = new DatabaseSync(path)
      try {
        if (corruption === 'future-schema') db.exec(`PRAGMA user_version = ${WORKSPACE_DATABASE_SCHEMA_VERSION + 1}`)
        if (corruption === 'missing-ready-row') db.exec('UPDATE projects SET ai_settings_ready = 1')
        if (corruption === 'hash') db.prepare('UPDATE ai_settings_documents SET content_hash = ?').run('f'.repeat(64))
        if (corruption === 'unready-row') db.exec('UPDATE projects SET ai_settings_ready = 0')
        if (corruption === 'formal-document') {
          const content = JSON.stringify({ ...document(), extraCredential: 'forbidden' })
          db.prepare('UPDATE ai_settings_documents SET content_json = ?, content_hash = ?').run(content, hash(content))
        }
      } finally { db.close() }
    }
    const before = await hashes(f.root)
    // Invalid JSON is rejected by the bounded file reader; valid JSON with bad book shape reaches the domain decoder.
    const expected = corruption === 'future-file' ? 'FEATURE_UNAVAILABLE' : corruption === 'formal-document' ? 'VALIDATION_ERROR' : 'STORAGE_ERROR'
    await assert.rejects(f.ai.prepareCompletion('prose'), errorCode(expected))
    assert.deepEqual(await hashes(f.root), before)
    assert.equal(f.state.decrypts, 0); assert.equal(f.calls.length, 0)
  })
}

test('a missing AI file stays absent and cannot borrow another book or app credentials', async t => {
  const f = await fixture(t), empty = join(f.root, 'empty-book')
  await mkdir(empty)
  f.scope.bookRoot = empty; f.scope.generation++
  const before = await hashes(f.root), snapshot = await f.books.capture(empty)
  assert.equal(snapshot.settings.version, 2)
  await assert.rejects(f.ai.prepareCompletion('prose'), errorCode('FEATURE_UNAVAILABLE'))
  assert.deepEqual(await hashes(f.root), before)
  assert.equal(f.state.decrypts, 0); assert.equal(f.calls.length, 0)
})

for (const state of ['missing', 'disabled', 'keyless', 'corrupt', 'unavailable', 'bad-cipher'] as const) {
  test(`global ${state} cannot fall back to diagnostic metadata or private keys`, async t => {
    const f = await fixture(t), file = join(f.app, GLOBAL_CONNECTIONS_FILE)
    if (state === 'missing') await writeFile(file, JSON.stringify({ version: 1, revision: 1, connections: [] }))
    if (state === 'disabled') await f.change({ enabled: false })
    if (state === 'keyless') await f.change({ clearApiKey: true })
    if (state === 'corrupt') await writeFile(file, '{broken')
    if (state === 'unavailable') f.state.available = false
    if (state === 'bad-cipher') {
      const value = JSON.parse(await readFile(file, 'utf8'))
      value.connections[0].encryptedApiKey = Buffer.from('synthetic-invalid-cipher').toString('base64')
      await writeFile(file, JSON.stringify(value))
    }
    const before = await hashes(f.root)
    await assert.rejects(f.ai.prepareCompletion('prose'), errorCode(state === 'missing' ? 'NOT_FOUND' : state === 'corrupt' ? 'STORAGE_ERROR' : 'FEATURE_UNAVAILABLE'))
    assert.deepEqual(await hashes(f.root), before)
    assert.equal(f.state.decrypts, state === 'bad-cipher' ? 1 : 0)
    assert.equal(f.calls.length, 0)
  })
}

test('a book switch during asynchronous credential recheck is stopped by the final scope check', async t => {
  const f = await fixture(t)
  let switchOnCheck = false
  const globals = {
    list: () => f.globals.list(),
    prepareCredential: async (id: string, revision: number) => {
      const credential = await f.globals.prepareCredential(id, revision)
      return { ...credential, assertCurrent: async () => { await credential.assertCurrent(); if (switchOnCheck) f.scope.generation += 2 } }
    }
  }
  const ai = new AiClient(new BookModelResolver(f.books, f.keys, globals, f.secrets, () => f.scope))
  const prepared = await ai.prepareCompletion('prose')
  switchOnCheck = true
  await assert.rejects(prepared.complete('写'), errorCode('CONFLICT'))
  assert.equal(f.calls.length, 0)
})

test('guarded SSE retains the existing event protocol and native deltas', async t => {
  const f = await fixture(t), deltas: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + secret)
    assert.equal(JSON.parse(String(init.body)).stream, true)
    return new Response('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const result = await f.ai.streamComplete('写', '', '', 'prose', undefined, undefined, delta => { deltas.push(delta) })
  assert.equal(result.content, '第一段第二段'); assert.deepEqual(deltas, ['第一段', '第二段'])
  assert.equal(f.state.decrypts, 1)
})
