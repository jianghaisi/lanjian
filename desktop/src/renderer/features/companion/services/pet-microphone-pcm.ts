/** Area resampling preserves duration even for fractional rates such as 44.1 kHz. */
export function microphonePcm(chunks: Float32Array[], rate: number): Uint8Array {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new Error('不支持当前麦克风采样率，请选择其他设备。')
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  if (size > rate * 30 + 2048 || size < rate * .1) throw new Error('录音太短或超过 30 秒，请重新录制。')
  const source = new Float32Array(size); let offset = 0
  for (const chunk of chunks) { source.set(chunk, offset); offset += chunk.length }
  const count = Math.min(480000, Math.floor(size * 16000 / rate)), ratio = rate / 16000
  const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer)
  let energy = 0
  for (let i = 0; i < count; i++) {
    const start = i * ratio, end = Math.min(size, (i + 1) * ratio); let sum = 0
    for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += (Number.isFinite(source[j]) ? source[j]! : 0) * (Math.min(end, j + 1) - Math.max(start, j))
    const sample = Math.max(-1, Math.min(1, sum / (end - start)))
    energy += sample * sample; view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  if (!count || Math.sqrt(energy / count) < .002) throw new Error('没有听到清晰的声音，请靠近麦克风重试。')
  return bytes
}
