import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../core/errors/app-error'

/** Internal schema migration only. The caller owns BEGIN/COMMIT/ROLLBACK and
 * restores foreign_keys outside the transaction. No author content conversion.
 */
export function rebuildSqliteTable(database: DatabaseSync, input: {
  table: 'task_runs' | 'workspace_config_documents' | 'canonical_events'
  copySql: string
  guardsSql: string
  integrityMessage: string
}): void {
  // Node 22's runtime lacks isTransaction even when newer installed types expose
  // it. Transaction ownership is enforced by the three private migration callers.
  if (database.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 0) {
    throw new AppError('DATABASE_MIGRATION_FAILED', '结构重建的连接设置无效。', { recoverable: false })
  }
  // Preserve exact definitions, including indirect and user-added dependencies.
  // Never rename the old table: SQLite would rewrite incoming references.
  const definitions = database.prepare(`
    SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL
      AND (type IN ('trigger', 'view') OR (type = 'index' AND tbl_name = ?))
    ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid
  `).all(input.table)
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'
  for (const definition of [...definitions].reverse()) {
    if (definition.type === 'index') continue // DROP TABLE removes these.
    database.exec(`DROP ${definition.type === 'view' ? 'VIEW' : 'TRIGGER'} ${quote(String(definition.name))}`)
  }
  database.exec(input.copySql)
  for (const definition of definitions) database.exec(String(definition.sql))
  database.exec(input.guardsSql)
  if (database.prepare('PRAGMA foreign_key_check').all().length) {
    throw new AppError('DATABASE_INTEGRITY_FAILED', input.integrityMessage, {
      recoverable: false, details: { area: 'workspaceDatabase' }
    })
  }
}
