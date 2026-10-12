import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, access, realpath, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-chapter-export-')))
const output = resolve(process.env.EXPORT_SMOKE_OUTPUT || '../.trellis/tasks/09-20-v3-writing-page-txt-export/evidence')
const entry = resolve(process.env.EXPORT_SMOKE_ENTRY || 'out-chapter-export/main/index.js')
const books = join(root, 'books'), modelRoot = join(root, 'models')
await Promise.all([mkdir(output, { recursive: true }), mkdir(books), mkdir(modelRoot)])
// The chapter-order.json ledger belongs to legacy file authority. New books use
// formal storage, so corrupting an unused legacy file would test the wrong owner.
const legacy = { path: join(books, '章序损坏导出验证'), title: '章序损坏导出验证' }
await Promise.all(['.webnovel/config', '.webnovel/research', '.webnovel/manuscript', '正文', '大纲/章纲', '设定集'].map(folder => mkdir(join(legacy.path, folder), { recursive: true })))
await Promise.all([
  writeFile(join(legacy.path, '.webnovel/state.json'), JSON.stringify({ version: 2, schemaVersion: 2, project_info: { title: legacy.title, genre: '悬疑' } })),
  writeFile(join(legacy.path, '.webnovel/research/sources.json'), JSON.stringify({ version: 1, sources: [] })),
  writeFile(join(legacy.path, '.webnovel/research/events.json'), JSON.stringify({ version: 1, events: [] })),
  writeFile(join(legacy.path, '.webnovel/manuscript/chapter-order.json'), JSON.stringify({ version: 1, chapterIds: [7] })),
  writeFile(join(legacy.path, '正文/第7章-必须保留的独立正文.md'), '章序损坏不能覆盖或漏掉这份正式正文。'),
  writeFile(join(legacy.path, '大纲/总纲.md'), '合成总纲。')
])
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: modelRoot })
const checks = [], screenshots = [], errors = []
let app, page
const panel = () => page.getByTestId('manuscript-export-dialog')
async function saveTarget(path) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async options => {
      globalThis.exportSaveOptions = options
      globalThis.exportSaveCalls = (globalThis.exportSaveCalls || 0) + 1
      return { canceled: !filePath, filePath: filePath || undefined }
    }
  }, path)
}
async function openPanel() {
  await page.getByTestId('chapter-transfer-toggle').click()
  await page.getByTestId('export-manuscript-in-book').click()
  await panel().waitFor({ state: 'visible' })
}
async function exportFile(path) {
  await saveTarget(path)
  await page.getByTestId('export-confirm').click()
  await panel().waitFor({ state: 'hidden' })
  return readFile(path, 'utf8')
}
async function openBook(title) {
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '返回我的作品', exact: true }).waitFor()
  await page.locator('[data-nav-parent="manuscript"]').click()
}
async function lockSyntheticBook(path) {
  assert.equal(process.platform, 'win32', 'This permission scenario uses Windows ACLs')
  const target = await realpath(path), scope = relative(root, target)
  assert.ok(scope && !scope.startsWith('..') && !isAbsolute(scope), 'ACL changes must stay inside the fresh temporary fixture')
  const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-\d+(?:-\d+)+/)?.[0]
  assert.ok(sid, 'Resolve current Windows user before changing fixture ACLs')
  const acl = args => execFileSync('icacls.exe', [target, ...args], { encoding: 'utf8', windowsHide: true })
  // Restrict data writes/creation while retaining ordinary reads/enumeration.
  // icacls basic D also blocked reads in the native Windows fixture.
  acl(['/deny', `*${sid}:(OI)(CI)(WD,AD)`])
  return () => acl(['/remove:d', `*${sid}`])
}
async function manuscriptBytes(path) {
  const folder = join(path, '正文'), files = (await readdir(folder)).filter(name => name.endsWith('.md')).sort()
  return Promise.all(files.map(async name => [name, await readFile(join(folder, name), 'utf8')]))
}
async function capture(name, theme, width, height, zoom) {
  const win = await app.browserWindow(page)
  await win.evaluate((win, size) => { if (win.isMaximized()) win.unmaximize(); win.setContentSize(size.width, size.height); win.webContents.setZoomFactor(size.zoom) }, { width, height, zoom })
  await page.evaluate(theme => {
    localStorage.setItem('lanjian-theme', theme)
    window.dispatchEvent(new StorageEvent('storage', { key: 'lanjian-theme', newValue: theme }))
  }, theme)
  await page.waitForTimeout(400)
  await page.evaluate(() => document.fonts.ready)
  const geometry = await panel().evaluate(element => {
    const bounds = element.getBoundingClientRect(), button = element.querySelector('[data-testid="export-confirm"]'), action = button.getBoundingClientRect()
    const list = element.querySelector('.export-chapter-list')
    return { width: innerWidth, height: innerHeight, overflow: element.scrollWidth > element.clientWidth + 1,
      visible: bounds.top >= 0 && bounds.bottom <= innerHeight && action.bottom <= innerHeight,
      buttonHit: button.contains(document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2)),
      scrolls: list.scrollHeight > list.clientHeight }
  })
  assert.equal(geometry.overflow, false); assert.equal(geometry.visible, true); assert.equal(geometry.buttonHit, true)
  assert.equal(geometry.scrolls, true)
  const png = await win.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
  screenshots.push({ name, theme, zoom, ...geometry })
}
try {
  app = await _electron.launch({ args: [entry], env })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }))
    globalThis.fetch = () => { throw Error('Network disabled for export verification') }
  })
  page = await app.firstWindow(); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  // Create fixtures through real application services, then load them through the UI.
  const fixture = await page.evaluate(async parentPath => {
    const api = window.novelDesktop
    const { project: a } = await api.projects.create({ parentPath, name: '晨雾与来信 · 导出验证', genre: '悬疑' })
    const chapters = await api.chapters.list()
    while (chapters.length < 18) chapters.push(await api.chapters.create())
    for (const [index, chapter] of chapters.entries()) {
      await api.chapters.update(chapter.id, { title: ['雨夜来信', '旧城钟声', '纸上的陌生人'][index % 3] + (index > 2 ? ` · ${index + 1}` : ''), content: `章节标记【${index + 1}】。这段合成正文只用于核对导出范围。`, expectedRevision: chapter.revision, reason: 'manual' })
    }
    const first = await api.outlines.createVolume('雾中来信')
    const v1 = first.volumes.find(v => v.title === '雾中来信').volume
    const second = await api.outlines.createVolume('旧城回声')
    const v2 = second.volumes.find(v => v.title === '旧城回声').volume
    for (const [index, chapter] of chapters.entries()) await api.outlines.placeChapter(chapter.id, index < 9 ? v1 : v2)
    const before = await api.chapters.list()
    const { project: b } = await api.projects.create({ parentPath, name: '另一本合成作品', genre: '都市' })
    const bChapter = await api.chapters.create()
    await api.chapters.update(bChapter.id, { title: '必须保留的独立正文', content: '章序损坏不能覆盖或漏掉这份正式正文。', expectedRevision: bChapter.revision, reason: 'manual' })
    return { a, b, chapters: before, v1, v2 }
  }, books)
  await page.evaluate(path => window.novelDesktop.projects.importProject(path), legacy.path)
  console.log('Synthetic books and 18 grouped chapters created')
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await openBook(fixture.a.title)
  const firstChapter = fixture.chapters.find(c => c.position === 1), thirdChapter = fixture.chapters.find(c => c.position === 3)
  const firstVolume = page.locator(`.chapter-volume-group[data-volume="${fixture.v1}"] .chapter-volume-toggle`)
  if (await firstVolume.getAttribute('aria-expanded') === 'false') await firstVolume.click()
  await page.locator('.chapter-tree-row').filter({ hasText: '雨夜来信' }).first().click()
  await page.getByTestId('manuscript-input').waitFor()
  await openPanel()
  assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 1)
  await page.getByTestId('export-clear').click()
  assert.equal(await page.getByTestId('export-confirm').isDisabled(), true)
  await panel().locator(`[data-export-chapter="${thirdChapter.id}"]`).check()
  await panel().locator(`[data-export-chapter="${firstChapter.id}"]`).check()
  assert.equal(await panel().locator(`[data-export-group="volume-${fixture.v1}"]`).evaluate(e => e.indeterminate), true)
  await capture('01-selected-chapters', 'qingzhou', 1440, 1000, 1)
  const partial = await exportFile(join(root, 'selected.txt'))
  assert.match(partial, /章节标记【1】/); assert.match(partial, /章节标记【3】/); assert.doesNotMatch(partial, /章节标记【2】/)
  assert.ok(partial.indexOf('第1章') < partial.indexOf('第3章'))
  const options = await app.evaluate(() => globalThis.exportSaveOptions)
  assert.match(options.title, /已选 2 章/); assert.match(options.defaultPath, /阅读稿\.txt$/)
  checks.push('exact selected contents; original chapter order/numbers; native save defaults; indeterminate volume checkbox')
  console.log('Selected chapters exported and file contents verified')

  await openPanel(); await page.getByTestId('export-select-all').focus(); await page.keyboard.press('Enter')
  assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 18)
  await capture('02-whole-book-dark-125', 'moye', 1100, 850, 1.25)
  await capture('03-whole-book-paper-125', 'xuanzhi', 1100, 850, 1.25)
  const all = await exportFile(join(root, 'whole.md'))
  assert.equal((all.match(/^## 第\d+章/gm) || []).length, 18)
  assert.match(all, /章节标记【18】/)
  checks.push('keyboard whole-book selection; all 18 chapters; Markdown; three themes including 125% scroll/fixed actions')
  console.log('Whole-book export and three theme/scale views verified')

  await openPanel(); await page.getByTestId('export-clear').click()
  await panel().locator(`[data-export-group="volume-${fixture.v2}"]`).check()
  assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 9)
  const volume = await exportFile(join(root, 'volume.txt'))
  assert.match(volume, /章节标记【10】/); assert.doesNotMatch(volume, /章节标记【9】/)
  checks.push('whole-volume selection exports only that volume')

  await openPanel(); await saveTarget(null); await page.getByTestId('export-confirm').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-export-dialog"]')?.getAttribute('aria-busy') === 'false')
  assert.equal(await panel().isVisible(), true); assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 1)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByTestId('chapter-transfer-toggle').evaluate(e => document.activeElement === e), true)
  checks.push('native save cancellation retains selection; Escape restores trigger focus')

  const edited = '章节标记【1】。导出前刚输入的最新正文。'
  await page.getByTestId('manuscript-input').fill(edited)
  await openPanel()
  const latest = await exportFile(join(root, 'latest.txt'))
  assert.match(latest, /导出前刚输入的最新正文/)
  const savedBody = await page.evaluate(async id => (await window.novelDesktop.chapters.get(id)).content, firstChapter.id)
  assert.equal(savedBody.trimStart(), edited)
  assert.ok(latest.includes(savedBody), 'Reading copy must contain the exact saved body, including editor indentation')
  checks.push('latest editor input is formally saved and included before exporting')

  // Exercise both ordinary save routes; export flush uses autosave staging for typed text.
  await app.evaluate(({ ipcMain }) => {
    const originals = new Map(['chapters:update', 'chapters:autosave-stage'].map(channel => [channel, ipcMain._invokeHandlers.get(channel)]))
    globalThis.exportSaveFailures = 0
    globalThis.restoreExportSave = () => {
      for (const [channel, original] of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, original) }
    }
    for (const [channel, original] of originals) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        if (!args[1]?.content?.includes('模拟保存失败')) return original(event, ...args)
        globalThis.exportSaveFailures += 1
        return { ok: false, error: { code: 'STORAGE_ERROR', message: '模拟保存失败，原稿保留', recoverable: true } }
      })
    }
  })
  await page.getByTestId('manuscript-input').fill('模拟保存失败，仍需保留的正文。')
  await openPanel()
  const calls = await app.evaluate(() => globalThis.exportSaveCalls)
  await saveTarget(join(root, 'must-not-write.txt'))
  await page.getByTestId('export-confirm').click()
  await panel().getByRole('alert').filter({ hasText: /模拟保存失败/ }).waitFor()
  assert.ok(await app.evaluate(() => globalThis.exportSaveFailures > 0))
  assert.equal(await app.evaluate(() => globalThis.exportSaveCalls), calls)
  await assert.rejects(access(join(root, 'must-not-write.txt')))
  assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 1)
  await app.evaluate(() => globalThis.restoreExportSave())
  const retry = await exportFile(join(root, 'save-retry.txt'))
  assert.match(retry, /仍需保留的正文/)
  checks.push('save failure opens no native dialog, preserves draft/selection, and retries successfully')

  const beforeReadonly = await manuscriptBytes(fixture.a.path)
  const unlock = await lockSyntheticBook(fixture.a.path)
  try {
    assert.deepEqual(await manuscriptBytes(fixture.a.path), beforeReadonly)
    await assert.rejects(writeFile(join(fixture.a.path, 'permission-probe.tmp'), 'must not be writable'), error => ['EACCES', 'EPERM'].includes(error.code))
    await page.getByTestId('manuscript-input').fill('只读权限期间输入的新正文，恢复权限后仍可导出。')
    await openPanel()
    const dialogCalls = await app.evaluate(() => globalThis.exportSaveCalls)
    const target = join(root, 'readonly-must-not-write.txt')
    await saveTarget(target)
    await page.getByTestId('export-confirm').click()
    await panel().getByRole('alert').waitFor()
    assert.equal(await app.evaluate(() => globalThis.exportSaveCalls), dialogCalls)
    await assert.rejects(access(target))
    assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 1)
    assert.match(await page.getByTestId('manuscript-input').innerText(), /只读权限期间输入的新正文/)
    assert.deepEqual(await manuscriptBytes(fixture.a.path), beforeReadonly)
  } finally { unlock() }
  const readonlyRetry = await exportFile(join(root, 'readonly-retry.txt'))
  assert.match(readonlyRetry, /只读权限期间输入的新正文/)
  checks.push('real Windows write-denied book preserves all manuscript bytes and the typed draft; no save dialog until permissions are restored; retry succeeds')
  console.log('Windows ACL denial and permission-restored retry verified')

  await openPanel()
  await saveTarget(join(root, 'missing-parent', 'reading.txt'))
  await page.getByTestId('export-confirm').click(); await panel().getByRole('alert').waitFor()
  assert.equal(await panel().locator('[data-export-chapter]:checked').count(), 1)
  await exportFile(join(root, 'write-retry.txt'))
  checks.push('filesystem write failure retains selected chapters for retry')

  await openPanel()
  const crossTarget = join(root, 'cross-book.txt')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => new Promise(resolve => { globalThis.finishExportSaveDialog = () => resolve({ canceled: false, filePath: path }) })
  }, crossTarget)
  await page.getByTestId('export-confirm').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-export-dialog"]')?.getAttribute('aria-busy') === 'true')
  // Wait for the actual native-dialog boundary before switching the process-side book.
  for (let i = 0; i < 30 && !await app.evaluate(() => Boolean(globalThis.finishExportSaveDialog)); i++) await page.waitForTimeout(100)
  assert.equal(await app.evaluate(() => Boolean(globalThis.finishExportSaveDialog)), true)
  await page.evaluate(path => window.novelDesktop.projects.switch(path), fixture.b.path)
  await app.evaluate(() => globalThis.finishExportSaveDialog())
  await panel().getByRole('alert').filter({ hasText: /作品已经切换/ }).waitFor()
  await assert.rejects(access(crossTarget))
  await page.evaluate(path => window.novelDesktop.projects.switch(path), fixture.a.path)
  await page.keyboard.press('Escape')
  checks.push('book switch while native save dialog is pending cannot write another book into the export')

  const after = await page.evaluate(() => window.novelDesktop.chapters.list())
  assert.deepEqual(after.filter(c => c.id !== firstChapter.id).map(c => c.content), fixture.chapters.filter(c => c.id !== firstChapter.id).map(c => c.content))

  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  const ledger = join(legacy.path, '.webnovel', 'manuscript', 'chapter-order.json')
  const previousLedger = await readFile(ledger)
  const beforeDamagedOrder = await manuscriptBytes(legacy.path)
  assert.equal(beforeDamagedOrder.length, 1, 'Order-corruption fixture must contain an actual manuscript')
  const damaged = '{invalid chapter order fixture'
  await writeFile(ledger, damaged)
  try {
    await openBook(legacy.title)
    await page.getByText('正文文件 / 顺序待核', { exact: true }).waitFor()
    await page.getByTestId('chapter-transfer-toggle').click()
    assert.equal(await page.getByTestId('export-manuscript-in-book').isDisabled(), true)
    const callsBefore = await app.evaluate(() => globalThis.exportSaveCalls)
    const target = join(root, 'damaged-order-must-not-write.txt')
    await saveTarget(target)
    const failure = await page.evaluate(async () => {
      try { await window.novelDesktop.projects.exportManuscript(); return null }
      catch (error) { return { code: error.code, message: error.message } }
    })
    assert.ok(failure); assert.match(failure.message, /章节顺序/)
    assert.equal(await app.evaluate(() => globalThis.exportSaveCalls), callsBefore)
    await assert.rejects(access(target))
    assert.equal(await readFile(ledger, 'utf8'), damaged)
    assert.deepEqual(await manuscriptBytes(legacy.path), beforeDamagedOrder)
  } finally {
    await writeFile(ledger, previousLedger)
  }
  checks.push('damaged chapter order disables UI export and rejects direct export before the native dialog; evidence and manuscript bytes are unchanged')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, root, entry, checks, screenshots, errors, liveProviderCalls: 0 }, null, 2))
  console.log(JSON.stringify({ ok: true, root, checks: checks.length, screenshots: screenshots.length }))
} catch (error) {
  if (page && !page.isClosed()) {
    const win = await app.browserWindow(page)
    await writeFile(join(output, `failure-${Date.now()}.png`), Buffer.from(await win.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64')).catch(() => {})
    await writeFile(join(output, 'failure-text.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  throw error
} finally { if (app) await app.close() }
