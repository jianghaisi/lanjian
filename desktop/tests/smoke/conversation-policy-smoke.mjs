import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-conversation-policy-')))
assert.ok(root.startsWith(parent + '\\'))
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-conversation-policy-entrypoints/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = []
let holdNext = false, releaseResponse
const question = { questions: [{ id: 'tone', prompt: '采用哪种讨论语气？', mode: 'single', required: true, options: [{ id: 'plain', label: '平实讨论', recommended: true }, { id: 'light', label: '轻松讨论' }] }] }
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw), text = JSON.stringify(body.messages)
    assert.ok(body.tools?.length, 'No prose completion is permitted in this harness')
    requests.push(body)
    if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    const result = body.messages.some(m => m.role === 'tool')
      ? { role: 'assistant', content: '已保留你的讨论偏好，未生成正文。' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'original-call', type: 'function', function: text.includes('SAMPLE_WITHOUT_CONFIRMATION')
        ? { name: 'write_sample', arguments: JSON.stringify({ instruction: '按当前章节提供样稿。' }) }
        : { name: body.tools.find(t => t.function.name.includes('_ask_author_')).function.name, arguments: JSON.stringify(question) } }] }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: result, finish_reason: result.tool_calls ? 'tool_calls' : 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-conversation-policy-check', 'main/index.js')
let app, page
const processOutput = []
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d))); page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
    localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '对话方法隔离验证', genre: '仙侠' })
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
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '对话方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('正文与审校方法'); await library.getByRole('button', { name: '查找插件', exact: true }).click()
  await library.getByRole('button', { name: /正文与审校方法/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  for (const slot of ['assistant-conversation', 'assistant-sample']) await editor.getByLabel(`插件源文件 ${slot}.md`, { exact: true }).fill(`个人创作方法 ${slot}：核对作者指定目标与已有资料。`)
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  const row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition')
  for (const name of ['通用助笔对话方法', '对话样稿方法']) await composition.getByRole('checkbox', { name: new RegExp(name) }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-methods.png') })

  const choose = async selected => page.evaluate(async ({ selected, personal }) => {
    const api = window.novelDesktop.writingPlugins, view = await api.list(true)
    const preview = await api.previewComposition({ bookToken: view.book.token, revision: view.revision, entries: selected ? ['assistant-conversation', 'assistant-sample'].map(contributionId => ({ pluginId: personal.id, digest: personal.current, contributionId, params: {} })) : [] })
    return api.applyComposition(preview.planId)
  }, { selected, personal })
  async function openAssistant() {
    if (await page.getByTestId('app-boot-enter').isVisible()) await page.getByTestId('app-boot-enter').click()
    await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
    if (await page.locator('.project-library').isVisible()) { await page.locator('[data-library-view="all"]').click(); await page.locator('.work-item-open').filter({ hasText: '对话方法隔离验证' }).first().click() }
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
    if (!await page.getByTestId('field-assistant-instruction').isVisible()) {
      await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter')
      await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
      await page.locator('.assistant-toggle').click()
    }
    await page.getByTestId('field-assistant-instruction').waitFor()
  }
  const unchanged = async () => {
    const current = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } })
    assert.deepEqual(current, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters })
  }
  async function waitRun(id, expected) {
    const view = await page.evaluate(async id => {
      for (let i = 0; i < 300; i++) { const view = await window.novelDesktop.fieldAssistant.runs.status(id); if (['completed', 'failed', 'cancelled', 'waiting-input'].includes(view.status)) return view; await new Promise(r => setTimeout(r, 100)) }
      throw Error('Assistant run did not settle')
    }, id)
    assert.equal(view.status, expected, view.message); return view
  }
  const start = async message => page.evaluate(async message => { const { project } = await window.novelDesktop.projects.status(); return window.novelDesktop.fieldAssistant.runs.start({ operationId: crypto.randomUUID(), workItemId: project.id, page: 'world', message, chapterId: 1, selectedCharacters: 0, history: [], targets: [] }) }, message)
  await openAssistant(); await page.getByTestId('field-assistant-instruction').fill('仅讨论资料与偏好，不生成正文。')
  await page.getByTestId('send-field-assistant').click(); await page.getByTestId('author-question-card').waitFor({ timeout: 60000 }).catch(async error => {
    await writeFile(join(evidence, 'question-failure.json'), JSON.stringify({ runs: await page.evaluate(() => window.novelDesktop.fieldAssistant.runs.recent()), text: await page.locator('.field-assistant').innerText(), requests }, null, 2))
    await page.screenshot({ path: join(evidence, 'question-failure.png') }); throw error
  })
  assert.equal(await page.getByTestId('submit-author-answer').isDisabled(), true)
  assert.equal(requests.length, 1); assert.match(JSON.stringify(requests[0].messages), /个人创作方法 assistant-conversation/)
  const waiting = await page.evaluate(() => window.novelDesktop.fieldAssistant.runs.recent().then(r => r.find(v => v.status === 'waiting-input')))
  await choose(false); await unchanged(); await app.close(); app = undefined
  await launch(); await page.getByTestId('app-boot-enter').waitFor({ timeout: 60000 }); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.evaluate(project => window.novelDesktop.projects.switch(project.path), state.project); await openAssistant()
  await page.getByRole('button', { name: '恢复任务', exact: true }).waitFor(); assert.equal(requests.length, 1)
  await page.getByRole('button', { name: '恢复任务', exact: true }).click(); await page.getByTestId('submit-author-answer').waitFor({ timeout: 60000 }).catch(async error => {
    await writeFile(join(evidence, 'resume-failure.json'), JSON.stringify({ runs: await page.evaluate(() => window.novelDesktop.fieldAssistant.runs.recent()), text: await page.locator('.field-assistant').innerText() }, null, 2))
    await page.screenshot({ path: join(evidence, 'resume-failure.png') }); throw error
  })
  assert.equal(await page.getByTestId('submit-author-answer').isDisabled(), true); assert.equal(requests.length, 1)
  await page.screenshot({ path: join(evidence, 'restored-question.png') })
  await page.getByLabel('平实讨论').check(); await page.getByTestId('submit-author-answer').click()
  await page.getByText('已保留你的讨论偏好，未生成正文。', { exact: true }).waitFor()
  await waitRun(waiting.id, 'completed'); assert.equal(requests.length, 2)
  assert.match(JSON.stringify(requests[1].messages), /个人创作方法 assistant-conversation/)
  assert.equal(requests[1].messages.filter(m => m.role === 'tool' && m.tool_call_id === 'original-call').length, 1)
  mark('Actual UI edit/install/grant/select, normal exit/relaunch with no resend, then explicit question recovery and real preference submission retain the original method after current composition is cleared')
  await choose(true)
  const sample = await start('SAMPLE_WITHOUT_CONFIRMATION'); const rejected = await waitRun(sample.id, 'failed')
  assert.match(rejected.message, /作者确认|审阅|大纲/); assert.equal(rejected.result, undefined); assert.equal(requests.length, 3)
  mark('Actual main sample tool rejects the synthetic unconfirmed chapter with zero prose calls; no outline confirmation interface is invoked')
  holdNext = true; const late = await start('仅核对资料，等待偏好问题。')
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); assert.equal(requests.length, 4)
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined
  const cancelled = await waitRun(late.id, 'cancelled'); assert.equal(cancelled.question, undefined); assert.equal(cancelled.result, undefined); assert.equal(cancelled.handoff, undefined)
  await unchanged(); assert.deepEqual(errors, [])
  mark('Withdrawal prevents the received late question from publishing; original foundation/outlines/chapters remain unchanged')
} finally {
  releaseResponse?.()
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2))
  await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) })
  server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + '\\')); await rm(root, { recursive: true, force: true })
}
