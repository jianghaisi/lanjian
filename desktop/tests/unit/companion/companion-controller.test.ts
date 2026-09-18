import assert from 'node:assert/strict'
import test from 'node:test'
import { CompanionController, defaultCompanionOptions, nextBlinkDelay, normalizeCompanionOptions, springStep } from '../../../src/renderer/features/companion/services/companion-controller'

const visible = { hidden: false, quiet: false, feedback: true, hovered: false }

test('native resuming is thinking while a paused parent stays quiet', () => {
  const controller = new CompanionController()
  controller.update('book:1', 'parent', 'streaming', 100)
  controller.update('book:1', 'parent', 'paused', 200)
  assert.equal(controller.state(200, visible), 'idle')
  controller.update('book:1', 'child', 'resuming', 300)
  assert.equal(controller.state(300, visible), 'thinking')
  assert.equal(controller.state(300, { ...visible, quiet: true }), 'idle')
  controller.update('book:1', 'child', 'failed', 400)
  assert.equal(controller.state(400, visible), 'warning')
})

test('companion shares task states and respects hidden, typing, feedback and idle priorities', () => {
  const controller = new CompanionController()
  controller.update('book-a:1', 'task-a', 'queued', 100)
  assert.equal(controller.state(100, visible), 'thinking')
  controller.update('book-a:1', 'task-a', 'streaming', 200)
  assert.equal(controller.state(200, visible), 'writing')
  assert.equal(controller.state(200, { ...visible, quiet: true }), 'idle')
  assert.equal(controller.state(200, { ...visible, hidden: true, quiet: true }), 'hidden')
  assert.equal(controller.state(200, { ...visible, feedback: false }), 'idle')
  controller.update('book-a:1', 'task-a', 'succeeded', 300)
  assert.equal(controller.state(300, visible), 'success')
  assert.equal(controller.state(2699, visible), 'success')
  assert.equal(controller.state(2700, visible), 'idle')
  assert.equal(controller.state(90_101, visible), 'sleeping')
  controller.interact(90_102)
  assert.equal(controller.state(90_102, { ...visible, hovered: true }), 'curious')
})

test('companion feedback comes from an observed same-task terminal transition, never restored history', () => {
  const controller = new CompanionController()
  controller.update('book-a:1', 'historical', 'succeeded', 100)
  assert.equal(controller.state(100, visible), 'idle')
  controller.update('book-a:1', 'task-a', 'running', 200)
  controller.update('book-a:1', 'different', 'failed', 250)
  assert.equal(controller.state(250, visible), 'idle')
  controller.update('book-a:1', 'task-b', 'running', 300)
  controller.update('book-a:1', 'task-b', 'failed', 400)
  assert.equal(controller.state(400, visible), 'warning')
  controller.update('book-b:1', 'task-b', 'failed', 500)
  assert.equal(controller.state(500, visible), 'idle')
  controller.update('book-b:2', 'task-c', 'running', 600)
  controller.update('book-b:2', 'task-c', 'cancelled', 700)
  assert.equal(controller.state(700, visible), 'idle')
})

test('companion blink interval is bounded to two through six seconds', () => {
  for (const [random, expected] of [[-1, 2000], [0, 2000], [.5, 4000], [1, 6000], [2, 6000]]) {
    assert.equal(nextBlinkDelay(() => random!), expected)
  }
})

test('a new AI task replaces previous completion feedback immediately', () => {
  const controller = new CompanionController()
  controller.update('book-a:1', 'first', 'running', 100)
  controller.update('book-a:1', 'first', 'succeeded', 200)
  assert.equal(controller.state(200, visible), 'success')
  controller.update('book-a:1', 'second', 'queued', 250)
  assert.equal(controller.state(250, visible), 'thinking')
  controller.update('book-a:1', 'second', 'streaming', 300)
  assert.equal(controller.state(300, visible), 'writing')
})

test('companion damped spring bounds elapsed time and settles without infinite oscillation', () => {
  assert.deepEqual(springStep(0, 0, 2, 60), springStep(0, 0, 2, .032))
  assert.deepEqual(springStep(1, .5, 2, -1), { position: 1, velocity: .5 })
  let frame = { position: 0, velocity: 0 }
  for (let i = 0; i < 600; i++) frame = springStep(frame.position, frame.velocity, 2.2, 1 / 60)
  assert.ok(Math.abs(frame.position - 2.2) < .001)
  assert.ok(Math.abs(frame.velocity) < .001)
  for (let i = 0; i < 600; i++) frame = springStep(frame.position, frame.velocity, 0, 1 / 60)
  assert.ok(Math.abs(frame.position) < .001)
})

test('companion options preserve genuine booleans, supported modes and finite intensity', () => {
  assert.deepEqual(normalizeCompanionOptions(null), defaultCompanionOptions)
  assert.deepEqual(normalizeCompanionOptions([]), defaultCompanionOptions)
  assert.deepEqual(normalizeCompanionOptions({ libraryMode: 'wrong', followPointer: 'false', intensity: NaN }), defaultCompanionOptions)
  assert.equal(normalizeCompanionOptions({ intensity: 10 }).intensity, 1)
  assert.equal(normalizeCompanionOptions({ intensity: -1 }).intensity, 0)
  assert.equal(normalizeCompanionOptions({ writingMode: 'hidden', autoBlink: false }).autoBlink, false)
  const options = normalizeCompanionOptions(null)
  options.writingMode = 'hidden'
  assert.equal(defaultCompanionOptions.writingMode, 'detailed')
})
