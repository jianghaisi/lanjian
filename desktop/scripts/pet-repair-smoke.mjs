import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { checkPetRepairs } from './pet-repair-checks.mjs'
import { checkPetFrames } from './pet-frame-checks.mjs'
import { checkPetBehaviorChat } from './pet-behavior-chat-checks.mjs'
import { checkPetSidePanels } from './pet-side-panel-checks.mjs'
import { checkPetRecovery } from './pet-recovery-checks.mjs'
import { checkPetRadial } from './pet-radial-checks.mjs'
import { checkPetCareFeedback } from './pet-care-feedback-checks.mjs'
import { checkPetReminders } from './pet-reminder-checks.mjs'
import { checkPetFocus } from './pet-focus-checks.mjs'
import { checkPetCareGuidance } from './pet-care-guidance-checks.mjs'
const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { defaultCompanionSettings } = require('../src/contracts/companion/companion-settings.ts')
const run = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const baseline = process.argv.includes('--baseline')
const artwork = process.argv.includes('--artwork')
const radial = process.argv.includes('--radial'), careFeedback = process.argv.includes('--care-feedback'), reminders = process.argv.includes('--reminders'), focus = process.argv.includes('--focus'), guidance = process.argv.includes('--care-guidance'), recovery = process.argv.includes('--recovery') || radial || careFeedback || reminders || focus || guidance || artwork
const build = resolve(process.argv.find(value => value.startsWith('--build='))?.slice(8) || (process.argv.includes('--standard') ? 'out' : artwork ? 'out-pet-artwork-check' : guidance ? 'out-pet-guidance-check' : focus ? 'out-pet-focus-check' : reminders ? 'out-pet-reminder-check' : radial || careFeedback ? 'out-pet-radial-check' : recovery ? 'out-pet-recovery-check' : process.argv.includes('--side-panels') ? 'out-pet-side-check' : 'out-pet-check'))
const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-pet-repair-')), profile = join(root, 'profile')
const output = resolve('artifacts/ui/pet-repair', artwork ? 'artwork' : guidance ? 'care-guidance' : focus ? 'focus' : reminders ? 'reminders' : careFeedback ? 'care-feedback' : radial ? 'radial' : recovery ? 'recovery' : process.argv.includes('--side-panels') ? 'side-panels' : baseline ? 'before' : 'after')
await mkdir(output, { recursive: true })
await new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })).create({ parentPath: root, title: '桌宠体验隔离验证' })
const settings = defaultCompanionSettings()
settings.revision = 1; settings.voice = { ...settings.voice, mute: true, textModel: false, preload: false, proactive: false }
await writeFile(join(profile, 'companion-settings.json'), JSON.stringify(settings))
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }; delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (key.startsWith('LANJIAN_SMOKE') || key.startsWith('LANJIAN_CAPTURE')) delete env[key]
let app, page, pet, originalCursor, passed = false
const checks = [], errors = [], observations = []
async function nativeMouse(points) {
  const physical = await app.evaluate(({ screen }, points) => points.map(point => ({ ...screen.dipToScreenPoint(point), down: point.down, up: point.up, hold: point.hold })), points)
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PetMouse { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'; [PetMouse]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null; ` + physical.map(p => `[PetMouse]::SetCursorPos(${Math.round(p.x)},${Math.round(p.y)}) | Out-Null; Start-Sleep -Milliseconds 100; ${p.down ? '[PetMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);' : ''} Start-Sleep -Milliseconds ${p.hold || 100}; ${p.up ? '[PetMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);' : ''}`).join(' ')
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 })
}
async function bounds() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).getBounds()) }
async function point() { const b = await bounds(), c = await pet.getByTestId('pet-window-handle').boundingBox(); return { x: b.x + c.x + c.width / 2, y: b.y + c.y + c.height / 2 } }
async function enterBoot() {
  // Optional host preference for tests unrelated to cinematic frame pacing.
  // Restore it after the real entry/exit; never remove the overlay via the DOM.
  if (process.argv.includes('--reduced-boot')) await page.emulateMedia({ reducedMotion: 'reduce' })
  const previous = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL())); const value = w.isAlwaysOnTop(); w.setAlwaysOnTop(true); w.show(); w.focus(); return value })
  try {
    await page.getByTestId('app-boot-enter').click({ timeout: 60000 })
    await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 120000 })
  } catch (error) {
    observations.push({ case: 'boot-timeout', renderer: await page.evaluate(() => ({ hidden: document.hidden, boot: { ...document.querySelector('[data-testid="app-boot"]')?.dataset }, text: document.body.innerText.slice(-600) })).catch(() => null) })
    throw error
  } finally {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL()))?.setAlwaysOnTop(value), previous).catch(() => {})
    if (process.argv.includes('--reduced-boot')) await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
}
try {
  app = await _electron.launch({ args: [join(build, 'main/index.js')], env, timeout: 30000 })
  originalCursor = await app.evaluate(({ screen }) => screen.getCursorScreenPoint())
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.getByTestId('library-continue-writing').waitFor({ timeout: 30000 })
  await pause(500)
  await enterBoot()
  await page.getByTestId('library-continue-writing').click()
  await page.getByTestId('external-companion').waitFor()
  assert.equal(app.windows().filter(w => /pet\.html/.test(w.url())).length, 0)
  if (recovery) {
    await page.getByTestId('desktop-pet-tools-toggle').click()
    assert.match(await page.getByTestId('desktop-pet-tools-menu').innerText(), /桌宠已关闭/)
    await page.keyboard.press('Escape')
    assert.equal(app.windows().filter(w => /pet\.html/.test(w.url())).length, 0, 'opening tools must not opt in')
    checks.push('visible tools are available while disabled and never create a pet implicitly')
  }
  await page.getByTestId('external-companion').click()
  for (let i = 0; i < 100 && !pet; i++) { pet = app.windows().find(w => /pet\.html/.test(w.url())); if (!pet) await pause(100) }
  assert.ok(pet); pet.setDefaultTimeout(15000); pet.on('pageerror', error => errors.push(error.message))
  await pet.getByTestId('pet-artwork').filter({ has: pet.locator('canvas') }).waitFor()
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-artwork"]').dataset.ready === 'true')
  if (recovery) {
    // An author can keep using the physical mouse during this fixture. Disable
    // OS forwarding only in the isolated process; inject Chromium input below.
    await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -30000, y: -30000 }) })
    await pause(100)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).setIgnoreMouseEvents(true, { forward: false }))
  }
  await pet.evaluate(() => {
    window.petAnimationEvents = []
    const art = document.querySelector('[data-testid="pet-artwork"]')
    new MutationObserver(() => window.petAnimationEvents.push({time:performance.now(),intent:art.dataset.intent,clip:art.dataset.clip})).observe(art,{attributes:true,attributeFilter:['data-intent','data-clip']})
    for (const type of ['blur','focus']) window.addEventListener(type,()=>window.petAnimationEvents.push({time:performance.now(),event:type}))
    window.petEvents = []
    for (const type of ['pointerdown', 'pointermove', 'mousemove', 'pointerup', 'lostpointercapture']) window.addEventListener(type, e => window.petEvents.push({ type, x: e.screenX, y: e.screenY, buttons: e.buttons, target: e.target.getAttribute?.('data-testid') || e.target.tagName }))
    window.petMotions = []; window.desktopPet.onMotion(m => window.petMotions.push(m))
  })
  if (!recovery) {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())); w.show(); w.focus() })
  const initial = await bounds(), p = await point()
  await nativeMouse([{ ...p, down: true, hold: 600 }, { ...p, up: true }]); await pause(800)
  observations.push({ case: 'hold', initial, after: await bounds(), events: await pet.evaluate(() => window.petEvents), motions: await pet.evaluate(() => window.petMotions) })
  const pressed = observations.at(-1).events.filter(e=>e.buttons===1)
  const interfered = pressed.some(e=>Math.hypot(e.x-p.x,e.y-p.y)>2)
  observations.at(-1).externalPointerInterference = interfered
  if (!baseline && !interfered) assert.deepEqual(await bounds(),initial,'stationary native hold moved the window')
  const beforeClicks = await bounds(), clickPoint = await point()
  await pet.evaluate(() => { window.petEvents = []; window.petMotions = [] })
  await nativeMouse(Array.from({length:8}, () => ({ ...clickPoint, down: true, up: true, hold:40 })))
  await pause(1000)
  observations.push({ case: 'repeat-clicks', initial:beforeClicks, after: await bounds(), events: await pet.evaluate(() => window.petEvents), motions: await pet.evaluate(() => window.petMotions) })
  if (!baseline) {
    assert.deepEqual(await bounds(), beforeClicks, 'stationary clicks must never move native window')
    const stable = await bounds(), local = await pet.getByTestId('pet-window-handle').boundingBox()
    await app.evaluate(({BrowserWindow},p)=>BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL())).webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p}),{x:Math.round(local.x+local.width/2),y:Math.round(local.y+local.height/2)})
    await pause(700)
    await app.evaluate(({BrowserWindow},p)=>BrowserWindow.getAllWindows().find(w=>/pet\.html/.test(w.webContents.getURL())).webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p}),{x:Math.round(local.x+local.width/2),y:Math.round(local.y+local.height/2)})
    assert.deepEqual(await bounds(),stable,'Electron stationary press/release moved native bounds')
    checks.push('Electron injected stationary press/release preserves native bounds; native hold interference reported separately')
  }
  }
  await pet.screenshot({ path: join(output, 'pet.png') })
  if (!baseline && process.argv.includes('--side-panels')) await checkPetSidePanels({ app, page, pet, output, checks, observations, nativeMouse, bounds })
  if (!baseline && radial) await checkPetRadial({ app, page, pet, output, checks, observations, bounds })
  if (!baseline && careFeedback) await checkPetCareFeedback({ app, pet, profile, output, checks, observations })
  if (!baseline && reminders) await checkPetReminders({ app, page, pet, output, checks, observations })
  if (!baseline && focus) await checkPetFocus({ app, pet, profile, output, checks, observations })
  if (!baseline && guidance) await checkPetCareGuidance({ app, pet, profile, output, checks, observations })
  if (!baseline && recovery) await checkPetRecovery({ app, page, pet, profile, output, checks, observations, nativeMouse, bounds })
  // The pet now has its own side settings. The existing main settings route
  // remains an explicit recovery/preview surface and is checked separately.
  if (!baseline) await pet.evaluate(() => window.desktopPet.command({ type: 'settings' }))
  else {
  await pet.getByTestId('pet-window-menu-toggle').click()
  await pet.getByRole('button', { name: '完整设置 ↗' }).click()
  }
  await page.getByTestId('desktop-pet-settings').waitFor()
  await page.getByTestId('desktop-pet-settings').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'settings.png') })
  checks.push(recovery ? 'new profile defaults off and main settings remain available' : 'new profile defaults off; native repeated clicks preserve bounds; settings opens')
  if (!baseline && (artwork || process.argv.includes('--frames'))) await checkPetFrames({ app, page, output, checks, observations })
  if (!baseline && !recovery) await checkPetRepairs({ app, page, pet, output, checks, observations, nativeMouse, point, bounds })
  if (!baseline && process.argv.includes('--behavior-chat')) await checkPetBehaviorChat({ app, pet, output, checks, observations, nativeMouse, bounds })
  assert.deepEqual(errors, [])
  if (!baseline) {
    if (recovery) await page.evaluate(() => window.desktopPet.command({ type: 'locate' }))
    const saved = await page.evaluate(()=>window.desktopPet.get())
    // Exercise the author's main-window close/save handshake. Playwright's
    // app.close() calls app.quit(), which is a different all-window close path.
    const closed = app.waitForEvent('close', { timeout: 30000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL())).close())
    await closed
    app = await _electron.launch({args:[join(build, 'main/index.js')],env,timeout:30000})
    page = await app.firstWindow()
    await page.waitForFunction(()=>Boolean(window.desktopPet))
    const restored = await page.evaluate(()=>window.desktopPet.get())
    assert.equal(restored.enabled,saved.enabled)
    assert.equal(restored.preferences.positionLocked,true)
    if (recovery) { assert.deepEqual(restored.position, saved.position); assert.equal(restored.preferences.clickThrough, false) }
    assert.equal(app.windows().filter(w=>/pet\.html/.test(w.url())).length,0)
    checks.push('normal close/relaunch preserves explicit enabled choice and position lock; library creates no pet')
    if (recovery) checks.push('normal close/relaunch preserves the recovered home and disabled click-through')
    if (radial || reminders || focus || guidance || artwork) {
      await enterBoot()
      await page.getByTestId('library-continue-writing').click()
      await page.getByTestId('workspace-loading').waitFor()
      let samples = 0
      const deadline = Date.now() + 45000
      while (await page.getByTestId('workspace-loading').count()) {
        assert.ok(Date.now() < deadline, 'work loading did not finish')
        const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => /pet\.html/.test(w.webContents.getURL()) && w.isVisible()))
        // Recheck after the main read: normal overlay exit between round trips
        // must not count an already-ready workspace as loading.
        if (await page.getByTestId('workspace-loading').count()) assert.equal(visible, false, 'pet showed during work loading or its exit transition')
        samples++; await pause(25)
      }
      while (!(await page.evaluate(() => window.desktopPet.get())).open) {
        assert.ok(Date.now() < deadline, 'pet did not restore after work loading')
        await pause(50)
      }
      assert.ok(samples > 0, 'loading was not observed')
      observations.push({ case: 'opted-in-loading', samples })
      checks.push('remembered opt-in stays hidden through work loading and the exit transition, then restores automatically')
    }
  }
  passed = true
} catch (error) {
  observations.push({case:'animation-trace',events:await pet?.evaluate(()=>window.petAnimationEvents).catch(()=>[])})
  await pet?.screenshot({path:join(output,'failure-pet.png')}).catch(()=>{})
  await page?.screenshot({path:join(output,'failure-settings.png')}).catch(()=>{})
  throw error
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, baseline, reducedBoot: process.argv.includes('--reduced-boot'), build, checks, observations, errors, profile, displays: app ? await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ workArea: d.workArea, scaleFactor: d.scaleFactor }))).catch(() => []) : [] }, null, 2))
  if (app) { if (originalCursor && !recovery) await nativeMouse([originalCursor]).catch(() => {}); await app.close().catch(() => {}) }
}
console.log(JSON.stringify({ output, checks, observations: observations.map(({ events, motions, ...o }) => o) }))
