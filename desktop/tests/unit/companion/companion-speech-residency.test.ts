import assert from 'node:assert/strict'
import test from 'node:test'
import { access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { LocalVoiceRuntime, COMPANION_IDLE_MS } from '../../../src/main/modules/companion/adapters/companion-voice/local-runtime'
import { LocalModelScheduler } from '../../../src/main/modules/models/application/local-model-scheduler'

const root = resolve('../../.local/companion-voice')
const worker = resolve('tests/fixtures/companion-worker.py')
const input = { action: 'tts' as const, text: 'ok', voice: 'ningguang' as const }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('speech cancellation drains silently, keeps its real PID and lease through work cleanup, and survives idle', async t => {
  try { await access(join(root, 'gpt-sovits-audition/venv/pyvenv.cfg')) } catch { t.skip('isolated Python unavailable'); return }
  const scheduler = new LocalModelScheduler(), runtime = new LocalVoiceRuntime(root, worker, scheduler, 'speech')
  t.after(() => { t.mock.timers.reset(); runtime.stop(); scheduler.stop() })
  const pid = Number((await runtime.run(input)).header.pid)
  let chunks = 0
  const controller = new AbortController()
  await assert.rejects(runtime.run({ ...input, text: 'drain' }, controller.signal, undefined, () => { chunks++; controller.abort() }), /VOICE_CANCELLED/)
  assert.doesNotThrow(() => process.kill(pid, 0))
  scheduler.stop('writing')
  let writerEntered = false
  const writer = scheduler.acquire('writing', () => {}).then(release => { writerEntered = true; return release })
  await pause(100); assert.equal(writerEntered, false, 'cancelled GPU work still owns its lease')
  const release = await writer; release()
  assert.equal(chunks, 1, 'late cancelled audio was drained, not published')
  assert.equal((await runtime.run(input)).header.pid, pid, 'writing handoff retains the engine')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.timers.tick(COMPANION_IDLE_MS * 2)
  t.mock.timers.reset()
  assert.equal((await runtime.run(input)).header.pid, pid, 'speech has no idle eviction')
  runtime.cancel()
  assert.equal((await runtime.run(input)).header.pid, pid)
  runtime.stop(); await pause(150)
  assert.throws(() => process.kill(pid, 0), 'app shutdown terminates the owned worker')
})

test('speech timeout rejects promptly without killing the model or publishing its late frames', async t => {
  try { await access(join(root, 'gpt-sovits-audition/venv/pyvenv.cfg')) } catch { t.skip('isolated Python unavailable'); return }
  const scheduler = new LocalModelScheduler(), runtime = new LocalVoiceRuntime(root, worker, scheduler, 'speech')
  t.after(() => { t.mock.timers.reset(); runtime.stop(); scheduler.stop() })
  const pid = Number((await runtime.run(input)).header.pid)
  let chunks = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await assert.rejects(runtime.run({ ...input, text: 'drain' }, undefined, undefined, () => { chunks++; t.mock.timers.tick(180000) }), /VOICE_TIMEOUT/)
  t.mock.timers.reset()
  assert.doesNotThrow(() => process.kill(pid, 0))
  assert.equal((await runtime.run(input)).header.pid, pid, 'next request waits for drain, then reuses the model')
  assert.equal(chunks, 1)
})
