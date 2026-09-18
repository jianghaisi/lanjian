import assert from 'node:assert/strict'
import test from 'node:test'
import { CompanionNoticePolicy, companionHoldMs } from '../../../src/contracts/companion/companion-presence'
import { createCompanionHold } from '../../../src/renderer/features/companion/services/companion-hold'

function gestureHarness() {
  let time = 0, sequence = 0
  const timers = new Map<number, {due:number;fn:()=>void}>()
  const state = {opened:0,tapped:0,holding:false}
  const hold = createCompanionHold(() => state.opened++, value => {state.holding=value}, () => state.tapped++, (fn, ms) => {
    const id=++sequence
    timers.set(id,{due:time+ms,fn})
    return id as unknown as ReturnType<typeof setTimeout>
  }, id => {timers.delete(id as unknown as number)}, () => time)
  return {hold,state,timers,advance(ms:number,deliver=true) {
    time+=ms
    if (!deliver) return
    for (const [id,timer] of [...timers].sort((a,b)=>a[1].due-b[1].due)) {
      if (timer.due<=time && timers.delete(id)) timer.fn()
    }
  }}
}

test('short release preserves one tap, without a hold hint or chat', () => {
  for (const duration of [0,250,999]) {
    const {hold,state,advance,timers}=gestureHarness()
    hold.start(); advance(duration)
    assert.equal(state.holding,false)
    hold.release(); hold.release(); advance(companionHoldMs)
    assert.deepEqual(state,{opened:0,tapped:1,holding:false})
    assert.equal(timers.size,0)
  }
})

test('hint starts at one second; total three seconds opens once without a release tap', () => {
  const {hold,state,advance,timers}=gestureHarness()
  hold.start(); advance(999); assert.equal(state.holding,false)
  hold.start(); advance(1); assert.equal(state.holding,true)
  advance(1999); assert.equal(state.opened,0)
  advance(1); assert.deepEqual(state,{opened:1,tapped:0,holding:false})
  hold.release(); advance(3000)
  assert.equal(state.opened,1); assert.equal(timers.size,0)
  hold.start(); advance(250); hold.release()
  assert.equal(state.tapped,1)
})

test('releasing in the pending-hold interval cancels both intents', () => {
  for (const duration of [1000,1500,2999]) {
    const {hold,state,advance}=gestureHarness()
    hold.start(); advance(duration); hold.release(); advance(3000)
    assert.deepEqual(state,{opened:0,tapped:0,holding:false})
  }
})

test('movement, leave, focus/modal/scope/unmount cancellation never becomes a tap', () => {
  for (const duration of [100,1200,2999]) {
    const {hold,state,advance,timers}=gestureHarness()
    hold.start(); advance(duration); hold.cancel(); hold.release(); advance(3000)
    assert.deepEqual(state,{opened:0,tapped:0,holding:false})
    assert.equal(timers.size,0)
  }
})

test('elapsed time remains authoritative when renderer timers are delayed', () => {
  for (const duration of [999,1000,2999,3000,5000]) {
    const {hold,state,advance}=gestureHarness()
    hold.start(); advance(duration,false); hold.release(); advance(5000)
    assert.deepEqual(state,{opened:duration>=3000?1:0,tapped:duration<1000?1:0,holding:false})
  }
})

test('already queued callbacks cannot revive a cancelled or later gesture', () => {
  const {hold,state,timers,advance}=gestureHarness()
  hold.start()
  const stale=[...timers.values()]
  hold.cancel(); hold.start()
  for (const timer of stale) timer.fn()
  assert.deepEqual(state,{opened:0,tapped:0,holding:false})
  advance(100); hold.release()
  assert.deepEqual(state,{opened:0,tapped:1,holding:false})
})

test('notice cooldown is global for 90 seconds and per work for ten minutes', () => {
  const policy=new CompanionNoticePolicy(), base=new Date(2026,8,12,14).getTime()
  const hover=(ms:number,work:string|null='a')=>policy.claim('continue-hover',new Date(base+ms),work)
  assert.equal(hover(0,null),false)
  assert.equal(hover(0),true)
  assert.equal(hover(89999,'b'),false)
  assert.equal(hover(90000,'b'),true)
  assert.equal(hover(599999),false)
  assert.equal(hover(600000),true)
  assert.equal(policy.claim('continue-hover',new Date(NaN),'c'),false)
  assert.equal(hover(-10000,'c'),false)
})

test('night boundary is local 23:00–05:00 and crossing midnight does not repeat', () => {
  const policy=new CompanionNoticePolicy()
  const at=(day:number,hour:number,minute=0)=>policy.claim('late-night',new Date(2026,8,day,hour,minute),null)
  assert.equal(at(12,22,59),false)
  assert.equal(at(12,23),true)
  assert.equal(at(13,0),false)
  assert.equal(at(13,4,59),false)
  assert.equal(at(13,5),false)
  assert.equal(at(13,23),true)
})
