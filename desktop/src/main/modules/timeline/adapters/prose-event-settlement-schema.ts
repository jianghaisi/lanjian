import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
const tables = [
`CREATE TABLE event_settlement_drafts (
 seq INTEGER PRIMARY KEY, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 project_id TEXT NOT NULL REFERENCES projects(id), chapter_id TEXT NOT NULL REFERENCES chapters(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=1000000), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 UNIQUE(id,revision)
) STRICT;`,
`CREATE TABLE event_settlement_decisions (
 seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id),
 chapter_id TEXT NOT NULL REFERENCES chapters(id), event_id TEXT NOT NULL REFERENCES canonical_events(id),
 event_version_id TEXT NOT NULL REFERENCES canonical_event_versions(id), previous_id TEXT REFERENCES event_settlement_decisions(id),
 body_version_id TEXT NOT NULL REFERENCES body_versions(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=1000000), content_hash TEXT NOT NULL CHECK(length(content_hash)=64)
) STRICT;`,
`CREATE TABLE event_settlement_receipts (
 seq INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=1000000), content_hash TEXT NOT NULL CHECK(length(content_hash)=64)
) STRICT;`]
const names=['event_settlement_drafts','event_settlement_decisions','event_settlement_receipts']
const guards=names.flatMap(name=>[
  `CREATE TRIGGER ${name}_no_update BEFORE UPDATE ON ${name} BEGIN SELECT RAISE(ABORT,'settlement history is immutable'); END;`,
  `CREATE TRIGGER ${name}_no_delete BEFORE DELETE ON ${name} BEGIN SELECT RAISE(ABORT,'settlement history is immutable'); END;`,
  `CREATE TRIGGER ${name}_scope BEFORE INSERT ON ${name} BEGIN
   SELECT CASE WHEN EXISTS(SELECT 1 FROM ${name} WHERE ${name.endsWith('drafts')?'id=NEW.id AND revision=NEW.revision':name.endsWith('decisions')?'id=NEW.id':'operation_id=NEW.operation_id'}) THEN RAISE(ABORT,'settlement replacement forbidden') END;
   SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_module_transitions WHERE project_id=NEW.project_id) THEN RAISE(ABORT,'settlement requires transitioned events') END;
   ${name.endsWith('receipts')?'':`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM chapters WHERE id=NEW.chapter_id AND project_id=NEW.project_id) THEN RAISE(ABORT,'wrong settlement chapter') END;`}
   ${name.endsWith('drafts')?`SELECT CASE WHEN NEW.revision<>COALESCE((SELECT MAX(revision)+1 FROM event_settlement_drafts WHERE id=NEW.id),1)
      OR EXISTS(SELECT 1 FROM event_settlement_drafts WHERE id=NEW.id AND (project_id<>NEW.project_id OR chapter_id<>NEW.chapter_id)) THEN RAISE(ABORT,'invalid draft chain') END;`:''}
   ${name.endsWith('decisions')?`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canonical_event_versions v JOIN body_versions b ON b.id=NEW.body_version_id WHERE v.id=NEW.event_version_id AND v.event_id=NEW.event_id AND v.project_id=NEW.project_id AND b.chapter_id=NEW.chapter_id) THEN RAISE(ABORT,'wrong settlement evidence') END;
      SELECT CASE WHEN NEW.previous_id IS NOT (SELECT id FROM event_settlement_decisions WHERE event_id=NEW.event_id ORDER BY seq DESC LIMIT 1) THEN RAISE(ABORT,'invalid settlement chain') END;`:''}
  END;`
])
const indexes=[`CREATE INDEX event_settlement_drafts_chapter ON event_settlement_drafts(project_id,chapter_id,seq);`,
 `CREATE INDEX event_settlement_decisions_event ON event_settlement_decisions(project_id,event_id,seq);`]
const definitions=[...tables,...guards,...indexes]
export const eventSettlementMigrationSql=definitions.join('\n')+`
DROP TRIGGER projects_schema_version_v47_after_insert;
CREATE TRIGGER projects_schema_version_v48_after_insert AFTER INSERT ON projects BEGIN UPDATE projects SET current_schema_version=48 WHERE id=NEW.id; END;
UPDATE projects SET current_schema_version=48;`
export function assertEventSettlementSchema(db:DatabaseSync,provided?:ReadonlyMap<string,string|null>){
 const compact=(s:string)=>s.trim().replace(/;$/,'').replace(/\s+/g,' ')
 for(const expected of definitions){
  const [,type,name]=/^CREATE (TABLE|TRIGGER|INDEX) (\w+)/.exec(expected)!
  const actual=provided?provided.get(type!.toLowerCase()+':'+name):db.prepare('SELECT sql FROM sqlite_schema WHERE name=? AND type=?').get(name!,type!.toLowerCase())?.sql
  if(typeof actual!=='string'||compact(actual)!==compact(expected)) throw new AppError('DATABASE_INTEGRITY_FAILED','正文事件结算结构损坏，原数据已保留。',{recoverable:false})
 }
}
