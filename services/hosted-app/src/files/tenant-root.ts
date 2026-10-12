import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { uuid } from '@lanjian/hosted-contracts'
import { fail } from '../http/errors.ts'

/** Every segment is server-controlled; reject links before using a cached runtime. */
export async function tenantParent(dataDir: string, owner: string, create: boolean): Promise<string> {
  const base = await realpath(resolve(dataDir))
  let current = base
  for (const segment of ['users', uuid(owner), 'books']) {
    current = join(current, segment)
    if (create) await mkdir(current, { mode: 0o700 }).catch(error => { if (error?.code !== 'EEXIST') throw error })
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) fail('conflict')
  }
  return current
}
export async function verifiedBookRoot(dataDir: string, owner: string, book: string): Promise<string> {
  const parent = await tenantParent(dataDir, owner, false), root = join(parent, uuid(book))
  const info = await lstat(root), canonical = await realpath(root), rel = relative(parent, canonical)
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== root || isAbsolute(rel) || rel.startsWith('..')) fail('conflict')
  return root
}
