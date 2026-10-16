// Real Electron/IPC/UI, localhost scripted responses, isolated books and model roots.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-review-recovery-')))
const output = resolve(process.argv[2] || '../.trellis/tasks/10-16-v3-planning-review-recovery/research/native')
await mkdir(output, { recursive: true })
const story = '林舟拿着旧信来到档案室，想找到落款人。管理员让他核对登记簿，他发现信件落款与登记不符，决定去找当年的管理员。'
const requests = []
let validReview = false
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()), prompt = body.messages.at(-1).content
    requests.push(prompt)
    let value
    if (prompt.startsWith('复核下方')) value = { issues: validReview ? [] : [{ category: 'continuity', quote: '林舟走进另一间屋子', parentQuote: '', reason: '核对行动', needsAuthor: false }] }
    else if (prompt.includes('生成创作蓝图')) value = { premise: '核对旧信', worldView: '旧城中的现实调查。', characters: [{ name: '林舟', role: '调查者', arcSeed: '核对信件后寻找见证人。' }], powerSystem: '', cheatSystem: '', rationale: '事件结果引出下一步。' }
    else if (prompt.includes('覆盖全书的总纲')) value = { title: '旧信', summary: '林舟核对旧信，发现差异后寻找管理员。', content: `${story}当年的管理员拿出原始登记，解释了誊抄的错误。林舟寄出回信，停止怀疑朋友，两人重新开始往来。` }
    else if (prompt.includes('把总纲拆成')) value = { volumes: [{ order: 1, title: '落款', storyContent: `${story}管理员帮他联系前任，前任以原始登记解释誊抄错误。林舟于是回信道歉，朋友接到信后重新约他见面。`, goal: '核对落款。', summary: '核对登记，联系前任，回信。', ending: '误会解除，恢复来往。' }] }
    else throw new Error('Unexpected scripted request')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
  } catch { res.writeHead(500); res.end('{"error":{"message":"synthetic fixture mismatch"}}') }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
await mkdir(join(root, 'profile'), { recursive: true })
const args = [resolve('out/main/index.js')]
let app, page
const errors = [], checks = []
function record(message) { checks.push(message); console.log(message) }
async function launch() {
  app = await _electron.launch({ args, env, timeout: 60000 })
  page = await app.firstWindow({ timeout: 60000 }); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => { localStorage.setItem('lanjian-opening-enabled', 'false'); localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' })); localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false })); await window.companionSettings?.update({ voice: { mute: true, textModel: false, preload: false } }) })
}
async function closeNormally() {
  const closed = app.waitForEvent('close', { timeout: 45000 })
  const owner = await app.browserWindow(page)
  await owner.evaluate(window => window.close())
  await closed
  app = null
}

async function openBook() {
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.show(); win.restore(); win.focus() })
  await page.bringToFront()
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
  await page.locator('.work-item-open').filter({ hasText: '大纲入口隔离验证' }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.locator('[data-nav-leaf="total-outline"]').first().click()
}
try {
  await launch()
  await page.evaluate(async ({ root, baseUrl }) => {
    const api = window.novelDesktop
    await api.projects.create({ parentPath: root, name: '大纲入口隔离验证', genre: '悬疑' })
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '合成大纲接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-outline-key' })
    const connection = created.connections.find(c => c.name === '合成大纲接口'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'outline-synthetic', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, plannedVolumes: 1, chaptersPerVolume: 18, targetWordsPerChapter: 2000 })
    await api.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '林舟核对旧信，发现不同后寻找管理员，误会解除。', worldView: '普通旧城', useRealms: false, useSystem: false })
  }, { root, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })

  await openBook()
  const originalOutline = await page.evaluate(() => window.novelDesktop.workspace.getPlanningOutline('total'))
  await page.getByTestId('generate-total-outline-ai').click()
  await page.locator('.planning-progress.failed').waitFor({ timeout: 90000 })
  assert.match(await page.locator('.planning-progress').innerText(), /quote 在草稿中找不到逐字原句/)
  assert.match(await page.locator('.planning-progress').innerText(), /已尝试自动修复 1 次/)
  assert.equal(requests.length, 3)
  await page.getByRole('button', { name: '查看候选与复核详情', exact: true }).click()
  await page.locator('.planning-progress details pre').waitFor()
  const first = await page.evaluate(async () => (await window.novelDesktop.planning.recent())[0])
  const originalDetails = await page.evaluate(id => window.novelDesktop.planning.details(id), first.id)
  assert.match(originalDetails.rawResult, /核对旧信/)
  const buttonBounds = await page.getByTestId('resume-planning').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(buttonBounds && buttonBounds.x + buttonBounds.width <= viewport.width && buttonBounds.y < viewport.height, 'resume stays visible with long details expanded')
  await page.screenshot({ path: join(output, 'review-failed.png') })
  record('invalid exact quote triggers one report repair; candidate persists with actionable error and details')
  await closeNormally()
  await launch(); await openBook()
  await page.locator('[data-nav-leaf="preparation"]').first().click()
  await page.getByTestId('resume-planning').waitFor()
  assert.equal(requests.length, 3)
  record('normal quit and restart restore failed stage without automatic model requests')
  validReview = true
  await page.getByTestId('resume-planning').click()
  await page.getByTestId('planning-proposal').waitFor({ timeout: 90000 })
  assert.equal(requests.length, 8)
  assert.deepEqual(await page.evaluate(id => window.novelDesktop.planning.details(id), first.id), originalDetails)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.getPlanningOutline('total')), originalOutline)
  await page.getByText('查看本书谋篇记录', { exact: true }).click()
  await page.locator('.planning-recovery-history button').filter({ hasText: '未完成' }).first().click()
  await page.locator('.planning-progress.failed').waitFor()
  assert.match(await page.locator('.planning-progress').innerText(), /quote 在草稿中找不到/)
  assert.equal(requests.length, 8)
  await page.screenshot({ path: join(output, 'review-resumed.png') })
  record('resume rechecks same candidate and generates only remaining stages; original attempt and formal outline unchanged')
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, requests: requests.length, errors, isolatedRoot: root }, null, 2))
  await closeNormally()
} finally { if (app) await app.close(); await new Promise(done => server.close(done)) }
