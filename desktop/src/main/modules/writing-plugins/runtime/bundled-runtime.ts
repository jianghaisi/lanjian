import { decodeDeriveArgs } from '../../../../contracts/writing-plugins/authoring'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { registerValidatedIpc, type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import type { BundledPluginService } from '../application/bundled-service'

export function registerBundledPlugins(ipc: IpcRegistrar, service: BundledPluginService) {
  registerValidatedIpc(ipc, 'writing-plugins:bundled-list', decodeNoArgs, () => service.list())
  registerValidatedIpc(ipc, 'writing-plugins:bundled-preview', decodeDeriveArgs, ref => service.preview(ref))
  registerValidatedIpc(ipc, 'writing-plugins:bundled-derive', decodeDeriveArgs, ref => service.derive(ref))
}
