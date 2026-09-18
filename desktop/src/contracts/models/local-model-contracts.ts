import { AppError } from '../core/app-error'
/** Public local model store DTOs. No executable, URL, credential or filesystem input. */
export const LOCAL_CONNECTION_ID = 'local:llama-cpp'
export const LOCAL_QWEN_ID = 'qwen3-1.7b-q8_0'
export const localModelStates = ['not-installed', 'detected', 'downloading', 'verifying', 'installing', 'checking', 'ready', 'failed', 'cancelled', 'interrupted'] as const
export type LocalModelState = typeof localModelStates[number]
export const modelCapabilities = ['text', 'stream', 'structured', 'tool-step', 'asr', 'tts', 'image'] as const
export type ModelCapability = typeof modelCapabilities[number]
export type LocalModelView = {
  id: string; name: string; family: string; description: string; revision: string
  bytes: number; quantization: string; license: string; state: LocalModelState
  capabilities: ModelCapability[]; contextTokens: number; maxOutputTokens: number
  recommendedOutputTokens: number; progress: number; message: string; canDownload: boolean
}
export type LocalModelsApi = {
  list(): Promise<LocalModelView[]>
  inspect(modelId: string): Promise<LocalModelView>
  cancel(modelId: string): Promise<boolean>
}
export function isLocalConnection(id?: string): boolean { return id === LOCAL_CONNECTION_ID }
export function isModelConnectionId(value: unknown): value is string {
  return typeof value === 'string' && (isLocalConnection(value) || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))
}
function invalid(): never { throw new Error('LOCAL_MODEL_CONTRACT') }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) invalid()
  return value as Record<string, unknown>
}
function string(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max) invalid(); return value }
function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid(); return Number(value) }
export function localModelId(value: unknown): string {
  const id = string(value, 100)
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) invalid()
  return id
}
export function decodeLocalModel(value: unknown): LocalModelView {
  const r = record(value, ['id','name','family','description','revision','bytes','quantization','license','state','capabilities','contextTokens','maxOutputTokens','recommendedOutputTokens','progress','message','canDownload'])
  localModelId(r.id); string(r.name,100); string(r.family,50); string(r.description,500); string(r.revision,100)
  integer(r.bytes,1,Number.MAX_SAFE_INTEGER); string(r.quantization,30); string(r.license,100)
  if (!localModelStates.includes(r.state as LocalModelState) || typeof r.canDownload !== 'boolean') invalid()
  if (!Array.isArray(r.capabilities) || r.capabilities.length > 7 || r.capabilities.some(c => !modelCapabilities.includes(c))) invalid()
  integer(r.contextTokens,128,1_048_576); integer(r.maxOutputTokens,128,128_000); integer(r.recommendedOutputTokens,128,128_000)
  integer(r.progress,0,100); string(r.message,500)
  return value as LocalModelView
}
export function decodeLocalModels(value: unknown): LocalModelView[] {
  if (!Array.isArray(value) || value.length > 100) invalid()
  return value.map(decodeLocalModel)
}
export const localModelResultDecoders = {
  'local-models:list': decodeLocalModels,
  'local-models:inspect': decodeLocalModel,
  'local-models:cancel': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value }
}


export function localOutputOverride(value: unknown, connectionId: unknown): {maxTokensOverride?: number} {
  if (value === undefined) return {}
  if (connectionId !== LOCAL_CONNECTION_ID || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 128 || value > 4096) throw new AppError('VALIDATION_ERROR', '本次本地输出预算应为 128 到 4096 tokens。', {recoverable: true})
  return {maxTokensOverride: value}
}
