import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-overview-motion-')))
const output = resolve(process.env.OVERVIEW_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-overview-continuity-native')
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
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
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
  const books = await page.evaluate(async root => {
    const api = window.novelDesktop, result = []
    for (const title of ['星河档案', '雾海来信', '长夜航行']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, title })
      const chapter = await api.chapters.create()
      await api.chapters.update(chapter.id, { title: '第一章', content: `${title}：这份正文保持原样。`, expectedRevision: chapter.revision })
      result.push(project)
    }
    return result
  }, root)
  const bodies = []
  for (const book of books) for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name)
    bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const expand = page.getByTestId('library-all-works')
  const back = page.getByTestId('library-all-works-back')
  const overview = page.locator('.library-overview-panel')
  const anchor = page.locator('.all-works-anchor')
  const search = page.getByRole('searchbox', { name: '搜索作品' })
  async function settleOverview() {
    await overview.evaluate(async element => { await Promise.allSettled(element.getAnimations().map(animation => animation.finished)) })
  }
  await anchor.evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished))
    window.originalGallery = element
    window.originalCards = [...element.querySelectorAll('.work-card')]
    window.galleryArrivals = 0
    element.addEventListener('animationstart', event => { if (event.target === element) window.galleryArrivals++ })
  })
  await capture('01-overview')
  const samples = await page.evaluate(async () => {
    const values = []
    document.querySelector('[data-testid="library-all-works"]').click()
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(requestAnimationFrame)
      const anchor = document.querySelector('.all-works-anchor')
      const panel = document.querySelector('.library-overview-panel')
      values.push({ top: anchor.getBoundingClientRect().top, transform: getComputedStyle(anchor).transform, height: panel.offsetHeight })
      if (frame > 1 && !panel.getAnimations().some(animation => animation.playState === 'running')) break
    }
    return values
  })
  assert.ok(samples.every(sample => sample.transform === 'none'), 'gallery translation must not restart during expansion')
  assert.ok(samples.some(sample => sample.height > 1 && sample.height < samples[0].height - 1))
  assert.equal(await overview.evaluate(e => e.inert), true)
  assert.equal(await page.locator('#all-works-title').evaluate(e => e === document.activeElement), true)
  await capture('02-expanded')
  await back.click()
  await settleOverview()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'library-all-works')
  assert.equal(await page.evaluate(() => window.galleryArrivals), 0)
  assert.equal(await anchor.evaluate(e => e === window.originalGallery), true)
  assert.equal(await page.evaluate(() => window.originalCards.every(e => e.isConnected)), true)
  checks.push('continuous-expansion-return-with-stable-cards-no-arrival-replay-and-focus')

  // Use DOM click for deliberately overlapping intents; normal clicks above exercise user paths.
  await expand.click()
  await back.evaluate(e => e.click())
  await expand.evaluate(e => e.click())
  await settleOverview()
  assert.equal(await overview.evaluate(e => e.inert), true)
  assert.equal(await page.locator('#all-works-title').evaluate(e => e === document.activeElement), true)
  await back.evaluate(e => e.click())
  await expand.evaluate(e => e.click())
  await back.evaluate(e => e.click())
  await settleOverview()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'library-all-works')
  assert.equal(await page.evaluate(() => window.galleryArrivals), 0)
  checks.push('overlapping-reversals-invalidate-old-focus-and-keep-arrival-clock')

  await expand.click()
  await back.click()
  await search.focus()
  await search.fill('星河')
  await settleOverview()
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  assert.equal(await search.inputValue(), '星河')
  await expand.click()
  await page.waitForFunction(() => document.querySelectorAll('.work-card:not([inert])').length === 1)
  assert.equal(await page.locator('.work-card:not([inert])').getAttribute('data-project-title'), books[0].title)
  await page.getByRole('button', { name: '列表显示', exact: true }).click()
  await page.getByLabel('作品排序', { exact: true }).selectOption('title')
  await back.click()
  await settleOverview()
  await expand.click()
  assert.equal(await page.getByRole('button', { name: '列表显示', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByLabel('作品排序', { exact: true }).inputValue(), 'title')
  await search.fill('')
  checks.push('return-does-not-steal-search-focus-and-retains-filter-layout-sort')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await back.click()
  await settleOverview()
  assert.equal(await overview.evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  assert.equal(await anchor.evaluate(e => getComputedStyle(e).animationName), 'none')
  assert.equal(await expand.evaluate(e => e === document.activeElement), true)
  await expand.click()
  assert.equal(await overview.evaluate(e => e.inert), true)
  checks.push('reduced-motion-immediate-state-and-correct-focus')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await back.click()
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await settleOverview()
  await page.waitForFunction(() => innerWidth <= 900)
  assert.equal(await anchor.evaluate(e => getComputedStyle(e).transform), 'none')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('03-compact-overview')
  await expand.click()
  await settleOverview()
  await capture('04-compact-expanded')
  assert.equal(await overview.evaluate(e => e.offsetHeight), 0)
  checks.push('resize-during-return-settles-compact-layout')
  for (const item of bodies) assert.deepEqual(await readFile(item.path), item.bytes)
  checks.push('three-manuscript-files-byte-identical')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, samples, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error)
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video()
  await app.close()
  if (video) await copyFile(await video.path(), join(output, 'overview-continuity.webm'))
}
