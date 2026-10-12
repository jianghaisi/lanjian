import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-bundled-ui-')))
const userData = join(root, 'app'), books = join(root, 'books'), evidence = resolve(process.env.LANJIAN_PLUGIN_EVIDENCE_DIR || '../.trellis/tasks/09-20-v3-plugin-marketplace-and-personal-authoring/research/local-library/native')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const checks = [], errors = [], requests = [], consoleErrors = []; let app, page, conversionCopyId
const mark = value => { checks.push(value); console.log(value) }
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); requests.push(body)
    response.setHeader('Content-Type', 'application/json')
    const reply = message => response.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))
    if (!body.tools?.length) {
      const prompt = JSON.stringify(body.messages)
      assert.match(prompt, /合作找回失物/)
      assert.match(prompt, /本地插件隔离作品/)
      if (prompt.includes('任务：核对')) { assert.match(prompt, /正式正文不进入插件创建和上传/); assert.match(prompt, /不编造引文/) }
      else assert.ok(prompt.includes('任务：规划言情情感线') || prompt.includes('任务：规划场景节奏'))
      return reply({ role: 'assistant', content: '合成插件建议：先核对目标与事件证据，再由作者决定。' })
    }
    const results = body.messages.filter(m => m.role === 'tool')
    const call = (name, args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `call-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    const input = body.messages.filter(m => m.role === 'user').at(-1)?.content || ''
    const named = (id, args) => { const definition = body.tools.find(t => t.function.name.startsWith(`p_builtin_plugins_${id}_`)); assert.ok(definition); call(definition.function.name, args) }
    const values = results.map(r => { const v = JSON.parse(r.content); return v.data ? JSON.parse(v.data) : v })
    const newCases = {
      NEW_ROMANCE: ['plan_romance_arc', { outlineKey: 'total', focus: '保留双方独立目标' }, 'lanjian.bundled.romance-arc'],
      NEW_SCENE: [' \nPLAN_SCENE_RHYTHM\t', { outlineKey: 'total', focus: '场景应有选择和代价' }, 'lanjian.bundled.scene-rhythm'],
      NEW_AUDIT: ['lanjian.bundled.chapter-consistency/audit_chapter_consistency', { outlineKey: 'total', focus: '核对证据', chapterId: 1 }, 'lanjian.bundled.chapter-consistency'],
      NEW_SPACING: ['space_chinese_text', { text: '主角获得10点EXP。\r\n🌙  ' }, 'lanjian.bundled.chinese-spacing'],
      NEW_CONVERSION: ['convert_chinese_text', { text: '头发发展，软件鼠标自行车。\r\n🌙  ', mode: 'to-taiwan-phrases' }, 'lanjian.bundled.chinese-conversion'],
      COPY_CONVERSION: ['convert_chinese_text', { text: '头发发展，软件鼠标自行车。\r\n🌙  ', mode: 'to-taiwan-phrases' }, conversionCopyId]
    }
    const selected = Object.keys(newCases).find(key => input.includes(key))
    if (selected) {
      const [query, args, pluginId] = newCases[selected]
      if (!results.length) return call('discover_tools', { query })
      if (results.length === 1) {
        const expectedIds = query === 'convert_chinese_text' && conversionCopyId ? ['lanjian.bundled.chinese-conversion', conversionCopyId] : [pluginId]
        assert.deepEqual(values[0].tools.map(t => t.pluginId).sort(), expectedIds.sort(), query)
        assert.equal(values[0].total, expectedIds.length); assert.equal(values[0].nextOffset, -1)
        assert.ok(values[0].tools.every(t => t.toolId === query.trim().toLowerCase().split('/').at(-1)))
        if (expectedIds.length === 2) assert.equal(values[0].tools[0].description, values[0].tools[1].description)
        const found = values[0].tools.find(t => t.pluginId === pluginId); assert.ok(found)
        const tool = body.tools.find(t => t.function.name === found.name); assert.ok(tool, found.name)
        return call(tool.function.name, args)
      }
      const result = values.at(-1)
      if (selected === 'NEW_SPACING') { assert.equal(result.original, args.text); assert.equal(result.text, '主角获得 10 点 EXP。\r\n🌙  '); assert.deepEqual(result.evidence, []) }
      else if (selected === 'NEW_CONVERSION' || selected === 'COPY_CONVERSION') { assert.equal(result.original, args.text); assert.equal(result.text, '頭髮發展，軟體滑鼠腳踏車。\r\n🌙  '); assert.deepEqual(result.evidence, []) }
      else { assert.equal(result.text, '合成插件建议：先核对目标与事件证据，再由作者决定。'); assert.match(result.notice, /未写入/); assert.ok(result.evidence.some(e => e.kind === 'planning-outline' && e.id === 'total')) }
      return reply({ role: 'assistant', content: `${selected} 已完成核对，正式内容未改动。` })
    }
    if (input.includes('LOCAL_INSTALL')) {
      if (!results.length) return named('list_plugins', { area: 'bundled', query: '写前决策' })
      const entries = values[0].entries
      if (results.length === 1) return named('install_plugin', { source: 'bundled', pluginId: entries[0].manifest.id, digest: entries[0].digest })
      assert.equal(values.at(-1).status, 'installed')
      return reply({ role: 'assistant', content: '本地流程插件已安装，尚未启用。' })
    }
    const personalWorkflow = input.includes('PERSONAL_WORKFLOW'), workflow = personalWorkflow || input.includes('LOCAL_WORKFLOW'), description = personalWorkflow ? '请作者选择本次写作重点。' : workflow ? '开始写作前，请作者' : '统计作者提供的片段'
    if (!results.length) return call('discover_tools', { query: personalWorkflow ? '本次写作重点' : workflow ? '写作前' : '统计作者提供' })
    if (results.length === 1) return call(body.tools.find(t => t.function.description.includes(description)).function.name, workflow ? {} : { text: '你好🌏\n\n 第二段 ' })
    if (personalWorkflow) { const free = input.includes('PERSONAL_WORKFLOW_FREE'); assert.deepEqual(values.at(-1).answers, [{ id: 'focus', chosenOptionIds: free ? [] : ['plot'], customText: free ? '保留伏笔，不提前揭晓。' : '', skipped: false }]); assert.match(values.at(-1).text, /plot 表示情节/) }
    else if (workflow) { assert.match(JSON.stringify(body.messages), /保留人物原先动机/); assert.match(JSON.stringify(body.messages), /character/) }
    else { assert.deepEqual(values.at(-1), { characters: 10, nonWhitespace: 6, paragraphs: 2, evidence: [] }); assert.match(JSON.stringify(body.messages), /宗门/) }
    reply({ role: 'assistant', content: workflow ? '已根据你的真实选择继续。' : '片段统计完成：10 个字符，2 段。' })
  } catch (e) { errors.push(String(e)); response.statusCode = 500; response.end('{}') }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
env.LANJIAN_USER_DATA_PATH = userData; env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
const build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-plugin-marketplace-check', 'main/index.js')
// Includes ten visible installations, author interactions, duplicate tools and a
// normal restart. Keep per-action/run timeouts; allow the full desktop sequence.
const watchdog = setTimeout(() => { errors.push('Bundled plugin timeout'); void app?.evaluate(({ app }) => app.exit(2)).catch(() => {}) }, 720000); watchdog.unref()
async function idle() { await page.getByTestId('writing-plugin-settings').locator('[role="status"]').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden' }) }
async function boot() {
  const window = await app.browserWindow(page)
  await window.evaluate(w => { if (w.isMinimized()) w.restore(); w.show(); w.focus() })
  await page.bringToFront()
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
}
async function settings() {
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText: '本地插件隔离作品' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').focus(); await page.keyboard.press('Enter'); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await idle()
}
const library = () => page.getByTestId('plugin-library'), detail = () => page.getByTestId('bundled-detail')
const editor = () => page.getByTestId('plugin-draft-editor')
async function ready() { await page.waitForFunction(() => document.querySelector('[data-testid="plugin-library"]')?.getAttribute('aria-busy') === 'false') }
async function browse() { await page.getByTestId('plugins-nav-library').click(); await ready(); if (await detail().isVisible()) { await page.keyboard.press('Escape'); await detail().waitFor({ state: 'hidden' }) } }
async function open(name) {
  const previous = library().getByRole('button', { name: '上一页', exact: true })
  while (await previous.count() && await previous.isEnabled()) { await previous.click(); await ready() }
  const card = library().getByRole('button', { name: new RegExp(name) })
  while (!await card.count()) {
    const next = library().getByRole('button', { name: '下一页', exact: true })
    assert.ok(await next.count() && await next.isEnabled(), `Missing catalog entry: ${name}`)
    await next.click(); await ready()
  }
  await card.click(); await detail().waitFor()
}
async function install(name, id, grant = false) {
  await browse(); await open(name); await detail().getByRole('button', { name: '预览并安装', exact: true }).click()
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins.some(p => p.id === id), false)
  await page.getByTestId('plugin-install').click(); await idle(); await enable(id, grant)
}
async function enable(id, grant = false) {
  const row = page.locator(`[data-plugin-id="${id}"]`)
  await row.getByRole('button', { name: '版本与权限' }).click()
  if (grant) for (const checkbox of await row.getByRole('checkbox').all()) await checkbox.check()
  await row.getByRole('button', { name: '确认权限并启用' }).click(); await idle()
  await row.getByRole('button', { name: '本书使用', exact: true }).click(); await idle()
}
async function send(goal) { await page.getByTestId('field-assistant-instruction').fill(goal); await page.getByTestId('send-field-assistant').click() }
async function complete(goal) {
  for (let i = 0; i < 300; i++) {
    const run = (await page.evaluate(() => window.novelDesktop.fieldAssistant.runs.recent())).find(r => r.goal === goal)
    if (run) { assert.ok(!['failed','cancelled','interrupted'].includes(run.status), run.message); if (run.status === 'completed') return }
    await page.waitForTimeout(100)
  }
  throw new Error('Run did not complete: ' + goal)
}
async function shot(name, grid = false) {
  await page.locator('.settings-editor').evaluate(el => { el.scrollTop = 0 })
  assert.equal(await library().evaluate(el => { for (let n = el; n; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 1) return false; return true }), true)
  if (grid) { const columns = await library().locator('.catalog').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length); assert.ok(columns >= 3); mark(`${name}: ${columns} columns`) }
  await page.screenshot({ path: join(evidence, name + '.png') })
}
try {
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); page = await app.firstWindow(); page.setDefaultTimeout(30000); await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
  await page.evaluate(async () => { localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true'); await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } }) })
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    const api = window.novelDesktop, { project } = await api.projects.create({ parentPath: books, name: '本地插件隔离作品', genre: '仙侠' })
    const list = await api.modelConnections.list(), made = await api.modelConnections.create({ expectedRevision: list.revision, name: '插件本地测试', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-only' })
    const connection = made.connections.find(c => c.name === '插件本地测试'), edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'plugin-model', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'plugin-model', model: 'plugin-test', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const chapter = await api.chapters.create(); await api.chapters.update(chapter.id, { content: '正式正文不进入插件创建和上传。', title: '原稿' })
    if (chapter.id !== 1) throw new Error('Expected the first isolated chapter')
    await api.outlines.update('total', '总纲：本地插件隔离作品。甲乙合作找回失物，在雨夜客栈相遇；人物关系缓慢改变。')
    return { project, chapterId: chapter.id }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  await page.reload(); await boot(); await settings()
  await ready(); assert.equal(await library().locator('.catalog-item').count(), 10)
  const entries = await page.evaluate(() => window.novelDesktop.writingPlugins.bundledPlugins())
  assert.equal(entries.length, 15)
  await library().getByRole('button', { name: '下一页', exact: true }).click(); await ready()
  assert.equal(await library().locator('.catalog-item').count(), 5)
  await shot('library-new-tools')
  await library().getByRole('button', { name: '上一页', exact: true }).click(); await ready()
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.listDrafts())).length, 0)
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins.length, 0)
  assert.equal(requests.length, 0); await shot('library-light', true)
  await library().getByLabel('本地插件关键词').fill('仙侠'); await library().getByRole('button', { name: '查找插件', exact: true }).click(); await ready()
  assert.equal(await library().locator('.catalog-item').count(), 1)
  await library().locator('.catalog-item').focus(); await page.keyboard.press('Enter'); await detail().waitFor()
  assert.equal(await detail().locator('h3').evaluate(el => el === document.activeElement), true)
  await detail().getByText('查看完整写作指导', { exact: true }).click()
  assert.equal(await detail().locator('.guidance-preview p').innerText(), entries.find(e => e.manifest.id === 'lanjian.bundled.xianxia').manifest.contributions[0].text)
  await shot('library-detail'); await page.keyboard.press('Escape'); await detail().waitFor({ state: 'hidden' })
  assert.equal(await library().locator('.catalog-item').evaluate(el => el === document.activeElement), true)
  await library().getByRole('button', { name: '清空筛选', exact: true }).click(); await ready()
  await open('片段字数统计'); await detail().getByRole('button', { name: '复制后修改', exact: true }).click(); await editor().waitFor()
  await editor().getByLabel('插件名称', { exact: true }).fill('我的统计副本')
  await editor().getByRole('button', { name: '保存草稿', exact: true }).click(); await editor().getByText('草稿已保存。', { exact: true }).waitFor()
  const copy = (await page.evaluate(() => window.novelDesktop.writingPlugins.listDrafts()))[0]
  assert.equal(JSON.parse(copy.manifestText).name, '我的统计副本'); assert.equal(copy.upstream.pluginId, 'lanjian.bundled.text-count'); assert.notEqual(copy.pluginId, copy.upstream.pluginId)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.writingPlugins.bundledPlugins()), entries)
  await page.getByTestId('plugins-nav-library').click(); await ready(); assert.equal(await detail().isVisible(), false)
  mark('Offline default catalog, no install or model request, real filtering, keyboard modal and editable personal copy before install')
  await install('片段字数统计', 'lanjian.bundled.text-count')
  await install('仙侠世界构筑', 'lanjian.bundled.xianxia')
  // Management must escape any stale installed filters and focus the real row,
  // without installing again or changing authorization.
  const beforeManage = await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))
  await page.getByRole('button', { name: '我创建的', exact: true }).click()
  await browse(); await open('仙侠世界构筑'); await detail().getByRole('button', { name: '管理已安装', exact: true }).click(); await idle()
  const managed = page.locator('[data-plugin-id="lanjian.bundled.xianxia"]'); await managed.locator('.plugin-editor').waitFor()
  assert.equal(await managed.evaluate(el => el === document.activeElement), true)
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins, beforeManage.plugins)
  await managed.getByRole('button', { name: '取消', exact: true }).click()
  // Any list() probe replaces/clears the service's one GUI book token. Renew it
  // through the visible page before making the next scoped composition edit.
  await page.getByRole('button', { name: '刷新', exact: true }).click(); await idle()
  mark('Full actual guidance in detail; installed detail opens and focuses matching management row without mutating grants or versions')
  const composition = page.getByTestId('book-plugin-composition')
  await composition.getByRole('checkbox').check(); await composition.getByRole('button', { name: '预览组合', exact: true }).click()
  await composition.getByRole('button', { name: '确认应用组合', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="book-plugin-composition"]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-testid="book-plugin-composition"] .eyebrow')?.textContent.includes('已保存组合 1')); await idle()
  const view = await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))
  assert.equal(view.composition.entries.length, 1); assert.equal(view.plugins.every(p => p.provenance.distribution === 'official' && !p.provenance.createdByMe), true)
  await page.locator('.assistant-toggle').click()
  const counterGoal = 'LOCAL_COUNTER：统计片段'; await send(counterGoal); await complete(counterGoal)
  mark('Actual local ZIP install, permission/book selection, real QuickJS counter and sourced xianxia guidance in provider prompt')
  const installGoal = 'LOCAL_INSTALL：从本地库安装写前决策流程'; await send(installGoal)
  await page.getByTestId('author-action-review').getByRole('heading', { name: /安装 写前决策流程/ }).waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins.length, 2)
  await page.getByTestId('author-question-card').getByLabel('确认执行', { exact: true }).check(); await page.getByTestId('submit-author-answer').click(); await complete(installGoal)
  await page.locator('.assistant-toggle').click(); await page.getByTestId('plugins-nav-installed').click(); await page.getByRole('button', { name: '刷新', exact: true }).click(); await idle()
  await enable('lanjian.bundled.writing-focus', true)
  await page.locator('.assistant-toggle').click()
  const workflowGoal = 'LOCAL_WORKFLOW：先确认本轮写作重点'; await send(workflowGoal)
  await page.getByTestId('author-question-card').getByLabel('人物与对白', { exact: true }).check()
  await page.getByTestId('author-question-card').getByLabel('有哪些必须保留或避免的内容？：自由回答', { exact: true }).fill('保留人物原先动机')
  await page.getByTestId('submit-author-answer').click(); await complete(workflowGoal)
  await page.locator('.assistant-toggle').click()
  mark('Real model list/install bundled tool, distinct host confirmation, permissioned declarative workflow and original author answers reach continuation')
  await page.getByTestId('plugins-nav-personal').click(); await page.getByRole('button', { name: /^新建交互流程/ }).click(); await editor().getByRole('heading', { name: '我的写作插件', exact: true }).waitFor()
  await editor().getByLabel('插件名称', { exact: true }).fill('个人流程回答回传')
  await editor().getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  const personal = (await page.evaluate(() => window.novelDesktop.writingPlugins.list(false))).plugins.find(p => p.provenance.createdByMe)
  await enable(personal.id, true); await page.locator('.assistant-toggle').click()
  const personalGoal = 'PERSONAL_WORKFLOW：确认写作重点'; await send(personalGoal)
  await page.getByTestId('author-question-card').getByLabel('情节', { exact: true }).check()
  await page.getByTestId('submit-author-answer').click(); await complete(personalGoal)
  // Single-choice and free text are alternatives in the author card. Verify
  // both real answer forms in separate runs rather than inventing a combination.
  const personalFreeGoal = 'PERSONAL_WORKFLOW_FREE：补充具体要求'; await send(personalFreeGoal)
  await page.getByTestId('author-question-card').getByLabel('这次先打磨哪一部分？：自由回答', { exact: true }).fill('保留伏笔，不提前揭晓。')
  await page.getByTestId('submit-author-answer').click(); await complete(personalFreeGoal); await page.locator('.assistant-toggle').click()
  mark('New personal workflow template installs through real preview; real answer IDs and free text reach the model continuation')
  const newPlugins = [
    ['言情情感线规划', 'romance-arc', 'NEW_ROMANCE', true],
    ['场景节奏规划', 'scene-rhythm', 'NEW_SCENE', true],
    ['章节一致性审校', 'chapter-consistency', 'NEW_AUDIT', true],
    ['中英文混排整理', 'chinese-spacing', 'NEW_SPACING', false],
    ['简繁与地区用词转换', 'chinese-conversion', 'NEW_CONVERSION', false]
  ]
  for (const [name, id, goal, grant] of newPlugins) {
    await install(name, `lanjian.bundled.${id}`, grant)
    await page.locator('.assistant-toggle').click(); await send(goal); await complete(goal); await page.locator('.assistant-toggle').click()
    mark(`Installed, authorized and invoked: ${name}`)
  }
  const textRequests = requests.filter(r => !r.tools?.length)
  assert.equal(textRequests.length, 3, 'Only planning/review tools may ask the book model')
  mark('All five packages are discovered by full tool ID, qualified identity or whitespace/case-normalized ID, then execute via returned names with original book evidence and exact text previews')
  await browse(); await open('简繁与地区用词转换'); await detail().getByRole('button', { name: '复制后修改', exact: true }).click(); await editor().waitFor()
  const conversionCopy = (await page.evaluate(() => window.novelDesktop.writingPlugins.listDrafts())).find(d => d.upstream?.pluginId === 'lanjian.bundled.chinese-conversion')
  assert.ok(conversionCopy.files.find(f => f.path === 'NOTICE.txt').content.includes('Apache License'))
  assert.ok(conversionCopy.files.find(f => f.path === 'main.js').content.length > 100000)
  assert.notEqual(conversionCopy.pluginId, conversionCopy.upstream.pluginId)
  await editor().getByRole('button', { name: '校验', exact: true }).click(); await editor().getByText('包格式校验通过。', { exact: true }).waitFor()
  mark('The conversion plugin copies into an independent editable draft with its real dictionary, source and full license; validation succeeds')
  await editor().getByRole('button', { name: '安装试用', exact: true }).click(); await page.getByTestId('plugin-install').click(); await idle()
  await enable(conversionCopy.pluginId); conversionCopyId = conversionCopy.pluginId
  await page.locator('.assistant-toggle').click()
  for (const goal of ['COPY_CONVERSION both enabled', 'NEW_CONVERSION both enabled']) { await send(goal); await complete(goal) }
  await page.locator('.assistant-toggle').click()
  mark('Original and personal conversion copy share tool ID and description; explicit discovery identities independently select and execute both while enabled')
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), state.chapterId)).content, '正式正文不进入插件创建和上传。')
  await page.getByTestId('plugins-nav-market').click(); await page.getByText('公共市场尚未连接', { exact: true }).waitFor()
  await page.getByRole('button', { name: '浏览本地插件库', exact: true }).filter({ visible: true }).click(); await ready(); if (await detail().isVisible()) { await page.keyboard.press('Escape'); await detail().waitFor({ state: 'hidden' }) }
  const mainWindow = await app.browserWindow(page)
  const compact = await mainWindow.evaluate(async w => { w.unmaximize(); for (let i = 0; w.isMaximized() && i < 50; i++) await new Promise(r => setTimeout(r, 50)); const [width, height] = w.getMinimumSize(); w.setSize(Math.max(width, 1100), Math.max(height, 800)); return Math.max(width, 1100) })
  await page.waitForFunction(width => innerWidth <= width, compact); await shot('library-compact', true)
  await page.getByTestId('settings-category-common').click(); await page.getByTestId('settings-nav-appearance').click(); await page.getByTestId('theme-moye').check(); await settings(); await ready(); await shot('library-dark', true)
  await app.close(); app = await _electron.launch({ args: [build, '--disable-gpu'], env }); page = await app.firstWindow(); page.setDefaultTimeout(30000)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins)); await boot(); await page.locator('.project-library').waitFor(); await settings(); await ready()
  assert.equal(await library().locator('.catalog-item').count(), 10)
  assert.deepEqual(await page.evaluate(() => window.novelDesktop.writingPlugins.bundledPlugins()), entries)
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.listDrafts())).find(d => d.id === copy.id).manifestText, copy.manifestText)
  assert.equal((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins.length, 10)
  await page.locator('.assistant-toggle').click()
  for (const goal of ['NEW_CONVERSION restart', 'COPY_CONVERSION restart']) { await send(goal); await complete(goal) }
  await page.locator('.assistant-toggle').click()
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), state.chapterId)).content, '正式正文不进入插件创建和上传。')
  mark('Unconnected public market returns to local library; compact/dark/restart retain catalog, installs and independent copy; formal manuscript unchanged')
  assert.deepEqual(errors, [])
  const report = { ok: true, checks, requests: requests.length, liveProviders: false, marketConfigured: false, errors }
  await writeFile(join(evidence, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (e) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}); await writeFile(join(evidence, `failure-${Date.now()}.json`), JSON.stringify({ error: String(e), checks, errors, consoleErrors, visibility: await page?.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus(), boot: document.querySelector('[data-testid="app-boot"]')?.outerHTML.slice(0, 900) })).catch(() => null), body: await page?.locator('body').innerText().catch(() => '') }, null, 2)); throw e
} finally {
  clearTimeout(watchdog); if (app) { const owned = app.process(), timer = setTimeout(() => owned.kill('SIGKILL'), 10000); await app.close().catch(() => {}); clearTimeout(timer) }
  server.closeAllConnections(); await new Promise(r => server.close(r))
  const checked = await realpath(root); if (dirname(checked) !== parent || !basename(checked).startsWith('lanjian-bundled-ui-')) throw new Error('Refusing cleanup outside owned test profile')
  await rm(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
