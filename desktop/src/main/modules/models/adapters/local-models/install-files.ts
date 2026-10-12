import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { AppError } from '../../../../core/errors/app-error'

export type DownloadArtifact = { bytes: number; sha256: string; url: string }
export function installError(message: string) { return new AppError('FEATURE_UNAVAILABLE', message, { recoverable: true }) }
export function safeRelative(name: string): string {
  if (!name || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw installError('安装包包含无效路径。')
  return name
}
/** Recheck every existing ancestor; owned installation paths never traverse links. */
export async function ownedPath(root: string, name: string): Promise<string> {
  safeRelative(name)
  if ((await lstat(root)).isSymbolicLink()) throw installError('安装目录包含链接，请检查存储位置。')
  const canonical = await realpath(root)
  let path = canonical
  for (const part of name.split('/')) {
    path = join(path, part)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw installError('安装目录包含链接，请检查存储位置。')
      const rel = relative(canonical, await realpath(path))
      if (rel.startsWith('..') || isAbsolute(rel)) throw installError('安装目录超出允许范围。')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path
}
export async function fileMatches(path: string, artifact: Pick<DownloadArtifact, 'bytes' | 'sha256'>, signal: AbortSignal, progress?: (bytes: number) => void): Promise<boolean> {
  signal.throwIfAborted()
  try { if (!(await stat(path)).isFile() || (await stat(path)).size !== artifact.bytes) return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 4 * 1024 * 1024 })) {
    signal.throwIfAborted(); hash.update(chunk); bytes += chunk.length; progress?.(bytes)
  }
  return hash.digest('hex') === artifact.sha256
}
export async function atomicJson(root: string, name: string, value: unknown) {
  const path = await ownedPath(root, name), temporary = await ownedPath(root, name + '.' + randomUUID() + '.tmp')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
  await ownedPath(root, name); await rename(temporary, path)
}
export async function readSmallJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 2 * 1024 * 1024) throw installError('安装记录过大，原记录已保留。')
  return JSON.parse(await readFile(path, 'utf8'))
}
