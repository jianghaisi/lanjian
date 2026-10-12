import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { codePluginLimits, marketDigest } from '@lanjian/writing-plugin-contracts'
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
export class PackageStore {
  private constructor(private readonly root: string) {}
  static async open(root: string) { await mkdir(root, { recursive: true }); if ((await lstat(root)).isSymbolicLink()) throw new Error('Invalid package root'); return new PackageStore(await realpath(root)) }
  async read(digest: string): Promise<Buffer> {
    const path = join(this.root, `${marketDigest(digest)}.zip`)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid package object')
    const file = await open(path, 'r')
    try {
      const info = await file.stat(); if (!info.isFile() || info.size > codePluginLimits.zipBytes) throw new Error('Invalid package size')
      const bytes = Buffer.alloc(info.size + 1); let offset = 0
      while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead }
      const result = bytes.subarray(0, offset)
      if (offset !== info.size || createHash('sha256').update(result).digest('hex') !== digest) throw new Error('Invalid package digest')
      return result
    } finally { await file.close() }
  }
  async put(bytes: Uint8Array, digest: string) {
    if (bytes.length > codePluginLimits.zipBytes || createHash('sha256').update(bytes).digest('hex') !== marketDigest(digest)) throw new Error('Invalid package bytes')
    try { await this.read(digest); return } catch (e) { if (!missing(e)) throw e }
    const temporary = join(this.root, `.upload-${randomUUID()}`), file = await open(temporary, 'wx')
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await rename(temporary, join(this.root, `${digest}.zip`)); await this.read(digest)
  }
}
