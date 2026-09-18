import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

// Opt-in installed GPT-SoVITS. Never launch beside the author's active inference.
const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const root = await mkdtemp(join(tmpdir(), 'lanjian-voice-residency-'))
const profile = join(root, 'profile'), output = resolve('artifacts/ui/companion-residency')
await mkdir(output, { recursive: true })
const projectService = new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
const work = (await projectService.create({ parentPath: root, title: '语音常驻 · 隔离测试' })).project
const manuscript = join(work.path, '正文', '第1章-隔离章节.md'), body = '本段仅用于进出作品与语音常驻回归，不是作者正文。'
await writeFile(manuscript, body)
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE; delete env.LANJIAN_SMOKE
const started = Date.now(), checks = [], errors = [], timings = []
let app, page, speechPid, mainPid
function workerPids() {
  const parent = mainPid
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.ParentProcessId -eq ${parent} } | ForEach-Object { $_.ProcessId })`], { encoding: 'utf8', windowsHide: true }).trim())
}
function sameWorker(reason) { assert.deepEqual(workerPids(), [speechPid], reason); checks.push(reason) }
async function focus() { await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); w.webContents.focus() }) }
async function tap() {
  await focus()
  await page.getByTestId('archive-character-talk').focus()
  await page.evaluate(() => { window.residencyAudio = { bytes: 0, first: 0, sources: 0, ended: 0, started: performance.now() } })
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.residencyAudio.bytes > 0, null, { timeout: 30000 })
  timings.push(await page.evaluate(() => ({ step: 'warm-tap-first-audio', ms: Math.round(window.residencyAudio.first - window.residencyAudio.started) })))
}
try {
  app = await _electron.launch({ args: ['.'], env, timeout: 30000 })
  mainPid = await app.evaluate(() => process.pid)
  page = await app.firstWindow(); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => localStorage.setItem('lanjian-companion-voice-v1', JSON.stringify({ voice: 'ningguang', volume: .65, mute: false, textModel: false, preload: true, proactive: false, subtitles: true })))
  await page.reload()
  await page.getByTestId('app-boot').waitFor({ state: 'visible' })
  console.log('waiting-for-real-speech-preparation')
  await page.waitForFunction(() => document.querySelector('[data-testid="app-boot"]')?.getAttribute('data-boot-phase') === 'ready', null, { timeout: 610000 })
  timings.push({ step: 'startup-ready', ms: Date.now() - started })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 10000 })
  const workers = workerPids(); assert.equal(workers.length, 1); speechPid = workers[0]
  await page.evaluate(() => {
    window.residencyAudio = { bytes: 0, first: 0, sources: 0, ended: 0, started: 0 }
    window.novelDesktop.companionVoice.onEvent(event => {
      if (event.kind !== 'audio') return
      window.residencyAudio.bytes += event.pcm.byteLength; window.residencyAudio.first ||= performance.now()
    })
    const original = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      const evidence = window.residencyAudio; evidence.sources++
      this.addEventListener('ended', () => evidence.ended++, { once: true })
      return original.apply(this, args)
    }
  })
  await tap()
  await page.locator('.topbar-settings').click()
  await page.getByRole('button', { name: '关闭外观设置', exact: true }).waitFor()
  await page.getByTestId('companion-notice').waitFor({ state: 'detached' })
  await page.waitForTimeout(200)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible()), false, 'settings stops audible playback')
  const afterStop = await page.evaluate(() => window.residencyAudio.bytes)
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.residencyAudio.bytes), afterStop, 'cancelled fragments never return to UI')
  sameWorker('settings-during-speech-keeps-same-worker')
  await page.getByTestId('companion-sound-enabled').uncheck()
  sameWorker('sound-off-retains-loaded-worker')
  await page.getByTestId('companion-sound-enabled').check()
  await page.getByTestId('companion-mode-summary').screenshot({ path: join(output, 'residency-settings.png') })
  await page.getByRole('button', { name: '关闭外观设置', exact: true }).click()
  await page.waitForTimeout(3100)
  await tap()
  let audible = false
  for (let index = 0; index < 400; index++) {
    audible ||= await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible())
    if (!await page.getByTestId('companion-notice').count()) break
    await page.waitForTimeout(100)
  }
  assert.equal(audible, true)
  const audio = await page.evaluate(() => window.residencyAudio)
  assert.ok(audio.sources > 0); assert.equal(audio.sources, audio.ended)
  assert.equal(await page.getByTestId('companion-notice').count(), 0)
  sameWorker('retap-after-settings-finishes-audio-on-same-worker')
  await page.locator('.work-item-open').filter({ hasText: work.title }).first().click()
  await page.locator('.project-title-return').waitFor()
  await page.getByTestId('workspace-loading').waitFor({ state: 'detached' })
  sameWorker('enter-work-retains-speech-worker')
  await page.locator('.project-title-return').click()
  await page.getByTestId('library-continue-writing').waitFor()
  await page.waitForTimeout(800)
  sameWorker('return-to-library-retains-speech-worker')
  await tap()
  await page.screenshot({ path: join(output, 'returned-voice.png') })
  assert.equal(await readFile(manuscript, 'utf8'), body)
  assert.deepEqual(errors, [])
  await app.close(); app = undefined
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.throws(() => process.kill(speechPid, 0), 'normal app exit releases speech')
  checks.push('normal-app-exit-releases-worker')
  console.log(JSON.stringify({ checks, timings, errors, speechPid }))
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify({ root, checks, timings, errors, speechPid }, null, 2))
  // Test-owned profile only; never leave a failed native test and its resident child behind.
  await app?.evaluate(({ app }) => app.quit()).catch(() => {})
}
