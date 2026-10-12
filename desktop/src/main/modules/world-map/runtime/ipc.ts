import { ipcMain } from 'electron'
import { registerWorldMapIpc as registerCommands } from './commands'

export function registerWorldMapIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
