import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeFrame, VoiceFrameReader, MAX_HEADER, MAX_PCM } from '../../../src/main/modules/companion/adapters/companion-voice/protocol'
import { LocalVoiceRuntime, COMPANION_IDLE_MS } from '../../../src/main/modules/companion/adapters/companion-voice/local-runtime'
import { resolve } from 'node:path'

test('private voice protocol handles partial UTF-8 and binary boundaries', () => {
  const reader = new VoiceFrameReader()
  const encoded = encodeFrame({ v: 1, id: 'safe-id', ok: true, text: '岚笺你好' }, Buffer.from([0, 10, 255, 13]))
  const results = [...encoded].flatMap(byte => reader.push(Buffer.from([byte])))
  assert.equal(results.length, 1)
  assert.equal(results[0]!.header.text, '岚笺你好')
  assert.deepEqual(results[0]!.pcm, Buffer.from([0, 10, 255, 13]))
})
test('private protocol handles ordered text frames without retaining whole conversation', () => {
  const reader = new VoiceFrameReader()
  const frames = reader.push(Buffer.concat(['你', '你好', '你好。'].map(text => encodeFrame({ v: 1, id: 'one', kind: 'delta', text }))))
  assert.deepEqual(frames.map(f => f.header.text), ['你', '你好', '你好。'])
})
test('private protocol rejects oversized, odd, malformed, wrong-version and invalid-ID payloads', () => {
  for (const value of [{ v: 2, id: 'one', pcmBytes: 0 }, { v: 1, id: '../path', pcmBytes: 0 }, { v: 1, id: 'one', pcmBytes: MAX_PCM + 2 }, { v: 1, id: 'one', pcmBytes: 3 }, []]) {
    const raw = Buffer.from(JSON.stringify(value)), prefix = Buffer.alloc(4)
    prefix.writeUInt32LE(raw.length)
    assert.throws(() => new VoiceFrameReader().push(Buffer.concat([prefix, raw])))
  }
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(MAX_HEADER + 1)
  assert.throws(() => new VoiceFrameReader().push(prefix))
  assert.throws(() => encodeFrame({ long: 'x'.repeat(MAX_HEADER) }))
})

test('idle cancel preserves real PID, active cancel kills it, and only ten-minute idle expires it', async t => {
  const runtime = new LocalVoiceRuntime(resolve('../../.local/companion-voice'), resolve('tests/fixtures/companion-worker.py'))
  if(!await runtime.available()) { t.skip('isolated test Python unavailable');return }
  t.after(()=>{t.mock.timers.reset();runtime.stop()})
  const input = {action:'chat' as const,text:'ok',context:'synthetic',history:[]}
  const first = await runtime.run(input)
  assert.equal(first.header.leaked,false)
  const pid = Number(first.header.pid)
  runtime.cancel()
  assert.equal((await runtime.run(input)).header.pid,pid)
  const controller = new AbortController()
  await assert.rejects(runtime.run({...input,text:'wait'},controller.signal,()=>controller.abort()),/VOICE_CANCELLED/)
  await new Promise(resolve=>setTimeout(resolve,150))
  assert.throws(()=>process.kill(pid,0))
  assert.equal(COMPANION_IDLE_MS,600000)
  t.mock.timers.enable({apis:['setTimeout']})
  const next = await runtime.run(input), nextPid = Number(next.header.pid)
  // Windows can reuse an exited PID immediately. The fixture's boot identity
  // proves this is a fresh worker; liveness checks below still use the real PID.
  assert.notEqual(first.header.instance,next.header.instance)
  runtime.cancel()
  t.mock.timers.tick(COMPANION_IDLE_MS-1)
  assert.doesNotThrow(()=>process.kill(nextPid,0))
  t.mock.timers.tick(1)
  t.mock.timers.reset()
  await new Promise(resolve=>setTimeout(resolve,150))
  assert.throws(()=>process.kill(nextPid,0))
})
