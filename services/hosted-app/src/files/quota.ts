import { defaultLimits, type SiteLimits } from '@lanjian/hosted-contracts'
import { lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tenantParent } from './tenant-root.ts'
import { fail } from '../http/errors.ts'

export async function assertTenantSpace(dataDir: string, owner: string, bookId: string | null, extraBytes: number, limits: SiteLimits = defaultLimits): Promise<void> {
  const parent = await tenantParent(dataDir, owner, false)
  let files = 0, total = 0, book = 0
  async function walk(path: string, currentBook: boolean): Promise<void> {
    for (const name of await readdir(path)) {
      if (++files > 50000) fail('quota-exceeded')
      // SQLite may remove WAL/SHM files after enumeration when its last handle closes.
      const child = join(path, name), stat = await lstat(child).catch(error => { if (error?.code === 'ENOENT') return null; throw error })
      if (!stat) continue
      if (stat.isSymbolicLink()) fail('conflict')
      if (stat.isDirectory()) await walk(child, currentBook)
      else if (stat.isFile()) { total += stat.size; if (currentBook) book += stat.size }
      else fail('conflict')
      if (total + extraBytes > limits.userMiB * 1024 * 1024 || book + extraBytes > limits.bookMiB * 1024 * 1024) fail('quota-exceeded')
    }
  }
  for (const id of await readdir(parent)) {
    const path = join(parent, id), stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('conflict')
    await walk(path, id === bookId)
  }
  for (const directory of ['group-chat', 'inspiration']) {
  const preparation = join(dirname(parent), directory)
  const stat = await lstat(preparation).catch(error => { if (error?.code === 'ENOENT') return null; throw error })
  if (stat) { if (!stat.isDirectory() || stat.isSymbolicLink()) fail('conflict'); await walk(preparation, bookId === null) }
  }
  if (total + extraBytes > limits.userMiB * 1024 * 1024 || book + extraBytes > limits.bookMiB * 1024 * 1024) fail('quota-exceeded')
}
