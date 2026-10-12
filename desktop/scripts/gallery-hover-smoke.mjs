import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-gallery-hover-')))
const output = resolve(process.env.GALLERY_HOVER_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-gallery-hover-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], samples = [], errors = []
page.on('pageerror', error => errors.push(error.message))
async function capture(name) {
  await writeFile(join(output, `${name}.png`), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
}
try {
  await owner.evaluate(win => { win.unmaximize(); win.setContentSize(1440, 900); win.show(); win.focus() })
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  })
  const books = await page.evaluate(async root => {
    const books = [], api = window.novelDesktop
    for (const title of ['星河档案', '雾海来信', '长夜航行']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, title })
      const chapter = await api.chapters.create()
      await api.chapters.update(chapter.id, { title: '第一章', content: `${title}：悬停动画不改变正文。`, expectedRevision: chapter.revision })
      books.push(project)
    }
    return books
  }, root)
  const bodies = []
  for (const book of books) for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name)
    bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map(a => a.finished))
    window.hoverCards = [...document.querySelectorAll('.work-card')]
  })
  const card = page.locator('.work-card').nth(1)
  const sample = () => card.evaluate(e => ({ top: e.getBoundingClientRect().top, transform: getComputedStyle(e).transform,
    translate: getComputedStyle(e).translate, hovered: e.matches(':hover'), accent: getComputedStyle(e, '::after').width }))
  async function settleCard() {
    await card.evaluate(async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)) })
  }
  async function holdLayout(label) {
    // Controlled endpoint sampling exposes a handoff jump that an endpoint screenshot misses.
    const count = await page.evaluate(async label => {
      document.querySelector(`[aria-label="${label}"]`).click()
      await new Promise(requestAnimationFrame)
      window.hoverRuns = window.hoverCards.flatMap(e => e.getAnimations().filter(a => a.constructor.name === 'Animation'))
      for (const animation of window.hoverRuns) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) - 1 }
      await new Promise(requestAnimationFrame)
      return window.hoverRuns.length
    }, label)
    assert.ok(count > 0)
    assert.ok(await card.evaluate(e => e.getAnimations().some(a => a.constructor.name === 'Animation')), 'sampled card participates in reflow')
    await card.hover({ position: { x: 30, y: 35 } })
    await card.evaluate(async e => { await Promise.allSettled(e.getAnimations().filter(a => a.constructor.name !== 'Animation').map(a => a.finished)) })
  }
  await card.hover({ position: { x: 30, y: 35 } })
  await settleCard()
  await holdLayout('列表显示')
  assert.equal((await sample()).hovered, true)
  const before = await sample()
  await page.evaluate(async () => { window.hoverRuns.forEach(a => a.finish()); await new Promise(requestAnimationFrame) })
  await settleCard()
  const after = await sample()
  samples.push({ before, after, endpointJump: Math.abs(after.top - before.top) })
  assert.ok(Math.abs(after.top - before.top) < .5, 'hovered card must not jump when reflow releases transform')
  checks.push('hovered-reflow-endpoint-handoff-under-half-a-css-pixel')
  await capture('01-hovered-list')

  await holdLayout('网格显示')
  const raised = await sample()
  await page.mouse.move(8, 8)
  // Keep the reflow paused while the independent pointer transition completes.
  await card.evaluate(async e => { await Promise.allSettled(e.getAnimations().filter(a => a.constructor.name !== 'Animation').map(a => a.finished)) })
  const departed = await sample()
  samples.push({ raised, departed })
  assert.equal(departed.hovered, false)
  assert.ok(departed.top - raised.top > 1, 'pointer departure responds even during paused layout motion')
  await page.evaluate(() => window.hoverRuns.forEach(a => a.finish()))
  await settleCard()
  checks.push('pointer-lift-and-return-compose-with-running-layout-transform')

  const idle = await sample()
  await card.locator('.work-card-main').focus()
  await settleCard()
  const focused = await sample()
  samples.push({ idle, focused })
  assert.ok(Math.abs(focused.top - idle.top) < .5)
  assert.ok(parseFloat(focused.accent) > parseFloat(idle.accent) + 1)
  assert.equal(await card.locator('.work-card-main').evaluate(e => e === document.activeElement), true)
  await capture('02-keyboard-focus')
  checks.push('keyboard-focus-emphasis-without-moving-target-or-losing-focus')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await card.hover({ position: { x: 30, y: 35 } })
  assert.equal((await sample()).translate, 'none')
  const reduced = await card.evaluate(e => ({ transition: getComputedStyle(e).transitionDuration, accentTransition: getComputedStyle(e, '::after').transitionDuration }))
  assert.equal(reduced.transition, '0s')
  assert.equal(reduced.accentTransition, '0s')
  await page.getByRole('button', { name: '列表显示', exact: true }).click()
  assert.equal(await page.evaluate(() => window.hoverCards.every(e => e.isConnected && !e.getAnimations().some(a => a.constructor.name === 'Animation'))), true)
  checks.push('reduced-motion-keeps-emphasis-without-lift-or-reflow')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForFunction(() => innerWidth <= 900)
  await card.hover({ position: { x: 30, y: 35 } })
  await settleCard()
  assert.equal((await sample()).hovered, true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('03-compact-hover')
  checks.push('compact-125-percent-hover-keeps-horizontal-containment')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  assert.deepEqual(errors, [])
  checks.push('three-manuscripts-byte-identical-and-no-renderer-errors')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  await app.close()
}
