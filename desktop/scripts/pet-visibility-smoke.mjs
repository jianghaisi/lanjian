import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// Plain Electron intentionally avoids Playwright's backgrounding switches.
// The fixture exercises the built application with a fresh synthetic profile.
const output = resolve(process.argv[2] || 'out')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await pause(100)
  }
  throw new Error(`Timed out: ${label}`)
}

if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  require('tsx/cjs')
  const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
  const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
  const { defaultCompanionSettings } = require('../src/contracts/companion/companion-settings.ts')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-pet-visibility-')))
  const profile = join(root, 'profile')
  await new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
    .create({ parentPath: root, title: '桌宠隐藏隔离验证' })
  const settings = defaultCompanionSettings()
  settings.revision = 1
  settings.voice = { ...settings.voice, mute: true, textModel: false, preload: false, proactive: false }
  await writeFile(join(profile, 'companion-settings.json'), JSON.stringify(settings))
  const evidence = resolve('artifacts/ui/pet-video/visibility')
  await mkdir(evidence, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
  env.LANJIAN_USER_DATA_PATH = profile
  env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'models')
  const result = await promisify(execFile)(require('electron'), [fileURLToPath(import.meta.url), output, evidence],
    { env, windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 })
  console.log(result.stdout.trim())
} else {
  // Do not await app.whenReady at ESM top level: Electron emits ready only
  // after its main module finishes evaluating.
  void runNative()
}

async function runNative() {
  const { app, BrowserWindow, screen } = await import('electron')
  const evidence = resolve(process.argv[3])
  const report = { passed: false, output, profile: process.env.LANJIAN_USER_DATA_PATH, checks: [], observations: [], errors: [] }
  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_event, _path, error) => report.errors.push(error.name))
    contents.on('render-process-gone', (_event, details) => report.errors.push(details.reason))
  })
  await import(pathToFileURL(join(output, 'main/index.js')).href)
  const evaluate = (window, source) => window.webContents.executeJavaScript(source)
  async function click(window, testId) {
    await until(() => evaluate(window, `Boolean(document.querySelector('[data-testid="${testId}"]:not(:disabled)'))`), testId, 60000)
    await evaluate(window, `document.querySelector('[data-testid="${testId}"]').click()`)
  }
  async function artwork(window) {
    return evaluate(window, `(() => {
      const art = document.querySelector('[data-testid="pet-artwork"]');
      const video = [...(art?.querySelectorAll('video') || [])].find(v => v.style.visibility === 'visible');
      return { hidden: document.hidden, ready: art?.dataset.ready, motion: art?.dataset.motion,
        clip: art?.dataset.clip, time: video?.currentTime, paused: video?.paused, decoded: video?.getVideoPlaybackQuality().totalVideoFrames };
    })()`)
  }
  async function observeVideo(window) {
    await until(async () => (await artwork(window)).ready === 'true', 'artwork ready')
    await until(async () => (await artwork(window)).paused === false, 'actual video playing')
  }
  try {
    await app.whenReady()
    for (const flag of ['disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding']) {
      assert.equal(app.commandLine.hasSwitch(flag), false, flag)
    }
    const owner = await until(() => BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL())), 'main window')
    // The boot scene intentionally pauses while occluded. Keep only this fresh
    // fixture visible until its real enter control is ready; preserve Chromium's
    // native visibility policy for the hide/show assertions below.
    owner.setAlwaysOnTop(true); owner.show(); owner.focus()
    await click(owner, 'app-boot-enter')
    await until(() => evaluate(owner, '!document.querySelector(\'[data-testid="app-boot"]\')'), 'boot completed')
    owner.setAlwaysOnTop(false)
    await click(owner, 'library-continue-writing')
    await until(() => evaluate(owner, 'Boolean(document.querySelector(\'[data-testid="external-companion"]\'))'), 'writing workspace')
    assert.equal(BrowserWindow.getAllWindows().some(w => /pet\.html/.test(w.webContents.getURL())), false)
    await click(owner, 'external-companion')
    const pet = await until(() => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())), 'pet window')
    await until(() => pet.isVisible(), 'pet shown')
    await observeVideo(pet)
    const before = await artwork(pet)
    await pause(400)
    assert.notEqual((await artwork(pet)).time, before.time, 'visible pet advances video')
    report.checks.push('standard build opens a default-off pet only after explicit choice; real video advances')

    for (const cause of ['native-hide', 'user-hide']) {
      if (cause === 'native-hide') pet.hide()
      else await evaluate(owner, 'window.desktopPet.command({ type: "hide" })')
      await until(async () => !pet.isVisible() && (await artwork(pet)).hidden, cause)
      await pause(250)
      const start = await artwork(pet)
      await pause(600)
      const end = await artwork(pet)
      assert.equal(end.time, start.time, `${cause} stops video time`)
      assert.equal(end.decoded, start.decoded, `${cause} stops video decoding`)
      if (end.ready === 'true') assert.equal(end.paused, true)
      assert.ok(!end.ready || end.motion === 'paused', `${cause} pauses or unmounts artwork`)
      report.observations.push({ cause, start, end })
      if (cause === 'native-hide') pet.showInactive()
      else await evaluate(owner, 'window.desktopPet.command({ type: "enable", enabled: true })')
      await until(async () => pet.isVisible() && !(await artwork(pet)).hidden, `${cause} restored`)
      await observeVideo(pet)
      const resumed = await artwork(pet)
      await pause(400)
      assert.notEqual((await artwork(pet)).time, resumed.time, `${cause} resumes video`)
      report.checks.push(`${cause}: actual hidden document, video time and decoding stop, video resumes`)
    }
    // Minimizing the writing window must leave the independent pet available.
    owner.minimize()
    await pause(400)
    assert.ok(pet.isVisible())
    assert.equal((await artwork(pet)).hidden, false)
    const independent = await artwork(pet)
    await pause(400)
    assert.notEqual((await artwork(pet)).time, independent.time)
    report.checks.push('minimizing the writing window preserves the visible, animated desktop pet')
    owner.restore()
    assert.deepEqual(report.errors, [])
    report.displays = screen.getAllDisplays().map(({ workArea, scaleFactor }) => ({ workArea, scaleFactor }))
    report.passed = true
  } catch (error) {
    report.errors.push(error.message)
    report.windows = await Promise.all(BrowserWindow.getAllWindows().map(async window => ({
      visible: window.isVisible(), minimized: window.isMinimized(), url: window.webContents.getURL(),
      page: await evaluate(window, '({ hidden: document.hidden, text: document.body?.innerText.slice(0, 1000) })').catch(() => null)
    })))
  } finally {
    await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    // This process owns only the fresh fixture profile, including on failure.
    app.exit(report.passed ? 0 : 1)
  }
}
