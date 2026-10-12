import assert from 'node:assert/strict'
import test from 'node:test'
import { UiSoundPlayer } from '../../../src/renderer/app/services/ui-sound-player'
import { soundDefaults } from '../../../src/renderer/app/composables/useSoundPreferences'
import { soundUrl } from '../../../src/renderer/app/services/ui-sound-catalog'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture() {
  let time = 1000, visible = true
  const preferences = { ...soundDefaults }
  const sources: Array<{ started: boolean; stopped: boolean; stopAt: number; offset: number; loop: boolean; onended: (() => void) | null; buffer: unknown; connect: () => void; disconnect: () => void; start: (when?: number, offset?: number) => void; stop: (at?: number) => void }> = []
  const gains: Array<{ value: number; automation: Array<[string, number, number]> }> = []
  const context = {
    state: 'running', currentTime: 1, destination: {}, baseLatency: 0, outputLatency: 0,
    getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    resume: async () => { context.state = 'running' }, close: async () => { context.state = 'closed' },
    decodeAudioData: async (_: ArrayBuffer) => ({ duration: 8 }),
    createBufferSource() {
      const source = { started: false, stopped: false, stopAt: Infinity, offset: 0, loop: false, onended: null as (() => void) | null, buffer: null as unknown,
        connect() {}, disconnect() {}, start(_when = 0, offset = 0) { source.started = true; source.offset = offset }, stop(at = context.currentTime) {
          source.stopped = true; source.stopAt = at
          if (at <= context.currentTime + .02) source.onended?.()
        } }
      sources.push(source); return source
    },
    createGain() {
      const gain = { value: 0, automation: [] as Array<[string, number, number]>,
        setValueAtTime(value: number, at: number) { gain.value = value; gain.automation.push(['set',value,at]) },
        setTargetAtTime(value: number, at: number) { gain.value = value; gain.automation.push(['target',value,at]) },
        linearRampToValueAtTime(value: number, at: number) { gain.value = value; gain.automation.push(['ramp',value,at]) },
        cancelScheduledValues(at: number) { gain.automation.push(['cancel',0,at]) },
        cancelAndHoldAtTime(at: number) { gain.automation.push(['hold',0,at]) } }
      gains.push(gain); return { gain, connect() {}, disconnect() {} }
    },
  }
  let fetches = 0, loader = async () => new ArrayBuffer(8)
  const player = new UiSoundPlayer({ preferences: () => preferences, visible: () => visible, base: () => 'file:///app/renderer/index.html',
    context: () => context as unknown as AudioContext, fetch: async () => { fetches++; return loader() }, now: () => time })
  return { player, preferences, sources, gains, context, setVisible: (v: boolean) => { visible = v }, advance: (ms = 1000) => { time += ms },
    loadWith: (fn: () => Promise<ArrayBuffer>) => { loader = fn }, fetches: () => fetches }
}
test('resource URLs stay relative to packaged renderer; cache is shared across scopes', async () => {
  assert.equal(soundUrl('U02', 'file:///app/renderer/index.html'), 'file:///app/renderer/sounds/v1/U02-ui-click.wav')
  const f = fixture()
  assert.equal(await f.player.scope().play('U02'), true)
  f.advance()
  assert.equal(await f.player.scope().play('U02'), true)
  assert.equal(f.fetches(), 1)
})
test('late decode after stop, disposal, hidden window or mute never starts a source', async () => {
  for (const cancel of ['stop', 'dispose', 'hide', 'mute', 'expire']) {
    const f = fixture(), scope = f.player.scope(), gate = deferred<ArrayBuffer>()
    f.loadWith(() => gate.promise)
    const play = scope.play('B19')
    if (cancel === 'stop') scope.stop()
    if (cancel === 'dispose') scope.dispose()
    if (cancel === 'hide') { f.setVisible(false); f.player.stop() }
    if (cancel === 'mute') { f.preferences.enabled = false; f.player.syncPreferences() }
    if (cancel === 'expire') f.advance()
    gate.resolve(new ArrayBuffer(8))
    assert.equal(await play, false, cancel)
    assert.equal(f.sources.length, 0, cancel)
  }
})
test('suspended context resuming later also drops canceled or expired cues', async () => {
  const f = fixture(), resume = deferred<void>(), scope = f.player.scope()
  f.context.state = 'suspended'
  f.context.resume = async () => { await resume.promise; f.context.state = 'running' }
  const play = scope.play('V01')
  scope.dispose(); resume.resolve()
  assert.equal(await play, false)
  assert.equal(f.sources.length, 0)
})
test('one interaction is throttled, burst capacity is bounded and brand is protected', async () => {
  const f = fixture(), scope = f.player.scope()
  assert.equal(await scope.play('U08'), true)
  assert.equal(await scope.play('U02'), false)
  f.advance()
  assert.equal(await scope.play('V01'), true)
  for (const id of ['L01', 'L03', 'L04', 'L05', 'B19'] as const) { f.advance(); await scope.play(id) }
  assert.equal(f.sources.filter(s => s.started && !s.stopped).length, 4)
  assert.equal(f.sources[1].stopped, false)
  assert.equal(f.gains.at(-1)!.value, f.preferences.volume, 'brand no longer ducks the accompanying accents')
})
test('loop opt-in, category switches and visibility stop all owned voices', async () => {
  const f = fixture(), scope = f.player.scope()
  assert.equal(await scope.play('L02'), false)
  f.preferences.waiting = true
  assert.equal(await scope.play('L02'), true)
  f.advance()
  assert.equal(await f.player.scope().play('L02'), false)
  assert.equal(f.sources.filter(s => s.loop && !s.stopped).length, 1)
  f.preferences.loading = false; f.player.syncPreferences()
  assert.ok(f.sources.every(s => s.stopped))
  f.advance(); await scope.play('U02')
  f.player.stop(); assert.ok(f.sources.every(s => s.stopped))
})
test('broken resources and audio contexts are optional, failed cache entries can retry', async () => {
  const f = fixture(), scope = f.player.scope()
  f.loadWith(async () => { throw new Error('missing') })
  assert.equal(await scope.play('U02'), false)
  f.advance(); f.loadWith(async () => new ArrayBuffer(8))
  assert.equal(await scope.play('U02'), true)
  f.player.dispose(); assert.equal(await scope.play('B19'), false)
})

test('reused quick-confirm and error cues follow the loading owner category', async () => {
  const f = fixture(), scope = f.player.scope('loading')
  f.preferences.interaction = false
  assert.equal(await scope.play('U03'), true)
  f.preferences.loading = false; f.player.syncPreferences(); f.advance()
  assert.equal(await scope.play('U12'), false)
  assert.ok(f.sources.every(source => source.stopped))
})

test('unavailable device, rejected decode and blocked resume stay optional', async () => {
  const unavailable = new UiSoundPlayer({ preferences: () => soundDefaults, visible: () => true,
    base: () => 'file:///app/renderer/index.html', context: () => { throw new Error('no-device') },
    fetch: async () => new ArrayBuffer(8) })
  await unavailable.preload(['B19'])
  await unavailable.unlock()
  assert.equal(await unavailable.scope().play('B19'), false)
  for (const failure of ['decode', 'resume']) {
    const f = fixture()
    if (failure === 'decode') f.context.decodeAudioData = async () => { throw new Error('decode') }
    else { f.context.state = 'suspended'; f.context.resume = async () => { throw new Error('blocked') } }
    assert.equal(await f.player.scope().play('B19'), false, failure)
    assert.equal(f.sources.length, 0, failure)
  }
})

test('new score movement decodes before crossfade; volume updates preserve both envelopes; mute stops even retiring voices', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  assert.equal(await scope.score({ id: 'B15', offset: 0 }), true)
  const gate = deferred<ArrayBuffer>()
  f.loadWith(() => gate.promise)
  const replacement = scope.score({ id: 'B16', offset: 0 })
  assert.equal(f.sources[0].stopped, false, 'old bed survives while replacement loads')
  gate.resolve(new ArrayBuffer(8)); assert.equal(await replacement, true)
  assert.equal(f.sources.length, 2)
  assert.deepEqual(f.sources.map(source => source.loop), [false, true])
  assert.ok(f.sources[0].stopAt > f.context.currentTime + .79)
  assert.ok(f.sources[0].onended, 'scheduled fade remains tracked for immediate cancellation')
  const envelopes = [f.gains[1], f.gains[3]]
  const automation = envelopes.map(gain => [...gain.automation])
  f.preferences.volume = .4; f.player.syncPreferences()
  assert.deepEqual(envelopes.map(gain => gain.automation), automation)
  assert.equal(f.gains[0].value, .4)
  f.preferences.enabled = false; f.player.syncPreferences()
  assert.ok(f.sources.every(source => source.stopAt < f.context.currentTime + .02))
  assert.ok(f.sources.every(source => source.onended === null))
})

test('superseded and canceled movements cannot start late, failed replacement preserves current texture', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  await scope.score({ id: 'B15', offset: 0 })
  const gate = deferred<ArrayBuffer>()
  f.loadWith(() => gate.promise)
  const old = scope.score({ id: 'B16', offset: 0 })
  f.loadWith(async () => new ArrayBuffer(8))
  assert.equal(await scope.score({ id: 'B17', offset: 0 }), true)
  gate.resolve(new ArrayBuffer(8)); assert.equal(await old, false)
  assert.equal(f.sources.length, 2)
  f.loadWith(async () => { throw new Error('missing') })
  // B13 decoded above but never started; force a separate failure on a fresh player.
  const broken = fixture(), brokenScope = broken.player.scope('boot')
  await brokenScope.score({ id: 'B15', offset: 0 }); broken.loadWith(async () => { throw new Error('missing') })
  assert.equal(await brokenScope.score({ id: 'B16', offset: 0 }), false)
  assert.equal(broken.sources[0].stopped, false)
  for (const stop of ['stop', 'hide', 'dispose', 'mute']) {
    const pending = fixture(), pendingScope = pending.player.scope('boot'), wait = deferred<ArrayBuffer>()
    pending.loadWith(() => wait.promise)
    const result = pendingScope.score({ id: 'B15', offset: 0 })
    if (stop === 'stop') pendingScope.stop()
    if (stop === 'hide') { pending.setVisible(false); pending.player.stop() }
    if (stop === 'dispose') pendingScope.dispose()
    if (stop === 'mute') { pending.preferences.enabled = false; pending.player.syncPreferences() }
    wait.resolve(new ArrayBuffer(8))
    assert.equal(await result, false, stop)
    assert.equal(pending.sources.length, 0, stop)
  }
})

test('score remains separate from accents and waiting option; rapid reversal bounds beds and fades final exit', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  await scope.score({ id: 'B15', offset: 0 }); await scope.score({ id: 'B16', offset: 0 }); await scope.score({ id: 'B17', offset: 0 })
  assert.equal(f.sources.filter(source => source.onended).length, 2)
  const beds = [...f.sources]
  for (const id of ['V01', 'L01', 'L03', 'L04', 'B19'] as const) { f.advance(); await scope.play(id) }
  assert.equal(beds[2].stopped, false, 'accent capacity never steals the current ambience')
  assert.equal(f.sources.slice(3).filter(source => !source.stopped).length, 4)
  const voice = f.sources[3]
  assert.equal(voice?.stopped, false, 'brand remains protected')
  await scope.score(null)
  assert.ok(beds[2].stopAt > f.context.currentTime + .79)
  scope.dispose()
  assert.ok(f.sources.every(source => source.onended === null))
})

test('the hidden startup window preloads without playing; saved mute still suppresses preloading', async () => {
  const f=fixture(), scope=f.player.scope('boot')
  f.setVisible(false)
  await f.player.preload(['B15','V01'])
  assert.equal(f.fetches(),2); assert.equal(f.sources.length,0)
  assert.equal(await scope.score({id:'B15',offset:0}),false)
  f.setVisible(true)
  assert.equal(await scope.score({id:'B15',offset:0}),true)
  assert.equal(f.fetches(),2)
  f.preferences.enabled=false;await f.player.preload(['B16'])
  assert.equal(f.fetches(),2)
})

test('slow score decoding uses the latest visible offset and shares the pending request', async () => {
  const f = fixture(), scope = f.player.scope('boot'), gate = deferred<ArrayBuffer>()
  f.loadWith(() => gate.promise)
  const first = scope.score({ id: 'B15', offset: 0 })
  const latest = scope.score({ id: 'B15', offset: 4.2 })
  assert.equal(f.fetches(), 1)
  gate.resolve(new ArrayBuffer(8))
  assert.deepEqual(await Promise.all([first, latest]), [true, true])
  assert.equal(f.sources.length, 1)
  assert.equal(f.sources[0].offset, 4.2)
  assert.equal(f.sources[0].loop, false)
})

test('stable loop spans many visual waves without restart; fixed movement seeks after hide or mute', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  await scope.score({ id: 'B16', offset: 1 })
  for (let i = 1; i <= 120; i++) {
    f.context.currentTime = 1+i*.4
    await scope.score({ id: 'B16', offset: 1+i*.4 })
  }
  assert.equal(f.sources.length, 1)
  f.setVisible(false); f.player.stop()
  f.setVisible(true)
  await scope.score({ id: 'B16', offset: 50.5 })
  assert.equal(f.sources.at(-1)!.offset, 2.5)
  await scope.score({ id: 'B17', offset: 2 })
  assert.equal(f.sources.at(-1)!.loop, false)
  f.preferences.enabled = false; f.player.syncPreferences()
  f.preferences.enabled = true; f.player.syncPreferences()
  await scope.score({ id: 'B17', offset: 4 })
  assert.equal(f.sources.at(-1)!.offset, 4)
})

test('fixed score corrects significant visual clock drift; idle is free-running and never replays the resolve', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  await scope.score({ id: 'B15', offset: 3 })
  f.context.currentTime += .12
  await scope.score({ id: 'B15', offset: 3.1 })
  assert.equal(f.sources.length, 1)
  f.context.currentTime += 1
  await scope.score({ id: 'B15', offset: 3.2 })
  assert.equal(f.sources.length, 2)
  assert.equal(f.sources[1].offset, 3.2)
  assert.ok(f.sources[0].stopAt < f.context.currentTime+.1)
  await scope.score({ id: 'B18' })
  const count = f.sources.length
  for (let i = 0; i < 20; i++) { f.context.currentTime += 5; await scope.score({ id: 'B18' }) }
  assert.equal(f.sources.length, count)
  assert.equal(f.sources.at(-1)!.loop, true)
  await scope.score(null)
  assert.ok(f.sources.at(-1)!.stopAt <= f.context.currentTime+.81)
})

test('late resume cannot play a canceled score or replace a newer movement', async () => {
  const f = fixture(), scope = f.player.scope('boot'), resume = deferred<void>()
  f.context.state = 'suspended'
  f.context.resume = async () => { await resume.promise; f.context.state = 'running' }
  const stale = scope.score({ id: 'B15', offset: 2 })
  await scope.score(null)
  const current = scope.score({ id: 'B17', offset: 1 })
  resume.resolve()
  assert.equal(await stale, false)
  assert.equal(await current, true)
  assert.equal(f.sources.length, 1)
  assert.equal(f.sources[0].offset, 1)
})

test('missing score does not retry every animation frame; it may recover after a bounded delay', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  f.loadWith(async () => { throw new Error('missing') })
  for (let i = 0; i < 60; i++) await scope.score({ id: 'B15', offset: i/60 })
  assert.equal(f.fetches(), 1)
  f.advance(1001); f.loadWith(async () => new ArrayBuffer(8))
  assert.equal(await scope.score({ id: 'B15', offset: 2 }), true)
  assert.equal(f.sources[0].offset, 2)
})

test('loading wait resumes even when hide/show occurs inside the one-shot throttle window', async () => {
  const f = fixture(), scope = f.player.scope('loading')
  f.preferences.waiting = true
  assert.equal(await scope.play('L02'), true)
  f.setVisible(false); f.player.stop()
  f.setVisible(true)
  assert.equal(await scope.play('L02'), true)
  assert.equal(await scope.play('L02'), false, 'an existing active loop still deduplicates')
  assert.equal(f.sources.filter(source => source.loop && !source.stopped).length, 1)
})

test('score follows the audible output clock, including decode age and a device latency change', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  f.context.getOutputTimestamp = () => ({ contextTime: .9, performanceTime: 1000 })
  await scope.score({ id: 'B15', offset: 3, sampledAt: 980 })
  assert.ok(Math.abs(f.sources[0].offset - 3.12) < 1e-9)
  f.advance(100); f.context.currentTime += .1
  f.context.getOutputTimestamp = () => ({ contextTime: 1, performanceTime: 1100 })
  await scope.score({ id: 'B15', offset: 3.12, sampledAt: 1100 })
  assert.equal(f.sources.length, 1, 'the output latency is not misclassified as drift')
  f.context.getOutputTimestamp = () => ({ contextTime: .92, performanceTime: 1100 })
  await scope.score({ id: 'B15', offset: 3.12, sampledAt: 1100 })
  assert.equal(f.sources.length, 2, '80ms output drift is corrected, not tolerated until 220ms')
  assert.ok(Math.abs(f.sources[1].offset - 3.3) < 1e-9)
  assert.ok(f.sources[0].stopAt < f.context.currentTime + .03)
})

test('latency fallback seeks the current wave and a timed cue catches up after decode', async () => {
  const f = fixture(), scope = f.player.scope('boot')
  f.context.baseLatency = .01; f.context.outputLatency = .06
  await scope.score({ id: 'B16', offset: 7.98 })
  assert.ok(Math.abs(f.sources[0].offset - .05) < 1e-9)
  const gate = deferred<ArrayBuffer>()
  f.loadWith(() => gate.promise)
  const play = scope.play('B19', .01)
  f.advance(90); gate.resolve(new ArrayBuffer(8))
  assert.equal(await play, true)
  assert.ok(Math.abs(f.sources[1].offset - .17) < 1e-9, 'decode delay must not shift the exit sound behind the moving card')
})
