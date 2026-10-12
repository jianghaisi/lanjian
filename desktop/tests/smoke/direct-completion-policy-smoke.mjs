import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-direct-native-')))
assert.equal(dirname(root), parent)
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-direct-completion-policy-entrypoints/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = [], processOutput = []
let holdNext = false, releaseResponse, app, page, projectPath
const proposal = [{ title: '个人方法事件候选', time: '次日', characters: ['资料员'], location: '档案室', event: '核对作者提供的记录', result: '等待作者审阅' }]
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); assert.equal(body.tools, undefined); assert.match(JSON.stringify(body.messages), /全局事件时间线候选任务/)
    requests.push(body); if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-direct-policy-check', 'main/index.js')
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function enterBook() {
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '时间线方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
}
async function chronicle() { await page.locator('[data-nav-parent="chronicle"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('generate-timeline-candidates').waitFor() }
async function completed() { await page.getByTestId('generate-timeline-candidates').filter({ hasText: 'AI 起草' }).waitFor(); await page.getByText('个人方法事件候选', { exact: true }).first().waitFor() }
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
    localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '时间线方法隔离验证', genre: '悬疑' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: 'AUTHOR_REQUIREMENT：仅比较事件候选。' })
    await api.workspace.saveTimeline([{ id: 'original-author-event', title: '作者原事件', time: '首日', characters: '资料员', location: '档案室', event: '保留原记录', result: '等待核对' }])
    const storage = await api.projects.sqliteStorageStatus()
    if (storage.storageMode !== 'sqlite') { const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token); const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token) }
    return { project, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  projectPath = state.project.path
  await page.reload(); await enterBook()
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('故事逐层展开'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 timeline-events.md', { exact: true }).fill('个人时间线方法：按作者提供的记录比较因果与选择，不制造正式事实，不写正文。')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /全局时间线方法/ }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-method.png') })
  const unchanged = async () => { const actual = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } }); assert.deepEqual(actual, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters }) }
  await chronicle(); await page.getByTestId('open-event-migration').waitFor(); await page.getByTestId('generate-timeline-candidates').click(); await completed()
  assert.equal(requests.length, 1); assert.match(JSON.stringify(requests[0].messages), /个人时间线方法/); assert.match(JSON.stringify(requests[0].messages), /AUTHOR_REQUIREMENT/); assert.doesNotMatch(JSON.stringify(requests[0].messages), /生成 8—16/)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.getTimeline()), state.timeline); await unchanged(); await page.screenshot({ path: join(evidence, 'legacy-candidate.png') }); mark('Actual UI edit/install/grant/select drives legacy timeline through the installed personal method without adopting events')
  await page.getByTestId('open-event-migration').click(); const panel = page.getByTestId('event-migration-panel'); await panel.waitFor()
  for (const checkbox of await panel.locator('input[type="checkbox"]').all()) await checkbox.check()
  await panel.getByRole('button', { name: '确认并切换到统一事件' }).click(); await panel.waitFor({ state: 'detached' })
  const projection = await page.evaluate(() => window.novelDesktop.events.projection()); assert.equal(projection.approved.length, 1)
  await page.getByTestId('generate-timeline-candidates').click(); await completed(); assert.equal(requests.length, 2); assert.match(JSON.stringify(requests[1].messages), /个人时间线方法/)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.events.projection()), projection); await unchanged(); await page.screenshot({ path: join(evidence, 'unified-candidate.png') }); mark('Reviewed migration and the unified timeline button consume the same installed method; raw task artifact alone creates no formal event')
  await app.close(); app = undefined; await launch(); await enterBook(); await chronicle(); assert.equal(requests.length, 2)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.events.projection()), projection); await unchanged()
  await page.getByTestId('generate-timeline-candidates').click(); await completed(); assert.equal(requests.length, 3); assert.match(JSON.stringify(requests[2].messages), /个人时间线方法/); mark('Normal native exit/relaunch sends nothing and the next explicit request retains the selected installed method')
  holdNext = true
  const pending = page.evaluate(async () => { try { await window.novelDesktop.events.generateModelCandidates({ operationId: crypto.randomUUID(), context: { title: '隔离任务', genre: '', subgenre: '', coreIdea: '', plannedVolumes: 0, chaptersPerVolume: 0, targetWordsPerChapter: 0, materials: '', worldView: '', totalOutline: '', existingEvents: '' } }); return { ok: true } } catch (error) { return { ok: false, code: error.code, message: error.message } } })
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined; assert.equal((await pending).ok, false); assert.equal(requests.length, 4)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.events.projection()), projection); await unchanged(); assert.deepEqual(errors, []); mark('Late withdrawal rejects the already sent unified result and keeps author foundation, outlines, chapters and formal events unchanged')
} catch (error) {
  let runs = []
  if (projectPath) { const db = new DatabaseSync(join(projectPath, '.webnovel', 'workspace.sqlite'), { readOnly: true }); try { runs = db.prepare("SELECT id,status,error_code,error_message,checkpoint_json FROM task_runs WHERE task_type='timeline_candidate_generation'").all() } finally { db.close() } }
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, runs }, null, 2)); throw error
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2)); await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }); server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true })
}
