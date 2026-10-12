import { app, shell } from 'electron'
import { decodeMarketQueryArgs, decodeOperationArgs, decodePublishRefArgs, decodeReleaseArgs, decodeVersionsArgs } from '../../../../contracts/writing-plugins/marketplace'
import { decodePluginTokenArgs } from '../../../../contracts/writing-plugins/management-contracts'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { registerValidatedIpc, type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { MarketplaceAuth, marketplaceDeployment } from '../adapters/marketplace-auth'
import { MarketplaceClient } from '../adapters/market-client'
import { PluginMarketStore } from '../adapters/market-store'
import { readPluginPackage } from '../adapters/package-reader'
import { PluginMarketplaceService } from '../application/marketplace-service'
import type { PluginAuthoringService } from '../application/authoring-service'
import type { WritingPluginManager } from '../application/plugin-manager'
import { setMarketplaceCallback } from './oauth-callback'

export function registerPluginMarketplace(ipc: IpcRegistrar, service: PluginMarketplaceService) {
  registerValidatedIpc(ipc, 'writing-plugins:market-status', decodeNoArgs, () => service.status())
  registerValidatedIpc(ipc, 'writing-plugins:market-login', decodeNoArgs, () => service.login())
  registerValidatedIpc(ipc, 'writing-plugins:market-logout', decodeNoArgs, () => service.logout())
  registerValidatedIpc(ipc, 'writing-plugins:market-catalog', decodeMarketQueryArgs, query => service.catalog(query))
  registerValidatedIpc(ipc, 'writing-plugins:market-versions', decodeVersionsArgs, (id, query) => service.versions(id, query))
  registerValidatedIpc(ipc, 'writing-plugins:preview-publish', decodePublishRefArgs, ref => service.preview(ref))
  registerValidatedIpc(ipc, 'writing-plugins:publish', decodePluginTokenArgs, id => service.publish(id))
  registerValidatedIpc(ipc, 'writing-plugins:refresh-publication', decodeOperationArgs, id => service.refresh(id))
  registerValidatedIpc(ipc, 'writing-plugins:retry-publication', decodeOperationArgs, id => service.retry(id))
  registerValidatedIpc(ipc, 'writing-plugins:withdraw-publication', decodeOperationArgs, id => service.withdraw(id))
  registerValidatedIpc(ipc, 'writing-plugins:preview-download', decodeReleaseArgs, release => service.previewDownload(release))
}
export function createNativePluginMarketplace(root: string, authoring: PluginAuthoringService, manager: WritingPluginManager) {
  let deployment
  try { deployment = marketplaceDeployment(process.env, app.isPackaged) } catch { deployment = null }
  if (!deployment) return new PluginMarketplaceService(authoring, manager, null)
  const auth = new MarketplaceAuth(deployment, url => shell.openExternal(url)), client = new MarketplaceClient(deployment, () => auth.token()), store = new PluginMarketStore(root, deployment.origin)
  setMarketplaceCallback(url => auth.callback(url))
  return new PluginMarketplaceService(authoring, manager, { auth, client, store, validate: readPluginPackage })
}
