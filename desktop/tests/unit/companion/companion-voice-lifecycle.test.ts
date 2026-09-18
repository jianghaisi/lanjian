/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, ref } from 'vue'
import { useCompanionVoice } from '../../../src/renderer/features/companion/composables/use-companion-voice'
import { useCompanionPresence } from '../../../src/renderer/features/companion/composables/use-companion-presence'
import { useCompanionRuntime } from '../../../src/renderer/features/companion/composables/use-companion-runtime'

// Mount the real composable without an Electron window, audio device or model.
const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  parentNode: () => null, nextSibling: () => null,
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('settings preview is lazy; closing during pending configuration suppresses session opening and stale failure', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const status = deferred<{ installed: boolean }>()
  let statusCalls = 0, openCalls = 0, unsubscribed = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { novelDesktop: { companionVoice: {
    configure: () => { statusCalls++; return status.promise },
    open: async () => { openCalls++; return { sessionId: 'unexpected' } },
    onEvent: () => () => { unsubscribed++ },
  } } } })
  let voice!: ReturnType<typeof useCompanionVoice>
  const app = renderer.createApp({ setup() { voice = useCompanionVoice(ref(null), { autoOpen: false }); return () => null } })
  try {
    app.mount({})
    assert.equal(statusCalls, 0)
    assert.equal(openCalls, 0)
    const opening = voice.open()
    assert.equal(statusCalls, 1)
    voice.close()
    const closedLabel = voice.stateLabel.value
    status.reject(new Error('late status failure'))
    await opening
    assert.equal(openCalls, 0)
    assert.equal(voice.ready.value, false)
    assert.equal(voice.stateLabel.value, closedLabel)
  } finally {
    app.unmount()
    assert.equal(unsubscribed, 1)
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('a late preview session is closed, retry opens normally, and unmount releases the accepted session', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const pending = deferred<{ sessionId: string }>()
  const closed: string[] = [], cancelled: string[] = []
  let opens = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { novelDesktop: { companionVoice: {
    configure: async () => true,
    open: () => ++opens === 1 ? pending.promise : Promise.resolve({ sessionId: 'current' }),
    close: async (id: string) => { closed.push(id) },
    cancel: async (id: string) => { cancelled.push(id) },
    onEvent: () => () => {},
  } } } })
  let voice!: ReturnType<typeof useCompanionVoice>
  const app = renderer.createApp({ setup() { voice = useCompanionVoice(ref(null), { autoOpen: false }); return () => null } })
  let unmounted = false
  try {
    app.mount({})
    const opening = voice.open()
    await Promise.resolve()
    assert.equal(opens, 1)
    voice.close()
    pending.resolve({ sessionId: 'late' })
    await opening
    assert.deepEqual(closed, ['late'])
    assert.equal(voice.ready.value, false)
    await voice.open()
    assert.equal(voice.ready.value, true)
    app.unmount(); unmounted = true
    assert.deepEqual(closed, ['late', 'current'])
    assert.deepEqual(cancelled, ['current'])
  } finally {
    if (!unmounted) app.unmount()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('library preparation starts during mount but never warms after unmount while configuration is pending', async t => {
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'), oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
  const pending=deferred<{installed:boolean}>()
  let statusCalls=0, prepareCalls=0
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){},novelDesktop:{companionVoice:{
    configure:()=>{statusCalls++;return pending.promise},warmup:async()=>{prepareCalls++;return true},suspend:async()=>true,onEvent:()=>()=>{},
  }}}})
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false,hasFocus:()=>true,querySelector:()=>null,addEventListener(){},removeEventListener(){}}})
  t.mock.timers.enable({apis:['setTimeout']})
  const app=renderer.createApp({setup(){useCompanionRuntime();return()=>null}})
  try {
    app.mount({}); t.mock.timers.tick(1500)
    assert.equal(statusCalls,1)
    app.unmount(); pending.resolve({installed:true})
    await new Promise(setImmediate)
    assert.equal(prepareCalls,0)
  } finally {
    t.mock.timers.reset()
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window')
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document')
  }
})
