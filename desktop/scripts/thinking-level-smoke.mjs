import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url), { _electron } = require('playwright')
const root = await mkdtemp(join(tmpdir(), 'lanjian-thinking-')), userData = join(root, 'app')
const evidence = resolve(process.env.LANJIAN_THINKING_EVIDENCE_DIR || join(root, 'evidence'))
await mkdir(userData); await mkdir(evidence, { recursive: true })
const bootstrap = join(root, 'entry.mjs'), build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-thinking')
await writeFile(bootstrap, `import ${JSON.stringify(pathToFileURL(join(build, 'main/index.js')).href)}\n`)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData
let app, page
const checks = [], errors = []
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 30_000 })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
    globalThis.thinkingRequests = []
    globalThis.holdThinking = false
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === 'https://thinking.invalid/v1beta/models') return Response.json({ models: ['gemini-3.8-flash', 'unsupported-native', 'exhausted-native'].map(name => ({ name: `models/${name}` })) })
      if (!String(url).startsWith('https://thinking.invalid/v1beta/models/')) throw Error('Isolated smoke blocks all other traffic')
      const body = JSON.parse(options.body)
      globalThis.thinkingRequests.push({ url: String(url), body })
      if (globalThis.holdThinking) await new Promise((_resolve, reject) => {
        options.signal.throwIfAborted()
        options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
      })
      if (String(url).includes('unsupported-native')) return new Response('private-error-sentinel', { status: 400 })
      if (String(url).includes('exhausted-native')) return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })
      return Response.json({ candidates: [{ content: { parts: [{ text: 'private-thought-sentinel', thought: true }, { text: '连接正常' }] }, finishReason: 'STOP' }] })
    }
  })
  page = await app.firstWindow(); page.setDefaultTimeout(20_000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('.project-library').waitFor()
}
async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const window = await app.browserWindow(page)
  const { data, size } = await window.evaluate(async w => { const image = await w.webContents.capturePage(); return { data: image.toPNG().toString('base64'), size: image.getSize() } })
  const viewport = await page.evaluate(() => ({ width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) }))
  assert.ok(Math.abs(size.width - viewport.width) <= 2 && Math.abs(size.height - viewport.height) <= 2, 'capture must cover the viewport')
  assert.ok(data.length > 20_000, 'blank capture')
  await writeFile(join(evidence, name), Buffer.from(data, 'base64'))
}
const defaults = () => page.evaluate(() => window.novelDesktop.modelConnections.defaults())
const idle = () => page.waitForFunction(() => document.querySelector('[data-testid="model-test-panel"]')?.getAttribute('aria-busy') === 'false')
try {
  await launch()
  await page.getByTestId('library-model-setup').click()
  await page.getByTestId('quick-name').fill('思考强度验收')
  await page.getByTestId('quick-protocol').selectOption('gemini-native')
  await page.getByTestId('quick-url').fill('https://thinking.invalid')
  await page.getByTestId('quick-key').fill('synthetic-key-only')
  await page.getByTestId('quick-save').click()
  const panel = page.getByTestId('model-test-panel'), row = model => panel.locator(`[data-model="${model}"]`)
  await row('gemini-3.8-flash').waitFor()
  const selector = panel.getByLabel('测试思考强度')
  assert.equal(await selector.inputValue(), 'default')
  await selector.focus(); await page.keyboard.press('End'); await page.keyboard.press('Tab')
  assert.equal(await selector.inputValue(), 'high')
  await panel.getByTestId('test-all-models').click()
  await row('exhausted-native').locator('.failed').waitFor(); await idle()
  const requests = await app.evaluate(() => globalThis.thinkingRequests)
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.body.generationConfig.thinkingConfig.thinkingLevel === 'high' && request.body.generationConfig.maxOutputTokens === 8192))
  assert.match(await row('unsupported-native').innerText(), /思考强度.*未自动降级/)
  assert.match(await row('exhausted-native').innerText(), /思考和正文共用/)
  assert.doesNotMatch(await panel.innerText(), /private-error-sentinel|private-thought-sentinel/)
  await selector.scrollIntoViewIfNeeded(); await capture('thinking-high-light.png')
  checks.push('native-selector-keyboard', 'batch-transmits-high-with-budget', 'unsupported-and-budget-safe-errors', 'no-hidden-retries-or-private-text')

  await selector.selectOption('default')
  assert.equal(await panel.locator('.passed,.failed').count(), 0)
  assert.equal(await panel.getByRole('button', { name: '设为新书默认', exact: true }).count(), 0)
  await row('gemini-3.8-flash').getByRole('button', { name: '测试', exact: true }).click()
  await row('gemini-3.8-flash').locator('.passed').waitFor(); await idle()
  assert.equal(await app.evaluate(() => globalThis.thinkingRequests.at(-1).body.generationConfig.thinkingConfig), undefined)
  checks.push('changed-strength-invalidates-old-receipts', 'default-omits-provider-field')

  await selector.selectOption('high')
  await app.evaluate(() => { globalThis.holdThinking = true })
  await panel.getByTestId('test-all-models').click()
  await row('gemini-3.8-flash').locator('.testing').waitFor()
  assert.equal(await selector.isDisabled(), true)
  await panel.getByTestId('stop-model-tests').click(); await idle()
  assert.equal(await panel.locator('.cancelled').count(), 3)
  assert.equal(await app.evaluate(() => globalThis.thinkingRequests.length), 5)
  await app.evaluate(() => { globalThis.holdThinking = false })
  await row('gemini-3.8-flash').getByRole('button', { name: '测试', exact: true }).click()
  await row('gemini-3.8-flash').locator('.passed').waitFor(); await idle()
  await row('gemini-3.8-flash').getByRole('button', { name: '设为新书默认', exact: true }).click()
  await page.getByRole('heading', { name: '新书默认模型', exact: true }).waitFor()
  assert.equal((await defaults()).template.shared.thinkingLevel, 'high')
  assert.equal(await app.evaluate(() => globalThis.thinkingRequests.length), 6)
  checks.push('cancel-stops-batch-without-changing-setting', 'tested-high-saved-without-repeat-probe')

  await page.locator('.advanced-connections > summary').click()
  await page.locator('.model-defaults > summary').click()
  const level = page.getByLabel('统一模型思考强度', { exact: true })
  assert.equal(await level.inputValue(), 'high')
  const window = await app.browserWindow(page)
  await window.evaluate(w => { w.setSize(1100, 800); w.webContents.setZoomFactor(1.25) })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'moye' })
  await level.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForFunction(() => { const r = document.querySelector('select[aria-label="统一模型思考强度"]').getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight })
  const geometry = await page.getByTestId('model-routing-form').evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }))
  assert.ok(geometry.scroll <= geometry.width + 2, JSON.stringify(geometry))
  await capture('thinking-routing-dark-125.png')
  await level.selectOption('medium')
  await page.getByTestId('save-new-book-defaults').click()
  await page.getByText('默认分配已保存，只影响之后新建的作品。', { exact: true }).waitFor()
  assert.equal((await defaults()).template.shared.thinkingLevel, 'medium')
  const disk = JSON.parse(await readFile(join(userData, 'global-model-connections.json'), 'utf8'))
  assert.equal(disk.newBookDefaults.template.shared.thinkingLevel, 'medium')
  assert.equal(disk.newBookDefaults.template.tasks.prose.thinkingLevel, 'high')
  checks.push('routing-selector-and-125pct-dark-layout', 'save-preserves-inactive-slot-strength')
  await app.close(); app = undefined
  await launch()
  assert.equal((await defaults()).template.shared.thinkingLevel, 'medium')
  await page.getByTestId('library-model-setup').click()
  await page.locator('.advanced-connections > summary').click()
  await page.locator('.model-defaults > summary').click()
  assert.equal(await page.getByLabel('统一模型思考强度', { exact: true }).inputValue(), 'medium')
  checks.push('real-electron-restart-persists-strength')
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, checks, root, evidence, errors }, null, 2))
  console.log(JSON.stringify({ ok: true, checks, root, evidence }))
} catch (error) {
  if (app && page) await capture(`failure-${Date.now()}.png`).catch(() => {})
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: false, checks, root, error: String(error), errors }, null, 2))
  throw error
} finally { if (app) await app.close() }
