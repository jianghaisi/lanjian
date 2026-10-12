import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

// Only synthetic books and an isolated profile; no author workspace or provider is used.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-navigation-motion-')))
const output = resolve(process.env.NAVIGATION_MOTION_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-navigation-motion-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function openAssistant() {
  if (await page.getByTestId('assistant-sidebar').getAttribute('aria-hidden') === 'true')
    await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
  await page.getByTestId('assistant-sidebar').waitFor()
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
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: root, name: '动效验证', title: '动效验证' })
    const chapters = []
    for (let i = 1; i <= 2; i++) {
      const status = await api.outlines.createVolume(`卷${i}`)
      const chapter = await api.chapters.create()
      const content = `第${i}章：这份正文不应被界面动画修改。`
      await api.chapters.update(chapter.id, { title: `场景${i}`, content, expectedRevision: chapter.revision })
      await api.outlines.placeChapter(chapter.id, status.volumes.at(-1).volume)
      chapters.push({ id: chapter.id, content })
    }
    return { ...project, chapters }
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const settings = page.getByRole('button', { name: '设置', exact: true })
  await settings.click(); await page.locator('.local-appearance-dialog[open]').waitFor()
  await capture('00-appearance-dialog')
  await page.locator('[data-preview-theme="qingzhou"] input').check()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'qingzhou')
  await capture('00-appearance-light')
  await page.locator('[data-preview-theme="moye"] input').check()
  await page.keyboard.press('Escape')
  await page.locator('.local-appearance-dialog[open]').waitFor({ state: 'hidden' })
  assert.equal(await settings.evaluate(e => e === document.activeElement), true)
  checks.push('native-appearance-dialog-escape-restores-focus')
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()

  const alignment = async () => page.evaluate(() => {
    const rail = document.querySelector('.workspace-navigation-rail').getBoundingClientRect()
    const target = document.querySelector('.activitybar>button[aria-current]').getBoundingClientRect()
    return Math.max(Math.abs(rail.top - target.top), Math.abs(rail.height - target.height))
  })
  await page.locator('.workspace-navigation-rail[data-ready=true]').waitFor()
  await page.waitForTimeout(350); assert.ok(await alignment() < 1)
  const go = async id => {
    await page.locator(`[data-nav-parent="${id}"]`).click()
    await page.waitForFunction(id => document.querySelector('.activitybar>button[aria-current]')?.getAttribute('data-nav-parent') === id, id)
  }
  await go('definition'); await page.waitForTimeout(90); await capture('01-navigation-in-flight')
  for (const id of ['materials', 'definition', 'manuscript', 'definition', 'manuscript']) await go(id)
  await page.waitForTimeout(350)
  assert.ok(await alignment() < 1)
  assert.equal(await page.locator('.activitybar>button[aria-current]').count(), 1)
  checks.push('rapid-navigation-reversal-settles-on-one-authoritative-selection')
  await go('foundation'); await page.locator('[data-nav-leaf="world"]').click()
  await page.locator('.archive-page-heading h2').filter({ hasText: '世界观' }).waitFor()
  await page.waitForTimeout(350); await capture('02-heading-arrival')
  assert.ok(await alignment() < 1)
  await go('manuscript')
  const trigger = page.getByTestId('open-quick-chapter')
  await trigger.click(); await page.getByTestId('quick-chapter-query').waitFor()
  assert.equal(await page.getByTestId('quick-chapter-query').evaluate(e => e === document.activeElement), true)
  await page.mouse.move(1400, 20)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(240)
  assert.equal(await page.getByTestId('quick-chapter-query').getAttribute('aria-activedescendant'), `quick-chapter-${book.chapters[1].id}`)
  await capture('03-quick-open-selection')
  await page.keyboard.press('Escape')
  assert.equal(await trigger.evaluate(e => e === document.activeElement), true)
  await trigger.click(); await page.getByTestId('quick-chapter-query').fill('场景2'); await page.keyboard.press('Enter')
  await page.getByTestId('quick-chapter-open').waitFor({ state: 'hidden' })
  await page.waitForFunction(text => document.querySelector('[data-testid="manuscript-input"]')?.textContent?.includes(text), book.chapters[1].content)
  checks.push('quick-open-keeps-keyboard-search-escape-focus-and-real-chapter-selection')
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForTimeout(500); assert.ok(await alignment() < 1)
  await capture('04-resize-alignment')
  checks.push('compact-125-percent-rail-aligns-with-real-button')
  await page.emulateMedia({ reducedMotion: 'reduce' }); await go('definition')
  await page.waitForTimeout(60)
  assert.ok(await alignment() < 1)
  assert.equal(await page.locator('.workspace-navigation-rail').evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await go('foundation'); await page.locator('[data-nav-leaf="world"]').click()
  assert.equal(await page.locator('.archive-page-heading h2').filter({ hasText: '世界观' }).evaluate(e => getComputedStyle(e).animationName), 'none')
  await go('manuscript'); await trigger.click()
  assert.equal(await page.getByTestId('quick-chapter-open').evaluate(e => getComputedStyle(e).animationName), 'none')
  await page.keyboard.press('Escape')
  checks.push('reduced-motion-snaps-navigation-and-disables-header-and-finder-arrival')
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('project-library').waitFor()
  assert.equal(await page.locator('.workspace-navigation-rail').count(), 0)
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.locator('.workspace-navigation-rail[data-ready=true]').waitFor()
  await page.waitForTimeout(150); assert.ok(await alignment() < 1)
  checks.push('library-unmount-and-warm-return-recreate-marker-without-stale-position')
  for (const body of bodies) assert.deepEqual(await readFile(body.path), body.bytes)
  checks.push('two-manuscript-files-byte-identical')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error); await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video(); await app.close()
  if (video) await copyFile(await video.path(), join(output, 'navigation-motion.webm'))
}
