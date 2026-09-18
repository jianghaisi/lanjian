/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useCompanionBoot } from '../../../src/renderer/features/companion/composables/use-companion-boot'
import { useBootCompletion } from '../../../src/renderer/app/composables/use-boot-completion'
import { companionPreparationPhase, companionPreparationError, retryCompanionPreparation, useCompanionRuntime } from '../../../src/renderer/features/companion/composables/use-companion-runtime'
import { useCompanionVoicePreferences } from '../../../src/renderer/features/companion/composables/use-companion-voice-preferences'
import { useCompanionPresence } from '../../../src/renderer/features/companion/composables/use-companion-presence'
import type { CompanionVoiceEvent, CompanionVoiceRequest } from '../../../src/contracts/companion/companion-voice-contracts'

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
function globals(values: Record<string, unknown>) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value })
  return () => { for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } }
}
const storage = { getItem: () => null, setItem() {} }
const flush = () => new Promise(setImmediate)

test('runtime waits for confirmed library readiness and exposes a safe preparation failure through boot', async () => {
  let configures = 0, warms = 0
  const restore = globals({ localStorage: storage, window: { novelDesktop: { companionVoice: {
    configure: async () => { configures++; return true },
    warmup: async () => { warms++; throw { code: 'FEATURE_UNAVAILABLE', message: '初始化语音环境长时间没有完成。', recoverable: true } },
    suspend: async () => true,
  } } } })
  useCompanionVoicePreferences().update({ textModel: false, mute: false, preload: true })
  const libraryReady = ref(false), core = ref('ready'), boot = useCompanionBoot(core, ref(''), ref(false))
  const app = renderer.createApp({ setup() { useCompanionRuntime(libraryReady); return () => null } })
  try {
    app.mount({}); await flush(); await retryCompanionPreparation()
    assert.equal(configures, 0); assert.equal(warms, 0)
    libraryReady.value = true; await flush()
    assert.equal(configures, 1); assert.equal(warms, 1)
    assert.match(boot.error.value, /初始化语音环境/)
    assert.equal(companionPreparationPhase.value, 'failed')
  } finally { app.unmount(); assert.equal(companionPreparationError.value, ''); restore() }
})

test('opening waits for its single library preparation owner, reports failure, retries, then becomes ready', async () => {
  const pending = deferred<boolean>()
  let warms = 0, configures = 0, suspends = 0
  const restore = globals({ localStorage: storage, window: { novelDesktop: { companionVoice: {
    configure: async () => { configures++; return true }, warmup: async () => ++warms === 1 ? pending.promise : true,
    suspend: async () => { suspends++; return true },
  } } } })
  const prefs = useCompanionVoicePreferences(); prefs.update({ textModel: false, mute: false, preload: true })
  const core = ref('projects'), coreError = ref(''), preview = ref(false)
  const boot = useCompanionBoot(core, coreError, preview)
  const app = renderer.createApp({ setup() { useCompanionRuntime(); return () => null } })
  try {
    app.mount({}); await flush()
    assert.equal(boot.phase.value, 'projects')
    core.value = 'ready'
    assert.equal(boot.phase.value, 'models'); assert.equal(boot.canSkip.value, true)
    assert.match(boot.detail.value, /语音模型/)
    assert.equal(configures, 1); assert.equal(warms, 1)
    pending.resolve(false); await flush()
    assert.match(boot.error.value, /未能完成准备/); assert.equal(boot.phase.value, 'models')
    await boot.retryModels()
    assert.equal(warms, 2); assert.equal(boot.phase.value, 'ready'); assert.equal(boot.error.value, '')
    assert.equal(boot.canSkip.value, false)
  } finally { app.unmount(); assert.equal(suspends, 1); restore() }
})

test('no-models and preload-off bypass model readiness, preview does not load, skip never rewrites preferences or masks core errors', () => {
  const restore = globals({ localStorage: storage })
  const prefs = useCompanionVoicePreferences()
  const core = ref('ready'), coreError = ref(''), preview = ref(false)
  companionPreparationPhase.value = 'loading'
  try {
    const boot = useCompanionBoot(core, coreError, preview)
    prefs.update({ textModel: false, mute: true, preload: true })
    assert.equal(boot.phase.value, 'ready'); assert.equal(boot.required.value, false)
    prefs.update({ textModel: true, mute: false, preload: false })
    assert.equal(boot.phase.value, 'ready'); assert.match(boot.detail.value, /未开启预加载/)
    prefs.update({ preload: true }); assert.equal(boot.phase.value, 'models')
    preview.value = true; assert.equal(boot.phase.value, 'ready'); assert.equal(boot.canSkip.value, false)
    preview.value = false
    const saved = JSON.stringify(prefs.preferences.value)
    boot.skipWaiting(); assert.equal(boot.phase.value, 'ready'); assert.equal(boot.skipped.value, true)
    assert.equal(companionPreparationPhase.value, 'loading'); assert.equal(JSON.stringify(prefs.preferences.value), saved)
    companionPreparationPhase.value = 'failed'; assert.match(boot.detail.value, /尚未就绪/)
    coreError.value = '作品清单读取失败'; assert.equal(boot.error.value, coreError.value)
  } finally { companionPreparationPhase.value = 'idle'; restore() }
})

test('three-second completion begins only after readiness, resets on lost readiness, and cancels on unmount', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
  const ready = ref(false); let completed = 0
  const app = renderer.createApp({ setup() { useBootCompletion(ready, () => completed++); return () => null } })
  app.mount({})
  try {
    t.mock.timers.tick(60_000); assert.equal(completed, 0)
    ready.value = true; await nextTick()
    t.mock.timers.tick(2999); assert.equal(completed, 0)
    ready.value = false; await nextTick(); t.mock.timers.tick(10_000); assert.equal(completed, 0)
    ready.value = true; await nextTick(); t.mock.timers.tick(3000); assert.equal(completed, 1)
    ready.value = false; await nextTick(); ready.value = true; await nextTick()
    app.unmount(); t.mock.timers.tick(3000); assert.equal(completed, 1)
  } finally { t.mock.timers.reset() }
})

test('tap keeps synthesis alive across a long audio gap and dismisses only after request AND last source finish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pending = deferred<{ text: string }>()
  let listener!: (event: CompanionVoiceEvent) => void, request!: CompanionVoiceRequest
  let cancels = 0, closes = 0, bootVisible = true
  const sources: Array<{ onended: (() => void) | null; stop(): void }> = []
  class FakeAudioContext {
    currentTime = 0; destination = {}
    async resume() {} async close() {}
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) } }
    createBufferSource() {
      const source = { onended: null as (() => void) | null, buffer: undefined, connect() {}, disconnect() {}, start() {}, stop() {} }
      sources.push(source); return source
    }
  }
  const restore = globals({ localStorage: storage, AudioContext: FakeAudioContext,
    document: { hidden: false, hasFocus: () => true, querySelector: () => bootVisible ? {} : null, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, novelDesktop: { companionVoice: {
      configure: async () => true, open: async () => ({ sessionId: 'tap-session' }),
      request: (value: CompanionVoiceRequest) => { request = value; return pending.promise },
      cancel: async () => { cancels++; return true }, close: async () => { closes++; return true },
      onEvent: (value: (event: CompanionVoiceEvent) => void) => { listener = value; return () => {} },
    } } },
  })
  const prefs = useCompanionVoicePreferences(); prefs.update({ mute: false, textModel: false, proactive: false, subtitles: true })
  let presence!: ReturnType<typeof useCompanionPresence>
  const app = renderer.createApp({ setup() { presence = useCompanionPresence(ref(null), ref(false), ref(false)); return () => null } })
  try {
    app.mount({}); presence.tap(); await flush(); assert.equal(request, undefined, 'opening overlay suppresses automatic/tap speech')
    bootVisible = false; presence.tap(); await flush()
    assert.ok(request); const baseline = cancels
    let sequence = 0
    const send = (event: { kind: 'text'; text: string } | { kind: 'audio'; pcm: Uint8Array; sampleRate: 24000 }) => listener({ sessionId: request.sessionId, requestId: request.requestId, sequence: sequence++, ...event })
    send({ kind: 'text', text: '欢迎回来。今天继续写故事吧。' })
    send({ kind: 'audio', pcm: new Uint8Array(4800), sampleRate: 24000 }); await nextTick()
    assert.equal(presence.playing.value, true)
    sources[0]!.onended!(); await nextTick()
    t.mock.timers.tick(8000); await nextTick()
    assert.equal(presence.visible.value, true); assert.equal(cancels, baseline, 'a fragment gap must not cancel synthesis')
    send({ kind: 'audio', pcm: new Uint8Array(9600), sampleRate: 24000 }); await nextTick()
    pending.resolve({ text: '欢迎回来。今天继续写故事吧。' }); await flush()
    t.mock.timers.tick(5000); await nextTick()
    assert.equal(presence.visible.value, true); assert.equal(cancels, baseline, 'a completed request must still let scheduled audio finish')
    sources[1]!.onended!(); await nextTick()
    t.mock.timers.tick(4499); assert.equal(presence.visible.value, true)
    t.mock.timers.tick(1); assert.equal(presence.visible.value, false); assert.equal(cancels, baseline + 1); assert.equal(closes, 1)
  } finally { app.unmount(); t.mock.timers.reset(); restore() }
})
