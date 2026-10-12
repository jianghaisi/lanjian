import assert from 'node:assert/strict'
import test from 'node:test'
import { bootScore, createBootCueTracker, createLoadingCueTracker, createQuickWorkspaceCueTracker, type BootSoundFrame } from '../../../src/renderer/app/services/ui-sound-timeline'

const boot: BootSoundFrame = { seconds: 0, handoff: -1, visible: true, reduced: false, cinematic: true, error: false, bypass: false }
test('fixed movements, eight-second waiting clock, quiet idle and exit follow the real animation', () => {
  assert.deepEqual(bootScore(boot), { id: 'B15', offset: 0 })
  assert.deepEqual(bootScore({ ...boot, seconds: 5.4 }), { id: 'B15', offset: 5.4 })
  assert.deepEqual(bootScore({ ...boot, seconds: 12 }), { id: 'B16', offset: 0 })
  assert.deepEqual(bootScore({ ...boot, seconds: 19.9999, arrayWait: 25.5 }), { id: 'B16', offset: 33.5 })
  assert.deepEqual(bootScore({ ...boot, seconds: 20, arrayWait: null }), { id: 'B17', offset: 0 })
  assert.deepEqual(bootScore({ ...boot, seconds: 26.5 }), { id: 'B17', offset: 6.5 })
  assert.deepEqual(bootScore({ ...boot, seconds: 33 }), { id: 'B18' })
  assert.equal(bootScore({ ...boot, seconds: 33, handoff: 0 }), null)
  for (const patch of [{ visible: false }, { reduced: true }, { cinematic: false }, { error: true }, { bypass: true }]) {
    assert.equal(bootScore({ ...boot, ...patch, seconds: 14 }), null)
  }
})
test('only brand and complete exit accent remain; movements do not retrigger old fragments', () => {
  const track = createBootCueTracker()
  assert.deepEqual(track(boot), [])
  assert.deepEqual(track({ ...boot, seconds: .13 }), [])
  assert.deepEqual(track({ ...boot, seconds: 1.01 }), ['V01'])
  assert.deepEqual(track({ ...boot, seconds: 1.05 }), [])
  assert.deepEqual(track({ ...boot, seconds: 12.41 }), [])
  for (let i = 0; i < 20; i++) assert.deepEqual(track({ ...boot, seconds: 19.9999 }), [])
  assert.deepEqual(track({ ...boot, seconds: 20.41 }), [])
  assert.deepEqual(track({ ...boot, seconds: 33, handoff: 0 }), ['B19'])
  assert.deepEqual(track({ ...boot, seconds: 33, handoff: 1.51 }), [])
  assert.deepEqual(track({ ...boot, seconds: 33, handoff: 1.6 }), [])
})
test('hidden, reduced, brief, bypass, errors and clock jumps never replay a backlog', () => {
  for (const patch of [{ visible: false }, { reduced: true }, { cinematic: false }, { error: true }, { bypass: true }]) {
    const track = createBootCueTracker()
    assert.deepEqual(track({ ...boot, ...patch, seconds: 1 }), [])
    assert.deepEqual(track({ ...boot, seconds: 1.1 }), [])
    assert.deepEqual(track({ ...boot, seconds: 33 }), [])
  }
})
test('loading reacts to real phases; errors, quick return and standard do not fabricate ready', () => {
  const frame = { phase: 'switch', impact: true, quick: false, reduced: false, error: '' }
  const track = createLoadingCueTracker()
  assert.deepEqual(track(frame), ['L01'])
  assert.deepEqual(track({ ...frame, phase: 'database' }), ['L03'])
  assert.deepEqual(track({ ...frame, phase: 'database' }), [])
  assert.deepEqual(track({ ...frame, phase: 'ready', error: 'failed' }), ['U12'])
  assert.deepEqual(track({ ...frame, phase: 'ready', error: 'failed' }), [])
  // Retrying returns through actual unfinished phases before ready.
  track(frame)
  assert.deepEqual(track({ ...frame, phase: 'ready' }), ['L04', 'L05'])
  assert.deepEqual(track({ ...frame, phase: 'ready' }), [])
  const quick = createLoadingCueTracker()
  assert.deepEqual(quick({ ...frame, quick: true }), [])
  assert.deepEqual(quick({ ...frame, phase: 'ready', quick: true }), ['U03'])
  assert.deepEqual(createLoadingCueTracker()({ ...frame, phase: 'ready', impact: false }), [])
})

test('memory return without a mounted loader confirms real ready once; cancellation drops its scope', () => {
  const track = createQuickWorkspaceCueTracker()
  const frame = { generation: 1, visible: false, replay: false, phase: 'switch', impact: true }
  assert.deepEqual(track(frame), { stop: true, confirm: false })
  assert.deepEqual(track({ ...frame, phase: 'ready' }), { stop: false, confirm: true })
  assert.deepEqual(track({ ...frame, phase: 'ready' }), { stop: false, confirm: false })
  assert.deepEqual(track(undefined), { stop: false, confirm: false }) // Ready has completed; allow its short tail.
  assert.deepEqual(track({ ...frame, generation: 2 }), { stop: true, confirm: false })
  assert.deepEqual(track(undefined), { stop: true, confirm: false })
  assert.equal(track({ ...frame, generation: 3, visible: true, phase: 'ready' }).confirm, false)
  assert.equal(track({ ...frame, generation: 4, impact: false, phase: 'ready' }).confirm, false)
})
