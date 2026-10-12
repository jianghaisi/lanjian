import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Run from desktop after building. The optional argument selects isolated output.
const output = resolve(process.argv[2] || 'out')
const profile = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-directory-check-')))
const evidence = resolve('artifacts/directory-layout')
await mkdir(evidence, { recursive: true })
const workers = [
  ['models/adapters/local-models/text-worker.py', 'local-models/text-worker.py'],
  ...['worker.py', 'gpt_sovits.py', 'gpt-sovits-assets.json'].map(name =>
    ['companion/adapters/companion-voice/' + name, 'companion-voice/' + name])
]
for (const [source, emitted] of workers) {
  assert.deepEqual(await readFile(join(output, 'main', emitted)), await readFile(resolve('src/main/modules', source)))
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('LANJIAN_') && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'ELECTRON_RENDERER_URL'))
env.LANJIAN_USER_DATA_PATH = profile
const app = await _electron.launch({ args: [join(output, 'main/index.js')], env })
const errors = []
const checks = ['emitted-workers-match-source']
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return { profile: app.getPath('userData'), sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration }
  })
  assert.equal(runtime.profile, profile)
  assert.equal(runtime.sandbox, true)
  assert.equal(runtime.contextIsolation, true)
  assert.equal(runtime.nodeIntegration, false)
  checks.push('isolated-profile-and-window-boundary')
  await page.waitForFunction(() => typeof window.novelDesktop?.app?.version === 'function')
  const info = await page.evaluate(() => window.novelDesktop.app.version())
  assert.ok(info)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  checks.push('preload-roundtrip')
  await page.getByTestId('project-library').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('main.app-frame')?.inert === false
    || (document.querySelector('[data-testid="app-boot"].has-error')
      && document.querySelector('[data-testid="app-boot-skip-models"]')), null, { timeout: 60000 })
  if (await page.getByTestId('app-boot-skip-models').isVisible()) {
    await page.getByTestId('app-boot-skip-models').click()
    checks.push('optional-models-unavailable-author-skip')
  }
  await page.waitForFunction(() => document.querySelector('main.app-frame')?.inert === false, null, { timeout: 60000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  checks.push('renderer-enters-library')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(evidence, 'library.png') })
  console.log(JSON.stringify({ checks, errors, profile, output }))
} finally {
  await writeFile(join(evidence, 'verification.json'), JSON.stringify({ checks, errors, profile, output }, null, 2))
  await app.close()
}
