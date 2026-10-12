import { AppError } from '../../../core/errors/app-error'
import type { WritingPluginManager } from '../application/plugin-manager'
import { inspectLibraryComposition } from '../domain/composition'
import { decodeCreativePolicySnapshot } from '../domain/creative-policy-snapshot'
import { createCreativePolicyProvider } from './creative-policy-provider'

/** Independent application scope, including calls originating in a book/group. */
export function createLibraryCreativePolicyProvider(getManager: () => WritingPluginManager) {
  const provider = createCreativePolicyProvider(
    () => getManager().captureLibraryComposition(),
    async version => (await getManager().loadLibraryAuthorized(version.manifest.id, version.digest)).files,
    ref => getManager().loadLibraryAuthorized(ref.pluginId, ref.digest),
    { inheritContext: false }
  )
  const restore = provider.restore!
  provider.restore = async value => {
    const snapshot = decodeCreativePolicySnapshot(value)
    if (snapshot.composition.entries.length) {
      const inspected = inspectLibraryComposition(await getManager().list(), snapshot.composition.entries)
      if (inspected.conflicts.length) throw new AppError('CONFLICT', '知识库原方法已不可用，请核对原安装版本。', { recoverable: true })
    }
    return restore(snapshot)
  }
  return provider
}
