// Direct Electron: Playwright's focus emulation hides actual visibility transitions.
const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const output = resolve('../.trellis/tasks/10-02-v3-interaction-sound-effects/research', `visibility-${Date.now()}`)
const checks = [], samples = []
let owner, timer, fingerprint
const sleep = ms => new Promise(done => setTimeout(done, ms))
async function waitFor(check, label, timeout = 20000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { const result = await check(); if (result) return result; await sleep(30) }
  throw new Error(`Timed out: ${label}`)
}
async function finish(error) {
  clearTimeout(timer)
  if (error && owner && !owner.isDestroyed()) samples.push(await owner.webContents.executeJavaScript('({hidden: document.hidden, time: document.querySelector("[data-cinematic-time]")?.getAttribute("data-cinematic-time"), sources: window.soundVisibilitySources})').catch(() => null))
  if (error && owner && !owner.isDestroyed()) { owner.show(); await fs.writeFile(join(output, 'failure.png'), (await owner.webContents.capturePage()).toPNG()).catch(() => {}) }
  await fs.writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, fingerprint, error: error ? String(error.stack || error) : null }, null, 2))
  console.log(JSON.stringify({ checks, output, error: error ? String(error) : null }))
  app.exit(error ? 1 : 0)
}
async function run(win) {
  owner = win
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg) ?? ''})`)
  win.setContentSize(1440, 900); win.show(); win.focus()
  await waitFor(() => evaluate(() => !!window.novelDesktop), 'bridge')
  await evaluate(async () => {
    await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: false, preload: false, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'brief', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-sound-v1', JSON.stringify({ enabled: true, volume: .6, boot: true, loading: true, interaction: true, hover: false, waiting: true }))
  })
  await new Promise(done => { win.webContents.once('did-finish-load', done); win.webContents.reload() })
  await waitFor(() => evaluate(() => { const button = document.querySelector('[data-testid="app-boot-enter"]'); if (!button) return false; button.click(); return true }), 'brief entry')
  await waitFor(() => evaluate(() => !document.querySelector('[data-testid="app-boot"]')), 'library')
  await evaluate(() => {
    window.soundVisibilityEvents = []; window.soundVisibilitySources = []
    document.addEventListener('visibilitychange', () => window.soundVisibilityEvents.push(document.visibilityState))
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.start = function(...args) {
      const record = this.__visibilitySound = { loop: this.loop, duration: this.buffer?.duration, offset: args[1] ?? 0, stopped: false, ended: false }
      window.soundVisibilitySources.push(record)
      this.addEventListener('ended', () => { record.ended = true }, { once: true })
      return start.apply(this, args)
    }
    AudioBufferSourceNode.prototype.stop = function(...args) { if (this.__visibilitySound) this.__visibilitySound.stopped = true; return stop.apply(this, args) }
    document.querySelector('button[aria-label="设置"],button[title="设置"]').click()
    document.querySelector('[data-testid="library-settings-opening"]').click()
  })
  await waitFor(() => evaluate(() => { const button = document.querySelector('[data-testid="loader-preview-work"]'); if (!button?.getClientRects().length) return false; button.click(); return true }), 'loading preview')
  await waitFor(() => evaluate(() => window.soundVisibilitySources.some(s => s.loop && !s.ended)), 'real wait loop')
  win.hide()
  await waitFor(() => evaluate(() => document.hidden), 'actual hidden document')
  await waitFor(() => evaluate(() => window.soundVisibilitySources.every(s => s.ended)), 'hidden ends sources')
  const hidden = await evaluate(() => ({ visibility: document.visibilityState, events: window.soundVisibilityEvents, sources: window.soundVisibilitySources }))
  assert.ok(hidden.sources.some(s => s.loop && s.stopped)); assert.ok(hidden.events.includes('hidden'))
  samples.push(hidden); checks.push('native-hidden-event-stops-real-loop-and-all-sources')
  win.show(); win.focus()
  await waitFor(() => evaluate(() => !document.hidden && window.soundVisibilitySources.filter(s => s.loop).length === 2), 'one current loop resumes')
  assert.equal(await evaluate(() => window.soundVisibilitySources.filter(s => s.loop && !s.ended).length), 1)
  assert.equal(await evaluate(() => window.soundVisibilitySources.filter(s => !s.loop).length), hidden.sources.filter(s => !s.loop).length)
  checks.push('visible-resumes-only-current-opt-in-loop-with-no-one-shot-backlog')
  await evaluate(() => document.querySelector('[data-testid="cancel-workspace-loading"]').click())
  await waitFor(() => evaluate(() => window.soundVisibilitySources.every(s => s.ended)), 'preview cleanup')
  samples.push(await evaluate(() => ({ visibility: document.visibilityState, sources: window.soundVisibilitySources })))
  checks.push('preview-unmount-stops-resumed-loop')
  // Keep this isolated test surface unoccluded while its real rAF reaches the
  // transition. hide() below still drives actual native visibility; no emulation.
  win.setAlwaysOnTop(true); win.show(); win.focus()
  await evaluate(() => {
    window.soundVisibilitySources = []; window.soundVisibilityEvents = []
    document.querySelector('[data-testid="boot-style-cinematic"]').click()
    document.querySelector('[data-testid="loader-preview-boot"]').click()
  })
  await waitFor(() => evaluate(() => Number(document.querySelector('[data-cinematic-time]')?.getAttribute('data-cinematic-time')) > 4), 'prelude midpoint')
  win.hide()
  await waitFor(() => evaluate(() => document.hidden && window.soundVisibilitySources.every(s => s.ended)), 'fixed prelude stops on hide')
  win.show(); win.focus()
  await waitFor(() => evaluate(() => window.soundVisibilitySources.some(s => s.duration > 12 && !s.ended && s.offset >= 4)), 'prelude resumes at visible position')
  assert.equal(await evaluate(() => window.soundVisibilitySources.filter(s => Math.abs(s.duration-2.64)<.02).length), 1, 'brand never replays on resume')
  checks.push('fixed-prelude-resumes-from-current-offset-without-brand-replay')
  await waitFor(() => evaluate(() => window.soundVisibilitySources.filter(s => s.duration >= 8 && !s.ended).length === 2 && window.soundVisibilitySources.some(s => s.loop && !s.ended)), 'prelude-to-wave overlap', 60000)
  win.hide()
  await waitFor(() => evaluate(() => document.hidden && window.soundVisibilitySources.every(s => s.ended)), 'both boot beds stop on real hide')
  const bootHidden = await evaluate(() => ({ visibility: document.visibilityState, events: window.soundVisibilityEvents, sources: window.soundVisibilitySources }))
  assert.ok(bootHidden.sources.filter(s => s.duration >= 8).every(s => s.stopped))
  samples.push(bootHidden); checks.push('hide-during-score-crossfade-stops-both-fixed-and-looping-movements')
  win.show(); win.focus()
  await waitFor(() => evaluate(() => !document.hidden && window.soundVisibilitySources.filter(s => s.loop && !s.ended).length === 1), 'current boot ambience resumes')
  assert.equal(await evaluate(() => window.soundVisibilitySources.filter(s => s.loop).length), 2)
  assert.equal(await evaluate(() => window.soundVisibilitySources.filter(s => !s.loop).length), bootHidden.sources.filter(s => !s.loop).length)
  await evaluate(() => document.querySelector('.close-preview').click())
  await waitFor(() => evaluate(() => window.soundVisibilitySources.every(s => s.ended)), 'boot preview cleanup')
  samples.push(await evaluate(() => ({ visibility: document.visibilityState, sources: window.soundVisibilitySources })))
  checks.push('boot-restore-keeps-current-wave-without-replaying-prelude-or-brand-and-close-cleans-up')
  await finish()
}
;(async () => {
  await fs.mkdir(output, { recursive: true })
  fingerprint = createHash('sha256').update(await fs.readFile(resolve(process.argv[2] || 'out-interaction-sound', 'renderer/index.html'))).digest('hex')
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'lanjian-sound-visibility-')))
  process.env.LANJIAN_USER_DATA_PATH = join(root, 'profile'); process.env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'models')
  delete process.env.ELECTRON_RENDERER_URL
  timer = setTimeout(() => void finish(new Error('Native visibility timeout')), 90000)
  process.on('unhandledRejection', finish)
  app.once('browser-window-created', (_, win) => { win.webContents.once('did-finish-load', () => { void run(win).catch(finish) }) })
  await import(pathToFileURL(resolve(process.argv[2] || 'out-interaction-sound', 'main/index.js')).href)
})().catch(finish)
