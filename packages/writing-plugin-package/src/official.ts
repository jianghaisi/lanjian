import { validateCreativeAssets, validatePluginManifest, type CreativePackage } from '@lanjian/writing-plugin-contracts'
import { officialCatalogData, officialReleaseCatalogData, officialReleaseSetsData } from './official-catalog.generated.ts'

export type OfficialCreativeReference = { pluginId: string; version: string; digest: string }
type ReleaseSource = { manifest: unknown; files: Readonly<Record<string, string>>; digest: string }
const invalid = (): never => { throw new Error('Unknown official creative release') }
function reference(value: unknown): OfficialCreativeReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || Object.keys(value).some(key => !['pluginId', 'version', 'digest'].includes(key))) return invalid()
  const ref = value as Record<string, unknown>
  if (typeof ref.pluginId !== 'string' || ref.pluginId.length > 100 || typeof ref.version !== 'string' || !ref.version.length || ref.version.length > 64 || typeof ref.digest !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest)) return invalid()
  return { pluginId: ref.pluginId, version: ref.version, digest: ref.digest }
}
function materialize(source: ReleaseSource): CreativePackage {
  const manifest = validatePluginManifest(structuredClone(source.manifest))
  const files = new Map(Object.entries(source.files))
  validateCreativeAssets(manifest, files)
  return { manifest, digest: source.digest, files }
}

/** Pure release data usable by desktop and hosted composition, never a file API. */
export function officialCreativePackages(): CreativePackage[] {
  return officialCatalogData.map(materialize)
}

/** Exact immutable release data; this never loads or grants an installed package. */
export function officialCreativePackageFor(value: OfficialCreativeReference): CreativePackage {
  const ref = reference(value)
  const source = officialReleaseCatalogData.find(pkg => pkg.manifest.id === ref.pluginId && pkg.manifest.version === ref.version && pkg.digest === ref.digest)
  return source ? materialize(source) : invalid()
}
/** A complete historically shipped set, not an arbitrary mixture of known versions. */
export function officialCreativePackagesFor(values: readonly OfficialCreativeReference[]): CreativePackage[] {
  if (!Array.isArray(values) || !values.length || values.length > 32) return invalid()
  const refs = values.map(reference)
  if (new Set(refs.map(ref => ref.pluginId)).size !== refs.length || !officialReleaseSetsData.some(set => set.length === refs.length && set.every(actual => refs.some(ref => actual.pluginId === ref.pluginId && actual.version === ref.version && actual.digest === ref.digest)))) return invalid()
  return refs.map(officialCreativePackageFor)
}
