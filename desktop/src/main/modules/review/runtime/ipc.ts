import { ipcMain } from 'electron'
import { registerReviewIpc as registerCommands } from './commands'

export function registerReviewIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
