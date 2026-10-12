/** Desktop shell adapted from OpenDesktop-Pet's transparent-window, drag and
 * click-through implementation (Copyright 2025 Loney, Apache-2.0).
 * Source: https://github.com/HanLoney/OpenDesktop-Pet/blob/main/main.js
 * Integration changes: sandbox, scoped IPC, no camera/AI services, multi-display
 * recovery, write-before-ack preferences, author-window lifecycle. See notices. */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { AppError, isAppError } from '../../core/errors/app-error'
import { mainOutputDirectory } from '../../platform/processes/main-output-directory'
import type { DesktopPetAction, DesktopPetContext, DesktopPetState, DesktopPetPanel, DesktopPetRect } from '../../../contracts/companion/desktop-pet'
import { layoutDesktopPet } from './application/desktop-pet-layout'
import { decodeDesktopPetCommand, decodeDesktopPetContext, defaultDesktopPetPreferences, DesktopPetPreferencesStore, restoreDesktopPetPosition } from './application/desktop-pet-policy'

type PetVoiceHost = { attach(window: BrowserWindow, kind: 'pet'): void; setPetActive(window: BrowserWindow, active: boolean): void; microphonePermitted?(window: BrowserWindow): boolean; activity?(): { roam: boolean; follow: boolean; reduced: boolean; sleeping: boolean; focus: boolean } }
export function attachDesktopPet(owner: BrowserWindow, voice?: PetVoiceHost): { dispose: () => void } {
  const mainDirectory = mainOutputDirectory(__dirname)
  const store = new DesktopPetPreferencesStore(app.getPath('userData'))
  let pet: BrowserWindow | null = null
  let loaded = false, disposed = false, interactive = false, dragging = false
  let dragTimer: ReturnType<typeof setInterval> | undefined
  let hitTimer: ReturnType<typeof setInterval> | undefined
  let regions: Array<{ x: number; y: number; width: number; height: number }> = []
  let ignoring: boolean | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  let panel: DesktopPetPanel | null = null, home: DesktopPetRect | undefined, expectedBounds: DesktopPetRect | undefined, arranging = false
  const state: DesktopPetState = {
    open: false,
    context: { mode: 'chibi', scope: '', taskId: '', taskStatus: '', quiet: false, reducedMotion: false, followPointer: true, autoBlink: true, stateFeedback: true, intensity: .45, focusHidden: false },
    preferences: { ...defaultDesktopPetPreferences }, position: null, error: null
  }
  let enabled = false
  let interactionBusy = false, pointerPressed = false, autoMoving = false, wanderAt = 0
  let wanderTarget: { x: number; y: number } | undefined
  const ready = store.read().then(saved => { enabled = saved.enabled; state.preferences = saved.preferences; state.position = saved.position }).catch(() => { state.error = '桌宠偏好读取失败，暂不加载宠物。原记录已保留，请检查设置后重试。' })
  const snapshot = (): DesktopPetState => structuredClone({ ...state, enabled })
  let motionSequence = 0
  function publishMotion(velocityX = 0) {
    if (loaded && pet && !pet.isDestroyed()) pet.webContents.send('desktop-pet:motion', { dragging, velocityX: Math.max(-4000, Math.min(4000, velocityX)), sequence: ++motionSequence })
  }
  function publish() {
    if (!owner.isDestroyed()) owner.webContents.send('desktop-pet:state', snapshot())
    if (loaded && pet && !pet.isDestroyed()) pet.webContents.send('desktop-pet:state', snapshot())
  }
  function shown() { return state.open && state.context.mode !== 'hidden' && !state.context.focusHidden }
  function pointerPolicy() {
    const ignore = state.preferences.clickThrough || (!dragging && !pointerPressed && !interactive)
    if (pet && !pet.isDestroyed() && ignore !== ignoring) {
      ignoring = ignore; pet.setIgnoreMouseEvents(ignore, { forward: true })
    }
  }
  function stopHitTesting() {
    clearInterval(hitTimer); hitTimer = undefined; interactive = false; pointerPressed = false
    if (autoMoving) { autoMoving = false; recoverPosition() }
  }
  function moveAutomatically() {
    if (!pet || pet.isDestroyed()) return
    const activity = voice?.activity?.()
    const allowed = activity && (activity.roam || activity.follow) && !activity.reduced && !state.context.reducedMotion && !state.preferences.positionLocked
    if (!allowed) { if (autoMoving) { autoMoving = false; recoverPosition() }; return }
    if (panel || dragging || pointerPressed || interactionBusy || interactive || activity.sleeping || activity.focus || state.context.quiet || state.context.focusHidden || voice?.microphonePermitted?.(pet)) return
    const bounds = pet.getBounds(), area = screen.getDisplayNearestPoint({x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}).workArea
    if (!wanderTarget || Date.now() > wanderAt) { wanderTarget = { x: area.x + Math.random()*Math.max(0,area.width-bounds.width), y: area.y + Math.random()*Math.max(0,area.height-bounds.height) }; wanderAt = Date.now()+8000 }
    const cursor = screen.getCursorScreenPoint()
    const target = activity.follow ? { x:cursor.x-bounds.width/2,y:cursor.y-bounds.height*.65 } : wanderTarget
    const safe = restoreDesktopPetPosition({x:Math.round(target.x),y:Math.round(target.y)}, bounds, [area])
    const dx = safe.x-bounds.x, dy = safe.y-bounds.y, distance=Math.hypot(dx,dy)
    if (distance<3) return
    const step=Math.min(distance,activity.follow?4:2)
    autoMoving=true
    const x = Math.round(bounds.x+dx/distance*step), y = Math.round(bounds.y+dy/distance*step)
    if (home) home = { ...home, x, y }
    expectedBounds = { ...bounds, x, y }; pet.setPosition(x, y)
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
      // The current cursor hit takes priority over automatic movement in this tick.
      moveAutomatically()
    }, 40)
  }
  function dimensions(scale = state.preferences.scale, anchor = state.position || screen.getCursorScreenPoint()) {
    const area = screen.getDisplayNearestPoint(anchor).workArea
    // Screen coordinates are Electron DIP, not screenshot pixels.
    // Character size is not page zoom: a small pet must keep readable controls.
    return { width: Math.min(area.width, Math.round(320 * Math.max(1, scale))), height: Math.min(area.height, Math.round(460 * Math.max(1, scale))) }
  }
  function recoveredHome(force = false): DesktopPetRect {
    const ownerBounds = owner.getBounds()
    const fallback = { x: ownerBounds.x + ownerBounds.width, y: ownerBounds.y + 80 }
    const size = dimensions(state.preferences.scale, force ? fallback : state.position || fallback)
    const position = restoreDesktopPetPosition(force ? null : state.position, size, screen.getAllDisplays().map(display => display.workArea), fallback)
    return { ...position, ...size }
  }
  function recoverPosition() {
    if (!pet || pet.isDestroyed()) return
    home = recoveredHome()
    state.position = { x: home.x, y: home.y }
    applyLayout()
    pet.webContents.setZoomFactor(1)
  }
  function applyLayout() {
    if (!pet || pet.isDestroyed() || !home) return
    const area = screen.getDisplayNearestPoint({ x: home.x + home.width / 2, y: home.y + home.height / 2 }).workArea
    const next = layoutDesktopPet(home, state.preferences.scale, panel, area)
    const previousLayout = JSON.stringify(state.layout)
    state.layout = next.layout; expectedBounds = next.bounds
    arranging = true
    try {
      pet.setBounds(next.bounds)
      expectedBounds = pet.getBounds()
      // Fractional system DPI can quantize the native origin by one DIP.
      // Compensate the local projection, never adopt this as a manual move.
      const dx = next.bounds.x - expectedBounds.x, dy = next.bounds.y - expectedBounds.y
      state.layout.pet.x += dx; state.layout.pet.y += dy
      if (state.layout.panel) { state.layout.panel.x += dx; state.layout.panel.y += dy }
    } finally { arranging = false }
    // A lock/topmost preference can reapply identical geometry. Renderer region
    // reports are deduplicated, so retain the still-valid hit map in that case.
    if (previousLayout !== JSON.stringify(state.layout)) { regions = []; interactive = false }
    pointerPolicy()
  }
  function closePanel() { if (panel) { panel = null; applyLayout() } }
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
    pointerPolicy()
    if (wasDragging) { recoverPosition(); publishMotion(); schedulePositionSave() }
  }
  async function ensureWindow() {
    if (disposed || pet) return
    const win = new BrowserWindow({
      ...dimensions(), title: '岚笺 · 桌面伙伴', show: false,
      transparent: true, frame: false, thickFrame: false, alwaysOnTop: state.preferences.alwaysOnTop,
      resizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: join(mainDirectory, '../preload/desktop-pet.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'lanjian-desktop-pet' }
    })
    pet = win
    voice?.attach(win, 'pet')
    ignoring = undefined; regions = []; interactionBusy = false; pointerPressed = false
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(
      contents === win.webContents && permission === 'media' && details.isMainFrame && details.requestingUrl === win.webContents.getURL()
      && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && shown() && win.isFocused() && voice?.microphonePermitted?.(win) === true
    ))
    win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
      contents === win.webContents && permission === 'media' && details.isMainFrame && details.requestingUrl === win.webContents.getURL()
      && details.mediaType === 'audio' && shown() && win.isFocused() && voice?.microphonePermitted?.(win) === true
    )
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('will-redirect', event => event.preventDefault())
    win.on('close', event => {
      if (disposed) return
      event.preventDefault()
      void setUserOpen(false).catch(() => { state.error = '桌宠关闭选择未能保存，请重试。'; publish() })
    })
    win.on('move', () => {
      if (disposed || win.isDestroyed() || autoMoving || arranging) return
      const bounds = win.getBounds()
      if (!home || !expectedBounds || (bounds.x === expectedBounds.x && bounds.y === expectedBounds.y)) return
      const dx = bounds.x - expectedBounds.x, dy = bounds.y - expectedBounds.y
      home = { ...home, x: home.x + dx, y: home.y + dy }; expectedBounds = bounds
      state.position = { x: home.x, y: home.y }
      if (!dragging) schedulePositionSave()
    })
    win.on('blur', () => { interactive = false; pointerPressed = false; stopDrag() })
    win.on('closed', () => {
      if (pet !== win) return
      loaded = false; pet = null; panel = null; home = undefined; expectedBounds = undefined; delete state.layout; stopHitTesting()
    })
    win.webContents.on('render-process-gone', () => {
      state.open = false; state.error = '伙伴窗口已中断，可通过顶栏“找回桌宠”重新打开。'
      stopHitTesting(); stopDrag(); win.destroy(); publish()
    })
    recoverPosition()
    pointerPolicy()
    try {
      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await win.loadURL(new URL('pet.html', process.env.ELECTRON_RENDERER_URL).href)
      else await win.loadFile(join(mainDirectory, '../renderer/pet.html'))
      if (disposed || win.isDestroyed()) return
      loaded = true; publish()
      if (shown()) { voice?.setPetActive(win, true); win.showInactive(); startHitTesting() }
    } catch {
      if (!win.isDestroyed()) win.destroy()
      state.open = false; state.error = '桌面伙伴未能打开，请通过顶栏重试。'; publish()
    }
  }
  function applyVisibility() {
    if (pet && !pet.isDestroyed()) voice?.setPetActive(pet, shown())
    if (!shown()) { closePanel(); stopHitTesting(); if (pet && !pet.isDestroyed()) pet.hide(); stopDrag(); return }
    void ensureWindow().then(() => { if (shown() && loaded && pet && !pet.isDestroyed()) { pet.showInactive(); startHitTesting() } })
  }
  function setUserOpen(choice: boolean | 'toggle', locate = false): Promise<void> {
    return enqueue(async () => {
      if (disposed) throw new AppError('FEATURE_UNAVAILABLE', '桌宠窗口已关闭。', { recoverable: true })
      const next = choice === 'toggle' ? !enabled || state.context.mode === 'hidden' : choice
      const preferences = locate ? { ...state.preferences, clickThrough: false } : state.preferences
      const target = locate ? recoveredHome(true) : undefined
      const position = target ? { x: target.x, y: target.y } : state.position
      // Recovery is a saved user choice, not an incidental native move event.
      // A failed write must leave both the visible location and input policy intact.
      await store.save({ enabled: next, preferences, position })
      if (disposed) return
      if (target) {
        stopDrag(); clearTimeout(saveTimer)
        autoMoving = false; wanderTarget = undefined; pointerPressed = false
      }
      enabled = next; state.preferences = preferences; state.error = null
      if (target) { state.position = position; recoverPosition(); pointerPolicy() }
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
    if (scopeChanged) closePanel()
    if (scopeChanged && pet && !pet.isDestroyed()) voice?.setPetActive(pet, false)
    state.context = { ...context, mode: context.mode === 'detailed' ? 'chibi' : context.mode }
    if (scopeChanged || !context.scope) state.open = enabled && Boolean(context.scope)
    applyVisibility(); publish()
  }, true)
  handle(channels[2]!, async (value, event) => {
    const command = decodeDesktopPetCommand(value)
    if (command.type === 'panel') {
      if (event.sender !== pet?.webContents) throw new AppError('VALIDATION_ERROR', '只有桌宠窗口可以展开面板。', { recoverable: false })
      if (command.panel && (!shown() || dragging)) return
      panel = command.panel; applyLayout(); publish(); return
    }
    if (command.type === 'regions') { regions = command.regions; return }
    if (command.type === 'interaction') { interactionBusy = command.busy; return }
    if (command.type === 'pointer-press') {
      pointerPressed = command.pressed && shown() && !state.preferences.clickThrough
      if (!pointerPressed) stopDrag()
      pointerPolicy(); return
    }
    if (command.type === 'hover') {
      // Forwarded events can target the transparent root while the OS switches
      // hit testing. Once measured regions exist, they are the single owner.
      if (!regions.length) { interactive = command.interactive; pointerPolicy() }
      return
    }
    if (command.type === 'recover-settings') {
      trusted(event, true)
      await enqueue(async () => {
        if (disposed) return
        const saved = await store.recover()
        if (disposed) return
        enabled = saved.enabled; state.preferences = saved.preferences; state.position = saved.position; state.open = false; state.error = null
        applyVisibility(); recoverPosition(); pointerPolicy()
      })
    } else if (command.type === 'configure') {
      await enqueue(async () => {
        if (disposed) throw new AppError('FEATURE_UNAVAILABLE', '桌宠窗口已关闭。', { recoverable: true })
        const current = command.preferences.positionLocked ? home : undefined
        const position = current ? { x: current.x, y: current.y } : state.position
        await store.save({ enabled, preferences: command.preferences, position })
        if (disposed) return
        state.preferences = command.preferences; state.position = position; state.error = null
        if (command.preferences.positionLocked) { autoMoving = false; wanderTarget = undefined }
        if (command.preferences.clickThrough) pointerPressed = false
        if (command.preferences.positionLocked || command.preferences.clickThrough) stopDrag()
        pet?.setAlwaysOnTop(command.preferences.alwaysOnTop)
        recoverPosition(); pointerPolicy()
      })
    } else if (command.type === 'drag-start') {
      if (!pet || !shown() || state.preferences.clickThrough || state.preferences.positionLocked) return
      closePanel(); publish()
      stopDrag(); autoMoving = false; clearTimeout(saveTimer); dragging = true; pointerPolicy()
      const origin = screen.getCursorScreenPoint(), bounds = pet.getBounds(), started = Date.now()
      let previous = origin.x, sampledAt = Date.now()
      publishMotion()
      dragTimer = setInterval(() => {
        if (!pet || pet.isDestroyed() || Date.now() - started > 30_000) { stopDrag(); return }
        const cursor = screen.getCursorScreenPoint()
        const now = Date.now()
        state.position = { x: Math.round(bounds.x + cursor.x - origin.x), y: Math.round(bounds.y + cursor.y - origin.y) }
        home = { ...bounds, ...state.position }; expectedBounds = home
        pet.setPosition(state.position.x, state.position.y)
        publishMotion((cursor.x - previous) * 1000 / Math.max(1, now - sampledAt))
        previous = cursor.x; sampledAt = now
      }, 16)
      return
    } else if (command.type === 'drag-end') stopDrag()
    else if (command.type === 'hide') await setUserOpen(false)
    else if (command.type === 'enable') await setUserOpen(command.enabled)
    else if (command.type === 'toggle' || command.type === 'locate') {
      await setUserOpen(command.type === 'locate' ? true : 'toggle', command.type === 'locate')
      applyVisibility()
    } else if (command.type === 'mode') {
      state.context.mode = 'chibi'; applyVisibility()
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
