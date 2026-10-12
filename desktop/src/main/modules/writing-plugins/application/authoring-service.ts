import { randomUUID } from 'node:crypto'
import { validatePluginManifest } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import { decodeDraftContent, decodeDraftExport, decodeDraftRef, type DraftExport, type DraftExportResult, type DraftRef, type DraftSave, type DraftTemplate, type PluginDraft } from '../../../../contracts/writing-plugins/authoring'
import type { PluginAuthoringPorts, PluginDraftStorePort } from '../domain/authoring'
import { pluginDraftTemplate } from '../domain/draft-templates'
import type { WritingPluginManager } from './plugin-manager'

export class PluginAuthoringService {
  constructor(private readonly store: PluginDraftStorePort, private readonly ports: PluginAuthoringPorts, private readonly manager: WritingPluginManager) {}
  list() { return this.store.list() }
  async owns(pluginId: string) { return (await this.store.list()).some(d => d.pluginId === pluginId) }
  create(template: DraftTemplate) {
    const id = randomUUID(), pluginId = `personal.${id}`
    return this.store.create({ id, pluginId, revision: 1, updatedAt: new Date().toISOString(), upstream: null, ...pluginDraftTemplate(pluginId, template) })
  }
  save(input: DraftSave) { return this.store.save(decodeDraftRef({ id: input.id, revision: input.revision }), decodeDraftContent({ manifestText: input.manifestText, files: input.files })) }
  private async snapshot(input: DraftRef): Promise<PluginDraft> {
    const ref = decodeDraftRef(input), draft = (await this.store.list()).find(d => d.id === ref.id)
    if (!draft || draft.revision !== ref.revision) throw new AppError('CONFLICT', '草稿已变化，请保存或重新载入后操作。', { recoverable: true })
    return draft
  }
  async validate(ref: DraftRef) { return (await this.ports.build(await this.snapshot(ref))).view }
  async publication(ref: DraftRef) {
    const draft = await this.snapshot(ref), built = await this.ports.build(draft)
    await this.snapshot(ref)
    return { built, upstream: draft.upstream }
  }
  async build(ref: DraftRef) {
    const built = await this.ports.build(await this.snapshot(ref)); await this.snapshot(ref)
    await this.ports.persist(built); return built.view
  }
  async export(input: DraftExport, assertActive: () => Promise<void> = async () => {}): Promise<DraftExportResult | null> {
    const request = decodeDraftExport(input), ref = { id: request.id, revision: request.revision }
    const built = await this.ports.build(await this.snapshot(ref))
    if (built.view.digest !== request.digest) throw new AppError('CONFLICT', '插件内容与导出预览不一致，请重新核对。', { recoverable: true })
    await this.snapshot(ref)
    const destination = await this.ports.chooseExport(built.view)
    if (!destination) return null
    await assertActive()
    await this.snapshot(ref)
    // Freeze only after native selection; cancelling a preview does not claim a version.
    await this.ports.persist(built)
    await destination.write(built.bytes, async () => { await assertActive(); await this.snapshot(ref) })
    return { draftId: ref.id, revision: ref.revision, digest: built.view.digest, fileName: destination.fileName }
  }
  async preview(ref: DraftRef) {
    const built = await this.ports.build(await this.snapshot(ref)); await this.snapshot(ref)
    const path = await this.ports.persist(built)
    return this.manager.preview(this.manager.chooseNativeFile(path))
  }
  async importSource(ref: DraftRef) {
    const draft = await this.snapshot(ref), source = await this.ports.chooseSource()
    if (source === null) return null
    const manifest = validatePluginManifest(JSON.parse(draft.manifestText))
    if (manifest.runtime !== 'quickjs-js') throw new AppError('VALIDATION_ERROR', '导入 JavaScript 需要代码插件模板。', { recoverable: true })
    return this.store.save(ref, { manifestText: draft.manifestText, files: [...draft.files.filter(f => f.path !== manifest.entry), { path: manifest.entry, content: source }] })
  }
  async derive(pluginId: string, digest: string) {
    return this.derivePackage(await this.ports.installed(pluginId, digest), digest)
  }
  async importPackage(assertActive: () => Promise<void> = async () => {}) {
    const source = await this.ports.choosePackage()
    if (!source) return null
    await assertActive()
    const declared = ['lanjian-plugin.json', source.manifest.entry, ...source.manifest.assets ?? []]
    if (source.files.size !== declared.length || declared.some(path => !source.files.has(path))) {
      throw new AppError('VALIDATION_ERROR', '插件包包含未声明或缺失的文件，无法完整复制。请检查插件清单。', { recoverable: true })
    }
    return this.derivePackage(source, source.digest)
  }
  async derivePackage(source: Awaited<ReturnType<PluginAuthoringPorts['installed']>>, digest: string) {
    const pluginId = source.manifest.id, id = randomUUID(), newId = `personal.${id}`
    const manifest = { ...source.manifest, id: newId, version: '1.0.0', name: `${source.manifest.name.slice(0, 80)}（派生）` }
    // Same-package dependencies follow the copied identity; external references stay pinned.
    if (manifest.contributions) manifest.contributions = manifest.contributions.map(contribution => contribution.requires ? {
      ...contribution,
      requires: contribution.requires.map(dependency => dependency.pluginId === pluginId ? { ...dependency, pluginId: newId } : dependency)
    } : contribution)
    const decode = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    const files = [manifest.entry, ...manifest.assets ?? []].map(path => {
      const bytes = source.files.get(path)
      if (!bytes) throw new AppError('VALIDATION_ERROR', '插件包缺少声明的文件，无法复制。', { recoverable: true })
      return { path, content: decode.decode(bytes) }
    })
    let content
    try { content = decodeDraftContent({ manifestText: JSON.stringify(manifest, null, 2), files }) }
    catch (cause) { throw new AppError('VALIDATION_ERROR', '插件内容超过可编辑草稿的限制，无法完整复制。原插件包已保留，可通过“安装插件包”使用。', { recoverable: true, cause }) }
    return this.store.create({ id, pluginId: newId, revision: 1, updatedAt: new Date().toISOString(), upstream: { pluginId, version: source.manifest.version, digest }, ...content })
  }
}
