import { assertJson, codePluginLimits, validatePluginManifest, validatePluginPath, type PluginManifest } from '@lanjian/writing-plugin-contracts'
import { boundedInteger, boundedString, enumValue, exactArgs, exactRecord, invalid, requiredString, uuid } from '../core/validation'
import { decodePluginInstallPreview, type PluginInstallPreview } from './management-contracts'

export const draftLimits = { count: 50, documentBytes: 8 * 1024 * 1024, draftBytes: 3 * 1024 * 1024 } as const
export type DraftContent = { manifestText: string; files: { path: string; content: string }[] }
export type PluginDraft = DraftContent & { id: string; pluginId: string; revision: number; updatedAt: string; upstream: { pluginId: string; version: string; digest: string } | null }
export type DraftRef = { id: string; revision: number }
export type DraftExport = DraftRef & { digest: string }
export type DraftExportResult = { draftId: string; revision: number; digest: string; fileName: string }
export type DraftSave = DraftRef & DraftContent
export type DraftTemplate = 'context' | 'workflow' | 'code'
export type DraftBuild = { draftId: string; revision: number; digest: string; manifest: PluginManifest; files: { path: string; bytes: number; digest: string }[] }
export type PluginAuthoringApi = {
  listDrafts(): Promise<PluginDraft[]>
  createDraft(template: DraftTemplate): Promise<PluginDraft>
  saveDraft(input: DraftSave): Promise<PluginDraft>
  validateDraft(input: DraftRef): Promise<DraftBuild>
  buildDraft(input: DraftRef): Promise<DraftBuild>
  exportDraft(input: DraftExport): Promise<DraftExportResult | null>
  previewDraft(input: DraftRef): Promise<PluginInstallPreview>
  importDraftSource(input: DraftRef): Promise<PluginDraft | null>
  importDraftPackage(): Promise<PluginDraft | null>
  deriveDraft(input: { pluginId: string; digest: string }): Promise<PluginDraft>
}
export function decodeDraftContent(value: unknown): DraftContent {
  const v = exactRecord(value, 'draft', ['manifestText', 'files'])
  assertJson(value, draftLimits.draftBytes)
  const manifestText = boundedString(v.manifestText, 'manifestText', codePluginLimits.manifestBytes)
  if (!Array.isArray(v.files) || v.files.length > codePluginLimits.files - 1) return invalid('files', '文件数量无效')
  const files = v.files.map(raw => {
    const f = exactRecord(raw, 'file', ['path', 'content'])
    let path: string
    try { path = validatePluginPath(f.path) } catch { return invalid('file.path', '路径无效') }
    if (path.toLowerCase() === 'lanjian-plugin.json') invalid('file.path', '清单需单独编辑')
    return { path, content: boundedString(f.content, 'content', codePluginLimits.entryBytes) }
  })
  if (new Set(files.map(f => f.path.toLowerCase())).size !== files.length) invalid('files', '文件名重复')
  return { manifestText, files }
}
export const decodeDraftRef = (value: unknown): DraftRef => {
  const v = exactRecord(value, 'draft', ['id', 'revision'])
  return { id: uuid(v.id, 'id'), revision: boundedInteger(v.revision, 'revision', 1, Number.MAX_SAFE_INTEGER) }
}
export function decodePluginDraft(value: unknown): PluginDraft {
  const v = exactRecord(value, 'draft', ['id', 'pluginId', 'revision', 'updatedAt', 'manifestText', 'files', 'upstream'])
  const pluginId = requiredString(v.pluginId, 'pluginId', 128)
  if (!/^personal\.[0-9a-f-]{36}$/.test(pluginId)) invalid('pluginId', '身份无效')
  let upstream: PluginDraft['upstream'] = null
  if (v.upstream !== null) {
    const u = exactRecord(v.upstream, 'upstream', ['pluginId', 'version', 'digest'])
    upstream = { pluginId: requiredString(u.pluginId, 'pluginId', 128), version: requiredString(u.version, 'version', 64), digest: decodeDigest(u.digest) }
  }
  return { ...decodeDraftRef({ id: v.id, revision: v.revision }), pluginId, updatedAt: requiredString(v.updatedAt, 'updatedAt', 40), upstream, ...decodeDraftContent({ manifestText: v.manifestText, files: v.files }) }
}
export function decodeDrafts(value: unknown): PluginDraft[] {
  assertJson(value, draftLimits.documentBytes)
  if (!Array.isArray(value) || value.length > draftLimits.count) return invalid('drafts', '数量无效')
  const drafts = value.map(decodePluginDraft)
  if (new Set(drafts.map(d => d.id)).size !== drafts.length || new Set(drafts.map(d => d.pluginId)).size !== drafts.length) invalid('drafts', '身份重复')
  return drafts
}
export function decodeDigest(v: unknown): string { const s = requiredString(v, 'digest', 64); if (!/^[a-f0-9]{64}$/.test(s)) invalid('digest', '摘要无效'); return s }
export function decodeDraftBuild(value: unknown): DraftBuild {
  const v = exactRecord(value, 'build', ['draftId', 'revision', 'digest', 'manifest', 'files'])
  const manifest = validatePluginManifest(v.manifest)
  if (!Array.isArray(v.files) || v.files.length > codePluginLimits.files) invalid('files', '数量无效')
  return { draftId: uuid(v.draftId, 'draftId'), revision: boundedInteger(v.revision, 'revision', 1, Number.MAX_SAFE_INTEGER), digest: decodeDigest(v.digest), manifest, files: (v.files as unknown[]).map(f => {
    const file = exactRecord(f, 'file', ['path', 'bytes', 'digest'])
    return { path: validatePluginPath(file.path), bytes: boundedInteger(file.bytes, 'bytes', 0, codePluginLimits.unpackedBytes), digest: decodeDigest(file.digest) }
  }) }
}
const one = (args: unknown[]) => { exactArgs(args, 1); return args[0] }
export const decodeDraftRefArgs = (args: unknown[]): [DraftRef] => [decodeDraftRef(one(args))]
export function decodeDraftExport(value: unknown): DraftExport {
  const v = exactRecord(value, 'export', ['id', 'revision', 'digest'])
  return { ...decodeDraftRef({ id: v.id, revision: v.revision }), digest: decodeDigest(v.digest) }
}
export const decodeDraftExportArgs = (args: unknown[]): [DraftExport] => [decodeDraftExport(one(args))]
export function decodeDraftExportResult(value: unknown): DraftExportResult | null {
  if (value === null) return null
  const v = exactRecord(value, 'export', ['draftId', 'revision', 'digest', 'fileName'])
  const fileName = requiredString(v.fileName, 'fileName', 255)
  if (/[\\/:\u0000-\u001f]/.test(fileName) || !fileName.toLowerCase().endsWith('.zip')) invalid('fileName', '文件名无效')
  return { draftId: uuid(v.draftId, 'draftId'), revision: boundedInteger(v.revision, 'revision', 1, Number.MAX_SAFE_INTEGER), digest: decodeDigest(v.digest), fileName }
}
export const decodeDraftTemplateArgs = (args: unknown[]): [DraftTemplate] => [enumValue(one(args), 'template', ['context', 'workflow', 'code'])]
export function decodeDraftSaveArgs(args: unknown[]): [DraftSave] {
  const v = exactRecord(one(args), 'draft', ['id', 'revision', 'manifestText', 'files'])
  return [{ ...decodeDraftRef({ id: v.id, revision: v.revision }), ...decodeDraftContent({ manifestText: v.manifestText, files: v.files }) }]
}
export function decodeDeriveArgs(args: unknown[]): [{ pluginId: string; digest: string }] {
  const v = exactRecord(one(args), 'derive', ['pluginId', 'digest']), pluginId = requiredString(v.pluginId, 'pluginId', 128)
  if (!/^[a-z][a-z0-9.-]*$/.test(pluginId)) invalid('pluginId', '身份无效')
  return [{ pluginId, digest: decodeDigest(v.digest) }]
}
export const authoringResultDecoders = {
  'writing-plugins:list-drafts': decodeDrafts,
  'writing-plugins:create-draft': decodePluginDraft,
  'writing-plugins:save-draft': decodePluginDraft,
  'writing-plugins:validate-draft': decodeDraftBuild,
  'writing-plugins:build-draft': decodeDraftBuild,
  'writing-plugins:export-draft': decodeDraftExportResult,
  'writing-plugins:preview-draft': decodePluginInstallPreview,
  'writing-plugins:import-draft-source': (v: unknown) => v === null ? null : decodePluginDraft(v),
  'writing-plugins:import-draft-package': (v: unknown) => v === null ? null : decodePluginDraft(v),
  'writing-plugins:derive-draft': decodePluginDraft
}
