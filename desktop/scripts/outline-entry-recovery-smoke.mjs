// Real Electron/IPC/UI, localhost scripted responses, isolated books and model roots.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-outline-entry-')))
const output = resolve(process.argv[2] || 'artifacts/outline-entry-recovery')
await mkdir(output, { recursive: true })
const story = '林舟拿着旧信来到档案室，想找到落款人。管理员让他核对登记簿，他发现信件落款与登记不符，决定去找当年的管理员。'
const requests = []
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()), prompt = body.messages.at(-1).content
    requests.push(prompt)
    let value
    if (prompt.startsWith('复核下方')) value = { issues: [] }
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
  await page.getByTestId('total-outline-start-guide').waitFor()
  await page.screenshot({ path: join(output, 'empty-total.png') })
  const editor = page.locator('.planning-document-workspace .cm-content').first()
  await editor.fill('作者未保存的总纲草稿')
  await page.getByTestId('generate-total-outline-ai').click()
  const dialog = page.getByRole('dialog', { name: '这份大纲还有修改' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.match(await editor.innerText(), /作者未保存的总纲草稿/)
  assert.equal(requests.length, 0)
  record('dirty outline departure cancel keeps the editor draft and makes zero model requests')
  await page.getByTestId('generate-total-outline-ai').click()
  await dialog.getByRole('button', { name: '保存后继续', exact: true }).click()
  await page.getByTestId('planning-proposal').waitFor({ timeout: 90000 })
  const initialSource = await page.evaluate(() => window.novelDesktop.workspace.getPlanningOutline('total'))
  assert.equal(initialSource.content, '作者未保存的总纲草稿')
  const guide = page.getByTestId('planning-formal-outline-guide')
  assert.match(await guide.innerText(), /总纲仍是候选/)
  const next = page.getByTestId('planning-next-step')
  await next.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'candidate-next-step.png') })
  const nextBox = await next.boundingBox(), candidateBox = await page.locator('.planning-proposal textarea').first().boundingBox()
  assert.ok(nextBox && candidateBox && nextBox.y < candidateBox.y, 'next action appears before long candidate fields')
  record('save-before-leave persists draft, generation opens preparation, next-step actions precede candidate text')
  const requestCount = requests.length
  await page.locator('[data-nav-leaf="total-outline"]').first().click()
  await page.getByTestId('generate-total-outline-ai').click()
  await next.waitFor()
  assert.equal(requests.length, requestCount)
  record('reopening existing candidate makes no additional model requests')
  const steps = [
    ['preview-character-seed-adoption', 'confirm-character-seed-adoption', '人物'],
    ['preview-world-seed-adoption', 'confirm-world-seed-adoption', '世界'],
    ['preview-power-system-adoption', 'confirm-power-system-adoption', '力量体系'],
    ['preview-cheat-system-adoption', 'confirm-cheat-system-adoption', '特殊优势']
  ]
  for (const [preview, confirm, label] of steps) {
    await page.getByTestId(preview).click()
    await page.getByTestId(confirm).click()
    await page.getByTestId(confirm).waitFor({ state: 'hidden' })
    record(`explicit synthetic ${label} preview/adoption advances the next-step action`)
  }
  await page.getByTestId('preview-total-adoption').click()
  await page.getByTestId('confirm-total-adoption').click()
  await page.getByTestId('confirm-total-adoption').waitFor({ state: 'hidden' })
  assert.match(await guide.innerText(), /总纲已采用/)
  const saved = await page.evaluate(async () => ({ source: await window.novelDesktop.workspace.getPlanningOutline('total'), status: await window.novelDesktop.outlines.planningStatus(), chapters: await window.novelDesktop.chapters.list() }))
  assert.ok(saved.source.content.includes('林舟'))
  assert.ok(saved.status.totalApproval); assert.notEqual(saved.status.totalApproval.status, 'confirmed')
  assert.equal(saved.chapters.length, 0)
  record('total adoption produces readable formal outline, with no author confirmation or prose generation')
  await page.locator('[data-nav-leaf="total-outline"]').first().click()
  await page.getByTestId('open-outline-expansion').click()
  await page.locator('[data-testid="start-outline-expansion"]:enabled').waitFor()
  assert.equal(await page.getByTestId('start-outline-expansion').isEnabled(), true)
  await page.screenshot({ path: join(output, 'formal-total-expansion.png') })
  assert.equal(requests.length, requestCount)
  record('saved formal total can be read by expansion without the missing-parent dead end')
  await closeNormally()
  await launch(); await openBook()
  const restarted = await page.evaluate(() => window.novelDesktop.workspace.getPlanningOutline('total'))
  assert.equal(restarted.content, saved.source.content)
  record('formal outline survives a normal close and restart')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, requestCount, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, requestCount, errors, output }))
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), `${error.stack}\n${await page.locator('body').innerText()}`).catch(() => {})
  }
  throw error
} finally {
  if (app) await closeNormally().catch(() => app?.close())
  await new Promise(done => server.close(done))
}
