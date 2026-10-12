import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Real packaged-layout main/preload + validated IPC; only temporary books and a
// loopback fake provider. No developer driver or author model configuration.
const temporaryParent = await realpath(tmpdir())
const root = await realpath(await mkdtemp(join(temporaryParent, 'lanjian-plugin-core-smoke-')))
const books = join(root, 'books'), userData = join(root, 'app')
await Promise.all([mkdir(books), mkdir(userData)])
const entry = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-plugin-core-check', 'main/index.js')
const seen = [], errors = []
let chapterId, generatedTaskId, held = false, enterHeld, releaseHeld
const entered = new Promise(resolve => { enterHeld = resolve })
const hold = new Promise(resolve => { releaseHeld = resolve })
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'plugin-smoke-model' }] })); return }
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    response.setHeader('Content-Type', 'application/json')
    const reply = message => response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }))
    if (!body.tools) {
      const instruction = body.messages.map(item => item.content || '').join('\n')
      if (instruction.includes('只修改作者指定字段')) return reply({ role: 'assistant', content: JSON.stringify({ value: '修复师从旧物中听见雨夜往事。' }) })
      return reply({ role: 'assistant', content: '只读审校结果：人物行动与雨夜环境一致。' })
    }
    assert.ok(body.tools.length <= 48)
    const declared = new Set(body.messages.flatMap(message => message.tool_calls ?? []).map(call => call.id))
    assert.ok(body.messages.filter(message => message.role === 'tool').every(message => declared.has(message.tool_call_id)), 'Each tool result needs its original provider declaration')
    const user = body.messages.filter(item => item.role === 'user').at(-1).content
    const results = body.messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content))
    const call = (id, args = {}) => {
      const name = body.tools.find(item => item.function.name === id || item.function.name.includes('_' + id + '_'))?.function.name
      assert.ok(name, 'Tool must be registered: ' + id)
      seen.push(id)
      return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'call_' + results.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    }
    if (user === 'BOUND_READ' && !held) { held = true; enterHeld(); await hold }
    if (user === 'FIELDS') {
      if (!results.length) return call('list_editable_fields')
      const target = results[0].fields[0]
      if (results.length === 1) return call('read_field', { targetId: target.targetId })
      return call('edit_field', { targetId: target.targetId, instruction: '旧物能说话' })
    }
    if (user === 'REVIEW') {
      if (!results.length) return call('read_manuscript', { chapterId })
      if (results.length === 1) return call('review_manuscript', { chapterId, expectedRevision: results[0].revision, instruction: '检查人物与环境是否一致' })
      assert.ok(results[1].evidence.some(item => item.kind === 'context-package'))
      return reply({ role: 'assistant', content: results[1].answer })
    }
    if (user === 'GENERATE') {
      if (!results.length) return call('read_manuscript', { chapterId })
      if (results.length === 1) return call('generate_manuscript', { chapterId, expectedRevision: results[0].revision, instruction: '继续这章' })
      generatedTaskId = results[1].taskId
      return reply({ role: 'assistant', content: results[1].notice })
    }
    if (!results.length) return call('read_book_context')
    if (results.length === 1) return call('read_materials')
    if (results.length === 2) return call('read_manuscript', { chapterId })
    assert.match(results[0].context, /原书设想A/)
    assert.equal(results[2].content, '原书A的雨夜正文。')
    assert.doesNotMatch(JSON.stringify(results), /synthetic-plugin-key|另一部B/)
    return reply({ role: 'assistant', content: '已依据原书A的资料与正文完成核对。' })
  } catch (error) { errors.push(error); response.statusCode = 500; response.end(JSON.stringify({ error: { message: 'isolated fixture assertion failed' } })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = userData
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')
let app
try {
  app = await _electron.launch({ args: [entry, '--disable-gpu'], env })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.novelDesktop?.fieldAssistant), undefined, { timeout: 20000 })
  const state = await page.evaluate(async ({ books, baseUrl }) => {
    let stage = 'create'
    try {
    const api = window.novelDesktop
    const { project } = await api.projects.create({ parentPath: books, name: '原书A', genre: '仙侠' })
    stage = 'configure-model'
    const catalogue = await api.modelConnections.list()
    const created = await api.modelConnections.create({ expectedRevision: catalogue.revision, name: '插件隔离接口', baseUrl, protocol: 'openai-compatible', apiKey: 'synthetic-plugin-key' })
    const connection = created.connections.find(item => item.name === '插件隔离接口')
    const edit = await api.modelConnections.book()
    await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'smoke', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'smoke', model: 'plugin-smoke-model', temperature: .6, topP: 1, maxTokens: 8192 } } })
    const profile = await api.workspace.getBookProfile()
    await api.workspace.saveBookProfile({ ...profile, coreIdea: '原书设想A' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { content: '原书A的雨夜正文。', title: '雨夜' })
    return { project, chapterId: chapter.id }
    } catch (error) { throw new Error(stage + ': ' + JSON.stringify(error)) }
  }, { books, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
  chapterId = state.chapterId
  const request = { operationId: 'plugin-smoke-fields', workItemId: state.project.id, page: 'profile', message: 'FIELDS', targets: [{ fieldId: 'definition.bookProfile.coreIdea', instanceId: 'core-idea', editorSessionId: 'smoke', workItemId: state.project.id, pageId: 'profile', label: '核心设想', revision: 1, value: '原书设想A' }], chapterId: null, selectedCharacters: 0, history: [] }
  const field = await page.evaluate(input => window.novelDesktop.fieldAssistant.conversation(input), request)
  assert.equal(field.kind, 'field')
  let fieldTask
  const deadline = Date.now() + 20000
  do {
    fieldTask = await page.evaluate(id => window.novelDesktop.fieldAssistant.task(id), field.task.id)
    if (fieldTask.status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  assert.equal(fieldTask.status, 'completed', fieldTask.error)
  assert.equal(fieldTask.candidate.after, '修复师从旧物中听见雨夜往事。')
  assert.equal(await page.evaluate(() => window.novelDesktop.workspace.getBookProfile().then(item => item.coreIdea)), '原书设想A')

  const review = await page.evaluate(async input => { try { return await window.novelDesktop.fieldAssistant.conversation(input) } catch (error) { throw Error(JSON.stringify(error)) } }, { ...request, operationId: 'plugin-smoke-review', message: 'REVIEW', page: 'world', targets: [] })
  assert.match(review.message, /只读审校结果/)
  assert.equal(await page.evaluate(id => window.novelDesktop.chapters.get(id).then(item => item.content), chapterId), '原书A的雨夜正文。')

  await page.evaluate(input => window.novelDesktop.fieldAssistant.conversation(input), { ...request, operationId: 'plugin-smoke-generate', message: 'GENERATE', page: 'world', targets: [] })
  let writingTask
  const writingDeadline = Date.now() + 20000
  do {
    writingTask = await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), generatedTaskId)
    if (['failed', 'completed', 'awaiting_approval'].includes(writingTask.status)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < writingDeadline)
  assert.equal(writingTask.status, 'failed', 'A book without approved outlines must fail the real domain gate')
  assert.equal(writingTask.workItemId, state.project.id)
  assert.equal(writingTask.chapterId, chapterId)
  assert.equal(writingTask.turn?.proposal, undefined)
  assert.equal(await page.evaluate(id => window.novelDesktop.chapters.get(id).then(item => item.content), chapterId), '原书A的雨夜正文。')

  const background = page.evaluate(input => window.novelDesktop.fieldAssistant.conversation(input), { ...request, operationId: 'plugin-smoke-book-bound', message: 'BOUND_READ', page: 'world', targets: [] })
  // Attach a rejection handler while a second IPC changes the visible book.
  void background.catch(() => {})
  await Promise.race([entered, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Provider did not enter held request')), 20000); timer.unref() })])
  await page.evaluate(async parentPath => {
    const api = window.novelDesktop
    await api.projects.create({ parentPath, name: '另一部B', genre: '悬疑' })
    const chapter = await api.chapters.create()
    await api.chapters.update(chapter.id, { content: '另一部B的独立正文。' })
  }, books)
  releaseHeld()
  const bound = await background
  assert.match(bound.message, /原书A/)
  assert.equal(await page.evaluate(id => window.novelDesktop.chapters.get(id).then(item => item.content), chapterId), '另一部B的独立正文。')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['real built main/preload and validated IPC', 'field read/edit remains an unadopted candidate', 'read-only review uses real domain service and context evidence', 'real manuscript task enforces outline prerequisites', 'A-to-B navigation keeps original-book tools bound to A'], tools: [...new Set(seen)] }, null, 2))
} finally {
  releaseHeld()
  if (app) {
    // A preload failure cannot acknowledge the application's graceful close IPC.
    // Only this isolated fixture may fall back to exiting its owned process.
    const hasApi = await app.firstWindow().then(page => page.evaluate(() => Boolean(window.novelDesktop))).catch(() => false)
    if (!hasApi) await app.evaluate(({ app }) => { app.exit(1) }).catch(() => {})
    else await app.close()
  }
  await new Promise(resolve => server.close(resolve))
  // Verify the exact owned temporary directory before recursive disposal.
  const target = await realpath(root)
  assert.equal(dirname(target), temporaryParent)
  assert.ok(basename(target).startsWith('lanjian-plugin-core-smoke-'))
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
