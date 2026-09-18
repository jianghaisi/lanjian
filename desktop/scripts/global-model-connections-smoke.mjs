import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url), { _electron } = require('playwright')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-global-ui-')))
const userData = join(root, 'app'), books = join(root, 'books')
const output = resolve('../.trellis/tasks/09-18-v3-gemini-native-protocol/evidence/global-model-connections')
await mkdir(userData); await mkdir(books); await mkdir(output, { recursive: true })
const requests = [], errors = [], geometries = []
let rejectCatalog = false
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString()
  assert.equal(req.headers.authorization, 'Bearer synthetic-ui-key')
  requests.push({ path: req.url, method: req.method })
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/v1/models' && rejectCatalog) { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'synthetic rejection' } })); return }
  if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'gpt-fixture' }, { id: 'gemini-fixture' }] }))
  else {
    assert.match(body, /连接测试/)
    res.end(JSON.stringify({ choices: [{ message: { content: '连接正常' } }] }))
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const endpoint = `http://127.0.0.1:${server.address().port}/v1`
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }; delete env.ELECTRON_RUN_AS_NODE; delete env.LANJIAN_SMOKE
let app, page
const manager = () => page.locator('[data-testid="global-model-settings"]')
const settled = async () => { await page.waitForFunction(() => document.querySelector('[data-testid="global-model-settings"]')?.getAttribute('aria-busy') === 'false') }
async function start() {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env, timeout: 30000 })
  await app.evaluate(({ session }, endpoint) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => done({ cancel: !details.url.startsWith(endpoint) }))
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => { if (!String(input).startsWith(endpoint + '/')) throw Error('Test blocks external provider traffic'); return original(input, init) }
  }, endpoint)
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  const security = await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')).webContents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration } })
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  page.on('pageerror', error => errors.push(error.name))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload(); await page.locator('[data-testid="app-boot"]').waitFor({ state: 'hidden' })
}
async function openLibraryManager() {
  await page.locator('.project-library').waitFor()
  await page.locator('.topbar-settings').click()
  await page.locator('[data-testid="library-global-models"]').click(); await settled()
}
async function closeLibraryManager() {
  await page.getByRole('dialog', { name: '全局模型接口与新书默认', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '关闭外观设置', exact: true }).click()
}
async function shelf() {
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.project-library').waitFor()
}
async function openBook(title) {
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.locator('[data-testid="workspace-loading"]').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '返回我的作品', exact: true }).waitFor()
}
async function settings(section) {
  // Existing sidebar pointer overlap is recorded separately; keyboard is a normal supported entrance.
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter')
  await page.locator('[data-testid="settings-category-ai"]').click()
  await page.locator(`[data-testid="settings-nav-${section}"]`).click(); await settled()
}
async function create(title, expectedRevision) {
  if (!(await page.locator('[data-testid="create-work-item"]').isVisible())) {
    const overview = page.locator('[data-testid="library-all-works-back"]')
    if (await overview.isVisible()) await overview.click()
  }
  await page.locator('[data-testid="create-work-item"]').click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill(title)
  // Only the native chooser is stubbed; the button and app create path are real.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, books)
  await page.locator('[data-testid="choose-create-folder"]').click()
  await page.locator('[data-testid="creation-model-defaults"]').waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-testid="creation-model-defaults"]')?.textContent.includes('正在核对'))
  if (expectedRevision) assert.match(await page.locator('[data-testid="creation-model-defaults"]').innerText(), new RegExp(`默认版本 ${expectedRevision}`))
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.getByRole('button', { name: '返回我的作品', exact: true }).waitFor()
  await page.locator('[data-testid="workspace-loading"]').waitFor({ state: 'hidden' })
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  return join(books, title)
}
async function defaults(prose = 'gemini-fixture') {
  const panel = manager().locator('.model-defaults')
  if (!(await panel.evaluate(e => e.open))) await panel.locator('summary').click()
  await panel.getByLabel('分配方式', { exact: true }).selectOption('perTask')
  const globalId = await manager().locator('[data-global-id]').first().getAttribute('data-global-id')
  for (const slot of ['shared', 'outline', 'chapterOutline', 'prose', 'review']) {
    const row = panel.locator(`[data-model-slot="${slot}"]`)
    await row.locator('select').selectOption(`global:${globalId}`)
    await row.locator('input').first().fill(slot === 'prose' ? prose : 'gpt-fixture')
  }
  await panel.locator('[data-testid="save-new-book-defaults"]').click(); await settled()
  assert.equal(await manager().getByRole('alert').count(), 0)
}
async function capture(name, width, height, zoom, focus = 'top') {
  await app.evaluate(({ BrowserWindow }, g) => { const w = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')); if (w.isMaximized()) w.unmaximize(); w.setContentSize(g.width, g.height); w.webContents.setZoomFactor(g.zoom); w.show() }, { width, height, zoom })
  await (focus === 'last-connection' ? manager().locator('[data-global-id]').last() : manager().locator('h3')).scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  const geometry = await manager().evaluate(e => ({ width: innerWidth, height: innerHeight, overflow: e.scrollWidth > e.clientWidth + 1, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 }))
  assert.equal(geometry.overflow, false); assert.equal(geometry.documentOverflow, false)
  geometries.push({ name, width, height, zoom, ...geometry })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')).webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
}
const readBook = async title => JSON.parse(await readFile(join(books, title, '.webnovel', 'ai-settings.json'), 'utf8'))

try {
  await start(); await openLibraryManager()
  assert.equal(requests.length, 0)
  await page.locator('[data-testid="global-add-connection"]').focus(); await page.keyboard.press('Enter')
  const name = page.locator('[data-testid="global-connection-name"]')
  await name.focus()
  await name.evaluate(e => { e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); e.value = '合成共享接口'; e.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '合成共享接口' })) })
  await page.locator('[data-testid="global-connection-url"]').fill(endpoint)
  await page.locator('[data-testid="global-connection-key"]').fill('synthetic-ui-key')
  await page.locator('[data-testid="global-save-connection"]').focus(); await page.keyboard.press('Enter'); await settled()
  assert.equal(await page.locator('[data-testid="global-connection-form"]').count(), 0)
  assert.equal(await manager().locator('[data-global-id]').count(), 1)
  assert.equal(requests.length, 0)
  await page.locator('[data-testid="global-probe-model"]').fill('gpt-fixture')
  await manager().getByRole('button', { name: '测试此接口', exact: true }).click(); await settled()
  await manager().getByRole('button', { name: '获取型号', exact: true }).click(); await settled()
  assert.equal(requests.length, 2)
  assert.equal(await manager().locator('.model-catalog li').count(), 2)
  rejectCatalog = true
  await manager().getByRole('button', { name: '获取型号', exact: true }).click(); await settled()
  assert.equal(await manager().getByRole('alert').count(), 1)
  assert.equal(await manager().locator('.model-catalog').count(), 0)
  rejectCatalog = false
  await manager().getByRole('button', { name: '编辑名称 / 密钥', exact: true }).click()
  await page.locator('[data-testid="global-connection-name"]').fill('冲突后保留输入')
  await page.locator('[data-testid="global-connection-key"]').fill('unsaved-synthetic-key')
  await page.evaluate(async () => { const api = window.novelDesktop.modelConnections, c = await api.list(); await api.update({ expectedRevision: c.revision, id: c.connections[0].id, connectionRevision: c.connections[0].revision, name: '已在另一处改名' }) })
  await page.locator('[data-testid="global-save-connection"]').click(); await settled()
  assert.equal(await page.locator('[data-testid="global-connection-name"]').inputValue(), '冲突后保留输入')
  assert.equal(await page.locator('[data-testid="global-connection-key"]').inputValue(), 'unsaved-synthetic-key')
  assert.equal(await manager().getByRole('alert').count(), 1)
  await manager().getByRole('button', { name: '取消编辑', exact: true }).click()
  await manager().getByRole('button', { name: '重新读取', exact: true }).click(); await settled()
  await defaults(); await capture('01-global-library-light', 1280, 800, 1)
  await closeLibraryManager()
  await create('Model-A', 1); await shelf(); await create('Model-B', 1)
  const bBefore = await readBook('Model-B')
  await shelf(); await openBook('Model-A'); await settings('routing')
  await manager().locator('[data-model-slot="prose"] input').first().fill('A-only')
  await page.locator('[data-testid="save-book-models"]').click(); await settled()
  assert.equal((await readBook('Model-A')).tasks.prose.model, 'A-only')
  assert.deepEqual(await readBook('Model-B'), bBefore)
  await page.locator('[data-testid="settings-nav-connection"]').click(); await settled(); await defaults('gemini-next')
  await shelf(); await create('Model-C', 2)
  assert.equal((await readBook('Model-C')).tasks.prose.model, 'gemini-next')
  assert.equal((await readBook('Model-A')).tasks.prose.model, 'A-only'); assert.deepEqual(await readBook('Model-B'), bBefore)
  await shelf(); await openBook('Model-B'); await settings('routing')
  await manager().getByRole('button', { name: '预览应用新书默认', exact: true }).click(); await settled()
  assert.deepEqual(await readBook('Model-B'), bBefore)
  await manager().getByRole('button', { name: '确认应用到本书', exact: true }).click(); await settled()
  assert.equal((await readBook('Model-B')).tasks.prose.model, 'gemini-next')
  await capture('02-book-routing-125-percent', 1440, 900, 1.25)
  await page.evaluate(() => localStorage.setItem('lanjian-theme', 'moye'))
  await app.close(); app = undefined
  const stored = await readFile(join(userData, 'global-model-connections.json'), 'utf8')
  assert.doesNotMatch(stored, /synthetic-ui-key/)
  assert.match(stored, /encryptedApiKey/)
  for (const title of ['Model-A', 'Model-B', 'Model-C']) assert.doesNotMatch(JSON.stringify(await readBook(title)), /synthetic-ui-key|encryptedApiKey/)
  await start(); await openLibraryManager()
  const beforeSecondProcess = await readFile(join(userData, 'global-model-connections.json'))
  await new Promise((done, reject) => {
    const child = spawn(require('electron'), ['.'], { cwd: process.cwd(), env, windowsHide: true, stdio: 'ignore' })
    const timeout = setTimeout(() => { child.kill(); reject(Error('second process did not respect application ownership')) }, 15000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); code === 0 ? done() : reject(Error('second process exit failed')) })
  })
  assert.deepEqual(await readFile(join(userData, 'global-model-connections.json')), beforeSecondProcess)
  assert.equal(await manager().locator('[data-global-id]').count(), 1); assert.equal(requests.length, 3)
  await capture('03-global-library-dark-restart', 1280, 800, 1)
  await manager().getByRole('button', { name: '停用（影响所有引用作品）', exact: true }).click(); await settled()
  assert.equal(await manager().getByRole('button', { name: '测试此接口', exact: true }).isDisabled(), true)
  await manager().getByRole('button', { name: '恢复接口', exact: true }).click(); await settled()
  const panel = manager().locator('.model-defaults'); await panel.locator('summary').click()
  await panel.getByRole('button', { name: '清空默认（已有书不变）', exact: true }).click(); await settled()
  await closeLibraryManager(); await create('Manual-D')
  const manual = await page.evaluate(() => window.novelDesktop.ai.getSettings()); assert.equal(manual.modelConfigured, false)
  await settings('connection'); await manager().locator('.model-private > summary').click()
  await manager().getByRole('button', { name: '管理本书私有接口', exact: true }).click()
  const privateForm = manager().locator('.model-private fieldset')
  await privateForm.locator('input').first().fill('隔离私有接口')
  await privateForm.getByRole('button', { name: '仅保存名称', exact: true }).click(); await settled()
  await privateForm.locator('input[type=password]').fill('synthetic-private-key')
  await privateForm.getByRole('button', { name: '仅保存密钥变更', exact: true }).click(); await settled()
  assert.equal(await privateForm.locator('input[type=password]').inputValue(), '')
  await privateForm.getByRole('button', { name: '取消私有接口编辑', exact: true }).click()
  await manager().locator('.model-private > .model-actions input[type=checkbox]').check()
  await page.locator('[data-testid="preview-global-reuse"]').click(); await settled()
  const originalBookSettings = await readFile(join(userData, 'settings.json')), originalRoute = await page.evaluate(() => window.novelDesktop.modelConnections.book())
  await manager().getByRole('button', { name: '确认加入全局库', exact: true }).click(); await settled()
  assert.equal(await manager().locator('[data-global-id]').count(), 2)
  assert.deepEqual(await readFile(join(userData, 'settings.json')), originalBookSettings)
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.modelConnections.book())).settings, originalRoute.settings)
  await page.locator('[data-testid="global-add-connection"]').click()
  await page.locator('[data-testid="global-connection-name"]').fill('Gemini 原生隔离接口')
  await page.locator('[data-testid="global-connection-protocol"]').selectOption('gemini-native')
  assert.equal(await page.locator('[data-testid="global-connection-url"]').getAttribute('placeholder'), 'https://服务根地址')
  await page.locator('[data-testid="global-connection-url"]').fill('https://native.example.test')
  await page.locator('[data-testid="global-connection-key"]').fill('synthetic-native-ui-key')
  await page.locator('[data-testid="global-save-connection"]').click(); await settled()
  assert.equal(await manager().locator('[data-global-id]').count(), 3)
  assert.match(await manager().locator('[data-global-id]').filter({ hasText: 'Gemini 原生隔离接口' }).innerText(), /Gemini 原生协议/)
  const finalCatalogBytes = await readFile(join(userData, 'global-model-connections.json'), 'utf8')
  assert.doesNotMatch(finalCatalogBytes, /synthetic-native-ui-key/)
  assert.ok(JSON.parse(finalCatalogBytes).connections.some(connection => connection.protocol === 'gemini-native' && connection.baseUrl === 'https://native.example.test'))
  await capture('04-gemini-native-connection', 1280, 800, 1, 'last-connection')
  assert.equal(requests.length, 3); assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, root, userData, books, errors, requests, geometries, liveModelCalls: 0, checks: ['library global management', 'keyboard and Chinese composition', 'conflict preserves transient input without publishing keys', 'OS-encrypted synthetic key', 'explicit loopback test and catalog only', 'A/B/C independent copies', 'explicit apply preview', 'restart and disable/recover', 'single-instance ownership', 'sandboxed context-isolated main renderer', 'manual no-default book', 'private key management and source-preserving reuse', 'explicit Gemini native protocol selection and immutable service-root persistence'] }, null, 2))
  console.log(JSON.stringify({ ok: true, root, output, requests: requests.length }))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, `failure-${Date.now()}.png`) }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  await new Promise(done => server.close(done))
  // Keep bounded synthetic roots for inspection, never clean arbitrary author folders.
}
