export type CompanionMode = 'detailed' | 'chibi' | 'hidden'
export type CompanionState = 'idle' | 'curious' | 'thinking' | 'writing' | 'success' | 'warning' | 'sleeping' | 'hidden'
export type CompanionOptions = {
  libraryMode: CompanionMode; writingMode: CompanionMode; followPointer: boolean; autoBlink: boolean;
  stateFeedback: boolean; intensity: number; focusAutoHide: boolean
}
export const defaultCompanionOptions: CompanionOptions = {
  libraryMode: 'detailed', writingMode: 'detailed', followPointer: true, autoBlink: true,
  stateFeedback: true, intensity: .45, focusAutoHide: true
}
export function normalizeCompanionOptions(value: unknown): CompanionOptions {
  const result = { ...defaultCompanionOptions }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const input = value as Record<string, unknown>
  for (const key of ['libraryMode', 'writingMode'] as const) {
    if (['detailed', 'chibi', 'hidden'].includes(String(input[key]))) result[key] = input[key] as CompanionMode
  }
  for (const key of ['followPointer', 'autoBlink', 'stateFeedback', 'focusAutoHide'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key]
  }
  if (typeof input.intensity === 'number' && Number.isFinite(input.intensity)) result.intensity = Math.min(1, Math.max(0, input.intensity))
  return result
}

/** Presentation state only: never owns AI tasks, author text, or provider calls. */
export class CompanionController {
  private lastInteraction = 0
  private feedbackUntil = 0
  private feedback: 'success' | 'warning' | null = null
  private scope = ''
  private status = ''
  private taskId = ''
  interact(now: number) { this.lastInteraction = now }
  update(scope: string, taskId: string, status: string, now: number) {
    if (scope !== this.scope) {
      this.scope = scope; this.feedback = null; this.feedbackUntil = 0; this.lastInteraction = now
      this.status = status; this.taskId = taskId
      return
    }
    if (taskId !== this.taskId) { this.feedback = null; this.feedbackUntil = 0 }
    if (taskId && taskId === this.taskId && status !== this.status && ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(this.status)) {
      if (status === 'succeeded' || status === 'failed') {
        this.feedback = status === 'succeeded' ? 'success' : 'warning'; this.feedbackUntil = now + 2400
      }
    }
    this.status = status; this.taskId = taskId
  }
  state(now: number, input: { hidden: boolean; quiet: boolean; feedback: boolean; hovered: boolean }): CompanionState {
    if (input.hidden) return 'hidden'
    if (input.quiet) return 'idle'
    if (input.feedback) {
      if (this.feedback && now < this.feedbackUntil) return this.feedback
      if (this.status === 'streaming') return 'writing'
      if (['queued', 'resuming', 'preparing', 'running'].includes(this.status)) return 'thinking'
    }
    if (now - this.lastInteraction > 90_000) return 'sleeping'
    return input.hovered ? 'curious' : 'idle'
  }
}

export function springStep(position: number, velocity: number, target: number, elapsed: number) {
  const dt = Math.min(.032, Math.max(0, elapsed))
  const nextVelocity = velocity + ((target - position) * 95 - velocity * 19) * dt
  return { position: position + nextVelocity * dt, velocity: nextVelocity }
}
export function nextBlinkDelay(random = Math.random) { return 2000 + Math.max(0, Math.min(1, random())) * 4000 }
