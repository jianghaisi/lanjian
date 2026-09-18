import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { transformWithEsbuild } from 'vite'
import * as errors from '../../../src/main/core/errors/app-error'
import * as policy from '../../../src/main/modules/companion/application/desktop-pet-policy'
import type { DesktopPetContext, DesktopPetPreferences, DesktopPetState } from '../../../src/contracts/companion/desktop-pet'

const source = readFile(new URL('../../../src/main/modules/companion/desktop-pet-window.ts', import.meta.url), 'utf8').then(text => transformWithEsbuild(text, 'desktop-pet-window.ts', { loader: 'ts', format: 'cjs' }))
const initialContext = (): DesktopPetContext => ({ mode: 'chibi', scope: 'book:1', taskId: '', taskStatus: '', quiet: false, reducedMotion: false, followPointer: true, autoBlink: true, stateFeedback: true, intensity: .45, focusHidden: false })
type InvokeResult = { ok: boolean; value?: DesktopPetState; error?: { code: string; message: string } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }

/** Executes the production module with Electron host adapters. This does not
 * claim native-window rendering coverage; the separate native smoke owns that. */
async function harness(options: { enabled?: boolean; readGate?: Promise<void>; saveGate?: Promise<void>; saveError?: Error } = {}) {
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
  }
  class FakeWindow extends EventEmitter {
    webContents = new Contents()
    destroyed = false; visible = false; focused = false; minimized = false
    showInactiveCount = 0; topCalls: boolean[] = []; ignoreCalls: boolean[] = []; loadedFiles: string[] = []
    bounds = { x: 100, y: 100, width: 1440, height: 900 }
    constructor(readonly options: Record<string, unknown> = {}) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
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
    setBounds(value: typeof this.bounds) { this.bounds = { ...value }; this.emit('move') }
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; this.emit('move') }
    async loadFile(path: string) { this.loadedFiles.push(path) }
    async loadURL(path: string) { this.loadedFiles.push(path) }
    close() { let prevented = false; this.emit('close', { preventDefault: () => { prevented = true } }); if (!prevented) this.destroy() }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.visible = false; this.emit('closed') } }
  }
  class Store {
    constructor(directory: string) { assert.equal(directory, '/isolated-test-user-data') }
    // Existing window tests use an explicitly opted-in user; default-off cases override enabled.
    async read() { if (options.readGate) await options.readGate; return { enabled: options.enabled ?? true, preferences: { ...policy.defaultDesktopPetPreferences }, position: null } }
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
  const electron = { app: { isPackaged: true, getPath: () => '/isolated-test-user-data' }, BrowserWindow: FakeWindow, screen,
    ipcMain: { handle: (channel: string, callback: (event: unknown, value?: unknown) => Promise<InvokeResult>) => { assert.ok(!handlers.has(channel)); handlers.set(channel, callback) }, removeHandler: (channel: string) => handlers.delete(channel) }
  }
  const exported: { exports: { attachDesktopPet?: (owner: FakeWindow) => { dispose(): void } } } = { exports: {} }
  const timer = (callback: () => void, delay: number, repeating = false) => { const id = nextTimer++; timers.set(id, callback); (repeating ? intervals : timeouts).set(id, { callback, delay }); return id }
  const clearTimer = (id: number) => { timers.delete(id); intervals.delete(id); timeouts.delete(id) }
  new Script((await source).code, { filename: 'desktop-pet-window.ts:production-module' }).runInNewContext({
    module: exported, exports: exported.exports, __dirname: '/compiled/main', process: { env: {} }, structuredClone, URL, Date,
    setTimeout: timer, setInterval: (callback: () => void, delay: number) => timer(callback, delay, true), clearTimeout: clearTimer, clearInterval: clearTimer,
    require: (name: string) => {
      imports.push(name)
      if (name === 'electron') return electron
      if (name === 'node:path') return { join }
      if (name === '../../core/errors/app-error') return errors
      if (name === './application/desktop-pet-policy') return { ...policy, DesktopPetPreferencesStore: Store }
      throw new Error(`unexpected desktop pet host dependency: ${name}`)
    }
  })
  const owner = new FakeWindow(), attachment = exported.exports.attachDesktopPet!(owner)
  const invoke = (channel: string, sender = owner.webContents, value?: unknown, frame = sender.mainFrame) => {
    const handler = handlers.get(`desktop-pet:${channel}`)
    assert.ok(handler, `missing desktop pet ${channel} handler`)
    return handler({ sender, senderFrame: frame }, value)
  }
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  const open = async () => { assert.equal((await invoke('context', owner.webContents, initialContext())).ok, true); await settle(); const pet = windows.find(window => window !== owner); assert.ok(pet); return pet }
  return { owner, windows, FakeWindow, invoke, open, settle, attachment, handlers, screen, cursor, timers, intervals, timeouts, saves, imports }
}

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
    assert.deepEqual(h.imports.sort(), ['./application/desktop-pet-policy', '../../core/errors/app-error', 'electron', 'node:path'].sort())
    assert.ok(pet.loadedFiles[0]?.endsWith('pet.html'))
  } finally { h.attachment.dispose() }
})

test('configure persistence failure cannot acknowledge preferences or apply top/scale change', async () => {
  const failure = new errors.AppError('STORAGE_ERROR', '保存失败', { recoverable: true })
  const h = await harness({ saveError: failure })
  try {
    const pet = await h.open(), previous = (await h.invoke('get')).value!
    const proposed: DesktopPetPreferences = { scale: 1.5, alwaysOnTop: false, clickThrough: true, reminderMinutes: 25 }
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
    assert.deepEqual(pet.topCalls, [false]); assert.equal(pet.webContents.zoom, 1.5)
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

test('OS cursor hit regions own click-through at scaled coordinates; forwarded hover cannot undo them', async () => {
  const h = await harness()
  try {
    const pet = await h.open()
    await h.invoke('command', pet.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.5 } })
    await h.invoke('command', pet.webContents, { type: 'regions', regions: [{ x: 10, y: 20, width: 30, height: 40 }] })
    const poll = [...h.intervals.values()].find(timer => timer.delay === 40)
    assert.ok(poll)
    Object.assign(h.cursor, { x: pet.bounds.x + 15 * 1.5, y: pet.bounds.y + 25 * 1.5 })
    poll.callback()
    assert.equal(pet.ignoreCalls.at(-1), false)
    const hitCalls = pet.ignoreCalls.length
    poll.callback()
    await h.invoke('command', pet.webContents, { type: 'hover', interactive: false })
    assert.equal(pet.ignoreCalls.length, hitCalls, 'forwarded root hover overrode a genuine OS-region hit')
    Object.assign(h.cursor, { x: pet.bounds.x + 100 * 1.5, y: pet.bounds.y + 100 * 1.5 })
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
    await h.open()
    const configure = h.invoke('command', h.owner.webContents, { type: 'configure', preferences: { ...policy.defaultDesktopPetPreferences, scale: 1.3 } })
    await h.settle()
    assert.equal(h.saves.length, 1)
    const positionSave = [...h.timeouts.values()].find(timer => timer.delay === 250)
    assert.ok(positionSave)
    positionSave.callback(); await h.settle()
    h.owner.destroy(); gate.resolve()
    await configure; await h.settle()
    assert.equal(h.saves.length, 1, 'queued position write outlived owner disposal')
    assert.equal(h.timers.size, 0)
  } finally { gate.resolve(); h.attachment.dispose() }
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
