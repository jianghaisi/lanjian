import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-inspiration-policy-')))
const output = resolve('../.trellis/tasks/10-12-v3-inspiration-method-policy/research/native-verified')
const build = resolve('out-inspiration-policy-check'), requests = [], errors = [], checks = [], mainLog = []
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
  await page.getByTestId('open-inspiration-library').click(); await page.getByTestId('inspiration-library').waitFor()
  await page.locator('.inspiration-library input[type=file]').setInputFiles([{ name: '合成元数据核对.txt', mimeType: 'text/plain', buffer: Buffer.from(sourceText) }])
  const preview = page.getByRole('dialog', { name: '核对来源导入' })
  await preview.waitFor(); await preview.getByRole('button', { name: '确认收入灵感库' }).click(); await preview.waitFor({ state: 'hidden' })
  await page.locator('.inspiration-extraction .model-catalog-trigger').click()
  await page.getByRole('button', { name: /手动指定模型 ID/ }).click()
  await page.getByRole('textbox', { name: '手动模型 ID', exact: true }).fill('metadata-fixture')
  await page.getByRole('button', { name: '使用此模型', exact: true }).click()
  await page.getByRole('spinbutton', { name: '每批调用预算' }).fill('1')
  await page.locator('.inspiration-source-shelf').getByRole('button', { name: '提取情节' }).click()
  const paused = await waitJob('paused-limit')
  assert.equal(requests.length, 1); assert.ok(requests[0].instruction.includes('这是实际原文的一个片段'))
  assert.ok(paused.creativePolicy.every(p => p.version === '1.7.0'))
  await page.getByRole('button', { name: '继续下一批' }).waitFor(); await capture('paused-original-methods')
  checks.push('actual native import, original model controls and published extract asset; plain provenance crosses preload')
  const dbFile = join(root, 'profile/inspiration', createHash('sha256').update('desktop-author').digest('hex'), 'library.sqlite')
  await app.close(); app = undefined
  const db = new DatabaseSync(dbFile), privateBefore = String(db.prepare('SELECT payload FROM job_policies WHERE job_id=?').get(paused.id).payload)
  assert.equal(JSON.parse(privateBefore).released.find(p => p.pluginId.endsWith('story-planning')).version, '1.7.0'); db.close()
  await launch(); await enter(); await page.getByTestId('open-inspiration-library').click()
  await page.getByRole('button', { name: '继续下一批' }).waitFor()
  const reopened = await page.evaluate(id => window.novelDesktop.inspiration.getJob(id), paused.id)
  assert.equal(reopened.status, 'paused-limit'); assert.equal(requests.length, 1)
  checks.push('normal Electron restart retains private original snapshot and makes zero automatic request')
  await page.getByRole('button', { name: '继续下一批' }).click()
  const done = await waitJob('succeeded'); assert.equal(done.id, paused.id); assert.equal(requests.length, 2)
  assert.ok(requests[1].instruction.includes('根据以下已提取的卡和逐字证据整理一个故事弧'))
  assert.deepEqual(done.creativePolicy, paused.creativePolicy)
  for (const r of requests) { assert.equal(r.stream, true); assert.deepEqual(r.tools, []); assert.ok(!r.system.includes('提取可追溯的小说灵感')) }
  const cards = await page.evaluate(() => window.novelDesktop.inspiration.search({ query: '' }))
  assert.equal(cards.total, 2); assert.ok(cards.cards.every(c => c.creativePolicy.length === 1))
  await page.locator('section[aria-label="提取作业"] strong').filter({ hasText: '完整提取' }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.inspiration-card').length === 2)
  assert.equal(await page.locator('section[aria-label="提取作业"]').getByRole('button', { name: '停止', exact: true }).count(), 0)
  await page.locator('.inspiration-card').first().click(); await page.locator('.inspiration-provenance blockquote').first().waitFor()
  assert.ok((await page.locator('.inspiration-provenance blockquote').first().textContent()).includes('标签甲'))
  await capture('completed-original-summary')
  const verify = new DatabaseSync(dbFile)
  assert.equal(String(verify.prepare('SELECT payload FROM job_policies WHERE job_id=?').get(paused.id).payload), privateBefore); verify.close()
  const actual = await page.evaluate(async () => { const api = window.novelDesktop.inspiration, sources = await api.listSources(); return api.readSource({ sourceId: sources[0].id, sourceVersion: sources[0].version, offset: 0, limit: 1 }) })
  assert.equal(actual.segments[0].text, sourceText); assert.deepEqual(errors, [])
  checks.push('explicit continuation restores original summary, exact source and stage provenance; no book, prose or outline confirmation')
  console.log('PASS native original inspiration extract/pause/restart/resume/provenance')
} catch (error) {
  failure = String(error); await page?.screenshot({ path: join(output, 'failed.png') }).catch(() => {})
  if (page) await writeFile(join(output, 'failed-state.txt'), await page.locator('body').innerText().catch(() => 'page unavailable'))
  throw error
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, requests, errors, failure, buildHash: createHash('sha256').update(await readFile(join(build, 'main/index.js'))).digest('hex') }, null, 2))
  await writeFile(join(output, 'main.log'), mainLog.join('\n'))
  await app?.close(); await new Promise(r => server.close(r))
  if (dirname(root) !== parent || !root.startsWith(join(parent, 'lanjian-inspiration-policy-')) || await realpath(root) !== root) throw Error('Invalid cleanup root')
  await rm(root, { recursive: true, force: true })
}
