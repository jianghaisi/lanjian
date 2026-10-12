/// <reference path="../../../src/renderer/desktop.d.ts" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { usePetChatHistory } from '../../../src/renderer/features/companion/composables/use-pet-chat-history'
import { choosePetBehavior, usePetBehavior } from '../../../src/renderer/features/companion/composables/use-pet-behavior'
import { useCompanionVoice } from '../../../src/renderer/features/companion/composables/use-companion-voice'
import { petPlaybackDuration } from '../../../src/renderer/features/companion/services/pet-action-motion'
import { defaultCompanionSettings } from '../../../src/contracts/companion/companion-settings'
import type { CompanionVoiceEvent, CompanionVoiceRequest } from '../../../src/contracts/companion/companion-voice-contracts'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('behavior uses actual needs, avoids repeated gestures and discards blocked deadlines', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  assert.equal(choosePetBehavior(20, 95, 'idle'), 'stretch')
  assert.equal(choosePetBehavior(90, 20, 'idle'), 'thinking')
  assert.equal(choosePetBehavior(90, 90, 'idle'), 'greet')
  assert.notEqual(choosePetBehavior(20, 95, 'stretch'), 'stretch')
  const input = ref({ allowed: true, energy: 20, mood: 90 })
  let behavior!: ReturnType<typeof usePetBehavior>
  const app = renderer.createApp({ setup() { behavior = usePetBehavior(input, () => 0); return () => null } })
  app.mount({})
  try {
    t.mock.timers.tick(23_000); assert.equal(behavior.intent.value, 'idle')
    input.value.allowed = false
    t.mock.timers.tick(100_000); assert.equal(behavior.sequence.value, 0)
    input.value.allowed = true
    t.mock.timers.tick(23_999); assert.equal(behavior.sequence.value, 0, 'no catch-up gesture')
    t.mock.timers.tick(1); assert.equal(behavior.intent.value, 'stretch')
    input.value.allowed = false; assert.equal(behavior.intent.value, 'idle', 'interactions cancel immediately')
    input.value.energy = 90; input.value.mood = 90; input.value.allowed = true
    t.mock.timers.tick(24_000); assert.equal(behavior.intent.value, 'greet')
    t.mock.timers.tick(petPlaybackDuration('greet')); assert.equal(behavior.intent.value, 'idle')
    app.unmount(); t.mock.timers.tick(120_000); assert.equal(behavior.sequence.value, 2)
  } finally { app.unmount() }
})

test('chat records preserve partial replies and failed states, reject late updates, bound whole turns and clear on scope change', () => {
  const scope = ref<string | null>('book-a')
  let history!: ReturnType<typeof usePetChatHistory>
  const app = renderer.createApp({ setup() { history = usePetChatHistory(scope); return () => null } })
  app.mount({})
  try {
    history.receive({ kind: 'start', id: 'a', text: '你好' })
    history.receive({ kind: 'text', id: 'a', text: '已经收到的部分' })
    history.receive({ kind: 'stopped', id: 'a' })
    history.receive({ kind: 'complete', id: 'a', text: '迟到的完成' })
    assert.equal(history.turns.value[0].reply, '已经收到的部分')
    assert.equal(history.turns.value[0].status, 'stopped')
    history.receive({ kind: 'start', id: 'b', text: '重试' })
    history.receive({ kind: 'failed', id: 'b', error: '连接失败' })
    assert.equal(history.turns.value[1].error, '连接失败')
    history.clear(); history.receive({ kind: 'text', id: 'b', text: '旧输出' })
    assert.equal(history.turns.value.length, 0)
    for (let i = 0; i < 22; i++) {
      history.receive({ kind: 'start', id: String(i), text: '问'.repeat(2200) })
      history.receive({ kind: 'complete', id: String(i), text: '答'.repeat(9000) })
    }
    assert.equal(history.turns.value.length, 20)
    assert.equal(history.turns.value[0].id, '2')
    assert.equal(history.turns.value[0].user.length, 2000)
    assert.equal(history.turns.value[0].reply.length, 8000)
    scope.value = 'book-b'; assert.equal(history.turns.value.length, 0)
    history.receive({ kind: 'text', id: '21', text: '跨书迟到' }); assert.equal(history.turns.value.length, 0)
    scope.value = null
    history.receive({ kind: 'start', id: 'outside', text: '书库' }); assert.equal(history.turns.value.length, 0)
  } finally { app.unmount() }
})

test('real voice lifecycle records accepted chat only and cannot revive stopped/cleared/scoped messages', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const settings = defaultCompanionSettings(); settings.revision = 1; settings.voice.mute = true
  const requests: CompanionVoiceRequest[] = []
  const pending: Array<ReturnType<typeof deferred<{ text: string }>>> = []
  let listener!: (event: CompanionVoiceEvent) => void
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    companionSettings: { get: async () => settings, onChange: () => () => {} },
    petVoice: {
      configure: async () => true, open: async () => ({ sessionId: 'session' }), close: async () => true, cancel: async () => true,
      onEvent: (value: typeof listener) => { listener = value; return () => {} },
      request: (value: CompanionVoiceRequest) => { requests.push(value); const result = deferred<{ text: string }>(); pending.push(result); return result.promise }
    }
  } })
  const scope = ref<string | null>('book-a')
  let history!: ReturnType<typeof usePetChatHistory>, voice!: ReturnType<typeof useCompanionVoice>
  const app = renderer.createApp({ setup() {
    history = usePetChatHistory(scope)
    voice = useCompanionVoice(scope, { autoOpen: false, pet: true, api: window.petVoice, onChat: history.receive })
    return () => null
  } })
  const text = (index: number, value: string, sequence = 0) => listener({ kind: 'text', sessionId: 'session', requestId: requests[index].requestId, sequence, text: value })
  try {
    app.mount({}); await new Promise(setImmediate); await voice.open()
    assert.equal(voice.ready.value, true)
    voice.input.value = '第一句'; const first = voice.run()
    text(0, '部分回复'); voice.stop()
    text(0, '迟到文本', 1); pending[0].resolve({ text: '迟到结果' }); await first
    assert.equal(history.turns.value[0].reply, '部分回复')
    assert.equal(history.turns.value[0].status, 'stopped')
    voice.input.value = '第二句'; const second = voice.run()
    text(1, '完整回复'); pending[1].resolve({ text: '完整回复' }); await second
    assert.equal(history.turns.value[1].status, 'complete')
    assert.equal(voice.input.value, '')
    const tap = voice.run('tap'); pending[2].resolve({ text: '摸摸反馈' }); await tap
    assert.equal(history.turns.value.length, 2, 'local gestures do not masquerade as user chat')
    voice.input.value = '第三句'; const third = voice.run()
    pending[3].reject(new Error('离线失败')); await third
    assert.equal(history.turns.value[2].status, 'failed')
    assert.equal(voice.input.value, '第三句', 'failure preserves editable input')
    voice.input.value = '第四句'; const fourth = voice.run(); text(4, '未完成')
    voice.close(); history.clear(); pending[4].resolve({ text: '清空后的迟到结果' }); await fourth
    assert.equal(history.turns.value.length, 0)
    await voice.open(); voice.input.value = '第五句'; const fifth = voice.run()
    scope.value = 'book-b'; await nextTick(); text(5, '跨书输出')
    pending[5].resolve({ text: '跨书结果' }); await fifth
    assert.equal(history.turns.value.length, 0)
  } finally {
    app.unmount()
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window')
  }
})
