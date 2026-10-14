import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), { _electron } = require('playwright')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-model-recovery-')))
const output = resolve(process.env.LANJIAN_RECOVERY_EVIDENCE || 'artifacts/model-recovery')
await mkdir(output, { recursive: true })
const requests = [], errors = []
let status = 200, detail = ''
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : undefined
  requests.push({ path: req.url, ...(body ? { body } : {}) })
  assert.equal(req.headers.authorization, 'Bearer synthetic-key')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
  res.statusCode = status
  res.end(JSON.stringify(status === 200 ? { choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] } : { error: { message: detail } }))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const endpoint = `http://127.0.0.1:${server.address().port}`
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'app'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'LANJIAN_SMOKE']) delete env[key]
const app = await _electron.launch({ executablePath: process.env.LANJIAN_TEST_EXECUTABLE || require('electron'), args: [resolve(process.argv[2] || 'out-model-recovery-check', 'main/index.js')], env })
let owner
try {
  await app.evaluate(({ session }, endpoint) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, done) => done({ cancel: !d.url.startsWith(endpoint + '/') }))
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => { if (!String(input).startsWith(endpoint + '/')) throw Error('External traffic blocked in synthetic test'); return original(input, init) }
  }, endpoint)
  const page = await app.firstWindow(); owner = await app.browserWindow(page); page.setDefaultTimeout(15000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => !!window.novelDesktop)
  await page.evaluate(async endpoint => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    const api = window.novelDesktop.modelConnections, current = await api.list()
    await api.create({ expectedRevision: current.revision, name: '合成测试接口', baseUrl: endpoint + '/v1', protocol: 'openai-compatible', apiKey: 'synthetic-key' })
  }, endpoint)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  const before = await page.evaluate(() => window.novelDesktop.modelConnections.list())
  await page.locator('.library-header-actions [aria-label="设置"]').click(); await page.getByTestId('library-global-models').click()
  await page.getByTestId('open-model-tests').click()
  const panel = page.getByTestId('model-test-panel'), row = panel.locator('article[data-model="fixture-model"]')
  await row.waitFor(); assert.match(await panel.innerText(), /仅测试文字回复，尚未验证工具调用/)
  const testButton = row.getByRole('button', { name: '测试', exact: true })
  await testButton.focus(); await testButton.press('Enter'); await row.locator('.result.passed').waitFor()
  assert.equal(await row.locator('.result.passed').innerText(), '文字测试通过')
  assert.match(await row.innerText(), /尚未验证工具调用/)
  assert.equal(requests.at(-1).body.tools, undefined)
  for (const failure of [{ status: 403, detail: '<title>网站防火墙</title> synthetic-key private-body', expected: /防火墙.*服务商/ }, { status: 429, detail: 'insufficient_quota synthetic-key', expected: /额度.*立即重试不会解决/ }, { status: 503, detail: 'private-body', expected: /稍后重试/ }]) {
    status = failure.status; detail = failure.detail; const before = requests.length
    await testButton.click(); await row.locator('.result.failed').waitFor()
    assert.match(await row.innerText(), failure.expected); assert.doesNotMatch(await row.innerText(), /synthetic-key|private-body/)
    assert.equal(requests.length, before + 1)
  }
  await owner.evaluate(win => { win.unmaximize(); win.setContentSize(1800, 1000); win.webContents.setZoomFactor(1) })
  await page.waitForTimeout(350); await row.scrollIntoViewIfNeeded(); await row.screenshot({ path: join(output, 'model-errors.png') })
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.modelConnections.list()), before)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, root, requests: requests.length, externalRequests: 0, configUnchanged: true, errors }, null, 2))
  console.log(JSON.stringify({ passed: true, output, requests: requests.length }))
} finally {
  if (owner) { const closed = app.waitForEvent('close'); await owner.evaluate(win => win.close()); await closed }
  server.closeAllConnections(); await new Promise(done => server.close(done))
}
