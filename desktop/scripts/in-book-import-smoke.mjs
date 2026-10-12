import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url), { _electron } = require('playwright')
const root = await mkdtemp(join(tmpdir(), 'lanjian-book-import-'))
const userData = join(root, 'app'), books = join(root, 'books'), source = join(root, '旧稿.txt')
const output = resolve('../.trellis/tasks/09-10-v3-library-ui-and-import-entry/evidence/in-book-import')
await mkdir(userData); await mkdir(books); await mkdir(output, { recursive: true })
const original = '第一章 雨后\n\n雨停了，林川把湿透的信放在桌上。\n\n第二章 来客\n\n门外来了一个带伞的人。'
await writeFile(source, original, 'utf8')
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }; delete env.ELECTRON_RUN_AS_NODE; delete env.LANJIAN_SMOKE
let app, page
const errors = [], checks = []
try {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.'], env })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }))
    globalThis.fetch = async () => { throw Error('No network in import verification') }
  })
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.name))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  assert.equal(await page.getByTestId('import-manuscript-in-book').count(), 0)
  assert.equal(await page.getByTestId('create-from-txt').count(), 0)
  await page.getByTestId('create-work-item').click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('书内接续验证')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, books)
  await page.getByTestId('choose-create-folder').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="creation-model-defaults"]')?.textContent.includes('尚未设置'))
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.getByTestId('new-project-guide').waitFor()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="manuscript"]').focus(); await page.keyboard.press('Enter')
  const entrance = page.getByTestId('import-manuscript-in-book')
  await page.getByTestId('chapter-transfer-toggle').click()
  await entrance.waitFor()
  const initial = await page.evaluate(() => window.novelDesktop.chapters.list())
  assert.equal(initial.length, 0)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
  await entrance.click()
  const modal = page.getByRole('dialog', { name: '导入文稿或资料', exact: true })
  await modal.waitFor()
  assert.match(await modal.innerText(), /雨后/)
  assert.equal(await readFile(source, 'utf8'), original)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.chapters.list()), initial)
  await modal.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.chapters.list()), initial)
  checks.push('open-book-only-native-chooser-preview-and-cancel-preserve-source-and-chapters')
  await page.getByTestId('chapter-transfer-toggle').click()
  await entrance.focus(); await page.keyboard.press('Enter'); await modal.waitFor()
  await modal.getByRole('button', { name: '追加到当前作品', exact: true }).click()
  await modal.getByRole('button', { name: '我独立创作', exact: true }).click()
  const preview = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')).webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, 'preview.png'), Buffer.from(preview, 'base64'))
  await modal.locator('.import-footer .seal-action').click()
  await modal.waitFor({ state: 'hidden' })
  const chapters = await page.evaluate(() => window.novelDesktop.chapters.list())
  assert.equal(chapters.length, 2)
  const bodies = await page.evaluate(async ids => Promise.all(ids.map(id => window.novelDesktop.chapters.get(id))), chapters.map(c => c.id))
  assert.match(JSON.stringify(bodies), /雨停了，林川把湿透的信放在桌上。/)
  assert.match(JSON.stringify(bodies), /门外来了一个带伞的人。/)
  assert.equal(await readFile(source, 'utf8'), original)
  const files = await readdir(join(books, '书内接续验证', '正文'))
  assert.equal(files.filter(f => f.endsWith('.md')).length, 2)
  checks.push('explicit-current-book-confirm-imports-two-chapters-through-production-contract-and-files')
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.project-library').waitFor()
  assert.equal(await page.getByTestId('import-manuscript-in-book').count(), 0)
  assert.equal((await page.evaluate(() => window.novelDesktop.projects.list())).projects.length, 1)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, root, checks }))
} catch (error) {
  errors.push(String(error)); await page?.screenshot({ path: join(output, `failure-${Date.now()}.png`) }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify({ root, checks, errors, liveModelCalls: 0 }, null, 2))
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
