import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { recoverableFileReplace, recoveryPath } from './recoverable-file-replace'

const writeLanes = new Map<string, Promise<void>>()

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      try { return JSON.parse(await readFile(recoveryPath(path), 'utf8')) as T }
      catch (recoveryError) {
        const recoveryCode = (recoveryError as NodeJS.ErrnoException).code
        if (recoveryCode === 'ENOENT' || recoveryError instanceof SyntaxError) return fallback
        throw recoveryError
      }
    }
    throw error
  }
}

export async function writeJson(path: string, value: unknown, beforeCommit?: () => Promise<void>): Promise<void> {
  return inWriteLane(path, () => writeJsonNow(path, value, beforeCommit))
}

async function writeJsonNow(path: string, value: unknown, beforeCommit?: () => Promise<void>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // A shared `.tmp` name lets two independent save paths overwrite each
  // other on Windows. Each write owns its staging file, then retries the
  // final rename briefly when antivirus/indexing has the destination open.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const content = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temporary, content, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    // A cancelled/stale operation may stage bytes, but must not replace the last valid report.
    if (beforeCommit) {
      try { await beforeCommit() }
      catch (error) { await rm(temporary, { force: true }); throw error }
    }
    try {
      await rename(temporary, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // NTFS EFS can reject replacement-by-rename with EXDEV even when both
      // files are siblings on the same volume. Preserve a verified recovery
      // copy before using the EFS-compatible overwrite path.
      if (code === 'EXDEV') return recoverableFileReplace(temporary, path, Buffer.from(content), { beforeCommit, validRecovery: validJson })
      if (attempt >= 5 || !['EACCES', 'EBUSY', 'EPERM'].includes(String(code))) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

function validJson(bytes: Buffer): boolean {
  try { JSON.parse(bytes.toString('utf8')); return true }
  catch { return false }
}

function inWriteLane<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLanes.get(path) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(() => undefined, () => undefined)
  writeLanes.set(path, settled)
  return result.finally(() => { if (writeLanes.get(path) === settled) writeLanes.delete(path) })
}
