import { createHash } from 'node:crypto'
import { readPluginPackage } from '@lanjian/writing-plugin-package'
import { marketLimits, pluginSdkCapabilities, type MarketRelease } from '@lanjian/writing-plugin-contracts'
import { CatalogStore } from '../adapters/catalog-store.ts'
import { PackageStore } from '../adapters/package-store.ts'
import { deny } from '../domain/releases.ts'

export class PublishService {
  private active = 0
  constructor(readonly catalog: CatalogStore, private readonly packages: PackageStore) {}
  private async validate(bytes: Uint8Array, release: MarketRelease) {
    if (bytes.length !== release.bytes || createHash('sha256').update(bytes).digest('hex') !== release.digest) throw new Error('Digest mismatch')
    const pkg = await readPluginPackage(bytes), declared = ['lanjian-plugin.json', pkg.manifest.entry, ...pkg.manifest.assets ?? []]
    if (pkg.manifest.capabilities.some(cap => !pluginSdkCapabilities.includes(cap as typeof pluginSdkCapabilities[number]))) throw new Error('Unsupported capability')
    if (JSON.stringify(pkg.manifest) !== JSON.stringify(release.manifest) || pkg.files.size !== declared.length || declared.some(p => !pkg.files.has(p))) throw new Error('Declaration mismatch')
  }
  async commit(operation: string, owner: string, ticket: string, bytes: Uint8Array) {
    const release = this.catalog.checkTicket(operation, owner, ticket)
    if (release.state !== 'uploading') return release
    if (this.active >= marketLimits.validationConcurrency) return deny(429, 'validation-busy')
    this.active++; this.catalog.transition(operation, 'uploading', 'validating')
    try {
      await this.validate(bytes, release); await this.packages.put(bytes, release.digest)
      return this.catalog.transition(operation, 'validating', 'published')
    } catch { return this.catalog.transition(operation, 'validating', 'validation-failed', 'invalid-package') }
    finally { this.active-- }
  }
  async reconcile() {
    for (const release of this.catalog.pending()) {
      try {
        if (release.state !== 'validating') throw new Error('Expired upload')
        await this.validate(await this.packages.read(release.digest), release)
        this.catalog.transition(release.operationId, 'validating', 'published')
      } catch { this.catalog.transition(release.operationId, release.state, 'validation-failed', 'interrupted') }
    }
  }
  async download(operation: string, digest: string) {
    const release = this.catalog.get(operation)
    if (release.state !== 'published' || release.digest !== digest) return deny(404, 'release-unavailable')
    const bytes = await this.packages.read(digest)
    if (this.catalog.get(operation).state !== 'published') return deny(404, 'release-unavailable')
    return bytes
  }
}
