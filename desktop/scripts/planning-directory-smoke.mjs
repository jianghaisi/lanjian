// Real Electron renderer + typed IPC, using only newly-created temporary works.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const resume = process.env.PLANNING_SMOKE_RESUME ? JSON.parse(await readFile(resolve('../.trellis/tasks/09-18-v3-planning-directory-and-guidance/evidence/result.json'), 'utf8')) : null
const userData = resume?.userData || await mkdtemp(join(tmpdir(), 'lanjian-planning-profile-'))
const parent = resume?.parent || await mkdtemp(join(tmpdir(), 'lanjian-planning-books-'))
const output = resolve('../.trellis/tasks/09-18-v3-planning-directory-and-guidance/evidence')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: require('electron'), args: [resolve('node_modules/.cache/planning-directory-build/out/main/index.js')], env, timeout: 30000 })
const errors = [], checks = resume?.checks || []
let page
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => { localStorage.setItem('lanjian-opening-enabled', 'false'); localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false })); localStorage.setItem('lanjian-theme', 'moye'); sessionStorage.setItem('lanjian-opening-seen', 'true') })
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 30000 })
  const owner = await app.browserWindow(page)
  const ownerId = await owner.evaluate(window => window.id)
  await owner.evaluate(window => { if (window.isMaximized()) window.unmaximize(); window.setContentSize(1440, 900) })
  const click = selector => page.locator(selector).first().click()
  const capture = async name => {
    await page.mouse.move(600, 30)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(200)
    const png = await app.evaluate(async ({ BrowserWindow }, id) => (await BrowserWindow.fromId(id).webContents.capturePage()).toPNG().toString('base64'), ownerId)
    await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
  }
  if (!resume) {
  await click('[data-testid="create-work-item"]')
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('谋篇验证（隔离样例）')
  await page.locator('input[placeholder="选择本地文件夹"]').evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }, parent)
  await click('.create-book-modal footer .control-button.primary')
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.locator('.planning-sidebar').waitFor()
  assert.equal(await page.locator('[data-nav-parent="master-outline"]').count(), 0)
  assert.equal(await page.locator('.planning-sidebar [aria-current="page"]').getAttribute('data-nav-leaf'), 'total-outline')
  checks.push('empty work enters the unified outline directory')
  await capture('01-empty')
  await page.getByRole('button', { name: '新建卷', exact: true }).click()
  await page.getByRole('textbox', { name: '新卷名称' }).fill('雾港来信')
  await page.getByRole('button', { name: '建立卷', exact: true }).click()
  await page.locator('[data-testid="planning-volume-1"][aria-current="page"]').waitFor()
  const volumeEditor = page.getByRole('textbox', { name: '当前卷纲正文', exact: true })
  await volumeEditor.fill('第一卷：从一封来信开始调查，在找到证人时结束。')
  await page.locator('[data-nav-leaf="total-outline"]').click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.match(await volumeEditor.innerText(), /第一卷/)
  assert.equal(await page.locator('[data-testid="planning-volume-1"]').getAttribute('aria-current'), 'page')
  await page.locator('[data-nav-leaf="total-outline"]').click()
  await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await page.locator('[data-nav-leaf="total-outline"][aria-current="page"]').waitFor()
  assert.match((await page.evaluate(() => window.novelDesktop.outlines.get(1))).content, /第一卷/)
  checks.push('dirty document cancel and save-before-leave protect identity and persisted text')
  await click('[data-testid="planning-volume-1"]')
  assert.match(await volumeEditor.innerText(), /第一卷/)
  await capture('02-volume')
  await page.getByRole('button', { name: '新建章节并写章纲', exact: true }).first().click()
  await page.getByRole('textbox', { name: '当前章纲正文', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '当前章纲正文', exact: true }).fill('进入状态：清晨，主角在雾港。\n剧情节点：收到来信。\n退出状态：决定寻找证人。')
  await click('[data-testid="save-outline-document"]')
  await page.waitForFunction(async () => (await window.novelDesktop.chapterOutlines.get(1)).content.includes('收到来信'))
  checks.push('unassigned chapter is directly editable and saves to the correct outline')
  await capture('03-chapter')
  await click('[data-nav-leaf="volume-lines"]')
  await page.locator('.volume-outline-reading').waitFor()
  assert.match(await page.locator('.volume-outline-reading').innerText(), /第一卷/)
  await click('[data-nav-leaf="chapter-skeleton"]')
  assert.equal(await page.locator('.planning-sidebar').count(), 1)
  checks.push('overview and chapter arrangement retain the single directory')
  await page.locator('[data-testid="planning-chapter-1"]').click()
  assert.match(await page.getByRole('textbox', { name: '当前章纲正文', exact: true }).innerText(), /收到来信/)
  // A real composition event must block navigation, including requests to another outline kind.
  const chapterEditor = page.getByRole('textbox', { name: '当前章纲正文', exact: true })
  await chapterEditor.dispatchEvent('compositionstart', { data: '雾' })
  await click('[data-testid="planning-volume-1"]')
  assert.equal(await page.locator('[data-testid="planning-chapter-1"]').getAttribute('aria-current'), 'page')
  await chapterEditor.dispatchEvent('compositionend', { data: '雾' })
  await click('[data-testid="planning-volume-1"]')
  await page.locator('[data-testid="planning-volume-1"][aria-current="page"]').waitFor()
  // Template insertion is an ordinary undoable editor transaction, never an implicit save.
  const savedVolume = (await page.evaluate(() => window.novelDesktop.outlines.get(1))).content
  await page.locator('.planning-writing-help summary').click()
  await page.getByRole('button', { name: '在光标处插入提纲' }).click()
  assert.match(await volumeEditor.innerText(), /本卷目标/)
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get(1))).content, savedVolume)
  await volumeEditor.press('Control+z')
  assert.equal(await volumeEditor.innerText(), savedVolume)
  checks.push('Chinese composition prevents leaving; templates remain undoable unsaved drafts')

  await page.evaluate(async () => {
    await window.novelDesktop.outlines.createVolume('灯塔的第二封信')
    await window.novelDesktop.outlines.update(2, '第二卷：灯塔里的第二封来信。')
  })
  // Refresh through the actual workspace loader before injecting isolated IPC read/write faults.
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 30000 })
  await page.locator('.work-item-open').first().click()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await click('[data-testid="planning-volume-1"]')
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('outlines:get')
    globalThis.__outlineRead = original
    ipcMain.removeHandler('outlines:get')
    ipcMain.handle('outlines:get', (...args) => { if (args[1] === 2) throw new Error('隔离测试：读取失败'); return original(...args) })
  })
  await click('[data-testid="planning-volume-2"]')
  await page.locator('.planning-feedback[role="alert"]').waitFor()
  assert.match(await volumeEditor.innerText(), /第一卷/)
  assert.equal(await page.getByTestId('planning-volume-1').getAttribute('aria-current'), 'page')
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('outlines:get'); ipcMain.handle('outlines:get', globalThis.__outlineRead) })
  await page.getByRole('button', { name: '重试打开' }).click()
  await page.locator('[data-testid="planning-volume-2"][aria-current="page"]').waitFor()
  assert.match(await volumeEditor.innerText(), /第二卷/)
  await click('[data-testid="planning-volume-1"]')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('outlines:get')
    ipcMain.handle('outlines:get', (...args) => args[1] === 2 ? new Promise(resolve => { globalThis.__releaseOutline = async () => resolve(await globalThis.__outlineRead(...args)) }) : globalThis.__outlineRead(...args))
  })
  await click('[data-testid="planning-volume-2"]')
  await page.locator('.planning-feedback[role="status"]').waitFor()
  await click('[data-testid="planning-chapter-1"]')
  await page.locator('[data-testid="planning-chapter-1"][aria-current="page"]').waitFor()
  await app.evaluate(async ({ ipcMain }) => { ipcMain.removeHandler('outlines:get'); ipcMain.handle('outlines:get', globalThis.__outlineRead); await globalThis.__releaseOutline() })
  assert.match(await chapterEditor.innerText(), /收到来信/)
  assert.equal(await page.getByTestId('planning-chapter-1').getAttribute('aria-current'), 'page')
  checks.push('failed volume read preserves identity; retry works; late volume reply cannot replace a newer chapter')

  await chapterEditor.fill('写入失败时也必须保留的草稿。')
  await app.evaluate(({ ipcMain }) => {
    globalThis.__outlineWrite = ipcMain._invokeHandlers.get('chapter-outlines:update')
    ipcMain.removeHandler('chapter-outlines:update')
    ipcMain.handle('chapter-outlines:update', () => { throw new Error('隔离测试：保存失败') })
  })
  await click('[data-testid="planning-volume-1"]')
  await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.planning-dialog[open]'))
  assert.match(await chapterEditor.innerText(), /保留的草稿/)
  assert.equal(await page.getByTestId('planning-chapter-1').getAttribute('aria-current'), 'page')
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('chapter-outlines:update'); ipcMain.handle('chapter-outlines:update', globalThis.__outlineWrite) })
  await click('[data-testid="planning-volume-1"]')
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.locator('[data-testid="planning-volume-1"][aria-current="page"]').waitFor()
  checks.push('save failure keeps the unsaved chapter and does not navigate')

  } else {
    await page.locator('.work-item-open').first().click()
    await page.locator('[data-nav-parent="planning"] svg').first().click()
  }
  const chapterEditor = page.getByRole('textbox', { name: '当前章纲正文', exact: true })
  console.log('Seeding 440 real chapters and one standalone outline in the isolated work…')
  const fixture = resume?.checks.some(check => check.startsWith('440 chapters')) ? { ok: true } : await page.evaluate(async () => {
    let step = 'create-chapters'
    try {
    const count = (await window.novelDesktop.chapters.list()).length
    for (let n = count + 1; n <= 440; n++) {
      const chapter = await window.novelDesktop.chapters.create()
      if (n === 60 || n === 440) await window.novelDesktop.chapterOutlines.update(chapter.id, `第${n}章的独立停点。`)
    }
    await window.novelDesktop.outlines.placeChapter(1, 2)
    await window.novelDesktop.outlines.placeChapter(60, 1)
    await window.novelDesktop.outlines.placeChapter(440, 2)
    await window.novelDesktop.chapterOutlines.update(900, '仅章纲：夜里在灯塔等待，停在门被敲响。')
    step = 'prepare-formal-outline-fixture'
    // Stage/standalone editing is an existing formal-storage capability; only this synthetic work is activated.
    let storage = await window.novelDesktop.projects.sqliteStorageStatus()
    if (storage.storageMode === 'files') {
      const shadow = await window.novelDesktop.projects.previewSqliteShadowMigration()
      if (!shadow.canImport || !shadow.token) return { ok: false, step, shadow }
      await window.novelDesktop.projects.importSqliteShadowMigration(shadow.token)
      storage = await window.novelDesktop.projects.sqliteStorageStatus()
    }
    if (storage.storageMode !== 'sqlite') {
      const preview = await window.novelDesktop.projects.previewSqliteActivation()
      if (!preview.canActivate || !preview.token) return { ok: false, step, preview }
      await window.novelDesktop.projects.activateSqliteStorage(preview.token)
    }
    step = 'create-stage'
    const existingStage = (await window.novelDesktop.outlines.list()).stages?.find(stage => stage.title === '寻找见证者')
    const stageId = existingStage?.stage || (await window.novelDesktop.outlines.createStage(1, '寻找见证者')).stage.stage
    await window.novelDesktop.outlines.updateStage(stageId, '寻找见证者', '阶段纲：从来信到证人。')
    return { ok: true }
    } catch (error) { return { ok: false, step, error: error?.message || JSON.stringify(error) } }
  })
  assert.ok(fixture.ok, JSON.stringify(fixture))
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 30000 })
  await page.locator('.work-item-open').first().click()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第440章')
  await click('[data-testid="planning-chapter-440"]')
  await page.locator('[data-testid="planning-chapter-440"][aria-current="page"]').waitFor()
  assert.match(await chapterEditor.innerText(), /第440章/)
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第60章')
  await click('[data-testid="planning-chapter-60"]')
  await page.locator('[data-testid="planning-chapter-60"][aria-current="page"]').waitFor()
  assert.match(await chapterEditor.innerText(), /第60章/)
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第900章')
  await click('[data-testid="open-planned-chapter-900"]')
  await page.locator('[data-testid="open-planned-chapter-900"][aria-current="page"]').waitFor()
  assert.match(await page.getByRole('textbox', { name: '独立章纲正文' }).innerText(), /仅章纲/)
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.list())).length, 440)
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('')
  assert.equal(await page.locator('.planning-sidebar [aria-current="page"]').count(), 1)
  await capture('04-long-directory-planned')
  const helpBounds = await page.locator('.planning-writing-help summary').evaluate(summary => ({ summary: summary.getBoundingClientRect().height, container: summary.parentElement.getBoundingClientRect().height }))
  assert.ok(helpBounds.container >= helpBounds.summary, JSON.stringify(helpBounds))
  await page.getByRole('textbox', { name: '独立章纲正文' }).fill('仅章纲：夜里在灯塔等待，停在门被敲响。\n保存重开仍然保留。')
  await click('[data-testid="save-planned-chapter"]')
  await page.waitForFunction(async () => (await window.novelDesktop.outlines.getPlannedChapter(900)).content.includes('保存重开'))
  await page.waitForFunction(() => !document.querySelector('[data-testid="save-planned-chapter"]')?.disabled)
  await page.locator('[data-testid^="open-stage-"]').first().click()
  await page.getByRole('textbox', { name: '当前阶段纲正文' }).waitFor()
  assert.match(await page.getByRole('textbox', { name: '当前阶段纲正文' }).innerText(), /从来信到证人/)
  await page.locator('[data-nav-parent="chronicle"] svg').first().click()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByRole('textbox', { name: '当前阶段纲正文' }).waitFor()
  assert.match(await page.getByRole('textbox', { name: '当前阶段纲正文' }).innerText(), /从来信到证人/)
  checks.push('440 chapters, non-55 placement, unassigned chapters, standalone outline and stage survive reload and directory search')

  await click('[data-nav-leaf="total-outline"]')
  for (const [width, height, zoom, theme] of [[1366, 768, 1, 'qingzhou'], [1366, 768, 1.25, 'moye'], [1784, 1118, 1, 'moye']]) {
    await owner.evaluate((window, size) => { window.setContentSize(size.width, size.height); window.webContents.setZoomFactor(size.zoom) }, { width, height, zoom })
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.waitForTimeout(200)
    const layout = await page.evaluate(() => {
      const area = document.querySelector('.planning-sidebar').getBoundingClientRect()
      const editor = document.querySelector('.outline-editor').getBoundingClientRect()
      return { width: innerWidth, height: innerHeight, sidebar: { left: area.left, right: area.right, bottom: area.bottom }, editor: { left: editor.left, right: editor.right, bottom: editor.bottom }, overflow: document.documentElement.scrollWidth - innerWidth }
    })
    assert.ok(layout.overflow <= 1 && layout.editor.right <= layout.width + 1 && layout.editor.bottom <= layout.height + 1, JSON.stringify(layout))
    assert.ok(layout.sidebar.right <= layout.editor.left + 1)
    await capture(`05-${width}-${height}-${zoom}-${theme}`)
  }
  checks.push('native light/dark screenshots at 1366×768, 1784×1118 and 125% zoom; no horizontal overflow')
  // Existing chapters and standalone outlines both keep their explicit manuscript handoff.
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第60章')
  await click('[data-testid="planning-chapter-60"]')
  await page.locator('[data-testid="planning-chapter-60"][aria-current="page"]').waitFor()
  await click('[data-testid="planning-write-chapter"]')
  await page.locator('[data-nav-parent="manuscript"][aria-current="step"]').waitFor()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第900章')
  await click('[data-testid="open-planned-chapter-900"]')
  await page.locator('[data-testid="open-planned-chapter-900"][aria-current="page"]').waitFor()
  assert.match(await page.getByRole('textbox', { name: '独立章纲正文' }).innerText(), /保存重开/)
  page.once('dialog', dialog => dialog.accept())
  await click('[data-testid="start-planned-chapter"]')
  await page.locator('[data-nav-parent="manuscript"][aria-current="step"]').waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.list())).length, 441)
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(900))).content, '')
  assert.match((await page.evaluate(() => window.novelDesktop.chapterOutlines.get(900))).content, /保存重开/)
  checks.push('standalone outline saves and reopens; explicit manuscript handoff creates only the matching empty chapter')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ pass: true, userData, parent, checks, errors }, null, 2))
  console.log(JSON.stringify({ pass: true, checks, output }))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); await writeFile(join(output, 'failure-body.txt'), await page.locator('body').innerText().catch(() => '')) }
  await writeFile(join(output, 'result.json'), JSON.stringify({ pass: false, userData, parent, checks, errors, error: String(error) }, null, 2))
  throw error
} finally { await app.close() }
