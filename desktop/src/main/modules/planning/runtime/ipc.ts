import { ipcMain } from 'electron'
import { registerPlanningIpc as registerCommands } from './commands'

export function registerPlanningIpc(dependencies: Parameters<typeof registerCommands>[1]): void {
  registerCommands(ipcMain, dependencies)
}
