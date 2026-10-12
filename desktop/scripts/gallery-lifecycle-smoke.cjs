// Run with Electron directly: no Playwright visibility override or recording.
const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')

const output = resolve(process.env.GALLERY_LIFECYCLE_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-gallery-lifecycle-native')
const sleep = ms => new Promise(done => setTimeout(done, ms))
const checks = [], observations = []
let owner, timer
async function fail(error) {
  clearTimeout(timer)
  if (owner && !owner.isDestroyed()) {
    owner.show()
    await fs.writeFile(join(output, 'failure.png'), (await owner.webContents.capturePage()).toPNG()).catch(() => {})
  }
  await fs.writeFile(join(output, 'failure.json'), JSON.stringify({ checks, observations, error: String(error.stack || error) }, null, 2))
  app.exit(1)
}
async function waitFor(check, description) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    const result = await check()
    if (result) return result
    await sleep(30)
  }
  throw new Error(`Timed out: ${description}`)
}
async function run(win, root) {
  owner = win
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg) ?? ''})`)
  win.setContentSize(1440, 900); win.show(); win.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 8 })
  await waitFor(() => evaluate(() => !!window.novelDesktop && !!document.querySelector('[data-testid="app-boot"]')), 'renderer ready')
  await evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  })
  const books = await evaluate(async root => {
    const books = [], api = window.novelDesktop
    for (const title of ['星河档案', '雾海来信', '长夜航行']) {
      const { project } = await api.projects.create({ parentPath: root, name: title, title })
      const chapter = await api.chapters.create()
      await api.chapters.update(chapter.id, { title: '第一章', content: `${title}：窗口变化不改变正文。`, expectedRevision: chapter.revision })
      books.push(project)
    }
    return books
  }, root)
  const bodies = []
  for (const book of books) for (const name of await fs.readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name)
    bodies.push({ path, bytes: await fs.readFile(path) })
  }
  await new Promise(done => { win.webContents.once('did-finish-load', done); win.webContents.reload() })
  await waitFor(() => evaluate(() => {
    const button = document.querySelector('[data-testid="app-boot-enter"]')
    if (!button) return false
    button.click(); return true
  }), 'boot entry')
  await waitFor(() => evaluate(() => !document.querySelector('[data-testid="app-boot"]')), 'boot removed')
  await evaluate(async () => {
    window.lifecycleErrors = []
    window.addEventListener('error', event => window.lifecycleErrors.push(event.message))
    window.addEventListener('unhandledrejection', event => window.lifecycleErrors.push(String(event.reason)))
    document.querySelector('[data-testid="library-all-works"]').click()
    await new Promise(requestAnimationFrame)
    await Promise.allSettled(document.getAnimations().map(animation => animation.finished))
    window.lifecycleCards = [...document.querySelectorAll('.work-card')]
    window.lifecycleEvents = []
    document.addEventListener('visibilitychange', () => window.lifecycleEvents.push({
      kind: document.visibilityState, states: window.lifecycleRuns?.map(animation => animation.playState)
    }))
    window.addEventListener('resize', () => window.lifecycleEvents.push({
      kind: 'resize', states: window.lifecycleRuns?.map(animation => animation.playState)
    }))
  })
  async function start(label) {
    const result = await evaluate(async label => {
      document.querySelector(`[aria-label="${label}"]`).click()
      await new Promise(requestAnimationFrame)
      window.lifecycleRuns = window.lifecycleCards.flatMap(card => card.getAnimations().filter(a => a.constructor.name === 'Animation'))
      return { count: window.lifecycleRuns.length, states: window.lifecycleRuns.map(a => a.playState), visibility: document.visibilityState }
    }, label)
    observations.push({ start: label, ...result })
    assert.equal(result.visibility, 'visible')
    assert.ok(result.count > 0, 'real gallery reflow starts')
    assert.ok(result.states.every(state => state === 'running'))
  }
  const states = () => evaluate(() => window.lifecycleRuns.map(animation => animation.playState))
  const noReplay = () => evaluate(() => window.lifecycleCards.every(card => card.isConnected && !card.getAnimations().some(a => a.constructor.name === 'Animation')))
  const capture = async name => fs.writeFile(join(output, name), (await win.webContents.capturePage()).toPNG())

  await start('列表显示')
  win.hide()
  await waitFor(() => evaluate(() => document.hidden), 'actual hidden document')
  assert.ok((await states()).every(state => state === 'idle'), 'hiding cancels, not merely finishes, the reflow')
  const hiddenEvents = await evaluate(() => window.lifecycleEvents)
  assert.ok(hiddenEvents.some(event => event.kind === 'hidden' && event.states?.length && event.states.every(state => state === 'idle')))
  observations.push({ hiddenEvents, backgroundThrottling: win.webContents.getBackgroundThrottling() })
  win.show(); win.focus()
  await waitFor(() => evaluate(() => !document.hidden), 'visible again')
  assert.equal(await noReplay(), true)
  await capture('01-restored-list.png')
  checks.push('real-hide-cancels-in-flight-motion-and-show-does-not-replay')

  await start('网格显示')
  win.setContentSize(1100, 760)
  await waitFor(async () => (await states()).every(state => state === 'idle'), 'resize cancellation')
  assert.equal(await noReplay(), true)
  checks.push('native-resize-settles-running-grid-reflow')

  win.webContents.debugger.attach('1.3')
  // Native resize may dispatch several events; start the next independent action after it settles.
  await sleep(250)
  await start('列表显示')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await waitFor(async () => (await states()).every(state => state === 'idle'), 'reduced-motion cancellation')
  await evaluate(async () => { document.querySelector('[aria-label="网格显示"]').click(); await new Promise(requestAnimationFrame) })
  assert.equal(await noReplay(), true)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await evaluate(() => new Promise(requestAnimationFrame))
  assert.equal(await noReplay(), true)
  checks.push('live-reduced-motion-cancels-and-restoring-preference-does-not-replay')

  await start('列表显示')
  win.webContents.setZoomFactor(1.25)
  await waitFor(async () => (await states()).every(state => state === 'idle'), 'zoom cancellation')
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 8 })
  await sleep(250)
  await evaluate(() => new Promise(requestAnimationFrame))
  const geometry = await evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    cards: window.lifecycleCards.map(card => ({ connected: card.isConnected, transform: getComputedStyle(card).transform,
      hovered: card.matches(':hover'), animations: card.getAnimations().map(a => ({ type: a.constructor.name, state: a.playState })) })) }))
  observations.push({ geometry })
  assert.ok(geometry.scrollWidth <= geometry.width + 1)
  assert.ok(geometry.cards.every(card => card.connected && card.transform === 'none'))
  await capture('02-compact-zoom.png')
  checks.push('native-zoom-settles-with-stable-card-identity-and-no-horizontal-overflow')

  await start('网格显示')
  await evaluate(async () => { await Promise.allSettled(window.lifecycleRuns.map(animation => animation.finished)) })
  assert.ok((await states()).every(state => state === 'finished'))
  assert.equal(await noReplay(), true)
  await capture('03-later-grid.png')
  checks.push('later-intentional-layout-change-still-completes-normally')
  for (const body of bodies) assert.deepEqual(await fs.readFile(body.path), body.bytes)
  const errors = await evaluate(() => window.lifecycleErrors)
  assert.deepEqual(errors, [])
  checks.push('three-synthetic-manuscripts-unchanged-and-no-renderer-errors')
  await fs.writeFile(join(output, 'verification.json'), JSON.stringify({ checks, observations, errors, manuscripts: bodies.length, root }, null, 2))
  clearTimeout(timer)
  app.exit(0)
}

;(async () => {
  await fs.mkdir(output, { recursive: true })
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'lanjian-gallery-lifecycle-')))
  process.env.LANJIAN_USER_DATA_PATH = join(root, 'profile')
  process.env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'models')
  delete process.env.ELECTRON_RENDERER_URL
  timer = setTimeout(() => void fail(new Error('Native lifecycle timeout')), 90000)
  process.on('unhandledRejection', fail)
  app.once('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => { void run(win, root).catch(fail) })
  })
  await import(pathToFileURL(resolve('out/main/index.js')).href)
})().catch(fail)
