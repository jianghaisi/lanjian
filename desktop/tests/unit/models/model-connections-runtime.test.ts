import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
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
import { saveTestedModelDefault } from '../../../src/renderer/features/models/services/model-quick-setup'

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-model-runtime-'))), app = join(root, 'app'), globals = join(root, 'globals')
  await mkdir(app); await mkdir(globals)
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
  const runtime = registerModelConnections(ipc, globals, app, secrets, projects, formal, writes, local, change, settings)
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
  return { root, app, globals, api, runtime, projects, settings, secrets, event, handlers, change, connect, saveDefaults, create, closed: () => closed!(), counts: () => ({ decrypts, localCalls }) }
}

test('explicit v2 upgrade preserves book bytes and credential-free default recovery; native probe diagnostics survive IPC', async t => {
  const f = await fixture(t), requests: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({ model: 'upstream-opus', content: [{ type: 'text', text: '连接正常' }], stop_reason: 'end_turn', usage: { input_tokens: 14, output_tokens: 5 } })
  })
  const catalog = await f.api.create({ expectedRevision: 0, name: '中转 Messages', baseUrl: 'https://relay.example.test/v1', protocol: 'anthropic-native', apiKey: 'synthetic-upgrade-secret' }), c = catalog.connections[0]
  const original = { connectionId: 'writer', model: 'opus5-5', parameterPolicy: { version: 1 as const, mode: 'auto' as const } }
  const template = { version: 5 as const, references: [{ kind: 'global' as const, id: 'writer', globalConnectionId: c.id }], routingMode: 'shared' as const, shared: original, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, original])) as any }
  const defaults = await f.api.saveDefaults({ expectedRevision: 0, expectedCatalogRevision: catalog.revision, template })
  const a = await f.create('UpgradeA'), b = await f.create('UpgradeB'), fileA = join(a, '.webnovel/ai-settings.json'), fileB = join(b, '.webnovel/ai-settings.json')
  const oldA = await readFile(fileA), oldB = await readFile(fileB)
  const upgraded = { ...original, parameterPolicy: { version: 2 as const, ruleId: 'claude-opus-5-5', mode: 'custom' as const, overrides: { reasoning: { effort: 'high' } } } }
  const book = await f.api.book()
  await f.api.saveBook({ token: book.token, patch: { shared: upgraded, globalRevisions: [{ id: c.id, revision: c.revision }] } })
  assert.deepEqual(await readFile(fileA), oldA, 'another book stays byte-identical')
  const recovery = join(b, '.webnovel/model-settings-recovery'), files = await readdir(recovery)
  assert.ok((await Promise.all(files.map(name => readFile(join(recovery, name))))).some(bytes => bytes.equals(oldB)))
  await f.api.saveDefaults({ expectedRevision: defaults.revision, expectedCatalogRevision: (await f.api.list()).revision, template: { ...template, shared: upgraded } })
  const backupName = (await readdir(f.globals)).find(name => name.startsWith('model-defaults-recovery-'))!
  const backup = await readFile(join(f.globals, backupName), 'utf8')
  assert.doesNotMatch(backup, /synthetic-upgrade-secret|encryptedApiKey/)
  assert.deepEqual(JSON.parse(backup).template, defaults.template)
  const saved = await readFile(fileB), globalFile = join(f.globals, 'global-model-connections.json'), globalBytes = await readFile(globalFile)
  await f.api.leaveBook(); await f.change(() => f.projects.switch(b)); await f.api.book(); await f.api.defaults()
  assert.deepEqual(await readFile(fileB), saved); assert.deepEqual(await readFile(globalFile), globalBytes); assert.equal(requests.length, 0)
  const receipt = await f.api.test({ id: c.id, revision: c.revision, model: upgraded.model, parameterPolicy: upgraded.parameterPolicy })
  assert.equal(receipt.success, true); assert.equal(receipt.diagnostics?.responseModel, 'upstream-opus')
  assert.equal(receipt.diagnostics?.outputTokens, 5); assert.equal(receipt.diagnostics?.reasoningTokens, undefined)
  assert.equal(requests[0].model, 'opus5-5'); assert.equal(requests[0].output_config.effort, 'high'); assert.equal(requests[0].temperature, undefined)
})

test('main/preload reject shared thinking that fails smaller tasks before saving either defaults or a book', async t => {
  const f = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => assert.fail('parameter validation and persistence must not call the provider'))
  const catalog = await f.api.create({ expectedRevision: 0, name: '合成预算校验', protocol: 'gemini-native', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'synthetic-budget-key' })
  const c = catalog.connections[0]
  const automatic = { connectionId: 'planner', model: 'gemini-2.5-flash', parameterPolicy: { version: 1 as const, mode: 'auto' as const } }
  const template = { version: 5 as const, references: [{ kind: 'global' as const, id: 'planner', globalConnectionId: c.id }], routingMode: 'shared' as const, shared: automatic,
    tasks: { outline: automatic, chapterOutline: automatic, prose: automatic, review: automatic } }
  const defaults = await f.api.saveDefaults({ expectedRevision: 0, expectedCatalogRevision: catalog.revision, template })
  const root = await f.create('SharedBudget'), file = join(root, '.webnovel/ai-settings.json'), globalFile = join(f.globals, 'global-model-connections.json')
  const before = await readFile(file), globalBefore = await readFile(globalFile), counts = f.counts()
  const invalid = { ...automatic, parameterPolicy: { version: 1 as const, mode: 'custom' as const, overrides: { thinking: { kind: 'budget' as const, tokens: 12000 } } } }
  await assert.rejects(f.api.saveDefaults({ expectedRevision: defaults.revision, expectedCatalogRevision: (await f.api.list()).revision, template: { ...template, shared: invalid } }), { code: 'VALIDATION_ERROR', message: /12000.*8192.*降低思考预算/ })
  assert.deepEqual(await readFile(globalFile), globalBefore)
  const edit = await f.api.book(), globalRevisions = [{ id: c.id, revision: c.revision }]
  for (const overrides of [{ topP: 1.2 }, { maxTokens: 128.5 }]) {
    const badNumber = { ...automatic, parameterPolicy: { version: 1 as const, mode: 'custom' as const, overrides } }
    await assert.rejects(f.api.test({ id: c.id, revision: c.revision, model: badNumber.model, parameterPolicy: badNumber.parameterPolicy }),
      { code: 'VALIDATION_ERROR', message: 'topP' in overrides ? /采样范围.*top_p.*0.*1.*清空/ : /最大输出.*128.*128000.*整数/ })
    // Raw malformed assignment patches retain their strict format boundary.
    // The real form decodes numeric intent before submitting this envelope.
    await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: badNumber, globalRevisions } }),
      { code: 'VALIDATION_ERROR', message: '作品模型分配格式无效，请检查选择和参数后重试。' })
    assert.deepEqual(await readFile(file), before); assert.deepEqual(await readFile(globalFile), globalBefore)
    assert.deepEqual(f.counts(), counts)
  }
  await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: invalid, globalRevisions } }), { code: 'VALIDATION_ERROR', message: /12000.*8192.*降低思考预算/ })
  assert.deepEqual(await readFile(file), before); assert.deepEqual(f.counts(), counts)
  // The same captured edit remains usable after rejected validation; independent prose is valid.
  await f.api.saveBook({ token: edit.token, patch: { routingMode: 'perTask', tasks: { prose: invalid }, globalRevisions } })
  const separate = await readFile(file), next = await f.api.book()
  await assert.rejects(f.api.saveBook({ token: next.token, patch: { routingMode: 'shared', shared: invalid, globalRevisions } }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await readFile(file), separate)
  const fixed = { ...invalid, parameterPolicy: { ...invalid.parameterPolicy, overrides: { ...invalid.parameterPolicy.overrides, maxTokens: 16384 } } }
  await f.api.saveBook({ token: next.token, patch: { routingMode: 'shared', shared: fixed, globalRevisions } })
  const ai = new AiClient(f.runtime.projectAi)
  for (const task of BOOK_MODEL_TASKS) {
    const effective = await ai.generationFor(task)
    assert.equal(effective?.outputTokens, 16384)
    assert.deepEqual(effective?.parameters.thinkingConfig, { thinkingBudget: 12000 })
  }
  assert.deepEqual(await readFile(globalFile), globalBefore, 'book corrections never rewrite the global source/default')
})

test('native thinking survives probe IPC, default persistence, new books, edits and apply preview', async t => {
  const f = await fixture(t), requests: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return Response.json({ candidates: [{ content: { parts: [{ text: '合成正文' }] }, finishReason: 'STOP' }] })
  })
  const catalog = await f.api.create({ expectedRevision: 0, name: '原生测试', baseUrl: 'https://native.example.test', protocol: 'gemini-native', apiKey: 'synthetic-native' })
  const c = catalog.connections[0]
  const receipt = await f.api.test({ id: c.id, revision: c.revision, model: 'gemini-3.8-flash', thinkingLevel: 'high' })
  assert.equal(receipt.thinkingLevel, 'high')
  assert.equal(requests[0].generationConfig.thinkingConfig.thinkingLevel, 'high')
  assert.equal(requests[0].generationConfig.maxOutputTokens, 8192)
  await saveTestedModelDefault(f.api, receipt)
  const root = await f.create('Thinking'), file = join(root, '.webnovel/ai-settings.json')
  assert.equal(JSON.parse(await readFile(file, 'utf8')).shared.thinkingLevel, 'high')
  const ai = new AiClient(f.runtime.projectAi)
  await ai.complete('合成写作')
  assert.equal(requests[1].generationConfig.thinkingConfig.thinkingLevel, 'high')
  const edit = await f.api.book()
  const before = await readFile(file)
  await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: { thinkingLevel: 'invalid' } } }), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await readFile(file), before)
  const saved = await f.api.saveBook({ token: edit.token, patch: { shared: { thinkingLevel: 'default' }, globalRevisions: [{ id: c.id, revision: c.revision }] } })
  assert.equal(saved.settings.shared.thinkingLevel, 'default')
  await assert.rejects(f.api.saveBook({ token: edit.token, patch: { shared: { thinkingLevel: 'low' } } }), { code: 'CONFLICT' })
  await ai.complete('default')
  assert.equal(requests[2].generationConfig.thinkingConfig, undefined)
  const defaults = await f.api.defaults(), current = await f.api.book()
  const preview = await f.api.previewApply({ bookRevision: current.revision, defaultRevision: defaults.revision })
  assert.ok(preview.changes.some(change => change.field === 'shared.thinkingLevel' && change.before === 'default' && change.after === 'high'))
  await f.api.confirmApply(preview.token)
  await f.api.leaveBook(); await f.change(() => f.projects.switch(root))
  assert.equal((await f.api.book()).settings.shared.thinkingLevel, 'high')
  assert.equal(requests.length, 3)
})

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

test('book-bound model run survives A to B to A while UI-bound authorization still expires', async t => {
  const f = await fixture(t), catalog = await f.connect(true)
  await f.saveDefaults(catalog.connections[0].id)
  const a = await f.create('BackgroundA'), b = await f.create('BackgroundB')
  await f.change(() => f.projects.switch(a))
  const ui = await f.runtime.projectAi.resolve('prose')
  let release!: () => void
  let captured!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { captured = resolve })
  const run = f.projects.runInCurrentBook(async () => {
    const model = await f.runtime.projectAi.resolve('prose')
    captured()
    await gate
    await model.requestGuard!.recheck()
    assert.equal(await f.projects.currentPath(), a)
    assert.equal(model.profile.model, 'gemini-fixture')
  })
  await ready
  await f.change(() => f.projects.switch(b))
  await assert.rejects(ui.requestGuard!.recheck(), { code: 'CONFLICT' })
  assert.equal(await f.projects.currentPath(), b)
  release()
  await run
  assert.equal(await f.projects.currentPath(), b)
  await f.change(() => f.projects.switch(a))
  await assert.rejects(ui.requestGuard!.recheck(), { code: 'CONFLICT' })
})

for (const patch of [{ enabled: false }, { apiKey: 'rotated-background-key' }]) {
  test(`background scope still rejects selected connection ${'enabled' in patch ? 'disable' : 'rotation'} after switching books`, async t => {
    const f = await fixture(t), catalog = await f.connect(true), id = catalog.connections[0].id
    await f.saveDefaults(id)
    const a = await f.create('Owner'), b = await f.create('Visible')
    await f.change(() => f.projects.switch(a))
    let release!: () => void, captured!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { captured = resolve })
    t.after(() => release())
    const run = f.projects.runInCurrentBook(async () => {
      const model = await f.runtime.projectAi.resolve('prose')
      captured()
      await gate
      await assert.rejects(model.requestGuard!.recheck(), { code: 'CONFLICT' })
    })
    await ready
    await f.change(() => f.projects.switch(b))
    const latest = await f.api.list()
    await f.api.update({ expectedRevision: latest.revision, id, connectionRevision: latest.connections[0].revision, ...patch })
    release()
    await run
    assert.equal(await f.projects.currentPath(), b)
  })
}

test('public reads preserve missing shared references, and actual resolution refuses them without fallback', async t => {
  const f = await fixture(t), c = await f.connect(); await f.saveDefaults(c.connections[0].id); await f.create('A')
  await writeFile(join(f.globals, 'global-model-connections.json'), JSON.stringify({ version: 1, revision: 9, connections: [] }))
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
  const models = await f.api.catalog({ id: connection.id, revision: connection.revision })
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
  const globalBefore = await readFile(join(f.globals, 'global-model-connections.json')), bookBefore = await readFile(file)
  const edit = await f.api.book()
  assert.equal(await f.api.savePrivateKey({ token: edit.token, id: 'primary', apiKey: 'private-after' }), true)
  assert.equal(await f.settings.projectApiKey(root), 'private-after'); assert.deepEqual(await readFile(file), bookBefore)
  await assert.rejects(f.api.savePrivateKey({ token: edit.token, id: 'primary', clearApiKey: true }), { code: 'CONFLICT' })
  const current = await f.api.book(), settingsBefore = await readFile(join(f.app, 'settings.json'))
  const renamed = await f.api.renamePrivate({ token: current.token, id: 'primary', name: '仅本书名称' })
  assert.equal(renamed.settings.version, 2); assert.equal(renamed.authority, 'files')
  assert.deepEqual(await readFile(join(f.app, 'settings.json')), settingsBefore)
  assert.deepEqual(await readFile(join(f.globals, 'global-model-connections.json')), globalBefore)
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
  await writeFile(join(f.globals, 'global-model-connections.json'), '{bad json')
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


test('public remove keeps book/default assignments missing, preserves other providers and revokes old capability', async t => {
  const f = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => assert.fail('remove must not network'))
  const initial = await f.connect(true), id = initial.connections[0].id
  await f.saveDefaults(id)
  const book = await f.create('DeleteFixture'), file = join(book, '.webnovel/ai-settings.json'), before = await readFile(file)
  const prepared = await f.runtime.globals.prepareCredential(id, 1)
  const defaults = await f.api.defaults(), catalog = await f.connect(true)
  await assert.rejects(f.api.remove({ expectedRevision: initial.revision, id, connectionRevision: 1 }), { code: 'CONFLICT' })
  const result = await f.api.remove({ expectedRevision: catalog.revision, id, connectionRevision: 1 })
  assert.deepEqual(result.connections.map(c => c.id), [catalog.connections[1].id])
  assert.deepEqual(await readFile(file), before)
  const after = await f.api.defaults()
  assert.deepEqual(after.template, defaults.template); assert.equal(after.references[0].state, 'missing')
  await assert.rejects(prepared.use(async () => assert.fail('deleted key')), { code: 'CONFLICT' })
  await assert.rejects(f.runtime.projectAi.resolve('prose'))
  assert.equal(f.counts().decrypts, 0)
  await assert.rejects(f.api.remove({ expectedRevision: result.revision, id, connectionRevision: 1 }), { code: 'NOT_FOUND' })
  await assert.rejects(f.api.remove({ expectedRevision: result.revision, id: catalog.connections[1].id, connectionRevision: 1, extra: true } as any), { code: 'VALIDATION_ERROR' })
})


test('v5 two books reference one API, retain independent model choices and survive fresh reads', async t => {
  const f = await fixture(t), catalog = await f.connect(true), c = catalog.connections[0]
  const draft = routingDraft(null)
  for (const p of Object.values(draft.profiles)) { p.selection = `global:${c.id}`; p.model = 'alias-a' }
  await f.api.saveDefaults({ expectedRevision: 0, expectedCatalogRevision: catalog.revision, template: compileRouting(draft, catalog).template })
  const a = await f.create('AdaptiveA'), b = await f.create('AdaptiveB'), bFile = join(b, '.webnovel/ai-settings.json')
  const bBefore = await readFile(bFile), keysBefore = await readFile(join(f.globals, 'global-model-connections.json'))
  await f.change(() => f.projects.switch(a))
  const view = await f.api.book(), edited = routingDraft(view.settings)
  assert.equal(view.settings.version, 5)
  edited.profiles.shared.model = 'alias-b'
  await f.api.saveBook({ token: view.token, patch: compileRouting(edited, await f.api.list(), view.settings).patch })
  assert.deepEqual(await readFile(bFile), bBefore)
  assert.deepEqual(await readFile(join(f.globals, 'global-model-connections.json')), keysBefore)
  assert.equal((await f.api.list()).connections.length, 1)
  await f.change(() => f.projects.switch(b)); assert.equal((await f.api.book()).settings.shared.model, 'alias-a')
  await f.change(() => f.projects.switch(a)); assert.equal((await f.api.book()).settings.shared.model, 'alias-b')
  const body: any[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { body.push(JSON.parse(String(init.body))); return Response.json({ choices: [{ message: { content: '完整合成正文' } }] }) })
  await new AiClient(f.runtime.projectAi).complete('隔离测试')
  assert.equal(body[0].model, 'alias-b'); assert.equal(body[0].max_tokens, 8192); assert.equal('temperature' in body[0], false)
  const third = await f.create('AdaptiveC')
  assert.equal(JSON.parse(await readFile(join(third, '.webnovel/ai-settings.json'), 'utf8')).shared.model, 'alias-a')
})

test('explicit private-to-global v5 save keeps exact recovery bytes and never decrypts or copies the private key', async t => {
  const f = await fixture(t), catalog = await f.connect(true), c = catalog.connections[0], book = await f.create('Transfer', true)
  const p = { connectionId: 'primary', model: 'old-alias', temperature: .5, topP: 1, maxTokens: 12000 }
  const raw = JSON.stringify({ version: 2, connections: [{ id: 'primary', name: '旧接口', baseUrl: 'https://legacy.example.test/v1' }], routingMode: 'shared', shared: p, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, p])) }, null, 2) + '\n'
  const file = join(book, '.webnovel/ai-settings.json'); await writeFile(file, raw); await f.settings.updateProjectApiKey(book, 'private-kept')
  const beforeKeys = await readFile(join(f.app, 'settings.json')), globalBefore = await readFile(join(f.globals, 'global-model-connections.json'))
  const view = await f.api.book(), draft = routingDraft(view.settings), decrypts = f.counts().decrypts
  for (const slot of Object.keys(draft.profiles) as Array<keyof typeof draft.profiles>) draft.profiles[slot] = { selection: `global:${c.id}`, model: p.model, parameterPolicy: { version: 1, mode: 'auto' } }
  const compiled = compileRouting(draft, await f.api.list(), view.settings)
  assert.equal(await readFile(file, 'utf8'), raw) // Preview/cancel can discard this patch without writing.
  const saved = await f.api.saveBook({ token: view.token, patch: compiled.patch })
  assert.equal(saved.settings.version, 5); assert.equal(f.counts().decrypts, decrypts)
  assert.deepEqual(await readFile(join(f.app, 'settings.json')), beforeKeys)
  assert.deepEqual(await readFile(join(f.globals, 'global-model-connections.json')), globalBefore)
  const recovery = join(book, '.webnovel/model-settings-recovery'), files = await readdir(recovery)
  assert.equal(files.length, 1); assert.equal(await readFile(join(recovery, files[0]), 'utf8'), raw)
  assert.doesNotMatch(await readFile(file, 'utf8'), /private-kept|encryptedApiKey/)
})

test('native catalog metadata is bounded, tied to revision, used by actual tests and invalidated by rotation', async t => {
  const f = await fixture(t), requests: any[] = []
  const catalog = await f.api.create({ expectedRevision: 0, name: 'metadata', baseUrl: 'https://gateway.example.test', protocol: 'gemini-native', apiKey: 'synthetic-metadata-secret' }), c = catalog.connections[0]
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (init.method !== 'POST') return Response.json({ models: [{ name: 'models/custom-writing', displayName: '合成写作', outputTokenLimit: 2048, inputTokenLimit: 32000, maxTemperature: 2, topP: .95, thinking: true, supportedGenerationMethods: ['generateContent'], ignoredVendorField: 'omit-me' }] })
    requests.push(JSON.parse(String(init.body))); return Response.json({ candidates: [{ content: { parts: [{ text: '完整正文' }] }, finishReason: 'STOP' }] })
  })
  const result = await f.api.catalog({ id: c.id, revision: c.revision })
  assert.equal(result.catalog?.entries[0].outputTokenLimit, 2048); assert.doesNotMatch(JSON.stringify(result), /omit-me|synthetic-metadata-secret/)
  const policy = { version: 1 as const, mode: 'custom' as const, overrides: { temperature: 0 } }
  const first = await f.api.test({ id: c.id, revision: c.revision, model: 'custom-writing', parameterPolicy: policy })
  assert.deepEqual(requests[0].generationConfig, { maxOutputTokens: 2048, temperature: 0 }); assert.match(first.parameterFingerprint!, /^[a-f0-9]{64}$/)
  const second = await f.api.test({ id: c.id, revision: c.revision, model: 'custom-writing', parameterPolicy: { ...policy, overrides: { temperature: 1 } } })
  assert.notEqual(second.parameterFingerprint, first.parameterFingerprint)
  const rotated = await f.api.update({ expectedRevision: catalog.revision, id: c.id, connectionRevision: c.revision, apiKey: 'synthetic-rotated' })
  await assert.rejects(f.api.test({ id: c.id, revision: rotated.connections[0].revision, model: 'custom-writing', parameterPolicy: policy }), { code: 'VALIDATION_ERROR' })
  assert.equal(requests.length, 2)
})

test('repairing an active route preserves inactive custom intent through disabled and deleted global sources', async t => {
  const f = await fixture(t)
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++
    return Response.json({ models: [{ name: 'models/old-writer', maxTemperature: 2, topP: .95, supportedGenerationMethods: ['generateContent'] }] })
  })
  const initial = await f.api.create({ expectedRevision: 0, name: '旧共用 API', baseUrl: 'https://native.example.test', protocol: 'gemini-native', apiKey: 'synthetic-old' })
  const old = initial.connections[0]
  await f.api.catalog({ id: old.id, revision: old.revision })
  const defaults = routingDraft(null); defaults.routingMode = 'perTask'
  for (const p of Object.values(defaults.profiles)) Object.assign(p, { selection: `global:${old.id}`, model: 'old-writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, topP: .8 } } })
  await f.api.saveDefaults({ expectedRevision: 0, expectedCatalogRevision: initial.revision, template: compileRouting(defaults, initial).template })
  const book = await f.create('RepairInactive'), file = join(book, '.webnovel/ai-settings.json')
  const withNew = await f.connect(), replacement = withNew.connections.find(c => c.id !== old.id)!
  let catalog = await f.api.update({ expectedRevision: withNew.revision, id: old.id, connectionRevision: old.revision, enabled: false })
  let view = await f.api.book()
  const previousTasks = structuredClone(view.settings.tasks), draft = routingDraft(view.settings)
  draft.routingMode = 'shared'
  draft.profiles.shared = { selection: `global:${replacement.id}`, model: 'new-writer', parameterPolicy: { version: 1, mode: 'auto' } }
  let saved = await f.api.saveBook({ token: view.token, patch: compileRouting(draft, catalog, view.settings).patch })
  assert.deepEqual(saved.settings.tasks, previousTasks)
  assert.notEqual(saved.settings.shared.connectionId, previousTasks.prose.connectionId)
  assert.equal(saved.settings.shared.model, 'new-writer')
  const beforeInvalid = await readFile(file)
  view = await f.api.book()
  const activeAgain = routingDraft(view.settings); activeAgain.routingMode = 'perTask'
  assert.throws(() => compileRouting(activeAgain, catalog, view.settings), /可用的全局接口/)
  await assert.rejects(f.api.saveBook({ token: view.token, patch: { routingMode: 'perTask', globalRevisions: [{ id: old.id, revision: 2 }] } }), { code: 'CONFLICT' })
  await assert.rejects(f.api.saveBook({ token: view.token, patch: { tasks: { prose: { model: 'edited-inactive' } }, globalRevisions: [{ id: old.id, revision: 2 }, { id: replacement.id, revision: replacement.revision }] } }), { code: 'CONFLICT' })
  assert.deepEqual(await readFile(file), beforeInvalid)
  catalog = await f.api.remove({ expectedRevision: catalog.revision, id: old.id, connectionRevision: 2 })
  view = await f.api.book()
  const repaired = routingDraft(view.settings); repaired.profiles.shared.model = 'new-writer-2'
  saved = await f.api.saveBook({ token: view.token, patch: compileRouting(repaired, catalog, view.settings).patch })
  assert.deepEqual(saved.settings.tasks, previousTasks)
  assert.equal(saved.settings.shared.model, 'new-writer-2')
  assert.equal(fetches, 1, 'repair and validation never refetch or probe automatically')
})

test('known non-text models are rejected by main even when sent directly as manual IDs', async t => {
  const f = await fixture(t)
  let fetches = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    fetches++
    assert.notEqual(init.method, 'POST', 'non-text generation must be rejected before HTTP')
    return Response.json({ models: [{ name: 'models/vector-model', supportedGenerationMethods: ['embedContent'] }] })
  })
  const catalog = await f.api.create({ expectedRevision: 0, name: '合成非文本接口', baseUrl: 'https://native.example.test', protocol: 'gemini-native', apiKey: 'synthetic-metadata' }), c = catalog.connections[0]
  await f.api.catalog({ id: c.id, revision: c.revision })
  await assert.rejects(f.api.test({ id: c.id, revision: c.revision, model: 'vector-model', parameterPolicy: { version: 1, mode: 'auto' } }), { code: 'VALIDATION_ERROR' })
  assert.equal(fetches, 1)
})
