import { copyFile, readFile, rm } from 'node:fs/promises'

type ReplaceHooks = {
  beforeCommit?: () => Promise<void>
  assertActive?: () => void
  validRecovery?: (bytes: Buffer) => boolean
}

export async function recoverableFileReplace(temporary: string, path: string, expectedContent: Uint8Array, hooks: ReplaceHooks = {}): Promise<void> {
  const recovery = recoveryPath(path)
  let recoverable = false
  let targetExisted = false
  try {
    try {
      const current = await readFile(path)
      targetExisted = true
      if (!hooks.validRecovery || hooks.validRecovery(current)) {
        await copyFile(path, recovery)
        recoverable = true
      } else {
        const previousRecovery = await readFile(recovery)
        recoverable = !hooks.validRecovery || hooks.validRecovery(previousRecovery)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      try {
        const previousRecovery = await readFile(recovery)
        recoverable = !hooks.validRecovery || hooks.validRecovery(previousRecovery)
      } catch (recoveryError) {
        if ((recoveryError as NodeJS.ErrnoException).code !== 'ENOENT') throw recoveryError
      }
    }
    await hooks.beforeCommit?.()
    hooks.assertActive?.()
    await copyFile(temporary, path)
    if (!Buffer.from(await readFile(path)).equals(Buffer.from(expectedContent))) throw new Error('File replacement verification failed')
    await rm(temporary, { force: true })
    await rm(recovery, { force: true })
  } catch (error) {
    try {
      if (recoverable) await copyFile(recovery, path)
      else if (!targetExisted) await rm(path, { force: true })
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'File replacement and recovery both failed')
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    throw error
  }
}

export function recoveryPath(path: string): string { return `${path}.recovery` }
