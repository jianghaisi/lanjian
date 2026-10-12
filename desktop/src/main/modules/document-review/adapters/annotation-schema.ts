export const annotationMigrationSql = `
CREATE TABLE document_annotations (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_kind TEXT NOT NULL CHECK(document_kind IN ('body','total','volume','stage','chapter-outline')),
  document_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(id, revision)
);
CREATE INDEX document_annotations_document ON document_annotations(project_id, document_kind, document_id, seq DESC);
CREATE TRIGGER document_annotations_scope BEFORE INSERT ON document_annotations
WHEN NOT (
  (NEW.document_kind = 'body' AND EXISTS(SELECT 1 FROM chapters WHERE id = NEW.document_id AND project_id = NEW.project_id)) OR
  (NEW.document_kind <> 'body' AND EXISTS(SELECT 1 FROM outline_nodes WHERE id = NEW.document_id AND project_id = NEW.project_id))
) OR NEW.revision <> COALESCE((SELECT MAX(revision)+1 FROM document_annotations WHERE id=NEW.id),1)
  OR EXISTS(SELECT 1 FROM document_annotations WHERE id=NEW.id AND (project_id<>NEW.project_id OR document_id<>NEW.document_id OR document_kind<>NEW.document_kind))
BEGIN SELECT RAISE(ABORT, 'annotation scope or revision mismatch'); END;
CREATE TRIGGER document_annotations_no_update BEFORE UPDATE ON document_annotations
BEGIN SELECT RAISE(ABORT, 'annotation history is append-only'); END;
CREATE TRIGGER document_annotations_no_delete BEFORE DELETE ON document_annotations
BEGIN SELECT RAISE(ABORT, 'annotation history is append-only'); END;
DROP TRIGGER projects_schema_version_v45_after_insert;
CREATE TRIGGER projects_schema_version_v46_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 46 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 46;
`
