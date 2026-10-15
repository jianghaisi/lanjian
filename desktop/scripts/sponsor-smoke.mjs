import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-sponsor-')))
const output = resolve(process.env.LANJIAN_SPONSOR_TEST_OUTPUT || 'artifacts/ui/sponsors')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const app = await _electron.launch({ args: [resolve(process.argv[2] || 'out-sponsor-check', 'main/index.js')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
const errors = [], checks = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(30000)
async function capture(name) {
  await page.screenshot() // flush paint before native capture at non-default zoom
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
}
async function enter() {
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
}
try {
  await page.waitForFunction(() => !!window.companionSettings)
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    await window.companionSettings.update({ careEnabled: false, voice: { mute: true, textModel: false, preload: false, proactive: false } })
  })
  // Observe the final OS-open boundary; preserve the production URL validation/handler.
  await app.evaluate(({ shell }) => {
    globalThis.sponsorOpened = []
    shell.openExternal = async url => { globalThis.sponsorOpened.push(url) }
  })
  await page.reload(); await enter()
  const settings = page.getByRole('button', { name: '设置', exact: true })
  const dialog = page.locator('dialog.library-preferences-dialog')
  for (const [theme, width, height, zoom] of [['qingzhou', 1440, 900, 1], ['xuanzhi', 1440, 900, 1.25], ['moye', 1100, 760, 1.25]]) {
    await owner.evaluate((win, view) => { win.unmaximize(); win.setContentSize(view.width, view.height); win.webContents.setZoomFactor(view.zoom) }, { width, height, zoom })
    await settings.click()
    await page.getByTestId('library-settings-appearance').click()
    await page.getByTestId(`theme-${theme}`).check()
    await page.getByTestId('library-settings-sponsors').click()
    const card = dialog.getByTestId('sponsor-card')
    await card.waitFor({ state: 'visible' })
    await card.getByAltText('FastAIToken Logo').evaluate(async image => { await image.decode(); if (!image.naturalWidth) throw new Error('Sponsor logo failed to load') })
    assert.equal(await dialog.locator('.library-settings-content').evaluate(e => e.scrollWidth > e.clientWidth + 1), false)
    const link = card.getByRole('link', { name: /通过岚笺邀请链接注册/ })
    await link.focus(); await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    assert.equal(await app.evaluate(() => globalThis.sponsorOpened.at(-1)), 'https://www.fastaitoken.com/register?aff=YD326MA7UYAU')
    await capture(`library-${theme}-${zoom}`)
    await page.keyboard.press('Escape')
    assert.equal(await settings.evaluate(e => document.activeElement === e), true)
    checks.push(`empty-library-${theme}-${zoom}-referral-and-focus`)
  }
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.webContents.setZoomFactor(1) })
  await settings.click(); await page.getByTestId('library-global-models').click()
  const models = page.locator('.global-models-dialog')
  await models.getByTestId('sponsor-card').waitFor({ state: 'visible' })
  assert.equal(await models.locator('.sponsor-card--compact').count(), 1)
  await capture('model-connections')
  await page.getByTestId('library-models-return').click(); await page.keyboard.press('Escape')
  checks.push('model-connections-compact-card')
  // An empty synthetic project is enough; no prose generation or author data.
  const project = await page.evaluate(async root => (await window.novelDesktop.projects.create({ parentPath: root, name: '赞助入口验证', title: '赞助入口验证' })).project, root)
  await page.reload(); await enter()
  await page.getByTestId('library-all-works').click()
  await page.locator('.work-item-open').filter({ hasText: project.title }).click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await settings.click(); await page.getByTestId('settings-category-advanced').click(); await page.getByTestId('settings-nav-about').click()
  await page.locator('.about-lanjian').getByTestId('sponsor-card').waitFor({ state: 'visible' })
  await capture('about')
  checks.push('work-about-sponsor')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ root, checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ root, checks, errors, error: String(error.stack || error) }, null, 2))
  throw error
} finally { await app.close() }
