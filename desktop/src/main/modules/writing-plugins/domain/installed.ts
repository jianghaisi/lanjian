import { assertJson, codePluginLimits, validatePluginManifest, validatePluginPath, validatePluginComposition, type PluginManifest, type PluginComposition } from '@lanjian/writing-plugin-contracts'
export type InstalledFile = { path: string; digest: string; bytes: number }
export type InstalledVersion = { digest: string; manifest: PluginManifest; files: InstalledFile[]; installedAt: string; origin: 'local'; grants: string[] }
export type InstalledPlugin = { id: string; current: string; enabled: boolean; versions: InstalledVersion[] }
export type PluginIndex = { format: 1; revision: number; plugins: InstalledPlugin[]; books: { id: string; plugins: string[]; composition?: PluginComposition }[]; library?: PluginComposition }
export type ValidatedPluginPackage = { manifest: PluginManifest; digest: string; unpackedBytes: number; files: Map<string, Uint8Array> }
export interface PluginPackageStorePort {
  read(): Promise<PluginIndex>
  write(index: PluginIndex, expectedRevision: number): Promise<void>
  readZip(path: string): Promise<ValidatedPluginPackage>
  publish(pkg: ValidatedPluginPackage): Promise<InstalledVersion>
  load(version: InstalledVersion): Promise<Map<string, Uint8Array>>
  remove(version: InstalledVersion): Promise<void>
}
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const bad = (): never => { throw new Error('Invalid plugin index') }
function obj(v: unknown, fields: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k))) return bad()
  return v as Record<string, unknown>
}
function list(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max) return bad(); return v }
function unique(v: string[]): void { if (new Set(v).size !== v.length) bad() }
export function decodePluginIndex(value: unknown): PluginIndex {
  assertJson(value, codePluginLimits.indexBytes)
  const root = obj(value, ['format', 'revision', 'plugins', 'books', ...(value && typeof value === 'object' && Object.hasOwn(value, 'library') ? ['library'] : [])])
  if (root.format !== 1 || !Number.isSafeInteger(root.revision) || Number(root.revision) < 0) bad()
  const plugins: InstalledPlugin[] = list(root.plugins, codePluginLimits.installedPlugins).map(raw => {
    const p = obj(raw, ['id', 'current', 'enabled', 'versions'])
    if (typeof p.id !== 'string' || !digest(p.current) || typeof p.enabled !== 'boolean') bad()
    const versions: InstalledVersion[] = list(p.versions, codePluginLimits.installedVersions).map(raw => {
      const v = obj(raw, ['digest', 'manifest', 'files', 'installedAt', 'origin', 'grants']), manifest = validatePluginManifest(v.manifest)
      if (manifest.id !== p.id || !digest(v.digest) || v.origin !== 'local' || typeof v.installedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v.installedAt)) bad()
      const grants = list(v.grants, 16)
      if (grants.some(c => typeof c !== 'string' || !manifest.capabilities.includes(c))) bad()
      unique(grants as string[])
      const files: InstalledFile[] = list(v.files, codePluginLimits.files).map(raw => {
        const f = obj(raw, ['path', 'digest', 'bytes']), path = validatePluginPath(f.path)
        if (!digest(f.digest) || !Number.isSafeInteger(f.bytes) || Number(f.bytes) < 0 || Number(f.bytes) > codePluginLimits.unpackedBytes) bad()
        return { path, digest: f.digest as string, bytes: Number(f.bytes) }
      })
      unique(files.map(f => f.path.toLowerCase()))
      if (files.reduce((sum, f) => sum + f.bytes, 0) > codePluginLimits.unpackedBytes || ['lanjian-plugin.json', manifest.entry, ...manifest.assets ?? []].some(path => !files.some(f => f.path === path))) bad()
      return { digest: v.digest as string, manifest, files, installedAt: v.installedAt as string, origin: 'local', grants: grants as string[] }
    })
    unique(versions.map(v => v.digest)); unique(versions.map(v => v.manifest.version))
    if (!versions.some(v => v.digest === p.current)) bad()
    return { id: p.id as string, current: p.current as string, enabled: p.enabled as boolean, versions }
  })
  unique(plugins.map(p => p.id))
  const books = list(root.books, 2000).map(raw => {
    const b = obj(raw, ['id', 'plugins', ...(raw && typeof raw === 'object' && Object.hasOwn(raw, 'composition') ? ['composition'] : [])])
    // V3's main-owned workItemId is the canonical book path, not a UUID.
    // It stays inside the application index and never becomes a guest argument.
    if (typeof b.id !== 'string' || !b.id.trim() || b.id.length > 32767 || /[\u0000-\u001f]/u.test(b.id)) bad()
    const ids = list(b.plugins, codePluginLimits.installedPlugins)
    if (ids.some(id => typeof id !== 'string' || !plugins.some(p => p.id === id))) bad()
    unique(ids as string[])
    return { id: b.id as string, plugins: ids as string[], ...(b.composition === undefined ? {} : { composition: validatePluginComposition(b.composition) }) }
  })
  unique(books.map(b => b.id))
  return { format: 1, revision: Number(root.revision), plugins, books, ...(root.library === undefined ? {} : { library: validatePluginComposition(root.library) }) }
}
