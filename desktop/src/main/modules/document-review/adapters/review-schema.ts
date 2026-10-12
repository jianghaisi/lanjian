import { AppError } from '../../../core/errors/app-error'

/** New migrations only. The original single-Task/single-Artifact guard is kept
 * verbatim for legacy writes, and both original unique indexes remain intact. */
export function createReviewMigrationSql(legacyBodyGuard: string): string {
  if (!legacyBodyGuard.startsWith('CREATE TRIGGER body_versions_ai_task_reference_guard')) throw new Error('Missing legacy provenance guard')
  return `
CREATE TABLE document_review_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_kind TEXT NOT NULL CHECK(document_kind IN ('body','total','volume','stage','chapter-outline')),
  document_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES task_runs(id),
  artifact_id TEXT NOT NULL UNIQUE REFERENCES generation_artifacts(id),
  artifact_hash TEXT NOT NULL CHECK(length(artifact_hash) = 64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX document_review_document ON document_review_sessions(project_id, document_kind, document_id);
CREATE TABLE document_review_blocks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES document_review_sessions(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE document_review_decisions (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL UNIQUE,
  block_id TEXT NOT NULL REFERENCES document_review_blocks(id),
  kind TEXT NOT NULL CHECK(kind IN ('prepared','staged','rejected','withdrawn','committed')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX document_review_decision_block ON document_review_decisions(block_id, seq DESC);
CREATE TABLE document_review_drafts (
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_kind TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(project_id,document_kind,document_id)
);
CREATE TABLE document_review_applications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  document_kind TEXT NOT NULL,
  document_id TEXT NOT NULL,
  previous_version_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  title TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE document_review_application_sources (
  application_id TEXT NOT NULL REFERENCES document_review_applications(id),
  session_id TEXT NOT NULL REFERENCES document_review_sessions(id),
  block_id TEXT NOT NULL UNIQUE REFERENCES document_review_blocks(id),
  decision_id TEXT NOT NULL UNIQUE REFERENCES document_review_decisions(id),
  PRIMARY KEY(application_id,block_id)
);
ALTER TABLE body_versions ADD COLUMN review_application_id TEXT REFERENCES document_review_applications(id);
ALTER TABLE outline_versions ADD COLUMN review_application_id TEXT REFERENCES document_review_applications(id);
CREATE UNIQUE INDEX body_versions_review_application ON body_versions(review_application_id) WHERE review_application_id IS NOT NULL;
CREATE UNIQUE INDEX outline_versions_review_application ON outline_versions(review_application_id) WHERE review_application_id IS NOT NULL;
DROP TRIGGER body_versions_ai_task_reference_guard;
${legacyBodyGuard.replace('BEFORE INSERT ON body_versions\nBEGIN', 'BEFORE INSERT ON body_versions\nWHEN NEW.review_application_id IS NULL\nBEGIN')}
CREATE TRIGGER body_versions_review_reference_guard BEFORE INSERT ON body_versions
WHEN NEW.review_application_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid reviewed body provenance') WHERE NEW.source_type <> 'ai'
    OR NEW.source_task_run_id IS NOT NULL OR NEW.generation_artifact_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM document_review_applications application
      JOIN chapters target ON target.id = application.document_id AND target.project_id = application.project_id
      WHERE application.id = NEW.review_application_id AND application.document_kind = 'body'
        AND target.id = NEW.chapter_id AND application.content_hash = NEW.content_hash
        AND application.previous_version_id = NEW.parent_id AND NEW.parent_id = target.current_body_version_id
        AND application.receipt_json IS NULL
        AND EXISTS (SELECT 1 FROM document_review_application_sources source WHERE source.application_id = application.id));
END;
CREATE TRIGGER outline_versions_review_reference_guard BEFORE INSERT ON outline_versions
WHEN NEW.review_application_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid reviewed outline provenance') WHERE NEW.source_type <> 'ai'
    OR NOT EXISTS (SELECT 1 FROM document_review_applications application
      JOIN outline_nodes target ON target.id = application.document_id AND target.project_id = application.project_id
      WHERE application.id = NEW.review_application_id AND application.document_kind <> 'body'
        AND target.id = NEW.outline_node_id AND application.content_hash = NEW.content_hash
        AND application.previous_version_id = NEW.parent_id AND NEW.parent_id = target.current_version_id
        AND application.receipt_json IS NULL
        AND EXISTS (SELECT 1 FROM document_review_application_sources source WHERE source.application_id = application.id));
END;
CREATE TRIGGER body_review_title_guard BEFORE INSERT ON body_version_metadata
BEGIN
  SELECT RAISE(ABORT, 'reviewed body title mismatch') WHERE EXISTS (
    SELECT 1 FROM body_versions version JOIN document_review_applications application ON application.id = version.review_application_id
    WHERE version.id = NEW.version_id AND application.title <> NEW.title);
END;
CREATE TRIGGER document_review_source_guard BEFORE INSERT ON document_review_application_sources
BEGIN
  SELECT RAISE(ABORT, 'review application source mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM document_review_applications application
    JOIN document_review_sessions session ON session.id = NEW.session_id
    JOIN document_review_blocks block ON block.id = NEW.block_id AND block.session_id = session.id
    JOIN document_review_decisions decision ON decision.id = NEW.decision_id AND decision.block_id = block.id
    JOIN generation_artifacts artifact ON artifact.id = session.artifact_id AND artifact.task_run_id = session.task_id
    JOIN task_runs task ON task.id = session.task_id AND task.project_id = application.project_id
    WHERE application.id = NEW.application_id AND application.project_id = session.project_id
      AND application.document_kind = session.document_kind AND application.document_id = session.document_id
      AND application.receipt_json IS NULL AND decision.kind = 'staged'
      AND artifact.content_hash = session.artifact_hash AND artifact.status = 'complete' AND artifact.schema_valid = 1
      AND task.status = 'succeeded'
      AND NOT EXISTS (SELECT 1 FROM document_review_decisions later WHERE later.block_id = block.id AND later.seq > decision.seq));
END;
CREATE TRIGGER document_review_session_scope_guard BEFORE INSERT ON document_review_sessions
BEGIN
  SELECT RAISE(ABORT, 'review source belongs to another book') WHERE NOT EXISTS (
    SELECT 1 FROM task_runs task JOIN generation_artifacts artifact ON artifact.task_run_id = task.id
    WHERE task.id = NEW.task_id AND task.project_id = NEW.project_id AND artifact.id = NEW.artifact_id
      AND artifact.content_hash = NEW.artifact_hash AND artifact.schema_valid = 1 AND artifact.status = 'complete'
      AND task.status = 'succeeded');
END;
CREATE TRIGGER document_review_applications_no_update BEFORE UPDATE ON document_review_applications
WHEN OLD.receipt_json IS NOT NULL OR NEW.receipt_json IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.document_kind IS NOT OLD.document_kind
  OR NEW.document_id IS NOT OLD.document_id OR NEW.previous_version_id IS NOT OLD.previous_version_id
  OR NEW.content_hash IS NOT OLD.content_hash OR NEW.title IS NOT OLD.title OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'review applications are immutable after commit'); END;
${['document_review_sessions', 'document_review_blocks', 'document_review_decisions', 'document_review_application_sources'].map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'review evidence is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'review evidence is append-only'); END;`).join('\n')}
CREATE TRIGGER document_review_applications_no_delete BEFORE DELETE ON document_review_applications
BEGIN SELECT RAISE(ABORT, 'review applications are append-only'); END;
DROP TRIGGER projects_schema_version_v44_after_insert;
CREATE TRIGGER projects_schema_version_v45_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 45 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 45;
`
}

export function assertReviewSchema(definitions: ReadonlyMap<string, string | null>, migration: string, expectedVersion = 45): void {
  for (const match of migration.matchAll(/CREATE (TRIGGER) ([a-z_0-9]+)[\s\S]*?END;|CREATE (TABLE|(?:UNIQUE )?INDEX) ([a-z_0-9]+)[^;]*;/g)) {
    const objectType = match[1] || match[3]!
    const type = objectType.includes('INDEX') ? 'index' : objectType.toLowerCase()
    const name = match[2] || match[4]!
    if (name.startsWith('projects_schema_version_') && name !== `projects_schema_version_v${expectedVersion}_after_insert`) continue
    const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '')
    if (normalize(definitions.get(`${type}:${match[2] || match[4]}`) || '') !== normalize(match[0])) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '修订记录结构无法核对，原稿未被改动。', { recoverable: false })
    }
  }
}
