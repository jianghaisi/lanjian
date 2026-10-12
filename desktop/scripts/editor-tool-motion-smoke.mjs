import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron } from 'playwright'

// Synthetic manuscripts and isolated profiles only; never use author data or provider jobs.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-editor-tools-')))
const output = resolve(process.env.EDITOR_TOOL_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-editor-tools-native')
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await _electron.launch({ args: [resolve('out/main/index.js')], env, recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], errors = [], samples = {}
page.on('pageerror', error => errors.push(error.message))
async function capture(name) {
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function sampleFold(open) {
  return page.evaluate(async open => {
    const heights = []
    if (!open) window.retiringFind = document.querySelector('.editor-find-fold')
    document.querySelector('[data-testid="manuscript-find"]').click()
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(requestAnimationFrame)
      const fold = document.querySelector('.editor-find-fold')
      heights.push(fold?.getBoundingClientRect().height || 0)
      if (frame > 1 && (open ? fold && !fold.classList.contains('editor-find-enter-active') : !fold)) break
    }
    return heights
  }, open)
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
    const { project } = await api.projects.create({ parentPath: root, name: '编辑工具动效', title: '编辑工具动效' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { title: '灯火', content: '灯火照着归途。\n\n巷口的灯火亮了，远行的人回到了故乡。', expectedRevision: chapter.revision })
    await api.outlines.update('total', '灯火初现。\n\n灯火引出故乡往事。')
    return project
  }, root)
  const bodies = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name)
    bodies.push({ path, bytes: await readFile(path) })
  }
  await page.reload()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  const body = page.getByTestId('manuscript-input')
  await body.waitFor()
  await body.evaluate(e => { window.originalEditor = e; window.originalEditorContent = e.querySelector('.cm-content') || e })
  samples.open = await sampleFold(true)
  const height = Math.max(...samples.open)
  assert.ok(samples.open.some(value => value > 2 && value < height - 2), 'find bar must pass through intermediate heights')
  const query = page.getByRole('textbox', { name: '查找正文', exact: true })
  assert.equal(await query.evaluate(e => e === document.activeElement), true)
  await query.fill('灯火')
  await page.waitForFunction(() => document.querySelector('.match-count')?.textContent.includes('1 / 2'))
  await query.press('Enter')
  await page.waitForFunction(() => document.querySelector('.match-count')?.textContent.includes('2 / 2'))
  assert.equal(await query.evaluate(e => e === document.activeElement), true)
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('保留的替换草稿')
  await capture('01-find-open')
  samples.close = await sampleFold(false)
  assert.ok(samples.close.some(value => value > 2 && value < height - 2), 'find bar must fold rather than disappear')
  assert.equal(samples.close.at(-1), 0)
  assert.equal(await page.evaluate(() => window.retiringFind.inert), true)
  assert.equal(await body.evaluate(e => e === window.originalEditor && e.contains(document.activeElement)), true)
  checks.push('find-intermediate-fold-heights-selection-focus-and-inert-exit')
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('manuscript-find').click()
    await query.waitFor()
    assert.equal(await query.inputValue(), '灯火')
    assert.equal(await page.getByRole('textbox', { name: '替换为', exact: true }).inputValue(), '保留的替换草稿')
    await query.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
    assert.equal(await page.getByTestId('manuscript-find').getAttribute('aria-pressed'), 'true')
    await query.press('Escape')
    await page.getByTestId('manuscript-find').click()
    await query.waitFor()
    assert.equal(await query.evaluate(e => !e.closest('[inert]')), true)
    await query.press('Escape')
    await page.locator('.editor-find-fold').waitFor({ state: 'hidden' })
  }
  assert.equal(await body.evaluate(e => (e.querySelector('.cm-content') || e) === window.originalEditorContent), true)
  checks.push('rapid-find-reversal-preserves-drafts-editor-node-and-composing-escape')
  const layout = page.getByTestId('manuscript-layout'), panel = page.locator('.writing-layout-popover')
  await layout.click()
  const font = panel.locator('select')
  await font.waitFor()
  assert.equal(await font.evaluate(e => e === document.activeElement), true)
  await font.selectOption('sans')
  await panel.getByRole('button', { name: '米纸', exact: true }).click()
  await capture('02-layout-paper')
  await font.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })
  assert.equal(await layout.getAttribute('aria-expanded'), 'true')
  await panel.evaluate(e => { window.retiringLayout = e })
  await page.getByRole('button', { name: '关闭版式', exact: true }).click()
  await page.waitForFunction(() => window.retiringLayout.inert)
  assert.equal(await layout.evaluate(e => e === document.activeElement), true)
  await layout.click()
  assert.equal(await panel.locator('select').inputValue(), 'sans')
  assert.equal(await panel.getByRole('button', { name: '米纸', exact: true }).getAttribute('aria-pressed'), 'true')
  await panel.getByRole('button', { name: '跟随主题', exact: true }).click()
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await body.evaluate(e => e === window.originalEditor), true)
  checks.push('layout-preferences-retained-inert-exit-ime-and-focus-return')
  for (let i = 0; i < 3; i++) {
    await layout.click()
    await panel.waitFor()
    await layout.click()
    await layout.click()
    await panel.waitFor()
    assert.equal(await font.evaluate(e => !e.closest('[inert]') && e === document.activeElement), true)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
  }
  checks.push('rapid-layout-toggle-keeps-current-panel-operable')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('manuscript-find').click()
  assert.equal(await page.locator('.editor-find-fold').evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await query.press('Escape')
  await layout.click()
  assert.equal(await panel.evaluate(e => getComputedStyle(e).transitionDuration), '0s')
  await page.keyboard.press('Escape')
  checks.push('reduced-motion-disables-find-and-layout-transitions')
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await page.waitForFunction(() => innerWidth <= 900)
  await page.getByTestId('manuscript-find').click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture('03-find-compact')
  await query.press('Escape')
  await layout.click()
  const bounds = await panel.boundingBox()
  assert.equal(await page.evaluate(bounds => bounds.x >= 0 && bounds.x + bounds.width <= innerWidth + 1, bounds), true)
  await capture('04-layout-compact')
  await page.keyboard.press('Escape')
  checks.push('compact-125-percent-tools-do-not-overflow-horizontally')
  await page.getByRole('button', { name: '谋篇', exact: true }).click()
  await page.locator('[data-nav-leaf="total-outline"]').click()
  const outline = page.getByTestId('outline-input')
  await outline.waitFor()
  await page.getByTestId('outline-find').click()
  const outlineQuery = page.getByRole('textbox', { name: /^查找/ })
  await outlineQuery.fill('灯火')
  await page.waitForFunction(() => document.querySelector('.match-count')?.textContent.includes('1 / 2'))
  await outlineQuery.press('Escape')
  await page.getByTestId('outline-layout').click()
  await panel.waitFor()
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(async () => (await window.novelDesktop.outlines.get('total')).content), '灯火初现。\n\n灯火引出故乡往事。')
  checks.push('shared-outline-tools-use-same-transitions-and-preserve-source')
  for (const item of bodies) assert.deepEqual(await readFile(item.path), item.bytes)
  checks.push('manuscript-files-byte-identical')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, samples, root }, null, 2))
  console.log(JSON.stringify({ checks, errors, output }))
} catch (error) {
  console.error(error)
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, samples, root }, null, 2))
  process.exitCode = 1
} finally {
  const video = page.video()
  await app.close()
  if (video) await copyFile(await video.path(), join(output, 'editor-tools.webm'))
}
