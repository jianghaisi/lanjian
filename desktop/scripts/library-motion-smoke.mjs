import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-library-motion-')))
const output = resolve(process.env.LIBRARY_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-library-motion-native-final')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
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
  await page.waitForTimeout(700)
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
  await capture('01-library-reveal')
  await page.getByTestId('library-all-works').click(); await page.waitForTimeout(700)
  await page.evaluate(() => { window.originalCard = document.querySelector('.work-card') })
  await page.getByRole('button', { name: '列表显示', exact: true }).click()
  await page.waitForTimeout(100); await capture('02-list-in-flight')
  assert.equal(await page.evaluate(() => window.originalCard === document.querySelector('.work-card')), true)
  await page.getByRole('button', { name: '网格显示', exact: true }).click()
  await page.getByRole('button', { name: '列表显示', exact: true }).click()
  await page.getByRole('button', { name: '网格显示', exact: true }).click()
  await page.waitForTimeout(600)
  assert.equal(await page.locator('.work-card').count(), 6)
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.work-card')].some(e => e.getAnimations().some(a => a.playState === 'running'))), false)
  await page.getByLabel('作品排序', { exact: true }).selectOption('title')
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('雾海')
  await page.waitForTimeout(500); assert.equal(await page.locator('.work-card').count(), 1)
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('不存在的书')
  await page.waitForTimeout(400); assert.equal(await page.locator('.work-card').count(), 0)
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('')
  await page.waitForTimeout(500); assert.equal(await page.locator('.work-card').count(), 6)
  await capture('03-grid-restored')
  const manage = page.getByRole('button', { name: `管理作品《${books[0].title}》` })
  await manage.click(); await page.keyboard.press('Escape'); assert.equal(await manage.evaluate(e => e === document.activeElement), true)
  await manage.click(); await page.getByRole('searchbox', { name: '搜索作品' }).fill('雾海')
  await page.waitForTimeout(300); assert.equal(await page.locator('.library-card-menu').count(), 0)
  await page.getByRole('searchbox', { name: '搜索作品' }).fill(''); await page.waitForTimeout(400)
  checks.push('keyed-grid-list-rapid-interruption-sort-search-empty-and-menu-focus')

  await observe(); await open(books[0]); await waitEntry(books[0])
  await capture('04-workspace-arrival'); await page.waitForTimeout(800)
  const coldEvents = await page.evaluate(() => window.motionEvents)
  assert.ok(coldEvents.some(e => e.selector.includes('workspace-loading')))
  assert.ok(coldEvents.some(e => e.path === books[0].path), JSON.stringify(coldEvents))
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  assert.equal(await page.getByTestId('library-cover-flight').count(), 0)
  checks.push('cold-entry-real-cover-identity-and-cleanup-with-editor-accessible')
  await page.waitForTimeout(1000); await library(); await observe(); await open(books[0]); await waitEntry(books[0]); await page.waitForTimeout(800)
  assert.deepEqual(await page.evaluate(() => window.motionEvents), [])
  checks.push('warm-return-has-no-loader-or-cover-replay')

  await library(); await page.emulateMedia({ reducedMotion: 'reduce' }); await observe(); await open(books[1]); await waitEntry(books[1]); await page.waitForTimeout(700)
  assert.ok(!(await page.evaluate(() => window.motionEvents)).some(e => e.path))
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  checks.push('reduced-motion-cold-entry-no-cover-flight')
  await library(); await page.emulateMedia({ reducedMotion: 'no-preference' })
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForTimeout(600); await page.getByRole('button', { name: '列表显示', exact: true }).click(); await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('05-compact-list')
  checks.push('compact-125-percent-gallery-without-horizontal-overflow')

  await open(books[3]); await page.getByTestId('library-cover-flight').waitFor()
  await owner.evaluate(win => win.setContentSize(1200, 800))
  await page.getByTestId('library-cover-flight').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  await waitEntry(books[3])
  checks.push('resize-during-cover-flight-restores-target-and-editor')
  await library(); await observe(); await open(books[2]); await page.getByTestId('workspace-loading').waitFor()
  await page.getByTestId('cancel-workspace-loading').click()
  await page.getByTestId('project-library').waitFor(); await page.waitForTimeout(1000)
  assert.ok(!(await page.evaluate(() => window.motionEvents)).some(e => e.path))
  assert.equal(await page.locator('[data-cover-in-flight]').count(), 0)
  checks.push('cancelled-opening-clears-optional-transfer')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  checks.push('all-six-manuscript-files-byte-identical')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error)
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video(); await app.close()
  if (video) await copyFile(await video.path(), join(output, 'library-motion.webm'))
}
