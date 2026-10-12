import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'
import JSZip from 'jszip'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-plugin-management-')))
const userData = join(root, 'app'), books = join(root, 'books')
await Promise.all([mkdir(userData), mkdir(books)])
const evidence = resolve(process.env.LANJIAN_PLUGIN_EVIDENCE_DIR || '../.trellis/tasks/09-18-v3-custom-code-plugins/research')
await mkdir(evidence, { recursive: true })
const errors = [], checks = []
let target = 'personal.chapter-rhythm', models = 0, app, page
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw), reply = message => response.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))
    response.setHeader('Content-Type', 'application/json')
    if (!body.tools) { models++; assert.match(body.messages.map(m => m.content).join('\n'), /境界|审阅/); reply({ role: 'assistant', content: '仙侠审阅：核对境界突破的代价与事件因果。' }); return }
    const results = body.messages.filter(m => m.role === 'tool')
    const call = (name, args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `call-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    if (!results.length) { call('discover_tools', { query: target }); return }
    if (results.length === 1) { const tool = body.tools.find(t => t.function.name.includes(target.replaceAll('.', '_').replaceAll('-', '_'))); assert.ok(tool); call(tool.function.name, { text: '月光落在山门。\n\n他收起剑，等待师父的回答。' }); return }
    reply({ role: 'assistant', content: JSON.parse(results.at(-1).content).text })
  } catch (error) { errors.push(String(error)); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const watchdog = setTimeout(() => { errors.push('Smoke timeout'); void app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }, 240000); watchdog.unref()
async function pack(name, version) {
  const source = resolve('examples/writing-plugins', name), m = JSON.parse(await readFile(join(source, 'lanjian-plugin.json'), 'utf8'))
  if (version) { m.version = version; m.description = '新版节奏诊断，可按授权读取作品背景。'; m.capabilities.push('book.read') }
  const zip = new JSZip().file('lanjian-plugin.json', JSON.stringify(m))
  for (const file of [m.entry, ...m.assets ?? []]) zip.file(file, await readFile(join(source, file)))
  const path = join(root, `${name}-${m.version}.zip`); await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' })); return path
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function install(path) {
  // Stub only the operating-system picker in this isolated Electron test. The
  // renderer still uses the production named IPC, ZIP validator and store.
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await page.getByTestId('plugin-choose').click(); await page.getByTestId('plugin-preview').waitFor()
  await page.getByTestId('plugin-install').click(); await idle()
  assert.equal(await page.getByRole('alert').count(), 0)
}
const row = id => page.locator(`[data-plugin-id="${id}"]`)
async function authorize(id) {
  await row(id).getByRole('button', { name: '版本与权限' }).click()
  for (const box of await row(id).locator('input[type="checkbox"]:enabled').all()) await box.check()
  await row(id).getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row(id).getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
}
async function until(id, status) {
  for (let i = 0; i < 500; i++) {
    const view = await page.evaluate(id => window.novelDesktop.fieldAssistant.runs.status(id), id)
    if (view.status === status) return view
    assert.notEqual(view.status, 'failed', view.message)
    await new Promise(r => setTimeout(r, 60))
  }
  assert.fail('Run did not reach ' + status)
}
async function start(bookId, operationId) { return page.evaluate(input => window.novelDesktop.fieldAssistant.runs.start(input), { operationId, workItemId: bookId, page: 'world', message: `使用 ${target} 审阅`, targets: [], chapterId: null, selectedCharacters: 0, history: [] }) }
async function answer(view, id, option) {
  await page.evaluate(input => window.novelDesktop.fieldAssistant.runs.answer(input), { runId: view.id, questionId: view.question.id, questionVersion: view.question.version, answerSubmissionId: id, answers: [{ id: view.question.questions[0].id, chosenOptionIds: [option], customText: '', skipped: false }] })
}
try {
  app = await _electron.launch({ args: [resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-custom-code-check', 'main/index.js'), '--disable-gpu'], env })
  page = await app.firstWindow(); page.setDefaultTimeout(30000); await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
  await page.evaluate(async () => { localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true'); await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } }) })
  const project = await page.evaluate(async ({ books, baseUrl }) => {
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '插件验收原书', genre: '仙侠' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '隔离插件模型', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-plugin-key' })
    const connection = made.connections.find(c => c.name === '隔离插件模型'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'plugin-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'plugin-model', model: 'plugin-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    return project
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: project.title }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter')
  await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  await install(await pack('chapter-rhythm'))
  assert.match(await row(target).innerText(), /未启用/)
  await row(target).locator('.plugin-editor').waitFor()
  assert.equal(await row(target).evaluate(el => el === document.activeElement), true)
  assert.equal(await row(target).getByLabel('向作者提问').isChecked(), false)
  await authorize(target); checks.push('Native picker → validated preview → disabled install → explicit permission → book selection')
  const first = await start(project.id, 'management-code'), waiting = await until(first.id, 'waiting-input')
  await page.getByRole('button', { name: '我创建的', exact: true }).click()
  await page.getByLabel('查找插件', { exact: true }).fill('不会匹配的旧筛选')
  assert.equal(await row(target).count(), 0)
  await install(await pack('chapter-rhythm', '2.0.0'))
  assert.equal(await page.getByLabel('查找插件', { exact: true }).inputValue(), '')
  assert.equal(await page.getByRole('button', { name: '全部已安装', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await row(target).evaluate(el => el === document.activeElement), true)
  assert.equal(await row(target).locator('select option:checked').innerText(), '2.0.0')
  assert.match(await row(target).getByLabel('版本切换核对').innerText(), /当前 1.0.0 → 待切换 2.0.0/)
  assert.match(await row(target).getByLabel('版本切换核对').innerText(), /新版节奏诊断/)
  assert.match(await row(target).locator('.plugin-grant').filter({ hasText: '读取作品背景与素材' }).innerText(), /新增权限/)
  assert.equal(await row(target).getByLabel('向作者提问').isChecked(), false)
  assert.equal(await row(target).getByLabel('读取作品背景与素材').isChecked(), false)
  const pending = await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))
  assert.equal(pending.plugins[0].versions.find(v => v.digest === pending.plugins[0].current).manifest.version, '1.0.0')
  assert.equal(pending.plugins[0].enabled, true); assert.equal(pending.plugins[0].bookEnabled, true)
  assert.deepEqual(pending.plugins[0].versions.find(v => v.manifest.version === '2.0.0').grants, [])
  await page.screenshot({ path: join(evidence, 'version-review-light.png') })
  await row(target).getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins, pending.plugins)
  checks.push('Installing under stale filters focuses exact new version; preview and cancellation preserve current version, grants, enablement and book membership')
  await row(target).getByRole('button', { name: '版本与权限' }).click()
  await row(target).locator('select').selectOption({ label: '2.0.0' })
  const nativeWindow = await app.browserWindow(page)
  const compact = await nativeWindow.evaluate(async w => { w.unmaximize(); for (let n=0; n<20 && w.isMaximized(); n++) await new Promise(r => setTimeout(r, 100)); const [mw,mh]=w.getMinimumSize(); w.setSize(Math.max(mw,1100),Math.max(mh,800)); return Math.max(mw,1100) })
  await page.waitForFunction(width => innerWidth <= width, compact)
  await row(target).locator('.plugin-editor').scrollIntoViewIfNeeded()
  assert.equal(await row(target).evaluate(el => { for (let n=el; n; n=n.parentElement) if (n.scrollWidth > n.clientWidth + 1) return false; return true }), true)
  await page.screenshot({ path: join(evidence, 'version-review-compact.png') })
  await row(target).getByLabel('向作者提问').check()
  await row(target).getByRole('button', { name: '确认切换版本' }).click(); await idle()
  await answer(waiting, 'management-code-answer', 'tense'); await until(first.id, 'completed')
  await row(target).getByRole('button', { name: '版本与权限' }).click(); await row(target).locator('select').selectOption({ label: '1.0.0' })
  await row(target).getByRole('button', { name: '确认切换版本' }).click(); await idle()
  checks.push('UI update adds no grant; pinned waiting code resumes; UI rollback retains both versions')
  await page.getByTestId('settings-category-common').click(); await page.getByTestId('settings-nav-appearance').click(); await page.getByTestId('theme-moye').check()
  await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle(); await page.getByTestId('plugins-nav-installed').click()
  await row(target).getByRole('button', { name: '版本与权限' }).click(); await row(target).locator('select').selectOption({ label: '2.0.0' })
  assert.equal(await row(target).getByLabel('向作者提问').isChecked(), true, 'Previously authorized version retains its own saved grants')
  assert.equal(await row(target).getByLabel('读取作品背景与素材').isChecked(), false)
  await row(target).locator('.plugin-editor').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'version-review-dark.png') })
  await row(target).getByRole('button', { name: '取消', exact: true }).click(); await row(target).getByRole('button', { name: '停用插件', exact: true }).click(); await idle()
  await row(target).getByRole('button', { name: '版本与权限' }).click(); await row(target).locator('select').selectOption({ label: '2.0.0' })
  assert.match(await row(target).getByLabel('版本切换核对').innerText(), /插件尚未启用/)
  await row(target).getByRole('button', { name: '确认切换版本' }).click(); await idle()
  assert.match(await page.getByTestId('writing-plugin-settings').innerText(), /插件仍未启用/)
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins[0].enabled, false)
  checks.push('Saved grants are specific to each version; switching a disabled plugin remains disabled; compact/light/dark version review is rendered')
  target = 'personal.genre-review'; await install(await pack('genre-review')); await authorize(target)
  const second = await start(project.id, 'management-recipe'), question = await until(second.id, 'waiting-input')
  await answer(question, 'management-recipe-answer', 'realm'); await until(second.id, 'completed'); assert.equal(models, 1)
  checks.push('Declarative example: discover → author question → fresh guest → packaged asset → original book model')
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }))
  const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')).webContents.getZoomFactor())
  await page.getByTestId('writing-plugin-settings').screenshot({ path: join(evidence, 'management-ui.png') })
  await page.screenshot({ path: join(evidence, 'management-ui-window.png') })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')); const [width,height]=w.getMinimumSize(); w.setSize(Math.max(width,1100),Math.max(height,800)) })
  await page.waitForTimeout(300)
  assert.equal(await page.getByTestId('writing-plugin-settings').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
  await page.getByTestId('writing-plugin-settings').screenshot({ path: join(evidence, 'management-ui-compact.png') })
  checks.push('Rendered settings at default and compact supported window sizes without horizontal overflow')
  const third = await start(project.id, 'management-revoke'); await until(third.id, 'waiting-input')
  await row(target).getByRole('button', { name: '取消本书使用' }).click(); await idle(); await until(third.id, 'cancelled')
  checks.push('UI per-book revocation cancels a real waiting recipe run')
  await row(target).getByRole('button', { name: '卸载', exact: true }).click(); await row(target).getByRole('button', { name: '确认卸载' }).click(); await idle()
  assert.equal(await row(target).count(), 0)
  const data = await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))
  assert.equal(data.plugins.length, 1); assert.equal(data.plugins[0].versions.length, 2)
  assert.ok(!JSON.stringify(data).includes(userData)); assert.ok(!JSON.stringify(data).includes(books))
  checks.push('UI uninstall removes only chosen plugin; management projection contains no physical paths')
  await app.close(); app = await _electron.launch({ args: [resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-custom-code-check', 'main/index.js'), '--disable-gpu'], env })
  page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
  const restored = await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))
  assert.equal(restored.plugins.length, 1); assert.equal(restored.plugins[0].versions.length, 2); assert.equal(restored.plugins[0].bookEnabled, true)
  checks.push('Normal application restart preserves selected book and installed versions')
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'management-smoke.json'), JSON.stringify({ ok: true, checks, viewport, zoom, modelCalls: models, errors }, null, 2))
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'management-ui-failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'management-smoke-failure.json'), JSON.stringify({ ok: false, error: String(error), checks, errors }, null, 2)); throw error
} finally {
  clearTimeout(watchdog); await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise(r => server.close(r))
  const checked = await realpath(root)
  if (dirname(checked) !== parent || !basename(checked).startsWith('lanjian-plugin-management-')) throw new Error('Refusing cleanup outside owned temp profile')
  await rm(checked, { recursive: true, force: true })
}
