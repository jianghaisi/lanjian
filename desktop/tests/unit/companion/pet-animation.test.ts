import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRenderer } from 'vue'
import { usePetAnimation } from '../../../src/renderer/features/companion/composables/use-pet-animation'
import { petActionDuration, petActionRestDuration, petTransitionDuration, petAnimations, petClipLoops, petFrameCount, petPlaybackDuration, resolvePetAnimation, samplePetClip } from '../../../src/renderer/features/companion/services/pet-action-motion'
import registration from '../../../src/renderer/assets/visuals/pet-sequences/registration.json'
import { petFrameDensity } from '../../../src/renderer/features/companion/services/pet-sequence-registration'

test('actions replace immediately without an old timer ending the new action; cancellation and unmount clear playback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
  let animation!: ReturnType<typeof usePetAnimation>
  const app = renderer.createApp({ setup() { animation = usePetAnimation(); return () => null } })
  app.mount({})
  try {
    animation.play('eating'); t.mock.timers.tick(1200)
    animation.play('handshake'); t.mock.timers.tick(1400)
    assert.equal(animation.intent.value, 'handshake')
    assert.equal(animation.sequence.value, 2)
    t.mock.timers.tick(petPlaybackDuration('handshake') - 1400); assert.equal(animation.intent.value, 'idle')
    animation.play('pat'); animation.cancel(); t.mock.timers.tick(petActionDuration)
    assert.equal(animation.intent.value, 'idle')
    animation.play('sleeping')
    t.mock.timers.tick(petPlaybackDuration('sleeping') - 1)
    assert.equal(animation.intent.value, 'sleeping', 'a slower preview must complete its cycle')
    t.mock.timers.tick(1); assert.equal(animation.intent.value, 'idle')
    animation.play('eating'); t.mock.timers.tick(1000)
    animation.started('eating', animation.sequence.value)
    t.mock.timers.tick(2000); assert.equal(animation.intent.value, 'eating', 'actual asset readiness starts its full duration')
    animation.play('handshake')
    animation.started('eating', animation.sequence.value - 1)
    t.mock.timers.tick(petPlaybackDuration('handshake')); assert.equal(animation.intent.value, 'idle', 'stale ready events cannot extend replacement')
    animation.play('sleeping')
  } finally { app.unmount() }
  assert.equal(animation.intent.value, 'idle')
})

test('all 18 actions sample their authored frame counts with matching artwork and motion data', () => {
  assert.equal(petAnimations.length, 18)
  for (const clip of petAnimations) {
    const asset = (registration as Record<string, { size: number[]; density: number; sha256: string; flowSha256: string; frames: { rect: number[]; anchor: number[] }[]; pages?: { file: string; origin: number[]; size: number[]; sha256: string }[] }>)[clip.intent]
    assert.ok(asset, `missing ${clip.intent}`)
    const count = petFrameCount(clip.intent), still = Math.floor(count / 2) - 1
    assert.equal(count, ['idle', 'handshake', 'pat', 'eating', 'drinking', 'greet', 'success', 'warning', 'stretch', 'playing'].includes(clip.intent) ? 16 : 8)
    const artwork = readFileSync(new URL(`../../../src/renderer/assets/visuals/pet-sequences/${clip.intent}.png`, import.meta.url))
    assert.equal(createHash('sha256').update(artwork).digest('hex'), asset.sha256, 'registration must match the shipped artwork')
    for (const page of asset.pages ?? []) {
      const png = readFileSync(new URL(`../../../src/renderer/assets/visuals/pet-sequences/${page.file}`, import.meta.url))
      assert.equal(createHash('sha256').update(png).digest('hex'), page.sha256, `${page.file} must match its registered source`)
    }
    const flow = readFileSync(new URL(`../../../src/renderer/assets/visuals/pet-sequences/${clip.intent}.flow`, import.meta.url))
    assert.equal(flow.length, 32*32*count*2*4)
    assert.equal(createHash('sha256').update(flow).digest('hex'), asset.flowSha256, 'new frame registration requires regenerated motion data')
    for (let offset = 3; offset < flow.length; offset += 4) assert.equal(flow[offset], 255)
    assert.ok(asset.density > 0)
    for (const frame of asset.frames) {
      const [x,y,w,h] = frame.rect
      assert.ok(x >= 0 && y >= 0 && x+w <= asset.size[0] && y+h <= asset.size[1])
      assert.ok(frame.anchor[0] >= 0 && frame.anchor[0] <= w && frame.anchor[1] <= h)
      if (asset.pages) assert.equal(asset.pages.filter(page => x >= page.origin[0] && y >= page.origin[1] && x+w <= page.origin[0]+page.size[0] && y+h <= page.origin[1]+page.size[1]).length, 1, 'each complete drawing must belong to exactly one page')
    }
    for (let time = -50; time <= 6000; time += 13) {
      const frame = samplePetClip(clip.intent, time)
      assert.ok(frame.frame >= 0 && frame.frame < count && frame.next >= 0 && frame.next < count)
      assert.ok(frame.mix >= 0 && frame.mix <= 1)
      assert.deepEqual(samplePetClip(clip.intent, time, true), { frame:still, next:still, mix:0 })
    }
    if (petClipLoops(clip.intent)) assert.deepEqual(samplePetClip(clip.intent, clip.cycle), samplePetClip(clip.intent, 0))
    else assert.deepEqual(samplePetClip(clip.intent, 60_000), { frame:count-1, next:count-1, mix:0 }, `${clip.intent} must finish rather than repeat`)
  }
  assert.deepEqual(samplePetClip('land', 60_000), { frame:7, next:7, mix:0 })
  assert.deepEqual(samplePetClip('eating', NaN), samplePetClip('eating', 0))
})

test('the expanded idle visits every authored pose and blends the last pose back into the first', () => {
  const visited = new Set<number>()
  for (let time = 0; time < 3200; time += 50) visited.add(samplePetClip('idle', time).frame)
  assert.deepEqual([...visited], Array.from({ length: 16 }, (_, index) => index))
  assert.deepEqual(samplePetClip('idle', 3100), { frame: 15, next: 0, mix: .5 })
  assert.deepEqual(samplePetClip('idle', 3200), { frame: 0, next: 1, mix: 0 })
  const offsets = registration.idle.frames.map(frame => (frame.bounds[0] + frame.bounds[2]) / 2 - frame.anchor[0])
  assert.ok(Math.max(...offsets) - Math.min(...offsets) < 6, 'the anchor must not jump between feet and robe tips at frame 7')
  assert.ok(offsets.every(offset => Math.abs(offset) < 8), 'the right robe tip must not bias every anchor by 20 pixels')
})

test('handshake crosses its two original atlases continuously and finishes once at the resting pose', () => {
  const asset = registration.handshake
  assert.deepEqual(asset.pages.map(page => page.file), ['handshake.png', 'handshake-return.png'])
  assert.deepEqual(asset.pages.map(page => page.size), [[1536, 1024], [1536, 1024]])
  assert.deepEqual(asset.size, [1536, 2048])
  assert.deepEqual([...asset.frameOrder].sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index), 'each authored cell is used once, never duplicated to inflate the frame count')
  assert.deepEqual(asset.frameOrder.slice(0, 8), [0, 4, 1, 5, 2, 6, 3, 7], 'the matched extension pairs must not restart the gesture halfway')
  assert.equal(asset.pages[1].origin[1], 1024)
  assert.ok(asset.frames[7].rect[1] < 1024 && asset.frames[8].rect[1] >= 1024)
  assert.deepEqual(samplePetClip('handshake', 1300), { frame: 7, next: 8, mix: .5 })
  const visited = new Set<number>()
  for (let time = 0; time <= petActionDuration; time += 10) visited.add(samplePetClip('handshake', time).frame)
  assert.equal(visited.size, 16)
  assert.deepEqual(samplePetClip('handshake', petActionDuration), { frame: 15, next: 15, mix: 0 })
  assert.deepEqual(samplePetClip('handshake', 60_000), samplePetClip('handshake', petActionDuration))
})

test('pat traverses both authored pages and returns to its resting pose without replaying the nod', () => {
  const asset = registration.pat
  assert.deepEqual(asset.pages.map(page => page.file), ['pat.png', 'pat-return.png'])
  assert.deepEqual(asset.pages.map(page => page.size), [[1536, 1024], [1536, 1024]])
  assert.deepEqual(asset.size, [1536, 2048])
  assert.deepEqual(asset.frameOrder, Array.from({ length: 16 }, (_, index) => index))
  assert.ok(asset.frames[7].rect[1] < 1024 && asset.frames[8].rect[1] >= 1024)
  assert.deepEqual(samplePetClip('pat', 1300), { frame: 7, next: 8, mix: .5 })
  const visited = new Set<number>()
  for (let time = 0; time <= petActionDuration; time += 10) visited.add(samplePetClip('pat', time).frame)
  assert.equal(visited.size, 16)
  assert.deepEqual(samplePetClip('pat', petActionDuration), { frame: 15, next: 15, mix: 0 })
  assert.deepEqual(samplePetClip('pat', 60_000), samplePetClip('pat', petActionDuration))
})

for (const intent of ['eating', 'drinking', 'greet', 'stretch', 'playing'] as const) test(`${intent} visits both authored pages once before resting`, () => {
  const asset = registration[intent]
  assert.deepEqual(asset.pages.map(page => page.file), [`${intent}.png`, `${intent}-return.png`])
  assert.deepEqual(asset.pages.map(page => page.size), [[1536, 1024], [1536, 1024]])
  assert.deepEqual(asset.size, [1536, 2048])
  assert.deepEqual(asset.frameOrder, Array.from({ length: 16 }, (_, index) => index), 'each original drawing is used once')
  assert.ok(asset.frames[7].rect[1] < 1024 && asset.frames[8].rect[1] >= 1024)
  assert.deepEqual(samplePetClip(intent, 1300), { frame: 7, next: 8, mix: .5 })
  const visited = new Set<number>()
  for (let time = 0; time <= petActionDuration; time += 10) visited.add(samplePetClip(intent, time).frame)
  assert.equal(visited.size, 16)
  assert.deepEqual(samplePetClip(intent, petActionDuration), { frame: 15, next: 15, mix: 0 })
  assert.deepEqual(samplePetClip(intent, 60_000), samplePetClip(intent, petActionDuration))
})

test('atlas pages retain fixed source scale through a gesture and seated poses keep their face scale', () => {
  for (const asset of [registration.pat, registration.handshake, registration.eating, registration.drinking, registration.greet, registration.stretch, registration.playing]) {
    for (const page of asset.pages) {
      const indexes = asset.frames.flatMap((frame, index) => frame.rect[1] >= page.origin[1] && frame.rect[1] < page.origin[1] + page.size[1] ? [index] : [])
      const first = asset.frames[indexes[0]!]!
      assert.ok(Math.abs((first.bounds[3]! - first.bounds[1]!) / page.density - 440) < .01)
      assert.ok(indexes.every(index => petFrameDensity(asset, index) === page.density), 'never refit individual poses while nodding')
    }
  }
  assert.notEqual(petFrameDensity(registration.pat, 7), petFrameDensity(registration.pat, 8), 'the second atlas has a different source-pixel scale')
  const legacy = { ...registration.pat, pages: registration.pat.pages.map(({ density, ...page }) => page) }
  assert.equal(petFrameDensity(legacy, 8), registration.pat.density, 'older multi-page registrations can omit page density')
  assert.equal(petFrameDensity(registration.idle, 0), registration.idle.density, 'single-page legacy entries still work')
  assert.equal(petFrameDensity({ size: [512, 512], density: 1, frames: [{ rect: [0, 0, 512, 512], anchor: [256, 486] }] }, 0), 1, 'captured transition textures are already normalized')
  assert.equal(registration.sleeping.density, registration.sleeping.faceWidth[0] / registration.sleeping.faceWidth[1])
  const sitting = registration.sleeping.frames[0]!
  assert.ok((sitting.bounds[3] - sitting.bounds[1]) / registration.sleeping.density < 400, 'a seated body must not be enlarged to standing height')
})

test('elapsed time, not renderer ticks, controls playback at different refresh rates', () => {
  for (const fps of [30, 60, 144]) {
    let elapsed = 0
    for (let tick = 0; tick < fps; tick++) elapsed += 1000 / fps
    const result = samplePetClip('eating', elapsed), expected = samplePetClip('eating', 1000)
    assert.equal(result.frame, expected.frame); assert.equal(result.next, expected.next)
    assert.ok(Math.abs(result.mix - expected.mix) < 1e-10)
  }
})

test('an explicit blink performs one closure and returns instead of repeating through a 2.6s gesture timer', () => {
  assert.equal(petClipLoops('blink'), false)
  assert.equal(petPlaybackDuration('blink'), 20 / 24 * 1000)
  assert.deepEqual(samplePetClip('blink', 480), { frame: 7, next: 7, mix: 0 })
  assert.deepEqual(samplePetClip('blink', 900), samplePetClip('blink', 480))
})

test('retained legacy atlas sampler holds terminal drawings at 30/60/144 Hz independently of video timing', () => {
  for (const { intent } of petAnimations.filter(({ intent }) => !petClipLoops(intent) && intent !== 'blink' && intent !== 'land')) {
    const duration = petTransitionDuration + petActionDuration + petActionRestDuration
    for (const fps of [30, 60, 144]) {
      let terminalTicks = 0
      for (let time = petTransitionDuration; time < duration; time += 1000 / fps) {
        if (samplePetClip(intent, time - petTransitionDuration).frame === petFrameCount(intent) - 1) terminalTicks++
      }
      assert.ok(terminalTicks >= 4, `${intent} must visibly settle at ${fps} Hz before its timer ends`)
    }
  }
})

test('actual gesture and task/voice state select the correct animation; idle does not mask real feedback', () => {
  assert.equal(resolvePetAnimation('drag', 'thinking', true, true), 'drag')
  assert.equal(resolvePetAnimation('idle', 'idle', false, true), 'land')
  assert.equal(resolvePetAnimation('listening', 'thinking', true, false), 'listening')
  assert.equal(resolvePetAnimation('eating', 'idle', true, false), 'eating')
  assert.equal(resolvePetAnimation('idle', 'writing', true, false), 'speaking')
  for (const state of ['writing','success','warning','sleeping','thinking'] as const) assert.equal(resolvePetAnimation('idle', state, false, false), state)
  assert.equal(resolvePetAnimation('idle', 'curious', false, false), 'idle')
})

for (const intent of ['success', 'warning'] as const) test(`${intent} preserves sixteen distinct full-character cells at one scale`, () => {
  const asset = registration[intent]
  assert.deepEqual(asset.layout, [4, 4])
  assert.equal(new Set(asset.frames.map(frame => frame.rect.join(','))).size, 16, 'do not count repeated source cells as new drawings')
  assert.ok(asset.frames.every((_, index) => petFrameDensity(asset, index) === asset.density))
  assert.deepEqual(samplePetClip(intent, 1300), { frame: 7, next: 8, mix: .5 })
  assert.deepEqual(samplePetClip(intent, 2600), { frame: 15, next: 15, mix: 0 })
})
