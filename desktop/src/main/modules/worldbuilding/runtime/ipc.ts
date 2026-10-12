import { ipcMain } from 'electron'
import { registerWorldbuildingIpc as registerCommands } from './commands'

export function registerWorldbuildingIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
