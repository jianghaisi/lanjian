import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import {
  assertGlobalConnectionTransition, decodeGlobalConnectionDocument, emptyGlobalConnections,
  MAX_MODEL_CONNECTION_BYTES, type GlobalConnectionDocument, type GlobalConnectionRepository,
  type GlobalConnectionSnapshot, type GlobalConnectionCommitGuard
} from '../domain/model-connections'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { readModelConnectionFile, sameModelFileIdentity, fileErrorCode, type ModelFileIdentity } from './model-connection-file'

export const GLOBAL_CONNECTIONS_FILE = 'global-model-connections.json'
type Publish = (file: string, text: string, beforeReplace: () => Promise<void>) => Promise<void>
class StoreConflict extends Error {}

/** Only constructed with trusted app userData, never a renderer-selected path. */
export class ModelConnectionsStore implements GlobalConnectionRepository {
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly userData: string, private readonly publish: Publish = atomicWriteText) {
    if (!isAbsolute(userData)) throw storageError()
  }

  async read(): Promise<GlobalConnectionSnapshot> {
    try { return await this.readAt(await realpath(this.userData)) }
    catch { throw storageError() }
  }

  commit(expected: GlobalConnectionSnapshot, nextValue: GlobalConnectionDocument, beforePublish?: GlobalConnectionCommitGuard): Promise<GlobalConnectionSnapshot> {
    // Snapshot inputs before yielding, so caller mutations cannot alter the staged operation.
    const next = decodeGlobalConnectionDocument(nextValue)
    const revision = expected.document.revision
    const fingerprint = expected.fingerprint
    const result = this.writes.then(() => this.commitNow(revision, fingerprint, next, beforePublish))
    this.writes = result.then(() => undefined, () => undefined)
    return result
  }

  private async commitNow(revision: number, fingerprint: string | null, next: GlobalConnectionDocument, beforePublish?: GlobalConnectionCommitGuard): Promise<GlobalConnectionSnapshot> {
    const content = `${JSON.stringify(next, null, 2)}\n`
    if (Buffer.byteLength(content, 'utf8') > MAX_MODEL_CONNECTION_BYTES) throw storageError()
    let lock: Awaited<ReturnType<typeof open>> | undefined
    let lockFile: string | undefined
    let lockIdentity: ModelFileIdentity | undefined
    try {
      const root = await realpath(this.userData)
      lockFile = join(root, `${GLOBAL_CONNECTIONS_FILE}.lock`)
      // Cross-instance/process serialization. A crash lock is never silently stolen/deleted.
      try { lock = await open(lockFile, 'wx', 0o600) }
      catch (error) { if (fileErrorCode(error) === 'EEXIST') throw new StoreConflict(); throw error }
      lockIdentity = await lock.stat({ bigint: true })
      await lock.writeFile(randomUUID(), 'utf8')
      const current = await this.readAt(root)
      if (current.fingerprint !== fingerprint || current.document.revision !== revision) throw new StoreConflict()
      assertGlobalConnectionTransition(current.document, next)
      await this.publish(join(root, GLOBAL_CONNECTIONS_FILE), content, async () => {
        if (beforePublish) {
          try { await beforePublish.recheck() } catch { throw new StoreConflict() }
        }
        if (await realpath(this.userData) !== root) throw new StoreConflict()
        const latest = await this.readAt(root)
        if (latest.fingerprint !== current.fingerprint) throw new StoreConflict()
        if (beforePublish) {
          // Scope may change during source/catalog I/O. This last check must not yield.
          try { beforePublish.assertActive() } catch { throw new StoreConflict() }
        }
      })
      return { document: decodeGlobalConnectionDocument(next), fingerprint: digest(Buffer.from(content)) }
    } catch (error) {
      if (error instanceof StoreConflict) throw new AppError('CONFLICT', '全局模型接口正在保存或已被修改，请刷新后重试；若上次保存异常中断，请先检查安全存储。', { recoverable: true })
      throw storageError()
    } finally {
      if (lock) {
        await lock.close().catch(() => undefined)
        // Only remove the exact lock created by this operation, never someone else's lock.
        const actual = await lstat(lockFile!, { bigint: true }).catch(() => null)
        if (actual && lockIdentity && !actual.isSymbolicLink() && sameModelFileIdentity(actual, lockIdentity)) {
          await unlink(lockFile!).catch(() => undefined)
        }
      }
    }
  }

  private async readAt(root: string): Promise<GlobalConnectionSnapshot> {
    const interruptedBackup = (await readdir(root)).some(name => name.startsWith(`${GLOBAL_CONNECTIONS_FILE}.`) && name.endsWith('.efs-backup'))
    if (interruptedBackup) throw storageError()
    const value = await readModelConnectionFile(root, GLOBAL_CONNECTIONS_FILE)
    return value ? { document: decodeGlobalConnectionDocument(value.value), fingerprint: value.fingerprint }
      : { document: emptyGlobalConnections(), fingerprint: null }
  }
}

function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function storageError(): AppError { return new AppError('STORAGE_ERROR', '全局模型接口无法安全读取或确认保存结果，请检查当前状态后重试。', { recoverable: true }) }
