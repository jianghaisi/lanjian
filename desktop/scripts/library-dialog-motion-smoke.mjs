import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-library-dialog-motion-')))
const output = resolve(process.env.LIBRARY_DIALOG_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-library-dialog-motion-native')
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
    const { project } = await window.novelDesktop.projects.create({ parentPath: root, name: '弹窗动效验证', title: '弹窗动效验证' })
    const chapter = await window.novelDesktop.chapters.create()
    await window.novelDesktop.chapters.update(chapter.id, { title: '第一章', content: '创建和导入弹窗不得修改这份正文。', expectedRevision: chapter.revision })
    return project
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) })
  }
  assert.equal(bodies.length, 1)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const create = page.getByTestId('create-work-item')
  const form = page.locator('.create-book-modal')
  const name = page.getByPlaceholder('例如：灯火照长安')
  async function settle(selector) {
    await page.locator(selector).evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)) })
  }
  async function tabBoundary(selector) {
    await page.locator(selector).evaluate(e => {
      window.formControls = [...e.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')]
        .filter(n => n.tabIndex >= 0 && !n.matches(':disabled') && !n.closest('[inert]') && n.getClientRects().length)
      window.formControls.at(-1).focus()
    })
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.formControls[0]), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.formControls.at(-1)), true)
  }
  await create.click(); await name.waitFor(); await settle('.library-dialog-surface')
  assert.equal(await name.evaluate(e => e === document.activeElement), true)
  await name.fill('尚未建立的书名')
  await name.evaluate(e => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  assert.equal(await form.count(), 1)
  await tabBoundary('.create-book-modal')
  await capture('01-create-dialog')
  checks.push('creation-name-focus-tab-wrap-and-composing-escape')

  // A single renderer turn keeps the reversal inside Vue's real leave window.
  samples.reversal = await page.evaluate(async () => {
    const old = document.querySelector('.create-book-modal').parentElement
    window.oldCreationSurface = old
    old.querySelector('header button').click()
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const departing = { connected: old.isConnected, inert: old.inert, hidden: old.getAttribute('aria-hidden'),
      leaving: old.classList.contains('library-modal-leave-active') }
    document.querySelector('[data-testid="create-work-item"]').click()
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const live = [...document.querySelectorAll('.library-dialog-surface')].filter(e => !e.inert)
    return { departing, live: live.length, activeInside: live[0]?.contains(document.activeElement) }
  })
  assert.equal(samples.reversal.departing.connected, true)
  assert.equal(samples.reversal.departing.inert, true)
  assert.equal(samples.reversal.departing.hidden, 'true')
  assert.equal(samples.reversal.departing.leaving, true)
  assert.equal(samples.reversal.live, 1); assert.equal(samples.reversal.activeInside, true)
  await settle('.library-dialog-surface:not([inert])')
  assert.equal(await name.inputValue(), '尚未建立的书名')
  assert.equal(await page.locator('.library-dialog-surface[inert]').count(), 0)
  await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' })
  assert.equal(await create.evaluate(e => e === document.activeElement), true)
  checks.push('creation-exit-is-inert-and-rapid-reopen-preserves-draft-and-new-focus')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await create.click(); await name.waitFor()
  assert.equal(await page.locator('.library-dialog-surface').evaluate(e => e.getAnimations({ subtree: true }).length), 0)
  await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' })
  checks.push('creation-reduced-motion-no-live-effects')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.getByTestId('manuscript-input').waitFor(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  const transfer = page.getByTestId('chapter-transfer-toggle')
  async function openImport() {
    await transfer.click(); await page.getByTestId('continue-manuscript-files').click()
    await page.locator('.txt-import-modal').waitFor(); await settle('.txt-import-backdrop')
  }
  await openImport()
  const importForm = page.locator('.txt-import-modal')
  assert.equal(await importForm.getByRole('button', { name: '关闭', exact: true }).evaluate(e => e === document.activeElement), true)
  await tabBoundary('.txt-import-modal')
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  assert.equal(await importForm.count(), 1)
  await capture('02-import-dialog')
  await page.keyboard.press('Escape'); await importForm.waitFor({ state: 'detached' })
  assert.equal(await transfer.evaluate(e => e === document.activeElement), true)
  checks.push('import-entry-tab-wrap-composing-escape-and-trigger-return')
  await openImport()
  await importForm.getByRole('button', { name: '关闭', exact: true }).click()
  samples.importExit = await page.locator('.txt-import-backdrop').evaluate(e => ({ inert: e.inert, hidden: e.getAttribute('aria-hidden') }))
  assert.equal(samples.importExit.inert, true); assert.equal(samples.importExit.hidden, 'true')
  await importForm.waitFor({ state: 'detached' })
  await openImport()
  assert.equal(await page.locator('.txt-import-backdrop').evaluate(e => e.inert || e.hasAttribute('aria-hidden')), false)
  checks.push('import-click-close-retires-inertly-and-next-open-is-interactive')
  await page.keyboard.press('Escape'); await importForm.waitFor({ state: 'detached' })
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openImport()
  samples.compact = await importForm.evaluate(e => {
    const r = e.getBoundingClientRect(), c = e.querySelector('header button'), b = c.getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      hit: c.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)), animations: e.parentElement.getAnimations({ subtree: true }).length }
  })
  assert.equal(samples.compact.hit, true); assert.equal(samples.compact.animations, 0)
  assert.ok(samples.compact.left >= 0 && samples.compact.right <= samples.compact.width + 1)
  await capture('03-compact-import'); await page.keyboard.press('Escape'); await importForm.waitFor({ state: 'detached' })
  checks.push('compact-import-reduced-motion-and-visible-close-control')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  const projects = await page.evaluate(() => window.novelDesktop.projects.list())
  assert.equal(projects.projects.length, 1)
  assert.deepEqual(errors, [])
  checks.push('no-extra-project-created-manuscript-byte-identical-and-no-renderer-errors')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  process.exitCode = 1
} finally { await app.close() }
