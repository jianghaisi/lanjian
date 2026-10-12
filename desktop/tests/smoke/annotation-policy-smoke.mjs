import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-annotation-policy-')))
assert.ok(root.startsWith(parent + '\\'))
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-annotation-policy-recovery/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = [], processOutput = []
let holdNext = false, releaseResponse
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw), text = JSON.stringify(body.messages)
    assert.ok(!body.tools?.length && !body.stream)
    assert.ok(!text.includes('（body）') && !text.includes('生成候选正文'), 'Only synthetic outline annotations')
    requests.push(body)
    if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    const instruction = body.messages.find(m => m.role === 'user')?.content || ''
    const result = instruction.startsWith('复核下方') ? '{"issues":[]}' : instruction.includes('作者已回答：')
      ? JSON.stringify({ documentId: instruction.match(/唯一目标文档 (\S+)（/)[1], changes: [{ quote: '先核对现有资料，再提交作者审阅。', replacement: '先核对本次已保存的资料，再提交作者审阅。' }] })
      : JSON.stringify({ ask_author: { questions: [{ id: 'motive', prompt: '核对哪一份当前资料？', mode: 'text', required: true, options: [] }] } })
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: result }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-annotation-policy-check', 'main/index.js')
let app, page
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); page = await app.firstWindow(); page.setDefaultTimeout(30000)
  app.process().stdout?.on('data', data => processOutput.push(String(data))); app.process().stderr?.on('data', data => processOutput.push(String(data)))
  app.process().on('exit', (code, signal) => processOutput.push(`process exit ${code} ${signal}`))
  page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function waitTask(id, expected) {
  const state = await page.evaluate(async id => {
    for (let i = 0; i < 600; i++) { const value = await window.novelDesktop.documentReview.generation.status(id); if (!['queued', 'running'].includes(value.status)) return value; await new Promise(r => setTimeout(r, 100)) }
    throw Error('Annotation task timed out')
  }, id)
  assert.equal(state.status, expected, state.error || ''); return state
}
async function start(selection) {
  return page.evaluate(async selection => {
    try { const api = window.novelDesktop.documentReview.generation, analysis = await api.analyzeRelated(selection); return await api.start({ ...selection, operationId: crypto.randomUUID(), mode: 'current', receipt: analysis.receipt, target: selection.origin, targets: [selection.origin] }) }
    catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, selection)
}
const submission = waiting => ({ runId: waiting.id, questionId: waiting.question.id, questionVersion: waiting.question.version, answerSubmissionId: crypto.randomUUID(), answers: [{ id: 'motive', chosenOptionIds: [], customText: '核对本次已保存的资料。', skipped: false }] })
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
      await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
      const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '批注方法隔离验证', genre: '悬疑' })
      const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '批注隔离模型', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
      const connection = made.connections.find(c => c.name === '批注隔离模型'), edit = await api.modelConnections.book()
      await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
      await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: '仅验证合成大纲批注方法。' })
      await api.outlines.update('total', '先核对现有资料，再提交作者审阅。')
      if (!(await api.chapters.list()).length) await api.chapters.create()
      const storage = await api.projects.sqliteStorageStatus()
      if (storage.storageMode !== 'sqlite') { const m = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(m.token); const a = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(a.token) }
      const snapshot = await api.documentReview.readSnapshot({ workItemId: project.id, kind: 'total' })
      const annotation = await api.documentReview.annotations.create({ document: snapshot.ref, operationId: crypto.randomUUID(), expectedRevision: snapshot.revision, expectedDraftRevision: null, title: snapshot.title, draftText: snapshot.content, start: 0, end: 2, body: '核对当前资料后提出修纲建议，不改变正式稿。' })
      return { project, selection: { origin: snapshot.ref, annotations: [{ id: annotation.id, revision: annotation.revision }] }, snapshot, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '批注方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library'); await library.getByLabel('本地插件关键词').fill('正文与审校方法'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /正文与审校方法/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 annotation-revision.md', { exact: true }).fill('PERSONAL_ANNOTATION_NATIVE：只核对作者指定的大纲资料，供逐处审阅。')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor(); await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /批注改稿方法/ }).check(); await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await composition.getByRole('checkbox', { name: /批注改稿方法/ }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'selected-annotation-method.png') })
  const waiting = await waitTask((await start(state.selection)).id, 'waiting-input')
  assert.equal(requests.length, 1); assert.ok(JSON.stringify(requests[0].messages).includes('PERSONAL_ANNOTATION_NATIVE'))
  await app.close(); app = undefined; await launch(); await page.evaluate(project => window.novelDesktop.projects.switch(project.path), state.project)
  assert.deepEqual(await page.evaluate(id => window.novelDesktop.documentReview.generation.status(id), waiting.id), waiting); assert.equal(requests.length, 1)
  const choose = async enabled => page.evaluate(async ({ enabled, personal }) => {
    try {
      const api = window.novelDesktop.writingPlugins, view = await api.list(true), preview = await api.previewComposition({ bookToken: view.book.token, revision: view.revision,
        entries: enabled ? [{ pluginId: personal.id, digest: personal.current, contributionId: 'annotation-revision', params: {} }] : [] }); return api.applyComposition(preview.planId)
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { enabled, personal })
  await choose(false)
  const next = await page.evaluate(answer => window.novelDesktop.documentReview.generation.answer(answer), submission(waiting)), completed = await waitTask(next.id, 'succeeded')
  assert.equal(requests.length, 3); assert.ok(JSON.stringify(requests[1].messages).includes('PERSONAL_ANNOTATION_NATIVE')); assert.ok(JSON.stringify(requests[2].messages).includes('PERSONAL_ANNOTATION_NATIVE')); assert.ok(completed.pending > 0)
  mark('Actual Electron derives, edits, installs and selects the annotation asset; waiting survives normal restart and answering after a changed current composition restores the original method for generation and outline review')
  await choose(true)
  const second = await waitTask((await start(state.selection)).id, 'waiting-input')
  holdNext = true; const pending = await start(state.selection)
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); const sends = requests.length
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined
  const failed = await waitTask(pending.id, 'failed'); assert.equal(failed.reviewId, null); assert.equal(failed.question, null)
  const rejection = await page.evaluate(async answer => { try { await window.novelDesktop.documentReview.generation.answer(answer); return null } catch (e) { return { code: e.code, message: e.message } } }, submission(second))
  assert.equal(rejection.code, 'CONFLICT'); assert.equal(requests.length, sends)
  const current = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } })
  assert.deepEqual(current, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters }); assert.deepEqual(errors, [])
  mark('Withdrawal after a request is received discards late questions/artifacts and blocks waiting-task restore with zero further requests; formal outline, foundation and manuscript remain unchanged')
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }); await new Promise(r => server.close(r))
  await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + '\\')); await rm(root, { recursive: true, force: true })
}
