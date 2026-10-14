import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-topbar-')))
const output = resolve(process.env.LANJIAN_TOPBAR_EVIDENCE_DIR || 'artifacts/ui/topbar-model-settings')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'LANJIAN_SMOKE']) delete env[key]
const build = resolve(process.argv[2] || 'out-topbar-settings-check')
const installed = process.env.LANJIAN_TEST_EXECUTABLE
const app = await _electron.launch({ executablePath: installed || require('electron'), args: installed ? [] : [join(build, 'main/index.js')], env })
const checks = [], errors = []
let owner
try {
  if (installed) {
    const actual = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }))
    assert.equal(actual.packaged, true)
    assert.equal(actual.version, process.env.LANJIAN_TEST_VERSION)
  }
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
    globalThis.fetch = async () => { throw new Error('Network disabled in isolated UI check') }
  })
  const page = await app.firstWindow()
  owner = await app.browserWindow(page)
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(() => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
  })
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const before = await page.evaluate(() => window.novelDesktop.modelConnections.list())
  const settings = page.locator('.library-preferences-dialog')
  const models = page.locator('.global-models-dialog')
  for (const [width, height, zoom, theme] of [[1440, 900, 1, 'qingzhou'], [1100, 760, 1.25, 'moye'], [1000, 720, 1, 'xuanzhi']]) {
    await owner.evaluate(win => { win.unmaximize(); win.setMinimumSize(800, 600) })
    await page.waitForTimeout(300)
    await owner.evaluate((win, { width, height, zoom }) => {
      win.setContentSize(width, height); win.webContents.setZoomFactor(zoom); win.show(); win.focus()
    }, { width, height, zoom })
    await page.waitForFunction(({ width, height, zoom }) => Math.abs(innerWidth - width / zoom) < 3 && Math.abs(innerHeight - height / zoom) < 3, { width, height, zoom })
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    assert.equal(await page.locator('.library-header-search,.library-local-status,[data-testid="library-model-setup"]').count(), 0)
    assert.equal(await page.locator('.book-tabs').evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
    await page.locator('.library-header-actions [aria-label="设置"]').click()
    assert.deepEqual(await settings.locator('nav > button').allTextContents(), ['01外观与画面', '02开场与加载', '03声音与对话', '04模型设置', '05写作插件'])
    const trigger = page.getByTestId('library-global-models')
    await trigger.focus()
    assert.equal(await trigger.evaluate(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit === el || el.contains(hit)
    }), true)
    await page.waitForTimeout(350)
    await page.screenshot() // Flush the current native paint before capturePage at non-default zoom.
    const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(output, `settings-${width}-${zoom}.png`), Buffer.from(png, 'base64'))
    await trigger.press('Enter')
    await models.waitFor({ state: 'visible' })
    assert.equal(await settings.evaluate(el => el.open), false)
    await page.getByTestId('library-models-return').click()
    assert.equal(await settings.evaluate(el => el.open), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.library-header-actions [aria-label="设置"]').evaluate(el => el === document.activeElement), true)
    checks.push({ width, height, zoom, theme, modelEntryAndReturn: true })
  }
  await page.locator('.library-header-actions [aria-label="设置"]').click()
  await page.getByTestId('library-global-models').click()
  await page.getByTestId('empty-add-connection').click()
  await models.getByLabel('接口名称', { exact: true }).fill('未保存的测试接口')
  await page.getByTestId('library-models-return').click()
  assert.equal(await models.evaluate(el => el.open), true, 'dirty input must block return')
  await models.getByRole('button', { name: '放弃本页修改', exact: true }).click()
  await page.getByTestId('library-models-return').click()
  assert.equal(await settings.evaluate(el => el.open), true)
  await page.keyboard.press('Escape')
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.modelConnections.list()), before)
  assert.deepEqual(errors, [])
  checks.push('dirty-model-input-protected', 'model-catalog-unchanged', 'no-renderer-errors')
  console.log(JSON.stringify({ root, output, checks }))
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ build, root, checks, errors }, null, 2))
  // Close only the BrowserWindow owned by this isolated harness through its native lifecycle.
  if (owner) await owner.evaluate(win => win.close()).catch(() => {})
}
