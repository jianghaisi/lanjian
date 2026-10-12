import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { AppError } from '../core/errors/app-error'
import { createDesktopRuntime } from './create-desktop-runtime'
import { createMainWindow } from './create-main-window'
import { receiveMarketplaceCallback } from '../modules/writing-plugins/runtime/oauth-callback'

if (process.env.LANJIAN_USER_DATA_PATH) app.setPath('userData', process.env.LANJIAN_USER_DATA_PATH)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'frontend'))
const ownsApplicationData = app.requestSingleInstanceLock()
if (!ownsApplicationData) app.quit()
app.on('second-instance', (_event, args) => {
  receiveMarketplaceCallback(args)
  const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
})
app.on('open-url', (event, url) => { event.preventDefault(); receiveMarketplaceCallback([url]) })

// Keep smoke diagnostics useful without printing exception text or stacks;
// provider failures may contain echoed credentials or manuscript content.
if (process.env.LANJIAN_SMOKE === '1') {
  process.on('unhandledRejection', (reason) => {
    const label = reason instanceof AppError ? reason.code : reason instanceof Error ? reason.name : 'unknown'
    console.error(`[desktop smoke] unhandled rejection: ${label}`)
  })
}

app.whenReady().then(async () => {
  if (!ownsApplicationData) return
  app.setAppUserModelId('cn.zuolan.novelwriter')
  const runtime = await createDesktopRuntime()
  createMainWindow(runtime)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(runtime)
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
