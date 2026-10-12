import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'
import { useAssistantChatPosition } from '../../../src/renderer/features/assistant/composables/use-assistant-chat-position'
import type { ReadingPosition } from '../../../src/renderer/features/assistant/services/assistant-memory'

class ScrollSurface extends EventTarget {
  scrollTop = 0
  clientHeight = 200
  scrollHeight = 2000
  scroll(top: number) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')) }
}
async function setup(t: TestContext) {
  const previousRequest = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>(); let serial = 0
  globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial }
  globalThis.cancelAnimationFrame = id => { frames.delete(id) }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const scope = effectScope(), element = new ScrollSurface(), scroll = shallowRef<HTMLElement>()
  const state = reactive({ scope: 1, revision: 1, visible: true, loading: false, position: { top: 100, atBottom: false } })
  const saved: ReadingPosition[] = []
  // Match the component's props projection: constructing this object reads position too.
  const snapshot = () => ({ scope: state.scope, revision: state.revision, visible: state.visible, loading: state.loading, position: state.position })
  const view = scope.run(() => useAssistantChatPosition(scroll, snapshot, value => { saved.push(value); state.position = value }))!
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)) }
  const restore = async () => { await nextTick(); frame(); frame() }
  t.after(() => { scope.stop(); globalThis.requestAnimationFrame = previousRequest; globalThis.cancelAnimationFrame = previousCancel })
  scroll.value = element as unknown as HTMLElement
  await restore()
  return { scope, state, element, saved, frames, frame, restore, view }
}

test('immediate hide flushes the latest sample and hidden zero layout cannot replace it', async t => {
  const f = await setup(t)
  assert.equal(f.element.scrollTop, 100)
  f.element.scroll(840); assert.equal(f.saved.length, 0)
  f.state.visible = false
  assert.deepEqual(f.saved, [{ top: 840, atBottom: false }])
  f.element.clientHeight = 0; f.element.scroll(0); t.mock.timers.tick(200)
  assert.equal(f.saved.length, 1)
  f.element.clientHeight = 200; f.state.visible = true; await f.restore()
  assert.equal(f.element.scrollTop, 840); assert.equal(f.view.ready.value, true)
})

test('normal scroll debounces saves and retains at-bottom semantics', async t => {
  const f = await setup(t)
  f.element.scroll(300); t.mock.timers.tick(80); f.element.scroll(1780); t.mock.timers.tick(119)
  assert.equal(f.saved.length, 0)
  t.mock.timers.tick(1); assert.deepEqual(f.saved, [{ top: 1780, atBottom: true }])
  f.state.visible = false; f.element.scrollHeight = 2500; f.state.visible = true; await f.restore()
  assert.equal(f.element.scrollTop, 2500, 'Browser clamps this to the new bottom')
})

test('saving a sampled position does not schedule restoration over a newer explicit jump', async t => {
  const f = await setup(t)
  f.element.scroll(700); t.mock.timers.tick(120); await nextTick()
  assert.equal(f.view.ready.value, true, 'Saving position must not put the view back into restoring mode')
  assert.equal(f.frames.size, 0)
  f.element.scroll(1500); await f.restore()
  assert.equal(f.element.scrollTop, 1500, 'Heading/comparison navigation cannot be pulled back by an earlier save')
})

test('book/loading changes discard old samples and already queued restore callbacks', async t => {
  const f = await setup(t)
  f.element.scroll(600); f.state.visible = false
  f.state.visible = true; await nextTick(); f.frame()
  const stale = [...f.frames.values()]
  f.state.scope = 2; f.state.loading = true; f.state.position = { top: 450, atBottom: false }
  f.element.scroll(23); stale.forEach(callback => callback(0)); t.mock.timers.tick(200)
  assert.equal(f.element.scrollTop, 23); assert.equal(f.saved.length, 1)
  f.state.revision++; f.state.loading = false; await f.restore()
  assert.equal(f.element.scrollTop, 450)
  f.element.scroll(800); f.state.scope = 3; f.state.loading = true; t.mock.timers.tick(200)
  assert.equal(f.saved.length, 1, 'Pending samples cannot be saved into the new book')
})

test('rapid hide/show cannot replay a superseded restore or reenable recording early', async t => {
  const f = await setup(t)
  f.state.visible = false; f.state.visible = true; await nextTick(); f.frame()
  const stale = [...f.frames.values()]
  f.state.visible = false; f.state.position = { top: 970, atBottom: false }; f.state.visible = true
  stale.forEach(callback => callback(0))
  assert.equal(f.view.ready.value, false)
  f.element.scroll(0); t.mock.timers.tick(200); assert.equal(f.saved.length, 0)
  await f.restore(); assert.equal(f.element.scrollTop, 970)
})

test('wheel, pointer and scrolling keys take precedence over a pending restore', async t => {
  const f = await setup(t)
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    f.state.visible = false; f.state.position = { top: 1100, atBottom: false }; f.state.visible = true
    await nextTick(); f.frame(); const stale = [...f.frames.values()]
    const event = new Event(type); Object.assign(event, { key: 'PageDown' }); f.element.dispatchEvent(event)
    f.element.scroll(540); stale.forEach(callback => callback(0)); t.mock.timers.tick(120)
    assert.equal(f.element.scrollTop, 540); assert.deepEqual(f.saved.at(-1), { top: 540, atBottom: false })
  }
})

test('composition and ordinary typing do not cancel position restoration', async t => {
  const f = await setup(t)
  for (const data of [{ key: 'a' }, { key: 'ArrowDown', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
    f.state.visible = false; f.state.visible = true; await nextTick(); f.frame()
    const event = new Event('keydown'); Object.assign(event, data); f.element.dispatchEvent(event)
    f.element.scrollTop = 0; f.frame(); assert.equal(f.element.scrollTop, 100)
  }
})

test('disposal saves a current sample, detaches listeners and rejects late frames', async t => {
  const f = await setup(t)
  f.element.scroll(760); f.scope.stop()
  assert.deepEqual(f.saved, [{ top: 760, atBottom: false }])
  f.element.scroll(50); t.mock.timers.tick(200); assert.equal(f.saved.length, 1)
})

test('disposal rejects an already dispatched restoration frame', async t => {
  const f = await setup(t)
  f.state.visible = false; f.state.visible = true; await nextTick(); f.frame()
  const stale = [...f.frames.values()]; f.scope.stop(); f.element.scrollTop = 33
  stale.forEach(callback => callback(0)); assert.equal(f.element.scrollTop, 33)
})
