import { mkdir, realpath, rename, stat, statfs } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { InstallationProgress, ModelAssetSource, ModelManifest, VerifiedModelAssets, VerifiedRuntime } from '../../domain/local-models'
import { ExistingModelAssets } from './existing-assets'
import { atomicJson, fileMatches, installError, ownedPath, readSmallJson, safeRelative } from './install-files'
import { ModelDownloader } from './model-download'
import { extractRuntime, type InstalledFile } from './runtime-extract'
import { runtimeProfile } from './runtime-profile'

type RuntimeReceipt = { version: 1; profile: string; directory: string; files: InstalledFile[] }
export class ManagedModelAssets implements ModelAssetSource {
  private legacy: ExistingModelAssets
  private downloader: ModelDownloader
  constructor(private root: string, private legacyRoot: string, downloader?: ModelDownloader) {
    this.legacy = new ExistingModelAssets(legacyRoot)
    this.downloader = downloader ?? new ModelDownloader(join(root, 'downloads'))
  }
  private supported(manifest: ModelManifest) { return process.platform === runtimeProfile.platform && process.arch === runtimeProfile.arch && manifest.runtimeId === 'llama-cpp-python' }
  private async modelPath(manifest: ModelManifest): Promise<string | undefined> {
    const file = manifest.files[0]!
    for (const [root, name] of [[this.root, 'downloads/' + file.sha256 + '.asset'], [this.legacyRoot, file.relativePath]]) {
      try {
        const canonical = await realpath(root), path = await realpath(join(root, name)), rel = relative(canonical, path)
        if (rel.startsWith('..') || isAbsolute(rel)) throw installError('本地模型资源位置无效。')
        if ((await stat(path)).isFile() && (await stat(path)).size === file.bytes) return path
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  private async receipt(): Promise<RuntimeReceipt | undefined> {
    const invalid = () => installError('本地运行环境记录无效，原记录已保留；请检查或恢复记录后重试。')
    const record = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
      return value as Record<string, unknown>
    }
    try {
      const r = record(await readSmallJson(await ownedPath(this.root, 'runtime-current.json')))
      if (r.version !== 1 || r.profile !== runtimeProfile.id || typeof r.directory !== 'string' || !Array.isArray(r.files) || r.files.length < 1 || r.files.length > 20000) throw invalid()
      const id = r.directory.startsWith(runtimeProfile.id + '-') ? r.directory.slice(runtimeProfile.id.length + 1) : r.directory
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw invalid()
      const files: InstalledFile[] = [], known = new Set<string>()
      for (const value of r.files) {
        const file = record(value)
        if (typeof file.path !== 'string' || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw invalid()
        try { safeRelative(file.path) } catch { throw invalid() }
        const key = file.path.toLowerCase()
        if (known.has(key)) throw invalid()
        known.add(key); files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 })
      }
      if (![runtimeProfile.python, runtimeProfile.sitePackages + '/llama_cpp/llama.py'].every(path => known.has(path.toLowerCase()))) throw invalid()
      return { version: 1, profile: runtimeProfile.id, directory: r.directory, files }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      if (error instanceof SyntaxError) throw invalid()
      throw error
    }
  }
  async installationInfo(manifest: ModelManifest) {
    const receipt = await this.receipt()
    if (!receipt && await this.legacy.discover(manifest)) return { canDownload: this.supported(manifest), downloadBytes: 0, requiredDiskBytes: 0 }
    const model = await this.modelPath(manifest), runtimePresent = receipt && await this.runtimePresent(receipt)
    const runtimeBytes = runtimePresent ? 0 : runtimeProfile.files.reduce((n, f) => n + f.bytes, 0)
    const downloadBytes = (model ? 0 : manifest.files[0]!.bytes) + runtimeBytes
    return { canDownload: this.supported(manifest), downloadBytes, requiredDiskBytes: downloadBytes + (runtimePresent ? 0 : runtimeProfile.files.reduce((n, f) => n + f.expandedBytes, 0)) + 256 * 1024 * 1024 }
  }
  async discover(manifest: ModelManifest) {
    const receipt = await this.receipt()
    if (!receipt) return this.legacy.discover(manifest)
    return Boolean(await this.modelPath(manifest) && await this.runtimePresent(receipt))
  }
  private async runtimePresent(receipt: RuntimeReceipt): Promise<boolean> {
    // Listing checks entry-point presence only; prepare still verifies every hash.
    // Match prepare's managed-first selection rather than masking loss with legacy assets.
    try {
      const root = await ownedPath(this.root, 'runtimes/' + receipt.directory)
      return (await stat(await ownedPath(root, runtimeProfile.python))).isFile()
        && (await stat(await ownedPath(root, runtimeProfile.sitePackages))).isDirectory()
        && (await stat(await ownedPath(root, runtimeProfile.sitePackages + '/llama_cpp/llama.py'))).isFile()
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  private async runtime(signal: AbortSignal, allowRepair = false): Promise<VerifiedRuntime | undefined> {
    const receipt = await this.receipt(); if (!receipt) return
    const root = await ownedPath(this.root, 'runtimes/' + receipt.directory)
    try {
      for (const file of receipt.files) {
        if (!await fileMatches(await ownedPath(root, file.path), file, signal)) {
          signal.throwIfAborted()
          if (allowRepair) return
          throw installError('本地运行环境校验失败，请重新安装；原环境已保留。')
        }
      }
    } catch (error) {
      signal.throwIfAborted()
      // Missing files can be rebuilt; permissions, links and invalid records cannot.
      if (allowRepair && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    return { root, python: await ownedPath(root, runtimeProfile.python), sitePackages: await ownedPath(root, runtimeProfile.sitePackages) }
  }
  async prepare(manifest: ModelManifest, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets> {
    if (!await this.receipt() && await this.legacy.discover(manifest)) return this.legacy.prepare(manifest, signal, progress)
    const modelPath = await this.modelPath(manifest)
    if (!modelPath) throw installError('尚未安装模型，请先在模型超市下载安装。')
    if (!await fileMatches(modelPath, manifest.files[0]!, signal, bytes => progress('verifying', Math.floor(bytes / manifest.files[0]!.bytes * 80), '正在校验模型文件'))) throw installError('模型校验未通过，原文件已保留。')
    const runtime = await this.runtime(signal)
    if (!runtime) throw installError('尚未安装本地运行环境，请先完成安装。')
    return { ...runtime, modelPath, fingerprint: manifest.files[0]!.sha256 + ':' + manifest.revision }
  }
  async install(manifest: ModelManifest, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets> {
    if (!this.supported(manifest)) throw installError('当前安装包仅支持 Windows x64 CPU。')
    if (!await this.receipt() && await this.legacy.discover(manifest)) {
      try { return await this.legacy.prepare(manifest, signal, progress) }
      catch { signal.throwIfAborted() /* preserve damaged originals, install a managed replacement */ }
    }
    await mkdir(this.root, { recursive: true }); await ownedPath(this.root, 'downloads')
    let modelPath = await this.modelPath(manifest)
    progress('verifying', 0, '正在检查可复用的本机资源')
    if (modelPath && !await fileMatches(modelPath, manifest.files[0]!, signal)) modelPath = undefined
    let runtime = await this.runtime(signal, true)
    signal.throwIfAborted()
    const totalBytes = (modelPath ? 0 : manifest.files[0]!.bytes) + (runtime ? 0 : runtimeProfile.files.reduce((n, f) => n + f.bytes, 0))
    const disk = await statfs(this.root), required = totalBytes + (runtime ? 0 : runtimeProfile.files.reduce((n,f)=>n+f.expandedBytes,0)) + 256*1024*1024
    if (disk.bavail * disk.bsize < required) throw installError('磁盘可用空间不足，请释放空间后重试。')
    let done = 0
    const download = async (file: ModelManifest['files'][number] | typeof runtimeProfile.files[number]) => {
      const path = await this.downloader.download(file, signal, received => progress('downloading', totalBytes ? Math.floor((done + received) / totalBytes * 80) : 80, '正在下载模型与运行环境', { receivedBytes: done + received, totalBytes }))
      done += file.bytes; return path
    }
    if (!modelPath) modelPath = await download(manifest.files[0]!)
    if (!runtime) {
      const archives: string[] = []
      for (const file of runtimeProfile.files) archives.push(await download(file))
      progress('installing', 82, '正在准备独立运行环境')
      // Keep native DLL paths short; the full recipe identity belongs in the receipt.
      const directory = randomUUID(), stageName = 'staging/' + directory
      const stage = await ownedPath(this.root, stageName); await mkdir(stage, { recursive: true })
      const files: InstalledFile[] = [], known = new Set<string>()
      for (let i = 0; i < archives.length; i++) files.push(...await extractRuntime(archives[i], runtimeProfile.files[i], stage, signal, known))
      await mkdir(await ownedPath(stage, 'temp'), { recursive: true })
      signal.throwIfAborted()
      const final = await ownedPath(this.root, 'runtimes/' + directory)
      await mkdir(await ownedPath(this.root, 'runtimes'), { recursive: true })
      await ownedPath(this.root, stageName); await rename(stage, final)
      signal.throwIfAborted()
      await atomicJson(this.root, 'runtime-current.json', { version: 1, profile: runtimeProfile.id, directory, files })
      runtime = { root: final, python: await ownedPath(final, runtimeProfile.python), sitePackages: await ownedPath(final, runtimeProfile.sitePackages) }
    }
    return { ...runtime, modelPath, fingerprint: manifest.files[0]!.sha256 + ':' + manifest.revision }
  }
}
