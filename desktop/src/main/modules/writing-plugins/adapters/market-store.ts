import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { codePluginLimits, marketDigest, type MarketRelease } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { decodeMarketJournal, type MarketIntent, type MarketJournal, type MarketStorePort } from '../domain/marketplace'
import { readBoundedFile } from './package-store'

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
export class PluginMarketStore implements MarketStorePort {
  private lane: Promise<unknown> = Promise.resolve()
  private readonly anchor: Promise<{ path: string; dev: number; ino: number }>
  constructor(private readonly root: string, private readonly origin: string) { this.anchor = realpath(root).then(async path => { const s = await stat(path); return { path, dev: s.dev, ino: s.ino } }) }
  private async safe(...parts: string[]) {
    const a = await this.anchor, current = await realpath(this.root), info = await stat(current)
    if (a.path !== current || a.dev !== info.dev || a.ino !== info.ino) throw new Error('Market root changed')
    let path = this.root
    for (const part of parts) { path = await projectDirectory(this.root, join(path, part)); try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Linked market storage') } catch (e) { if (!missing(e)) throw e } }
    return path
  }
  private serial<T>(fn: () => Promise<T>) { const next = this.lane.then(fn); this.lane = next.catch(() => {}); return next }
  private async load(): Promise<MarketJournal> {
    try {
      const journal = decodeMarketJournal(JSON.parse((await readBoundedFile(await this.safe('plugin-market.json'), 8 * 1024 * 1024)).toString('utf8')))
      if (journal.origin !== this.origin) throw new Error('Deployment changed')
      return journal
    } catch (cause) { if (missing(cause)) return { origin: this.origin, intents: [], downloads: [] }; throw new AppError('STORAGE_ERROR', '市场记录无法读取或服务地址已变化，原记录已保留。', { recoverable: true, cause }) }
  }
  async read() { await this.lane; return this.load() }
  private async save(next: MarketJournal, before: string) {
    await writeJson(await this.safe('plugin-market.json'), decodeMarketJournal(next), async () => {
      await this.safe('plugin-market.json')
      if (JSON.stringify(await this.load()) !== before) throw new AppError('CONFLICT', '市场记录已变化，请重新载入；原记录已保留。', { recoverable: true })
    })
  }
  private path(digest: string) { return this.safe('plugin-market-packages', `${marketDigest(digest)}.zip`) }
  async bytes(digest: string) {
    const bytes = await readBoundedFile(await this.path(digest), codePluginLimits.zipBytes)
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new AppError('STORAGE_ERROR', '市场包摘要不符，原文件已保留。', { recoverable: true })
    return bytes
  }
  private async put(digest: string, bytes: Uint8Array) {
    if (bytes.length > codePluginLimits.zipBytes || createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Invalid market package')
    const directory = await this.safe('plugin-market-packages'); await mkdir(directory, { recursive: true }); await this.safe('plugin-market-packages')
    try { await this.bytes(digest); return await this.path(digest) } catch (e) { if (!missing(e)) throw e }
    const temporary = await this.safe('plugin-market-packages', `.pending-${randomUUID()}.zip`), file = await open(temporary, 'wx')
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await rename(temporary, await this.path(digest)); await this.bytes(digest); return await this.path(digest)
  }
  intent(intent: MarketIntent, bytes: Uint8Array) {
    return this.serial(async () => {
      const journal = await this.load(), existing = journal.intents.find(i => i.request.operationId === intent.request.operationId)
      if (existing) { if (JSON.stringify(existing.request) !== JSON.stringify(intent.request) || existing.publisherId !== intent.publisherId) throw new Error('Conflicting publication'); return }
      const before = JSON.stringify(journal)
      await this.put(intent.request.digest, bytes); journal.intents.push(intent); await this.save(journal, before)
    })
  }
  release(release: MarketRelease) {
    return this.serial(async () => {
      const journal = await this.load(), intent = journal.intents.find(i => i.request.operationId === release.operationId)
      if (!intent) throw new Error('Unknown publication')
      const before = JSON.stringify(journal)
      intent.release = release; await this.save(journal, before)
    })
  }
  download(release: MarketRelease, bytes: Uint8Array) {
    return this.serial(async () => {
      const journal = await this.load(), before = JSON.stringify(journal), path = await this.put(release.digest, bytes)
      journal.downloads = [...journal.downloads.filter(d => d.operationId !== release.operationId), release].slice(-64)
      await this.save(journal, before); return path
    })
  }
}
