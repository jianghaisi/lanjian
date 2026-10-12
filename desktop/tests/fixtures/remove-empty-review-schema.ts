import assert from 'node:assert/strict'
import type { DatabaseSync } from 'node:sqlite'
/** Test-only construction of pre-v45 snapshots. Refuses populated review data. */
export function removeEmptyReviewSchema(db: DatabaseSync) {
  const settlementTables=['event_settlement_receipts','event_settlement_decisions','event_settlement_drafts']
  for(const table of settlementTables){
    if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name=? AND type='table'").get(table))continue
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n,0)
    db.exec('DROP TABLE '+table)
  }
  const tables = ['document_review_application_sources', 'document_review_decisions', 'document_review_blocks', 'document_review_sessions', 'document_review_applications', 'document_review_drafts', 'document_review_recoveries', 'document_annotations']
  for (const table of tables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
  const guard = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='body_versions_ai_task_reference_guard'").get()!.sql).replace('WHEN NEW.review_application_id IS NULL\n', '')
  db.exec('DROP TRIGGER body_versions_ai_task_reference_guard')
  const additions = db.prepare("SELECT type,name FROM sqlite_schema WHERE type IN ('trigger','index') AND (name LIKE '%review%' OR name LIKE 'document_annotations%') AND name NOT LIKE 'sqlite_%'").all()
  for (const row of additions) db.exec(`DROP ${String(row.type).toUpperCase()} "${String(row.name)}"`)
  db.exec('ALTER TABLE body_versions DROP COLUMN review_application_id; ALTER TABLE outline_versions DROP COLUMN review_application_id')
  for (const table of tables) db.exec(`DROP TABLE ${table}`)
  db.exec(guard)
}
