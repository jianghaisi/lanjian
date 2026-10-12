import { dialog } from 'electron'
import { lstat } from 'node:fs/promises'
import { codePluginLimits } from '@lanjian/writing-plugin-contracts'
import { decodeDeriveArgs, decodeDraftExportArgs, decodeDraftRefArgs, decodeDraftSaveArgs, decodeDraftTemplateArgs } from '../../../../contracts/writing-plugins/authoring'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { AppError } from '../../../core/errors/app-error'
import { registerValidatedIpc, type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { PluginDraftStore } from '../adapters/draft-store'
import { buildPluginDraft } from '../adapters/draft-builder'
import { pluginExportDestination } from '../adapters/plugin-export'
import { PluginPackageStore, readBoundedFile, readPluginZipFile } from '../adapters/package-store'
import { PluginAuthoringService } from '../application/authoring-service'
import type { WritingPluginManager } from '../application/plugin-manager'

export function registerPluginAuthoring(ipc: IpcRegistrar, service: PluginAuthoringService) {
  registerValidatedIpc(ipc, 'writing-plugins:list-drafts', decodeNoArgs, () => service.list())
  registerValidatedIpc(ipc, 'writing-plugins:create-draft', decodeDraftTemplateArgs, template => service.create(template))
  registerValidatedIpc(ipc, 'writing-plugins:save-draft', decodeDraftSaveArgs, input => service.save(input))
  registerValidatedIpc(ipc, 'writing-plugins:validate-draft', decodeDraftRefArgs, input => service.validate(input))
  registerValidatedIpc(ipc, 'writing-plugins:build-draft', decodeDraftRefArgs, input => service.build(input))
  registerValidatedIpc(ipc, 'writing-plugins:export-draft', decodeDraftExportArgs, input => service.export(input))
  registerValidatedIpc(ipc, 'writing-plugins:preview-draft', decodeDraftRefArgs, input => service.preview(input))
  registerValidatedIpc(ipc, 'writing-plugins:import-draft-source', decodeDraftRefArgs, input => service.importSource(input))
  registerValidatedIpc(ipc, 'writing-plugins:import-draft-package', decodeNoArgs, () => service.importPackage())
  registerValidatedIpc(ipc, 'writing-plugins:derive-draft', decodeDeriveArgs, input => service.derive(input.pluginId, input.digest))
}
export function createNativePluginAuthoring(root: string, manager: WritingPluginManager) {
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root)
  return new PluginAuthoringService(store, {
    build: buildPluginDraft, persist: build => store.persist(build),
    async choosePackage() {
      const choice = await dialog.showOpenDialog({ title: '选择插件包，创建可编辑的个人副本', buttonLabel: '复制为个人草稿', properties: ['openFile'], filters: [{ name: '岚笺插件包', extensions: ['zip'] }] })
      const path = choice.filePaths[0]
      if (choice.canceled || !path) return null
      try { return await readPluginZipFile(path) }
      catch (cause) {
        if (cause instanceof AppError) throw cause
        throw new AppError('STORAGE_ERROR', '插件包无法读取，请重新选择文件。已有草稿已保留。', { recoverable: true, cause })
      }
    },
    async chooseExport(build) {
      const choice = await dialog.showSaveDialog({ title: `导出插件包 · ${build.manifest.name}`, buttonLabel: '导出插件包', defaultPath: `${build.manifest.id}-${build.manifest.version}.zip`, filters: [{ name: '岚笺插件包', extensions: ['zip'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] })
      return choice.canceled || !choice.filePath ? null : pluginExportDestination(choice.filePath, root)
    },
    async chooseSource() {
      const choice = await dialog.showOpenDialog({ title: '导入已编译的插件 JavaScript', properties: ['openFile'], filters: [{ name: 'JavaScript', extensions: ['js'] }] })
      const path = choice.filePaths[0]; if (choice.canceled || !path) return null
      if (!path.endsWith('.js') || (await lstat(path)).isSymbolicLink()) throw new AppError('VALIDATION_ERROR', '请选择实际 JavaScript 文件。', { recoverable: true })
      return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedFile(path, codePluginLimits.entryBytes))
    },
    async installed(id, digest) {
      const version = (await manager.list()).plugins.find(p => p.id === id)?.versions.find(v => v.digest === digest)
      if (!version) throw new AppError('NOT_FOUND', '安装版本已不存在，请刷新。', { recoverable: true })
      return { manifest: version.manifest, files: await packages.load(version) }
    }
  }, manager)
}
