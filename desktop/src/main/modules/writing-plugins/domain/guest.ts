import { assertJson, codePluginLimits, pluginLimits, type JsonValue } from '@lanjian/writing-plugin-contracts'

export const guestMethods = ['book.read', 'model.generate', 'candidate.prepare', 'interaction.request', 'assets.readText'] as const
export type GuestMethod = typeof guestMethods[number]
export type GuestInvocation = {
  invocationId: string
  source: string
  toolId: string
  input: JsonValue
  continuation?: { checkpoint: JsonValue; answer: JsonValue }
}
export type GuestFailure = 'invalid-input' | 'guest-error' | 'module-denied' | 'output-limit' | 'rpc-limit' | 'timeout' | 'cancelled' | 'process-exit' | 'process-memory' | 'unavailable' | 'protocol-error'
export type GuestResult = { ok: true; value: JsonValue; wasmBytes: number } | { ok: false; code: GuestFailure }
export type GuestBroker = (method: GuestMethod, input: JsonValue, signal: AbortSignal) => Promise<JsonValue>
export type GuestPolicy = { sliceMs: number; invocationMs: number }
export const defaultGuestPolicy: GuestPolicy = { sliceMs: codePluginLimits.sliceMs, invocationMs: codePluginLimits.invocationMs }

export function validateGuestPolicy(value: GuestPolicy): void {
  for (const key of ['sliceMs', 'invocationMs'] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > defaultGuestPolicy[key]) throw new Error('Invalid guest policy')
  }
}
export function validateGuestInvocation(value: unknown): asserts value is GuestInvocation {
  assertJson(value, codePluginLimits.entryBytes + pluginLimits.inputBytes * 3)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid guest invocation')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['invocationId', 'source', 'toolId', 'input', 'continuation'].includes(k)) ||
      typeof v.invocationId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(v.invocationId) ||
      typeof v.toolId !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(v.toolId) ||
      typeof v.source !== 'string' || new TextEncoder().encode(v.source).byteLength > codePluginLimits.entryBytes) throw new Error('Invalid guest invocation')
  assertJson(v.input, pluginLimits.inputBytes)
  if (v.continuation !== undefined) {
    const c = v.continuation as Record<string, unknown>
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length !== 2) throw new Error('Invalid continuation')
    assertJson(c.checkpoint, codePluginLimits.checkpointBytes)
    assertJson(c.answer, pluginLimits.inputBytes)
  }
}

/** Main-owned port. Implementations must release their process before resolving. */
export interface GuestRunner {
  run(invocation: GuestInvocation, broker: GuestBroker, signal: AbortSignal): Promise<GuestResult>
  dispose(): Promise<void>
}
