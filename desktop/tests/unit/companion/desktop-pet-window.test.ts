import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { transformWithEsbuild } from 'vite'
import * as errors from '../../../src/main/core/errors/app-error'
import * as policy from '../../../src/main/modules/companion/application/desktop-pet-policy'
import * as layout from '../../../src/main/modules/companion/application/desktop-pet-layout'
import * as outputDirectory from '../../../src/main/platform/processes/main-output-directory'
import * as windowSecurity from '../../../src/main/bootstrap/window-security'
import type { DesktopPetContext, DesktopPetPreferences, DesktopPetState } from '../../../src/contracts/companion/desktop-pet'

const source = readFile(new URL('../../../src/main/modules/companion/desktop-pet-window.ts', import.meta.url), 'utf8').then(text => transformWithEsbuild(text, 'desktop-pet-window.ts', { loader: 'ts', format: 'cjs' }))
const mainSource = readFile(new URL('../../../src/main/bootstrap/create-main-window.ts', import.meta.url), 'utf8').then(text => transformWithEsbuild(text, 'create-main-window.ts', { loader: 'ts', format: 'cjs' }))
const initialContext = (): DesktopPetContext => ({ mode: 'chibi', scope: 'book:1', taskId: '', taskStatus: '', quiet: false, reducedMotion: false, followPointer: true, autoBlink: true, stateFeedback: true, intensity: .45, focusHidden: false })
type InvokeResult = { ok: boolean; value?: DesktopPetState; error?: { code: string; message: string } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }

/** Executes the production module with Electron host adapters. This does not
 * claim native-window rendering coverage; the separate native smoke owns that. */
async function harness(options: { mainWindow?: boolean; enabled?: boolean; saved?: policy.StoredDesktopPetPreferences; quantized?: boolean; readGate?: Promise<void>; saveGate?: Promise<void>; saveError?: Error; activity?: {roam:boolean;follow:boolean;reduced:boolean;sleeping:boolean;focus:boolean} } = {}) {
  const timers = new Map<number, () => void>(), intervals = new Map<number, { callback: () => void; delay: number }>(), timeouts = new Map<number, { callback: () => void; delay: number }>(); let nextTimer = 1
  const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<InvokeResult>>()
  const saves: policy.StoredDesktopPetPreferences[] = [], imports: string[] = []
  const windows: FakeWindow[] = []
  class Contents extends EventEmitter {
    mainFrame = {}
    sent: Array<{ channel: string; value: unknown }> = []
    zoom = 1
    openHandler?: () => { action: string }
    permissionRequest?: (_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void
    permissionCheck?: () => boolean
    session = {
      setPermissionRequestHandler: (handler: Contents['permissionRequest']) => { this.permissionRequest = handler },
      setPermissionCheckHandler: (handler: Contents['permissionCheck']) => { this.permissionCheck = handler }
    }
    send(channel: string, value: unknown) { this.sent.push({ channel, value: structuredClone(value) }) }
    setWindowOpenHandler(handler: Contents['openHandler']) { this.openHandler = handler }
    setZoomFactor(value: number) { this.zoom = value }
    getZoomFactor() { return this.zoom }
    getURL() { return 'file:///compiled/renderer/pet.html' }
    isDestroyed() { return false }
  }
  class FakeWindow extends EventEmitter {
    webContents = new Contents()
    destroyed = false; visible = false; focused = false; minimized = false; blockUnload = false
    showInactiveCount = 0; topCalls: boolean[] = []; ignoreCalls: boolean[] = []; loadedFiles: string[] = []
    bounds = { x: 100, y: 100, width: 1440, height: 900 }
    constructor(readonly options: Record<string, unknown> = {}) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    isFocused() { return this.focused }
    restore() { this.minimized = false }
    show() { this.visible = true }
    focus() { this.focused = true }
    showInactive() { this.visible = true; this.showInactiveCount++ }
    hide() { this.visible = false }
    setMenu(_value: unknown) {}
    setIgnoreMouseEvents(value: boolean, _options: unknown) { this.ignoreCalls.push(value) }
    setAlwaysOnTop(value: boolean) { this.topCalls.push(value) }
    getBounds() { return { ...this.bounds } }
    getContentBounds() { return { ...this.bounds } }
    getPosition() { return [this.bounds.x, this.bounds.y] }
    setBounds(value: typeof this.bounds) { this.bounds = options.quantized ? { x: value.x + 1, y: value.y + 1, width: value.width + 1, height: value.height + 1 } : { ...value }; this.emit('move') }
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; this.emit('move') }
    async loadFile(path: string) { this.loadedFiles.push(path) }
    async loadURL(path: string) { this.loadedFiles.push(path) }
    close() {
      let prevented = false; this.emit('close', { preventDefault: () => { prevented = true } })
      if (!prevented) {
        if (this.blockUnload) this.webContents.emit('will-prevent-unload')
        else this.destroy()
      }
    }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.visible = false; this.emit('closed') } }
  }
  class Store {
    constructor(directory: string) { assert.equal(directory, '/isolated-test-user-data') }
    // Existing window tests use an explicitly opted-in user; default-off cases override enabled.
    async read() { if (options.readGate) await options.readGate; return structuredClone(options.saved ?? { enabled: options.enabled ?? true, preferences: { ...policy.defaultDesktopPetPreferences }, position: null }) }
    async save(value: policy.StoredDesktopPetPreferences) {
      saves.push(structuredClone(value))
      if (options.saveGate) await options.saveGate
      if (options.saveError) throw options.saveError
    }
  }
  const cursor = { x: 400, y: 400 }
  const screen = Object.assign(new EventEmitter(), {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    getCursorScreenPoint: () => ({ ...cursor })
  })
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, getPath: () => '/isolated-test-user-data', quitRequests: 0, finalQuits: 0,
    quit() {
      this.quitRequests++
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
      app.emit('before-quit', event)
      if (event.defaultPrevented) return
      for (const window of windows) if (!window.destroyed) window.close()
      if (windows.every(window => window.destroyed)) { this.finalQuits++; app.emit('will-quit') }
    }
  })
  const electron = { app, BrowserWindow: FakeWindow, screen,
    ipcMain: Object.assign(new EventEmitter(), { handle: (channel: string, callback: (event: unknown, value?: unknown) => Promise<InvokeResult>) => { assert.ok(!handlers.has(channel)); handlers.set(channel, callback) }, removeHandler: (channel: string) => handlers.delete(channel) })
  }
  const exported: { exports: { attachDesktopPet?: (owner: FakeWindow, voice?: unknown) => { dispose(): void } } } = { exports: {} }
  const timer = (callback: () => void, delay: number, repeating = false) => { const id = nextTimer++; timers.set(id, callback); (repeating ? intervals : timeouts).set(id, { callback, delay }); return id }
  const clearTimer = (id: number) => { timers.delete(id); intervals.delete(id); timeouts.delete(id) }
  const context = {
    module: exported, exports: exported.exports, __dirname: '/compiled/main', process: { env: {} }, structuredClone, URL, Date,
    setTimeout: timer, setInterval: (callback: () => void, delay: number) => timer(callback, delay, true), clearTimeout: clearTimer, clearInterval: clearTimer,
    require: (name: string) => {
      imports.push(name)
      if (name === 'electron') return electron
      if (name === 'node:path') return { join }
      if (name === '../../core/errors/app-error') return errors
      if (name === '../../platform/processes/main-output-directory' || name === '../platform/processes/main-output-directory') return outputDirectory
      if (name === '../modules/companion/desktop-pet-window') return exported.exports
      if (name === './window-security') return windowSecurity
      if (name === './application/desktop-pet-policy') return { ...policy, DesktopPetPreferencesStore: Store }
      if (name === './application/desktop-pet-layout') return layout
      throw new Error(`unexpected desktop pet host dependency: ${name}`)
    }
  }
  new Script((await source).code, { filename: 'desktop-pet-window.ts:production-module' }).runInNewContext(context)
  let owner: FakeWindow, attachment: { dispose(): void }
  if (options.mainWindow) {
    const main: { exports: { createMainWindow?: (runtime: unknown) => void } } = { exports: {} }
    new Script((await mainSource).code, { filename: 'create-main-window.ts:production-module' }).runInNewContext({ ...context, module: main, exports: main.exports, __LANJIAN_DEV_SCENARIOS__: false })
    main.exports.createMainWindow!({ writingAgentPreviews: { cancel() {} } })
    owner = windows[0]!; attachment = { dispose: () => owner.destroy() }
  } else {
    owner = new FakeWindow(); attachment = exported.exports.attachDesktopPet!(owner, options.activity ? {attach(){},setPetActive(){},activity:()=>options.activity} : undefined)
  }
  const invoke = (channel: string, sender = owner.webContents, value?: unknown, frame = sender.mainFrame) => {
    const handler = handlers.get(`desktop-pet:${channel}`)
    assert.ok(handler, `missing desktop pet ${channel} handler`)
    return handler({ sender, senderFrame: frame }, value)
  }
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  const open = async () => { assert.equal((await invoke('context', owner.webContents, initialContext())).ok, true); await settle(); const pet = windows.find(window => window !== owner); assert.ok(pet); return pet }
  return { owner, windows, FakeWindow, invoke, open, settle, attachment, handlers, screen, cursor, timers, intervals, timeouts, saves, imports, app, ipcMain: electron.ipcMain }
}

test('global quit waits for the owner save decision; cancelling retains the pet and later explicit close still opts out', async () => {
  const h = await harness({ mainWindow: true })
  try {
    const pet = await h.open()
    h.app.quit(); h.app.quit(); await h.settle()
    assert.equal(h.owner.webContents.sent.filter(x => x.channel === 'app:before-close').length, 1, 'repeat quit must share the pending save check')
    assert.equal(pet.visible, true, 'global quit must not treat the pet as an explicit close')
    assert.equal(h.saves.length, 0, 'waiting for confirmation must not write opt-out')
    h.ipcMain.emit('app:close-ready', { sender: h.owner.webContents }, false)
    assert.equal(h.owner.destroyed, false); assert.equal(pet.destroyed, false)
    assert.equal((await h.invoke('get')).value?.enabled, true)
    pet.close(); await h.settle()
    assert.equal(h.saves.at(-1)?.enabled, false, 'cancelling global quit must not disable explicit pet close')
    assert.equal(pet.visible, false); assert.equal(h.app.finalQuits, 0)
  } finally { h.attachment.dispose() }
})

test('confirmed global quit disposes pet resources without changing either enabled choice or keeping a quit listener', async () => {
  for (const enabled of [true, false]) {
    const h = await harness({ mainWindow: true, enabled })
    try {
      if (enabled) await h.open()
      h.app.quit(); await h.settle()
      h.ipcMain.emit('app:close-ready', { sender: {} }, true)
      assert.equal(h.owner.destroyed, false, 'untrusted sender cannot authorize quit')
      h.ipcMain.emit('app:close-ready', { sender: h.owner.webContents }, true)
      assert.ok(h.windows.every(window => window.destroyed))
      assert.equal(h.saves.length, 0); assert.equal(h.app.finalQuits, 1)
      assert.equal(h.app.listenerCount('before-quit'), 0)
      assert.equal(h.ipcMain.listenerCount('app:close-ready'), 0)
      assert.equal(h.handlers.size, 0); assert.equal(h.timers.size, 0)
    } finally { h.attachment.dispose() }
  }
})

test('renderer beforeunload veto clears the global quit intent and a later owner close needs a fresh save check', async () => {
  const h = await harness({ mainWindow: true })
  try {
    const pet = await h.open(); h.owner.blockUnload = true
    h.app.quit(); await h.settle()
    h.ipcMain.emit('app:close-ready', { sender: h.owner.webContents }, true)
    assert.equal(h.owner.destroyed, false); assert.equal(pet.visible, true)
    h.owner.blockUnload = false; h.owner.close()
    assert.equal(h.owner.webContents.sent.filter(x => x.channel === 'app:before-close').length, 2)
    assert.equal(h.owner.destroyed, false)
    h.ipcMain.emit('app:close-ready', { sender: h.owner.webContents }, true)
    assert.equal(h.owner.destroyed, true); assert.equal(pet.destroyed, true)
    assert.equal(h.app.quitRequests, 1, 'a vetoed app quit must not turn a later plain window close into a new app quit')
    assert.equal(h.saves.length, 0)
  } finally { h.attachment.dispose() }
})

test('locate saves the recovered home before acknowledging, preserving it after restart even with a side panel', async () => {
  const gate = deferred<void>(), saved = { enabled: true, preferences: { ...policy.defaultDesktopPetPreferences, clickThrough: true, positionLocked: true }, position: { x: 20, y: 30 } }
  const h = await harness({ saved, saveGate: gate.promise })
  try {
    const pet = await h.open()
    await h.invoke('command', pet.webContents, { type: 'panel', panel: 'settings' })
    const before = pet.getBounds(), operation = h.invoke('command', h.owner.webContents, { type: 'locate' })
    await h.settle()
    assert.deepEqual(pet.getBounds(), before, 'pending save must not move the pet')
    assert.equal((await h.invoke('get')).value!.preferences.clickThrough, true)
    gate.resolve(); const result = await operation
    assert.equal(result.ok, true)
    assert.notDeepEqual(result.value!.position, saved.position)
    assert.deepEqual(h.saves.at(-1)!.position, result.value!.position)
    assert.equal(result.value!.preferences.clickThrough, false)
    assert.equal(result.value!.preferences.positionLocked, true)
    const restarted = await harness({ saved: h.saves.at(-1)! })
    try {
      const restored = await restarted.open(), home = result.value!.position!
      assert.deepEqual(restored.getPosition(), [home.x, home.y])
    } finally { restarted.attachment.dispose() }
  } finally { h.attachment.dispose() }
})

test('failed locate keeps the old home, click-through, visibility and bounds intact', async () => {
  const saved = { enabled: true, preferences: { ...policy.defaultDesktopPetPreferences, clickThrough: true }, position: { x: 20, y: 30 } }
  const h = await harness({ saved, saveError: new Error('disk full') })
  try {
    const pet = await h.open(), before = (await h.invoke('get')).value!, bounds = pet.getBounds()
    const result = await h.invoke('command', h.owner.webContents, { type: 'locate' })
    assert.equal(result.ok, false)
    assert.deepEqual((await h.invoke('get')).value, before)
    assert.deepEqual(pet.getBounds(), bounds)
    assert.equal(pet.visible, true)
  } finally { h.attachment.dispose() }
})

test('locate fits the owner display rather than using the old larger display dimensions', async () => {
  const primary = { x: 0, y: 0, width: 640, height: 400 }, secondary = { x: 1920, y: 0, width: 1920, height: 1040 }
  const h = await harness({ saved: { enabled: true, preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.8 }, position: { x: 2120, y: 0 } } })
  h.owner.bounds = { x: 10, y: 10, width: 300, height: 300 }
  h.screen.getDisplayNearestPoint = (...args: unknown[]) => ({ workArea: (args[0] as { x: number }).x >= secondary.x ? secondary : primary })
  h.screen.getAllDisplays = () => [{ workArea: primary }, { workArea: secondary }]
  try {
    const pet = await h.open()
    assert.ok(pet.bounds.x >= secondary.x)
    const result = await h.invoke('command', h.owner.webContents, { type: 'locate' })
    assert.equal(result.ok, true)
    assert.ok(pet.bounds.x >= 0 && pet.bounds.x + pet.bounds.width <= primary.width)
    assert.ok(pet.bounds.y >= 0 && pet.bounds.y + pet.bounds.height <= primary.height)
    assert.deepEqual(h.saves.at(-1)!.position, result.value!.position)
    assert.equal(result.value!.preferences.scale, 1.8)
  } finally { h.attachment.dispose() }
})

test('short display fits the character independently of panel state and restores the chosen size on a larger display', async () => {
  const h = await harness({ saved: { enabled: true, preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.8 }, position: null } })
  let area = { x: 0, y: 0, width: 640, height: 400 }
  h.screen.getDisplayNearestPoint = () => ({ workArea: area }); h.screen.getAllDisplays = () => [{ workArea: area }]
  try {
    const pet = await h.open(), idle = (await h.invoke('get')).value!.layout!.pet
    assert.ok(idle.y >= 0 && idle.y + idle.height <= area.height)
    for (const panel of ['menu', 'settings', 'care', 'chat', null]) {
      const state = (await h.invoke('command', pet.webContents, { type: 'panel', panel })).value!
      assert.equal(state.layout!.pet.height, idle.height)
      assert.equal(state.preferences.scale, 1.8)
      assert.ok(pet.bounds.x >= 0 && pet.bounds.y >= 0 && pet.bounds.x + pet.bounds.width <= area.width && pet.bounds.y + pet.bounds.height <= area.height)
    }
    area = { x: 0, y: 0, width: 1920, height: 1040 }; h.screen.emit('display-metrics-changed')
    const restored = (await h.invoke('get')).value!
    assert.equal(restored.layout!.pet.height, 240 * 1.8 + 32)
    assert.equal(restored.preferences.scale, 1.8)
    assert.equal(h.saves.length, 0, 'temporary fitting must not overwrite the preference')
  } finally { h.attachment.dispose() }
})

test('automatic movement stays in the work area, yields to interaction and preserves the manual landing point', async () => {
  const activity={roam:false,follow:true,reduced:false,sleeping:false,focus:false},h=await harness({activity})
  try {
    const pet=await h.open(),original=pet.getPosition(),saved=(await h.invoke('get')).value!.position
    const tick=[...h.intervals.values()].find(timer=>timer.delay===40)!.callback
    h.cursor.x=-99999;h.cursor.y=-99999
    for(let i=0;i<1200;i++)tick()
    assert.ok(pet.bounds.x>=0&&pet.bounds.y>=0);assert.notDeepEqual(pet.getPosition(),original)
    assert.deepEqual((await h.invoke('get')).value!.position,saved)
    await h.invoke('command',pet.webContents,{type:'interaction',busy:true});const paused=pet.getPosition();tick();assert.deepEqual(pet.getPosition(),paused)
    await h.invoke('command',pet.webContents,{type:'interaction',busy:false});activity.focus=true;tick();assert.deepEqual(pet.getPosition(),paused)
    activity.focus=false;activity.follow=false;tick();assert.deepEqual(pet.getPosition(),original)
    activity.follow=true;tick()
    await h.invoke('command',pet.webContents,{type:'drag-start'});const grabbed=pet.getPosition()
    h.cursor.x+=40;h.cursor.y+=10
    const drag=[...h.intervals.values()].find(timer=>timer.delay===16)!.callback;drag()
    assert.deepEqual(pet.getPosition(),[grabbed[0]!+40,grabbed[1]!+10])
    await h.invoke('command',pet.webContents,{type:'drag-end'})
    assert.ok(![...h.intervals.values()].some(timer=>timer.delay===16))
  } finally {h.attachment.dispose()}
})
test('work entry, switching and status updates never create a pet before the user opts in', async () => {
  const h = await harness({ enabled: false })
  try {
    for (const scope of ['book:1', 'book:2', '', 'book:1']) {
      for (const mode of ['chibi', 'detailed', 'hidden']) {
        const result = await h.invoke('context', h.owner.webContents, { ...initialContext(), scope, mode, taskStatus: 'running' })
        assert.equal(result.value?.open, false)
      }
    }
    await h.settle()
    assert.equal(h.windows.length, 1, 'disabled pet must not even create a hidden renderer')
    assert.equal(h.saves.length, 0)
    assert.equal(h.timers.size, 0)
  } finally { h.attachment.dispose() }
})

test('explicit opening is persisted, while focus and library exits only hide temporarily', async () => {
  const h = await harness({ enabled: false })
  try {
    await h.invoke('context', h.owner.webContents, initialContext())
    assert.equal((await h.invoke('command', h.owner.webContents, { type: 'toggle' })).value?.open, true)
    await h.settle()
    assert.equal(h.saves.at(-1)?.enabled, true)
    const pet = h.windows[1]!
    assert.equal(pet.visible, true)
    for (const context of [{ ...initialContext(), focusHidden: true }, { ...initialContext(), scope: '' }]) {
      await h.invoke('context', h.owner.webContents, context)
      assert.equal(pet.visible, false)
    }
    assert.equal(h.saves.length, 1, 'temporary hiding must not rewrite user choice')
    await h.invoke('context', h.owner.webContents, { ...initialContext(), scope: 'book:2' })
    await h.settle()
    assert.equal(pet.visible, true)
    const restarted = await harness({ enabled: h.saves.at(-1)!.enabled })
    try { assert.equal((await restarted.open()).visible, true) } finally { restarted.attachment.dispose() }
    await h.invoke('command', h.owner.webContents, { type: 'hide' })
    assert.equal(h.saves.at(-1)?.enabled, false)
    await h.invoke('context', h.owner.webContents, { ...initialContext(), scope: '' })
    await h.invoke('context', h.owner.webContents, initialContext())
    assert.equal((await h.invoke('get')).value?.open, false)
    assert.equal(pet.visible, false)
    const disabledRestart = await harness({ enabled: h.saves.at(-1)!.enabled })
    try {
      await disabledRestart.invoke('context', disabledRestart.owner.webContents, initialContext())
      await disabledRestart.settle()
      assert.equal(disabledRestart.windows.length, 1)
    } finally { disabledRestart.attachment.dispose() }
  } finally { h.attachment.dispose() }
})

test('pending opt-in waits for storage and cannot load a pet after leaving the work', async () => {
  const gate = deferred<void>(), h = await harness({ enabled: false, saveGate: gate.promise })
  try {
    await h.invoke('context', h.owner.webContents, initialContext())
    const pending = h.invoke('command', h.owner.webContents, { type: 'toggle' })
    await h.settle()
    assert.equal((await h.invoke('get')).value?.open, false)
    assert.equal(h.windows.length, 1)
    await h.invoke('context', h.owner.webContents, { ...initialContext(), scope: '' })
    gate.resolve()
    assert.equal((await pending).value?.open, false)
    assert.equal(h.windows.length, 1)
    await h.invoke('context', h.owner.webContents, initialContext())
    await h.settle()
    assert.equal(h.windows[1]?.visible, true)
  } finally { gate.resolve(); h.attachment.dispose() }
})

test('failed explicit opening or closing preserves the prior choice and window state', async () => {
  for (const enabled of [false, true]) {
    const h = await harness({ enabled, saveError: new errors.AppError('STORAGE_ERROR', '保存失败', { recoverable: true }) })
    try {
      await h.invoke('context', h.owner.webContents, initialContext())
      await h.settle()
      const result = await h.invoke('command', h.owner.webContents, { type: 'toggle' })
      assert.equal(result.ok, false)
      assert.equal(result.error?.code, 'STORAGE_ERROR')
      assert.equal((await h.invoke('get')).value?.open, enabled)
      assert.equal(h.windows.length, enabled ? 2 : 1)
      await h.invoke('context', h.owner.webContents, { ...initialContext(), scope: 'book:2' })
      assert.equal((await h.invoke('get')).value?.open, enabled)
    } finally { h.attachment.dispose() }
  }
})

test('queued toggle and appearance saves retain the latest explicit enabled choice', async () => {
  const h = await harness({ enabled: false })
  try {
    await h.invoke('context', h.owner.webContents, initialContext())
    const results = await Promise.all([
      h.invoke('command', h.owner.webContents, { type: 'toggle' }),
      h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.5 } }),
      h.invoke('command', h.owner.webContents, { type: 'toggle' })
    ])
    assert.ok(results.every(result => result.ok))
    assert.deepEqual(h.saves.map(value => value.enabled), [true, true, false])
    assert.equal(h.saves.at(-1)?.preferences.scale, 1.5)
    assert.equal((await h.invoke('get')).value?.open, false)
  } finally { h.attachment.dispose() }
})

test('desktop pet accepts main-frame owner commands and pet commands, but not stranger/subframe/context impersonation', async () => {
  const h = await harness()
  try {
    const pet = await h.open(), stranger = new h.FakeWindow()
    assert.equal((await h.invoke('get', pet.webContents)).ok, true)
    assert.equal((await h.invoke('command', pet.webContents, { type: 'hover', interactive: true })).ok, true)
    for (const channel of ['get', 'command', 'context']) {
      const value = channel === 'context' ? initialContext() : channel === 'command' ? { type: 'hide' } : undefined
      assert.equal((await h.invoke(channel, stranger.webContents, value)).error?.code, 'VALIDATION_ERROR')
      assert.equal((await h.invoke(channel, h.owner.webContents, value, {})).error?.code, 'VALIDATION_ERROR')
      assert.equal((await h.invoke(channel, pet.webContents, value, {})).error?.code, 'VALIDATION_ERROR')
    }
    assert.equal((await h.invoke('context', pet.webContents, { ...initialContext(), scope: 'spoofed-book' })).error?.code, 'VALIDATION_ERROR')
    assert.equal((await h.invoke('get')).value?.context.scope, 'book:1')
    assert.equal((await h.invoke('get')).value?.open, true)
    await h.invoke('context', h.owner.webContents, { ...initialContext(), taskStatus: 'running', stateFeedback: false })
    assert.equal((await h.invoke('get')).value?.context.stateFeedback, false)
    const feedbackState = pet.webContents.sent.filter(message => message.channel === 'desktop-pet:state').at(-1)!.value as DesktopPetState
    assert.equal(feedbackState.context.stateFeedback, false)
  } finally { h.attachment.dispose() }
})

test('production window is isolated, non-focusing and denies navigation, permission requests and popup APIs', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    const preferences = pet.options.webPreferences as Record<string, unknown>
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.partition, 'lanjian-desktop-pet')
    assert.equal(pet.options.transparent, true); assert.equal(pet.options.frame, false); assert.equal(pet.options.skipTaskbar, true)
    assert.ok(pet.showInactiveCount > 0); assert.equal(pet.focused, false)
    assert.equal(pet.webContents.openHandler?.().action, 'deny')
    let permitted: boolean | undefined
    pet.webContents.permissionRequest?.(pet.webContents, 'camera', allowed => { permitted = allowed })
    assert.equal(permitted, false); assert.equal(pet.webContents.permissionCheck?.(), false)
    for (const name of ['will-navigate', 'will-redirect']) { let prevented = false; pet.webContents.emit(name, { preventDefault: () => { prevented = true } }); assert.equal(prevented, true) }
    assert.deepEqual([...h.handlers.keys()].sort(), ['desktop-pet:command', 'desktop-pet:context', 'desktop-pet:get'])
    assert.deepEqual(h.imports.sort(), ['./application/desktop-pet-policy', './application/desktop-pet-layout', '../../core/errors/app-error', '../../platform/processes/main-output-directory', 'electron', 'node:path'].sort())
    assert.ok(pet.loadedFiles[0]?.endsWith('pet.html'))
  } finally { h.attachment.dispose() }
})

test('configure persistence failure cannot acknowledge preferences or apply top/scale change', async () => {
  const failure = new errors.AppError('STORAGE_ERROR', '保存失败', { recoverable: true })
  const h = await harness({ saveError: failure })
  try {
    const pet = await h.open(), previous = (await h.invoke('get')).value!
    const proposed: DesktopPetPreferences = { scale: 1.5, alwaysOnTop: false, clickThrough: true, positionLocked: false, reminderMinutes: 25 }
    const result = await h.invoke('command', h.owner.webContents, { type: 'configure', preferences: proposed })
    assert.equal(result.ok, false); assert.equal(result.error?.code, 'STORAGE_ERROR')
    assert.deepEqual((await h.invoke('get')).value?.preferences, previous.preferences)
    assert.deepEqual(pet.topCalls, []); assert.equal(pet.webContents.zoom, 1)
    for (const message of h.owner.webContents.sent) if (message.channel === 'desktop-pet:state') assert.deepEqual((message.value as DesktopPetState).preferences, previous.preferences)
  } finally { h.attachment.dispose() }
})

test('configure waits for durable save before applying its acknowledged preferences', async () => {
  const gate = deferred<void>(), h = await harness({ saveGate: gate.promise })
  try {
    const pet = await h.open(), proposed = { ...policy.defaultDesktopPetPreferences, alwaysOnTop: false, scale: 1.5 }
    const pending = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: proposed })
    await h.settle()
    assert.equal((await h.invoke('get')).value?.preferences.scale, 1)
    assert.deepEqual(pet.topCalls, [])
    gate.resolve(); assert.equal((await pending).ok, true)
    assert.deepEqual((await h.invoke('get')).value?.preferences, proposed)
    assert.deepEqual(pet.topCalls, [false]); assert.equal(pet.webContents.zoom, 1)
    assert.equal(pet.bounds.width, 480, 'acknowledged character scale still resizes its native surface')
  } finally { gate.resolve(); h.attachment.dispose() }
})

test('native pet close hides only pet and owner close destroys pet plus IPC/display/timer resources', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    assert.equal(h.intervals.size, 1)
    pet.close()
    await h.settle()
    assert.equal(pet.destroyed, false); assert.equal(pet.visible, false); assert.equal(h.owner.destroyed, false)
    assert.equal(h.intervals.size, 0, 'hidden pet retains a no-op hit-test poll')
    assert.equal((await h.invoke('get')).value?.open, false)
    assert.equal(h.saves.at(-1)?.enabled, false)
    await h.invoke('command', h.owner.webContents, { type: 'toggle' }); await h.settle()
    assert.equal(pet.visible, true)
    assert.equal(h.intervals.size, 1, 'reopened pet must have exactly one hit-test poll')
    h.owner.destroy()
    assert.equal(pet.destroyed, true); assert.equal(h.handlers.size, 0); assert.equal(h.timers.size, 0)
    assert.equal(h.screen.listenerCount('display-removed'), 0); assert.equal(h.screen.listenerCount('display-metrics-changed'), 0)
    h.attachment.dispose()
  } finally { h.attachment.dispose() }
})

test('render-process loss clears hit testing and locating creates one fresh poll for the replacement window', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    pet.webContents.emit('render-process-gone')
    assert.equal(pet.destroyed, true); assert.equal(h.intervals.size, 0)
    const failed = (await h.invoke('get')).value!
    assert.equal(failed.open, false); assert.match(failed.error ?? '', /中断/)
    await h.invoke('command', h.owner.webContents, { type: 'locate' }); await h.settle()
    const alive = h.windows.filter(win => win !== h.owner && !win.destroyed)
    assert.equal(alive.length, 1); assert.notEqual(alive[0], pet)
    assert.equal(alive[0]!.visible, true); assert.equal(h.intervals.size, 1)
  } finally { h.attachment.dispose() }
})

test('character scale keeps page text at native size; OS hit regions still own click-through', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    await h.invoke('command', pet.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: .6 } })
    assert.equal(pet.webContents.zoom, 1, 'small character must not shrink panel typography')
    assert.ok(pet.bounds.width >= 320 && pet.bounds.height >= 460, 'small character retains a readable interaction surface')
    await h.invoke('command', pet.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.5 } })
    assert.equal(pet.webContents.zoom, 1)
    await h.invoke('command', pet.webContents, { type: 'regions', regions: [{ x: 10, y: 20, width: 30, height: 40 }] })
    const poll = [...h.intervals.values()].find(timer => timer.delay === 40)
    assert.ok(poll)
    Object.assign(h.cursor, { x: pet.bounds.x + 15, y: pet.bounds.y + 25 })
    poll.callback()
    assert.equal(pet.ignoreCalls.at(-1), false)
    const hitCalls = pet.ignoreCalls.length
    poll.callback()
    await h.invoke('command', pet.webContents, { type: 'hover', interactive: false })
    assert.equal(pet.ignoreCalls.length, hitCalls, 'forwarded root hover overrode a genuine OS-region hit')
    Object.assign(h.cursor, { x: pet.bounds.x + 100, y: pet.bounds.y + 100 })
    poll.callback()
    assert.equal(pet.ignoreCalls.at(-1), true)
    const outsideCalls = pet.ignoreCalls.length
    await h.invoke('command', pet.webContents, { type: 'hover', interactive: true })
    assert.equal(pet.ignoreCalls.length, outsideCalls, 'forwarded hover unlocked a non-interactive region')
  } finally { h.attachment.dispose() }
})

test('pet return-to-writing/settings requests activate owner and emit only allowlisted UI actions', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    h.owner.minimized = true
    for (const type of ['return-to-writing', 'settings']) assert.equal((await h.invoke('command', pet.webContents, { type })).ok, true)
    assert.equal(h.owner.minimized, false); assert.equal(h.owner.visible, true); assert.equal(h.owner.focused, true)
    assert.deepEqual(h.owner.webContents.sent.filter(message => message.channel === 'desktop-pet:action').map(message => message.value), ['return-to-writing', 'settings'])
    assert.equal((await h.invoke('command', pet.webContents, { type: 'generate-chapter' })).error?.code, 'VALIDATION_ERROR')
    assert.equal(h.saves.length, 0)
  } finally { h.attachment.dispose() }
})

test('owner closed while preferences load rejects a previously admitted configure without saving', async () => {
  const gate = deferred<void>(), h = await harness({ readGate: gate.promise })
  try {
    const pending = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.5 } })
    h.owner.destroy(); gate.resolve()
    const result = await pending
    assert.equal(result.ok, false, 'closed owner must not retain command authority after preferences load')
    assert.equal(h.saves.length, 0, 'closed owner command must not write preferences')
    assert.equal(h.windows.length, 1)
  } finally { gate.resolve(); h.attachment.dispose() }
})

test('owner close prevents a queued configure from writing and prevents a late in-flight save from applying window preferences', async () => {
  const gate = deferred<void>(), h = await harness({ saveGate: gate.promise })
  try {
    const pet = await h.open()
    const first = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.3 } })
    const second = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.6 } })
    await h.settle()
    assert.equal(h.saves.length, 1)
    h.owner.destroy(); gate.resolve()
    await first
    assert.equal((await second).ok, false, 'queued configure cannot outlive owner authority')
    assert.equal(h.saves.length, 1, 'queued configure wrote after owner close')
    assert.equal(pet.destroyed, true); assert.equal(pet.webContents.zoom, 1)
    assert.deepEqual(pet.topCalls, [])
  } finally { gate.resolve(); h.attachment.dispose() }
})

test('position-save callback already queued behind a pending save cannot write after owner closes', async () => {
  const gate = deferred<void>(), h = await harness({ saveGate: gate.promise })
  try {
    const pet = await h.open()
    const configure = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.3 } })
    await h.settle()
    assert.equal(h.saves.length, 1)
    pet.setPosition(pet.bounds.x - 20, pet.bounds.y)
    const positionSave = [...h.timeouts.values()].find(timer => timer.delay === 250)
    assert.ok(positionSave)
    positionSave.callback(); await h.settle()
    h.owner.destroy(); gate.resolve()
    await configure; await h.settle()
    assert.equal(h.saves.length, 1, 'queued position write outlived owner disposal')
    assert.equal(h.timers.size, 0)
  } finally { gate.resolve(); h.attachment.dispose() }
})

test('side panel expansion preserves home, saved position and character size, including locked settings updates', async () => {
  const h = await harness()
  try {
    const pet = await h.open(), bounds = { ...pet.bounds }, initial = (await h.invoke('get')).value!
    assert.equal((await h.invoke('command', h.owner.webContents, { type: 'panel', panel: 'settings' })).ok, false)
    for (const panel of ['menu', 'chat', 'care', 'settings']) {
      const result = await h.invoke('command', pet.webContents, { type: 'panel', panel })
      assert.equal(result.ok, true)
      const current = result.value!
      assert.equal(current.layout!.kind, panel)
      assert.equal(current.layout!.pet.width, initial.layout!.pet.width)
      if (panel !== 'menu') {
        assert.equal(pet.bounds.x + current.layout!.pet.x, bounds.x + initial.layout!.pet.x)
        assert.equal(pet.bounds.y + current.layout!.pet.y, bounds.y + initial.layout!.pet.y)
      }
      assert.equal(current.layout!.pet.height, initial.layout!.pet.height)
      assert.deepEqual(current.position, initial.position)
    }
    assert.equal(h.saves.length, 0, 'layout must not write preferences or schedule position saves')
    assert.equal([...h.timeouts.values()].some(timer => timer.delay === 250), false)
    await h.invoke('command', pet.webContents, { type: 'configure', preferences: { ...initial.preferences, positionLocked: true } })
    assert.deepEqual(h.saves.at(-1)!.position, initial.position, 'save home rather than expanded native origin')
    await h.invoke('command', pet.webContents, { type: 'panel', panel: null })
    assert.deepEqual(pet.bounds, bounds)
    assert.equal((await h.invoke('get')).value!.layout!.kind, null)
  } finally { h.attachment.dispose() }
})
test('fractional-DPI native bounds rounding never accumulates into the saved home or character anchor', async () => {
  const h = await harness({ quantized: true })
  try {
    const pet = await h.open(), initial = (await h.invoke('get')).value!
    const anchor = { x: pet.bounds.x + initial.layout!.pet.x, y: pet.bounds.y + initial.layout!.pet.y }
    for (let i = 0; i < 8; i++) for (const panel of ['settings', null]) {
      const result = (await h.invoke('command', pet.webContents, { type: 'panel', panel })).value!
      assert.deepEqual(result.position, initial.position)
      assert.equal(pet.bounds.x + result.layout!.pet.x, anchor.x)
      assert.equal(pet.bounds.y + result.layout!.pet.y, anchor.y)
      pet.emit('move') // Windows may deliver another move after setBounds returns.
      assert.deepEqual((await h.invoke('get')).value!.position, initial.position)
    }
    assert.equal(h.saves.length, 0)
    assert.equal([...h.timeouts.values()].some(timer => timer.delay === 250), false)
  } finally { h.attachment.dispose() }
})
test('unchanged panel geometry retains its hit map after saving preferences', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    const state = (await h.invoke('command', pet.webContents, { type: 'panel', panel: 'settings' })).value!
    const panel = state.layout!.panel!
    await h.invoke('command', pet.webContents, { type: 'regions', regions: [panel] })
    Object.assign(h.cursor, { x: pet.bounds.x + panel.x + 40, y: pet.bounds.y + panel.y + 40 })
    const tick = [...h.intervals.values()].find(timer => timer.delay === 40)!.callback
    tick(); assert.equal(pet.ignoreCalls.at(-1), false)
    await h.invoke('command', pet.webContents, { type: 'configure', preferences: { ...state.preferences, positionLocked: true } })
    tick(); assert.equal(pet.ignoreCalls.at(-1), false, 'unchanged renderer will not resend the same regions')
    pet.webContents.emit('render-process-gone')
    assert.equal((await h.invoke('get')).value!.layout, undefined)
  } finally { h.attachment.dispose() }
})

test('dragging, scope changes and hiding collapse panels without adopting their expanded window origin', async () => {
  const h = await harness()
  try {
    const pet = await h.open(), bounds = { ...pet.bounds }
    await h.invoke('command', pet.webContents, { type: 'panel', panel: 'chat' })
    await h.invoke('command', pet.webContents, { type: 'drag-start' })
    assert.deepEqual(pet.bounds, bounds)
    h.cursor.x += 45
    ;[...h.intervals.values()].find(timer => timer.delay === 16)!.callback()
    await h.invoke('command', pet.webContents, { type: 'drag-end' })
    const position = (await h.invoke('get')).value!.position!
    assert.equal(position.x, bounds.x + 45)
    for (const context of [{ ...initialContext(), scope: 'book:2' }, { ...initialContext(), focusHidden: true }]) {
      await h.invoke('command', pet.webContents, { type: 'panel', panel: 'settings' })
      await h.invoke('context', h.owner.webContents, context)
      assert.equal((await h.invoke('get')).value!.layout!.kind, null)
      assert.deepEqual((await h.invoke('get')).value!.position, position)
    }
  } finally { h.attachment.dispose() }
})

test('idle pet blur does not schedule or replace a position save when no drag took place', async () => {
  const h = await harness()
  try {
    const pet = await h.open(), scheduled = [...h.timeouts.keys()]
    pet.emit('blur')
    assert.deepEqual([...h.timeouts.keys()], scheduled)
    assert.equal(h.saves.length, 0)
  } finally { h.attachment.dispose() }
})


test('cursor entering an interactive region stops follow on that very tick', async () => {
  const h = await harness({ activity: { roam:false, follow:true, reduced:false, sleeping:false, focus:false } })
  try {
    const pet = await h.open(), before = pet.getPosition()
    await h.invoke('command',pet.webContents,{type:'regions',regions:[{x:180,y:280,width:90,height:100}]})
    Object.assign(h.cursor,{x:pet.bounds.x+240,y:pet.bounds.y+330})
    const tick = [...h.intervals.values()].find(timer=>timer.delay===40)!.callback
    tick()
    assert.deepEqual(pet.getPosition(),before,'automatic movement ran before the current pointer hit')
    assert.equal(pet.ignoreCalls.at(-1),false)
    await h.invoke('command',pet.webContents,{type:'interaction',busy:true})
    Object.assign(h.cursor,{x:pet.bounds.x-100,y:pet.bounds.y-100})
    tick();assert.deepEqual(pet.getPosition(),before,'a pressed pointer must keep ownership outside the region')
  } finally { h.attachment.dispose() }
})

test('position lock captures the visible location, stops a drag and blocks both movement owners while locate stays usable', async () => {
  const activity = {roam:false,follow:true,reduced:false,sleeping:false,focus:false}
  const h = await harness({activity})
  try {
    const pet = await h.open(), tick = [...h.intervals.values()].find(timer=>timer.delay===40)!.callback
    Object.assign(h.cursor,{x:10,y:10});tick()
    const visible = pet.getPosition()
    const locked = { ...policy.defaultDesktopPetPreferences,positionLocked:true }
    assert.equal((await h.invoke('command',h.owner.webContents,{type:'configure',preferences:locked})).ok,true)
    assert.deepEqual(h.saves.at(-1)?.position,{x:visible[0],y:visible[1]})
    for(let i=0;i<5;i++)tick()
    await h.invoke('command',pet.webContents,{type:'drag-start'})
    assert.ok(![...h.intervals.values()].some(timer=>timer.delay===16))
    assert.deepEqual(pet.getPosition(),visible)
    assert.equal((await h.invoke('command',h.owner.webContents,{type:'locate'})).ok,true)
    assert.equal((await h.invoke('get',h.owner.webContents)).value?.preferences.positionLocked,true)
    await h.invoke('command',h.owner.webContents,{type:'configure',preferences:{...locked,positionLocked:false}})
    await h.invoke('command',pet.webContents,{type:'drag-start'})
    assert.ok([...h.intervals.values()].some(timer=>timer.delay===16))
    await h.invoke('command',h.owner.webContents,{type:'configure',preferences:locked})
    assert.ok(![...h.intervals.values()].some(timer=>timer.delay===16))
  } finally { h.attachment.dispose() }
})


test('press keeps native input capture outside the body until release, including when position is locked', async () => {
  const h = await harness({activity:{roam:false,follow:true,reduced:false,sleeping:false,focus:false}})
  try {
    const pet=await h.open(), tick=[...h.intervals.values()].find(timer=>timer.delay===40)!.callback
    await h.invoke('command',pet.webContents,{type:'regions',regions:[{x:50,y:50,width:30,height:30}]})
    await h.invoke('command',pet.webContents,{type:'pointer-press',pressed:true})
    const position=pet.getPosition();Object.assign(h.cursor,{x:0,y:0});tick()
    assert.equal(pet.ignoreCalls.at(-1),false,'press lost mouse-up capture over transparent area')
    assert.deepEqual(pet.getPosition(),position)
    await h.invoke('command',pet.webContents,{type:'pointer-press',pressed:false})
    assert.equal(pet.ignoreCalls.at(-1),true)
    await h.invoke('command',pet.webContents,{type:'pointer-press',pressed:true})
    pet.emit('blur');assert.equal(pet.ignoreCalls.at(-1),true,'blur must cancel input capture')
  } finally {h.attachment.dispose()}
})
