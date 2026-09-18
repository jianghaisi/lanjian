/** Main and renderer share reminder limits; no model, storage or wall-clock side effects. */
export type CompanionNoticeReason = 'continue-hover' | 'late-night'
export const companionHoldMs = 3000
export const companionHoldHintMs = 1000
export const companionHoverMs = 1200
export const companionNoticeGapMs = 90_000
export class CompanionNoticePolicy {
  private last = -Infinity
  private workTimes = new Map<string, number>()
  private night = ''
  claim(reason: CompanionNoticeReason, now: Date, workId: string | null): boolean {
    const time = now.getTime()
    if (!Number.isFinite(time) || time - this.last < companionNoticeGapMs) return false
    if (reason === 'continue-hover') {
      if (!workId || time - (this.workTimes.get(workId) ?? -Infinity) < 600_000) return false
      this.workTimes.delete(workId); this.workTimes.set(workId, time)
      if (this.workTimes.size > 32) this.workTimes.delete(this.workTimes.keys().next().value!)
    } else {
      if (now.getHours() >= 5 && now.getHours() < 23) return false
      const nightDate = new Date(time)
      if (nightDate.getHours() < 5) nightDate.setDate(nightDate.getDate() - 1)
      const night = `${nightDate.getFullYear()}-${nightDate.getMonth()}-${nightDate.getDate()}`
      if (night === this.night) return false
      this.night = night
    }
    this.last = time
    return true
  }
}
