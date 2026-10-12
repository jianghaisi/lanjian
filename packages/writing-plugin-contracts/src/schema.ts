import { pluginLimits } from './limits.ts'
import type { JsonValue, ToolSchema } from './types.ts'

/** Pure, deliberately small JSON Schema subset shared by host and marketplace. */
export class PluginContractError extends Error {
  constructor() { super('插件数据不符合有界契约。'); this.name = 'PluginContractError' }
}
const bad = (): never => { throw new PluginContractError() }
const dangerous = new Set(['__proto__', 'prototype', 'constructor'])
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))

// Check descriptors before reading values: getters, cycles, toJSON and class instances
// must never run as a side effect of validating a plugin boundary.
export function assertJson(value: unknown, maxBytes = pluginLimits.outputBytes): asserts value is JsonValue {
  let nodes = 0, estimatedBytes = 0
  const active = new Set<object>()
  function visit(item: unknown, depth: number): void {
    if (++nodes > pluginLimits.valueNodes || depth > pluginLimits.valueDepth) bad()
    if (item === null || typeof item === 'boolean') { estimatedBytes += 5; return }
    if (typeof item === 'number') { if (!Number.isFinite(item)) bad(); estimatedBytes += 24; return }
    if (typeof item === 'string') { estimatedBytes += item.length; if (estimatedBytes > maxBytes) bad(); return }
    if (!Array.isArray(item) && !plain(item)) bad()
    const object = item as object
    if (active.has(object)) bad()
    active.add(object)
    const descriptors = Object.getOwnPropertyDescriptors(object)
    if (Object.getOwnPropertySymbols(object).length) bad()
    const array = Array.isArray(item)
    if (array && item.length > pluginLimits.valueNodes) bad()
    let count = 0
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue
      if (dangerous.has(key) || !descriptor.enumerable || !('value' in descriptor) || array && !/^(0|[1-9]\d*)$/.test(key)) bad()
      estimatedBytes += key.length + 3
      if (estimatedBytes > maxBytes) bad()
      count++; visit(descriptor.value, depth + 1)
    }
    if (array && count !== item.length) bad()
    active.delete(object)
  }
  visit(value, 0)
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) bad()
}

export function jsonBytes(value: unknown): number {
  assertJson(value)
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function validateSchema(value: unknown, rootObject = true): ToolSchema {
  assertJson(value, pluginLimits.schemaBytes)
  let nodes = 0
  function visit(schema: unknown, depth: number): void {
    if (!plain(schema) || ++nodes > pluginLimits.schemaNodes || depth > pluginLimits.schemaDepth) bad()
    const s = schema as Record<string, unknown>
    const allowed: Record<string, string[]> = {
      object: ['properties', 'required', 'additionalProperties'], array: ['items', 'minItems', 'maxItems'],
      string: ['enum', 'minLength', 'maxLength'], number: ['enum', 'minimum', 'maximum'],
      integer: ['enum', 'minimum', 'maximum'], boolean: []
    }
    if (typeof s.type !== 'string' || !Object.hasOwn(allowed, s.type)) bad()
    const keys = ['type', 'description', ...allowed[s.type as string]]
    if (Object.keys(s).some(key => !keys.includes(key))) bad()
    if (s.description !== undefined && (typeof s.description !== 'string' || s.description.length > 2000)) bad()
    function bounds(min: string, max: string, ceiling: number, required: boolean): void {
      if (required && s[max] === undefined) bad()
      for (const key of [min, max]) if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isSafeInteger(s[key]) || (s[key] as number) < 0 || (s[key] as number) > ceiling)) bad()
      if (s[min] !== undefined && s[max] !== undefined && (s[min] as number) > (s[max] as number)) bad()
    }
    if (s.type === 'object') {
      if (s.additionalProperties !== false || !plain(s.properties)) bad()
      const properties = s.properties as Record<string, unknown>
      if (Object.keys(properties).some(key => !key.length || key.length > 200)) bad()
      if (s.required !== undefined && (!Array.isArray(s.required) || new Set(s.required).size !== s.required.length || s.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key)))) bad()
      for (const child of Object.values(properties)) visit(child, depth + 1)
    } else if (s.type === 'array') {
      bounds('minItems', 'maxItems', 10000, true); visit(s.items, depth + 1)
    } else if (s.type === 'string') {
      bounds('minLength', 'maxLength', pluginLimits.outputBytes, true)
      if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 1000 || new Set(s.enum).size !== s.enum.length || s.enum.some(v => typeof v !== 'string' || v.length < Number(s.minLength ?? 0) || v.length > Number(s.maxLength)))) bad()
    } else if (s.type === 'number' || s.type === 'integer') {
      for (const key of ['minimum', 'maximum']) if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s.type === 'integer' && !Number.isSafeInteger(s[key]))) bad()
      if (s.minimum !== undefined && s.maximum !== undefined && Number(s.minimum) > Number(s.maximum)) bad()
      if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 1000 || new Set(s.enum).size !== s.enum.length || s.enum.some(v => typeof v !== 'number' || !Number.isFinite(v) || s.type === 'integer' && !Number.isSafeInteger(v) || s.minimum !== undefined && v < Number(s.minimum) || s.maximum !== undefined && v > Number(s.maximum)))) bad()
    }
  }
  visit(value, 0)
  if (rootObject && (value as { type: string }).type !== 'object') bad()
  return structuredClone(value) as ToolSchema
}

export function validateValue(schema: ToolSchema, value: unknown, maxBytes = pluginLimits.outputBytes): asserts value is JsonValue {
  assertJson(value, maxBytes)
  function visit(s: ToolSchema, v: unknown): void {
    switch (s.type) {
      case 'object': {
        if (!plain(v)) bad()
        const record = v as Record<string, unknown>
        if (Object.keys(record).some(k => !Object.hasOwn(s.properties, k)) || s.required?.some(k => !Object.hasOwn(record, k))) bad()
        for (const key of Object.keys(record)) visit(s.properties[key], record[key])
        break
      }
      case 'array':
        if (!Array.isArray(v) || v.length < (s.minItems ?? 0) || v.length > s.maxItems) bad()
        for (const child of v as unknown[]) visit(s.items, child)
        break
      case 'string':
        if (typeof v !== 'string' || v.length < (s.minLength ?? 0) || v.length > s.maxLength || s.enum && !s.enum.includes(v)) bad()
        break
      case 'boolean': if (typeof v !== 'boolean') bad(); break
      default:
        if (typeof v !== 'number' || !Number.isFinite(v) || s.type === 'integer' && !Number.isSafeInteger(v) || s.minimum !== undefined && v < s.minimum || s.maximum !== undefined && v > s.maximum || s.enum && !s.enum.includes(v)) bad()
    }
  }
  visit(schema, value)
}

export const objectSchema = (properties: Record<string, ToolSchema>, required = Object.keys(properties)): ToolSchema => ({ type: 'object', additionalProperties: false, properties, required })
export const textSchema = (maxLength: number, minLength = 0): ToolSchema => ({ type: 'string', minLength, maxLength })
