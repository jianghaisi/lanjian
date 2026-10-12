import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-gallery-feedback-')))
const output = resolve(process.env.GALLERY_FEEDBACK_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-gallery-feedback-native')
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
  await page.getByTestId('library-all-works').click()
  const manage = page.getByRole('button', { name: `管理作品《${books[0].title}》`, exact: true })
  const menu = page.locator('.library-card-menu:not([inert])')
  const search = page.getByRole('searchbox', { name: '搜索作品' })
  await manage.click()
  await menu.waitFor()
  assert.equal(await menu.locator('button').first().evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('ArrowDown')
  assert.equal(await menu.locator('button').last().evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Home')
  assert.equal(await menu.locator('button').first().evaluate(e => e === document.activeElement), true)
  await menu.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
  assert.equal(await manage.getAttribute('aria-expanded'), 'true')
  await capture('01-menu-keyboard')
  await menu.evaluate(e => { window.retiringMenu = e })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.retiringMenu.inert && window.retiringMenu.getAttribute('aria-hidden') === 'true')
  assert.equal(await manage.evaluate(e => e === document.activeElement), true)
  checks.push('menu-keyboard-initial-focus-navigation-ime-and-inert-exit')
  for (let index = 0; index < 3; index++) {
    await manage.click()
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await manage.click()
    await menu.waitFor()
    assert.equal(await menu.locator('button').first().evaluate(e => e === document.activeElement), true)
    await search.focus()
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await search.evaluate(e => e === document.activeElement), true)
  }
  checks.push('rapid-menu-reopen-and-focus-dismissal')
  await page.evaluate(() => { window.originalCards = [...document.querySelectorAll('.work-card')]; window.cardPositions = window.originalCards.map(e => ({ left: e.offsetLeft, top: e.offsetTop })) })
  await search.fill('无此作品')
  await page.waitForFunction(() => window.originalCards.every(e => e.inert && e.getAttribute('aria-hidden') === 'true'))
  const positions = await page.evaluate(() => ({ before: window.cardPositions, after: window.originalCards.map(e => ({ left: parseFloat(e.style.left), top: parseFloat(e.style.top) })) }))
  assert.deepEqual(positions.after, positions.before, 'departing cards retain distinct pre-filter positions')
  await page.locator('.works-empty-state').waitFor()
  assert.equal(await page.locator('.works-result-count').textContent(), '00')
  assert.match(await page.locator('.works-empty-state').innerText(), /没有找到匹配的作品/)
  assert.equal(await search.evaluate(e => e === document.activeElement), true)
  await capture('02-search-empty')
  await page.waitForFunction(() => !document.querySelector('.archive-list-leave-active,.gallery-empty-enter-active'))
  await capture('02-search-empty-settled')
  await page.locator('.works-empty-state').evaluate(e => { window.retiringEmpty = e })
  await search.fill('星河')
  await page.waitForFunction(() => window.retiringEmpty.inert)
  await page.waitForFunction(() => document.querySelectorAll('.work-card:not([inert])').length === 1)
  assert.equal(await page.locator('.work-card:not([inert])').getAttribute('data-project-title'), books[0].title)
  for (const value of ['', '雾海', '无此作品', '', '星河', '']) await search.fill(value)
  await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 3 && [...document.querySelectorAll('.work-card')].every(e => !e.inert))
  assert.equal(await page.locator('.works-result-count').textContent(), '03')
  await capture('03-results-restored')
  checks.push('filter-exits-inert-empty-feedback-and-rapid-restoration')
  await manage.click()
  await page.getByRole('button', { name: '列表显示', exact: true }).click()
  await menu.waitFor({ state: 'hidden' })
  await page.getByLabel('作品排序', { exact: true }).selectOption('title')
  await manage.click()
  await page.locator('.all-works-surface').dispatchEvent('scroll')
  await menu.waitFor({ state: 'hidden' })
  checks.push('layout-sort-and-scroll-dismiss-stale-menu')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await manage.click()
  assert.equal(await menu.evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await page.keyboard.press('Escape')
  await search.fill('无此作品')
  await page.locator('.works-empty-state').waitFor()
  assert.equal(await page.locator('.works-empty-state').evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  assert.equal(await page.locator('.works-result-count').evaluate(e => getComputedStyle(e).animationName), 'none')
  await search.fill('')
  checks.push('reduced-motion-suppresses-menu-empty-count-effects')
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForFunction(() => innerWidth <= 900)
  await manage.click()
  const bounds = await menu.boundingBox()
  assert.equal(await page.evaluate(bounds => bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= innerWidth + 1 && bounds.y + bounds.height <= innerHeight + 1, bounds), true)
  await capture('04-compact-menu')
  await owner.evaluate(win => win.setContentSize(1200, 800))
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  checks.push('compact-menu-bounds-and-resize-dismissal')
  for (const item of bodies) assert.deepEqual(await readFile(item.path), item.bytes)
  checks.push('three-manuscript-files-byte-identical')
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
  if (video) await copyFile(await video.path(), join(output, 'gallery-feedback.webm'))
}
