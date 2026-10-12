import { assertJson, PluginContractError, validateSchema } from './schema.ts'
import { codePluginLimits } from './limits.ts'
import type { ToolDescriptor } from './types.ts'
import { validateCategoryIds, validatePluginTags, validateContributions, type WritingContribution } from './contributions.ts'

export type PluginManifestTool = Omit<ToolDescriptor, 'pluginId' | 'version'>
export type PluginManifest = {
  apiVersion: 1
  id: string
  name: string
  version: string
  description: string
  runtime: 'quickjs-js' | 'declarative'
  entry: string
  capabilities: string[]
  tools: PluginManifestTool[]
  assets?: string[]
  categoryIds?: string[]
  tags?: string[]
  contributions?: WritingContribution[]
}
const bad = (): never => { throw new PluginContractError() }
const exact = (v: Record<string, unknown>, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k))) bad() }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad()
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) return bad()
  return value
}
/** Portable package paths: never normalize an unsafe path into an accepted one. */
export function validatePluginPath(value: unknown): string {
  const path = text(value, 240)
  if (path !== path.normalize('NFC') || /[\\:<>"]|[|?*\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/') || path.endsWith('/')) bad()
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..' || segment.length > 100 || /[ .]$/.test(segment) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(segment)) bad()
  }
  return path
}
function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length || value.some(c => typeof c !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(c))) return bad()
  return [...value]
}
export function validatePluginManifest(value: unknown): PluginManifest {
  assertJson(value, codePluginLimits.manifestBytes)
  const m = record(value)
  exact(m, ['apiVersion', 'id', 'name', 'version', 'description', 'runtime', 'entry', 'capabilities', 'tools', 'assets', 'categoryIds', 'tags', 'contributions'])
  const id = text(m.id, 128), version = text(m.version, 64)
  validatePluginPath(id)
  if (m.apiVersion !== 1 || !/^[a-z][a-z0-9.-]{0,127}$/.test(id) || id.startsWith('builtin.') || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) bad()
  if (m.runtime !== 'quickjs-js' && m.runtime !== 'declarative') bad()
  const entry = validatePluginPath(m.entry)
  if (!(m.runtime === 'quickjs-js' ? /\.(?:m?js)$/ : /\.json$/).test(entry) || entry === 'lanjian-plugin.json') bad()
  const grant = capabilities(m.capabilities)
  if (!Array.isArray(m.tools) || m.tools.length > codePluginLimits.packageTools) bad()
  const decodeTool = (value: unknown): PluginManifestTool => {
    const t = record(value)
    exact(t, ['id', 'description', 'effect', 'capabilities', 'inputSchema', 'outputSchema'])
    const toolId = text(t.id, 100), caps = capabilities(t.capabilities)
    if (!/^[a-z][a-z0-9_-]{0,99}$/.test(toolId) || !['read', 'derive', 'candidate', 'interaction'].includes(String(t.effect)) || caps.some(c => !grant.includes(c))) bad()
    return { id: toolId, description: text(t.description, 2000), effect: t.effect as PluginManifestTool['effect'], capabilities: caps, inputSchema: validateSchema(t.inputSchema), outputSchema: validateSchema(t.outputSchema) }
  }
  const tools = (m.tools as unknown[]).map(decodeTool)
  if (tools.some(t => t.id.startsWith('contribution__'))) bad()
  if (new Set(tools.map(t => t.id)).size !== tools.length) bad()
  const result: PluginManifest = { apiVersion: 1, id, name: text(m.name, 100), version, description: text(m.description, 2000), runtime: m.runtime as PluginManifest['runtime'], entry, capabilities: grant, tools }
  if (m.categoryIds !== undefined) result.categoryIds = validateCategoryIds(m.categoryIds)
  if (m.tags !== undefined) result.tags = validatePluginTags(m.tags)
  if (m.assets !== undefined) {
    if (!Array.isArray(m.assets) || m.assets.length > codePluginLimits.files - 2) bad()
    const assets = (m.assets as unknown[]).map(validatePluginPath)
    const all = ['lanjian-plugin.json', entry, ...assets].map(p => p.toLowerCase())
    if (new Set(all).size !== all.length) bad()
    result.assets = assets
  }
  if (m.contributions !== undefined) result.contributions = validateContributions(m.contributions, result, decodeTool)
  if (!tools.length && !result.contributions?.length) bad()
  return result
}
