// Explicit real-model regression. Uses installed assets, an isolated profile and fixed preview text.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url); require('tsx/cjs')
const { CompanionSettingsStore } = require('../src/main/modules/companion/adapters/companion-settings-store.ts')
const build = resolve(process.argv[2] || 'out-interaction-sound')
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-sound-voice-')))
const output = resolve('../.trellis/tasks/10-02-v3-interaction-sound-effects/research', `voice-native-${Date.now()}`)
await mkdir(output, { recursive: true })
await new CompanionSettingsStore(join(root, 'profile')).update({ careEnabled: false,
  voice: { mute: false, textModel: false, preload: true, proactive: false, voice: 'ningguang' } })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const app = await _electron.launch({ args: [join(build, 'main/index.js')], env })
const checks = [], errors = [], evidence = {}
let page
function instrument() {
  const p = window.__voiceSound = { sources: [], taps: [], pcmBytes: 0, pcmPeak: 0, overlap: false }
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function(target, ...args) {
    if (target instanceof AudioDestinationNode) {
      const tap = this.context.createAnalyser(); tap.fftSize = 512
      connect.call(this, tap); connect.call(tap, target)
      p.taps.push({ tap, speech: this.context.sampleRate === 24000, peak: 0 })
      return target
    }
    return connect.call(this, target, ...args)
  }
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function(...args) {
    const entry = { speech: this.context.sampleRate === 24000, state: this.context.state, ended: false }
    p.sources.push(entry); this.addEventListener('ended', () => { entry.ended = true }, { once: true })
    return start.apply(this, args)
  }
  const data = new Float32Array(512)
  setInterval(() => {
    let speech = false, effects = false
    for (const item of p.taps) {
      item.tap.getFloatTimeDomainData(data)
      const peak = Math.max(...data.map(Math.abs)); item.peak = Math.max(item.peak, peak)
      if (peak > .0001) { if (item.speech) speech = true; else effects = true }
    }
    p.overlap ||= speech && effects
  }, 16)
  addEventListener('DOMContentLoaded', () => window.novelDesktop.companionVoice.onEvent(event => {
    if (event.kind !== 'audio') return
    p.pcmBytes += event.pcm.byteLength
    const view = new DataView(event.pcm.buffer, event.pcm.byteOffset, event.pcm.byteLength)
    for (let i = 0; i < view.byteLength; i += 2) p.pcmPeak = Math.max(p.pcmPeak, Math.abs(view.getInt16(i, true)))
  }), { once: true })
}
async function speechPids() {
  const pid = await app.evaluate(() => process.pid)
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} -and $_.Name -eq 'python.exe' -and $_.CommandLine -match 'worker.py' } | Select-Object -ExpandProperty ProcessId`], { encoding: 'utf8', windowsHide: true }).trim()
}
async function completeCheck() {
  await page.waitForFunction(() => {
    const result = document.querySelector('[data-testid="voice-check-result"]')
    return result && result.getAttribute('data-result') !== 'running'
  }, undefined, { timeout: 650000 })
  assert.equal(await page.getByTestId('voice-check-result').getAttribute('data-result'), 'confirm', await page.getByTestId('voice-check-result').innerText())
}
try {
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.companionSettings)
  await page.evaluate(() => localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: 'cinematic', bootPalette: 'dark' })))
  await page.addInitScript(instrument)
  await page.reload()
  const owner = await app.browserWindow(page)
  await owner.evaluate(window => { window.setContentSize(1440, 1000); window.show(); window.focus() })
  await page.getByTestId('app-boot-enter').click({ timeout: 650000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  evidence.status = await page.evaluate(() => window.novelDesktop.companionVoice.status())
  assert.equal(evidence.status.speechInstalled, true)
  evidence.bootPreparation = await page.getByTestId('companion-preparation-status').textContent()
  assert.equal(await page.evaluate(() => window.novelDesktop.companionVoice.prepare('ningguang')), true)
  const pid = await speechPids(); assert.ok(pid, 'real speech worker must remain resident after preparation')
  evidence.speechPid = pid
  checks.push('cinematic-boot-with-real-speech-preload-and-effects')
  console.log('PASS real speech preload during cinematic boot')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('library-settings-sound').click()
  const before = await page.evaluate(() => window.companionSettings.get())
  await page.getByTestId('companion-voice-check').locator('summary').click()
  await page.getByTestId('sound-preview-brand').click()
  await page.getByTestId('voice-check-start').click()
  await page.waitForFunction(() => window.__voiceSound.overlap, undefined, { timeout: 60000 })
  await page.getByTestId('sound-enabled').uncheck()
  await completeCheck()
  evidence.first = await page.getByTestId('companion-voice-check').locator('li').allTextContents()
  assert.deepEqual(await page.evaluate(() => window.companionSettings.get()), before)
  checks.push('real-voice-and-brand-nonzero-output-overlap', 'muting-effects-does-not-stop-speech-or-change-voice-settings')
  console.log('PASS simultaneous output and independent mute')

  const previous = await page.evaluate(() => window.__voiceSound.pcmBytes)
  await page.getByTestId('voice-check-start').click()
  await completeCheck()
  assert.ok(await page.evaluate(() => window.__voiceSound.pcmBytes) > previous)
  await page.getByTestId('sound-enabled').check()
  assert.equal(await speechPids(), pid, 'settings and repeated playback retain the same speech process')
  evidence.audio = await page.evaluate(() => ({ ...window.__voiceSound, taps: window.__voiceSound.taps.map(({ speech, peak }) => ({ speech, peak })) }))
  assert.ok(evidence.audio.pcmBytes > 0 && evidence.audio.pcmPeak > 100)
  const speech = evidence.audio.sources.filter(source => source.speech)
  assert.ok(speech.length && speech.every(source => source.ended && source.state === 'running'))
  assert.deepEqual(errors, [])
  checks.push('repeat-real-speech-with-effects-muted', 'same-resident-worker-and-natural-pcm-drain', 'no-renderer-errors')
  console.log('PASS repeated real speech and resident worker')
} catch (error) {
  errors.push(String(error)); process.exitCode = 1
  if (page) evidence.failureText = await page.locator('body').innerText().catch(() => '')
} finally {
  if (page) await page.screenshot({ path: join(output, 'result.png') }).catch(() => {})
  const mainSha256 = createHash('sha256').update(await readFile(join(build, 'main/index.js'))).digest('hex')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ build, root, mainSha256, checks, errors, evidence, humanHearing: 'unverified' }, null, 2))
  // This profile owns no author work. Do not enter the product's interactive exit dialog.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  console.log(JSON.stringify({ output, checks, errors }))
}
