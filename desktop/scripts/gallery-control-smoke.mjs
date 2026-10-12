import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-gallery-control-')))
const output = resolve(process.env.GALLERY_CONTROL_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-gallery-control-native')
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
  const rail = page.locator('.display-switch-rail')
  const grid = page.getByRole('button', { name: '网格显示', exact: true })
  const list = page.getByRole('button', { name: '列表显示', exact: true })
  async function settle() {
    await rail.evaluate(async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)) })
  }
  async function alignment(button) {
    const a = await rail.boundingBox(), b = await button.boundingBox()
    assert.ok(a && b && Math.abs(a.x - b.x) < .5 && Math.abs(a.width - b.width) < .5)
  }
  await alignment(grid)
  await list.click()
  assert.equal(await list.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.all-works-surface').evaluate(e => e.classList.contains('display-list')), true)
  await settle()
  await alignment(list)
  assert.equal(await page.evaluate(() => window.hoverCards.every(e => e.isConnected)), true)
  await capture('01-list-selection')
  checks.push('real-click-updates-layout-and-pressed-state-with-aligned-decorative-rail')

  const reversal = await page.evaluate(async () => {
    const group = document.querySelector('.display-switch'), rail = group.querySelector('.display-switch-rail')
    const grid = group.querySelector('[aria-label="网格显示"]'), list = group.querySelector('[aria-label="列表显示"]')
    const left = () => rail.getBoundingClientRect().left - grid.getBoundingClientRect().left
    grid.click()
    await new Promise(requestAnimationFrame)
    await Promise.allSettled(rail.getAnimations().map(a => a.finished))
    const width = rail.getBoundingClientRect().width, values = []
    list.click()
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(requestAnimationFrame)
      values.push(left())
      if (left() > width * .25) break
    }
    const turning = left()
    grid.click()
    await new Promise(requestAnimationFrame)
    const firstReverse = left(), pressed = grid.getAttribute('aria-pressed')
    await Promise.allSettled(rail.getAnimations().map(a => a.finished))
    return { values, turning, firstReverse, end: left(), width, pressed }
  })
  samples.push({ reversal })
  assert.ok(reversal.turning > 0 && reversal.turning < reversal.width)
  assert.ok(reversal.firstReverse > 0 && reversal.firstReverse < reversal.width)
  assert.ok(Math.abs(reversal.firstReverse - reversal.turning) < reversal.width * .35)
  assert.equal(reversal.pressed, 'true')
  assert.ok(Math.abs(reversal.end) < .5)
  checks.push('rapid-reversal-interpolates-from-in-flight-position')

  await list.focus()
  await page.keyboard.press('Enter')
  await settle()
  await alignment(list)
  assert.equal(await list.evaluate(e => e === document.activeElement), true)
  await grid.focus()
  await page.keyboard.press('Space')
  await settle()
  await alignment(grid)
  assert.equal(await grid.evaluate(e => e === document.activeElement), true)
  await capture('02-keyboard-grid')
  checks.push('native-enter-space-activation-retains-focus-and-pressed-semantics')

  const bounds = await list.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await list.locator('svg').evaluate(async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)) })
  const scale = await list.locator('svg').evaluate(e => getComputedStyle(e).scale)
  assert.ok(parseFloat(scale) < .95)
  await alignment(grid)
  await capture('03-press-feedback')
  await page.mouse.up()
  await settle()
  await alignment(list)
  checks.push('icon-press-feedback-does-not-move-button-or-commit-selection-before-release')

  const search = page.getByRole('searchbox', { name: '搜索作品' })
  await search.fill('不存在的档案')
  await page.locator('.works-empty-state').waitFor()
  assert.equal(await list.getAttribute('aria-pressed'), 'true')
  await alignment(list)
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  await search.fill('')
  await page.waitForFunction(() => document.querySelectorAll('.work-card:not([inert])').length === 3)
  checks.push('empty-search-does-not-reset-layout-control-or-steal-focus')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await grid.click()
  assert.equal(await rail.evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await alignment(grid)
  const reducedBounds = await list.boundingBox()
  await page.mouse.move(reducedBounds.x + reducedBounds.width / 2, reducedBounds.y + reducedBounds.height / 2)
  await page.mouse.down()
  assert.equal(await list.locator('svg').evaluate(e => getComputedStyle(e).scale), 'none')
  await page.mouse.up()
  await alignment(list)
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForFunction(() => innerWidth <= 900)
  await alignment(list)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('04-compact-reduced-motion')
  checks.push('reduced-motion-snaps-and-125-percent-zoom-keeps-alignment')

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
