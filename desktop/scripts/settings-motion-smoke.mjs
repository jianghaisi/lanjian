import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-settings-motion-')))
const output = resolve(process.env.SETTINGS_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-settings-motion-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = [], samples = {}
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
const dialog = page.locator('dialog.library-preferences-dialog')
const settings = page.getByRole('button', { name: '设置', exact: true })
async function settleDialog() {
  await dialog.evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)) })
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
    const { project } = await window.novelDesktop.projects.create({ parentPath: root, name: '设置动效验证', title: '设置动效验证' })
    const chapter = await window.novelDesktop.chapters.create()
    await window.novelDesktop.chapters.update(chapter.id, { title: '第一章', content: '设置切换和弹窗动画不得修改这份正文。', expectedRevision: chapter.revision })
    return project
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) })
  }
  assert.equal(bodies.length, 1)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await settings.click(); await settleDialog()
  samples.open = await dialog.evaluate(e => {
    window.retainedSettingsInput = e.querySelector('[data-testid="theme-moye"]')
    return { opacity: getComputedStyle(e).opacity, translate: getComputedStyle(e).translate,
      contentAnimation: getComputedStyle(e.querySelector('.library-settings-content')).animationName,
      discrete: CSS.supports('transition-behavior', 'allow-discrete') }
  })
  assert.equal(samples.open.opacity, '1'); assert.equal(samples.open.contentAnimation, 'none'); assert.equal(samples.open.discrete, true)
  await capture('01-library-settings-open')
  // Freeze the real native close transition on the close event's next paint.
  await dialog.evaluate(e => {
    e.addEventListener('close', () => requestAnimationFrame(() => {
      window.exitSample = null
      getComputedStyle(e).opacity
      const effects = e.getAnimations()
      for (const a of effects) { a.pause(); a.currentTime = 80 }
      window.exitSample = { open: e.open, opacity: Number(getComputedStyle(e).opacity), display: getComputedStyle(e).display,
        pointer: getComputedStyle(e).pointerEvents, backdropPointer: getComputedStyle(e, '::backdrop').pointerEvents,
        transitions: effects.map(a => a.transitionProperty) }
    }), { once: true })
  })
  await page.getByRole('button', { name: '关闭外观设置', exact: true }).click()
  await page.waitForFunction(() => !!window.exitSample)
  samples.exit = await page.evaluate(() => window.exitSample)
  assert.equal(samples.exit.open, false); assert.equal(samples.exit.display, 'grid')
  assert.ok(samples.exit.opacity > 0 && samples.exit.opacity < 1)
  assert.equal(samples.exit.pointer, 'none'); assert.equal(samples.exit.backdropPointer, 'none')
  assert.equal(await settings.evaluate(e => e === document.activeElement), true)
  samples.exit.rejectsFocus = await dialog.evaluate(e => {
    window.retainedSettingsInput.focus()
    return !e.contains(document.activeElement)
  })
  assert.equal(samples.exit.rejectsFocus, true, 'retiring settings must not accept keyboard or deferred focus')
  checks.push('native-close-fades-with-immediate-focus-return-and-no-retiring-hit-targets')
  await capture('02-library-settings-mid-exit')
  await settings.click()
  samples.reopen = await dialog.evaluate(e => {
    const opacity = Number(getComputedStyle(e).opacity)
    for (const a of e.getAnimations()) a.finish()
    return { opacity, retained: e.querySelector('[data-testid="theme-moye"]') === window.retainedSettingsInput, modal: e.matches(':modal') }
  })
  assert.equal(samples.reopen.retained, true); assert.equal(samples.reopen.modal, true)
  assert.ok(samples.reopen.opacity >= samples.exit.opacity && samples.reopen.opacity < 1)
  await settleDialog()
  assert.equal(await dialog.evaluate(e => getComputedStyle(e).opacity), '1')
  checks.push('mid-exit-reopen-reverses-from-current-opacity-and-retains-settings-input')
  await page.getByTestId('theme-xuanzhi').check()
  await page.keyboard.press('Escape'); await settleDialog()
  assert.equal(await dialog.evaluate(e => getComputedStyle(e).display), 'none')
  assert.equal(await settings.evaluate(e => e === document.activeElement), true)
  await settings.click(); await settleDialog()
  assert.equal(await page.getByTestId('theme-xuanzhi').isChecked(), true)
  checks.push('escape-finishes-native-close-and-reopen-preserves-theme')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.press('Escape'); await settings.click()
  samples.reduced = await dialog.evaluate(e => ({ duration: getComputedStyle(e).transitionDuration, translate: getComputedStyle(e).translate, animations: e.getAnimations().length }))
  assert.equal(samples.reduced.duration, '0s'); assert.equal(samples.reduced.translate, 'none'); assert.equal(samples.reduced.animations, 0)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.evaluate(e => getComputedStyle(e).display), 'none')
  checks.push('reduced-motion-open-and-close-snap-without-effects')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await settings.click(); await settleDialog()
  samples.compact = await dialog.evaluate(async e => {
    const body = e.querySelector('.library-settings-content'), button = e.querySelector('header button')
    body.scrollTo({ top: body.scrollHeight, behavior: 'instant' })
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const b = button.getBoundingClientRect()
    return { scrollTop: body.scrollTop, overflow: body.scrollWidth > body.clientWidth + 1, closeHit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) }
  })
  assert.equal(samples.compact.overflow, false); assert.equal(samples.compact.closeHit, true)
  assert.ok(samples.compact.scrollTop > 100, 'compact close remains accessible after actual content scrolling')
  await capture('03-compact-settings'); await page.keyboard.press('Escape'); await settleDialog()
  checks.push('compact-125-percent-layout-keeps-close-control-and-scrolling')
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.webContents.setZoomFactor(1) })
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.getByTestId('manuscript-input').waitFor(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await settings.click(); await page.getByTestId('settings-category-common').waitFor()
  await page.getByTestId('settings-category-advanced').click()
  await page.getByTestId('settings-nav-about').click()
  await page.locator('.about-lanjian').waitFor()
  assert.match(await page.locator('.about-lanjian').evaluate(e => getComputedStyle(e).animationName), /settings-section-arrive/)
  for (const id of ['common', 'advanced', 'common', 'advanced']) await page.getByTestId(`settings-category-${id}`).click()
  assert.equal(await page.locator('.settings-category-navigation [aria-current="page"]').getAttribute('data-testid'), 'settings-category-advanced')
  await page.getByTestId('settings-category-common').focus(); await page.keyboard.press('Enter')
  assert.equal(await page.getByTestId('settings-category-common').evaluate(e => e === document.activeElement && e.getAttribute('aria-current') === 'page'), true)
  await page.locator('.settings-editor').evaluate(async e => {
    await Promise.allSettled(e.getAnimations({ subtree: true }).filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished))
  })
  await capture('04-workbench-settings')
  checks.push('workbench-section-arrival-rapid-category-reversal-and-keyboard-focus')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('settings-category-advanced').click(); await page.getByTestId('settings-nav-about').click()
  assert.equal(await page.locator('.about-lanjian').evaluate(e => getComputedStyle(e).animationName), 'none')
  assert.equal(await page.getByTestId('settings-category-advanced').evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  checks.push('workbench-reduced-motion-retains-selection-without-arrival')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  assert.deepEqual(errors, [])
  checks.push('synthetic-manuscript-byte-identical-and-no-renderer-errors')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  process.exitCode = 1
} finally { await app.close() }
