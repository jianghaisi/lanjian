import { contributionLimits, validatePluginManifest, type PluginManifest, type WritingContribution } from '@lanjian/writing-plugin-contracts'

/** A form projection, never proof that the draft can be built or installed.
 * Editable strings may be empty, unfinished or contain unresolved parameters.
 * Validate the surrounding structure, then restore the exact author input.
 */
export function editableDraftManifest(text: string): PluginManifest | null {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw.name !== 'string' || typeof raw.version !== 'string' || typeof raw.description !== 'string') return null
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((tag: unknown) => typeof tag !== 'string'))) return null
    const originals = new Map<string, { name: string; text: string }>()
    const contributions = raw.contributions?.map((c: Record<string, unknown>) => {
      if (c.kind !== 'context-fragment') return c
      if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.text !== 'string') throw new Error('Invalid guidance fields')
      originals.set(c.id, { name: c.name, text: c.text })
      return { ...c, name: '写作指导', text: '编辑中' }
    })
    const valid = validatePluginManifest({ ...raw, name: '草稿', version: '1.0.0', description: '编辑中', ...(raw.tags !== undefined ? { tags: [] } : {}), ...(contributions ? { contributions } : {}) })
    return {
      ...valid, name: raw.name, version: raw.version, description: raw.description,
      ...(raw.tags !== undefined ? { tags: [...raw.tags] } : {}),
      ...(valid.contributions ? { contributions: valid.contributions.map(c => c.kind === 'context-fragment' ? { ...c, ...originals.get(c.id)! } : c) } : {})
    }
  } catch { return null }
}

type Guidance = Extract<WritingContribution, { kind: 'context-fragment' }>
export type RemovedGuidance = { contribution: Guidance; index: number }
function assertRoom(manifest: PluginManifest) {
  if ((manifest.contributions?.length ?? 0) >= contributionLimits.count) throw new Error(`一个插件最多包含 ${contributionLimits.count} 项贡献，请先移除不需要的内容。`)
}
/** IDs here are author-owned manifest keys, never plugin or persisted draft IDs. */
export function addDraftGuidance(manifest: PluginManifest, copyId?: string, reservedId?: string): { manifest: PluginManifest; id: string } {
  assertRoom(manifest)
  const entries = manifest.contributions ?? [], used = new Set([...entries.map(c => c.id), reservedId])
  let suffix = 1
  while (used.has(`guidance-${suffix}`)) suffix++
  const id = `guidance-${suffix}`, source = entries.find(c => c.id === copyId)
  if (copyId && source?.kind !== 'context-fragment') throw new Error('这条指导已变化，请重新选择。')
  const contribution: Guidance = source?.kind === 'context-fragment'
    ? { ...JSON.parse(JSON.stringify(source)), id, name: `${source.name.slice(0, 96)}（副本）` }
    : { id, name: '新的写作指导', kind: 'context-fragment', stages: ['assistant', 'planning', 'writing', 'review'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, text: '' }
  return { manifest: { ...manifest, contributions: [...entries, contribution] }, id }
}
export function removeDraftGuidance(manifest: PluginManifest, id: string): { manifest: PluginManifest; removed: RemovedGuidance } {
  const entries = manifest.contributions ?? [], index = entries.findIndex(c => c.id === id), contribution = entries[index]
  if (contribution?.kind !== 'context-fragment') throw new Error('这条指导已变化，请重新选择。')
  const dependents = entries.filter(c => c.id !== id && c.requires?.some(d => d.pluginId === manifest.id && d.contributionId === id))
  if (dependents.length) throw new Error(`“${dependents.map(c => c.name || c.id).join('、')}”仍依赖这条指导，请先在高级清单中调整依赖。`)
  return { manifest: { ...manifest, contributions: entries.filter(c => c.id !== id) }, removed: { contribution: JSON.parse(JSON.stringify(contribution)), index } }
}
export function restoreDraftGuidance(manifest: PluginManifest, removed: RemovedGuidance): PluginManifest {
  assertRoom(manifest)
  const entries = [...manifest.contributions ?? []]
  if (entries.some(c => c.id === removed.contribution.id)) throw new Error('原指导标识已被使用，无法撤销移除。当前内容已保留。')
  entries.splice(Math.min(removed.index, entries.length), 0, JSON.parse(JSON.stringify(removed.contribution)))
  return { ...manifest, contributions: entries }
}
