import { bundledPluginSources } from '../domain/bundled-plugins'
import type { BundledPackage, BundledPluginPorts } from '../application/bundled-service'
import { buildPluginContent } from './draft-builder'
import { PluginDraftStore } from './draft-store'

export function bundledPackagePorts(root: string): BundledPluginPorts {
  const store = new PluginDraftStore(root)
  let loaded: Promise<BundledPackage[]> | undefined
  return {
    load() { return loaded ??= Promise.all(bundledPluginSources().map(async source => { const { bytes, pkg } = await buildPluginContent(source); return { bytes, manifest: pkg.manifest, digest: pkg.digest, files: pkg.files } })) },
    persist: pkg => store.persist({ bytes: pkg.bytes, view: { manifest: pkg.manifest, digest: pkg.digest } })
  }
}
