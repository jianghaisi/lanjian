import { assertJson, PluginContractError, validateValue } from './schema.ts'
import type { PluginManifest } from './manifest.ts'
import type { CompositionEntry, PluginComposition } from './contributions.ts'
import { renderContributionText, contributionLimits, pluginIdentity, contributionId, validatePluginComposition } from './contributions.ts'
import type { JsonObject } from './types.ts'
import { creativeSlots } from './creative-slots.ts'
export { creativeSlots } from './creative-slots.ts'

/** Supported domain slots, never package IDs or unbounded service dispatch. */
export type CreativeSlot = keyof typeof creativeSlots
export type CreativePolicy = { kind: 'creative-policy'; slot: CreativeSlot; mode: 'replace' | 'append' | 'disabled'; asset?: string }
export type TeamPreset = { kind: 'team-preset'; asset: string }
export type CreativeMember = {
  id: string; name: string; initials: string; task: 'outline' | 'chapterOutline' | 'prose' | 'review'
  color: string; responsibility: string; capabilities: string[]; preparationKinds: string[]
}
export type CreativeStarter = { id: string; label: string; hint: string; message: string }
export type CreativeTeam = { format: 1; members: CreativeMember[]; starters?: CreativeStarter[] }
export type CreativeTeamSource = { pluginId: string; version: string; digest: string; contributionId: string; compositionRevision: number; params: JsonObject; team: CreativeTeam }
export type CreativePackage = { manifest: PluginManifest; digest: string; files: ReadonlyMap<string, string> }
export type PolicySource = {
  pluginId: string; version: string; digest: string; contributionId: string; slot: CreativeSlot
  compositionRevision: number; params: JsonObject; text: string; mode: CreativePolicy['mode']
}
export type CreativePolicyRecord = Omit<PolicySource, 'text'>
const bad = (): never => { throw new PluginContractError() }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) return bad()
  return value as Record<string, unknown>
}
function text(v: unknown, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)) return bad()
  return v
}
/** Diagnostic provenance only; never authorization or a substitute for package load. */
export function validatePolicyRecords(value: unknown): CreativePolicyRecord[] {
  assertJson(value, contributionLimits.snapshotBytes)
  if (!Array.isArray(value) || value.length > contributionLimits.selected) return bad()
  return value.map(raw => {
    const p = record(raw, ['pluginId', 'version', 'digest', 'contributionId', 'slot', 'compositionRevision', 'params', 'mode'])
    if (typeof p.digest !== 'string' || !/^[a-f0-9]{64}$/.test(p.digest) || typeof p.slot !== 'string' || !Object.hasOwn(creativeSlots, p.slot)
      || !Number.isSafeInteger(p.compositionRevision) || Number(p.compositionRevision) < 0 || !['replace', 'append'].includes(String(p.mode))
      || !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) return bad()
    assertJson(p.params, contributionLimits.paramsBytes)
    return { pluginId: pluginIdentity(p.pluginId), version: text(p.version, 64), digest: p.digest, contributionId: contributionId(p.contributionId),
      slot: p.slot as CreativeSlot, compositionRevision: Number(p.compositionRevision), params: structuredClone(p.params) as JsonObject, mode: p.mode as CreativePolicyRecord['mode'] }
  })
}
export function policyRecords(sources: readonly PolicySource[]): CreativePolicyRecord[] {
  return validatePolicyRecords(sources.map(({ text: _text, ...record }) => record))
}

/** Optional bounded genre table in a method asset; plain authored methods also work. */
function genreGuidance(source: string, params: JsonObject): string {
  if (!source.trimStart().startsWith('{')) return renderContributionText(source, params)
  const raw = JSON.parse(source); assertJson(raw, 64 * 1024)
  const root = record(raw, ['format', 'fallback', 'genres'])
  if (root.format !== 'genre-guidance-v1' || !Array.isArray(root.genres) || root.genres.length > 128) return bad()
  const fallback = text(root.fallback, 2000)
  const genres = root.genres.map(raw => {
    const g = record(raw, ['id', 'guidance', 'subgenres'])
    if (!Array.isArray(g.subgenres) || g.subgenres.length > 128) return bad()
    const subgenres = g.subgenres.map(raw => { const s = record(raw, ['id', 'guidance']); return { id: text(s.id, 120), guidance: text(s.guidance, 2000) } })
    if (new Set(subgenres.map(s => s.id)).size !== subgenres.length) return bad()
    return { id: text(g.id, 120), guidance: text(g.guidance, 2000), subgenres }
  })
  if (new Set(genres.map(g => g.id)).size !== genres.length) return bad()
  const selected = genres.find(g => g.id === params.genre)
  return [selected?.guidance ?? fallback, selected?.subgenres.find(s => s.id === params.subgenre)?.guidance ?? ''].filter(Boolean).join('\n')
}
export function validateCreativeTeam(value: unknown): CreativeTeam {
  assertJson(value, contributionLimits.snapshotBytes)
  const root = record(value, ['format', 'members', 'starters'])
  if (root.format !== 1 || !Array.isArray(root.members) || !root.members.length || root.members.length > 16) return bad()
  const members = root.members.map(raw => {
    const m = record(raw, ['id', 'name', 'initials', 'task', 'color', 'responsibility', 'capabilities', 'preparationKinds'])
    const id = text(m.id, 64)
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || !['outline', 'chapterOutline', 'prose', 'review'].includes(String(m.task))) bad()
    const list = (v: unknown, allowed: readonly string[], max: number): string[] => {
      if (!Array.isArray(v) || v.length > max || new Set(v).size !== v.length || v.some(s => typeof s !== 'string' || !allowed.includes(s))) return bad()
      return [...v]
    }
    return { id, name: text(m.name, 100), initials: text(m.initials, 8), task: m.task as CreativeMember['task'], color: text(m.color, 40), responsibility: text(m.responsibility, 4000),
      capabilities: list(m.capabilities, ['book.read', 'planning.read', 'planning.candidate', 'manuscript.read', 'manuscript.candidate', 'review.read', 'model.generate', 'author.ask', 'assets.read', 'group.prepare', 'group.delegate', 'group.create'], 12),
      preparationKinds: list(m.preparationKinds, ['definition', 'world', 'characters', 'outline', 'timeline', 'research', 'adaptation'], 7) }
  })
  if (new Set(members.map(m => m.id)).size !== members.length) bad()
  if (root.starters === undefined) return { format: 1, members }
  if (!Array.isArray(root.starters) || root.starters.length > 8) return bad()
  const starters = root.starters.map(raw => {
    const s = record(raw, ['id', 'label', 'hint', 'message']), id = text(s.id, 64)
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) return bad()
    return { id, label: text(s.label, 100), hint: text(s.hint, 300), message: text(s.message, 12000) }
  })
  if (new Set(starters.map(s => s.id)).size !== starters.length) return bad()
  return { format: 1, members, starters }
}

/** Validate every strategy asset both at preview and immutable installed load. */
export function validateCreativeAssets(manifest: PluginManifest, files: ReadonlyMap<string, string>): void {
  let characters = 0
  for (const c of manifest.contributions ?? []) {
    if (c.kind !== 'creative-policy' && c.kind !== 'team-preset') continue
    if (c.kind === 'creative-policy' && c.mode === 'disabled') continue
    const source = files.get(c.asset!)
    if (source === undefined || !source.trim() || source.length > 12000) bad()
    characters += source!.length
    if (c.kind === 'team-preset') validateCreativeTeam(JSON.parse(source!))
    else {
      if (c.slot === 'genre-guidance') genreGuidance(source!, {})
      for (const match of source!.matchAll(/\{\{([^{}]+)\}\}/g)) if (c.configSchema.type !== 'object' || !Object.hasOwn(c.configSchema.properties, match[1])) bad()
    }
  }
  if (characters > contributionLimits.contextChars) bad()
}

/** Explicit selection replaces the release default; fragments never become policies. */
export function resolveCreativePolicy(defaults: readonly CreativePackage[], installed: readonly CreativePackage[], composition: PluginComposition, slot: CreativeSlot, defaultParams: JsonObject = {}): PolicySource[] {
  const materialize = (pkg: CreativePackage, entry: CompositionEntry | undefined) => (pkg.manifest.contributions ?? [])
    .filter(c => c.kind === 'creative-policy' && c.slot === slot && (!entry || c.id === entry.contributionId))
    .map(c => {
      if (c.kind !== 'creative-policy') return bad()
      const schema = c.configSchema
      const inherited = slot === 'genre-guidance' && schema.type === 'object'
        ? Object.fromEntries(Object.entries(defaultParams).filter(([key]) => Object.hasOwn(schema.properties, key))) as JsonObject : defaultParams
      const params = entry ? { ...inherited, ...entry.params } : defaultParams
      validateValue(c.configSchema, params, contributionLimits.paramsBytes)
      validateCreativeAssets(pkg.manifest, pkg.files)
      return { pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest, contributionId: c.id, slot, compositionRevision: composition.revision,
        params: structuredClone(params), mode: c.mode, text: c.mode === 'disabled' ? '' : slot === 'genre-guidance' ? genreGuidance(pkg.files.get(c.asset!)!, params) : renderContributionText(pkg.files.get(c.asset!)!, params) }
    })
  const selected = composition.entries.flatMap(entry => {
    const pkg = installed.find(p => p.manifest.id === entry.pluginId && p.digest === entry.digest)
    if (!pkg || !pkg.manifest.contributions?.some(c => c.id === entry.contributionId)) return bad()
    return materialize(pkg, entry)
  })
  const primary = selected.filter(p => p.mode !== 'append')
  if (primary.length > 1 || primary.some(p => p.mode === 'disabled')) return bad()
  const baseline = primary.length ? primary : defaults.flatMap(p => materialize(p, undefined)).filter(p => p.mode === 'replace')
  if (baseline.length !== 1) return bad()
  const result = [...baseline, ...selected.filter(p => p.mode === 'append')]
  if (result.reduce((sum, p) => sum + p.text.length, 0) > contributionLimits.contextChars) bad()
  return result
}

/** The actual selected literal team asset; data never grants installed authority. */
export function resolveCreativeTeam(defaults: readonly CreativePackage[], installed: readonly CreativePackage[], value: PluginComposition): CreativeTeamSource {
  const composition = validatePluginComposition(value)
  const selected = composition.entries.flatMap(entry => {
    const pkg = installed.find(pkg => pkg.manifest.id === entry.pluginId && pkg.digest === entry.digest)
    const contribution = pkg?.manifest.contributions?.find(item => item.id === entry.contributionId)
    if (!pkg || !contribution) return bad()
    return contribution.kind === 'team-preset' ? [{ pkg, contribution, params: entry.params }] : []
  })
  if (selected.length > 1) return bad()
  const choices: typeof selected = selected.length ? selected : defaults.flatMap(pkg => (pkg.manifest.contributions ?? []).flatMap(contribution => contribution.kind === 'team-preset' ? [{ pkg, contribution, params: {} }] : []))
  if (choices.length !== 1) return bad()
  const { pkg, contribution, params } = choices[0]
  validateValue(contribution.configSchema, params)
  validateCreativeAssets(pkg.manifest, pkg.files)
  const asset = pkg.files.get(contribution.asset)
  if (asset === undefined) return bad()
  return { pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest, contributionId: contribution.id, compositionRevision: composition.revision,
    params: structuredClone(params), team: validateCreativeTeam(JSON.parse(asset)) }
}
