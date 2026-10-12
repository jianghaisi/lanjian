import type { PluginManifest } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import type { BundledPlugin, BundledPluginRef } from '../../../../contracts/writing-plugins/bundled'
import type { WritingPluginManager } from './plugin-manager'
import type { PluginAuthoringService } from './authoring-service'

export type BundledPackage = { bytes: Uint8Array; manifest: PluginManifest; digest: string; files: Map<string, Uint8Array> }
export type BundledPluginPorts = { load(): Promise<BundledPackage[]>; persist(pkg: BundledPackage): Promise<string> }
export class BundledPluginService {
  constructor(private readonly ports: BundledPluginPorts, private readonly manager: WritingPluginManager, private readonly authoring: PluginAuthoringService) {}
  async list(): Promise<BundledPlugin[]> { return (await this.ports.load()).map(p => ({ origin: 'bundled', manifest: structuredClone(p.manifest), digest: p.digest })) }
  async official(id: string, digest: string): Promise<boolean> { return (await this.ports.load()).some(p => p.manifest.id === id && p.digest === digest) }
  private async selected(ref: BundledPluginRef) {
    const pkg = (await this.ports.load()).find(p => p.manifest.id === ref.pluginId && p.digest === ref.digest)
    if (!pkg) throw new AppError('CONFLICT', '内置插件版本已变化，请重新打开本地插件库。', { recoverable: true })
    return pkg
  }
  async preview(ref: BundledPluginRef) {
    const pkg = await this.selected(ref), path = await this.ports.persist(pkg)
    return this.manager.preview(this.manager.chooseNativeFile(path))
  }
  async derive(ref: BundledPluginRef) { const pkg = await this.selected(ref); return this.authoring.derivePackage(pkg, pkg.digest) }
}
