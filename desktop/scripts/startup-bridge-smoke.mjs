import assert from 'node:assert/strict'
import { access, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { resolveConfig } from 'electron-vite'
import { build, createServer } from 'vite'

// Launch the actual emitted main entry with a synthetic, canonical profile.
// --dev uses the actual electron-vite serve configuration in an isolated output.
const output = resolve(process.argv[2] || 'out')
let rendererUrl = process.argv[3]
let server
if (rendererUrl === '--dev') {
  const { config } = await resolveConfig({ build: { outDir: output } }, 'serve', 'development')
  await build(config.main)
  await build(config.preload)
  server = await createServer({ ...config.renderer, server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  rendererUrl = `http://127.0.0.1:${server.httpServer.address().port}`
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-bridge-')))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = join(root, 'profile')
env.LANJIAN_GLOBAL_MODEL_DATA_PATH = join(root, 'models')
if (rendererUrl) env.ELECTRON_RENDERER_URL = rendererUrl
const application = await _electron.launch({ args: [join(output, 'main/index.js')], env })
try {
  const page = await application.firstWindow({ timeout: 30000 })
  const owner = await application.browserWindow(page)
  const preferences = await owner.evaluate(window => {
    const p = window.webContents.getLastWebPreferences()
    return { url: window.webContents.getURL(), ...p }
  })
  console.log(JSON.stringify({ output, rendererUrl, preferences }))
  await access(join(output, 'preload/index.cjs'))
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  await owner.evaluate(window => {
    window.bridgeErrors = []
    window.webContents.on('preload-error', (_event, path, error) => window.bridgeErrors.push({ path, name: error.name }))
  })
  await page.reload()
  const preloadErrors = await owner.evaluate(window => window.bridgeErrors)
  console.log(JSON.stringify({ preloadErrors }))
  assert.deepEqual(preloadErrors, [])
  await page.waitForFunction(() => typeof window.novelDesktop?.app?.version === 'function')
  assert.ok(await page.evaluate(() => window.novelDesktop.app.version()))
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await page.evaluate(() => window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false, proactive: false } }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.waitForFunction(() => typeof window.novelDesktop?.app?.version === 'function')
  await page.getByTestId('app-boot-enter').click({ timeout: 30000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  await page.getByTestId('project-library').waitFor({ state: 'visible' })
  assert.deepEqual(await owner.evaluate(window => window.bridgeErrors), [])
  for (const worker of ['local-models/text-worker.py', 'companion-voice/worker.py']) {
    await access(join(output, 'main', worker))
  }
  const pet = await application.evaluateHandle(async ({ BrowserWindow }, { output, rendererUrl }) => {
    const window = new BrowserWindow({ show: false, webPreferences: {
      preload: `${output}/preload/desktop-pet.cjs`, sandbox: true, contextIsolation: true, nodeIntegration: false
    } })
    if (rendererUrl) await window.loadURL(`${rendererUrl}/pet.html`)
    else await window.loadFile(`${output}/renderer/pet.html`)
    return window
  }, { output, rendererUrl })
  assert.deepEqual(await pet.evaluate(window => window.webContents.executeJavaScript(
    '({ pet: typeof window.desktopPet?.get, owner: typeof window.novelDesktop, node: typeof window.require })'
  )), { pet: 'function', owner: 'undefined', node: 'undefined' })
  await pet.evaluate(window => window.destroy())
  console.log('PASS: sandboxed preload roundtrip, reload, cinematic entry and library')
  console.log('PASS: emitted workers exist; pet preload loads without owner or Node access')
} finally {
  // A broken preload cannot acknowledge the normal close IPC. Only this fixture
  // process owns this empty temporary profile, so terminate via Electron itself.
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await application.close()
  await server?.close()
}
