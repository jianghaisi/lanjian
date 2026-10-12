import { assertJson, contributionLimits, resolveCreativePolicy, resolveCreativeTeam, validatePluginComposition, type CreativePackage, type CreativeSlot, type PluginComposition, type PolicySource, type JsonObject, type CreativeTeamSource } from '@lanjian/writing-plugin-contracts'
import { officialCreativePackages, officialCreativePackagesFor } from '@lanjian/writing-plugin-package/official'
import { AppError } from '../../../core/errors/app-error'
import type { CreativePolicyReference, CreativePolicySnapshot } from './creative-policy-snapshot'

export type CreativePolicyRun = { resolve(slot: CreativeSlot, defaultParams?: JsonObject): PolicySource[]; team?: () => CreativeTeamSource; assertAuthorized?: () => Promise<void>; snapshot?: () => CreativePolicySnapshot; withContext?: <T>(operation: () => Promise<T>) => Promise<T> }
export type CaptureCreativePolicy = { (): Promise<CreativePolicyRun>; restore?: (snapshot: CreativePolicySnapshot) => Promise<CreativePolicyRun> }
/** Current grants may change while methods remain frozen; late output cannot confer authority. */
export async function withCreativePolicy<T>(policy: CreativePolicyRun, operation: () => Promise<T>): Promise<T> {
  await policy.assertAuthorized?.()
  const result = await operation()
  await policy.assertAuthorized?.()
  return result
}
export function creativePolicyRun(installed: readonly CreativePackage[] = [], composition: PluginComposition = { revision: 0, entries: [] }, slotParams: CreativePolicySnapshot['slotParams'] = {}, released?: readonly CreativePolicyReference[]): CreativePolicyRun {
  let defaults: CreativePackage[]
  try { defaults = released ? officialCreativePackagesFor(released) : officialCreativePackages() }
  catch (cause) { throw new AppError('CONFLICT', '原任务的发行创作方法无法核验，请重新核对。', { recoverable: true, cause }) }
  const packages = installed.map(p => ({ manifest: structuredClone(p.manifest), digest: p.digest, files: new Map(p.files) }))
  const selection = validatePluginComposition(composition)
  const reference = (p: CreativePackage) => ({ pluginId: p.manifest.id, version: p.manifest.version, digest: p.digest })
  const snapshot: CreativePolicySnapshot = { format: 1, released: defaults.map(reference), installed: packages.map(reference), composition: selection, slotParams: structuredClone(slotParams) }
  return { snapshot: () => structuredClone(snapshot), team() {
    try { return resolveCreativeTeam(defaults, packages, selection) }
    catch (cause) { throw new AppError('FEATURE_UNAVAILABLE', '本次创作团队缺失、损坏或存在冲突，请在写作插件中核对。', { recoverable: true, cause }) }
  }, resolve(slot, defaultParams) {
    try {
      const params = Object.hasOwn(snapshot.slotParams, slot) ? snapshot.slotParams[slot]! : defaultParams ?? {}
      assertJson(params, contributionLimits.paramsBytes)
      const frozen = structuredClone(params), sources = resolveCreativePolicy(defaults, packages, selection, slot, frozen)
      snapshot.slotParams[slot] = frozen
      return sources
    }
    catch (cause) { throw new AppError('FEATURE_UNAVAILABLE', '本次创作方法缺失、已停用或存在冲突，请在写作插件中核对后再生成。', { recoverable: true, cause }) }
  } }
}
