import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { AssistantRunStore } from '../../src/main/modules/assistant/adapters/assistant-run-store'

// Real built main/preload + real utility process + real domain task. Installation
// is seeded through the application manager; the management UI is a separate gate.
const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-sdk-smoke-')))
const userData = join(root, 'app'), books = join(root, 'books')
await Promise.all([mkdir(userData), mkdir(books)])
const manager = new WritingPluginManager(new PluginPackageStore(userData), async () => {})
const history = new AssistantRunStore(userData), pluginId = 'test.native-sdk'
let entered!: () => void, release!: () => void, modelCalls = 0
const began = new Promise<void>(r => { entered = r }), hold = new Promise<void>(r => { release = r })
const failures: Error[] = []
const smokeStarted = Date.now(), stage = (name: string) => console.log(JSON.stringify({ stage: name, elapsedMs: Date.now() - smokeStarted }))
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw), reply = (message: unknown) => response.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))
    response.setHeader('Content-Type', 'application/json')
    if (!body.tools) {
      modelCalls++
      const text = body.messages.map((m: { content: string }) => m.content).join('\n')
      assert.match(text, /SDK_ONLY/); assert.match(text, /固定系统模板_A/); assert.doesNotMatch(text, /另一部B/)
      assert.equal(body.model, 'sdk-smoke-model'); entered(); await hold
      reply({ role: 'assistant', content: '原书模型建议' }); return
    }
    const results = body.messages.filter((m: { role: string }) => m.role === 'tool')
    const call = (name: string, args: unknown) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `call-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    if (!results.length) { call('discover_tools', { query: pluginId }); return }
    if (results.length === 1) {
      const tool = body.tools.find((t: { function: { name: string } }) => t.function.name.includes('test_native_sdk'))
      assert.ok(tool); call(tool.function.name, { chapterId: 1 }); return
    }
    const result = JSON.parse(results.at(-1).content)
    assert.match(result.text, /original-v1.*原书设想A.*warm/s)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-sdk-key|另一部B/)
    reply({ role: 'assistant', content: JSON.stringify(result) })
  } catch (error) { failures.push(error as Error); response.statusCode = 500; response.end(JSON.stringify({ error: { message: 'fixture assertion failed' } })) }
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const env: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string' && !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL') env[key] = value
env.LANJIAN_USER_DATA_PATH = userData
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const entry = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-custom-code-check', 'main/index.js')
let app: ElectronApplication | undefined
let activeBook = ''
const watchdog = setTimeout(() => {
  failures.push(Error('native SDK smoke exceeded its 180-second deadline'))
  release(); server.closeAllConnections()
  // Timeout fallback is limited to this test's own temporary-profile process.
  void app?.evaluate(({ app }) => { app.exit(2) }).catch(() => {})
}, 180000)
watchdog.unref()
async function launch() {
  app = await _electron.launch({ args: [entry, '--disable-gpu'], env })
  const page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.fieldAssistant.runs), undefined, { timeout: 20000 })
  await page.evaluate(async () => { await window.companionSettings!.update({ voice: { mute: true, textModel: false, preload: false } }) })
  stage('launched-with-optional-models-off')
  return page
}
async function until(page: Page, id: string, status: string) {
  for (let i = 0; i < 400; i++) {
    const view = await page.evaluate(id => window.novelDesktop!.fieldAssistant.runs!.status(id), id)
    if (view.status === status) return view
    assert.notEqual(view.status, 'failed', view.message)
    await new Promise(r => setTimeout(r, 50))
  }
  assert.fail('run did not reach ' + status)
}
const question = { questions: [{ id: 'tone', prompt: '选择故事方向', mode: 'single', required: true, options: [{ id: 'warm', label: '温暖' }, { id: 'dark', label: '悬疑' }] }] }
const source = `export async function execute(id,input,ctx){
  const chapter=await ctx.book.read({kind:'manuscript',chapterId:input.chapterId});
  const suggestion=await ctx.model.generate({instruction:'SDK_ONLY',draft:chapter.content});
  const book=await ctx.book.read({kind:'context'});
  await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{chapterId:chapter.chapterId,revision:chapter.revision,book:book.context,suggestion:suggestion.text}});return {};
}
export async function resume(id,checkpoint,answer,ctx){
  const request={kind:'manuscript',key:'chapter',input:{chapterId:checkpoint.chapterId,expectedRevision:checkpoint.revision,instruction:'继续写作'}};
  const candidate=await ctx.candidate.prepare(request), duplicate=await ctx.candidate.prepare(request);
  if(candidate.taskId!==duplicate.taskId)throw Error('duplicate');
  return {text:'original-v1 '+checkpoint.book+' '+answer.answers[0].chosenOptionIds[0],taskId:candidate.taskId};
}`
async function install(bookId: string, version = '1.0.0') {
  const caps = ['book.read', 'manuscript.read', 'manuscript.candidate', 'model.generate', 'author.ask']
  const output = { type: 'object', additionalProperties: false, properties: { text: { type: 'string', maxLength: 20000 }, taskId: { type: 'string', maxLength: 200 } }, required: ['text', 'taskId'] }
  const manifest = { apiVersion: 1, id: pluginId, name: '原生 SDK 验收', version, description: '隔离夹具', runtime: 'quickjs-js', entry: 'main.js', capabilities: caps, tools: [{ id: 'analyze', description: '读取并按选择创作', effect: 'candidate', capabilities: caps, inputSchema: { type: 'object', additionalProperties: false, properties: { chapterId: { type: 'integer', minimum: 1 } }, required: ['chapterId'] }, outputSchema: output }] }
  const path = join(root, version + '.zip')
  await writeFile(path, await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', version === '1.0.0' ? source : 'export function execute(){throw Error("new version must not run")}').generateAsync({ type: 'nodebuffer' }))
  let index = await manager.install((await manager.preview(manager.chooseNativeFile(path))).planId)
  const installed = index.plugins[0].versions.find(v => v.manifest.version === version)!
  index = await manager.selectVersion(pluginId, installed.digest, caps, index.revision)
  index = await manager.setEnabled(pluginId, true, caps, index.revision)
  await manager.setBookEnabled(bookId, pluginId, true, index.revision)
  return installed.digest
}
try {
  let page = await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    const api = window.novelDesktop!, { project } = await api.projects.create({ parentPath: books, name: '原书A', genre: '仙侠' })
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: 'SDK 隔离接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-sdk-key' })
    const connection = created.connections.find(item => item.name === 'SDK 隔离接口')!, edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'sdk-smoke-model', temperature: .6, topP: 1, maxTokens: 8192 } } })
    await api.workspace.saveBookProfile({ ...await api.workspace.getBookProfile(), coreIdea: '原书设想A' })
    await api.workspace.saveSystemTemplate('固定系统模板_A：属性、技能、任务')
    const chapter = await api.chapters.create(); await api.chapters.update(chapter.id, { content: '原书A的正式正文。', title: '雨夜' })
    return { project, chapterId: chapter.id }
  }, { books, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` })
  activeBook = state.project.id
  const pin = await install(state.project.id)
  stage('configured-and-installed')
  const start = await page.evaluate(input => window.novelDesktop!.fieldAssistant.runs!.start(input), { operationId: 'sdk-native-run', workItemId: state.project.id, page: 'world', message: '使用插件', targets: [], chapterId: null, selectedCharacters: 0, history: [] })
  await Promise.race([began, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('SDK model was not reached')), 60000); timer.unref() })])
  await page.evaluate(async books => { await window.novelDesktop!.projects.create({ parentPath: books, name: '另一部B', genre: '悬疑' }) }, books)
  release()
  stage('switched-book-after-sdk-model')
  for (let i = 0; i < 400; i++) { if ((await history.read(state.project.id))[0].view.status === 'waiting-input') break; await new Promise(r => setTimeout(r, 50)) }
  assert.equal((await history.read(state.project.id))[0].view.status, 'waiting-input')
  assert.equal(await app!.evaluate(({ app }) => app.getAppMetrics().filter(m => m.name === 'Writing plugin guest').length), 0, 'waiting releases the utility process')
  await page.evaluate(path => window.novelDesktop!.projects.switch(path), state.project.path)
  const waiting = await until(page, start.id, 'waiting-input')
  stage('waiting-and-released-guest')
  await install(state.project.id, '2.0.0')
  await app!.close(); app = undefined; page = await launch()
  await page.evaluate(path => window.novelDesktop!.projects.switch(path), state.project.path)
  const recovered = await page.evaluate(id => window.novelDesktop!.fieldAssistant.runs!.status(id), start.id)
  assert.equal(recovered.needsResume, true)
  await page.evaluate(input => window.novelDesktop!.fieldAssistant.runs!.resume(input), { runId: start.id, expectedRevision: recovered.revision, context: { page: 'world', targets: [], chapterId: null, selectedCharacters: 0 } })
  const submission = { runId: start.id, questionId: waiting.question!.id, questionVersion: waiting.question!.version, answerSubmissionId: 'native-answer', answers: [{ id: 'tone', chosenOptionIds: ['warm'], customText: '', skipped: false }] }
  const receipts = await page.evaluate(async input => Promise.all([window.novelDesktop!.fieldAssistant.runs!.answer(input), window.novelDesktop!.fieldAssistant.runs!.answer(input)]), submission)
  assert.deepEqual(receipts[0], receipts[1])
  stage('answered-after-restart')
  await until(page, start.id, 'completed')
  stage('completed')
  const record = (await history.read(state.project.id))[0], candidate = record.plugins!.effects[0].value as { taskId: string }
  assert.equal(record.plugins!.pins[0].digest, pin); assert.equal(record.plugins!.effects.length, 1)
  const guestResult = record.messages.find(m => m.role === 'tool' && m.tool_call_id === 'call-1')!.content!
  assert.equal(guestResult.includes(state.project.path), false); assert.equal(guestResult.includes(userData), false)
  assert.equal(record.messages.filter(m => m.role === 'tool' && m.tool_call_id === 'call-1').length, 1)
  let task = await page.evaluate(id => window.novelDesktop!.ai.writingAgentTask(id), candidate.taskId)
  for (let i = 0; i < 400 && task.status !== 'failed'; i++) { await new Promise(r => setTimeout(r, 50)); task = await page.evaluate(id => window.novelDesktop!.ai.writingAgentTask(id), candidate.taskId) }
  assert.equal(task.status, 'failed', 'actual domain task must enforce missing approved outlines')
  assert.equal(task.workItemId, state.project.id)
  assert.equal(await page.evaluate(id => window.novelDesktop!.chapters.get(id).then(c => c.content), state.chapterId), '原书A的正式正文。')
  assert.equal(modelCalls, 1); assert.deepEqual(failures, [])
  console.log(JSON.stringify({ ok: true, checks: ['installed discovery and native QuickJS process', 'frozen original model and fixed system template', 'A-to-B navigation during SDK call', 'wait releases native process', 'normal restart and pinned old version resume', 'duplicate answer and candidate receipt deduplication', 'real manuscript domain gate preserves formal text'], liveProviders: false, managementUi: false }, null, 2))
} catch (error) {
  const records = activeBook ? await history.read(activeBook).catch(() => []) : []
  console.error(JSON.stringify({ failure: String(error), providerErrors: failures.map(e => e.message), runs: records.map(r => ({ status: r.view.status, message: r.view.message, intent: r.intent, budget: r.dispatcher.budget })) }))
  throw error
} finally {
  clearTimeout(watchdog)
  release()
  if (app) await app.close()
  await new Promise<void>(r => server.close(() => r()))
  const target = await realpath(root)
  assert.equal(dirname(target), parent); assert.ok(basename(target).startsWith('lanjian-sdk-smoke-'))
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
