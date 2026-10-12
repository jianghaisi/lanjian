import { assertJson, validatePluginManifest, type PluginManifest } from '@lanjian/writing-plugin-contracts'
import { exactRecord, invalid } from '../core/validation'
import { decodeDigest, decodePluginDraft, type PluginDraft } from './authoring'
import { decodePluginInstallPreview, type PluginInstallPreview } from './management-contracts'

export type BundledPlugin = { origin: 'bundled'; manifest: PluginManifest; digest: string }
export type BundledPluginRef = { pluginId: string; digest: string }
export type BundledPluginsApi = {
  bundledPlugins(): Promise<BundledPlugin[]>
  previewBundledPlugin(ref: BundledPluginRef): Promise<PluginInstallPreview>
  deriveBundledPlugin(ref: BundledPluginRef): Promise<PluginDraft>
}
export function decodeBundledPlugins(value: unknown): BundledPlugin[] {
  assertJson(value, 1024 * 1024)
  if (!Array.isArray(value) || value.length > 32) return invalid('bundled', '本地目录格式无效')
  const entries = value.map(item => {
    const v = exactRecord(item, 'bundled', ['origin', 'manifest', 'digest'])
    if (v.origin !== 'bundled') return invalid('origin', '本地目录来源无效')
    return { origin: 'bundled' as const, manifest: validatePluginManifest(v.manifest), digest: decodeDigest(v.digest) }
  })
  if (new Set(entries.map(e => e.manifest.id)).size !== entries.length) invalid('bundled', '插件身份重复')
  return entries
}
export const bundledPluginResultDecoders = {
  'writing-plugins:bundled-list': decodeBundledPlugins,
  'writing-plugins:bundled-preview': decodePluginInstallPreview,
  'writing-plugins:bundled-derive': decodePluginDraft
}
