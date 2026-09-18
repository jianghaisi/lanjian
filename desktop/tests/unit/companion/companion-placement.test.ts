import assert from 'node:assert/strict'
import test from 'node:test'
import { placeCompanion } from '../../../src/renderer/features/companion/services/companion-placement'

test('pet stays inside the viewport and docks beside protected manuscript', () => {
  const viewport = { width: 1440, height: 900 }
  const paper = { left: 340, right: 1100, top: 140, bottom: 830 }
  const left = placeCompanion(500, 500, 100, 160, viewport, paper)
  assert.ok(left.x + 100 <= paper.left)
  const right = placeCompanion(1080, 500, 100, 160, viewport, paper)
  assert.ok(right.x >= paper.right)
  assert.deepEqual(placeCompanion(-100, -100, 100, 160, viewport), { x: 8, y: 64 })
  assert.deepEqual(placeCompanion(3000, 3000, 100, 160, viewport), { x: 1332, y: 732 })
})

test('placement leaves free space above prose available, preserves user side after resize', () => {
  const paper = { left: 180, right: 660, top: 260, bottom: 700 }
  assert.deepEqual(placeCompanion(200, 70, 100, 120, { width: 880, height: 720 }, paper), { x: 200, y: 70 })
  const compact = placeCompanion(1000, 600, 100, 120, { width: 880, height: 720 }, paper)
  assert.ok(compact.x >= paper.right && compact.x + 100 <= 880)
  assert.ok(compact.y + 120 <= 720)
})
