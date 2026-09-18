/** Bounded PCM queue. Stop releases every scheduled source immediately. */
export class CompanionAudioPlayer {
  private context?: AudioContext
  private gain?: GainNode
  private sources = new Set<AudioBufferSourceNode>()
  private next = 0
  private bytes = 0
  constructor(private readonly changed: (playing: boolean) => void) {}
  async prepare(volume: number): Promise<void> {
    this.context ||= new AudioContext({ sampleRate: 24000 })
    if (!this.gain) { this.gain = this.context.createGain(); this.gain.connect(this.context.destination) }
    this.gain.gain.value = Math.max(0, Math.min(1, volume))
    await this.context.resume()
  }
  volume(value: number): void { if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, value)) }
  enqueue(pcm: Uint8Array): void {
    if (!this.context || !this.gain || pcm.byteLength % 2 || !pcm.byteLength || this.bytes + pcm.byteLength > 1_440_000) throw new Error('VOICE_AUDIO_LIMIT')
    this.bytes += pcm.byteLength
    const buffer = this.context.createBuffer(1, pcm.byteLength / 2, 24000)
    const samples = buffer.getChannelData(0), view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain)
    this.sources.add(source)
    source.onended = () => { source.disconnect(); this.sources.delete(source); if (!this.sources.size) this.changed(false) }
    const when = Math.max(this.context.currentTime + .02, this.next)
    this.next = when + buffer.duration
    source.start(when); this.changed(true)
  }
  stop(): void {
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect() }
    this.sources.clear(); this.next = 0; this.bytes = 0; this.changed(false)
  }
  dispose(): void { this.stop(); this.gain?.disconnect(); const context = this.context; this.context = undefined; this.gain = undefined; void context?.close() }
}
