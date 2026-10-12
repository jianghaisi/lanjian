/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, ref } from 'vue'
import { defaultCompanionSettings, type CompanionSettings } from '../../../src/contracts/companion/companion-settings'
import { companionPreparationPhase, useCompanionRuntime } from '../../../src/renderer/features/companion/composables/use-companion-runtime'

const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  parentNode: () => null, nextSibling: () => null,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const flush = () => new Promise(setImmediate)

test('pending settings configure once; lost library readiness invalidates both configuration and warmup', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const settings = deferred<CompanionSettings>(), configuration = deferred<boolean>(), warming = deferred<boolean>()
  let configures = 0, warms = 0, suspends = 0
  const configured: unknown[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    companionSettings: { get: () => settings.promise, onChange: () => () => {} },
    novelDesktop: { companionVoice: {
      configure: (options: unknown) => { configured.push(options); return ++configures === 1 ? configuration.promise : Promise.resolve(true) },
      warmup: () => ++warms === 1 ? warming.promise : Promise.resolve(true),
      suspend: async () => { suspends++; return true },
    } },
  } })
  const libraryReady = ref(true)
  const app = renderer.createApp({ setup() { useCompanionRuntime(libraryReady); return () => null } })
  try {
    app.mount({}); await flush()
    assert.equal(configures, 0)
    const saved = defaultCompanionSettings()
    saved.revision = 1; saved.voice.voice = 'ganyu'
    settings.resolve(saved); await flush()
    assert.equal(configures, 1, 'initial load and preference watcher share one current preparation')
    assert.deepEqual(configured[0], { textModel: false, speechModel: true, preload: true, voice: 'ganyu' })
    libraryReady.value = false; await flush()
    configuration.resolve(true); await flush()
    assert.equal(warms, 0, 'obsolete configuration cannot begin model preparation')
    libraryReady.value = true; await flush()
    assert.equal(configures, 2); assert.equal(warms, 1)
    assert.equal(companionPreparationPhase.value, 'loading')
    libraryReady.value = false; await flush()
    warming.resolve(true); await flush()
    assert.equal(companionPreparationPhase.value, 'idle', 'obsolete warmup cannot publish readiness')
    libraryReady.value = true; await flush()
    assert.equal(configures, 3); assert.equal(warms, 2)
    assert.equal(companionPreparationPhase.value, 'ready')
  } finally {
    app.unmount(); assert.equal(suspends, 1)
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
