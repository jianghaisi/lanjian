import { lstat, mkdir, open, realpath, rename, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { decodeDrafts, decodePluginDraft, draftLimits, type DraftContent, type DraftRef, type PluginDraft } from '../../../../contracts/writing-plugins/authoring'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import { readBoundedFile } from './package-store'
import type { BuiltDraft, PluginDraftStorePort } from '../domain/authoring'

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'
const conflict = (): never => { throw new AppError('CONFLICT', '插件草稿或构建版本已变化，请重新载入。', { recoverable: true }) }
export class PluginDraftStore implements PluginDraftStorePort {
  private lane: Promise<unknown> = Promise.resolve()
  private readonly anchor: Promise<{ path: string; dev: number; ino: number }>
  constructor(private readonly root: string) { this.anchor = realpath(root).then(async path => { const info = await stat(path); return { path, dev: info.dev, ino: info.ino } }) }
  private async safe(...segments: string[]) {
    const anchor = await this.anchor, current = await realpath(this.root), info = await stat(current)
    if (current !== anchor.path || info.dev !== anchor.dev || info.ino !== anchor.ino) conflict()
    let path = this.root
    for (const segment of segments) {
      path = await projectDirectory(this.root, join(path, segment))
      try { if ((await lstat(path)).isSymbolicLink()) conflict() } catch (e) { if (!missing(e)) throw e }
    }
    return path
  }
  private serial<T>(operation: () => Promise<T>) { const next = this.lane.then(operation); this.lane = next.catch(() => {}); return next }
  private async read(): Promise<PluginDraft[]> {
    try { return decodeDrafts(JSON.parse((await readBoundedFile(await this.safe('plugin-drafts.json'), draftLimits.documentBytes)).toString('utf8'))) }
    catch (cause) { if (missing(cause)) return []; throw new AppError('STORAGE_ERROR', '插件草稿无法读取，原文件已保留。', { recoverable: true, cause }) }
  }
  async list() { await this.lane; return this.read() }
  create(draft: PluginDraft): Promise<PluginDraft> {
    return this.serial(async () => {
      const all = await this.read(), next = decodePluginDraft(draft)
      if (next.revision !== 1 || all.some(d => d.id === next.id || d.pluginId === next.pluginId)) conflict()
      await this.commit([...all, next], all); return next
    })
  }
  save(ref: DraftRef, content: DraftContent): Promise<PluginDraft> {
    return this.serial(async () => {
      const all = await this.read(), old = all.find(d => d.id === ref.id)
      if (!old || old.revision !== ref.revision) return conflict()
      const next = decodePluginDraft({ ...old, ...content, revision: old.revision + 1, updatedAt: new Date().toISOString() })
      await this.commit(all.map(d => d.id === next.id ? next : d), all); return next
    })
  }
  private async commit(next: PluginDraft[], old: PluginDraft[]) {
    const validated = decodeDrafts(next), path = await this.safe('plugin-drafts.json')
    await writeJson(path, validated, async () => { await this.safe('plugin-drafts.json'); if (JSON.stringify(await this.read()) !== JSON.stringify(old)) conflict() })
  }
  persist(build: { bytes: Uint8Array; view: Pick<BuiltDraft['view'], 'manifest' | 'digest'> }): Promise<string> {
    return this.serial(async () => {
      const dir = await this.safe('plugin-builds'); await mkdir(dir, { recursive: true }); await this.safe('plugin-builds')
      const name = `${build.view.manifest.id}-${build.view.manifest.version}.zip`, path = await this.safe('plugin-builds', name)
      try { await stat(path) } catch (e) {
        if (!missing(e)) throw e
        const temporary = await this.safe('plugin-builds', `.staging-${randomUUID()}.zip`)
        const file = await open(temporary, 'wx')
        try { await file.writeFile(build.bytes); await file.sync() } finally { await file.close() }
        await this.safe('plugin-builds', name); await rename(temporary, path)
      }
      const bytes = await readBoundedFile(path, 10 * 1024 * 1024)
      if (createHash('sha256').update(bytes).digest('hex') !== build.view.digest) throw new AppError('CONFLICT', '这个版本已经构建。修改后请增加版本号，旧构建已保留。', { recoverable: true })
      return path
    })
  }
}
