import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-export-motion-')))
const output = resolve(process.env.EXPORT_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-export-motion-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = [], samples = {}
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  // Request a fresh renderer capture; capturePage can return an earlier frame
  // immediately after a reduced-motion mount in this Electron runtime.
  await page.screenshot({ animations: 'allow' })
  // Electron zoom and Windows display scaling can clip a CDP screenshot.
  // After its paint flush, capture the full native content surface.
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
    const { project } = await window.novelDesktop.projects.create({ parentPath: root, name: '导出动效验证', title: '导出动效验证' })
    for (let i = 1; i <= 3; i++) {
      const chapter = await window.novelDesktop.chapters.create()
      await window.novelDesktop.chapters.update(chapter.id, { title: `章节${i}`, content: `第${i}章：导出动效不得修改正文。`, expectedRevision: chapter.revision })
    }
    return project
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) })
  }
  assert.equal(bodies.length, 3)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.getByTestId('manuscript-input').waitFor(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  const dialog = page.getByTestId('manuscript-export-dialog'), transfer = page.getByTestId('chapter-transfer-toggle')
  async function open() {
    await transfer.click(); await page.getByTestId('export-manuscript-in-book').click()
    await page.locator('.manuscript-export-dialog[open]').waitFor()
  }
  async function settle() {
    await dialog.evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)) })
  }
  await open(); await settle()
  assert.equal(await page.getByTestId('export-select-all').evaluate(e => e === document.activeElement), true)
  assert.equal(await dialog.locator('[data-export-chapter]:checked').count(), 1)
  await dialog.evaluate(e => { window.retainedExportChapter = e.querySelector('[data-export-chapter]') })
  await page.getByTestId('export-select-all').click()
  assert.equal(await dialog.locator('[data-export-chapter]:checked').count(), 3)
  await page.getByTestId('export-clear').click()
  assert.equal(await page.getByTestId('export-confirm').isDisabled(), true)
  await dialog.locator('[data-export-chapter]').first().focus(); await page.keyboard.press('Space')
  assert.equal(await dialog.locator('[data-export-chapter]:checked').count(), 1)
  assert.equal(await dialog.evaluate(e => e.querySelector('[data-export-chapter]') === window.retainedExportChapter), true)
  assert.equal(await dialog.locator('.export-chapter').first().evaluate(e => getComputedStyle(e).transitionProperty), 'background-color')
  checks.push('chapter-selection-feedback-keeps-inputs-and-keyboard-selection-authoritative')
  await capture('01-selection')
  await dialog.evaluate(e => {
    e.addEventListener('close', () => requestAnimationFrame(() => {
      getComputedStyle(e).opacity
      for (const a of e.getAnimations()) { a.pause(); a.currentTime = 70 }
      const css = getComputedStyle(e)
      window.exportExit = { open: e.open, opacity: Number(css.opacity), display: css.display, direction: css.flexDirection,
        pointer: css.pointerEvents, backdropPointer: getComputedStyle(e, '::backdrop').pointerEvents }
      window.retainedExportChapter.focus()
      window.exportExit.rejectsFocus = !e.contains(document.activeElement)
    }), { once: true })
  })
  await page.getByRole('button', { name: '关闭批量导出', exact: true }).click()
  await page.waitForFunction(() => !!window.exportExit)
  samples.exit = await page.evaluate(() => window.exportExit)
  assert.equal(samples.exit.open, false); assert.equal(samples.exit.display, 'flex'); assert.equal(samples.exit.direction, 'column')
  assert.ok(samples.exit.opacity > 0 && samples.exit.opacity < 1)
  assert.equal(samples.exit.pointer, 'none'); assert.equal(samples.exit.backdropPointer, 'none'); assert.equal(samples.exit.rejectsFocus, true)
  assert.equal(await transfer.evaluate(e => e === document.activeElement), true)
  checks.push('native-exit-retains-column-layout-restores-focus-and-rejects-retiring-input')
  await open()
  samples.reopen = await dialog.evaluate(e => {
    const value = { retained: window.retainedExportChapter === e.querySelector('[data-export-chapter]'), modal: e.matches(':modal'), opacity: Number(getComputedStyle(e).opacity) }
    for (const a of e.getAnimations()) a.finish()
    return value
  })
  assert.equal(samples.reopen.retained, true); assert.equal(samples.reopen.modal, true)
  await settle()
  assert.equal(await dialog.locator('[data-export-chapter]:checked').count(), 1)
  checks.push('mid-exit-reopen-reuses-controls-and-reinitializes-current-chapter')
  // Exercise the browser's queued close event before it can dispatch.
  samples.lateClose = await dialog.evaluate(async e => {
    e.close(); e.showModal()
    const destination = e.querySelector('[data-testid="export-clear"]')
    destination.focus()
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    return { open: e.open, retainedFocus: document.activeElement === destination }
  })
  assert.equal(samples.lateClose.open, true); assert.equal(samples.lateClose.retainedFocus, true)
  await settle()
  await page.keyboard.press('Escape'); await settle()
  assert.equal(await transfer.evaluate(e => e === document.activeElement), true)
  checks.push('queued-native-close-event-cannot-steal-new-open-focus')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open()
  samples.reduced = await dialog.evaluate(e => ({ duration: getComputedStyle(e).transitionDuration, effects: e.getAnimations().length }))
  assert.equal(samples.reduced.duration, '0s'); assert.equal(samples.reduced.effects, 0)
  await page.getByTestId('export-select-all').click(); await page.getByTestId('export-clear').click()
  assert.equal(await dialog.locator('[data-export-chapter]:checked').count(), 0)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.evaluate(e => getComputedStyle(e).display), 'none')
  checks.push('reduced-motion-selection-and-close-remain-immediate')
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await open()
  samples.compact = await dialog.evaluate(e => {
    const r = e.getBoundingClientRect(), button = e.querySelector('.export-close'), b = button.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight,
      hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) }
  })
  assert.ok(samples.compact.left >= 0 && samples.compact.right <= samples.compact.width && samples.compact.top >= 0 && samples.compact.bottom <= samples.compact.height)
  assert.equal(samples.compact.hit, true)
  await capture('02-compact-export'); await page.keyboard.press('Escape')
  checks.push('compact-125-percent-dialog-and-close-button-stay-in-viewport')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  assert.deepEqual(errors, [])
  checks.push('three-manuscripts-byte-identical-and-no-renderer-errors')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  process.exitCode = 1
} finally { await app.close() }
