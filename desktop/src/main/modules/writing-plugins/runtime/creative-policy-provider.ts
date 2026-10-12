import type { CreativePackage, PluginComposition } from '@lanjian/writing-plugin-contracts'
import type { InstalledVersion } from '../domain/installed'
import { creativePolicyRun, type CaptureCreativePolicy } from '../domain/creative-policy'
import { currentContributionSnapshot, withContributionSnapshot } from './contribution-context'
import { assertReleasedCreativePolicy, decodeCreativePolicySnapshot, type CreativePolicyReference } from '../domain/creative-policy-snapshot'
import { AppError } from '../../../core/errors/app-error'
import { currentCreativePolicyRun } from '../application/creative-policy-execution'

export function createCreativePolicyProvider(
  capture: () => Promise<{ versions: InstalledVersion[]; composition: PluginComposition }>,
  load: (version: InstalledVersion) => Promise<Map<string, Uint8Array>>,
  restoreReference?: (reference: CreativePolicyReference) => Promise<{ version: InstalledVersion; files: Map<string, Uint8Array> }>,
  options: { inheritContext?: boolean } = {}
): CaptureCreativePolicy {
  const materialize = (version: InstalledVersion, files: Map<string, Uint8Array>): CreativePackage => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return { manifest: version.manifest, digest: version.digest, files: new Map((version.manifest.assets ?? []).map(path => {
      const bytes = files.get(path)
      if (!bytes) throw new AppError('CONFLICT', '原创作方法资产缺失，请核对安装版本。', { recoverable: true })
      return [path, decoder.decode(bytes)]
    })) }
  }
  const provider: CaptureCreativePolicy = async () => {
    const retained = options.inheritContext === false ? undefined : currentCreativePolicyRun()
    if (retained) { await retained.assertAuthorized?.(); return retained }
    const snapshot = (options.inheritContext === false ? undefined : currentContributionSnapshot()) ?? await capture()
    const versions = structuredClone(snapshot.versions), composition = structuredClone(snapshot.composition)
    const packages: CreativePackage[] = await Promise.all(versions.map(async version => {
      return materialize(version, await load(version))
    }))
    return { ...creativePolicyRun(packages, composition), withContext: operation => withContributionSnapshot({ versions, composition }, operation), assertAuthorized: async () => { await Promise.all(versions.map(version => load(version))) } }
  }
  provider.restore = async value => {
    const snapshot = decodeCreativePolicySnapshot(value)
    assertReleasedCreativePolicy(snapshot)
    if (snapshot.installed.length && !restoreReference) throw new AppError('FEATURE_UNAVAILABLE', '原安装创作方法无法安全恢复，请重新发起任务。', { recoverable: true })
    const loaded = await Promise.all(snapshot.installed.map(async ref => {
      const original = await restoreReference!(ref)
      if (original.version.manifest.id !== ref.pluginId || original.version.manifest.version !== ref.version || original.version.digest !== ref.digest) {
        throw new AppError('CONFLICT', '原创作方法安装版本不符，请重新核对。', { recoverable: true })
      }
      // Only main-owned manager data supplies the manifest and declared bytes.
      return { version: structuredClone(original.version), package: materialize(original.version, original.files) }
    }))
    return { ...creativePolicyRun(loaded.map(item => item.package), snapshot.composition, snapshot.slotParams, snapshot.released), withContext: operation => withContributionSnapshot({ versions: loaded.map(item => item.version), composition: snapshot.composition }, operation), assertAuthorized: async () => { await Promise.all(loaded.map(item => load(item.version))) } }
  }
  return provider
}
