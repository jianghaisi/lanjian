import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'

// Actual catalog first; controlled main-process IPC fixtures for interactive states only.
// No install/probe call reaches the production service, and no model file is downloaded.
const evidence = resolve('artifacts/local-model-catalog')
await mkdir(evidence, { recursive: true })
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-catalog-native-')))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE'))
const report = { root, newWeightsDownloaded: 0, inference: 'none; UI fixtures are not model inference', checks: [], screenshots: [], hashes: {} }
for (const file of ['out-local-model-catalog/main/index.js', 'out-local-model-catalog/preload/index.cjs', 'out-local-model-catalog/main/local-models/text-worker.py', 'out-local-model-catalog/main/local-models/text_prompts.py', 'src/contracts/models/local-model-contracts.ts', 'src/main/modules/models/adapters/local-models/text-runtime.ts', 'src/main/modules/models/application/local-model-service.ts', 'src/renderer/features/models/components/LocalModelStore.vue', 'src/renderer/features/models/components/LocalModelCard.vue', 'src/renderer/features/models/composables/use-local-models.ts', 'src/renderer/features/models/composables/create-connections-actions.js']) {
  report.hashes[file] = createHash('sha256').update(await readFile(resolve(file))).digest('hex')
}
const html = await readFile(resolve('out-local-model-catalog/renderer/index.html'), 'utf8')
for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[a-zA-Z0-9_.-]+)"/g)) {
  const file = 'out-local-model-catalog/renderer/' + match[1]
  report.hashes[file] = createHash('sha256').update(await readFile(resolve(file))).digest('hex')
}
await withChronicleBuildSnapshot(resolve('out-local-model-catalog'), join(evidence, 'snapshots'), async snapshot => {
  let app, page
  const start = async () => {
    app = await electron.launch({ args: [join(snapshot, 'out/main/index.js')], env: { ...env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }, timeout: 60000 })
    app.process().stderr.on('data', data => { report.stderr = (report.stderr || '') + data.toString().slice(0, 4000) })
    page = await app.firstWindow({ timeout: 60000 }); page.setDefaultTimeout(30000)
    // Startup animation is outside this catalog check; use its supported reduced-motion path.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => Boolean(window.novelDesktop))
  }
  const enter = async () => {
    await page.bringToFront()
    await page.waitForFunction(() => document.querySelector('[data-testid="app-boot"]') || document.querySelector('[data-testid="library-continue-writing"]'))
    const deadline = Date.now() + 60000
    while (Date.now() < deadline && await page.getByTestId('app-boot').isVisible()) {
      const skip = page.getByTestId('app-boot-skip-models'), button = page.getByTestId('app-boot-enter')
      if (await skip.isVisible()) await skip.click()
      else if (await button.isVisible()) await button.click()
      await page.waitForTimeout(250)
    }
    await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByTestId('library-continue-writing').click()
    await page.getByTestId('workspace-loading').waitFor({ state: 'hidden', timeout: 60000 })
    await page.locator('.activitybar [data-activity="settings"]').focus(); await page.keyboard.press('Enter')
    await page.getByTestId('settings-category-ai').click(); await page.getByTestId('settings-nav-local-models').click()
    await page.locator('.store-model').first().waitFor()
  }
  const capture = async (name, width, height, zoom, top = true, anchor) => {
    const bounds = await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))
      w.unmaximize(); w.setContentSize(width, height); w.webContents.setZoomFactor(zoom); return w.getContentBounds()
    }, { width, height, zoom })
    await page.waitForTimeout(350)
    if (anchor) await page.locator(anchor).scrollIntoViewIfNeeded()
    else if (top) await page.locator('.store-heading').scrollIntoViewIfNeeded()
    assert.ok(await page.getByTestId('local-model-store').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
    const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).capturePage()).toPNG().toString('base64'))
    await writeFile(join(evidence, name), Buffer.from(bytes, 'base64'))
    report.screenshots.push({ name, width, height, zoom, bounds, dimensions })
  }
  const fixtureHandlers = async (rows, settings) => app.evaluate(({ ipcMain }, { rows, settings, stateFile }) => {
    const fs = process.getBuiltinModule('fs')
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { rows, settings, calls: [] }
    globalThis.catalogUiFixture = state
    const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
    const success = value => ({ ok: true, value })
    for (const name of ['local-models:list', 'local-models:install', 'local-models:inspect', 'local-models:cancel', 'ai:get-settings', 'ai:update-settings']) ipcMain.removeHandler(name)
    ipcMain.handle('local-models:list', async () => {
      state.listInFlight = (state.listInFlight || 0) + 1
      state.maxListInFlight = Math.max(state.maxListInFlight || 0, state.listInFlight)
      const rows = structuredClone(state.rows)
      try {
        if (state.holdList) await new Promise(resolve => { (state.releaseLists ||= []).push(resolve) })
        if (state.listDelayMs) await new Promise(resolve => setTimeout(resolve, state.listDelayMs))
        if (state.failList) return { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: '夹具读取失败', recoverable: true } }
        state.lastListedOperations = rows.filter(row => row.operationId).map(row => row.operationId)
        return success(rows)
      } finally { state.listInFlight--; state.listCompleted = (state.listCompleted || 0) + 1 }
    })
    ipcMain.handle('local-models:install', async (_event, id) => {
      state.calls.push(['install', id])
      if (state.holdPreparation) await new Promise(resolve => { state.releasePreparation = resolve })
      if (state.installFailure) return { ok: false, error: { code: 'CONFLICT', message: state.installFailure, recoverable: true } }
      const row = state.rows.find(row => row.id === id)
      Object.assign(row, { state: 'downloading', progress: 42, message: '测试夹具：下载权重', operation: 'install', operationId: process.getBuiltinModule('crypto').randomUUID(), receivedBytes: 420000, totalBytes: 1000000 })
      if (state.failListAfterInstall) { state.failList = true; state.failListAfterInstall = false }
      if (state.holdListAfterInstall) { state.holdList = true; state.holdListAfterInstall = false }
      save(); return success(row)
    })
    ipcMain.handle('local-models:inspect', async (_event, id) => {
      state.calls.push(['inspect', id])
      if (state.holdPreparation) await new Promise(resolve => { state.releasePreparation = resolve })
      if (state.inspectFailure) return { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: state.inspectFailure, recoverable: true } }
      const row = state.rows.find(row => row.id === id)
      if (state.inspectReady) Object.assign(row, { state: 'ready', operation: 'inspect', progress: 100, message: '测试夹具：重新检测通过', capabilities: ['text', 'stream', 'structured', 'tool-step'] })
      if (state.holdListAfterInspect) { state.holdList = true; state.holdListAfterInspect = false }
      save(); return success(row)
    })
    ipcMain.handle('local-models:cancel', async (_event, id, operationId) => {
      state.cancelRequests ||= []; state.cancelRequests.push([id, operationId])
      const row = state.rows.find(row => row.id === id)
      if (!row || row.operationId !== operationId) return success(false)
      if (state.holdCancel) await new Promise(resolve => { state.releaseCancel = resolve })
      if (row.operationId !== operationId) return success(false)
      state.calls.push(['cancel', id, operationId]); row.state = 'cancelled'; row.message = '测试夹具：已停止，可继续'
      delete row.operationId
      if (state.holdListAfterCancel) { state.holdList = true; state.holdListAfterCancel = false }
      save(); return success(true)
    })
    ipcMain.handle('ai:get-settings', () => {
      state.settingsReads = (state.settingsReads || 0) + 1
      if (state.failNextSettingsRead) {
        state.failNextSettingsRead = false; save()
        return { ok: false, error: { code: 'STORAGE_ERROR', message: '夹具：保存后的状态读取失败。', recoverable: true } }
      }
      return success(state.settings)
    })
    ipcMain.handle('ai:update-settings', async (_event, patch) => {
      state.calls.push(['assign', patch])
      if (state.holdAssign) await new Promise(resolve => { state.releaseAssign = resolve })
      if (state.assignFailure) return { ok: false, error: { code: 'STORAGE_ERROR', message: state.assignFailure, recoverable: true } }
      Object.assign(state.settings, patch, { modelConfigured: true })
      state.failNextSettingsRead = Boolean(state.failSettingsAfterAssign); state.failSettingsAfterAssign = false
      save(); return success(state.settings)
    })
  }, { rows, settings, stateFile: join(root, 'ui-fixture.json') })
  const mark = message => { report.checks.push(message); console.log('PASS ' + message) }
  try {
    await start()
    const initial = await page.evaluate(() => window.novelDesktop.localModels.list())
    assert.equal(initial.length, 16); assert.ok(initial.every(row => row.state === 'not-installed' && row.canDownload))
    await page.evaluate(parentPath => window.novelDesktop.projects.create({ parentPath, name: '模型目录隔离验收', genre: '悬疑' }), root)
    await page.reload(); await enter()
    await page.waitForFunction(() => document.querySelectorAll('.store-model').length === 16)
    assert.equal(await page.getByTestId('assign-local-model').count(), 0)
    assert.equal(await page.locator('.model-badges').filter({ hasText: '未开发实测' }).count(), 15)
    mark('actual 16-row catalog, 15 untested badges, no unready assignment')
    await capture('catalog-100.png', 1440, 1000, 1)
    await capture('catalog-125.png', 1100, 900, 1.25)
    await page.getByTestId('install-' + initial[0].id).scrollIntoViewIfNeeded()
    await capture('catalog-125-actions.png', 1100, 900, 1.25, false)
    await capture('catalog-wide.png', 1640, 1060, 1)
    // Theme-only visual fixtures use the real renderer; no author preference is saved.
    const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme)
    report.visualChecks = []
    for (const theme of ['xuanzhi', 'qingzhou', 'moye']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await capture('catalog-library-' + theme + '.png', 1440, 1000, 1)
      const visual = await page.evaluate(() => {
        const card = document.querySelector('.store-model'), button = card.querySelector('.model-button.primary')
        const ink = getComputedStyle(card.querySelector('h3')), surface = getComputedStyle(card), action = getComputedStyle(button)
        const luminance = color => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
        }
        const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
        // Chromium may serialize color-mix as color(srgb ...); resolve through canvas.
        const color = value => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const context = canvas.getContext('2d'); context.fillStyle = value; context.fillRect(0, 0, 1, 1)
          return 'rgb(' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',') + ')'
        }
        return {
          theme: document.documentElement.dataset.theme,
          rootOpacity: getComputedStyle(document.documentElement).opacity,
          rootFilter: getComputedStyle(document.documentElement).filter,
          radius: surface.borderRadius, titleFont: ink.fontFamily,
          cardContrast: contrast(color(ink.color), color(surface.backgroundColor)),
          actionContrast: contrast(color(action.color), color(action.backgroundColor)),
          overflow: [...document.querySelectorAll('.store-model')].some(el => el.scrollWidth > el.clientWidth + 1)
        }
      })
      assert.equal(visual.rootOpacity, '1'); assert.equal(visual.rootFilter, 'none')
      assert.equal(visual.radius, '0px'); assert.equal(visual.titleFont.split(',').at(-1).trim(), 'serif')
      assert.ok(visual.cardContrast >= 4.5); assert.ok(visual.actionContrast >= 4.5); assert.equal(visual.overflow, false)
      report.visualChecks.push(visual)
    }
    await capture('catalog-library-moye-125.png', 1100, 900, 1.25, false, '.store-model:first-child .model-actions')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('.store-model').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s')
    const download = page.getByTestId('install-' + initial[0].id)
    await download.focus()
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
    assert.equal(await download.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), true)
    assert.equal(await download.evaluate(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return r.width >= 32 && r.height >= 32 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit))
    }), true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(theme => { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme }, originalTheme)
    mark('actual catalog UI: My Works typography and square archive cards, three themes with readable contrast, compact 125% keyboard/hit targets and reduced motion; no preference or model writes')
    const beforeBrowseSettings = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    const search = page.getByRole('searchbox', { name: '搜索模型' })
    await search.fill('GLM'); assert.equal(await page.locator('.store-model').count(), 1)
    await page.locator('.model-details summary').focus(); await page.keyboard.press('Enter')
    assert.equal(await page.locator('.model-details').getAttribute('open'), '')
    assert.match(await page.locator('.model-details').innerText(), /社区量化来源/)
    assert.equal(await page.locator('.model-detail-body dl > div').count(), 6)
    assert.match(await page.locator('.model-detail-body').innerText(), /许可\s+MIT/)
    assert.match(await page.locator('.model-detail-body').innerText(), /最大输出\s+4,096 tokens/)
    await capture('catalog-glm.png', 1440, 1000, 1)
    await capture('catalog-glm-details-125.png', 1100, 900, 1.25, false, '.model-detail-body')
    assert.equal(await page.locator('.model-detail-body').evaluate(el => [...el.querySelectorAll('dl, dd, .model-runtime-note')].every(node => node.scrollWidth <= node.clientWidth + 1)), true)
    await search.fill(''); await page.getByLabel('筛选模型系列').selectOption('DeepSeek')
    assert.equal(await page.locator('.store-model').count(), 3)
    await page.getByLabel('模型排列方式').selectOption('size')
    const sorted = await page.locator('.store-model').evaluateAll(els => els.map(el => el.dataset.modelId))
    assert.deepEqual(sorted, initial.filter(row => row.family === 'DeepSeek').sort((a, b) => a.bytes - b.bytes).map(row => row.id))
    await capture('catalog-deepseek.png', 1440, 1000, 1)
    assert.match(await page.getByTestId('model-filter-summary').innerText(), /系列：DeepSeek/)
    await search.fill('蒸馏')
    await capture('catalog-filter-summary-125.png', 1100, 900, 1.25, false, '.store-filter-summary')
    const clearFilters = page.getByTestId('clear-model-filters')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))
      window.focus(); window.webContents.focus()
    })
    await clearFilters.focus(); await page.keyboard.press('Enter')
    assert.equal(await search.inputValue(), '')
    await page.waitForFunction(() => {
      const field = document.querySelector('.store-search input'), accent = document.querySelector('.store-result i')
      return field === document.activeElement && getComputedStyle(field).borderBottomColor === getComputedStyle(accent).backgroundColor
    }, undefined, { timeout: 5000 })
    report.searchFocus = await search.evaluate(el => {
      const style = getComputedStyle(el)
      return { focused: el === document.activeElement, outline: style.outlineStyle, shadow: style.boxShadow,
        top: style.borderTopWidth, left: style.borderLeftWidth, right: style.borderRightWidth,
        bottomWidth: parseFloat(style.borderBottomWidth), bottomColor: style.borderBottomColor,
        accent: getComputedStyle(document.querySelector('.store-result i')).backgroundColor }
    })
    assert.equal(report.searchFocus.focused, true)
    assert.equal(report.searchFocus.outline, 'none'); assert.equal(report.searchFocus.shadow, 'none')
    assert.equal(report.searchFocus.top, '0px'); assert.equal(report.searchFocus.left, '0px'); assert.equal(report.searchFocus.right, '0px')
    assert.ok(report.searchFocus.bottomWidth > 0 && report.searchFocus.bottomWidth <= 1)
    assert.equal(report.searchFocus.bottomColor, report.searchFocus.accent)
    await capture('catalog-search-focus-125.png', 1100, 900, 1.25, false, '.store-search')
    assert.equal(await page.getByTestId('model-filter-summary').count(), 0)
    assert.equal(await page.getByLabel('筛选模型系列').inputValue(), '')
    assert.equal(await page.getByLabel('模型排列方式').inputValue(), 'size')
    assert.deepEqual(await page.locator('.store-model').evaluateAll(els => els.map(el => el.dataset.modelId)), [...initial].sort((a, b) => a.bytes - b.bytes).map(row => row.id))
    const longQuery = '很长的型号关键词 <测试> '.repeat(24)
    await search.fill(longQuery)
    await capture('catalog-long-filter-125.png', 1100, 900, 1.25, false, '.store-filter-summary')
    assert.equal(await page.getByTestId('model-filter-summary').locator('li').getAttribute('title'), '关键词：' + longQuery.trim())
    assert.equal(await page.getByTestId('model-filter-summary').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    assert.equal(await clearFilters.evaluate(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return r.width >= 32 && r.height >= 32 && (hit === el || el.contains(hit))
    }), true)
    await clearFilters.focus(); await page.keyboard.press('Enter')
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeBrowseSettings)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.localModels.list()), initial)
    mark('actual catalog browsing: grouped full license/budgets, keyboard details, visible filters, long Chinese query, 125% hit targets and reset focus/order; settings and models unchanged')
    await search.fill('no-such-model'); await page.getByRole('button', { name: '查看全部模型', exact: true }).click()
    assert.equal(await page.locator('.store-model').count(), 16)
    mark('search, family filter, size sort, empty reset and keyboard details')
    const settings = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    await fixtureHandlers(initial, settings)
    const glm = initial.find(row => row.family === 'GLM').id, qwen = initial[0].id
    await search.fill('GLM')
    const unavailableCard = page.locator('[data-model-id="' + glm + '"]')
    const beforeAvailabilityCalls = await app.evaluate(() => globalThis.catalogUiFixture.calls.length)
    await app.evaluate((_electron, id) => {
      Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), {
        canDownload: false, message: '测试夹具：未找到完整模型与运行环境，当前环境暂不支持自动安装。'
      })
    }, glm)
    const unavailableButton = unavailableCard.getByRole('button', { name: '暂不支持安装', exact: true })
    await unavailableButton.waitFor(); assert.equal(await unavailableButton.isDisabled(), true)
    assert.match(await unavailableCard.locator('.model-message').innerText(), /暂不支持自动安装/)
    assert.equal(await unavailableCard.getByTestId('inspect-' + glm).count(), 0)
    assert.equal(await unavailableCard.getByTestId('install-' + glm).count(), 0)
    assert.equal(await unavailableCard.getByTestId('assign-local-model').count(), 0)
    assert.equal(await unavailableCard.locator('.model-estimate').count(), 0)
    await capture('catalog-install-unavailable-fixture.png', 1440, 1000, 1, false, '.model-message')
    await capture('catalog-install-unavailable-125-fixture.png', 1100, 900, 1.25, false, '.model-message')
    await unavailableCard.locator('.model-details summary').focus(); await page.keyboard.press('Enter')
    assert.equal(await unavailableCard.locator('.model-details').getAttribute('open'), '')
    await page.keyboard.press('Enter')
    await app.evaluate((_electron, id) => {
      Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), { state: 'detected', message: '测试夹具：已发现资源，可检测' })
    }, glm)
    await unavailableCard.getByTestId('inspect-' + glm).waitFor()
    assert.equal(await unavailableCard.getByTestId('inspect-' + glm).isEnabled(), true)
    await app.evaluate((_electron, id) => {
      Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), { state: 'ready', progress: 100, message: '测试夹具：检测通过', capabilities: ['text', 'stream', 'structured', 'tool-step'] })
    }, glm)
    await unavailableCard.getByTestId('assign-local-model').waitFor()
    assert.equal(await unavailableCard.getByTestId('assign-local-model').isEnabled(), true)
    await page.mouse.move(0, 0)
    const assignmentPalette = await unavailableCard.getByTestId('assign-local-model').evaluate(el => ({
      action: getComputedStyle(el).backgroundColor,
      accent: getComputedStyle(document.querySelector('.store-result i')).backgroundColor
    }))
    assert.equal(assignmentPalette.action, assignmentPalette.accent)
    await app.evaluate((_electron, original) => {
      const s = globalThis.catalogUiFixture; s.rows[s.rows.findIndex(row => row.id === original.id)] = original
    }, initial.find(row => row.id === glm))
    await unavailableCard.getByTestId('install-' + glm).waitFor()
    assert.equal(await unavailableCard.getByTestId('install-' + glm).isEnabled(), true)
    assert.equal(await unavailableButton.count(), 0)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.length), beforeAvailabilityCalls)
    mark('UI fixture: unsupported installation explains its disabled action at 100%/125%; existing resources remain detectable/selectable, recovery restores download, and no preparation or assignment is triggered')
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture; s.listDelayMs = 1400; s.maxListInFlight = 0
      s.rows.find(row => row.id === id).description = '慢速目录夹具：第一轮已更新'
    }, glm)
    await page.getByText('慢速目录夹具：第一轮已更新', { exact: true }).waitFor()
    await app.evaluate((_electron, id) => { globalThis.catalogUiFixture.rows.find(row => row.id === id).description = '慢速目录夹具：第二轮已更新' }, glm)
    await page.getByText('慢速目录夹具：第二轮已更新', { exact: true }).waitFor()
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.maxListInFlight), 1)
    await app.evaluate((_electron, original) => { const s = globalThis.catalogUiFixture; s.listDelayMs = 0; s.rows.find(row => row.id === original.id).description = original.description; s.installFailure = '夹具：另一窗口正在准备，请稍后重试。' }, initial.find(row => row.id === glm))
    await page.getByTestId('install-' + glm).click()
    await page.getByTestId('local-model-action-error').waitFor()
    const completedBefore = await app.evaluate(() => globalThis.catalogUiFixture.listCompleted)
    await page.waitForTimeout(2500)
    assert.ok(await app.evaluate(() => globalThis.catalogUiFixture.listCompleted) > completedBefore)
    assert.match(await page.getByTestId('local-model-action-error').innerText(), /另一窗口/)
    assert.equal(await page.locator('.store-model').count(), 1)
    assert.equal(await page.getByTestId('install-' + glm).isEnabled(), true)
    await capture('catalog-action-error-fixture.png', 1440, 1000, 1)
    await page.getByTestId('local-model-action-error').getByRole('button', { name: '关闭提示' }).click()
    await app.evaluate(() => { globalThis.catalogUiFixture.installFailure = '' })
    mark('UI fixture: slow reads refresh without overlap; actionable failure survives polling and keeps retry controls visible')
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture; s.holdPreparation = true
      Object.assign(s.rows.find(row => row.id === id), { state: 'cancelled', operation: 'inspect', progress: 100, message: '测试夹具：上一轮准备完成', receivedBytes: 1000000, totalBytes: 1000000 })
    }, glm)
    await page.locator('.model-message').filter({ hasText: '上一轮准备完成' }).waitFor()
    await search.fill('GLM'); await page.getByTestId('install-' + glm).click()
    const awaiting = page.locator('.store-active').getByRole('button', { name: '等待状态…' })
    await awaiting.waitFor(); assert.equal(await awaiting.isDisabled(), true)
    assert.match(await page.locator('.model-state').innerText(), /准备中/)
    assert.match(await page.locator('.model-progress').innerText(), /正在确认准备状态/)
    assert.doesNotMatch(await page.locator('.store-active').innerText(), /100%|上一轮准备完成|停止检测|停止安装/)
    assert.doesNotMatch(await page.locator('.model-progress').innerText(), /100%|1 MB|上一轮准备完成/)
    assert.equal(await page.locator('.model-progress progress').count(), 0)
    assert.equal(await page.locator('.model-actions').getByRole('button', { name: '等待状态…' }).isDisabled(), true)
    await capture('catalog-preparation-pending-fixture.png', 1440, 1000, 1, false, '.model-progress')
    await capture('catalog-preparation-pending-125-fixture.png', 1100, 900, 1.25, false, '.model-progress')
    await search.fill('qwen3-1.7b'); assert.equal(await page.getByTestId('install-' + qwen).isDisabled(), true)
    assert.equal(await awaiting.isVisible(), true)
    await search.fill('GLM')
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdPreparation = false; s.releasePreparation(); delete s.releasePreparation })
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).waitFor()
    assert.match(await page.locator('.model-progress').innerText(), /42%/)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    mark('UI fixture: pending installation hides stale phase/100%/bytes, disables unknown stop, survives filtering at 100%/125%, then hands over to actual progress without assigning')
    await search.fill('qwen3-1.7b'); assert.equal(await page.getByTestId('install-' + qwen).isDisabled(), true)
    await page.getByTestId('model-scope-ready').focus(); await page.keyboard.press('Enter')
    assert.equal(await page.locator('.store-model').count(), 0)
    assert.equal(await page.locator('.store-active').isVisible(), true)
    await app.evaluate(() => { globalThis.catalogUiFixture.holdCancel = true })
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).click()
    await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).waitFor()
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdCancel = false; s.releaseCancel(); delete s.releaseCancel })
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    await page.getByTestId('model-scope-all').click()
    await search.fill('GLM'); assert.match(await page.getByTestId('install-' + glm).innerText(), /继续安装/)
    await page.getByTestId('install-' + glm).click(); await page.locator('.model-progress').waitFor()
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    mark('UI fixture: exact model install/stop/continue; active banner survives filtering; other preparations disabled')
    await page.getByTestId('install-' + glm).click()
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).waitFor()
    const readFailureOperation = await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture; s.failList = true; s.holdCancel = true
      return s.rows.find(row => row.id === id).operationId
    }, glm)
    await page.getByRole('button', { name: '重新读取', exact: true }).waitFor()
    assert.equal(await page.locator('.store-model').count(), 0)
    assert.match(await page.locator('.store-active').innerText(), /状态暂时无法读取，仍可尝试停止本次准备/)
    assert.doesNotMatch(await page.locator('.store-active').innerText(), /42%|下载权重/)
    assert.match(await page.getByTestId('model-scope-all').innerText(), /—/)
    await capture('catalog-read-failure-stop-fixture.png', 1440, 1000, 1, false, '.store-active')
    await capture('catalog-read-failure-stop-125-fixture.png', 1100, 900, 1.25, false, '.store-active')
    const stopUnreadable = page.locator('.store-active').getByRole('button', { name: '停止安装' })
    await stopUnreadable.focus(); await page.keyboard.press('Enter')
    await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).waitFor()
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdCancel = false; s.releaseCancel(); delete s.releaseCancel })
    await stopUnreadable.waitFor()
    assert.match(await page.locator('.store-active').innerText(), /状态暂时无法读取/)
    const stoppedOnDisk = JSON.parse(await readFile(join(root, 'ui-fixture.json'), 'utf8'))
    assert.equal(stoppedOnDisk.rows.find(row => row.id === glm).state, 'cancelled')
    assert.deepEqual(stoppedOnDisk.cancelRequests.at(-1), [glm, readFailureOperation])
    assert.deepEqual(stoppedOnDisk.settings, settings)
    await app.evaluate(() => { globalThis.catalogUiFixture.failList = false })
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    await page.getByTestId('install-' + glm).click()
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).waitFor()
    const successor = await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture, row = s.rows.find(row => row.id === id)
      s.failList = true
      const previous = row.operationId; row.operationId = process.getBuiltinModule('crypto').randomUUID()
      return { previous, current: row.operationId, requests: s.cancelRequests.length }
    }, glm)
    await page.getByRole('button', { name: '重新读取', exact: true }).waitFor()
    await stopUnreadable.click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.deepEqual(await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture, row = s.rows.find(row => row.id === id)
      return { last: s.cancelRequests.at(-1), requests: s.cancelRequests.length, operationId: row.operationId, state: row.state }
    }, glm), { last: [glm, successor.previous], requests: successor.requests + 1, operationId: successor.current, state: 'downloading' })
    assert.equal(await page.getByRole('button', { name: '重新读取', exact: true }).isVisible(), true)
    await app.evaluate(() => { globalThis.catalogUiFixture.failList = false })
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await stopUnreadable.click(); await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    mark('UI fixture: failed directory keeps exact keyboard stop without stale progress at 100%/125%; accepted stop waits for readable state, stale stop preserves successor and assignments')
    await app.evaluate(() => { globalThis.catalogUiFixture.failListAfterInstall = true })
    await page.getByTestId('install-' + glm).click()
    await page.getByRole('button', { name: '重新读取', exact: true }).waitFor()
    const acknowledged = await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture
      return { operationId: s.rows.find(row => row.id === id).operationId, listed: s.lastListedOperations, cancels: s.cancelRequests.length }
    }, glm)
    assert.ok(acknowledged.operationId)
    assert.equal(acknowledged.listed.includes(acknowledged.operationId), false, 'no successful list provided the new stop ID')
    assert.equal(await page.locator('.store-model').count(), 0)
    assert.match(await page.locator('.store-active').innerText(), /状态暂时无法读取/)
    assert.doesNotMatch(await page.locator('.store-active').innerText(), /42%|下载权重|已停止/)
    assert.equal(await stopUnreadable.isEnabled(), true)
    await capture('catalog-install-acknowledged-fixture.png', 1440, 1000, 1, false, '.store-active')
    await capture('catalog-install-acknowledged-125-fixture.png', 1100, 900, 1.25, false, '.store-active')
    await app.evaluate(() => { globalThis.catalogUiFixture.holdCancel = true })
    await stopUnreadable.focus(); await page.keyboard.press('Enter')
    await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).waitFor()
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdCancel = false; s.releaseCancel(); delete s.releaseCancel })
    await page.waitForFunction(() => document.querySelector('.store-active button')?.textContent === '停止安装' && !document.querySelector('.store-active button').disabled)
    const acknowledgedOnDisk = JSON.parse(await readFile(join(root, 'ui-fixture.json'), 'utf8'))
    assert.equal(acknowledgedOnDisk.rows.find(row => row.id === glm).state, 'cancelled')
    assert.deepEqual(acknowledgedOnDisk.cancelRequests.at(-1), [glm, acknowledged.operationId])
    assert.equal(acknowledgedOnDisk.cancelRequests.length, acknowledged.cancels + 1)
    assert.deepEqual(acknowledgedOnDisk.settings, settings)
    await app.evaluate(() => { globalThis.catalogUiFixture.failList = false })
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.match(await page.getByTestId('install-' + glm).innerText(), /继续安装/)
    mark('UI fixture: install acknowledgement retains exact keyboard stop before any active listing succeeds; no stale progress, unchanged assignments, recovery and 100%/125% layout')
    await app.evaluate(() => { globalThis.catalogUiFixture.holdListAfterInstall = true })
    await page.getByTestId('install-' + glm).click()
    const acknowledgedCardStop = page.locator('.model-actions').getByRole('button', { name: '停止安装', exact: true })
    await acknowledgedCardStop.waitFor()
    assert.equal(await acknowledgedCardStop.isEnabled(), true); assert.equal(await stopUnreadable.isEnabled(), true)
    assert.match(await page.locator('.model-state').innerText(), /准备中/)
    assert.match(await page.locator('.model-progress').innerText(), /正在确认准备状态/)
    assert.match(await page.locator('.store-active').innerText(), /正在确认准备状态/)
    assert.doesNotMatch(await page.locator('.model-progress').innerText(), /42%|已停止|下载权重/)
    assert.equal(await page.locator('.model-progress progress').count(), 0)
    const slowAcknowledged = await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture
      return { operationId: s.rows.find(row => row.id === id).operationId, listed: s.lastListedOperations, inFlight: s.listInFlight, cancels: s.cancelRequests.length }
    }, glm)
    assert.ok(slowAcknowledged.inFlight > 0)
    assert.equal(slowAcknowledged.listed.includes(slowAcknowledged.operationId), false)
    await capture('catalog-acknowledged-stop-pending-fixture.png', 1440, 1000, 1, false, '.model-progress')
    await capture('catalog-acknowledged-stop-pending-125-fixture.png', 1100, 900, 1.25, false, '.model-progress')
    await search.fill('qwen3-1.7b')
    assert.equal(await page.getByTestId('install-' + qwen).isDisabled(), true)
    assert.equal(await stopUnreadable.isEnabled(), true)
    await search.fill('GLM')
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdList = false; s.holdCancel = true })
    await acknowledgedCardStop.focus(); await page.keyboard.press('Enter')
    await page.locator('.model-actions').getByRole('button', { name: '正在停止…' }).waitFor()
    assert.equal(await page.locator('.model-actions').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdCancel = false; s.releaseCancel(); delete s.releaseCancel })
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.match(await page.getByTestId('install-' + glm).innerText(), /继续安装/)
    assert.ok(await app.evaluate(() => globalThis.catalogUiFixture.listInFlight > 0 && globalThis.catalogUiFixture.releaseLists.length > 0), 'the original reads are still pending after confirmed stop')
    const slowStoppedOnDisk = JSON.parse(await readFile(join(root, 'ui-fixture.json'), 'utf8'))
    assert.equal(slowStoppedOnDisk.rows.find(row => row.id === glm).state, 'cancelled')
    assert.deepEqual(slowStoppedOnDisk.cancelRequests.at(-1), [glm, slowAcknowledged.operationId])
    assert.equal(slowStoppedOnDisk.cancelRequests.length, slowAcknowledged.cancels + 1)
    assert.deepEqual(slowStoppedOnDisk.settings, settings)
    await search.fill('qwen3-1.7b')
    await app.evaluate(() => { globalThis.catalogUiFixture.holdPreparation = true })
    await page.getByTestId('install-' + qwen).click()
    await page.locator('.store-active').getByRole('button', { name: '等待状态…' }).waitFor()
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; for (const release of s.releaseLists || []) release(); delete s.releaseLists })
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.store-active strong').innerText(), initial.find(row => row.id === qwen).name)
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '等待状态…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdPreparation = false; s.releasePreparation(); delete s.releasePreparation })
    await stopUnreadable.waitFor(); await stopUnreadable.click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    await search.fill('GLM')
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    mark('UI fixture: acknowledged stops work during held reads at 100%/125%; keyboard exact cancel releases another-model retry before old reads return, without clearing its pending start or changing assignments')
    const waitForHeldLists = async count => app.evaluate(async (_electron, count) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((globalThis.catalogUiFixture.releaseLists || []).length >= count) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw Error('expected held renderer lists: ' + count)
    }, count)
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture
      Object.assign(s.rows.find(row => row.id === id), { state: 'failed', operation: 'inspect', capabilities: [], message: '测试夹具：检测待重试' })
      s.inspectReady = true; s.holdListAfterInspect = true
    }, glm)
    await page.getByTestId('inspect-' + glm).waitFor()
    await page.getByTestId('inspect-' + glm).focus(); await page.keyboard.press('Enter')
    // Initial, completion and polling reads are all held. Let only the newest
    // poll publish terminal status; the inspection's own refresh stays pending.
    await waitForHeldLists(3)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdList = false; s.releaseLists.pop()() })
    const glmAssign = page.locator('[data-model-id="' + glm + '"] [data-testid="assign-local-model"]')
    await glmAssign.waitFor(); assert.equal(await glmAssign.isEnabled(), true)
    assert.equal(await page.locator('.store-active').count(), 0)
    assert.ok(await app.evaluate(() => globalThis.catalogUiFixture.listInFlight >= 2))
    await capture('catalog-inspection-settled-fixture.png', 1440, 1000, 1, false, '.model-actions')
    await search.fill('qwen3-1.7b')
    await app.evaluate(() => { globalThis.catalogUiFixture.holdPreparation = true })
    await page.getByTestId('install-' + qwen).click()
    await page.locator('.store-active').getByRole('button', { name: '等待状态…' }).waitFor()
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; for (const release of s.releaseLists) release(); delete s.releaseLists })
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.store-active strong').innerText(), initial.find(row => row.id === qwen).name)
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '等待状态…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdPreparation = false; s.inspectReady = false; s.releasePreparation(); delete s.releasePreparation })
    await stopUnreadable.waitFor(); await stopUnreadable.click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), settings)
    mark('UI fixture: completed detection unlocks selection and another model before its old reads return; late inspection cleanup preserves the new start, with unchanged assignments')
    await page.getByTestId('install-' + qwen).click(); await stopUnreadable.waitFor()
    const stoppedIds = await app.evaluate((_electron, id) => ({ first: globalThis.catalogUiFixture.rows.find(row => row.id === id).operationId, count: globalThis.catalogUiFixture.cancelRequests.length }), qwen)
    await app.evaluate(() => { globalThis.catalogUiFixture.holdListAfterCancel = true })
    await stopUnreadable.focus(); await page.keyboard.press('Enter')
    await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).waitFor()
    await waitForHeldLists(2)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdList = false; s.releaseLists.pop()() })
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.ok(await app.evaluate(() => globalThis.catalogUiFixture.listInFlight > 0))
    await search.fill('GLM')
    await app.evaluate((_electron, id) => {
      Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), { state: 'cancelled', operation: 'install', capabilities: [] })
    }, glm)
    await page.getByTestId('install-' + glm).waitFor(); await page.getByTestId('install-' + glm).click()
    await page.waitForFunction(() => document.querySelector('.model-progress')?.textContent.includes('42%'))
    const successorCardStop = page.locator('.model-actions').getByRole('button', { name: '停止安装', exact: true })
    assert.equal(await successorCardStop.isEnabled(), true); assert.equal(await stopUnreadable.isEnabled(), true)
    const successorStopId = await app.evaluate((_electron, id) => globalThis.catalogUiFixture.rows.find(row => row.id === id).operationId, glm)
    await capture('catalog-successor-stop-fixture.png', 1440, 1000, 1, false, '.model-progress')
    await capture('catalog-successor-stop-125-fixture.png', 1100, 900, 1.25, false, '.model-progress')
    await app.evaluate(() => { globalThis.catalogUiFixture.holdCancel = true })
    await successorCardStop.focus(); await page.keyboard.press('Enter')
    await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).waitFor()
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; for (const release of s.releaseLists) release(); delete s.releaseLists })
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.store-active').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    assert.equal(await page.locator('.model-actions').getByRole('button', { name: '正在停止…' }).isDisabled(), true)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdCancel = false; s.releaseCancel(); delete s.releaseCancel })
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    const settledOnDisk = JSON.parse(await readFile(join(root, 'ui-fixture.json'), 'utf8'))
    assert.deepEqual(settledOnDisk.cancelRequests.slice(stoppedIds.count), [[qwen, stoppedIds.first], [glm, successorStopId]])
    for (const id of [qwen, glm]) assert.equal(settledOnDisk.rows.find(row => row.id === id).state, 'cancelled')
    assert.deepEqual(settledOnDisk.settings, settings)
    mark('UI fixture: a held old stop read cannot disable successor controls or clear its own pending stop; exact independent cancellations persisted, keyboard and 100%/125% verified')
    const beforeRetry = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    const installsBeforeRetry = await app.evaluate(() => globalThis.catalogUiFixture.calls.filter(call => call[0] === 'install').length)
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture
      Object.assign(s.rows.find(row => row.id === id), { state: 'failed', operation: 'inspect', progress: 0, message: '测试夹具：检测未完成，可重试检测或继续安装' })
      s.inspectFailure = '夹具：本次检测仍未完成，请重试。'
    }, glm)
    const retry = page.getByTestId('inspect-' + glm), resume = page.getByTestId('install-' + glm)
    await retry.waitFor(); assert.match(await retry.innerText(), /重新检测/)
    assert.match(await resume.innerText(), /继续安装/)
    await capture('catalog-inspect-retry-fixture.png', 1440, 1000, 1, false, '.model-retry')
    await capture('catalog-inspect-retry-125-fixture.png', 1100, 900, 1.25, false, '.model-retry')
    for (const button of [retry, resume]) {
      assert.ok(await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 80 && r.height >= 30 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }))
    }
    await app.evaluate(() => { globalThis.catalogUiFixture.holdPreparation = true })
    await retry.focus(); await page.keyboard.press('Enter')
    await awaiting.waitFor(); assert.equal(await awaiting.isDisabled(), true)
    assert.match(await page.locator('.model-progress').innerText(), /正在确认准备状态/)
    assert.doesNotMatch(await page.locator('.model-progress').innerText(), /检测未完成|%/)
    assert.equal(await page.locator('.model-progress progress').count(), 0)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdPreparation = false; s.releasePreparation(); delete s.releasePreparation })
    await page.getByTestId('local-model-action-error').filter({ hasText: '本次检测仍未完成' }).waitFor()
    assert.equal(await page.locator('.store-active').count(), 0)
    assert.equal(await retry.isEnabled(), true)
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.at(-1)[0]), 'inspect')
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.filter(call => call[0] === 'install').length), installsBeforeRetry)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeRetry)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.inspectFailure = ''; s.inspectReady = true })
    await retry.focus(); await page.keyboard.press('Enter')
    await page.locator('[data-model-id="' + glm + '"] [data-testid="assign-local-model"]').waitFor()
    assert.equal(await resume.count(), 0)
    assert.equal(await page.getByTestId('local-model-action-error').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeRetry)
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture; s.inspectReady = false
      Object.assign(s.rows.find(row => row.id === id), { state: 'interrupted', operation: 'inspect', capabilities: [], progress: 0, message: '测试夹具：上次检测中断' })
    }, glm)
    await resume.waitFor(); await retry.focus(); await page.keyboard.press('Tab')
    assert.equal(await resume.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter'); await page.locator('.model-progress').waitFor()
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.at(-1)[0]), 'install')
    await page.locator('.store-active').getByRole('button', { name: '停止安装' }).click()
    await page.locator('.store-active').waitFor({ state: 'hidden' })
    assert.equal(await retry.count(), 0)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeRetry)
    mark('UI fixture: inspection recovery retries only inspection; explicit separate install, keyboard and 125% hit targets; assignments unchanged')
    await app.evaluate((_electron, ids) => {
      for (const id of ids) Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), { state: 'ready', progress: 100, message: '测试夹具：本机可用', capabilities: ['text', 'stream', 'structured', 'tool-step'] })
    }, [qwen, glm])
    await search.fill(''); await page.waitForFunction(() => document.querySelectorAll('[data-testid="assign-local-model"]').length === 2)
    const a = page.locator('[data-model-id="' + qwen + '"]'), b = page.locator('[data-model-id="' + glm + '"]')
    await a.locator('.model-assign select').selectOption('prose'); await b.locator('.model-assign select').selectOption('review')
    await search.fill('qwen3-1.7b'); assert.equal(await a.locator('.model-assign select').inputValue(), 'prose')
    const beforeSelection = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdAssign = true; s.assignFailure = '夹具：模型方案保存失败，请重试。' })
    await a.getByTestId('assign-local-model').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="assign-local-model"]').disabled)
    assert.equal(await a.locator('.model-assigned').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeSelection)
    await app.evaluate(() => { const s = globalThis.catalogUiFixture; s.holdAssign = false; s.releaseAssign(); delete s.releaseAssign })
    await page.getByText('夹具：模型方案保存失败，请重试。', { exact: true }).waitFor()
    assert.equal(await a.locator('.model-assigned').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), beforeSelection)
    assert.equal(await a.getByTestId('assign-local-model').isEnabled(), true)
    await capture('catalog-assignment-failed-fixture.png', 1440, 1000, 1)
    await app.evaluate(() => { globalThis.catalogUiFixture.assignFailure = '' })
    await a.getByTestId('assign-local-model').click()
    await page.waitForFunction(id => window.novelDesktop.ai.getSettings().then(s => s.tasks.prose.model === id), qwen)
    await a.locator('.model-assigned').filter({ hasText: '正文' }).waitFor()
    await search.fill('GLM'); assert.equal(await b.locator('.model-assign select').inputValue(), 'review')
    await app.evaluate(() => { globalThis.catalogUiFixture.failSettingsAfterAssign = true })
    await b.getByTestId('assign-local-model').click()
    await page.getByText('模型方案已保存，但模型状态暂时无法刷新，请稍后重试。', { exact: true }).waitFor()
    await b.locator('.model-assigned').filter({ hasText: '审校' }).waitFor()
    await page.waitForFunction(id => window.novelDesktop.ai.getSettings().then(s => s.tasks.review.model === id), glm)
    const assigned = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    assert.equal(assigned.tasks.prose.model, qwen); assert.equal(assigned.tasks.review.model, glm)
    assert.deepEqual(assigned.tasks.outline, settings.shared)
    mark('UI fixture: pending and failed selection keep original assignments; retry confirms selection; refresh failure preserves the successful save')
    await capture('catalog-ready-fixture.png', 1440, 1000, 1)
    mark('UI fixture: independent per-model targets and explicit separate prose/review assignments')
    const attentionRows = initial.filter(row => row.id !== qwen && row.id !== glm).slice(0, 4)
    const callsBeforeFiltering = await app.evaluate(() => globalThis.catalogUiFixture.calls.length)
    await app.evaluate((_electron, ids) => {
      for (const [index, id] of ids.entries()) Object.assign(globalThis.catalogUiFixture.rows.find(row => row.id === id), {
        state: ['detected', 'failed', 'cancelled', 'interrupted'][index], operation: 'inspect', progress: 0, message: '测试夹具：待处理状态，不代表文件已下载'
      })
    }, attentionRows.map(row => row.id))
    await page.waitForFunction(() => document.querySelector('[data-testid="model-scope-attention"]').textContent.trim().endsWith('4'))
    await search.fill(''); await page.getByTestId('model-scope-ready').focus(); await page.keyboard.press('Enter')
    assert.deepEqual(await page.locator('.store-model').evaluateAll(nodes => nodes.map(node => node.dataset.modelId).sort()), [qwen, glm].sort())
    await page.keyboard.press('Tab'); assert.equal(await page.getByTestId('model-scope-attention').evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.locator('.store-model').evaluateAll(nodes => nodes.map(node => node.dataset.modelId).sort()), attentionRows.map(row => row.id).sort())
    assert.equal(await page.getByTestId('assign-local-model').count(), 0)
    await search.fill(attentionRows[1].id); assert.equal(await page.locator('.store-model').count(), 1)
    assert.match(await page.getByTestId('model-scope-attention').innerText(), /待处理\s*4/)
    assert.match(await page.getByTestId('model-scope-ready').innerText(), /本机可用\s*2/)
    await capture('catalog-status-filters-fixture.png', 1440, 1000, 1)
    await capture('catalog-status-filters-125-fixture.png', 1100, 900, 1.25, false, '.store-tabs')
    for (const scope of ['all', 'ready', 'attention']) assert.ok(await page.getByTestId('model-scope-' + scope).evaluate(el => {
      const bounds = el.getBoundingClientRect(); return bounds.width >= 60 && bounds.height >= 30 && bounds.left >= 0 && bounds.right <= innerWidth
    }))
    await app.evaluate((_electron, rows) => {
      for (const original of rows) {
        const s = globalThis.catalogUiFixture, index = s.rows.findIndex(row => row.id === original.id)
        s.rows[index] = original
      }
    }, attentionRows)
    await page.waitForFunction(() => document.querySelector('[data-testid="model-scope-attention"]').textContent.trim().endsWith('0'))
    await page.getByTestId('clear-model-filters').focus(); await page.keyboard.press('Enter')
    assert.equal(await page.locator('.store-model').count(), 16)
    assert.equal(await search.evaluate(el => el === document.activeElement), true)
    assert.equal(await a.locator('.model-assign select').inputValue(), 'prose')
    assert.equal(await b.locator('.model-assign select').inputValue(), 'review')
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), assigned)
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.length), callsBeforeFiltering)
    mark('UI fixture: ready and attention scopes match status counts; search/reset, independent targets, keyboard and 125% controls; filtering sends no preparation or assignment calls')
    await search.fill('qwen3-1.7b')
    await page.locator('.statusbar').getByText(qwen, { exact: true }).waitFor()
    const assignmentCalls = await app.evaluate(() => globalThis.catalogUiFixture.calls.filter(call => call[0] === 'assign').length)
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture
      Object.assign(s.rows.find(row => row.id === id), { state: 'failed', operation: 'inspect', capabilities: [], progress: 0, message: '测试夹具：已分配型号暂时不可用' })
      s.settings.modelConfigured = false
    }, qwen)
    await page.locator('.statusbar').getByText('模型未配置', { exact: true }).waitFor()
    await page.locator('[data-model-id="' + qwen + '"] .model-assigned').filter({ hasText: '正文' }).waitFor()
    await capture('catalog-availability-lost-fixture.png', 1440, 1000, 1, false, '[data-model-id="' + qwen + '"] .model-retry')
    await page.getByTestId('install-' + qwen).click(); await page.locator('.model-progress').waitFor()
    await app.evaluate((_electron, id) => {
      const s = globalThis.catalogUiFixture, row = s.rows.find(row => row.id === id)
      Object.assign(row, { state: 'ready', operation: 'install', capabilities: ['text', 'stream', 'structured', 'tool-step'], progress: 100, message: '测试夹具：后台安装完成，恢复可用' })
      delete row.operationId; delete row.receivedBytes; delete row.totalBytes
      s.settings.modelConfigured = true
    }, qwen)
    await page.locator('.statusbar').getByText(qwen, { exact: true }).waitFor()
    await page.locator('[data-model-id="' + qwen + '"] [data-testid="assign-local-model"]').waitFor()
    assert.deepEqual(await page.evaluate(() => window.novelDesktop.ai.getSettings()), assigned)
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.calls.filter(call => call[0] === 'assign').length), assignmentCalls)
    const readsAfterCompletion = await app.evaluate(() => globalThis.catalogUiFixture.settingsReads)
    await page.waitForTimeout(3000)
    assert.equal(await app.evaluate(() => globalThis.catalogUiFixture.settingsReads), readsAfterCompletion)
    await capture('catalog-availability-restored-fixture.png', 1440, 1000, 1, false, '[data-model-id="' + qwen + '"] .model-actions')
    mark('UI fixture: assigned model loss and background installation completion refresh writing availability; no assignment writes or repeat settings reads on stable polls')
    await app.evaluate((_electron, path) => process.getBuiltinModule('fs').writeFileSync(path, JSON.stringify(globalThis.catalogUiFixture)), join(root, 'ui-fixture.json'))
    report.fixtureCalls = await app.evaluate(() => globalThis.catalogUiFixture.calls)
    await app.close(); app = undefined
    await start(); await fixtureHandlers(initial, settings); await enter()
    const reopened = await page.evaluate(() => window.novelDesktop.ai.getSettings())
    assert.equal(reopened.tasks.prose.model, qwen); assert.equal(reopened.tasks.review.model, glm)
    await page.getByTestId('model-scope-ready').click()
    assert.equal(await page.locator('.store-model').count(), 2)
    mark('UI fixture restart: persisted independent assignments and ready-only filtering')
    await app.evaluate(() => { globalThis.catalogUiFixture.failList = true })
    await page.getByTestId('local-model-store').getByRole('alert').waitFor()
    assert.equal(await page.locator('.store-model').count(), 0)
    assert.equal(await page.getByRole('button', { name: '查看全部模型', exact: true }).count(), 0)
    assert.match(await page.getByTestId('model-store-count').innerText(), /目录暂不可用/)
    for (const scope of ['all', 'ready', 'attention']) assert.match(await page.getByTestId('model-scope-' + scope).innerText(), /—/)
    await capture('catalog-counts-unavailable-fixture.png', 1440, 1000, 1)
    await app.evaluate(() => { globalThis.catalogUiFixture.failList = false })
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.store-model').length === 2)
    assert.equal(await page.getByTestId('local-model-store').getByRole('alert').count(), 0)
    assert.match(await page.getByTestId('model-scope-ready').innerText(), /本机可用\s*2/)
    mark('UI fixture: failed listing clears stale ready cards; recovery restores current rows without changing assignments')
    const beforeDuplicate = await app.evaluate(() => ({ calls: structuredClone(globalThis.catalogUiFixture.calls), settings: structuredClone(globalThis.catalogUiFixture.settings) }))
    await app.evaluate((_electron, id) => {
      const state = globalThis.catalogUiFixture
      state.rows.push({ ...state.rows.find(row => row.id === id), state: 'failed', capabilities: [] })
    }, qwen)
    await assert.rejects(page.evaluate(() => window.novelDesktop.localModels.list()))
    await page.getByTestId('local-model-store').getByRole('alert').waitFor()
    assert.equal(await page.locator('.store-model').count(), 0)
    assert.match(await page.getByTestId('model-store-count').innerText(), /目录暂不可用/)
    for (const scope of ['all', 'ready', 'attention']) assert.match(await page.getByTestId('model-scope-' + scope).innerText(), /—/)
    await capture('catalog-duplicate-records-fixture.png', 1440, 1000, 1)
    await app.evaluate(() => { globalThis.catalogUiFixture.rows.pop() })
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.store-model').length === 2)
    assert.equal(await page.getByTestId('local-model-store').getByRole('alert').count(), 0)
    assert.match(await page.getByTestId('model-scope-ready').innerText(), /本机可用\s*2/)
    assert.deepEqual(await app.evaluate(() => ({ calls: globalThis.catalogUiFixture.calls, settings: globalThis.catalogUiFixture.settings })), beforeDuplicate)
    mark('UI fixture: production preload rejects duplicate model IDs, hides stale readiness and recovers after explicit reread without preparation or assignment writes')
    report.fixtureCalls = await app.evaluate(() => globalThis.catalogUiFixture.calls)
    report.passed = true
  } catch (error) {
    report.error = String(error)
    if (app) await capture('failure.png', 1440, 1000, 1, false).catch(() => {})
    throw error
  } finally {
    await writeFile(join(evidence, 'native-result.json'), JSON.stringify(report, null, 2))
    if (app) await app.close()
  }
})
