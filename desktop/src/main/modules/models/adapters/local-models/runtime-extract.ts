import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { openPromise } from 'yauzl'
import { installError, ownedPath, safeRelative } from './install-files'

export type InstalledFile = { path: string; bytes: number; sha256: string }
export type RuntimeArchive = { format: string; target: string; expandedBytes: number }
const unzipGzip = promisify(gunzip)
/** Deliberately supports only the regular files/directories in the pinned recipe. */
export async function extractRuntime(archive: string, spec: RuntimeArchive, root: string, signal: AbortSignal, known: Set<string>): Promise<InstalledFile[]> {
  const files: InstalledFile[] = []; let expanded = 0, entries = 0
  const target = (name: string, directory = false) => {
    signal.throwIfAborted()
    const path = safeRelative((spec.target ? spec.target + '/' : '') + (directory ? name.replace(/\/$/, '') : name))
    if (++entries > 20000 || known.has(path.toLowerCase())) throw installError('安装包包含重复路径或过多文件。')
    if (!directory) known.add(path.toLowerCase())
    return path
  }
  const put = async (name: string, bytes: Buffer) => {
    expanded += bytes.length
    if (expanded > spec.expandedBytes) throw installError('运行环境解压大小超出清单。')
    const path = target(name), output = await ownedPath(root, path)
    await mkdir(dirname(output), { recursive: true }); await ownedPath(root, path)
    signal.throwIfAborted(); await writeFile(output, bytes, { flag: 'wx' })
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  if (spec.format === 'tar.gz') {
    const raw = await unzipGzip(await readFile(archive), { maxOutputLength: Math.min(256 * 1024 * 1024, spec.expandedBytes + 16 * 1024 * 1024) })
    const string = (block: Buffer, start: number, size: number) => block.subarray(start, start + size).toString('utf8').split('\0')[0]
    let offset = 0
    while (offset + 512 <= raw.length) {
      signal.throwIfAborted(); const header = raw.subarray(offset, offset + 512); offset += 512
      if (header.every(byte => byte === 0)) break
      const octal = (start: number, size: number) => { const value = string(header, start, size).trim(); if (!/^[0-7]+$/.test(value)) throw installError('运行环境归档格式无效。'); return parseInt(value, 8) }
      const checksum = [...header].reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0)
      if (checksum !== octal(148, 8)) throw installError('运行环境归档校验失败。')
      const size = octal(124, 12), prefix = string(header, 345, 155), name = (prefix ? prefix + '/' : '') + string(header, 0, 100)
      if (offset + size > raw.length) throw installError('运行环境归档不完整。')
      if (header[156] === 53 && size === 0) { const path = target(name, true); await mkdir(await ownedPath(root, path), { recursive: true }) }
      else if (header[156] === 48 || header[156] === 0) await put(name, raw.subarray(offset, offset + size))
      else throw installError('运行环境归档包含不支持的链接或条目。')
      offset += Math.ceil(size / 512) * 512
    }
  } else if (spec.format === 'zip') {
    const zip = await openPromise(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
    try {
      for await (const entry of zip.eachEntry()) {
        signal.throwIfAborted()
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000
        if ((kind && kind !== 0x8000 && kind !== 0x4000) || entry.isEncrypted()) throw installError('运行环境归档包含链接或加密条目。')
        if (entry.fileName.endsWith('/')) { const path = target(entry.fileName, true); await mkdir(await ownedPath(root, path), { recursive: true }); continue }
        expanded += entry.uncompressedSize
        if (expanded > spec.expandedBytes) throw installError('运行环境解压大小超出清单。')
        const path = target(entry.fileName), output = await ownedPath(root, path)
        await mkdir(dirname(output), { recursive: true }); await ownedPath(root, path)
        const file = await open(output, 'wx'), hash = createHash('sha256'); let bytes = 0
        const stream = await zip.openReadStreamPromise(entry)
        const abort = () => stream.destroy(new Error('cancelled')); signal.addEventListener('abort', abort, { once: true })
        try {
          for await (const chunk of stream) {
            signal.throwIfAborted(); bytes += chunk.length
            if (bytes > entry.uncompressedSize) throw installError('运行环境解压大小无效。')
            hash.update(chunk); await file.writeFile(chunk)
          }
        } finally { signal.removeEventListener('abort', abort); stream.destroy(); await file.close() }
        if (bytes !== entry.uncompressedSize) throw installError('运行环境归档不完整。')
        files.push({ path, bytes, sha256: hash.digest('hex') })
      }
    } finally { zip.close() }
  } else throw installError('运行环境归档格式不受支持。')
  if (expanded !== spec.expandedBytes) throw installError('运行环境文件总量与清单不一致。')
  return files
}
