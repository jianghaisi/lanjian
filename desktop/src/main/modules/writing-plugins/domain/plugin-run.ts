import { assertJson, codePluginLimits, pluginLimits, validatePluginComposition, type JsonObject, type JsonValue, type PluginComposition } from '@lanjian/writing-plugin-contracts'

export type PluginVersionPin = { id: string; version: string; digest: string; grants: string[] }
export type PluginEffectReceipt = { key: string; requestHash: string; status: 'intent' | 'completed'; value?: JsonValue }
export type PluginRunState = { pins: PluginVersionPin[]; effects: PluginEffectReceipt[]; composition?: PluginComposition }
export interface PluginEffectJournal { once(key: string, request: JsonValue, operation: () => Promise<JsonValue>): Promise<JsonValue> }
export type PluginContinuation = { checkpoint: JsonObject; answer: JsonValue }

/** Persist version identities and bounded side-effect receipts, never host objects. */
export function decodePluginRunState(value: unknown): PluginRunState {
  assertJson(value)
  const bad = (): never => { throw new Error('Invalid plugin run state') }
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return bad()
    return v as Record<string, unknown>
  }
  const root = object(value, ['pins', 'effects', 'composition'])
  if (!Array.isArray(root.pins) || root.pins.length > codePluginLimits.installedPlugins || !Array.isArray(root.effects) || root.effects.length > pluginLimits.calls) bad()
  const pins = (root.pins as unknown[]).map(raw => {
    const p = object(raw, ['id', 'version', 'digest', 'grants'])
    if (typeof p.id !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(p.id) || p.id.startsWith('builtin.') || typeof p.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(p.version) || p.version.length > 64 || typeof p.digest !== 'string' || !/^[a-f0-9]{64}$/.test(p.digest) || !Array.isArray(p.grants) || p.grants.length > 16 || p.grants.some(c => typeof c !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(c)) || new Set(p.grants).size !== p.grants.length) bad()
    return { id: p.id as string, version: p.version as string, digest: p.digest as string, grants: [...p.grants as string[]] }
  })
  const effects = (root.effects as unknown[]).map(raw => {
    const e = object(raw, ['key', 'requestHash', 'status', 'value'])
    if (typeof e.key !== 'string' || !/^[a-f0-9]{64}$/.test(e.key) || typeof e.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.requestHash) || !['intent', 'completed'].includes(String(e.status)) || (e.status === 'completed') !== Object.hasOwn(e, 'value')) bad()
    if (e.value !== undefined) assertJson(e.value, 16 * 1024)
    return { key: e.key as string, requestHash: e.requestHash as string, status: e.status as PluginEffectReceipt['status'], ...(e.value === undefined ? {} : { value: e.value as JsonValue }) }
  })
  if (new Set(pins.map(p => p.id)).size !== pins.length || new Set(effects.map(e => e.key)).size !== effects.length) bad()
  const composition = root.composition === undefined ? undefined : validatePluginComposition(root.composition)
  if (composition?.entries.some(e => !pins.some(p => p.id === e.pluginId && p.digest === e.digest))) bad()
  return { pins, effects, ...(composition ? { composition } : {}) }
}
