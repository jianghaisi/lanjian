import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-multi-book-writing-')))
const userData = join(root, 'app')
const books = join(root, 'books')
const evidence = process.env.LANJIAN_MULTI_BOOK_EVIDENCE_DIR
  ? resolve(process.env.LANJIAN_MULTI_BOOK_EVIDENCE_DIR)
  : join(root, 'evidence')
const builtDesktop = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out')
const entry = join(builtDesktop, 'main', 'index.js')
await Promise.all([mkdir(userData), mkdir(books), mkdir(evidence, { recursive: true })])
const bootstrap = join(root, 'desktop-entry.mjs')
await writeFile(bootstrap, `import ${JSON.stringify(pathToFileURL(entry).href)}\n`, 'utf8')

const errors = []
const checks = []
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = userData
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(userData, 'global-model-data', 'v1')

let app
let page

async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(evidence, name), Buffer.from(data, 'base64'))
}

async function waitForSaved(expected) {
  const deadline = Date.now() + 30_000
  do {
    const saved = await page.evaluate(async text => {
      const chapters = await window.novelDesktop.chapters.list()
      if (chapters.length !== 1) return false
      return (await window.novelDesktop.chapters.get(chapters[0].id)).content.trim() === text.trim()
    }, expected)
    if (saved) { await page.getByTestId('manuscript-save-state').waitFor(); return }
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw Error('The expected manuscript was not saved before switching books')
}

async function enterManuscript() {
  const manuscript = page.getByRole('button', { name: '书稿', exact: true })
  const hit = await manuscript.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      width: rect.width,
      target: target?.className || target?.tagName || null,
      usable: Boolean(target && (target === button || button.contains(target)))
    }
  })
  assert.equal(hit.usable, true, `Collapsed manuscript entry is blocked: ${JSON.stringify(hit)}`)
  await manuscript.click()
  const chapters = page.locator('[data-nav-leaf="chapters"]')
  if (await chapters.isVisible()) await chapters.click()
}

async function createBook(title, chapterTitle, content) {
  const overview = page.getByTestId('library-all-works-back')
  if (!(await page.getByTestId('create-work-item').isVisible()) && (await overview.isVisible())) await overview.click()
  await page.getByTestId('create-work-item').click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill(title)
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, books)
  await page.getByTestId('choose-create-folder').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="creation-model-defaults"]')?.textContent.includes('fixture-writing-model'))
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.getByTestId('new-project-guide').waitFor()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await enterManuscript()
  assert.equal(await page.locator('.archive-chapter-heading').count(), 0)
  const toolbarTop = await page.getByTestId('chapter-explorer-tools').evaluate(element => {
    const explorer = element.closest('.explorer')
    const navigation = explorer.querySelector('.manuscript-view-nav')
    return element.getBoundingClientRect().top - (navigation?.getBoundingClientRect().bottom ?? explorer.getBoundingClientRect().top)
  })
  assert.ok(toolbarTop >= 0 && toolbarTop < 45, `chapter toolbar is not immediately below the manuscript view tabs: ${toolbarTop}`)
  await page.getByRole('button', { name: /^建立第一章/ }).click()
  await page.getByTestId('manuscript-editor').waitFor()
  await page.getByTestId('manuscript-title-input').fill(chapterTitle)
  await page.getByTestId('manuscript-input').fill(content)
  await page.getByTestId('save-manuscript').click()
  await waitForSaved(content)
  const status = await page.evaluate(() => window.novelDesktop.projects.status())
  assert.equal(status.project.title, title)
  checks.push(`created-and-saved:${title}`)
  return status.project
}

async function returnToLibrary() {
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.project-library').waitFor()
}

async function openBook(title, expected, replacement) {
  await page.locator('.work-item-open').filter({ hasText: title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-editor').waitFor()
  assert.equal((await page.getByTestId('manuscript-input').textContent()).trim(), expected)
  const persisted = await page.evaluate(async () => {
    const chapters = await window.novelDesktop.chapters.list()
    return chapters.length === 1 ? window.novelDesktop.chapters.get(chapters[0].id) : null
  })
  assert.equal(persisted?.content.trim(), expected)
  const status = await page.evaluate(() => window.novelDesktop.projects.status())
  assert.equal(status.project.title, title)
  await page.getByTestId('manuscript-input').fill(replacement)
  await page.getByTestId('save-manuscript').click()
  await waitForSaved(replacement)
  checks.push(`reopened-and-resaved:${title}`)
}

async function launchFixture() {
  app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], env, timeout: 30_000 })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
    globalThis.multiBookStreams = []
    globalThis.modelProbeRequests = []
    globalThis.holdModelProbe = false
    globalThis.rejectModelCatalog = false
    globalThis.fetch = async (url, options) => {
      if (String(url) === 'https://multi-book.invalid/v1/models') {
        if (globalThis.rejectModelCatalog) return new Response('{}', { status: 401 })
        return new Response(JSON.stringify({ data: ['fixture-writing-model', 'fixture-other-model', 'fixture-unavailable'].map(id => ({ id })) }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (String(url) !== 'https://multi-book.invalid/v1/chat/completions') throw new Error('Multi-book smoke blocks unrecognized network access')
      const request = JSON.parse(options.body)
      if (!request.stream) {
        globalThis.modelProbeRequests.push(request.model)
        if (globalThis.holdModelProbe) await new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
        })
        if (request.model === 'fixture-unavailable') return new Response('{}', { status: 404 })
        return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      const index = globalThis.multiBookStreams.length
      const content = globalThis.fixtureStreamText ?? (index === 0 ? '甲书独立候选。' : '乙书独立候选。')
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
          globalThis.multiBookStreams.push({ content,
            fail: () => controller.error(new TypeError('synthetic stream disconnected')),
            finish: () => { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close() } })
          options.signal?.addEventListener('abort', () => controller.error(new Error('fixture aborted')), { once: true })
        }
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => errors.push(`${error.name}:${error.message}`))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', mute: true, textModel: false, preload: false }))
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  // The dossier opening now waits for an explicit enter click after its
  // roughly 33-second scene; older styles still close automatically.
  await page.waitForFunction(() => !document.querySelector('[data-testid="app-boot"]') ||
    Boolean(document.querySelector('[data-testid="app-boot-enter"]')), null, { timeout: 50_000 })
  if (await page.getByTestId('app-boot-enter').isVisible()) await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden', timeout: 20_000 })
  await page.locator('.project-library').waitFor()
}

try {
  await launchFixture()

  await page.getByTestId('library-model-setup').click()
  await page.getByTestId('empty-add-connection').click()
  await page.getByTestId('global-connection-name').fill('双书验证接口')
  await page.getByTestId('global-connection-url').fill('https://multi-book.invalid/v1')
  await page.getByTestId('global-connection-key').fill('synthetic-test-key-never-real')
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'))
  await capture('one-time-model-setup.png')
  const originalSize = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0], size = window.getSize(), zoom = window.webContents.getZoomFactor()
    window.setSize(1100, 800); window.webContents.setZoomFactor(1.25)
    return { size, zoom }
  })
  await page.getByTestId('global-save-connection').scrollIntoViewIfNeeded()
  const setupLayout = await page.getByTestId('global-connection-form').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
  assert.ok(setupLayout.scroll <= setupLayout.width + 2, JSON.stringify(setupLayout))
  await capture('model-setup-1100-125pct.png')
  await app.evaluate(({ BrowserWindow }, saved) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(...saved.size); window.webContents.setZoomFactor(saved.zoom) }, originalSize)
  await page.getByTestId('global-save-connection').click()
  await page.getByTestId('open-model-tests').click()
  const panel = page.getByTestId('model-test-panel')
  const row = model => panel.locator(`[data-model="${model}"]`)
  const waitProbeIdle = () => page.waitForFunction(() => document.querySelector('[data-testid="model-test-panel"]')?.getAttribute('aria-busy') === 'false')
  await row('fixture-writing-model').waitFor()
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 0)
  assert.equal((await page.evaluate(() => window.novelDesktop.modelConnections.defaults())).template, null)
  await row('fixture-writing-model').getByRole('button', { name: '测试', exact: true }).focus()
  await page.keyboard.press('Enter')
  await row('fixture-writing-model').locator('.passed').waitFor()
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 1)
  await panel.getByRole('button', { name: '批量测试…', exact: true }).click()
  for (const model of ['fixture-writing-model', 'fixture-other-model']) await row(model).getByRole('checkbox').check()
  await panel.getByRole('button', { name: '测试所选（2）', exact: true }).click()
  await row('fixture-other-model').locator('.passed').waitFor()
  await waitProbeIdle()
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 3)
  await panel.getByTestId('test-all-models').click()
  await row('fixture-unavailable').locator('.failed').waitFor()
  await waitProbeIdle()
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 6)
  assert.equal(await panel.locator('.passed').count(), 2)
  await app.evaluate(() => { globalThis.holdModelProbe = true })
  await panel.getByTestId('test-all-models').click()
  await row('fixture-writing-model').locator('.testing').waitFor()
  await panel.getByTestId('stop-model-tests').click()
  await waitProbeIdle()
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 7)
  assert.equal(await panel.locator('.cancelled').count(), 3)
  await app.evaluate(() => { globalThis.holdModelProbe = false })
  await panel.getByTestId('test-all-models').click()
  await row('fixture-unavailable').locator('.failed').waitFor()
  await waitProbeIdle()
  await capture('model-selection-and-batch-results.png')
  await row('fixture-writing-model').getByRole('button', { name: '设为新书默认', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.model-defaults > summary')?.textContent.includes('fixture-writing-model'))
  assert.equal((await page.evaluate(() => window.novelDesktop.modelConnections.list())).connections.length, 1)
  assert.equal(await app.evaluate(() => globalThis.modelProbeRequests.length), 10)
  await page.getByRole('button', { name: '收起模型列表', exact: true }).click()
  await page.getByTestId('open-model-tests').click()
  await row('fixture-writing-model').waitFor()
  await app.evaluate(() => { globalThis.rejectModelCatalog = true })
  await panel.getByRole('button', { name: '重新获取模型', exact: true }).click()
  await panel.getByRole('alert').waitFor()
  assert.equal(await panel.locator('[data-model]').count(), 0)
  await app.evaluate(() => { globalThis.rejectModelCatalog = false })
  await panel.getByRole('button', { name: '重新获取模型', exact: true }).click()
  await row('fixture-writing-model').waitFor()
  await row('fixture-other-model').getByRole('button', { name: '测试', exact: true }).click()
  await row('fixture-other-model').locator('.passed').waitFor()
  await waitProbeIdle()
  await page.getByRole('button', { name: '收起模型列表', exact: true }).click()
  checks.push('catalog-without-manual-model', 'single-selected-and-all-model-tests', 'per-model-failures-and-batch-cancel', 'explicit-default-without-repeat-probe', 'existing-connection-discovery-and-retry')
  await page.getByRole('dialog', { name: '全局模型接口与新书默认', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
  checks.push('one-time-setup-through-visible-form')

  const first = await createBook('双书甲', '甲章', '甲书第一次保存。')
  await returnToLibrary()
  const second = await createBook('双书乙', '乙章', '乙书第一次保存。')
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.path, second.path)

  const selectTab = async book => {
    await page.locator('[data-book-tab]').filter({ hasText: book.title }).click()
    await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('main.app-frame')?.inert, book.path)
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
    await page.getByTestId('manuscript-editor').waitFor()
    assert.equal((await page.evaluate(() => window.novelDesktop.projects.status())).project.path, book.path)
  }
  const startTask = () => page.evaluate(async () => {
    const chapter = await window.novelDesktop.chapters.get((await window.novelDesktop.chapters.list())[0].id)
    const settings = await window.novelDesktop.modelConnections.book()
    if (settings.settings.shared.model !== 'fixture-writing-model') throw Error('New book did not inherit configured model')
    return window.novelDesktop.ai.startWritingAgent({ operationId: crypto.randomUUID(), request: { chapterId: chapter.id, message: '改写选段', currentDraft: chapter.content, preferredSkill: 'rewrite', selection: { start: 0, end: chapter.content.length, text: chapter.content } } })
  })
  const waitTask = async (task, status) => {
    const deadline = Date.now() + 40_000
    let result
    do {
      result = await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), task.id)
      if (result.status === status) return result
      if (['failed', 'cancelled', 'interrupted'].includes(result.status)) throw Error(`Task ${result.workItemId}: ${JSON.stringify(result.error || result.status)}`)
      await new Promise(resolve => setTimeout(resolve, 125))
    } while (Date.now() < deadline)
    const transport = await app.evaluate(() => ({ streams: globalThis.multiBookStreams.length, probes: globalThis.modelProbeRequests.length }))
    throw Error(`Expected ${status}, got ${result?.status}; fixture transport ${JSON.stringify(transport)}`)
  }
  await selectTab(first)
  const firstTask = await startTask()
  await waitTask(firstTask, 'streaming')
  await selectTab(second)
  const denied = await page.evaluate(async id => { try { await window.novelDesktop.ai.cancelWritingAgentTask(id); return false } catch { return true } }, firstTask.id)
  assert.equal(denied, true)
  const secondTask = await startTask()
  await waitTask(secondTask, 'streaming')
  const summary = await page.evaluate(() => window.novelDesktop.ai.backgroundTasks())
  assert.equal(summary.filter(task => ['running', 'streaming'].includes(task.status)).length, 2, JSON.stringify(summary))
  await page.getByTestId('background-tasks-toggle').click()
  await capture('two-books-streaming.png')
  await page.getByTestId('background-tasks-toggle').click()
  const priorTheme = await page.evaluate(() => { const prior = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'moye'; return prior })
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1100, 800); window.webContents.setZoomFactor(1.25) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await capture('book-tabs-dark-1100-125pct.png')
  const tabLayout = await page.getByTestId('book-tabs').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
  assert.ok(tabLayout.scroll <= tabLayout.width + 2, JSON.stringify(tabLayout))
  await app.evaluate(({ BrowserWindow }, saved) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(...saved.size); window.webContents.setZoomFactor(saved.zoom) }, originalSize)
  await page.evaluate(theme => { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme }, priorTheme)
  checks.push('setup-and-tabs-at-1100px-125percent', 'dark-tabs-reduced-motion')
  await app.evaluate(() => globalThis.multiBookStreams.forEach(stream => stream.finish()))
  for (const [book, task, expected] of [[second, secondTask, '乙书独立候选。'], [first, firstTask, '甲书独立候选。']]) {
    await selectTab(book)
    const result = await waitTask(task, 'succeeded')
    assert.equal(result.workItemId, book.id)
    assert.equal(result.turn.candidate.content, expected)
    assert.equal(result.artifact.status, 'complete')
  }
  checks.push('A-and-B-stream-concurrently-across-real-tabs', 'cross-book-cancel-rejected', 'both-candidates-stay-with-own-books', 'both-books-inherit-one-default-without-reconfiguration')

  // Use the real preload and main handlers in the same renderer turn so navigation
  // arrives while the earlier preview is still capturing/reading the book.
  for (const [from, to] of [[first, second], [second, first]]) {
    await selectTab(from)
    const outcome = await page.evaluate(async ({ from, to }) => {
      const api = window.novelDesktop
      const chapter = await api.chapters.get((await api.chapters.list())[0].id)
      const preview = api.ai.previewWritingAgentContext({ chapterId: chapter.id, expectedWorkItemId: from.id,
        message: '只读核对', currentDraft: chapter.content, preferredSkill: 'query' })
        .then(value => ({ ok: true, value }), error => ({ ok: false, code: error.code, message: error.message }))
      await api.projects.switch(to.path)
      return preview
    }, { from, to })
    assert.equal(outcome.ok, false, JSON.stringify(outcome))
    assert.equal(outcome.code, 'CONFLICT')
    assert.ok(!outcome.message.includes(from.path))
    await selectTab(to)
  }
  checks.push('preview-A-to-B-to-A-rejected-at-native-boundary')
  const previewRetry = await page.evaluate(async book => {
    const api = window.novelDesktop
    const chapter = await api.chapters.get((await api.chapters.list())[0].id)
    const input = { chapterId: chapter.id, expectedWorkItemId: book.id, message: '只读核对', currentDraft: chapter.content, preferredSkill: 'query' }
    const old = api.ai.previewWritingAgentContext(input).then(() => 'unexpected-success', error => error.code)
    const fresh = api.ai.previewWritingAgentContext(input)
    const [code, preview] = await Promise.all([old, fresh])
    const repeated = await api.ai.previewWritingAgentContext(input)
    const departing = api.ai.previewWritingAgentContext(input).then(() => 'unexpected-success', error => error.code)
    await api.modelConnections.leaveBook()
    return { code, preview, repeated, departed: await departing }
  }, first)
  assert.equal(previewRetry.code, 'CONFLICT')
  assert.equal(previewRetry.departed, 'CONFLICT')
  assert.equal(previewRetry.preview.workItemId, first.id)
  assert.equal(previewRetry.preview.contentHash, previewRetry.repeated.contentHash)
  assert.ok(previewRetry.preview.items.length > 0)
  checks.push('latest-preview-replaces-old-and-retry-keeps-context-hash', 'leave-book-cancels-pending-preview')
  await selectTab(second)

  await selectTab(first)
  await app.evaluate(() => { globalThis.fixtureStreamText = '甲书暂停前的片段。'.repeat(40) })
  const pausedTask = await startTask()
  const pausedStream = await waitTask(pausedTask, 'streaming')
  const paused = await page.evaluate(id => window.novelDesktop.ai.pauseWritingAgentTask(id), pausedTask.id)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.partial.content, pausedStream.partial.content)
  await selectTab(second)
  await app.evaluate(() => { globalThis.fixtureStreamText = '乙书断线前的片段。'.repeat(40) })
  const failedTask = await startTask()
  const failedStream = await waitTask(failedTask, 'streaming')
  await app.evaluate(() => globalThis.multiBookStreams.at(-1).fail())
  const failed = await waitTask(failedTask, 'failed')
  assert.equal(failed.partial.content, failedStream.partial.content)
  assert.equal(failed.artifact, undefined)
  checks.push('native-pause-keeps-partial', 'stream-failure-keeps-partial-without-success-artifact')

  const restarting = app.waitForEvent('close', { timeout: 15_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close()))
  await restarting
  await launchFixture()
  assert.equal(await app.evaluate(() => globalThis.multiBookStreams.length), 0)
  const reopenAfterRestart = async book => {
    if (!(await page.locator('.project-library').isVisible())) await returnToLibrary()
    await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
    if (!(await page.getByTestId('manuscript-editor').isVisible())) await enterManuscript()
    await page.getByTestId('manuscript-editor').waitFor()
  }
  await reopenAfterRestart(first)
  const recoveredPause = await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), paused.id)
  assert.equal(recoveredPause.status, 'paused')
  assert.equal(recoveredPause.partial.content, paused.partial.content)
  assert.equal((await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), firstTask.id)).turn.candidate.content, '甲书独立候选。')
  await reopenAfterRestart(second)
  const recoveredFailure = await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), failed.id)
  assert.equal(recoveredFailure.status, 'failed')
  assert.equal(recoveredFailure.partial.content, failed.partial.content)
  const wrongBookResume = await page.evaluate(async id => {
    try { await window.novelDesktop.ai.resumeWritingAgentTask(id, crypto.randomUUID()); return false } catch { return true }
  }, paused.id)
  assert.equal(wrongBookResume, true)
  assert.equal(await app.evaluate(() => globalThis.multiBookStreams.length), 0)
  checks.push('normal-restart-retains-candidates-and-partials', 'restart-does-not-auto-generate', 'cross-book-resume-rejected')

  for (const [book, original, method, text] of [
    [first, paused, 'resumeWritingAgentTask', '甲书明确恢复的候选。'],
    [second, failed, 'retryWritingAgentTask', '乙书明确重试的候选。']
  ]) {
    await selectTab(book)
    await app.evaluate((_electron, text) => { globalThis.fixtureStreamText = text }, text)
    const operationId = await page.evaluate(() => crypto.randomUUID())
    const resumed = await page.evaluate(({ method, taskId, operationId }) => window.novelDesktop.ai[method](taskId, operationId), { method, taskId: original.id, operationId })
    await waitTask(resumed, 'streaming')
    await app.evaluate(() => globalThis.multiBookStreams.at(-1).finish())
    const completed = await waitTask(resumed, 'succeeded')
    assert.equal(completed.workItemId, book.id)
    assert.equal(completed.parentTaskRunId, original.id)
    assert.equal(completed.attempt, 2)
    assert.equal(completed.turn.candidate.content, text)
    const duplicate = await page.evaluate(({ method, taskId, operationId }) => window.novelDesktop.ai[method](taskId, operationId), { method, taskId: original.id, operationId })
    assert.equal(duplicate.id, resumed.id)
    const originalAfter = await page.evaluate(id => window.novelDesktop.ai.writingAgentTask(id), original.id)
    assert.equal(originalAfter.partial.content, original.partial.content)
    const manuscript = await page.evaluate(async () => window.novelDesktop.chapters.get((await window.novelDesktop.chapters.list())[0].id))
    assert.equal(manuscript.content.trim(), book.id === first.id ? '甲书第一次保存。' : '乙书第一次保存。')
  }
  assert.equal(await app.evaluate(() => globalThis.multiBookStreams.length), 2)
  await capture('restarted-explicit-recovery.png')
  checks.push('explicit-recovery-stays-in-own-book', 'recovery-operation-is-idempotent', 'recovery-preserves-formal-manuscripts')

  await page.locator('[data-book-tab]').filter({ hasText: first.title }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-book-path')), second.path)
  await page.keyboard.press('Enter')
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('main.app-frame')?.inert, second.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: `关闭《${first.title}》标签`, exact: true }).click()
  await page.locator('[data-book-tab]').filter({ hasText: first.title }).waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-book-tab]').count(), 1)
  assert.equal((await page.evaluate(() => window.novelDesktop.projects.list())).projects.length, 2)
  checks.push('keyboard-tab-navigation-and-close-preserves-book')

  await returnToLibrary()
  await openBook('双书甲', '甲书第一次保存。', '甲书往返后第二次保存。')
  await returnToLibrary()
  await openBook('双书乙', '乙书第一次保存。', '乙书往返后第二次保存。')
  await returnToLibrary()
  await openBook('双书甲', '甲书往返后第二次保存。', '甲书最终保存。')
  await returnToLibrary()

  const library = await page.evaluate(() => window.novelDesktop.projects.list())
  assert.equal(library.projects.filter(project => ['双书甲', '双书乙'].includes(project.title)).length, 2)
  assert.deepEqual(errors, [])
  checks.push('A-to-B-to-A-visible-editor-state-isolated')

  const files = {}
  for (const project of [first, second]) {
    const directory = join(project.path, '正文')
    const names = (await readdir(directory)).filter(name => name.endsWith('.md'))
    assert.equal(names.length, 1)
    files[project.title] = await readFile(join(directory, names[0]), 'utf8')
  }
  assert.match(files['双书甲'], /甲书最终保存。/)
  assert.doesNotMatch(files['双书甲'], /乙书/)
  assert.match(files['双书乙'], /乙书往返后第二次保存。/)
  assert.doesNotMatch(files['双书乙'], /甲书/)
  checks.push('independent-readable-manuscript-files')

  await capture('library-after-two-book-writing.png')
  checks.push('chapter-sidebar-tools-below-view-tabs-without-decorative-heading')

  const dismissTaskNotice = page.getByRole('button', { name: '关闭任务通知', exact: true })
  if (await dismissTaskNotice.isVisible()) await dismissTaskNotice.click()
  const bookConfigs = await Promise.all([first, second].map(book => readFile(join(book.path, '.webnovel', 'ai-settings.json'), 'utf8')))
  const defaultBefore = await page.evaluate(() => window.novelDesktop.modelConnections.defaults())
  const connectionBefore = await page.evaluate(async () => {
    const api = window.novelDesktop.modelConnections, catalog = await api.list()
    await api.create({ expectedRevision: catalog.revision, name: '保留接口', baseUrl: 'https://other.invalid/v1', protocol: 'openai-compatible' })
    return catalog.connections[0]
  })
  await page.getByTestId('library-model-setup').click()
  const card = page.locator(`[data-global-id="${connectionBefore.id}"]`)
  await card.getByRole('button').click()
  await page.getByText('停用或删除接口', { exact: true }).click()
  const authorityFile = join(env.LANJIAN_GLOBAL_MODEL_DATA_PATH, 'global-model-connections.json')
  const originalBytes = await readFile(authorityFile, 'utf8')
  await page.getByTestId('delete-global-connection').click()
  await page.getByTestId('cancel-delete-global-connection').click()
  assert.equal(await readFile(authorityFile, 'utf8'), originalBytes)
  checks.push('delete-cancel-leaves-configuration-and-key-unchanged')

  await page.getByTestId('delete-global-connection').click()
  await page.evaluate(async id => {
    const api = window.novelDesktop.modelConnections, catalog = await api.list(), c = catalog.connections.find(c => c.id === id)
    await api.update({ expectedRevision: catalog.revision, id, connectionRevision: c.revision, name: '已在其他操作中修改' })
  }, connectionBefore.id)
  await page.getByTestId('confirm-delete-global-connection').click()
  await page.locator('.global-model-settings > .model-notice.error').waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.modelConnections.list())).connections.length, 2)
  await page.getByTestId('cancel-delete-global-connection').click()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await card.getByText('已在其他操作中修改', { exact: true }).waitFor()
  checks.push('stale-delete-confirmation-rejected-without-deletion')

  await page.getByTestId('delete-global-connection').click()
  await page.getByTestId('confirm-delete-global-connection').focus()
  await capture('api-delete-confirmation.png')
  await page.keyboard.press('Enter')
  await card.waitFor({ state: 'detached' })
  await page.locator('.model-defaults > summary .error').waitFor()
  const afterDelete = JSON.parse(await readFile(authorityFile, 'utf8'))
  assert.equal(afterDelete.connections.length, 1)
  assert.equal(afterDelete.connections[0].name, '保留接口')
  assert.ok(!JSON.stringify(afterDelete).includes(JSON.parse(originalBytes).connections[0].encryptedApiKey))
  const defaultAfter = await page.evaluate(() => window.novelDesktop.modelConnections.defaults())
  assert.deepEqual(defaultAfter.template, defaultBefore.template)
  assert.equal(defaultAfter.references[0].state, 'missing')
  for (const [index, book] of [first, second].entries()) assert.equal(await readFile(join(book.path, '.webnovel', 'ai-settings.json'), 'utf8'), bookConfigs[index])
  await capture('api-deleted-default-needs-reselection.png')
  checks.push('keyboard-delete-removes-only-selected-api-and-key', 'deleted-default-reference-visible-and-book-configs-unchanged')

  await page.getByTestId('delete-global-connection').click()
  await page.getByTestId('confirm-delete-global-connection').click()
  await page.getByTestId('empty-add-connection').waitFor()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.modelConnections.list())).connections, [])
  assert.deepEqual(JSON.parse(await readFile(authorityFile, 'utf8')).connections, [])
  assert.deepEqual(errors, [])
  checks.push('last-api-removal-persists-empty-catalog')
  const closed = app.waitForEvent('close', { timeout: 15_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close()))
  await closed
  checks.push('native-window-close-handshake')
  const result = { ok: true, root, builtDesktop, books: [first, second], checks, errors }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result))
} catch (error) {
  errors.push(error instanceof Error ? error.stack || error.message : String(error))
  if (page) await capture(`failure-${Date.now()}.png`).catch(() => undefined)
  const result = { ok: false, root, builtDesktop, checks, errors }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2), 'utf8').catch(() => undefined)
  console.error(JSON.stringify(result))
  process.exitCode = 1
} finally {
  // Only the fixture-owned app. Playwright close can disconnect its renderer
  // before the application's save-before-close handshake is acknowledged.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
}
