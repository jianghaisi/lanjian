import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url)
require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-pet-opt-in-'))
const profile = join(root, 'profile'), output = resolve('artifacts/ui/desktop-pet-opt-in')
await mkdir(output, { recursive: true })
const projectService = new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
const work = (await projectService.create({ parentPath: root, title: '桌宠开关隔离验证' })).project
const manuscript = join(work.path, '正文', '第1章-隔离测试.md'), body = '仅用于桌宠选择验证，不是作者作品。'
await writeFile(manuscript, body)
const preferenceFile = join(profile, 'desktop-pet.json')
const legacy = { preferences: { scale: 0.75, alwaysOnTop: true, clickThrough: false, reminderMinutes: 0 }, position: null }
const legacyBytes = JSON.stringify(legacy)
await writeFile(preferenceFile, legacyBytes)
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (key.startsWith('LANJIAN_SMOKE') || key.startsWith('LANJIAN_CAPTURE')) delete env[key]
const checks = [], errors = [], states = []
let app, page
async function close() { if (app) { await app.close(); app = undefined } }
async function launch() {
  app = await _electron.launch({ args: ['.'], env, timeout: 30000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.desktopPet))
  await page.exposeFunction('recordPetState', state => states.push(state))
  await page.evaluate(() => window.desktopPet.onState(({ open, context, error }) => window.recordPetState({ open, scope: context.scope, error })))
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 30000 })
  await page.getByTestId('library-continue-writing').waitFor()
}
async function openWork() {
  await page.getByTestId('library-continue-writing').click()
  await page.locator('.project-title-return').waitFor()
  await page.getByTestId('workspace-loading').waitFor({ state: 'detached' })
  await page.getByTestId('external-companion').waitFor()
}
async function backToLibrary() {
  await page.locator('.project-title-return').click()
  await page.getByTestId('library-continue-writing').waitFor()
  await page.waitForFunction(async () => (await window.desktopPet.get()).context.scope === '')
}
async function petWindows() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => /pet\.html/.test(win.webContents.getURL())).map(win => ({ visible: win.isVisible(), url: win.webContents.getURL() })))
}
async function saved() { return JSON.parse(await readFile(preferenceFile, 'utf8')) }
try {
  // Seed only this temporary profile before the real app starts, with inference disabled.
  const preload = join(root, 'seed-preload.cjs'), entry = join(root, 'seed.cjs')
  await writeFile(preload, `localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({voice:'ningguang',volume:0,mute:true,proactive:false,subtitles:true,textModel:false,preload:false}));`)
  await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.LANJIAN_USER_DATA_PATH);app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)}}});win.loadFile(${JSON.stringify(resolve('out/renderer/index.html'))});});`)
  app = await _electron.launch({ args: [entry], env, timeout: 30000 })
  page = await app.firstWindow()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lanjian-companion-voice-v1')).mute === true)
  await close()

  await launch()
  await openWork()
  assert.deepEqual(await petWindows(), [], 'legacy profile must not instantiate the pet renderer')
  assert.equal(await readFile(preferenceFile, 'utf8'), legacyBytes, 'default-off read must not rewrite legacy preferences')
  checks.push('legacy-work-entry-has-no-pet-window-or-preference-write')
  await page.screenshot({ path: join(output, 'default-off.png') })

  await page.getByTestId('external-companion').click()
  await page.waitForFunction(async () => (await window.desktopPet.get()).open)
  const pet = await app.waitForEvent('window', { predicate: window => /pet\.html/.test(window.url()), timeout: 10000 }).catch(() => app.windows().find(window => /pet\.html/.test(window.url())))
  assert.ok(pet)
  await pet.getByTestId('desktop-pet-window').waitFor()
  assert.equal((await saved()).enabled, true)
  assert.equal((await saved()).preferences.scale, legacy.preferences.scale)
  assert.equal((await petWindows()).length, 1)
  checks.push('real-toolbar-click-opens-and-persists-enabled-with-appearance-preserved')
  await page.screenshot({ path: join(output, 'enabled-main.png') })
  await pet.screenshot({ path: join(output, 'enabled-pet.png') })
  await backToLibrary()
  assert.ok((await petWindows()).every(window => !window.visible))
  assert.equal((await saved()).enabled, true)
  await openWork()
  await page.waitForFunction(async () => (await window.desktopPet.get()).open)
  checks.push('library-return-temporarily-hides-and-work-reentry-restores-choice')
  await close()

  await launch()
  assert.deepEqual(await petWindows(), [], 'enabled preference must not load a pet in the library')
  await openWork()
  await page.waitForFunction(async () => (await window.desktopPet.get()).open)
  assert.equal((await saved()).enabled, true)
  checks.push('restart-restores-enabled-only-on-entering-work')
  await app.windows().find(window => /pet\.html/.test(window.url()))?.getByTestId('desktop-pet-window').waitFor()
  await page.bringToFront()
  await page.getByTestId('external-companion').press('Space')
  await page.waitForFunction(async () => !(await window.desktopPet.get()).open)
  assert.equal((await saved()).enabled, false)
  checks.push('keyboard-toggle-persists-disabled')
  await close()

  await launch()
  await openWork()
  assert.deepEqual(await petWindows(), [])
  await backToLibrary()
  await openWork()
  assert.deepEqual(await petWindows(), [])
  assert.equal((await saved()).enabled, false)
  assert.equal(await readFile(manuscript, 'utf8'), body)
  checks.push('disabled-restart-and-reentry-create-no-pet-and-preserve-manuscript')
  await page.screenshot({ path: join(output, 'remembered-off.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks, errors }))
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, states }, null, 2))
  try { await close() } finally {
    const actual = await realpath(root)
    assert.equal(actual, root)
    assert.equal(dirname(actual), await realpath(tmpdir()))
    assert.ok(actual.split(/[\\/]/).at(-1).startsWith('lanjian-pet-opt-in-'))
    await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
