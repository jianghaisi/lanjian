import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { transformWithEsbuild } from 'vite'
import * as errors from '../../../src/main/core/errors/app-error'
import * as ipc from '../../../src/contracts/ipc'
import * as contracts from '../../../src/contracts/companion/companion-care'
import { defaultCompanionSettings, type CompanionSettings } from '../../../src/contracts/companion/companion-settings'
import { CompanionCareService } from '../../../src/main/modules/companion/application/companion-care-service'
import { newPetCare } from '../../../src/main/modules/companion/domain/companion-care'

const source = readFile(new URL('../../../src/main/modules/companion/runtime/companion-care-runtime.ts', import.meta.url), 'utf8')
  .then(text => transformWithEsbuild(text, 'companion-care-runtime.ts', { loader: 'ts', format: 'cjs' }))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
type Result = { ok: boolean; value?: contracts.PetCareState; error?: { message: string } }
type Runtime = { setActive(active: boolean): void; configure(settings: CompanionSettings): void; shutdown(): void }

/** Production IPC/timer code and real service/domain; only Electron, clock and disk are replaced. */
async function harness() {
  let time = 0, interval: (() => void) | undefined, readGate: Promise<void> | undefined, failSave = false
  let settings = { ...defaultCompanionSettings(), careEnabled: true }
  let state = newPetCare('2026-10-01'), queue: Promise<unknown> = Promise.resolve()
  const handlers = new Map<string, (event: { allowed: boolean }, input?: unknown) => Promise<Result>>()
  const serial = <T>(run: () => T | Promise<T>) => { const next = queue.then(run); queue = next.catch(() => {}); return next }
  class Store {
    read() { return serial(() => structuredClone(state)) }
    update(run: (before: contracts.PetCareState) => contracts.PetCareState) {
      return serial(() => {
        const before = structuredClone(state), next = run(before)
        if (next !== before && failSave) { failSave = false; throw new errors.AppError('STORAGE_ERROR', '未能保存', { recoverable: true }) }
        state = structuredClone(next); return structuredClone(state)
      })
    }
    recover() { return serial(() => { state = newPetCare('2026-10-01'); return structuredClone(state) }) }
  }
  const exported: { exports: { registerCompanionCare?: (...args: unknown[]) => Runtime } } = { exports: {} }
  const publications: Array<{ channel: string; value: unknown }> = []
  new Script((await source).code, { filename: 'companion-care-runtime.ts:production-module' }).runInNewContext({
    module: exported, exports: exported.exports, performance: { now: () => time },
    setInterval: (callback: () => void, delay: number) => { assert.equal(delay, 5000); interval = callback; return { unref() {} } },
    clearInterval: () => { interval = undefined },
    require: (name: string) => {
      if (name === 'electron') return { ipcMain: {
        handle: (channel: string, callback: (event: { allowed: boolean }, input?: unknown) => Promise<Result>) => handlers.set(channel, callback),
        removeHandler: (channel: string) => handlers.delete(channel),
      } }
      if (name === '../../../core/errors/app-error') return errors
      if (name === '../../../../contracts/ipc') return ipc
      if (name === '../../../../contracts/companion/companion-care') return contracts
      if (name === '../adapters/companion-care-store') return { CompanionCareStore: Store }
      if (name === '../application/companion-care-service') return { CompanionCareService }
      throw new Error(`Unexpected care dependency: ${name}`)
    },
  })
  const runtime = exported.exports.registerCompanionCare!('/isolated-memory-profile', (event: { allowed: boolean }) => {
    if (!event.allowed) throw new errors.AppError('FEATURE_UNAVAILABLE', '未授权', { recoverable: true })
  }, async () => { const snapshot = settings, gate = readGate; readGate = undefined; if (gate) await gate; return snapshot },
  (channel: string, value: unknown) => publications.push({ channel, value: structuredClone(value) }))
  const invoke = (action: string, value?: unknown, allowed = true) => handlers.get(`companion-care:${action}`)!({ allowed }, value)
  const request = (action: contracts.PetCareAction) => ({ requestId: crypto.randomUUID(), revision: state.revision, action })
  const act = (action: contracts.PetCareAction) => invoke('act', request(action))
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }
  const at = (value: number) => { time = value }
  const tick = async (value: number) => { at(value); interval?.(); await settle() }
  const configure = (patch: Partial<CompanionSettings> = {}) => { settings = { ...settings, ...patch, revision: settings.revision + 1 }; runtime.configure(settings) }
  configure(); runtime.setActive(true)
  assert.equal((await act({ type: 'focus-start', minutes: 5 })).ok, true)
  return { runtime, configure, at, tick, act, invoke, request, settle, publications, handlers,
    storePreferences: (patch: Partial<CompanionSettings>) => { settings = { ...settings, ...patch, revision: settings.revision + 1 } },
    notifyPreferences: () => runtime.configure(settings),
    read: () => structuredClone(state), delayRead: (gate: Promise<void>) => { readGate = gate }, failSave: () => { failSave = true } }
}

test('equal and unrelated settings do not discard elapsed focus or an already queued tick', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  for (let i = 1; i <= 4; i++) { h.at(i * 1000); h.configure({ reducedMotion: i % 2 === 0 }) }
  await h.tick(5000); assert.equal(h.read().focus?.elapsed, 5)
  const gate = deferred(); h.delayRead(gate.promise); await h.tick(10000)
  h.at(11000); h.configure(); gate.resolve(); await h.settle()
  assert.equal(h.read().focus?.elapsed, 10)
})

test('ordinary successful, duplicate and failed care requests retain the current time segment', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  h.at(1000); const buy = h.request({ type: 'buy', item: 'food' })
  assert.equal((await h.invoke('act', buy)).ok, true)
  h.at(2000); assert.equal((await h.invoke('act', buy)).ok, true)
  h.at(3000); assert.equal((await h.act({ type: 'use', item: 'water' })).ok, true)
  h.at(4000); h.failSave(); assert.equal((await h.act({ type: 'pat' })).ok, false)
  await h.tick(5000)
  assert.equal(h.read().focus?.elapsed, 5); assert.equal(h.read().coins, 32)
  assert.equal(h.read().inventory.food, 4); assert.equal(h.read().inventory.water, 4)
  assert.equal(h.read().receipts.length, 3, 'one focus, one purchase and one use; retry/failure add no receipt')
})

test('ordinary action cannot invalidate an in-flight tick, and busy intervals are counted once later', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  const gate = deferred(); h.delayRead(gate.promise); await h.tick(5000)
  h.at(6000); assert.equal((await h.act({ type: 'pat' })).ok, true)
  await h.tick(10000); gate.resolve(); await h.settle()
  assert.equal(h.read().focus?.elapsed, 5)
  await h.tick(15000); assert.equal(h.read().focus?.elapsed, 15)
})

test('invalid and unauthorized input cannot reset the care clock or write a receipt', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  h.at(3000); assert.equal((await h.invoke('act', { ...h.request({ type: 'pat' }), action: { type: 'unknown' } })).ok, false)
  h.at(4000); assert.equal((await h.invoke('act', h.request({ type: 'pat' }), false)).ok, false)
  await h.tick(5000); assert.equal(h.read().focus?.elapsed, 5)
  assert.equal(h.read().receipts.length, 1)
})

test('pause/resume and sleep/wake exclude the stopped interval and prevent early rewards', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  await h.tick(5000); assert.equal(h.read().focus?.elapsed, 5)
  h.at(6000); await h.act({ type: 'focus-pause' }); await h.tick(10000)
  assert.equal(h.read().focus?.elapsed, 5)
  h.at(11000); await h.act({ type: 'focus-resume' }); await h.tick(15000)
  assert.equal(h.read().focus?.elapsed, 9)
  h.at(16000); await h.act({ type: 'sleep' }); await h.tick(20000)
  h.at(21000); await h.act({ type: 'wake' }); await h.tick(25000)
  assert.equal(h.read().focus?.elapsed, 9); assert.equal(h.read().focus?.status, 'paused')
  assert.equal(h.read().coins, 40); assert.equal(h.read().totals.focus, 0)
})

for (const boundary of ['hidden', 'disabled', 'shutdown'] as const) test(`${boundary} invalidates a pending tick; reactivation excludes the inactive period`, async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  const gate = deferred(); h.delayRead(gate.promise); await h.tick(5000)
  h.at(6000)
  if (boundary === 'hidden') h.runtime.setActive(false)
  else if (boundary === 'disabled') h.configure({ careEnabled: false })
  else h.runtime.shutdown()
  gate.resolve(); await h.settle(); assert.equal(h.read().focus?.elapsed, 0)
  await h.tick(10000); assert.equal(h.read().focus?.elapsed, 0)
  if (boundary === 'shutdown') { assert.equal(h.handlers.size, 0); return }
  h.at(11000)
  if (boundary === 'hidden') h.runtime.setActive(true); else h.configure({ careEnabled: true })
  await h.tick(15000); assert.equal(h.read().focus?.elapsed, 4)
})

test('long suspend gaps stay discarded and the next normal interval resumes once', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  await h.tick(5000); await h.tick(65000); assert.equal(h.read().focus?.elapsed, 5)
  await h.tick(70000); assert.equal(h.read().focus?.elapsed, 10)
  assert.equal(h.read().coins, 40)
})

test('a delayed older preference read cannot erase a confirmed off/on clock boundary', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  const gate = deferred(); h.delayRead(gate.promise); await h.tick(5000)
  h.at(6000); h.configure({ careEnabled: false })
  gate.resolve(); await h.settle()
  h.at(9000); h.configure({ careEnabled: true })
  await h.tick(10000)
  assert.equal(h.read().focus?.elapsed, 1, 'the disabled three seconds must not become online progress')
})

test('a fresh preference read before its notification applies the care boundary only once', async t => {
  const h = await harness(); t.after(() => h.runtime.shutdown())
  h.at(1000); h.configure({ careEnabled: false })
  h.at(4000); h.storePreferences({ careEnabled: true }); await h.invoke('get')
  h.at(4500); h.notifyPreferences()
  await h.tick(5000); assert.equal(h.read().focus?.elapsed, 1)
})
