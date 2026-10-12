import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'

/** Frozen schema 40. Empty structures only; no reviewed migration or public writer. */
export const eventMigrationReceiptTables = [
  'event_migration_receipts', 'event_migration_source_aliases', 'event_migration_receipt_seals', 'event_module_transitions'
] as const

const receiptTable = `CREATE TABLE event_migration_receipts (
  operation_id TEXT NOT NULL PRIMARY KEY CHECK(length(operation_id) BETWEEN 1 AND 200 AND instr(operation_id, char(0)) = 0),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*' AND instr(source_fingerprint, char(0)) = 0),
  decision_fingerprint TEXT NOT NULL CHECK(length(decision_fingerprint) = 64 AND decision_fingerprint NOT GLOB '*[^0-9a-f]*' AND instr(decision_fingerprint, char(0)) = 0),
  source_snapshot_hash TEXT NOT NULL CHECK(length(source_snapshot_hash) = 64 AND source_snapshot_hash NOT GLOB '*[^0-9a-f]*' AND instr(source_snapshot_hash, char(0)) = 0),
  source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json) AND json_type(source_snapshot_json) = 'object'),
  mapping_count INTEGER NOT NULL CHECK(typeof(mapping_count) = 'integer' AND mapping_count BETWEEN 0 AND 100000),
  committed_at TEXT NOT NULL CHECK(length(committed_at) > 0)
) STRICT;`

const aliasTable = `CREATE TABLE event_migration_source_aliases (
  operation_id TEXT NOT NULL REFERENCES event_migration_receipts(operation_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal) = 'integer' AND ordinal >= 0),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('sources', 'events', 'timeline')),
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*' AND instr(source_hash, char(0)) = 0),
  source_ordinal INTEGER NOT NULL CHECK(typeof(source_ordinal) = 'integer' AND source_ordinal BETWEEN 0 AND 99999),
  original_id TEXT NOT NULL CHECK(length(original_id) BETWEEN 1 AND 200 AND instr(original_id, char(0)) = 0),
  disposition TEXT NOT NULL CHECK(disposition IN ('retain-source', 'keep-separate', 'link-existing')),
  material_source_id TEXT NULL REFERENCES material_sources(id) ON DELETE RESTRICT,
  material_content_hash TEXT NULL,
  event_id TEXT NULL REFERENCES canonical_events(id) ON DELETE RESTRICT,
  event_version_id TEXT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY(operation_id, ordinal),
  UNIQUE(project_id, source_kind, source_hash, source_ordinal),
  CHECK((source_kind = 'sources' AND disposition = 'retain-source'
      AND material_source_id IS NOT NULL AND material_content_hash IS NOT NULL AND event_id IS NULL AND event_version_id IS NULL)
    OR (source_kind IN ('events', 'timeline') AND disposition IN ('keep-separate', 'link-existing')
      AND event_id IS NOT NULL AND event_version_id IS NOT NULL AND material_source_id IS NULL AND material_content_hash IS NULL))
) STRICT;`

const sealTable = `CREATE TABLE event_migration_receipt_seals (
  operation_id TEXT NOT NULL PRIMARY KEY REFERENCES event_migration_receipts(operation_id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
) STRICT;`

const transitionTable = `CREATE TABLE event_module_transitions (
  project_id TEXT NOT NULL PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE REFERENCES event_migration_receipt_seals(operation_id) ON DELETE RESTRICT
) STRICT;`

const aliasIndex = `CREATE INDEX idx_event_migration_alias_original ON event_migration_source_aliases(project_id, source_kind, original_id);`

const insertGuards = [
  `CREATE TRIGGER event_migration_receipts_insert_guard BEFORE INSERT ON event_migration_receipts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_migration_receipts WHERE operation_id = NEW.operation_id)
    THEN RAISE(ABORT, 'event migration operation already exists') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND storage_mode = 'sqlite')
    OR EXISTS (SELECT 1 FROM event_module_transitions WHERE project_id = NEW.project_id)
    THEN RAISE(ABORT, 'invalid event migration project state') END;
END;`,
  `CREATE TRIGGER event_migration_source_aliases_insert_guard BEFORE INSERT ON event_migration_source_aliases BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_migration_source_aliases
    WHERE (operation_id = NEW.operation_id AND ordinal = NEW.ordinal)
      OR (project_id = NEW.project_id AND source_kind = NEW.source_kind AND source_hash = NEW.source_hash AND source_ordinal = NEW.source_ordinal))
    THEN RAISE(ABORT, 'event migration occurrence already mapped') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_migration_receipts
    WHERE operation_id = NEW.operation_id AND project_id = NEW.project_id AND NEW.ordinal < mapping_count)
    OR EXISTS (SELECT 1 FROM event_migration_receipt_seals WHERE operation_id = NEW.operation_id)
    THEN RAISE(ABORT, 'invalid or sealed event migration mapping') END;
  SELECT CASE WHEN NEW.source_kind = 'sources' AND NOT EXISTS (SELECT 1 FROM material_sources
    WHERE id = NEW.material_source_id AND project_id = NEW.project_id AND content_hash = NEW.material_content_hash)
    THEN RAISE(ABORT, 'invalid event migration material revision') END;
  SELECT CASE WHEN NEW.source_kind IN ('events', 'timeline') AND NOT EXISTS (
    SELECT 1 FROM canonical_event_versions v
    JOIN canonical_event_version_seals s ON s.version_id = v.id
    JOIN canonical_event_version_heads h ON h.event_id = v.event_id AND h.project_id = v.project_id
    WHERE v.id = NEW.event_version_id AND v.event_id = NEW.event_id AND v.project_id = NEW.project_id
      AND v.id = COALESCE(h.approved_version_id, h.latest_version_id))
    THEN RAISE(ABORT, 'invalid event migration selected version') END;
END;`,
  `CREATE TRIGGER event_migration_receipt_seals_insert_guard BEFORE INSERT ON event_migration_receipt_seals BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_migration_receipt_seals WHERE operation_id = NEW.operation_id)
    THEN RAISE(ABORT, 'event migration receipt already sealed') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_migration_receipts r
    WHERE r.operation_id = NEW.operation_id AND r.project_id = NEW.project_id
      AND r.mapping_count = (SELECT COUNT(*) FROM event_migration_source_aliases a WHERE a.operation_id = r.operation_id))
    THEN RAISE(ABORT, 'incomplete event migration receipt') END;
END;`,
  `CREATE TRIGGER event_module_transitions_insert_guard BEFORE INSERT ON event_module_transitions BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_module_transitions WHERE project_id = NEW.project_id OR operation_id = NEW.operation_id)
    THEN RAISE(ABORT, 'event module already transitioned') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM event_migration_receipt_seals s
    JOIN projects p ON p.id = s.project_id AND p.storage_mode = 'sqlite'
    WHERE s.operation_id = NEW.operation_id AND s.project_id = NEW.project_id)
    THEN RAISE(ABORT, 'event module requires same-project sealed receipt') END;
END;`
]

const immutableGuards = eventMigrationReceiptTables.flatMap(table => [
  `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'event migration evidence is append-only'); END;`,
  `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'event migration evidence is append-only'); END;`
])
const projectGuard = `CREATE TRIGGER projects_schema_version_v40_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 40 WHERE id = NEW.id; END;`

// Keep the exact CREATE definitions for fail-closed validation, including guard bodies.
const definitions = [receiptTable, aliasTable, sealTable, transitionTable, aliasIndex, ...insertGuards, ...immutableGuards, projectGuard]
export const eventMigrationReceiptsMigrationSql = '\nDROP TRIGGER projects_schema_version_v39_after_insert;\n'
  + definitions.join('\n') + '\nUPDATE projects SET current_schema_version = 40;\n'

export function assertEventMigrationReceiptSchema(database: DatabaseSync, projectSchemaVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version), providedDefinitions?: ReadonlyMap<string, string | null>): void {
  const lookup = providedDefinitions ? undefined : database.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?')
  for (const original of definitions) {
    // Later additive schemas own the project version stamp, not these immutable
    // event receipt definitions. Historical migration SQL/checksums stay exact.
    const definition = original === projectGuard ? projectGuard.replaceAll('40', String(projectSchemaVersion)) : original
    const [, kind, name] = /^CREATE (TABLE|INDEX|TRIGGER) (\w+)/.exec(definition)!
    const actual = providedDefinitions ? providedDefinitions.get(`${kind!.toLowerCase()}:${name}`) : lookup!.get(kind!.toLowerCase(), name!)?.sql
    const normalize = original === projectGuard ? compactProjectGuard : compact
    if (typeof actual !== 'string' || normalize(actual) !== normalize(definition)) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '事件迁移回执结构或保护约束不完整，已停止打开且未尝试修复。', {
        recoverable: false, details: { area: 'workspaceDatabase' }
      })
    }
  }
}

function compact(sql: string): string { return sql.trim().replace(/;$/, '').replace(/\s+/g, ' ') }
function compactProjectGuard(sql: string): string { return compact(sql).replace(/\s*=\s*/g, '=') }
