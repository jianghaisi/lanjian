import { ipcMain } from 'electron'
import { registerTimelineIpc as registerCommands } from './commands'

export function registerTimelineIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
