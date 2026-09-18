/** Private-pipe codec: 4-byte LE JSON length + bounded JSON + optional PCM16. */
export const MAX_HEADER = 32768
export const MAX_PCM = 1_440_000
export type VoiceFrame = { header: Record<string, unknown>; pcm: Buffer }
export function encodeFrame(header: Record<string, unknown>, pcm: Buffer = Buffer.alloc(0)): Buffer {
  const json = Buffer.from(JSON.stringify({ ...header, pcmBytes: pcm.length }), 'utf8')
  if (json.length > MAX_HEADER || pcm.length > MAX_PCM) throw new Error('VOICE_FRAME_LIMIT')
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(json.length)
  return Buffer.concat([prefix, json, pcm])
}
export class VoiceFrameReader {
  private buffer = Buffer.alloc(0)
  push(data: Buffer): VoiceFrame[] {
    // Readable chunks can hold several small text frames. Total buffering is still bounded.
    if (data.length + this.buffer.length > MAX_PCM + MAX_HEADER * 2) throw new Error('VOICE_FRAME_LIMIT')
    this.buffer = Buffer.concat([this.buffer, data])
    const frames: VoiceFrame[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (!length || length > MAX_HEADER) throw new Error('VOICE_HEADER_LIMIT')
      if (this.buffer.length < 4 + length) break
      const header: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(4, 4 + length)))
      if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('VOICE_HEADER_INVALID')
      const value = header as Record<string, unknown>
      const bytes = value.pcmBytes
      if (value.v !== 1 || !Number.isSafeInteger(bytes) || Number(bytes) < 0 || Number(bytes) > MAX_PCM || Number(bytes) % 2 || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)) throw new Error('VOICE_HEADER_INVALID')
      const end = 4 + length + Number(bytes)
      if (this.buffer.length < end) break
      frames.push({ header: value, pcm: Buffer.from(this.buffer.subarray(4 + length, end)) })
      this.buffer = this.buffer.subarray(end)
    }
    return frames
  }
}
