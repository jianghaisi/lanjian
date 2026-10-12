import test from 'node:test'
import assert from 'node:assert/strict'
import { petDragThreshold, petDragTilt } from '../../../src/renderer/features/companion/services/pet-gesture'
import { decodeDesktopPetMotion } from '../../../src/contracts/companion/desktop-pet'

test('small click tremor stays a click, including scaled negative screen coordinates', () => {
  const start = { x: -1200, y: -500 }
  assert.equal(petDragThreshold(start, { x: -1197, y: -497 }), false)
  assert.equal(petDragThreshold(start, { x: -1193, y: -500 }), true)
  assert.equal(petDragThreshold(start, { x: -1193, y: -500 }, 1.5), false)
})
test('drag sway follows direction, clamps fast movement and respects reduced motion', () => {
  assert.ok(petDragTilt(100, false) < 0)
  assert.ok(petDragTilt(-100, false) > 0)
  assert.equal(petDragTilt(8000, false), -10)
  assert.equal(petDragTilt(8000, true), 0)
  assert.throws(() => decodeDesktopPetMotion({ dragging: true, velocityX: NaN, sequence: 1 }))
})
