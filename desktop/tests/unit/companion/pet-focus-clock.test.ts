import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import type { PetFocus } from '../../../src/contracts/companion/companion-care'
import { usePetFocusClock } from '../../../src/renderer/features/companion/composables/use-pet-focus-clock'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const focus = ref<PetFocus | null>({ id: crypto.randomUUID(), duration: 300, elapsed: 0, status: 'running' }), enabled = ref(true)
  let time = 0, clock!: ReturnType<typeof usePetFocusClock>
  const app = renderer.createApp({ setup() { clock = usePetFocusClock(focus, enabled, () => time); return () => null } })
  app.mount({}); t.after(() => { app.unmount(); t.mock.timers.reset() })
  return { focus, enabled, clock, unmount: () => app.unmount(), advance(ms: number) { time += ms; t.mock.timers.tick(ms) } }
}

test('focus display advances each second without mutating acknowledged progress', t => {
  const f = fixture(t), before = JSON.stringify(f.focus.value)
  assert.equal(f.clock.text.value, '05:00')
  f.advance(1000); assert.equal(f.clock.text.value, '04:59')
  f.advance(1000); assert.equal(f.clock.text.value, '04:58')
  assert.equal(f.clock.progress.value, 2); assert.equal(JSON.stringify(f.focus.value), before)
})

test('equal projections do not rewind or extend the display window', async t => {
  const f = fixture(t)
  f.advance(2000); f.focus.value = { ...f.focus.value! }; await nextTick()
  f.advance(1000); assert.equal(f.clock.text.value, '04:57')
  f.advance(2000); assert.equal(f.clock.text.value, '04:55'); assert.equal(f.clock.waiting.value, true)
})

test('a stale stream stops at five seconds and main progress reanchors the display', t => {
  const f = fixture(t)
  f.advance(600_000); assert.equal(f.clock.text.value, '04:55'); assert.equal(f.clock.waiting.value, true)
  assert.equal(f.focus.value!.status, 'running')
  f.focus.value = { ...f.focus.value!, elapsed: 5.2 }
  assert.equal(f.clock.waiting.value, false)
  f.advance(1000); assert.equal(f.clock.text.value, '04:54')
})

test('only main completion can display zero or a full progress bar', t => {
  const f = fixture(t)
  f.focus.value = { ...f.focus.value!, elapsed: 299 }
  f.advance(300_000); assert.equal(f.clock.text.value, '00:01'); assert.equal(f.clock.progress.value, 299)
  assert.equal(f.focus.value!.status, 'running'); assert.equal(f.clock.waiting.value, true)
  f.focus.value = { ...f.focus.value!, elapsed: 300, status: 'complete' }
  assert.equal(f.clock.text.value, '00:00'); assert.equal(f.clock.progress.value, 300); assert.equal(f.clock.waiting.value, false)
})

test('pause and disabled presentation freeze at confirmed progress; resume uses a new baseline', t => {
  const f = fixture(t)
  f.focus.value = { ...f.focus.value!, elapsed: 20, status: 'paused' }
  f.advance(60_000); assert.equal(f.clock.text.value, '04:40')
  f.focus.value = { ...f.focus.value!, status: 'running' }
  f.advance(1000); assert.equal(f.clock.text.value, '04:39')
  f.enabled.value = false; f.advance(60_000); assert.equal(f.clock.text.value, '04:40')
  f.enabled.value = true; f.advance(1000); assert.equal(f.clock.text.value, '04:39')
})

test('replacement, cancellation and unmount do not retain a previous clock', t => {
  const f = fixture(t)
  f.advance(4000)
  f.focus.value = { id: crypto.randomUUID(), duration: 900, elapsed: 0, status: 'running' }
  assert.equal(f.clock.text.value, '15:00')
  f.advance(1000); assert.equal(f.clock.text.value, '14:59')
  f.focus.value = null; f.advance(60_000); assert.equal(f.clock.progress.value, 0)
  f.focus.value = { id: crypto.randomUUID(), duration: 300, elapsed: 0, status: 'running' }
  f.advance(1000); f.unmount(); f.advance(60_000); assert.equal(f.clock.text.value, '04:59')
})
