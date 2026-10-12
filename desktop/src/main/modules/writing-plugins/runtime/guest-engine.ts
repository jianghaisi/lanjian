import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten-core'
import releaseSync from '@jitl/quickjs-wasmfile-release-sync'
import { assertJson, codePluginLimits, pluginLimits, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { defaultGuestPolicy, guestMethods, validateGuestInvocation, validateGuestPolicy, type GuestBroker, type GuestFailure, type GuestInvocation, type GuestPolicy, type GuestResult, type GuestMethod } from '../domain/guest'
import { guestBootstrap } from './guest-bootstrap'

class GuestFault extends Error { constructor(readonly code: GuestFailure) { super(code) } }

/** One WASM module/runtime per invocation. Only prevalidated source enters this VM. */
export async function executeGuest(invocation: GuestInvocation, wasmBinary: ArrayBuffer, broker: GuestBroker, signal: AbortSignal, policy: GuestPolicy = defaultGuestPolicy): Promise<GuestResult> {
  try { validateGuestInvocation(invocation); validateGuestPolicy(policy) } catch { return { ok: false, code: 'invalid-input' } }
  if (signal.aborted) return { ok: false, code: 'cancelled' }
  const deadline = Date.now() + policy.invocationMs
  const memory = new WebAssembly.Memory({ initial: 256, maximum: codePluginLimits.wasmBytes / 65536 })
  // Supplying bytes and memory removes network/path fallback and Emscripten's 2 GiB default.
  const module = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, {
    wasmBinary, wasmMemory: memory
  }))
  if (module.getWasmMemory() !== memory) return { ok: false, code: 'unavailable' }
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(codePluginLimits.guestHeapBytes)
  runtime.setMaxStackSize(codePluginLimits.guestStackBytes)
  let sliceDeadline = 0, fault: GuestFailure | undefined, alive = true, rpcCount = 0
  let wake: (() => void) | undefined
  const rpcController = new AbortController()
  const abortRpc = () => { rpcController.abort(); wake?.() }
  signal.addEventListener('abort', abortRpc, { once: true })
  runtime.setInterruptHandler(() => {
    if (signal.aborted) fault = 'cancelled'
    else if (Date.now() >= deadline || Date.now() >= sliceDeadline) fault = 'timeout'
    return Boolean(fault)
  })
  runtime.setModuleLoader(() => { fault = 'module-denied'; return { error: new Error('Module imports are unavailable') } })
  const vm = runtime.newContext()
  const handles: QuickJSHandle[] = [], promises = new Set<QuickJSDeferredPromise>()
  const hold = (handle: QuickJSHandle) => { handles.push(handle); return handle }
  function slice<T>(fn: () => T): T {
    if (signal.aborted) throw new GuestFault('cancelled')
    if (Date.now() >= deadline) throw new GuestFault('timeout')
    if (fault) throw new GuestFault(fault)
    sliceDeadline = Math.min(deadline, Date.now() + policy.sliceMs)
    // The caller must own/dispose a returned handle before checking a fault again.
    return fn()
  }
  function unwrap(result: ReturnType<typeof vm.evalCode>): QuickJSHandle {
    if (result.error) { result.error.dispose(); throw new GuestFault(fault ?? 'guest-error') }
    return result.value
  }
  function readString(handle: QuickJSHandle, limit: number): string {
    if (vm.typeof(handle) !== 'string') throw new GuestFault('protocol-error')
    const length = vm.getProp(handle, 'length')
    try { if (vm.getNumber(length) > limit) throw new GuestFault('output-limit') } finally { length.dispose() }
    return vm.getString(handle)
  }
  function readJson(handle: QuickJSHandle, limit: number): JsonValue {
    const value: unknown = JSON.parse(readString(handle, limit))
    assertJson(value, limit)
    return value
  }
  async function settled(handle: QuickJSHandle): Promise<QuickJSHandle> {
    for (;;) {
      const state = slice(() => vm.getPromiseState(handle))
      if (state.type === 'fulfilled') return state.value
      if (state.type === 'rejected') { state.error.dispose(); throw new GuestFault(fault ?? 'guest-error') }
      slice(() => { const jobs = runtime.executePendingJobs(32); if (jobs.error) { jobs.error.dispose(); throw new GuestFault(fault ?? 'guest-error') } })
      // Yield even for an endless resolved-Promise chain so cancellation/watchdogs run.
      if (runtime.hasPendingJob()) await new Promise<void>(resolve => setImmediate(resolve))
      else await new Promise<void>(resolve => {
        const timer = setTimeout(() => { wake = undefined; resolve() }, Math.min(50, Math.max(1, deadline - Date.now())))
        wake = () => { clearTimeout(timer); wake = undefined; resolve() }
      })
    }
  }
  try {
    const bridge = hold(vm.newFunction('hostCall', (methodHandle, inputHandle) => {
      try {
        if (!methodHandle || !inputHandle) throw new GuestFault('protocol-error')
        const method = readString(methodHandle, 40)
        if (!guestMethods.includes(method as GuestMethod)) throw new GuestFault('protocol-error')
        if (++rpcCount > pluginLimits.calls) throw new GuestFault('rpc-limit')
        const input = readJson(inputHandle, pluginLimits.inputBytes)
        const promise = vm.newPromise(); promises.add(promise)
        void Promise.resolve().then(() => {
          if (!alive || rpcController.signal.aborted) throw new GuestFault('cancelled')
          return broker(method as GuestMethod, input, rpcController.signal)
        }).then(value => {
          if (!alive) return
          assertJson(value, pluginLimits.outputBytes)
          const result = vm.newString(JSON.stringify(value)); promise.resolve(result); result.dispose()
        }).catch(() => {
          if (!alive) return
          const error = vm.newError('Host capability unavailable'); promise.reject(error); error.dispose()
        }).finally(() => { if (alive) { promises.delete(promise); promise.dispose(); wake?.() } })
        return promise.handle.dup()
      } catch (error) {
        fault = error instanceof GuestFault ? error.code : 'protocol-error'
        return { error: vm.newError('Invalid host call') }
      }
    }))
    const makeHelpers = hold(slice(() => unwrap(vm.evalCode(guestBootstrap, 'sdk.js'))))
    const helpers = hold(slice(() => unwrap(vm.callFunction(makeHelpers, vm.undefined, bridge))))
    // No bridge is placed on globalThis, even briefly. Plugin errors are never dumped.
    const evaluated = hold(slice(() => unwrap(vm.evalCode(invocation.source, 'plugin.js', { type: 'module' }))))
    const namespace = hold(await settled(evaluated))
    const entry = hold(slice(() => vm.getProp(namespace, invocation.continuation ? 'resume' : 'execute')))
    if (vm.typeof(entry) !== 'function') throw new GuestFault('guest-error')
    const invoke = hold(vm.getProp(helpers, 'invoke'))
    const args = [entry, hold(vm.newString(invocation.toolId)), hold(vm.newString(JSON.stringify(invocation.input))), hold(vm.newString(invocation.continuation ? JSON.stringify(invocation.continuation) : ''))]
    const running = hold(slice(() => unwrap(vm.callFunction(invoke, vm.undefined, args))))
    const result = hold(await settled(running))
    if (promises.size) throw new GuestFault('protocol-error')
    const encode = hold(vm.getProp(helpers, 'encode'))
    const encoded = hold(slice(() => unwrap(vm.callFunction(encode, vm.undefined, result))))
    return { ok: true, value: slice(() => readJson(encoded, pluginLimits.outputBytes)), wasmBytes: memory.buffer.byteLength }
  } catch (error) {
    return { ok: false, code: fault ?? (error instanceof GuestFault ? error.code : 'guest-error') }
  } finally {
    alive = false; rpcController.abort(); signal.removeEventListener('abort', abortRpc)
    for (const promise of promises) promise.dispose()
    for (const handle of handles.reverse()) if (handle.alive) handle.dispose()
    vm.dispose(); runtime.dispose()
  }
}
