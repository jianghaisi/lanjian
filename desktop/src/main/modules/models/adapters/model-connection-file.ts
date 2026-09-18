import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_MODEL_CONNECTION_BYTES } from '../domain/model-connections'
import { projectTargetPath } from '../../../platform/storage/project-path'

/** Private bounded reader shared by app authority and selected legacy sources. */
export async function readModelConnectionFile(root: string, relativePath: string): Promise<{ value: unknown; content: string; fingerprint: string } | null> {
  const file = await projectTargetPath(root, join(root, relativePath))
  let stat
  try { stat = await lstat(file, { bigint: true }) }
  catch (error) { if (fileErrorCode(error) === 'ENOENT') return null; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_MODEL_CONNECTION_BYTES)) throw Error('Invalid model settings file')
  const handle = await open(file, 'r')
  try {
    const actual = await handle.stat({ bigint: true })
    if (!actual.isFile() || !sameModelFileIdentity(stat, actual) || actual.nlink !== 1n) throw Error('Invalid model settings identity')
    const bytes = Buffer.alloc(MAX_MODEL_CONNECTION_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length)
      if (!part.bytesRead) break
      length += part.bytesRead
    }
    if (length > MAX_MODEL_CONNECTION_BYTES) throw Error('Model settings too large')
    const content = bytes.subarray(0, length)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
    const value: unknown = JSON.parse(decoded)
    return { value, content: decoded, fingerprint: createHash('sha256').update(content).digest('hex') }
  } finally { await handle.close() }
}

export type ModelFileIdentity = { dev: bigint; ino: bigint }
export function sameModelFileIdentity(pathStat: ModelFileIdentity, handleStat: ModelFileIdentity): boolean {
  // Windows lstat can report dev=0 while fstat reports the actual volume serial.
  return pathStat.ino === handleStat.ino
    && (pathStat.dev === handleStat.dev || (process.platform === 'win32' && pathStat.dev === 0n))
}
export function fileErrorCode(value: unknown): unknown {
  return value && typeof value === 'object' && 'code' in value ? value.code : undefined
}
