import { ipcMain } from 'electron'
import { registerCharactersIpc as registerCommands } from './commands'

export function registerCharactersIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
