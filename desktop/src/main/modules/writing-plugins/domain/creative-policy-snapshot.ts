import { assertJson, codePluginLimits, contributionLimits, creativeSlots, pluginIdentity, validatePluginComposition, type CreativeSlot, type JsonObject, type PluginComposition } from '@lanjian/writing-plugin-contracts'
import { officialCreativePackagesFor } from '@lanjian/writing-plugin-package/official'
import { AppError } from '../../../core/errors/app-error'
import { creativePolicyRun, type CaptureCreativePolicy, type CreativePolicyRun } from './creative-policy'

export type CreativePolicyReference = { pluginId: string; version: string; digest: string }
/** Main-private references, never a permission ledger or an IPC authorization token. */
export type CreativePolicySnapshot = { format: 1; released: CreativePolicyReference[]; installed: CreativePolicyReference[]; composition: PluginComposition; slotParams: Partial<Record<CreativeSlot, JsonObject>> }
function invalid(cause?: unknown): never {
  throw new AppError('CONFLICT', '原创作方法快照已失效，请从当前资料重新发起任务。', { recoverable: true, cause })
}
function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) return invalid()
  return value as Record<string, unknown>
}
function references(value: unknown, max: number): CreativePolicyReference[] {
  if (!Array.isArray(value) || value.length > max) return invalid()
  const refs = value.map(raw => {
    const ref = record(raw, ['pluginId', 'version', 'digest'])
    const pluginId = pluginIdentity(ref.pluginId)
    if (typeof ref.version !== 'string' || !ref.version.trim() || ref.version.length > 64 || /[\u0000-\u001f\u007f]/u.test(ref.version)
      || typeof ref.digest !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest)) return invalid()
    return { pluginId, version: ref.version, digest: ref.digest }
  })
  if (new Set(refs.map(ref => ref.pluginId)).size !== refs.length) return invalid()
  return refs
}
export function decodeCreativePolicySnapshot(value: unknown): CreativePolicySnapshot {
  try {
    assertJson(value, contributionLimits.snapshotBytes * 2)
    const raw = record(value, ['format', 'released', 'installed', 'composition', 'slotParams'])
    if (raw.format !== 1) return invalid()
    const released = references(raw.released, 32), installed = references(raw.installed, codePluginLimits.installedPlugins)
    const composition = validatePluginComposition(raw.composition)
    if (composition.entries.some(entry => !installed.some(ref => ref.pluginId === entry.pluginId && ref.digest === entry.digest))) return invalid()
    if (!raw.slotParams || typeof raw.slotParams !== 'object' || Array.isArray(raw.slotParams)) return invalid()
    const slotParams: Partial<Record<CreativeSlot, JsonObject>> = {}
    for (const [slot, params] of Object.entries(raw.slotParams)) {
      if (!Object.hasOwn(creativeSlots, slot) || !params || typeof params !== 'object' || Array.isArray(params)) return invalid()
      assertJson(params, contributionLimits.paramsBytes)
      slotParams[slot as CreativeSlot] = structuredClone(params) as JsonObject
    }
    return { format: 1, released, installed, composition, slotParams }
  } catch (cause) { return invalid(cause) }
}
export function assertReleasedCreativePolicy(snapshot: CreativePolicySnapshot): void {
  try { officialCreativePackagesFor(snapshot.released) }
  catch (cause) { throw new AppError('CONFLICT', '原任务的发行创作方法无法核验，请重新核对方法后发起任务。', { recoverable: true, cause }) }
}
/** Default-only compatibility never grants an installed package access. */
export async function restoreCreativePolicy(capture: CaptureCreativePolicy, value: unknown): Promise<CreativePolicyRun> {
  const snapshot = decodeCreativePolicySnapshot(value)
  assertReleasedCreativePolicy(snapshot)
  if (capture.restore) return capture.restore(snapshot)
  if (snapshot.installed.length) throw new AppError('FEATURE_UNAVAILABLE', '原任务的安装创作方法无法安全恢复，请重新发起。', { recoverable: true })
  return creativePolicyRun([], snapshot.composition, snapshot.slotParams, snapshot.released)
}
