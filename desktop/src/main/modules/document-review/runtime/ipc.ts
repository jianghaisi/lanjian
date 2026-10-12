import { ipcMain } from 'electron'
import { registerDocumentReviewIpc as registerCommands } from './commands'

export function registerDocumentReviewIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
