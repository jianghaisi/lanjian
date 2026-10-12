import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
const desktop = resolve('../desktop'), require = createRequire(join(desktop, 'package.json'))
require('tsx/cjs')
const { _electron } = require('playwright')
const { SettingsStore } = require(join(desktop, 'src/main/platform/settings/settings-store.ts'))
const { ProjectService } = require(join(desktop, 'src/main/modules/library/application/project-service.ts'))
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-hosted-editor-'))), profile = join(root, 'profile')
const store = new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })
await new ProjectService(store).create({ parentPath: root, title: '共享编辑器回归样书' })
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(k)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const entry = join(root, 'entry.mjs')
await writeFile(entry, `process.on('unhandledRejection', e => { console.error(e); process.exit(1) }); await import(${JSON.stringify(pathToFileURL(join(desktop, 'out/main/index.js')).href)});`)
const app = await _electron.launch({ executablePath: require('electron'), args: ['--disable-gpu', '--disable-features=CalculateNativeWinOcclusion', entry], env })
app.process().stderr?.on('data', chunk => process.stderr.write(chunk))
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(25000)
  await page.waitForFunction(() => !!window.companionSettings)
  await page.evaluate(async () => { localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' })); await window.companionSettings.update({ careEnabled: false, voice: { mute: true, textModel: false, preload: false, proactive: false } }) })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  const open = page.getByRole('button', { name: /打开作品.*共享编辑器回归样书|继续创作/ }).first()
  await open.click()
  await page.waitForFunction(() => !!window.novelDesktop && !!document.querySelector('[data-activity="desk"]'))
  await page.evaluate(async () => { await window.novelDesktop.chapters.create() })
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'detached' }); await open.click()
  await page.locator('[data-activity="desk"]').click()
  const editor = page.getByTestId('manuscript-input')
  await editor.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('.app-frame[inert]') && !document.querySelector('[data-testid="workspace-loading"]'))
  const input = editor
  await input.fill('共享编辑器回归：中文正文。')
  await input.press('Control+s')
  await page.getByRole('button', { name: '立即保存', exact: true }).click()
  await page.waitForFunction(async () => (await window.novelDesktop.chapters.get(1)).content.includes('共享编辑器回归'))
  const actual = await page.evaluate(() => window.novelDesktop.chapters.get(1))
  assert.match(actual.content, /中文正文/)
  await page.getByRole('button', { name: '谋篇', exact: true }).click()
  await page.locator('[data-activity="desk"]').click()
  assert.match(await input.innerText(), /中文正文/)
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/desktop-shared-editor.png' })
  await writeFile('test-results/desktop-shared-editor.json', JSON.stringify({ status: 'passed', profile: root, revision: actual.revision, content: actual.content }, null, 2))
  console.log('Isolated Electron shared editor save and navigation passed.')
} catch (error) { const page = app.windows()[0]; if (page) { await mkdir('test-results', { recursive: true }); await writeFile('test-results/desktop-editor-error.txt', await page.locator('body').innerText()) }; throw error } finally { await app.close() }
