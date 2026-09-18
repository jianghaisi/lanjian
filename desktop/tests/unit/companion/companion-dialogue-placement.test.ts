import assert from 'node:assert/strict'
import test from 'node:test'
import { intersects, placeCompanionDialogue } from '../../../src/renderer/features/companion/services/companion-dialogue-placement'
const safe = { left: 0, top: 60, right: 1440, bottom: 850 }
const stage = { left: 0, top: 60, right: 420, bottom: 850 }
test('top placement protects the actual character, not a click point', () => {
  const character = [{ left: 15, top: 450, right: 395, bottom: 850 }]
  const result = placeCompanionDialogue({ safe, stage, character, desired: { width: 340, height: 300 } })
  assert.equal(result.kind, 'above')
  assert.equal(intersects({ ...result, right: result.left + result.width, bottom: result.top + result.height }, character[0]!, 12), false)
})
test('unknown or large art uses a floating right slot, not a reserved lane', () => {
  for (const character of [[], [{ left: -100, top: 65, right: 550, bottom: 1300 }]]) {
    const result = placeCompanionDialogue({ safe, stage, character, desired: { width: 340, height: 320 } })
    assert.equal(result.kind, 'right')
    assert.ok(result.left >= 420 && result.left + result.width <= safe.right)
  }
})
test('right preference floats over module space but does not overlap art', () => {
  const result = placeCompanionDialogue({ safe, stage, character: [{ left: 10, top: 70, right: 200, bottom: 800 }], desired: { width: 300, height: 250 } })
  assert.equal(result.kind, 'right')
  assert.equal(result.left, 432)
})
test('floating bubble stays inside zoomed viewport', () => {
  for (const scale of [1, 1.25, 1.5]) {
    const result = placeCompanionDialogue({ safe: { left: 0, top: 40, right: 1100 / scale, bottom: 760 / scale }, stage: { left: 0, top: 40, right: 320 / scale, bottom: 760 / scale }, character: [], desired: { width: 340, height: 340 } })
    assert.equal(result.kind, 'right')
    assert.ok(result.left + result.width <= 1100 / scale)
    assert.ok(result.top + result.height <= 760 / scale)
  }
})

test('streaming height expands beside the character without modifying or clipping its rectangles', () => {
  const character = [{ left: 30, top: 72, right: 470, bottom: 910 }]
  const original = structuredClone(character)
  for (const height of [80, 112, 160, 260]) {
    const result = placeCompanionDialogue({ safe, stage, character, desired: { width: 420, height } })
    assert.equal(result.kind, 'right')
    assert.equal(result.left, 482)
    assert.equal(intersects({ ...result, right: result.left + result.width, bottom: result.top + result.height }, character[0]!, 12), false)
  }
  assert.deepEqual(character, original)
})

test('fully occupied viewport fails closed instead of covering the face', () => {
  assert.equal(placeCompanionDialogue({ safe, stage, character: [{ left: -100, top: -100, right: 1800, bottom: 1200 }], desired: { width: 340, height: 180 } }).kind, 'unavailable')
})
