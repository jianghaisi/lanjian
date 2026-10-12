import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, open, rename, unlink } from 'node:fs/promises'

const replaceRetryDelaysMs = [20, 45, 90, 180, 360, 720]

export async function atomicWriteText(path: string, content: string, beforeReplace?: () => Promise<void>, assertActive?: () => void): Promise<void> {
  return atomicWrite(path, content, 'utf8', beforeReplace, assertActive)
}

export async function atomicWriteBuffer(path: string, content: Uint8Array, beforeReplace?: () => Promise<void>): Promise<void> {
  return atomicWrite(path, content, undefined, beforeReplace)
}

async function atomicWrite(path: string, content: string | Uint8Array, encoding?: BufferEncoding, beforeReplace?: () => Promise<void>, assertActive?: () => void): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx')
  try {
    try {
      await handle.writeFile(content, encoding)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await replaceWithRetry(temp, path, beforeReplace, assertActive)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

async function replaceWithRetry(temp: string, target: string, beforeReplace?: () => Promise<void>, assertActive?: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    // Recheck on every rename attempt, including Windows sharing-violation retries.
    if (beforeReplace) await beforeReplace()
    assertActive?.()
    try {
      await rename(temp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && code === 'EXDEV') {
        // Node's rename cannot replace an existing EFS-encrypted file and
        // reports a false cross-device error. Use the bounded EFS copy path,
        // which keeps and syncs a recoverable old-content backup.
        if (beforeReplace) await beforeReplace()
        assertActive?.()
        await replaceWindowsEncryptedFile(temp, target)
        return
      }
      const delay = replaceRetryDelaysMs[attempt]
      if (delay === undefined || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** Exported for deterministic regression coverage; production enters only after Windows rename returns EXDEV. */
export async function replaceWindowsEncryptedFile(temp: string, target: string): Promise<void> {
  const backup = `${target}.${randomUUID()}.efs-backup`
  await retryWindowsFileAction(() => copyFile(target, backup, constants.COPYFILE_EXCL))
  await syncFile(backup)
  try {
    // Windows refuses both rename-over and copy-over for an existing EFS file.
    // The exclusive lock plus the synced encrypted backup bounds the necessary
    // remove/copy window and makes an interrupted operation fail recoverably.
    await retryWindowsFileAction(() => unlink(target))
    await retryWindowsFileAction(() => copyFile(temp, target, constants.COPYFILE_EXCL))
    await syncFile(target)
    await unlink(temp)
    await unlink(backup)
  } catch (error) {
    try {
      await retryWindowsFileAction(async () => {
        await unlink(target).catch(value => { if ((value as NodeJS.ErrnoException).code !== 'ENOENT') throw value })
        await copyFile(backup, target, constants.COPYFILE_EXCL)
      })
      await syncFile(target)
      await unlink(backup)
    } catch { /* retain the encrypted backup for explicit recovery */ }
    throw error
  }
}

async function retryWindowsFileAction(action: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await action(); return }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const delay = replaceRetryDelaysMs[attempt]
      if (delay === undefined || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error
      await new Promise<void>(resolve => setTimeout(resolve, delay))
    }
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try { await handle.sync() } finally { await handle.close() }
}
