import { ipcMain } from 'electron'
import { registerModelsIpc as registerCommands } from './commands'

export function registerModelsIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
