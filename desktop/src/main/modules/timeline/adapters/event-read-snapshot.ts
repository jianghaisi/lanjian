import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, rmSync, rmdirSync } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { AppError } from '../../../core/errors/app-error'
import { isChangingWorkspaceSnapshot, workspaceSnapshotConflict as changedSnapshot } from '../../../core/errors/workspace-snapshot-error'
import { WORKSPACE_DATABASE_RELATIVE_PATH } from '../../../core/ports/workspace-database'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'

type FileStamp = { size: number; hash: string } | null
type SnapshotStamp = { database: FileStamp; wal: FileStamp; journal: FileStamp }

/**
 * SQLite readOnly still creates WAL sidecars in a writable source directory.
 * Inspect a private, byte-verified copy instead. This is not a backup API: any
 * concurrent source change or hot rollback journal fails closed for a fresh read.
 */
export async function eventReadSnapshot(workItemId: string, afterCopy?: (privatePath: string) => Promise<void>): Promise<{
  path: string
  sourceFingerprint: string
  dispose(): void
} | null> {
  const root = await canonicalDirectory(workItemId)
  const databasePath = await projectTargetPath(root, join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
  // Validate each sidecar independently: a sidecar itself can be a link outside the book.
  const sourcePaths = {
    database: databasePath,
    wal: await projectTargetPath(root, `${databasePath}-wal`),
    journal: await projectTargetPath(root, `${databasePath}-journal`)
  }
  const inspect = async (): Promise<SnapshotStamp> => ({
    database: await fileStamp(await containedSource(root, sourcePaths.database)),
    wal: await fileStamp(await containedSource(root, sourcePaths.wal)),
    journal: await fileStamp(await containedSource(root, sourcePaths.journal))
  })
  const before = await inspect()
  if (!before.database) {
    if (before.wal || before.journal) throw changedSnapshot('recovery-required')
    return null
  }
  if (before.journal && before.journal.size > 0) throw changedSnapshot('recovery-required')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'lanjian-event-read-'))
  const path = join(temporaryRoot, 'snapshot.sqlite')
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    // Exact owned files only; never recursively clean a book, temp root or unknown file.
    for (const suffix of ['-shm', '-wal', '-journal', '']) {
      try { rmSync(`${path}${suffix}`, { force: true }) } catch { /* retained private snapshot on cleanup failure */ }
    }
    try { rmdirSync(temporaryRoot) } catch { /* do not remove unrecognized contents */ }
  }
  try {
    // Windows CopyFile can temporarily deny writable opens of its source.
    // Stream with normal read sharing; the byte checks below still reject races.
    await pipeline(createReadStream(await containedSource(root, sourcePaths.database)), createWriteStream(path, { flags: 'wx' }))
    if (before.wal) await pipeline(createReadStream(await containedSource(root, sourcePaths.wal)), createWriteStream(`${path}-wal`, { flags: 'wx' }))
    await afterCopy?.(path)
    const copied = { database: await fileStamp(path), wal: await fileStamp(`${path}-wal`) }
    // Two source observations plus the actual copied bytes must agree. This rejects
    // checkpoint/copy races rather than assuming that copying the main DB is enough.
    const after = await inspect()
    if (JSON.stringify(before) !== JSON.stringify(after)
      || JSON.stringify(copied.database) !== JSON.stringify(before.database)
      || JSON.stringify(copied.wal) !== JSON.stringify(before.wal)) throw changedSnapshot()
    for (const source of Object.values(sourcePaths)) {
      await containedSource(root, source)
    }
    return { path, sourceFingerprint: createHash('sha256').update(JSON.stringify(before)).digest('hex'), dispose }
  } catch (error) {
    dispose()
    if (error instanceof AppError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw changedSnapshot()
    throw new AppError('STORAGE_ERROR', '暂时无法建立只读事件快照；作品文件没有被改写。', { recoverable: true, cause: error })
  }
}

/** Initial inspection may race a normal checkpoint. Retry only acquisition, never a reviewed commit. */
export async function stableEventReadSnapshot(workItemId: string) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await eventReadSnapshot(workItemId) } catch (error) {
      if (!isChangingWorkspaceSnapshot(error) || attempt >= 2) throw error
    }
  }
}

async function containedSource(root: string, path: string): Promise<string> {
  await projectTargetPath(root, path)
  try { return await projectExistingPath(root, path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
    throw error
  }
}

async function fileStamp(path: string): Promise<FileStamp> {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw changedSnapshot()
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(path)) {
      size += chunk.length
      hash.update(chunk)
    }
    if (size !== info.size) throw changedSnapshot()
    return { size, hash: hash.digest('hex') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
