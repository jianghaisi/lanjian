import assert from 'node:assert/strict'
import test from 'node:test'
import { getEventListeners } from 'node:events'
import { createRenderer, nextTick, ref, shallowRef, watch, type App, type Ref } from 'vue'
import { useGalleryMotion } from '../../../src/renderer/features/library/composables/use-gallery-motion'

type Bounds = { left: number; top: number; width: number; height: number }
type Fixture = {
  app: App; layout: Ref<number>; runs: Array<{ frames: Keyframe[]; cancelled: boolean }>
  document: EventTarget & { hidden: boolean }; window: EventTarget
  preference: EventTarget & { matches: boolean }
  departing: Ref<boolean>; style: { transform: string; removeProperty(name: string): void }
  replaceCard(path?: string): void
  setBounds(value: Bounds): void; change(value: number): Promise<void>
}

async function withGallery(check: (fixture: Fixture) => Promise<void>) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousMatch = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  const document = Object.assign(new EventTarget(), { hidden: false })
  const window = new EventTarget()
  const preference = Object.assign(new EventTarget(), { matches: false })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => preference })
  type Node = { children: Node[]; parent: Node | null }
  const node = (): Node => ({ children: [], parent: null })
  const renderer = createRenderer<Node, Node>({
    patchProp() {}, insert(child, parent) { parent.children.push(child); child.parent = parent },
    remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child) },
    createElement: node, createText: node, createComment: node, setText() {}, setElementText() {},
    parentNode: child => child.parent, nextSibling: () => null
  })
  const layout = ref(0)
  const departing = ref(false)
  const style = { transform: '', removeProperty(name: string) { if (name === 'transform') this.transform = '' } }
  let bounds = { left: 0, top: 0, width: 100, height: 80 }
  const runs: Array<{ frames: Keyframe[]; cancelled: boolean }> = []
  const card = {
    isConnected: true, style, dataset: { projectPath: '/fixture/book' }, classList: { contains: () => departing.value },
    getBoundingClientRect: () => ({ ...bounds }),
    animate(frames: Keyframe[]) {
      const run = { frames, cancelled: false }; runs.push(run)
      let reject!: (error: Error) => void
      const finished = new Promise<void>((_, fail) => { reject = fail })
      return { finished, cancel() { run.cancelled = true; reject(new Error('cancelled')) } }
    }
  }
  let currentCard = card
  const root = { querySelectorAll: () => [currentCard] } as unknown as HTMLElement
  const app = renderer.createApp({ setup() {
    useGalleryMotion(shallowRef(root), () => layout.value)
    watch(layout, value => { bounds = { left: value * 100, top: 40, width: 200, height: 80 } }, { flush: 'post' })
    return () => null
  } })
  function fixture() {
    return {
      app, layout, runs, document, window, preference, departing, style,
      replaceCard(path = '/fixture/book') {
        currentCard.isConnected = false
        currentCard = { ...card, isConnected: true, dataset: { projectPath: path } }
      },
      setBounds(value: typeof bounds) { bounds = value },
      async change(value: number) { layout.value = value; await nextTick(); await nextTick() }
    }
  }
  try {
    app.mount(node())
    await check(fixture())
  } finally {
    app.unmount()
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousMatch) Object.defineProperty(globalThis, 'matchMedia', previousMatch)
    else Reflect.deleteProperty(globalThis, 'matchMedia')
  }
}

test('gallery interrupts from visible bounds, suppresses reduced motion and disposes animations', async () => {
  await withGallery(async ({ change, runs, setBounds, preference, app }) => {
    await change(1)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]!.frames[0]!.transform, 'translate(-100px,-40px) scale(0.5,1)')
    // A rapid switch begins at the in-flight visual rectangle, not the old destination.
    setBounds({ left: 55, top: 25, width: 150, height: 80 })
    await change(2)
    assert.equal(runs[0]!.cancelled, true)
    assert.equal(runs[1]!.frames[0]!.transform, 'translate(-145px,-15px) scale(0.75,1)')
    preference.matches = true
    await change(3)
    assert.equal(runs[1]!.cancelled, true)
    assert.equal(runs.length, 2)
    preference.matches = false
    await change(4)
    assert.equal(runs.length, 3)
    app.unmount()
    assert.equal(runs[2]!.cancelled, true)
    await change(5)
    assert.equal(runs.length, 3)
  })
})

test('a departing card freezes the interrupted visual bounds without adding another animation clock', async () => {
  await withGallery(async ({ change, runs, setBounds, departing, style }) => {
    await change(1)
    setBounds({ left: 55, top: 25, width: 150, height: 80 })
    departing.value = true
    await change(2)
    assert.equal(runs[0]!.cancelled, true)
    assert.equal(runs.length, 1, 'existing opacity transition owns departure timing')
    assert.equal(style.transform, 'translate(-145px,-15px) scale(0.75,1)')
    // A second query must use the same visible rectangle against its new base.
    setBounds({ left: 55, top: 25, width: 150, height: 80 })
    await change(3)
    assert.equal(style.transform, 'translate(-245px,-15px) scale(0.75,1)')
    assert.equal(runs.length, 1)
    // Match the component's reinsertion hook, then resume normal retained motion.
    style.removeProperty('transform')
    departing.value = false
    await change(4)
    assert.equal(style.transform, '')
    assert.equal(runs.length, 2)
  })
})

test('visibility, preference and resize settle active motion without another layout change', async () => {
  await withGallery(async ({ change, runs, document, window, preference }) => {
    await change(1)
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(runs[0]!.cancelled, true)
    await change(2)
    assert.equal(runs.length, 1, 'hidden layout updates do not animate')
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    assert.equal(runs.length, 1, 'showing does not replay the old layout')
    await change(3)
    preference.matches = true
    preference.dispatchEvent(new Event('change'))
    assert.equal(runs[1]!.cancelled, true)
    preference.matches = false
    preference.dispatchEvent(new Event('change'))
    await nextTick()
    assert.equal(runs.length, 2, 'preference recovery does not replay')
    await change(4)
    window.dispatchEvent(new Event('resize'))
    assert.equal(runs[2]!.cancelled, true)
    await change(5)
    assert.equal(runs.length, 4, 'later intentional changes still animate')
  })
})

test('replacement nodes inherit only the matching work visual rectangle', async () => {
  await withGallery(async ({ change, layout, replaceCard, runs, setBounds }) => {
    const unwatch = watch(layout, value => replaceCard(value === 2 ? '/fixture/other-book' : undefined), { flush: 'post' })
    try {
      setBounds({ left: 55, top: 25, width: 150, height: 80 })
      await change(1)
      assert.equal(runs.length, 1)
      assert.equal(runs[0]!.frames[0]!.transform, 'translate(-45px,-15px) scale(0.75,1)')
      await change(2)
      assert.equal(runs[0]!.cancelled, true)
      assert.equal(runs.length, 1, 'a different work must not inherit the retired work transform')
    } finally { unwatch() }
  })
})

test('interruption invalidates queued motion even if visibility or preference recovers before nextTick', async () => {
  await withGallery(async ({ change, runs, layout, document, window, preference }) => {
    const unwatch = watch(layout, value => {
      if (value === 1) {
        document.hidden = true; document.dispatchEvent(new Event('visibilitychange'))
        document.hidden = false; document.dispatchEvent(new Event('visibilitychange'))
      } else if (value === 2) {
        preference.matches = true; preference.dispatchEvent(new Event('change'))
        preference.matches = false; preference.dispatchEvent(new Event('change'))
      } else if (value === 3) window.dispatchEvent(new Event('resize'))
    }, { flush: 'post' })
    try {
      await change(1); await change(2); await change(3)
      assert.equal(runs.length, 0)
      await change(4)
      assert.equal(runs.length, 1)
    } finally { unwatch() }
  })
})

test('unmount removes lifecycle listeners and pending work', async () => {
  await withGallery(async ({ app, layout, runs, document, window, preference }) => {
    assert.equal(getEventListeners(document, 'visibilitychange').length, 1)
    assert.equal(getEventListeners(window, 'resize').length, 1)
    assert.equal(getEventListeners(preference, 'change').length, 1)
    const unwatch = watch(layout, () => app.unmount(), { flush: 'post' })
    layout.value = 1
    await nextTick(); await nextTick()
    unwatch()
    assert.equal(runs.length, 0)
    assert.equal(getEventListeners(document, 'visibilitychange').length, 0)
    assert.equal(getEventListeners(window, 'resize').length, 0)
    assert.equal(getEventListeners(preference, 'change').length, 0)
  })
})
