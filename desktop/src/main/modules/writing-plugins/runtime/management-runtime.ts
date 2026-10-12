import { dialog } from 'electron'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { decodePluginBookArgs, decodePluginEnableArgs, decodePluginListArgs, decodePluginTokenArgs, decodePluginUninstallArgs, decodePluginVersionArgs } from '../../../../contracts/writing-plugins/management-contracts'
import { registerValidatedIpc, type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { AppError } from '../../../core/errors/app-error'
import type { ProjectService } from '../../library/application/project-service'
import { PluginManagement, type PluginManagementPorts } from '../application/plugin-management'
import type { WritingPluginManager } from '../application/plugin-manager'
import { decodeCompositionArgs, decodeLibraryCompositionArgs } from '../../../../contracts/writing-plugins/contributions'

export function registerPluginManagement(ipc: IpcRegistrar, manager: WritingPluginManager, ports: PluginManagementPorts): PluginManagement {
  const management = new PluginManagement(manager, ports)
  registerValidatedIpc(ipc, 'writing-plugins:list', decodePluginListArgs, withBook => management.list(withBook))
  registerValidatedIpc(ipc, 'writing-plugins:choose-package', decodeNoArgs, () => management.choosePackage())
  registerValidatedIpc(ipc, 'writing-plugins:preview-install', decodePluginTokenArgs, token => manager.preview(token))
  registerValidatedIpc(ipc, 'writing-plugins:install', decodePluginTokenArgs, async token => { await ports.beforeInstall?.(token); await manager.install(token); return true })
  registerValidatedIpc(ipc, 'writing-plugins:set-enabled', decodePluginEnableArgs, async i => { await manager.setEnabled(i.id, i.enabled, i.grants, i.revision); return true })
  registerValidatedIpc(ipc, 'writing-plugins:set-book-enabled', decodePluginBookArgs, async i => { await management.setBookEnabled(i); return true })
  registerValidatedIpc(ipc, 'writing-plugins:select-version', decodePluginVersionArgs, async i => { await manager.selectVersion(i.id, i.digest, i.grants, i.revision); return true })
  registerValidatedIpc(ipc, 'writing-plugins:uninstall', decodePluginUninstallArgs, async i => { await manager.uninstall(i.id, i.revision); return true })
  registerValidatedIpc(ipc, 'writing-plugins:preview-composition', decodeCompositionArgs, input => management.previewComposition(input))
  registerValidatedIpc(ipc, 'writing-plugins:preview-library-composition', decodeLibraryCompositionArgs, input => management.previewLibraryComposition(input))
  registerValidatedIpc(ipc, 'writing-plugins:apply-composition', decodePluginTokenArgs, async token => { await management.applyComposition(token); return true })
  return management
}
export function registerNativePluginManagement(ipc: IpcRegistrar, manager: WritingPluginManager, projects: ProjectService, market: Pick<PluginManagementPorts, 'provenance' | 'beforeInstall'> = {}): PluginManagement {
  return registerPluginManagement(ipc, manager, {
    ...market,
    async currentBook() {
      try { const book = await projects.currentSummary(); return { id: book.id, title: book.title } }
      catch (error) { if (error instanceof AppError && error.code === 'PROJECT_NOT_OPEN') return null; throw error }
    },
    async chooseZip() { const result = await dialog.showOpenDialog({ title: '选择岚笺写作插件', properties: ['openFile'], filters: [{ name: '岚笺插件包', extensions: ['zip'] }] }); return result.canceled ? null : result.filePaths[0] ?? null }
  })
}
