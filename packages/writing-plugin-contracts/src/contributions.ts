import { assertJson, PluginContractError, validateSchema } from './schema.ts'
import { validatePluginRecipe, type PluginRecipe } from './recipe.ts'
import type { PluginManifest, PluginManifestTool } from './manifest.ts'
import type { JsonObject, ToolSchema } from './types.ts'
import { creativeSlots } from './creative-slots.ts'
import type { CreativePolicy, TeamPreset } from './creative-policy.ts'

export const writingStages = ['assistant', 'worldbuilding', 'planning', 'writing', 'review'] as const
export const pluginSdkCapabilities = ['book.read', 'planning.read', 'manuscript.read', 'planning.candidate', 'manuscript.candidate', 'model.generate', 'author.ask', 'assets.read'] as const
export type WritingStage = typeof writingStages[number]
export type PluginCategory = { categoryId: string; name: string; parentId?: string }
export const pluginCategories: readonly PluginCategory[] = [
  { categoryId: 'genre', name: '题材' }, { categoryId: 'style', name: '文风' },
  { categoryId: 'workflow', name: '写作流程' }, { categoryId: 'worldbuilding', name: '世界设定' },
  { categoryId: 'characters', name: '人物塑造' }, { categoryId: 'plot', name: '情节与伏笔' },
  { categoryId: 'research', name: '资料与考据' }, { categoryId: 'review', name: '审校与一致性' },
  { categoryId: 'interaction', name: '作者交互' }, { categoryId: 'format', name: '格式与呈现' },
  { categoryId: 'tools', name: '工具扩展' }
]
export const categoryLabel = (id: string, catalog: readonly PluginCategory[] = pluginCategories): string => catalog.find(c => c.categoryId === id)?.name ?? `扩展分类 · ${id}`
export type ContributionDependency = { pluginId: string; contributionId: string }
type ContributionBase = {
  id: string; name: string; stages: WritingStage[]; configSchema: ToolSchema
  requires?: ContributionDependency[]; exclusiveGroup?: string
}
export type WritingContribution = ContributionBase & (
  | { kind: 'context-fragment'; text: string }
  | { kind: 'tool-reference'; toolId: string }
  | { kind: 'setting-template' | 'checker' | 'workflow'; tool: PluginManifestTool; recipe: PluginRecipe }
  | CreativePolicy | TeamPreset
)
export type CompositionEntry = { pluginId: string; digest: string; contributionId: string; params: JsonObject }
export type PluginComposition = { revision: number; entries: CompositionEntry[] }
export function renderContributionText(text: string, params: JsonObject, missing = ''): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_whole, key: string) => Object.hasOwn(params, key) ? (typeof params[key] === 'string' ? params[key] as string : JSON.stringify(params[key])) : missing)
}
export const contributionLimits = { count: 24, selected: 32, contextChars: 24000, paramsBytes: 8192, snapshotBytes: 128 * 1024, workflowSteps: 64 } as const

const bad = (): never => { throw new PluginContractError() }
function object(v: unknown, fields: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !fields.includes(k))) return bad()
  return v as Record<string, unknown>
}
function string(v: unknown, max: number): string { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) return bad(); return v }
export function contributionId(v: unknown): string { const s = string(v, 64); if (!/^[a-z][a-z0-9_-]*$/.test(s)) bad(); return s }
export function pluginIdentity(v: unknown): string { const s = string(v, 128); if (!/^[a-z][a-z0-9.-]*$/.test(s) || s.startsWith('builtin.')) bad(); return s }
export function validateCategoryIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 16) return bad()
  const ids = v.map(x => { const s = string(x, 100); if (!/^[a-z][a-z0-9.-]*$/.test(s)) bad(); return s })
  if (new Set(ids).size !== ids.length) bad()
  return ids
}
export function validatePluginTags(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 24) return bad()
  const tags = v.map(x => string(x, 40))
  if (new Set(tags).size !== tags.length) bad()
  return tags
}
/** Recipes expose only the existing bounded SDK, never arbitrary host code. */
export function validateContributions(v: unknown, manifest: PluginManifest, decodeTool: (v: unknown) => PluginManifestTool): WritingContribution[] {
  if (!Array.isArray(v) || v.length > contributionLimits.count) return bad()
  const entries = v.map((raw): WritingContribution => {
    const c = object(raw, ['id', 'name', 'kind', 'stages', 'configSchema', 'requires', 'exclusiveGroup', 'text', 'toolId', 'tool', 'recipe', 'slot', 'mode', 'asset'])
    const id = contributionId(c.id), name = string(c.name, 100), configSchema = validateSchema(c.configSchema)
    if (configSchema.type !== 'object') return bad()
    if (!Array.isArray(c.stages) || !c.stages.length || c.stages.some(s => !writingStages.includes(s)) || new Set(c.stages).size !== c.stages.length) bad()
    const base: ContributionBase = { id, name, configSchema, stages: [...c.stages as WritingStage[]] }
    if (c.requires !== undefined) {
      if (!Array.isArray(c.requires) || c.requires.length > 16) bad()
      base.requires = (c.requires as unknown[]).map(raw => { const d = object(raw, ['pluginId', 'contributionId']); return { pluginId: pluginIdentity(d.pluginId), contributionId: contributionId(d.contributionId) } })
      if (new Set(base.requires.map(d => `${d.pluginId}/${d.contributionId}`)).size !== base.requires.length) bad()
    }
    if (c.exclusiveGroup !== undefined) base.exclusiveGroup = string(c.exclusiveGroup, 100)
    if (c.kind === 'creative-policy' || c.kind === 'team-preset') {
      if (c.text !== undefined || c.toolId !== undefined || c.tool !== undefined || c.recipe !== undefined) return bad()
      if (c.kind === 'team-preset') {
        if (c.slot !== undefined || c.mode !== undefined || base.stages.length !== 1 || base.stages[0] !== 'assistant') return bad()
      } else {
        if (typeof c.slot !== 'string' || !Object.hasOwn(creativeSlots, c.slot) || !['replace', 'append', 'disabled'].includes(String(c.mode)) || base.stages.length !== 1 || base.stages[0] !== creativeSlots[c.slot as keyof typeof creativeSlots]) return bad()
        if (c.mode === 'disabled') { if (c.asset !== undefined) return bad(); return { ...base, kind: c.kind, slot: c.slot as CreativePolicy['slot'], mode: 'disabled' } }
      }
      const asset = string(c.asset, 240)
      if (!manifest.assets?.includes(asset) || !(c.kind === 'team-preset' ? /\.json$/ : /\.(?:md|txt)$/).test(asset)) return bad()
      return c.kind === 'team-preset' ? { ...base, kind: c.kind, asset } : { ...base, kind: c.kind, slot: c.slot as CreativePolicy['slot'], mode: c.mode as CreativePolicy['mode'], asset }
    }
    if (c.slot !== undefined || c.mode !== undefined || c.asset !== undefined) return bad()
    if (c.kind === 'context-fragment') {
      if (c.toolId !== undefined || c.tool !== undefined || c.recipe !== undefined || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 12000) return bad()
      // Substitutions are data only. Require every referenced parameter to be declared.
      for (const match of c.text.matchAll(/\{\{([^{}]+)\}\}/g)) if (!Object.hasOwn(configSchema.properties, match[1])) bad()
      return { ...base, kind: c.kind, text: c.text } as WritingContribution
    }
    if (c.kind === 'tool-reference') {
      if (c.text !== undefined || c.tool !== undefined || c.recipe !== undefined || !manifest.tools.some(t => t.id === c.toolId)) return bad()
      return { ...base, kind: c.kind, toolId: c.toolId as string } as WritingContribution
    }
    if (!['setting-template', 'checker', 'workflow'].includes(String(c.kind)) || c.text !== undefined || c.toolId !== undefined) return bad()
    const tool = decodeTool(c.tool)
    if (tool.id !== `contribution__${id}` || manifest.tools.some(t => t.id === tool.id)) bad()
    const recipe = validatePluginRecipe(c.recipe, { ...manifest, runtime: 'declarative', tools: [tool] })
    const steps = recipe.tools[0].steps
    if (c.kind === 'checker' && (!['read', 'derive'].includes(tool.effect) || steps.some(s => s.call === 'candidate.prepare' || s.call === 'interaction.request'))) bad()
    if (c.kind === 'setting-template' && (tool.effect !== 'candidate' || !steps.some(s => s.call === 'candidate.prepare'))) bad()
    return { ...base, kind: c.kind as 'workflow', tool, recipe } as WritingContribution
  })
  if (new Set(entries.map(c => c.id)).size !== entries.length) bad()
  return entries
}
export function validateCompositionEntries(value: unknown): CompositionEntry[] {
  assertJson(value, contributionLimits.snapshotBytes)
  if (!Array.isArray(value) || value.length > contributionLimits.selected) return bad()
  const entries = value.map(raw => {
    const e = object(raw, ['pluginId', 'digest', 'contributionId', 'params'])
    if (typeof e.digest !== 'string' || !/^[a-f0-9]{64}$/.test(e.digest) || !e.params || typeof e.params !== 'object' || Array.isArray(e.params)) bad()
    assertJson(e.params, contributionLimits.paramsBytes)
    return { pluginId: pluginIdentity(e.pluginId), digest: e.digest as string, contributionId: contributionId(e.contributionId), params: structuredClone(e.params) as JsonObject }
  })
  if (new Set(entries.map(e => `${e.pluginId}/${e.contributionId}`)).size !== entries.length) bad()
  return entries
}
export function validatePluginComposition(value: unknown): PluginComposition {
  const v = object(value, ['revision', 'entries'])
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0) bad()
  return { revision: Number(v.revision), entries: validateCompositionEntries(v.entries) }
}
