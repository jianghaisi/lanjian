export const reviewRecoveryMigrationSql = `
CREATE TABLE document_review_recoveries (
  seq INTEGER PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_kind TEXT NOT NULL,
  document_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE INDEX document_review_recoveries_document ON document_review_recoveries(project_id,document_kind,document_id,seq DESC);
CREATE TRIGGER document_review_recoveries_no_update BEFORE UPDATE ON document_review_recoveries
BEGIN SELECT RAISE(ABORT, 'recovery evidence is append-only'); END;
CREATE TRIGGER document_review_recoveries_no_delete BEFORE DELETE ON document_review_recoveries
BEGIN SELECT RAISE(ABORT, 'recovery evidence is append-only'); END;
DROP TRIGGER projects_schema_version_v46_after_insert;
CREATE TRIGGER projects_schema_version_v47_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 47 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 47;
`
