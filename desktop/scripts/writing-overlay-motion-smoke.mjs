import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

// Exercise only synthetic local books; no author profile or provider jobs.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-writing-overlay-')))
const output = resolve(process.env.WRITING_OVERLAY_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-writing-overlay-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
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
    const { project } = await api.projects.create({ parentPath: root, name: '弹层动效验证', title: '弹层动效验证' })
    let chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { title: '归途', content: '旧稿：灯火映着归人的身影。', expectedRevision: chapter.revision })
    await api.chapters.nameCurrentRevision(chapter.id, '灯火初稿')
    chapter = await api.chapters.get(chapter.id)
    await api.chapters.update(chapter.id, { title: '归途', content: '定稿：巷口的灯亮了，远行的人终于回到了故乡。', expectedRevision: chapter.revision })
    await api.chapters.nameCurrentRevision(chapter.id, '归途定稿')
    return project
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name)
    bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()
  const history = page.getByTestId('open-manuscript-history')
  await history.click()
  const ledger = page.locator('.revision-ledger'), close = page.getByRole('button', { name: '关闭历史版本', exact: true })
  await close.waitFor()
  assert.equal(await close.evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await ledger.evaluate(e => e.contains(document.activeElement) && document.activeElement !== e.querySelector('[aria-label="关闭历史版本"]')), true)
  await page.keyboard.press('Tab')
  assert.equal(await close.evaluate(e => e === document.activeElement), true)
  checks.push('history-initial-focus-and-tab-wrap')
  const label = page.getByRole('textbox', { name: '当前版本名称', exact: true })
  await label.fill('未保存的命名草稿')
  await label.evaluate(e => { window.overlayNameInput = e })
  await page.getByRole('navigation', { name: '历史版本列表' }).getByRole('button').filter({ hasText: '灯火初稿' }).click()
  await page.getByRole('button', { name: '看全文', exact: true }).click()
  assert.match(await page.locator('.revision-full-preview').innerText(), /旧稿：灯火/)
  await page.getByTestId('revision-view-changes').click()
  assert.match(await page.getByTestId('revision-diff').innerText(), /定稿：巷口/)
  assert.equal(await label.evaluate(e => e === window.overlayNameInput), true)
  assert.equal(await label.inputValue(), '未保存的命名草稿')
  await capture('01-history-comparison')
  checks.push('revision-switch-keeps-name-input-and-unsaved-draft')
  await label.focus()
  await label.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
  assert.equal(await ledger.isVisible(), true)
  await page.evaluate(() => {
    const panel = document.querySelector('.revision-backdrop')
    window.historyExit = panel
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => window.historyExit.inert && window.historyExit.getAttribute('aria-hidden') === 'true')
  await ledger.waitFor({ state: 'hidden' })
  assert.equal(await history.evaluate(e => e === document.activeElement), true)
  checks.push('history-ime-escape-ignored-and-exit-inert-with-focus-return')

  const guidance = page.getByTestId('open-workspace-guidance')
  const panel = page.getByTestId('workspace-guidance-panel')
  await guidance.click()
  await panel.waitFor()
  assert.equal(await panel.evaluate(e => e === document.activeElement && !e.inert), true)
  await panel.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
  assert.equal(await panel.isVisible(), true)
  await capture('02-guidance-anchor')
  await page.evaluate(() => {
    window.guidanceExit = document.querySelector('[data-testid="workspace-guidance-panel"]')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => window.guidanceExit.inert && window.guidanceExit.getAttribute('aria-hidden') === 'true')
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await guidance.evaluate(e => e === document.activeElement), true)
  checks.push('guidance-ime-and-inert-exit-focus-return')
  for (let i = 0; i < 3; i++) {
    await guidance.click()
    await panel.waitFor()
    await guidance.click()
    await guidance.click()
    await panel.waitFor()
    assert.equal(await panel.evaluate(e => !e.inert && e === document.activeElement), true)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
  }
  await guidance.click()
  const title = page.getByTestId('manuscript-title-input')
  await title.click()
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await title.evaluate(e => e === document.activeElement), true)
  checks.push('rapid-guidance-toggle-and-outside-click-preserve-focus')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await history.click()
  assert.equal(await ledger.evaluate(e => getComputedStyle(e).animationName), 'none')
  assert.equal(await page.locator('.revision-preview-arrive').evaluate(e => getComputedStyle(e).animationName), 'none')
  await page.keyboard.press('Escape')
  await ledger.waitFor({ state: 'hidden' })
  await guidance.click()
  assert.equal(await panel.evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await page.keyboard.press('Escape')
  checks.push('reduced-motion-disables-history-and-guidance-effects')
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForFunction(() => innerWidth <= 900)
  await history.click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('03-history-compact')
  await page.keyboard.press('Escape')
  await ledger.waitFor({ state: 'hidden' })
  await guidance.click()
  const bounds = await panel.boundingBox()
  assert.equal(await page.evaluate(bounds => bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= innerWidth + 1 && bounds.y + bounds.height <= innerHeight + 1, bounds), true)
  await capture('04-guidance-compact')
  checks.push('compact-125-percent-overlays-stay-within-viewport')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  checks.push('manuscript-files-byte-identical')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error)
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video()
  await app.close()
  if (video) await copyFile(await video.path(), join(output, 'writing-overlays.webm'))
}
