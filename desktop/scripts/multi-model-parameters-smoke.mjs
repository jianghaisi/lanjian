import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url), { _electron } = require('playwright')
const output = resolve('../.trellis/tasks/10-05-v3-model-parameter-compatibility/evidence/electron')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-multi-model-')))
const userData = join(root, 'app'), globals = join(root, 'models')
await mkdir(userData); await mkdir(globals); await mkdir(output, { recursive: true })
const requests = [], errors = [], geometries = []
let rejectCatalog = false, holdCatalog = false, releaseCatalog
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
  assert.equal(req.url.startsWith('/claude') ? req.headers['x-api-key'] : req.headers.authorization, req.url.startsWith('/claude') ? 'synthetic-ui-key' : 'Bearer synthetic-ui-key')
  requests.push({ path: req.url, ...(body ? { body } : {}) })
  if (req.url.endsWith('/models') && holdCatalog) await new Promise(done => { releaseCatalog = done })
  if (res.destroyed) return
  res.setHeader('Content-Type', 'application/json')
  if (req.url.endsWith('/models')) {
    if (rejectCatalog) { res.statusCode = 401; res.end('{"error":{"message":"synthetic rejection"}}'); return }
    res.end(JSON.stringify(req.url.startsWith('/gemini') ? { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] } : { data: [{ id: 'opus5-5' }], has_more: false })); return
  }
  assert.match(JSON.stringify(body), /连接测试/)
  if (req.url.endsWith('/messages')) res.end(JSON.stringify({ model: 'upstream-opus', content: [{ type: 'text', text: '连接正常' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 7 } }))
  else if (req.url.endsWith('/responses')) res.end(JSON.stringify({ model: 'upstream-gpt', status: 'completed', output: [{ type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: '连接正常' }] }], usage: { input_tokens: 11, output_tokens: 8, output_tokens_details: { reasoning_tokens: 2 } } }))
  else if (req.url.includes(':generateContent')) res.end(JSON.stringify({ modelVersion: 'upstream-gemini', candidates: [{ content: { parts: [{ text: '连接正常' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, thoughtsTokenCount: 3 } }))
  else res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 5 } }))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const endpoint = `http://127.0.0.1:${server.address().port}`
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData, LANJIAN_GLOBAL_MODEL_DATA_PATH: globals }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.LANJIAN_SMOKE
let app, page
const manager = () => page.locator('[data-testid="global-model-settings"]')
const settled = () => page.waitForFunction(() => document.querySelector('[data-testid="global-model-settings"]')?.getAttribute('aria-busy') === 'false')
async function start() {
  app = await _electron.launch({ executablePath: require('electron'), args: [resolve('out-model-parameters-20261005/main/index.js')], env })
  await app.evaluate(({ session }, endpoint) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => done({ cancel: !details.url.startsWith(endpoint + '/') }))
    const original = globalThis.fetch
    globalThis.fetch = (input, init) => { if (!String(input).startsWith(endpoint + '/')) throw Error('Smoke blocks external requests'); return original(input, init) }
  }, endpoint)
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload(); await page.locator('[data-testid="app-boot-enter"]').click(); await page.locator('[data-testid="app-boot"]').waitFor({ state: 'hidden' })
  await page.locator('[data-testid="library-model-setup"]').click(); await settled()
}
async function capture(theme) {
  await page.evaluate(theme => { localStorage.setItem('lanjian-theme', theme); window.dispatchEvent(new StorageEvent('storage', { key: 'lanjian-theme', newValue: theme })) }, theme)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')); if (w.isMaximized()) w.unmaximize(); w.setContentSize(1100, 1000); w.webContents.setZoomFactor(1.25) })
  await manager().locator('[data-testid="model-parameters"]').first().scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  const geometry = await manager().evaluate(e => ({ width: innerWidth, overflow: e.scrollWidth > e.clientWidth + 1, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 }))
  assert.equal(geometry.overflow, false); assert.equal(geometry.documentOverflow, false)
  geometries.push({ theme, zoom: 1.25, ...geometry })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet.html')).webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, `${theme}-125.png`), Buffer.from(png, 'base64'))
}
try {
  await start(); assert.equal(requests.length, 0)
  await page.locator('[data-testid="global-add-connection"]').click()
  await page.locator('[data-testid="global-connection-name"]').evaluate(e => { e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); e.value = '中转 Claude'; e.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中转 Claude' })) })
  await page.locator('[data-testid="global-connection-protocol"]').selectOption('anthropic-native')
  await page.locator('[data-testid="global-connection-url"]').fill(endpoint + '/claude/v1')
  await page.locator('[data-testid="global-connection-key"]').fill('synthetic-ui-key')
  await page.locator('[data-testid="global-save-connection"]').focus(); await page.keyboard.press('Enter'); await settled()
  assert.equal(requests.length, 0)
  const defaults = manager().locator('.model-defaults')
  await defaults.locator('summary').first().click()
  await defaults.locator('[data-testid="routing-model-shared"]').click()
  const popup = page.getByRole('dialog', { name: '选择模型及所属接口', exact: true })
  await popup.getByRole('button', { name: /找不到要用的模型/ }).click()
  await popup.getByLabel('手动模型 ID', { exact: true }).fill('opus5-5')
  await popup.getByLabel('手动模型 ID', { exact: true }).press('Enter')
  await popup.waitFor({ state: 'hidden' })
  assert.equal(await defaults.locator('[data-testid="routing-model-shared"]').evaluate(e => e === document.activeElement), true)
  await defaults.locator('[data-testid="model-parameters"] details > summary').click()
  await defaults.getByLabel('统一模型型号规则', { exact: true }).selectOption('claude-opus-5-5')
  assert.match(await defaults.innerText(), /32,768/)
  await defaults.getByLabel('统一模型参数模式').selectOption('custom')
  assert.equal(await defaults.getByLabel('统一模型创造性', { exact: true }).count(), 0)
  await defaults.getByLabel('统一模型思考强度', { exact: true }).selectOption('high')
  await defaults.getByLabel('统一模型最大输出', { exact: true }).fill('32768')
  for (const theme of ['qingzhou', 'xuanzhi', 'moye']) await capture(theme)
  await defaults.locator('[data-testid="save-new-book-defaults"]').scrollIntoViewIfNeeded()
  await defaults.locator('[data-testid="save-new-book-defaults"]').focus(); await page.keyboard.press('Enter'); await settled()
  const saved = await page.evaluate(() => window.novelDesktop.modelConnections.defaults())
  assert.equal(saved.template.shared.parameterPolicy.ruleId, 'claude-opus-5-5')
  assert.equal(saved.template.shared.parameterPolicy.overrides.reasoning.effort, 'high')
  assert.equal(requests.length, 0, 'editing and saving never generate')
  const probes = await page.evaluate(async endpoint => {
    const api = window.novelDesktop.modelConnections, c = (await api.list()).connections[0]
    const results = [await api.test({ id: c.id, revision: c.revision, model: 'opus5-5', parameterPolicy: { version: 2, ruleId: 'claude-opus-5-5', mode: 'custom', overrides: { reasoning: { effort: 'high' } } } })]
    for (const [path, protocol, ruleId, reasoning] of [['responses', 'openai-responses', 'gpt-6.1-sol', { effort: 'high' }], ['chat', 'openai-compatible', 'deepseek-v4', { mode: 'disabled' }], ['gemini', 'gemini-native', 'gemini-3.8-flash', { effort: 'medium' }]]) {
      const list = await api.create({ expectedRevision: (await api.list()).revision, name: path, protocol, baseUrl: endpoint + '/' + path + '/v1', apiKey: 'synthetic-ui-key' })
      const next = list.connections.find(c => c.name === path)
      results.push(await api.test({ id: next.id, revision: next.revision, model: 'alias-' + path, parameterPolicy: { version: 2, ruleId, mode: 'custom', overrides: { reasoning } } }))
    }
    return results
  }, endpoint)
  assert.ok(probes.every(p => p.success), JSON.stringify(probes))
  assert.deepEqual(probes.map(p => p.diagnostics.outputTokens), [7, 8, 5, 9])
  assert.equal(probes[0].diagnostics.reasoningTokens, undefined)
  assert.equal(requests[0].body.model, 'opus5-5'); assert.equal(requests[0].body.output_config.effort, 'high'); assert.equal(requests[0].body.temperature, undefined)
  assert.equal(requests[1].body.reasoning.effort, 'high'); assert.equal(requests[1].body.reasoning_effort, undefined)
  assert.equal(requests[2].body.thinking.type, 'disabled'); assert.equal(requests[3].body.generationConfig.thinkingConfig.thinkingLevel, 'medium')
  const query = await page.evaluate(async () => { const c = (await window.novelDesktop.modelConnections.list()).connections[0]; return { id: c.id, revision: c.revision } })
  rejectCatalog = true
  const failed = await page.evaluate(async query => { try { return await window.novelDesktop.modelConnections.catalog(query) } catch (e) { return { rejected: true, message: e.message } } }, query)
  assert.ok(failed.rejected || !failed.success); rejectCatalog = false
  holdCatalog = true
  const pending = page.evaluate(async query => { try { return await window.novelDesktop.modelConnections.catalog(query) } catch { return { rejected: true } } }, query)
  for (let i = 0; i < 150 && !releaseCatalog; i++) await new Promise(done => setTimeout(done, 20))
  assert.ok(releaseCatalog); await page.evaluate(() => window.novelDesktop.modelConnections.cancelTest()); releaseCatalog(); holdCatalog = false
  const cancelled = await pending; assert.ok(cancelled.rejected || !cancelled.success)
  const before = await readFile(join(globals, 'global-model-connections.json')), requestCount = requests.length
  await app.close(); app = undefined; await start()
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.modelConnections.defaults()), { ...saved, catalogRevision: (await page.evaluate(() => window.novelDesktop.modelConnections.list())).revision })
  assert.deepEqual(await readFile(join(globals, 'global-model-connections.json')), before)
  assert.equal(requests.length, requestCount); assert.deepEqual(errors, [])
  const restartedProbe = await page.evaluate(async () => {
    const api = window.novelDesktop.modelConnections, c = (await api.list()).connections.find(c => c.name === '中转 Claude')
    return api.test({ id: c.id, revision: c.revision, model: 'opus5-5', parameterPolicy: { version: 2, ruleId: 'claude-opus-5-5', mode: 'auto' } })
  })
  assert.equal(restartedProbe.success, true); assert.equal(requests.length, requestCount + 1)
  assert.deepEqual(await readFile(join(globals, 'global-model-connections.json')), before)
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'passed', root, geometries, requests, probes, restartedProbe, errors, checks: ['IME and keyboard', 'rule binding', 'fixed sampling hidden', 'three themes at 125%', 'four protocol bodies', 'diagnostics unknown vs zero', 'catalog failure and cancellation', 'save and restart with explicit credential-backed probe', 'no read-side mutation or automatic requests'] }, null, 2))
  console.log('PASS multi-model Electron smoke: ' + output)
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), stack: error.stack, errors, requests }, null, 2))
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  releaseCatalog?.(); if (app) await app.close(); server.closeAllConnections(); await new Promise(done => server.close(done))
}
