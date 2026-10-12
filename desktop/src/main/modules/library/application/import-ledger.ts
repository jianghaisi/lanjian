import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectDirectory } from '../../../platform/storage/project-path'
import { writeJson } from '../../../platform/storage/json-store'
import type { TxtCreationMethod } from '../../../../contracts/index'

export type ImportRecord = {
  id: string; importedAt: string; fileName: string; title: string; sha256: string
  ownership: 'owned' | 'material' | 'external'; creationMethod?: TxtCreationMethod
  chapterIds: number[]; sourceIds?: string[]; selectedChapterIndexes?: number[]; storagePath: string
}
export type ImportLedger = { version: 1; records: ImportRecord[] }
type Snapshot = { ledger: ImportLedger; bytes: Buffer | null; identity: string | null }
type JsonSnapshot = { value: unknown; bytes: Buffer; identity: string }
export const importUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hashPattern = /^[a-f0-9]{64}$/
const maximumBytes = 20 * 1024 * 1024

export function importConflict(message = '导入记录损坏或不完整，已停止写入；请先核对，原文件与记录均已保留。'): AppError {
  return new AppError('CONFLICT', message, { recoverable: true })
}
export function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
const text = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
function relativeStorage(value: unknown): boolean {
  return text(value) && !/[\\:\x00]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..')
}
function numbers(value: unknown, min: number, max: number): value is number[] {
  return Array.isArray(value) && value.length <= 5000 && new Set(value).size === value.length && value.every(id => Number.isSafeInteger(id) && id >= min && id <= max)
}
function validRecord(value: unknown): value is ImportRecord {
  if (!object(value) || !text(value.id) || !importUuid.test(value.id) || !text(value.sha256) || !hashPattern.test(value.sha256)
    || !text(value.importedAt) || !Number.isFinite(Date.parse(value.importedAt)) || !text(value.fileName) || !text(value.title)
    || typeof value.ownership !== 'string' || !['owned', 'material', 'external'].includes(value.ownership) || !numbers(value.chapterIds, 1, 1_000_000)
    || !relativeStorage(value.storagePath)) return false
  if (value.creationMethod !== undefined && (typeof value.creationMethod !== 'string' || !['human', 'ai', 'mixed'].includes(value.creationMethod))) return false
  if (value.sourceIds !== undefined && (!Array.isArray(value.sourceIds) || value.sourceIds.length > 10000 || !value.sourceIds.every(id => text(id)))) return false
  if (value.selectedChapterIndexes !== undefined && !numbers(value.selectedChapterIndexes, 0, 4999)) return false
  return value.ownership === 'owned' ? value.chapterIds.length > 0 : value.chapterIds.length === 0
}

/** Strict import metadata only; optional settings keep their existing reader. */
export async function readImportJson(root: string, relative: string): Promise<JsonSnapshot | null> {
  let observed = false
  try {
    const path = await projectDirectory(root, join(root, relative))
    const before = await stat(path, { bigint: true })
    observed = true
    if (!before.isFile() || before.size > BigInt(maximumBytes)) throw importConflict()
    const bytes = await readFile(path)
    const after = await stat(path, { bigint: true })
    const identity = `${before.dev}:${before.ino}:${before.birthtimeNs}`
    if (identity !== `${after.dev}:${after.ino}:${after.birthtimeNs}` || before.mtimeNs !== after.mtimeNs || bytes.length > maximumBytes) throw importConflict()
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes, identity }
  } catch (error) {
    if (!observed && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof AppError) throw error
    throw new AppError('CONFLICT', '导入记录无法读取，已停止写入；原文件与记录均已保留。', { recoverable: true, cause: error })
  }
}

export async function importEntries(root: string, relative: string): Promise<string[]> {
  try {
    const entries = await readdir(await projectDirectory(root, join(root, relative)))
    if (entries.length > 10000) throw importConflict('导入记录过多，请先核对整理；未修改任何文件。')
    return entries
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (error instanceof AppError) throw error
    throw new AppError('CONFLICT', '导入记录目录无法读取，已停止写入。', { recoverable: true, cause: error })
  }
}

export async function readImportLedger(root: string, allowedPendingManifest?: string): Promise<Snapshot> {
  const source = await readImportJson(root, '.webnovel/imports/index.json')
  if (source) {
    const value = source.value
    if (!object(value) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > 100000
      || !value.records.every(validRecord) || new Set(value.records.map(r => r.id)).size !== value.records.length
      || new Set(value.records.map(r => r.sha256)).size !== value.records.length) throw importConflict()
    return { ledger: value as ImportLedger, bytes: source.bytes, identity: source.identity }
  }
  // A recovery copy is evidence, not permission to silently rebuild the index.
  if (await readImportJson(root, '.webnovel/imports/index.json.recovery')) throw importConflict()
  for (const directory of ['sources', 'operations']) {
    if ((await importEntries(root, `.webnovel/imports/${directory}`)).length) throw importConflict()
  }
  for (const id of await importEntries(root, '.webnovel/imports/manifests')) {
    if (id !== allowedPendingManifest || !importUuid.test(id)) throw importConflict()
    const journal = (await readImportJson(root, `.webnovel/imports/manifests/${id}/manifest.json`))?.value
    if (!object(journal) || !Array.isArray(journal.files) || !journal.files.every(f => object(f) && typeof f.status === 'string' && ['pending', 'skipped'].includes(f.status))) throw importConflict()
  }
  return { ledger: { version: 1, records: [] }, bytes: null, identity: null }
}

export async function publishImportLedger(root: string, snapshot: Snapshot, guard: () => Promise<unknown>): Promise<void> {
  await guard()
  const path = await projectDirectory(root, join(root, '.webnovel/imports/index.json'))
  await writeJson(path, snapshot.ledger, async () => {
    await guard()
    const current = await readImportJson(root, '.webnovel/imports/index.json')
    if (snapshot.bytes === null ? current !== null : !current || snapshot.identity !== current.identity || !snapshot.bytes.equals(current.bytes)) {
      throw importConflict('导入记录在操作期间发生变化，已停止；请核对原记录与本次导入。')
    }
  })
}

export async function assertNoPartialImport(root: string, ownManifest: string | undefined, ledger: ImportLedger): Promise<void> {
  for (const name of await importEntries(root, '.webnovel/imports/operations')) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw importConflict()
    const receipt = (await readImportJson(root, `.webnovel/imports/operations/${name}`))?.value
    if (!object(receipt) || receipt.version !== 1 || receipt.sha256 !== name.slice(0, -5) || receipt.status !== 'completed'
      || !text(receipt.id) || !importUuid.test(receipt.id) || !text(receipt.requestHash) || !hashPattern.test(receipt.requestHash)
      || !numbers(receipt.chapterIds, 1, 1_000_000) || !Array.isArray(receipt.sourceIds) || receipt.sourceIds.length > 10000
      || !receipt.sourceIds.every(id => text(id))) throw importConflict()
    const completed = ledger.records.find(record => record.id === receipt.id && record.sha256 === receipt.sha256)
    if (!completed || JSON.stringify(completed.chapterIds) !== JSON.stringify(receipt.chapterIds)
      || JSON.stringify(completed.sourceIds ?? []) !== JSON.stringify(receipt.sourceIds)) throw importConflict()
  }
  for (const id of await importEntries(root, '.webnovel/imports/manifests')) {
    if (!importUuid.test(id)) throw importConflict()
    const journal = (await readImportJson(root, `.webnovel/imports/manifests/${id}/manifest.json`))?.value
    if (!object(journal) || journal.version !== 1 || journal.id !== id || !Array.isArray(journal.files) || !journal.files.length || journal.files.length > 20
      || typeof journal.status !== 'string' || !['ready', 'committing', 'interrupted', 'completed', 'needs-review'].includes(journal.status)
      || !journal.files.every(file => object(file) && typeof file.status === 'string' && ['pending', 'running', 'completed', 'skipped', 'review'].includes(file.status))) throw importConflict()
    if (id === ownManifest) continue
    if (journal.status === 'needs-review' || journal.files.some(f => !object(f) || ['running', 'review'].includes(String(f.status)))) throw importConflict()
  }
}

export async function writeImportOperation(root: string, record: { id: string; sha256: string; request: unknown; chapterIds: number[]; sourceIds?: string[] },
  status: 'running' | 'completed', guard: () => Promise<unknown>): Promise<void> {
  await guard()
  const path = await projectDirectory(root, join(root, `.webnovel/imports/operations/${record.sha256}.json`))
  const requestHash = createHash('sha256').update(JSON.stringify(record.request)).digest('hex')
  await writeJson(path, { version: 1, id: record.id, sha256: record.sha256, requestHash, status,
    chapterIds: record.chapterIds, sourceIds: record.sourceIds ?? [] }, async () => { await guard() })
}
