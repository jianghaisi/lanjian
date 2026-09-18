import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalModelScheduler } from '../../../src/main/modules/models/application/local-model-scheduler'

test('owner-scoped writing clear preserves active speech and its queued successor', async () => {
  const scheduler = new LocalModelScheduler(); let voiceStopped = 0, writingEntered = false
  const releaseVoice = await scheduler.acquire('companion', () => voiceStopped++)
  scheduler.stop('writing')
  const queued = scheduler.acquire('writing', () => {}).then(release => { writingEntered = true; return release })
  await Promise.resolve(); assert.equal(writingEntered, false); assert.equal(voiceStopped, 0)
  releaseVoice(); const releaseWriting = await queued; releaseWriting()
  assert.equal(voiceStopped, 1, 'only ordinary idle owner handoff invokes the retention callback')
  scheduler.stop()
})

test('owner-scoped clear rejects its own queued job but not another active job; reentrant release is safe', async () => {
  const scheduler = new LocalModelScheduler(); let stopped = 0
  let releaseWriting = () => {}
  releaseWriting = await scheduler.acquire('writing', () => { stopped++; releaseWriting() })
  const queued = scheduler.acquire('companion', () => {})
  scheduler.stop('writing')
  const releaseVoice = await queued
  assert.equal(stopped, 1)
  const writing = scheduler.acquire('writing', () => {})
  scheduler.stop('writing'); await assert.rejects(writing)
  releaseVoice(); scheduler.stop()
})
test('active inference is protected; idle ownership changes stop the old worker',async()=>{
  const scheduler=new LocalModelScheduler();let writingStops=0,voiceStops=0
  const release=await scheduler.acquire('writing',()=>writingStops++)
  const waiting=scheduler.acquire('companion',()=>voiceStops++)
  await assert.rejects(scheduler.acquire('third',()=>{}),/另一项任务/)
  assert.equal(writingStops,0);release();const next=await waiting
  assert.equal(writingStops,1);release();assert.equal(voiceStops,0)
  next();scheduler.stop();assert.equal(voiceStops,1)
})
test('cancelling a queued caller never kills an active worker',async()=>{
  const scheduler=new LocalModelScheduler(),controller=new AbortController();let stops=0
  const release=await scheduler.acquire('writing',()=>stops++)
  const waiting=scheduler.acquire('companion',()=>{},controller.signal);controller.abort()
  await assert.rejects(waiting,/已停止/);assert.equal(stops,0);release()
  const next=await scheduler.acquire('writing',()=>stops++);next();scheduler.stop();assert.equal(stops,1)
})
