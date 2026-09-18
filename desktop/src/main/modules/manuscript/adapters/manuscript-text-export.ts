import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../core/ports/workspace-database'
import { stableEventReadSnapshot } from '../../timeline/adapters/event-read-snapshot'
import { ManuscriptFileStore, textHash } from './manuscript-file-store'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { workspaceDatabaseMigrations, workspaceMigrationChecksumMatches } from '../../../platform/storage/workspace-database'
import { assertManuscriptTextSchema } from './manuscript-text-objects'

const textTables = ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks'] as const
type TextTable = typeof textTables[number]
export type LegacyTextReference = {
  table: TextTable
  id: string
  hash: string
  relativePath: string
  metadata: Record<string, unknown>
}
export type LegacyCurrentText = {
  kind: 'body' | 'outline'
  documentId: string
  versionId: string
  relativePath: string
  hash: string
  observedHash: string | null
  state: 'matching' | 'missing' | 'stale-mirror' | 'external-conflict'
}
export type LegacyTextMigrationPreview = {
  version: 1
  projectId: string
  schemaVersion: number
  sourceFingerprint: string
  fingerprint: string
  counts: Record<TextTable, number>
  uniqueTexts: number
  uniqueBytes: number
  references: LegacyTextReference[]
  current: LegacyCurrentText[]
}

/** Read-only acquisition. No source connection, schema upgrade or mirror repair. */
export async function previewLegacyTextMigration(root: string): Promise<LegacyTextMigrationPreview> {
  return inspectLegacy(root, async preview => preview)
}

/** Verified staging bundle, NOT a storage-mode switch. The caller supplies a new,
 * empty directory outside the author book and an approved preview fingerprint. */
export async function exportLegacyTextMigration(root: string, destination: string, expectedFingerprint: string): Promise<LegacyTextMigrationPreview> {
  const source = await canonicalDirectory(root)
  const target = await canonicalDirectory(destination)
  const rel = relative(source, target)
  if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
    throw new AppError('PATH_ESCAPE', '迁移暂存目录必须位于原作品之外。', { recoverable: true })
  }
  if ((await readdir(target)).length) throw new AppError('CONFLICT', '迁移暂存目录必须为空，未覆盖已有文件。', { recoverable: true })
  return inspectLegacy(source, async (preview, objects, privateDatabase) => {
    if (preview.fingerprint !== expectedFingerprint) throw new AppError('CONFLICT', '作品内容或文件在预览后已变化，请重新预览；未导出过期数据。', { recoverable: true })
    const files = await ManuscriptFileStore.open(target)
    const backup = join(target, 'source-database')
    await mkdir(backup)
    const backups: { name: string; hash: string }[] = []
    for (const suffix of ['', '-wal']) {
      try {
        const name = 'workspace.sqlite' + suffix
        const bytes = await readFile(privateDatabase + suffix)
        await copyFile(privateDatabase + suffix, join(backup, name))
        if (hashBytes(await readFile(join(backup, name))) !== hashBytes(bytes)) throw integrity('数据库暂存副本校验失败。')
        backups.push({ name, hash: hashBytes(bytes) })
      } catch (error) {
        if (suffix && missing(error)) continue
        throw error
      }
    }
    for (const [hash, content] of objects) {
      const snapshot = await files.snapshot(content)
      if (snapshot.hash !== hash || (await files.readSnapshot(hash)).content !== content) throw integrity('正文历史导出校验失败。')
    }
    // Every row (including duplicate texts, archived versions and terminal
    // checkpoints) retains its original identity and metadata in the manifest.
    for (const reference of preview.references) {
      if ((await files.readSnapshot(reference.hash)).hash !== reference.hash) throw integrity('稿件引用导出不完整。')
    }
    // No status/authority marker is written into the source or this staging copy.
    await atomicWriteText(join(target, 'text-export.json'), JSON.stringify({ ...preview, backups, exportOnly: true }, null, 2) + '\n')
    return preview
  })
}

async function inspectLegacy<T>(root: string,
  operation: (preview: LegacyTextMigrationPreview, objects: Map<string, string>, privateDatabase: string) => Promise<T>): Promise<T> {
  const canonicalRoot = await canonicalDirectory(root)
  const snapshot = await stableEventReadSnapshot(canonicalRoot)
  if (!snapshot) throw new AppError('NOT_FOUND', '作品没有可迁移的旧正文数据库。', { recoverable: true })
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
    database.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON; BEGIN;')
    const schemaVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version)
    if (schemaVersion < 39 || schemaVersion > WORKSPACE_DATABASE_SCHEMA_VERSION) {
      throw new AppError('UNSUPPORTED_PROJECT_VERSION', '旧正文数据库版本暂不支持迁移；未执行升级。', { recoverable: true })
    }
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= schemaVersion)) {
      const row = database.prepare('SELECT name, checksum FROM schema_migrations WHERE version = ?').get(migration.version)
      if (row?.name !== migration.name || !workspaceMigrationChecksumMatches(migration, row.checksum)) throw integrity('数据库迁移记录不完整，未继续导出。')
    }
    if (schemaVersion >= 41) assertManuscriptTextSchema(database, schemaVersion)
    if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
      || database.prepare('PRAGMA foreign_key_check').all().length) throw integrity('数据库结构校验失败，未继续导出。')
    const projects = database.prepare('SELECT * FROM projects LIMIT 2').all()
    if (projects.length !== 1 || projects[0].storage_mode !== 'sqlite') throw integrity('作品尚未处于旧正式数据库模式。')
    if (projects[0].text_authority === 'files-v1') throw new AppError('CONFLICT', '作品已经使用文件正文，无需再次迁移。', { recoverable: true })
    if (projects[0].text_authority !== undefined && projects[0].text_authority !== 'legacy-sqlite') throw integrity('作品正文权威状态未知，未继续导出。')
    const projectId = String(projects[0].id)
    const objects = new Map<string, string>()
    const references: LegacyTextReference[] = []
    const counts = Object.fromEntries(textTables.map(table => [table, 0])) as Record<TextTable, number>
    for (const table of textTables) {
      // Table names are closed constants, never supplied by the caller or renderer.
      for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY id`).iterate()) {
        const { content, content_hash: hashValue, ...metadata } = row
        if (typeof content !== 'string' || typeof hashValue !== 'string' || !/^[a-f0-9]{64}$/.test(hashValue)
          || textHash(content) !== hashValue || content.includes('\0') || Buffer.byteLength(content) > 16 * 1024 * 1024) {
          throw integrity('正文、大纲或历史内容校验失败，未跳过损坏记录。')
        }
        objects.set(hashValue, content)
        references.push({ table, id: String(row.id), hash: hashValue, relativePath: `.webnovel/history/text/${hashValue}.md`, metadata })
        counts[table]++
      }
    }
    const current: LegacyCurrentText[] = []
    const store = await ManuscriptFileStore.open(canonicalRoot)
    for (const row of database.prepare(`
      SELECT 'body' AS kind, c.id AS document_id, c.current_body_version_id AS version_id,
        v.content_hash, m.relative_path, m.observed_hash
      FROM chapters c JOIN body_versions v ON v.id = c.current_body_version_id AND v.chapter_id = c.id
      LEFT JOIN mirror_entries m ON m.project_id = c.project_id AND m.source_type = 'chapter_markdown' AND m.source_id = c.id
      WHERE c.project_id = ? AND c.status <> 'archived'
      UNION ALL
      SELECT 'outline', n.id, n.current_version_id, v.content_hash, m.relative_path, m.observed_hash
      FROM outline_nodes n JOIN outline_versions v ON v.id = n.current_version_id AND v.outline_node_id = n.id
      LEFT JOIN mirror_entries m ON m.project_id = n.project_id AND m.source_type = 'outline_markdown' AND m.source_id = n.id
      WHERE n.project_id = ? AND n.status <> 'archived'
      ORDER BY kind, document_id`).all(projectId, projectId)) {
      if (typeof row.relative_path !== 'string' || !objects.has(String(row.content_hash))) throw integrity('当前稿件的文件或历史引用不完整。')
      let observedHash: string | null = null
      try { observedHash = (await store.read(row.relative_path)).hash }
      catch (error) { if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error }
      const hash = String(row.content_hash)
      current.push({ kind: row.kind as 'body' | 'outline', documentId: String(row.document_id), versionId: String(row.version_id),
        relativePath: row.relative_path, hash, observedHash,
        state: observedHash === null ? 'missing' : observedHash === hash ? 'matching'
          : observedHash === row.observed_hash ? 'stale-mirror' : 'external-conflict' })
    }
    // A join must not hide a missing head. Counts alone are not the export proof,
    // but they do detect silently dropped current identities before hash checks.
    const active = Number(database.prepare("SELECT count(*) AS n FROM chapters WHERE status <> 'archived'").get()?.n)
      + Number(database.prepare("SELECT count(*) AS n FROM outline_nodes WHERE status <> 'archived'").get()?.n)
    if (active !== current.length || new Set(current.map(item => item.relativePath.toLocaleLowerCase('en-US'))).size !== current.length) {
      throw integrity('当前稿件身份缺失或文件位置冲突，未继续迁移。')
    }
    const fingerprint = textHash(JSON.stringify({ source: snapshot.sourceFingerprint, references, current }))
    const preview: LegacyTextMigrationPreview = { version: 1, projectId, schemaVersion, sourceFingerprint: snapshot.sourceFingerprint,
      fingerprint, counts, uniqueTexts: objects.size, uniqueBytes: [...objects.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0), references, current }
    return await operation(preview, objects, snapshot.path)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('DATABASE_INTEGRITY_FAILED', '正文迁移预检或导出未完成；原作品没有被修改。', { recoverable: true, cause: error })
  } finally { try { database?.close() } finally { snapshot.dispose() } }
}

function hashBytes(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
function missing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
function integrity(message: string): AppError { return new AppError('DATABASE_INTEGRITY_FAILED', message, { recoverable: true }) }
