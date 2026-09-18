import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const userData = await mkdtemp(join(tmpdir(), 'lanjian-full-flow-desktop-'))
const parentPath = await mkdtemp(join(tmpdir(), 'lanjian-full-flow-books-'))
const output = resolve('../.trellis/tasks/09-12-v3-global-model-connections/evidence/full-writing-flow')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete env.ELECTRON_RUN_AS_NODE
let app
let page
const pageErrors = []
const geometries = []
const start = async () => {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env, timeout: 30000 })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    if (!localStorage.getItem('lanjian-theme')) localStorage.setItem('lanjian-theme', 'qingzhou')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  await page.locator('[data-testid="app-boot"]').waitFor({ state: 'hidden' })
}
const openWriting = async () => {
  await page.locator('[data-nav-parent="settings"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="settings-category-writing"]').click()
  await page.locator('[data-testid="chapter-generation-full-flow"]').waitFor()
  assert.equal(await page.locator('.writing-preferences input[value="fast"], .writing-preferences input[value="reviewed"]').count(), 0)
  assert.equal(await page.locator('[data-assist-field-id="AppShell.bookProfile.chapterGenerationMode"]').count(), 0)
  assert.match(await page.locator('.writing-preference-footer').innerText(), /完整流程/)
}
const openFixtureFromLibrary = async () => {
  await page.locator('.project-library').waitFor()
  // Use the app's shelf entry, not a synthetic workspace marker or renderer state.
  await page.locator('.work-item-open').filter({ hasText: '完整流程桌面验收' }).first().click()
  await page.locator('[data-nav-parent="settings"]').waitFor()
  await page.locator('[data-testid="workspace-loading"]').waitFor({ state: 'hidden' })
  await page.locator('.project-library').waitFor({ state: 'hidden' })
}
const capture = async (name, width, height, zoom) => {
  await app.evaluate(({ BrowserWindow }, geometry) => {
    const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('pet.html'))
    if (window.isMaximized()) window.unmaximize()
    window.setContentSize(geometry.width, geometry.height)
    window.webContents.setZoomFactor(geometry.zoom)
    window.show()
  }, { width, height, zoom })
  await page.locator('[data-testid="chapter-generation-full-flow"]').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  geometries.push({ name, width, height, zoom, actual: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })), horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) })
  assert.equal(geometries.at(-1).horizontalOverflow, false)
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('pet.html'))
    return (await window.webContents.capturePage()).toPNG().toString('base64')
  })
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
}

try {
  await start()
  await page.locator('[data-testid="create-work-item"]').click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('完整流程桌面验收')
  await page.locator('input[placeholder="选择本地文件夹"]').evaluate((input, path) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, path)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, parentPath)
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  await openWriting()
  const initial = await page.evaluate(() => window.novelDesktop.workspace.getBookProfile())
  assert.equal(initial.chapterGenerationMode, 'reviewed')
  const compact = page.locator('.writing-preferences input[value="compact"]')
  await compact.focus()
  await page.keyboard.press('Space')
  assert.equal(await compact.isChecked(), true)
  await page.locator('[data-testid="save-writing-preferences"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(async () => (await window.novelDesktop.workspace.getBookProfile()).proseExpansionMode === 'compact')
  await capture('01-full-flow-light', 1280, 800, 1)
  await capture('02-full-flow-125-percent', 1440, 900, 1.25)
  await page.evaluate(() => localStorage.setItem('lanjian-theme', 'moye'))
  await app.close()
  app = undefined

  // Seed only this disposable book with the historical spelling while Electron is closed.
  const bookPath = join(parentPath, '完整流程桌面验收')
  // Normal new-book creation currently uses file compatibility storage. SQLite
  // projection/save/history are independently exercised by the service regression.
  const mirrorPath = join(bookPath, '.webnovel', 'config', 'book-profile.json')
  const raw = JSON.stringify({ ...JSON.parse(await readFile(mirrorPath, 'utf8')), chapterGenerationMode: 'fast' })
  await writeFile(mirrorPath, raw, 'utf8')
  await start()
  await openFixtureFromLibrary()
  await openWriting()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'moye')
  const legacy = await page.evaluate(() => window.novelDesktop.workspace.getBookProfile())
  assert.equal(legacy.chapterGenerationMode, 'reviewed')
  assert.equal(legacy.proseExpansionMode, 'compact')
  assert.equal(await readFile(mirrorPath, 'utf8'), raw)
  await capture('03-legacy-full-flow-dark', 1280, 800, 1)
  await page.locator('[data-testid="save-writing-preferences"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="save-writing-preferences"]').disabled)
  await app.close()
  app = undefined
  assert.equal(JSON.parse(await readFile(mirrorPath, 'utf8')).chapterGenerationMode, 'reviewed')
  assert.deepEqual(pageErrors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, userData, parentPath, pageErrors, geometries, storageMode: 'file', checks: ['normal app create', 'no generation-mode controls', 'keyboard preference save', 'new book reviewed', 'legacy fast projects as reviewed without read-time file rewrite', 'explicit full-mode file save', 'light/dark and zoom screenshots'], liveModelCalls: 0 }, null, 2))
  console.log(JSON.stringify({ ok: true, output, geometries }))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, `failure-${Date.now()}.png`) }).catch(() => undefined)
  throw error
} finally {
  if (app) await app.close()
}
