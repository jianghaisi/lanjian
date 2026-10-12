import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { usePetReminder } from '../../../src/renderer/features/companion/composables/use-pet-reminder'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const input = ref({ minutes: 1, enabled: true, scope: 'book-a' as string | null, blocked: false })
  let count = 0
  const app = renderer.createApp({ setup() { usePetReminder(input, () => count++); return () => null } })
  app.mount({})
  t.after(() => { app.unmount(); t.mock.timers.reset() })
  return { input, count: () => count, advance: (ms: number) => t.mock.timers.tick(ms), unmount: () => app.unmount() }
}

test('equal state broadcasts do not starve the first reminder or subsequent intervals', async t => {
  const f = fixture(t)
  for (let i = 0; i < 24; i++) {
    f.input.value = { ...f.input.value }; await nextTick()
    f.advance(5000)
    assert.equal(f.count(), Math.floor((i + 1) / 12))
  }
})

test('busy periods defer only one reminder and resume the full interval after delivery', t => {
  const f = fixture(t)
  f.input.value.blocked = true
  for (let i = 0; i < 20; i++) f.advance(30_000)
  assert.equal(f.count(), 0)
  f.input.value.blocked = false
  f.advance(29_999); assert.equal(f.count(), 0)
  f.advance(1); assert.equal(f.count(), 1)
  f.advance(59_999); assert.equal(f.count(), 1)
  f.advance(1); assert.equal(f.count(), 2)
})

test('temporary interaction before the deadline does not reset the interval', t => {
  const f = fixture(t)
  f.advance(20_000); f.input.value.blocked = true
  f.advance(20_000); f.input.value.blocked = false
  f.advance(20_000); assert.equal(f.count(), 1)
})

test('disabling or hiding discards a due reminder and enabling starts a fresh interval', t => {
  const f = fixture(t)
  f.input.value.blocked = true; f.advance(60_000)
  f.input.value.enabled = false; f.input.value.blocked = false
  f.advance(600_000); assert.equal(f.count(), 0)
  f.input.value.enabled = true
  f.advance(59_999); assert.equal(f.count(), 0)
  f.advance(1); assert.equal(f.count(), 1)
})

test('changing the chosen interval restarts it, and zero disables reminders', t => {
  const f = fixture(t)
  f.advance(50_000); f.input.value.minutes = 2
  f.advance(119_999); assert.equal(f.count(), 0)
  f.advance(1); assert.equal(f.count(), 1)
  f.input.value.minutes = 0; f.advance(3_600_000)
  assert.equal(f.count(), 1)
})

test('book replacement, empty scope and disposal cancel the previous deadline', t => {
  const f = fixture(t)
  f.advance(50_000); f.input.value.scope = 'book-b'
  f.advance(10_000); assert.equal(f.count(), 0)
  f.advance(50_000); assert.equal(f.count(), 1)
  f.input.value.scope = null; f.advance(600_000); assert.equal(f.count(), 1)
  f.input.value.scope = 'book-c'; f.advance(59_999)
  f.unmount(); f.advance(600_000); assert.equal(f.count(), 1)
})
