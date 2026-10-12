import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-continuation-native-')))
assert.equal(dirname(root), parent)
const userData = join(root, 'app'), books = join(root, 'books'), source = join(root, '静态原材料.txt')
const evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/10-12-v3-continuation-analysis-policy/research/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true }), writeFile(source, '第一章 资料\n资料员核对作者提供的记录。')])
const requests = [], errors = [], checks = [], processOutput = []
const areas = ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline']
const proposal = { sections: areas.map(area => ({ area, status: 'missing', content: '', evidence: [] })), rationale: '个人整理方法验证：原材料不足的部分交由作者审阅。' }
let holdNext = false, releaseResponse, app, page
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); assert.equal(body.tools, undefined); assert.match(JSON.stringify(body.messages), /旧稿接续分析候选/)
    requests.push(body); if (holdNext) { holdNext = false; await new Promise(r => { releaseResponse = r }) }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: userData, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(userData, 'global-model-data', 'v1'), LANJIAN_SMOKE_DOCUMENT_PATHS: JSON.stringify([source]) })
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-continuation-policy-check', 'main/index.js')
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); app.process().stdout?.on('data', d => processOutput.push(String(d))); app.process().stderr?.on('data', d => processOutput.push(String(d)))
  page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function enterBook() {
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '旧稿整理隔离验证' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
}
async function preparation() {
  await page.locator('[data-nav-parent="planning"]').focus(); await page.keyboard.press('Enter')
  await page.locator('[data-nav-leaf="preparation"]').click(); await page.getByTestId('preparation-continuation').click()
}
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    try {
      localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
      await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
      const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '旧稿整理隔离验证', genre: '悬疑' })
      const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '方法隔离验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
      const connection = made.connections.find(c => c.name === '方法隔离验证'), edit = await api.modelConnections.book()
      await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
      await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: 'AUTHOR_REQUIREMENT：仅整理原材料供审阅。' })
      const manifest = await api.imports.chooseDocuments()
      await api.imports.commitManifest({ id: manifest.id, expectedWorkItemId: project.path, files: [{ token: manifest.files[0].token, ownership: 'owned', creationMethod: 'human', title: '静态原材料', selectedChapterIndexes: [0] }] })
      return { project, manifestId: manifest.id, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() }
    } catch (error) { throw Error(JSON.stringify({ code: error?.code, message: error?.message || String(error) })) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await enterBook()
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('故事逐层展开'); await library.getByRole('button', { name: '查找插件', exact: true }).click(); await library.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor(); await editor.getByText(/源文件与附带资料/).click()
  await editor.getByLabel('插件源文件 continuation-analysis.md', { exact: true }).fill('个人旧稿整理方法：按原证据核对因果与选择，不补正文，不确认大纲。')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe), row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle(); await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition'); await composition.getByRole('checkbox', { name: /旧稿接续整理方法/ }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click(); await composition.getByRole('button', { name: '确认应用组合', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-method.png') })
  const unchanged = async () => {
    const actual = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list(), timeline: await api.workspace.getTimeline() } })
    assert.deepEqual(actual, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters, timeline: state.timeline })
  }
  await preparation(); await page.getByTestId('generate-continuation-analysis').click(); await page.getByTestId('continuation-analysis').waitFor(); assert.equal(await page.getByLabel('接续分析整体判断', { exact: true }).inputValue(), proposal.rationale)
  const candidate = (await page.evaluate(() => window.novelDesktop.imports.continuationAnalysis())).candidate
  assert.equal(requests.length, 1); assert.match(JSON.stringify(requests[0].messages), /个人旧稿整理方法/); assert.match(JSON.stringify(requests[0].messages), /AUTHOR_REQUIREMENT/); assert.equal(candidate.creativePolicy[0].pluginId, personal.id)
  await unchanged(); await page.screenshot({ path: join(evidence, 'visible-candidate.png') }); mark('Actual native UI editing/install/grant/select and manual old-manuscript button use the installed method; nine sections remain candidates')
  await app.close(); app = undefined; await launch(); await enterBook(); await preparation(); await page.getByTestId('continuation-analysis').waitFor()
  assert.equal(requests.length, 1); assert.equal((await page.evaluate(() => window.novelDesktop.imports.continuationAnalysis())).candidate.id, candidate.id); await unchanged(); mark('Normal native restart keeps original method provenance and candidate without sending or adopting')
  await page.evaluate(async id => window.novelDesktop.imports.generateContinuationAnalysis(id), state.manifestId); assert.equal(requests.length, 2); assert.match(JSON.stringify(requests[1].messages), /个人旧稿整理方法/)
  const latest = (await page.evaluate(() => window.novelDesktop.imports.continuationAnalysis())).candidate
  holdNext = true
  const pending = page.evaluate(async id => { try { await window.novelDesktop.imports.generateContinuationAnalysis(id); return { ok: true } } catch (error) { return { ok: false, code: error.code, message: error.message } } }, state.manifestId)
  for (let i = 0; !releaseResponse && i < 300; i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(releaseResponse); await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  releaseResponse(); releaseResponse = undefined; assert.equal((await pending).ok, false); assert.equal(requests.length, 3)
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.imports.continuationAnalysis())).candidate, latest); await unchanged(); assert.deepEqual(errors, []); mark('Late native withdrawal withholds the new response, preserves the prior candidate and all formal author data')
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); await writeFile(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors }, null, 2)); throw error
} finally {
  releaseResponse?.(); await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2)); await writeFile(join(evidence, 'process.log'), processOutput.join(''))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }); server.closeAllConnections(); await new Promise(r => server.close(r))
  assert.equal(await realpath(root), root); assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true })
}
