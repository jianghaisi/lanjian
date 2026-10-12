import { ipcMain } from 'electron'
import { registerAnnotationRevisionIpc as registerCommands } from './generation-commands'

export function registerAnnotationRevisionIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
