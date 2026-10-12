// Native UI verification. All works and settings are synthetic and isolated.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
require('tsx/cjs')
const { SqliteWorkspaceDatabaseFactory } = require('../src/main/platform/storage/workspace-database.ts')
const { SqliteManuscriptService } = require('../src/main/modules/manuscript/application/sqlite-manuscript-service.ts')
const { buildWritingAgentDiff } = require('../src/contracts/assistant/writing-diff.ts')

const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-document-review-')))
const evidence = resolve('../.trellis/tasks/09-29-v3-outline-editor-tools/research')
await mkdir(evidence, { recursive: true })
const output = await mkdtemp(join(evidence, 'native-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const checks = [], errors = []
const editorText = locator => locator.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'))
let app, page
const buildDirectory = resolve(process.argv[2] || 'out')
async function capture(name) {
  // Playwright can retain a pre-zoom clip. Capture the owning webContents at
  // its actual device scale, so 125% evidence includes the entire viewport.
  const owner = await app.browserWindow(page)
  const frame = await owner.evaluate(async window => {
    const image = await window.webContents.capturePage()
    return { ...image.getSize(), data: image.toPNG().toString('base64') }
  })
  const expected = await page.evaluate(() => ({ width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) }))
  assert.ok(Math.abs(frame.width - expected.width) <= 1 && Math.abs(frame.height - expected.height) <= 1, JSON.stringify({ actual: { width: frame.width, height: frame.height }, expected }))
  await writeFile(join(output, name), Buffer.from(frame.data, 'base64'))
}
async function waitForApi(predicate, argument) {
  const deadline = Date.now() + 30000
  do {
    if (await page.evaluate(predicate, argument)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error('Expected persisted application state did not arrive')
}
async function launch() {
  app = await _electron.launch({ args: [join(buildDirectory, 'main/index.js')], env })
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
    globalThis.reviewFixtureCalls = 0
    globalThis.fetch = async (url, options) => {
      if (String(url) === 'https://document-review.invalid/v1/models') return new Response(JSON.stringify({ data: [{ id: 'annotation-fixture' }] }), { headers: { 'Content-Type': 'application/json' } })
      if (String(url) !== 'https://document-review.invalid/v1/chat/completions') throw new Error('Native fixture blocks non-fixture requests')
      const request = JSON.parse(options.body), instruction = request.messages.find(message => message.role === 'user').content
      const documentId = instruction.match(/唯一目标文档 (\S+)（/)?.[1]
      if (!documentId) throw new Error('Unexpected fixture generation')
      globalThis.reviewFixtureCalls++
      const quote = instruction.includes('（total）') ? '开端\n\n转折' : instruction.includes('（volume）') ? '卷的开端' : '新开端'
      const content = JSON.stringify({ documentId, changes: [{ quote, replacement: quote + '（根据批注补充动机）' }] })
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
    }
  })
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()) })
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(async () => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-theme', 'moye')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
  })
}
async function library() {
  await page.reload(); await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
}
async function open(book) {
  await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  if (await page.getByRole('button', { name: '丢弃这份草稿', exact: true }).isVisible()) await page.getByRole('button', { name: '丢弃这份草稿', exact: true }).click()
  await page.locator('[data-nav-parent="planning"]').click()
  await page.locator('[data-nav-leaf="total-outline"]').click()
}
async function close() {
  const done = app.waitForEvent('close', { timeout: 30000 })
  await page.close({ runBeforeUnload: true }); await done; app = null
}
async function installReviewSaveFaults(failWrite = false) {
  await app.evaluate(({ ipcMain }, failWrite) => {
    const state = globalThis.reviewSaveFixture = { failWrite, failRead: false, writes: 0, confirmed: 0, handlers: {} }
    for (const channel of ['document-review:save', 'document-review:list']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error('Missing review handler: ' + channel)
      state.handlers[channel] = original; ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        if (channel.endsWith(':list')) return state.failRead ? { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：修订记录暂不可读', recoverable: true } } : original(...args)
        state.writes++
        if (state.failWrite) return { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：稿件未写入', recoverable: true } }
        const result = await original(...args)
        if (result.ok) { state.confirmed++; state.failRead = true }
        return result
      })
    }
  }, failWrite)
}
async function restoreReviewSaveHandlers() {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.reviewSaveFixture
    for (const [channel, handler] of Object.entries(state.handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    delete globalThis.reviewSaveFixture
  })
}
async function checkBodySaveConsumer(document, candidate) {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.bodyConsumerFixture = { failRead: true, confirmed: 0, handlers: {} }
    state.readFailed = new Promise(resolve => { state.onReadFailure = resolve })
    for (const name of ['document-review:save', 'chapters:get']) {
      const original = ipcMain._invokeHandlers.get(name)
      if (!original) throw new Error('Missing body consumer handler: ' + name)
      state.handlers[name] = original; ipcMain.removeHandler(name)
      ipcMain.handle(name, async (...args) => {
        if (name === 'chapters:get' && state.confirmed && state.failRead) {
          state.onReadFailure()
          return { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：正文保存后章节暂不可读', recoverable: true } }
        }
        const result = await original(...args)
        if (name === 'document-review:save' && result.ok) state.confirmed++
        return result
      })
    }
  })
  try {
    await page.locator('.inline-review').first().getByRole('button', { name: '保留', exact: true }).click()
    await page.getByTestId('save-manuscript').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-save-state"]')?.classList.contains('saved'))
    await app.evaluate(() => globalThis.bodyConsumerFixture.readFailed)
    await page.getByTestId('check-manuscript-save').waitFor()
    const saved = await page.evaluate(doc => window.novelDesktop.documentReview.readSnapshot(doc), document)
    assert.equal(saved.content, candidate)
    assert.match(await page.getByTestId('manuscript-save-state').textContent(), /已保存.*文件状态待核对/)
    assert.equal(await page.getByTestId('document-review-status').getByRole('alert').count(), 0)
    assert.equal(await app.evaluate(() => globalThis.bodyConsumerFixture.confirmed), 1)
    await capture('body-saved-metadata-unavailable.png')
    checks.push('retained prose is formally saved with committed sources even when its chapter metadata read fails')
    const input = page.getByTestId('manuscript-input')
    await input.press('Control+End'); await page.keyboard.insertText('\n\n核对期间继续写。')
    const later = await editorText(input)
    await app.evaluate(() => { globalThis.bodyConsumerFixture.failRead = false })
    await page.getByTestId('check-manuscript-save').click()
    await page.getByTestId('check-manuscript-save').waitFor({ state: 'hidden' })
    assert.equal(await editorText(input), later)
    assert.equal((await page.evaluate(doc => window.novelDesktop.documentReview.readSnapshot(doc), document)).versionId, saved.versionId)
    assert.equal(await app.evaluate(() => globalThis.bodyConsumerFixture.confirmed), 1)
    await capture('body-metadata-retry-keeps-input.png')
    await page.getByTestId('save-manuscript').click()
    await waitForApi(async text => (await window.novelDesktop.chapters.get(1)).content === text, later)
    await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-save-state"]')?.classList.contains('saved'))
    assert.equal(await app.evaluate(() => globalThis.bodyConsumerFixture.confirmed), 2)
    checks.push('readonly prose metadata retry preserves later input and version; the next explicit save uses the acknowledged baseline')
    // Restore the fixture through the actual editor/history/save flow for later generation checks.
    await page.getByTestId('manuscript-undo').click()
    assert.equal(await editorText(input), candidate)
    await page.getByTestId('save-manuscript').click()
    await waitForApi(async text => (await window.novelDesktop.chapters.get(1)).content === text, candidate)
  } finally {
    await app.evaluate(({ ipcMain }) => {
      for (const [channel, handler] of Object.entries(globalThis.bodyConsumerFixture.handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      delete globalThis.bodyConsumerFixture
    })
  }
}
async function checkOutlineSaveConsumer(input, document, label, channel, standalone = false) {
  const before = await page.evaluate(document => window.novelDesktop.documentReview.readSnapshot(document), document)
  await app.evaluate(({ ipcMain }, channel) => {
    const state = globalThis.outlineConsumerFixture = { failRead: true, confirmed: 0, reads: 0, handlers: {} }
    state.readFailed = new Promise(resolve => { state.onReadFailure = resolve })
    for (const name of ['document-review:save', channel]) {
      const original = ipcMain._invokeHandlers.get(name)
      if (!original) throw new Error('Missing outline consumer handler: ' + name)
      state.handlers[name] = original; ipcMain.removeHandler(name)
      ipcMain.handle(name, async (...args) => {
        if (name === channel && state.confirmed && state.failRead) {
          state.reads++
          state.onReadFailure()
          return { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：已保存文档暂不可重读', recoverable: true } }
        }
        const result = await original(...args)
        if (name === 'document-review:save' && result.ok) state.confirmed++
        return result
      })
    }
  }, channel)
  try {
    await input.press('Control+End'); await page.keyboard.insertText('\n\n保存确认后的正文。')
    const submitted = await editorText(input)
    await page.getByTestId(standalone ? 'save-planned-chapter' : 'save-outline-document').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="outline-save-state"]')?.classList.contains('saved'))
    const saved = await page.evaluate(document => window.novelDesktop.documentReview.readSnapshot(document), document)
    assert.equal(saved.content, submitted); assert.notEqual(saved.versionId, before.versionId)
    assert.equal(await app.evaluate(() => globalThis.outlineConsumerFixture.confirmed), 1)
    if (standalone) {
      await page.getByTestId('check-planned-save').waitFor()
      assert.match(await page.getByTestId('outline-save-state').textContent(), /章纲已保存.*文件状态待核对/)
      await app.evaluate(() => globalThis.outlineConsumerFixture.readFailed)
      assert.ok(await app.evaluate(() => globalThis.outlineConsumerFixture.reads) >= 1)
      await capture('standalone-saved-metadata-unavailable.png')
      await input.press('Control+End'); await page.keyboard.insertText('\n核对期间继续写的新文字。')
      const later = await editorText(input)
      await app.evaluate(() => { globalThis.outlineConsumerFixture.failRead = false })
      await page.getByTestId('check-planned-save').click()
      await page.getByTestId('check-planned-save').waitFor({ state: 'hidden' })
      assert.equal(await editorText(input), later)
      assert.equal(await app.evaluate(() => globalThis.outlineConsumerFixture.confirmed), 1)
      assert.equal((await page.evaluate(document => window.novelDesktop.documentReview.readSnapshot(document), document)).versionId, saved.versionId)
      assert.equal(await page.getByTestId('outline-save-state').evaluate(el => el.classList.contains('dirty')), true)
      await capture('standalone-metadata-retry-keeps-input.png')
      await page.getByTestId('save-planned-chapter').click()
      await page.waitForFunction(() => document.querySelector('[data-testid="outline-save-state"]')?.classList.contains('saved'))
      assert.equal((await page.evaluate(document => window.novelDesktop.documentReview.readSnapshot(document), document)).content, later)
      assert.equal(await app.evaluate(() => globalThis.outlineConsumerFixture.confirmed), 2)
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.list())).some(chapter => chapter.id === 900), false)
      checks.push('standalone outline confirms saved revision despite failed metadata; read-only retry keeps later typing and next save creates no prose')
    } else {
      assert.equal(await app.evaluate(() => globalThis.outlineConsumerFixture.reads), 0)
      assert.equal(await editorText(input), submitted)
      await capture(`${label}-saved-without-second-read.png`)
      checks.push(`${label} review save uses acknowledged content without a fallible second document read`)
    }
  } finally {
    await app.evaluate(({ ipcMain }) => {
      for (const [channel, handler] of Object.entries(globalThis.outlineConsumerFixture.handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      delete globalThis.outlineConsumerFixture
    })
  }
}
async function checkChapterLeaveInput() {
  const tree = page.getByTestId('chapter-tree-window')
  const first = tree.getByRole('button', { name: /^第 1 章，/ })
  const second = tree.getByRole('button', { name: /^第 2 章，/ })
  const input = page.getByTestId('manuscript-input')
  const title = page.getByTestId('manuscript-title-input')
  const firstSaved = await page.evaluate(() => window.novelDesktop.chapters.get(1))
  await second.click(); await page.waitForFunction(() => document.querySelector('.chapter-tree-row[aria-current="page"]')?.getAttribute('aria-label')?.startsWith('第 2 章，'))
  for (const phase of ['save', 'read']) {
    if (phase === 'save') { await input.press('Control+End'); await page.keyboard.insertText('\n\n准备切换时提交的正文。') }
    const submitted = await editorText(input)
    await app.evaluate(({ ipcMain }, phase) => {
      const channel = phase === 'save' ? 'chapters:autosave-stage' : 'chapter-outlines:get'
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error('Missing leave guard handler: ' + channel)
      const state = globalThis.chapterLeaveFixture = { channel, original, delay: true }
      state.entered = new Promise(resolve => { state.onEnter = resolve })
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        const result = await original(...args)
        if (state.delay && (phase === 'save' ? args[1] === 2 : args[1] === 1)) {
          state.onEnter()
          await new Promise(resolve => { state.release = resolve })
        }
        return result
      })
    }, phase)
    try {
      await first.click()
      await app.evaluate(() => globalThis.chapterLeaveFixture.entered)
      await input.press('Control+End'); await page.keyboard.insertText(phase === 'save' ? '\n保存等待期间补写。' : '\n读取目标期间补写。')
      if (phase === 'read') await title.fill('等待切章时改过的章名')
      const later = await editorText(input), laterTitle = await title.inputValue()
      await app.evaluate(() => { const state = globalThis.chapterLeaveFixture; state.delay = false; state.release() })
      await page.locator('.toast').filter({ hasText: phase === 'save' ? '保存期间正文又有新修改' : '读取期间当前正文有新修改' }).waitFor()
      assert.match(await tree.locator('[aria-current="page"]').getAttribute('aria-label'), /^第 2 章，/)
      assert.equal(await editorText(input), later); assert.equal(await title.inputValue(), laterTitle)
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(2))).content, submitted)
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(1))).revision, firstSaved.revision)
      await capture(`chapter-leave-${phase}-keeps-input.png`)
      await first.click()
      await page.waitForFunction(() => document.querySelector('.chapter-tree-row[aria-current="page"]')?.getAttribute('aria-label')?.startsWith('第 1 章，'))
      const saved = await page.evaluate(() => window.novelDesktop.chapters.get(2))
      assert.equal(saved.content, later); assert.equal(saved.title, laterTitle)
      assert.equal(await editorText(input), firstSaved.content)
      checks.push(`chapter switch ${phase} wait preserves later input in the source; explicit retry saves it and opens an unchanged target`)
    } finally {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis.chapterLeaveFixture; state.delay = false; state.release?.()
        ipcMain.removeHandler(state.channel); ipcMain.handle(state.channel, state.original)
        delete globalThis.chapterLeaveFixture
      })
    }
    if (phase === 'save') { await second.click(); await page.waitForFunction(() => document.querySelector('.chapter-tree-row[aria-current="page"]')?.getAttribute('aria-label')?.startsWith('第 2 章，')) }
  }
}
async function checkOutlineNavigationInput(book) {
  // Remember a real volume as the planning destination before returning to prose.
  await page.locator('[data-nav-parent="planning"]').click()
  await page.getByTestId('planning-volume-1').click()
  await page.getByRole('textbox', { name: '当前卷纲正文', exact: true }).waitFor()
  await page.locator('[data-nav-parent="manuscript"]').click()
  const tree = page.getByTestId('chapter-tree-window'), input = page.getByTestId('manuscript-input')
  await tree.getByRole('button', { name: /^第 2 章，/ }).click()
  await page.waitForFunction(() => document.querySelector('.chapter-tree-row[aria-current="page"]')?.getAttribute('aria-label')?.startsWith('第 2 章，'))
  const document = { workItemId: book.id, kind: 'volume', legacyId: 1 }
  const target = await page.evaluate(doc => window.novelDesktop.documentReview.readSnapshot(doc), document)
  for (const phase of ['published', 'composition']) {
    const source = await page.evaluate(() => window.novelDesktop.chapters.get(2))
    await app.evaluate(({ ipcMain }) => {
      const channel = 'outlines:get', original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error('Missing outline read handler')
      const state = globalThis.outlineNavigationFixture = { channel, original, delay: true }
      state.entered = new Promise(resolve => { state.onEnter = resolve })
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        const result = await original(...args)
        if (state.delay && args[1] === 1) { state.onEnter(); await new Promise(resolve => { state.release = resolve }) }
        return result
      })
    })
    try {
      await page.locator('[data-nav-parent="planning"]').click()
      await app.evaluate(() => globalThis.outlineNavigationFixture.entered)
      if (phase === 'composition') await input.dispatchEvent('compositionstart', { data: '新' })
      await input.press('Control+End'); await page.keyboard.insertText(phase === 'composition' ? '\n打开卷纲时仍在组字的新输入。' : '\n读取卷纲期间补写的正文。')
      const later = await editorText(input)
      if (phase === 'published') await page.waitForTimeout(350)
      await app.evaluate(() => { const state = globalThis.outlineNavigationFixture; state.delay = false; state.release() })
      if (phase === 'composition') {
        await page.waitForTimeout(300)
        assert.equal(await input.isVisible(), true, 'outline opening must wait for ongoing composition')
        assert.equal(await editorText(input), later)
        await input.dispatchEvent('compositionend', { data: '新' })
      }
      await page.locator('.toast').filter({ hasText: '当前正文有新修改' }).waitFor()
      assert.equal(await input.isVisible(), true); assert.equal(await editorText(input), later)
      assert.match(await tree.locator('[aria-current="page"]').getAttribute('aria-label'), /^第 2 章，/)
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(2))).revision, source.revision)
      const unchanged = await page.evaluate(doc => window.novelDesktop.documentReview.readSnapshot(doc), document)
      assert.equal(unchanged.revision, target.revision); assert.equal(unchanged.content, target.content)
      await capture(`outline-open-${phase}-keeps-prose.png`)
      await page.locator('[data-nav-parent="planning"]').click()
      await page.getByRole('textbox', { name: '当前卷纲正文', exact: true }).waitFor()
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(2))).content, later)
      assert.equal(await editorText(page.getByRole('textbox', { name: '当前卷纲正文', exact: true })), target.content)
      await page.locator('[data-nav-parent="manuscript"]').click(); await input.waitFor()
      assert.equal(await editorText(input), later)
      checks.push(`opening a volume during ${phase} prose input keeps the source draft; explicit retry saves prose and opens the unchanged outline`)
    } finally {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis.outlineNavigationFixture; state.delay = false; state.release?.()
        ipcMain.removeHandler(state.channel); ipcMain.handle(state.channel, state.original)
        delete globalThis.outlineNavigationFixture
      })
    }
  }
}
const surfaces = []
async function sameEditor(prefix, kind) {
  const root = page.getByTestId(prefix + '-editor')
  for (const action of ['undo', 'redo', 'find', 'format', 'layout', 'annotations', 'typewriter', 'focus']) {
    assert.equal(await page.getByTestId(prefix + '-' + action).isVisible(), true, kind + ':' + action)
  }
  await page.getByTestId(prefix + '-typewriter').click()
  assert.equal(await root.evaluate(el => el.classList.contains('is-typewriter-mode')), true)
  await page.getByTestId(prefix + '-typewriter').click()
  await page.getByTestId(prefix + '-focus').click()
  await page.waitForFunction(() => document.querySelector('.studio')?.classList.contains('writing-focus'))
  const surface = await root.evaluate(el => {
    const page = el.querySelector('.manuscript-page'), title = el.querySelector('.manuscript-title-row')
    const content = el.querySelector('.cm-content'), foot = el.querySelector('.editor-foot')
    const bounds = page.getBoundingClientRect(), footer = foot.getBoundingClientRect()
    const text = getComputedStyle(content), paper = getComputedStyle(page)
    return { width: bounds.width, height: bounds.height, font: text.fontFamily, size: text.fontSize, line: text.lineHeight,
      guides: text.backgroundImage, paper: paper.backgroundColor, border: paper.borderTopWidth,
      title: Boolean(title), footer: footer.bottom <= innerHeight && footer.top >= 0 }
  })
  assert.ok(surface.title && surface.footer && surface.height > 150, JSON.stringify(surface))
  surfaces.push({ kind, ...surface })
  if (surfaces.length > 1) {
    for (const key of ['width', 'font', 'size', 'line', 'guides', 'paper', 'border']) assert.equal(surface[key], surfaces[0][key], kind + ':' + key)
  }
  await capture('shared-editor-' + kind + '.png')
  await page.getByTestId(prefix + '-focus').click()
  await page.waitForFunction(() => !document.querySelector('.studio')?.classList.contains('writing-focus'))
}
async function annotate(input, label, prefix = 'outline') {
  await input.click(); await input.press('Control+Home')
  await input.press('Shift+ArrowRight'); await input.press('Shift+ArrowRight')
  await page.getByTestId(`${prefix}-annotations`).click()
  const panel = page.getByTestId('annotation-panel')
  await panel.getByRole('textbox', { name: '批注内容' }).fill(`${label}：补充人物动机。`)
  await panel.getByTestId('save-annotation').click()
  await panel.locator('.annotation-body').filter({ hasText: `${label}：补充人物动机。` }).waitFor()
  await panel.getByRole('button', { name: '解决', exact: true }).first().click()
  await panel.getByRole('checkbox', { name: '显示已解决和已删除' }).check()
  await panel.getByRole('button', { name: '重新打开', exact: true }).first().click()
  await panel.getByRole('button', { name: '解决', exact: true }).first().waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-testid="save-annotation"]')?.textContent.includes('保存中'))
  await panel.getByRole('button', { name: '定位原文', exact: true }).first().click()
  await capture(`annotation-${label}.png`)
  const cardId = await panel.locator('[data-annotation-card]').first().getAttribute('data-annotation-card')
  const original = await editorText(input)
  await panel.getByRole('button', { name: '收起批注', exact: true }).click()
  const mark = input.locator(`[data-annotation-id="${cardId}"]`).first()
  await mark.click()
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-annotation-card') === id, cardId)
  assert.equal(await panel.locator(`[data-annotation-card="${cardId}"].active`).count(), 1)
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await mark.click()
  await page.waitForFunction(id => {
    const card = document.querySelector(`[data-annotation-card="${id}"]`), panel = card?.closest('[data-testid="annotation-panel"]')
    if (!card || !panel) return false
    const bounds = card.getBoundingClientRect(), container = panel.getBoundingClientRect()
    return document.activeElement === card && bounds.top >= container.top && bounds.top < container.bottom - 30
  }, cardId)
  assert.equal(await editorText(input), original)
  assert.equal(await panel.getByRole('checkbox', { name: /^选择批注/ }).first().isChecked(), false)
  await capture(`annotation-located-${label}.png`)
  await panel.getByRole('button', { name: '收起批注', exact: true }).click()
  checks.push(`annotation mark in ${label} focuses its comment on every click without editing text or selecting generation`)
}
try {
  await launch()
  const books = await page.evaluate(async root => {
    try {
    const api = window.novelDesktop, books = []
    for (const name of ['编辑验证甲', '编辑验证乙']) {
      const { project } = await api.projects.create({ parentPath: root, name, genre: '悬疑' })
      await api.projects.switch(project.path)
      await api.workspace.saveBookProfile({ ...await api.workspace.getBookProfile(), autosaveDelayMs: 30000 })
      const chapter = await api.chapters.create()
      await api.outlines.update('total', '开端\n\n\n转折')
      await api.outlines.createVolume('雾港')
      await api.outlines.update(1, '卷的开端\n\n\n卷的转折')
      await api.outlines.placeChapter(chapter.id, 1)
      await api.chapterOutlines.update(chapter.id, '章的开端\n\n\n章的转折')
      const second = await api.chapters.create()
      await api.chapters.update(second.id, { title: '切章保护目标', content: '第二章原正文。' })
      await api.outlines.placeChapter(second.id, 1)
      await api.chapterOutlines.update(second.id, '第二章纲。')
      const stage = await api.outlines.createStage(1, '来信')
      await api.outlines.updateStage(stage.stage.stage, '来信', '阶段开端\n\n\n阶段转折')
      books.push({ ...project, chapter, stageId: stage.stage.stage })
    }
    return books
    } catch (error) { return { failure: error?.message || JSON.stringify(error) } }
  }, root)
  assert.ok(Array.isArray(books), JSON.stringify(books))
  await close()
  const authority = new SqliteManuscriptService(new SqliteWorkspaceDatabaseFactory())
  for (const book of books) await authority.updateChapterOutline(book.path, 900, '独立章的开端\n\n\n独立章的转折', 1)
  await launch()
  await library(); await open(books[0])
  const owner = await app.browserWindow(page)
  await owner.evaluate(w => { if (w.isMaximized()) w.unmaximize(); w.setContentSize(1440, 900) })
  const editor = page.getByRole('textbox', { name: '全局总纲正文', exact: true })
  await editor.waitFor()
  assert.equal(await page.getByTestId('outline-undo').isDisabled(), true)
  await page.getByTestId('outline-format').click()
  assert.equal(await editorText(editor), '开端\n\n转折')
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get('total'))).content, '开端\n\n\n转折')
  await page.getByTestId('outline-undo').click()
  assert.equal(await editorText(editor), '开端\n\n\n转折')
  await page.getByTestId('outline-redo').click()
  assert.equal(await editorText(editor), '开端\n\n转折')
  await page.getByTestId('save-outline-document').click()
  await waitForApi(async () => (await window.novelDesktop.outlines.get('total')).content === '开端\n\n转折')
  checks.push('total format/undo/redo preserves explicit save')
  await page.getByTestId('outline-layout').click()
  await page.getByRole('button', { name: '虚线', exact: true }).click()
  await page.getByRole('slider', { name: /行宽/ }).fill('900')
  await page.getByRole('button', { name: '关闭版式' }).click()
  assert.equal(await editorText(editor), '开端\n\n转折')
  await page.getByTestId('open-outline-expansion').click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByTestId('open-outline-expansion').click()
  await editor.waitFor()
  checks.push('planning expansion hides and restores the shared editor without losing its draft')
  await sameEditor('outline', 'total')
  await page.getByTestId('open-outline-history').click()
  const history = page.getByTestId('outline-history')
  await history.getByRole('button', { name: /第 1 版/ }).click()
  await history.getByRole('button', { name: '恢复到编辑稿', exact: true }).click()
  assert.equal(await editorText(editor), '开端\n\n\n转折')
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get('total'))).content, '开端\n\n转折')
  await page.getByTestId('outline-undo').click()
  assert.equal(await editorText(editor), '开端\n\n转折')
  checks.push('outline persisted history restores only draft and one undo returns current text')
  await annotate(editor, 'total')
  const opinionPanel = page.getByTestId('annotation-panel')
  const opinion = opinionPanel.getByRole('textbox', { name: '批注内容' })
  async function openOpinions(kind = 'total') {
    const prefix = kind === 'body' ? 'manuscript' : 'outline'
    await page.locator(`[data-testid="${prefix}-editor"][data-document-kind="${kind}"]`).waitFor()
    if (!await opinionPanel.isVisible()) await page.getByTestId(prefix + '-annotations').click()
    await opinion.waitFor()
    await page.waitForFunction(() => {
      const input = document.querySelector('[aria-label="批注内容"]')
      return input instanceof HTMLTextAreaElement && !input.disabled
    })
  }
  await openOpinions(); await opinion.fill('甲书总纲暂存意见')
  await page.getByTestId('planning-volume-1').click(); await openOpinions('volume')
  assert.equal(await opinion.inputValue(), ''); await opinion.fill('甲书卷纲暂存意见')
  await page.getByTestId('planning-chapter-1').click(); await openOpinions('chapter-outline')
  assert.equal(await opinion.inputValue(), ''); await opinion.fill('甲书章纲暂存意见')
  await page.getByTestId('planning-write-chapter').click(); await openOpinions('body')
  assert.equal(await opinion.inputValue(), ''); await opinion.fill('甲书正文暂存意见')
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('[data-library-view="all"]').click(); await open(books[1]); await openOpinions()
  assert.equal(await opinion.inputValue(), ''); await opinion.fill('乙书总纲意见')
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('[data-library-view="all"]').click(); await open(books[0]); await openOpinions()
  assert.equal(await opinion.inputValue(), '甲书总纲暂存意见')
  await opinionPanel.getByRole('button', { name: '编辑', exact: true }).first().click()
  assert.equal(await opinion.inputValue(), '甲书总纲暂存意见')
  await opinionPanel.getByText('当前意见尚未保存，请先保存或清空，再编辑其他批注。', { exact: true }).waitFor()
  for (const [target, text] of [['planning-volume-1', '甲书卷纲暂存意见'], ['planning-chapter-1', '甲书章纲暂存意见']]) {
    await page.getByTestId(target).click(); await openOpinions(target === 'planning-volume-1' ? 'volume' : 'chapter-outline')
    assert.equal(await opinion.inputValue(), text)
    await opinionPanel.getByRole('button', { name: '清空意见', exact: true }).click()
  }
  await page.getByTestId('planning-write-chapter').click(); await openOpinions('body')
  assert.equal(await opinion.inputValue(), '甲书正文暂存意见')
  await opinionPanel.getByRole('button', { name: '清空意见', exact: true }).click()
  await page.locator('[data-nav-parent="planning"]').click(); await page.locator('[data-nav-leaf="total-outline"]').click(); await openOpinions()
  assert.equal(await opinion.inputValue(), '甲书总纲暂存意见')
  await editor.click(); await editor.press('Control+Home'); await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight')
  await opinionPanel.getByTestId('save-annotation').click()
  await opinionPanel.getByText('甲书总纲暂存意见', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="批注内容"]')?.value === '')
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get('total'))).content, '开端\n\n转折')
  assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
  await capture('annotation-draft-return.png')
  await opinionPanel.getByRole('button', { name: '收起批注', exact: true }).click()
  checks.push('unsaved annotation opinions survive outline/prose remounts and two-book navigation; explicit save preserves formal text and makes zero model calls')
  // Faults are injected around the real validated IPC handlers in this isolated
  // application only. Successful writes still use the real project database.
  await app.evaluate(({ ipcMain }) => {
    const channels = ['document-annotations:create', 'document-annotations:list']
    const state = globalThis.annotationAckFixture = { mode: 'normal', failRead: false, calls: [], handlers: new Map(channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)])) }
    for (const channel of channels) {
      const original = state.handlers.get(channel)
      if (!original) throw new Error('Missing annotation handler: ' + channel)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        if (channel.endsWith(':list')) return state.failRead ? { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：批注列表回读失败', recoverable: true } } : original(...args)
        state.calls.push({ operationId: args[1].operationId, body: args[1].body })
        if (state.mode === 'write-failure') return { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：批注未写入', recoverable: true } }
        if (state.mode === 'delay') { state.reached(); await new Promise(resolve => { state.release = resolve }) }
        const result = await original(...args)
        if (state.mode === 'read-failure' && result.ok) state.failRead = true
        return result
      })
    }
  })
  try {
    await openOpinions()
    await editor.click(); await editor.press('Control+Home'); await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight')
    await app.evaluate(() => { globalThis.annotationAckFixture.mode = 'read-failure' })
    await opinion.fill('保存成功但列表暂不可读的意见')
    await opinionPanel.getByTestId('save-annotation').click()
    const reviewStatus = page.getByTestId('document-review-status')
    await reviewStatus.getByText(/批注已保存，但列表刷新失败/).waitFor()
    await page.waitForFunction(() => document.querySelector('[aria-label="批注内容"]')?.value === '')
    assert.equal(await opinionPanel.getByTestId('save-annotation').isDisabled(), true)
    await capture('annotation-saved-refresh-failed.png')
    await app.evaluate(() => { const state = globalThis.annotationAckFixture; state.failRead = false; state.mode = 'normal' })
    await reviewStatus.getByRole('button', { name: '重新核对', exact: true }).click()
    await opinionPanel.getByText('保存成功但列表暂不可读的意见', { exact: true }).waitFor()
    assert.equal(await app.evaluate(() => globalThis.annotationAckFixture.calls.length), 1)
    checks.push('a real saved annotation with a failed follow-up read clears the form, shows a truthful warning and retries without another write')

    await app.evaluate(() => {
      const state = globalThis.annotationAckFixture
      state.mode = 'delay'; state.ready = new Promise(resolve => { state.reached = resolve })
    })
    await opinion.fill('切走后才确认保存的总纲意见')
    await opinionPanel.getByTestId('save-annotation').click()
    await app.evaluate(() => globalThis.annotationAckFixture.ready)
    await page.getByTestId('planning-volume-1').click(); await openOpinions('volume')
    assert.equal(await opinion.inputValue(), '')
    await opinion.fill('卷纲尚未提交的独立意见')
    await page.locator('[data-nav-leaf="total-outline"]').click()
    await page.locator('[data-testid="outline-editor"][data-document-kind="total"]').waitFor()
    if (!await opinionPanel.isVisible()) await page.getByTestId('outline-annotations').click()
    await opinionPanel.getByText('保存成功但列表暂不可读的意见', { exact: true }).waitFor()
    assert.equal(await opinion.isDisabled(), true)
    assert.equal(await opinion.inputValue(), '切走后才确认保存的总纲意见')
    assert.equal(await opinionPanel.getByText('切走后才确认保存的总纲意见', { exact: true }).count(), 0)
    await app.evaluate(() => { const state = globalThis.annotationAckFixture; state.mode = 'normal'; state.release() })
    await opinionPanel.getByText('切走后才确认保存的总纲意见', { exact: true }).waitFor()
    await page.waitForFunction(() => { const input = document.querySelector('[aria-label="批注内容"]'); return input?.value === '' && !input.disabled })
    assert.equal(await reviewStatus.getByRole('alert').count(), 0)
    await capture('annotation-late-save-return.png')
    await page.getByTestId('planning-volume-1').click(); await openOpinions('volume')
    assert.equal(await opinion.inputValue(), '卷纲尚未提交的独立意见')
    assert.equal(await opinionPanel.getByText('切走后才确认保存的总纲意见', { exact: true }).count(), 0)
    await opinionPanel.getByRole('button', { name: '清空意见', exact: true }).click()
    await page.locator('[data-nav-leaf="total-outline"]').click(); await openOpinions()
    assert.equal(await opinion.inputValue(), '')
    assert.equal(await app.evaluate(() => globalThis.annotationAckFixture.calls.length), 2)
    checks.push('an acknowledged save after editor remount clears its pending opinion and refreshes its card without touching the other outline opinion')

    await editor.click(); await editor.press('Control+Home'); await editor.press('Shift+ArrowRight'); await editor.press('Shift+ArrowRight')
    await app.evaluate(() => { globalThis.annotationAckFixture.mode = 'write-failure' })
    await opinion.fill('写入失败必须保留的意见')
    await opinionPanel.getByTestId('save-annotation').click()
    await opinionPanel.getByRole('alert').filter({ hasText: '合成测试：批注未写入' }).waitFor()
    assert.equal(await opinion.inputValue(), '写入失败必须保留的意见')
    await app.evaluate(() => { globalThis.annotationAckFixture.mode = 'normal' })
    await opinionPanel.getByTestId('save-annotation').click()
    await opinionPanel.getByText('写入失败必须保留的意见', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('[aria-label="批注内容"]')?.value === '')
    const calls = await app.evaluate(() => globalThis.annotationAckFixture.calls)
    assert.equal(calls.length, 4); assert.equal(calls[2].operationId, calls[3].operationId)
    const saved = await page.evaluate(async workItemId => {
      const api = window.novelDesktop.documentReview, snapshot = await api.readSnapshot({ workItemId, kind: 'total' })
      return { snapshot, annotations: (await api.annotations.list({ document: snapshot.ref, includeDeleted: true })).items }
    }, books[0].id)
    for (const body of ['保存成功但列表暂不可读的意见', '切走后才确认保存的总纲意见', '写入失败必须保留的意见']) assert.equal(saved.annotations.filter(item => item.body === body).length, 1)
    assert.equal(saved.snapshot.content, '开端\n\n转折')
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
    checks.push('an unconfirmed write keeps the actual form; retry uses the same operation, saves one comment and leaves formal text and model calls unchanged')
    await opinionPanel.getByRole('button', { name: '收起批注', exact: true }).click()
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis.annotationAckFixture
      state.release?.()
      for (const [channel, handler] of state.handlers) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      delete globalThis.annotationAckFixture
    })
  }
  await editor.dispatchEvent('compositionstart', { data: '雾' })
  assert.equal(await page.getByTestId('outline-format').isDisabled(), true)
  assert.equal(await page.getByTestId('outline-undo').isDisabled(), true)
  await editor.dispatchEvent('compositionend', { data: '雾' })
  await page.getByTestId('outline-find').click()
  await page.locator('.manuscript-find input').first().fill('转折')
  await page.locator('.manuscript-find input').first().press('Escape')
  checks.push('composition guard and shared editor search')
  for (const target of [
    ['planning-volume-1', '当前卷纲正文'],
    ['planning-chapter-1', '当前章纲正文'],
    ['open-planned-chapter-900', '独立章纲正文']
  ]) {
    await page.getByTestId(target[0]).click()
    const input = page.getByRole('textbox', { name: target[1], exact: true })
    await input.waitFor()
    assert.equal(await page.getByTestId('outline-undo').isDisabled(), true)
    const before = await editorText(input)
    await page.getByTestId('outline-format').click()
    await page.getByTestId('outline-undo').click()
    assert.equal(await editorText(input), before)
    await sameEditor('outline', target[0])
    if (target[0] === 'open-planned-chapter-900') {
      const title = page.getByRole('textbox', { name: '独立章纲标题', exact: true })
      const originalTitle = await title.inputValue()
      await title.fill('')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await title.inputValue(), '')
      assert.equal(await page.getByTestId('save-planned-chapter').isDisabled(), true)
      await page.getByTestId('outline-undo').click()
      assert.equal(await title.inputValue(), originalTitle)
      await title.fill('经过修改的独立章纲')
      await page.getByTestId('save-planned-chapter').click()
      await waitForApi(async () => (await window.novelDesktop.outlines.getPlannedChapter(900)).title === '经过修改的独立章纲')
      assert.equal((await page.evaluate(() => window.novelDesktop.chapters.list())).some(chapter => chapter.id === 900), false)
      checks.push('shared title history preserves empty title; standalone save never creates prose')
    }
    await annotate(input, target[0])
    if (target[0] === 'planning-chapter-1') await checkOutlineSaveConsumer(input, { workItemId: books[0].id, kind: 'chapter-outline', legacyId: 1 }, 'bound-outline', 'chapter-outlines:get')
    if (target[0] === 'open-planned-chapter-900') await checkOutlineSaveConsumer(input, { workItemId: books[0].id, kind: 'chapter-outline', legacyId: 900 }, 'standalone-outline', 'outlines:get-planned-chapter', true)
  }
  await page.locator('[data-testid^="open-stage-"]').first().click()
  await page.getByRole('textbox', { name: '当前阶段纲正文', exact: true }).waitFor()
  assert.equal(await page.getByTestId('outline-undo').isDisabled(), true)
  const stageTitle = page.getByRole('textbox', { name: '当前阶段名称', exact: true })
  const originalStageTitle = await stageTitle.inputValue()
  await stageTitle.fill('')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await stageTitle.inputValue(), '')
  assert.equal(await page.getByTestId('save-outline-document').isDisabled(), true)
  await page.getByTestId('outline-undo').click()
  assert.equal(await stageTitle.inputValue(), originalStageTitle)
  await sameEditor('outline', 'stage')
  checks.push('volume/chapter/stage share full editor with isolated histories')
  await annotate(page.getByRole('textbox', { name: '当前阶段纲正文', exact: true }), 'stage')
  await checkOutlineSaveConsumer(page.getByRole('textbox', { name: '当前阶段纲正文', exact: true }), { workItemId: books[0].id, kind: 'stage', legacyId: books[0].stageId }, 'stage-outline', 'outlines:list')
  // More than one real persisted page: updating a late entry must not remove
  // the other expanded comments or keep a resolved comment selected for AI.
  const annotationFixture = await page.evaluate(async ({ workItemId, legacyId }) => {
    const api = window.novelDesktop.documentReview
    const snapshot = await api.readSnapshot({ workItemId, kind: 'stage', legacyId })
    const ids = []
    for (let i = 1; i <= 55; i++) {
      const draft = await api.recoverDraft(snapshot.ref)
      const annotation = await api.annotations.create({ document: snapshot.ref, operationId: crypto.randomUUID(), expectedRevision: snapshot.revision,
        expectedDraftRevision: draft?.revision ?? null, title: snapshot.title, draftText: snapshot.content, start: 0, end: 2, body: `分页批注 ${i}` })
      ids.push(annotation.id)
    }
    return { document: snapshot.ref, content: snapshot.content, id: ids[0] }
  }, { workItemId: books[0].id, legacyId: books[0].stageId })
  await page.locator('[data-nav-leaf="total-outline"]').click()
  await page.getByTestId(`open-stage-${books[0].stageId}`).click()
  await page.getByTestId('outline-annotations').click()
  const expandedAnnotations = page.getByTestId('annotation-panel')
  await page.waitForFunction(() => document.querySelectorAll('[data-annotation-card]').length === 50)
  await expandedAnnotations.getByRole('button', { name: '更多批注', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-annotation-card]').length === 56)
  const olderAnnotation = page.locator(`[data-annotation-card="${annotationFixture.id}"]`)
  await olderAnnotation.getByRole('checkbox').check()
  await olderAnnotation.getByRole('button', { name: '编辑', exact: true }).click()
  await expandedAnnotations.getByRole('textbox', { name: '批注内容' }).fill('第二页修改意见仍在，其他批注也保留。')
  await expandedAnnotations.getByTestId('save-annotation').click()
  await olderAnnotation.getByText('第二页修改意见仍在，其他批注也保留。', { exact: true }).waitFor()
  assert.equal(await expandedAnnotations.locator('[data-annotation-card]').count(), 56)
  assert.equal(await olderAnnotation.getByRole('checkbox').isChecked(), true)
  await olderAnnotation.getByRole('button', { name: '解决', exact: true }).click()
  await expandedAnnotations.getByText('已选 0 条批注', { exact: true }).waitFor()
  await expandedAnnotations.getByRole('checkbox', { name: '显示已解决和已删除' }).check()
  await olderAnnotation.getByRole('button', { name: '重新打开', exact: true }).click()
  await olderAnnotation.getByRole('button', { name: '解决', exact: true }).waitFor()
  assert.equal(await expandedAnnotations.locator('[data-annotation-card]').count(), 56)
  const storedAnnotation = await page.evaluate(async fixture => {
    const api = window.novelDesktop.documentReview
    return { item: (await api.annotations.list({ document: fixture.document, includeDeleted: true })).items.find(item => item.id === fixture.id),
      content: (await api.readSnapshot(fixture.document)).content }
  }, annotationFixture)
  assert.equal(storedAnnotation.item.revision, 4)
  assert.equal(storedAnnotation.item.status, 'open')
  assert.equal(storedAnnotation.content, annotationFixture.content)
  await capture('annotation-expanded-pages.png')
  await expandedAnnotations.getByRole('button', { name: '收起批注', exact: true }).click()
  checks.push('56 persisted annotations stay expanded through edit, resolve and reopen; selection and formal outline remain correct')
  await page.getByTestId('outline-layout').click()
  for (const zoom of [1, 1.25]) {
    // The application supports a minimum 1000 CSS px; 1280 at 125% stays inside it.
    await owner.evaluate((w, zoom) => { w.setContentSize(zoom === 1 ? 1100 : 1280, 900); w.webContents.setZoomFactor(zoom) }, zoom)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const panel = page.locator('.writing-layout-popover')
    assert.equal(await panel.getByRole('slider', { name: /行宽/ }).isVisible(), true)
    for (const locator of [page.getByTestId('outline-layout'), panel.getByRole('button', { name: '关闭版式' }), page.getByTestId('save-outline-document')]) {
      assert.equal(await locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }), true)
    }
    assert.equal(await page.locator('.plain-text-host').evaluate(el => { const r = el.getBoundingClientRect(); return r.height > 80 && r.top < innerHeight - 80 }), true)
    await capture(`toolbar-${zoom}.png`)
  }
  await page.getByRole('button', { name: '关闭版式' }).click()
  checks.push('layout at 1100x900 and 1280x900 at 125 percent keeps controls in viewport')
  await owner.evaluate(w => { w.setContentSize(1440, 900); w.webContents.setZoomFactor(1) })
  await page.getByTestId('planning-chapter-1').click()
  await page.getByTestId('planning-write-chapter').click()
  await sameEditor('manuscript', 'body')
  await writeFile(join(output, 'shared-editor-surfaces.json'), JSON.stringify(surfaces, null, 2))
  checks.push('six document entries share paper, typography, guides, title, footer, follow input and actual focus mode')
  const body = page.getByTestId('manuscript-input')
  await body.fill('正文第一段。\n\n\n正文第二段。')
  const bodyBefore = await editorText(body)
  await page.getByTestId('manuscript-format').click()
  assert.notEqual(await editorText(body), bodyBefore)
  await page.getByTestId('manuscript-undo').click()
  assert.equal(await editorText(body), bodyBefore)
  await page.getByTestId('manuscript-redo').click()
  const bodyAfter = await editorText(body)
  await body.press('Control+s')
  await waitForApi(async content => (await window.novelDesktop.chapters.get(1)).content === content, bodyAfter)
  checks.push('prose shared toolbar retains external history and real save')
  // Restart with one real task/artifact source and two separate changes. No
  // provider call and no author directory is involved in this native fixture.
  await close()
  const db = await new SqliteWorkspaceDatabaseFactory().openExisting(books[0].path)
  const document = db.documentReviewSnapshot({ workItemId: books[0].id, kind: 'body', legacyId: 1 })
  const sourceText = '　　开端。' + '穿过长街。'.repeat(30) + '\n\n　　结尾。'
  db.writeFormalChapter({ legacyChapterId: 1, title: document.title, content: sourceText, expectedRevision: document.revision, reason: 'manual' })
  const baseline = db.documentReviewSnapshot(document.ref)
  const candidate = sourceText.replace('开端', '新开端').replace('结尾', '新结尾')
  const taskId = randomUUID(), artifactId = randomUUID()
  const hash = text => createHash('sha256').update(text).digest('hex')
  const checkpoint = phase => JSON.stringify({ version: 1, phase, workItemId: books[0].id, request: { chapterId: 1, message: '隔离润色测试', currentDraft: sourceText } })
  db.createTaskRun({ id: taskId, legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: randomUUID(), contentHash: hash(sourceText), checkpointJson: checkpoint('queued') })
  db.transitionTaskRun({ id: taskId, status: 'running', checkpointJson: checkpoint('model') })
  const content = JSON.stringify({ id: randomUUID(), workItemId: books[0].id, chapterId: 1, createdAt: new Date().toISOString(), model: 'isolated-provider',
    skill: { id: 'rewrite', label: '改写' }, answer: '候选已完成', tools: [], candidate: { mode: 'replaceSelection', content: candidate,
      baseDraftFingerprint: hash(sourceText), selection: { start: 0, end: sourceText.length, text: sourceText }, diff: buildWritingAgentDiff(sourceText, candidate) } })
  db.completeTaskRunWithArtifact(taskId, checkpoint('approval'), { id: artifactId, taskRunId: taskId, artifactType: 'writing_agent_turn', status: 'complete', content, contentHash: hash(content), schemaValid: true, metadataJson: '{}' })
  db.close()
  await launch(); await library(); await open(books[0])
  await page.getByTestId('planning-chapter-1').click(); await page.getByTestId('planning-write-chapter').click()
  const reviewDoc = await page.evaluate(async ({ taskId, workItemId }) => {
    try {
    const api = window.novelDesktop
    const snapshot = await api.documentReview.readSnapshot({ workItemId, kind: 'body', legacyId: 1 })
    await api.documentReview.openReview({ document: snapshot.ref, taskId })
    return snapshot.ref
    } catch (error) { throw new Error(JSON.stringify(error)) }
  }, { taskId, workItemId: books[0].id })
  // Load the persistent review using the real document lifecycle.
  await page.reload(); await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if (await page.locator('.work-item-open').count()) { await page.locator('[data-library-view="all"]').click(); await open(books[0]); await page.getByTestId('planning-chapter-1').click(); await page.getByTestId('planning-write-chapter').click() }
  await page.locator('.inline-review').first().waitFor()
  assert.equal(await page.locator('.inline-review').count(), 2)
  assert.equal(await editorText(page.getByTestId('manuscript-input')), sourceText)
  await page.getByTestId('manuscript-input').dispatchEvent('compositionstart', { data: '中' })
  assert.equal(await page.locator('.inline-review button:enabled').count(), 0)
  await page.getByTestId('manuscript-input').dispatchEvent('compositionend', { data: '中' })
  await page.waitForFunction(() => document.querySelectorAll('.inline-review button:enabled').length === 4)
  assert.equal(await editorText(page.getByTestId('manuscript-input')), sourceText)
  checks.push('Chinese composition disables red suggestion actions and ending input restores them without altering prose')
  await capture('inline-red-suggestions.png')
  await installReviewSaveFaults(true)
  try {
  await page.locator('.inline-review').first().getByRole('button', { name: '保留', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.inline-review').length === 1)
  await page.getByTestId('manuscript-undo').click()
  await page.waitForFunction(() => document.querySelectorAll('.inline-review').length === 2)
  assert.equal(await editorText(page.getByTestId('manuscript-input')), sourceText)
  await page.getByTestId('manuscript-redo').click()
  await page.waitForFunction(() => document.querySelectorAll('.inline-review').length === 1)
  await page.getByTestId('save-manuscript').click()
  const status = page.getByTestId('document-review-status')
  await status.getByRole('alert').filter({ hasText: '修订操作失败，稿件仍保留。' }).waitFor()
  assert.match(await page.getByTestId('manuscript-save-state').textContent(), /合成测试：稿件未写入/)
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(1))).content, sourceText)
  assert.equal(await editorText(page.getByTestId('manuscript-input')), sourceText.replace('开端', '新开端'))
  await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-save-state"]')?.classList.contains('error'))
  await capture('review-save-write-failed.png')
  checks.push('real review write failure keeps retained prose and staged source, shows unsaved state and leaves formal bytes unchanged')
  await app.evaluate(() => { globalThis.reviewSaveFixture.failWrite = false })
  await status.getByRole('button', { name: '重新核对', exact: true }).click()
  await status.getByRole('alert').waitFor({ state: 'hidden' })
  await page.getByTestId('save-manuscript').click()
  await status.getByRole('alert').filter({ hasText: /稿件已保存.*修订记录刷新失败/ }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-save-state"]')?.classList.contains('saved'))
  await waitForApi(async original => (await window.novelDesktop.chapters.get(1)).content === original.replace('开端', '新开端'), sourceText)
  const beforeRetry = await app.evaluate(() => ({ writes: globalThis.reviewSaveFixture.writes, confirmed: globalThis.reviewSaveFixture.confirmed }))
  assert.equal(beforeRetry.confirmed, 1)
  await capture('review-save-refresh-failed.png')
  await app.evaluate(() => { globalThis.reviewSaveFixture.failRead = false })
  await status.getByRole('button', { name: '重新核对', exact: true }).click()
  await status.getByRole('alert').waitFor({ state: 'hidden' })
  assert.deepEqual(await app.evaluate(() => ({ writes: globalThis.reviewSaveFixture.writes, confirmed: globalThis.reviewSaveFixture.confirmed })), beforeRetry)
  assert.equal((await page.evaluate(doc => window.novelDesktop.documentReview.listReviews(doc), reviewDoc))[0].blocks.filter(block => block.status === 'committed').length, 1)
  checks.push('confirmed prose review save stays saved on list failure; read-only retry restores committed sources without another write')
  } finally { await restoreReviewSaveHandlers() }
  await checkBodySaveConsumer(reviewDoc, candidate)
  await waitForApi(async doc => (await window.novelDesktop.documentReview.listReviews(doc))[0].blocks.every(block => block.status === 'committed'), reviewDoc)
  const finalReviews = await page.evaluate(doc => window.novelDesktop.documentReview.listReviews(doc), reviewDoc)
  assert.ok(finalReviews[0].blocks.every(block => block.status === 'committed'))
  checks.push('native red suggestions do not enter text; retain/undo/redo and two saves keep one real source')
  await annotate(page.getByTestId('manuscript-input'), 'body', 'manuscript')
  checks.push('annotations created, located, resolved and reopened through all six native editor entries')
  assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
  const configured = await page.evaluate(async () => {
    try {
      const api = window.novelDesktop, catalog = await api.modelConnections.list()
      await api.modelConnections.create({ expectedRevision: catalog.revision, name: '批注隔离模型', baseUrl: 'https://document-review.invalid/v1', protocol: 'openai-compatible', apiKey: 'synthetic-fixture-key' })
      const connection = (await api.modelConnections.list()).connections[0]
      const edit = await api.modelConnections.book()
      await api.modelConnections.saveBook({ token: edit.token, patch: { routingMode: 'shared', globalReferences: [{ id: 'annotation-fixture', globalConnectionId: connection.id }], globalRevisions: [{ id: connection.id, revision: connection.revision }], shared: { connectionId: 'annotation-fixture', model: 'annotation-fixture', temperature: .2, topP: 1, maxTokens: 4000 } } })
      return true
    } catch (error) { return { error: error.message } }
  })
  assert.equal(configured, true, JSON.stringify(configured))
  await page.getByTestId('manuscript-annotations').click()
  const annotationPanel = page.getByTestId('annotation-panel')
  await annotationPanel.getByRole('checkbox', { name: /^选择批注：body/ }).check()
  await app.evaluate(({ ipcMain }) => {
    const channel = 'annotation-revision:analyze', original = ipcMain._invokeHandlers.get(channel)
    if (!original) throw new Error('Missing annotation analysis handler')
    const state = globalThis.annotationIntentFixture = { original, delay: true, requests: [] }
    state.ready = new Promise(resolve => { state.reached = resolve })
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      state.requests.push(args[1])
      const result = await original(...args)
      if (state.delay) { state.reached(result.ok); await new Promise(resolve => { state.release = resolve }) }
      return result
    })
  })
  try {
    await page.getByTestId('analyze-annotation-targets').click()
    assert.equal(await app.evaluate(() => globalThis.annotationIntentFixture.ready), true)
    await annotationPanel.getByRole('checkbox', { name: /^选择批注：body/ }).uncheck()
    await app.evaluate(() => { const state = globalThis.annotationIntentFixture; state.delay = false; state.release() })
    await annotationPanel.locator('.annotation-generation [role="alert"]').filter({ hasText: '已变化' }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.annotation-generation')?.textContent.includes('正在核对修改依据'))
    assert.equal(await page.getByTestId('annotation-targets').count(), 0)
    assert.equal((await page.evaluate(doc => window.novelDesktop.documentReview.generation.recent(doc), reviewDoc)).length, 0)
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
    await annotationPanel.locator('.annotation-generation').scrollIntoViewIfNeeded()
    await capture('annotation-analysis-selection-changed.png')
    checks.push('changing selected comments while real analysis is pending discards the delayed receipt, hides old targets and starts no model task')

    await annotationPanel.getByRole('checkbox', { name: /^选择批注：body/ }).check()
    await page.getByTestId('analyze-annotation-targets').click()
    await page.getByTestId('annotation-targets').waitFor()
    await page.locator('[data-target-kind="total"] input').check()
    await annotationPanel.locator('[data-annotation-card]').filter({ hasText: 'body：补充人物动机。' }).getByRole('button', { name: '编辑', exact: true }).click()
    await annotationPanel.getByRole('textbox', { name: '批注内容' }).fill('body：补充人物动机，并核对承诺时间。')
    const unsavedOpinion = annotationPanel.getByTestId('unsaved-annotation-opinion')
    await unsavedOpinion.waitFor()
    assert.equal(await page.getByTestId('revise-current-from-annotations').isDisabled(), true)
    assert.equal(await page.getByTestId('analyze-annotation-targets').isDisabled(), true)
    assert.equal(await page.getByTestId('annotation-targets').count(), 0)
    await unsavedOpinion.getByRole('button', { name: '返回意见', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[aria-label="批注内容"]')), true)
    assert.equal(await annotationPanel.getByRole('textbox', { name: '批注内容' }).inputValue(), 'body：补充人物动机，并核对承诺时间。')
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
    await unsavedOpinion.scrollIntoViewIfNeeded()
    await capture('annotation-unsaved-opinion.png')
    checks.push('unsaved opinion visibly blocks analysis/generation, clears old targets and returns focus to intact input with zero model calls')
    await annotationPanel.getByTestId('save-annotation').click()
    await annotationPanel.getByText('body：补充人物动机，并核对承诺时间。', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('[aria-label="批注内容"]')?.value === '')
    assert.equal(await page.getByTestId('annotation-targets').count(), 0)
    assert.equal(await annotationPanel.getByRole('checkbox', { name: /^选择批注：body/ }).isChecked(), true)
    await annotationPanel.locator('.annotation-generation [role="alert"]').filter({ hasText: '已变化' }).waitFor()
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
    const requests = await app.evaluate(() => globalThis.annotationIntentFixture.requests)
    const comments = await page.evaluate(doc => window.novelDesktop.documentReview.annotations.list({ document: doc }), reviewDoc)
    const edited = comments.items.find(item => item.id === requests[1].annotations[0].id)
    assert.ok(edited.revision > requests[1].annotations[0].revision)
    assert.equal((await page.evaluate(doc => window.novelDesktop.chapters.get(1), reviewDoc)).content, candidate)
    await annotationPanel.locator('.annotation-generation').scrollIntoViewIfNeeded()
    await capture('annotation-analysis-opinion-edited.png')
    checks.push('editing a selected saved comment keeps it selected, invalidates its ready targets and preserves formal prose with zero model calls')
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis.annotationIntentFixture
      state.release?.(); ipcMain.removeHandler('annotation-revision:analyze'); ipcMain.handle('annotation-revision:analyze', state.original)
      delete globalThis.annotationIntentFixture
    })
  }
  await page.getByTestId('analyze-annotation-targets').click()
  await page.getByTestId('annotation-targets').waitFor()
  assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 0)
  await page.locator('[data-target-kind="body"] input').uncheck()
  await page.locator('[data-target-kind="total"] input').check()
  await page.locator('[data-target-kind="volume"] input').check()
  await page.getByTestId('generate-annotation-targets').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-annotation-task]').length === 2 && [...document.querySelectorAll('[data-annotation-task]')].every(el => el.textContent.includes('等待逐处核对')), undefined, { timeout: 40000 })
  assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), 2)
  const linkedTasks = await page.evaluate(doc => window.novelDesktop.documentReview.generation.recent(doc), reviewDoc)
  assert.deepEqual(new Set(linkedTasks.map(t => t.target.document.kind)), new Set(['total', 'volume']))
  await capture('annotation-linked-tasks.png')
  await annotationPanel.getByRole('button', { name: '收起批注', exact: true }).click()
  await page.locator('[data-nav-parent="planning"]').click()
  await page.locator('[data-nav-leaf="total-outline"]').click()
  await page.locator('.inline-review').first().waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get('total'))).content, '开端\n\n转折')
  await page.locator('.inline-review').first().getByRole('button', { name: '保留', exact: true }).click()
  await installReviewSaveFaults()
  try {
  await page.getByTestId('save-outline-document').click()
  const status = page.getByTestId('document-review-status')
  await status.getByRole('alert').filter({ hasText: /稿件已保存.*修订记录刷新失败/ }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="outline-save-state"]')?.classList.contains('saved'))
  await page.waitForFunction(() => document.querySelector('[data-testid="outline-save-state"]')?.textContent.includes('已保存为 Markdown'))
  assert.equal(await page.locator('.outline-storage-warning').count(), 0)
  await waitForApi(async () => (await window.novelDesktop.outlines.get('total')).content.includes('根据批注补充动机'))
  await capture('outline-review-save-refresh-failed.png')
  await app.evaluate(() => { globalThis.reviewSaveFixture.failRead = false })
  await status.getByRole('button', { name: '重新核对', exact: true }).click()
  await status.getByRole('alert').waitFor({ state: 'hidden' })
  assert.deepEqual(await app.evaluate(() => ({ writes: globalThis.reviewSaveFixture.writes, confirmed: globalThis.reviewSaveFixture.confirmed })), { writes: 1, confirmed: 1 })
  checks.push('outline review save reports saved content separately from failed review refresh and rereads without another formal version')
  } finally { await restoreReviewSaveHandlers() }
  await waitForApi(async () => {
    const api = window.novelDesktop, summary = (await api.projects.status()).project
    const doc = await api.documentReview.readSnapshot({ workItemId: summary.id, kind: 'total' })
    return (await api.documentReview.listReviews(doc.ref)).every(r => r.blocks.every(b => b.status === 'committed'))
  })
  await page.getByTestId('planning-volume-1').click()
  await page.locator('.inline-review').first().getByRole('button', { name: '保留', exact: true }).click()
  await page.getByTestId('document-review-status').getByRole('alert').waitFor()
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get(1))).content, '卷的开端\n\n\n卷的转折')
  checks.push('explicit two-target annotation generation; total review/save invalidates downstream volume and preserves unselected documents')
  await page.getByTestId('planning-chapter-1').click()
  await page.getByTestId('planning-write-chapter').click()
  await page.getByTestId('manuscript-input').waitFor()
  if (!await page.getByTestId('annotation-panel').count()) await page.getByTestId('manuscript-annotations').click()
  await annotationPanel.getByRole('checkbox', { name: /^选择批注：body/ }).check()
  const callsBeforeStop = await app.evaluate(() => globalThis.reviewFixtureCalls)
  await app.evaluate(() => {
    const state = globalThis.annotationStopFixture = { original: globalThis.fetch }
    state.ready = new Promise(resolve => { state.reached = resolve })
    globalThis.fetch = async (url, options) => {
      const response = await state.original(url, options)
      if (!String(url).includes('/chat/completions')) return response
      return new Promise((resolve, reject) => {
        const signal = options?.signal
        const abort = () => { signal?.removeEventListener('abort', abort); reject(new DOMException('Stopped by author', 'AbortError')) }
        state.release = () => { signal?.removeEventListener('abort', abort); resolve(response) }
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
        state.reached(true)
      })
    }
  })
  try {
    await page.getByTestId('revise-current-from-annotations').click()
    assert.equal(await app.evaluate(() => globalThis.annotationStopFixture.ready), true)
    const running = (await page.evaluate(doc => window.novelDesktop.documentReview.generation.recent(doc), reviewDoc)).find(task => task.status === 'running')
    assert.ok(running)
    const row = page.locator(`[data-annotation-task="${running.id}"]`)
    await row.waitFor()
    await annotationPanel.getByRole('textbox', { name: '批注内容' }).fill('停止时也应保留的未提交意见')
    await page.getByTestId('manuscript-input').dispatchEvent('compositionstart', { data: '中' })
    assert.equal(await row.getByTestId('stop-annotation-task').isEnabled(), true)
    await row.getByTestId('stop-annotation-task').click()
    await row.getByText('已停止', { exact: true }).waitFor()
    assert.equal(await row.getByRole('button', { name: '重试', exact: true }).isDisabled(), true)
    assert.equal(await annotationPanel.getByRole('textbox', { name: '批注内容' }).inputValue(), '停止时也应保留的未提交意见')
    assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(1))).content, candidate)
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), callsBeforeStop + 1)
    await row.scrollIntoViewIfNeeded()
    await capture('annotation-stop-during-edit.png')
    await page.getByTestId('manuscript-input').dispatchEvent('compositionend', { data: '中' })
    await annotationPanel.getByRole('button', { name: '清空意见', exact: true }).click()
    await page.waitForFunction(id => !document.querySelector(`[data-annotation-task="${id}"] .generation-actions button`)?.disabled, running.id)
    assert.equal(await row.getByRole('button', { name: '重试', exact: true }).isEnabled(), true)
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), callsBeforeStop + 1)
    checks.push('real task stops during composition with unsaved opinion intact; retry stays disabled until editing ends and never starts automatically')
  } finally {
    await app.evaluate(() => {
      const state = globalThis.annotationStopFixture
      state.release?.(); globalThis.fetch = state.original; delete globalThis.annotationStopFixture
    })
  }
  // Exercise real persisted ask_author tasks. Only the transport response is
  // synthetic; task creation, question validation and continuation use main.
  const callsBeforeQuestion = await app.evaluate(() => globalThis.reviewFixtureCalls)
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis.annotationQuestionFixture = { fetch: globalThis.fetch, ask: true, loseReceipt: true, failRead: false, submissions: [], handlers: {} }
    globalThis.fetch = async (url, options) => {
      const response = await state.fetch(url, options)
      if (!state.ask || !String(url).includes('/chat/completions')) return response
      state.ask = false
      const content = JSON.stringify({ ask_author: { questions: [{ id: 'motive', prompt: '角色为何返回？', mode: 'text', required: true, options: [] }] } })
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    for (const channel of ['annotation-revision:answer', 'annotation-revision:recent']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) throw new Error('Missing annotation task handler: ' + channel)
      state.handlers[channel] = original; ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        if (channel.endsWith(':recent')) return state.failRead ? { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：后续任务暂不可读', recoverable: true } } : original(...args)
        state.submissions.push(args[1])
        const result = await original(...args)
        if (state.loseReceipt && result.ok) { state.loseReceipt = false; return { ok: false, error: { code: 'STORAGE_ERROR', message: '合成测试：回答回执中断', recoverable: true } } }
        state.failRead = true
        return result
      })
    }
  })
  try {
    await page.getByTestId('revise-current-from-annotations').click()
    const question = page.getByTestId('author-question-card')
    await question.waitFor()
    const responseInput = question.getByRole('textbox', { name: '角色为何返回？：自由回答', exact: true })
    await responseInput.fill('为了履行前文约定，先向同伴解释动机。')
    await question.getByRole('button', { name: '暂不回答', exact: true }).click()
    await question.waitFor({ state: 'hidden' })
    await annotationPanel.getByRole('button', { name: '继续回答', exact: true }).click()
    assert.equal(await responseInput.inputValue(), '为了履行前文约定，先向同伴解释动机。')
    await page.locator('[data-nav-parent="planning"]').click()
    await page.locator('[data-nav-leaf="total-outline"]').click()
    await page.getByTestId('outline-input').waitFor()
    await page.getByTestId('planning-chapter-1').click(); await page.getByTestId('planning-write-chapter').click()
    await page.getByTestId('manuscript-input').waitFor()
    if (!await annotationPanel.count()) await page.getByTestId('manuscript-annotations').click()
    await question.waitFor()
    assert.equal(await responseInput.inputValue(), '为了履行前文约定，先向同伴解释动机。')
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), callsBeforeQuestion + 1)
    await question.scrollIntoViewIfNeeded(); await capture('annotation-answer-restored.png')
    checks.push('real model question defers, resumes and restores unfinished answers across outline/prose navigation without another model call')
    await question.getByTestId('submit-author-answer').click()
    await annotationPanel.getByRole('alert').filter({ hasText: '合成测试：回答回执中断' }).first().waitFor()
    assert.equal(await responseInput.inputValue(), '为了履行前文约定，先向同伴解释动机。')
    await question.getByTestId('submit-author-answer').click()
    await question.waitFor({ state: 'hidden' })
    await annotationPanel.getByRole('alert').filter({ hasText: '合成测试：后续任务暂不可读' }).waitFor()
    await annotationPanel.getByText('回答已提交；正在核对后续任务，可刷新改稿记录查看进度。', { exact: true }).waitFor()
    const submissions = await app.evaluate(() => globalThis.annotationQuestionFixture.submissions)
    assert.equal(submissions.length, 2); assert.deepEqual(submissions[0], submissions[1])
    await capture('annotation-answer-confirmed-read-failed.png')
    await app.evaluate(() => { globalThis.annotationQuestionFixture.failRead = false })
    await annotationPanel.getByRole('button', { name: '刷新改稿记录', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.annotation-generation')?.textContent.includes('回答已提交；'))
    await annotationPanel.getByRole('alert').filter({ hasText: '合成测试：后续任务暂不可读' }).waitFor({ state: 'hidden' })
    await waitForApi(async doc => (await window.novelDesktop.documentReview.generation.recent(doc)).some(task => task.target.document.kind === 'body' && task.status === 'succeeded'), reviewDoc)
    assert.equal(await app.evaluate(() => globalThis.reviewFixtureCalls), callsBeforeQuestion + 2)
    assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(1))).content, candidate)
    checks.push('lost answer receipt retries the same submission with one continuation; confirmed answer stays sealed on read failure and formal prose is unchanged')
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis.annotationQuestionFixture
      globalThis.fetch = state.fetch
      for (const [channel, handler] of Object.entries(state.handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      delete globalThis.annotationQuestionFixture
    })
  }
  for (const theme of ['moye', 'xuanzhi', 'qingzhou']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await capture(`prose-${theme}.png`)
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'moye' })
  if (await page.getByTestId('annotation-panel').isVisible()) await page.getByTestId('annotation-panel').getByRole('button', { name: '收起批注', exact: true }).click()
  await checkChapterLeaveInput()
  await checkOutlineNavigationInput(books[0])
  await close(); await launch(); await library(); await open(books[0])
  assert.equal(await editorText(page.getByRole('textbox', { name: '全局总纲正文', exact: true })), '开端\n\n转折（根据批注补充动机）')
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('[data-library-view="all"]').click(); await open(books[1])
  assert.equal(await editorText(page.getByRole('textbox', { name: '全局总纲正文', exact: true })), '开端\n\n\n转折')
  checks.push('restart persists only saved draft; second book unaffected')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, checks, errors }, null, 2))
  console.log(JSON.stringify({ output, checks, errors }))
} catch (error) {
  if (page && !page.isClosed()) {
    await capture('failure.png').catch(() => {})
    await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText())
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ root, checks, errors, failure: String(error) }, null, 2))
  console.error(output); throw error
} finally {
  if (app) {
    // A failing check can leave an intentionally dirty synthetic draft. Destroy
    // only windows owned by this exact test application, never another instance.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {})
    await app.close().catch(() => {})
  }
}
