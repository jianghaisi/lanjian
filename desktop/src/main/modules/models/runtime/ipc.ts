import { ipcMain } from 'electron'
import { AiClient } from '../application/ai-client'
import { genreCatalog } from '../../../../contracts/worldbuilding/genre-catalog'
import { decodeAiConnectionDraftArgs, decodeAiSettingsUpdateArgs, decodeNoArgs } from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import type { BookModelsService } from '../application/book-models-service'

interface Dependencies {
  projectAi: BookModelsService
  ai: AiClient
}

export function registerModelsIpc(dependencies: Dependencies): void {
  const { projectAi, ai } = dependencies
  registerValidatedIpc(ipcMain, 'ai:get-settings', decodeNoArgs, () => projectAi.get())
  registerValidatedIpc(ipcMain, 'ai:update-settings', decodeAiSettingsUpdateArgs, (input) => projectAi.update(input))
  registerValidatedIpc(ipcMain, 'ai:list-models', decodeAiConnectionDraftArgs, (draft) => ai.listModels(draft))
  registerValidatedIpc(ipcMain, 'ai:test', decodeAiConnectionDraftArgs, (draft) => ai.testConnection(draft))
  registerValidatedIpc(ipcMain, 'ai:genres', decodeNoArgs, () => ({
    genres: genreCatalog.map((item) => ({
      id: item.id,
      name: item.label,
      aliases: [],
      substyles: item.subgenres.map(([label]) => label)
    }))
  }))
}
