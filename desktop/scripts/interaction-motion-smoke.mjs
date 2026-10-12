import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

// Only synthetic books and an isolated profile; no author workspace or provider is used.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-interaction-motion-')))
const output = resolve(process.env.INTERACTION_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-interaction-motion-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function openAssistant() {
  if (await page.getByTestId('assistant-sidebar').getAttribute('aria-hidden') === 'true')
    await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
  await page.getByTestId('assistant-sidebar').waitFor()
}
try {
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.show(); win.focus() })
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  })
  const book = await page.evaluate(async root => {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: root, name: '动效验证', title: '动效验证' })
    const chapters = []
    for (let i = 1; i <= 2; i++) {
      const status = await api.outlines.createVolume(`卷${i}`)
      const chapter = await api.chapters.create()
      const content = `第${i}章：这份正文不应被界面动画修改。`
      await api.chapters.update(chapter.id, { title: `场景${i}`, content, expectedRevision: chapter.revision })
      await api.outlines.placeChapter(chapter.id, status.volumes.at(-1).volume)
      chapters.push({ id: chapter.id, content })
    }
    return { ...project, chapters }
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const settings = page.getByRole('button', { name: '设置', exact: true })
  await settings.click(); await page.locator('.local-appearance-dialog[open]').waitFor()
  await capture('00-appearance-dialog')
  await page.locator('[data-preview-theme="qingzhou"] input').check()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'qingzhou')
  await capture('00-appearance-light')
  await page.locator('[data-preview-theme="moye"] input').check()
  await page.keyboard.press('Escape')
  await page.locator('.local-appearance-dialog[open]').waitFor({ state: 'hidden' })
  assert.equal(await settings.evaluate(e => e === document.activeElement), true)
  checks.push('native-appearance-dialog-escape-restores-focus')
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()

  const layout = page.getByTestId('manuscript-layout')
  await layout.click(); await page.locator('.writing-layout-popover').waitFor()
  await capture('01-layout-popover')
  await page.keyboard.press('Escape')
  await page.locator('.writing-layout-popover').waitFor({ state: 'hidden' })
  assert.equal(await layout.evaluate(e => e === document.activeElement), true)
  checks.push('layout-popover-escape-restores-focus')

  await openAssistant(); await page.getByTestId('assistant-mode-agent').click()
  const composer = page.getByTestId('field-assistant-instruction')
  await composer.fill('尚未发送的创作想法，关闭侧栏后应保留。')
  await composer.evaluate(e => { window.originalComposer = e })
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '关闭智能助笔侧栏', exact: true }).click()
    assert.equal(await page.getByTestId('assistant-sidebar').evaluate(e => e.inert), true)
    await openAssistant()
  }
  assert.equal(await composer.evaluate(e => e === window.originalComposer), true)
  assert.equal(await composer.inputValue(), '尚未发送的创作想法，关闭侧栏后应保留。')
  await capture('02-assistant-draft-preserved')
  checks.push('rapid-drawer-toggle-keeps-composer-identity-draft-and-hidden-inert')
  await page.getByRole('button', { name: '关闭智能助笔侧栏', exact: true }).click()

  for (const index of [0, 1, 0]) {
    const group = page.locator('.chapter-volume-group').filter({ has: page.locator('.chapter-row-title', { hasText: `场景${index + 1}` }) })
    const toggle = group.locator('.chapter-volume-toggle'), fold = group.locator('.chapter-volume-fold')
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
    assert.equal(await fold.evaluate(e => e.inert), true)
    await toggle.click(); await group.locator('.chapter-tree-row').click()
    await page.waitForFunction(text => document.querySelector('[data-testid="manuscript-input"]')?.textContent?.includes(text), book.chapters[index].content)
    assert.equal(await fold.evaluate(e => e.inert), false)
  }
  await capture('03-chapter-fold-and-selection')
  checks.push('volume-fold-inert-and-chapter-switch-preserve-authoritative-text')

  // Replace only the list read in this isolated Electron process. No task/provider is started.
  const fixture = { id: 'c6a4db9a-9b73-4cd1-9f13-7018cdce480d', workItemId: book.id, taskType: 'writing_agent', status: 'running', label: '状态反馈验证', detail: '隔离测试中的状态记录', attempt: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actions: ['view', 'pause', 'cancel'] }
  await app.evaluate(({ ipcMain }, item) => {
    globalThis.motionTaskFixture = [item]
    ipcMain.removeHandler('workspace:list-task-center')
    ipcMain.handle('workspace:list-task-center', () => ({ ok: true, value: globalThis.motionTaskFixture }))
  }, fixture)
  await openAssistant(); await page.getByTestId('assistant-mode-tasks').click()
  await page.getByTestId('task-filter-all').click()
  for (const [status, label] of [['running', '执行中'], ['paused', '已暂停'], ['succeeded', '已完成'], ['failed', '未完成']]) {
    await app.evaluate((_electron, status) => { globalThis.motionTaskFixture[0].status = status; globalThis.motionTaskFixture[0].actions = status === 'paused' ? ['resume', 'view'] : ['view'] }, status)
    await page.getByTestId('refresh-task-center').click()
    const mark = page.locator('.task-status-label').filter({ hasText: label })
    await mark.waitFor()
    assert.equal(await mark.getAttribute('data-running'), String(status === 'running'))
    assert.equal(await mark.locator('svg').count(), status === 'succeeded' ? 1 : 0)
    await capture(`04-task-${status}`)
  }
  checks.push('real-task-panel-running-paused-success-failure-feedback-from-isolated-ipc-fixtures')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.task-status-label').evaluate(e => getComputedStyle(e).animationName), 'none')
  assert.equal(await page.locator('.chapter-volume-fold').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await page.getByRole('button', { name: '关闭智能助笔侧栏', exact: true }).click()
  await layout.click()
  assert.equal(await page.locator('.writing-layout-popover').evaluate(e => getComputedStyle(e).animationName), 'none')
  await page.keyboard.press('Escape')
  await openAssistant(); await page.getByTestId('assistant-mode-agent').click()
  assert.equal(await composer.inputValue(), '尚未发送的创作想法，关闭侧栏后应保留。')
  checks.push('reduced-motion-disables-new-effects-with-draft-preserved')

  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('05-compact-assistant')
  checks.push('compact-125-percent-no-document-overflow')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  checks.push('two-manuscript-files-byte-identical')
  await page.getByRole('button', { name: '关闭智能助笔侧栏', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const title = page.getByTestId('manuscript-title-input')
  await title.evaluate(e => { window.originalTitleInput = e })
  await title.fill('场景1：保存反馈验证')
  await page.waitForFunction(async id => (await window.novelDesktop.chapters.get(id)).title === '场景1：保存反馈验证', book.chapters[0].id)
  await page.locator('.storage-state-mark:is(.checkpoint,.saved)').waitFor()
  assert.equal(await title.evaluate(e => e === window.originalTitleInput && e === document.activeElement), true)
  assert.equal(await page.evaluate(async id => (await window.novelDesktop.chapters.get(id)).content, book.chapters[0].id), book.chapters[0].content)
  await page.keyboard.press('Control+s')
  await page.locator('.storage-state-mark.saved').waitFor()
  assert.equal(await title.evaluate(e => e === window.originalTitleInput && e === document.activeElement), true)
  await capture('06-real-save-keeps-title-focus')
  checks.push('real-title-autosave-checkpoint-and-manual-save-without-input-remount-or-focus-loss')
  await title.dispatchEvent('compositionstart')
  await title.fill('场景1：组合输入验证')
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(async id => (await window.novelDesktop.chapters.get(id)).title, book.chapters[0].id), '场景1：保存反馈验证')
  await title.dispatchEvent('compositionend', { data: '组合输入验证' })
  await page.waitForFunction(async id => (await window.novelDesktop.chapters.get(id)).title === '场景1：组合输入验证', book.chapters[0].id)
  assert.equal(await title.evaluate(e => e === window.originalTitleInput && e === document.activeElement), true)
  checks.push('synthetic-composition-defers-title-save-until-end-with-focus-preserved')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error); await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video(); await app.close()
  if (video) await copyFile(await video.path(), join(output, 'interaction-motion.webm'))
}
