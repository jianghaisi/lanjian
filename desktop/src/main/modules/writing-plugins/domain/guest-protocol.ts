import { assertJson, codePluginLimits, pluginLimits, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { guestMethods, type GuestInvocation, type GuestMethod, type GuestPolicy, type GuestResult } from './guest'

export type GuestCommand = { kind: 'start'; invocation: GuestInvocation; policy: GuestPolicy } |
  { kind: 'reply'; id: number; ok: true; value: JsonValue } | { kind: 'reply'; id: number; ok: false }
export type GuestEvent = { kind: 'rpc'; id: number; method: GuestMethod; input: JsonValue } |
  { kind: 'result'; result: GuestResult }
const wireLimit = codePluginLimits.entryBytes * 3 + pluginLimits.outputBytes
const failures = new Set(['invalid-input', 'guest-error', 'module-denied', 'output-limit', 'rpc-limit', 'timeout', 'cancelled', 'process-exit', 'process-memory', 'unavailable', 'protocol-error'])

export function encodeGuestWire(value: unknown): string {
  assertJson(value, wireLimit)
  return JSON.stringify(value)
}
function objectWire(wire: unknown): Record<string, JsonValue> {
  if (typeof wire !== 'string' || wire.length > wireLimit || new TextEncoder().encode(wire).byteLength > wireLimit) throw new Error('Invalid guest wire')
  const value: unknown = JSON.parse(wire)
  assertJson(value, wireLimit)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid guest wire')
  return value
}
const keys = (v: object, expected: string[]) => Object.keys(v).length === expected.length && Object.keys(v).every(k => expected.includes(k))
const id = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 1 && Number(n) <= pluginLimits.calls
export function decodeGuestEvent(wire: unknown): GuestEvent {
  const v = objectWire(wire)
  if (v.kind === 'rpc' && keys(v, ['kind', 'id', 'method', 'input']) && id(v.id) && guestMethods.includes(v.method as GuestMethod)) {
    assertJson(v.input, pluginLimits.inputBytes)
    return v as GuestEvent
  }
  if (v.kind === 'result' && keys(v, ['kind', 'result']) && v.result && typeof v.result === 'object' && !Array.isArray(v.result)) {
    const r = v.result
    if (r.ok === false && keys(r, ['ok', 'code']) && failures.has(String(r.code))) return v as GuestEvent
    if (r.ok === true && keys(r, ['ok', 'value', 'wasmBytes']) && Number.isSafeInteger(r.wasmBytes) && Number(r.wasmBytes) > 0 && Number(r.wasmBytes) <= codePluginLimits.wasmBytes) {
      assertJson(r.value, pluginLimits.outputBytes); return v as GuestEvent
    }
  }
  throw new Error('Invalid guest event')
}
export function decodeGuestCommand(wire: unknown): GuestCommand {
  const v = objectWire(wire)
  // The engine validates the full invocation and stricter-only policy before use.
  if (v.kind === 'start' && keys(v, ['kind', 'invocation', 'policy'])) return v as unknown as GuestCommand
  if (v.kind === 'reply' && id(v.id) && (v.ok === false && keys(v, ['kind', 'id', 'ok']) || v.ok === true && keys(v, ['kind', 'id', 'ok', 'value']))) {
    if (v.ok) assertJson(v.value, pluginLimits.outputBytes)
    return v as GuestCommand
  }
  throw new Error('Invalid guest command')
}
