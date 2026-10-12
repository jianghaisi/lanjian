import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-policy-ui-')))
assert.equal(root.startsWith(parent + '\\'), true)
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_POLICY_EVIDENCE || '../.trellis/tasks/archive/2026-10/10-11-v3-planning-policy-entrypoints/research/planning-native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const requests = [], errors = [], checks = []
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); assert.ok(!body.tools?.length); requests.push(body)
    response.setHeader('Content-Type', 'application/json')
    const text = body.messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
    const result = text.includes('复核下方') ? { issues: [] }
      : text.includes('"premise":"一句核心命题"') ? { premise: '留下', worldView: '城市规则', characters: [{ name: '周子昂', role: '主角', arcSeed: '承担代价' }], powerSystem: '', cheatSystem: '', rationale: '回应素材' }
      : text.includes('"title":"总纲标题"') ? { title: '城市选择', summary: '关系变化', content: '周子昂选择留下，城市关系发生变化。' }
      : text.includes('"volumes":[{"order":1') ? { volumes: [{ order: 1, title: '留下', goal: '承担代价', summary: '面对城市变化', ending: '关系发生变化', storyContent: '周子昂面对城市变化选择留下，回应造成关系变化。' }] }
      : { worldView: '隔离设定候选', useRealms: false, realms: [], useSystem: false, systemTemplate: '', rationale: '验证插件替换' }
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }] }))
  } catch (error) { errors.push(error.message); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-planning-policy-check', 'main/index.js')
let app, page
const mark = text => { checks.push(text); console.log(text) }
async function launch() {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
}
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function waitJob(id) {
  return page.evaluate(async id => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const state = await window.novelDesktop.planning.job(id)
      if (state.status !== 'running') return state
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error('Planning smoke timed out')
  }, id)
}
try {
  await launch()
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '创作方法隔离作品', genre: '仙侠' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '策略验证', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '策略验证'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'policy-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'policy-model', model: 'policy-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    await api.workspace.saveFoundation({ ...await api.workspace.getFoundation(), creationPath: 'materials', sourceNotes: '围绕人物选择与代价设计一个城市故事。' })
    await api.workspace.saveBookProfile({ ...await api.workspace.getBookProfile(), plannedVolumes: 1, chaptersPerVolume: 2 })
    await api.workspace.savePromptOverride({ task: 'outline', content: '作者独立要求标记：保持人物选择与代价。' })
    return { project, foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '创作方法隔离作品' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
  await page.evaluate(() => window.novelDesktop.workspace.generateFoundationDraft()); assert.equal(requests.length, 1)
  const defaultRequest = JSON.stringify(requests[0].messages)
  const library = page.getByTestId('plugin-library')
  await library.getByLabel('本地插件关键词').fill('故事逐层展开'); await library.getByRole('button', { name: '查找插件', exact: true }).click()
  await library.getByRole('button', { name: /故事逐层展开/ }).click()
  await page.getByTestId('bundled-detail').getByRole('button', { name: '复制后修改', exact: true }).click()
  const editor = page.getByTestId('plugin-draft-editor'); await editor.waitFor()
  await editor.getByText(/源文件与附带资料/).click()
  const method = '个人方法标记：先从失去的资源反推人物选择与城市规则。'
  await editor.getByLabel('插件源文件 foundation.md', { exact: true }).fill(method)
  const selectedSlots = ['blueprint', 'total-outline', 'volume-outline', 'outline-review', 'genre-guidance']
  for (const slot of selectedSlots) await editor.getByLabel(`插件源文件 ${slot}.${slot === 'genre-guidance' ? 'txt' : 'md'}`, { exact: true }).fill(`个人方法标记 ${slot}：检查人物选择与代价。`)
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click(); await editor.getByText('草稿已保存。', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  const row = page.locator(`[data-plugin-id="${personal.id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click(); await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
  const composition = page.getByTestId('book-plugin-composition')
  for (const name of ['作品设定创作方法', '创作蓝图方法', '总纲方法', '卷纲方法', '大纲复核与有限修正方法', '题材指导方法']) await composition.getByRole('checkbox', { name: new RegExp(name) }).check()
  await composition.getByRole('button', { name: '预览组合', exact: true }).click()
  await composition.getByRole('button', { name: '确认应用组合', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1'))
  await page.screenshot({ path: join(evidence, 'selected-policy.png') })
  await page.evaluate(() => window.novelDesktop.workspace.generateFoundationDraft()); assert.equal(requests.length, 2)
  const replacement = JSON.stringify(requests[1].messages)
  assert.ok(replacement.includes(method)); assert.ok(!defaultRequest.includes(method)); assert.ok(replacement.includes(personal.current))
  const original = (await page.evaluate(() => window.novelDesktop.writingPlugins.bundledPlugins())).find(p => p.manifest.id === 'lanjian.official.story-planning')
  const derived = await page.evaluate(ref => window.novelDesktop.writingPlugins.deriveBundledPlugin(ref), { pluginId: original.manifest.id, digest: original.digest })
  assert.ok(!replacement.includes(derived.files.find(f => f.path === 'foundation.md').content.trim()))
  mark('Real Electron copy/edit/install/grant/book composition changes the actual foundation model request and exact package digest')
  const runPlanning = async () => {
    const job = await page.evaluate(() => window.novelDesktop.planning.start())
    const result = await waitJob(job.id)
    assert.equal(result.status, 'completed', JSON.stringify(result.error))
    return page.evaluate(() => window.novelDesktop.planning.draft())
  }
  const start = requests.length, proposal = await runPlanning(), planningRequests = requests.slice(start)
  assert.equal(planningRequests.length, 6)
  for (const [index, slot] of [[0, 'blueprint'], [2, 'total-outline'], [4, 'volume-outline']]) assert.ok(JSON.stringify(planningRequests[index].messages).includes('个人方法标记 ' + slot))
  for (const index of [1, 3, 5]) assert.ok(JSON.stringify(planningRequests[index].messages).includes('个人方法标记 outline-review'))
  for (const request of planningRequests) {
    const text = JSON.stringify(request.messages)
    assert.ok(text.includes('作者独立要求标记')); assert.ok(text.includes('个人方法标记 genre-guidance'))
    for (const slot of selectedSlots) assert.ok(!text.includes(derived.files.find(f => f.path === `${slot}.${slot === 'genre-guidance' ? 'txt' : 'md'}`).content.trim()))
  }
  assert.equal(proposal.creativePolicy.length, 5); assert.ok(proposal.creativePolicy.every(p => p.pluginId === personal.id && p.digest === personal.current))
  mark('Blueprint, total and volume generation plus all reviews use the installed methods; author requirements remain, default method assets are absent and durable sources match exact ZIP')
  const assertUnchanged = async () => {
    const current = await page.evaluate(async () => { const api = window.novelDesktop; return { foundation: await api.workspace.getFoundation(), outlines: await api.outlines.get('total'), chapters: await api.chapters.list() } })
    assert.deepEqual(current, { foundation: state.foundation, outlines: state.outlines, chapters: state.chapters })
  }
  await assertUnchanged(); await app.close(); app = undefined; await launch()
  await page.evaluate(project => window.novelDesktop.projects.switch(project.path), state.project)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.planning.draft()), proposal)
  const beforeRestartRun = requests.length
  await page.evaluate(() => window.novelDesktop.workspace.generateFoundationDraft()); assert.equal(requests.length, beforeRestartRun + 1); assert.ok(JSON.stringify(requests.at(-1).messages).includes(method)); await assertUnchanged()
  const reopened = await runPlanning(); assert.deepEqual(reopened.creativePolicy, proposal.creativePolicy); assert.equal(requests.length, beforeRestartRun + 7)
  const sends = requests.length
  await page.evaluate(async id => { const api = window.novelDesktop.writingPlugins, view = await api.list(false); await api.setEnabled({ id, revision: view.revision, enabled: false, grants: [] }) }, personal.id)
  const blocked = await page.evaluate(async () => { try { await window.novelDesktop.workspace.generateFoundationDraft(); return false } catch { return true } })
  assert.equal(blocked, true); assert.equal(requests.length, sends); await assertUnchanged(); assert.deepEqual(errors, [])
  const blockedJob = await page.evaluate(() => window.novelDesktop.planning.start())
  assert.equal((await waitJob(blockedJob.id)).status, 'failed'); assert.equal(requests.length, sends)
  mark('Normal restart retains the selected method; revoked policy blocks before send; saved foundation/outline/chapter bytes remain unchanged')
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length }, null, 2))
  await app?.close().catch(async () => { await app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) })
  await new Promise(r => server.close(r))
  const canonical = await realpath(root); assert.equal(canonical, root); assert.ok(root.startsWith(parent + '\\')); await rm(root, { recursive: true, force: true })
}
