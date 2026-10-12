import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createPetVideoPlayer, type PetVideoState } from '../../../src/renderer/features/companion/services/pet-video-player'
import { petVideoAvailable, petVideoClip } from '../../../src/renderer/features/companion/services/pet-video-assets'
import { petPlaybackDuration } from '../../../src/renderer/features/companion/services/pet-action-motion'
import manifest from '../../../src/renderer/assets/visuals/pet-videos/manifest.json'

class Video extends EventTarget {
  src = ''; muted = false; defaultMuted = false; playsInline = false; preload = ''; loop = false
  style = { visibility: '' }; dataset: Record<string, string> = {}; paused = true; currentTime = 0; readyState = 2
  removed = false; failPlay = false; loads = 0; deferred?: { promise: Promise<void>; reject(reason: Error): void }
  setAttribute() {}
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  load() { this.loads++ }
  play() { this.paused = false; return this.deferred?.promise ?? (this.failPlay ? Promise.reject(new Error('decode')) : Promise.resolve()) }
  pause() { this.paused = true }
  remove() { this.removed = true }
}
function fixture() {
  const videos: Video[] = [], states: PetVideoState[] = [], starts: [string, number][] = []
  const player = createPetVideoPlayer({ appendChild() {} } as unknown as HTMLElement, {
    state: value => states.push(value), started: (intent, action) => starts.push([intent, action])
  }, () => { const video = new Video(); videos.push(video); return video as unknown as HTMLVideoElement })
  const select = (intent: Parameters<typeof petVideoClip>[0], action = 1) => player.select(petVideoClip(intent), intent, action)
  const loaded = () => videos.at(-1)!.dispatchEvent(new Event('loadeddata'))
  return { player, videos, states, starts, select, loaded, state: () => states.at(-1)! }
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('pending media keeps the visible pose; newest request owns selection and old decoders are released', async () => {
  const h = fixture()
  try {
    h.select('idle'); h.loaded(); await flush()
    const idle = h.videos[0]!
    h.select('greet', 2); const stale = h.videos[1]!
    assert.equal(h.state().clip, 'idle'); assert.equal(idle.removed, false); assert.equal(idle.paused, true)
    h.select('pat', 3); stale.dispatchEvent(new Event('loadeddata')); await flush()
    assert.equal(h.state().clip, 'idle'); assert.equal(stale.removed, true)
    h.loaded(); await flush()
    assert.equal(h.state().clip, 'pat'); assert.deepEqual(h.starts, [['idle', 1], ['pat', 3]])
    assert.equal(idle.removed, true); assert.equal(idle.src, '')
    assert.equal(h.videos.filter(video => !video.removed).length, 1)
  } finally { h.player.dispose() }
  assert.ok(h.videos.every(video => video.removed && video.paused && !video.src))
})

test('load errors and timeouts preserve current imagery and allow a later retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = fixture()
  try {
    h.select('idle'); h.loaded(); await flush()
    h.select('drinking'); h.videos.at(-1)!.dispatchEvent(new Event('error'))
    assert.equal(h.state().failed, true); assert.equal(h.state().clip, 'idle'); assert.equal(h.state().ready, true)
    h.select('greet'); t.mock.timers.tick(12_000)
    assert.equal(h.state().failed, true); assert.equal(h.videos.at(-1)!.removed, true)
    h.select('pat'); h.loaded(); await flush()
    assert.equal(h.state().failed, false); assert.equal(h.state().clip, 'pat')
  } finally { h.player.dispose() }
})

test('hidden media pauses in place, reduced motion seeks a still, and resume never restarts action timers', async () => {
  const h = fixture()
  try {
    h.select('listening'); h.loaded(); await flush()
    const video = h.videos[0]!; video.currentTime = 2
    h.player.activity({ hidden: true, reduced: false })
    assert.equal(video.paused, true); assert.equal(video.currentTime, 2)
    h.player.activity({ hidden: false, reduced: false }); await flush()
    assert.equal(video.paused, false); assert.equal(video.currentTime, 2); assert.equal(h.starts.length, 1)
    h.player.activity({ hidden: false, reduced: true })
    assert.equal(video.paused, true); assert.equal(video.currentTime, 0)
    h.select('stretch'); h.loaded(); await flush()
    assert.equal(h.videos.at(-1)!.paused, true)
    h.player.activity({ hidden: false, reduced: false }); await flush()
    assert.equal(h.videos.at(-1)!.paused, false); assert.equal(h.starts.length, 2)
  } finally { h.player.dispose() }
})

test('pause-induced play rejection is harmless; real playback failure returns to poster state', async () => {
  const h = fixture()
  try {
    h.select('idle'); const first = h.videos[0]!
    let reject!: (reason: Error) => void
    first.deferred = { promise: new Promise<void>((_, failure) => { reject = failure }), reject: error => reject(error) }
    h.loaded(); h.player.activity({ hidden: true, reduced: false }); reject(new Error('AbortError')); await flush()
    assert.equal(h.state().failed, false); assert.equal(h.state().ready, true)
    h.select('pat'); const next = h.videos.at(-1)!; next.failPlay = true
    h.player.activity({ hidden: false, reduced: false }); h.loaded(); await flush()
    assert.equal(h.state().failed, true); assert.equal(h.state().ready, false); assert.equal(next.removed, true)
  } finally { h.player.dispose() }
})

test('unmount cancels a late decode and its timeout without publishing new state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = fixture(); h.select('stretch'); const count = h.states.length
  h.player.dispose(); h.loaded(); t.mock.timers.tick(20_000)
  assert.equal(h.states.length, count); assert.equal(h.starts.length, 0); assert.ok(h.videos[0]!.removed)
})

test('shipped files bind the 17 verified clips and their real durations; rejected handshake has no asset', () => {
  assert.equal(Object.keys(manifest).length, 17)
  assert.equal(petVideoAvailable('handshake'), false); assert.equal(petVideoClip('handshake').id, 'idle')
  for (const [id, entry] of Object.entries(manifest)) {
    const data = readFileSync(new URL('../../../src/renderer/assets/visuals/pet-videos/' + entry.file, import.meta.url))
    assert.equal(data.length, entry.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256)
    assert.equal(entry.durationMs, entry.frames / entry.fps * 1000)
    const intent = id as keyof typeof manifest, clip = petVideoClip(intent)
    assert.equal(clip.frames, entry.frames); assert.equal(clip.loop, entry.loop)
    assert.ok(petPlaybackDuration(intent) >= entry.durationMs, id + ' must not be cut short')
  }
  assert.equal(manifest.land.loop, false); assert.equal(manifest.blink.loop, false)
  assert.ok(petPlaybackDuration('stretch') > 7800)
})
