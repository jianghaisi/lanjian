import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { officialCreativePackages, officialCreativePackagesFor } from '@lanjian/writing-plugin-package/official'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-official-release-native-')))
assert.ok(root.startsWith(parent + '\\'))
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-official-release-recovery/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = []
let holdNext = false, releaseResponse
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw), text = JSON.stringify(body.messages)
    assert.ok(!body.tools?.length); assert.ok(!text.includes('生成候选正文') && !text.includes('唯一允许处理的原文'), 'No prose or selection generation in this harness')
    requests.push(body)
    if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    const result = text.includes('返回1—3个当前章卡候选')
      ? JSON.stringify({ answer: '核对资料的不同安排仅供讨论。', options: [{ title: '先核对现有资料', rationale: '保持已保存依据', goal: '核对当前资料' }] })
      : '本次检索未找到足够依据。'
    if (body.stream) {
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: result }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    } else {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: result }, finish_reason: 'stop' }] }))
    }
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const oldBuild = resolve(process.env.LANJIAN_RELEASE_OLD_BUILD || 'out-durable-writing-check', 'main/index.js')
const newBuild = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-official-release-check', 'main/index.js')
let build = oldBuild
const currentReleased = officialCreativePackages().map(pkg => ({ pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest }))
const buildHashes = { old: createHash('sha256').update(await readFile(oldBuild)).digest('hex'), current: createHash('sha256').update(await readFile(newBuild)).digest('hex') }
let originalPolicy, recoveredPolicy, failure
let app, page
const processOutput = []
const mark = text => { checks.push(text); console.log(text) }
function storedPolicy(project, taskId) {
  const db = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'), { readOnly: true })
  try {
    const row = db.prepare('SELECT checkpoint_json FROM task_runs WHERE id = ?').get(taskId)
    assert.ok(row)
    return JSON.parse(row.checkpoint_json).recovery.creativePolicy
  } finally { db.close() }
}
function storedOperation(project, taskId) {
  const db = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'), { readOnly: true })
  try { return db.prepare('SELECT idempotency_key FROM task_runs WHERE id = ?').get(taskId).idempotency_key }
  finally { db.close() }
}
async function closeFixture() {
  if (!app) return
  const ownApp = app; let timer
  try { await Promise.race([ownApp.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Isolated release fixture shutdown timed out')), 8000) })]) }
  catch (error) {
    const fixtureProcess = ownApp.process()
    if (fixtureProcess.exitCode === null) {
      if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(fixtureProcess.pid), '/T', '/F'], { windowsHide: true }).catch(() => fixtureProcess.kill())
      else fixtureProcess.kill()
    }
    throw error
  } finally { clearTimeout(timer); app = undefined }
}
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d))); page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function run(skill) {
  return page.evaluate(async skill => {
    try {
    const api = window.novelDesktop, { project } = await api.projects.status()
    const task = await api.ai.startWritingAgent({ operationId: crypto.randomUUID(), request: { expectedWorkItemId: project.id, chapterId: 1, message: '只依据当前作品核对资料，不生成正文。', currentDraft: '', preferredSkill: skill } })
    for (let i = 0; i < 600; i++) {
      const state = await api.ai.writingAgentTask(task.id)
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.status)) return state
      await new Promise(r => setTimeout(r, 100))
    }
    throw Error('Writing policy task timed out')
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, skill)
}
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
    localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '原发行恢复隔离验证', genre: '仙侠' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: '只核对方法组合和已保存资料。' })
    if (!(await api.chapters.list()).length) { const chapter = await api.chapters.create(); if (chapter.id !== 1) throw Error('Unexpected fixture chapter identity') }
    const storage = await api.projects.sqliteStorageStatus()
    if (storage.storageMode !== 'sqlite') {
      const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token)
      const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token)
    }
    return { project, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '原发行恢复隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const defaultQuery = await run('query'); assert.equal(defaultQuery.status, 'succeeded', defaultQuery.errorMessage)
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('正文与审校方法'); await library.getByRole('button', { name: '查找插件', exact: true }).click()
  await library.getByRole('button', { name: /正文与审校方法/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  for (const slot of ['prose', 'review', 'selection-revision', 'chapter-discussion', 'work-query']) await editor.getByLabel(`插件源文件 ${slot}.md`, { exact: true }).fill(`个人创作方法 ${slot}：核对作者指定目标与已有资料。`)
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  const row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition')
  for (const name of ['正文场景创作方法', '正文与场景审校方法', '选段处理方法', '章卡讨论方法', '作品问答方法']) await composition.getByRole('checkbox', { name: new RegExp(name) }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-methods.png') })

  async function startQuery() {
    return page.evaluate(async () => {
      const api = window.novelDesktop, { project } = await api.projects.status()
      return api.ai.startWritingAgent({ operationId: crypto.randomUUID(), request: { expectedWorkItemId: project.id, chapterId: 1, message: '只依据当前作品核对资料，不生成正文。', currentDraft: '', preferredSkill: 'query' } })
    })
  }
  async function waitTask(id, expected) {
    const task = await page.evaluate(async id => {
      for (let i = 0; i < 300; i++) { const state = await window.novelDesktop.ai.writingAgentTask(id); if (!['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(state.status)) return state; await new Promise(r => setTimeout(r, 100)) }
      throw Error('Durable writing task timed out')
    }, id)
    assert.equal(task.status, expected, task.error?.message || task.errorMessage || JSON.stringify(task)); return task
  }
  const choose = async selected => page.evaluate(async ({ selected, personal }) => {
    const api = window.novelDesktop.writingPlugins, view = await api.list(true)
    const preview = await api.previewComposition({ bookToken: view.book.token, revision: view.revision, entries: selected ? [{ pluginId: personal.id, digest: personal.current, contributionId: 'work-query', params: {} }] : [] })
    return api.applyComposition(preview.planId)
  }, { selected, personal })
  const unchanged = async () => {
    const current = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } })
    assert.deepEqual(current, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters })
  }
  holdNext = true; const started = await startQuery()
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); assert.equal(requests.length, 2)
  const paused = await page.evaluate(id => window.novelDesktop.ai.pauseWritingAgentTask(id), started.id)
  assert.equal(paused.status, 'paused'); assert.ok(paused.contextPackage.contexts.some(c => c.preview.includes('个人创作方法 work-query')))
  releaseResponse(); releaseResponse = undefined
  await choose(false); await unchanged(); await closeFixture()
  originalPolicy = storedPolicy(state.project, paused.id)
  assert.notDeepEqual(originalPolicy.released, currentReleased)
  assert.equal(officialCreativePackagesFor(originalPolicy.released).length, originalPolicy.released.length)
  mark('The unmodified older Electron build captured a real different registered default release; shutdown and inspection issue zero additional model requests')
  build = newBuild
  await launch(); await page.evaluate(project => window.novelDesktop.projects.switch(project.path), state.project)
  assert.deepEqual(await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), paused.id), paused); assert.equal(requests.length, 2)
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) await page.locator('.work-item-open').filter({ hasText: '原发行恢复隔离验证' }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  if (!await page.getByTestId('assistant-mode-tasks').isVisible()) await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
  await page.getByTestId('assistant-mode-tasks').click()
  await page.getByTestId('task-center-panel').waitFor()
  assert.match(await page.getByTestId(`task-center-item-${paused.id}`).innerText(), /已暂停/)
  await page.screenshot({ path: join(evidence, 'original-paused-ui.png') })
  await page.getByTestId(`task-center-resume-${paused.id}`).click()
  let child
  for (let i = 0; !child && i < 300; i++) {
    child = await page.evaluate(id => window.novelDesktop.ai.listWritingAgentTasks(1).then(tasks => tasks.find(task => task.parentTaskRunId === id)), paused.id)
    if (!child) await new Promise(r => setTimeout(r, 100))
  }
  assert.ok(child, 'real task-center resume must create the original task child')
  const done = await waitTask(child.id, 'succeeded'); assert.equal(done.turn?.candidate, undefined)
  const operation = storedOperation(state.project, child.id)
  assert.equal(requests.length, 3); assert.ok(JSON.stringify(requests[2].messages).includes('个人创作方法 work-query'))
  assert.deepEqual(await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), paused.id), paused)
  mark('Actual Electron edits, installs and selects personal methods; a received query pauses, survives normal exit/relaunch without resend, then explicitly resumes the original method after current composition is cleared')
  await choose(true); holdNext = true; const pending = await startQuery()
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); assert.equal(requests.length, 4)
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined
  const failed = await waitTask(pending.id, 'failed'); assert.equal(failed.artifact, undefined); assert.equal(failed.partial, undefined)
  const rejected = await page.evaluate(id => window.novelDesktop.ai.retryWritingAgentTask(id, crypto.randomUUID()), failed.id)
  await waitTask(rejected.id, 'failed'); assert.equal(requests.length, 4)
  assert.equal((await page.evaluate(({ id, operation }) => window.novelDesktop.ai.resumeWritingAgentTask(id, operation), { id: paused.id, operation })).id, child.id)
  await unchanged(); assert.deepEqual(errors, [])
  mark('Withdrawal blocks late publication and a new explicit retry before any send; the existing resume receipt returns the same child without authorization recapture, and formal foundation/outlines/manuscript are unchanged')
  await page.screenshot({ path: join(evidence, 'recovered-original.png') })
  await closeFixture()
  recoveredPolicy = storedPolicy(state.project, child.id)
  assert.deepEqual(recoveredPolicy, originalPolicy)
  mark('After an actual binary upgrade the persisted child retains the exact original default collection and original installed methods, parameters and fragments')
} catch (error) {
  failure = { message: error.message, stack: error.stack }
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  releaseResponse?.()
  await closeFixture().catch(error => { errors.push(error.message) })
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length, originalPolicy, recoveredPolicy, currentReleased, buildHashes, failure }, null, 2))
  await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + '\\')); await rm(root, { recursive: true, force: true })
}
