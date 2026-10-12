import type { LocalModelState, ModelCapability, LocalSamplingDefaults } from '../../../../contracts/models/local-model-contracts'
export const localPromptProfiles = ['qwen3', 'chatml', 'phi3', 'mistral-instruct', 'glm4', 'deepseek-r1'] as const
export type LocalPromptProfile = typeof localPromptProfiles[number]
export type ModelManifest = {
  id: string; name: string; family: string; description: string; revision: string; quantization: string
  license: string; licenseUrl: string; runtimeId: string; capabilities: ModelCapability[]
  contextTokens: number; systemReserveTokens: number; maxOutputTokens: number; recommendedOutputTokens: number
  samplingDefaults?: LocalSamplingDefaults
  promptProfile?: LocalPromptProfile
  publisher?: string; publisherKind?: 'official' | 'community'; developmentStatus?: 'tested' | 'unverified'
  files: Array<{ relativePath: string; bytes: number; sha256: string; url: string }>
}
export type VerifiedModelFiles = { modelPath: string; fingerprint: string }
export type VerifiedRuntime = { root: string; python: string; sitePackages: string }
export type VerifiedModelAssets = VerifiedModelFiles & VerifiedRuntime & { promptProfile?: LocalPromptProfile }
export type InstallationProgress = (state: LocalModelState, progress: number, message: string, transfer?: { receivedBytes: number; totalBytes: number }) => void
/** Future download/install drivers share this contract with existing-resource adoption. */
export interface ModelAssetSource {
  discover(manifest: ModelManifest): Promise<boolean>
  prepare(manifest: ModelManifest, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets>
  installationInfo?(manifest: ModelManifest): Promise<{ canDownload: boolean; downloadBytes: number; requiredDiskBytes: number }>
  install?(manifest: ModelManifest, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets>
}
export interface ModelRuntimeInstaller {
  prepare(assets: VerifiedModelAssets, signal: AbortSignal, progress: InstallationProgress): Promise<VerifiedModelAssets>
}

