/** Desktop shell adapted from OpenDesktop-Pet's transparent-window, drag and
 * click-through implementation (Copyright 2025 Loney, Apache-2.0).
 * Source: https://github.com/HanLoney/OpenDesktop-Pet/blob/main/main.js
 * Integration changes: sandbox, scoped IPC, no camera/AI services, multi-display
 * recovery, write-before-ack preferences, author-window lifecycle. See notices. */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { AppError, isAppError } from '../../core/errors/app-error'
import type { DesktopPetAction, DesktopPetContext, DesktopPetState } from '../../../contracts/companion/desktop-pet'
import { decodeDesktopPetCommand, decodeDesktopPetContext, defaultDesktopPetPreferences, DesktopPetPreferencesStore, restoreDesktopPetPosition } from './application/desktop-pet-policy'

export function attachDesktopPet(owner: BrowserWindow): { dispose: () => void } {
  const store = new DesktopPetPreferencesStore(app.getPath('userData'))
  let pet: BrowserWindow | null = null
  let loaded = false, disposed = false, interactive = false, dragging = false
  let dragTimer: ReturnType<typeof setInterval> | undefined
  let hitTimer: ReturnType<typeof setInterval> | undefined
  let regions: Array<{ x: number; y: number; width: number; height: number }> = []
  let ignoring: boolean | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  const state: DesktopPetState = {
    open: false,
    context: { mode: 'chibi', scope: '', taskId: '', taskStatus: '', quiet: false, reducedMotion: false, followPointer: true, autoBlink: true, stateFeedback: true, intensity: .45, focusHidden: false },
    preferences: { ...defaultDesktopPetPreferences }, position: null, error: null
  }
  let enabled = false
  const ready = store.read().then(saved => { enabled = saved.enabled; state.preferences = saved.preferences; state.position = saved.position }).catch(() => { state.error = '桌宠偏好读取失败，暂不加载宠物。原记录已保留，请检查设置后重试。' })
  const snapshot = (): DesktopPetState => structuredClone(state)
  function publish() {
    if (!owner.isDestroyed()) owner.webContents.send('desktop-pet:state', snapshot())
    if (loaded && pet && !pet.isDestroyed()) pet.webContents.send('desktop-pet:state', snapshot())
  }
  function shown() { return state.open && state.context.mode !== 'hidden' && !state.context.focusHidden }
  function pointerPolicy() {
    const ignore = !dragging && (state.preferences.clickThrough || !interactive)
    if (pet && !pet.isDestroyed() && ignore !== ignoring) {
      ignoring = ignore; pet.setIgnoreMouseEvents(ignore, { forward: true })
    }
  }
  function stopHitTesting() {
    clearInterval(hitTimer); hitTimer = undefined; interactive = false
  }
  function startHitTesting() {
    if (hitTimer) return
    // Windows may not deliver an initial forwarded move to a fully click-through
    // transparent surface. Use bounded local hit regions to break that deadlock.
    hitTimer = setInterval(() => {
      if (!loaded || !shown() || !pet || pet.isDestroyed() || dragging) return
      const cursor = screen.getCursorScreenPoint(), bounds = pet.getContentBounds(), zoom = pet.webContents.getZoomFactor()
      const x = (cursor.x - bounds.x) / zoom, y = (cursor.y - bounds.y) / zoom
      interactive = regions.some(rect => x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height)
      pointerPolicy()
    }, 40)
  }
  function dimensions(scale = state.preferences.scale) {
    const area = screen.getDisplayNearestPoint(state.position || screen.getCursorScreenPoint()).workArea
    // Screen coordinates are Electron DIP, not screenshot pixels.
    return { width: Math.min(area.width, Math.round(320 * scale)), height: Math.min(area.height, Math.round(460 * scale)) }
  }
  function recoverPosition(force = false) {
    if (!pet || pet.isDestroyed()) return
    const size = dimensions()
    const ownerBounds = owner.getBounds()
    const fallback = { x: ownerBounds.x + ownerBounds.width, y: ownerBounds.y + 80 }
    const position = restoreDesktopPetPosition(force ? null : state.position, size, screen.getAllDisplays().map(display => display.workArea), fallback)
    state.position = position
    pet.setBounds({ ...position, ...size })
    pet.webContents.setZoomFactor(Math.min(state.preferences.scale, size.width / 320, size.height / 460))
  }
  function enqueue(operation: () => Promise<void>): Promise<void> {
    const next = queue.then(operation)
    queue = next.catch(() => {})
    return next
  }
  function schedulePositionSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void enqueue(async () => {
        if (disposed) return
        try { await store.save({ enabled, preferences: state.preferences, position: state.position }); state.error = null }
        catch { state.error = '位置暂未保存。可以继续使用，下次启动可能回到旧位置。' }
        if (!disposed) publish()
      })
    }, 250)
  }
  function stopDrag() {
    const wasDragging = dragging
    dragging = false; clearInterval(dragTimer); dragTimer = undefined
    pointerPolicy(); if (wasDragging) schedulePositionSave()
  }
  async function ensureWindow() {
    if (disposed || pet) return
    const win = new BrowserWindow({
      ...dimensions(), title: '岚笺 · 桌面伙伴', show: false,
      transparent: true, frame: false, thickFrame: false, alwaysOnTop: state.preferences.alwaysOnTop,
      resizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/desktop-pet.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'lanjian-desktop-pet' }
    })
    pet = win
    ignoring = undefined; regions = []
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    win.webContents.session.setPermissionCheckHandler(() => false)
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('will-redirect', event => event.preventDefault())
    win.on('close', event => {
      if (disposed) return
      event.preventDefault()
      void setUserOpen(false).catch(() => { state.error = '桌宠关闭选择未能保存，请重试。'; publish() })
    })
    win.on('move', () => {
      if (disposed || win.isDestroyed()) return
      const [x, y] = win.getPosition(); state.position = { x, y }
      schedulePositionSave()
    })
    win.on('blur', () => { interactive = false; stopDrag() })
    win.on('closed', () => {
      if (pet !== win) return
      loaded = false; pet = null; stopHitTesting()
    })
    win.webContents.on('render-process-gone', () => {
      state.open = false; state.error = '伙伴窗口已中断，可通过顶栏“找回桌宠”重新打开。'
      stopHitTesting(); stopDrag(); win.destroy(); publish()
    })
    recoverPosition()
    pointerPolicy()
    try {
      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await win.loadURL(new URL('pet.html', process.env.ELECTRON_RENDERER_URL).href)
      else await win.loadFile(join(__dirname, '../renderer/pet.html'))
      if (disposed || win.isDestroyed()) return
      loaded = true; publish()
      if (shown()) { win.showInactive(); startHitTesting() }
    } catch {
      if (!win.isDestroyed()) win.destroy()
      state.open = false; state.error = '桌面伙伴未能打开，请通过顶栏重试。'; publish()
    }
  }
  function applyVisibility() {
    if (!shown()) { stopHitTesting(); if (pet && !pet.isDestroyed()) pet.hide(); stopDrag(); return }
    void ensureWindow().then(() => { if (shown() && loaded && pet && !pet.isDestroyed()) { pet.showInactive(); startHitTesting() } })
  }
  function setUserOpen(choice: boolean | 'toggle', locate = false): Promise<void> {
    return enqueue(async () => {
      if (disposed) throw new AppError('FEATURE_UNAVAILABLE', '桌宠窗口已关闭。', { recoverable: true })
      const next = choice === 'toggle' ? !state.open || state.context.mode === 'hidden' : choice
      const preferences = locate ? { ...state.preferences, clickThrough: false } : state.preferences
      await store.save({ enabled: next, preferences, position: state.position })
      if (disposed) return
      enabled = next; state.preferences = preferences; state.error = null
      state.open = enabled && Boolean(state.context.scope)
      if (next && state.context.mode === 'hidden') { state.context.mode = 'chibi'; ownerAction('mode-chibi') }
      applyVisibility(); publish()
    })
  }
  function ownerAction(action: DesktopPetAction) {
    if (owner.isDestroyed()) return
    if (owner.isMinimized()) owner.restore()
    owner.show(); owner.focus(); owner.webContents.send('desktop-pet:action', action)
  }
  function trusted(event: Electron.IpcMainInvokeEvent, ownerOnly = false) {
    return !disposed && event.senderFrame === event.sender.mainFrame &&
      (event.sender === owner.webContents || (!ownerOnly && pet && !pet.isDestroyed() && event.sender === pet.webContents))
  }
  const channels = ['desktop-pet:get', 'desktop-pet:context', 'desktop-pet:command']
  function handle(channel: string, operation: (value: unknown, event: Electron.IpcMainInvokeEvent) => Promise<void>, ownerOnly = false) {
    ipcMain.handle(channel, async (event, value: unknown) => {
      if (!trusted(event, ownerOnly)) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '此窗口不能执行桌宠操作。', recoverable: false } }
      await ready
      if (!trusted(event, ownerOnly)) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '桌宠窗口已关闭，请重新打开。', recoverable: true } }
      try { await operation(value, event); return { ok: true, value: snapshot() } }
      catch (error) { return { ok: false, error: { code: isAppError(error) ? error.code : 'INTERNAL_ERROR', message: isAppError(error) ? error.message : '桌宠操作未完成，请重试。', recoverable: true } } }
    })
  }
  handle(channels[0]!, async () => {})
  handle(channels[1]!, async value => {
    const context: DesktopPetContext = decodeDesktopPetContext(value)
    const scopeChanged = context.scope !== state.context.scope
    state.context = context
    if (scopeChanged || !context.scope) state.open = enabled && Boolean(context.scope)
    applyVisibility(); publish()
  }, true)
  handle(channels[2]!, async value => {
    const command = decodeDesktopPetCommand(value)
    if (command.type === 'regions') { regions = command.regions; return }
    if (command.type === 'hover') {
      // Forwarded events can target the transparent root while the OS switches
      // hit testing. Once measured regions exist, they are the single owner.
      if (!regions.length) { interactive = command.interactive; pointerPolicy() }
      return
    }
    if (command.type === 'configure') {
      await enqueue(async () => {
        if (disposed) throw new AppError('FEATURE_UNAVAILABLE', '桌宠窗口已关闭。', { recoverable: true })
        await store.save({ enabled, preferences: command.preferences, position: state.position })
        if (disposed) return
        state.preferences = command.preferences; state.error = null
        pet?.setAlwaysOnTop(command.preferences.alwaysOnTop)
        recoverPosition(); pointerPolicy()
      })
    } else if (command.type === 'drag-start') {
      if (!pet || !shown() || state.preferences.clickThrough) return
      stopDrag(); dragging = true; pointerPolicy()
      const origin = screen.getCursorScreenPoint(), bounds = pet.getBounds(), started = Date.now()
      dragTimer = setInterval(() => {
        if (!pet || pet.isDestroyed() || Date.now() - started > 30_000) { stopDrag(); return }
        const cursor = screen.getCursorScreenPoint()
        pet.setPosition(Math.round(bounds.x + cursor.x - origin.x), Math.round(bounds.y + cursor.y - origin.y))
      }, 16)
      return
    } else if (command.type === 'drag-end') stopDrag()
    else if (command.type === 'hide') await setUserOpen(false)
    else if (command.type === 'toggle' || command.type === 'locate') {
      await setUserOpen(command.type === 'locate' ? true : 'toggle', command.type === 'locate')
      if (command.type === 'locate' && shown()) {
        // Explicit recovery also unlocks click-through, including after display removal.
        await ensureWindow(); recoverPosition(true); pointerPolicy()
      }
      applyVisibility()
    } else if (command.type === 'mode') {
      state.context.mode = command.mode; ownerAction(command.mode === 'detailed' ? 'mode-detailed' : 'mode-chibi'); applyVisibility()
    } else ownerAction(command.type)
    publish()
  })
  const displaysChanged = () => { if (!disposed) { recoverPosition(); publish() } }
  screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged)
  function dispose() {
    if (disposed) return
    disposed = true; clearInterval(dragTimer); stopHitTesting(); clearTimeout(saveTimer)
    if (pet && !pet.isDestroyed()) pet.destroy()
    for (const channel of channels) ipcMain.removeHandler(channel)
    screen.removeListener('display-removed', displaysChanged); screen.removeListener('display-metrics-changed', displaysChanged)
  }
  owner.once('closed', dispose)
  return { dispose }
}
