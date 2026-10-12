import { validateCompositionEntries, validatePluginComposition, type CompositionEntry, type PluginComposition } from '@lanjian/writing-plugin-contracts'
import { boundedInteger, exactArgs, exactRecord, invalid, requiredString, uuid } from '../core/validation'
export { categoryLabel, pluginCategories, writingStages } from '@lanjian/writing-plugin-contracts'
export type { WritingContribution, CompositionEntry, PluginComposition } from '@lanjian/writing-plugin-contracts'
export type PluginProvenance = { distribution: 'local' | 'official' | 'community'; createdByMe: boolean }
export type CompositionInput = { bookToken: string; revision: number; entries: CompositionEntry[] }
export type LibraryCompositionInput = { libraryToken: string; revision: number; entries: CompositionEntry[] }
export type CompositionPreview = { planId: string; revision: number; entries: CompositionEntry[]; conflicts: { code: 'missing' | 'permission' | 'parameters' | 'exclusive' | 'cycle' | 'budget' | 'version'; contribution: string; message: string }[] }
export function decodeComposition(v: unknown): PluginComposition { try { return validatePluginComposition(v) } catch { return invalid('composition', '组合无效') } }
const entries = (v: unknown) => { try { return validateCompositionEntries(v) } catch { return invalid('entries', '贡献选择无效') } }
export function decodeCompositionArgs(args: unknown[]): [CompositionInput] {
  exactArgs(args, 1); const v = exactRecord(args[0], 'composition', ['bookToken', 'revision', 'entries'])
  return [{ bookToken: uuid(v.bookToken, 'bookToken'), revision: boundedInteger(v.revision, 'revision', 0, Number.MAX_SAFE_INTEGER), entries: entries(v.entries) }]
}
export function decodeLibraryCompositionArgs(args: unknown[]): [LibraryCompositionInput] {
  exactArgs(args, 1); const v = exactRecord(args[0], 'libraryComposition', ['libraryToken', 'revision', 'entries'])
  return [{ libraryToken: uuid(v.libraryToken, 'libraryToken'), revision: boundedInteger(v.revision, 'revision', 0, Number.MAX_SAFE_INTEGER), entries: entries(v.entries) }]
}
export function decodeCompositionPreview(raw: unknown): CompositionPreview {
  const v = exactRecord(raw, 'preview', ['planId', 'revision', 'entries', 'conflicts'])
  if (!Array.isArray(v.conflicts) || v.conflicts.length > 1024) return invalid('conflicts', '数量无效')
  return { planId: uuid(v.planId, 'planId'), revision: boundedInteger(v.revision, 'revision', 0, Number.MAX_SAFE_INTEGER), entries: entries(v.entries), conflicts: v.conflicts.map(raw => {
    const c = exactRecord(raw, 'conflict', ['code', 'contribution', 'message'])
    if (!['missing', 'permission', 'parameters', 'exclusive', 'cycle', 'budget', 'version'].includes(String(c.code))) invalid('code', '冲突类型无效')
    return { code: c.code as CompositionPreview['conflicts'][number]['code'], contribution: requiredString(c.contribution, 'contribution', 200), message: requiredString(c.message, 'message', 500) }
  }) }
}
export function decodePluginProvenance(raw: unknown): PluginProvenance {
  const v = exactRecord(raw, 'provenance', ['distribution', 'createdByMe'])
  if (!['local', 'official', 'community'].includes(String(v.distribution)) || typeof v.createdByMe !== 'boolean') return invalid('provenance', '来源无效')
  return { distribution: v.distribution as PluginProvenance['distribution'], createdByMe: v.createdByMe }
}
export function inPluginView(provenance: PluginProvenance, view: 'all' | 'official' | 'community' | 'mine'): boolean {
  return view === 'all' || view === 'mine' && provenance.createdByMe || view === provenance.distribution
}
