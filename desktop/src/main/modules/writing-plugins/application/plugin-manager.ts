import { randomUUID } from 'node:crypto'
import { codePluginLimits, type CompositionEntry, type PluginComposition } from '@lanjian/writing-plugin-contracts'
import { inspectComposition, inspectLibraryComposition } from '../domain/composition'
import { AppError } from '../../../core/errors/app-error'
import type { InstalledVersion, PluginIndex, PluginPackageStorePort } from '../domain/installed'

import type { PluginInstallPreview } from '../../../../contracts/writing-plugins/management-contracts'
export type { PluginInstallPreview } from '../../../../contracts/writing-plugins/management-contracts'
type Plan = { path: string; digest: string; revision: number; expires: number }
const conflict = (): never => { throw new AppError('CONFLICT', '插件状态或安装计划已变化，请刷新并重新确认。', { recoverable: true }) }

/** UI confirmation names a bounded opaque plan. No install path is accepted from
 * a renderer or a guest. All mutating operations share this application lane. */
export class WritingPluginManager {
  private readonly choices = new Map<string, { path: string; expires: number }>()
  private readonly plans = new Map<string, Plan>()
  private lane: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: PluginPackageStorePort, private readonly revoke: (pluginId: string, bookId?: string) => Promise<void>) {}
  private serial<T>(action: () => Promise<T>): Promise<T> { const next = this.lane.then(action, action); this.lane = next.catch(() => {}); return next }
  private expire(): void {
    for (const map of [this.choices, this.plans]) for (const [id, record] of map) if (record.expires <= Date.now()) map.delete(id)
  }
  /** Main native picker only. Selection grants preview, not installation. */
  chooseNativeFile(path: string): string {
    this.expire()
    if (this.choices.size >= codePluginLimits.installationPlans) conflict()
    const token = randomUUID(); this.choices.set(token, { path, expires: Date.now() + codePluginLimits.installationPlanMs }); return token
  }
  async preview(token: string): Promise<PluginInstallPreview> {
    this.expire(); const chosen = this.choices.get(token)
    if (!chosen || this.plans.size >= codePluginLimits.installationPlans) return conflict()
    this.choices.delete(token)
    const pkg = await this.store.readZip(chosen.path), index = await this.store.read(), existing = index.plugins.find(p => p.id === pkg.manifest.id)
    if (existing?.versions.some(v => v.manifest.version === pkg.manifest.version && v.digest !== pkg.digest)) conflict()
    const current = existing?.versions.find(v => v.digest === existing.current), planId = randomUUID()
    this.plans.set(planId, { path: chosen.path, digest: pkg.digest, revision: index.revision, expires: Date.now() + codePluginLimits.installationPlanMs })
    return { planId, manifest: pkg.manifest, digest: pkg.digest, unpackedBytes: pkg.unpackedBytes, fileCount: pkg.files.size, addedCapabilities: pkg.manifest.capabilities.filter(c => !current?.grants.includes(c)), existingVersion: current?.manifest.version ?? null }
  }
  install(planId: string): Promise<PluginIndex> {
    return this.serial(async () => {
      this.expire(); const plan = this.plans.get(planId)
      if (!plan) return conflict()
      this.plans.delete(planId)
      const index = await this.store.read()
      if (index.revision !== plan.revision) conflict()
      const pkg = await this.store.readZip(plan.path)
      if (pkg.digest !== plan.digest) conflict()
      const plugin = index.plugins.find(p => p.id === pkg.manifest.id)
      if (plugin?.versions.some(v => v.digest === pkg.digest)) return index
      if (plugin?.versions.some(v => v.manifest.version === pkg.manifest.version) || plugin && plugin.versions.length >= codePluginLimits.installedVersions || !plugin && index.plugins.length >= codePluginLimits.installedPlugins) conflict()
      const version = await this.store.publish(pkg)
      if (plugin) plugin.versions.push(version)
      else index.plugins.push({ id: version.manifest.id, current: version.digest, enabled: false, versions: [version] })
      return this.save(index)
    })
  }
  // Reads must remain available while revocation waits for active invocations to
  // exit; their late RPC checks need to observe the already-persisted revocation.
  list(): Promise<PluginIndex> { return this.store.read() }
  private async save(index: PluginIndex): Promise<PluginIndex> { const previous = index.revision++; await this.store.write(index, previous); return index }
  setEnabled(id: string, enabled: boolean, grants: string[], revision: number): Promise<PluginIndex> {
    return this.serial(async () => {
      const index = await this.store.read(), plugin = index.plugins.find(p => p.id === id)
      if (!plugin || index.revision !== revision) return conflict()
      const version = plugin.versions.find(v => v.digest === plugin.current)!
      if (grants.length > 16 || new Set(grants).size !== grants.length || grants.some(c => !version.manifest.capabilities.includes(c))) conflict()
      if (enabled) await this.store.load(version)
      // Persist revocation before signalling cancellation, so late RPC fails authorization.
      const revoked = !enabled || version.grants.some(c => !grants.includes(c))
      plugin.enabled = enabled; version.grants = [...grants]
      await this.save(index); if (revoked) await this.revoke(id)
      return index
    })
  }
  setBookEnabled(bookId: string, id: string, enabled: boolean, revision: number, assertScope: () => Promise<void> = async () => {}): Promise<PluginIndex> {
    return this.serial(async () => {
      const index = await this.store.read(), plugin = index.plugins.find(p => p.id === id)
      if (!plugin || index.revision !== revision || enabled && !plugin.enabled) return conflict()
      await assertScope()
      let book = index.books.find(b => b.id === bookId)
      if (!book) { book = { id: bookId, plugins: [] }; index.books.push(book) }
      book.plugins = [...book.plugins.filter(p => p !== id), ...(enabled ? [id] : [])]
      await this.save(index); if (!enabled) await this.revoke(id, bookId)
      return index
    })
  }
  selectVersion(id: string, digest: string, grants: string[], revision: number): Promise<PluginIndex> {
    return this.serial(async () => {
      const index = await this.store.read(), plugin = index.plugins.find(p => p.id === id), version = plugin?.versions.find(v => v.digest === digest)
      if (!plugin || !version || index.revision !== revision || grants.length > 16 || new Set(grants).size !== grants.length || grants.some(c => !version.manifest.capabilities.includes(c))) return conflict()
      await this.store.load(version)
      // Previous versions and their grants remain available to pinned invocations.
      const revoked = version.grants.some(c => !grants.includes(c))
      plugin.current = digest; version.grants = [...grants]
      await this.save(index); if (revoked) await this.revoke(id)
      return index
    })
  }
  async capture(bookId: string): Promise<InstalledVersion[]> {
    return (await this.captureComposition(bookId)).versions
  }
  async captureComposition(bookId: string) {
    const index = await this.list(), book = index.books.find(b => b.id === bookId)
    const composition = structuredClone(book?.composition ?? { revision: 0, entries: [] })
    const inspected = inspectComposition(index, bookId, composition.entries)
    if (inspected.conflicts.length) conflict()
    const versions = index.plugins.filter(p => p.enabled && book?.plugins.includes(p.id)).map(p => {
      const entry = composition.entries.find(e => e.pluginId === p.id)
      return p.versions.find(v => v.digest === (entry?.digest ?? p.current))!
    })
    // Direct planning/writing context capture must verify package bytes too, even
    // when no guest tool is registered for this run.
    for (const version of versions) {
      const current = await this.loadAuthorized(bookId, version.manifest.id, version.digest)
      if (version.grants.some(cap => !current.version.grants.includes(cap))) conflict()
    }
    return { composition, versions, resolved: inspected.resolved }
  }
  applyComposition(bookId: string, entries: CompositionEntry[], revision: number, assertScope: () => Promise<void>): Promise<PluginComposition> {
    return this.serial(async () => {
      const index = await this.store.read()
      if (index.revision !== revision) return conflict()
      const inspected = inspectComposition(index, bookId, entries)
      if (inspected.conflicts.length) return conflict()
      for (const { version } of inspected.resolved) await this.store.load(version)
      await assertScope()
      let book = index.books.find(b => b.id === bookId)
      if (!book) { book = { id: bookId, plugins: [] }; index.books.push(book) }
      book.composition = { revision: (book.composition?.revision ?? 0) + 1, entries: inspected.entries }
      await this.save(index)
      return structuredClone(book.composition)
    })
  }
  async captureLibraryComposition() {
    const index = await this.list(), composition = structuredClone(index.library ?? { revision: 0, entries: [] })
    const inspected = inspectLibraryComposition(index, composition.entries)
    if (inspected.conflicts.length) conflict()
    const versions = [...new Map(inspected.resolved.map(r => [`${r.version.manifest.id}/${r.version.digest}`, r.version])).values()]
    for (const version of versions) await this.loadLibraryAuthorized(version.manifest.id, version.digest)
    return { composition, versions, resolved: inspected.resolved }
  }
  applyLibraryComposition(entries: CompositionEntry[], revision: number, assertScope: () => Promise<void>): Promise<PluginComposition> {
    return this.serial(async () => {
      const index = await this.store.read()
      if (index.revision !== revision) return conflict()
      const inspected = inspectLibraryComposition(index, entries)
      if (inspected.conflicts.length) return conflict()
      for (const { version } of inspected.resolved) await this.store.load(version)
      await assertScope()
      index.library = { revision: (index.library?.revision ?? 0) + 1, entries: inspected.entries }
      await this.save(index)
      return structuredClone(index.library)
    })
  }
  private async authorizeLibrary(id: string, digest: string): Promise<InstalledVersion> {
    const index = await this.list(), plugin = index.plugins.find(p => p.id === id), version = plugin?.versions.find(v => v.digest === digest)
    if (!plugin?.enabled || !version) return conflict()
    // Current selection affects new jobs; original private snapshots retain their
    // selected versions until the installation itself is disabled or removed.
    return version
  }
  loadLibraryAuthorized(id: string, digest: string) { return this.loadChecked(id, () => this.authorizeLibrary(id, digest)) }
  async authorize(bookId: string, id: string, digest: string, capability?: string): Promise<InstalledVersion> {
    const index = await this.list(), plugin = index.plugins.find(p => p.id === id), version = plugin?.versions.find(v => v.digest === digest)
    if (!plugin?.enabled || !version || !index.books.some(b => b.id === bookId && b.plugins.includes(id)) || capability && !version.grants.includes(capability)) return conflict()
    return version
  }
  async loadAuthorized(bookId: string, id: string, digest: string): Promise<{ version: InstalledVersion; files: Map<string, Uint8Array> }> {
    return this.loadChecked(id, () => this.authorize(bookId, id, digest))
  }
  private async loadChecked(id: string, authorize: () => Promise<InstalledVersion>): Promise<{ version: InstalledVersion; files: Map<string, Uint8Array> }> {
    const version = await authorize()
    let files: Map<string, Uint8Array>
    try { files = await this.store.load(version) }
    catch (cause) {
      await this.serial(async () => {
        const index = await this.store.read(), plugin = index.plugins.find(p => p.id === id)
        if (plugin?.enabled) { plugin.enabled = false; await this.save(index); await this.revoke(id) }
      })
      throw cause
    }
    // Grant withdrawal during byte validation is scoped, not package corruption.
    const current = await authorize()
    return { version: current, files }
  }
  uninstall(id: string, revision: number): Promise<PluginIndex> {
    return this.serial(async () => {
      const index = await this.store.read(), plugin = index.plugins.find(p => p.id === id)
      if (!plugin || index.revision !== revision) return conflict()
      // Failure during cleanup leaves a disabled indexed package, available for retry.
      plugin.enabled = false; await this.save(index); await this.revoke(id)
      for (const version of plugin.versions) await this.store.remove(version)
      index.plugins = index.plugins.filter(p => p.id !== id)
      for (const book of index.books) book.plugins = book.plugins.filter(p => p !== id)
      return this.save(index)
    })
  }
}
