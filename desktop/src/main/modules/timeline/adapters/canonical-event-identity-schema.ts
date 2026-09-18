import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'

/** Version 39 changes identity storage only. No event/history/receipt is created. */
export const canonicalEventIdentityCopySql = `
CREATE TABLE canonical_events_v39 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  time_ref TEXT NOT NULL,
  location_text TEXT NOT NULL,
  event_text TEXT NOT NULL,
  result_text TEXT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK(status IN ('candidate', 'approved')),
  conflict_group_id TEXT NULL,
  event_signature TEXT NOT NULL,
  slot_signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT NULL
);
INSERT INTO canonical_events_v39 (rowid, id, project_id, time_ref, location_text, event_text, result_text,
  confidence, status, conflict_group_id, event_signature, slot_signature, created_at, approved_at)
SELECT rowid, id, project_id, time_ref, location_text, event_text, result_text,
  confidence, status, conflict_group_id, event_signature, slot_signature, created_at, approved_at FROM canonical_events;
DROP TABLE canonical_events;
ALTER TABLE canonical_events_v39 RENAME TO canonical_events;
`

export const canonicalEventIdentityGuardsSql = `
CREATE INDEX idx_canonical_events_project_signature ON canonical_events(project_id, event_signature);
DROP TRIGGER projects_schema_version_v38_after_insert;
CREATE TRIGGER projects_schema_version_v39_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 39 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 39;
`

// Unknown table extensions must not be silently dropped by an explicit column copy.
export function assertCanonicalEventIdentityUpgradeSource(database: DatabaseSync, expectedSql: string): void {
  const actual = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'canonical_events'").get()?.sql
  if (typeof actual !== 'string' || compact(actual) !== compact(expectedSql)) invalid()
}

export function assertCanonicalEventIdentitySchema(database: DatabaseSync): void {
  const expectedTable = canonicalEventIdentityCopySql.slice(0, canonicalEventIdentityCopySql.indexOf('\nINSERT INTO'))
    .replace('canonical_events_v39', '"canonical_events"')
  assertCanonicalEventIdentityUpgradeSource(database, expectedTable)
  const indexes = database.prepare("PRAGMA index_list('canonical_events')").all()
  const signature = indexes.find(index => index.name === 'idx_canonical_events_project_signature')
  if (!signature || signature.unique !== 0 || signature.partial !== 0) invalid()
  const columns = (name: string) => database.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(name).map(column => column.name)
  if (JSON.stringify(columns(String(signature.name))) !== JSON.stringify(['project_id', 'event_signature'])) invalid()
  for (const index of indexes) {
    if (index.unique !== 1) continue
    const names = columns(String(index.name))
    if (names.length === 2 && names.includes('project_id') && names.includes('event_signature')) invalid()
  }
}

function compact(sql: string): string { return sql.trim().replace(/;$/, '').replace(/\s+/g, ' ') }
function invalid(): never {
  throw new AppError('DATABASE_INTEGRITY_FAILED', '事件身份表结构与版本约定不一致，未尝试修复或删除未知结构。', {
    recoverable: false, details: { area: 'workspaceDatabase' }
  })
}
