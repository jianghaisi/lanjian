import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-idea-native-')))
assert.equal(dirname(root), parent)
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-idea-policy-recovery/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = [], processOutput = []
let failNext = false, holdNext = false, releaseResponse
const proposal = { options: [{ title: '原方法灵感候选', content: '保留原灵感，比较可供作者审阅的发展方向。此候选没有写入正式设定或大纲。', rationale: '仅验证创作方法与候选持久记录。' }] }
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw)
    assert.equal(body.tools, undefined); assert.match(JSON.stringify(body.messages), /灵感发散任务|梗概方案任务/)
    requests.push(body)
    if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    if (failNext) { failNext = false; response.statusCode = 503; response.end(JSON.stringify({ error: { message: 'controlled fixture outage' } })); return }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-idea-policy-check', 'main/index.js')
let app, page
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function waitRun(id, expected) {
  const view = await page.evaluate(async id => {
    for (let i = 0; i < 600; i++) {
      let view
      try { view = await window.novelDesktop.workspace.ideaGeneration(id) }
      catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(view.status)) return view
      await new Promise(r => setTimeout(r, 100))
    }
    throw Error('Idea run did not settle')
  }, id)
  assert.equal(view.status, expected, view.error); return view
}
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '灵感方法隔离验证', genre: '悬疑' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: '只验证原灵感方法和候选历史。' })
    const storage = await api.projects.sqliteStorageStatus()
    if (storage.storageMode !== 'sqlite') { const migration = await api.projects.previewSqliteShadowMigration(); await api.projects.importSqliteShadowMigration(migration.token); const activation = await api.projects.previewSqliteActivation(); await api.projects.activateSqliteStorage(activation.token) }
    await api.workspace.saveIdea({ title: '隔离灵感便签', content: '只比较已经保存的想法，供作者审阅。', status: 'candidate' })
    return { project, ideas: await api.workspace.listIdeas(), foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '灵感方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('故事逐层展开'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  for (const slot of ['idea-divergence', 'idea-synopsis']) await editor.getByLabel(`插件源文件 ${slot}.md`, { exact: true }).fill(`个人灵感方法 ${slot}：核对作者本次方向与原灵感，不制造正式事实。`)
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition')
  for (const name of ['灵感发散方法', '故事梗概方法']) await composition.getByRole('checkbox', { name: new RegExp(name) }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-methods.png') })
  const choose = async selected => page.evaluate(async ({ selected, personal }) => {
    const api = window.novelDesktop.writingPlugins, view = await api.list(true), preview = await api.previewComposition({ bookToken: view.book.token, revision: view.revision, entries: selected ? ['idea-divergence', 'idea-synopsis'].map(contributionId => ({ pluginId: personal.id, digest: personal.current, contributionId, params: {} })) : [] })
    return api.applyComposition(preview.planId)
  }, { selected, personal })
  const unchanged = async () => { const actual = await page.evaluate(async () => { const api = window.novelDesktop; return { ideas: await api.workspace.listIdeas(), foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } }); assert.deepEqual(actual, { ideas: state.ideas, foundation: state.foundation, outlines: state.outlines, chapters: state.chapters }) }
  async function openIdea() {
    await page.getByRole('button', { name: '素材', exact: true }).click(); await page.getByTestId('idea-list').getByRole('button', { name: /隔离灵感便签/ }).click(); await page.getByTestId('idea-generation').waitFor()
  }
  const latest = async () => page.evaluate(() => window.novelDesktop.workspace.listIdeaGenerations().then(tasks => tasks[0]))
  await openIdea(); await page.getByTestId('idea-diverge').click(); let first
  for (let i = 0; !first && i < 100; i++) { first = await latest(); if (!first) await new Promise(r => setTimeout(r, 100)) }
  assert.ok(first); await waitRun(first.id, 'succeeded'); assert.equal(requests.length, 1); assert.match(JSON.stringify(requests[0].messages), /个人灵感方法 idea-divergence/)
  await page.getByTestId('idea-generation-result').getByText('原方法灵感候选').waitFor()
  failNext = true; await page.getByTestId('idea-synopsis').click(); let failed
  for (let i = 0; (!failed || failed.id === first.id) && i < 100; i++) { failed = await latest(); if (!failed || failed.id === first.id) await new Promise(r => setTimeout(r, 100)) }
  assert.notEqual(failed.id, first.id); await waitRun(failed.id, 'failed'); assert.equal(requests.length, 2); assert.match(JSON.stringify(requests[1].messages), /个人灵感方法 idea-synopsis/)
  mark('Actual UI edit/install/grant/select and both visible idea generation buttons consume their distinct personal method assets')
  await choose(false); await unchanged(); await app.close(); app = undefined
  await launch(); await page.getByTestId('app-boot-enter').waitFor({ timeout: 60000 }); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.evaluate(project => window.novelDesktop.projects.switch(project.path), state.project); await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '灵感方法隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await openIdea(); assert.equal(requests.length, 2); await page.getByTestId(`retry-idea-generation-${failed.id}`).click()
  let child; for (let i = 0; (!child || child.id === failed.id) && i < 200; i++) { child = await latest(); if (!child || child.id === failed.id) await new Promise(r => setTimeout(r, 100)) }
  assert.notEqual(child.id, failed.id); await waitRun(child.id, 'succeeded'); assert.equal(requests.length, 3); assert.match(JSON.stringify(requests[2].messages), /个人灵感方法 idea-synopsis/)
  await page.getByTestId('idea-generation-result').filter({ hasText: '梗概方案' }).filter({ hasText: '候选已保存' }).getByText('原方法灵感候选', { exact: true }).waitFor()
  await page.screenshot({ path: join(evidence, 'restored-candidate.png') }); await unchanged()
  mark('Normal native exit/relaunch sends nothing; real retry button restores the original installed synopsis method after the current composition was cleared')
  await choose(true); holdNext = true
  const late = await page.evaluate(async idea => window.novelDesktop.workspace.startIdeaGeneration({ operationId: crypto.randomUUID(), ideaId: idea.id, expectedUpdatedAt: idea.updatedAt, mode: 'diverge', instruction: '仅比较候选。' }), state.ideas[0])
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); assert.equal(requests.length, 4)
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined
  const denied = await waitRun(late.id, 'failed'); assert.equal(denied.proposal, null); assert.equal(denied.rawResult, undefined)
  await unchanged(); assert.deepEqual(errors, []); mark('Late withdrawal blocks visible valid/invalid artifacts while original idea notes, foundation, outlines and chapters remain unchanged')
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, runs: await page?.evaluate(() => window.novelDesktop.workspace.listIdeaGenerations()).catch(e => ({ error: e.message })) }, null, 2)); throw error
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2)); await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) })
  server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true })
}
