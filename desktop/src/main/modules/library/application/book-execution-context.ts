import { AsyncLocalStorage } from 'node:async_hooks'
import { stat } from 'node:fs/promises'
import { AppError } from '../../../core/errors/app-error'
import { canonicalDirectory } from '../../../platform/storage/project-path'

export type BookExecutionIdentity = Readonly<{ root: string; physicalIdentity: string }>

/** Main-only async context. No renderer path, credential or mutable UI state. */
export class BookExecutionContext {
  private readonly storage = new AsyncLocalStorage<BookExecutionIdentity>()

  current(): BookExecutionIdentity | undefined { return this.storage.getStore() }

  async run<T>(root: string, operation: () => T | Promise<T>): Promise<T> {
    const canonical = await canonicalDirectory(root)
    const identity = Object.freeze({ root: canonical, physicalIdentity: await physicalIdentity(canonical) })
    return this.storage.run(identity, operation)
  }

  async path(): Promise<string | undefined> {
    const captured = this.current()
    if (!captured) return undefined
    if (await canonicalDirectory(captured.root) !== captured.root ||
        await physicalIdentity(captured.root) !== captured.physicalIdentity) {
      throw new AppError('CONFLICT', '任务所属作品的位置或身份已变化，请重新打开作品。', { recoverable: true })
    }
    return captured.root
  }
}

async function physicalIdentity(root: string): Promise<string> {
  const value = await stat(root, { bigint: true })
  return `${value.dev}:${value.ino}:${value.birthtimeNs}`
}
