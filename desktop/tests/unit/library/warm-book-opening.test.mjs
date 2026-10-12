import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createLibraryOpeningActions } from '../../../src/renderer/features/library/composables/create-opening-actions.js'

function fixture(t) {
  const original = globalThis.window, timers = new Map(); let id = 0, frames = 0
  globalThis.window = { setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: () => { frames++; return ++id }, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }) }
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original })
  const ports = { workspaceOpening: ref(null), workspaceOpeningGeneration: 0, workspaceOpeningSlowTimer: 0,
    workspaceOpeningPhaseTimer: 0, workspaceOpeningPhaseFrame: 0, workspaceOpeningPhaseWaiters: [],
    WORKSPACE_PHASE_SEQUENCE: ['switch', 'database', 'workspace', 'chapter', 'recovery', 'ready'], WORKSPACE_PHASE_DWELL_MS: 320 }
  return { ports, timers, frames: () => frames, actions: createLibraryOpeningActions(ports) }
}

test('warm entry advances without dwell timers and finish cancels slow indicator', async t => {
  const f = fixture(t), generation = f.actions.beginWorkspaceOpening({ path: 'A', title: '甲' }, { replay: false })
  assert.equal(f.ports.workspaceOpening.value.visible, true)
  f.actions.setWorkspaceOpeningPhase('ready')
  assert.equal(f.ports.workspaceOpening.value.phase, 'ready')
  assert.equal(await f.actions.waitForWorkspaceOpeningPhase(generation, 'ready'), true)
  assert.equal(f.frames(), 0)
  f.actions.finishWorkspaceOpening(generation)
  assert.equal(f.timers.size, 0); assert.equal(f.ports.workspaceOpening.value, null)
})

test('a genuinely slow warm read marks waiting; obsolete timer cannot affect the next book', t => {
  const f = fixture(t)
  f.actions.beginWorkspaceOpening({ path: 'A', title: '甲' }, { replay: false })
  f.actions.setWorkspaceOpeningPhase('chapter')
  const old = [...f.timers.values()][0]; assert.equal(old.delay, 4000)
  old.fn()
  assert.equal(f.ports.workspaceOpening.value.visible, true)
  assert.equal(f.ports.workspaceOpening.value.slow, true)
  const generation = f.actions.beginWorkspaceOpening({ path: 'B', title: '乙' })
  old.fn(); assert.equal(f.ports.workspaceOpening.value.slow, false)
  assert.equal(f.ports.workspaceOpening.value.visible, true)
  f.actions.setWorkspaceOpeningPhase('ready'); assert.equal(f.frames(), 1)
  f.actions.finishWorkspaceOpening(generation)
})


test('memory transition stays guarded without mounting a loader or scheduling presentation timers', async t => {
  const f = fixture(t)
  const generation = f.actions.beginWorkspaceOpening({ path: 'A', title: '甲' }, { replay: false, visible: false })
  assert.equal(f.ports.workspaceOpening.value.visible, false)
  assert.equal(f.actions.isCurrentWorkspaceOpening(generation), true)
  assert.equal(f.timers.size, 0)
  f.actions.setWorkspaceOpeningPhase('ready')
  assert.equal(await f.actions.waitForWorkspaceOpeningPhase(generation, 'ready'), true)
  assert.equal(f.frames(), 0)
  f.actions.finishWorkspaceOpening(generation)
  assert.equal(f.ports.workspaceOpening.value, null)
})

test('hidden memory transition clears the previous visible slow timer', t => {
  const f = fixture(t)
  f.actions.beginWorkspaceOpening({ path: 'A', title: '甲' })
  const oldTimer = [...f.timers.values()][0]
  f.actions.beginWorkspaceOpening({ path: 'B', title: '乙' }, { replay: false, visible: false })
  assert.equal(f.timers.size, 0)
  oldTimer.fn()
  assert.equal(f.ports.workspaceOpening.value.visible, false)
  assert.equal(f.ports.workspaceOpening.value.slow, false)
})
