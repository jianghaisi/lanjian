import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { WorldMapService } from '../application/world-map-service'
import { WorldMapWorkspaceService } from '../application/world-map-workspace-service'
import { WorldMapGenerationService } from '../application/world-map-generation-service'
import {
  decodeWorldMapImageAdoptArgs,
  decodeWorldMapImageCancelArgs,
  decodeWorldMapImageGenerateArgs,
  decodeWorldMapWriteArgs
} from '../../../../contracts/ipc'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  worldMapWorkspace: WorldMapWorkspaceService
  worldMap: WorldMapService
  worldMapGeneration: WorldMapGenerationService
}

export function registerWorldMapIpc(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const { worldMapWorkspace, worldMap, worldMapGeneration } = dependencies
  registerValidatedIpc(ipcMain, 'workspace:get-world-map', decodeNoArgs, () => worldMapWorkspace.read())
  registerValidatedIpc(ipcMain, 'workspace:save-world-map', decodeWorldMapWriteArgs, (input) => worldMap.write(input))
  registerValidatedIpc(ipcMain, 'workspace:generate-world-map-image', decodeWorldMapImageGenerateArgs, (input) =>
    worldMapGeneration.generate(input)
  )
  registerValidatedIpc(ipcMain, 'workspace:cancel-world-map-image', decodeWorldMapImageCancelArgs, (operationId) =>
    worldMapGeneration.cancel(operationId)
  )
  registerValidatedIpc(ipcMain, 'workspace:adopt-world-map-image', decodeWorldMapImageAdoptArgs, (input) =>
    worldMapGeneration.adopt(input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-world-map-background', decodeNoArgs, () =>
    worldMapGeneration.background()
  )
}
