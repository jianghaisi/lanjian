import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { WritingPluginRunHost, type GuestProcess } from '../../../src/main/modules/writing-plugins/runtime/run-host'
import { codePluginLimits } from '@lanjian/writing-plugin-contracts'
import type { GuestInvocation, GuestBroker } from '../../../src/main/modules/writing-plugins/domain/guest'
import { decodeGuestCommand, decodeGuestEvent, encodeGuestWire } from '../../../src/main/modules/writing-plugins/domain/guest-protocol'

const wasm = readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).then(b => new Uint8Array(b).buffer)
const invocation = (source: string, id = 'test'): GuestInvocation => ({ invocationId: id, source, toolId: 'algorithm', input: { a: 5, b: 8 } })
const deny: GuestBroker = async () => { throw new Error('SECRET_HOST_PATH') }
async function run(source: string, broker = deny, controller = new AbortController()) {
  return executeGuest(invocation(source), await wasm, broker, controller.signal, { sliceMs: 100, invocationMs: 1200 })
}
test('new algorithm and async broker run inside isolated WASM, with JSON-only context', async () => {
  const seen: unknown[] = []
  const result = await run('export async function execute(id, input, ctx) { const data = await ctx.book.read({section:"outline"}); return {sum:input.a+input.b, data, id}; }', async (method, input) => { seen.push({ method, input }); return { text: '测试' } })
  assert.deepEqual(seen, [{ method: 'book.read', input: { section: 'outline' } }])
  assert.deepEqual(result, { ok: true, value: { sum: 13, data: { text: '测试' }, id: 'algorithm' }, wasmBytes: 16 * 1024 * 1024 })
})
test('guest has no host globals or bridge object, including Function constructor', async () => {
  const result = await run('export async function execute(id, input, ctx) { return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof window, typeof WebAssembly, typeof __bridge, await ctx.book.read.constructor("return typeof process")()]; }')
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, Array(8).fill('undefined'))
})
test('static and dynamic imports fail even when plugin catches import rejection', async () => {
  for (const source of ['import fs from "node:fs"; export function execute(){return 1}', 'export async function execute(){ try {await import("node:fs")} catch{} return 1 }']) {
    assert.deepEqual(await run(source), { ok: false, code: 'module-denied' })
  }
})
test('CPU loop, resolved-promise loop and never-resolving promise have finite deadlines', async () => {
  for (const source of ['export function execute(){while(true){}}', 'export async function execute(){while(true){await Promise.resolve()}}', 'export function execute(){return new Promise(()=>{})}']) {
    assert.deepEqual(await run(source), { ok: false, code: 'timeout' })
  }
})
test('memory allocation is bounded and a fresh invocation remains usable', async () => {
  assert.equal((await run('export function execute(){ const a=[]; for(let i=0;i<256;i++) a.push(new ArrayBuffer(1024*1024)); return 1 }')).ok, false)
  assert.equal((await run('export function execute(){return "still usable"}')).ok, true)
})
test('large, non-JSON, cyclic and accessor results fail without evaluating host objects', async () => {
  for (const expression of ['"x".repeat(1048577)', 'NaN', 'undefined', '{f(){}}', 'Object.defineProperty({},"x",{enumerable:true,get(){while(true){}}})', '(()=>{const a={};a.a=a;return a})()', '({["__proto__"]:1})']) {
    assert.equal((await run(`export function execute(){return ${expression}}`)).ok, false, expression)
  }
})
test('RPC budget and malformed RPC input stop guest before extra calls', async () => {
  let calls = 0
  const result = await run('export async function execute(id,input,ctx){for(let i=0;i<97;i++) await ctx.book.read({}); return 1}', async () => { calls++; return {} })
  assert.deepEqual(result, { ok: false, code: 'rpc-limit' }); assert.equal(calls, 96)
  assert.equal((await run('export async function execute(id,input,ctx){return ctx.book.read({get x(){while(true){}}})}')).ok, false)
})
test('host errors and plugin exceptions never disclose raw diagnostics', async () => {
  const result = await run('export async function execute(id,input,ctx){ try { await ctx.book.read({}) } catch(e){ return e.message }}')
  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(result).includes('SECRET_HOST_PATH'), false)
  assert.deepEqual(await run('export function execute(){throw new Error("SECRET_PLUGIN_TEXT")}'), { ok: false, code: 'guest-error' })
})
test('cancellation aborts pending broker, ignores late completion and releases VM', async () => {
  const controller = new AbortController()
  let brokerSignal: AbortSignal | undefined, finish!: () => void
  const result = run('export async function execute(id,input,ctx){return ctx.book.read({})}', async (_method, _input, signal) => {
    brokerSignal = signal
    setTimeout(() => controller.abort(), 10)
    return new Promise(resolve => { finish = () => resolve({ late: true }) })
  }, controller)
  assert.deepEqual(await result, { ok: false, code: 'cancelled' })
  assert.equal(brokerSignal?.aborted, true); finish()
  await new Promise(resolve => setTimeout(resolve, 5))
})
test('explicit resume uses checkpoint and fresh VM without replaying execute', async () => {
  const request = invocation('export function execute(){throw Error("must not replay")} export function resume(id,checkpoint,answer){return {id,step:checkpoint.step,answer,old:typeof oldState}}')
  request.continuation = { checkpoint: { step: 2 }, answer: '继续' }
  const result = await executeGuest(request, await wasm, deny, new AbortController().signal)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { id: 'algorithm', step: 2, answer: '继续', old: 'undefined' })
})
test('unawaited pending SDK work cannot report completion', async () => {
  let signal: AbortSignal | undefined
  const result = await run('export function execute(id,input,ctx){void ctx.book.read({}); return "premature"}', async (_method, _input, pendingSignal) => { signal = pendingSignal; return new Promise(() => {}) })
  assert.deepEqual(result, { ok: false, code: 'protocol-error' }); assert.equal(signal?.aborted, true)
})
class FakeProcess implements GuestProcess {
  sent: string[] = []; kills = 0; bytes = 0
  message: (wire: unknown) => void = () => {}; exit: () => void = () => {}
  send(wire: string) { this.sent.push(wire) }
  kill() { this.kills++ }
  onMessage(listener: (wire: unknown) => void) { this.message = listener }
  onExit(listener: () => void) { this.exit = listener }
  residentBytes() { return this.bytes }
  result() { this.message(encodeGuestWire({ kind: 'result', result: { ok: true, value: 1, wasmBytes: 16777216 } })) }
}
test('two processes only; queue snapshots inputs, waits for actual exit before releasing slot', async () => {
  const children: FakeProcess[] = []
  const host = new WritingPluginRunHost(() => { const child = new FakeProcess(); children.push(child); return child })
  const controller = new AbortController(), req = invocation('export function execute(){return 1}', 'three')
  const one = host.run(invocation(req.source, 'one'), deny, controller.signal)
  const two = host.run(invocation(req.source, 'two'), deny, controller.signal)
  const three = host.run(req, deny, controller.signal); req.input = 'mutated'
  assert.equal(children.length, 2); children[0].result(); assert.equal(children[0].kills, 1); assert.equal(children.length, 2)
  children[0].exit(); await one; assert.equal(children.length, 3)
  const start = decodeGuestCommand(children[2].sent[0]); assert.equal(start.kind, 'start')
  if (start.kind === 'start') assert.deepEqual(start.invocation.input, { a: 5, b: 8 })
  const disposal = host.dispose(); children[1].exit(); children[2].exit()
  assert.deepEqual(await two, { ok: false, code: 'cancelled' }); assert.deepEqual(await three, { ok: false, code: 'cancelled' }); await disposal
})
test('watchdog kills a stuck child and discards late RPC results; queued cancellation never forks', async () => {
  const children: FakeProcess[] = [], signals: AbortSignal[] = []
  const host = new WritingPluginRunHost(() => { const child = new FakeProcess(); children.push(child); return child }, { sliceMs: 10, invocationMs: 60 })
  const controller = new AbortController(), queued = new AbortController()
  let finish!: () => void
  const one = host.run(invocation('', 'one'), async (_m, _i, signal) => { signals.push(signal); return new Promise(resolve => { finish = () => resolve('late') }) }, controller.signal)
  const two = host.run(invocation('', 'two'), deny, controller.signal)
  const three = host.run(invocation('', 'three'), deny, queued.signal)
  queued.abort(); assert.deepEqual(await three, { ok: false, code: 'cancelled' })
  children[0].message(encodeGuestWire({ kind: 'rpc', id: 1, method: 'book.read', input: {} }))
  await new Promise(resolve => setTimeout(resolve, 90))
  assert.equal(children.length, 2); assert.equal(children[0].kills, 1); assert.equal(signals[0].aborted, true)
  finish(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(children[0].sent.length, 1)
  children.forEach(c => c.exit())
  assert.deepEqual(await one, { ok: false, code: 'timeout' }); await two; await host.dispose()
})
test('worker crash, malformed protocol and excessive process memory are explicit failures', async () => {
  for (const kind of ['crash', 'protocol', 'memory'] as const) {
    const child = new FakeProcess(), host = new WritingPluginRunHost(() => child)
    const result = host.run(invocation(''), deny, new AbortController().signal)
    if (kind === 'crash') child.exit()
    else if (kind === 'protocol') { child.message({ raw: 'object forbidden' }); child.exit() }
    else { child.bytes = codePluginLimits.processResidentBytes + 1; await new Promise(resolve => setTimeout(resolve, 125)); assert.equal(child.kills, 1); child.exit() }
    assert.deepEqual(await result, { ok: false, code: kind === 'crash' ? 'process-exit' : kind === 'protocol' ? 'protocol-error' : 'process-memory' }); await host.dispose()
  }
})
test('wire decoders reject extra fields, oversized data, unknown replies and unknown errors', () => {
  for (const value of [{ kind: 'result', result: { ok: false, code: 'raw-secret' } }, { kind: 'rpc', id: 0, method: 'book.read', input: {} }, { kind: 'rpc', id: 1, method: 'fs.read', input: {} }]) assert.throws(() => decodeGuestEvent(JSON.stringify(value)))
  assert.throws(() => decodeGuestCommand('{"kind":"reply","id":1,"ok":false,"value":"hidden"}'))
})
