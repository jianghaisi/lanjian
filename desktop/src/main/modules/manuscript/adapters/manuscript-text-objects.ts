import { randomUUID, createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { projectExistingPathSync, projectTargetPathSync } from '../../../platform/storage/project-path'
import type { DatabaseSync } from 'node:sqlite'

const textTables = ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks'] as const
const referencedText = textTables.map(table => `EXISTS (SELECT 1 FROM ${table} WHERE content_hash = OLD.content_hash)`).join(' OR ')
// A running development instance applied this exact intermediate schema-41
// build before 41 was frozen. Keep its original receipt; only this checksum AND
// the complete guarded schema below are accepted, never arbitrary drift.
export const intermediateManuscriptSchema41Checksum = 'a17c58d0fb72a9a59be0892572b4f2b903957f90e12e884f8aaff465317f90cd'
export function hasIntermediateManuscriptSchema41(database: DatabaseSync): boolean {
  return database.prepare('SELECT checksum FROM schema_migrations WHERE version = 41').get()?.checksum === intermediateManuscriptSchema41Checksum
}
const fileModeGuards = [
  ...textTables.flatMap(table => ['INSERT', 'UPDATE'].map(operation =>
    `CREATE TRIGGER manuscript_${table}_${operation.toLowerCase()}_guard BEFORE ${operation} ON ${table}
WHEN NEW.content <> '' AND EXISTS (SELECT 1 FROM projects WHERE text_authority = 'files-v1')
BEGIN SELECT RAISE(ABORT, 'file-authoritative text must not be stored in SQLite'); END;`)),
  `CREATE TRIGGER manuscript_text_objects_no_update BEFORE UPDATE ON manuscript_text_objects
BEGIN SELECT RAISE(ABORT, 'manuscript text references are immutable'); END;`,
  `CREATE TRIGGER manuscript_text_objects_no_delete BEFORE DELETE ON manuscript_text_objects
WHEN OLD.autosave_temporary = 0 OR ${referencedText}
  OR EXISTS (SELECT 1 FROM manuscript_file_heads WHERE content_hash = OLD.content_hash)
  OR EXISTS (SELECT 1 FROM manuscript_text_objects WHERE relative_path = OLD.relative_path AND content_hash <> OLD.content_hash)
BEGIN SELECT RAISE(ABORT, 'manuscript text references are immutable'); END;`,
  `CREATE TRIGGER manuscript_authority_no_downgrade BEFORE UPDATE OF text_authority, storage_mode ON projects
WHEN OLD.text_authority = 'files-v1' AND (NEW.text_authority <> 'files-v1' OR NEW.storage_mode <> 'sqlite')
BEGIN SELECT RAISE(ABORT, 'file authority cannot be downgraded in place'); END;`
]

export const manuscriptTextObjectsMigrationSql = `
DROP TRIGGER projects_schema_version_v40_after_insert;
CREATE TRIGGER projects_schema_version_v41_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 41 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 41;
ALTER TABLE projects ADD COLUMN text_authority TEXT NOT NULL DEFAULT 'legacy-sqlite'
  CHECK(text_authority IN ('legacy-sqlite', 'files-v1'));
CREATE TABLE manuscript_text_objects (
  content_hash TEXT PRIMARY KEY CHECK(length(content_hash) = 64),
  relative_path TEXT NOT NULL,
  range_start INTEGER NULL,
  range_end INTEGER NULL,
  CHECK((range_start IS NULL AND range_end IS NULL) OR
    (range_start IS NOT NULL AND range_end IS NOT NULL AND range_start >= 0 AND range_end >= range_start))
);
CREATE TABLE manuscript_file_commits (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL
);
CREATE TABLE manuscript_file_heads (
  document_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('body', 'outline')),
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64)
);
`

// Schema 41 has already been opened by a development instance on an author
// book. Its exact bytes/checksum above are frozen; hardening is additive only.
export const manuscriptTextGuardsMigrationSql = `
DROP TRIGGER projects_schema_version_v41_after_insert;
CREATE TRIGGER projects_schema_version_v42_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 42 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 42;
ALTER TABLE manuscript_text_objects ADD COLUMN autosave_temporary INTEGER NOT NULL DEFAULT 0 CHECK(autosave_temporary IN (0, 1));
` + fileModeGuards.join('\n') + '\n' + textTables.map(table => `CREATE INDEX manuscript_${table}_hash ON ${table}(content_hash);`).join('\n')

export function assertManuscriptTextSchema(database: DatabaseSync, version: number): void {
  const guarded = version >= 42 || hasIntermediateManuscriptSchema41(database)
  const definitions = [...manuscriptTextObjectsMigrationSql.matchAll(/CREATE TABLE manuscript_[\s\S]*?\n\);/g)].map(match =>
    guarded && match[0].startsWith('CREATE TABLE manuscript_text_objects ')
      ? match[0].replace('range_end INTEGER NULL,', 'range_end INTEGER NULL, autosave_temporary INTEGER NOT NULL DEFAULT 0 CHECK(autosave_temporary IN (0, 1)),') : match[0])
  const indexes = textTables.map(table => `CREATE INDEX manuscript_${table}_hash ON ${table}(content_hash);`)
  for (const definition of [...definitions, ...(guarded ? [...fileModeGuards, ...indexes] : [])]) {
    const [, type, name] = /^CREATE (TABLE|TRIGGER|INDEX) (\w+)/.exec(definition)!
    const actual = database.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?').get(type.toLowerCase(), name)?.sql
    const compact = (sql: string) => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ')
    if (typeof actual !== 'string' || compact(actual) !== compact(definition)) throw integrity('稿件引用结构或保护约束不完整，未尝试自动修复。')
  }
  const column = database.prepare('PRAGMA table_info(projects)').all().find(row => row.name === 'text_authority')
  if (!column || column.type !== 'TEXT' || column.notnull !== 1 || column.dflt_value !== "'legacy-sqlite'") throw integrity('稿件权威字段无效。')
}

export type TextObjectReference = { hash: string; relativePath: string; rangeStart: number | null; rangeEnd: number | null }

/** Immutable text objects for synchronous SQLite consumers. Current editable
 * manuscripts are owned by ManuscriptFileStore, never by this snapshot reader. */
export class ManuscriptTextObjects {
  constructor(private readonly root: string) {}

  write(content: string): TextObjectReference {
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 16 * 1024 * 1024
      || Buffer.from(content).toString('utf8') !== content) throw integrity('历史稿件内容无效。')
    const hash = createHash('sha256').update(content).digest('hex')
    const reference: TextObjectReference = { hash, relativePath: `.webnovel/history/text/${hash}.md`, rangeStart: null, rangeEnd: null }
    const target = projectTargetPathSync(this.root, join(this.root, reference.relativePath))
    if (existsSync(target)) { this.read(reference); return reference }
    mkdirSync(dirname(target), { recursive: true })
    projectTargetPathSync(this.root, target)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      const descriptor = openSync(temporary, 'wx')
      try { writeFileSync(descriptor, content, 'utf8'); fsyncSync(descriptor) } finally { closeSync(descriptor) }
      projectTargetPathSync(this.root, target)
      // Publish complete bytes without ever replacing an existing immutable object.
      try { linkSync(temporary, target) }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error }
      this.read(reference)
      return reference
    } finally { if (existsSync(temporary)) unlinkSync(projectExistingPathSync(this.root, temporary)) }
  }

  read(reference: TextObjectReference): string {
    if (!/^[a-f0-9]{64}$/.test(reference.hash) || !/^\.webnovel\/history\/text\/[a-f0-9]{64}\.md$/.test(reference.relativePath)) {
      throw integrity('历史稿件文件引用无效。')
    }
    try {
      const path = projectExistingPathSync(this.root, join(this.root, reference.relativePath))
      if (!statSync(path).isFile() || statSync(path).size > 16 * 1024 * 1024) throw integrity('历史稿件大小无效。')
      const bytes = readFileSync(path)
      const fullText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      if (createHash('sha256').update(bytes).digest('hex') !== reference.relativePath.slice(-67, -3)) throw integrity('历史文件校验失败。')
      const { rangeStart, rangeEnd } = reference
      if ((rangeStart === null) !== (rangeEnd === null)
        || (rangeStart !== null && (!Number.isSafeInteger(rangeStart) || !Number.isSafeInteger(rangeEnd)
          || rangeStart < 0 || rangeEnd! < rangeStart || rangeEnd! > fullText.length))) throw integrity('正文分块引用范围无效。')
      const content = rangeStart === null ? fullText : fullText.slice(rangeStart, rangeEnd!)
      if (createHash('sha256').update(content).digest('hex') !== reference.hash) throw integrity('历史稿件内容校验失败。')
      return content
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('DATABASE_INTEGRITY_FAILED', '历史稿件文件缺失或无法校验；未返回空稿。', { recoverable: true, cause: error })
    }
  }
}

function integrity(message: string): AppError { return new AppError('DATABASE_INTEGRITY_FAILED', message, { recoverable: true }) }
