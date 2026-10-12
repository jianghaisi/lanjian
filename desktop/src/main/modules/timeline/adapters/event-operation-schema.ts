import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'

// V44 was briefly prepared with an equivalent outer migration statement before
// the final SQL formatting was frozen. The protected table and trigger
// definitions are still verified byte-for-byte by assertEventOperationSchema.
export const intermediateEventOperationSchema44Checksum = '7f6904247842b3f8ffe9e823d8f5701272056ef45fb58ab90a945beb8505f340'

const table = `CREATE TABLE event_operation_receipts (
  operation_id TEXT NOT NULL PRIMARY KEY CHECK(length(operation_id) BETWEEN 1 AND 200 AND instr(operation_id,char(0))=0),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('create','edit','adopt','archive','restore','reorder')),
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=16777216),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  event_id TEXT NULL REFERENCES canonical_events(id) ON DELETE RESTRICT,
  version_id TEXT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  lifecycle_id TEXT NULL REFERENCES event_lifecycle_versions(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES event_display_order_versions(id) ON DELETE RESTRICT,
  no_op INTEGER NOT NULL CHECK(no_op IN (0,1)),
  committed_at TEXT NOT NULL CHECK(length(committed_at)>0),
  CHECK((kind='reorder' AND event_id IS NULL AND version_id IS NULL AND lifecycle_id IS NULL)
    OR (kind<>'reorder' AND event_id IS NOT NULL AND version_id IS NOT NULL AND lifecycle_id IS NOT NULL))
) STRICT;`
const insert = `CREATE TRIGGER event_operation_receipts_insert_guard BEFORE INSERT ON event_operation_receipts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_operation_receipts WHERE operation_id=NEW.operation_id)
    THEN RAISE(ABORT,'event operation already recorded') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_module_transitions t JOIN projects p ON p.id=t.project_id
    WHERE t.project_id=NEW.project_id AND p.storage_mode='sqlite')
    THEN RAISE(ABORT,'event operation requires transitioned book') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_display_order_versions WHERE id=NEW.order_id AND project_id=NEW.project_id)
    THEN RAISE(ABORT,'invalid operation order') END;
  SELECT CASE WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM canonical_events e
    JOIN canonical_event_versions v ON v.event_id=e.id AND v.project_id=e.project_id
    JOIN canonical_event_version_seals s ON s.version_id=v.id
    JOIN event_lifecycle_versions l ON l.event_id=e.id AND l.project_id=e.project_id
    WHERE e.id=NEW.event_id AND e.project_id=NEW.project_id AND v.id=NEW.version_id AND l.id=NEW.lifecycle_id)
    THEN RAISE(ABORT,'invalid operation event result') END;
END;`
const immutable = ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER event_operation_receipts_no_${action.toLowerCase()}
BEFORE ${action} ON event_operation_receipts BEGIN SELECT RAISE(ABORT,'event operation receipts are immutable'); END;`)
const definitions = [table, insert, ...immutable]
export const eventOperationMigrationSql = `DROP TRIGGER projects_schema_version_v43_after_insert;
${definitions.join('\n')}
CREATE TRIGGER projects_schema_version_v44_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 44 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version=44;`

export function assertEventOperationSchema(database: DatabaseSync, providedDefinitions?: ReadonlyMap<string, string | null>): void {
  const lookup = providedDefinitions ? undefined : database.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?')
  const compact = (sql: string) => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ')
  for (const expected of definitions) {
    const [, type, name] = /^CREATE (TABLE|TRIGGER) (\w+)/.exec(expected)!
    const actual = providedDefinitions ? providedDefinitions.get(`${type!.toLowerCase()}:${name}`) : lookup!.get(type!.toLowerCase(), name!)?.sql
    if (typeof actual !== 'string' || compact(actual) !== compact(expected)) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '事件操作回执结构不完整，已停止打开且未改动作品。', { recoverable: false })
    }
  }
}
