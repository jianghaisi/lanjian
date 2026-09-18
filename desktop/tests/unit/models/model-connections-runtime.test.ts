import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerModelConnections } from '../../../src/main/modules/models/runtime/model-connections-runtime'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { BOOK_MODEL_TASKS } from '../../../src/main/modules/models/domain/book-model-settings'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'
import { compileRouting, routingDraft } from '../../../src/renderer/features/models/services/model-connections-state'
import type { ModelConnectionsApi } from '../../../src/contracts/models/model-connections-contracts'
import { createModelConnectionsBridge } from '../../../src/preload/model-connections-bridge'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { OpenAiCompatibleImageClient } from '../../../src/main/modules/models/adapters/openai-compatible-image-client'

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-model-runtime-'))), app = join(root, 'app')
  await mkdir(app)
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-model-runtime-'))); assert.equal(await realpath(root), root); await rm(root, { recursive: true, force: true }) })
  let decrypts = 0, localCalls = 0
  const secrets = { available: () => true, encrypt: (v: string) => Buffer.from(`synthetic-test-envelope-1234567890|${v}`).toString('base64'), decrypt: (v: string) => { decrypts++; return Buffer.from(v, 'base64').toString().split('|')[1] } }
  const settings = new SettingsStore(app, secrets), projects = new ProjectService(settings), writes = new WorkspaceWriteCoordinator()
  const formal = new SqliteManuscriptService(new SqliteWorkspaceDatabaseFactory(), undefined, writes)
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const ipc = { handle: (channel: string, listener: (e: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, listener) } as unknown as IpcMain
  const frame = {}, event = { sender: { id: 7, isDestroyed: () => false, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  let closed: (() => void) | undefined
  const window = { webContents: { id: 7, once: (_: string, cb: () => void) => { closed = cb } } } as unknown as BrowserWindow
  const local = { listModels: async () => ['fixture-local'], ready: async () => true, limits: () => ({ contextTokens: 8192, systemReserveTokens: 256, maxOutputTokens: 4096, recommendedOutputTokens: 2048 }),
    complete: async () => { localCalls++; return { content: '本机响应' } }, toolStep: async () => { localCalls++; return { content: '本机响应', toolCalls: [] } } }
  const change = async <T>(operation: () => Promise<T>, preserve = false) => { runtime.beginChange(preserve); try { return await operation() } finally { runtime.endChange() } }
  const runtime = registerModelConnections(ipc, app, secrets, projects, formal, writes, local, change, settings)
  runtime.attach(window)
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => unwrapValidatedIpcResponse<T>(channel, await handlers.get(channel)!(event, ...args))
  const api = createModelConnectionsBridge(invoke)
  const connect = async (key = false) => { const current = await api.list(); return api.create({ expectedRevision: current.revision, name: '合成共享接口', baseUrl: 'https://provider.example.test/v1', protocol: 'openai-compatible', ...(key ? { apiKey: 'fixture-secret-sentinel' } : {}) }) }
  const saveDefaults = async (id: string, model = 'gemini-fixture') => {
    const current = await api.defaults(), catalog = await api.list(), p = (model = 'gpt-fixture') => ({ connectionId: 'planner', model, temperature: .6, topP: .9, maxTokens: 4096 })
    return api.saveDefaults({ expectedRevision: current.revision, expectedCatalogRevision: catalog.revision,
      template: { version: 4, references: [{ kind: 'global', id: 'planner', globalConnectionId: id }], routingMode: 'perTask', shared: p(), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p(task === 'prose' ? model : 'gpt-fixture')])) as any } })
  }
  const create = async (title: string, manual = false) => { const preview = await api.previewCreation(manual); const result = await api.createProject({ token: preview.token, project: { parentPath: root, title } }); assert.equal(result.status, 'created'); return join(root, title) }
  return { root, app, api, runtime, projects, settings, secrets, event, handlers, change, connect, saveDefaults, create, closed: () => closed!(), counts: () => ({ decrypts, localCalls }) }
}

test('public main + preload: manage with no book, create A/B/C with independent defaults and explicitly apply to B', async t => {
  const f = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => assert.fail('reads and saves must not network'))
  const catalog = await f.connect(true), id = catalog.connections[0].id
  assert.equal(f.counts().decrypts, 0)
  assert.doesNotMatch(JSON.stringify(catalog), /fixture-secret|encryptedApiKey/)
  await f.saveDefaults(id)
  const a = await f.create('A'), b = await f.create('B'), aFile = join(a, '.webnovel/ai-settings.json'), bFile = join(b, '.webnovel/ai-settings.json')
  const aBefore = await readFile(aFile), bBefore = await readFile(bFile)
  const edit = await f.api.book(), draft = routingDraft(edit.settings); draft.profiles.prose.model = 'B-only'
  const saved = await f.api.saveBook({ token: edit.token, patch: compileRouting(draft, catalog, edit.settings).patch })
  assert.equal(saved.settings.tasks.prose.model, 'B-only'); assert.deepEqual(await readFile(aFile), aBefore)
  await f.saveDefaults(id, 'next-gemini'); const c = await f.create('C')
  assert.equal(JSON.parse(await readFile(join(c, '.webnovel/ai-settings.json'), 'utf8')).defaultRevision, 2)
  await f.change(() => f.projects.switch(b))
  const current = await f.api.book(), preview = await f.api.previewApply({ bookRevision: current.revision, defaultRevision: 2 })
  const beforeConfirm = await readFile(bFile)
  assert.ok(preview.changes.some(c => c.field === 'prose.model')); assert.notDeepEqual(beforeConfirm, bBefore)
  assert.deepEqual(await readFile(bFile), beforeConfirm)
  const applied = await f.api.confirmApply(preview.token)
  assert.equal(applied.settings.tasks.prose.model, 'next-gemini')
  await assert.rejects(f.api.confirmApply(preview.token), { code: 'CONFLICT' })
  assert.deepEqual(await readFile(aFile), aBefore); assert.equal(f.counts().decrypts, 0)
})

test('public reads preserve missing shared references, and actual resolution refuses them without fallback', async t => {
  const f = await fixture(t), c = await f.connect(); await f.saveDefaults(c.connections[0].id); await f.create('A')
  await writeFile(join(f.app, 'global-model-connections.json'), JSON.stringify({ version: 1, revision: 9, connections: [] }))
  const publicSettings = await f.runtime.projectAi.get()
  assert.equal(publicSettings.version, 4); assert.equal(publicSettings.modelConfigured, false)
  assert.equal(publicSettings.connections[0].baseUrl, '')
  unwrapValidatedIpcResponse('ai:get-settings', { ok: true, value: publicSettings })
  await assert.rejects(f.runtime.projectAi.resolve('prose'), { code: 'NOT_FOUND' })
})

test('public book save rejects cross-book token and cancellation/expired default previews do not write', async t => {
  const f = await fixture(t), c = await f.connect(); await f.saveDefaults(c.connections[0].id); const a = await f.create('A')
  const edit = await f.api.book(), before = await readFile(join(a, '.webnovel/ai-settings.json'))
  await f.create('B')
  await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: { model: 'stale' } } }), { code: 'CONFLICT' })
  assert.deepEqual(await readFile(join(a, '.webnovel/ai-settings.json')), before)
  const pending = await f.api.previewCreation(false); await f.api.cancelPreviews()
  await assert.rejects(f.api.createProject({ token: pending.token, project: { parentPath: f.root, title: 'Stale' } }), { code: 'CONFLICT' })
})

test('reuse previews are secret-free; confirmation preserves original settings, source and receipt idempotence', async t => {
  const f = await fixture(t), book = await f.create('Legacy', true)
  const p = { connectionId: 'primary', model: 'gpt-fixture', temperature: .5, topP: .9, maxTokens: 1024 }
  const raw = JSON.stringify({ version: 2, connections: [{ id: 'primary', name: '旧接口', baseUrl: 'https://legacy.example.test/v1' }], routingMode: 'shared', shared: p, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p])) })
  const file = join(book, '.webnovel/ai-settings.json'); await writeFile(file, raw)
  await f.settings.updateProjectApiKey(book, 'fixture-secret-sentinel')
  const settingsBefore = await readFile(join(f.app, 'settings.json'))
  const preview = await f.api.previewReuse({ selectedIds: ['primary'], expectedRevision: 0 })
  assert.equal(f.counts().decrypts, 0); assert.doesNotMatch(JSON.stringify(preview), /fixture-secret|encryptedApiKey/)
  await f.api.cancelPreviews(); assert.deepEqual(await readFile(join(f.app, 'settings.json')), settingsBefore)
  const actual = await f.api.previewReuse({ selectedIds: ['primary'], expectedRevision: 0 }), result = await f.api.confirmReuse(actual.token)
  assert.deepEqual(await f.api.confirmReuse(actual.token), result); assert.deepEqual(await f.api.reuseReceipt(actual.token), result)
  assert.equal(await readFile(file, 'utf8'), raw); assert.deepEqual(await readFile(join(f.app, 'settings.json')), settingsBefore)
})

test('explicit global probe uses one selected key/revision and never sends a book prompt', async t => {
  const f = await fixture(t), catalog = await f.connect(true), c = catalog.connections[0]
  let sends = 0
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { sends++; assert.match(String(url), /provider\.example\.test/); assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-secret-sentinel'); assert.match(String(init.body), /连接测试/); return new Response(JSON.stringify({ choices: [{ message: { content: '连接正常' } }] })) })
  const result = await f.api.test({ id: c.id, revision: c.revision, model: 'fixture-probe' })
  assert.equal(result.success, true); assert.equal(sends, 1); assert.doesNotMatch(JSON.stringify(result), /fixture-secret/)
  await f.api.update({ expectedRevision: catalog.revision, id: c.id, connectionRevision: c.revision, enabled: false })
  await assert.rejects(f.api.test({ id: c.id, revision: c.revision, model: 'fixture-probe' }), { code: 'CONFLICT' }); assert.equal(sends, 1)
})

test('public Gemini-native connection probes catalog and generation with gateway-compatible auth and native payloads', async t => {
  const f = await fixture(t), current = await f.api.list()
  const catalog = await f.api.create({ expectedRevision: current.revision, name: 'Gemini 原生', baseUrl: 'https://native.example.test', protocol: 'gemini-native', apiKey: 'fixture-native-secret' })
  const connection = catalog.connections[0]
  assert.equal(connection.protocol, 'gemini-native')
  const calls: Array<{ url: string; headers: Headers; body?: any }> = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) })
    return new Response(String(url).endsWith('/v1beta/models')
      ? JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash-high' }] })
      : JSON.stringify({ candidates: [{ content: { parts: [{ text: '内部思考', thought: true }, { text: '连接正常' }] }, finishReason: 'STOP' }] }),
    { headers: { 'Content-Type': 'application/json' } })
  })
  const models = await f.api.catalog({ id: connection.id, revision: connection.revision, model: 'gemini-3.8-flash-high' })
  const generated = await f.api.test({ id: connection.id, revision: connection.revision, model: 'gemini-3.8-flash-high' })
  assert.deepEqual(models.models, ['gemini-3.8-flash-high'])
  assert.equal(generated.success, true)
  assert.deepEqual(calls.map(call => call.url), [
    'https://native.example.test/v1beta/models',
    'https://native.example.test/v1beta/models/gemini-3.8-flash-high:generateContent'
  ])
  assert.ok(calls.every(call => call.headers.get('x-goog-api-key') === 'fixture-native-secret' && call.headers.get('Authorization') === 'Bearer fixture-native-secret' && !call.url.includes('fixture-native-secret')))
  assert.ok(!('messages' in calls[1].body))
  assert.deepEqual(calls[1].body.contents, [{ role: 'user', parts: [{ text: '这是连接测试。请只回复：连接正常' }] }])
})

test('feature IPC rejects foreign windows, subframes, unknown fields and secrets in results', async t => {
  const f = await fixture(t)
  for (const event of [{ ...f.event, sender: { ...f.event.sender, id: 99 } }, { ...f.event, senderFrame: {} }]) {
    const result = await f.handlers.get('model-connections:list')!(event as IpcMainInvokeEvent) as any
    assert.equal(result.ok, false); assert.equal(result.error.code, 'FEATURE_UNAVAILABLE')
  }
  await assert.rejects((f.api.create as any)({ expectedRevision: 0, name: 'bad', baseUrl: 'https://example.test/v1', arbitraryPath: f.root }), { code: 'VALIDATION_ERROR' })
  assert.equal((await f.api.list()).connections.length, 0)
  assert.throws(() => unwrapValidatedIpcResponse('model-connections:list', { ok: true, value: { revision: 0, connections: [], encryptedApiKey: 'secret-sentinel' } }), { code: 'INTERNAL_ERROR' })
  f.closed(); await assert.rejects(f.api.list(), { code: 'FEATURE_UNAVAILABLE' })
})

test('default selection state preserves local budgets, same-name source identity, and private alias collisions', () => {
  const profile = { connectionId: 'assigned-1', model: 'same-name', temperature: .5, topP: .9, maxTokens: 1024 }
  const settings = { version: 2 as const, connections: [{ id: 'assigned-1', name: 'Private', baseUrl: 'https://private.example.test' }], routingMode: 'perTask' as const, shared: profile, tasks: { outline: profile, chapterOutline: profile, prose: profile, review: profile } }
  const draft = routingDraft(settings); draft.profiles.prose.selection = 'global:shared-id'
  const output = compileRouting(draft, { revision: 1, connections: [{ id: 'shared-id', name: 'Private', baseUrl: 'https://shared.example.test', protocol: 'openai-compatible', enabled: true, revision: 1, credentialState: 'missing' }] }, settings)
  assert.equal(output.template.shared.connectionId, 'assigned-1'); assert.notEqual(output.template.tasks.prose.connectionId, 'assigned-1')
  assert.equal(draft.profiles.outline.selection, 'private:assigned-1')
})

test('private rename and credential rotation are separate captured edits and never change the global copy', async t => {
  const f = await fixture(t), root = await f.create('Private', true), file = join(root, '.webnovel/ai-settings.json')
  const p = { connectionId: 'primary', model: 'fixture', temperature: .5, topP: .9, maxTokens: 1024 }
  await writeFile(file, JSON.stringify({ version: 2, connections: [{ id: 'primary', name: '旧接口', baseUrl: 'https://private.example.test' }], routingMode: 'shared', shared: p, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p])) }))
  await f.settings.updateProjectApiKey(root, 'private-before')
  const reuse = await f.api.previewReuse({ selectedIds: ['primary'], expectedRevision: 0 }); await f.api.confirmReuse(reuse.token)
  const globalBefore = await readFile(join(f.app, 'global-model-connections.json')), bookBefore = await readFile(file)
  const edit = await f.api.book()
  assert.equal(await f.api.savePrivateKey({ token: edit.token, id: 'primary', apiKey: 'private-after' }), true)
  assert.equal(await f.settings.projectApiKey(root), 'private-after'); assert.deepEqual(await readFile(file), bookBefore)
  await assert.rejects(f.api.savePrivateKey({ token: edit.token, id: 'primary', clearApiKey: true }), { code: 'CONFLICT' })
  const current = await f.api.book(), settingsBefore = await readFile(join(f.app, 'settings.json'))
  const renamed = await f.api.renamePrivate({ token: current.token, id: 'primary', name: '仅本书名称' })
  assert.equal(renamed.settings.version, 2); assert.equal(renamed.authority, 'files')
  assert.deepEqual(await readFile(join(f.app, 'settings.json')), settingsBefore)
  assert.deepEqual(await readFile(join(f.app, 'global-model-connections.json')), globalBefore)
  const clear = await f.api.book(); assert.equal(await f.api.savePrivateKey({ token: clear.token, id: 'primary', clearApiKey: true }), false)
  assert.doesNotMatch(await readFile(file, 'utf8'), /private-before|private-after|encryptedApiKey/)
})

test('private key edits reject book switching and external settings changes without overwriting either', async t => {
  const f = await fixture(t), root = await f.create('Private', true)
  const first = await f.api.book()
  await f.settings.updateProjectApiKey(root, 'external-key')
  const original = await readFile(join(f.app, 'settings.json'))
  await assert.rejects(f.api.savePrivateKey({ token: first.token, id: 'primary', apiKey: 'stale-key' }), { code: 'CONFLICT' })
  assert.deepEqual(await readFile(join(f.app, 'settings.json')), original)
  const edit = await f.api.book(); await f.create('Other', true)
  await assert.rejects(f.api.savePrivateKey({ token: edit.token, id: 'primary', apiKey: 'wrong-book-key' }), { code: 'CONFLICT' })
  assert.equal(await f.settings.projectApiKey(root), 'external-key')
})

test('unattached one-off global selection is source-explicit and does not save references', async t => {
  const f = await fixture(t), root = await f.create('Manual', true), c = await f.connect(true)
  const before = await f.api.book(), provider = new AiClient(f.runtime.projectAi)
  let sends = 0
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { sends++; assert.match(String(url), /provider.example.test/); assert.equal(JSON.parse(String(init.body)).model, 'same-model'); return new Response(JSON.stringify({ choices: [{ message: { content: 'fixture' } }] })) })
  await provider.complete('fixture', '', '', 'prose', undefined, 'same-model', `global:${c.connections[0].id}`)
  assert.equal(sends, 1); assert.deepEqual((await f.api.book()).settings, before.settings)
  await assert.rejects(f.runtime.projectAi.resolve('prose', c.connections[0].id))
  assert.equal(await f.projects.currentPath(), root)
})

test('frozen full-run provider cannot switch credentials between drafting and review', async t => {
  const f = await fixture(t), c = await f.connect(true), id = c.connections[0].id
  await f.saveDefaults(id); await f.create('Frozen')
  const ai = await new AiClient(f.runtime.projectAi).captureRun(['prose', 'review'])
  let sends = 0
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response(JSON.stringify({ choices: [{ message: { content: 'fixture' } }] })) })
  await ai.complete('draft')
  const catalog = await f.api.list()
  await f.api.update({ expectedRevision: catalog.revision, id, connectionRevision: catalog.connections[0].revision, apiKey: 'rotated-key' })
  await assert.rejects(ai.complete('review', '', '', 'review'), { code: 'CONFLICT' }); assert.equal(sends, 1)
})

test('local profile wrapper retains cancellation scope and local edits bypass a corrupt global catalog', async t => {
  const f = await fixture(t), p = { connectionId: 'local:llama-cpp', model: 'fixture-local', temperature: .5, topP: .9, maxTokens: 1024 }
  await f.api.saveDefaults({ expectedRevision: 0, expectedCatalogRevision: 0, template: { version: 4, references: [], routingMode: 'shared', shared: p, tasks: { outline: p, chapterOutline: p, prose: p, review: p } } })
  const root = await f.create('Local'), before = f.counts().decrypts
  await writeFile(join(f.app, 'global-model-connections.json'), '{bad json')
  const updated = await f.runtime.projectAi.update({ shared: { model: 'fixture-local', maxTokens: 512 } })
  assert.equal(updated.shared.maxTokens, 512)
  const local = { listModels: async () => ['fixture-local'], ready: async () => true, limits: () => ({ contextTokens: 8192, systemReserveTokens: 256, maxOutputTokens: 4096, recommendedOutputTokens: 2048 }), complete: async () => ({ content: 'local' }), toolStep: async () => ({ content: 'local', toolCalls: [] }) }
  const frozen = await new AiClient(f.runtime.projectAi, local).captureRun(['prose'])
  const wrapped = frozen.withLocalProfile(p), prepared = await wrapped.prepareCompletion('prose')
  await f.create('Other', true)
  await assert.rejects(prepared.complete('must not send'), { code: 'CONFLICT' })
  assert.equal(f.counts().decrypts, before); assert.ok(root)
})

test('image dispatch preserves the same global scope guard and refuses a disabled snapshot', async t => {
  const f = await fixture(t), c = await f.connect(true); await f.create('Images', true)
  const captured = await f.runtime.projectAi.resolveConnection(`global:${c.connections[0].id}`)
  if (captured.kind === 'local') throw Error('expected remote test fixture')
  const client = new OpenAiCompatibleImageClient({ resolveConnection: async () => captured }, async () => assert.fail('revoked image must not send'))
  await f.api.update({ expectedRevision: c.revision, id: c.connections[0].id, connectionRevision: c.connections[0].revision, enabled: false })
  await assert.rejects(client.generate(captured.connectionId, 'image-fixture', 'fixture'), { code: 'CONFLICT' })
})

test('returning to the shelf revokes book capabilities without forgetting the recent-book preference', async t => {
  const f = await fixture(t), c = await f.connect(true); await f.saveDefaults(c.connections[0].id)
  const root = await f.create('Leave'), prepared = await new AiClient(f.runtime.projectAi).prepareCompletion('prose'), edit = await f.api.book()
  await f.api.leaveBook()
  assert.equal(await f.projects.currentPath(), root)
  assert.equal((await f.api.list()).connections.length, 1)
  await assert.rejects(prepared.complete('revoked'), { code: 'CONFLICT' })
  await assert.rejects(f.api.book(), { code: 'CONFLICT' })
  await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: { model: 'stale' } } }), { code: 'CONFLICT' })
  await f.change(() => f.projects.switch(root)); assert.equal((await f.api.book()).settings.tasks.prose.model, 'gemini-fixture')
})

test('legacy public create dispatch also initializes defaults, while reopening does not inherit again', async t => {
  const f = await fixture(t), c = await f.connect(); await f.saveDefaults(c.connections[0].id)
  const created = await f.runtime.create({ parentPath: f.root, title: 'Compatibility' })
  assert.equal((await f.api.book()).settings.tasks.prose.model, 'gemini-fixture')
  await f.saveDefaults(c.connections[0].id, 'future-model')
  await f.api.leaveBook(); await f.change(() => f.projects.switch(created.project.path))
  assert.equal((await f.api.book()).settings.tasks.prose.model, 'gemini-fixture')
})
