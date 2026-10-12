import { resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * One main-process write lane per work item. Ordinary database reads do not
 * use it. Task status connections that may checkpoint on close do use it.
 * Byte-verified event snapshot acquisition also waits in this lane to
 * avoid racing our own imports/checkpoints; its callback remains read-only.
 */
export class WorkspaceWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>()
  private readonly ownedLane = new AsyncLocalStorage<{ key: string; active: boolean }>()

  /** Main-owned read-only snapshot acquisition may reuse a currently held lane.
   * Writes still queue; inherited async context stops granting reuse on release. */
  async read<T>(workItemId: string, operation: () => Promise<T> | T): Promise<T> {
    const owned = this.ownedLane.getStore()
    if (owned?.active && owned.key === workItemKey(workItemId)) return operation()
    return this.run(workItemId, operation)
  }

  async run<T>(workItemId: string, operation: () => Promise<T> | T): Promise<T> {
    const key = workItemKey(workItemId)
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
    this.tails.set(key, current)

    await previous.catch(() => undefined)
    const owned = { key, active: true }
    try {
      return await this.ownedLane.run(owned, operation)
    } finally {
      owned.active = false
      release()
      if (this.tails.get(key) === current) this.tails.delete(key)
    }
  }

  pending(workItemId: string): boolean {
    return this.tails.has(workItemKey(workItemId))
  }
}

function workItemKey(workItemId: string): string {
  const normalized = resolve(workItemId)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}
