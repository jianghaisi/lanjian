import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PluginBookInput, PluginManagementView } from '../../../../contracts/writing-plugins/management-contracts'
import type { WritingPluginManager } from './plugin-manager'
import { PluginCompositionService } from './composition-service'
import type { CompositionInput, LibraryCompositionInput, PluginProvenance } from '../../../../contracts/writing-plugins/contributions'

export type PluginManagementPorts = {
  currentBook(): Promise<{ id: string; title: string } | null>
  chooseZip(): Promise<string | null>
  /** Verified host records only. A manifest's self-description is never identity evidence. */
  provenance?(pluginId: string, digest: string): Promise<PluginProvenance>
  beforeInstall?(planId: string): Promise<void>
}
export class PluginManagement {
  private book: { token: string; id: string; expires: number } | null = null
  private library: { token: string; expires: number } | null = null
  private readonly compositions: PluginCompositionService
  constructor(readonly manager: WritingPluginManager, private readonly ports: PluginManagementPorts) { this.compositions = new PluginCompositionService(manager) }
  async list(withBook: boolean): Promise<PluginManagementView> {
    const [index, current] = await Promise.all([this.manager.list(), withBook ? this.ports.currentBook() : null])
    this.book = current ? { token: randomUUID(), id: current.id, expires: Date.now() + 10 * 60_000 } : null
    this.library = { token: randomUUID(), expires: Date.now() + 10 * 60_000 }
    const selected = index.books.find(b => b.id === current?.id)?.plugins ?? []
    return {
      revision: index.revision, book: current && this.book ? { token: this.book.token, title: current.title } : null,
      library: { token: this.library.token, composition: structuredClone(index.library ?? { revision: 0, entries: [] }) },
      composition: current ? structuredClone(index.books.find(b => b.id === current.id)?.composition ?? { revision: 0, entries: [] }) : null,
      plugins: await Promise.all(index.plugins.map(async p => ({ id: p.id, current: p.current, enabled: p.enabled, bookEnabled: selected.includes(p.id), provenance: await this.ports.provenance?.(p.id, p.current) ?? { distribution: 'local' as const, createdByMe: false }, versions: p.versions.map(v => ({ digest: v.digest, manifest: v.manifest, grants: v.grants, installedAt: v.installedAt })) })))
    }
  }
  async choosePackage(): Promise<string | null> { const path = await this.ports.chooseZip(); return path ? this.manager.chooseNativeFile(path) : null }
  async setBookEnabled(input: PluginBookInput): Promise<void> {
    const { book, check } = this.bookScope(input.bookToken)
    await check()
    await this.manager.setBookEnabled(book!.id, input.id, input.enabled, input.revision, check)
  }
  async previewComposition(input: CompositionInput) {
    const { book, check } = this.bookScope(input.bookToken)
    await check()
    return this.compositions.preview(book!.id, input.entries, input.revision, check)
  }
  async previewLibraryComposition(input: LibraryCompositionInput) {
    const library = this.library
    const check = async () => {
      if (!library || this.library !== library || library.token !== input.libraryToken || library.expires <= Date.now())
        throw new AppError('CONFLICT', '知识库方法页面已变化，请刷新后重新选择。', { recoverable: true })
    }
    await check()
    return this.compositions.previewLibrary(input.entries, input.revision, check)
  }
  applyComposition(planId: string): Promise<void> { return this.compositions.apply(planId) }
  private bookScope(token: string) {
    const book = this.book
    const check = async () => {
      if (!book || this.book !== book || book.token !== token || book.expires <= Date.now() || (await this.ports.currentBook())?.id !== book.id)
        throw new AppError('CONFLICT', '作品或插件页面已变化，请刷新后重新选择。', { recoverable: true })
    }
    return { book, check }
  }
}
