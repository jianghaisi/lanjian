/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import type { CompanionVoiceApi, CompanionVoiceEvent, CompanionVoiceRequest } from '../../../src/contracts/companion/companion-voice-contracts'
import { useCompanionVoice } from '../../../src/renderer/features/companion/composables/use-companion-voice'
import { useCompanionVoiceCheck } from '../../../src/renderer/features/companion/composables/use-companion-voice-check'
import { useCompanionVoicePreferences } from '../../../src/renderer/features/companion/composables/use-companion-voice-preferences'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
const flush = () => new Promise(setImmediate)
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

async function fixture(overrides: Partial<CompanionVoiceApi> = {}, context: 'running' | 'suspended' | 'unknown' | 'reject' | 'pending' = 'running') {
  const originals = new Map(['window', 'localStorage', 'AudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls: string[] = [], sources: Array<{ onended: (() => void) | null; stop(): void }> = [], contexts: AudioContext[] = []
  const response = deferred<{ text: string }>(), resume = deferred<void>()
  let emit!: (event: CompanionVoiceEvent) => void, reset!: (id: string) => void, current!: CompanionVoiceRequest, sequence = 0, writes = 0
  const api: CompanionVoiceApi = {
    status: async () => { calls.push('status'); return { installed: false, textInstalled: false, speechInstalled: true, profile: 'gpt-sovits-v2-fp16' } },
    configure: async () => { calls.push('configure'); return true },
    prepare: async voice => { calls.push(`prepare:${voice}`); return true },
    warmup: async () => { calls.push('FORBIDDEN:warmup'); return true }, suspend: async () => { calls.push('FORBIDDEN:suspend'); return true },
    open: async () => { calls.push('open'); return { sessionId: 'test-session' } },
    request: input => { calls.push(`request:${input.action}`); current = input; sequence = 0; return response.promise },
    cancel: async () => { calls.push('cancel'); return true }, close: async () => { calls.push('close'); return true },
    onEvent: callback => { emit = callback; return () => {} }, onReset: callback => { reset = callback; return () => {} }, ...overrides,
  }
  class AudioContext {
    state: string | undefined = context === 'unknown' ? undefined : context
    onstatechange: (() => void) | null = null
    constructor() { contexts.push(this) }
    changeState(state: string) { this.state = state; this.onstatechange?.() }
    currentTime = 0; destination = {}
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    resume() { calls.push('resume'); if (this.state === 'closed') return Promise.reject(new Error('context closed')); return context === 'reject' ? Promise.reject(new Error('private audio error')) : context === 'pending' ? resume.promise : Promise.resolve() }
    close() { calls.push('audio-close'); return Promise.resolve() }
    createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) } }
    createBufferSource() { const source = { buffer: undefined, onended: null as (() => void) | null, connect() {}, disconnect() {}, start() { calls.push('scheduled') }, stop() { calls.push('stopped') } }; sources.push(source); return source }
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { novelDesktop: { companionVoice: api } } },
    localStorage: { configurable: true, value: { getItem: () => null, setItem() { writes++ } } },
    AudioContext: { configurable: true, value: AudioContext },
  })
  const prefs = useCompanionVoicePreferences()
  await prefs.update({ mute: false, volume: .65, textModel: false, preload: false, voice: 'ganyu' })
  writes = 0
  let voice!: ReturnType<typeof useCompanionVoice>, check!: ReturnType<typeof useCompanionVoiceCheck>
  const app = renderer.createApp({ setup() { voice = useCompanionVoice(ref(null), { autoOpen: false }); check = useCompanionVoiceCheck(voice); return () => null } })
  app.mount({})
  let unmounted = false
  return { voice, check, prefs, calls, sources, contexts, response, resume,
    audio() { emit({ sessionId: current.sessionId, requestId: current.requestId, sequence: sequence++, kind: 'audio', pcm: new Uint8Array([0, 1, 0, 2]), sampleRate: 24000 }) },
    reset() { reset('test-session') }, writes: () => writes,
    unmount() { if (!unmounted) { app.unmount(); unmounted = true } },
    dispose() { if (!unmounted) app.unmount(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } },
  }
}

test('self-check is lazy, speech-only, and requires settled request, natural ends and author confirmation', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 0; t.mock.method(performance, 'now', () => now)
  const f = await fixture()
  try {
    await flush(); assert.equal(f.calls.length, 0)
    const checking = f.check.start(); await flush()
    assert.deepEqual(f.calls.filter(c => !['cancel', 'resume'].includes(c)), ['status', 'configure', 'open', 'prepare:ganyu', 'request:preview'])
    f.audio(); f.sources[0]!.onended!()
    now += 8_000; t.mock.timers.tick(8_000)
    assert.equal(f.voice.playing.value, false)
    assert.equal(f.check.result.value, 'running', '8s fragment gap cannot finish request')
    f.audio(); f.response.resolve({ text: 'PRIVATE fixed preview' }); await checking
    assert.equal(f.check.result.value, 'running', 'request completion alone cannot finish queued audio')
    f.sources[1]!.onended!(); await nextTick()
    assert.equal(f.check.result.value, 'confirm')
    assert.equal(f.check.steps.value.at(-1)!.state, '通过')
    assert.equal(JSON.stringify(f.check.steps.value).includes('PRIVATE'), false)
    f.check.confirm(false); assert.equal(f.check.result.value, 'unheard'); assert.match(f.check.message.value, /音量混合器/)
    assert.equal(f.writes(), 0)
    assert.equal(f.calls.some(c => c.startsWith('FORBIDDEN')), false)
  } finally { f.dispose(); t.mock.timers.reset() }
})

for (const state of ['suspended', 'closed'] as const) for (const stage of ['synthesis', 'drain'] as const) test(`channel ${state} during ${stage} fails promptly and ignores late output`, async () => {
  const f = await fixture()
  try {
    const checking = f.check.start(); await flush(); f.audio()
    if (stage === 'drain') { f.response.resolve({ text: 'done' }); await checking }
    f.contexts[0]!.changeState(state)
    assert.equal(f.check.result.value, 'failed')
    assert.equal(f.check.steps.value.find(step => step.id === 'audio')!.state, '未就绪')
    assert.match(f.check.message.value, /播放通道/)
    assert.equal(f.voice.playing.value, false)
    assert.ok(f.sources.every(source => source.onended === null))
    const count = f.sources.length
    f.audio(); f.response.resolve({ text: 'late' }); await checking
    assert.equal(f.sources.length, count); assert.equal(f.check.result.value, 'failed')
    f.check.confirm(true); assert.equal(f.check.result.value, 'failed')
    assert.equal(f.calls.filter(call => call === 'resume').length, 1, 'no automatic resume')
    assert.equal(f.calls.some(call => call.startsWith('FORBIDDEN')), false)
  } finally { f.dispose() }
})

test('explicit retry replaces a closed context and old context events cannot invalidate the new attempt', async () => {
  const f = await fixture()
  try {
    const first = f.check.start(); await flush()
    const oldContext = f.contexts[0]!, stale = oldContext.onstatechange
    oldContext.changeState('closed')
    assert.equal(f.check.result.value, 'failed')
    const second = f.check.start(); await flush()
    assert.equal(f.contexts.length, 2)
    assert.equal(oldContext.onstatechange, null)
    stale?.()
    assert.equal(f.check.result.value, 'running'); assert.equal(f.calls.filter(call => call === 'request:preview').length, 2)
    f.audio(); f.response.resolve({ text: 'done' }); await Promise.all([first, second])
    f.sources[0]!.onended!()
    assert.equal(f.check.result.value, 'confirm')
    f.unmount(); assert.equal(f.contexts[1]!.onstatechange, null)
  } finally { f.dispose() }
})

for (const mode of ['mute', 'zero'] as const) test(`disabled/zero-volume: ${mode} performs no inference or writes`, async () => {
  const f = await fixture()
  try {
    await f.prefs.update(mode === 'mute' ? { mute: true } : { volume: 0 }); await nextTick()
    const writes = f.writes(); await f.check.start()
    assert.deepEqual(f.calls, []); assert.equal(f.writes(), writes)
    assert.equal(f.check.result.value, 'failed'); assert.equal(f.check.steps.value[0]!.state, '未就绪')
    assert.ok(f.check.steps.value.slice(1).every(step => step.state === '未检查'))
  } finally { f.dispose() }
})

for (const mode of ['missing', 'false', 'error', 'timeout', 'no-pcm', 'synthesis'] as const) test(`honest diagnostic failure: ${mode}`, async () => {
  const overrides: Partial<CompanionVoiceApi> = mode === 'missing' ? { status: async () => ({ installed: false, textInstalled: false, speechInstalled: false, profile: 'gpt-sovits-v2-fp16' }) }
    : mode === 'false' ? { prepare: async () => false }
    : mode === 'error' ? { prepare: async () => { throw new Error('SECRET C:/private/checkpoint') } }
    : mode === 'timeout' ? { prepare: async () => { throw { code: 'FEATURE_UNAVAILABLE', message: '语音模型准备超时，请重试。' } } } : {}
  const f = await fixture(overrides)
  try {
    const checking = f.check.start(); await flush()
    if (mode === 'no-pcm') f.response.resolve({ text: 'not audio' })
    if (mode === 'synthesis') f.response.reject(new Error('SECRET model stderr'))
    await checking
    assert.equal(f.check.result.value, 'failed'); assert.doesNotMatch(f.check.message.value, /SECRET/)
    if (mode === 'no-pcm') assert.match(f.check.message.value, /未收到音频/)
    if (mode === 'timeout') assert.match(f.check.message.value, /超时/)
    assert.equal(f.calls.includes('FORBIDDEN:warmup'), false)
  } finally { f.dispose() }
})

for (const context of ['reject', 'suspended', 'unknown'] as const) test(`WebAudio ${context} never passes or submits synthesis`, async () => {
  const f = await fixture({}, context)
  try {
    await f.check.start()
    assert.equal(f.check.result.value, 'failed'); assert.equal(f.calls.includes('request:preview'), false)
    assert.notEqual(f.check.steps.value.find(step => step.id === 'audio')!.state, '通过')
  } finally { f.dispose() }
})

for (const stage of ['status', 'configure', 'open', 'prepare', 'audio', 'request', 'drain'] as const) test(`stop suppresses late continuation at ${stage}`, async () => {
  const pending = deferred<void>()
  const methods: Partial<CompanionVoiceApi> = {
    status: async () => { await pending.promise; return { installed: false, textInstalled: false, speechInstalled: true, profile: 'gpt-sovits-v2-fp16' } },
    configure: async () => { await pending.promise; return true },
    open: async () => { await pending.promise; return { sessionId: 'late' } },
    prepare: async () => { await pending.promise; return true },
  }
  const overrides = stage in methods ? { [stage]: methods[stage as keyof typeof methods] } : {}
  const f = await fixture(overrides, stage === 'audio' ? 'pending' : 'running')
  try {
    const checking = f.check.start(); await flush()
    if (stage === 'request' || stage === 'drain') f.audio()
    if (stage === 'drain') { f.response.resolve({ text: 'done' }); await checking }
    f.check.cancel(); const count = f.sources.length
    pending.resolve()
    f.resume.resolve(); f.response.resolve({ text: 'late' }); await checking
    if (stage === 'request' || stage === 'drain') f.audio()
    assert.equal(f.sources.length, count)
    assert.equal(f.check.result.value, 'stopped')
    assert.ok(f.sources.every(source => source.onended === null))
  } finally { f.dispose() }
})

for (const action of ['voice', 'model', 'reset', 'unmount'] as const) test(`invalidation during preparation: ${action}`, async () => {
  const pending = deferred<boolean>(), f = await fixture({ prepare: () => pending.promise })
  try {
    const checking = f.check.start(); await flush()
    if (action === 'voice') await f.prefs.update({ voice: 'keqing' })
    if (action === 'model') await f.prefs.update({ mute: true })
    if (action === 'reset') f.reset()
    if (action === 'unmount') f.unmount()
    pending.reject(new Error('late SECRET')); await checking
    assert.notEqual(f.check.result.value, 'running'); assert.notEqual(f.check.result.value, 'confirm')
    assert.equal(f.calls.includes('request:preview'), false)
  } finally { f.dispose() }
})

test('retry is explicit and software completion is not heard until confirmed', async () => {
  let prepares = 0
  const f = await fixture({ prepare: async () => ++prepares > 1 })
  try {
    await f.check.start(); assert.equal(f.check.result.value, 'failed'); await flush(); assert.equal(prepares, 1)
    const checking = f.check.start(); await flush(); f.audio(); f.sources[0]!.onended!()
    f.response.resolve({ text: 'test' }); await checking
    assert.equal(f.check.result.value, 'confirm'); f.check.confirm(true); assert.equal(f.check.result.value, 'heard')
  } finally { f.dispose() }
})

test('bounded waiting times out without an automatic restart; late readiness is discarded', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); let now = 0; t.mock.method(performance, 'now', () => now)
  const pending = deferred<boolean>(), f = await fixture({ prepare: () => pending.promise })
  try {
    const checking = f.check.start(); await flush(); now = 610_001; t.mock.timers.tick(250)
    assert.equal(f.check.result.value, 'failed'); assert.match(f.check.message.value, /超时/)
    pending.resolve(true); await checking; assert.equal(f.calls.includes('request:preview'), false)
  } finally { f.dispose(); t.mock.timers.reset() }
})

test('unavailable bridge is reported without attempting inference', async () => {
  const f = await fixture()
  let check!: ReturnType<typeof useCompanionVoiceCheck>
  const api = window.novelDesktop!.companionVoice
  Reflect.deleteProperty(window.novelDesktop!, 'companionVoice')
  const app = renderer.createApp({ setup() { check = useCompanionVoiceCheck(f.voice); return () => null } })
  try {
    app.mount({}); await check.start()
    assert.equal(check.result.value, 'failed'); assert.match(check.message.value, /当前环境不支持/)
    assert.equal(f.calls.length, 0)
  } finally { app.unmount(); Object.assign(window.novelDesktop!, { companionVoice: api }); f.dispose() }
})

test('late preparation failure cannot overwrite a new successful attempt', async () => {
  const old = deferred<boolean>(); let prepares = 0
  const f = await fixture({ prepare: () => ++prepares === 1 ? old.promise : Promise.resolve(true) })
  try {
    const first = f.check.start(); await flush(); f.check.cancel()
    const second = f.check.start(); await flush()
    old.reject(new Error('OLD SECRET')); await first
    assert.equal(f.check.result.value, 'running')
    f.audio(); f.sources[0]!.onended!(); f.response.resolve({ text: 'done' }); await second
    assert.equal(f.check.result.value, 'confirm'); assert.doesNotMatch(f.check.message.value, /OLD/)
  } finally { f.dispose() }
})
