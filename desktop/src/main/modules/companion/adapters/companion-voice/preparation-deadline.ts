export const VOICE_REQUEST_TIMEOUT_MS = 180_000
export const VOICE_PREPARATION_LIMIT_MS = 600_000
export const preparationStages = ['verify', 'runtime', 'weights', 'warmup'] as const
export type PreparationStage = typeof preparationStages[number]

/** Only a new, ordered stage buys more time; duplicate heartbeats cannot keep a hung worker alive. */
export class PreparationDeadline {
  private stageIndex = -1
  private stall: ReturnType<typeof setTimeout>
  private total: ReturnType<typeof setTimeout>
  constructor(private readonly expire: (reason: string) => void) {
    this.stall = this.armStage()
    this.total = setTimeout(() => this.finish('VOICE_PREPARATION_TIMEOUT'), VOICE_PREPARATION_LIMIT_MS)
  }
  advance(stage: unknown): void {
    const index = preparationStages.findIndex(value => value === stage)
    if (index < 0 || index < this.stageIndex) throw new Error('VOICE_PROTOCOL_FAILED')
    if (index === this.stageIndex) return
    this.stageIndex = index
    clearTimeout(this.stall)
    this.stall = this.armStage()
  }
  private armStage() {
    return setTimeout(() => this.finish(`VOICE_PREPARATION_STALLED:${preparationStages[this.stageIndex] ?? 'startup'}`), VOICE_REQUEST_TIMEOUT_MS)
  }
  private finish(reason: string) { this.clear(); this.expire(reason) }
  clear() { clearTimeout(this.stall); clearTimeout(this.total) }
}
