import type { LocalModelState, ModelCapability } from '../../../../contracts/models/local-model-contracts'
export type ModelManifest = {
  id: string; name: string; family: string; description: string; revision: string; quantization: string
  license: string; licenseUrl: string; runtimeId: string; capabilities: ModelCapability[]
  contextTokens: number; systemReserveTokens: number; maxOutputTokens: number; recommendedOutputTokens: number
  files: Array<{ relativePath: string; bytes: number; sha256: string; url: string }>
}
export type VerifiedModelAssets = { root: string; modelPath: string; python: string; sitePackages: string; fingerprint: string }
export type InstallationProgress = (state: LocalModelState, progress: number, message: string) => void
/** Future download/install drivers share this contract with existing-resource adoption. */
export interface ModelAssetSource {
  discover(manifest: ModelManifest): Promise<boolean>
  prepare(manifest: ModelManifest, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets>
}
export interface ModelRuntimeInstaller {
  prepare(assets: VerifiedModelAssets, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets>
}

