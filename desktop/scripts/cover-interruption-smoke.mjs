import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-cover-interruption-')))
const output = resolve(process.env.COVER_INTERRUPTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-cover-interruption-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(30000)
const checks = [], errors = []
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function observe() {
  await page.evaluate(() => {
    window.motionObserver?.disconnect(); window.motionEvents = []
    window.motionObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
        for (const selector of ['[data-testid="workspace-loading"]', '[data-testid="library-cover-flight"]']) {
          const found = node.matches(selector) ? node : node.querySelector(selector)
          if (found) window.motionEvents.push({ selector, path: found.getAttribute('data-project-path') })
        }
      }
    }); window.motionObserver.observe(document.body, { childList: true, subtree: true })
  })
}
async function waitEntry(book) {
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()
}
async function library() {
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('project-library').waitFor()
  await page.getByTestId('library-all-works').click()
  await page.locator('.library-overview-panel').evaluate(async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)) })
}
const open = book => page.locator('.work-item-open').filter({ hasText: book.title }).click()
try {
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.show(); win.focus() })
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  })
  const books = await page.evaluate(async root => {
    const api = window.novelDesktop, result = []
    for (const title of ['星河档案', '雾海来信', '长夜航行', '纸上的城市', '群山之间', '未完成的世界']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, title })
      const chapter = await api.chapters.create(), content = `${title}：这份正文必须保持原样。`
      await api.chapters.update(chapter.id, { title: '第一章', content, expectedRevision: chapter.revision })
      result.push({ ...project, content })
    }
    return result
  }, root)
  const bodies = []
  for (const book of books) for (const name of await readdir(join(book.path, '正文'))) {
    if (name.endsWith('.md')) { const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) }) }
  }
  assert.equal(bodies.length, 6)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  await page.locator('.library-overview-panel').evaluate(async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)) })
  async function holdFlight(book) {
    await open(book)
    await page.getByTestId('library-cover-flight').waitFor()
    const held = await page.getByTestId('library-cover-flight').evaluate(e => {
      const animation = e.getAnimations()[0]
      if (!animation) return false
      animation.pause(); animation.currentTime = 150
      window.heldCover = animation
      window.heldTarget = document.querySelector('[data-cover-in-flight]')
      return !!window.heldTarget && window.heldTarget.isConnected && e.inert
    })
    assert.equal(held, true)
    await waitEntry(book)
    assert.equal(await page.getByTestId('library-cover-flight').getAttribute('data-project-path'), book.path)
  }
  async function cleared() {
    await page.getByTestId('library-cover-flight').waitFor({ state: 'detached' })
    assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
    assert.equal(await page.evaluate(() => !window.heldTarget?.hasAttribute('data-cover-in-flight')), true)
  }
  await holdFlight(books[0])
  const unrelated = await page.evaluate(async () => {
    // A renderer scroll event from outside the target's ancestry must be ignored.
    document.querySelector('.workbench').dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)
    return !!document.querySelector('[data-testid="library-cover-flight"]')
  })
  assert.equal(unrelated, true)
  checks.push('unrelated-workbench-scroll-does-not-interrupt-held-cover')
  const scrolled = await page.evaluate(async () => {
    const strip = document.querySelector('.book-tabs-scroll')
    // Constrain this real strip to reproduce overflow without opening many books.
    strip.style.maxWidth = '80px'
    const before = window.heldTarget.getBoundingClientRect().left
    strip.scrollLeft = 24
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    return { scroll: strip.scrollLeft, moved: window.heldTarget.getBoundingClientRect().left !== before,
      flight: !!document.querySelector('[data-testid="library-cover-flight"]'), hidden: window.heldTarget.hasAttribute('data-cover-in-flight') }
  })
  assert.ok(scrolled.scroll > 0 && scrolled.moved)
  assert.equal(scrolled.flight, false, 'destination scroll must retire the stale flight')
  assert.equal(scrolled.hidden, false)
  await cleared()
  await page.evaluate(() => document.querySelector('.book-tabs-scroll').style.removeProperty('max-width'))
  await capture('01-target-restored-after-scroll')
  checks.push('real-target-strip-scroll-restores-cover-and-cancels-stale-flight')

  await library()
  await open(books[1])
  await page.getByTestId('workspace-loading').waitFor()
  await page.getByTestId('cancel-workspace-loading').click()
  await page.getByTestId('project-library').waitFor()
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  await page.getByTestId('library-all-works').click()
  await open(books[1]); await waitEntry(books[1])
  await page.getByTestId('library-cover-flight').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  checks.push('cancelled-opening-and-explicit-retry-preserve-entry-and-cleanup')

  await library(); await holdFlight(books[2])
  await page.locator('[data-book-tab]').filter({ hasText: books[0].title }).click()
  await waitEntry(books[0]); await cleared()
  assert.equal(await page.getByTestId('manuscript-input').evaluate(e => e.textContent.includes('这份正文必须保持原样')), true)
  checks.push('switching-to-another-open-work-releases-old-flight-with-editor-ready')

  await library(); await holdFlight(books[3])
  await page.evaluate(() => window.heldCover.cancel())
  await cleared()
  await waitEntry(books[3])
  checks.push('cancelled-animation-promise-restores-current-target')

  await library(); await holdFlight(books[4])
  await owner.evaluate(win => win.setContentSize(1200, 800))
  await cleared(); await waitEntry(books[4])
  checks.push('native-resize-interruption-leaves-no-hidden-cover')

  // Keep the final cold destination visible after the narrow-window scenario.
  // An offscreen target correctly skips the decorative cover flight.
  for (const book of books.slice(0, 4)) {
    await page.getByRole('button', { name: `关闭《${book.title}》标签`, exact: true }).click()
    await page.getByRole('button', { name: `关闭《${book.title}》标签`, exact: true }).waitFor({ state: 'detached' })
  }
  await library(); await observe(); await open(books[5]); await waitEntry(books[5])
  await page.getByTestId('library-cover-flight').waitFor({ state: 'detached' })
  assert.ok((await page.evaluate(() => window.motionEvents)).some(event => event.path === books[5].path))
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  await capture('02-later-entry-completed')
  checks.push('later-cold-entry-still-flies-and-finishes-normally')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  assert.deepEqual(errors, [])
  checks.push('six-manuscripts-byte-identical-and-no-renderer-errors')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, scrolled, errors, root }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  await app.close()
}
