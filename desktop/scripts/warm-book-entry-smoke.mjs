import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { _electron } from 'playwright'

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-warm-entry-')))
const output = resolve(process.env.WARM_ENTRY_OUTPUT || '../.trellis/tasks/09-22-v3-warm-book-entry/evidence')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
let app, page
const checks = [], errors = [], timings = []
let profiled = false
let fixture = { chapterCount: 1, outlineCount: 0 }
async function launch() {
  app = await _electron.launch({ args: [resolve('out/main/index.js')], env })

  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await app.evaluate(({ ipcMain }) => {
    globalThis.warmEntryTimings = []
    for (const [channel, handler] of ipcMain._invokeHandlers) ipcMain._invokeHandlers.set(channel, async (...args) => {
      const start = Date.now()
      const timing = { channel, ms: null }
      globalThis.warmEntryTimings.push(timing)
      try {
        const result = await handler(...args)
        if (channel === 'workspace:bootstrap' && globalThis.holdWarmBootstrap) {
          globalThis.holdWarmBootstrap = false
          await new Promise(resolve => { globalThis.releaseWarmBootstrap = resolve })
        }
        return result
      }
      finally { timing.ms = Date.now() - start }
    })
  })
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-theme', 'moye')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
  })
}
async function enterLibrary() {
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.hide(); win.show(); win.focus() })
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
}
async function trackLoading() {
  await page.evaluate(() => {
    window.entryObserver?.disconnect(); window.entryLoadingSeen = false; window.entryQuick = null
    window.entryObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) {
          const loader = node.matches('[data-testid="workspace-loading"]') ? node : node.querySelector('[data-testid="workspace-loading"]')
          if (loader) { window.entryLoadingSeen = true; window.entryQuick = loader.getAttribute('data-loading-quick') }
        }
      }
    })
    window.entryObserver.observe(document.body, { childList: true, subtree: true })
  })
}
async function open(book, warm, tab = false) {
  await app.evaluate(() => { globalThis.warmEntryTimings = [] })
  const profile = process.env.WARM_ENTRY_PROFILE === '1' && warm && !profiled
  if (profile) {
    profiled = true
    await app.evaluate(async () => {
      const { Session } = process.getBuiltinModule('inspector')
      const session = new Session(); session.connect(); globalThis.warmEntryProfiler = session
      const post = (method, args = {}) => new Promise((resolve, reject) => session.post(method, args, (e, value) => e ? reject(e) : resolve(value)))
      await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start')
    })
  }
  await trackLoading(); const start = Date.now()
  await (tab ? page.locator('[data-book-tab]').filter({ hasText: book.title }) : page.locator('.work-item-open').filter({ hasText: book.title }).first()).click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('main.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  const result = await page.evaluate(() => ({ seen: window.entryLoadingSeen, quick: window.entryQuick }))
  timings.push({ title: book.title, warm, tab, elapsedMs: Date.now() - start, ...result, ipc: await app.evaluate(() => globalThis.warmEntryTimings) })
  if (profile) {
    const result = await app.evaluate(async () => {
      const session = globalThis.warmEntryProfiler
      try { return await new Promise((resolve, reject) => session.post('Profiler.stop', (e, result) => e ? reject(e) : resolve(result.profile))) }
      finally { session.disconnect(); globalThis.warmEntryProfiler = null }
    })
    await writeFile(join(output, 'warm-entry.cpuprofile'), JSON.stringify(result))
  }
  assert.equal(result.seen, !warm, JSON.stringify(timings.at(-1)))
  assert.equal(result.quick, warm ? null : 'false', JSON.stringify(timings.at(-1)))
  if (warm && process.env.WARM_ENTRY_REQUIRE_MEMORY === '1')
    assert.ok(timings.at(-1).elapsedMs < 1500, `Memory entry exceeded 1500ms: ${JSON.stringify(timings.at(-1))}`)
  // Readiness is editable entry. Measure ancillary checks separately and settle
  // them before the next test operation, without adding to editable-entry time.
  const checkDeadline = Date.now() + 30000
  while (!await app.evaluate(() => globalThis.warmEntryTimings
    .some(item => item.channel === 'workspace:get-chapter-projection' && item.ms !== null))) {
    assert.ok(Date.now() < checkDeadline, 'Background chapter check did not complete')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  timings.at(-1).checksReadyMs = Date.now() - start
  if (warm) assert.equal(await page.evaluate(() => window.entryLoadingSeen), false, 'memory verification mounted a loader')
  await page.getByTestId('manuscript-input').waitFor()
  // CodeMirror virtualizes long documents: DOM text is only the visible range.
  const editor = page.getByTestId('manuscript-input')
  await editor.click(); await page.keyboard.press('Control+Home')
  await page.waitForFunction(prefix => document.querySelector('[data-testid="manuscript-input"]')?.innerText?.includes(prefix), book.content.split('\n')[0].slice(0, 30))
  await page.keyboard.press('Control+End')
  await page.waitForFunction(suffix => document.querySelector('[data-testid="manuscript-input"]')?.innerText?.trim().endsWith(suffix), book.content.split('\n').at(-1).slice(-30))
  await page.keyboard.press('Control+Home')
  const saved = await page.evaluate(async () => {
    const api = window.novelDesktop, status = await api.projects.status(), chapters = await api.chapters.list()
    return { id: status.project.id, content: (await api.chapters.get(chapters[0].id)).content }
  })
  assert.equal(saved.id, book.id); assert.equal(saved.content.trim(), book.content)
  const settledTimings = await app.evaluate(() => globalThis.warmEntryTimings)
  assert.equal(settledTimings.filter(item => item.channel === 'workspace:get-chapter-projection').length, 1, JSON.stringify(settledTimings))
  assert.equal(settledTimings.filter(item => item.channel === 'projects:sqlite-storage-status').length, 1, JSON.stringify(settledTimings))
  checks.push(`${warm ? 'warm' : 'cold'} ${tab ? 'tab' : 'library'} entry: ${book.title}`)
}
async function library() {
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.project-library').waitFor()
  await page.locator('[data-library-view="all"]').click()
}
async function close() {
  const closed = app.waitForEvent('close', { timeout: 30000 })
  await page.close({ runBeforeUnload: true }); await closed; app = null
}
try {
  await launch()
  const books = await page.evaluate(async root => {
    const api = window.novelDesktop, result = []
    for (const title of ['再次进入甲书', '再次进入乙书']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, genre: '悬疑' })
      await api.projects.switch(project.path)
      const chapter = await api.chapters.create(), content = `${title}的独立正文，不能串书。`
      await api.chapters.update(chapter.id, { title: '第一章', content, expectedRevision: chapter.revision })
      result.push({ ...project, content })
    }
    return result
  }, root)
  if (process.env.WARM_ENTRY_LONG_BOOK === '1') {
    await close()
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/warm-book-entry-fixture.ts', root, books[0].path], { env, timeout: 300000 })
    const { content, ...counts } = JSON.parse(await readFile(join(root, 'long-book-fixture.json'), 'utf8'))
    fixture = counts
    books[0].content = content.trim()
    await launch()
  }
  await enterLibrary()
  await open(books[0], false); await library()
  await open(books[1], false); await library()
  await open(books[0], true)
  await open(books[1], true, true); await open(books[0], true, true)
  // A real editor save must survive the fast round trip as well.
  books[0].content += '作者刚刚补写的一句话。'
  await page.getByTestId('manuscript-input').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('作者刚刚补写的一句话。')
  await open(books[1], true, true); await open(books[0], true, true)
  const owner = await app.browserWindow(page)
  await writeFile(join(output, 'warm-entry.png'), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
  await close(); await launch(); await enterLibrary()
  await open(books[0], false)
  if (process.env.WARM_ENTRY_EXTERNAL_EDIT === '1') {
    await library(); await open(books[1], false)
    const bookRoot = await realpath(books[0].path)
    assert.ok(bookRoot.startsWith(root + sep))
    const candidates = (await readdir(join(bookRoot, '正文'))).filter(name => /^第1章-.*\.md$/u.test(name))
    assert.equal(candidates.length, 1)
    const bodyPath = await realpath(join(bookRoot, '正文', candidates[0]))
    assert.ok(bodyPath.startsWith(bookRoot + sep))
    const before = await readFile(bodyPath, 'utf8')
    assert.equal(before.trim(), books[0].content)
    const external = before + '\n外部程序新写的一句话。'
    await writeFile(bodyPath, external, 'utf8')
    await app.evaluate(() => { globalThis.holdWarmBootstrap = true })
    const start = Date.now()
    await page.locator('[data-book-tab]').filter({ hasText: books[0].title }).click()
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
    const editor = page.getByTestId('manuscript-input')
    await editor.click(); await page.keyboard.press('Control+End')
    await page.keyboard.insertText('内存中继续输入的一句话。')
    const editableMs = Date.now() - start
    const deadline = Date.now() + 30000
    while (!await app.evaluate(() => Boolean(globalThis.releaseWarmBootstrap))) {
      assert.ok(Date.now() < deadline, 'held bootstrap did not reach its barrier')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await app.evaluate(() => { globalThis.releaseWarmBootstrap(); globalThis.releaseWarmBootstrap = null })
    await page.getByTestId('manuscript-conflict').waitFor({ timeout: 30000 })
    assert.ok((await editor.innerText()).includes('内存中继续输入的一句话。'))
    assert.equal(await readFile(bodyPath, 'utf8'), external)
    page.once('dialog', dialog => dialog.accept())
    await page.getByTestId('recover-manuscript-conflict').click()
    await page.getByTestId('manuscript-conflict').waitFor({ state: 'hidden' })
    assert.equal(await readFile(bodyPath, 'utf8'), external)
    checks.push(`external edit + typing preserved; explicit backup/reload succeeded (${editableMs} ms to typed editor)`)
  }
  assert.deepEqual(errors, [])
  await close()
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, fixture, checks, errors, timings }, null, 2))
  console.log(JSON.stringify({ fixture, checks, errors, timings }))
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ root, fixture, error: String(error), checks, errors, timings }, null, 2))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await app.evaluate(({ app }) => {
    globalThis.warmEntryProfiler?.disconnect(); globalThis.warmEntryProfiler = null
    app.exit(1)
  }).catch(() => {})
}
