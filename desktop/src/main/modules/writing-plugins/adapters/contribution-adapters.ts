import { type PluginComposition, type PluginManifest, type PluginManifestTool, type JsonObject, type PluginRecipe } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import type { InstalledVersion } from '../domain/installed'
import { inspectComposition, contributionContexts } from '../domain/composition'

export function resolvePinnedComposition(versions: InstalledVersion[], composition: PluginComposition) {
  const inspected = inspectComposition({ format: 1, revision: 0, plugins: versions.map(v => ({ id: v.manifest.id, current: v.digest, enabled: true, versions: [v] })), books: [{ id: 'pinned', plugins: versions.map(v => v.manifest.id) }] }, 'pinned', composition.entries)
  if (inspected.conflicts.length) throw new AppError('CONFLICT', '已固定的插件组合不再可用，请核对版本与授权。', { recoverable: true })
  return inspected.resolved
}
export function pinnedContributionContext(versions: InstalledVersion[], composition: PluginComposition, stage: Parameters<typeof contributionContexts>[1]) {
  return contributionContexts(resolvePinnedComposition(versions, composition), stage, composition)
}
export type MaterializedPluginTool = { tool: PluginManifestTool; params: JsonObject; guestToolId: string; recipe?: PluginRecipe }
/** Recipes and references enter the very same SDK broker/VM/budget as code tools. */
export function materializeContributionTools(manifest: PluginManifest, digest: string, composition?: PluginComposition): MaterializedPluginTool[] {
  const result: MaterializedPluginTool[] = manifest.tools.map(tool => ({ tool, guestToolId: tool.id, params: {} }))
  for (const entry of composition?.entries ?? []) {
    if (entry.pluginId !== manifest.id || entry.digest !== digest) continue
    const c = manifest.contributions?.find(c => c.id === entry.contributionId)
    if (!c || c.kind === 'context-fragment' || c.kind === 'creative-policy' || c.kind === 'team-preset') continue
    const original = c.kind === 'tool-reference' ? manifest.tools.find(t => t.id === c.toolId)! : c.tool
    const tool = { ...original, id: `contribution__${c.id}`, description: `${c.name}（${c.stages.join('、')}）· ${original.description}`.slice(0, 2000) }
    result.push({ tool, params: structuredClone(entry.params), guestToolId: original.id, ...(c.kind === 'tool-reference' ? {} : { recipe: c.recipe }) })
  }
  return result
}
