import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-gallery-departure-')))
const output = resolve(process.env.GALLERY_DEPARTURE_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-gallery-departure-native')
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
  await page.mouse.move(8, 8)
  const search = page.getByRole('searchbox', { name: '搜索作品' })
  await search.focus()
  const departure = await page.evaluate(async () => {
    const cards = window.hoverCards
    const rects = () => cards.map(e => {
      const r = e.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    const input = document.querySelector('input[aria-label="搜索作品"]')
    document.querySelector('[aria-label="列表显示"]').click()
    await new Promise(requestAnimationFrame)
    const moving = cards.flatMap(e => e.getAnimations().filter(a => a.constructor.name === 'Animation'))
    for (const animation of moving) { animation.pause(); animation.currentTime = 80 }
    const before = rects()
    input.value = '无此作品'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(requestAnimationFrame)
    const after = rects()
    const inert = cards.every(e => e.inert), leaving = cards.every(e => e.classList.contains('archive-list-leave-active'))
    // Keep consecutive intents inside one renderer call: pausing CSS does not
    // pause Vue's removal fallback timer, and a screenshot could outlive the exit.
    const repeatedBefore = rects()
    input.value = '仍无此作品'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(requestAnimationFrame)
    const repeatedAfter = rects(), stillConnected = cards.every(e => e.isConnected)
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(requestAnimationFrame)
    window.restoredCards = [...document.querySelectorAll('.work-card')]
    const incoming = window.restoredCards.flatMap(e => e.getAnimations().filter(a => a.constructor.name === 'Animation'))
    incoming.forEach(a => { a.pause(); a.currentTime = 0 })
    const reentry = window.restoredCards.map(e => {
      const r = e.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    incoming.forEach(a => a.play())
    return { before, after, moving: moving.length, inert, leaving,
      repeated: { before: repeatedBefore, after: repeatedAfter, stillConnected },
      reentry, incoming: incoming.length,
      originalPaths: cards.map(e => e.dataset.projectPath), restoredPaths: window.restoredCards.map(e => e.dataset.projectPath) }
  })
  samples.push({ departure })
  assert.ok(departure.moving > 0)
  assert.equal(departure.inert, true)
  assert.equal(departure.leaving, true)
  const delta = (a, b) => Math.max(...a.flatMap((r, index) => Object.keys(r).map(key => Math.abs(r[key] - b[index][key]))))
  assert.ok(delta(departure.before, departure.after) < 1, 'retiring cards retain their in-flight visual rectangles')
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  checks.push('mid-reflow-filter-freezes-visible-bounds-with-inert-exit-and-search-focus')
  const repeated = departure.repeated
  samples.push({ repeated })
  assert.equal(repeated.stillConnected, true, 'sample the real still-retiring cards, not detached zero rectangles')
  assert.ok(delta(repeated.before, repeated.after) < 1, 'second query must not compound or discard the frozen transform')
  checks.push('repeated-query-preserves-frozen-departure')

  assert.deepEqual(departure.restoredPaths, departure.originalPaths)
  assert.equal(departure.incoming, 3)
  assert.ok(delta(departure.repeated.after, departure.reentry) < 1, 'replacement nodes begin from the same work visual rectangle')
  await page.waitForFunction(() => document.querySelectorAll('.work-card:not([inert])').length === 3)
  const restored = await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map(a => a.finished))
    return window.restoredCards.map(e => ({ connected: e.isConnected, inert: e.inert, hidden: e.hasAttribute('aria-hidden'),
      transform: e.style.transform, width: e.style.width, height: e.style.height, left: e.style.left, top: e.style.top }))
  })
  samples.push({ restored })
  assert.ok(restored.every(e => e.connected && !e.inert && !e.hidden && !e.transform && !e.width && !e.height && !e.left && !e.top))
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  await capture('02-reinserted-list')
  checks.push('rapid-reinsertion-matches-work-path-and-visible-geometry-and-clears-exit-styles')

  await page.getByRole('combobox', { name: '作品排序' }).selectOption('title')
  await page.getByRole('button', { name: '网格显示', exact: true }).click()
  await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().map(a => a.finished)) })
  assert.equal(await page.evaluate(() => window.restoredCards.every(e => e.isConnected && !e.inert && !e.style.transform)), true)
  checks.push('sorting-and-layout-remain-usable-after-reinsertion')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await search.fill('无此作品')
  await page.waitForFunction(() => !document.querySelector('.work-card'))
  await search.fill('星河')
  await page.waitForFunction(() => document.querySelectorAll('.work-card:not([inert])').length === 1)
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  checks.push('reduced-motion-filtering-settles-with-search-focus')
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
