import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { _electron } from 'playwright'

// Usage: node scripts/release-smoke.mjs <installed.exe> <new isolated fixture directory>
const executablePath = resolve(process.argv[2] ?? '')
const expectedVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const root = resolve(process.argv[3] ?? '')
assert.ok(process.argv[2] && process.argv[3] && isAbsolute(executablePath), 'Executable and fresh fixture directory required')
await mkdir(root, { recursive: true })
const marker = join(root, 'release-fixture.json')
let fixture
try { fixture = JSON.parse(await readFile(marker, 'utf8')); assert.equal(fixture.kind, 'lanjian-release-smoke') }
catch (error) { if (error.code !== 'ENOENT') throw error }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const errors = [], checks = [], pids = []
let app, page
async function launch() {
  app = await _electron.launch({ executablePath, env, timeout: 60000 })
  pids.push(app.process().pid)
  page = await app.firstWindow(); page.setDefaultTimeout(45000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  const actual = await app.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'),
    prefs: BrowserWindow.getAllWindows().find(win => !win.isDestroyed())?.webContents.getLastWebPreferences(),
  }))
  assert.equal(actual.packaged, true); assert.equal(actual.version, expectedVersion)
  assert.equal(await realpath(actual.userData), await realpath(env.LANJIAN_USER_DATA_PATH))
  assert.equal(actual.prefs.contextIsolation, true); assert.equal(actual.prefs.sandbox, true); assert.equal(actual.prefs.nodeIntegration, false)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
  })
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  checks.push('packaged-version-and-isolated-sandboxed-window')
}
async function close() {
  if (!app) return
  const closing = app.waitForEvent('close', { timeout: 45000 })
  // Close the native window so the application's save/close handshake runs.
  // CDP Page.close can destroy webContents before Electron's window close hook.
  const owner = await app.browserWindow(page)
  await owner.evaluate(window => window.close())
  await closing
  app = null
}
async function openBook() {
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: fixture.title }).first().click()
  await page.waitForFunction(() => !document.querySelector('main.app-frame')?.inert)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()
}
try {
  await launch()
  if (!fixture) {
    fixture = await page.evaluate(async parentPath => {
      const api = window.novelDesktop
      const { project } = await api.projects.create({ parentPath, name: '岚笺安装包验证', genre: '悬疑' })
      await api.projects.switch(project.path)
      const chapter = await api.chapters.create()
      await api.chapters.update(chapter.id, { title: '保存与恢复验证', content: '　　这是安装包隔离测试的数据。', expectedRevision: chapter.revision })
      return { kind: 'lanjian-release-smoke', title: project.title ?? project.name, project, chapterId: chapter.id, content: '　　这是安装包隔离测试的数据。' }
    }, root)
    fixture.title = '岚笺安装包验证'
    await writeFile(marker, JSON.stringify(fixture, null, 2))
    await close(); await launch()
  }
  await openBook()
  const current = await page.evaluate(id => window.novelDesktop.chapters.get(id), fixture.chapterId)
  assert.equal(current.content, fixture.content)
  await page.getByTestId('manuscript-input').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n手工保存后应完整恢复。')
  await page.getByTestId('save-manuscript').click()
  fixture.content += '\n手工保存后应完整恢复。'
  await page.waitForFunction(async ({ chapterId, content }) => (await window.novelDesktop.chapters.get(chapterId)).content === content, fixture)
  await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-save-state"]')?.classList.contains('saved'))
  await writeFile(marker, JSON.stringify(fixture, null, 2))
  checks.push('no-key-manual-edit-and-authoritative-save')
  await close(); await launch(); await openBook()
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), fixture.chapterId)).content, fixture.content)
  assert.ok(await page.getByTestId('manuscript-input').innerText().then(text => text.includes('手工保存后应完整恢复。')))
  checks.push('normal-restart-restores-saved-content')
  assert.equal(new Set(pids).size, pids.length)
  assert.deepEqual(errors, [])
  const owner = await app.browserWindow(page)
  const screenshot = await owner.evaluate(async window => {
    window.show(); window.focus()
    const frame = await window.webContents.capturePage()
    return { empty: frame.isEmpty(), size: frame.getSize(), png: frame.toPNG().toString('base64') }
  })
  assert.equal(screenshot.empty, false)
  assert.ok(screenshot.size.width > 800 && screenshot.size.height > 500)
  await writeFile(join(root, 'installed-editor.png'), Buffer.from(screenshot.png, 'base64'))
  console.log(JSON.stringify({ checks, errors, pids }))
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''))
  }
  throw error
} finally {
  await close()
  await writeFile(join(root, 'verification.json'), JSON.stringify({ executablePath, root, checks, errors, pids }, null, 2))
}
