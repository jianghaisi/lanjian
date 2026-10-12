import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-fact-native-')))
assert.equal(dirname(root), parent)
const userData = join(root, 'app'), books = join(root, 'books'), source = join(root, '静态原材料.txt')
const evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-fact-extraction-policy-recovery/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true }), writeFile(source, '第一章 旧资料\n沈砚来到石桥。')])
const requests = [], errors = [], checks = [], processOutput = []
const proposal = [{ character: '沈砚', field: 'location', value: '石桥', event: '抵达', evidence: '沈砚来到石桥。', importance: 'high' }]
let holdNext = false, releaseResponse, app, page
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); assert.equal(body.tools, undefined); assert.match(JSON.stringify(body.messages), /当前已确认正文/)
    requests.push(body); if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: userData, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(userData, 'global-model-data', 'v1'), LANJIAN_SMOKE_DOCUMENT_PATHS: JSON.stringify([source]) })
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-fact-policy-check', 'main/index.js')
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function enterBook() {
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '事实方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
}
async function review() {
  await page.locator('[data-nav-parent="manuscript"]').focus(); await page.keyboard.press('Enter')
  await page.locator('[data-nav-leaf="chapters"]').click()
  await page.getByTestId('manuscript-editor').waitFor()
  if (!await page.getByTestId('assistant-sidebar').isVisible()) await page.getByRole('button', { name: '打开智能助笔侧栏', exact: true }).click()
  await page.getByTestId('assistant-mode-checks').click()
}
async function waitRun(id, expected) {
  const job = await page.evaluate(async id => {
    for (let i = 0; i < 400; i++) {
      try {
        const view = await window.novelDesktop.workspace.getFactExtractionJob(id)
        if (view.status !== 'running') return view
      } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
      await new Promise(r => setTimeout(r, 100))
    }
    throw Error('Fact task did not settle')
  }, id)
  assert.equal(job.status, expected, JSON.stringify(job.error)); return job
}

try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
      await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
      const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '事实方法隔离验证', genre: '悬疑' })
      const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
      const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
      await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
      await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: 'AUTHOR_REQUIREMENT：仅提取既有正文证据供审阅。' })
      const manifest = await api.imports.chooseDocuments()
      await api.imports.commitManifest({ id: manifest.id, expectedWorkItemId: project.path, files: [{ token: manifest.files[0].token, ownership: 'owned', creationMethod: 'human', title: '静态原材料', selectedChapterIndexes: [0] }] })
      if ((await api.projects.sqliteStorageStatus()).storageMode !== 'sqlite') {
        const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token)
        const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token)
      }
      // Confirm only this pre-existing static import's BODY metadata; never an outline or generated prose.
      const imported = (await api.chapters.list()).find(c => c.title === '旧资料'); if (!imported?.content.includes('沈砚来到石桥。')) throw Error('Missing static source')
      await api.chapters.updatePlanning(imported.id, { lifecycleStatus: 'REVIEWABLE' })
      await api.chapters.updatePlanning(imported.id, { lifecycleStatus: 'CONFIRMED' })
      return { project, chapterId: imported.id, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await enterBook()
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('正文与审校方法'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /正文与审校方法/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 fact-extraction.md', { exact: true }).fill('个人事实识别方法：按原文识别重要人物状态变化，不推测事实，不确认大纲。')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /人物状态变化识别方法/ }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-method.png') })
  const unchanged = async () => {
    const actual = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() } })
    assert.deepEqual(actual, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters, timeline: state.timeline })
  }
  await review(); await page.getByRole('button', { name: '基于确认版提炼', exact: true }).click()
  const first = await page.evaluate(async chapterId => { for (let i = 0; i < 100; i++) { const jobs = await window.novelDesktop.workspace.listFactExtractionJobs(chapterId); if (jobs.length) return jobs[0]; await new Promise(r => setTimeout(r, 100)) } throw Error('No fact task') }, state.chapterId)
  const completed = await waitRun(first.id, 'completed')
  await page.getByText('石桥', { exact: true }).first().waitFor(); await page.getByText('石桥', { exact: true }).first().scrollIntoViewIfNeeded()
  assert.equal(requests.length, 1); assert.match(JSON.stringify(requests[0].messages), /个人事实识别方法/); assert.match(JSON.stringify(requests[0].messages), /AUTHOR_REQUIREMENT/)
  const batches = await page.evaluate(() => window.novelDesktop.workspace.listFactBatches()); assert.equal(batches.length, 1); assert.equal(batches[0].changes.length, 1)
  await unchanged(); await page.screenshot({ path: join(evidence, 'visible-candidate.png') }); mark('Actual native UI editing/install/grant/select and confirmed-body button produce visible evidence-bound candidates without adoption')
  await app.close(); app = undefined; await launch(); await enterBook(); await review()
  assert.equal(requests.length, 1); assert.equal((await page.evaluate(id => window.novelDesktop.workspace.getFactExtractionJob(id), completed.id)).status, 'completed')
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.listFactBatches()), batches); await unchanged(); mark('Normal native restart reads original task and candidate history with zero automatic requests')
  holdNext = true
  const late = await page.evaluate(id => window.novelDesktop.workspace.startFactExtraction(id), state.chapterId)
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined; await waitRun(late.id, 'failed'); assert.equal(requests.length, 2)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.workspace.listFactBatches()), batches); await unchanged(); assert.deepEqual(errors, []); mark('Late native withdrawal rejects publication and preserves prior candidates and all formal author data')

} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors }, null, 2)); throw error
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2)); await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }); server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true })
}
