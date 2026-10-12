import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-library-selection-')))
const output = resolve('../.trellis/tasks/10-12-v3-library-method-selection/research/native-copy-final')
const build = resolve('out-library-method-selection-final'), requests = [], errors = [], checks = [], mainLog = [], viewports = []
const sourceText = '资料员选择标签甲，审核员记录标签甲并保留核对依据。'
await mkdir(output, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'metadata-fixture' }] })); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), instruction = body.messages.at(-1).content
    requests.push({ stream: body.stream, tools: body.tools, system: body.messages[0].content, instruction })
    const input = JSON.parse(instruction.split('\n').at(-1)), evidence = Array.isArray(input) ? input.flatMap(c => c.evidence).slice(0, 1) : [{ segmentId: input.segmentId, quote: input.text.slice(0, 30) }]
    const content = JSON.stringify({ cards: [{ title: '标签核对记录', narrative: '本记录只保留来源中已有的标签核对信息。', tags: ['元数据'], characters: [], conflict: '', choice: '', outcome: '', turn: '', foreshadowing: '', evidence }] })
    res.setHeader('content-type', 'text/event-stream')
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 40 } })}\n\ndata: [DONE]\n\n`)
  } catch (error) { errors.push(String(error)); res.statusCode = 500; res.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH = join(root, 'profile'); env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'models')
let app, page, owner, failure
const launch = async () => {
  app = await _electron.launch({ args: [join(build, 'main/index.js'), '--disable-gpu'], env })
  app.process().stderr?.on('data', chunk => mainLog.push(chunk.toString()))
  page = await app.firstWindow(); owner = await app.browserWindow(page)
  page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message))
  await owner.evaluate(w => { w.setContentSize(1440, 960); w.show(); w.focus() })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.inspiration))
}
const enter = async () => {
  await page.waitForFunction(() => ['app-boot-enter', 'app-boot-skip-models'].some(id => document.querySelector(`[data-testid="${id}"]`)?.getClientRects().length), undefined, { timeout: 60000 })
  if (await page.getByTestId('app-boot-skip-models').isVisible()) await page.getByTestId('app-boot-skip-models').click()
  else await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 60000 })
}
const waitJob = async status => {
  for (let i = 0; i < 300; i++) {
    const job = await page.evaluate(async () => (await window.novelDesktop.inspiration.listJobs())[0])
    if (job?.status === status) return job
    if (job && ['failed', 'usage-unconfirmed'].includes(job.status)) throw Error(`${job.status}: ${job.notice}`)
    await page.waitForTimeout(50)
  }
  throw Error(`Job did not reach ${status}`)
}
const capture = async name => {
  viewports.push(await page.evaluate(name => ({ name, width: innerWidth, height: innerHeight, dpr: devicePixelRatio }), name))
  await page.screenshot({ path: join(output, `${name}.png`) })
  await writeFile(join(output, `${name}-native.png`), Buffer.from(await owner.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
}
try {
  await launch()
  await page.evaluate(async baseUrl => {
    const api = window.novelDesktop, old = await api.modelConnections.list()
    await api.modelConnections.create({ expectedRevision: old.revision, name: '元数据方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    await window.companionSettings?.update({ voice: { mute: true, textModel: false, preload: false } })
  }, `http://127.0.0.1:${server.address().port}/v1`)
  await page.reload(); await enter()
  const idle = async () => page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' })
  const settings = async () => { await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByTestId('library-settings-plugins').click(); await idle() }
  const openLibrary = async () => { const close = page.getByRole('button', { name: '关闭外观设置', exact: true }); if (await close.isVisible()) await close.click(); await page.getByTestId('open-inspiration-library').click() }
  await settings()
  const catalog = page.getByTestId('plugin-library')
  await catalog.getByLabel('本地插件关键词').fill('故事逐层展开'); await catalog.getByRole('button', { name: '查找插件', exact: true }).click(); await catalog.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 inspiration-extract.md', { exact: true }).fill('D2_NATIVE_EXTRACT {{tag}}')
  await editor.getByLabel('插件源文件 inspiration-summary.md', { exact: true }).fill('D2_NATIVE_SUMMARY {{tag}}')
  await editor.getByText('高级清单 · 工具、能力与贡献', { exact: true }).click()
  const manifest = JSON.parse(await editor.getByLabel('插件清单', { exact: true }).inputValue())
  manifest.version = '1.0.0'; manifest.capabilities = []; manifest.tools = []
  manifest.contributions = manifest.contributions.filter(c => c.kind === 'creative-policy' && ['inspiration-extract', 'inspiration-summary'].includes(c.slot)).map(c => ({ ...c, configSchema: { type: 'object', properties: { tag: { type: 'string', description: '方法标记', maxLength: 80 } }, required: ['tag'], additionalProperties: false } }))
  await editor.getByLabel('插件清单', { exact: true }).fill(JSON.stringify(manifest, null, 2))
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  assert.ok(personal); const row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  const composition = page.getByTestId('library-plugin-composition'); await composition.waitFor()
  assert.equal(await page.getByTestId('book-plugin-composition').count(), 0)
  assert.equal(await composition.locator('article.contribution').count(), 2)
  for (const entry of await composition.locator('article.contribution').all()) { await entry.getByRole('checkbox').check(); await entry.getByLabel('方法标记', { exact: true }).fill('ORIGINAL_NATIVE') }
  await composition.getByRole('button', { name: '预览组合', exact: true }).click()
  await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="library-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await composition.scrollIntoViewIfNeeded(); await capture('selected-personal-methods')
  await owner.evaluate(w => w.setContentSize(800, 960)); await page.waitForTimeout(150)
  assert.ok(await composition.evaluate(el => el.scrollWidth <= el.clientWidth + 2)); await capture('selected-methods-narrow')
  await owner.evaluate(w => w.setContentSize(1440, 960))
  checks.push('Actual UI derives, edits, installs and enables a personal package, then previews and selects two library methods without any book or login')
  await openLibrary(); await page.getByTestId('inspiration-library').waitFor()
  await page.locator('.inspiration-library input[type=file]').setInputFiles([{ name: '合成元数据核对.txt', mimeType: 'text/plain', buffer: Buffer.from(sourceText) }])
  const preview = page.getByRole('dialog', { name: '核对来源导入' })
  await preview.waitFor(); await preview.getByRole('button', { name: '确认收入知识库' }).click(); await preview.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '查看《合成元数据核对》的资料', exact: true }).click()
  await page.locator('.knowledge-original pre').first().waitFor()
  assert.equal((await page.locator('.knowledge-original pre').first().innerText()).trim(), sourceText)
  await page.getByRole('button', { name: '提取记录', exact: true }).click()
  await page.locator('.inspiration-extraction .model-catalog-trigger').click()
  await page.getByRole('button', { name: /手动指定模型 ID/ }).click()
  await page.getByRole('textbox', { name: '手动模型 ID', exact: true }).fill('metadata-fixture')
  await page.getByRole('button', { name: '使用此模型', exact: true }).click()
  await page.getByRole('spinbutton', { name: '每批调用预算' }).fill('1')
  await page.getByRole('button', { name: '提取情节', exact: true }).click()
  const paused = await waitJob('paused-limit')
  assert.equal(requests.length, 1); assert.ok(requests[0].instruction.includes('D2_NATIVE_EXTRACT ORIGINAL_NATIVE'))
  assert.ok(paused.creativePolicy.every(p => p.pluginId === personal.id && p.version === '1.0.0'))
  await page.getByRole('button', { name: '继续下一批' }).waitFor(); await capture('paused-original-methods')
  checks.push('actual native import and model controls use the selected personal extract asset; its real provenance crosses preload')
  await settings(); await page.getByTestId('plugins-nav-installed').click(); await composition.waitFor()
  for (const input of await composition.getByLabel('方法标记', { exact: true }).all()) await input.fill('NEW_NATIVE')
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="library-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 2'))
  const dbFile = join(root, 'profile/inspiration', createHash('sha256').update('desktop-author').digest('hex'), 'library.sqlite')
  await app.close(); app = undefined
  const db = new DatabaseSync(dbFile), privateBefore = String(db.prepare('SELECT payload FROM job_policies WHERE job_id=?').get(paused.id).payload)
  assert.equal(JSON.parse(privateBefore).installed[0].pluginId, personal.id); assert.equal(JSON.parse(privateBefore).composition.entries[0].params.tag, 'ORIGINAL_NATIVE'); db.close()
  await launch(); await enter(); await openLibrary()
  await page.getByRole('button', { name: '查看《合成元数据核对》的资料', exact: true }).click()
  await page.getByRole('button', { name: '提取记录', exact: true }).click()
  await page.getByRole('button', { name: '继续下一批' }).waitFor()
  const reopened = await page.evaluate(id => window.novelDesktop.inspiration.getJob(id), paused.id)
  assert.equal(reopened.status, 'paused-limit'); assert.equal(requests.length, 1)
  checks.push('normal Electron restart retains private original snapshot and makes zero automatic request')
  await page.getByRole('button', { name: '继续下一批' }).click()
  const done = await waitJob('succeeded'); assert.equal(done.id, paused.id); assert.equal(requests.length, 2)
  assert.ok(requests[1].instruction.includes('D2_NATIVE_SUMMARY ORIGINAL_NATIVE'))
  assert.deepEqual(done.creativePolicy, paused.creativePolicy)
  for (const r of requests) { assert.equal(r.stream, true); assert.deepEqual(r.tools, []); assert.ok(!r.system.includes('提取可追溯的小说灵感')) }
  const cards = await page.evaluate(() => window.novelDesktop.inspiration.search({ query: '' }))
  assert.equal(cards.total, 2); assert.ok(cards.cards.every(c => c.creativePolicy.length === 1))
  await page.locator('section[aria-label="本书提取作业"] strong').filter({ hasText: '完整提取' }).waitFor()
  assert.equal(await page.locator('section[aria-label="本书提取作业"]').getByRole('button', { name: '停止', exact: true }).count(), 0)
  await page.getByRole('button', { name: '情节片段', exact: true }).click()
  await page.locator('.inspiration-card small').filter({ hasText: '情节片段' }).waitFor()
  await page.locator('.inspiration-card').first().click(); await page.locator('.inspiration-provenance blockquote').first().waitFor()
  assert.ok((await page.locator('.inspiration-provenance blockquote').first().textContent()).includes('标签甲'))
  await capture('completed-original-extract')
  await page.getByRole('button', { name: '故事汇总', exact: true }).click()
  await page.locator('.inspiration-card small').filter({ hasText: '故事汇总' }).waitFor()
  await page.locator('.inspiration-card').first().click(); await page.locator('.inspiration-provenance blockquote').first().waitFor()
  assert.ok((await page.locator('.inspiration-provenance blockquote').first().textContent()).includes('标签甲'))
  await capture('completed-original-summary')
  const verify = new DatabaseSync(dbFile)
  assert.equal(String(verify.prepare('SELECT payload FROM job_policies WHERE job_id=?').get(paused.id).payload), privateBefore); verify.close()
  const actual = await page.evaluate(async () => { const api = window.novelDesktop.inspiration, sources = await api.listSources(); return api.readSource({ sourceId: sources[0].id, sourceVersion: sources[0].version, offset: 0, limit: 1 }) })
  assert.equal(actual.segments[0].text, sourceText); assert.deepEqual(errors, [])
  checks.push('explicit continuation restores original summary, exact source and stage provenance; no book, prose or outline confirmation')
  await page.getByRole('button', { name: '提取记录', exact: true }).click()
  await page.locator('.inspiration-extraction .model-catalog-trigger').click(); await page.getByRole('button', { name: /手动指定模型 ID/ }).click()
  await page.getByRole('textbox', { name: '手动模型 ID', exact: true }).fill('metadata-fixture'); await page.getByRole('button', { name: '使用此模型', exact: true }).click()
  await page.getByRole('spinbutton', { name: '每批调用预算' }).fill('2'); await page.getByRole('button', { name: '提取情节', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('section[aria-label="本书提取作业"]')?.textContent.includes('完整提取'))
  for (let i = 0; i < 300 && requests.length < 4; i++) await page.waitForTimeout(50)
  const fresh = await waitJob('succeeded'); assert.notEqual(fresh.id, done.id); assert.equal(requests.length, 4)
  assert.ok(requests.slice(2).every(r => r.instruction.includes('NEW_NATIVE')))
  checks.push('Changing the saved method parameters affects only the explicit new job; the original resumed job retained ORIGINAL_NATIVE after a normal restart')
  await settings(); await page.getByTestId('plugins-nav-installed').click(); await page.locator(`[data-plugin-id="${personal.id}"]`).getByRole('button', { name: '停用插件', exact: true }).click(); await idle()
  await openLibrary(); await page.getByRole('button', { name: '提取记录', exact: true }).click()
  const blocked = await page.evaluate(async ({ sourceId, sourceVersion, profile }) => {
    const api = window.novelDesktop
    try { await api.inspiration.extract({ sourceId, sourceVersion, operationId: crypto.randomUUID(), maxCalls: 2, profile }); return null } catch (error) { return error.code }
  }, { sourceId: paused.sourceId, sourceVersion: paused.sourceVersion, profile: paused.profile })
  assert.equal(blocked, 'CONFLICT'); assert.equal(requests.length, 4); assert.deepEqual(errors, [])
  await page.getByRole('dialog', { name: '外观设置', exact: true }).waitFor({ state: 'hidden' })
  await capture('disabled-method-preserves-history')
  checks.push('Disabling the actual installed plugin rejects new extraction before a provider call; original source and retained completed history remain readable')
  console.log('PASS native personal library method selection and original-job recovery')
} catch (error) {
  failure = String(error); await page?.screenshot({ path: join(output, 'failed.png') }).catch(() => {})
  if (page) await writeFile(join(output, 'failed-state.txt'), await page.locator('body').innerText().catch(() => 'page unavailable'))
  throw error
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, requests, errors, viewports, failure, buildHash: createHash('sha256').update(await readFile(join(build, 'main/index.js'))).digest('hex') }, null, 2))
  await writeFile(join(output, 'main.log'), mainLog.join('\n'))
  await app?.close(); await new Promise(r => server.close(r))
  if (dirname(root) !== parent || !root.startsWith(join(parent, 'lanjian-library-selection-')) || await realpath(root) !== root) throw Error('Invalid cleanup root')
  await rm(root, { recursive: true, force: true })
}
