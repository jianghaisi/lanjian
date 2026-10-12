import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { attachDesktopPet } from '../modules/companion/desktop-pet-window'
import { join } from 'node:path'
import { isAllowedAppNavigation, isAllowedExternalUrl } from './window-security'
import type { DesktopRuntime } from './create-desktop-runtime'
import { mainOutputDirectory } from '../platform/processes/main-output-directory'

export function createMainWindow(runtime: DesktopRuntime): void {
  const mainDirectory = mainOutputDirectory(__dirname)
  const { companionVoice, localModelRuntime, modelConnectionsRuntime } = runtime
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(mainDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let closeAllowed = false
  companionVoice?.attach(window)
  localModelRuntime?.attach(window)
  modelConnectionsRuntime?.attach(window)
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) runtime.writingAgentPreviews.cancel()
  })
  window.webContents.once('destroyed', () => runtime.writingAgentPreviews.cancel())
  attachDesktopPet(window, companionVoice)
  let closeRequested = false, quitRequested = false
  const showSelectionAiMenu = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents || window.isDestroyed()) return
    if (process.env.LANJIAN_SMOKE === '1') {
      window.webContents.send('app:selection-ai-action', 'rewrite')
      return
    }
    const selectSkill = (skill: 'rewrite' | 'expand' | 'compress' | 'custom' | 'polish') => () => {
      if (!window.webContents.isDestroyed()) window.webContents.send('app:selection-ai-action', skill)
    }
    Menu.buildFromTemplate([
      { label: '用智能助笔改写', click: selectSkill('rewrite') },
      { label: '用智能助笔扩写', click: selectSkill('expand') },
      { label: '用智能助笔压缩', click: selectSkill('compress') },
      { label: '自定义处理选区', click: selectSkill('custom') },
      { label: '润色选区', click: selectSkill('polish') },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]).popup({ window })
  }
  const closeReady = (event: Electron.IpcMainEvent, success: boolean): void => {
    if (event.sender !== window.webContents) return
    closeRequested = false
    if (!success) {
      quitRequested = false
      if (!window.isDestroyed()) window.show()
      return
    }
    closeAllowed = true
    if (!window.isDestroyed()) window.close()
  }
  ipcMain.on('app:close-ready', closeReady)
  ipcMain.on('app:show-selection-ai-menu', showSelectionAiMenu)
  const beforeQuit = (event: Electron.Event): void => {
    if (event.defaultPrevented || window.isDestroyed()) return
    // Let the existing save/unsaved-draft guards decide first. Electron must
    // not close the pet independently and persist that as a user opt-out.
    event.preventDefault()
    quitRequested = true
    window.close()
  }
  app.on('before-quit', beforeQuit)
  window.webContents.on('will-prevent-unload', () => { quitRequested = false })
  window.on('close', (event) => {
    // A renderer beforeunload guard may still keep this window alive. Consume
    // the permit now so any later close must run fresh save/draft checks.
    if (closeAllowed) { closeAllowed = false; return }
    event.preventDefault()
    if (closeRequested || window.webContents.isDestroyed()) return
    closeRequested = true
    window.webContents.send('app:before-close')
  })
  window.on('closed', () => {
    app.removeListener('before-quit', beforeQuit)
    ipcMain.removeListener('app:close-ready', closeReady)
    ipcMain.removeListener('app:show-selection-ai-menu', showSelectionAiMenu)
    if (quitRequested) app.quit()
  })
  window.webContents.on('preload-error', () => {
    console.error('[desktop] preload failed')
  })
  if (__LANJIAN_DEV_SCENARIOS__ && !app.isPackaged) {
    window.webContents.once('did-finish-load', () => {
      void import('../../../tests/smoke/desktop-scenario-driver')
        .then(({ runDesktopScenarios }) => {
          runDesktopScenarios(window, runtime)
        })
        .catch(() => {
          console.error('[desktop] development scenario driver failed to load')
          app.exit(1)
        })
    })
  }
  // A page reload resets preload state, not the already shown BrowserWindow.
  // Replay actual visibility for that document; hidden windows must still wait.
  const notifyWindowShown = (): void => {
    if (!window.isDestroyed() && window.isVisible() && !window.webContents.isDestroyed()) {
      window.webContents.send('app:window-shown')
    }
  }
  window.on('show', notifyWindowShown)
  window.on('restore', notifyWindowShown)
  window.webContents.on('did-finish-load', notifyWindowShown)
  window.once('ready-to-show', () => {
    window.show()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  const guardNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedAppNavigation(window.webContents.getURL(), url)) event.preventDefault()
  }
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    if (process.env.LANJIAN_SMOKE === '1') rendererUrl.searchParams.set('smoke', '1')
    if (process.env.LANJIAN_SMOKE_BOOT_VISIBILITY_ONLY === '1') rendererUrl.searchParams.set('boot', '1')
    void window.loadURL(rendererUrl.toString())
  } else
    void window.loadFile(
      join(mainDirectory, '../renderer/index.html'),
      process.env.LANJIAN_SMOKE === '1'
        ? { query: { smoke: '1', ...(process.env.LANJIAN_SMOKE_BOOT_VISIBILITY_ONLY === '1' ? { boot: '1' } : {}) } }
        : undefined
    )
}
