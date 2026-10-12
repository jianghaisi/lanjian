import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { checkCompanionSettingsOwnership } from './companion-settings-ownership-checks.mjs'

const require = createRequire(import.meta.url)
require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const probe = process.argv.includes('--probe')
const build = resolve(process.argv[2] || 'out-library-settings-check')
const rendererFingerprint = createHash('sha256').update(await readFile(join(build, 'renderer/index.html'))).digest('hex')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-library-settings-')))
const profile = join(root, 'profile')
const output = resolve(`artifacts/ui/library-settings/${probe ? 'before' : 'ownership'}`)
await mkdir(output, { recursive: true })
const store = new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })
const service = new ProjectService(store)
const project = (await service.create({ parentPath: root, title: '设置回归 · 星城创作档案' })).project
const manuscript = join(project.path, '正文', '第1章-隔离章节.md')
const body = '这是隔离设置回归的合成正文，不是作者书稿。'
await writeFile(manuscript, body)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const app = await _electron.launch({ args: [join(build, 'main/index.js')], env })
let page, owner
const results = [], errors = [], checks = []
async function capture(name) {
  const shot = await owner.evaluate(async window => {
    const image = await window.webContents.capturePage()
    return { size: image.getSize(), empty: image.isEmpty(), png: image.toPNG().toString('base64') }
  })
  const expected = await page.evaluate(() => ({ width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio }))
  assert.equal(shot.empty, false)
  assert.ok(Math.abs(shot.size.width - expected.width) < 3 && Math.abs(shot.size.height - expected.height) < 3)
  await writeFile(join(output, name), Buffer.from(shot.png, 'base64'))
}
async function measure() {
  return page.evaluate(() => {
    const dialog = document.querySelector('.local-appearance-dialog:not(.global-models-dialog)')
    const scroll = dialog.querySelector('.library-settings-content') || dialog
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
    const header = dialog.querySelector(':scope > header'), close = header.querySelector('button'), bounds = rect(close)
    const headings = [...dialog.querySelectorAll('h3, .dialogue-settings > legend > span, .dialogue-settings > legend:not(:has(span))')].map(node => {
      const css = getComputedStyle(node)
      return { text: node.textContent.trim(), font: css.font, border: css.borderInlineStart, padding: css.paddingInlineStart }
    })
    const controls = [...scroll.querySelectorAll('input, select, button')].filter(node => node.getClientRects().length).map(node => ({ name: node.dataset.testid || node.type || node.tagName, ...rect(node) }))
    const d = rect(dialog), s = rect(scroll), css = getComputedStyle(dialog)
    return { viewport: [innerWidth, innerHeight], dialog: d, scroll: s, scrollTop: scroll.scrollTop, dialogScrollTop: dialog.scrollTop,
      header: rect(header), headerHit: close.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
      background: css.backgroundColor, overflow: scroll.scrollWidth > scroll.clientWidth + 1, headings,
      escapedControls: controls.filter(r => r.x < s.x - 2 || r.right > s.right + 2), height: css.height, position: css.position }
  })
}
async function enterLibrary() {
  await page.getByTestId('app-boot-enter').click({ timeout: 30000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  await page.getByTestId('project-library').waitFor({ state: 'visible' })
}
try {
  page = await app.firstWindow({ timeout: 30000 }); page.setDefaultTimeout(15000)
  owner = await app.browserWindow(page)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.companionSettings)
  await page.evaluate(() => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    return window.companionSettings.update({ careEnabled: false, voice: { mute: true, textModel: false, preload: false, proactive: false } })
  })
  await page.reload(); await enterLibrary()
  const views = probe ? [{ width: 1440, height: 900, zoom: 1, theme: 'qingzhou' }] : [
    { width: 1920, height: 1000, zoom: 1, theme: 'qingzhou' },
    { width: 1440, height: 900, zoom: 1.25, theme: 'xuanzhi' },
    { width: 1100, height: 760, zoom: 1.25, theme: 'moye' },
    { width: 1360, height: 800, zoom: 1, theme: 'moye' }
  ]
  const dialog = page.locator('.local-appearance-dialog:not(.global-models-dialog)')
  for (const [index, view] of views.entries()) {
    await owner.evaluate((window, view) => { window.unmaximize(); window.setContentSize(view.width, view.height); window.webContents.setZoomFactor(view.zoom) }, view)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByTestId(`theme-${view.theme}`).check()
    await page.waitForTimeout(600)
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(Math.abs(actual.width - view.width / view.zoom) < 3 && Math.abs(actual.height - view.height / view.zoom) < 3, 'requested native size and zoom were applied')
    await capture(`${index}-top.png`)
    for (const [step, selector] of [['top', '[data-testid="theme-settings"]'], ['appearance', '[data-testid="library-appearance-settings"]'], ['voice', '[data-testid="companion-voice-settings"]'], ['end', '[data-testid="library-global-models"]']]) {
      await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(250)
      const result = { view, step, ...await measure() }; results.push(result)
      console.log(JSON.stringify({ view: index, step, headerHit: result.headerHit, overflow: result.overflow, dialogScrollTop: result.dialogScrollTop, background: result.background, headings: step === 'top' ? result.headings : undefined }))
      if (step !== 'top') await capture(`${index}-${step}.png`)
      if (!probe) {
        assert.ok(result.headerHit, 'close remains visible and hit-testable at every scroll depth')
        assert.equal(result.dialogScrollTop, 0, 'only the content body scrolls')
        assert.equal(result.overflow, false, 'no horizontal content overflow')
        assert.equal(result.headings.length, 5, 'library keeps theme, artwork, voice, dialogue and loading')
        assert.equal(await page.getByTestId('desktop-pet-settings').count(), 0, 'desktop controls belong to writing settings')
        assert.deepEqual(result.escapedControls, [], 'controls fit available dialog width')
        assert.ok(!/transparent|rgba|color\(/.test(result.background), 'dialog is fully opaque')
        assert.ok(result.dialog.y >= 0 && result.dialog.bottom <= result.viewport[1] + 1)
        assert.equal(new Set(result.headings.map(h => h.font)).size, 1, 'section heading typography is consistent')
        assert.ok(result.headings.every(h => h.border === result.headings[0].border && parseFloat(h.border) >= 2 && parseFloat(h.padding) > 0), 'every section uses the same nonzero jade rule (device-pixel rounding allowed)')
      }
    }
    await page.getByRole('button', { name: '关闭外观设置' }).click()
    assert.equal(await page.getByRole('button', { name: '设置', exact: true }).evaluate(node => node === document.activeElement), true)
  }
  if (!probe) {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const volume = page.getByTestId('companion-sound-volume')
    // The model stays disabled. Change a harmless caption preference instead.
    const opacity = page.getByTestId('dialogue-opacity')
    await opacity.focus(); await opacity.press('End'); await opacity.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await page.reload(); await enterLibrary()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    assert.equal(await page.getByTestId('theme-moye').isChecked(), true)
    assert.equal(await opacity.inputValue(), '99')
    assert.equal(await volume.isDisabled(), true)
    await page.getByTestId('loader-preview-boot').click()
    const preview = page.getByTestId('loader-preview-dialog')
    await preview.waitFor({ state: 'visible' })
    const previewBounds = await preview.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(Math.abs(previewBounds.width - viewport.width) < 2 && Math.abs(previewBounds.height - viewport.height) < 2, 'nested preview still covers the viewport')
    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    assert.equal(await page.getByTestId('loader-preview-boot').evaluate(node => node === document.activeElement), true)
    assert.equal(await dialog.evaluate(node => node.open), true)
    await page.getByTestId('library-global-models').click()
    await page.getByRole('dialog', { name: '全局模型接口与新书默认', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('dialog', { name: '全局模型接口与新书默认', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    checks.push('preferences-persist-after-reload', 'models-still-disabled', 'global-model-settings-entry', 'nested-preview-viewport-and-focus')
    await checkCompanionSettingsOwnership({ app, page, owner, capture, checks, errors })
  }
  assert.equal(await readFile(manuscript, 'utf8'), body)
  assert.deepEqual(errors, [])
  checks.push('synthetic-manuscript-unchanged', 'renderer-error-free', 'close-restores-opener-focus')
} catch (error) {
  errors.push(String(error)); if (page && owner) await capture('failure.png').catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ capturedAt: new Date().toISOString(), root, build, rendererFingerprint, probe, checks, results, errors }, null, 2))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close()
}
