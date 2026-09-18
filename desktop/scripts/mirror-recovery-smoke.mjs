import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

const require = createRequire(import.meta.url)
require('tsx/cjs')
const { _electron } = require('playwright')
const { DatabaseSync } = require('node:sqlite')
const { stableEventReadSnapshot } = require('../src/main/modules/timeline/adapters/event-read-snapshot.ts')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { DocumentService } = require('../src/main/modules/manuscript/application/document-service.ts')
const { CurrentProjectLegacyWorkspaceSource } = require('../src/main/modules/library/application/legacy-workspace-source.ts')
const { ShadowImportService } = require('../src/main/modules/library/application/shadow-import-service.ts')
const { SqliteWorkspaceDatabaseFactory } = require('../src/main/platform/storage/workspace-database.ts')
const { SqliteManuscriptService } = require('../src/main/modules/manuscript/application/sqlite-manuscript-service.ts')

const output = resolve('../.trellis/tasks/09-12-v3-monster-girls-authority-repair/research/electron-recovery')
await mkdir(output, { recursive: true })
const parent = await realpath(tmpdir())
const root = await mkdtemp(join(parent, 'lanjian-mirror-smoke-'))
const userData = join(root, 'user-data')
const title = '外部稿恢复隔离验收'
const originalBody = '沈砚在雨夜收到一封信。'
const externalBody = '沈砚在雨夜收到一封信。\n\n他先核对门牌，再把信封交给林舟。'
const originalOutline = '时间：第一夜。人物：沈砚、林舟。地点：旧城。事件：收到来信。'
const externalOutline = '时间：第一夜。人物：沈砚、林舟。地点：旧城。事件：收到来信，先核对门牌。\n\n' + '场景约束：双方只知道信封表面的文字；不能提前得知寄信人的动机。\n'.repeat(18)
const settings = new SettingsStore(userData, { available: () => false, encrypt: () => assert.fail('no credentials'), decrypt: () => assert.fail('no credentials') })
const projects = new ProjectService(settings)
const { project } = await projects.create({ parentPath: root, name: title, genre: '悬疑' })
const fileDocuments = new DocumentService(projects)
await fileDocuments.updateChapter(1, { title: '雨夜来信', content: originalBody })
await fileDocuments.updateOutline('total', '全书总纲：从雨夜来信追到旧城真相。')
await fileDocuments.updateOutline(1, '第一卷：核对信件。')
await fileDocuments.updateChapterOutline(1, originalOutline)
const databases = new SqliteWorkspaceDatabaseFactory()
const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
const importer = new ShadowImportService(source, databases)
await importer.import(await importer.preview())
const authority = new SqliteManuscriptService(databases)
await authority.activate(project.path, await source.snapshot())
await writeFile(join(project.path, '正文', '第1章-雨夜来信.md'), externalBody)
await writeFile(join(project.path, '大纲', '章纲', '第1章.md'), externalOutline)

const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete env.ELECTRON_RUN_AS_NODE
const pageErrors = [], checks = [], geometries = []
let app, page

async function fingerprint() {
  const files = {}
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (!/^workspace\.sqlite(?:-wal|-shm|-journal)?$/.test(entry.name)) files[relative(project.path, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await walk(project.path)
  const snapshot = await stableEventReadSnapshot(project.path)
  const db = new DatabaseSync(snapshot.path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    for (const { name } of tables) {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      files[`sqlite:${name}`] = createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex')
    }
  } finally { db.close(); snapshot.dispose() }
  return files
}
async function formalVersions() {
  const snapshot = await stableEventReadSnapshot(project.path)
  const db = new DatabaseSync(snapshot.path, { readOnly: true })
  try { return {
    bodies: db.prepare('SELECT content,source_type FROM body_versions ORDER BY version_no').all(),
    outlines: db.prepare("SELECT v.content,v.source_type FROM outline_versions v JOIN outline_nodes n ON n.id=v.outline_node_id WHERE n.legacy_key='chapter-1' ORDER BY v.version_no").all()
  } } finally { db.close(); snapshot.dispose() }
}
async function start(snapshot) {
  app = await _electron.launch({ executablePath: require('electron'), args: [snapshot], cwd: process.cwd(), env, timeout: 30000 })
  await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true })))
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    localStorage.setItem('lanjian-theme', 'qingzhou')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  await page.locator('[data-testid="app-boot"]').waitFor({ state: 'hidden' })
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.locator('[data-testid="workspace-loading"]').waitFor({ state: 'hidden' })
  await page.locator('.project-library').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="manuscript"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="manuscript-input"]').waitFor()
}
async function openOutline() {
  await page.locator('[data-nav-parent="planning"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-nav-leaf="chapter-outline"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="preview-outline-mirror"]').waitFor()
}
async function capture(name, width, height, zoom) {
  await app.evaluate(({ BrowserWindow }, geometry) => {
    const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('pet.html'))
    if (window.isMaximized()) window.unmaximize()
    window.setContentSize(geometry.width, geometry.height)
    window.webContents.setZoomFactor(geometry.zoom)
    window.show()
  }, { width, height, zoom })
  await page.locator('[data-testid="outline-mirror-preview"]').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const geometry = await page.locator('[data-testid="outline-mirror-preview"]').evaluate(node => ({
    width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    panelOverflow: node.scrollWidth > node.clientWidth
  }))
  assert.equal(geometry.horizontalOverflow, false)
  assert.equal(geometry.panelOverflow, false)
  geometries.push({ name, width, height, zoom, ...geometry })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('pet.html')).webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
}

try {
  await withChronicleBuildSnapshot(resolve('out'), join(root, 'build-cache'), async snapshot => {
    await writeFile(join(snapshot, 'package.json'), JSON.stringify({ name: 'mirror-recovery-smoke', type: 'module', main: './out/main/index.js' }))
    await symlink(resolve('node_modules'), join(snapshot, 'node_modules'), 'junction')
    try {
      await start(snapshot)
      const beforeCancel = await fingerprint()
      let dialogReady = page.waitForEvent('dialog')
      let recoveryClick = page.locator('[data-testid="recover-external-mirror"]').click()
      await (await dialogReady).dismiss()
      await recoveryClick
      assert.deepEqual(await fingerprint(), beforeCancel)
      assert.equal(await page.locator('[data-testid="manuscript-input"]').innerText(), originalBody)
      checks.push('body preview/cancel leaves formal records and all non-database book files unchanged')
      dialogReady = page.waitForEvent('dialog')
      recoveryClick = page.locator('[data-testid="recover-external-mirror"]').click()
      await (await dialogReady).accept()
      await recoveryClick
      await page.waitForFunction(text => document.querySelector('[data-testid="manuscript-input"]')?.textContent?.includes(text), '他先核对门牌')
      await page.locator('[data-testid="open-manuscript-history"]').click()
      await page.locator('.revision-ledger').waitFor()
      const versions = await page.evaluate(() => window.novelDesktop.chapters.revisions(1))
      assert.ok(versions.some(item => item.content === originalBody && !item.isCurrent))
      assert.ok(versions.some(item => item.content === externalBody && item.isCurrent && item.reason === 'restore'))
      await page.getByRole('button', { name: '关闭历史版本' }).click()
      checks.push('body adopted through UI; original and restore versions readable')
      await openOutline()
      const editor = page.getByRole('textbox', { name: '当前章纲正文', exact: true })
      await editor.fill(originalOutline + '\n作者未保存中文草稿。')
      const beforeOutlineCancel = await fingerprint()
      await page.locator('[data-testid="preview-outline-mirror"]').focus()
      await page.keyboard.press('Enter')
      await page.locator('[data-testid="outline-mirror-preview"]').waitFor()
      assert.equal(await page.getByRole('textbox', { name: '外部章纲内容' }).inputValue(), externalOutline)
      assert.equal(await page.locator('[data-testid="adopt-outline-mirror"]').isDisabled(), true)
      await page.locator('[data-testid="cancel-outline-mirror"]').focus()
      await page.keyboard.press('Escape')
      await page.locator('[data-testid="outline-mirror-preview"]').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('[data-testid="preview-outline-mirror"]').evaluate(node => node === document.activeElement), true)
      assert.match(await editor.innerText(), /作者未保存中文草稿/)
      assert.deepEqual(await fingerprint(), beforeOutlineCancel)
      checks.push('outline preview/cancel preserves unsaved Chinese draft, formal records, mirrored files and keyboard focus')
      await editor.fill(originalOutline)
      await page.locator('[data-testid="preview-outline-mirror"]').click()
      await page.locator('[data-testid="outline-mirror-preview"]').waitFor()
      await capture('01-outline-comparison', 1280, 800, 1)
      await capture('02-outline-comparison-125-percent', 1440, 900, 1.25)
      await page.locator('[data-testid="adopt-outline-mirror"]').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="outline-mirror-message"]')?.textContent?.includes('原版本已保留'))
      assert.equal(await page.evaluate(async () => (await window.novelDesktop.chapterOutlines.get(1)).content), externalOutline)
      const stored = await formalVersions()
      assert.deepEqual(stored.bodies.map(row => row.content), [originalBody, externalBody])
      assert.deepEqual(stored.outlines.map(row => row.content), [originalOutline, externalOutline])
      assert.equal(stored.outlines[1].source_type, 'restore')
      checks.push('outline UI adoption appends one restore version; both full texts retained')
      await app.close(); app = undefined
      await start(snapshot)
      assert.match(await page.locator('[data-testid="manuscript-input"]').innerText(), /他先核对门牌/)
      await openOutline()
      assert.equal(await page.evaluate(async () => (await window.novelDesktop.chapterOutlines.get(1)).content), externalOutline)
      checks.push('fresh Electron process reopens both adopted texts')
      assert.deepEqual(pageErrors, [])
    } catch (error) {
      if (page && !page.isClosed()) await page.screenshot({ path: join(output, `failure-${Date.now()}.png`) }).catch(() => undefined)
      throw error
    } finally {
      if (app) { await app.close(); app = undefined }
      await unlink(join(snapshot, 'node_modules'))
    }
  })
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, checks, pageErrors, geometries, realModelCalls: 0, authorBookUsed: false, chineseInput: 'Chinese text entry and cancellation tested; OS IME composition not manually tested' }, null, 2))
  console.log(JSON.stringify({ ok: true, output, checks }))
} catch (error) {
  await writeFile(join(output, `failure-${Date.now()}.json`), JSON.stringify({ message: error.message, checks, pageErrors }, null, 2))
  throw error
} finally {
  const target = await realpath(root)
  if (target !== root || dirname(target) !== parent || !target.startsWith(join(parent, 'lanjian-mirror-smoke-'))) throw new Error('Unexpected cleanup path')
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
