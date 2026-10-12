import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { fromBufferPromise } from 'yauzl'
import { codePluginLimits, validatePluginRecipe, validatePluginManifest, validatePluginPath, validateCreativeAssets } from '@lanjian/writing-plugin-contracts'
import type { PluginManifest } from '@lanjian/writing-plugin-contracts'
export type ValidatedPluginPackage = { manifest: PluginManifest; digest: string; unpackedBytes: number; files: Map<string, Uint8Array> }
const invalid = (): never => { throw new Error('Invalid plugin archive') }

/** No extraction or guest execution during preview. Every raw entry is visited;
 * lazy streams bound actual bytes as well as untrusted advertised ZIP sizes. */
export async function readPluginPackage(input: Uint8Array): Promise<ValidatedPluginPackage> {
  try {
    if (!input.byteLength || input.byteLength > codePluginLimits.zipBytes) invalid()
    const bytes = Buffer.from(input), zip = await fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
    if (zip.entryCount < 2 || zip.entryCount > codePluginLimits.files * 2) invalid()
    const files = new Map<string, Buffer>(), paths = new Map<string, boolean>(), offsets = new Set<number>()
    let unpackedBytes = 0, count = 0, advertisedBytes = 0
    try {
      for await (const entry of zip.eachEntry()) {
        if (++count > codePluginLimits.files * 2 || entry.isEncrypted() || !entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) invalid()
        // Reject Windows reparse/device attributes and Unix non-file/non-directory types.
        const directory = entry.fileName.endsWith('/'), mode = (entry.externalFileAttributes >>> 16) & 0xf000
        if (entry.externalFileAttributes & 0x440 || mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) invalid()
        const path = validatePluginPath(directory ? entry.fileName.slice(0, -1) : entry.fileName), folded = path.toLowerCase()
        if (paths.has(folded) || offsets.has(entry.relativeOffsetOfLocalHeader)) invalid()
        paths.set(folded, directory); offsets.add(entry.relativeOffsetOfLocalHeader)
        for (const [existing, isDirectory] of paths) {
          if (!isDirectory && folded.startsWith(existing + '/') || !directory && existing.startsWith(folded + '/')) invalid()
        }
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) invalid()
        advertisedBytes += entry.uncompressedSize
        if (advertisedBytes > codePluginLimits.unpackedBytes || entry.compressedSize > bytes.length) invalid()
        // Central/local names must agree; do not let different ZIP readers install
        // a different entry. Unicode-path extras must describe the same raw name.
        const local = await zip.readLocalFileHeaderPromise(entry)
        if (!local.fileName.equals(entry.fileNameRaw) || local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) invalid()
        const rawName = new TextDecoder('utf-8', { fatal: true }).decode(entry.fileNameRaw)
        if (rawName !== entry.fileName || local.fileDataStart + entry.compressedSize > bytes.length) invalid()
        if (directory) { if (entry.uncompressedSize !== 0) invalid(); continue }
        if (files.size >= codePluginLimits.files) invalid()
        const chunks: Buffer[] = [], stream = await zip.openReadStreamPromise(entry)
        let size = 0, checksum = 0
        try {
          for await (const data of stream) {
            const chunk = Buffer.from(data); size += chunk.length; unpackedBytes += chunk.length
            if (size > entry.uncompressedSize || unpackedBytes > codePluginLimits.unpackedBytes) invalid()
            checksum = crc32(chunk, checksum); chunks.push(chunk)
          }
        } finally { stream.destroy() }
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) invalid()
        files.set(path, Buffer.concat(chunks, size))
      }
    } finally { zip.close() }
    if (count !== zip.entryCount) invalid()
    const manifestBytes = files.get('lanjian-plugin.json')
    if (!manifestBytes || manifestBytes.length > codePluginLimits.manifestBytes) invalid()
    const decode = (data: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(data)
    const manifest = validatePluginManifest(JSON.parse(decode(manifestBytes!)))
    const entry = files.get(manifest.entry)
    if (!entry || entry.length > codePluginLimits.entryBytes) invalid()
    const entryText = decode(entry!)
    if (manifest.runtime === 'declarative') validatePluginRecipe(JSON.parse(entryText), manifest)
    for (const asset of manifest.assets ?? []) { const data = files.get(asset); if (!data) invalid(); decode(data!) }
    validateCreativeAssets(manifest, new Map((manifest.assets ?? []).map(path => [path, decode(files.get(path)!)])))
    return { manifest, digest: createHash('sha256').update(bytes).digest('hex'), unpackedBytes, files }
  } catch (cause) {
    throw new Error('Invalid plugin archive', { cause })
  }
}
