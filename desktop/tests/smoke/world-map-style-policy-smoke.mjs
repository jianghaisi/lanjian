import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Existing registered image and static source only; no new fiction or outline approval.
const image = await readFile(resolve('src/renderer/assets/visuals/background-industrial-city.png'))
const hash = createHash('sha256').update(image).digest('hex')
const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-map-native-')))
assert.equal(dirname(root), parent)
const userData = join(root, 'app'), books = join(root, 'books'), source = join(root, '静态原材料.txt')
const evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-world-map-style-policy/research/native-first')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true }), writeFile(source, '第一章 旧资料\n沈砚来到石桥。')])
const requests = [], errors = [], checks = [], processOutput = [], timings = []
let holdNext = false, releaseResponse, app, page
const server = createServer(async (request, response) => {
  try {
    assert.match(request.url, /\/images\/generations$/)
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); assert.equal(body.model, 'map-policy-test'); assert.equal(body.size, '1536x1024')
    assert.equal(typeof body.prompt, 'string'); assert.match(body.prompt, /个人地图视觉方法/); assert.match(body.prompt, /石桥/)
    assert.doesNotMatch(body.prompt, /纸雕|深玉绿|微缩建筑|沙盘/); requests.push(body)
    if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: userData, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(userData, 'global-model-data', 'v1'), LANJIAN_SMOKE_DOCUMENT_PATHS: JSON.stringify([source]) })
if (process.env.LANJIAN_MAP_DIAGNOSTICS === '1') env.LANJIAN_MAP_DIAGNOSTICS = join(evidence, 'lane-trace.log')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-map-policy-check', 'main/index.js')
const mark = text => { checks.push(text); timings.push({ event: text, at: Date.now() }); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env })
  app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function enterBook() {
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) {
    await page.locator('.work-item-open').filter({ hasText: '地图方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  }
}
async function enterMap() {
  await page.locator('[data-nav-parent="chronicle"]').focus(); await page.keyboard.press('Enter')
  await page.getByTestId('timeline-mode-map').click(); await page.getByTestId('world-map-view').waitFor()
  await page.getByTestId('map-generation-settings-trigger').click()
  await page.getByLabel('图像接口').selectOption({ label: '方法隔离验证' })
  await page.getByLabel('图像模型', { exact: true }).fill('map-policy-test')
}
async function waitResponse() {
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse, 'actual image request must reach the loopback provider')
}
async function closeFixture() {
  if (!app) return
  const fixtureApp = app; let timeout
  try {
    await Promise.race([fixtureApp.close(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Isolated fixture shutdown timed out')), 8000) })])
  } catch {
    const fixtureProcess = fixtureApp.process()
    if (fixtureProcess.exitCode === null) {
      if (process.platform === 'win32') {
        await promisify(execFile)('taskkill', ['/PID', String(fixtureProcess.pid), '/T', '/F']).catch(() => fixtureProcess.kill())
      } else fixtureProcess.kill()
    }
  }
  finally { clearTimeout(timeout) }
}
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
      await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
      const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '地图方法隔离验证', genre: '悬疑' })
      const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
      const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
      await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'map-policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
      const manifest = await api.imports.chooseDocuments()
      await api.imports.commitManifest({ id: manifest.id, expectedWorkItemId: project.path, files: [{ token: manifest.files[0].token, ownership: 'owned', creationMethod: 'human', title: '静态原材料', selectedChapterIndexes: [0] }] })
      await api.workspace.saveTimeline([{ id: 'existing-event', title: '旧资料', time: '时间未标注', characters: '沈砚', location: '石桥', event: '来到石桥', result: '' }])
      if ((await api.projects.sqliteStorageStatus()).storageMode !== 'sqlite') {
        const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token)
        const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token)
      }
      return { project, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await enterBook()
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter')
  await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('故事逐层展开'); await library.getByRole('button', { name: '查找插件', exact: true }).click()
  await library.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 world-map-style.md', { exact: true }).fill('个人地图视觉方法：采用平面墨线空间草图，只表现本书已有地点，不增加地理事实，不确认大纲。')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  assert.ok(personal); const row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /世界地图视觉方法/ }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-method.png') })
  const unchanged = async () => {
    const actual = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() } })
    assert.deepEqual(actual, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters, timeline: state.timeline })
  }
  await enterMap(); await page.getByTestId('map-generate').click()
  await page.getByRole('img', { name: 'AI 生成的小说地图候选预览', exact: true }).waitFor()
  assert.equal(requests.length, 1); await unchanged(); await page.screenshot({ path: join(evidence, 'visible-preview.png') })
  mark('Native UI editing, real installation and book composition put the selected map method in the actual image request and preview')
  timings.push({ event: 'adopt-click', at: Date.now() })
  await page.getByTestId('map-adopt-image').click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.locator('.map-background').waitFor()
  timings.push({ event: 'adopt-visible', at: Date.now() })
  const adopted = await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())
  assert.equal(adopted.document.version, 2); assert.equal(adopted.document.background.assetId, hash)
  assert.deepEqual(await readFile(join(state.project.path, '.webnovel', 'assets', 'world-map', `${hash}.png`)), image)
  await unchanged(); await page.screenshot({ path: join(evidence, 'adopted-map.png') })
  mark('Explicit isolated map adoption saves the validated content-addressed image while preserving static prose, outlines and timeline')
  await app.close(); app = undefined; await launch(); await enterBook(); await enterMap(); await page.locator('.map-background').waitFor()
  assert.equal(requests.length, 1); assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.getWorldMap()), adopted); await unchanged()
  mark('Normal native restart reads the saved background and original method selection with zero automatic requests')
  holdNext = true; await page.getByTestId('map-generate').click(); await waitResponse()
  await page.getByRole('button', { name: '停止等待', exact: true }).click(); releaseResponse(); releaseResponse = undefined
  await page.getByTestId('map-generate').waitFor(); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.getWorldMap()), adopted); await unchanged()
  mark('Native stop discards an image response arriving after cancellation and preserves the previously adopted map')
  holdNext = true; await page.getByTestId('map-generate').click(); await waitResponse()
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined; await page.getByTestId('map-generate').waitFor()
  await page.locator('.generator-error').waitFor(); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.getWorldMap()), adopted); await unchanged()
  assert.equal(requests.length, 3); assert.deepEqual(errors, []); await page.screenshot({ path: join(evidence, 'withdrawn-image.png') })
  mark('Late native plugin withdrawal publishes no candidate and keeps the original formal map and author data')
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, timings }, null, 2)); throw error
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length, timings }, null, 2))
  await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await closeFixture()
  server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.equal(dirname(root), parent)
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
