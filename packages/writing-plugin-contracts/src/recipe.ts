import { assertJson, PluginContractError } from './schema.ts'
import { pluginLimits } from './limits.ts'
import type { JsonValue } from './types.ts'
import type { PluginManifest, PluginManifestTool } from './manifest.ts'

export type RecipeMethod = 'book.read' | 'model.generate' | 'candidate.prepare' | 'interaction.request' | 'assets.readText'
export type RecipeStep = { id: string; call: RecipeMethod; args: Record<string, JsonValue>; when?: { equals: [JsonValue, JsonValue] } }
export type PluginRecipe = { format: 1; tools: { id: string; steps: RecipeStep[]; result: JsonValue }[] }
const bad = (): never => { throw new PluginContractError() }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(); return v as Record<string, unknown> }
function exact(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).some(k => !keys.includes(k))) bad() }
const safe = (key: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)
function template(v: unknown, previous: Set<string>, depth = 0): void {
  if (depth > 16) bad()
  if (v === null || typeof v !== 'object') return
  if (Array.isArray(v)) { v.forEach(value => template(value, previous, depth + 1)); return }
  const o = object(v), keys = Object.keys(o)
  if ('$ref' in o) {
    if (keys.length !== 1 || typeof o.$ref !== 'string') return bad()
    const parts = o.$ref.split('.')
    if (parts.length > 16 || parts.some(p => !safe(p)) || !(parts[0] === 'input' || parts[0] === 'steps' && previous.has(parts[1]!))) bad()
    return
  }
  if ('$join' in o) {
    if (keys.length !== 1 || !Array.isArray(o.$join) || o.$join.length > 32) bad()
    ;(o.$join as unknown[]).forEach(value => template(value, previous, depth + 1)); return
  }
  if (keys.some(k => k.startsWith('$') || ['__proto__', 'constructor', 'prototype'].includes(k))) bad()
  Object.values(o).forEach(value => template(value, previous, depth + 1))
}
function authority(step: Record<string, unknown>, tool: PluginManifestTool): void {
  const args = object(step.args)
  let cap: string, extra: string | undefined
  switch (step.call) {
    case 'book.read':
      if (args.kind === 'context') exact(args, ['kind'])
      else if (args.kind === 'materials') exact(args, ['kind', 'offset'])
      else if (args.kind === 'outline') exact(args, ['kind', 'key'])
      else if (args.kind === 'manuscript') exact(args, ['kind', 'chapterId'])
      else return bad()
      cap = args.kind === 'outline' ? 'planning.read' : args.kind === 'manuscript' ? 'manuscript.read' : 'book.read'; break
    case 'model.generate': exact(args, ['instruction', 'draft']); if (!('instruction' in args)) bad(); cap = 'model.generate'; break
    case 'candidate.prepare':
      exact(args, ['kind', 'key', 'input'])
      if (tool.effect !== 'candidate' || !['planning', 'expand', 'manuscript'].includes(String(args.kind)) || !('key' in args) || !('input' in args)) bad()
      cap = args.kind === 'manuscript' ? 'manuscript.candidate' : 'planning.candidate'
      extra = args.kind === 'manuscript' ? 'manuscript.read' : args.kind === 'expand' ? 'planning.read' : undefined; break
    case 'interaction.request': exact(args, ['question']); if (!('question' in args)) bad(); cap = 'author.ask'; break
    case 'assets.readText': exact(args, ['path']); if (!('path' in args)) bad(); cap = 'assets.read'; break
    default: return bad()
  }
  if (!tool.capabilities.includes(cap) || extra && !tool.capabilities.includes(extra)) bad()
}
/** Closed, finite recipes; references can only point to inputs or earlier steps. */
export function validatePluginRecipe(value: unknown, manifest: PluginManifest): PluginRecipe {
  assertJson(value, pluginLimits.inputBytes)
  const r = object(value); exact(r, ['format', 'tools'])
  if (manifest.runtime !== 'declarative' || r.format !== 1 || !Array.isArray(r.tools) || r.tools.length !== manifest.tools.length) bad()
  let steps = 0
  const ids = new Set<string>()
  for (const entry of r.tools as unknown[]) {
    const t = object(entry); exact(t, ['id', 'steps', 'result'])
    const descriptor = manifest.tools.find(tool => tool.id === t.id)
    if (!descriptor || ids.has(descriptor.id) || !Array.isArray(t.steps) || t.steps.length > 32 || !('result' in t)) bad()
    ids.add(descriptor!.id)
    const previous = new Set<string>()
    for (const raw of t.steps as unknown[]) {
      if (++steps > 256) bad()
      const s = object(raw); exact(s, ['id', 'call', 'args', 'when'])
      if (typeof s.id !== 'string' || !safe(s.id) || previous.has(s.id)) bad()
      authority(s, descriptor!); template(s.args, previous)
      if (s.when !== undefined) { const w = object(s.when); exact(w, ['equals']); if (!Array.isArray(w.equals) || w.equals.length !== 2) bad(); template(w.equals, previous) }
      previous.add(s.id as string)
    }
    template(t.result, previous)
  }
  return structuredClone(value) as PluginRecipe
}
