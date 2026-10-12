import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { SettingsStore } from '../../../platform/settings/settings-store'
import { ResearchService } from '../application/research-service'
import { ResearchLibraryService } from '../../library/application/research-library-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { FoundationDraftService } from '../../planning/application/foundation-draft-service'
import {
  decodeFoundationArgs,
  decodeBookProfileArgs,
  decodeNoArgs,
  decodeOptionalChapterIdArgs,
  decodeRealmsArgs,
  decodePowerSystemArgs,
  decodeCheatSystemArgs,
  decodeResearchQueryArgs,
  decodeResearchSettingsArgs,
  decodeSourceCardCreateArgs,
  decodeSourceCardUpdateArgs,
  decodeSystemTemplateArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  settings: SettingsStore
  research: ResearchService
  researchLibrary: ResearchLibraryService
  workspace: WorkspaceService
  foundationDrafts: FoundationDraftService
}

export function registerWorldbuildingIpc(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const { settings, research, researchLibrary, workspace, foundationDrafts } = dependencies
  registerValidatedIpc(ipcMain, 'research:get-settings', decodeNoArgs, () => settings.researchSettings())
  registerValidatedIpc(ipcMain, 'research:update-settings', decodeResearchSettingsArgs, (input) =>
    settings.updateResearchSettings(input)
  )
  registerValidatedIpc(ipcMain, 'research:search', decodeResearchQueryArgs, (query) => research.search(query))
  registerValidatedIpc(ipcMain, 'research:list-sources', decodeNoArgs, () => researchLibrary.listSources())
  registerValidatedIpc(ipcMain, 'research:create-source', decodeSourceCardCreateArgs, (input) =>
    researchLibrary.createSource(input)
  )
  registerValidatedIpc(ipcMain, 'research:update-source', decodeSourceCardUpdateArgs, (id, input) =>
    researchLibrary.updateSource(id, input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-foundation', decodeNoArgs, () => workspace.foundation())
  registerValidatedIpc(ipcMain, 'workspace:get-book-profile', decodeNoArgs, () => workspace.bookProfile())
  registerValidatedIpc(ipcMain, 'workspace:save-book-profile', decodeBookProfileArgs, (data) =>
    workspace.saveBookProfile(data)
  )
  registerValidatedIpc(ipcMain, 'workspace:generate-foundation-draft', decodeNoArgs, () => foundationDrafts.generate())
  registerValidatedIpc(ipcMain, 'workspace:save-foundation', decodeFoundationArgs, (data) =>
    workspace.saveFoundation(data)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-foundation-status', decodeOptionalChapterIdArgs, (chapterId) =>
    workspace.foundationStatus(chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-realms', decodeNoArgs, () => workspace.realms())
  registerValidatedIpc(ipcMain, 'workspace:save-realms', decodeRealmsArgs, (levels) => workspace.saveRealms(levels))
  registerValidatedIpc(ipcMain, 'workspace:get-power-system', decodeNoArgs, () => workspace.powerSystem())
  registerValidatedIpc(ipcMain, 'workspace:save-power-system', decodePowerSystemArgs, (data) =>
    workspace.savePowerSystem(data)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-cheat-system', decodeNoArgs, () => workspace.cheatSystem())
  registerValidatedIpc(ipcMain, 'workspace:save-cheat-system', decodeCheatSystemArgs, (data) =>
    workspace.saveCheatSystem(data)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-system-template', decodeNoArgs, () => workspace.systemTemplate())
  registerValidatedIpc(ipcMain, 'workspace:save-system-template', decodeSystemTemplateArgs, (template) =>
    workspace.saveSystemTemplate(template)
  )
}
