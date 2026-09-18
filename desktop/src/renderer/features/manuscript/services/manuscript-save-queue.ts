export const supersededSave = Symbol('superseded manuscript save')
type Job = { key?: string; run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }

/** One write in flight, one latest waiting autosave per contiguous document lane.
 * Manual saves/finalization/AI are barriers: coalescing never crosses them.
 * Errors go back to the caller, which owns the visible draft and recovery copy. */
export class ManuscriptSaveQueue {
  private jobs: Job[] = []
  private running = false
  private idleWaiters: Array<() => void> = []

  enqueue<T>(run: () => Promise<T>): Promise<T>
  enqueue<T>(run: () => Promise<T>, key: string | undefined): Promise<T | typeof supersededSave>
  enqueue<T>(run: () => Promise<T>, key?: string): Promise<T | typeof supersededSave> {
    return new Promise<T | typeof supersededSave>((resolve, reject) => {
      const previous = this.jobs.at(-1)
      if (key && previous?.key === key) {
        this.jobs.pop()
        previous.resolve(supersededSave)
      }
      this.jobs.push({ key, run, resolve: value => resolve(value as T | typeof supersededSave), reject })
      if (!this.running) { this.running = true; queueMicrotask(() => { void this.pump() }) }
    })
  }

  barrier<T>(run: () => Promise<T>): Promise<T> {
    return this.enqueue(run)
  }

  /** Waits for completion, not an acknowledgement that every write succeeded. */
  idle(): Promise<void> {
    if (!this.running) return Promise.resolve()
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  private async pump(): Promise<void> {
    while (this.jobs.length) {
      const job = this.jobs.shift()!
      try { job.resolve(await job.run()) } catch (error) { job.reject(error) }
      // Let the caller apply the acknowledged revision before the next write
      // captures its base version. Do not let a synchronous pump outrun UI state.
      await Promise.resolve()
    }
    this.running = false
    const waiters = this.idleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }
}
