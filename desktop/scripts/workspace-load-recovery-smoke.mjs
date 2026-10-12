import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { _electron } from 'playwright'

// All failures and credentials below are synthetic. Never attach to the author app.
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-load-recovery-')))
const output = resolve('../.trellis/tasks/09-30-v3-workspace-load-recovery/evidence')
await mkdir(output, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
let app, page
const checks = [], errors = []
async function fingerprint(dir) {
  const result = {}
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) result[relative(dir, file)] = createHash('sha256').update(await readFile(file)).digest('hex')
    }
  }
  await visit(dir)
  return result
}
async function capture(name) {
  const owner = await app.browserWindow(page)
  await writeFile(join(output, name), Buffer.from(await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
}
async function library() {
  await page.getByTestId('book-tabs').getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.project-library').waitFor()
  await page.locator('[data-library-view="all"]').click()
}
async function open(book) {
  await page.locator('.work-item-open').filter({ hasText: book.title }).first().click()
  await page.waitForFunction(path => document.querySelector('[data-book-tab][aria-current="page"]')?.getAttribute('data-book-path') === path && !document.querySelector('main.app-frame')?.inert, book.path)
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await page.getByTestId('manuscript-input').waitFor()
}
async function release() {
  await app.evaluate(async () => {
    const deadline = Date.now() + 15000
    while (!globalThis.releaseRecovery) {
      if (Date.now() > deadline) throw Error('Targeted check did not reach test gate')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    globalThis.releaseRecovery(); globalThis.recoveryFaults.hold = false
  })
}
try {
  app = await _electron.launch({ args: [resolve('out-workspace-recovery/main/index.js')], env })
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await app.evaluate(({ ipcMain }) => {
    const issue = (id, area) => ({ id, area, title: area === 'aiSettings' ? '模型分配尚未加载完成' : '事件资料尚未加载完成',
      message: '作品资料正在更新，本次未能读完。请在当前操作结束后点击“重新检查”，无需修改正文或重新填写接口。', reason: 'busy', recovery: 'manualReview' })
    const eventIssue = issue('unifiedEventsUnreadable', 'unifiedEvents')
    globalThis.recoveryFaults = { bootstrap: true, partial: true, hold: false, calls: 0, sends: 0 }
    // Assert that none of these checks contacts an AI provider.
    const fetch = globalThis.fetch
    globalThis.fetch = (...args) => {
      if (String(args[0]).includes('provider.example.test')) { globalThis.recoveryFaults.sends++; throw Error('Synthetic provider must not be called') }
      return fetch(...args)
    }
    const bootstrap = ipcMain._invokeHandlers.get('workspace:bootstrap')
    ipcMain._invokeHandlers.set('workspace:bootstrap', async (...args) => {
      const response = await bootstrap(...args)
      if (!response.ok || !globalThis.recoveryFaults.bootstrap) return response
      return { ...response, value: { ...response.value, aiSettings: null, eventProjection: null,
        issues: [eventIssue, issue('modelSettingsUnreadable', 'aiSettings')] } }
    })
    const recheck = ipcMain._invokeHandlers.get('workspace:recheck-load-issues')
    ipcMain._invokeHandlers.set('workspace:recheck-load-issues', async (...args) => {
      globalThis.recoveryFaults.calls++
      const response = await recheck(...args)
      if (globalThis.recoveryFaults.hold) await new Promise(resolve => { globalThis.releaseRecovery = () => { globalThis.releaseRecovery = null; resolve() } })
      if (!response.ok || !globalThis.recoveryFaults.partial) return response
      return { ...response, value: { ...response.value, eventProjection: null, issues: [eventIssue] } }
    })
  })
  const books = await page.evaluate(async root => {
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'system' }))
    localStorage.setItem('lanjian-theme', 'moye')
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    const api = window.novelDesktop
    const catalog = await api.modelConnections.create({ expectedRevision: 0, name: '隔离测试接口', baseUrl: 'https://provider.example.test/v1', protocol: 'openai-compatible', apiKey: 'synthetic-secret-sentinel' })
    const current = await api.modelConnections.defaults()
    const p = { connectionId: 'planner', model: 'fixture-model', temperature: 0.6, topP: 0.9, maxTokens: 4096 }
    await api.modelConnections.saveDefaults({ expectedRevision: current.revision, expectedCatalogRevision: catalog.revision,
      template: { version: 4, references: [{ kind: 'global', id: 'planner', globalConnectionId: catalog.connections[0].id }], routingMode: 'shared', shared: p,
        tasks: Object.fromEntries(['outline', 'chapterOutline', 'prose', 'review'].map(task => [task, p])) } })
    const result = []
    for (const title of ['恢复测试甲书', '恢复测试乙书']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, genre: '悬疑' })
      await api.projects.switch(project.path)
      const chapter = await api.chapters.create(), content = `${title}的合成正文，不使用作者原稿。`
      await api.chapters.update(chapter.id, { title: '第一章', content, expectedRevision: chapter.revision })
      result.push({ ...project, content })
    }
    return result
  }, root)
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(win => { win.hide(); win.show(); win.focus() })
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('[data-library-view="all"]').click()
  await open(books[0])
  await page.getByTestId('workspace-bootstrap-issues').waitFor()
  const details = page.getByTestId('workspace-bootstrap-issues')
  if (!await details.evaluate(element => element.open)) await page.getByTestId('workspace-bootstrap-issues-summary').click()
  assert.equal(await page.getByTestId('recheck-workspace-issues').count(), 2)
  await capture('recovery-before.png')
  await page.getByTestId('copy-workspace-diagnostic').first().click()
  await page.getByTestId('workspace-recovery-feedback').filter({ hasText: '已复制' }).waitFor()
  const diagnostic = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.match(diagnostic, /unifiedEventsUnreadable/)
  for (const secret of [root, books[0].content, 'synthetic-secret-sentinel', 'provider.example.test']) assert.ok(!diagnostic.includes(secret))
  checks.push('native clipboard contains only version, issue ID and reason')

  await app.evaluate(() => { globalThis.recoveryFaults.hold = true })
  await page.getByTestId('recheck-workspace-issues').first().click()
  await page.getByTestId('manuscript-input').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('重新检查时补写的正文。')
  books[0].content += '重新检查时补写的正文。'
  await release()
  await page.getByTestId('workspace-recovery-feedback').filter({ hasText: '已恢复 1 项' }).waitFor()
  assert.equal(await page.getByTestId('recheck-workspace-issues').count(), 1)
  assert.equal((await page.getByTestId('manuscript-input').innerText()).trim(), books[0].content)
  checks.push('partial check clears recovered model warning and retains failed events and manuscript typed in flight')

  await page.locator('[data-nav-parent="settings"]').click()
  // Settings navigation is grouped; search exposes the routing destination directly.
  await page.getByPlaceholder('搜索设置项').fill('任务模型')
  await page.getByTestId('settings-nav-routing').click()
  const model = page.locator('[data-model-slot="shared"] input[aria-label$="型号"]').first()
  await model.waitFor(); await model.fill('作者尚未保存的型号')
  await app.evaluate(() => { globalThis.recoveryFaults.partial = false; globalThis.recoveryFaults.hold = true })
  await page.getByTestId('recheck-workspace-issues').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="recheck-workspace-issues"]')?.disabled)
  await model.fill('检查期间继续输入的型号')
  await release()
  await page.getByTestId('workspace-recovery-feedback').filter({ hasText: '检查完成' }).waitFor()
  assert.equal(await model.inputValue(), '检查期间继续输入的型号')
  assert.equal(await page.getByTestId('workspace-bootstrap-issues').count(), 0)
  await capture('recovery-after-draft.png')
  checks.push('successful recheck clears warning without resetting mounted model input, including typing in flight')

  // Direct named recheck must leave every project file byte-identical.
  const before = await fingerprint(books[0].path)
  const recovered = await page.evaluate(book => window.novelDesktop.workspace.recheckLoadIssues({ workItem: { id: book.id, path: book.path }, issueIds: ['unifiedEventsUnreadable', 'modelSettingsUnreadable'] }), books[0])
  assert.deepEqual(recovered.issues, [])
  assert.equal(recovered.aiSettings.modelConfigured, true)
  assert.equal(recovered.aiSettings.apiKeyConfigured, true)
  assert.deepEqual(await fingerprint(books[0].path), before)
  checks.push('production targeted check preserves all book file hashes and reports configured model without provider request')

  await page.getByRole('button', { name: '放弃本页未保存修改并重新读取', exact: true }).click()
  await page.getByRole('button', { name: '放弃本页未保存修改并重新读取', exact: true }).waitFor({ state: 'hidden' })
  await page.locator('[data-nav-parent="manuscript"]').click()
  await library(); await open(books[1])
  if (!await details.evaluate(element => element.open)) await page.getByTestId('workspace-bootstrap-issues-summary').click()
  await app.evaluate(() => { globalThis.recoveryFaults.hold = true })
  await page.getByTestId('recheck-workspace-issues').first().click()
  await library(); await open(books[0])
  await release()
  await app.evaluate(() => { globalThis.recoveryFaults.bootstrap = false })
  // Let the delayed IPC response traverse preload and Vue's next render.
  await page.waitForTimeout(300)
  assert.equal((await page.getByTestId('manuscript-input').innerText()).trim(), books[0].content)
  const saved = await page.evaluate(async () => {
    const chapters = await window.novelDesktop.chapters.list()
    return (await window.novelDesktop.chapters.get(chapters[0].id)).content
  })
  assert.equal(saved.trim(), books[0].content)
  assert.equal(await page.getByTestId('workspace-recovery-feedback').count(), 0)
  checks.push('late result from B cannot overwrite A or display B recovery feedback')
  await library(); await open(books[1]); await library(); await open(books[0])
  assert.equal(await page.getByTestId('workspace-bootstrap-issues').count(), 0)
  checks.push('returning through warm cache does not revive recovered warning')
  const faults = await app.evaluate(() => globalThis.recoveryFaults)
  assert.equal(faults.sends, 0)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'desktop-smoke.json'), JSON.stringify({ passed: true, checks, pageErrors: errors, recheckCalls: faults.calls, providerCalls: faults.sends, fixture: 'isolated synthetic books and credentials' }, null, 2))
  console.log(JSON.stringify({ passed: true, checks, output }))
} catch (error) {
  if (page && !page.isClosed()) await capture('recovery-failure.png').catch(() => {})
  const failure = { passed: false, checks, error: String(error), pageErrors: errors }
  await writeFile(join(output, 'desktop-smoke.json'), JSON.stringify(failure, null, 2))
  await writeFile(join(output, `desktop-smoke-failure-${Date.now()}.json`), JSON.stringify(failure, null, 2))
  throw error
} finally {
  if (app) {
    // This process owns the isolated test instance; bypass its normal author
    // close prompt when a failed test leaves a synthetic draft on screen.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
}
