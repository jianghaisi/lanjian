import test from 'node:test'
import assert from 'node:assert/strict'
import { CompanionAsrService } from '../../../src/main/modules/companion/application/companion-asr-service'
import { decodeAsrInput } from '../../../src/contracts/companion/companion-asr'
import { microphonePcm } from '../../../src/renderer/features/companion/services/pet-microphone-pcm'
const id = '12345678-1234-1234-1234-123456789abc'
test('ASR rejects oversized, malformed and unowned PCM before inference', async () => {
  let called = 0
  const service = new CompanionAsrService(async () => { called++; return '你好' }), capture = service.begin(1)
  const input = { ...capture, sampleRate: 16000 as const, pcm: new Uint8Array(3200) }
  for (const invalid of [{ ...input, sampleRate: 48000 }, { ...input, pcm: new Uint8Array(960002) }, { ...input, pcm: new Uint8Array(3201) }, { ...input, extra: true }]) assert.throws(() => decodeAsrInput(invalid))
  await assert.rejects(service.transcribe(2, input)); assert.equal(called, 0)
  assert.equal(service.permitted(1), true)
  assert.deepEqual(await service.transcribe(1, input), { text: '你好' })
  await assert.rejects(service.transcribe(1, input)); assert.equal(called, 1)
})
test('owner/scope cancellation aborts inference and rejects late transcript without affecting new capture', async () => {
  let complete!: (text: string) => void, signal!: AbortSignal
  const service = new CompanionAsrService((_pcm, abort) => { signal = abort; return new Promise(resolve => { complete = resolve }) })
  const first = service.begin(1), pending = service.transcribe(1, { ...first, sampleRate: 16000, pcm: new Uint8Array(3200) })
  assert.equal(service.permitted(1), false)
  service.cancel(2); assert.equal(signal.aborted, false)
  service.cancel(1, first.captureId); assert.equal(signal.aborted, true)
  const next = service.begin(1); complete('迟到内容')
  await assert.rejects(pending, /取消/)
  service.cancel(1, first.captureId); assert.equal(service.permitted(1), true)
  service.cancel(1, next.captureId); assert.equal(service.active, false)
})
test('unsubmitted capture expires without keeping microphone permission alive', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const service = new CompanionAsrService(async () => '')
  service.begin(1); t.mock.timers.tick(45000); assert.equal(service.permitted(1), false)
  t.mock.timers.reset()
})
test('PCM resamples real device rates to bounded 16 kHz mono, clamps and rejects silence', () => {
  for (const rate of [16000, 44100, 48000]) {
    const source = new Float32Array(rate).fill(.5), result = microphonePcm([source.subarray(0, 777), source.subarray(777)], rate)
    assert.equal(result.byteLength, 32000); assert.equal(new DataView(result.buffer).getInt16(100, true), 16384)
    assert.equal(decodeAsrInput({ captureId: id, pcm: result, sampleRate: 16000 }).pcm.length, 32000)
  }
  assert.throws(() => microphonePcm([new Float32Array(48000)], 48000), /声音/)
  assert.throws(() => microphonePcm([new Float32Array(10)], 16000), /太短/)
  assert.throws(() => microphonePcm([new Float32Array(16000 * 31)], 16000), /30 秒/)
})
