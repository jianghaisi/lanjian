import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import { previewLegacyTextMigration, exportLegacyTextMigration, type LegacyTextMigrationPreview } from '../adapters/manuscript-text-export'
import { ManuscriptFileStore, textHash } from '../adapters/manuscript-file-store'
import { ManuscriptTextObjects } from '../adapters/manuscript-text-objects'
import { installMigratedTextReferences } from '../adapters/manuscript-text-migration'
import { manuscriptMigrationMarker } from '../adapters/manuscript-migration-lock'
import { stableEventReadSnapshot } from '../../timeline/adapters/event-read-snapshot'
import { ManuscriptCommitJournal } from '../adapters/manuscript-commit-journal'
import { WorkspaceBackupService } from '../../library/application/workspace-backup-service'

type Receipt = { version: 1; operationId: string; projectId: string; sourceRootHash: string; exportFingerprint: string;
  legacyStateHash: string; backupFolder: string; phase: 'prepared' | 'publishing' | 'verified'; vacuumed: boolean }
export type TextMigrationResult = { projectId: string; authority: 'files-v1'; backupPath: string; currentFiles: number; references: number; vacuumed: boolean }

/** Private/offline migration entry, not a renderer arbitrary-path API.
 * The host must close author windows or hold the shared write lane. A durable
 * marker blocks normal writes across restart until this exact receipt completes. */
export class ManuscriptTextMigrationService {
  constructor(private readonly databases: WorkspaceDatabaseFactory,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator(),
    private readonly fault?: (phase: 'prepared' | 'published' | 'committed') => Promise<void>) {}

  async prepare(rootValue: string, bundleValue: string, expectedFingerprint: string): Promise<void> {
    const root = await canonicalDirectory(rootValue), bundle = await canonicalDirectory(bundleValue)
    separate(root, bundle)
    return this.writes.run(root, async () => {
      if ((await readdir(bundle)).length) throw conflict('迁移目录必须为空，未覆盖已有备份。')
      const preview = await previewLegacyTextMigration(root)
      if (preview.fingerprint !== expectedFingerprint || preview.current.some(head => head.state === 'external-conflict')) {
        throw conflict('迁移预览已变化或存在外部改稿，请先核对两份内容；原稿未改动。')
      }
      // Keep exact old DB/WAL before any schema upgrade, then retain a verified
      // full book (including all original files) before publishing current text.
      await exportLegacyTextMigration(root, bundle, preview.fingerprint)
      const backupParent = join(bundle, 'backup')
      await mkdir(backupParent)
      const backup = await this.backups(root).create(backupParent)
      const latest = await previewLegacyTextMigration(root)
      if (JSON.stringify(latest.references) !== JSON.stringify(preview.references)
        || JSON.stringify(latest.current) !== JSON.stringify(preview.current)) throw conflict('准备备份期间稿件发生变化，未开始切换。')
      const receipt: Receipt = { version: 1, operationId: randomUUID(), projectId: preview.projectId,
        sourceRootHash: textHash(root), exportFingerprint: preview.fingerprint,
        legacyStateHash: await currentLegacyStateHash(root, await projectExistingPath(bundle, join(bundle, 'source-database/workspace.sqlite'))),
        backupFolder: relative(bundle, backup.backupPath).split(sep).join('/'), phase: 'prepared', vacuumed: false }
      await this.receipt(bundle, receipt)
      await this.fault?.('prepared')
    })
  }

  async resume(rootValue: string, bundleValue: string): Promise<TextMigrationResult> {
    const root = await canonicalDirectory(rootValue), bundle = await canonicalDirectory(bundleValue)
    separate(root, bundle)
    return this.writes.run(root, async () => {
      const receipt = await this.loadReceipt(bundle)
      const preview = await this.loadExport(bundle)
      if (receipt.sourceRootHash !== textHash(root) || receipt.projectId !== preview.projectId || receipt.exportFingerprint !== preview.fingerprint) {
        throw conflict('迁移记录不属于当前作品或导出批次。')
      }
      const backupPath = await projectExistingPath(bundle, join(bundle, receipt.backupFolder))
      const backupCheck = await this.backups(root).previewRestore(backupPath)
      if (!backupCheck.canRestore) throw conflict('迁移前备份校验失败，未继续切换。')
      const marker = await projectTargetPath(root, join(root, manuscriptMigrationMarker))
      const markerText = JSON.stringify({ version: 1, operationId: receipt.operationId, projectId: receipt.projectId, exportFingerprint: receipt.exportFingerprint })
      const existingMarker = await optionalText(root, marker)
      if (existingMarker !== null && existingMarker !== markerText) throw conflict('作品已有另一份待完成迁移，请保留并核对原记录。')
      if (receipt.phase !== 'verified') {
        if (receipt.phase === 'prepared') {
          const latest = await previewLegacyTextMigration(root)
          if (JSON.stringify(latest.references) !== JSON.stringify(preview.references)
            || JSON.stringify(latest.current) !== JSON.stringify(preview.current)) throw conflict('迁移准备后原稿发生变化，未发布过期内容。')
          if (await currentLegacyStateHash(root, await projectExistingPath(bundle, join(bundle, 'source-database/workspace.sqlite'))) !== receipt.legacyStateHash) {
            throw conflict('迁移准备后作品元数据发生变化，未建立写入锁或发布稿件。')
          }
          await mkdir(join(root, '.webnovel/recovery'), { recursive: true })
          if (existingMarker === null) await atomicWriteText(marker, markerText)
          receipt.phase = 'publishing'
          await this.receipt(bundle, receipt)
        } else if (existingMarker === null) throw conflict('未完成迁移缺少作品侧恢复标记，未猜测继续。')
        const source = await ManuscriptFileStore.open(bundle), current = await ManuscriptFileStore.open(root)
        const checkMarker = async () => { if (await optionalText(root, marker) !== markerText) throw conflict('迁移作用域已变化，已停止写入。') }
        const raw = new DatabaseSync(await projectExistingPath(root, join(root, '.webnovel/workspace.sqlite')))
        try {
          raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
          const project = raw.prepare('SELECT id, text_authority FROM projects LIMIT 2').all()
          if (project.length !== 1 || project[0].id !== preview.projectId) throw conflict('迁移作品身份已变化。')
          if (project[0].text_authority === 'legacy-sqlite') {
            if (legacyStateHash(raw) !== receipt.legacyStateHash) throw conflict('迁移期间数据库或身份关系发生变化，未发布过期稿件。')
            // Resume only receipts issued for this migration's exact heads.
            for (const pending of await current.pending()) {
              const head = preview.current.find(head => head.documentId === pending.documentId && head.relativePath === pending.relativePath)
              if (!head || pending.contentHash !== head.hash || pending.previousHash !== head.observedHash) throw conflict('作品另有待恢复稿件，未混用迁移凭据。')
            }
            await current.recover(async () => {}, checkMarker)
            for (const head of preview.current) {
              let observed: string | null = null
              try { observed = (await current.read(head.relativePath)).hash }
              catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error }
              if (observed !== head.observedHash && observed !== head.hash) throw conflict('迁移期间出现外部改稿，文件和导出历史均已保留。')
              const result = await current.save({ operationId: randomUUID(), documentId: head.documentId, kind: head.kind,
                relativePath: head.relativePath, title: '迁移稿件', expectedHash: observed, content: (await source.readSnapshot(head.hash)).content }, async () => {}, checkMarker)
              if (!result.metadataSaved) throw conflict('稿件发布尚未完成，请继续当前迁移。')
            }
            await this.fault?.('published')
            await checkMarker()
            await installMigratedTextReferences(raw, root, bundle, preview)
            await this.fault?.('committed')
          } else if (project[0].text_authority !== 'files-v1') throw conflict('未知稿件权威状态，未继续迁移。')
          verifyMigratedReferences(raw, root, preview)
          raw.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
          receipt.vacuumed = true
        } finally { raw.close() }
        // Verify from a fresh read-only connection, not the transaction's cache.
        const verify = new DatabaseSync(join(root, '.webnovel/workspace.sqlite'), { readOnly: true })
        try { verifyMigratedReferences(verify, root, preview) } finally { verify.close() }
        receipt.phase = 'verified'
        await this.receipt(bundle, receipt)
      } else {
        // A completed receipt permits retry after later legitimate edits, but
        // never reports success against an old DB restored into the same path.
        const snapshot = await stableEventReadSnapshot(root)
        if (!snapshot) throw conflict('迁移记录对应的作品数据库已移除。')
        let verified: DatabaseSync | undefined
        try {
          verified = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
          const rows = verified.prepare('SELECT * FROM projects LIMIT 2').all()
          if (rows.length !== 1 || rows[0].id !== receipt.projectId || rows[0].text_authority !== 'files-v1') {
            throw conflict('作品身份或正文存储模式已变化，旧迁移记录不能代表当前作品。')
          }
        } finally { try { verified?.close() } finally { snapshot.dispose() } }
      }
      if (await optionalText(root, marker) !== null) {
        if (await optionalText(root, marker) !== markerText) throw conflict('迁移标记已变化，未清除它。')
        await unlink(await projectExistingPath(root, marker))
      }
      return { projectId: receipt.projectId, authority: 'files-v1', backupPath, currentFiles: preview.current.length,
        references: preview.references.length, vacuumed: receipt.vacuumed }
    })
  }

  private backups(root: string): WorkspaceBackupService {
    // Outer lane already owns the work; the nested backup instance has no other callers.
    return new WorkspaceBackupService(this.databases, async () => root, async () => '正文迁移前完整作品', () => 'file-first-migration-v1')
  }
  private async receipt(bundle: string, receipt: Receipt): Promise<void> {
    await atomicWriteText(await projectTargetPath(bundle, join(bundle, 'migration-receipt.json')), JSON.stringify(receipt))
  }
  private async loadReceipt(bundle: string): Promise<Receipt> {
    const value = JSON.parse(await boundedText(bundle, 'migration-receipt.json', 4096)) as Receipt
    if (!value || value.version !== 1 || !/^[a-f0-9-]{36}$/i.test(value.operationId)
      || typeof value.projectId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceRootHash)
      || !/^[a-f0-9]{64}$/.test(value.exportFingerprint) || !['prepared', 'publishing', 'verified'].includes(value.phase)
      || !/^[a-f0-9]{64}$/.test(value.legacyStateHash)
      || typeof value.vacuumed !== 'boolean' || typeof value.backupFolder !== 'string'
      || !/^backup\/[^/\\]+$/.test(value.backupFolder)) throw conflict('迁移恢复记录无效，未猜测恢复。')
    return value
  }
  private async loadExport(bundle: string): Promise<LegacyTextMigrationPreview> {
    const value = JSON.parse(await boundedText(bundle, 'text-export.json', 64 * 1024 * 1024)) as LegacyTextMigrationPreview
    if (!value || value.version !== 1 || !Array.isArray(value.references) || value.references.length > 100_000
      || !Array.isArray(value.current) || value.current.length > 100_000
      || value.fingerprint !== textHash(JSON.stringify({ source: value.sourceFingerprint, references: value.references, current: value.current }))) {
      throw conflict('导出清单校验失败，未继续迁移。')
    }
    return value
  }
}

function verifyMigratedReferences(db: DatabaseSync, root: string, preview: LegacyTextMigrationPreview): void {
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length
    || db.prepare('SELECT text_authority FROM projects WHERE id = ?').get(preview.projectId)?.text_authority !== 'files-v1') throw conflict('切换后的数据库校验失败，备份和恢复标记已保留。')
  const objects = new ManuscriptTextObjects(root)
  const current = new ManuscriptCommitJournal(root)
  for (const head of preview.current) {
    const stored = db.prepare('SELECT * FROM manuscript_file_heads WHERE document_id = ?').get(head.documentId)
    if (!stored || stored.relative_path !== head.relativePath || stored.kind !== head.kind || stored.content_hash !== head.hash
      || current.readCurrent(head.relativePath)?.hash !== head.hash) throw conflict('迁移后的当前文件校验失败。')
  }
  for (const table of ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks'] as const) {
    const expected = preview.references.filter(item => item.table === table)
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    if (rows.length !== expected.length) throw conflict('迁移后的历史条数不一致。')
    for (let i = 0; i < rows.length; i++) {
      const { content, content_hash, ...metadata } = rows[i]
      if (content !== '' || content_hash !== expected[i].hash || JSON.stringify(metadata) !== JSON.stringify(expected[i].metadata)) throw conflict('迁移后的版本身份或内容指纹不一致。')
      const reference = db.prepare('SELECT * FROM manuscript_text_objects WHERE content_hash = ?').get(String(content_hash))
      if (!reference) throw conflict('迁移后的历史文件引用缺失。')
      objects.read({ hash: String(content_hash), relativePath: String(reference.relative_path),
        rangeStart: reference.range_start === null ? null : Number(reference.range_start), rangeEnd: reference.range_end === null ? null : Number(reference.range_end) })
    }
  }
}
async function boundedText(root: string, name: string, max: number): Promise<string> {
  const path = await projectExistingPath(root, join(root, name))
  if ((await stat(path)).size > max) throw conflict('迁移记录超过安全上限。')
  return readFile(path, 'utf8')
}
async function optionalText(root: string, path: string): Promise<string | null> {
  try {
    const target = await projectExistingPath(root, path)
    if ((await stat(target)).size > 4096) throw conflict('迁移标记异常，未继续。')
    return await readFile(target, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; throw error }
}
async function currentLegacyStateHash(root: string, originalPath: string): Promise<string> {
  const snapshot = await stableEventReadSnapshot(root)
  if (!snapshot) throw conflict('迁移数据库已移除。')
  const db = new DatabaseSync(snapshot.path, { readOnly: true })
  const original = new DatabaseSync(originalPath, { readOnly: true })
  try {
    const oldTables = original.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    for (const { name } of oldTables) {
      const query = `SELECT * FROM "${String(name).replaceAll('"', '""')}"`
      const normalize = (row: Record<string, unknown>) => {
        if (name !== 'projects') return JSON.stringify(row)
        const { current_schema_version, text_authority, ...rest } = row
        return JSON.stringify(rest)
      }
      const before = original.prepare(query).all()
      const after = db.prepare(query).all().filter(row => name !== 'schema_migrations' || Number(row.version) <= Number(original.prepare('PRAGMA user_version').get()!.user_version))
      if (JSON.stringify(before.map(normalize).sort()) !== JSON.stringify(after.map(normalize).sort())) throw conflict('备份准备期间作品关系或元数据发生变化，未开始迁移。')
    }
    return legacyStateHash(db)
  } finally { try { original.close(); db.close() } finally { snapshot.dispose() } }
}
function legacyStateHash(db: DatabaseSync): string {
  // Metadata as well as text participates. A changed title, order, confirmation,
  // custom table or relationship must not slip through a content-only preview.
  const hash = createHash('sha256')
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
  hash.update(JSON.stringify(schema))
  for (const table of schema.filter(row => row.type === 'table')) {
    hash.update(String(table.name))
    const rows = db.prepare(`SELECT * FROM "${String(table.name).replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()
    for (const row of rows) hash.update(row + '\n')
  }
  return hash.digest('hex')
}
function separate(root: string, bundle: string): void {
  for (const [parent, child] of [[root, bundle], [bundle, root]]) {
    const path = relative(parent, child)
    if (!path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) throw new AppError('PATH_ESCAPE', '迁移备份与作品目录不能互相包含。', { recoverable: true })
  }
}
function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
