import type { DraftBuild, DraftContent, DraftRef, PluginDraft } from '../../../../contracts/writing-plugins/authoring'
import type { PluginManifest } from '@lanjian/writing-plugin-contracts'

export interface PluginDraftStorePort {
  list(): Promise<PluginDraft[]>
  create(draft: PluginDraft): Promise<PluginDraft>
  save(ref: DraftRef, content: DraftContent): Promise<PluginDraft>
}
export type BuiltDraft = { view: DraftBuild; bytes: Uint8Array }
export type DraftPackageSource = { manifest: PluginManifest; files: Map<string, Uint8Array> }
export type PluginExportDestination = {
  fileName: string
  write(bytes: Uint8Array, beforeCommit: () => Promise<void>): Promise<void>
}
export interface PluginAuthoringPorts {
  build(draft: PluginDraft): Promise<BuiltDraft>
  persist(build: BuiltDraft): Promise<string>
  chooseSource(): Promise<string | null>
  choosePackage(): Promise<(DraftPackageSource & { digest: string }) | null>
  chooseExport(build: DraftBuild): Promise<PluginExportDestination | null>
  installed(pluginId: string, digest: string): Promise<DraftPackageSource>
}
