import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { codePluginLimits, validatePluginRecipe, validatePluginManifest, validateCreativeAssets } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { decodePluginIndex, type InstalledVersion, type PluginIndex, type PluginPackageStorePort, type ValidatedPluginPackage } from '../domain/installed'
import { readPluginPackage } from './package-reader'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const conflict = (): never => { throw new AppError('CONFLICT', '插件安装状态或文件已变化，请重新预览后操作。', { recoverable: true }) }
const storage = (cause: unknown): never => { throw new AppError('STORAGE_ERROR', '插件存储无法读取或校验失败，原文件已保留。', { recoverable: true, cause }) }

/** Bounded file reads, including a second stat so an in-place edit cannot create
 * a mixed preview. Caller paths stay main-only and never enter plugin input. */
export async function readPluginZipFile(path: string): Promise<ValidatedPluginPackage> {
  if (!/\.zip$/i.test(path) || (await lstat(path)).isSymbolicLink()) conflict()
  return readPluginPackage(await readBoundedFile(path, codePluginLimits.zipBytes))
}
export async function readBoundedFile(path: string, max: number): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > max) conflict()
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead }
    const after = await file.stat()
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) conflict()
    return bytes.subarray(0, length)
  } finally { await file.close() }
}

export class PluginPackageStore implements PluginPackageStorePort {
  private readonly anchor: Promise<{ path: string; dev: number; ino: number }>
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly root: string) {
    this.anchor = realpath(root).then(async path => { const info = await stat(path); if (!info.isDirectory()) conflict(); return { path, dev: info.dev, ino: info.ino } })
  }
  private async safe(path: string): Promise<string> {
    const anchor = await this.anchor, current = await realpath(this.root), info = await stat(current)
    if (current !== anchor.path || info.dev !== anchor.dev || info.ino !== anchor.ino) conflict()
    const result = await projectDirectory(this.root, path)
    let cursor = resolve(this.root)
    for (const segment of relative(resolve(this.root), result).split(sep).filter(Boolean)) {
      cursor = join(cursor, segment)
      try { if ((await lstat(cursor)).isSymbolicLink()) conflict() } catch (error) { if (!missing(error)) throw error }
    }
    return result
  }
  private versionPath(version: InstalledVersion): string { return join(this.root, 'plugin-packages', version.manifest.id, `${version.manifest.version}-${version.digest}`) }
  async read(): Promise<PluginIndex> { await this.writes; return this.readNow() }
  readZip(path: string): Promise<ValidatedPluginPackage> { return readPluginZipFile(path) }
  private async readNow(): Promise<PluginIndex> {
    const path = await this.safe(join(this.root, 'plugin-index.json'))
    try { return decodePluginIndex(JSON.parse((await readBoundedFile(path, codePluginLimits.indexBytes)).toString('utf8'))) }
    catch (cause) { if (missing(cause)) return { format: 1, revision: 0, plugins: [], books: [] }; return storage(cause) }
  }
  write(index: PluginIndex, expectedRevision: number): Promise<void> {
    const snapshot = decodePluginIndex(index)
    const operation = this.writes.then(async () => {
      if (snapshot.revision !== expectedRevision + 1 || (await this.readNow()).revision !== expectedRevision) conflict()
      const path = await this.safe(join(this.root, 'plugin-index.json'))
      await writeJson(path, snapshot, async () => { await this.safe(path); if ((await this.readNow()).revision !== expectedRevision) conflict() })
    })
    this.writes = operation.catch(() => {})
    return operation
  }
  async publish(pkg: ValidatedPluginPackage): Promise<InstalledVersion> {
    const version: InstalledVersion = { digest: pkg.digest, manifest: structuredClone(pkg.manifest), files: [...pkg.files].map(([path, bytes]) => ({ path, digest: hash(bytes), bytes: bytes.length })), origin: 'local', installedAt: new Date().toISOString(), grants: [] }
    const destination = await this.safe(this.versionPath(version))
    try { await stat(destination); await this.load(version); return version } catch (error) { if (!missing(error)) throw error }
    const staging = await this.safe(join(this.root, 'plugin-packages', `.staging-${randomUUID()}`))
    await mkdir(staging, { recursive: true }); await this.safe(staging)
    // On any failure, preserve the staging evidence. Never remove an older version.
    for (const [path, bytes] of pkg.files) {
      const file = await this.safe(join(staging, path))
      await mkdir(dirname(file), { recursive: true }); await this.safe(file)
      await writeFile(file, bytes, { flag: 'wx' })
    }
    await mkdir(dirname(destination), { recursive: true })
    await this.safe(staging); await this.safe(destination)
    await rename(staging, destination)
    await this.load(version)
    return version
  }
  async load(version: InstalledVersion): Promise<Map<string, Buffer>> {
    try {
      const root = await this.safe(this.versionPath(version)), files = new Map<string, Buffer>()
      for (const metadata of version.files) {
        const file = await this.safe(join(root, metadata.path)), bytes = await readBoundedFile(file, metadata.bytes)
        await this.safe(file)
        if (bytes.length !== metadata.bytes || hash(bytes) !== metadata.digest) conflict()
        files.set(metadata.path, bytes)
      }
      // Match ZIP preview's strict UTF-8/BOM decoding without changing hashed bytes.
      const decode = new TextDecoder('utf-8', { fatal: true })
      const manifest = validatePluginManifest(JSON.parse(decode.decode(files.get('lanjian-plugin.json')!)))
      if (JSON.stringify(manifest) !== JSON.stringify(version.manifest)) conflict()
      if (manifest.runtime === 'declarative') validatePluginRecipe(JSON.parse(decode.decode(files.get(manifest.entry)!)), manifest)
      validateCreativeAssets(manifest, new Map((manifest.assets ?? []).map(path => [path, decode.decode(files.get(path)!)])))
      return files
    } catch (cause) { return storage(cause) }
  }
  async remove(version: InstalledVersion): Promise<void> {
    const target = await this.safe(this.versionPath(version))
    try {
      // Refuse reparse points throughout the exact owned version tree before rm.
      const directories = [target]
      while (directories.length) {
        const directory = directories.pop()!
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = await this.safe(join(directory, entry.name))
          if (entry.isDirectory()) directories.push(path)
        }
      }
      await this.safe(target)
      await rm(target, { recursive: true, force: false })
    } catch (cause) { if (!missing(cause)) return storage(cause) }
  }
}
