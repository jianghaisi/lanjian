import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron, chromium } from 'playwright'
import { createServer } from 'node:http'
import { readPluginPackage } from '@lanjian/writing-plugin-package'
import { createMarketApp } from '../../services/plugin-marketplace/dist/app.js'
import { oidcIdentity } from '../../services/plugin-marketplace/dist/adapters/oidc-auth.js'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-market-native-')))
const evidence = resolve('../.trellis/tasks/09-20-v3-plugin-marketplace-and-personal-authoring/research'), build = resolve(process.argv[2] || 'out-plugin-marketplace-check', 'main/index.js')
const issuer = process.env.LANJIAN_TEST_OIDC_ISSUER || 'http://127.0.0.1:43121/realms/lanjian-plugins-test'
assert.equal(new URL(issuer).hostname, '127.0.0.1', 'Only the isolated loopback test realm is permitted'); assert.ok(issuer.endsWith('/realms/lanjian-plugins-test'))
await mkdir(evidence, { recursive: true })
const discovery = await fetch(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(5000) }).then(r => r.json()); assert.equal(discovery.issuer, issuer)
const identity = oidcIdentity(issuer, 'lanjian-plugin-market', new URL(discovery.jwks_uri)), authFailures = []
const market = await createMarketApp(join(root, 'service'), async authorization => {
  try { return await identity(authorization) }
  catch (error) {
    // Only synthetic-realm protocol metadata. Never persist the credential or subject.
    const parts = authorization?.slice(7).split('.') ?? []
    if (parts.length === 3) {
      const { alg } = JSON.parse(Buffer.from(parts[0], 'base64url').toString()), { iss, aud, scope, iat, exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      authFailures.push({ alg, iss, aud, scope, iat, exp, now: Math.floor(Date.now() / 1000) })
    }
    throw error
  }
})
await market.app.listen({ host: '127.0.0.1', port: 0 }); const marketOrigin = `http://127.0.0.1:${market.app.server.address().port}`
const requests = [], checks = [], errors = [], clients = []; let browser
let modelRequests = 0
const model = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); modelRequests++
    response.setHeader('Content-Type', 'application/json')
    const reply = message => response.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))
    const results = body.messages.filter(m => m.role === 'tool')
    const call = (name, args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `call-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    if (!results.length) return call('discover_tools', { query: '统计输入文字' })
    if (results.length === 1) return call(body.tools.find(t => t.function.description.includes('统计输入文字')).function.name, { text: '你好🌏' })
    assert.equal(JSON.parse(results.at(-1).content).characters, 3)
    reply({ role: 'assistant', content: '下载的工具执行完成，共 3 个字符。' })
  } catch (e) { errors.push(String(e)); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => model.listen(0, '127.0.0.1', r))
const envBase = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
const watchdog = setTimeout(() => { for (const client of clients) client.app.process().kill('SIGKILL') }, 300000); watchdog.unref()
async function boot(page) { await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' }) }
async function settings(page, name) {
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: name }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click()
}
async function launch(name) {
  const profile = join(root, name), books = join(profile, 'books'); await mkdir(books, { recursive: true })
  const env = { ...envBase, LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(profile, 'global-model-data', 'v1'), LANJIAN_MARKET_ORIGIN: marketOrigin, LANJIAN_MARKET_ISSUER: issuer, LANJIAN_MARKET_CLIENT_ID: 'lanjian-desktop', LANJIAN_MARKET_TEST_LOOPBACK: '1' }
  const app = await _electron.launch({ args: [build, '--disable-gpu'], env }), page = await app.firstWindow()
  clients.push({ app, page, profile }); page.setDefaultTimeout(30000); await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
  await page.evaluate(async () => { localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true'); await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } }) })
  const state = await page.evaluate(async ({ books, name }) => { const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name, genre: '仙侠' }); const chapter = await api.chapters.create(); await api.chapters.update(chapter.id, { content: 'PRIVATE-MANUSCRIPT-NEVER-UPLOAD', title: '原稿' }); return { project, chapterId: chapter.id } }, { books, name })
  await page.reload(); await boot(page); await settings(page, name)
  return { app, page, profile, state }
}
async function login(client) {
  // Replace only the OS handoff: the actual independent Edge browser posts to
  // Keycloak, and the returned one-use code enters the real second-instance
  // handler. Never register a test app as the author's OS protocol handler.
  await client.app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__marketAuthorizationUrl = url } })
  await client.page.getByTestId('plugins-nav-market').click(); await client.page.getByRole('button', { name: '登录以发布', exact: true }).click()
  let authorizationUrl
  for (let i = 0; i < 100; i++) { authorizationUrl = await client.app.evaluate(() => globalThis.__marketAuthorizationUrl); if (authorizationUrl) break; await client.page.waitForTimeout(50) }
  assert.ok(authorizationUrl)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext(), page = await context.newPage(); let callback
  await page.route('**/login-actions/**', async route => {
    const response = await route.fetch({ maxRedirects: 0 }), location = response.headers().location
    if (location?.startsWith('cn.zuolan.novelwriter:/oauth/callback?')) { callback = location; await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>测试账号登录完成，可以返回岚笺。</p>' }) }
    else await route.fulfill({ response })
  })
  await page.goto(authorizationUrl); await page.locator('#username').fill('author-a'); await page.locator('#password').fill('author-a-test-only'); await page.screenshot({ path: join(evidence, 'keycloak-browser-login.png') }); await page.locator('#kc-login').click()
  for (let i = 0; i < 200 && !callback; i++) await page.waitForTimeout(50)
  if (!callback) { await page.screenshot({ path: join(evidence, 'keycloak-login-failure.png') }); throw new Error('Keycloak browser did not return an authorization code') }
  await client.app.evaluate(({ app }, url) => app.emit('second-instance', {}, [url]), callback)
  await client.page.getByRole('button', { name: '退出账号', exact: true }).waitFor()
  const status = await client.page.evaluate(() => window.novelDesktop.writingPlugins.marketStatus()); assert.equal(status.auth.state, 'signed-in')
  await browser.close(); browser = undefined
  await client.page.getByTestId('plugins-nav-installed').click()
}
try {
  // Capture only route names/counts. Never log tokens, authorization codes or bodies.
  market.app.server.on('request', (request, response) => response.on('finish', () => requests.push(`${request.method} ${request.url.split('?')[0]} ${response.statusCode}`)))
  const a = await launch('市场作者A'); await login(a); checks.push('Real Keycloak 26.7.4 login in an isolated system Edge browser; actual PKCE exchange, signature and nonce checks; OS URI transport substituted in test')
  await a.page.getByTestId('plugins-nav-personal').click(); await a.page.getByRole('button', { name: /^新建代码工具/ }).click()
  const editor = a.page.getByTestId('plugin-draft-editor'); await editor.getByLabel('插件名称', { exact: true }).fill('市场字数工具'); await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  const privateDraft = await a.page.evaluate(async () => { const api = window.novelDesktop.writingPlugins, d = await api.createDraft('context'); return api.saveDraft({ id: d.id, revision: d.revision, manifestText: 'PRIVATE-DRAFT-NEVER-UPLOAD', files: d.files }) }); assert.ok(privateDraft.id)
  assert.equal(requests.filter(r => r.includes('/uploads')).length, 0)
  await editor.getByRole('button', { name: '预览发布到市场', exact: true }).click(); await editor.getByTestId('plugin-publish-preview').waitFor(); assert.equal(requests.filter(r => r.includes('/uploads')).length, 0)
  await editor.getByTestId('plugin-publish-preview').scrollIntoViewIfNeeded(); await a.page.screenshot({ path: join(evidence, 'market-publish-preview.png') })
  await editor.getByRole('button', { name: '提交并在校验通过后公开', exact: true }).click(); await editor.getByText('自动校验通过，版本已公开。', { exact: true }).waitFor()
  const release = (await a.page.evaluate(() => window.novelDesktop.writingPlugins.marketStatus())).publications[0]; assert.equal(release.state, 'published')
  checks.push('Visible authoring -> exact-file publish preview -> explicit submit -> automatic public release; private draft produces zero upload')
  const b = await launch('市场作者B'); assert.equal((await b.page.evaluate(() => window.novelDesktop.writingPlugins.marketStatus())).auth.state, 'signed-out')
  await b.page.getByTestId('plugins-nav-market').click(); const marketUi = b.page.getByTestId('plugin-market')
  await marketUi.getByLabel('市场关键词').fill('市场字数'); await marketUi.getByRole('button', { name: '查找插件', exact: true }).click(); await marketUi.getByRole('button', { name: /社区.*市场字数工具/ }).click()
  await marketUi.locator('.detail').scrollIntoViewIfNeeded(); await b.page.screenshot({ path: join(evidence, 'market-download-detail.png') })
  await marketUi.getByRole('button', { name: '下载并预览安装', exact: true }).click(); await b.page.getByTestId('plugin-preview').waitFor(); await b.page.getByTestId('plugin-install').click()
  const row = b.page.locator(`[data-plugin-id="${release.manifest.id}"]`); await row.waitFor()
  let installed = await b.page.evaluate(() => window.novelDesktop.writingPlugins.list(true)); assert.equal(installed.plugins[0].enabled, false); assert.equal(installed.plugins[0].current, release.digest); assert.deepEqual(installed.plugins[0].provenance, { distribution: 'community', createdByMe: false })
  await row.getByRole('button', { name: '版本与权限', exact: true }).click(); await row.getByRole('button', { name: '确认权限并启用', exact: true }).click(); await row.getByRole('button', { name: '本书使用', exact: true }).click()
  await b.page.evaluate(async baseUrl => {
    const api = window.novelDesktop, list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '市场隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '市场隔离验证'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'plugin-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'plugin-model', model: 'plugin-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
  }, `http://127.0.0.1:${model.address().port}/v1`)
  const run = await b.page.evaluate(input => window.novelDesktop.fieldAssistant.runs.start(input), { operationId: 'market-native', workItemId: b.state.project.id, page: 'world', message: '统计输入文字', targets: [], chapterId: null, selectedCharacters: 0, history: [] })
  let runStatus
  for (let i = 0; i < 300; i++) { runStatus = await b.page.evaluate(id => window.novelDesktop.fieldAssistant.runs.status(id), run.id); if (runStatus.status === 'completed') break; assert.notEqual(runStatus.status, 'failed', runStatus.message); await b.page.waitForTimeout(60) }
  assert.equal(runStatus.status, 'completed'); assert.equal(modelRequests, 3)
  checks.push('Second isolated Electron client anonymously discovers, downloads and explicitly enables the exact version, then executes its tool through the real assistant and QuickJS worker')
  await b.page.getByTestId('plugins-nav-market').click(); await marketUi.getByTestId('market-detail').waitFor(); await marketUi.getByRole('button', { name: '下载并预览安装', exact: true }).click()
  await a.page.getByTestId('plugins-nav-market').click(); await a.page.getByRole('button', { name: '我的发布', exact: true }).click(); await a.page.getByRole('button', { name: '下架此版本', exact: true }).click(); await a.page.getByText('版本已下架。', { exact: true }).waitFor()
  await b.page.getByTestId('plugin-install').click(); await b.page.getByTestId('writing-plugin-settings').getByRole('alert').waitFor()
  installed = await b.page.evaluate(() => window.novelDesktop.writingPlugins.list(true)); assert.equal(installed.plugins[0].current, release.digest); assert.equal(installed.plugins[0].enabled, true)
  assert.equal(await b.page.evaluate(id => window.novelDesktop.chapters.get(id).then(c => c.content), b.state.chapterId), 'PRIVATE-MANUSCRIPT-NEVER-UPLOAD')
  const zip = await readPluginPackage(await market.packages.read(release.digest)); assert.deepEqual([...zip.files.keys()], ['lanjian-plugin.json', 'main.js'])
  for (const bytes of zip.files.values()) { assert.equal(Buffer.from(bytes).includes(Buffer.from('PRIVATE-DRAFT-NEVER-UPLOAD')), false); assert.equal(Buffer.from(bytes).includes(Buffer.from('PRIVATE-MANUSCRIPT-NEVER-UPLOAD')), false) }
  checks.push('Withdrawal between download and install blocks confirmation; prior installed version, enablement and formal manuscript remain intact')
  await a.page.getByRole('button', { name: '退出账号', exact: true }).click(); assert.equal((await a.page.evaluate(() => window.novelDesktop.writingPlugins.marketStatus())).auth.publisherId, null)
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'marketplace-smoke.json'), JSON.stringify({ ok: true, checks, requestCount: requests.length, browser: 'Microsoft Edge (isolated, headless)', identity: 'Keycloak 26.7.4 real test realm', osProtocolRegistrationVerified: false, errors }, null, 2)); console.log(JSON.stringify({ ok: true, checks, requestCount: requests.length }, null, 2))
} catch (error) {
  for (const [i, client] of clients.entries()) await client.page.screenshot({ path: join(evidence, `marketplace-failure-${i}.png`) }).catch(() => {})
  const alerts = await Promise.all(clients.map(client => client.page.getByRole('alert').allTextContents().catch(() => [])))
  await writeFile(join(evidence, `marketplace-failure-${Date.now()}.json`), JSON.stringify({ error: String(error), checks, errors, requests, alerts, authFailures }, null, 2)); throw error
} finally {
  clearTimeout(watchdog); await browser?.close().catch(() => {})
  for (const { app } of clients.reverse()) { const process = app.process(), fallback = setTimeout(() => process.kill('SIGKILL'), 10000); await app.close().catch(() => {}); clearTimeout(fallback) }
  await market.app.close(); model.closeAllConnections(); await new Promise(r => model.close(r))
  const checked = await realpath(root); if (dirname(checked) !== parent || !basename(checked).startsWith('lanjian-market-native-')) throw new Error('Unsafe test cleanup target')
  await rm(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
