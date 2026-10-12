import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const probe = process.argv.includes('--probe')
const root = await mkdtemp(join(tmpdir(), 'lanjian-hero-layout-'))
const profile = join(root, 'profile'), output = resolve(`artifacts/ui/library-hero-layout/${probe ? 'before' : 'after'}`)
await mkdir(output, { recursive: true })
const service = new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
const titles = ['星城少年们的日常录', '三千盏星灯，他们都叫我主公', '超长书名回归：在遥远的群星之间寻找最后一座城市与那些尚未写完的故事']
const books = [], files = []
for (const title of titles.slice(0, probe ? 2 : 3)) {
  const project = (await service.create({ parentPath: root, title })).project
  const path = join(project.path, '正文', '第1章-隔离章节.md')
  const body = probe ? '仅用于尺寸回归的合成正文，不是作者书稿。' : '仅用于尺寸回归的合成正文。'.repeat(9000)
  await writeFile(path, body); files.push({ path, body }); books.push(project)
}
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE; delete env.LANJIAN_SMOKE
let app, page, mainWindow
const results = [], errors = [], checks = []
const views = probe ? [{ width: 1920, height: 1000, zoom: 1, theme: 'moye' }] : [
  { width: 1920, height: 1000, zoom: 1, theme: 'moye' },
  { width: 1360, height: 800, zoom: 1, theme: 'moye' },
  { width: 1360, height: 800, zoom: .8, theme: 'moye' },
  { width: 1920, height: 1000, zoom: 1.25, theme: 'qingzhou' },
  { width: 1440, height: 900, zoom: 1.25, theme: 'xuanzhi' },
  { width: 1100, height: 760, zoom: 1.25, theme: 'moye' },
]
async function view(value) {
  await mainWindow.evaluate((window, value) => {
    window.unmaximize(); window.setContentSize(value.width, value.height)
    window.webContents.setZoomFactor(value.zoom)
  }, value)
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, value.theme)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(750)
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(Math.abs(actual.width - value.width / value.zoom) < 3 && Math.abs(actual.height - value.height / value.zoom) < 3, `requested viewport/zoom actually applied: ${JSON.stringify({ value, actual })}`)
}
async function measure() {
  return page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
    const pick = selector => rect(document.querySelector(selector))
    const hero = document.querySelector('.continue-dossier'), overview = document.querySelector('.library-overview-panel')
    const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
    const contained = (inner, outer) => inner.left >= outer.left - 2 && inner.right <= outer.right + 2 && inner.top >= outer.top - 2 && inner.bottom <= outer.bottom + 2
    const bounds = rect(hero), clip = rect(overview)
    const content = [...hero.querySelectorAll('header strong,h2,.dossier-copy>p,.dossier-data-row b,.dossier-progress>i,.dossier-copy footer,.library-book-cover')].filter(visible).map(node => ({ tag: node.className || node.tagName, rect: rect(node), contained: contained(rect(node), bounds) && contained(rect(node), clip), overflow: /hidden|clip/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2, hint: node.getAttribute('title') }))
    const actions = [...document.querySelectorAll('.archive-action')].map(node => {
      const r = rect(node), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      return { text: node.textContent.trim(), rect: r, contained: contained(r, clip), hit: !!hit && node.contains(hit), textFits: [...node.querySelectorAll('strong,small')].every(label => label.scrollWidth <= label.clientWidth + 2) }
    })
    return { title: hero.querySelector('h2').textContent, viewport: { width: innerWidth, height: innerHeight }, rootSize: getComputedStyle(document.documentElement).fontSize, hero: bounds, overview: clip, gallery: pick('.all-works-anchor'), content, actions, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
  })
}
async function screenshot(name) {
  // Electron zoom changes devicePixelRatio; capture the owned native viewport,
  // not Playwright's cached screenshot clip from the previous zoom level.
  const capture = await mainWindow.evaluate(async window => {
    const image = await window.webContents.capturePage()
    return { size: image.getSize(), empty: image.isEmpty(), png: image.toPNG().toString('base64') }
  })
  const expected = await page.evaluate(() => ({ width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio }))
  assert.equal(capture.empty, false, 'native screenshot is not empty')
  assert.ok(Math.abs(capture.size.width - expected.width) < 3 && Math.abs(capture.size.height - expected.height) < 3, 'native screenshot covers the entire zoomed viewport')
  await writeFile(join(output, name), Buffer.from(capture.png, 'base64'))
}
try {
  app = await _electron.launch({ args: ['.'], env, timeout: 30000 })
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  mainWindow = await app.browserWindow(page)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false, proactive: false, subtitles: true })))
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'visible' })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 15000 })
  for (let index = 0; index < books.length; index++) {
    const book = books[index]
    await view(views[0])
    await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
    await page.locator('.project-title-return').waitFor()
    await page.getByTestId('workspace-loading').waitFor({ state: 'detached' })
    await page.locator('.project-title-return').click()
    await page.waitForFunction(title => document.querySelector('.continue-dossier h2')?.textContent === title, book.title)
    for (const [v, value] of views.entries()) {
      await view(value)
      const result = { book: index, view: value, ...await measure() }; results.push(result)
      await screenshot(`book-${index}-view-${v}.png`)
      console.log(JSON.stringify({ book: index, view: v, hero: result.hero.height, overview: result.overview.height, clipped: result.content.filter(c => !c.contained).map(c => c.tag), actions: result.actions.map(a => a.contained && a.hit && a.textFits) }))
      if (!probe) {
        assert.equal(result.documentOverflow, false, 'no horizontal document overflow')
        assert.ok(result.content.every(c => c.contained), 'all visible core content remains inside the card and its ancestor')
        assert.ok(result.content.every(c => !c.overflow || c.hint || c.tag.startsWith('library-book-cover')), 'truncated text retains a full-text hint')
        assert.ok(result.content.some(c => c.tag === 'FOOTER'), 'last-edit information remains visible at compact heights')
        assert.ok(result.actions.every(a => a.contained && a.hit && a.textFits), 'four complete, readable, hit-testable entries')
        assert.ok(result.hero.bottom <= result.gallery.top + 2, 'gallery does not cover the hero')
        if (index > 0) {
          const first = results.find(r => r.book === 0 && JSON.stringify(r.view) === JSON.stringify(value))
          assert.ok(Math.abs(result.hero.height - first.hero.height) < 2, 'book title does not alter card height')
        }
      }
    }
  }
  if (!probe) {
    await view(views[0]); const before = await measure()
    await page.getByTestId('library-all-works').click(); await page.waitForTimeout(800)
    assert.ok((await page.locator('.library-overview-panel').boundingBox()).height < 1)
    const back = page.getByRole('button', { name: /返回.*概览/ })
    await back.click(); await page.waitForTimeout(800)
    const after = await measure()
    assert.ok(Math.abs(before.overview.height - after.overview.height) < 2)
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'library-all-works')
    checks.push('all-works-collapse-and-return-height-focus')
    await screenshot('returned-overview.png')
  }
  for (const file of files) assert.equal(await readFile(file.path, 'utf8'), file.body)
  assert.deepEqual(errors, []); checks.push('synthetic-manuscripts-unchanged', 'renderer-error-free')
} catch (error) {
  errors.push(String(error)); if (page && mainWindow) await screenshot('failure.png').catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ root, probe, checks, results, errors }, null, 2))
  await app?.close().catch(() => {})
}
