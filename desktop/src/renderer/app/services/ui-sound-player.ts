import type { SoundPreferences } from '../composables/useSoundPreferences'
import { BOOT_CROSSFADE_SECONDS, isBootScore, scoreLoops, soundCategory, soundGain, soundThrottle, soundUrl, type BootScorePosition, type SoundId, type SoundCategory } from './ui-sound-catalog'

export interface SoundScope {
  category?: SoundCategory
  revision: number
  disposed: boolean
  play: (id: SoundId, elapsed?: number) => Promise<boolean>
  score: (position: BootScorePosition | null) => Promise<boolean>
  stop: () => void
  dispose: () => void
}
interface Voice { id: SoundId; scope: SoundScope; source: AudioBufferSourceNode; gain: GainNode; envelope?: GainNode; retiring: boolean; startedAt: number; offset: number }
interface ScoreState {
  position: BootScorePosition | null
  revision: number
  retryAfter: number
  pending?: { revision: number; epoch: number; result: Promise<boolean> }
}
interface Options {
  preferences: () => Readonly<SoundPreferences>
  visible: () => boolean
  base: () => string
  context?: () => AudioContext
  fetch?: (url: string) => Promise<ArrayBuffer>
  now?: () => number
}

/** Optional presentation only: failures resolve false, never enter a business error path. */
export class UiSoundPlayer {
  private context?: AudioContext
  private buffers = new Map<SoundId, Promise<AudioBuffer>>()
  private voices = new Set<Voice>()
  private scores = new WeakMap<SoundScope, ScoreState>()
  private last = new Map<string, number>()
  private epoch = 0
  private disposed = false
  constructor(private readonly options: Options) {}
  private now() { return this.options.now?.() ?? performance.now() }
  private audio() { return this.context ??= (this.options.context?.() ?? new AudioContext({ latencyHint: 'interactive' })) }
  /** Map the sound card's output clock to the same performance clock as paint. */
  private outputTime() {
    const context = this.audio(), stamp = context.getOutputTimestamp?.(), now = this.now()
    if (stamp && stamp.contextTime! > 0 && stamp.performanceTime! > 0 && Math.abs(now - stamp.performanceTime!) < 1000) {
      return Math.min(context.currentTime, stamp.contextTime! + (now - stamp.performanceTime!) / 1000)
    }
    return context.currentTime - Math.max(0, (context.baseLatency || 0) + (context.outputLatency || 0))
  }
  private positionOffset(position: BootScorePosition) {
    return (position.offset ?? 0) + (position.sampledAt === undefined ? 0 : Math.max(0, this.now() - position.sampledAt) / 1000)
  }
  private enabled(id: SoundId, category = soundCategory(id)) {
    const p = this.options.preferences()
    return !this.disposed && p.enabled && p.volume > 0 && p[category]
      && (id !== 'U01' || p.hover) && (id !== 'L02' || p.waiting)
  }
  private allowed(id: SoundId, category = soundCategory(id)) { return this.options.visible() && this.enabled(id, category) }
  private buffer(id: SoundId) {
    let pending = this.buffers.get(id)
    if (!pending) {
      pending = (async () => {
        const url = soundUrl(id, this.options.base())
        const data = this.options.fetch ? await this.options.fetch(url) : await fetch(url).then(response => {
          if (!response.ok) throw new Error('sound-unavailable')
          return response.arrayBuffer()
        })
        return this.audio().decodeAudioData(data)
      })()
      this.buffers.set(id, pending)
      void pending.catch(() => { if (this.buffers.get(id) === pending) this.buffers.delete(id) })
    }
    return pending
  }
  async preload(ids: readonly SoundId[]) {
    if (this.disposed) return
    // A hidden startup window may decode in advance; visibility still gates
    // every actual source start. Waiting for show would miss the first action.
    await Promise.all(ids.filter(id => this.enabled(id)).map(id => this.buffer(id).catch(() => undefined)))
  }
  async unlock(): Promise<void> {
    try {
      if (!this.options.visible() || !this.options.preferences().enabled || this.disposed) return
      const context = this.audio()
      if (context.state === 'suspended') await context.resume()
    } catch { /* Later user activation can retry. Past cues are never queued. */ }
  }
  scope(category?: SoundCategory): SoundScope {
    const scope: SoundScope = {
      category, revision: 0, disposed: false,
      play: (id, elapsed) => isBootScore(id) ? this.score({ id, offset: 0 }, scope) : this.play(id, scope, elapsed),
      score: position => this.score(position, scope),
      stop: () => this.stop(scope),
      dispose: () => { scope.disposed = true; this.stop(scope) },
    }
    this.scores.set(scope, { position: null, revision: 0, retryAfter: 0 })
    return scope
  }
  private level(voice: Voice) {
    return this.options.preferences().volume * soundGain(voice.id)
  }
  private mix() {
    if (!this.context) return
    for (const voice of this.voices) {
      if (voice.retiring && !voice.envelope) continue
      voice.gain.gain.cancelScheduledValues(this.context.currentTime)
      voice.gain.gain.setTargetAtTime(this.level(voice), this.context.currentTime, .012)
    }
  }
  private end(voice: Voice) {
    voice.source.onended = null
    voice.source.disconnect(); voice.envelope?.disconnect(); voice.gain.disconnect()
    this.voices.delete(voice)
  }
  private halt(voice: Voice, fade = .012) {
    voice.retiring = true
    try {
      const now = this.context!.currentTime
      const envelope = (voice.envelope ?? voice.gain).gain
      envelope.cancelAndHoldAtTime(now)
      envelope.linearRampToValueAtTime(0, now + fade)
      voice.source.stop(now + fade + (fade ? .003 : 0))
    } catch { this.end(voice) }
  }
  stop(scope?: SoundScope) {
    if (scope) {
      scope.revision++
      const score = this.scores.get(scope)!
      score.position = null; score.revision++
    } else this.epoch++
    for (const voice of [...this.voices]) if (!scope || voice.scope === scope) this.halt(voice)
    this.mix()
  }
  syncPreferences() {
    this.epoch++ // Also invalidate pending decodes under the old preferences.
    for (const voice of [...this.voices]) if (!this.allowed(voice.id, voice.scope.category)) this.halt(voice)
    this.mix()
  }
  private startVoice(id: SoundId, scope: SoundScope, buffer: AudioBuffer, loop: boolean, offset = 0, fade = BOOT_CROSSFADE_SECONDS) {
    const context = this.audio(), source = context.createBufferSource(), gain = context.createGain()
    const envelope = isBootScore(id) ? context.createGain() : undefined
    const voice: Voice = { id, scope, source, gain, envelope, retiring: false, startedAt: context.currentTime, offset }
    source.buffer = buffer; source.loop = loop
    source.connect(envelope ?? gain); envelope?.connect(gain); gain.connect(context.destination)
    const now = context.currentTime
    gain.gain.setValueAtTime(0, now)
    if (envelope) {
      envelope.gain.setValueAtTime(0, now)
      envelope.gain.linearRampToValueAtTime(1, now + fade)
    }
    source.onended = () => this.end(voice)
    this.voices.add(voice); this.mix()
    try { source.start(0, offset) } catch (error) { this.end(voice); throw error }
    return voice
  }
  private score(position: BootScorePosition | null, scope: SoundScope): Promise<boolean> {
    const state = this.scores.get(scope)!
    if (state.position?.id !== position?.id) { state.revision++; state.retryAfter = 0 }
    state.position = position
    const scores = () => [...this.voices].filter(voice => isBootScore(voice.id))
    if (!position) {
      for (const voice of scores()) if (voice.scope === scope && !voice.retiring) this.halt(voice, BOOT_CROSSFADE_SECONDS)
      return Promise.resolve(true)
    }
    const { id } = position
    if (scope.disposed || !this.allowed(id, scope.category)) return Promise.resolve(false)
    const active = scores().find(voice => voice.scope === scope && voice.id === id && !voice.retiring)
    if (active) {
      if (position.offset === undefined) return Promise.resolve(true)
      const duration = active.source.buffer!.duration
      let drift = Math.abs(this.positionOffset(position) - active.offset - (this.outputTime() - active.startedAt))
      if (active.source.loop) { drift %= duration; drift = Math.min(drift, duration - drift) }
      if (drift < .05) return Promise.resolve(true)
    }
    const revision = state.revision, epoch = this.epoch, scopeRevision = scope.revision
    if (state.pending?.revision === revision && state.pending.epoch === epoch) return state.pending.result
    if (this.now() < state.retryAfter) return Promise.resolve(false)
    const result = (async () => {
      try {
        const context = this.audio()
        const [buffer] = await Promise.all([this.buffer(id), this.unlock()])
        if (scope.disposed || scope.revision !== scopeRevision || state.revision !== revision || epoch !== this.epoch
          || !this.allowed(id, scope.category) || context.state !== 'running' || state.position?.id !== id) return false
        // The renderer kept updating this position while decode/resume was pending.
        // Never play the beginning of a fixed scene over its current visible midpoint.
        let offset = state.position.offset === undefined ? 0 : this.positionOffset(state.position) + Math.max(0, context.currentTime - this.outputTime())
        const loop = scoreLoops(id)
        if (!Number.isFinite(offset) || offset < 0 || (!loop && offset >= buffer.duration)) return false
        if (loop) offset %= buffer.duration
        for (const voice of scores()) if (voice.retiring) { this.halt(voice, 0); this.end(voice) }
        const old = scores(), fade = active ? .02 : !old.length ? .02 : BOOT_CROSSFADE_SECONDS
        this.startVoice(id, scope, buffer, loop, offset, fade)
        for (const voice of old) this.halt(voice, fade)
        return true
      } catch { if (state.revision === revision) state.retryAfter = this.now() + 1000; return false }
    })()
    const pending = { revision, epoch, result }
    state.pending = pending
    void result.finally(() => { if (state.pending === pending) state.pending = undefined })
    return result
  }
  private async play(id: SoundId, scope: SoundScope, elapsed?: number): Promise<boolean> {
    if (scope.disposed || !this.allowed(id, scope.category)) return false
    const requested = this.now(), epoch = this.epoch, revision = scope.revision
    const throttle = soundThrottle(id)
    if (scope.category === 'loading' && id.startsWith('U')) throttle.key = `loading:${throttle.key}`
    if (requested - (this.last.get(throttle.key) ?? -Infinity) < throttle.ms) return false
    this.last.set(throttle.key, requested)
    const current = () => !scope.disposed && revision === scope.revision && epoch === this.epoch && this.allowed(id, scope.category)
      && this.now() - requested < (id === 'L02' ? 1200 : id.startsWith('U') ? 220 : 450)
    try {
      const context = this.audio()
      const [buffer] = await Promise.all([this.buffer(id), this.unlock()])
      if (!current() || context.state !== 'running') return false
      if (id === 'L02' && [...this.voices].some(voice => voice.id === 'L02' && !voice.retiring)) return false
      const oneShots = [...this.voices].filter(voice => !isBootScore(voice.id) && !voice.source.loop && !voice.retiring)
      if (id !== 'L02' && oneShots.length >= 4) {
        const expendable = oneShots.find(voice => voice.id !== 'V01')
        if (!expendable) return false
        this.halt(expendable)
      }
      // Boot voice/exit cues carry their visual age. A late decode must not move
      // the whole utterance or handoff sound later than the action it accompanies.
      const offset = elapsed === undefined ? 0 : Math.max(0, elapsed + (this.now() - requested)/1000 + context.currentTime - this.outputTime())
      if (!Number.isFinite(offset) || offset >= buffer.duration) return false
      this.startVoice(id, scope, buffer, id === 'L02', offset)
      return true
    } catch { return false }
  }
  dispose() {
    this.disposed = true; this.stop(); this.buffers.clear()
    if (this.context) void this.context.close().catch(() => {})
  }
}
