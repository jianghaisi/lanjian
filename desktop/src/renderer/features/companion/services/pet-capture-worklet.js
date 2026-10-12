// Only a bounded in-memory mono stream; output is silent.
class PetCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.total = 0; this.stopped = false
    this.port.onmessage = event => { if (event.data === 'flush') { this.flush(); this.stopped = true; this.port.postMessage('flushed') } }
  }
  flush() {
    if (!this.samples.length) return
    const chunk = Float32Array.from(this.samples); this.samples = []
    this.port.postMessage(chunk, [chunk.buffer])
  }
  process(inputs) {
    const channels = inputs[0]
    if (this.stopped || !channels?.length) return true
    for (let i = 0; i < channels[0].length && this.total < sampleRate * 30; i++, this.total++) {
      let sum = 0; for (const channel of channels) sum += channel[i] || 0
      this.samples.push(sum / channels.length)
    }
    if (this.samples.length >= 2048) this.flush()
    if (this.total >= sampleRate * 30) { this.flush(); this.stopped = true; this.port.postMessage('limit') }
    return true
  }
}
registerProcessor('pet-capture', PetCaptureProcessor)
