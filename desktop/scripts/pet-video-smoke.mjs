import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
const require = createRequire(import.meta.url); require('tsx/cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { defaultCompanionSettings } = require('../src/contracts/companion/companion-settings.ts')
const build = resolve(process.argv[2] || 'out-pet-video-check')
const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-pet-video-')), profile = join(root, 'profile')
const output = resolve('artifacts/ui/pet-video'); await mkdir(output, { recursive: true })
await new ProjectService(new SettingsStore(profile, { available: () => false, encrypt: () => '', decrypt: () => '' })).create({ parentPath: root, title: '透明视频隔离验证' })
const preferences = defaultCompanionSettings()
preferences.revision = 1; preferences.voice = { ...preferences.voice, mute: true, textModel: false, preload: false, proactive: false }
await writeFile(join(profile, 'companion-settings.json'), JSON.stringify(preferences))
const manifest = JSON.parse(await readFile('src/renderer/assets/visuals/pet-videos/manifest.json', 'utf8'))
const env = { ...process.env, LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(root, 'global') }
delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (key.startsWith('LANJIAN_SMOKE') || key.startsWith('LANJIAN_CAPTURE')) delete env[key]
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = [], media = [], errors = []
const fingerprints = {}
for (const path of [join(build, 'main/index.js'), 'src/renderer/assets/visuals/pet-videos/manifest.json', 'src/renderer/features/companion/components/DesktopPetArtwork.vue', 'src/renderer/features/companion/services/pet-video-player.ts']) fingerprints[path] = createHash('sha256').update(await readFile(path)).digest('hex')
let viewport
let app, page, passed = false
function pixelStats(element) {
  const video = [...element.querySelectorAll('video')].find(v => v.style.visibility === 'visible')
  if (!video || video.readyState < 2) return null
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let zero = 0, opaque = 0, partial = 0
  for (let i = 3; i < pixels.length; i += 4) { if (!pixels[i]) zero++; else if (pixels[i] === 255) opaque++; else partial++ }
  return { clip: element.dataset.clip, width: canvas.width, height: canvas.height, time: video.currentTime, duration: video.duration, paused: video.paused, loop: video.loop, muted: video.muted, zero, opaque, partial }
}
try {
  app = await _electron.launch({ args: [join(build, 'main/index.js')], env, timeout: 30_000 })
  page = await app.firstWindow(); page.setDefaultTimeout(20_000)
  page.on('pageerror', e => errors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL())); w.setSize(1280, 980); w.show(); w.focus() })
  await page.getByTestId('app-boot-enter').click({ timeout: 90_000 })
  await page.getByTestId('app-boot').waitFor({ state: 'detached', timeout: 120_000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByTestId('library-continue-writing').click()
  await page.getByTestId('external-companion').click()
  let pet
  for (let i = 0; i < 150 && !pet; i++) { pet = app.windows().find(w => /pet\.html/.test(w.url())); if (!pet) await pause(100) }
  assert.ok(pet); pet.on('pageerror', e => errors.push(e.message))
  await pet.waitForFunction(() => document.querySelector('[data-testid="pet-artwork"]')?.dataset.ready === 'true')
  const actual = await pet.getByTestId('pet-artwork').evaluate(pixelStats)
  assert.ok(actual.zero > 300000 && actual.opaque > 30000 && actual.partial > 0)
  await pet.screenshot({ path: join(output, 'native-pet.png') }); checks.push('detached pet decodes genuine transparent video')
  await pet.evaluate(() => window.desktopPet.command({ type: 'settings' }))
  const settings = page.getByTestId('desktop-pet-settings'), art = page.getByTestId('pet-action-preview').getByTestId('pet-artwork')
  await settings.waitFor(); await settings.scrollIntoViewIfNeeded()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL())); w.show(); w.focus() })
  assert.equal(await page.getByTestId('pet-preview-handshake').count(), 0)
  async function choose(id) {
    await page.getByTestId('pet-preview-' + id).click()
    await page.waitForFunction(id => { const a = document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]'); return a?.dataset.clip === id && a.dataset.ready === 'true' && a.dataset.assetError === 'false' }, id)
  }
  for (const [id, clip] of Object.entries(manifest)) {
    await choose(id); await pause(130)
    const stats = await art.evaluate(pixelStats)
    assert.equal(stats.clip, id); assert.equal(stats.width, 960); assert.equal(stats.height, 960)
    assert.ok(stats.zero > 300000 && stats.opaque > 30000 && stats.partial > 0, id + ' real alpha')
    assert.equal(stats.muted, true); assert.equal(stats.loop, clip.loop)
    assert.ok(Math.abs(stats.duration - clip.durationMs / 1000) < .03)
    assert.ok(stats.time > 0 && !stats.paused, id + ' actually advances')
    media.push(stats)
  }
  checks.push('all 17 packaged clips decode alpha and advance at real duration; handshake excluded')
  await choose('stretch')
  await pause(7200); assert.equal(await art.getAttribute('data-clip'), 'stretch')
  await page.waitForFunction(() => document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]')?.dataset.clip === 'idle')
  checks.push('7.79 second stretch finishes naturally before returning')
  // Native visibility is checked separately by pet-visibility-smoke.mjs.
  // Playwright's focus override prevents this process from observing a real hidden document.
  await choose('idle')
  await settings.getByRole('button', { name: '动作与提醒', exact: true }).click()
  const reduced = settings.getByRole('checkbox', { name: /减少动画/ })
  await reduced.check(); await pause(250)
  const still = await art.evaluate(pixelStats); assert.equal(still.paused, true); assert.equal(still.time, 0)
  await pause(250); assert.equal((await art.evaluate(pixelStats)).time, 0)
  await reduced.uncheck(); await pause(250); assert.equal((await art.evaluate(pixelStats)).paused, false)
  checks.push('reduced motion is a real stationary frame')
  await page.evaluate(() => { for (const id of ['stretch', 'greet', 'drinking']) document.querySelector('[data-testid="pet-preview-' + id + '"]').click() })
  await page.waitForFunction(() => document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]')?.dataset.clip === 'drinking')
  assert.ok(await art.locator('video').count() <= 2); checks.push('rapid replacement keeps newest action and bounded decoders')
  await art.evaluate(el => { const v = [...el.querySelectorAll('video')].find(v => v.style.visibility === 'visible'); v.src = 'file:///nonexistent-pet-fixture.webm'; v.load() })
  await page.waitForFunction(() => document.querySelector('[data-testid="pet-action-preview"] [data-testid="pet-artwork"]')?.dataset.assetError === 'true')
  await art.locator('img').waitFor(); await choose('idle'); checks.push('injected media failure shows poster and next action recovers')
  await page.screenshot({ path: join(output, 'settings-videos.png') })
  viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  viewport.zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !/pet\.html/.test(w.webContents.getURL())).webContents.getZoomFactor())
  assert.deepEqual(errors, []); passed = true
} finally {
  if (!passed && page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed, build, root, fingerprints, checks, media, errors, viewport, date: new Date().toISOString() }, null, 2))
  if (app) await app.close().catch(() => {})
}
console.log(JSON.stringify({ passed, output, checks, clips: media.length }))
