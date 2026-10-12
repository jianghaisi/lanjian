import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { defaultCompanionSettings } = require('../src/contracts/companion/companion-settings.ts')
const build = resolve(process.argv[2] ?? 'out-pet-quit-check')
const output = resolve(process.argv[3] ?? 'artifacts/ui/pet-quit/final')
const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-pet-quit-'))
const profile = join(root, 'profile'), models = join(root, 'models')
await mkdir(models); await mkdir(output, { recursive: true })
await new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })).create({ parentPath: root, title: '退出选择隔离验证' })
const settings = defaultCompanionSettings()
settings.revision = 1; settings.voice = { ...settings.voice, mute: true, textModel: false, preload: false, proactive: false }
await writeFile(join(profile, 'companion-settings.json'), JSON.stringify(settings))
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: models }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
for (const key of Object.keys(env)) if (key.startsWith('LANJIAN_SMOKE') || key.startsWith('LANJIAN_CAPTURE')) delete env[key]
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = data => createHash('sha256').update(data).digest('hex')
const stored = () => readFile(join(profile, 'desktop-pet.json'))
const checks = [], errors = [], observations = []
let app, page, pet, passed = false

async function launch() {
  app = await _electron.launch({ args: [join(build, 'main/index.js')], env, timeout: 30000 })
  page = await app.firstWindow(); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
  // Electron resolves will-prevent-unload itself. Playwright's automatic
  // dialog dismissal would race that native decision and fail in CDP.
  page.on('dialog', dialog => {
    if (dialog.type() === 'beforeunload') observations.push({ case: 'native-beforeunload-dialog' })
    else void dialog.dismiss().catch(() => {})
  })
  await page.getByTestId('library-continue-writing').waitFor({ timeout: 45000 })
  await app.evaluate(({ app, BrowserWindow }, tracePath) => {
    const { writeFileSync } = process.getBuiltinModule('fs')
    const owner = BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL()))
    globalThis.petQuitTrace = { before: 0, blockedUnload: 0, will: 0 }
    app.on('before-quit', () => { globalThis.petQuitTrace.before++ })
    owner.webContents.on('will-prevent-unload', () => { globalThis.petQuitTrace.blockedUnload++ })
    app.on('will-quit', () => { globalThis.petQuitTrace.will++; writeFileSync(tracePath, JSON.stringify(globalThis.petQuitTrace)) })
  }, join(output, 'quit-trace.json'))
}
async function enterWork(checkLoading = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('app-boot-enter').click({ timeout: 60000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 120000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByTestId('library-continue-writing').click()
  if (checkLoading) {
    await page.getByTestId('workspace-loading').waitFor()
    let samples = 0
    while (await page.getByTestId('workspace-loading').count()) {
      assert.ok(samples < 1200, 'work did not finish loading')
      const visible = await petVisible()
      if (await page.getByTestId('workspace-loading').count()) assert.equal(visible, false)
      samples++; await pause(25)
    }
    observations.push({ case: 'loading', samples }); assert.ok(samples > 0)
  }
  await page.getByTestId('external-companion').waitFor()
}
async function petVisible() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => /pet\.html/.test(w.webContents.getURL()) && w.isVisible()))
}
async function waitFor(check) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await pause(25) }
  assert.fail('native condition timed out')
}
async function quitRequest() {
  // Return from evaluation before the process can complete its asynchronous exit.
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
}
async function holdCloseDecision() {
  await app.evaluate(({ ipcMain }) => {
    const listeners = ipcMain.listeners('app:close-ready')
    globalThis.petQuitDecision = { listeners, attempts: 0, event: null, listener: (event) => { globalThis.petQuitDecision.attempts++; globalThis.petQuitDecision.event = event } }
    for (const listener of listeners) ipcMain.removeListener('app:close-ready', listener)
    ipcMain.on('app:close-ready', globalThis.petQuitDecision.listener)
  })
}
async function releaseCloseDecision(success) {
  await app.evaluate(({ ipcMain }, success) => {
    const decision = globalThis.petQuitDecision
    ipcMain.removeListener('app:close-ready', decision.listener)
    for (const listener of decision.listeners) ipcMain.on('app:close-ready', listener)
    if (decision.event) for (const listener of decision.listeners) listener(decision.event, success)
    delete globalThis.petQuitDecision
  }, success)
}

try {
  await launch(); await enterWork()
  assert.equal((await page.evaluate(() => window.desktopPet.get())).enabled, false)
  await page.evaluate(() => window.desktopPet.command({ type: 'enable', enabled: true }))
  await waitFor(petVisible)
  pet = app.windows().find(w => /pet\.html/.test(w.url())); assert.ok(pet)
  await pet.waitForFunction(() => Boolean(window.companionCare))
  await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -30000, y: -30000 }) })
  const before = await stored()
  await holdCloseDecision(); await quitRequest()
  await waitFor(() => app.evaluate(() => globalThis.petQuitDecision.attempts === 1))
  await quitRequest(); await pause(150)
  assert.equal(await app.evaluate(() => globalThis.petQuitDecision.attempts), 1)
  observations.push({ case: 'pending', petVisible: await petVisible(), bytesUnchanged: before.equals(await stored()) })
  assert.equal(await petVisible(), true, 'global quit hid the opted-in pet before the owner decision')
  assert.deepEqual(await stored(), before, 'pending global quit changed the saved user choice')
  checks.push('repeated app.quit waits for one real renderer save response without closing the pet or rewriting preferences')
  await releaseCloseDecision(false)
  assert.equal(await petVisible(), true)
  const care = await pet.evaluate(() => window.companionCare.get())
  const cared = await pet.evaluate(request => window.companionCare.act(request), { requestId: randomUUID(), revision: care.revision, action: { type: 'pat' } })
  assert.ok(cared.revision > care.revision, 'care must still accept real commands after a cancelled quit')
  await pet.screenshot({ path: join(output, 'cancelled-quit.png') })
  checks.push('cancelled owner save decision retains visible pet and working care get/act IPC')

  await page.evaluate(() => {
    window.petQuitVeto = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', window.petQuitVeto)
  })
  await quitRequest()
  await waitFor(() => app.evaluate(() => globalThis.petQuitTrace.blockedUnload > 0))
  assert.equal(await petVisible(), true); await pet.evaluate(() => window.companionCare.get())
  assert.deepEqual(await stored(), before)
  await page.evaluate(() => { window.removeEventListener('beforeunload', window.petQuitVeto); delete window.petQuitVeto })
  checks.push('real Chromium beforeunload veto retains pet, care IPC and saved choice; later quit can retry')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).close())
  await waitFor(async () => !(await page.evaluate(() => window.desktopPet.get())).enabled)
  assert.equal(JSON.parse(await stored()).enabled, false)
  assert.equal(await petVisible(), false)
  await page.evaluate(() => window.desktopPet.command({ type: 'enable', enabled: true }))
  await waitFor(petVisible)
  checks.push('explicit native pet close after cancelling quit still persists opt-out; re-enable remains available')
  const optedIn = await stored(), closed = app.waitForEvent('close', { timeout: 30000 })
  await quitRequest(); await closed; app = undefined
  assert.deepEqual(await stored(), optedIn)
  const trace = JSON.parse(await readFile(join(output, 'quit-trace.json'), 'utf8'))
  assert.equal(trace.will, 1); assert.ok(trace.blockedUnload > 0)
  observations.push({ case: 'confirmed-quit', trace, preferenceHash: digest(optedIn) })
  checks.push('confirmed app.quit exits normally once and preserves the exact opted-in preference bytes')

  await launch()
  assert.equal((await page.evaluate(() => window.desktopPet.get())).enabled, true)
  assert.equal(await petVisible(), false)
  await enterWork(true); await waitFor(petVisible)
  checks.push('fresh process restores enabled choice only after work loading; library and loading remain pet-free')
  await page.evaluate(() => window.desktopPet.command({ type: 'enable', enabled: false }))
  const optedOut = await stored(), offClosed = app.waitForEvent('close', { timeout: 30000 })
  await quitRequest(); await offClosed; app = undefined
  assert.deepEqual(await stored(), optedOut); assert.equal(JSON.parse(optedOut).enabled, false)
  checks.push('global quit also preserves an explicitly disabled choice byte-for-byte')
  assert.deepEqual(errors, []); passed = true
} finally {
  if (app) {
    await page?.evaluate(() => { if (window.petQuitVeto) window.removeEventListener('beforeunload', window.petQuitVeto) }).catch(() => {})
    await releaseCloseDecision(false).catch(() => {})
    await app.close().catch(() => {})
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, build, profile, checks, errors, observations }, null, 2))
}
console.log(JSON.stringify({ passed, output, checks: checks.length, errors }))
