import type { JsonValue } from '@lanjian/writing-plugin-contracts'
import type { CompositionEntry } from '../../../contracts/writing-plugins/contributions'
import type { PluginManagementView } from '../../../contracts/writing-plugins/management-contracts'

const key = (entry: CompositionEntry) => `${entry.pluginId}/${entry.contributionId}`
const display = (value: JsonValue) => typeof value === 'boolean' ? value ? '开启' : '关闭' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)

export function describeCompositionEntry(entry: CompositionEntry, plugins: PluginManagementView['plugins']) {
  const version = plugins.find(p => p.id === entry.pluginId)?.versions.find(v => v.digest === entry.digest)
  const contribution = version?.manifest.contributions?.find(c => c.id === entry.contributionId)
  return { entry, label: `${version?.manifest.name ?? entry.pluginId} ${version?.manifest.version ?? '版本不可用'} · ${contribution?.name ?? entry.contributionId}`,
    stages: contribution?.stages ?? [],
    parameters: Object.entries(entry.params).map(([name, value]) => ({ name,
      label: contribution?.configSchema.type === 'object' ? contribution.configSchema.properties[name]?.description || name : name,
      text: display(value), structured: typeof value === 'object'
    })) }
}

// Object key order is not a parameter change; array order and value types are.
function equalValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalValue(v, b[i]))
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equalValue(a[k], b[k]))
}

/** Read-only explanation of a main-owned preview, never an approval or a new
 * candidate. Callers invalidate the whole preview when either source changes. */
export function reviewComposition(saved: CompositionEntry[], proposed: CompositionEntry[], plugins: PluginManagementView['plugins']) {
  const beforeByKey = new Map(saved.map(e => [key(e), e])), afterByKey = new Map(proposed.map(e => [key(e), e]))
  const rows = [...proposed, ...saved.filter(e => !afterByKey.has(key(e)))].map(entry => {
    const old = beforeByKey.get(key(entry)), next = afterByKey.get(key(entry))
    const before = old && describeCompositionEntry(old, plugins), after = next && describeCompositionEntry(next, plugins)
    const status: 'added' | 'removed' | 'changed' | 'unchanged' = !old ? 'added' : !next ? 'removed' : old.digest !== next.digest || !equalValue(old.params, next.params) ? 'changed' : 'unchanged'
    const names = new Set([...(before?.parameters.map(p => p.name) ?? []), ...(after?.parameters.map(p => p.name) ?? [])])
    return { key: key(entry), status, before, after, versionChanged: Boolean(old && next && old.digest !== next.digest),
      parameters: [...names].map(name => {
        const previous = before?.parameters.find(p => p.name === name), following = after?.parameters.find(p => p.name === name)
        return { name, label: following?.label ?? previous!.label, before: previous?.text, after: following?.text,
          changed: !previous || !following || !equalValue(old?.params[name], next?.params[name]) }
      })
    }
  })
  const commonBefore = saved.filter(e => afterByKey.has(key(e))).map(key), commonAfter = proposed.filter(e => beforeByKey.has(key(e))).map(key)
  return { rows, counts: { added: rows.filter(r => r.status === 'added').length, removed: rows.filter(r => r.status === 'removed').length,
    changed: rows.filter(r => r.status === 'changed').length, unchanged: rows.filter(r => r.status === 'unchanged').length },
    orderChanged: commonBefore.some((id, index) => id !== commonAfter[index]) }
}
