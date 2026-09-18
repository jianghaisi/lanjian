import { resolve } from 'node:path'

/**
 * One main-process write lane per work item. Ordinary database reads do not
 * use it. Byte-verified event snapshot acquisition also waits in this lane to
 * avoid racing our own imports/checkpoints; its callback remains read-only.
 */
export class WorkspaceWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(workItemId: string, operation: () => Promise<T> | T): Promise<T> {
    const key = workItemKey(workItemId)
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
    this.tails.set(key, current)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
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
