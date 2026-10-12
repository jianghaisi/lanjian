// All writes target fresh temporary books/profile; no model calls or author files.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { verifyLandmarkBindings } from './world-map-landmark-smoke.mjs'
import { withChronicleBuildSnapshot } from './chronicle-build-snapshot.mjs'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const landmarksOnly = process.argv.includes('--landmarks-only')
const args = process.argv.slice(2).filter(arg => arg !== '--landmarks-only')
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--bitmap'), 'Only optional --bitmap <PNG> is supported')
const bitmap = args.length ? await readFile(resolve(args[1])) : null
if (bitmap) assert.equal(bitmap.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Fixture must be a PNG')
const userData = await mkdtemp(join(tmpdir(), 'lanjian-chronicle-profile-'))
const projectParent = await mkdtemp(join(tmpdir(), 'lanjian-chronicle-book-'))
const output = resolve(`../.trellis/tasks/09-09-beta-ai-world-map/evidence/landmark-binding/${landmarksOnly ? 'probe' : 'native'}`)
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete env.ELECTRON_RUN_AS_NODE
// A concurrent dev/build session may replace out/ while this isolated app is open.
// Snapshot generated artifacts under node_modules so external runtime imports still resolve.
const buildCache = resolve('node_modules/.cache')
await withChronicleBuildSnapshot(resolve('out'), buildCache, async buildSnapshot => {
const app = await _electron.launch({ executablePath: require('electron'), args: [join(buildSnapshot, 'out/main/index.js')], env, timeout: 30000 })
try {
const page = await app.firstWindow()
const mainWindow = await app.browserWindow(page)
const mainWindowId = await mainWindow.evaluate(window => window.id)
page.setDefaultTimeout(12000)
const errors = [], checks = [], interactions = []
const pointerTrace = []
await page.exposeFunction('__recordMapPointer', entry => pointerTrace.push(entry))
await page.addInitScript(() => {
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
    if ((type === 'pointermove' && !event.buttons) || !event.target.closest?.('.map-canvas')) return
    window.__recordMapPointer({ type, x: event.clientX, y: event.clientY, tag: event.target.tagName, class: event.target.getAttribute('class'), testid: event.target.closest('[data-testid]')?.getAttribute('data-testid') })
  }, true)
})
page.on('pageerror', error => errors.push(error.message))
// The global rail reveals clipped labels; click its visible icon, not the off-rail label box.
const click = selector => selector.startsWith('[data-nav-parent=') ? page.locator(selector).locator('svg').first().click() : page.locator(selector).first().click()
const capture = async name => {
  await page.mouse.move(500, 20)
  await page.waitForTimeout(300) // Let the rail's hover reveal settle before capturing its resting state.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => !document.querySelector('[data-testid="world-map-view"]') || document.querySelector('[data-testid="world-map-view"]').getAttribute('aria-busy') === 'false')
  if (bitmap && await page.locator('[data-testid="map-canvas"]').count()) {
    // Background reads are deliberately lazy and independent of the map-view busy flag.
    await page.waitForFunction(() => { const image = document.querySelector('.map-background'); return image?.complete && image.naturalWidth > 0 })
    await page.locator('.map-background').evaluate(image => image.decode())
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(150)
  // Native capture is zoom-aware; Playwright's cached device scale can clip Electron's 125% view.
  const png = await app.evaluate(async ({ BrowserWindow }, id) => { const window = BrowserWindow.fromId(id); return (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG().toString('base64') }, mainWindowId)
  await writeFile(join(output, `${name}.png`), Buffer.from(png, 'base64'))
  // Independent compositor capture: some Windows/DPI combinations return a white native bitmap.
  await page.screenshot({ path: join(output, `${name}-renderer.png`), fullPage: true })
}
async function resize(width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.fromId(size.id); if (window.isMaximized()) window.unmaximize(); window.setContentSize(size.width, size.height); window.webContents.setZoomFactor(size.zoom) }, { width, height, zoom, id: mainWindowId })
}
async function layout(label) {
  const result = await page.evaluate(() => {
    const measure = selector => { const el = document.querySelector(selector), r = el?.getBoundingClientRect(); return r ? { selector, width: r.width, height: r.height, right: r.right, bottom: r.bottom, overflow: el.scrollWidth - el.clientWidth, overflowX: getComputedStyle(el).overflowX } : { selector, missing: true } }
    return { width: innerWidth, height: innerHeight, items: ['.workbench', '.timeline-workbench', ...(document.querySelector('.chronicle-events') ? ['.chronicle-events', '.chronicle-list-pane', '.chronicle-dossier'] : ['.world-map', '.map-canvas'])].map(measure) }
  })
  checks.push({ label, ...result })
  const sidebarWidth = await page.locator('.chronicle-sidebar').evaluate(el => el.getBoundingClientRect().width)
  assert.ok(sidebarWidth <= 178 && sidebarWidth >= 152, `sidebar must remain narrow: ${sidebarWidth}`)
  const canvas = result.items.find(item => item.selector === '.map-canvas'), world = result.items.find(item => item.selector === '.world-map')
  if (canvas && world) assert.ok(canvas.height / world.height >= .8, `${label}: canvas is only ${canvas.height/world.height} of workspace`)
  // Panning/focusing intentionally moves image pixels outside the clipping canvas, never the workspace.
  for (const item of result.items) assert.ok(!item.missing && item.width > 80 && item.height > 30 && item.right <= result.width + 2 && item.bottom <= result.height + 2 && (item.overflow <= 2 || (item.selector === '.map-canvas' && item.overflowX === 'hidden')), `${label}: ${JSON.stringify(item)}`)
}
try {
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => { localStorage.setItem('lanjian-opening-enabled', 'false'); localStorage.setItem('lanjian-theme', 'qingzhou'); sessionStorage.setItem('lanjian-opening-seen', 'true') })
  await page.reload()
  await resize(1440, 900)
  await click('[data-testid="create-work-item"]')
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('纪事设计验收（隔离样例）')
  await page.locator('input[placeholder="选择本地文件夹"]').evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }, projectParent)
  await click('.create-book-modal footer .control-button.primary')
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  await click('[data-nav-parent="chronicle"]')
  await page.locator('.chronicle-events').waitFor()
  assert.equal(await page.locator('.chronicle-sidebar').count(), 1)
  assert.equal(await page.locator('.chronicle-sidebar nav[aria-label="纪事主视图"] button').count(), 2)
  await capture('01-empty')
  const records = [
    ['旧码头的约见', '第一日 · 傍晚', '沈砚、林照', '雾港', '沈砚赴约来到旧码头，发现约定的渡船没有靠岸。', '一封迟到的信，将他的目光引向北境。'],
    ['渡口来信', '第二日 · 清晨', '林照', '晦河渡口', '林照从渡船上取回封存的信件。', '信中印记与旧塔遗址有关。'],
    ['北境的守望', '第三日 · 入夜', '沈砚', '北境哨站', '抵达哨站后，他得知通往旧塔的山路已经封闭。', '需要重新寻找进入旧塔的道路。']
  ]
  let savedCount = 0
  for (const [title, time, characters, location, event, result] of records) {
    await click('[data-testid="add-timeline-event"]')
    for (const [label, value] of [['事件标题', title], ['时间或阶段', time], ['人物', characters], ['地点', location], ['事件内容', event], ['结果与后续影响', result]]) await page.getByRole('textbox', { name: label, exact: true }).fill(value)
    await page.locator('.chronicle-dossier-actions').getByRole('button', { name: '保存时间线' }).click()
    savedCount += 1
    await page.waitForFunction(async expected => (await window.novelDesktop.workspace.getTimeline()).events.length === expected, savedCount)
    await page.waitForFunction(() => !document.querySelector('.chronicle-dossier-actions button')?.disabled)
  }
  const saved = await page.evaluate(() => window.novelDesktop.workspace.getTimeline())
  assert.equal(saved.events.length, 3)
  assert.equal(saved.events[0].location, '雾港')
  if (bitmap) {
    // The bitmap is a visual fixture only; synthetic events do not assert novel geography.
    const current = await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())
    const bookRoot = await realpath(current.workItemId), fixtureRoot = await realpath(projectParent)
    const inside = relative(fixtureRoot, bookRoot)
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Fixture writes must stay in the fresh temporary book')
    const assetId = createHash('sha256').update(bitmap).digest('hex')
    const assetFolder = join(bookRoot, '.webnovel/assets/world-map')
    await mkdir(assetFolder, { recursive: true })
    const assetInside = relative(bookRoot, await realpath(assetFolder))
    assert.ok(assetInside && !assetInside.startsWith('..') && !isAbsolute(assetInside))
    await writeFile(join(assetFolder, `${assetId}.png`), bitmap, { flag: 'wx' })
    await page.evaluate(input => window.novelDesktop.workspace.saveWorldMap(input), {
      workItemId: current.workItemId, expectedRevision: current.revision,
      document: { version: 2, markers: [], background: { assetId, format: 'png', width: bitmap.readUInt32BE(16), height: bitmap.readUInt32BE(20), stylePreset: 'paper-atlas', model: 'isolated bitmap fixture', generatedAt: new Date().toISOString(), sourceFingerprint: assetId } }
    })
  }
  if (landmarksOnly) {
    await verifyLandmarkBindings({ page, click, capture, interactions })
    await writeFile(join(output, 'result.json'), JSON.stringify({ pass: true, interactions, errors }, null, 2))
    console.log(JSON.stringify({ pass: true, output, landmarksOnly }))
  } else {
  await page.locator('.chronicle-record').first().click()
  assert.match(await page.locator('.chronicle-dossier-title').textContent(), /旧码头的约见/)
  await layout('events-1440'); await capture('02-events-1440')
  await page.getByRole('searchbox', { name: '搜索纪事事件' }).fill('渡口')
  assert.equal(await page.locator('.chronicle-record').count(), 1)
  await page.getByRole('searchbox', { name: '搜索纪事事件' }).fill('')
  await page.getByRole('button', { name: '在地图中查看' }).click()
  await page.locator('[data-testid="map-canvas"]').waitFor()
  assert.match(await page.locator('.map-inspector h3').textContent(), /雾港/)
  assert.equal(await page.getByRole('button', { name: '3D BETA' }).isDisabled(), true)
  assert.equal(await page.locator('.map-generation-settings').evaluate(el => el.matches(':popover-open')), false)
  if (bitmap) {
    await page.waitForFunction(() => document.querySelector('.map-background')?.naturalWidth > 0)
    await page.locator('.map-onboarding').waitFor()
    await capture('02-map-ready-unbound')
  }
  assert.equal(await page.locator('[data-testid="map-browse-mode"]').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[data-testid="map-x"]').count(), 0)
  await click('[data-testid="map-place"]')
  await page.locator('.map-placement-hint').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.map-placement-hint').count(), 0)
  assert.equal(await page.locator('[data-testid="map-save"]').count(), 0, 'cancelling placement cannot create a dirty draft')
  await click('[data-testid="map-edit-mode"]')
  await click('[data-testid="map-place"]')
  await page.locator('.map-inspector').waitFor({ state: 'hidden' })
  const placementCanvas = await page.locator('[data-testid="map-canvas"]').boundingBox(), placementPlot = await page.locator('.map-plot').boundingBox()
  const outside = placementPlot.x > placementCanvas.x + 4 ? { x: placementCanvas.x + 2, y: placementCanvas.y + placementCanvas.height / 2 } : { x: placementCanvas.x + placementCanvas.width / 2, y: placementCanvas.y + 2 }
  await page.mouse.click(outside.x, outside.y)
  assert.equal(await page.locator('[data-testid="map-pin"]').count(), 0)
  await page.locator('.map-placement-error').waitFor()
  await page.mouse.click(placementPlot.x + placementPlot.width / 2, placementPlot.y + placementPlot.height / 2)
  await page.locator('[data-testid="map-pin"]').waitFor()
  await click('[data-testid="map-undo"]')
  assert.equal(await page.locator('[data-testid="map-pin"]').count(), 0, 'one click placement must undo cleanly')
  interactions.push('off-image placement rejected', 'native placement/undo')
  await page.locator('[data-testid="map-x"]').fill('45'); await page.locator('[data-testid="map-y"]').fill('60')
  await click('[data-testid="map-apply-coordinates"]'); await click('[data-testid="map-save"]')
  await page.waitForFunction(() => document.querySelector('.map-save-status')?.textContent?.includes('地点定位已保存'))
  assert.equal((await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())).document.markers[0].x, 45)
  await click('[data-testid="map-browse-mode"]')
  const pinCoordinates = () => page.locator('[data-testid="map-pin"]').getAttribute('style')
  const savedPinCoordinates = await pinCoordinates()
  const dragPin = async (dx, dy) => {
    const pin = await page.locator('[data-testid="map-pin"]').boundingBox()
    // SVG is the actual anchor; a visible label must not skew the gesture start.
    const anchor = await page.locator('[data-testid="map-pin"] > svg').boundingBox() ?? pin
    pointerTrace.push({ anchor, hit: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 300), { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }) })
    await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2); await page.mouse.down()
    await page.mouse.move(anchor.x + anchor.width / 2 + dx, anchor.y + anchor.height / 2 + dy, { steps: 6 }); await page.mouse.up()
  }
  await dragPin(20, -10)
  await page.locator('[data-testid="map-pin"]').focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await pinCoordinates(), savedPinCoordinates, 'browse pointer and arrow cannot change a marker')
  assert.equal(await page.locator('[data-testid="map-save"]').count(), 0)
  await click('[data-testid="map-labels"]')
  assert.equal(await page.locator('[data-testid="map-pin"] > span').count(), 0)
  await click('[data-testid="map-labels"]')
  assert.equal(await page.locator('[data-testid="map-pin"] > span').count(), 1)
  await page.locator('[data-testid="map-canvas"]').focus()
  const keyboardPanBefore = await page.locator('.map-plot').getAttribute('style')
  await page.keyboard.press('ArrowRight')
  assert.notEqual(await page.locator('.map-plot').getAttribute('style'), keyboardPanBefore)
  await page.keyboard.press('+'); assert.match(await page.locator('.map-view-controls output').textContent(), /120%/)
  await page.keyboard.press('0'); assert.match(await page.locator('.map-view-controls output').textContent(), /100%/)
  interactions.push('placement cancellation', 'browse protects coordinates', 'transient labels', 'keyboard pan/zoom/fit')
  await page.getByRole('button', { name: '放大地图' }).click()
  assert.match(await page.locator('.map-view-controls output').textContent(), /120%/)
  const canvas = await page.locator('[data-testid="map-canvas"]').boundingBox()
  const transformBefore = await page.locator('.map-plot').getAttribute('style')
  await page.mouse.move(canvas.x + 45, canvas.y + 45); await page.mouse.down()
  await page.mouse.move(canvas.x + 75, canvas.y + 65, { steps: 5 }); await page.mouse.up()
  assert.notEqual(await page.locator('.map-plot').getAttribute('style'), transformBefore)
  assert.equal((await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())).document.markers[0].x, 45, 'panning cannot write coordinates')
  await click('[data-testid="map-edit-mode"]')
  await dragPin(20, -10)
  assert.notEqual(await pinCoordinates(), savedPinCoordinates)
  await click('[data-testid="map-undo"]')
  assert.equal(await pinCoordinates(), savedPinCoordinates, 'one multi-frame drag is exactly one undo step')
  assert.equal(await page.locator('[data-testid="map-undo"]').isDisabled(), true)
  await dragPin(20, -10)
  await page.locator('[data-testid="map-canvas"]').focus(); await page.keyboard.press('Control+z')
  assert.equal(await pinCoordinates(), savedPinCoordinates)
  const cancelAnchor = await page.locator('[data-testid="map-pin"] > svg').boundingBox()
  await page.mouse.move(cancelAnchor.x + cancelAnchor.width / 2, cancelAnchor.y + cancelAnchor.height / 2); await page.mouse.down()
  await page.mouse.move(cancelAnchor.x + cancelAnchor.width / 2 + 25, cancelAnchor.y + cancelAnchor.height / 2 + 15, { steps: 6 })
  assert.notEqual(await pinCoordinates(), savedPinCoordinates)
  await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await pinCoordinates(), savedPinCoordinates, 'Escape during drag rolls back the active gesture')
  assert.equal(await page.locator('[data-testid="map-browse-mode"]').getAttribute('aria-pressed'), 'true')
  await click('[data-testid="map-edit-mode"]')
  assert.equal(await page.locator('[data-testid="map-undo"]').isDisabled(), true)
  interactions.push('Escape rolls back active pointer drag')
  await dragPin(20, -10)
  await page.locator('[data-testid="map-pin"]').focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('[data-testid="map-save"]').isEnabled(), true)
  await click('[data-testid="map-save"]')
  await page.waitForFunction(() => document.querySelector('.map-save-status')?.textContent?.includes('地点定位已保存'))
  assert.notEqual((await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())).document.markers[0].x, 45)
  await click('[data-testid="map-browse-mode"]')
  await click('[data-testid="map-focus-location"]')
  const centered = await page.evaluate(() => {
    const viewport = document.querySelector('.map-canvas').getBoundingClientRect(), bounds = document.querySelector('.map-plot').getBoundingClientRect(), pin = document.querySelector('[data-testid="map-pin"]')
    return { dx: bounds.left + bounds.width * parseFloat(pin.style.left) / 100 - (viewport.left + viewport.width / 2), dy: bounds.top + bounds.height * parseFloat(pin.style.top) / 100 - (viewport.top + viewport.height / 2) }
  })
  assert.ok(Math.abs(centered.dx) < 2 && Math.abs(centered.dy) < 2, `focus must center the actual transformed coordinate: ${JSON.stringify(centered)}`)
  interactions.push('pointer pan does not save', 'single-action drag undo', 'Ctrl+Z undo', 'annotation nudge/save', 'transformed coordinate centering')
  await click('[data-testid="map-event"]'); await click('[data-testid="map-open-event"]')
  assert.match(await page.locator('.chronicle-dossier-title').textContent(), /旧码头的约见/)
  await click('[data-testid="timeline-mode-map"]')
  await click('[data-testid="map-generation-settings-trigger"]')
  await page.locator('.map-generation-settings:popover-open').waitFor()
  assert.equal(await page.getByRole('radio').count(), 0)
  assert.match(await page.locator('.generator-intro').textContent(), /纸雕沙盘/)
  await capture('03-generator-popover')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.map-generation-settings').evaluate(el => el.matches(':popover-open')), false)
  await page.getByRole('button', { name: '缩小地图' }).click()
  assert.match(await page.locator('.map-view-controls output').textContent(), /83%/)
  await page.getByRole('button', { name: '适应画面', exact: true }).click()
  assert.match(await page.locator('.map-view-controls output').textContent(), /100%/)
  await layout('map-1440'); await capture('03-map-1440')
  await click('[data-testid="timeline-mode-foreshadows"]'); await page.locator('[data-testid="timeline-foreshadows-view"]').waitFor()
  await click('[data-testid="timeline-mode-characters"]'); await page.locator('.chronicle-auxiliary-heading').waitFor()
  await click('[data-nav-parent="planning"]'); await click('[data-nav-leaf="volume-lines"]')
  await page.locator('[data-nav-parent="planning"][aria-current="step"]').waitFor()
  assert.equal(await page.locator('[data-nav-parent="planning"]').getAttribute('aria-current'), 'step')
  // Append a dense, isolated fixture through the actual save API. No author project is involved.
  const denseEvents = [...saved.events, ...Array.from({ length: 54 }, (_, i) => ({ id: `dense-${i}`, title: `档案事件 ${i+1}`, time: `第 ${i+4} 日`, characters: '沈砚、林照', location: `样例地点 ${i % 52 + 1}`, event: '核对这一地点中已经发生的事。', result: '留下需要在后续核对的记录。' }))]
  await page.evaluate(events => window.novelDesktop.workspace.saveTimeline(events), denseEvents)
  await click('[data-nav-parent="chronicle"]')
  // Main IPC is deliberately held pending; real pointer navigation must not await it.
  await click('[data-testid="timeline-mode-events"]')
  await app.evaluate(({ ipcMain }) => {
    const channel = 'workspace:get-world-map', original = ipcMain._invokeHandlers.get(channel)
    globalThis.__mapOriginal = original; globalThis.__mapReadCount = 0
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (...args) => { globalThis.__mapReadCount++; return new Promise(resolve => { globalThis.__releaseMapRead = async () => resolve(await original(...args)) }) })
  })
  await click('[data-testid="timeline-mode-map"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="world-map-view"]')?.getAttribute('aria-busy') === 'true')
  const leaveStart = Date.now()
  await click('[data-testid="timeline-mode-events"]')
  await page.locator('.chronicle-events').waitFor({ timeout: 2000 })
  const leaveMs = Date.now() - leaveStart
  assert.equal(await app.evaluate(() => globalThis.__mapReadCount), 1, 'switching away must not issue a second old-page read')
  await app.evaluate(async ({ ipcMain }) => { ipcMain.removeHandler('workspace:get-world-map'); ipcMain.handle('workspace:get-world-map', globalThis.__mapOriginal); await globalThis.__releaseMapRead() })
  assert.equal(await page.locator('[data-testid="world-map-view"]').count(), 0, 'late map response cannot switch back')
  for (let i = 0; i < 4; i++) {
    await click('[data-testid="timeline-mode-map"]')
    await page.waitForFunction(() => document.querySelector('[data-testid="world-map-view"]')?.getAttribute('aria-busy') === 'false')
    await click('[data-testid="timeline-mode-events"]')
    await page.locator('.chronicle-events').waitFor()
  }
  await click('[data-testid="timeline-mode-map"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="world-map-view"]')?.getAttribute('aria-busy') === 'false')
  const denseView = await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())
  assert.equal(denseView.events.length, 57); assert.equal(new Set(denseView.events.map(event => event.location)).size, 55)
  if (await page.getByRole('button', { name: '地点档案', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '地点档案', exact: true }).click()
  assert.equal(await page.locator('[data-testid="map-location"]').count(), 55)
  await capture('06-dense-locations')
  await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await click('[data-testid="map-generation-settings-trigger"]')
  assert.equal(await page.locator('.map-generation-settings').evaluate(el => getComputedStyle(el).animationName), 'none')
  await page.keyboard.press('Escape')
  await click('[data-testid="timeline-mode-events"]')
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.workspace.getTimeline())).events, denseEvents)

  if (bitmap) await verifyLandmarkBindings({ page, click, capture, interactions })

  for (const [width, height, zoom, theme, name] of [[1440,900,1,'moye','dark'], [1100,700,1,'qingzhou','compact'], [1440,900,1.25,'qingzhou','zoom125']]) {
    await resize(width, height, zoom)
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
    await click('[data-nav-parent="chronicle"]'); await page.locator('.chronicle-record').first().click()
    await layout(`events-${name}`); await capture(`04-events-${name}`)
    await click('[data-testid="timeline-mode-map"]'); await page.locator('[data-testid="map-canvas"]').waitFor()
    await layout(`map-${name}`); await capture(`05-map-${name}`)
  }

  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ pass: true, checks, interactions, errors, bitmapFixture: Boolean(bitmap), dense: { events: 57, locations: 55, unresolvedReadLeaveMs: leaveMs, repeatedMapVisits: 4 }, isolation: { userData, projectParent, buildSnapshot }, remoteCalls: 0 }, null, 2))
  console.log(JSON.stringify({ pass: true, output, checks: checks.length }))
  }
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, `failure-${Date.now()}.json`), JSON.stringify({ error: String(error), errors, checks, pointerTrace }, null, 2))
  throw error
}
} finally { await app.close() }
})
