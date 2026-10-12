import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { CompanionSettingsStore } = require('../src/main/modules/companion/adapters/companion-settings-store.ts')
const build = resolve(process.argv[2] || 'out-companion-diagnostic-check'), realVoice = process.argv.includes('--real-voice')
const audioFixture = process.argv.includes('--audio-fixture')
assert.ok(!(realVoice && audioFixture), 'fixture audio and real inference are separate evidence modes')
if (realVoice && process.platform === 'win32') {
  const active = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process electron,python -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true }).trim()
  assert.equal(Number(active), 0, 'close author Electron/model sessions before the opt-in real voice check')
}
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-voice-check-'))), profile = join(root, 'profile')
const output = resolve(`artifacts/ui/companion-voice-check/${realVoice ? 'real' : audioFixture ? 'audio-fixture' : 'layout'}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
await mkdir(output, { recursive: true })
const project = (await new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })).create({ parentPath: root, title: '声音自检 · 隔离回归' })).project
const manuscript = join(project.path, '正文', '第1章-隔离章节.md'), body = '声音自检隔离正文；不访问作者作品。'
await writeFile(manuscript, body)
await new CompanionSettingsStore(profile).update({ careEnabled: false, voice: { mute: true, textModel: false, preload: false, proactive: false, voice: 'ningguang' } })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
Object.assign(env, { LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') })
const app = await _electron.launch({ args: [join(build, 'main/index.js')], env })
const checks = [], errors = [], measurements = []
let page, owner
async function capture(name) {
  const shot = await owner.evaluate(async window => { const image = await window.webContents.capturePage(); return { png: image.toPNG().toString('base64'), size: image.getSize() } })
  const expected = await page.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio])
  assert.ok(Math.abs(shot.size.width - expected[0]) < 3 && Math.abs(shot.size.height - expected[1]) < 3)
  await writeFile(join(output, name), Buffer.from(shot.png, 'base64'))
}
async function expandAndCheck(host) {
  const detail = page.getByTestId('companion-voice-check'), summary = detail.locator('summary')
  assert.equal(await detail.evaluate(node => node.open), false)
  await summary.focus(); await page.keyboard.press('Space')
  assert.equal(await detail.evaluate(node => node.open), true)
  const settingsBefore = await page.evaluate(() => window.companionSettings.get())
  await page.getByTestId('voice-check-start').focus(); await page.keyboard.press('Enter')
  await page.getByTestId('voice-check-result').filter({ hasText: '语音功能已关闭' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.companionSettings.get()), settingsBefore)
  assert.equal(await detail.locator('li[data-state="未检查"]').count(), 6)
  await detail.scrollIntoViewIfNeeded()
  const measured = await detail.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return { width: rect.width, overflow: node.scrollWidth > node.clientWidth + 1,
      controlsFit: [...node.querySelectorAll('button')].every(button => { const b = button.getBoundingClientRect(); return b.left >= rect.left && b.right <= rect.right + 1 }) }
  })
  assert.equal(measured.overflow, false); assert.equal(measured.controlsFit, true)
  measurements.push({ host, ...measured }); checks.push(`${host}:keyboard-disabled-truthful-no-preference-write`)
  await capture(`${host}.png`)
}
async function checkAudioInterruption() {
  // Test-only IPC fixture in this isolated process; real preload, WebAudio and settings UI.
  // Silent PCM is playback plumbing evidence, never inference or human hearing evidence.
  await app.evaluate(({ ipcMain }) => {
    let session = 0
    for (const name of ['status', 'configure', 'prepare', 'open', 'request', 'cancel', 'close', 'warmup', 'suspend']) ipcMain.removeHandler(`companion-voice:${name}`)
    const ok = value => ({ ok: true, value })
    ipcMain.handle('companion-voice:status', () => ok({ installed: false, textInstalled: false, speechInstalled: true, profile: 'gpt-sovits-v2-fp16' }))
    for (const name of ['configure', 'prepare', 'cancel', 'close', 'suspend']) ipcMain.handle(`companion-voice:${name}`, () => ok(true))
    ipcMain.handle('companion-voice:warmup', () => { throw new Error('fixture must never warm a model') })
    ipcMain.handle('companion-voice:open', () => ok({ sessionId: `audio-fixture-${++session}` }))
    ipcMain.handle('companion-voice:request', async (event, input) => {
      if (input.action !== 'preview') throw new Error('only fixed diagnostic preview is allowed')
      const base = { sessionId: input.sessionId, requestId: input.requestId }
      event.sender.send('companion-voice:event', { ...base, sequence: 0, kind: 'audio', sampleRate: 24000, pcm: new Uint8Array(144000) })
      await new Promise(resolve => setTimeout(resolve, 300))
      return ok({ text: '隔离播放通道测试，非模型推理。' })
    })
  })
  await page.evaluate(() => {
    const Original = window.AudioContext
    window.__voiceCheckContexts = []
    window.AudioContext = class extends Original {
      constructor(...args) { super(...args); window.__voiceCheckContexts.push(this) }
    }
  })
  await page.getByTestId('companion-sound-enabled').check()
  await page.waitForFunction(async () => !(await window.companionSettings.get()).voice.mute)
  await page.getByTestId('companion-voice-check').locator('summary').click()
  const prefs = await page.evaluate(() => window.companionSettings.get())
  for (const action of ['suspend', 'close']) {
    await page.getByTestId('voice-check-start').click()
    await page.getByTestId('voice-check-playback').filter({ hasText: '检查中' }).waitFor()
    const before = await page.evaluate(() => window.__voiceCheckContexts.length)
    await page.evaluate(async action => { await window.__voiceCheckContexts.at(-1)[action]() }, action)
    await page.waitForFunction(() => document.querySelector('[data-testid="voice-check-result"]')?.getAttribute('data-result') === 'failed', null, { timeout: 2000 })
    assert.match(await page.getByTestId('voice-check-audio').innerText(), /未就绪/)
    assert.equal(await page.getByTestId('voice-check-heard').count(), 0)
    await page.getByTestId('voice-check-result').scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    await capture(`audio-${action}-unready.png`)
    await page.getByTestId('voice-check-start').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="voice-check-result"]')?.getAttribute('data-result') === 'confirm')
    assert.equal(await page.evaluate(() => window.__voiceCheckContexts.length), before + (action === 'close' ? 1 : 0))
    await page.getByTestId('voice-check-unheard').click()
    checks.push(`fixture-${action}-immediate-unready-explicit-retry-natural-drain`)
  }
  assert.deepEqual(await page.evaluate(() => window.companionSettings.get()), prefs)
  await page.getByRole('button', { name: '关闭外观设置' }).click()
  await page.evaluate(async () => { await window.__voiceCheckContexts.at(-1).suspend() })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByTestId('voice-check-result').count(), 0)
  checks.push('fixture-idle-state-change-does-not-reopen-result', 'fixture-no-preference-writes')
}
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); owner = await app.browserWindow(page)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.companionSettings)
  await page.evaluate(() => localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'standard', bootStyle: 'brief', bootPalette: 'system' })))
  await page.reload()
  await page.getByTestId('app-boot-enter').click({ timeout: 30000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached' })
  for (const view of [{ width: 1440, height: 900, zoom: 1, theme: 'qingzhou' }, { width: 1100, height: 760, zoom: 1.25, theme: 'moye' }]) {
    await owner.evaluate((window, v) => { window.unmaximize(); window.setContentSize(v.width, v.height); window.webContents.setZoomFactor(v.zoom) }, view)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByTestId(`theme-${view.theme}`).check()
    // Native <details> is intentionally kept across close/reopen; close it explicitly for keyboard testing.
    if (await page.getByTestId('companion-voice-check').evaluate(node => node.open)) await page.getByTestId('companion-voice-check').locator('summary').click()
    await expandAndCheck(`library-${view.theme}`)
    await page.getByRole('button', { name: '关闭外观设置' }).click()
    assert.equal(await page.getByRole('button', { name: '设置', exact: true }).evaluate(node => node === document.activeElement), true)
  }
  await page.getByTestId('library-continue-writing').click()
  await page.getByTestId('workspace-loading').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('settings-category-common').click()
  await page.getByTestId('settings-nav-companion').click()
  await page.getByTestId('companion-settings').waitFor()
  await expandAndCheck('writing-dark-compact')
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('project-library').waitFor()
  await owner.evaluate(window => { window.setContentSize(1440, 900); window.webContents.setZoomFactor(1) })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('theme-qingzhou').check()
  if (audioFixture) await checkAudioInterruption()
  if (realVoice) {
    await page.getByTestId('companion-sound-enabled').check()
    await page.waitForFunction(async () => !(await window.companionSettings.get()).voice.mute)
    const status = await page.evaluate(() => window.novelDesktop.companionVoice.status())
    assert.equal(status.speechInstalled, true, 'real voice mode requires existing validated assets')
    await page.getByTestId('companion-voice-check').locator('summary').click()
    await page.getByTestId('voice-check-start').click()
    await page.getByTestId('voice-check-preparation').filter({ hasText: '检查中' }).waitFor()
    await page.getByTestId('voice-check-stop').click()
    assert.match(await page.getByTestId('voice-check-result').innerText(), /已停止/)
    checks.push('real-cold-preparation-explicit-stop')
    await page.getByTestId('voice-check-start').click()
    console.log('real-voice: waiting for selected speech preparation and natural playback completion')
    await page.waitForFunction(() => {
      const result = document.querySelector('[data-testid="voice-check-result"]')
      return result && result.getAttribute('data-result') !== 'running'
    }, null, { timeout: 650000 })
    const evidence = await page.getByTestId('companion-voice-check').locator('li').allTextContents()
    assert.equal(await page.getByTestId('voice-check-result').getAttribute('data-result'), 'confirm')
    assert.equal(await page.getByTestId('companion-text-model-enabled').isChecked(), false)
    await page.getByTestId('voice-check-heard').scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await capture('real-software-playback-complete.png')
    // Automation cannot certify human hearing. Exercise the honest negative route only.
    await page.getByTestId('voice-check-unheard').click()
    assert.match(await page.getByTestId('voice-check-result').innerText(), /音量混合器/)
    measurements.push({ realSoftwareEvidence: evidence, humanHearing: 'unverified' })
    checks.push('real-selected-voice-natural-drain', 'hearing-confirmation-not-automatic')
    await page.getByTestId('voice-check-start').click()
    await page.getByRole('button', { name: '关闭外观设置' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    assert.equal(await page.getByTestId('voice-check-heard').count(), 0)
    assert.equal(await page.getByTestId('voice-check-stop').count(), 0)
    checks.push('dialog-close-invalidates-pending-real-attempt')
  }
  assert.equal(await readFile(manuscript, 'utf8'), body)
  assert.deepEqual(errors, [])
  checks.push('synthetic-manuscript-unchanged', 'no-renderer-errors')
} catch (error) {
  errors.push(String(error)); if (page && owner) await capture('failure.png').catch(() => {})
  throw error
} finally {
  const rendererFingerprint = createHash('sha256').update(await readFile(join(build, 'renderer/index.html'))).digest('hex')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ capturedAt: new Date().toISOString(), root, build, rendererFingerprint, realVoice, audioFixture, checks, measurements, errors }, null, 2))
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await app.close().catch(() => {})
  console.log(JSON.stringify({ output, checks, errors }))
}
