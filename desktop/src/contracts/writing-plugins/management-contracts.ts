import { codePluginLimits, pluginSdkCapabilities, validatePluginManifest, type PluginManifest } from '@lanjian/writing-plugin-contracts'
import { boundedBoolean, boundedInteger, exactArgs, exactRecord, invalid, requiredString, uuid } from '../core/validation'
import type { PluginAuthoringApi } from './authoring'
import type { PluginMarketplaceApi } from './marketplace'
import type { BundledPluginsApi } from './bundled'
import { decodeComposition, decodeCompositionPreview, decodePluginProvenance, type CompositionInput, type LibraryCompositionInput, type CompositionPreview, type PluginComposition, type PluginProvenance } from './contributions'

export const supportedPluginCapabilities = pluginSdkCapabilities
export type PluginVersionView = { digest: string; manifest: PluginManifest; grants: string[]; installedAt: string }
export type PluginManagementView = {
  revision: number
  book: { token: string; title: string } | null
  composition: PluginComposition | null
  library?: { token: string; composition: PluginComposition }
  plugins: { id: string; current: string; enabled: boolean; bookEnabled: boolean; provenance: PluginProvenance; versions: PluginVersionView[] }[]
}
export type PluginInstallPreview = { planId: string; manifest: PluginManifest; digest: string; unpackedBytes: number; fileCount: number; addedCapabilities: string[]; existingVersion: string | null }
export type PluginRevisionInput = { id: string; revision: number }
export type PluginEnableInput = PluginRevisionInput & { enabled: boolean; grants: string[] }
export type PluginBookInput = PluginRevisionInput & { enabled: boolean; bookToken: string }
export type PluginVersionInput = PluginRevisionInput & { digest: string; grants: string[] }
export type WritingPluginsApi = PluginAuthoringApi & PluginMarketplaceApi & BundledPluginsApi & {
  list(withBook: boolean): Promise<PluginManagementView>
  choosePackage(): Promise<string | null>
  previewInstall(token: string): Promise<PluginInstallPreview>
  install(planId: string): Promise<boolean>
  setEnabled(input: PluginEnableInput): Promise<boolean>
  setBookEnabled(input: PluginBookInput): Promise<boolean>
  selectVersion(input: PluginVersionInput): Promise<boolean>
  uninstall(input: PluginRevisionInput): Promise<boolean>
  previewComposition(input: CompositionInput): Promise<CompositionPreview>
  previewLibraryComposition(input: LibraryCompositionInput): Promise<CompositionPreview>
  applyComposition(planId: string): Promise<boolean>
}
const revision = (v: unknown) => boundedInteger(v, 'revision', 0, Number.MAX_SAFE_INTEGER)
const digest = (v: unknown) => { const s = requiredString(v, 'digest', 64); if (!/^[a-f0-9]{64}$/.test(s)) invalid('digest', '格式无效'); return s }
const id = (v: unknown) => { const s = requiredString(v, 'id', 128); if (!/^[a-z][a-z0-9.-]{0,127}$/.test(s) || s.startsWith('builtin.')) invalid('id', '格式无效'); return s }
function list<T>(v: unknown, max: number, decode: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) return invalid('list', '数量无效')
  return v.map(decode)
}
function caps(v: unknown): string[] {
  const values = list(v, 16, value => requiredString(value, 'capability', 128))
  if (new Set(values).size !== values.length || values.some(c => !/^[a-z][a-z0-9.-]*$/.test(c))) invalid('capabilities', '格式无效')
  return values
}
function manifest(v: unknown): PluginManifest { try { return validatePluginManifest(v) } catch { return invalid('manifest', '插件清单无效') } }
export function decodePluginManagementView(value: unknown): PluginManagementView {
  const v = exactRecord(value, 'plugins', ['revision', 'book', 'plugins', 'composition', ...(value && typeof value === 'object' && Object.hasOwn(value, 'library') ? ['library'] : [])])
  const book = v.book === null ? null : exactRecord(v.book, 'book', ['token', 'title'])
  const library = v.library === undefined ? null : exactRecord(v.library, 'library', ['token', 'composition'])
  return { ...(library ? { library: { token: uuid(library.token, 'library.token'), composition: decodeComposition(library.composition) } } : {}), revision: revision(v.revision), composition: v.composition === null ? null : decodeComposition(v.composition), book: book && { token: uuid(book.token, 'book.token'), title: requiredString(book.title, 'book.title', 1000) }, plugins: list(v.plugins, codePluginLimits.installedPlugins, value => {
    const p = exactRecord(value, 'plugin', ['id', 'current', 'enabled', 'bookEnabled', 'versions', 'provenance'])
    const versions = list(p.versions, codePluginLimits.installedVersions, value => {
      const v = exactRecord(value, 'version', ['digest', 'manifest', 'grants', 'installedAt']), m = manifest(v.manifest), grants = caps(v.grants)
      if (m.id !== p.id || grants.some(c => !m.capabilities.includes(c))) invalid('version', '授权或身份无效')
      return { digest: digest(v.digest), manifest: m, grants, installedAt: requiredString(v.installedAt, 'installedAt', 40) }
    })
    if (!versions.some(v => v.digest === p.current) || new Set(versions.map(v => v.digest)).size !== versions.length) invalid('versions', '当前版本无效')
    return { id: id(p.id), current: digest(p.current), enabled: boundedBoolean(p.enabled, 'enabled'), bookEnabled: boundedBoolean(p.bookEnabled, 'bookEnabled'), provenance: decodePluginProvenance(p.provenance), versions }
  }) }
}
export function decodePluginInstallPreview(value: unknown): PluginInstallPreview {
  const v = exactRecord(value, 'preview', ['planId', 'manifest', 'digest', 'unpackedBytes', 'fileCount', 'addedCapabilities', 'existingVersion'])
  return { planId: uuid(v.planId, 'planId'), manifest: manifest(v.manifest), digest: digest(v.digest), unpackedBytes: boundedInteger(v.unpackedBytes, 'unpackedBytes', 1, codePluginLimits.unpackedBytes), fileCount: boundedInteger(v.fileCount, 'fileCount', 1, codePluginLimits.files), addedCapabilities: caps(v.addedCapabilities), existingVersion: v.existingVersion === null ? null : requiredString(v.existingVersion, 'existingVersion', 64) }
}
const one = (args: unknown[]) => { exactArgs(args, 1); return args[0] }
export const decodePluginListArgs = (args: unknown[]): [boolean] => [boundedBoolean(one(args), 'withBook')]
export const decodePluginTokenArgs = (args: unknown[]): [string] => [uuid(one(args), 'token')]
function base(args: unknown[], fields: string[]) { const v = exactRecord(one(args), 'input', ['id', 'revision', ...fields]); return { v, id: id(v.id), revision: revision(v.revision) } }
function grants(v: unknown) { const result = caps(v); if (result.some(c => !supportedPluginCapabilities.includes(c as typeof supportedPluginCapabilities[number]))) invalid('grants', '包含尚不支持的能力'); return result }
export function decodePluginEnableArgs(args: unknown[]): [PluginEnableInput] { const b = base(args, ['enabled', 'grants']); return [{ id: b.id, revision: b.revision, enabled: boundedBoolean(b.v.enabled, 'enabled'), grants: grants(b.v.grants) }] }
export function decodePluginBookArgs(args: unknown[]): [PluginBookInput] { const b = base(args, ['enabled', 'bookToken']); return [{ id: b.id, revision: b.revision, enabled: boundedBoolean(b.v.enabled, 'enabled'), bookToken: uuid(b.v.bookToken, 'bookToken') }] }
export function decodePluginVersionArgs(args: unknown[]): [PluginVersionInput] { const b = base(args, ['digest', 'grants']); return [{ id: b.id, revision: b.revision, digest: digest(b.v.digest), grants: grants(b.v.grants) }] }
export function decodePluginUninstallArgs(args: unknown[]): [PluginRevisionInput] { const b = base(args, []); return [{ id: b.id, revision: b.revision }] }
const success = (v: unknown) => { if (v !== true) invalid('result', '操作未确认'); return true }
export const writingPluginResultDecoders = {
  'writing-plugins:list': decodePluginManagementView,
  'writing-plugins:choose-package': (v: unknown) => v === null ? null : uuid(v, 'token'),
  'writing-plugins:preview-install': decodePluginInstallPreview,
  'writing-plugins:preview-composition': decodeCompositionPreview,
  'writing-plugins:preview-library-composition': decodeCompositionPreview,
  ...Object.fromEntries(['install', 'set-enabled', 'set-book-enabled', 'select-version', 'uninstall', 'apply-composition'].map(name => [`writing-plugins:${name}`, success]))
}
