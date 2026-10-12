import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { decodeAsrInput, type CompanionAsrInput } from '../../../../contracts/companion/companion-asr'

type Capture = { owner: number; id: string; controller: AbortController; timer: ReturnType<typeof setTimeout>; submitted: boolean }
/** One short, explicitly armed capture. Audio never enters persistence or diagnostics. */
export class CompanionAsrService {
  private capture?: Capture
  constructor(private readonly recognize: (pcm: Uint8Array, signal: AbortSignal) => Promise<string>) {}
  get active(): boolean { return Boolean(this.capture) }
  permitted(owner: number): boolean { return this.capture?.owner === owner && !this.capture.submitted }
  begin(owner: number): { captureId: string } {
    if (this.capture) throw new AppError('CONFLICT', '请先结束或取消当前录音。', { recoverable: true })
    const id = randomUUID(), controller = new AbortController()
    const timer = setTimeout(() => this.cancel(owner, id), 45000); timer.unref()
    this.capture = { owner, id, controller, timer, submitted: false }
    return { captureId: id }
  }
  cancel(owner?: number, id?: string): boolean {
    const current = this.capture
    if (current && (owner === undefined || current.owner === owner) && (id === undefined || id === current.id)) {
      this.capture = undefined; clearTimeout(current.timer); current.controller.abort()
    }
    return true
  }
  async transcribe(owner: number, value: CompanionAsrInput): Promise<{ text: string }> {
    const input = decodeAsrInput(value), current = this.capture
    if (!current || current.owner !== owner || current.id !== input.captureId || current.submitted) throw new AppError('CONFLICT', '录音已结束，请重新录制。', { recoverable: true })
    current.submitted = true; clearTimeout(current.timer)
    current.timer = setTimeout(() => this.cancel(owner, current.id), 180000); current.timer.unref()
    try {
      const text = await this.recognize(input.pcm.slice(), current.controller.signal)
      if (this.capture !== current || current.controller.signal.aborted) throw new AppError('CONFLICT', '本次识别已取消。', { recoverable: true })
      if (typeof text !== 'string' || text.length > 2000) throw new Error('ASR_RESULT_INVALID')
      return { text: text.trim() }
    } finally {
      clearTimeout(current.timer)
      if (this.capture === current) this.capture = undefined
    }
  }
}
