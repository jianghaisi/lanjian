import { randomUUID } from 'node:crypto'
import type { MarketQuery, MarketRelease } from '@lanjian/writing-plugin-contracts'
import type { DraftRef } from '../../../../contracts/writing-plugins/authoring'
import type { MarketStatus, PublishPreview } from '../../../../contracts/writing-plugins/marketplace'
import type { PluginProvenance } from '../../../../contracts/writing-plugins/contributions'
import { AppError } from '../../../core/errors/app-error'
import type { MarketAuthPort, MarketClientPort, MarketStorePort } from '../domain/marketplace'
import type { PluginAuthoringService } from './authoring-service'
import type { WritingPluginManager } from './plugin-manager'

const conflict = (): never => { throw new AppError('CONFLICT', '草稿、市场身份或版本已变化，请重新预览。', { recoverable: true }) }
const unavailable = (): never => { throw new AppError('FEATURE_UNAVAILABLE', '此发行版尚未连接插件市场。本地创建和已安装插件可以继续使用。', { recoverable: true }) }
export class PluginMarketplaceService {
  private readonly plans = new Map<string, { expires: number; preview: PublishPreview; ref: DraftRef }>()
  private readonly installations = new Map<string, { operationId: string; digest: string; expires: number }>()
  constructor(private readonly authoring: PluginAuthoringService, private readonly manager: WritingPluginManager, private readonly network: { auth: MarketAuthPort; client: MarketClientPort; store: MarketStorePort; validate(bytes: Uint8Array): Promise<{ digest: string; manifest: unknown }> } | null) {}
  private connected() { if (!this.network) return unavailable(); return this.network }
  private publisher() { const n = this.connected(); n.auth.token(); return n.auth.view().publisherId! }
  private prune() { for (const map of [this.plans, this.installations]) for (const [id, p] of map) if (p.expires <= Date.now()) map.delete(id) }
  async status(): Promise<MarketStatus> {
    if (!this.network) return { available: false, auth: { state: 'signed-out', publisherId: null }, publications: [], pending: [] }
    const auth = this.network.auth.view(), journal = await this.network.store.read(), intents = journal.intents.filter(i => i.publisherId === auth.publisherId)
    return { available: true, auth, publications: intents.flatMap(i => i.release ? [i.release] : []), pending: intents.filter(i => !i.release || ['uploading', 'validating'].includes(i.release.state)).map(i => ({ operationId: i.request.operationId, name: i.request.manifest.name, version: i.request.manifest.version })) }
  }
  async login() { await this.connected().auth.begin(); return this.status() }
  async logout() { this.connected().auth.logout(); this.plans.clear(); return this.status() }
  catalog(query: MarketQuery) { return this.connected().client.catalog(query) }
  versions(pluginId: string, query: MarketQuery) { return this.connected().client.versions(pluginId, query) }
  release(operationId: string) { return this.connected().client.publicRelease(operationId) }
  async preview(ref: DraftRef): Promise<PublishPreview> {
    const publisherId = this.publisher(); this.prune(); if (this.plans.size >= 4) conflict()
    const { built, upstream } = await this.authoring.publication(ref)
    if (this.publisher() !== publisherId) conflict()
    const planId = randomUUID(), preview: PublishPreview = { planId, publisherId, build: built.view, request: { operationId: randomUUID(), manifest: built.view.manifest, digest: built.view.digest, bytes: built.bytes.length, upstream } }
    this.plans.set(planId, { preview, ref, expires: Date.now() + 10 * 60_000 }); return preview
  }
  async publish(planId: string) {
    this.prune(); const plan = this.plans.get(planId); if (!plan) return conflict(); this.plans.delete(planId)
    const publisherId = this.publisher(); if (plan.preview.publisherId !== publisherId) conflict()
    const { built } = await this.authoring.publication(plan.ref)
    if (built.view.digest !== plan.preview.request.digest || this.publisher() !== publisherId) conflict()
    // Explicit publication freezes this local version too. A later edit cannot
    // silently build different bytes under the already-published version number.
    await this.authoring.build(plan.ref)
    await this.connected().store.intent({ publisherId, request: plan.preview.request, release: null }, built.bytes)
    return this.send(plan.preview.request.operationId)
  }
  private async intent(operation: string) {
    const publisherId = this.publisher(), intent = (await this.connected().store.read()).intents.find(i => i.request.operationId === operation && i.publisherId === publisherId)
    if (!intent) return conflict(); return intent
  }
  async publication(operation: string) { const intent = await this.intent(operation); return { request: intent.request, release: intent.release } }
  private async send(operation: string) {
    const n = this.connected(), intent = await this.intent(operation), prepared = await n.client.prepare(intent.request)
    if (this.publisher() !== intent.publisherId) conflict()
    let release = prepared.release
    if (release.state === 'uploading') release = await n.client.commit(operation, prepared.ticket, await n.store.bytes(intent.request.digest))
    await n.store.release(release); return release
  }
  async refresh(operation: string) { await this.intent(operation); const release = await this.connected().client.status(operation); await this.connected().store.release(release); return release }
  async retry(operation: string) {
    await this.intent(operation)
    try { const release = await this.refresh(operation); if (release.state !== 'uploading') return release }
    catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error }
    return this.send(operation)
  }
  async withdraw(operation: string) { await this.intent(operation); const release = await this.connected().client.withdraw(operation); await this.connected().store.release(release); return release }
  async previewDownload(selected: MarketRelease) {
    const n = this.connected(); this.prune(); if (this.installations.size >= 16) conflict()
    const release = await n.client.publicRelease(selected.operationId)
    if (release.state !== 'published' || release.digest !== selected.digest || release.manifest.id !== selected.manifest.id || release.manifest.version !== selected.manifest.version) conflict()
    const bytes = await n.client.download(release.operationId, release.digest), pkg = await n.validate(bytes)
    if (pkg.digest !== release.digest || JSON.stringify(pkg.manifest) !== JSON.stringify(release.manifest)) conflict()
    const path = await n.store.download(release, bytes), preview = await this.manager.preview(this.manager.chooseNativeFile(path))
    this.installations.set(preview.planId, { operationId: release.operationId, digest: release.digest, expires: Date.now() + 10 * 60_000 }); return preview
  }
  async beforeInstall(planId: string) {
    const plan = this.installations.get(planId); if (!plan) return
    const release = await this.connected().client.publicRelease(plan.operationId)
    if (plan.expires <= Date.now() || release.state !== 'published' || release.digest !== plan.digest) conflict()
    this.installations.delete(planId)
  }
  async provenance(id: string, digest: string): Promise<PluginProvenance> {
    const createdByMe = await this.authoring.owns(id).catch(() => false)
    if (!this.network) return { distribution: 'local', createdByMe }
    try {
      const journal = await this.network.store.read(), release = [...journal.downloads, ...journal.intents.flatMap(i => i.release ? [i.release] : [])].find(r => r.manifest.id === id && r.digest === digest && ['published', 'withdrawn'].includes(r.state))
      return { distribution: release?.distribution ?? 'local', createdByMe: createdByMe || !!release && release.publisherId === this.network.auth.view().publisherId }
    } catch { return { distribution: 'local', createdByMe } }
  }
}
