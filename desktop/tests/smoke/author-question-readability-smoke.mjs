import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-author-question-native-')))
assert.ok(root.startsWith(parent + '\\'))
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-author-question-readability/research/native-final')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const team = { format: 1, members: [
  { id: 'constructor', name: '资料协调', initials: '协', color: 'unknown-safe', responsibility: '仅协调权限核对，不创作正文。', task: 'outline', capabilities: ['book.read', 'group.prepare', 'group.delegate', 'author.ask', 'assets.read', 'model.generate'], preparationKinds: ['definition'] },
  { id: 'prototype', name: '规则核对', initials: '核', color: 'blue', responsibility: '仅保存合成核对资料。', task: 'chapterOutline', capabilities: ['book.read', 'group.prepare', 'author.ask'], preparationKinds: ['world'] },
  { id: 'researcher', name: '权限审阅', initials: '审', color: 'slate', responsibility: '只读核对可用工具。', task: 'review', capabilities: ['book.read', 'manuscript.read', 'review.read'], preparationKinds: [] }
], starters: [{ id: 'sdk', label: '核对插件元数据', hint: '只核对合成资料', message: 'E1_NATIVE_METADATA_ONLY' }] }
const sdkQuestion = { questions: [{ id: 'choice', prompt: '核对合成资料标签', mode: 'single', required: true, options: [{ id: 'a', label: '标签甲' }, { id: 'b', label: '标签乙' }] }] }
const sdkSource = `export async function execute(id,input,ctx){const asset=await ctx.assets.readText({path:'notes.txt'});await ctx.book.read({kind:'context'});const model=await ctx.model.generate({instruction:'E1_NATIVE_METADATA_ONLY',draft:asset.text});await ctx.interaction.request({question:${JSON.stringify(sdkQuestion)},checkpoint:{text:asset.text+':'+model.text}});return {}} export async function resume(id,checkpoint,answer,ctx){return{text:checkpoint.text+':'+answer.answers[0].chosenOptionIds[0]}}`
const toolName = id => { const identity = `builtin.core/${id}`; return `p_${identity.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 42)}_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}` }
const requests = [], errors = [], checks = [], processOutput = []
let holdNext = false, releaseResponse, failure, app, page
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url.endsWith('/models')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: ['outline', 'chapterOutline', 'review'].map(task => ({ id: `team-${task}` })) })); return }
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw); assert.ok(['team-outline', 'team-chapterOutline', 'team-review'].includes(body.model), 'No prose model is permitted in this fixture')
    requests.push(body)
    let message = { role: 'assistant', content: '权限核对结束，原书稿未改动。' }
    const lastUser = body.messages.findLastIndex(item => item.role === 'user')
    const sdkGoal = body.messages[lastUser]?.content.includes('当前目标：E1_NATIVE_METADATA_ONLY')
    if (!body.tools) {
      assert.equal(body.model, 'team-outline'); assert.ok(body.messages.some(item => item.content?.includes('E1_NATIVE_METADATA_ONLY'))); assert.ok(body.messages.some(item => item.content?.includes('固定系统显示模板')))
      message = { role: 'assistant', content: 'E1_NATIVE_MODEL_METADATA' }
    } else if (sdkGoal) {
      const results = body.messages.slice(lastUser + 1).filter(item => item.role === 'tool')
      if (!results.length) message = { role: 'assistant', content: '', tool_calls: [{ id: 'native-sdk-discover', type: 'function', function: { name: 'discover_tools', arguments: JSON.stringify({ query: 'E1_NATIVE_SDK' }) } }] }
      else if (results.length === 1) { const tool = body.tools.find(tool => tool.function.description.includes('E1_NATIVE_SDK')); assert.ok(tool); message = { role: 'assistant', content: '', tool_calls: [{ id: 'native-sdk-call', type: 'function', function: { name: tool.function.name, arguments: '{}' } }] } }
      else { assert.equal(JSON.parse(results.at(-1).content).value.text, 'E1_NATIVE_ASSET:E1_NATIVE_MODEL_METADATA:a'); message = { role: 'assistant', content: 'E1_NATIVE_TOOL_FINISHED' } }
    } else if (holdNext) { holdNext = false; await new Promise(resolve => { releaseResponse = resolve }) }
    else if (!body.messages.some(message => message.role === 'tool')) {
      const id = body.model === 'team-outline' ? 'delegate_to_member' : body.model === 'team-chapterOutline' ? 'save_preparation_candidate' : 'read_book_context'
      const args = body.model === 'team-outline' ? { memberId: 'prototype', instruction: '核对合成权限资料。' } : body.model === 'team-chapterOutline' ? { kind: 'world', title: '合成权限核对', content: '这是一项权限核对的测试记录，尚未采用。' } : {}
      assert.ok(body.tools.some(tool => tool.function.name === toolName(id)))
      message = { role: 'assistant', content: '', tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name: toolName(id), arguments: JSON.stringify(args) } }] }
    }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-author-question-check', 'main/index.js'), buildHash = createHash('sha256').update(await readFile(build)).digest('hex')
const mark = text => { checks.push(text); console.log(text) }
async function closeFixture() {
  if (!app) return
  const own = app; let timer
  try { await Promise.race([own.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Isolated team fixture shutdown timed out')), 8000) })]) }
  catch (error) { const process = own.process(); if (process.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true }).catch(() => process.kill()); throw error }
  finally { clearTimeout(timer); app = undefined }
}
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', value => processOutput.push(String(value))); app.process().stderr?.on('data', value => processOutput.push(String(value)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.groupChat))
}
async function enter() {
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '团队插件隔离核对' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
}
const idle = async () => page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' })
async function group() { await page.getByTestId('group-chat-tab').click(); await page.getByTestId('group-chat-workspace').waitFor(); await page.locator('.group-member-list button').first().waitFor() }
async function waitIdle(sessionId, message) { return page.evaluate(async ({ sessionId, message }) => { for (let i = 0; i < 600; i++) { const value = await window.novelDesktop.groupChat.get({ sessionId, limit: 100 }); if (value.messages.some(item => item.role === 'user' && item.content === message) && value.status !== 'running') return value; await new Promise(resolve => setTimeout(resolve, 100)) }; throw Error(`Team conversation timed out: ${document.querySelector('.group-error')?.textContent || ''}`) }, { sessionId, message }) }
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true'); await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
      const api = window.novelDesktop, list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '团队隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
      const connection = made.connections.find(c => c.name === '团队隔离验证'), defaults = await api.modelConnections.defaults(), profile = task => ({ connectionId: 'team-model', model: `team-${task}`, temperature: .6, topP: 1, maxTokens: 8192 })
      await api.modelConnections.saveDefaults({ expectedRevision: defaults.revision, expectedCatalogRevision: made.revision, template: { version: 4, references: [{ kind: 'global', id: 'team-model', globalConnectionId: connection.id }], routingMode: 'perTask', shared: profile('outline'), tasks: Object.fromEntries(['outline', 'chapterOutline', 'prose', 'review'].map(task => [task, profile(task)])) } })
      const { project } = await api.projects.create({ parentPath: books, name: '团队插件隔离核对', genre: '悬疑' }); await api.chapters.create()
      if ((await api.projects.sqliteStorageStatus()).storageMode !== 'sqlite') { const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token); const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token) }
      return { project, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await enter(); await group()
  assert.equal(await page.locator('.group-member-list button').count(), 7); assert.equal(requests.length, 0)
  const original = (await page.evaluate(() => window.novelDesktop.groupChat.list())).find(s => s.book?.id === state.project.id)
  await page.locator('[data-nav-parent="settings"]').click(); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library'); await library.getByLabel('本地插件关键词').fill('创作团队'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /创作团队/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click(); await editor.getByLabel('插件源文件 team.json', { exact: true }).fill(JSON.stringify(team, null, 2))
  await editor.getByText('高级清单 · 工具、能力与贡献', { exact: true }).click()
  const manifest = JSON.parse(await editor.getByLabel('插件清单', { exact: true }).inputValue())
  manifest.capabilities = ['book.read', 'assets.read', 'model.generate', 'author.ask']
  manifest.tools = [{ id: 'inspect', description: 'E1_NATIVE_SDK 元数据核对', effect: 'derive', capabilities: manifest.capabilities, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 20000 } }, required: ['text'], additionalProperties: false } }]
  await editor.getByLabel('插件清单', { exact: true }).fill(JSON.stringify(manifest, null, 2))
  await editor.getByLabel('插件源文件 main.js', { exact: true }).fill(sdkSource)
  await editor.getByLabel('插件源文件 group-orchestration.md', { exact: true }).fill('E1_NATIVE_ORCHESTRATION')
  await editor.getByLabel('附带资料文件名', { exact: true }).fill('notes.txt'); await editor.getByRole('button', { name: '添加资料文件', exact: true }).click()
  await editor.getByLabel('插件源文件 notes.txt', { exact: true }).fill('E1_NATIVE_ASSET')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor(); await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(plugin => plugin.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); for (const input of await page.locator('.plugin-grant input').all()) await input.check(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /^创作团队 / }).check(); await composition.getByRole('checkbox', { name: /群聊总调度方法/ }).check(); await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await group(); assert.equal(await page.locator('.group-member-list button').count(), 7)
  await page.getByTestId('new-group-discussion').click(); await page.waitForFunction(() => document.querySelectorAll('.group-member-list button').length === 3)
  let current = (await page.evaluate(() => window.novelDesktop.groupChat.list())).find(session => session.id !== original.id && session.book?.id === state.project.id)
  assert.deepEqual(current.team, team); assert.equal(requests.length, 0)
  await page.getByTestId('group-starter-sdk').click(); assert.equal(await page.locator('.group-composer textarea').inputValue(), 'E1_NATIVE_METADATA_ONLY'); assert.equal(requests.length, 0)
  await page.getByRole('button', { name: '资料协调成员设置', exact: true }).click(); await page.getByRole('heading', { name: '资料协调', exact: true }).waitFor(); assert.ok((await page.getByRole('region', { name: '成员设置', exact: true }).textContent()).includes(team.members[0].responsibility)); await page.getByRole('button', { name: '关闭成员设置', exact: true }).click()
  await page.screenshot({ path: join(evidence, 'three-members.png') })
  mark('Actual Electron UI derives, edits, builds, installs, grants and selects a three-member team; existing discussion keeps seven and explicit new discussion/settings use the original plugin metadata without inference')
  await page.locator('.group-composer textarea').fill('只核对成员职责与权限，不生成正文。'); await page.getByTestId('group-send').click(); current = await waitIdle(current.id, '只核对成员职责与权限，不生成正文。')
  assert.equal(current.status, 'idle', current.notice); assert.equal(current.candidates.length, 1); assert.equal(current.candidates[0].memberId, 'prototype'); assert.deepEqual(requests.map(request => request.model), ['team-outline', 'team-outline', 'team-chapterOutline', 'team-chapterOutline'])
  assert.ok(requests[0].tools.some(tool => tool.function.name === toolName('delegate_to_member'))); assert.ok(!requests[2].tools.some(tool => tool.function.name === toolName('delegate_to_member')))
  mark('Actual task-specific model transport delegates to the custom member ID and saves a proposed synthetic candidate with the original finite tool intersection')
  const selectedId = current.id
  await page.evaluate(async () => { const api = window.novelDesktop.writingPlugins, view = await api.list(true), preview = await api.previewComposition({ bookToken: view.book.token, revision: view.revision, entries: [] }); await api.applyComposition(preview.planId) })
  await closeFixture(); await launch(); await enter(); await group(); assert.equal(requests.length, 4); assert.equal(await page.locator('.group-member-list button').count(), 3)
  current = await page.evaluate(id => window.novelDesktop.groupChat.get({ sessionId: id, limit: 100 }), selectedId); assert.deepEqual(current.team, team); assert.equal(current.candidates.length, 1)
  mark('Normal exit/relaunch with current composition cleared restores the original three-member team and candidate with zero resend')
  const sdkStart = requests.length
  await page.locator('.group-composer select').selectOption('constructor'); await page.locator('.group-composer textarea').fill('E1_NATIVE_METADATA_ONLY'); await page.getByTestId('group-send').click(); current = await waitIdle(selectedId, 'E1_NATIVE_METADATA_ONLY')
  assert.equal(current.status, 'waiting-input', current.notice); assert.equal(requests.length, sdkStart + 3); assert.equal(current.question.pluginId, personal.id)
  assert.ok(requests[sdkStart].messages[0].content.includes('E1_NATIVE_ORCHESTRATION')); assert.ok(!requests[sdkStart].messages[0].content.includes('一次目标不必每人发言'))
  const questionCard = page.getByTestId('author-question-card')
  await questionCard.waitFor()
  assert.equal(await questionCard.locator('.author-question-source').innerText(), '创作插件 · 作者交互')
  const details = questionCard.getByTestId('author-question-source-details')
  assert.equal(await details.getAttribute('open'), null)
  assert.equal(await details.locator('pre').isVisible(), false)
  await page.screenshot({ path: join(evidence, 'sdk-waiting.png') })
  await details.locator('summary').focus(); await details.locator('summary').press('Enter')
  await details.locator('pre').waitFor({ state: 'visible' })
  assert.equal(await details.locator('pre').innerText(), `插件：${current.question.pluginId}\n工具：${current.question.toolId}`)
  await page.screenshot({ path: join(evidence, 'source-details.png') })
  await details.locator('summary').press('Enter')
  assert.equal(await details.locator('pre').isVisible(), false)
  mark('Actual question card displays a truthful source type; original plugin/tool IDs are collapsed by default and keyboard-accessible in source details')
  await closeFixture(); await launch(); await enter(); await group(); assert.equal(requests.length, sdkStart + 3)
  await page.getByTestId('author-question-card').getByLabel('标签甲', { exact: true }).check(); await page.getByTestId('submit-author-answer').click()
  current = await page.evaluate(async id => { for(let i=0;i<600;i++){const s=await window.novelDesktop.groupChat.get({sessionId:id,limit:100});if(s.status==='idle'&&s.messages.some(m=>m.content==='E1_NATIVE_TOOL_FINISHED'))return s;await new Promise(r=>setTimeout(r,100))}throw Error('Original SDK answer did not finish') },selectedId)
  assert.equal(requests.length, sdkStart + 4); assert.equal(current.candidates.length,1)
  await page.waitForFunction(() => document.querySelector('.group-thread-header')?.textContent.includes('团队就绪'))
  assert.equal(await page.locator('.group-stop').count(),0); assert.equal(await page.getByTestId('author-question-card').count(),0)
  const readableAnswer = '核对合成资料标签\n标签甲'
  const visibleAnswer = current.messages.filter(message => message.role === 'user' && message.content === readableAnswer)
  assert.equal(visibleAnswer.length, 1)
  const answerId = visibleAnswer[0].id
  await page.locator(`[data-message-id="${answerId}"]`).waitFor()
  assert.ok((await page.locator(`[data-message-id="${answerId}"]`).innerText()).includes('标签甲'))
  await page.screenshot({ path: join(evidence, 'sdk-resumed.png') })
  await closeFixture(); await launch(); await enter(); await group()
  assert.equal(requests.length, sdkStart + 4)
  const persisted = await page.evaluate(id => window.novelDesktop.groupChat.get({ sessionId: id, limit: 100 }), selectedId)
  assert.equal(persisted.messages.filter(message => message.role === 'user' && message.content === readableAnswer).length, 1)
  await page.locator(`[data-message-id="${answerId}"]`).waitFor()
  assert.ok((await page.locator(`[data-message-id="${answerId}"]`).innerText()).includes('标签甲'))
  await page.screenshot({ path: join(evidence, 'readable-restarted.png') })
  mark('Actual UI submits the original choice ID to the SDK while recording the original question and label; normal restart retains one readable answer and makes zero resend')
  mark('Real utility-process SDK reads declared asset and original book, calls the same member model, saves its author checkpoint, resumes after normal app restart with zero resend and settles the original native envelope once')
  const reviewerFirst = requests.length
  await page.locator('.group-composer select').selectOption('researcher'); await page.locator('.group-composer textarea').fill('只读取当前书已保存依据。'); await page.getByTestId('group-send').click(); current = await waitIdle(selectedId, '只读取当前书已保存依据。')
  assert.equal(current.status, 'idle', current.notice); assert.deepEqual(requests.slice(reviewerFirst).map(request => request.model), ['team-review', 'team-review']); assert.ok(!requests[reviewerFirst].tools.some(tool => tool.function.name === toolName('save_preparation_candidate')))
  const beforeHold = requests.length
  holdNext = true; await page.locator('.group-composer textarea').fill('仅核对撤权窗口。'); await page.getByTestId('group-send').click()
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(releaseResponse)
  const published = current.messages.filter(message => message.role === 'agent').length
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(true); await api.setBookEnabled({ id, revision: view.revision, bookToken: view.book.token, enabled: false }) }, personal.id)
  releaseResponse(); releaseResponse = undefined; current = await waitIdle(selectedId, '仅核对撤权窗口。')
  assert.equal(current.messages.filter(message => message.role === 'agent').length, published); assert.equal(requests.length, beforeHold + 1)
  const formal = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } })
  assert.deepEqual(formal, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters }); assert.ok(formal.chapters.every(chapter => !chapter.content)); assert.deepEqual(errors, [])
  await page.locator('.group-attention').waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('.group-thread-header')?.textContent.includes('执行中断'))
  assert.equal(await page.locator('.group-stop').count(), 0)
  await page.screenshot({ path: join(evidence, 'withdrawn-original-team.png') })
  mark('Original-team read-only member uses the real book context tool; withdrawal blocks late publication while original candidates and formal database/empty manuscript remain intact, with no outline confirmation')
} catch (error) { failure = { message: error.message, stack: error.stack }; await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); throw error }
finally {
  releaseResponse?.(); await closeFixture().catch(error => { errors.push(error.message) }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requests: requests.map(request => ({ model: request.model, toolNames: request.tools?.map(tool => tool.function.name) })), buildHash, failure }, null, 2)); await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + '\\')); await rm(root, { recursive: true, force: true })
}
