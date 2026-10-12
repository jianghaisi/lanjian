import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'

const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { defaultCompanionSettings } = require('../src/contracts/companion/companion-settings.ts')
const build = resolve(process.argv[2] || 'out-pet-microphone-draft-check')
const output = resolve(process.argv[3] || `artifacts/ui/pet-microphone-draft/${Date.now()}`)
const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-pet-microphone-draft-')), profile = join(root, 'profile')
await mkdir(output, { recursive: true })
const projects = new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' }))
const work = (await projects.create({ parentPath: root, title: '桌宠录音草稿隔离验证' })).project
const manuscript = join(work.path, '正文', '第1章-隔离测试.md'), body = '合成作品，验证麦克风不会修改正文。'
await writeFile(manuscript, body)
const settings = defaultCompanionSettings()
settings.revision = 1; settings.voice = { ...settings.voice, mute: true, textModel: false, preload: false, proactive: false }
settings.microphone.enabled = true
await writeFile(join(profile, 'companion-settings.json'), JSON.stringify(settings))
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile }; delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (key.startsWith('LANJIAN_SMOKE') || key.startsWith('LANJIAN_CAPTURE')) delete env[key]
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let app, page, pet, stage = 'launch', passed = false, failure, environment
const checks = [], errors = []
async function point(control) {
  await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(120)
  const rect = await control.boundingBox(); assert.ok(rect)
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
}
async function mouse(type, at, button = 'left') {
  await app.evaluate(({ BrowserWindow }, input) => {
    BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents.sendInputEvent(input)
  }, { type, button, clickCount: 1, ...at })
}
async function focusPet() {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL()))
    win.focus(); win.webContents.focus()
  })
  await pet.waitForFunction(() => document.hasFocus())
}
async function click(control) { const at = await point(control); await focusPet(); await mouse('mouseDown', at); await mouse('mouseUp', at) }
async function openChat() {
  await click(pet.getByTestId('pet-window-menu-toggle')); await pause(450)
  await click(pet.getByTestId('pet-open-chat')); await pet.getByTestId('pet-chat-input').waitFor()
}
async function recording() { await pet.getByTestId('pet-microphone').filter({ hasText: '结束' }).waitFor(); await pause(600) }
async function idle() {
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-microphone-transcript"]') || /^(麦克风输入|按住说话)$/.test(document.querySelector('[data-testid="pet-microphone"]')?.textContent.trim() || ''))
}
async function tracksEnded() {
  await pet.waitForFunction(() => window.petDraftTracks.length > 0 && window.petDraftTracks.every(track => track.readyState === 'ended'), null, { timeout: 3000 })
}
async function complete(text) {
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-microphone"]')?.textContent.includes('识别中'))
  await tracksEnded()
  await app.evaluate(async (_electron, text) => {
    for (let i = 0; i < 100 && !globalThis.petDraftResolve; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!globalThis.petDraftResolve) throw new Error('No pending ASR response')
    globalThis.petDraftResolve({ ok: true, value: { text } }); globalThis.petDraftResolve = undefined
  }, text)
  await idle()
}
try {
  app = await _electron.launch({ args: [join(build, 'main/index.js'), '--use-fake-device-for-media-stream'], env, timeout: 30000 })
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('app-boot-enter').click({ timeout: 60000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 60000 })
  await page.getByTestId('library-continue-writing').click()
  await page.getByTestId('external-companion').waitFor()
  assert.equal(app.windows().filter(w => /pet\.html/.test(w.url())).length, 0)
  await page.getByTestId('external-companion').click()
  for (let i = 0; i < 100 && !pet; i++) { pet = app.windows().find(w => /pet\.html/.test(w.url())); if (!pet) await pause(100) }
  assert.ok(pet); pet.setDefaultTimeout(15000); pet.on('pageerror', error => errors.push(error.message))
  await pet.getByTestId('pet-window-menu-toggle').waitFor()
  await app.evaluate(({ BrowserWindow, screen, ipcMain }) => {
    const win = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL()))
    screen.getCursorScreenPoint = () => ({ x: -30000, y: -30000 })
    win.setIgnoreMouseEvents(true, { forward: false }); win.setIgnoreMouseEvents = () => {}
    win.show(); win.focus(); win.webContents.focus()
    // Keep actual capture grant, permission, audio worklet and cancel paths.
    // Only inference is deterministic; no real microphone or model inference.
    ipcMain.removeHandler('companion-asr:transcribe')
    globalThis.petDraftSubmits = 0
    ipcMain.handle('companion-asr:transcribe', (_event, input) => {
      if (input.sampleRate !== 16000 || input.pcm.byteLength < 3200) throw new Error('Missing captured PCM')
      globalThis.petDraftSubmits++
      return new Promise(resolve => { globalThis.petDraftResolve = resolve })
    })
  })
  await pet.evaluate(() => {
    window.petDraftTracks = []
    const Worklet = window.AudioWorkletNode
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) { super(...args); window.petDraftNode = this }
    }
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints); window.petDraftTracks.push(...stream.getTracks()); return stream
    }
  })
  environment = { displays: await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ workArea: d.workArea, scaleFactor: d.scaleFactor }))), input: 'Electron Chromium input; OS mouse forwarding disabled in isolated fixture', realMicrophone: false, inference: 'controlled IPC transcript', viewport: await pet.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })) }
  await openChat()
  environment.viewport = await pet.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  environment.zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents.getZoomFactor())
  const mic = pet.getByTestId('pet-microphone'), input = pet.getByTestId('pet-chat-input'), candidate = pet.getByTestId('pet-microphone-transcript')
  async function focusMic() { await focusPet(); await mic.focus() }
  stage = 'toggle Space and existing draft'
  await input.fill('我已经写好的草稿'); await focusMic(); await pet.keyboard.press('Space'); await recording()
  await pet.keyboard.press('Space'); await complete('接下来口述的内容')
  assert.equal(await input.inputValue(), '我已经写好的草稿'); await candidate.waitFor(); assert.equal(await mic.count(), 0)
  const actions = await candidate.locator('button').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect(), region = button.closest('.input-tools').getBoundingClientRect()
    return bounds.top >= region.top && bounds.bottom <= region.bottom
  }))
  assert.deepEqual(actions, [true, true], 'both candidate actions must be visible without scrolling')
  assert.equal(await pet.getByTestId('pet-chat-turn').count(), 0, 'transcription must not send')
  await pet.screenshot({ path: join(output, 'pending-transcript.png') })
  checks.push('Space toggles recording; existing draft retained; transcript staged; tracks released; no chat sent')
  stage = 'close and reopen preserves candidate'
  await click(pet.getByRole('button', { name: '关闭聊天', exact: true })); await openChat()
  assert.equal(await input.inputValue(), '我已经写好的草稿'); await candidate.waitFor()
  await click(pet.getByRole('button', { name: '追加到草稿', exact: true }))
  assert.equal(await input.inputValue(), '我已经写好的草稿\n接下来口述的内容'); assert.equal(await candidate.count(), 0)
  checks.push('closing/reopening chat preserves draft and candidate; explicit append retains both')
  stage = 'toggle Enter and empty draft'
  await input.fill(''); await focusMic(); await pet.keyboard.down('Enter'); await recording()
  await pet.keyboard.down('Enter'); await pause(100); assert.match(await mic.innerText(), /结束录音/)
  await pet.keyboard.up('Enter'); await pet.keyboard.press('Enter'); await complete('空草稿回填')
  assert.equal(await input.inputValue(), '空草稿回填'); assert.equal(await candidate.count(), 0)
  checks.push('native Enter click records once despite key repeat; empty draft receives editable result')
  stage = 'draft changed while transcribing and overflow recovery'
  await click(mic); await recording(); await click(mic)
  await input.fill('字'.repeat(1999)); await complete('后到的转写')
  await click(pet.getByRole('button', { name: '追加到草稿', exact: true }))
  assert.equal((await input.inputValue()).length, 1999); assert.match(await candidate.innerText(), /后到的转写/)
  await pet.getByRole('alert').filter({ hasText: '2000' }).waitFor()
  await input.fill('缩短后'); await click(pet.getByRole('button', { name: '追加到草稿', exact: true }))
  assert.equal(await input.inputValue(), '缩短后\n后到的转写')
  checks.push('typing during ASR and overflowing append preserve both texts; shortening permits retry')
  stage = 'hold pointer ownership'
  await pet.evaluate(async () => { const settings = await window.companionSettings.get(); await window.companionSettings.update({ microphone: { ...settings.microphone, mode: 'hold' } }) })
  await idle(); const at = await point(mic)
  await mouse('mouseDown', at, 'right'); await pause(250); await mouse('mouseUp', at, 'right'); await idle()
  const submitsBeforeCancel = await app.evaluate(() => globalThis.petDraftSubmits)
  await mouse('mouseDown', at); await recording()
  // A real lostpointercapture event is dispatched by Chromium after release.
  await mic.evaluate(element => element.releasePointerCapture(1)); await idle(); await tracksEnded()
  await mouse('mouseUp', at)
  assert.equal(await app.evaluate(() => globalThis.petDraftSubmits), submitsBeforeCancel)
  checks.push('hold ignores secondary button and cancels capture loss without submitting audio')
  stage = 'hold pointer release'
  await mouse('mouseDown', await point(mic)); await recording(); await mouse('mouseUp', await point(mic)); await complete('鼠标按住说话')
  await click(pet.getByRole('button', { name: '放弃这段', exact: true }))
  assert.equal(await input.inputValue(), '缩短后\n后到的转写')
  checks.push('primary hold releases into transcription; explicit discard preserves typed draft')
  stage = 'hold keyboard and blur'
  await focusMic(); await pet.keyboard.down('Space'); await recording(); await pet.keyboard.down('Space')
  await input.focus(); await idle(); await pet.keyboard.up('Space'); await tracksEnded()
  await input.fill(''); await focusMic(); await pet.keyboard.down('Enter'); await recording()
  await pet.keyboard.up('Enter'); await complete('键盘按住说话')
  assert.equal(await input.inputValue(), '键盘按住说话')
  checks.push('hold Space blur cancels; held Enter releases into transcription')
  stage = 'automatic limit releases hold ownership'
  await input.fill(''); await focusMic(); await pet.keyboard.down('Space'); await recording()
  // Exercise the exact worklet limit callback without a 30-second wait.
  await pet.evaluate(() => window.petDraftNode.port.onmessage(new MessageEvent('message', { data: 'limit' })))
  await pet.keyboard.up('Space'); await input.focus(); await complete('达到时限的转写')
  assert.equal(await input.inputValue(), '达到时限的转写')
  await focusMic(); await pet.keyboard.down('Space'); await recording(); await pet.keyboard.up('Space'); await complete('下一段')
  await click(pet.getByRole('button', { name: '放弃这段', exact: true }))
  checks.push('simulated worklet duration-limit signal keeps transcription and allows the next held recording')
  stage = 'clear chat removes staged transcript'
  await click(pet.getByTestId('pet-chat-send'))
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-chat-turn"]')?.dataset.status === 'complete')
  await input.fill('新的草稿'); await focusMic(); await pet.keyboard.down('Space'); await recording(); await pet.keyboard.up('Space'); await complete('待清理')
  await click(pet.getByTestId('pet-chat-clear'))
  assert.equal(await input.inputValue(), ''); assert.equal(await candidate.count(), 0); assert.equal(await pet.getByTestId('pet-chat-turn').count(), 0)
  await tracksEnded(); assert.equal(await readFile(manuscript, 'utf8'), body); assert.deepEqual(errors, [])
  checks.push('clear chat clears transcript candidate and draft; all tracks ended; synthetic manuscript unchanged')
  await pet.screenshot({ path: join(output, 'cleared-chat.png') })
  passed = true
} catch (error) {
  failure = error.stack || String(error); await pet?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  const petHtml = await readFile(join(build, 'renderer/pet.html'), 'utf8')
  const buildFiles = ['main/index.js', 'preload/desktop-pet.cjs', 'renderer/pet.html', ...Array.from(petHtml.matchAll(/(?:src|href)="\.\/([^"\s]+)"/g), match => `renderer/${match[1]}`)]
  const fingerprints = Object.fromEntries(await Promise.all(buildFiles.map(async file => [file, createHash('sha256').update(await readFile(join(build, file))).digest('hex')])))
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, stage, failure, checks, errors, profile, build, environment, fingerprints }, null, 2))
  if (app) await app.close().catch(() => {})
}
console.log(JSON.stringify({ passed, stage, failure, checks, output }))
