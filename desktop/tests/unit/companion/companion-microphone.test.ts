/// <reference path="../../../src/renderer/desktop.d.ts" />
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, ref } from 'vue'
import { usePetMicrophone } from '../../../src/renderer/features/companion/composables/use-pet-microphone'
import { defaultCompanionSettings } from '../../../src/contracts/companion/companion-settings'
const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
const settle = () => new Promise(setImmediate)
test('real recording composable releases late permission and suppresses canceled / edited transcripts', async t => {
  const old = new Map(['window','document','navigator','AudioContext','AudioWorkletNode'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis,name)]))
  let unmount: (() => void) | undefined
  t.after(() => { unmount?.(); for (const [name, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis,name,descriptor); else Reflect.deleteProperty(globalThis,name) } })
  const id = '12345678-1234-1234-1234-123456789abc', settings = defaultCompanionSettings(); settings.microphone.enabled = true
  let permission!: (stream: unknown) => void, result!: (value: {text:string}) => void, stopped = 0, closed = 0, cancels = 0, submits = 0, begins = 0
  const track = { stop() { stopped++ }, onended: null }, stream = { getTracks: () => [track] }
  let currentNode: { port: { onmessage?: (event: {data: unknown}) => void; postMessage: () => void; close: () => void } }
  const events = { addEventListener() {}, removeEventListener() {} }
  const globals = {
    window: { ...events, companionSettings: { get: async () => settings, onChange: () => () => {} }, companionAsr: { begin: async () => { begins++; return {captureId:id} }, cancel: async () => { cancels++; return true }, publishDevices: async () => true, transcribe: () => { submits++; return new Promise(resolve => { result = resolve }) } } },
    document: { ...events, hidden:false }, navigator: { mediaDevices: { ...events, enumerateDevices: async () => [], getUserMedia: () => new Promise(resolve => { permission = resolve }) } },
    AudioContext: class { sampleRate = 48000; destination = {}; audioWorklet = { addModule: async () => {} }; createGain() { return { gain:{value:1}, connect() {} } } createMediaStreamSource() { return {connect() {}} } resume() {return Promise.resolve()} close() {closed++; return Promise.resolve()} },
    AudioWorkletNode: class { port = { onmessage: undefined as ((event:{data:unknown})=>void)|undefined, postMessage: () => { this.port.onmessage?.({data:'flushed'}) }, close() {} }; constructor() { currentNode = this } connect() {} disconnect() {} },
  }
  for (const [name,value] of Object.entries(globals)) Object.defineProperty(globalThis,name,{configurable:true,value})
  const draft = ref('原草稿'), scope = ref<string|null>('work'); let mic!: ReturnType<typeof usePetMicrophone>
  const app = renderer.createApp({setup(){mic=usePetMicrophone(draft,scope,()=>{});return()=>null}}); app.mount({}); unmount = () => app.unmount(); await settle()
  const first = mic.start(); await settle(); mic.cancel(); permission(stream); await first
  assert.equal(stopped,1); assert.equal(submits,0); assert.equal(mic.active.value,false)
  const second = mic.start(); await settle(); permission(stream); await second
  currentNode!.port.onmessage?.({data:new Float32Array(48000).fill(.3)})
  const finished = mic.finish(); await settle(); assert.equal(stopped,2); assert.equal(closed,1)
  draft.value='作者后来输入的文字'; result({text:'识别出的文字'}); await finished
  assert.equal(draft.value,'作者后来输入的文字'); assert.equal(mic.alternative.value,'识别出的文字')
  await t.test('pending transcript survives another recording attempt and explicit adoption appends once', async () => {
    const count = begins
    await mic.start(); assert.equal(begins, count); assert.equal(mic.alternative.value, '识别出的文字')
    mic.useAlternative(); assert.equal(draft.value, '作者后来输入的文字\n识别出的文字'); assert.equal(mic.alternative.value, '')
    mic.useAlternative(); assert.equal(draft.value, '作者后来输入的文字\n识别出的文字')
  })
  async function recognize(text: string) {
    const start = mic.start(); await settle(); permission(stream); await start
    currentNode!.port.onmessage?.({ data: new Float32Array(48000).fill(.3) })
    const finished = mic.finish(); await settle(); result({ text }); await finished
    assert.equal(mic.active.value, false)
  }
  await t.test('unchanged existing draft is preserved until explicit append', async () => {
    draft.value = '已有草稿'
    await recognize('新的口述')
    assert.equal(draft.value, '已有草稿'); assert.equal(mic.alternative.value, '新的口述')
    draft.value += '\n'; mic.useAlternative()
    assert.equal(draft.value, '已有草稿\n新的口述'); assert.equal(mic.alternative.value, '')
  })
  await t.test('empty unchanged draft fills directly without sending', async () => {
    draft.value = ''
    await recognize('直接回填')
    assert.equal(draft.value, '直接回填'); assert.equal(mic.alternative.value, '')
  })
  await t.test('append overflow retains both texts and remains recoverable', async () => {
    draft.value = '长'.repeat(1998)
    await recognize('口述内容')
    mic.useAlternative()
    assert.equal(draft.value, '长'.repeat(1998)); assert.equal(mic.alternative.value, '口述内容'); assert.match(mic.error.value, /2000/)
    draft.value = '短草稿'; mic.useAlternative()
    assert.equal(draft.value, '短草稿\n口述内容'); assert.equal(mic.error.value, '')
  })
  await t.test('discard and cancel never delete typed text, and cancellation preserves the candidate', async () => {
    draft.value = '作者后来输入的文字'; await recognize('待放弃')
    mic.cancel(); assert.equal(mic.alternative.value, '待放弃')
    mic.discardAlternative(); assert.equal(mic.alternative.value, ''); assert.equal(draft.value, '作者后来输入的文字')
  })
  const third = mic.start(); await settle(); permission(stream); await third
  currentNode!.port.onmessage?.({data:new Float32Array(48000).fill(.3)})
  const pending = mic.finish(); await settle(); scope.value='another-work'; result({text:'旧书迟到结果'}); await pending
  assert.equal(mic.alternative.value,''); assert.equal(draft.value,'作者后来输入的文字'); assert.ok(cancels>=3)
  await t.test('scope change discards pending candidate and an inactive book cannot begin recording', async () => {
    await recognize('仅此作品')
    assert.equal(mic.alternative.value, '仅此作品')
    scope.value = null
    assert.equal(mic.alternative.value, '')
    const count = begins; await mic.start(); assert.equal(begins, count)
  })
})
