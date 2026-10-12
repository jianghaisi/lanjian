import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { _electron } from 'playwright'

const build = resolve(process.argv[2] || 'out-interaction-sound')
const entryOnly = process.argv.includes('--entry-only')
const holdModels = process.argv.includes('--hold-models')
const recordBoot = process.argv.includes('--record-boot')
const html = await readFile(join(build, 'renderer/index.html'), 'utf8')
const buildFiles = ['main/index.js', 'renderer/index.html', 'renderer/sounds/v1/manifest.json',
  ...[...html.matchAll(/src="([^"]+\.js)"/g)].map(match => `renderer/${match[1].replace(/^\.\//, '')}`)]
const fingerprint = Object.fromEntries(await Promise.all(buildFiles.map(async path => [path, createHash('sha256').update(await readFile(join(build, path))).digest('hex')])))
const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-ui-sound-')))
const output = resolve('../.trellis/tasks/10-02-v3-interaction-sound-effects/research', `native-${Date.now()}`)
await mkdir(output, { recursive: true })
const env = { ...process.env, LANJIAN_USER_DATA_PATH: join(root, 'profile'), LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'models') }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.LANJIAN_SMOKE
const app = await _electron.launch({ args: [join(build, 'main/index.js')], env })
const checks = [], errors = [], samples = {}
let page, owner
function probeAudio() {
  const probe = window.__soundProbe = { events: [], decoded: [], peak: 0, states: [], taps: [], bootWindows: [], sync: [] }
  const sources = []
  const bytes = new WeakMap(), buffers = new WeakMap()
  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
    const arrayBuffer = response.arrayBuffer.bind(response)
    response.arrayBuffer = async () => { const data = await arrayBuffer(); bytes.set(data, String(args[0])); return data }
    return response
  }
  const decode = BaseAudioContext.prototype.decodeAudioData
  BaseAudioContext.prototype.decodeAudioData = async function(data, ...args) {
    const buffer = await decode.call(this, data, ...args)
    const file = bytes.get(data) || 'unidentified'
    buffers.set(buffer, file); probe.decoded.push(file)
    return buffer
  }
  const connect = AudioNode.prototype.connect
  const outputs=new WeakMap()
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination instanceof AudioDestinationNode) {
      let tap=outputs.get(this.context)
      if(!tap){tap=this.context.createAnalyser();tap.fftSize=512;outputs.set(this.context,tap);connect.call(tap,destination);probe.taps.push(tap)}
      connect.call(this, tap)
      return destination
    }
    return connect.call(this, destination, ...args)
  }
  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
  AudioBufferSourceNode.prototype.start = function(...args) {
    const file = buffers.get(this.buffer) || 'unidentified'
    const record = { id: file.split('/').at(-1).slice(0, 3), file, loop: this.loop, state: this.context.state,
      duration: this.buffer?.duration, offset: args[1] ?? 0, at: performance.now(), contextAt: this.context.currentTime, stops: [], ended: false, stopped: false }
    this.__soundRecord = record; probe.events.push(record)
    sources.push(this)
    this.addEventListener('ended', () => { record.ended = true; record.endedAt = performance.now() }, { once: true })
    return start.apply(this, args)
  }
  AudioBufferSourceNode.prototype.stop = function(...args) {
    if (this.__soundRecord) { this.__soundRecord.stopped = true; this.__soundRecord.stopAt = performance.now() + Math.max(0, (args[0] ?? this.context.currentTime) - this.context.currentTime)*1000; this.__soundRecord.stops.push(this.__soundRecord.stopAt) }
    return stop.apply(this, args)
  }
  const data = new Float32Array(512), mixed = new Float32Array(512)
  let sampled = 0
  setInterval(() => {
    mixed.fill(0)
    for (const tap of probe.taps) {
      tap.getFloatTimeDomainData(data)
      for (let i = 0; i < data.length; i++) { probe.peak = Math.max(probe.peak, Math.abs(data[i])); mixed[i] += data[i] }
    }
    const boot = document.querySelector('[data-cinematic-time]')
    if (boot && performance.now() - sampled >= 100) {
      sampled = performance.now()
      probe.bootWindows.push({ time: Number(boot.getAttribute('data-cinematic-time')), at: sampled,
        rms: Math.sqrt(mixed.reduce((sum, value) => sum + value*value, 0)/mixed.length) })
    }
  }, 16)
  new MutationObserver(() => {
    const boot = document.querySelector('[data-cinematic-time]')
    if (!boot) return
    const time = Number(boot.dataset.cinematicTime), waiting = boot.hasAttribute('data-array-wait'), wait = Number(boot.dataset.arrayWait)
    const handoff = Number(boot.querySelector('[data-handoff-time]')?.dataset.handoffTime ?? -1)
    const id = handoff >= 0 ? 'B19' : time < 12 ? 'B15' : waiting || time < 20 ? 'B16' : time < 33 ? 'B17' : 'B18'
    if (id === 'B18') return
    const source = sources.findLast(source => source.__soundRecord.id === id && !source.__soundRecord.stopped && !source.__soundRecord.ended)
    if (!source) return
    const record = source.__soundRecord, stamp = source.context.getOutputTimestamp(), now = performance.now()
    if (!stamp.contextTime || !stamp.performanceTime) return
    const output = stamp.contextTime + (now-stamp.performanceTime)/1000
    if (output < record.contextAt) return // The new source has not reached output yet.
    let audio = record.offset+output-record.contextAt
    const visual = id === 'B16' ? (waiting ? wait%8 : time-12) : id === 'B17' ? time-20 : id === 'B19' ? handoff : time
    if (source.loop) audio = ((audio%record.duration)+record.duration)%record.duration
    let error = audio-visual
    if (source.loop) error = ((error+record.duration*1.5)%record.duration)-record.duration/2
    probe.sync.push({id,time,wait:waiting?wait:null,handoff,audio,visual,error,at:now,outputLead:source.context.currentTime-output})
  }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-cinematic-time','data-array-wait','data-handoff-time']})
  window.__startSoundRecording = async () => {
    const video = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:false})
    const context = probe.taps[0].context, mixed = context.createMediaStreamDestination()
    for (const tap of probe.taps) tap.connect(mixed)
    // All opening movements share this context. Include later destination taps.
    const push = probe.taps.push.bind(probe.taps)
    probe.taps.push = (...taps) => { for(const tap of taps) tap.connect(mixed); return push(...taps) }
    const stream = new MediaStream([...video.getVideoTracks(),...mixed.stream.getAudioTracks()])
    const recorder = new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9,opus',videoBitsPerSecond:3000000})
    const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data)
    recorder.start(1000)
    window.__stopSoundRecording=()=>new Promise(resolve=>{
      recorder.onstop=async()=>{
        const bytes=new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer())
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
        for(const track of stream.getTracks())track.stop()
        mixed.disconnect();resolve(btoa(binary))
      };recorder.stop()
    })
  }
}
async function capture(name) {
  await page.screenshot() // Flush current paint before the native capture at Windows zoom.
  const png = await owner.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
const count = async id => page.evaluate(id => window.__soundProbe.events.filter(e => !id || e.id === id).length, id)
async function waitCue(id, after) { await page.waitForFunction(({ id, after }) => window.__soundProbe.events.filter(e => e.id === id).length > after, { id, after }) }
async function silence() { await page.waitForFunction(() => window.__soundProbe.events.every(e => e.ended), undefined, { timeout: 4000 }) }
async function settle() { await page.waitForTimeout(110) }
try {
  page = await app.firstWindow({ timeout: 60000 }); owner = await app.browserWindow(page)
  if (recordBoot) await app.evaluate(({desktopCapturer,BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0]
    const sourceId = win.getMediaSourceId()
    let capturePending=true
    globalThis.__captureDebug = {sourceId,permissions:[],sources:[]}
    // Test-only isolated session, restricted to capture of this synthetic window.
    // The product's permission policy and author's normal profile stay untouched.
    win.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>{globalThis.__captureDebug.permissions.push({permission,mediaTypes:details.mediaTypes});callback(capturePending&&contents===win.webContents&&(permission==='display-capture'||permission==='media'&&details.mediaTypes?.length===0))})
    win.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({types:['window']})
      globalThis.__captureDebug.sources=sources.filter(source=>source.id===sourceId).map(source=>({id:source.id}))
      const source = sources.find(source=>source.id===sourceId)
      capturePending=false
      callback(source?{video:source}:{})
    })
  })
  page.setDefaultTimeout(20000)
  page.on('pageerror', e => errors.push(e.message))
  await owner.evaluate(win => { win.setContentSize(1440, 900); win.show(); win.focus() })
  await page.waitForFunction(() => !!window.novelDesktop)
  if (holdModels) await app.evaluate(({ ipcMain }) => {
    // Isolated readiness fixture, not a real inference claim. Keep actual visual clocks/audio.
    const prepared = new Promise(resolve => { globalThis.__releaseSoundWarmup = () => resolve(true) })
    ipcMain.removeHandler('companion-voice:warmup')
    ipcMain.handle('companion-voice:warmup', async () => ({ ok: true, value: await prepared }))
  })
  await page.evaluate(async ({ entryOnly, holdModels }) => {
    await window.companionSettings.update({ voice: { mute: !holdModels, textModel: false, preload: holdModels, proactive: false }, careEnabled: false })
    await window.novelDesktop.companionVoice.configure({ textModel: false, speechModel: holdModels, preload: holdModels, voice: 'ningguang' })
    localStorage.setItem('lanjian-loading-v1', JSON.stringify({ theme: 'impact', bootStyle: entryOnly ? 'brief' : 'cinematic', bootPalette: 'dark' }))
    localStorage.setItem('lanjian-theme', 'moye')
  }, { entryOnly, holdModels })
  const book = await page.evaluate(async root => {
    const { project } = await window.novelDesktop.projects.create({ parentPath: root, name: 'SoundCheck', title: '音效验证档案' })
    const chapter = await window.novelDesktop.chapters.create()
    await window.novelDesktop.chapters.update(chapter.id, { title: '第一章', content: '界面声音不应修改这份正文。', expectedRevision: chapter.revision })
    return project
  }, root)
  const manuscripts = []
  for (const name of await readdir(join(book.path, '正文'))) if (name.endsWith('.md')) {
    const path = join(book.path, '正文', name); manuscripts.push({ path, bytes: await readFile(path) })
  }
  assert.equal(manuscripts.length, 1)
  await page.addInitScript(probeAudio)
  await page.reload()
  await owner.evaluate(win => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
  if (!entryOnly) {
  await page.waitForFunction(() => document.querySelector('[data-testid="app-boot"]')?.classList.contains('motion-ready'))
  if(recordBoot){await page.waitForFunction(()=>window.__soundProbe.taps.length>0);await page.evaluate(()=>window.__startSoundRecording())}
  await waitCue('V01', 0) // No mouse or keyboard gesture precedes cold startup audio.
  assert.equal(await count('V01'), 1)
  await page.waitForFunction(() => window.__soundProbe.peak > .001)
  if (holdModels) {
    await page.waitForFunction(() => Number(document.querySelector('[data-array-wait]')?.getAttribute('data-array-wait')) >= 17, undefined, { timeout: 180000 })
    samples.waiting = await page.evaluate(() => ({ elapsed: Number(document.querySelector('[data-array-wait]').getAttribute('data-array-wait')), sources: window.__soundProbe.events.filter(e => e.id === 'B16') }))
    assert.equal(samples.waiting.sources.filter(source=>!source.stopped).length, 1, 'one current original musical wave source')
    assert.equal(await count('B17'), 0, 'resolve must wait for real readiness')
    await app.evaluate(() => globalThis.__releaseSoundWarmup())
    checks.push('extended-real-animation-wait-uses-one-wave-loop-and-defers-resolve-until-ready')
  }
  // Actual document.hidden is checked by the companion direct-Electron harness;
  // Playwright's focus emulation masks native visibility even after a window hide.
  await page.getByTestId('app-boot-enter').waitFor({ timeout: 180000 })
  await waitCue('B18', 0)
  await page.waitForTimeout(1100) // Idle remains a quiet loop, never another resolve.
  await page.getByTestId('app-boot-enter').click()
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  if(recordBoot){const encoded=await page.evaluate(()=>window.__stopSoundRecording());await writeFile(join(output,'synchronized-boot.webm'),Buffer.from(encoded,'base64'))}
  const boot = await page.evaluate(() => ({ events: window.__soundProbe.events, peak: window.__soundProbe.peak, windows: window.__soundProbe.bootWindows, sync: window.__soundProbe.sync }))
  samples.boot = boot
  assert.equal(boot.events.filter(e => e.id === 'V01').length, 1)
  for (const id of ['B15', 'B16', 'B17', 'B18', 'B19']) assert.ok(boot.events.some(e => e.id === id), id)
  assert.ok(boot.events.every(e => !/^B(0[1-9]|1[0-4])$/.test(e.id)), 'old fragments are retired')
  assert.ok(boot.events.every(e => e.state === 'running'))
  const beds = ['B15', 'B16', 'B17', 'B18'].map(id => {
    const events = boot.events.filter(event => event.id === id)
    if(id==='B18')assert.equal(events.length,1,id)
    else if(id==='B16')assert.equal(events.length,1,id)
    else for(let i=1;i<events.length;i++)assert.ok(events[i].offset>events[i-1].offset,`${id} drift correction must seek forward within the movement, never replay its beginning`)
    assert.equal(events[0].loop, id === 'B16' || id === 'B18', `${id}: only waiting movements loop`)
    assert.ok(events[0].ended, `${id}: must finish on handoff`)
    return events[0]
  })
  for (let i = 1; i < beds.length; i++) {
    const outgoing=boot.events.findLast(event=>event.id===beds[i-1].id)
    assert.ok(outgoing.stops.some(at=>at-beds[i].at>700),'phase transition initially schedules the complete overlap; a clock correction may supersede it')
  }
  const brand = boot.events.find(event => event.id === 'V01')
  let coveredUntil=brand.at
  for(const event of boot.events.filter(event=>event.id==='B15'))if(event.at<=coveredUntil)coveredUntil=Math.max(coveredUntil,event.stopAt??event.endedAt)
  assert.ok(coveredUntil>brand.endedAt, 'the union of original/corrected score sources covers the entire brand without a gap')
  const sustained = boot.windows.filter(window => window.time >= 1.3 && window.time < 32)
  assert.ok(sustained.length > 100)
  assert.ok(sustained.every(window=>window.rms>1e-6),'no actual zero-signal gap between visible stages')
  assert.ok(!sustained.some((window,i)=>i&&window.rms<.0003&&sustained[i-1].rms<.0003),'no sustained quiet gap; a single 10ms mono sample near a zero crossing is not a stage disconnect')
  for(const id of ['B15','B16','B17','B19']){
    const frames=boot.sync.filter(frame=>frame.id===id)
    assert.ok(frames.length>10,`${id} needs real rendered/output clock samples`)
    const errors=frames.map(frame=>Math.abs(frame.error)).sort((a,b)=>a-b)
    assert.ok(errors[Math.floor(errors.length*.95)]<.06,`${id} output/visual p95 ${errors[Math.floor(errors.length*.95)]}`)
  }
  const landmarks={B15:[1,3.05,5,8.79,9.25,11.79]}
  samples.synchronization=[]
  for(const [id,positions] of Object.entries(landmarks))for(const position of positions){
    const frames=boot.sync.filter(frame=>frame.id===id&&Math.abs(frame.visual-position)<.025)
    assert.ok(frames.length,`${id} ${position}: missing landmark frames`)
    const maxErrorMs=Math.max(...frames.map(frame=>Math.abs(frame.error)*1000))
    // A correction cannot retract audio already queued at the device. Keep the
    // steady-state p95 assertion above, and bound a stalled action by the 50ms
    // seek threshold + measured output queue + one 60Hz presentation frame.
    assert.ok(frames.every(frame=>Math.abs(frame.error)*1000<50+Math.max(0,frame.outputLead*1000)+1000/60),`${id} ${position}: ${maxErrorMs}ms exceeds correction/output budget`)
    samples.synchronization.push({id,position,frames:frames.length,maxErrorMs})
  }
  for(const id of ['B15','B16','B17']){
    const frames=boot.sync.filter(frame=>frame.id===id)
    for(let i=0;i<frames.length;i++)if(Math.abs(frames[i].error)>.08){
      const recovered=frames.slice(i+1).find(frame=>Math.abs(frame.error)<.05)
      assert.ok(recovered&&recovered.at-frames[i].at<150,`${id}: failed to catch up after a long frame / phase change`)
    }
  }
  checks.push('rendered-frame-versus-device-output-position-p95-below-60ms')
  checks.push('prelude-landmarks-within-measured-output-correction-budget-and-clock-jump-recovery-within-150ms')
  checks.push('cold-start-file-audio-running-nonzero-output-single-brand-and-handoff')
  checks.push('complete-prelude-and-resolve-single-play-eight-second-wave-quiet-idle-and-brand-overlap')
  console.log('PASS cold startup audio and handoff')
  } else {
    await page.getByTestId('app-boot-enter').click()
    await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  }

  const settings = page.getByRole('button', { name: '设置', exact: true })
  await settings.click(); await page.getByTestId('library-settings-sound').click(); await settle()
  const sounds = page.getByTestId('sound-preferences')
  assert.equal(await sounds.getByTestId('sound-enabled').isChecked(), true)
  assert.equal(await sounds.getByTestId('sound-volume').inputValue(), '60')
  assert.equal(await sounds.getByTestId('sound-hover').isChecked(), false)
  await capture('01-library-sound-settings')
  let before = await count('V01')
  await sounds.getByTestId('sound-preview-brand').click(); await waitCue('V01', before)
  await sounds.getByTestId('sound-preview-stop').click(); await silence()
  before = await count('V01')
  await settle(); await sounds.getByTestId('sound-preview-brand').click(); await waitCue('V01', before)
  await page.getByTestId('library-settings-opening').click(); await silence()
  checks.push('explicit-preview-stop-and-v-show-page-leave-stop')

  await page.getByTestId('library-settings-sound').click(); await settle()
  await sounds.locator('summary').click()
  await sounds.getByTestId('sound-waiting').check(); await settle()
  await page.getByTestId('library-settings-opening').click(); await settle()
  before = await count('L02')
  await page.getByTestId('loader-preview-work').click(); await waitCue('L02', before)
  assert.equal(await page.evaluate(() => window.__soundProbe.events.filter(e => e.loop && !e.ended).length), 1)
  await page.getByTestId('cancel-workspace-loading').click(); await silence()
  assert.equal(await page.evaluate(() => window.__soundProbe.events.filter(e => e.loop && !e.ended).length), 0)
  checks.push('opt-in-wait-loop-ends-on-preview-close')

  await page.getByTestId('library-settings-sound').click(); await settle()
  await sounds.getByTestId('sound-hover').check(); await settle()
  before = await count('U01')
  await page.getByTestId('library-settings-appearance').hover(); await waitCue('U01', before)
  await page.getByTestId('library-settings-appearance').click(); await settle()
  await page.getByTestId('library-settings-opening').focus(); await silence(); await settle()
  before = await count('U05')
  await page.keyboard.press('Enter'); await waitCue('U05', before); await settle()
  assert.equal(await count('U05'), before + 1)
  await page.keyboard.press('Enter'); await settle()
  assert.equal(await count('U05'), before + 1)
  checks.push('opt-in-hover-and-single-native-keyboard-navigation-no-repeat-on-selected-tab')

  await page.getByTestId('library-settings-sound').click(); await settle()
  await sounds.getByTestId('sound-hover').uncheck()
  await sounds.getByTestId('sound-enabled').uncheck(); await silence()
  before = await count()
  await sounds.getByTestId('sound-preview-brand').click(); await settle()
  assert.equal(await count(), before)
  await page.reload(); await owner.evaluate(win => { if (win.isMinimized()) win.restore(); win.show(); win.focus() }); await page.waitForTimeout(2200)
  assert.equal(await count(), 0, 'saved mute must precede startup')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await settings.click(); await page.getByTestId('library-settings-sound').click()
  assert.equal(await sounds.getByTestId('sound-enabled').isChecked(), false)
  await sounds.getByTestId('sound-enabled').check()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await owner.evaluate(win => { win.setContentSize(1100, 760); win.webContents.setZoomFactor(1.25) })
  await capture('02-compact-sound-settings')
  assert.equal(await sounds.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true)
  checks.push('master-mute-before-reload-and-shared-settings-compact-125-percent')
  await page.keyboard.press('Escape'); await owner.evaluate(win => { win.setContentSize(1440, 900); win.webContents.setZoomFactor(1) })
  await silence()
  const search = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await search.focus(); before = await count()
  await page.keyboard.type('abcd'); await page.keyboard.press('Backspace')
  await search.dispatchEvent('compositionstart'); await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true }); await search.dispatchEvent('compositionend')
  await settle(); assert.equal(await count(), before)
  await search.fill('')
  checks.push('text-input-and-composition-stay-quiet')

  await settle(); before = await count('U08')
  const ordinaryClicks = await count('U02')
  await page.getByRole('button', { name: /新建空白作品/ }).click()
  await page.locator('.create-book-modal').waitFor(); await waitCue('U08', before); await settle()
  assert.equal(await count('U02'), ordinaryClicks, 'dedicated dialog cue replaces generic click')
  before = await count('U09')
  await page.keyboard.press('Escape'); await page.locator('.create-book-modal').waitFor({ state: 'hidden' }); await waitCue('U09', before)
  checks.push('shared-dialog-open-and-keyboard-close-once-without-generic-click-duplication')

  await page.getByTestId('library-all-works').click(); await settle()
  before = await count('L04')
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.getByTestId('manuscript-input').waitFor({ timeout: 45000 })
  await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  await waitCue('L04', before)
  await settings.click(); await page.getByTestId('settings-nav-appearance').click()
  await page.getByTestId('sound-preferences').waitFor()
  assert.equal(await page.getByTestId('sound-enabled').isChecked(), true)
  assert.equal(await page.getByTestId('sound-waiting').isChecked(), true)
  await capture('03-workbench-sound-settings')
  checks.push('real-book-ready-audio-and-workbench-shares-preferences')
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('library-all-works').click(); await settle()
  const coldStarts = await count('L01'), completions = await count('L04'), confirmations = await count('U03')
  await page.locator('.work-item-open').filter({ hasText: book.title }).click()
  await page.getByTestId('manuscript-input').waitFor(); await page.getByTestId('workspace-loading').waitFor({ state: 'hidden' })
  assert.equal(await count('L01'), coldStarts)
  assert.equal(await count('L04'), completions)
  assert.equal(await count('U03'), confirmations + 1)
  checks.push('quick-return-keeps-one-short-confirmation-without-cold-load-replay')
  for (const item of manuscripts) assert.deepEqual(await readFile(item.path), item.bytes)
  checks.push('synthetic-manuscript-bytes-unchanged')

  const manifest = JSON.parse(await readFile(join(build, 'renderer/sounds/v1/manifest.json'), 'utf8'))
  assert.equal(manifest.length, 23)
  for (const item of manifest) assert.equal(createHash('sha256').update(await readFile(join(build, 'renderer/sounds/v1', item.file))).digest('hex'), item.sha256)
  samples.assets = await page.evaluate(async items => {
    const context = new AudioContext()
    try {
      return await Promise.all(items.map(async item => {
        const bytes = await fetch(new URL(`sounds/v1/${item.file}`, document.baseURI)).then(response => response.arrayBuffer())
        const buffer = await context.decodeAudioData(bytes)
        return { id: item.id, duration: buffer.duration, channels: buffer.numberOfChannels }
      }))
    } finally { await context.close() }
  }, manifest)
  for (const item of samples.assets) { assert.ok(item.duration > 0, item.id); assert.equal(item.channels, 2, item.id) }
  samples.end = await page.evaluate(() => ({ events: window.__soundProbe.events, peak: window.__soundProbe.peak, decoded: window.__soundProbe.decoded }))
  assert.equal(errors.length, 0, errors.join('\n'))
  checks.push('all-23-packaged-resource-hashes-native-decode-and-no-renderer-errors')
  console.log(JSON.stringify({ checks, output }))
} catch (error) {
  errors.push(error.stack || String(error))
  if (page) { samples.failure = await page.evaluate(() => ({ events: window.__soundProbe?.events, decoded: window.__soundProbe?.decoded, peak: window.__soundProbe?.peak, hidden: document.hidden, boot: document.querySelector('[data-cinematic-time]')?.getAttribute('data-cinematic-time'), body: document.body.innerText.slice(0, 1800) })).catch(() => null); await capture('failure').catch(() => {}) }
  console.error(error)
  process.exitCode = 1
} finally {
  if(recordBoot) console.log('Capture setup',await app.evaluate(()=>globalThis.__captureDebug).catch(()=>null))
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, samples, build, fingerprint, entryOnly, holdModels, profile: root,
    note: 'Native decoded audio and analyser output; not a claim of human listening or frame-rate performance.' }, null, 2))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
