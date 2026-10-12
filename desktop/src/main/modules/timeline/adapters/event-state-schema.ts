import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'

/** Schema 43 prepares empty history. Author-reviewed operations own initialization. */
export const eventStateTables = ['event_lifecycle_versions', 'event_display_order_versions'] as const

const identifier = "CHECK(length(id) BETWEEN 1 AND 200 AND instr(id, char(0)) = 0)"
const lifecycle = `CREATE TABLE event_lifecycle_versions (
  id TEXT NOT NULL PRIMARY KEY ${identifier},
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  previous_id TEXT NULL REFERENCES event_lifecycle_versions(id) ON DELETE RESTRICT,
  expected_event_version_id TEXT NOT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('active', 'archived')),
  created_at TEXT NOT NULL CHECK(length(created_at) > 0),
  UNIQUE(event_id, revision)
) STRICT;`

const order = `CREATE TABLE event_display_order_versions (
  id TEXT NOT NULL PRIMARY KEY ${identifier},
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  previous_id TEXT NULL REFERENCES event_display_order_versions(id) ON DELETE RESTRICT,
  event_ids_json TEXT NOT NULL CHECK(length(event_ids_json) <= 16777216 AND json_valid(event_ids_json)
    AND json_type(event_ids_json) = 'array' AND json_array_length(event_ids_json) <= 100000),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*' AND instr(content_hash, char(0)) = 0),
  created_at TEXT NOT NULL CHECK(length(created_at) > 0),
  UNIQUE(project_id, revision)
) STRICT;`

const lifecycleGuard = `CREATE TRIGGER event_lifecycle_versions_insert_guard BEFORE INSERT ON event_lifecycle_versions BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_lifecycle_versions
    WHERE id = NEW.id OR (event_id = NEW.event_id AND revision = NEW.revision))
    THEN RAISE(ABORT, 'event lifecycle revision already exists') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_event_version_heads h
    JOIN canonical_events e ON e.id = h.event_id AND e.project_id = h.project_id
    JOIN event_module_transitions t ON t.project_id = h.project_id
    JOIN projects p ON p.id = h.project_id AND p.storage_mode = 'sqlite'
    JOIN canonical_event_version_seals s ON s.version_id = h.latest_version_id
    WHERE h.event_id = NEW.event_id AND h.project_id = NEW.project_id AND h.latest_version_id = NEW.expected_event_version_id)
    THEN RAISE(ABORT, 'invalid event lifecycle scope or version') END;
  SELECT CASE WHEN NEW.revision <> COALESCE((SELECT MAX(revision) + 1 FROM event_lifecycle_versions WHERE event_id = NEW.event_id), 1)
    OR NEW.previous_id IS NOT (SELECT id FROM event_lifecycle_versions WHERE event_id = NEW.event_id ORDER BY revision DESC LIMIT 1)
    THEN RAISE(ABORT, 'stale event lifecycle revision') END;
  SELECT CASE WHEN (NEW.revision = 1 AND NEW.state <> 'active')
    OR NEW.state = (SELECT state FROM event_lifecycle_versions WHERE event_id = NEW.event_id ORDER BY revision DESC LIMIT 1)
    THEN RAISE(ABORT, 'invalid event lifecycle transition') END;
END;`

const orderGuard = `CREATE TRIGGER event_display_order_versions_insert_guard BEFORE INSERT ON event_display_order_versions BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_display_order_versions
    WHERE id = NEW.id OR (project_id = NEW.project_id AND revision = NEW.revision))
    THEN RAISE(ABORT, 'event display order revision already exists') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_module_transitions t
    JOIN projects p ON p.id = t.project_id AND p.storage_mode = 'sqlite' WHERE t.project_id = NEW.project_id)
    THEN RAISE(ABORT, 'event display order requires transitioned book') END;
  SELECT CASE WHEN NEW.revision <> COALESCE((SELECT MAX(revision) + 1 FROM event_display_order_versions WHERE project_id = NEW.project_id), 1)
    OR NEW.previous_id IS NOT (SELECT id FROM event_display_order_versions WHERE project_id = NEW.project_id ORDER BY revision DESC LIMIT 1)
    THEN RAISE(ABORT, 'stale event display order revision') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.event_ids_json) WHERE type <> 'text')
    OR EXISTS (SELECT value FROM json_each(NEW.event_ids_json) GROUP BY value HAVING COUNT(*) > 1)
    OR json_array_length(NEW.event_ids_json) <> (SELECT COUNT(*) FROM canonical_events WHERE project_id = NEW.project_id)
    OR EXISTS (SELECT 1 FROM json_each(NEW.event_ids_json) j WHERE NOT EXISTS (
      SELECT 1 FROM canonical_events e WHERE e.id = j.value AND e.project_id = NEW.project_id))
    THEN RAISE(ABORT, 'event display order must contain every same-book identity exactly once') END;
END;`

const immutable = eventStateTables.flatMap(table => [
  `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'event state history is append-only'); END;`,
  `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'event state history is append-only'); END;`
])
const definitions = [lifecycle, order, lifecycleGuard, orderGuard, ...immutable]
export const eventStateMigrationSql = `
DROP TRIGGER projects_schema_version_v42_after_insert;
${definitions.join('\n')}
CREATE TRIGGER projects_schema_version_v43_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 43 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 43;
`

export function assertEventStateSchema(database: DatabaseSync, providedDefinitions?: ReadonlyMap<string, string | null>): void {
  const lookup = providedDefinitions ? undefined : database.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?')
  for (const definition of definitions) {
    const [, kind, name] = /^CREATE (TABLE|TRIGGER) (\w+)/.exec(definition)!
    const actual = providedDefinitions ? providedDefinitions.get(`${kind!.toLowerCase()}:${name}`) : lookup!.get(kind!.toLowerCase(), name!)?.sql
    if (typeof actual !== 'string' || compact(actual) !== compact(definition)) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '事件排序或归档历史结构不完整，已停止打开且未改动作品。', { recoverable: false })
    }
  }
}

function compact(sql: string): string { return sql.trim().replace(/;$/, '').replace(/\s+/g, ' ') }
