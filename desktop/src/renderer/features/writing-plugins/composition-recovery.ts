import type { CompositionEntry } from '../../../contracts/writing-plugins/contributions'
import type { PluginManagementView } from '../../../contracts/writing-plugins/management-contracts'

/** Read-only recovery projection. A different installed digest is never a
 * replacement for the author's selected version or its parameter schema. */
export function unavailableContributions(entries: CompositionEntry[], plugins: PluginManagementView['plugins'], textDrafts: Record<string, string>, invalidFields: Record<string, string>) {
  return entries.flatMap(entry => {
    const plugin = plugins.find(p => p.id === entry.pluginId)
    const version = plugin?.versions.find(v => v.digest === entry.digest)
    if (version?.manifest.contributions?.some(c => c.id === entry.contributionId)) return []
    const prefix = `${entry.pluginId}/${entry.contributionId}/`
    const names = new Set([...Object.keys(entry.params), ...Object.keys(textDrafts).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))])
    return [{ entry,
      label: `${version?.manifest.name ?? entry.pluginId} · ${entry.contributionId}`,
      reason: !plugin ? '插件已卸载或尚未安装' : !version ? '本书选用的版本尚未安装' : '这个版本未提供这项写作能力',
      parameters: [...names].map(name => {
        const value = entry.params[name]
        return { name, text: textDrafts[`${prefix}${name}`] ?? (value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value)), error: invalidFields[`${prefix}${name}`] ?? '' }
      })
    }]
  })
}
