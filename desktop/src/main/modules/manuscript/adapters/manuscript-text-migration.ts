import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../core/ports/workspace-database'
import type { LegacyTextMigrationPreview } from './manuscript-text-export'
import { ManuscriptTextObjects, type TextObjectReference } from './manuscript-text-objects'
import { ManuscriptFileStore, textHash } from './manuscript-file-store'
import { ManuscriptCommitJournal } from './manuscript-commit-journal'

const tables = ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks'] as const
const guards = ['body_versions_no_update', 'outline_versions_no_update', 'autosave_checkpoints_terminal_content_guard'] as const

/** Commit phase only. The migration orchestrator must hold the book write lease,
 * retain a verified whole-book backup, and publish verified current files first.
 * This is not an automatic schema upgrade or a renderer-facing operation. */
export async function installMigratedTextReferences(database: DatabaseSync, root: string, bundleRoot: string,
  preview: LegacyTextMigrationPreview): Promise<void> {
  if (Number(database.prepare('PRAGMA user_version').get()?.user_version) !== WORKSPACE_DATABASE_SCHEMA_VERSION) {
    throw integrity('请先核对迁移数据库结构版本。')
  }
  const project = database.prepare('SELECT * FROM projects LIMIT 2').all()
  if (project.length !== 1 || project[0].id !== preview.projectId || project[0].storage_mode !== 'sqlite'
    || project[0].text_authority !== 'legacy-sqlite') throw integrity('作品文本迁移身份或状态不一致。')
  const source = await ManuscriptFileStore.open(bundleRoot)
  const current = await ManuscriptFileStore.open(root)
  const objects = new ManuscriptTextObjects(root)
  const references = new Map<string, TextObjectReference>()
  for (const item of preview.references.filter(item => item.table !== 'document_chunks')) {
    const text = await source.readSnapshot(item.hash)
    references.set(item.hash, objects.write(text.content))
  }
  // Chunks point into their immutable version, never to a second full-text table
  // or a new per-chunk copy. Exact legacy chunk bytes/IDs remain unchanged.
  const bodies = new Map(preview.references.filter(item => item.table === 'body_versions').map(item => [item.id, item]))
  for (const item of preview.references.filter(item => item.table === 'document_chunks')) {
    const parent = bodies.get(String(item.metadata.body_version_id))
    if (!parent) throw integrity('检索分块的原正文版本不存在。')
    const body = (await source.readSnapshot(parent.hash)).content
    const chunk = (await source.readSnapshot(item.hash)).content
    const start = body.indexOf(chunk)
    if (start < 0) throw integrity('检索分块与原正文不一致，未丢弃历史分块。')
    if (!references.has(item.hash)) references.set(item.hash, { hash: item.hash,
      relativePath: `.webnovel/history/text/${parent.hash}.md`, rangeStart: start, rangeEnd: start + chunk.length })
  }
  for (const reference of references.values()) objects.read(reference)
  for (const head of preview.current) {
    if ((await current.read(head.relativePath)).hash !== head.hash) throw conflict('当前稿件尚未完成逐项校验，未切换数据库引用。')
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const table of tables) {
      const expected = preview.references.filter(item => item.table === table)
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      if (rows.length !== expected.length) throw conflict('导出后稿件记录数量发生变化，未切换文本模式。')
      for (let index = 0; index < rows.length; index++) {
        const { content, content_hash: hash, ...metadata } = rows[index]
        const item = expected[index]
        if (item.id !== rows[index].id || item.hash !== hash || typeof content !== 'string'
          || textHash(content) !== hash || JSON.stringify(metadata) !== JSON.stringify(item.metadata)) {
          throw conflict('导出后稿件内容或版本关系发生变化，未切换文本模式。')
        }
      }
    }
    const incoherentOutlines = database.prepare(`SELECT 1 FROM outline_nodes n LEFT JOIN outline_versions v
      ON v.id = n.current_version_id AND v.outline_node_id = n.id
      WHERE n.current_version_id IS NOT NULL AND (v.id IS NULL OR n.content_hash <> v.content_hash) LIMIT 1`).get()
    if (incoherentOutlines) throw integrity('大纲当前稿与版本引用不一致，原数据库已保留。')
    const definitions = guards.map(name => {
      const sql = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?").get(name)?.sql
      if (typeof sql !== 'string' || !sql.startsWith(`CREATE TRIGGER ${name}`)) throw integrity('历史保护约束缺失，未清除数据库正文。')
      return sql
    })
    const insert = database.prepare(`INSERT INTO manuscript_text_objects (content_hash, relative_path, range_start, range_end) VALUES (?, ?, ?, ?)`)
    if (database.prepare('SELECT 1 FROM manuscript_text_objects LIMIT 1').get()) throw conflict('文本引用表不是空白迁移状态。')
    for (const reference of references.values()) insert.run(reference.hash, reference.relativePath, reference.rangeStart, reference.rangeEnd)
    // Only this explicit migration transaction temporarily lifts text immutability;
    // every ID/provenance field is compared above and all guards return before COMMIT.
    for (const name of guards) database.exec(`DROP TRIGGER ${name}`)
    for (const table of tables) database.exec(`UPDATE ${table} SET content = ''`)
    for (const sql of definitions) database.exec(sql)
    for (const table of tables) {
      if (database.prepare(`SELECT 1 FROM ${table} t LEFT JOIN manuscript_text_objects o ON o.content_hash = t.content_hash
        WHERE t.content <> '' OR o.content_hash IS NULL LIMIT 1`).get()) throw integrity('正文文件引用校验未通过。')
    }
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw integrity('稿件元数据关系校验未通过。')
    for (const head of preview.current) {
      const identity = head.kind === 'body'
        ? database.prepare('SELECT title FROM chapters WHERE id = ?').get(head.documentId)
        : database.prepare('SELECT title FROM outline_nodes WHERE id = ?').get(head.documentId)
      if (typeof identity?.title !== 'string') throw integrity('迁移稿件缺少标题身份。')
      database.prepare(`INSERT INTO manuscript_file_heads (document_id, kind, relative_path, title, content_hash) VALUES (?, ?, ?, ?, ?)`)
        .run(head.documentId, head.kind, head.relativePath, identity.title, head.hash)
      database.prepare(`UPDATE mirror_entries SET observed_hash = ?, content_hash = ?, status = 'synced',
        last_error_code = NULL, previous_relative_path = NULL, previous_observed_hash = NULL
        WHERE project_id = ? AND source_id = ? AND source_type = ? AND relative_path = ?`)
        .run(head.hash, head.hash, preview.projectId, head.documentId, head.kind === 'body' ? 'chapter_markdown' : 'outline_markdown', head.relativePath)
    }
    // Recheck synchronously immediately before switching; the asynchronous export
    // verification above is not a grant to overwrite a concurrent author edit.
    const files = new ManuscriptCommitJournal(root)
    for (const head of preview.current) if (files.readCurrent(head.relativePath)?.hash !== head.hash) throw conflict('切换前稿件发生变化，原数据库模式已保留。')
    database.prepare("UPDATE projects SET text_authority = 'files-v1' WHERE id = ? AND text_authority = 'legacy-sqlite'").run(preview.projectId)
    database.exec('COMMIT')
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* retain original failure */ }
    throw error
  }
}

function integrity(message: string): AppError { return new AppError('DATABASE_INTEGRITY_FAILED', message, { recoverable: true }) }
function conflict(message: string): AppError { return new AppError('CONFLICT', message, { recoverable: true }) }
