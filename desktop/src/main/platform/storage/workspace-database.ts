import { createHash, randomUUID } from 'node:crypto'
import { decodeWorldMapDocument } from '../../../contracts/world-map/world-map'
import { access, mkdir, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../core/errors/app-error'
import { parseBookModelSettings, type BookModelSettings } from '../../modules/models/domain/book-model-settings'
import { bookModelConfigInputs } from '../../modules/models/adapters/book-model-configs'
import { normalizeRetrievalText } from '../../modules/assistant/domain/retrieval-text'
import { normalizeChapterCard, type ChapterCard } from '../../modules/manuscript/domain/chapter-card'
import { normalizeStoryText, storyEventSignature } from '../../modules/timeline/domain/story-event'
import { assertMaterialSources, assertCanonicalEvents, normalizedMaterialUrl } from '../../modules/worldbuilding/domain/legacy-research-validation'
import { assertAppendStoryEventVersionInput, type AppendStoryEventVersionInput, type StoryEventVersion, type StoryEventVersionHeads } from '../../modules/timeline/domain/story-event-version'
import { CanonicalEventVersions, canonicalEventVersionsMigrationSql, canonicalEventVersionTables, canonicalEventVersionTriggers } from '../../modules/timeline/adapters/canonical-event-versions'
import { stableEventReadSnapshot } from '../../modules/timeline/adapters/event-read-snapshot'
import { ManuscriptTextObjects, manuscriptTextObjectsMigrationSql, manuscriptTextGuardsMigrationSql, assertManuscriptTextSchema, intermediateManuscriptSchema41Checksum, hasIntermediateManuscriptSchema41, type TextObjectReference } from '../../modules/manuscript/adapters/manuscript-text-objects'
import { ManuscriptCommitJournal, type ManuscriptCommand, type ManuscriptFileIntent, type ManuscriptCommitReceipt } from '../../modules/manuscript/adapters/manuscript-commit-journal'
import { assertNoManuscriptMigration } from '../../modules/manuscript/adapters/manuscript-migration-lock'
import { rebuildSqliteTable } from './sqlite-table-rebuild'
import { canonicalEventIdentityCopySql, canonicalEventIdentityGuardsSql, assertCanonicalEventIdentityUpgradeSource, assertCanonicalEventIdentitySchema } from '../../modules/timeline/adapters/canonical-event-identity-schema'
import { eventMigrationReceiptsMigrationSql, assertEventMigrationReceiptSchema, eventMigrationReceiptTables } from '../../modules/timeline/adapters/event-migration-receipt-schema'
import { readEventMigrationReceipt } from '../../modules/timeline/adapters/event-migration-receipt-reader'
import {
  chapterLifecycleStates,
  initialChapterLifecycle,
  transitionChapterLifecycle,
  type ChapterLifecycleState
} from '../../modules/manuscript/domain/chapter-lifecycle'
import { factBatchCanTransition } from '../../modules/review/domain/fact-batch-lifecycle'
import { taskRunCanTransition, taskRunHasLegacyPause, taskRunIsTerminal } from '../../modules/assistant/domain/task-run-lifecycle'
import {
  createTaskContractSnapshot,
  isLegacyTaskContract,
  taskContractHash,
  type WorkspaceTaskContractSnapshot
} from '../../modules/assistant/domain/task-template-contract'
import {
  WORKSPACE_DATABASE_RELATIVE_PATH,
  WORKSPACE_DATABASE_SCHEMA_VERSION,
  WORKSPACE_AUTOSAVE_CHECKPOINT_WINDOW_MS,
  assertLegacyWorkspaceSnapshot,
  type LegacyWorkspaceSnapshot,
  type LegacyWorkspacePromptProfile,
  type ShadowImportResult,
  type WorkspaceDatabaseFactory,
  type WorkspaceAiSettingsWriteGuard,
  type WorkspaceDatabaseInspection,
  type WorkspaceDatabasePort,
  type WorkspaceEventReadPort,
  type WorkspaceRecoveryReadPort,
  type WorkspaceEventChapterCatalog,
  type WorkspaceOutlineChildrenAppendInput,
  type WorkspaceBodyRevisionRecord,
  type WorkspaceArchivedChapterRecord,
  type WorkspaceChapterRecord,
  type WorkspaceChapterPlanningRecord,
  type WorkspaceChapterPlanningWriteResult,
  type WorkspaceChapterPlanningWriteInput,
  type WorkspaceChapterWriteInput,
  type WorkspaceChapterWriteResult,
  type WorkspaceWritingAgentApplicationInput,
  type WorkspaceWritingAgentApplicationResult,
  type WorkspaceContextPackageCreateInput,
  type WorkspaceContextPackageRecord,
  type WorkspaceArtifactStatus,
  type WorkspaceAutosaveCheckpointFinalizeResult,
  type WorkspaceAutosaveCheckpointRecord,
  type WorkspaceAutosaveCheckpointStageInput,
  type WorkspaceAutosaveCheckpointStageResult,
  type WorkspaceAutosaveCheckpointStatus,
  type WorkspaceApprovedFactRecord,
  type WorkspaceFactBatchCreateInput,
  type WorkspaceFactBatchRecord,
  type WorkspaceFactBatchStatus,
  type WorkspaceFactChangeCreateInput,
  type WorkspaceFactChangeDecision,
  type WorkspaceFactChangeRecord,
  type WorkspaceFactDecisionInput,
  type WorkspaceFactDecisionResult,
  type WorkspaceFactImportance,
  type WorkspaceFactReviewClass,
  type WorkspaceFindingDecisionInput,
  type WorkspaceFindingRecord,
  type WorkspaceFindingRunInput,
  type WorkspaceFindingStatus,
  type WorkspaceSummaryVersionRecord,
  type WorkspaceSummaryVersionWriteInput,
  type WorkspaceChapterDerivativeStatus,
  type WorkspaceDocumentChunkRecord,
  type WorkspaceCharacterSnapshotRecord,
  type WorkspaceModelConfigInput,
  type WorkspaceModelConfigRecord,
  type WorkspaceConfigDocumentKind,
  type WorkspaceCharacterAliasInput,
  type WorkspaceCharacterAliasRecord,
  type WorkspaceCharacterAliasWriteResult,
  type WorkspaceEntityInput,
  type WorkspaceEntityRecord,
  type WorkspaceEntityRelationInput,
  type WorkspaceEntityRelationRecord,
  type WorkspaceEntityRelationWriteResult,
  type WorkspaceEntityType,
  type WorkspaceEntityWriteResult,
  type WorkspaceIdeaInput,
  type WorkspaceIdeaPromotionResult,
  type WorkspaceIdeaRecord,
  type WorkspaceIdeaStatus,
  type WorkspaceIdeaWriteResult,
  type WorkspaceMaterialSourceRecord,
  type WorkspaceMaterialSourceWriteResult,
  type WorkspaceMaterialSourcesWriteResult,
  type WorkspaceCanonicalEventRecord,
  type WorkspaceCanonicalEventsWriteResult,
  type WorkspaceCanonicalEventWriteResult,
  type WorkspaceCanonicalEventVersionWriteResult,
  type WorkspaceCharacterStateDocument,
  type WorkspaceCharacterStateWriteResult,
  type WorkspaceOutlinePlanningStateDocument,
  type WorkspaceOutlinePlanningStateWriteResult,
  type WorkspaceResourceLedgerInput,
  type WorkspaceResourceLedgerRecord,
  type WorkspaceResourceBalanceRecord,
  type WorkspaceResourceLedgerView,
  type WorkspaceResourceLedgerWriteResult,
  type WorkspaceForeshadowActionInput,
  type WorkspaceForeshadowActionRecord,
  type WorkspaceForeshadowActionWriteResult,
  type WorkspaceForeshadowLedgerView,
  type WorkspaceForeshadowRecord,
  type WorkspaceForeshadowStatus,
  type WorkspaceRealTrialAutomaticMetrics,
  type WorkspaceRealTrialChapterInput,
  type WorkspaceRealTrialChapterRecord,
  type WorkspaceRealTrialConclusionInput,
  type WorkspaceRealTrialConclusionRecord,
  type WorkspaceGenerationArtifactCreateInput,
  type WorkspaceGenerationArtifactRecord,
  type WorkspaceMirrorPlan,
  type WorkspaceMirrorPlanFilter,
  type WorkspaceMirrorStatus,
  type WorkspaceStorageMode,
  type WorkspaceOutlineRecord,
  type WorkspaceOutlineWriteInput,
  type WorkspaceProjectWritingConfig,
  type WorkspaceProjectWritingConfigInput,
  type WorkspaceProjectWritingConfigWriteResult,
  type WorkspaceFoundationConfig,
  type WorkspaceFoundationConfigWriteResult,
  type WorkspacePromptProfileRecord,
  type WorkspacePromptProfileWriteResult,
  type WorkspaceTaskRunCreateInput,
  type WorkspaceTaskRunRecord,
  type WorkspaceTaskRunTransitionInput,
  type WorkspaceTaskStatus
} from '../../core/ports/workspace-database'
import { canonicalDirectory, projectDirectory, projectTargetPath, projectExistingPathSync } from './project-path'

const initialMigrationName = 'initial-workspace-shadow-schema'
const initialMigrationSql = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  legacy_manifest_hash TEXT NOT NULL CHECK(length(legacy_manifest_hash) = 64),
  storage_mode TEXT NOT NULL CHECK(storage_mode IN ('shadow', 'sqlite')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  legacy_chapter_id INTEGER NOT NULL CHECK(legacy_chapter_id > 0),
  seq INTEGER NOT NULL CHECK(seq > 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'confirmed', 'archived')),
  current_body_version_id TEXT NULL,
  confirmed_body_version_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, legacy_chapter_id),
  UNIQUE(project_id, seq),
  FOREIGN KEY(current_body_version_id) REFERENCES body_versions(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(confirmed_body_version_id) REFERENCES body_versions(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE body_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  parent_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  restored_from_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK(source_type IN ('legacy_import', 'manual', 'autosave', 'ai', 'restore')),
  source_task_run_id TEXT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chapter_id, version_no)
);

CREATE TABLE mirror_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  observed_hash TEXT NULL CHECK(observed_hash IS NULL OR length(observed_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('pending', 'synced', 'conflict', 'failed')),
  last_error_code TEXT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, source_type, source_id),
  UNIQUE(project_id, relative_path)
);

CREATE TABLE write_operations (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  result_ref TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shadow_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64),
  status TEXT NOT NULL CHECK(status IN ('completed', 'failed')),
  chapter_count INTEGER NOT NULL CHECK(chapter_count >= 0),
  total_words INTEGER NOT NULL CHECK(total_words >= 0),
  error_code TEXT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NULL
);

CREATE INDEX idx_body_versions_chapter_created ON body_versions(chapter_id, version_no DESC);
CREATE INDEX idx_shadow_imports_project_started ON shadow_imports(project_id, started_at DESC);

CREATE TRIGGER body_versions_no_update
BEFORE UPDATE ON body_versions
BEGIN
  SELECT RAISE(ABORT, 'body_versions are append-only');
END;

CREATE TRIGGER body_versions_no_delete
BEFORE DELETE ON body_versions
BEGIN
  SELECT RAISE(ABORT, 'body_versions are append-only');
END;
`
const formalManuscriptMigrationName = 'formal-manuscript-and-storage-transitions'
const formalManuscriptMigrationSql = `
ALTER TABLE mirror_entries ADD COLUMN previous_relative_path TEXT NULL;
ALTER TABLE mirror_entries ADD COLUMN previous_observed_hash TEXT NULL CHECK(previous_observed_hash IS NULL OR length(previous_observed_hash) = 64);

CREATE TABLE body_version_metadata (
  version_id TEXT PRIMARY KEY REFERENCES body_versions(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('legacy_import', 'manual', 'autosave', 'ai', 'restore'))
);

INSERT INTO body_version_metadata (version_id, title, reason)
SELECT versions.id, chapters.title, versions.source_type
FROM body_versions versions
JOIN chapters ON chapters.id = versions.chapter_id;

CREATE TABLE storage_transitions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  from_mode TEXT NOT NULL CHECK(from_mode IN ('shadow', 'sqlite')),
  to_mode TEXT NOT NULL CHECK(to_mode IN ('shadow', 'sqlite')),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64),
  created_at TEXT NOT NULL,
  CHECK(from_mode <> to_mode)
);

CREATE INDEX idx_mirror_entries_project_status ON mirror_entries(project_id, status);
CREATE INDEX idx_storage_transitions_project_created ON storage_transitions(project_id, created_at DESC);
`
const aiTaskArtifactMigrationName = 'persistent-ai-task-runs-and-artifacts'
const aiTaskArtifactMigrationSql = `
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'preparing', 'running', 'streaming', 'succeeded', 'cancelled', 'failed', 'interrupted')),
  idempotency_key TEXT NOT NULL,
  parent_task_run_id TEXT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  base_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NULL CHECK(content_hash IS NULL OR length(content_hash) = 64),
  context_package_id TEXT NULL,
  model_config_id TEXT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  checkpoint_json TEXT NOT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  started_at TEXT NULL,
  ended_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, idempotency_key)
);

CREATE TABLE generation_artifacts (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('partial', 'complete', 'invalid', 'discarded', 'applied')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  schema_valid INTEGER NOT NULL CHECK(schema_valid IN (0, 1)),
  base_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  selection_anchor_json TEXT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_run_id, artifact_type)
);

CREATE INDEX idx_task_runs_project_status_updated ON task_runs(project_id, status, updated_at DESC);
CREATE INDEX idx_task_runs_chapter_updated ON task_runs(chapter_id, updated_at DESC);
CREATE INDEX idx_generation_artifacts_task ON generation_artifacts(task_run_id);

CREATE TRIGGER body_versions_ai_task_reference_guard
BEFORE INSERT ON body_versions
WHEN NEW.source_task_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'AI body version requires an applied artifact from a succeeded same-chapter task')
  WHERE NOT EXISTS (
    SELECT 1 FROM task_runs runs
    JOIN generation_artifacts artifacts ON artifacts.task_run_id = runs.id
    WHERE runs.id = NEW.source_task_run_id
      AND runs.chapter_id = NEW.chapter_id
      AND runs.status = 'succeeded'
      AND artifacts.status = 'applied'
  );
END;
`
const contextPackageMigrationName = 'frozen-ai-context-packages-and-stream-artifacts'
const contextPackageMigrationSql = `
CREATE TABLE context_packages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  compiler_version TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  token_budget INTEGER NOT NULL CHECK(token_budget > 0),
  estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
  truncation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_run_id)
);

CREATE INDEX idx_context_packages_project_created ON context_packages(project_id, created_at DESC);

CREATE TRIGGER context_packages_task_scope_guard
BEFORE INSERT ON context_packages
BEGIN
  SELECT RAISE(ABORT, 'context package must match its task project')
  WHERE NOT EXISTS (
    SELECT 1 FROM task_runs runs
    WHERE runs.id = NEW.task_run_id AND runs.project_id = NEW.project_id
  );
END;

CREATE TRIGGER task_runs_context_package_guard
BEFORE UPDATE OF context_package_id ON task_runs
WHEN NEW.context_package_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'task context package link is invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM context_packages packages
    WHERE packages.id = NEW.context_package_id
      AND packages.task_run_id = NEW.id
      AND packages.project_id = NEW.project_id
  );
END;

CREATE TRIGGER context_packages_no_update
BEFORE UPDATE ON context_packages
BEGIN
  SELECT RAISE(ABORT, 'context packages are immutable');
END;

CREATE TRIGGER context_packages_no_delete
BEFORE DELETE ON context_packages
BEGIN
  SELECT RAISE(ABORT, 'context packages are immutable');
END;
`
const partialArtifactProvenanceMigrationName = 'applied-partial-artifact-body-provenance'
const partialArtifactProvenanceMigrationSql = `
DROP TRIGGER body_versions_ai_task_reference_guard;

CREATE TRIGGER body_versions_ai_task_reference_guard
BEFORE INSERT ON body_versions
WHEN NEW.source_task_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'AI body version requires an applied same-chapter task artifact')
  WHERE NOT EXISTS (
    SELECT 1 FROM task_runs runs
    JOIN generation_artifacts artifacts ON artifacts.task_run_id = runs.id
    WHERE runs.id = NEW.source_task_run_id
      AND runs.chapter_id = NEW.chapter_id
      AND artifacts.status = 'applied'
      AND (
        (runs.status = 'succeeded' AND artifacts.artifact_type = 'writing_agent_turn')
        OR
        (runs.status IN ('cancelled', 'failed', 'interrupted') AND artifacts.artifact_type = 'writing_agent_stream')
      )
  );
END;
`
const outlineAuthorityMigrationName = 'outline-nodes-versions-and-readable-mirrors'
const outlineAuthorityMigrationSql = `
ALTER TABLE projects ADD COLUMN outline_storage_ready INTEGER NOT NULL DEFAULT 0 CHECK(outline_storage_ready IN (0, 1));

CREATE TABLE outline_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  parent_id TEXT NULL REFERENCES outline_nodes(id) ON DELETE RESTRICT,
  legacy_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('summary', 'volume', 'chapter')),
  seq INTEGER NOT NULL CHECK(seq > 0),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('draft', 'confirmed', 'archived')),
  current_version_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, legacy_key),
  FOREIGN KEY(current_version_id) REFERENCES outline_versions(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE outline_versions (
  id TEXT PRIMARY KEY,
  outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  parent_id TEXT NULL REFERENCES outline_versions(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK(source_type IN ('legacy_import', 'manual', 'ai', 'restore')),
  created_at TEXT NOT NULL,
  UNIQUE(outline_node_id, version_no)
);

CREATE INDEX idx_outline_nodes_project_type_seq ON outline_nodes(project_id, node_type, seq);
CREATE UNIQUE INDEX idx_outline_nodes_sibling_seq
  ON outline_nodes(project_id, COALESCE(parent_id, ''), node_type, seq)
  WHERE status <> 'archived';
CREATE INDEX idx_outline_versions_node_version ON outline_versions(outline_node_id, version_no DESC);

CREATE TRIGGER outline_versions_no_update BEFORE UPDATE ON outline_versions BEGIN
  SELECT RAISE(ABORT, 'outline_versions are append-only');
END;
CREATE TRIGGER outline_versions_no_delete BEFORE DELETE ON outline_versions BEGIN
  SELECT RAISE(ABORT, 'outline_versions are append-only');
END;
`
const writingConfigurationMigrationName = 'writing-configuration-stage-planning-and-chapter-workflows'
const writingConfigurationMigrationSql = `
ALTER TABLE projects ADD COLUMN target_words INTEGER NULL CHECK(target_words IS NULL OR target_words > 0);
ALTER TABLE projects ADD COLUMN genre_text TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN audience_scale TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN default_pov TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN writing_style TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN chapter_target_words INTEGER NULL CHECK(chapter_target_words IS NULL OR chapter_target_words > 0);
ALTER TABLE projects ADD COLUMN autosave_enabled INTEGER NOT NULL DEFAULT 1 CHECK(autosave_enabled IN (0, 1));
ALTER TABLE projects ADD COLUMN autosave_delay_ms INTEGER NOT NULL DEFAULT 1500 CHECK(autosave_delay_ms BETWEEN 250 AND 60000);
ALTER TABLE projects ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN current_schema_version INTEGER NOT NULL DEFAULT 7 CHECK(current_schema_version > 0);

CREATE TABLE outline_node_metadata (
  outline_node_id TEXT PRIMARY KEY REFERENCES outline_nodes(id) ON DELETE RESTRICT,
  planning_kind TEXT NOT NULL CHECK(planning_kind IN ('summary', 'volume', 'stage', 'chapter')),
  goal_text TEXT NOT NULL DEFAULT '',
  entry_state_text TEXT NOT NULL DEFAULT '',
  exit_state_text TEXT NOT NULL DEFAULT '',
  conflict_text TEXT NOT NULL DEFAULT '',
  turning_point_text TEXT NOT NULL DEFAULT '',
  hook_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO outline_node_metadata (
  outline_node_id, planning_kind, goal_text, entry_state_text, exit_state_text,
  conflict_text, turning_point_text, hook_text, metadata_json, created_at, updated_at
)
SELECT id, node_type, '', '', '', '', '', '', '{}', created_at, updated_at
FROM outline_nodes;

ALTER TABLE chapters ADD COLUMN outline_node_id TEXT NULL REFERENCES outline_nodes(id) ON DELETE RESTRICT;

UPDATE chapters
SET outline_node_id = (
  SELECT nodes.id FROM outline_nodes nodes
  WHERE nodes.project_id = chapters.project_id
    AND nodes.legacy_key = 'chapter-' || chapters.legacy_chapter_id
    AND nodes.status <> 'archived'
  LIMIT 1
);

CREATE TABLE chapter_workflows (
  chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING', 'ARCHIVED')),
  archived_from_status TEXT NULL CHECK(archived_from_status IS NULL OR archived_from_status IN ('PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING')),
  card_status TEXT NOT NULL DEFAULT 'empty' CHECK(card_status IN ('empty', 'draft', 'confirmed')),
  goal_text TEXT NOT NULL DEFAULT '',
  entry_state_text TEXT NOT NULL DEFAULT '',
  conflict_text TEXT NOT NULL DEFAULT '',
  pov_text TEXT NOT NULL DEFAULT '',
  narrative_distance_text TEXT NOT NULL DEFAULT '',
  exit_change_text TEXT NOT NULL DEFAULT '',
  hook_text TEXT NOT NULL DEFAULT '',
  card_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  CHECK(
    (lifecycle_status = 'ARCHIVED' AND archived_from_status IS NOT NULL)
    OR (lifecycle_status <> 'ARCHIVED' AND archived_from_status IS NULL)
  )
);

INSERT INTO chapter_workflows (chapter_id, lifecycle_status, archived_from_status, updated_at)
SELECT chapters.id,
  CASE
    WHEN chapters.status = 'archived' THEN 'ARCHIVED'
    WHEN chapters.status = 'confirmed' THEN 'CONFIRMED'
    WHEN EXISTS (
      SELECT 1 FROM body_versions versions
      WHERE versions.id = chapters.current_body_version_id AND length(versions.content) > 0
    ) THEN 'DRAFTING'
    ELSE 'PLANNED'
  END,
  CASE
    WHEN chapters.status = 'archived' AND EXISTS (
      SELECT 1 FROM body_versions versions
      WHERE versions.id = chapters.current_body_version_id AND length(versions.content) > 0
    ) THEN 'DRAFTING'
    WHEN chapters.status = 'archived' THEN 'PLANNED'
    ELSE NULL
  END,
  chapters.updated_at
FROM chapters;

CREATE INDEX idx_outline_node_metadata_kind ON outline_node_metadata(planning_kind, outline_node_id);
CREATE INDEX idx_chapters_outline_node ON chapters(outline_node_id);
CREATE INDEX idx_chapter_workflows_lifecycle ON chapter_workflows(lifecycle_status, chapter_id);
CREATE INDEX idx_chapter_workflows_card ON chapter_workflows(card_status, chapter_id);

CREATE TRIGGER outline_node_metadata_kind_guard
BEFORE INSERT ON outline_node_metadata
BEGIN
  SELECT RAISE(ABORT, 'outline planning kind is incompatible with its storage node type')
  WHERE NOT EXISTS (
    SELECT 1 FROM outline_nodes nodes
    WHERE nodes.id = NEW.outline_node_id
      AND (nodes.node_type = NEW.planning_kind OR (nodes.node_type = 'volume' AND NEW.planning_kind = 'stage'))
  );
END;

CREATE TRIGGER outline_node_metadata_kind_update_guard
BEFORE UPDATE OF planning_kind, outline_node_id ON outline_node_metadata
BEGIN
  SELECT RAISE(ABORT, 'outline planning kind is incompatible with its storage node type')
  WHERE NOT EXISTS (
    SELECT 1 FROM outline_nodes nodes
    WHERE nodes.id = NEW.outline_node_id
      AND (nodes.node_type = NEW.planning_kind OR (nodes.node_type = 'volume' AND NEW.planning_kind = 'stage'))
  );
END;

CREATE TRIGGER outline_nodes_planning_kind_guard
BEFORE UPDATE OF node_type ON outline_nodes
WHEN EXISTS (SELECT 1 FROM outline_node_metadata metadata WHERE metadata.outline_node_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'outline storage node type is incompatible with its planning kind')
  WHERE NOT EXISTS (
    SELECT 1 FROM outline_node_metadata metadata
    WHERE metadata.outline_node_id = NEW.id
      AND (NEW.node_type = metadata.planning_kind OR (NEW.node_type = 'volume' AND metadata.planning_kind = 'stage'))
  );
END;

CREATE TRIGGER chapters_outline_scope_guard
BEFORE UPDATE OF outline_node_id ON chapters
WHEN NEW.outline_node_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'chapter outline link must target a chapter node in the same project')
  WHERE NOT EXISTS (
    SELECT 1 FROM outline_nodes nodes
    JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
    WHERE nodes.id = NEW.outline_node_id
      AND nodes.project_id = NEW.project_id
      AND metadata.planning_kind = 'chapter'
  );
END;

CREATE TRIGGER chapters_outline_insert_scope_guard
BEFORE INSERT ON chapters
WHEN NEW.outline_node_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'chapter outline link must target a chapter node in the same project')
  WHERE NOT EXISTS (
    SELECT 1 FROM outline_nodes nodes
    JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
    WHERE nodes.id = NEW.outline_node_id
      AND nodes.project_id = NEW.project_id
      AND metadata.planning_kind = 'chapter'
  );
END;

CREATE TRIGGER chapter_workflows_transition_guard
BEFORE UPDATE OF lifecycle_status ON chapter_workflows
WHEN NEW.lifecycle_status <> OLD.lifecycle_status
BEGIN
  SELECT RAISE(ABORT, 'invalid chapter lifecycle transition')
  WHERE NOT (
    NEW.lifecycle_status = 'ARCHIVED'
    OR (OLD.lifecycle_status = 'ARCHIVED' AND NEW.lifecycle_status = OLD.archived_from_status)
    OR (OLD.lifecycle_status = 'PLANNED' AND NEW.lifecycle_status = 'DRAFTING')
    OR (OLD.lifecycle_status = 'DRAFTING' AND NEW.lifecycle_status IN ('REVIEWABLE', 'REVISING'))
    OR (OLD.lifecycle_status = 'REVIEWABLE' AND NEW.lifecycle_status IN ('CONFIRMED', 'REVISING'))
    OR (OLD.lifecycle_status = 'CONFIRMED' AND NEW.lifecycle_status = 'REVISING')
    OR (OLD.lifecycle_status = 'REVISING' AND NEW.lifecycle_status IN ('PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED'))
  );
END;

UPDATE projects SET current_schema_version = 7;
`
const autosaveCheckpointMigrationName = 'autosave-checkpoints-and-idempotent-client-operations'
const autosaveCheckpointMigrationSql = `
ALTER TABLE projects ADD COLUMN autosave_merge_window_ms INTEGER NOT NULL DEFAULT 30000
  CHECK(autosave_merge_window_ms BETWEEN 1000 AND 600000);

CREATE TABLE autosave_checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  latest_client_operation_id TEXT NOT NULL,
  base_body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('staged', 'finalized', 'conflict', 'discarded')),
  merge_window_ms INTEGER NOT NULL CHECK(merge_window_ms BETWEEN 1000 AND 600000),
  window_started_at TEXT NOT NULL,
  window_ends_at TEXT NOT NULL,
  last_staged_at TEXT NOT NULL,
  conflict_current_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  finalized_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (status = 'staged' AND conflict_current_body_version_id IS NULL AND finalized_body_version_id IS NULL)
    OR (status = 'conflict' AND conflict_current_body_version_id IS NOT NULL AND finalized_body_version_id IS NULL)
    OR (status = 'finalized' AND conflict_current_body_version_id IS NULL AND finalized_body_version_id IS NOT NULL)
    OR status = 'discarded'
  )
);

CREATE TABLE autosave_checkpoint_operations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  checkpoint_id TEXT NOT NULL REFERENCES autosave_checkpoints(id) ON DELETE RESTRICT,
  client_operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  staged_at TEXT NOT NULL,
  UNIQUE(project_id, client_operation_id)
);

CREATE INDEX idx_autosave_checkpoints_chapter_status_window
  ON autosave_checkpoints(chapter_id, status, window_started_at DESC);
CREATE INDEX idx_autosave_checkpoints_project_updated
  ON autosave_checkpoints(project_id, updated_at DESC);
CREATE INDEX idx_autosave_checkpoint_operations_checkpoint
  ON autosave_checkpoint_operations(checkpoint_id, staged_at);

CREATE TRIGGER autosave_checkpoint_operations_no_update
BEFORE UPDATE ON autosave_checkpoint_operations
BEGIN
  SELECT RAISE(ABORT, 'autosave checkpoint operations are append-only');
END;

CREATE TRIGGER autosave_checkpoint_operations_no_delete
BEFORE DELETE ON autosave_checkpoint_operations
BEGIN
  SELECT RAISE(ABORT, 'autosave checkpoint operations are append-only');
END;

CREATE TRIGGER autosave_checkpoint_operations_scope_guard
BEFORE INSERT ON autosave_checkpoint_operations
BEGIN
  SELECT RAISE(ABORT, 'autosave checkpoint operation scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM autosave_checkpoints checkpoints
    WHERE checkpoints.id = NEW.checkpoint_id
      AND checkpoints.project_id = NEW.project_id
      AND checkpoints.chapter_id = NEW.chapter_id
  );
END;

CREATE TRIGGER autosave_checkpoints_scope_insert_guard
BEFORE INSERT ON autosave_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'autosave checkpoint version scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM chapters
    JOIN body_versions base_versions ON base_versions.id = NEW.base_body_version_id
    WHERE chapters.id = NEW.chapter_id
      AND chapters.project_id = NEW.project_id
      AND base_versions.chapter_id = NEW.chapter_id
  )
  OR (NEW.conflict_current_body_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM body_versions versions WHERE versions.id = NEW.conflict_current_body_version_id AND versions.chapter_id = NEW.chapter_id
  ))
  OR (NEW.finalized_body_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM body_versions versions WHERE versions.id = NEW.finalized_body_version_id AND versions.chapter_id = NEW.chapter_id
  ));
END;

CREATE TRIGGER autosave_checkpoints_scope_update_guard
BEFORE UPDATE OF project_id, chapter_id, base_body_version_id, conflict_current_body_version_id, finalized_body_version_id ON autosave_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'autosave checkpoint version scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM chapters
    JOIN body_versions base_versions ON base_versions.id = NEW.base_body_version_id
    WHERE chapters.id = NEW.chapter_id
      AND chapters.project_id = NEW.project_id
      AND base_versions.chapter_id = NEW.chapter_id
  )
  OR (NEW.conflict_current_body_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM body_versions versions WHERE versions.id = NEW.conflict_current_body_version_id AND versions.chapter_id = NEW.chapter_id
  ))
  OR (NEW.finalized_body_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM body_versions versions WHERE versions.id = NEW.finalized_body_version_id AND versions.chapter_id = NEW.chapter_id
  ));
END;

CREATE TRIGGER autosave_checkpoints_transition_guard
BEFORE UPDATE OF status ON autosave_checkpoints
WHEN NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'invalid autosave checkpoint transition')
  WHERE NOT (
    (OLD.status = 'staged' AND NEW.status IN ('finalized', 'conflict', 'discarded'))
    OR (OLD.status = 'conflict' AND NEW.status = 'discarded')
  );
END;

CREATE TRIGGER autosave_checkpoints_terminal_content_guard
BEFORE UPDATE OF project_id, chapter_id, base_body_version_id, title, content, content_hash, merge_window_ms,
  window_started_at, window_ends_at ON autosave_checkpoints
WHEN OLD.status <> 'staged'
BEGIN
  SELECT RAISE(ABORT, 'terminal autosave checkpoint content is immutable');
END;

CREATE TRIGGER projects_schema_version_v8_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 8
BEGIN
  UPDATE projects SET current_schema_version = 8 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 8;
`
const factApprovalMigrationName = 'version-bound-fact-review-and-approved-memory'
const factApprovalMigrationSql = `
CREATE TABLE fact_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE')),
  extractor_task_run_id TEXT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, idempotency_key)
);

CREATE TABLE fact_changes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES fact_batches(id) ON DELETE RESTRICT,
  candidate_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NULL,
  subject_json TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_json TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NULL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  importance TEXT NOT NULL CHECK(importance IN ('high', 'medium', 'low')),
  change_type TEXT NOT NULL CHECK(change_type IN ('NEW', 'CHANGED', 'CONFIRMS', 'CONTRADICTS')),
  decision_status TEXT NOT NULL CHECK(decision_status IN ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED')),
  matched_fact_id TEXT NULL REFERENCES facts(id) ON DELETE RESTRICT,
  edited_object_json TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  approved_change_id TEXT NOT NULL UNIQUE REFERENCES fact_changes(id) ON DELETE RESTRICT,
  primary_source_id TEXT NOT NULL REFERENCES fact_sources(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  subject_type TEXT NOT NULL,
  subject_id TEXT NULL,
  predicate TEXT NOT NULL,
  object_json TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('APPROVED', 'RETRACTED')),
  importance TEXT NOT NULL CHECK(importance IN ('high', 'medium', 'low')),
  supersedes_fact_id TEXT NULL REFERENCES facts(id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE fact_sources (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  quote TEXT NOT NULL CHECK(length(quote) > 0),
  span_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE fact_decisions (
  id TEXT PRIMARY KEY,
  fact_change_id TEXT NOT NULL REFERENCES fact_changes(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVED', 'REJECTED', 'DEFERRED')),
  original_object_json TEXT NOT NULL,
  decided_object_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE fact_source_impacts (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE RESTRICT,
  fact_source_id TEXT NOT NULL REFERENCES fact_sources(id) ON DELETE RESTRICT,
  old_body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  replacement_body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  impact_type TEXT NOT NULL CHECK(impact_type = 'SOURCE_NO_LONGER_CURRENT'),
  created_at TEXT NOT NULL,
  UNIQUE(fact_source_id, old_body_version_id, replacement_body_version_id, impact_type)
);

CREATE INDEX idx_fact_batches_chapter_status_created ON fact_batches(chapter_id, status, created_at DESC);
CREATE INDEX idx_fact_batches_body_version ON fact_batches(body_version_id, status);
CREATE INDEX idx_fact_changes_batch_decision ON fact_changes(batch_id, decision_status, id);
CREATE INDEX idx_facts_project_key_approved ON facts(project_id, normalized_key, approved_at DESC);
CREATE INDEX idx_facts_supersedes ON facts(supersedes_fact_id);
CREATE INDEX idx_fact_sources_chapter_version ON fact_sources(chapter_id, body_version_id, fact_id);
CREATE INDEX idx_fact_source_impacts_fact ON fact_source_impacts(fact_id, created_at DESC);

CREATE TRIGGER fact_batches_scope_insert_guard
BEFORE INSERT ON fact_batches
BEGIN
  SELECT RAISE(ABORT, 'fact batch version scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM chapters
    JOIN body_versions versions ON versions.id = NEW.body_version_id
    WHERE chapters.id = NEW.chapter_id
      AND chapters.project_id = NEW.project_id
      AND versions.chapter_id = NEW.chapter_id
      AND versions.content_hash = NEW.content_hash
  ) OR (NEW.extractor_task_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_runs runs
    WHERE runs.id = NEW.extractor_task_run_id
      AND runs.project_id = NEW.project_id
      AND runs.chapter_id = NEW.chapter_id
      AND runs.base_body_version_id = NEW.body_version_id
      AND runs.content_hash = NEW.content_hash
  ));
END;

CREATE TRIGGER fact_batches_scope_update_guard
BEFORE UPDATE OF project_id, chapter_id, body_version_id, content_hash, extractor_task_run_id, idempotency_key ON fact_batches
BEGIN
  SELECT RAISE(ABORT, 'fact batch provenance is immutable');
END;

CREATE TRIGGER fact_batches_transition_guard
BEFORE UPDATE OF status ON fact_batches
WHEN NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'invalid fact batch transition')
  WHERE NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'))
    OR (OLD.status = 'PARTIALLY_APPROVED' AND NEW.status IN ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'))
  );
END;

CREATE TRIGGER fact_changes_scope_guard
BEFORE INSERT ON fact_changes
WHEN NEW.matched_fact_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'matched fact must belong to the fact batch project')
  WHERE NOT EXISTS (
    SELECT 1 FROM fact_batches batches
    JOIN facts ON facts.id = NEW.matched_fact_id
    WHERE batches.id = NEW.batch_id AND facts.project_id = batches.project_id
  );
END;

CREATE TRIGGER fact_changes_provenance_guard
BEFORE UPDATE OF batch_id, candidate_type, subject_type, subject_id, subject_json, predicate, object_json,
  normalized_key, evidence_json, confidence, importance, change_type, matched_fact_id ON fact_changes
BEGIN
  SELECT RAISE(ABORT, 'fact change provenance is immutable');
END;

CREATE TRIGGER fact_changes_decision_transition_guard
BEFORE UPDATE OF decision_status ON fact_changes
WHEN NEW.decision_status <> OLD.decision_status
BEGIN
  SELECT RAISE(ABORT, 'invalid fact change decision transition')
  WHERE NOT (
    (OLD.decision_status = 'PENDING' AND NEW.decision_status IN ('APPROVED', 'REJECTED', 'DEFERRED'))
    OR (OLD.decision_status = 'DEFERRED' AND NEW.decision_status IN ('APPROVED', 'REJECTED'))
  );
END;

CREATE TRIGGER facts_scope_guard
BEFORE INSERT ON facts
BEGIN
  SELECT RAISE(ABORT, 'approved fact must belong to its reviewed change project')
  WHERE NOT EXISTS (
    SELECT 1 FROM fact_changes changes
    JOIN fact_batches batches ON batches.id = changes.batch_id
    WHERE changes.id = NEW.approved_change_id AND batches.project_id = NEW.project_id
  ) OR (NEW.supersedes_fact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM facts previous WHERE previous.id = NEW.supersedes_fact_id AND previous.project_id = NEW.project_id
  ));
END;

CREATE TRIGGER facts_no_update BEFORE UPDATE ON facts BEGIN
  SELECT RAISE(ABORT, 'facts are append-only');
END;
CREATE TRIGGER facts_no_delete BEFORE DELETE ON facts BEGIN
  SELECT RAISE(ABORT, 'facts are append-only');
END;

CREATE TRIGGER fact_sources_scope_guard
BEFORE INSERT ON fact_sources
BEGIN
  SELECT RAISE(ABORT, 'fact source version scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM facts
    JOIN chapters ON chapters.id = NEW.chapter_id
    JOIN body_versions versions ON versions.id = NEW.body_version_id
    WHERE facts.id = NEW.fact_id
      AND facts.project_id = chapters.project_id
      AND versions.chapter_id = NEW.chapter_id
      AND versions.content_hash = NEW.content_hash
  ) OR EXISTS (
    SELECT 1 FROM facts WHERE facts.primary_source_id = NEW.id AND facts.id <> NEW.fact_id
  );
END;

CREATE TRIGGER fact_sources_no_update BEFORE UPDATE ON fact_sources BEGIN
  SELECT RAISE(ABORT, 'fact sources are append-only');
END;
CREATE TRIGGER fact_sources_no_delete BEFORE DELETE ON fact_sources BEGIN
  SELECT RAISE(ABORT, 'fact sources are append-only');
END;

CREATE TRIGGER fact_decisions_no_update BEFORE UPDATE ON fact_decisions BEGIN
  SELECT RAISE(ABORT, 'fact decisions are append-only');
END;
CREATE TRIGGER fact_decisions_no_delete BEFORE DELETE ON fact_decisions BEGIN
  SELECT RAISE(ABORT, 'fact decisions are append-only');
END;

CREATE TRIGGER fact_source_impacts_scope_guard
BEFORE INSERT ON fact_source_impacts
BEGIN
  SELECT RAISE(ABORT, 'fact source impact scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM fact_sources sources
    JOIN facts ON facts.id = sources.fact_id
    JOIN body_versions old_versions ON old_versions.id = NEW.old_body_version_id
    JOIN body_versions replacement_versions ON replacement_versions.id = NEW.replacement_body_version_id
    WHERE sources.id = NEW.fact_source_id
      AND sources.fact_id = NEW.fact_id
      AND sources.body_version_id = NEW.old_body_version_id
      AND old_versions.chapter_id = sources.chapter_id
      AND replacement_versions.chapter_id = sources.chapter_id
  );
END;

CREATE TRIGGER fact_source_impacts_no_update BEFORE UPDATE ON fact_source_impacts BEGIN
  SELECT RAISE(ABORT, 'fact source impacts are append-only');
END;
CREATE TRIGGER fact_source_impacts_no_delete BEFORE DELETE ON fact_source_impacts BEGIN
  SELECT RAISE(ABORT, 'fact source impacts are append-only');
END;

DROP TRIGGER projects_schema_version_v8_after_insert;
CREATE TRIGGER projects_schema_version_v9_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 9
BEGIN
  UPDATE projects SET current_schema_version = 9 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 9;
`
const consistencyAndMemoryMigrationName = 'formal-rules-findings-summaries-and-model-configuration'
const consistencyAndMemoryMigrationSql = `
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  rule_layer TEXT NOT NULL CHECK(rule_layer IN ('deterministic', 'semantic', 'literary')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, code, version)
);

CREATE TABLE rule_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  rule_id TEXT NULL REFERENCES rules(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NULL CHECK(content_hash IS NULL OR length(content_hash) = 64),
  rule_layer TEXT NOT NULL CHECK(rule_layer IN ('deterministic', 'semantic', 'literary')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale')),
  input_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NULL,
  error_message TEXT NULL,
  started_at TEXT NULL,
  ended_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  rule_run_id TEXT NOT NULL REFERENCES rule_runs(id) ON DELETE RESTRICT,
  rule_id TEXT NULL REFERENCES rules(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NULL CHECK(content_hash IS NULL OR length(content_hash) = 64),
  rule_layer TEXT NOT NULL CHECK(rule_layer IN ('deterministic', 'semantic', 'literary')),
  severity TEXT NOT NULL CHECK(severity IN ('blocker', 'warning', 'suggestion')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  suggested_action TEXT NOT NULL DEFAULT '',
  confidence REAL NULL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status TEXT NOT NULL CHECK(status IN ('open', 'accepted', 'ignored', 'exception', 'stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE finding_decisions (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('accepted', 'ignored', 'exception', 'later')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  name TEXT NOT NULL,
  template_text TEXT NOT NULL,
  template_hash TEXT NOT NULL CHECK(length(template_hash) = 64),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, task_type, name, version)
);

CREATE TABLE summary_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  source_task_run_id TEXT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'approved', 'stale', 'rejected')),
  created_at TEXT NOT NULL,
  UNIQUE(chapter_id, body_version_id, content_hash)
);

CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  token_estimate INTEGER NOT NULL CHECK(token_estimate >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(body_version_id, ordinal)
);

CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  input_token_budget INTEGER NULL CHECK(input_token_budget IS NULL OR input_token_budget > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, provider, model_name)
);

CREATE INDEX idx_rules_project_layer_enabled ON rules(project_id, rule_layer, enabled);
CREATE INDEX idx_rule_runs_project_chapter_created ON rule_runs(project_id, chapter_id, created_at DESC);
CREATE INDEX idx_findings_project_status_created ON findings(project_id, status, created_at DESC);
CREATE INDEX idx_findings_body_version ON findings(body_version_id, content_hash);
CREATE INDEX idx_finding_decisions_finding_created ON finding_decisions(finding_id, created_at DESC);
CREATE INDEX idx_summary_versions_chapter_status ON summary_versions(chapter_id, status, created_at DESC);
CREATE INDEX idx_document_chunks_chapter_version ON document_chunks(chapter_id, body_version_id, ordinal);
CREATE INDEX idx_model_configs_project_enabled ON model_configs(project_id, enabled, is_default);

CREATE TRIGGER findings_rule_run_scope_guard
BEFORE INSERT ON findings
BEGIN
  SELECT RAISE(ABORT, 'finding must match its rule run project and body version')
  WHERE NOT EXISTS (
    SELECT 1 FROM rule_runs runs
    WHERE runs.id = NEW.rule_run_id
      AND runs.project_id = NEW.project_id
      AND (NEW.chapter_id IS NULL OR runs.chapter_id = NEW.chapter_id)
      AND (NEW.body_version_id IS NULL OR runs.body_version_id = NEW.body_version_id)
      AND (NEW.content_hash IS NULL OR runs.content_hash = NEW.content_hash)
  );
END;

CREATE TRIGGER finding_decisions_no_update BEFORE UPDATE ON finding_decisions BEGIN
  SELECT RAISE(ABORT, 'finding decisions are append-only');
END;
CREATE TRIGGER finding_decisions_no_delete BEFORE DELETE ON finding_decisions BEGIN
  SELECT RAISE(ABORT, 'finding decisions are append-only');
END;

DROP TRIGGER projects_schema_version_v9_after_insert;
CREATE TRIGGER projects_schema_version_v10_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 10
BEGIN
  UPDATE projects SET current_schema_version = 10 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 10;
`
const characterAliasMigrationName = 'formal-character-entities-and-aliases'
const characterAliasMigrationSql = `
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK(entity_type = 'character'),
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('candidate', 'approved', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, entity_type, normalized_name)
);

CREATE TABLE character_aliases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  character_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  valid_from_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  valid_to_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(character_id, normalized_alias)
);

CREATE INDEX idx_entities_project_type_name ON entities(project_id, entity_type, normalized_name);
CREATE INDEX idx_character_aliases_project_normalized ON character_aliases(project_id, normalized_alias);

CREATE TRIGGER character_aliases_scope_guard
BEFORE INSERT ON character_aliases
BEGIN
  SELECT RAISE(ABORT, 'character alias scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM entities
    WHERE entities.id = NEW.character_id AND entities.project_id = NEW.project_id AND entities.entity_type = 'character'
  );
END;

DROP TRIGGER projects_schema_version_v10_after_insert;
CREATE TRIGGER projects_schema_version_v11_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 11
BEGIN
  UPDATE projects SET current_schema_version = 11 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 11;
`
const entityRelationMigrationName = 'formal-story-entities-and-relations'
const entityRelationMigrationSql = `
DROP TRIGGER character_aliases_scope_guard;
DROP INDEX idx_character_aliases_project_normalized;
DROP INDEX idx_entities_project_type_name;
ALTER TABLE character_aliases RENAME TO character_aliases_v11;
ALTER TABLE entities RENAME TO entities_v11;

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('character', 'location', 'item', 'organization', 'world_rule')),
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('candidate', 'approved', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, entity_type, normalized_name)
);

INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at)
SELECT id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at FROM entities_v11;

CREATE TABLE character_aliases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  character_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  valid_from_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  valid_to_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(character_id, normalized_alias)
);

INSERT INTO character_aliases (id, project_id, character_id, alias, normalized_alias, valid_from_chapter_id, valid_to_chapter_id, created_at)
SELECT id, project_id, character_id, alias, normalized_alias, valid_from_chapter_id, valid_to_chapter_id, created_at FROM character_aliases_v11;
DROP TABLE character_aliases_v11;
DROP TABLE entities_v11;

CREATE TABLE entity_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  subject_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  predicate TEXT NOT NULL,
  object_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(subject_entity_id <> object_entity_id),
  UNIQUE(project_id, subject_entity_id, predicate, object_entity_id)
);

CREATE INDEX idx_entities_project_type_name ON entities(project_id, entity_type, normalized_name);
CREATE INDEX idx_character_aliases_project_normalized ON character_aliases(project_id, normalized_alias);
CREATE INDEX idx_entity_relations_project_subject ON entity_relations(project_id, subject_entity_id);
CREATE INDEX idx_entity_relations_project_object ON entity_relations(project_id, object_entity_id);

CREATE TRIGGER character_aliases_scope_guard
BEFORE INSERT ON character_aliases
BEGIN
  SELECT RAISE(ABORT, 'character alias scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM entities
    WHERE entities.id = NEW.character_id AND entities.project_id = NEW.project_id AND entities.entity_type = 'character'
  );
END;

CREATE TRIGGER entity_relations_scope_guard
BEFORE INSERT ON entity_relations
BEGIN
  SELECT RAISE(ABORT, 'entity relation scope mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = NEW.subject_entity_id AND project_id = NEW.project_id)
     OR NOT EXISTS (SELECT 1 FROM entities WHERE id = NEW.object_entity_id AND project_id = NEW.project_id);
END;

DROP TRIGGER projects_schema_version_v11_after_insert;
CREATE TRIGGER projects_schema_version_v12_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 12
BEGIN
  UPDATE projects SET current_schema_version = 12 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 12;
`

const characterSnapshotMigrationName = 'rebuildable-approved-fact-character-snapshots'
const characterSnapshotMigrationSql = `
CREATE TABLE character_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  through_chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  through_seq INTEGER NOT NULL CHECK (through_seq >= 1),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  source_fact_set_hash TEXT NOT NULL CHECK (length(source_fact_set_hash) = 64),
  generated_at TEXT NOT NULL,
  UNIQUE(project_id, character_id, through_chapter_id)
);

CREATE INDEX idx_character_snapshots_before ON character_snapshots(project_id, character_id, through_seq DESC);

CREATE TRIGGER character_snapshots_scope_guard
BEFORE INSERT ON character_snapshots
BEGIN
  SELECT RAISE(ABORT, 'character snapshot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM chapters
    WHERE chapters.id = NEW.through_chapter_id
      AND chapters.project_id = NEW.project_id
      AND chapters.seq = NEW.through_seq
  );
END;

DROP TRIGGER projects_schema_version_v12_after_insert;
CREATE TRIGGER projects_schema_version_v13_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 13
BEGIN
  UPDATE projects SET current_schema_version = 13 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 13;
`
const resourceLedgerMigrationName = 'append-only-resource-ledger'
const resourceLedgerMigrationSql = `
CREATE TABLE resource_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  resource_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  event_id TEXT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  resulting_quantity INTEGER NOT NULL,
  fact_id TEXT NULL REFERENCES facts(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  operation_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, operation_key)
);

CREATE INDEX idx_resource_ledger_resource_time ON resource_ledger(project_id, resource_entity_id, created_at, id);
CREATE INDEX idx_resource_ledger_event ON resource_ledger(project_id, event_id) WHERE event_id IS NOT NULL;

CREATE TRIGGER resource_ledger_scope_guard
BEFORE INSERT ON resource_ledger
BEGIN
  SELECT RAISE(ABORT, 'resource ledger scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM entities
    WHERE entities.id = NEW.resource_entity_id
      AND entities.project_id = NEW.project_id
      AND entities.entity_type = 'item'
      AND entities.status = 'approved'
  )
  OR (NEW.fact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM facts WHERE facts.id = NEW.fact_id AND facts.project_id = NEW.project_id
  ));
END;

CREATE TRIGGER resource_ledger_balance_guard
BEFORE INSERT ON resource_ledger
BEGIN
  SELECT RAISE(ABORT, 'resource ledger resulting quantity mismatch')
  WHERE NEW.resulting_quantity <> COALESCE((
    SELECT SUM(delta) FROM resource_ledger
    WHERE project_id = NEW.project_id AND resource_entity_id = NEW.resource_entity_id
  ), 0) + NEW.delta;
END;

CREATE TRIGGER resource_ledger_no_update
BEFORE UPDATE ON resource_ledger
BEGIN
  SELECT RAISE(ABORT, 'resource ledger is append-only');
END;

CREATE TRIGGER resource_ledger_no_delete
BEFORE DELETE ON resource_ledger
BEGIN
  SELECT RAISE(ABORT, 'resource ledger is append-only');
END;

DROP TRIGGER projects_schema_version_v13_after_insert;
CREATE TRIGGER projects_schema_version_v14_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 14
BEGIN
  UPDATE projects SET current_schema_version = 14 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 14;
`
const foreshadowLedgerMigrationName = 'formal-foreshadow-ledger'
const foreshadowLedgerMigrationSql = `
CREATE TABLE foreshadows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'discarded')),
  planted_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  payoff_chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, normalized_title)
);

CREATE TABLE foreshadow_actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  foreshadow_id TEXT NOT NULL REFERENCES foreshadows(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard')),
  description TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'chapter_draft', 'writing_agent')),
  operation_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, operation_key)
);

CREATE INDEX idx_foreshadows_status ON foreshadows(project_id, status, updated_at DESC);
CREATE INDEX idx_foreshadow_actions_history ON foreshadow_actions(project_id, foreshadow_id, created_at, id);

CREATE TRIGGER foreshadows_scope_insert_guard
BEFORE INSERT ON foreshadows
BEGIN
  SELECT RAISE(ABORT, 'foreshadow chapter scope mismatch')
  WHERE (NEW.planted_chapter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chapters WHERE chapters.id = NEW.planted_chapter_id AND chapters.project_id = NEW.project_id
  )) OR (NEW.payoff_chapter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chapters WHERE chapters.id = NEW.payoff_chapter_id AND chapters.project_id = NEW.project_id
  ));
END;

CREATE TRIGGER foreshadows_scope_update_guard
BEFORE UPDATE ON foreshadows
BEGIN
  SELECT RAISE(ABORT, 'foreshadow chapter scope mismatch')
  WHERE NEW.project_id <> OLD.project_id
    OR (NEW.planted_chapter_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chapters WHERE chapters.id = NEW.planted_chapter_id AND chapters.project_id = NEW.project_id
    )) OR (NEW.payoff_chapter_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chapters WHERE chapters.id = NEW.payoff_chapter_id AND chapters.project_id = NEW.project_id
    ));
END;

CREATE TRIGGER foreshadow_actions_scope_guard
BEFORE INSERT ON foreshadow_actions
BEGIN
  SELECT RAISE(ABORT, 'foreshadow action scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM foreshadows WHERE foreshadows.id = NEW.foreshadow_id AND foreshadows.project_id = NEW.project_id
  ) OR (NEW.chapter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chapters WHERE chapters.id = NEW.chapter_id AND chapters.project_id = NEW.project_id
  ));
END;

CREATE TRIGGER foreshadow_actions_no_update
BEFORE UPDATE ON foreshadow_actions
BEGIN
  SELECT RAISE(ABORT, 'foreshadow actions are append-only');
END;

CREATE TRIGGER foreshadow_actions_no_delete
BEFORE DELETE ON foreshadow_actions
BEGIN
  SELECT RAISE(ABORT, 'foreshadow actions are append-only');
END;

DROP TRIGGER projects_schema_version_v14_after_insert;
CREATE TRIGGER projects_schema_version_v15_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 15
BEGIN
  UPDATE projects SET current_schema_version = 15 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 15;
`
const promptAuthorityMigrationName = 'project-prompt-authority-and-readable-mirror'
const promptAuthorityMigrationSql = `
ALTER TABLE projects ADD COLUMN prompt_storage_ready INTEGER NOT NULL DEFAULT 0 CHECK(prompt_storage_ready IN (0, 1));
ALTER TABLE projects ADD COLUMN prompt_work_item_id TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN prompt_genre_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN prompt_updated_at TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_prompt_templates_project_task_enabled
  ON prompt_templates(project_id, task_type, enabled, version DESC);

DROP TRIGGER projects_schema_version_v15_after_insert;
CREATE TRIGGER projects_schema_version_v16_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 16
BEGIN
  UPDATE projects SET current_schema_version = 16 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 16;
`
const namedBodyVersionMigrationName = 'named-body-version-metadata'
const namedBodyVersionMigrationSql = `
ALTER TABLE body_version_metadata ADD COLUMN label TEXT NULL
  CHECK(label IS NULL OR (length(trim(label)) BETWEEN 1 AND 80));

DROP TRIGGER projects_schema_version_v16_after_insert;
CREATE TRIGGER projects_schema_version_v17_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 17
BEGIN
  UPDATE projects SET current_schema_version = 17 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 17;
`
const realTrialMigrationName = 'real-chapter-trial-observations'
const realTrialMigrationSql = `
CREATE TABLE real_trial_chapter_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NOT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  planning_minutes INTEGER NOT NULL CHECK(planning_minutes BETWEEN 0 AND 1440),
  writing_minutes INTEGER NOT NULL CHECK(writing_minutes BETWEEN 0 AND 1440),
  ai_editing_minutes INTEGER NOT NULL CHECK(ai_editing_minutes BETWEEN 0 AND 1440),
  fact_review_minutes INTEGER NOT NULL CHECK(fact_review_minutes BETWEEN 0 AND 1440),
  diff_accepted_blocks INTEGER NOT NULL CHECK(diff_accepted_blocks BETWEEN 0 AND 100000),
  diff_rejected_blocks INTEGER NOT NULL CHECK(diff_rejected_blocks BETWEEN 0 AND 100000),
  misapplied_changes INTEGER NOT NULL CHECK(misapplied_changes BETWEEN 0 AND 100000),
  false_positive_findings INTEGER NOT NULL CHECK(false_positive_findings BETWEEN 0 AND 100000),
  useful_findings INTEGER NOT NULL CHECK(useful_findings BETWEEN 0 AND 100000),
  model_cost REAL NULL CHECK(model_cost IS NULL OR (model_cost >= 0 AND model_cost <= 1000000)),
  satisfaction INTEGER NOT NULL CHECK(satisfaction BETWEEN 1 AND 5),
  continue_next_chapter INTEGER NOT NULL CHECK(continue_next_chapter IN (0, 1)),
  bypassed_features TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  automatic_metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, chapter_id, body_version_id)
);

CREATE INDEX idx_real_trial_project_chapter_updated
  ON real_trial_chapter_records(project_id, chapter_id, updated_at DESC);

CREATE TRIGGER real_trial_chapter_scope_guard
BEFORE INSERT ON real_trial_chapter_records
BEGIN
  SELECT RAISE(ABORT, 'real trial chapter scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM chapters c
    JOIN body_versions b ON b.chapter_id = c.id
    WHERE c.id = NEW.chapter_id AND c.project_id = NEW.project_id AND b.id = NEW.body_version_id AND b.content_hash = NEW.content_hash
  );
END;

CREATE TRIGGER real_trial_chapter_update_scope_guard
BEFORE UPDATE ON real_trial_chapter_records
BEGIN
  SELECT RAISE(ABORT, 'real trial chapter scope mismatch')
  WHERE NEW.project_id <> OLD.project_id OR NEW.chapter_id <> OLD.chapter_id OR NEW.body_version_id <> OLD.body_version_id OR NEW.content_hash <> OLD.content_hash;
END;

DROP TRIGGER projects_schema_version_v17_after_insert;
CREATE TRIGGER projects_schema_version_v18_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 18
BEGIN
  UPDATE projects SET current_schema_version = 18 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 18;
`
const realTrialConclusionMigrationName = 'real-chapter-trial-conclusion'
const realTrialConclusionMigrationSql = `
CREATE TABLE real_trial_conclusions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_count_at_decision INTEGER NOT NULL CHECK(chapter_count_at_decision BETWEEN 20 AND 30),
  decision TEXT NOT NULL CHECK(decision IN ('continue', 'narrow', 'adjust')),
  high_priority_problems TEXT NOT NULL,
  medium_priority_problems TEXT NOT NULL DEFAULT '',
  low_priority_problems TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL,
  next_scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER real_trial_conclusion_scope_guard
BEFORE INSERT ON real_trial_conclusions
BEGIN
  SELECT RAISE(ABORT, 'real trial conclusion scope mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id);
END;

CREATE TRIGGER real_trial_conclusion_update_scope_guard
BEFORE UPDATE ON real_trial_conclusions
BEGIN
  SELECT RAISE(ABORT, 'real trial conclusion scope mismatch')
  WHERE NEW.project_id <> OLD.project_id;
END;

DROP TRIGGER projects_schema_version_v18_after_insert;
CREATE TRIGGER projects_schema_version_v19_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 19
BEGIN
  UPDATE projects SET current_schema_version = 19 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 19;
`
const ideaPromotionMigrationName = 'formal-ideas-and-setting-promotion'
const ideaPromotionMigrationSql = `
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate', 'approved', 'archived')),
  promoted_to_type TEXT NULL CHECK(promoted_to_type IS NULL OR promoted_to_type = 'world_rule'),
  promoted_to_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((promoted_to_type IS NULL) = (promoted_to_id IS NULL))
);

CREATE INDEX idx_ideas_project_status_updated ON ideas(project_id, status, updated_at DESC, id);

CREATE TRIGGER ideas_promotion_scope_insert
BEFORE INSERT ON ideas
WHEN NEW.promoted_to_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'idea promotion scope mismatch')
  WHERE NEW.promoted_to_type <> 'world_rule'
     OR NOT EXISTS (
       SELECT 1 FROM entities
       WHERE entities.id = NEW.promoted_to_id
         AND entities.project_id = NEW.project_id
         AND entities.entity_type = 'world_rule'
         AND entities.status = 'approved'
     );
END;

CREATE TRIGGER ideas_promotion_scope_update
BEFORE UPDATE ON ideas
WHEN NEW.promoted_to_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'idea promotion scope mismatch')
  WHERE NEW.promoted_to_type <> 'world_rule'
     OR NOT EXISTS (
       SELECT 1 FROM entities
       WHERE entities.id = NEW.promoted_to_id
         AND entities.project_id = NEW.project_id
         AND entities.entity_type = 'world_rule'
         AND entities.status = 'approved'
     );
END;

DROP TRIGGER projects_schema_version_v19_after_insert;
CREATE TRIGGER projects_schema_version_v20_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 20
BEGIN
  UPDATE projects SET current_schema_version = 20 WHERE id = NEW.id;
END;

UPDATE projects SET current_schema_version = 20;
`
const ideaSummaryMigrationSql = `
CREATE TABLE ideas_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate', 'approved', 'archived')),
  promoted_to_type TEXT NULL CHECK(promoted_to_type IS NULL OR promoted_to_type IN ('world_rule', 'summary')),
  promoted_to_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((promoted_to_type IS NULL) = (promoted_to_id IS NULL))
);
INSERT INTO ideas_next SELECT * FROM ideas;
DROP TABLE ideas;
ALTER TABLE ideas_next RENAME TO ideas;
CREATE INDEX idx_ideas_project_status_updated ON ideas(project_id, status, updated_at DESC, id);
${['insert', 'update'].map((action) => `
CREATE TRIGGER ideas_promotion_scope_${action}
BEFORE ${action.toUpperCase()} ON ideas
WHEN NEW.promoted_to_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'idea promotion scope mismatch') WHERE NOT (
    (NEW.promoted_to_type = 'world_rule' AND EXISTS (
      SELECT 1 FROM entities WHERE id = NEW.promoted_to_id AND project_id = NEW.project_id
        AND entity_type = 'world_rule' AND status = 'approved'
    )) OR (NEW.promoted_to_type = 'summary' AND EXISTS (
      SELECT 1 FROM outline_nodes WHERE id = NEW.promoted_to_id AND project_id = NEW.project_id
        AND node_type = 'summary' AND legacy_key = 'total'
    ))
  );
END;`).join('\n')}
DROP TRIGGER projects_schema_version_v20_after_insert;
CREATE TRIGGER projects_schema_version_v21_after_insert
AFTER INSERT ON projects
WHEN NEW.current_schema_version <> 21
BEGIN
  UPDATE projects SET current_schema_version = 21 WHERE id = NEW.id;
END;
UPDATE projects SET current_schema_version = 21;
`
const ideaGenerationSourceMigrationSql = `
DROP TRIGGER projects_schema_version_v21_after_insert;
ALTER TABLE ideas ADD COLUMN source_task_run_id TEXT REFERENCES task_runs(id);
ALTER TABLE ideas ADD COLUMN source_option_index INTEGER CHECK (source_option_index BETWEEN 0 AND 2);
CREATE TRIGGER ideas_generation_source_insert BEFORE INSERT ON ideas
WHEN (NEW.source_task_run_id IS NULL) != (NEW.source_option_index IS NULL)
  OR (NEW.source_task_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_runs WHERE id = NEW.source_task_run_id AND project_id = NEW.project_id
      AND task_type = 'idea_generation' AND status = 'succeeded'
  ))
BEGIN SELECT RAISE(ABORT, 'invalid idea generation source'); END;
CREATE TRIGGER ideas_generation_source_immutable BEFORE UPDATE OF source_task_run_id, source_option_index ON ideas
WHEN NEW.source_task_run_id IS NOT OLD.source_task_run_id OR NEW.source_option_index IS NOT OLD.source_option_index
BEGIN SELECT RAISE(ABORT, 'immutable idea generation source'); END;
CREATE TRIGGER projects_schema_version_v22_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 22 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 22;
`
const factLowValueMigrationSql = `
DROP TRIGGER projects_schema_version_v22_after_insert;
ALTER TABLE fact_changes ADD COLUMN review_class TEXT NOT NULL DEFAULT 'reviewable'
  CHECK(review_class IN ('reviewable', 'low_value'));
DROP TRIGGER fact_changes_provenance_guard;
CREATE TRIGGER fact_changes_provenance_guard
BEFORE UPDATE OF batch_id, candidate_type, subject_type, subject_id, subject_json, predicate, object_json,
  normalized_key, evidence_json, confidence, importance, change_type, review_class, matched_fact_id ON fact_changes
BEGIN
  SELECT RAISE(ABORT, 'fact change provenance is immutable');
END;
CREATE TRIGGER projects_schema_version_v23_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 23 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 23;
`
const materialSourcesMigrationSql = `
DROP TRIGGER projects_schema_version_v23_after_insert;
ALTER TABLE projects ADD COLUMN material_sources_ready INTEGER NOT NULL DEFAULT 0
  CHECK(material_sources_ready IN (0, 1));
CREATE TABLE material_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other')),
  external_id TEXT NULL,
  url TEXT NULL,
  normalized_url TEXT NULL,
  title TEXT NOT NULL,
  author TEXT NULL,
  published_at TEXT NULL,
  captured_at TEXT NOT NULL,
  updated_at TEXT NULL,
  excerpt TEXT NOT NULL,
  user_notes TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(references_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  UNIQUE(project_id, content_hash),
  UNIQUE(project_id, normalized_url)
);
CREATE INDEX idx_material_sources_project_captured
  ON material_sources(project_id, captured_at DESC, id);
CREATE TRIGGER projects_schema_version_v24_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 24 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 24;
`
const canonicalEventsMigrationSql = `
DROP TRIGGER projects_schema_version_v24_after_insert;
ALTER TABLE projects ADD COLUMN canonical_events_ready INTEGER NOT NULL DEFAULT 0
  CHECK(canonical_events_ready IN (0, 1));
CREATE TABLE canonical_events (
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
  approved_at TEXT NULL,
  UNIQUE(project_id, event_signature)
);
CREATE INDEX idx_canonical_events_project_created ON canonical_events(project_id, created_at DESC, id);
CREATE INDEX idx_canonical_events_project_slot ON canonical_events(project_id, slot_signature);
CREATE TABLE canonical_event_characters (
  event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  PRIMARY KEY(event_id, ordinal)
);
CREATE INDEX idx_canonical_event_characters_name ON canonical_event_characters(normalized_name, event_id);
CREATE TABLE canonical_event_evidence_refs (
  event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  source_id TEXT NOT NULL REFERENCES material_sources(id) ON DELETE RESTRICT,
  excerpt TEXT NOT NULL,
  PRIMARY KEY(event_id, ordinal)
);
CREATE TRIGGER canonical_event_evidence_scope_guard BEFORE INSERT ON canonical_event_evidence_refs
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_events events
    JOIN material_sources sources ON sources.id = NEW.source_id AND sources.project_id = events.project_id
    WHERE events.id = NEW.event_id
  ) THEN RAISE(ABORT, 'cross-project event evidence') END;
END;
CREATE TRIGGER projects_schema_version_v25_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 25 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 25;
`
const characterStateAuthorityMigrationSql = `
DROP TRIGGER projects_schema_version_v25_after_insert;
ALTER TABLE projects ADD COLUMN character_state_ready INTEGER NOT NULL DEFAULT 0
  CHECK(character_state_ready IN (0, 1));
CREATE TABLE character_state_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  updated_at TEXT NOT NULL
);
CREATE TRIGGER character_state_documents_scope_guard BEFORE INSERT ON character_state_documents
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM projects projects
    WHERE projects.id = NEW.project_id AND projects.storage_mode = 'sqlite'
  ) THEN RAISE(ABORT, 'character state requires an active sqlite project') END;
END;
CREATE TRIGGER projects_schema_version_v26_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 26 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 26;
`
const factReviewBatchSemanticAliasMigrationSql = `
DROP TRIGGER projects_schema_version_v26_after_insert;
CREATE VIEW fact_review_batches AS SELECT * FROM fact_batches;
CREATE TRIGGER projects_schema_version_v27_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 27 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 27;
`
const outlinePlanningStateAuthorityMigrationSql = `
DROP TRIGGER projects_schema_version_v27_after_insert;
CREATE TRIGGER projects_schema_version_v27_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 28 WHERE id = NEW.id; END;
ALTER TABLE projects ADD COLUMN outline_planning_state_ready INTEGER NOT NULL DEFAULT 0
  CHECK(outline_planning_state_ready IN (0, 1));
CREATE TABLE outline_planning_state_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  updated_at TEXT NOT NULL
);
CREATE TRIGGER outline_planning_state_documents_scope_guard BEFORE INSERT ON outline_planning_state_documents
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM projects projects
    WHERE projects.id = NEW.project_id AND projects.storage_mode = 'sqlite'
  ) THEN RAISE(ABORT, 'outline planning state requires an active sqlite project') END;
END;
CREATE TRIGGER projects_schema_version_v28_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 28 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 28;
`
const aiSettingsAuthorityMigrationSql = `
DROP TRIGGER projects_schema_version_v27_after_insert;
DROP TRIGGER projects_schema_version_v28_after_insert;
ALTER TABLE projects ADD COLUMN ai_settings_ready INTEGER NOT NULL DEFAULT 0
  CHECK(ai_settings_ready IN (0, 1));
CREATE TABLE ai_settings_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  updated_at TEXT NOT NULL
);
CREATE TRIGGER ai_settings_documents_scope_guard BEFORE INSERT ON ai_settings_documents
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM projects projects
    WHERE projects.id = NEW.project_id AND projects.storage_mode = 'sqlite'
  ) THEN RAISE(ABORT, 'AI settings require an active sqlite project') END;
END;
CREATE TRIGGER projects_schema_version_v29_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 29 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 29;
`
const workspaceConfigAuthorityMigrationSql = `
DROP TRIGGER projects_schema_version_v29_after_insert;
CREATE TABLE workspace_config_documents (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('timeline', 'realms', 'power_system', 'cheat_system', 'system_ui')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, kind)
);
CREATE TRIGGER workspace_config_documents_scope_guard BEFORE INSERT ON workspace_config_documents
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM projects projects
    WHERE projects.id = NEW.project_id AND projects.storage_mode = 'sqlite'
  ) THEN RAISE(ABORT, 'workspace config requires an active sqlite project') END;
END;
CREATE TRIGGER projects_schema_version_v30_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 30 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 30;
`
const writingAgentApplicationMigrationSql = `
DROP TRIGGER projects_schema_version_v30_after_insert;
CREATE UNIQUE INDEX body_versions_unique_ai_task_application
ON body_versions(source_task_run_id)
WHERE source_task_run_id IS NOT NULL;
CREATE TRIGGER projects_schema_version_v31_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 31 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 31;
`
const temporalCharacterSnapshotsMigrationSql = `
DROP TRIGGER projects_schema_version_v31_after_insert;
DELETE FROM character_snapshots;
CREATE TRIGGER projects_schema_version_v32_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 32 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 32;
`
const bodyVersionArtifactProvenanceMigrationSql = `
DROP TRIGGER body_versions_ai_task_reference_guard;
DROP TRIGGER body_versions_no_update;
DROP TRIGGER projects_schema_version_v32_after_insert;

ALTER TABLE body_versions ADD COLUMN generation_artifact_id TEXT NULL
  REFERENCES generation_artifacts(id) ON DELETE RESTRICT;

UPDATE body_versions
SET generation_artifact_id = (
  SELECT artifacts.id
  FROM generation_artifacts artifacts
  JOIN task_runs runs ON runs.id = artifacts.task_run_id
  JOIN chapters target_chapters ON target_chapters.id = body_versions.chapter_id
  JOIN body_versions base_versions ON base_versions.id = runs.base_body_version_id
  WHERE runs.id = body_versions.source_task_run_id
    AND runs.chapter_id = body_versions.chapter_id
    AND runs.project_id = target_chapters.project_id
    AND runs.task_type = 'writing_agent'
    AND base_versions.chapter_id = body_versions.chapter_id
    AND (runs.content_hash IS NULL OR runs.content_hash = base_versions.content_hash)
    AND artifacts.status = 'applied'
    AND artifacts.base_body_version_id IS runs.base_body_version_id
    AND json_valid(runs.checkpoint_json)
    AND json_extract(runs.checkpoint_json, '$.workItemId') = runs.project_id
    AND json_extract(runs.checkpoint_json, '$.request.chapterId') = target_chapters.legacy_chapter_id
    AND (
      (json_type(runs.checkpoint_json, '$.request.selection') IS NULL
        AND json_type(runs.checkpoint_json, '$.request.insertionAnchor') IS NULL
        AND artifacts.selection_anchor_json IS NULL)
      OR
      (artifacts.selection_anchor_json IS NOT NULL AND json_valid(artifacts.selection_anchor_json)
        AND json_extract(artifacts.selection_anchor_json, '$.version') = 1
        AND json_extract(artifacts.selection_anchor_json, '$.selection') IS json_extract(runs.checkpoint_json, '$.request.selection')
        AND json_extract(artifacts.selection_anchor_json, '$.insertionAnchor') IS json_extract(runs.checkpoint_json, '$.request.insertionAnchor'))
    )
    AND (
      (runs.status = 'succeeded' AND artifacts.artifact_type = 'writing_agent_turn')
      OR
      (runs.status IN ('cancelled', 'failed', 'interrupted') AND artifacts.artifact_type = 'writing_agent_stream')
    )
)
WHERE body_versions.source_type = 'ai'
  AND body_versions.source_task_run_id IS NOT NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM generation_artifacts artifacts
    JOIN task_runs runs ON runs.id = artifacts.task_run_id
    JOIN chapters target_chapters ON target_chapters.id = body_versions.chapter_id
    JOIN body_versions base_versions ON base_versions.id = runs.base_body_version_id
    WHERE runs.id = body_versions.source_task_run_id
      AND runs.chapter_id = body_versions.chapter_id
      AND runs.project_id = target_chapters.project_id
      AND runs.task_type = 'writing_agent'
      AND base_versions.chapter_id = body_versions.chapter_id
      AND (runs.content_hash IS NULL OR runs.content_hash = base_versions.content_hash)
      AND artifacts.status = 'applied'
      AND artifacts.base_body_version_id IS runs.base_body_version_id
      AND json_valid(runs.checkpoint_json)
      AND json_extract(runs.checkpoint_json, '$.workItemId') = runs.project_id
      AND json_extract(runs.checkpoint_json, '$.request.chapterId') = target_chapters.legacy_chapter_id
      AND (
        (json_type(runs.checkpoint_json, '$.request.selection') IS NULL
          AND json_type(runs.checkpoint_json, '$.request.insertionAnchor') IS NULL
          AND artifacts.selection_anchor_json IS NULL)
        OR
        (artifacts.selection_anchor_json IS NOT NULL AND json_valid(artifacts.selection_anchor_json)
          AND json_extract(artifacts.selection_anchor_json, '$.version') = 1
          AND json_extract(artifacts.selection_anchor_json, '$.selection') IS json_extract(runs.checkpoint_json, '$.request.selection')
          AND json_extract(artifacts.selection_anchor_json, '$.insertionAnchor') IS json_extract(runs.checkpoint_json, '$.request.insertionAnchor'))
      )
      AND (
        (runs.status = 'succeeded' AND artifacts.artifact_type = 'writing_agent_turn')
        OR
        (runs.status IN ('cancelled', 'failed', 'interrupted') AND artifacts.artifact_type = 'writing_agent_stream')
      )
  );

CREATE TRIGGER body_versions_no_update
BEFORE UPDATE ON body_versions
BEGIN
  SELECT RAISE(ABORT, 'body_versions are append-only');
END;

CREATE UNIQUE INDEX body_versions_unique_ai_artifact_application
ON body_versions(generation_artifact_id)
WHERE generation_artifact_id IS NOT NULL;

CREATE TRIGGER body_versions_ai_task_reference_guard
BEFORE INSERT ON body_versions
BEGIN
  SELECT RAISE(ABORT, 'AI body version requires an exact task and Artifact pair')
  WHERE
    (NEW.source_type = 'ai' AND (NEW.source_task_run_id IS NULL OR NEW.generation_artifact_id IS NULL))
    OR
    (NEW.source_type <> 'ai' AND (NEW.source_task_run_id IS NOT NULL OR NEW.generation_artifact_id IS NOT NULL));

  SELECT RAISE(ABORT, 'AI body version provenance does not match task, project, chapter, base, anchor, or revision')
  WHERE NEW.source_type = 'ai' AND NOT EXISTS (
    SELECT 1
    FROM generation_artifacts artifacts
    JOIN task_runs runs ON runs.id = artifacts.task_run_id
    JOIN chapters target_chapters ON target_chapters.id = NEW.chapter_id
    JOIN body_versions base_versions ON base_versions.id = runs.base_body_version_id
    WHERE artifacts.id = NEW.generation_artifact_id
      AND artifacts.task_run_id = NEW.source_task_run_id
      AND runs.task_type = 'writing_agent'
      AND runs.project_id = target_chapters.project_id
      AND runs.chapter_id = NEW.chapter_id
      AND runs.base_body_version_id IS NOT NULL
      AND base_versions.chapter_id = NEW.chapter_id
      AND (runs.content_hash IS NULL OR runs.content_hash = base_versions.content_hash)
      AND artifacts.base_body_version_id IS runs.base_body_version_id
      AND artifacts.status = 'applied'
      AND NEW.parent_id IS target_chapters.current_body_version_id
      AND json_valid(runs.checkpoint_json)
      AND json_extract(runs.checkpoint_json, '$.workItemId') = runs.project_id
      AND json_extract(runs.checkpoint_json, '$.request.chapterId') = target_chapters.legacy_chapter_id
      AND (
        (
          json_type(runs.checkpoint_json, '$.request.selection') IS NULL
          AND json_type(runs.checkpoint_json, '$.request.insertionAnchor') IS NULL
          AND artifacts.selection_anchor_json IS NULL
        )
        OR
        (
          artifacts.selection_anchor_json IS NOT NULL
          AND json_valid(artifacts.selection_anchor_json)
          AND json_extract(artifacts.selection_anchor_json, '$.version') = 1
          AND json_extract(artifacts.selection_anchor_json, '$.selection') IS json_extract(runs.checkpoint_json, '$.request.selection')
          AND json_extract(artifacts.selection_anchor_json, '$.insertionAnchor') IS json_extract(runs.checkpoint_json, '$.request.insertionAnchor')
        )
      )
      AND (
        (runs.status = 'succeeded' AND artifacts.artifact_type = 'writing_agent_turn')
        OR
        (runs.status IN ('cancelled', 'failed', 'interrupted') AND artifacts.artifact_type = 'writing_agent_stream')
      )
  );
END;

CREATE TRIGGER projects_schema_version_v33_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 33 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 33;
`
const taskTemplateContractMigrationSql = `
ALTER TABLE task_runs ADD COLUMN template_id TEXT NULL;
ALTER TABLE task_runs ADD COLUMN template_version INTEGER NULL;
ALTER TABLE task_runs ADD COLUMN template_hash TEXT NULL;
ALTER TABLE task_runs ADD COLUMN input_schema_json TEXT NULL;
ALTER TABLE task_runs ADD COLUMN output_schema_json TEXT NULL;
ALTER TABLE task_runs ADD COLUMN allowed_operations_json TEXT NULL;
ALTER TABLE task_runs ADD COLUMN forbidden_operations_json TEXT NULL;
ALTER TABLE task_runs ADD COLUMN task_contract_hash TEXT NULL;

-- Historical rows cannot prove which executable contract was active. Preserve
-- them as immutable, non-executable legacy records instead of guessing.
UPDATE task_runs SET
  template_id = 'legacy:' || task_type,
  template_version = 0,
  template_hash = lower(hex(zeroblob(32))),
  input_schema_json = '{}',
  output_schema_json = '{}',
  allowed_operations_json = '[]',
  forbidden_operations_json = '["*"]',
  task_contract_hash = lower(hex(zeroblob(32)))
WHERE template_id IS NULL;

ALTER TABLE prompt_templates ADD COLUMN system_template TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_templates ADD COLUMN input_schema_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE prompt_templates ADD COLUMN output_schema_json TEXT NOT NULL DEFAULT '{}';
UPDATE prompt_templates SET system_template = template_text WHERE system_template = '';

CREATE TRIGGER task_runs_contract_insert_guard
BEFORE INSERT ON task_runs
BEGIN
  SELECT RAISE(ABORT, 'new AI task requires a complete immutable task contract')
  WHERE NEW.template_id IS NULL OR NEW.template_id = ''
    OR NEW.template_version IS NULL OR NEW.template_version <= 0
    OR NEW.template_hash IS NULL OR length(NEW.template_hash) <> 64
    OR NEW.input_schema_json IS NULL OR json_valid(NEW.input_schema_json) = 0
    OR NEW.output_schema_json IS NULL OR json_valid(NEW.output_schema_json) = 0
    OR NEW.allowed_operations_json IS NULL OR json_valid(NEW.allowed_operations_json) = 0
    OR json_type(NEW.allowed_operations_json) <> 'array'
    OR NEW.forbidden_operations_json IS NULL OR json_valid(NEW.forbidden_operations_json) = 0
    OR json_type(NEW.forbidden_operations_json) <> 'array'
    OR NEW.task_contract_hash IS NULL OR length(NEW.task_contract_hash) <> 64;
END;

CREATE TRIGGER task_runs_contract_immutable
BEFORE UPDATE OF template_id, template_version, template_hash, input_schema_json, output_schema_json,
  allowed_operations_json, forbidden_operations_json, task_contract_hash ON task_runs
BEGIN
  SELECT RAISE(ABORT, 'task contract snapshot is immutable');
END;

CREATE TRIGGER task_runs_retry_contract_guard
BEFORE INSERT ON task_runs
WHEN NEW.parent_task_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'retry task must inherit the exact parent task contract')
  WHERE NOT EXISTS (
    SELECT 1 FROM task_runs parent
    WHERE parent.id = NEW.parent_task_run_id
      AND parent.project_id = NEW.project_id
      AND parent.template_version > 0
      AND parent.task_type = NEW.task_type
      AND parent.template_id = NEW.template_id
      AND parent.template_version = NEW.template_version
      AND parent.template_hash = NEW.template_hash
      AND parent.input_schema_json = NEW.input_schema_json
      AND parent.output_schema_json = NEW.output_schema_json
      AND parent.allowed_operations_json = NEW.allowed_operations_json
      AND parent.forbidden_operations_json = NEW.forbidden_operations_json
      AND parent.task_contract_hash = NEW.task_contract_hash
  );
END;

CREATE TRIGGER prompt_templates_contract_immutable
BEFORE UPDATE OF task_type, name, template_text, template_hash, version, system_template,
  input_schema_json, output_schema_json ON prompt_templates
BEGIN
  SELECT RAISE(ABORT, 'prompt template versions are immutable');
END;

DROP TRIGGER projects_schema_version_v33_after_insert;
CREATE TRIGGER projects_schema_version_v34_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 34 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 34;
`
const findingResolutionMigrationSql = `
-- Both old CHECK-constrained tables are rebuilt in one foreign-key-enabled
-- transaction. Copy first, remove the old child before the old parent, then
-- rename; historical IDs, evidence and decisions are retained verbatim.
CREATE TABLE findings_v35 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  rule_run_id TEXT NOT NULL REFERENCES rule_runs(id) ON DELETE RESTRICT,
  rule_id TEXT NULL REFERENCES rules(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NULL CHECK(content_hash IS NULL OR length(content_hash) = 64),
  rule_layer TEXT NOT NULL CHECK(rule_layer IN ('deterministic', 'semantic', 'literary')),
  severity TEXT NOT NULL CHECK(severity IN ('blocker', 'warning', 'suggestion')),
  code TEXT NOT NULL, title TEXT NOT NULL, rationale TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  suggested_action TEXT NOT NULL DEFAULT '',
  confidence REAL NULL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status TEXT NOT NULL CHECK(status IN ('open', 'accepted', 'ignored', 'exception', 'stale', 'fixed')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  resulting_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  CHECK(status <> 'fixed' OR resulting_body_version_id IS NOT NULL)
);
INSERT INTO findings_v35 SELECT findings.*, NULL FROM findings;
CREATE TABLE finding_decisions_v35 (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings_v35(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('accepted', 'ignored', 'exception', 'later', 'fixed')),
  reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  resulting_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  CHECK((decision = 'fixed' AND resulting_body_version_id IS NOT NULL)
    OR (decision <> 'fixed' AND resulting_body_version_id IS NULL))
);
INSERT INTO finding_decisions_v35 SELECT finding_decisions.*, NULL FROM finding_decisions ORDER BY rowid;
DROP TABLE finding_decisions;
DROP TABLE findings;
ALTER TABLE findings_v35 RENAME TO findings;
ALTER TABLE finding_decisions_v35 RENAME TO finding_decisions;
CREATE INDEX idx_findings_project_status_created ON findings(project_id, status, created_at DESC);
CREATE INDEX idx_findings_body_version ON findings(body_version_id, content_hash);
CREATE INDEX idx_findings_resulting_body_version ON findings(resulting_body_version_id) WHERE resulting_body_version_id IS NOT NULL;
CREATE INDEX idx_finding_decisions_finding_created ON finding_decisions(finding_id, created_at DESC);
CREATE TRIGGER findings_rule_run_scope_guard BEFORE INSERT ON findings
BEGIN
  SELECT RAISE(ABORT, 'finding must match its rule run project and body version')
  WHERE NOT EXISTS (
    SELECT 1 FROM rule_runs runs WHERE runs.id = NEW.rule_run_id AND runs.project_id = NEW.project_id
      AND (NEW.chapter_id IS NULL OR runs.chapter_id = NEW.chapter_id)
      AND (NEW.body_version_id IS NULL OR runs.body_version_id = NEW.body_version_id)
      AND (NEW.content_hash IS NULL OR runs.content_hash = NEW.content_hash)
  );
  SELECT RAISE(ABORT, 'new findings cannot arrive already repaired')
  WHERE NEW.status = 'fixed' OR NEW.resulting_body_version_id IS NOT NULL;
END;
CREATE TRIGGER findings_evidence_immutable
BEFORE UPDATE OF id, project_id, rule_run_id, rule_id, chapter_id, body_version_id,
  content_hash, rule_layer, severity, code, title, rationale, evidence_json,
  suggested_action, confidence, created_at ON findings
BEGIN SELECT RAISE(ABORT, 'finding source evidence is immutable'); END;
CREATE TRIGGER finding_decisions_no_update BEFORE UPDATE ON finding_decisions
BEGIN SELECT RAISE(ABORT, 'finding decisions are append-only'); END;
CREATE TRIGGER finding_decisions_no_delete BEFORE DELETE ON finding_decisions
BEGIN SELECT RAISE(ABORT, 'finding decisions are append-only'); END;
CREATE TRIGGER finding_decisions_resolution_scope_guard BEFORE INSERT ON finding_decisions
WHEN NEW.decision = 'fixed'
BEGIN
  SELECT RAISE(ABORT, 'repair decision requires a newer current version in the finding chapter')
  WHERE NOT EXISTS (
    SELECT 1 FROM findings f JOIN chapters c ON c.id = f.chapter_id
    JOIN projects p ON p.id = f.project_id
    JOIN body_versions source ON source.id = f.body_version_id AND source.chapter_id = c.id
    JOIN body_versions target ON target.id = NEW.resulting_body_version_id AND target.chapter_id = c.id
    WHERE f.id = NEW.finding_id AND c.project_id = f.project_id
      AND p.storage_mode = 'sqlite' AND c.status <> 'archived'
      AND c.current_body_version_id = target.id AND target.version_no > source.version_no
      AND f.status IN ('open', 'accepted', 'stale')
  );
END;
CREATE TRIGGER findings_resolution_status_guard BEFORE UPDATE OF status, resulting_body_version_id ON findings
BEGIN
  SELECT RAISE(ABORT, 'repair target can only be attached by an explicit fixed decision')
  WHERE NEW.resulting_body_version_id IS NOT OLD.resulting_body_version_id
    AND NEW.resulting_body_version_id IS NOT NULL AND NEW.status <> 'fixed';
  SELECT RAISE(ABORT, 'fixed status requires the latest explicit decision and its current repair target')
  WHERE NEW.status = 'fixed' AND NOT EXISTS (
    SELECT 1 FROM finding_decisions d JOIN chapters c ON c.id = NEW.chapter_id
    JOIN body_versions b ON b.id = NEW.resulting_body_version_id AND b.chapter_id = c.id
    WHERE d.rowid = (SELECT max(rowid) FROM finding_decisions WHERE finding_id = NEW.id)
      AND d.finding_id = NEW.id AND d.decision = 'fixed'
      AND d.resulting_body_version_id = NEW.resulting_body_version_id
      AND c.project_id = NEW.project_id AND c.current_body_version_id = b.id AND c.status <> 'archived'
  );
END;
CREATE TRIGGER chapters_fixed_findings_invalidation AFTER UPDATE OF current_body_version_id ON chapters
WHEN OLD.current_body_version_id IS NOT NEW.current_body_version_id
BEGIN
  UPDATE findings SET status = 'stale',
    updated_at = CASE WHEN updated_at >= NEW.updated_at
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE NEW.updated_at END
  WHERE chapter_id = NEW.id AND status = 'fixed' AND resulting_body_version_id IS NOT NEW.current_body_version_id;
END;
DROP TRIGGER projects_schema_version_v34_after_insert;
CREATE TRIGGER projects_schema_version_v35_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 35 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 35;
`
// Used only against task_runs (or the task-center CTE with the same columns).
// CASE protects historical malformed JSON; a bare phase is not proof of pause.
const legacyTaskPauseSql = `CASE WHEN task_type = 'writing_agent' AND status = 'cancelled' AND json_valid(checkpoint_json) THEN
  COALESCE(json_extract(checkpoint_json, '$.version') = 1
    AND json_extract(checkpoint_json, '$.phase') = 'paused'
    AND json_extract(checkpoint_json, '$.workItemId') = (SELECT prompt_work_item_id FROM projects WHERE projects.id = project_id)
    AND json_type(checkpoint_json, '$.request.chapterId') = 'integer'
    AND json_extract(checkpoint_json, '$.request.chapterId') = (SELECT legacy_chapter_id FROM chapters WHERE chapters.id = chapter_id)
    AND json_type(checkpoint_json, '$.request.message') = 'text'
    AND json_type(checkpoint_json, '$.request.currentDraft') = 'text', 0)
  ELSE 0 END`

const nativeTaskPauseMigrationSql = `
CREATE TABLE task_runs_v36 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chapter_id TEXT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'resuming', 'preparing', 'running', 'streaming', 'paused', 'succeeded', 'cancelled', 'failed', 'interrupted')),
  idempotency_key TEXT NOT NULL,
  parent_task_run_id TEXT NULL REFERENCES task_runs(id) ON DELETE RESTRICT,
  base_body_version_id TEXT NULL REFERENCES body_versions(id) ON DELETE RESTRICT,
  content_hash TEXT NULL CHECK(content_hash IS NULL OR length(content_hash) = 64),
  context_package_id TEXT NULL,
  model_config_id TEXT NULL,
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  checkpoint_json TEXT NOT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  started_at TEXT NULL,
  ended_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  template_id TEXT NULL,
  template_version INTEGER NULL,
  template_hash TEXT NULL,
  input_schema_json TEXT NULL,
  output_schema_json TEXT NULL,
  allowed_operations_json TEXT NULL,
  forbidden_operations_json TEXT NULL,
  task_contract_hash TEXT NULL,
  UNIQUE(project_id, idempotency_key)
);
-- No historical row is relabelled. Even legacy cancelled+pause records retain
-- their original timestamps, checkpoint and contract evidence byte for byte.
INSERT INTO task_runs_v36 SELECT * FROM task_runs;
DROP TABLE task_runs;
ALTER TABLE task_runs_v36 RENAME TO task_runs;
`
const nativeTaskPauseGuardsSql = `
CREATE TRIGGER task_runs_writing_active_insert_guard
BEFORE INSERT ON task_runs
WHEN NEW.task_type = 'writing_agent' AND NEW.status IN ('queued', 'resuming', 'preparing', 'running', 'streaming')
BEGIN
  SELECT RAISE(ABORT, 'chapter already has an active writing task')
  WHERE EXISTS (SELECT 1 FROM task_runs active
    WHERE active.project_id = NEW.project_id AND active.chapter_id IS NEW.chapter_id
      AND active.task_type = 'writing_agent'
      AND active.status IN ('queued', 'resuming', 'preparing', 'running', 'streaming'));
END;
CREATE TRIGGER task_runs_resuming_insert_guard
BEFORE INSERT ON task_runs WHEN NEW.status = 'resuming'
BEGIN
  SELECT RAISE(ABORT, 'resuming requires an uncontinued same-chapter paused or interrupted parent')
  WHERE NOT EXISTS (
    SELECT 1 FROM task_runs parent
    WHERE parent.id = NEW.parent_task_run_id AND parent.project_id = NEW.project_id
      AND parent.chapter_id IS NEW.chapter_id
      AND (parent.status IN ('paused', 'interrupted') OR (${legacyTaskPauseSql}))
      AND NOT EXISTS (SELECT 1 FROM task_runs children
        WHERE children.project_id = NEW.project_id AND children.parent_task_run_id = parent.id)
  );
END;
CREATE TRIGGER task_runs_native_pause_transition_guard
BEFORE UPDATE OF status ON task_runs
WHEN (OLD.status = 'paused' AND NEW.status NOT IN ('paused', 'cancelled'))
  OR (NEW.status = 'resuming' AND OLD.status <> 'resuming')
  OR (NEW.status = 'paused' AND OLD.status NOT IN ('queued', 'resuming', 'preparing', 'running', 'streaming', 'paused'))
BEGIN SELECT RAISE(ABORT, 'paused parent cannot reopen; continuation requires a new run'); END;
DROP TRIGGER body_versions_ai_task_reference_guard;
${bodyVersionArtifactProvenanceMigrationSql.slice(bodyVersionArtifactProvenanceMigrationSql.lastIndexOf('CREATE TRIGGER body_versions_ai_task_reference_guard'), bodyVersionArtifactProvenanceMigrationSql.indexOf('CREATE TRIGGER projects_schema_version_v33_after_insert'))
  .replace("runs.status IN ('cancelled', 'failed', 'interrupted')", "runs.status IN ('paused', 'cancelled', 'failed', 'interrupted')")
  .replace("json_extract(runs.checkpoint_json, '$.workItemId') = runs.project_id", "json_extract(runs.checkpoint_json, '$.workItemId') = (SELECT prompt_work_item_id FROM projects WHERE id = runs.project_id)")}
DROP TRIGGER projects_schema_version_v35_after_insert;
CREATE TRIGGER projects_schema_version_v36_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 36 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 36;
`
const worldMapConfigMigrationSql = `
CREATE TABLE workspace_config_documents_v37 (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('timeline', 'realms', 'power_system', 'cheat_system', 'system_ui', 'world_map')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, kind)
);
INSERT INTO workspace_config_documents_v37 SELECT * FROM workspace_config_documents;
DROP TABLE workspace_config_documents;
ALTER TABLE workspace_config_documents_v37 RENAME TO workspace_config_documents;
`
const worldMapConfigGuardsSql = `
DROP TRIGGER projects_schema_version_v36_after_insert;
CREATE TRIGGER projects_schema_version_v37_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 37 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 37;
`
const migrations = [
  { version: 1, name: initialMigrationName, sql: initialMigrationSql, checksum: hashText(initialMigrationSql) },
  { version: 2, name: formalManuscriptMigrationName, sql: formalManuscriptMigrationSql, checksum: hashText(formalManuscriptMigrationSql) },
  { version: 3, name: aiTaskArtifactMigrationName, sql: aiTaskArtifactMigrationSql, checksum: hashText(aiTaskArtifactMigrationSql) },
  { version: 4, name: contextPackageMigrationName, sql: contextPackageMigrationSql, checksum: hashText(contextPackageMigrationSql) },
  { version: 5, name: partialArtifactProvenanceMigrationName, sql: partialArtifactProvenanceMigrationSql, checksum: hashText(partialArtifactProvenanceMigrationSql) },
  { version: 6, name: outlineAuthorityMigrationName, sql: outlineAuthorityMigrationSql, checksum: hashText(outlineAuthorityMigrationSql) },
  { version: 7, name: writingConfigurationMigrationName, sql: writingConfigurationMigrationSql, checksum: hashText(writingConfigurationMigrationSql) },
  { version: 8, name: autosaveCheckpointMigrationName, sql: autosaveCheckpointMigrationSql, checksum: hashText(autosaveCheckpointMigrationSql) },
  { version: 9, name: factApprovalMigrationName, sql: factApprovalMigrationSql, checksum: hashText(factApprovalMigrationSql) },
  { version: 10, name: consistencyAndMemoryMigrationName, sql: consistencyAndMemoryMigrationSql, checksum: hashText(consistencyAndMemoryMigrationSql) },
  { version: 11, name: characterAliasMigrationName, sql: characterAliasMigrationSql, checksum: hashText(characterAliasMigrationSql) },
  { version: 12, name: entityRelationMigrationName, sql: entityRelationMigrationSql, checksum: hashText(entityRelationMigrationSql) },
  { version: 13, name: characterSnapshotMigrationName, sql: characterSnapshotMigrationSql, checksum: hashText(characterSnapshotMigrationSql) },
  { version: 14, name: resourceLedgerMigrationName, sql: resourceLedgerMigrationSql, checksum: hashText(resourceLedgerMigrationSql) },
  { version: 15, name: foreshadowLedgerMigrationName, sql: foreshadowLedgerMigrationSql, checksum: hashText(foreshadowLedgerMigrationSql) },
  { version: 16, name: promptAuthorityMigrationName, sql: promptAuthorityMigrationSql, checksum: hashText(promptAuthorityMigrationSql) },
  { version: 17, name: namedBodyVersionMigrationName, sql: namedBodyVersionMigrationSql, checksum: hashText(namedBodyVersionMigrationSql) },
  { version: 18, name: realTrialMigrationName, sql: realTrialMigrationSql, checksum: hashText(realTrialMigrationSql) },
  { version: 19, name: realTrialConclusionMigrationName, sql: realTrialConclusionMigrationSql, checksum: hashText(realTrialConclusionMigrationSql) },
  { version: 20, name: ideaPromotionMigrationName, sql: ideaPromotionMigrationSql, checksum: hashText(ideaPromotionMigrationSql) },
  { version: 21, name: 'idea-summary-promotion', sql: ideaSummaryMigrationSql, checksum: hashText(ideaSummaryMigrationSql) },
  { version: 22, name: 'idea-generation-source', sql: ideaGenerationSourceMigrationSql, checksum: hashText(ideaGenerationSourceMigrationSql) },
  { version: 23, name: 'fact-low-value-review-class', sql: factLowValueMigrationSql, checksum: hashText(factLowValueMigrationSql) },
  { version: 24, name: 'material-sources-authority', sql: materialSourcesMigrationSql, checksum: hashText(materialSourcesMigrationSql) },
  { version: 25, name: 'canonical-events-authority', sql: canonicalEventsMigrationSql, checksum: hashText(canonicalEventsMigrationSql) },
  { version: 26, name: 'character-state-authority', sql: characterStateAuthorityMigrationSql, checksum: hashText(characterStateAuthorityMigrationSql) },
  { version: 27, name: 'fact-review-batch-semantic-alias', sql: factReviewBatchSemanticAliasMigrationSql, checksum: hashText(factReviewBatchSemanticAliasMigrationSql) },
  { version: 28, name: 'outline-planning-state-authority', sql: outlinePlanningStateAuthorityMigrationSql, checksum: hashText(outlinePlanningStateAuthorityMigrationSql) },
  { version: 29, name: 'ai-settings-authority', sql: aiSettingsAuthorityMigrationSql, checksum: hashText(aiSettingsAuthorityMigrationSql) },
  { version: 30, name: 'workspace-config-authority', sql: workspaceConfigAuthorityMigrationSql, checksum: hashText(workspaceConfigAuthorityMigrationSql) },
  { version: 31, name: 'atomic-writing-agent-application', sql: writingAgentApplicationMigrationSql, checksum: hashText(writingAgentApplicationMigrationSql) },
  { version: 32, name: 'chapter-scoped-character-snapshots', sql: temporalCharacterSnapshotsMigrationSql, checksum: hashText(temporalCharacterSnapshotsMigrationSql) },
  { version: 33, name: 'exact-body-version-artifact-provenance', sql: bodyVersionArtifactProvenanceMigrationSql, checksum: hashText(bodyVersionArtifactProvenanceMigrationSql) },
  { version: 34, name: 'immutable-task-template-contracts', sql: taskTemplateContractMigrationSql, checksum: hashText(taskTemplateContractMigrationSql) },
  { version: 35, name: 'version-bound-explicit-finding-resolution', sql: findingResolutionMigrationSql, checksum: hashText(findingResolutionMigrationSql) },
  { version: 36, name: 'native-paused-and-resuming-task-runs', sql: nativeTaskPauseMigrationSql + nativeTaskPauseGuardsSql, checksum: hashText(nativeTaskPauseMigrationSql + nativeTaskPauseGuardsSql) },
  { version: 37, name: 'world-map-workspace-config', sql: worldMapConfigMigrationSql + worldMapConfigGuardsSql, checksum: hashText(worldMapConfigMigrationSql + worldMapConfigGuardsSql) },
  { version: 38, name: 'canonical-event-version-foundation', sql: canonicalEventVersionsMigrationSql, checksum: hashText(canonicalEventVersionsMigrationSql) },
  { version: 39, name: 'distinct-canonical-event-identities', sql: canonicalEventIdentityCopySql + canonicalEventIdentityGuardsSql, checksum: hashText(canonicalEventIdentityCopySql + canonicalEventIdentityGuardsSql) },
  { version: 40, name: 'immutable-event-migration-receipts', sql: eventMigrationReceiptsMigrationSql, checksum: hashText(eventMigrationReceiptsMigrationSql) },
  { version: 41, name: 'file-manuscript-text-references', sql: manuscriptTextObjectsMigrationSql, checksum: hashText(manuscriptTextObjectsMigrationSql) },
  { version: 42, name: 'file-manuscript-guards-and-bounded-autosave', sql: manuscriptTextGuardsMigrationSql, checksum: hashText(manuscriptTextGuardsMigrationSql) }
] as const
export const workspaceDatabaseMigrations = migrations

export function workspaceMigrationChecksumMatches(migration: { version: number; checksum: string }, checksum: unknown): boolean {
  return checksum === migration.checksum || (migration.version === 41 && checksum === intermediateManuscriptSchema41Checksum)
}
const requiredTables = ['ai_settings_documents', 'autosave_checkpoint_operations', 'autosave_checkpoints', 'body_version_metadata', 'body_versions', 'canonical_event_characters', 'canonical_event_evidence_refs', 'canonical_events', 'chapter_workflows', 'chapters', 'character_aliases', 'character_snapshots', 'character_state_documents', 'context_packages', 'document_chunks', 'entities', 'entity_relations', 'fact_batches', 'fact_changes', 'fact_decisions', 'fact_source_impacts', 'fact_sources', 'facts', 'finding_decisions', 'findings', 'foreshadow_actions', 'foreshadows', 'generation_artifacts', 'ideas', 'material_sources', 'mirror_entries', 'model_configs', 'outline_node_metadata', 'outline_nodes', 'outline_planning_state_documents', 'outline_versions', 'projects', 'prompt_templates', 'real_trial_chapter_records', 'real_trial_conclusions', 'resource_ledger', 'rule_runs', 'rules', 'schema_migrations', 'shadow_imports', 'storage_transitions', 'summary_versions', 'task_runs', 'workspace_config_documents', 'write_operations']
const requiredTriggers = ['ai_settings_documents_scope_guard', 'canonical_event_evidence_scope_guard', 'autosave_checkpoint_operations_no_delete', 'autosave_checkpoint_operations_no_update', 'autosave_checkpoint_operations_scope_guard', 'autosave_checkpoints_scope_insert_guard', 'autosave_checkpoints_scope_update_guard', 'autosave_checkpoints_terminal_content_guard', 'autosave_checkpoints_transition_guard', 'body_versions_ai_task_reference_guard', 'body_versions_no_delete', 'body_versions_no_update', 'chapter_workflows_transition_guard', 'chapters_outline_insert_scope_guard', 'chapters_outline_scope_guard', 'character_aliases_scope_guard', 'character_snapshots_scope_guard', 'character_state_documents_scope_guard', 'context_packages_no_delete', 'context_packages_no_update', 'context_packages_task_scope_guard', 'entity_relations_scope_guard', 'fact_batches_scope_insert_guard', 'fact_batches_scope_update_guard', 'fact_batches_transition_guard', 'fact_changes_decision_transition_guard', 'fact_changes_provenance_guard', 'fact_decisions_no_delete', 'fact_decisions_no_update', 'fact_source_impacts_no_delete', 'fact_source_impacts_no_update', 'fact_source_impacts_scope_guard', 'fact_sources_no_delete', 'fact_sources_no_update', 'fact_sources_scope_guard', 'facts_no_delete', 'facts_no_update', 'facts_scope_guard', 'finding_decisions_no_delete', 'finding_decisions_no_update', 'findings_rule_run_scope_guard', 'foreshadow_actions_no_delete', 'foreshadow_actions_no_update', 'foreshadow_actions_scope_guard', 'foreshadows_scope_insert_guard', 'foreshadows_scope_update_guard', 'ideas_promotion_scope_insert', 'ideas_promotion_scope_update', 'outline_node_metadata_kind_guard', 'outline_node_metadata_kind_update_guard', 'outline_nodes_planning_kind_guard', 'outline_versions_no_delete', 'outline_versions_no_update', 'projects_schema_version_v37_after_insert', 'findings_evidence_immutable', 'finding_decisions_resolution_scope_guard', 'findings_resolution_status_guard', 'chapters_fixed_findings_invalidation', 'ideas_generation_source_insert', 'ideas_generation_source_immutable', 'prompt_templates_contract_immutable', 'real_trial_chapter_scope_guard', 'real_trial_chapter_update_scope_guard', 'real_trial_conclusion_scope_guard', 'real_trial_conclusion_update_scope_guard', 'resource_ledger_balance_guard', 'resource_ledger_no_delete', 'resource_ledger_no_update', 'resource_ledger_scope_guard', 'task_runs_context_package_guard', 'task_runs_contract_immutable', 'task_runs_contract_insert_guard', 'task_runs_retry_contract_guard', 'workspace_config_documents_scope_guard']
const requiredViews = ['fact_review_batches']
const requiredAdditionalTriggers = ['outline_planning_state_documents_scope_guard', 'task_runs_resuming_insert_guard', 'task_runs_native_pause_transition_guard', 'task_runs_writing_active_insert_guard']
const promptTaskTypes = ['outline', 'chapterOutline', 'prose', 'review'] as const

export class SqliteWorkspaceDatabaseFactory implements WorkspaceDatabaseFactory {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => randomUUID()
  ) {}

  async open(workItemId: string): Promise<WorkspaceDatabasePort> {
    return SqliteWorkspaceDatabase.open(workItemId, this.now, this.id)
  }

  async openExisting(workItemId: string): Promise<WorkspaceDatabasePort | null> {
    return SqliteWorkspaceDatabase.openExisting(workItemId, this.now, this.id)
  }

  async openModelSettingsWrite(workItemId: string): Promise<WorkspaceDatabasePort> {
    return SqliteWorkspaceDatabase.openModelSettingsWrite(workItemId, this.now, this.id)
  }

  async openEventReadOnly(workItemId: string): Promise<WorkspaceEventReadPort | null> {
    return SqliteWorkspaceDatabase.openEventReadOnly(workItemId, this.now, this.id)
  }

  async openRecoveryReadOnly(workItemId: string): Promise<WorkspaceRecoveryReadPort | null> {
    return SqliteWorkspaceDatabase.openRecoveryReadOnly(workItemId, this.now, this.id)
  }

  async readProjectIdentity(workItemId: string): Promise<{ title: string; genre: string } | null> {
    return SqliteWorkspaceDatabase.readProjectIdentity(workItemId)
  }
}

export class SqliteWorkspaceDatabase implements WorkspaceDatabasePort {
  private closed = false
  private fileCommand: ManuscriptCommand | null = null
  private fileIntents: ManuscriptFileIntent[] = []
  private fileExpectedHashes = new Map<string, string | null>()
  private supersededAutosaveTexts = new Set<string>()
  private replayingFileCommit: ManuscriptCommitReceipt | null = null

  private constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
    private readonly id: () => string,
    private readonly projectRoot: string,
    private readonly readSchemaVersion?: number
  ) {
    database.function('lanjian_retrieval_text', { deterministic: true, directOnly: true },
      (value) => typeof value === 'string' ? normalizeRetrievalText(value) : '')
    database.function('lanjian_manuscript_text', { directOnly: true },
      (content, hash) => this.readStoredText(content, hash))
  }

  static async open(workItemId: string, now: () => Date = () => new Date(), id: () => string = () => randomUUID()): Promise<SqliteWorkspaceDatabase> {
    const root = await canonicalDirectory(workItemId)
    const metadataRoot = await projectDirectory(root, join(root, '.webnovel'))
    await mkdir(metadataRoot, { recursive: true })
    const path = await projectTargetPath(root, join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
    const existed = await pathExists(path)
    return this.openPath(path, existed, now, id, root)
  }

  static async openExisting(workItemId: string, now: () => Date = () => new Date(), id: () => string = () => randomUUID()): Promise<SqliteWorkspaceDatabase | null> {
    const root = await canonicalDirectory(workItemId)
    const path = await projectTargetPath(root, join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
    if (!await pathExists(path)) return null
    return this.openPath(path, true, now, id, root)
  }

  /** Model saves never use openPath's creating/migrating lane. */
  static async openModelSettingsWrite(workItemId: string, now: () => Date = () => new Date(), id: () => string = () => randomUUID()): Promise<SqliteWorkspaceDatabase> {
    const root = await canonicalDirectory(workItemId)
    const path = await projectTargetPath(root, join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')))
    if (!await pathExists(path)) throw new AppError('CONFLICT', '作品数据库已变化，未保存模型分配。', { recoverable: true })
    const database = new DatabaseSync(path, { allowExtension: false })
    try {
      database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 100;')
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      if (version !== WORKSPACE_DATABASE_SCHEMA_VERSION) throw new AppError('FEATURE_UNAVAILABLE', '请先核对数据库版本；模型分配保存不会执行升级。', { recoverable: true })
      const workspace = new SqliteWorkspaceDatabase(database, now, id, root)
      workspace.validateSchema()
      workspace.assertFormal()
      return workspace
    } catch (error) { database.close(); throw error }
  }

  static async openEventReadOnly(workItemId: string, now: () => Date = () => new Date(), id: () => string = () => randomUUID()): Promise<WorkspaceEventReadPort | null> {
    return this.openReadOnlyFacade(workItemId, now, id, (workspace, version, close) => {
      const project = workspace.projectRow()
      return Object.freeze({
        schemaVersion: version,
        projectId: project ? String(project.id) : null,
        eventChapterCatalog: () => workspace.eventChapterCatalog(),
        hasEventMigrationEvidence: () => workspace.hasEventMigrationEvidence(),
        eventMigrationReceipt: (operationId?: string) => readEventMigrationReceipt(workspace.database, version, project ? String(project.id) : null, operationId),
        storageMode: () => workspace.storageMode(),
        formalMaterialSourcesReady: () => workspace.formalMaterialSourcesReady(),
        listMaterialSources: () => workspace.listMaterialSources(),
        searchMaterialSources: (terms: string[], pinned?: string[], limit?: number) => workspace.searchMaterialSources(terms, pinned, limit),
        materialSourcesMirror: () => workspace.materialSourcesMirror(),
        formalCanonicalEventsReady: () => workspace.formalCanonicalEventsReady(),
        listCanonicalEvents: () => workspace.listCanonicalEvents(),
        listCanonicalEventVersions: (eventId: string) => workspace.listCanonicalEventVersions(eventId),
        canonicalEventVersionHeads: (eventId: string) => workspace.canonicalEventVersionHeads(eventId),
        canonicalEventsMirror: () => workspace.canonicalEventsMirror(),
        formalOutlinePlanningStateReady: () => workspace.formalOutlinePlanningStateReady(),
        outlinePlanningState: () => workspace.outlinePlanningState(),
        outlinePlanningStateMirror: () => workspace.outlinePlanningStateMirror(),
        formalWorkspaceConfigReady: (kind: WorkspaceConfigDocumentKind) => workspace.formalWorkspaceConfigReady(kind),
        workspaceConfig: (kind: WorkspaceConfigDocumentKind) => workspace.workspaceConfig(kind),
        workspaceConfigMirror: (kind: WorkspaceConfigDocumentKind) => workspace.workspaceConfigMirror(kind),
        close
      })
    })
  }

  static async readProjectIdentity(workItemId: string): Promise<{ title: string; genre: string } | null> {
    return this.openReadOnlyFacade(workItemId, () => new Date(), () => randomUUID(), (workspace, _version, close) => {
      try {
        if (workspace.storageMode() !== 'sqlite') return null
        const project = workspace.projectRow()!
        return { title: String(project.name), genre: String(project.genre_text ?? '') }
      } finally { close() }
    })
  }

  static async openRecoveryReadOnly(workItemId: string, now: () => Date = () => new Date(), id: () => string = () => randomUUID()): Promise<WorkspaceRecoveryReadPort | null> {
    return this.openReadOnlyFacade(workItemId, now, id, (workspace, version, close) => {
      if (version < 39) throw new AppError('UNSUPPORTED_PROJECT_VERSION', '请先通过项目数据核对数据库版本，再恢复外部稿；预览未执行升级。', { recoverable: true })
      return Object.freeze({
        storageMode: () => workspace.storageMode(),
        textAuthority: () => workspace.textAuthority(),
        formalBodyVersion: (id: number, versionId: string) => workspace.formalBodyVersion(id, versionId),
        formalOutlineReady: () => workspace.formalOutlineReady(),
        formalChapters: () => workspace.formalChapters(),
        formalOutlines: () => workspace.formalOutlines(),
        readableMirrorPlans: (filter) => workspace.readableMirrorPlans(filter),
        close
      })
    })
  }

  private static async openReadOnlyFacade<T>(workItemId: string, now: () => Date, id: () => string,
    facade: (workspace: SqliteWorkspaceDatabase, version: number, close: () => void) => T): Promise<T | null> {
    const snapshot = await stableEventReadSnapshot(workItemId)
    if (!snapshot) return null
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
      // Connection-local only: do not change journal mode, migrate or sync mirrors.
      database.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 100; BEGIN;')
      const version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
      if (!Number.isInteger(version) || version < 1 || version > WORKSPACE_DATABASE_SCHEMA_VERSION) {
        throw new AppError('UNSUPPORTED_PROJECT_VERSION', '作品数据库版本不支持只读事件核对；未执行升级或内容迁移。', { recoverable: false })
      }
      const workspace = new SqliteWorkspaceDatabase(database, now, id, await canonicalDirectory(workItemId), version)
      workspace.validateReadSchema(version)
      const project = workspace.projectRow()
      if (project && !['shadow', 'sqlite'].includes(String(project.storage_mode))) throw workspace.integrityError('作品存储模式无效。')
      // Return an explicit facade rather than the write-capable database instance.
      return facade(workspace, version, () => { try { workspace.close() } finally { snapshot.dispose() } })
    } catch (error) {
      try { database?.close() } catch { /* preserve the inspection failure */ }
      snapshot.dispose()
      if (error instanceof AppError) throw error
      throw new AppError('DATABASE_INTEGRITY_FAILED', '作品事件数据暂时无法安全核对；数据库和原文件未被改写。', {
        recoverable: false, details: { area: 'workspaceDatabase' }, cause: error
      })
    }
  }

  private hasEventMigrationEvidence(): boolean {
    if ((this.readSchemaVersion ?? WORKSPACE_DATABASE_SCHEMA_VERSION) < 40) return false
    // Even orphaned/foreign evidence prevents issuing a fresh migration grant.
    // Full receipt integrity/recovery belongs to the future receipt read owner.
    return eventMigrationReceiptTables
      .some(table => Boolean(this.database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()))
  }

  private eventChapterCatalog(): WorkspaceEventChapterCatalog {
    if (this.storageMode() !== 'sqlite') return { manuscripts: 'unavailable', outlines: 'unavailable', entries: [] }
    const projectId = String(this.projectRow()!.id)
    const catalog: WorkspaceEventChapterCatalog = { manuscripts: 'sqlite', outlines: this.formalOutlineReady() ? 'sqlite' : 'unavailable', entries: [] }
    for (const kind of ['manuscript', 'outline'] as const) {
      if (kind === 'outline' && catalog.outlines === 'unavailable') continue
      const statement = kind === 'manuscript'
        ? this.database.prepare('SELECT legacy_chapter_id AS chapter_id, status, current_body_version_id AS revision FROM chapters WHERE project_id = ? ORDER BY legacy_chapter_id')
        : this.database.prepare("SELECT legacy_key, status, current_version_id AS revision FROM outline_nodes WHERE project_id = ? AND node_type = 'chapter' ORDER BY legacy_key")
      for (const row of statement.iterate(projectId)) {
        if (catalog.entries.length >= 100_000) throw new AppError('VALIDATION_ERROR', '章节核对记录超过 100,000 项；未截断记录。', { recoverable: true })
        const key = kind === 'outline' ? String(row.legacy_key) : null
        const chapterId = kind === 'manuscript' ? row.chapter_id : key && /^chapter-[1-9]\d*$/.test(key) ? Number(key.slice(8)) : null
        if (typeof chapterId !== 'number' || !Number.isSafeInteger(chapterId) || chapterId < 1
          || !['draft', 'confirmed', 'archived'].includes(String(row.status))
          || (row.revision !== null && (typeof row.revision !== 'string' || !row.revision))
          || (row.status !== 'archived' && row.revision === null)) throw this.integrityError('章节核对身份、状态或当前版本无效。')
        catalog.entries.push({ kind, chapterId, status: row.status === 'archived' ? 'archived' : 'active', revision: row.revision as string | null })
      }
    }
    return catalog
  }

  private static async openPath(path: string, existed: boolean, now: () => Date, id: () => string, root: string): Promise<SqliteWorkspaceDatabase> {
    assertNoManuscriptMigration(root)
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(path, { allowExtension: false })
      database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      const workspace = new SqliteWorkspaceDatabase(database, now, id, root)
      workspace.migrate()
      workspace.assertConnectionSettings()
      return workspace
    } catch (error) {
      try { database?.close() } catch { /* best effort after failed open */ }
      if (!existed) await cleanupNewDatabase(path)
      if (error instanceof AppError) throw error
      throw new AppError('DATABASE_MIGRATION_FAILED', '作品数据库无法初始化；Markdown 和 JSON 原稿没有改动。', {
        recoverable: false,
        details: { area: 'workspaceDatabase' },
        cause: error
      })
    }
  }

  importSnapshot(snapshot: LegacyWorkspaceSnapshot): ShadowImportResult {
    this.assertOpen()
    try {
      assertLegacyWorkspaceSnapshot(snapshot)
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', '影子导入快照无效，未写入数据库。', { recoverable: true, cause: error })
    }
    const timestamp = this.now().toISOString()
    const baseline = this.currentProjectionFingerprint()
    const operationKey = `shadow-import:${snapshot.sourceFingerprint}:${baseline}`
    const completed = this.row(this.database.prepare('SELECT status FROM write_operations WHERE operation_key = ?').get(operationKey))
    if (completed?.status === 'completed') {
      this.verifySnapshot(snapshot)
      return {
        sourceFingerprint: snapshot.sourceFingerprint,
        chapterCount: snapshot.chapters.length,
        insertedVersions: 0,
        unchangedVersions: snapshot.chapters.length,
        verified: true
      }
    }
    if (completed) throw this.integrityError('影子导入操作状态无效，已停止继续写入。')

    let insertedVersions = 0
    let unchangedVersions = 0
    this.transaction(() => {
      const project = this.projectRow()
      const projectId = project ? String(project.id) : this.id()
      if (project && project.storage_mode !== 'shadow') {
        throw new AppError('CONFLICT', '这部作品已经切换为 SQLite 正式数据，不能再执行旧文件影子导入。', { recoverable: true })
      }
      if (!project) {
        this.database.prepare(`
          INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
          VALUES (?, ?, 'active', ?, 'shadow', ?, ?)
        `).run(projectId, snapshot.projectName, snapshot.projectManifestHash, timestamp, timestamp)
      } else {
        this.database.prepare(`
          UPDATE projects SET name = ?, legacy_manifest_hash = ?, updated_at = ? WHERE id = ?
        `).run(snapshot.projectName, snapshot.projectManifestHash, timestamp, projectId)
      }

      this.database.prepare(`
        INSERT INTO write_operations (id, operation_key, operation_type, status, payload_hash, created_at, updated_at)
        VALUES (?, ?, 'shadow_import', 'pending', ?, ?, ?)
      `).run(this.id(), operationKey, snapshot.sourceFingerprint, timestamp, timestamp)

      this.database.prepare('UPDATE chapters SET seq = seq + 1000000000 WHERE project_id = ?').run(projectId)
      const importedIds = new Set<number>()
      for (const chapter of snapshot.chapters) {
        importedIds.add(chapter.legacyChapterId)
        let storedChapter = this.row(this.database.prepare(`
          SELECT id, current_body_version_id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?
        `).get(projectId, chapter.legacyChapterId))
        const chapterId = storedChapter ? String(storedChapter.id) : deterministicChapterId(projectId, chapter.legacyChapterId)
        if (!storedChapter) {
          this.database.prepare(`
            INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, current_body_version_id, confirmed_body_version_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?)
          `).run(chapterId, projectId, chapter.legacyChapterId, chapter.position, chapter.title, timestamp, timestamp)
          const lifecycle = initialChapterLifecycle(Boolean(chapter.content))
          this.database.prepare(`
            INSERT INTO chapter_workflows (chapter_id, lifecycle_status, archived_from_status, updated_at)
            VALUES (?, ?, NULL, ?)
          `).run(chapterId, lifecycle.status, timestamp)
          storedChapter = { id: chapterId, current_body_version_id: null }
        } else {
          this.database.prepare(`
            UPDATE chapters SET seq = ?, title = ?, status = 'draft', updated_at = ? WHERE id = ?
          `).run(chapter.position, chapter.title, timestamp, chapterId)
        }

        const storedCurrentVersionId = storedChapter.current_body_version_id ? String(storedChapter.current_body_version_id) : undefined
        const current = storedCurrentVersionId
          ? this.row(this.database.prepare('SELECT id, content, content_hash FROM body_versions WHERE id = ?').get(storedCurrentVersionId))
          : undefined
        let currentVersionId = current?.id ? String(current.id) : undefined
        if (current && current.content_hash === chapter.contentHash && current.content === chapter.content) {
          unchangedVersions += 1
        } else {
          if (current && current.content_hash === chapter.contentHash && current.content !== chapter.content) {
            throw this.integrityError('正文版本的内容与哈希不一致，已停止影子导入。')
          }
          const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) AS value FROM body_versions WHERE chapter_id = ?').get(chapterId), 'value')) + 1
          currentVersionId = this.id()
          this.database.prepare(`
            INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, 'legacy_import', NULL, ?)
          `).run(currentVersionId, chapterId, versionNo, chapter.content, chapter.contentHash, current?.id ? String(current.id) : null, timestamp)
          this.writeDocumentChunks(projectId, chapterId, currentVersionId, chapter.content, timestamp)
          this.database.prepare(`
            INSERT INTO body_version_metadata (version_id, title, reason) VALUES (?, ?, 'legacy_import')
          `).run(currentVersionId, chapter.title)
          this.database.prepare('UPDATE chapters SET current_body_version_id = ?, updated_at = ? WHERE id = ?').run(currentVersionId, timestamp, chapterId)
          this.markBodyVersionDependentsStale(
            chapterId,
            current?.id ? String(current.id) : null,
            current?.content_hash ? String(current.content_hash) : null,
            currentVersionId,
            chapter.contentHash,
            timestamp
          )
          insertedVersions += 1
        }

        if (!currentVersionId) throw this.integrityError('章节没有可用的当前正文版本。')
        this.database.prepare(`
          INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at)
          VALUES (?, ?, 'chapter_markdown', ?, ?, ?, ?, ?, 'pending', NULL, ?)
          ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET
            source_version_id = excluded.source_version_id,
            relative_path = excluded.relative_path,
            content_hash = excluded.content_hash,
            observed_hash = excluded.observed_hash,
            status = 'pending',
            last_error_code = NULL,
            updated_at = excluded.updated_at
        `).run(this.id(), projectId, chapterId, currentVersionId, chapter.mirrorRelativePath, chapter.contentHash, chapter.contentHash, timestamp)
      }

      const existing = this.rows(this.database.prepare('SELECT id, legacy_chapter_id FROM chapters WHERE project_id = ? ORDER BY legacy_chapter_id').all(projectId))
      let archivedPosition = snapshot.chapters.length
      for (const chapter of existing) {
        const legacyId = Number(chapter.legacy_chapter_id)
        if (importedIds.has(legacyId)) continue
        archivedPosition += 1
        const workflow = this.row(this.database.prepare('SELECT lifecycle_status FROM chapter_workflows WHERE chapter_id = ?').get(String(chapter.id)))
        if (workflow && workflow.lifecycle_status !== 'ARCHIVED') this.database.prepare(`
          UPDATE chapter_workflows SET lifecycle_status = 'ARCHIVED', archived_from_status = lifecycle_status, updated_at = ? WHERE chapter_id = ?
        `).run(timestamp, String(chapter.id))
        this.database.prepare(`UPDATE chapters SET seq = ?, status = 'archived', updated_at = ? WHERE id = ?`).run(archivedPosition, timestamp, String(chapter.id))
      }

      const importedOutlineKeys = new Set<string>()
      const outlineIds = new Map<string, string>()
      for (const outline of snapshot.outlines ?? []) {
        importedOutlineKeys.add(outline.legacyKey)
        const stored = this.row(this.database.prepare(`SELECT id, current_version_id FROM outline_nodes WHERE project_id = ? AND legacy_key = ?`).get(projectId, outline.legacyKey))
        const nodeId = stored ? String(stored.id) : deterministicOutlineId(projectId, outline.legacyKey)
        outlineIds.set(outline.legacyKey, nodeId)
        const parentId = outline.parentLegacyKey ? outlineIds.get(outline.parentLegacyKey) ?? null : null
        if (outline.parentLegacyKey && !parentId) throw this.integrityError('大纲父节点没有先于子节点导入。')
        if (!stored) {
          this.database.prepare(`
            INSERT INTO outline_nodes (id, project_id, parent_id, legacy_key, node_type, seq, title, content, content_hash, status, current_version_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
          `).run(nodeId, projectId, parentId, outline.legacyKey, storageOutlineNodeType(outline.nodeType), outline.seq, outline.title, outline.content, outline.contentHash, timestamp, timestamp)
          this.database.prepare(`
            INSERT INTO outline_node_metadata (outline_node_id, planning_kind, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `).run(nodeId, outline.nodeType, timestamp, timestamp)
        }
        const current = stored?.current_version_id ? this.row(this.database.prepare('SELECT * FROM outline_versions WHERE id = ?').get(String(stored.current_version_id))) : undefined
        let versionId = current?.id ? String(current.id) : undefined
        if (!current || current.content_hash !== outline.contentHash || current.content !== outline.content) {
          versionId = this.id()
          const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM outline_versions WHERE outline_node_id = ?').get(nodeId), 'value'))
          this.database.prepare(`INSERT INTO outline_versions (id, outline_node_id, version_no, content, content_hash, parent_id, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, 'legacy_import', ?)`)
            .run(versionId, nodeId, versionNo, outline.content, outline.contentHash, current?.id ? String(current.id) : null, timestamp)
        }
        if (!versionId) throw this.integrityError('导入的大纲缺少当前版本。')
        const currentVersionId = versionId
        this.database.prepare(`UPDATE outline_nodes SET parent_id = ?, node_type = ?, seq = ?, title = ?, content = ?, content_hash = ?, status = 'draft', current_version_id = ?, updated_at = ? WHERE id = ?`)
          .run(parentId, storageOutlineNodeType(outline.nodeType), outline.seq, outline.title, outline.content, outline.contentHash, currentVersionId, timestamp, nodeId)
        this.database.prepare(`
          INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at)
          VALUES (?, ?, 'outline_markdown', ?, ?, ?, ?, ?, 'pending', NULL, ?)
          ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET source_version_id = excluded.source_version_id, relative_path = excluded.relative_path,
            content_hash = excluded.content_hash, observed_hash = excluded.observed_hash, status = 'pending', last_error_code = NULL, updated_at = excluded.updated_at
        `).run(this.id(), projectId, nodeId, currentVersionId, outline.mirrorRelativePath, outline.contentHash, outline.contentHash, timestamp)
      }
      for (const node of this.rows(this.database.prepare('SELECT id, legacy_key FROM outline_nodes WHERE project_id = ?').all(projectId))) {
        if (!importedOutlineKeys.has(String(node.legacy_key))) this.database.prepare(`UPDATE outline_nodes SET status = 'archived', updated_at = ? WHERE id = ?`).run(timestamp, String(node.id))
      }
      this.database.prepare(`
        UPDATE chapters SET outline_node_id = (
          SELECT nodes.id FROM outline_nodes nodes
          JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
          WHERE nodes.project_id = chapters.project_id
            AND nodes.legacy_key = 'chapter-' || chapters.legacy_chapter_id
            AND nodes.status <> 'archived'
            AND metadata.planning_kind = 'chapter'
          LIMIT 1
        )
        WHERE project_id = ?
      `).run(projectId)
      this.database.prepare('UPDATE projects SET outline_storage_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      this.importPromptProfileInCurrentTransaction(projectId, snapshot.promptProfile ?? emptyPromptProfile(snapshot.workItemId), timestamp)

      const receiptId = this.id()
      this.database.prepare(`
        INSERT INTO shadow_imports (id, project_id, source_fingerprint, status, chapter_count, total_words, error_code, started_at, ended_at)
        VALUES (?, ?, ?, 'completed', ?, ?, NULL, ?, ?)
      `).run(receiptId, projectId, snapshot.sourceFingerprint, snapshot.chapters.length, snapshot.totalWords, timestamp, timestamp)
      this.database.prepare(`
        UPDATE write_operations SET status = 'completed', result_ref = ?, updated_at = ? WHERE operation_key = ?
      `).run(receiptId, timestamp, operationKey)
      this.verifyProjection(snapshot)
    })
    this.verifySnapshot(snapshot)
    return {
      sourceFingerprint: snapshot.sourceFingerprint,
      chapterCount: snapshot.chapters.length,
      insertedVersions,
      unchangedVersions,
      verified: true
    }
  }

  storageMode(): WorkspaceStorageMode | null {
    this.assertOpen()
    const project = this.projectRow()
    return project ? project.storage_mode as WorkspaceStorageMode : null
  }

  projectWritingConfig(): WorkspaceProjectWritingConfig {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    const configJson = String(project.config_json ?? '{}')
    assertJsonText(configJson, 512_000, '项目扩展配置')
    return {
      targetWords: project.target_words === null || project.target_words === undefined ? null : Number(project.target_words),
      genreText: String(project.genre_text ?? ''),
      audienceScale: String(project.audience_scale ?? ''),
      defaultPov: String(project.default_pov ?? ''),
      writingStyle: String(project.writing_style ?? ''),
      chapterTargetWords: project.chapter_target_words === null || project.chapter_target_words === undefined ? null : Number(project.chapter_target_words),
      autosaveEnabled: Number(project.autosave_enabled) === 1,
      autosaveDelayMs: Number(project.autosave_delay_ms),
      autosaveMergeWindowMs: Number(project.autosave_merge_window_ms),
      configJson
    }
  }

  updateProjectWritingConfig(input: WorkspaceProjectWritingConfigInput, expectedConfigHash?: string): WorkspaceProjectWritingConfigWriteResult {
    this.assertFormal()
    const current = this.projectWritingConfig()
    const next: WorkspaceProjectWritingConfig = { ...current, ...input }
    assertOptionalPositiveInteger(next.targetWords, '作品目标字数')
    assertOptionalPositiveInteger(next.chapterTargetWords, '单章目标字数')
    assertBoundedText(next.genreText, '题材', 2_000)
    assertBoundedText(next.audienceScale, '受众尺度', 2_000)
    assertBoundedText(next.defaultPov, '默认视角', 2_000)
    assertBoundedText(next.writingStyle, '文风提示', 20_000)
    if (!Number.isSafeInteger(next.autosaveDelayMs) || next.autosaveDelayMs < 250 || next.autosaveDelayMs > 60_000) {
      throw new AppError('VALIDATION_ERROR', '自动保存延迟必须在 250 到 60000 毫秒之间。', { recoverable: true })
    }
    assertJsonText(next.configJson, 512_000, '项目扩展配置')
    if (input.autosaveMergeWindowMs === undefined) {
      const extensions = JSON.parse(next.configJson) as unknown
      if (extensions && typeof extensions === 'object' && !Array.isArray(extensions)
        && 'autosaveMergeWindowMs' in extensions) {
        next.autosaveMergeWindowMs = Number((extensions as Record<string, unknown>).autosaveMergeWindowMs)
      }
    }
    if (!Number.isSafeInteger(next.autosaveMergeWindowMs) || next.autosaveMergeWindowMs < 1_000 || next.autosaveMergeWindowMs > 600_000) {
      throw new AppError('VALIDATION_ERROR', '自动保存版本合并窗口必须在 1000 到 600000 毫秒之间。', { recoverable: true })
    }
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (expectedConfigHash && createHash('sha256').update(JSON.stringify(this.projectWritingConfig())).digest('hex') !== expectedConfigHash) throw new AppError('CONFLICT', '作品定义已被更新，请重新读取后保存。', { recoverable: true })
      this.database.prepare(`
        UPDATE projects SET target_words = ?, genre_text = ?, audience_scale = ?, default_pov = ?, writing_style = ?,
          chapter_target_words = ?, autosave_enabled = ?, autosave_delay_ms = ?, autosave_merge_window_ms = ?, config_json = ?, current_schema_version = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.targetWords, next.genreText, next.audienceScale, next.defaultPov, next.writingStyle,
        next.chapterTargetWords, next.autosaveEnabled ? 1 : 0, next.autosaveDelayMs, next.autosaveMergeWindowMs, next.configJson,
        WORKSPACE_DATABASE_SCHEMA_VERSION, timestamp, projectId
      )
      mirror = this.prepareProjectConfigMirror(projectId, timestamp)
    })
    return { config: this.projectWritingConfig(), mirror }
  }

  foundationConfig(): WorkspaceFoundationConfig | null {
    this.assertOpen()
    const extensions = JSON.parse(this.projectWritingConfig().configJson) as Record<string, unknown>
    if (!extensions.foundation || typeof extensions.foundation !== 'object' || Array.isArray(extensions.foundation)) return null
    return normalizeFoundationConfig(extensions.foundation as Record<string, unknown>)
  }

  foundationMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()!.id)
    const mirror = this.row(this.database.prepare(`
      SELECT relative_path, content_hash, status FROM mirror_entries
      WHERE project_id = ? AND source_type = 'foundation_json' AND source_id = ?
    `).get(projectId, projectId))
    return mirror ? {
      relativePath: String(mirror.relative_path), contentHash: String(mirror.content_hash), status: String(mirror.status) as WorkspaceMirrorStatus
    } : null
  }

  writeFoundationConfig(input: WorkspaceFoundationConfig, observedMirrorHash?: string): WorkspaceFoundationConfigWriteResult {
    this.assertFormal()
    if (observedMirrorHash !== undefined && !isSha256(observedMirrorHash)) throw new AppError('VALIDATION_ERROR', '创作基础镜像哈希无效。', { recoverable: true })
    const foundation = normalizeFoundationConfig(input as unknown as Record<string, unknown>)
    const projectId = String(this.projectRow()!.id)
    const current = this.projectWritingConfig()
    const extensions = JSON.parse(current.configJson) as Record<string, unknown>
    const nextConfigJson = JSON.stringify({ ...extensions, foundation })
    assertJsonText(nextConfigJson, 512_000, '项目扩展配置')
    const timestamp = this.now().toISOString()
    let mirrors!: WorkspaceMirrorPlan[]
    this.transaction(() => {
      this.database.prepare(`UPDATE projects SET config_json = ?, current_schema_version = ?, updated_at = ? WHERE id = ?`)
        .run(nextConfigJson, WORKSPACE_DATABASE_SCHEMA_VERSION, timestamp, projectId)
      mirrors = [
        this.prepareProjectConfigMirror(projectId, timestamp),
        this.prepareFoundationMirror(projectId, timestamp, observedMirrorHash)
      ]
    })
    return { foundation: this.foundationConfig()!, mirrors }
  }

  formalPromptReady(): boolean {
    this.assertOpen()
    const project = this.projectRow()
    return Boolean(project && Number(project.prompt_storage_ready) === 1)
  }

  formalPromptMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()!.id)
    const mirror = this.row(this.database.prepare(`
      SELECT relative_path, content_hash, status FROM mirror_entries
      WHERE project_id = ? AND source_type = 'prompt_profile_json' AND source_id = ?
    `).get(projectId, projectId))
    return mirror ? {
      relativePath: String(mirror.relative_path), contentHash: String(mirror.content_hash), status: String(mirror.status) as WorkspaceMirrorStatus
    } : null
  }

  importPromptProfile(input: LegacyWorkspacePromptProfile): WorkspaceMirrorPlan | null {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    if (this.formalPromptReady()) return null
    let mirror: WorkspaceMirrorPlan | null = null
    this.transaction(() => { mirror = this.importPromptProfileInCurrentTransaction(String(project.id), input, this.now().toISOString()) })
    return mirror
  }

  promptProfile(): WorkspacePromptProfileRecord {
    this.assertFormal()
    if (!this.formalPromptReady()) throw new AppError('FEATURE_UNAVAILABLE', '这部作品的提示词尚未迁入 SQLite。', { recoverable: true })
    return this.promptProfileRecord()
  }

  private promptProfileRecord(): WorkspacePromptProfileRecord {
    const project = this.projectRow()!
    const projectId = String(project.id)
    const overrides: WorkspacePromptProfileRecord['overrides'] = {}
    for (const row of this.rows(this.database.prepare(`
      SELECT task_type, template_text FROM prompt_templates
      WHERE project_id = ? AND name = 'project-override' AND enabled = 1
      ORDER BY task_type, version DESC
    `).all(projectId))) {
      const task = String(row.task_type)
      if (!promptTaskTypes.includes(task as typeof promptTaskTypes[number])) throw this.integrityError('作品提示词包含未知任务类型。')
      if (overrides[task as keyof typeof overrides] !== undefined) throw this.integrityError('作品提示词存在多个启用版本。')
      overrides[task as keyof typeof overrides] = String(row.template_text)
    }
    const mirror = this.row(this.database.prepare(`
      SELECT status FROM mirror_entries WHERE project_id = ? AND source_type = 'prompt_profile_json' AND source_id = ?
    `).get(projectId, projectId))
    return {
      version: 1,
      workItemId: String(project.prompt_work_item_id || ''),
      genreFingerprint: String(project.prompt_genre_fingerprint || ''),
      overrides,
      updatedAt: String(project.prompt_updated_at || ''),
      mirrorStatus: mirror ? String(mirror.status) as WorkspaceMirrorStatus : null
    }
  }

  writePromptProfile(input: Omit<WorkspacePromptProfileRecord, 'mirrorStatus'>): WorkspacePromptProfileWriteResult {
    this.assertFormal()
    if (!this.formalPromptReady()) throw new AppError('FEATURE_UNAVAILABLE', '这部作品的提示词尚未迁入 SQLite。', { recoverable: true })
    assertPromptProfileInput(input)
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`UPDATE prompt_templates SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = 'project-override' AND enabled = 1`).run(timestamp, projectId)
      for (const task of promptTaskTypes) {
        const content = input.overrides[task]
        if (!content) continue
        const version = Number(this.scalar(this.database.prepare(`
          SELECT COALESCE(MAX(version), 0) + 1 AS value FROM prompt_templates WHERE project_id = ? AND task_type = ? AND name = 'project-override'
        `).get(projectId, task), 'value'))
        this.database.prepare(`
          INSERT INTO prompt_templates (id, project_id, task_type, name, template_text, template_hash, enabled, version,
            created_at, updated_at, system_template, input_schema_json, output_schema_json)
          VALUES (?, ?, ?, 'project-override', ?, ?, 1, ?, ?, ?, ?, '{}', '{}')
        `).run(this.id(), projectId, task, content, hashText(content), version, timestamp, timestamp, content)
      }
      this.database.prepare(`
        UPDATE projects SET prompt_work_item_id = ?, prompt_genre_fingerprint = ?, prompt_updated_at = ?, updated_at = ? WHERE id = ?
      `).run(input.workItemId, input.genreFingerprint, input.updatedAt || timestamp, timestamp, projectId)
      mirror = this.preparePromptProfileMirror(projectId, timestamp)
    })
    return { profile: this.promptProfile(), mirror }
  }

  activateSqlite(snapshot: LegacyWorkspaceSnapshot): void {
    this.assertOpen()
    try {
      assertLegacyWorkspaceSnapshot(snapshot)
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', '正式切换快照无效，未切换数据源。', { recoverable: true, cause: error })
    }
    if (this.storageMode() !== 'shadow') throw new AppError('CONFLICT', '作品数据库不在可切换的影子状态。', { recoverable: true })
    this.verifyProjection(snapshot)
    const project = this.projectRow()!
    const projectId = String(project.id)
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        UPDATE mirror_entries SET status = 'synced', observed_hash = content_hash,
          previous_relative_path = NULL, previous_observed_hash = NULL, last_error_code = NULL, updated_at = ?
        WHERE project_id = ? AND source_type IN ('chapter_markdown', 'outline_markdown', 'prompt_profile_json')
      `).run(timestamp, projectId)
      const order = snapshot.chapterOrderMirror
      if (hashText(order.content) !== order.contentHash) {
        throw new AppError('VALIDATION_ERROR', '章节顺序镜像内容与校验值不一致，未切换正式数据源。', { recoverable: true })
      }
      this.database.prepare(`
        INSERT INTO mirror_entries (
          id, project_id, source_type, source_id, source_version_id, relative_path, content_hash,
          observed_hash, status, last_error_code, updated_at, previous_relative_path, previous_observed_hash
        ) VALUES (?, ?, 'chapter_order_json', ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)
        ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET
          source_version_id = excluded.source_version_id,
          relative_path = excluded.relative_path,
          content_hash = excluded.content_hash,
          observed_hash = excluded.observed_hash,
          status = excluded.status,
          last_error_code = NULL,
          updated_at = excluded.updated_at,
          previous_relative_path = NULL,
          previous_observed_hash = NULL
      `).run(
        this.id(), projectId, projectId, snapshot.sourceFingerprint, order.relativePath, order.contentHash,
        order.observedHash, order.observedHash === order.contentHash ? 'synced' : 'pending', timestamp
      )
      this.database.prepare(`
        INSERT INTO storage_transitions (id, project_id, from_mode, to_mode, source_fingerprint, created_at)
        VALUES (?, ?, 'shadow', 'sqlite', ?, ?)
      `).run(this.id(), projectId, snapshot.sourceFingerprint, timestamp)
      this.database.prepare(`UPDATE projects SET storage_mode = 'sqlite', updated_at = ? WHERE id = ?`).run(timestamp, projectId)
    })
    if (this.storageMode() !== 'sqlite') throw this.integrityError('SQLite 正式数据源切换没有生效。')
  }

  deactivateSqlite(sourceFingerprint: string): void {
    this.assertFormal()
    if (!/^[0-9a-f]{64}$/.test(sourceFingerprint)) throw new AppError('VALIDATION_ERROR', '回退核对指纹无效。', { recoverable: true })
    this.assertRollbackReady()
    const project = this.projectRow()!
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO storage_transitions (id, project_id, from_mode, to_mode, source_fingerprint, created_at)
        VALUES (?, ?, 'sqlite', 'shadow', ?, ?)
      `).run(this.id(), String(project.id), sourceFingerprint, timestamp)
      this.database.prepare(`UPDATE projects SET storage_mode = 'shadow', updated_at = ? WHERE id = ?`).run(timestamp, String(project.id))
    })
  }

  activateEmptyFileTextAuthority(): void {
    this.assertFormal()
    this.transaction(() => {
      for (const table of ['body_versions', 'outline_versions', 'outline_nodes', 'autosave_checkpoints', 'document_chunks']) {
        if (this.database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new AppError('CONFLICT', '已有稿件必须通过备份迁移，不能按空白作品切换。', { recoverable: true })
      }
      this.database.prepare("UPDATE projects SET text_authority = 'files-v1' WHERE id = ?").run(String(this.projectRow()!.id))
    })
  }

  formalChapters(): WorkspaceChapterRecord[] {
    this.assertFormal()
    return this.formalChapterRows(true)
  }

  formalChapterIds(): number[] {
    this.assertFormal()
    return this.activeChapterIds()
  }

  formalChapter(legacyChapterId: number): WorkspaceChapterRecord | undefined {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '章节身份无效。', { recoverable: true })
    return this.formalChapterRecord(legacyChapterId, false, true)
  }

  formalArchivedChapters(): WorkspaceArchivedChapterRecord[] {
    this.assertFormal()
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    const rows = this.rows(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, chapters.seq, chapters.title, chapters.current_body_version_id,
             chapters.updated_at AS deleted_at, bodies.content, bodies.content_hash,
             mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path
      FROM chapters
      JOIN body_versions bodies ON bodies.id = chapters.current_body_version_id
      JOIN body_version_metadata metadata ON metadata.version_id = bodies.id
      JOIN mirror_entries mirrors ON mirrors.project_id = chapters.project_id
        AND mirrors.source_type = 'chapter_markdown' AND mirrors.source_id = chapters.id
      WHERE chapters.project_id = ? AND chapters.status = 'archived'
      ORDER BY chapters.updated_at DESC, chapters.legacy_chapter_id DESC
      LIMIT 500
    `).all(String(project.id)))
    return rows.map((row) => ({ ...this.chapterRecord(row), deletedAt: String(row.deleted_at) }))
  }

  formalManuscriptRevision(): string {
    this.assertFormal()
    return hashText(JSON.stringify(this.formalChapterRows(true).map((chapter) => ({
      id: chapter.legacyChapterId,
      position: chapter.position,
      title: chapter.title,
      version: chapter.currentVersionId,
      contentHash: chapter.contentHash
    }))))
  }

  formalOutlineReady(): boolean {
    const project = this.projectRow()
    return Boolean(project && Number(project.outline_storage_ready) === 1)
  }

  formalOutlines(): WorkspaceOutlineRecord[] {
    this.assertFormal()
    if (!this.formalOutlineReady()) throw new AppError('FEATURE_UNAVAILABLE', '这部作品的大纲仍由 Markdown 保存，尚未迁入 SQLite。', { recoverable: true })
    return this.formalOutlineRows(true)
  }

  writeFormalOutline(input: WorkspaceOutlineWriteInput): { outline: WorkspaceOutlineRecord; mirror: WorkspaceMirrorPlan; insertedVersion: boolean } {
    return this.manuscriptTransaction({ name: 'writeFormalOutline', args: [input] }, () => this.writeFormalOutlineInTransaction(input))
  }

  reservedOutlineKeys(): string[] {
    this.assertFormal()
    if (!this.formalOutlineReady()) throw new AppError('FEATURE_UNAVAILABLE', '这部作品的大纲仍由 Markdown 保存，尚未迁入 SQLite。', { recoverable: true })
    return this.rows(this.database.prepare('SELECT legacy_key FROM outline_nodes WHERE project_id = ?').all(String(this.projectRow()!.id)))
      .map(row => String(row.legacy_key))
  }

  appendFormalOutlineChildren(input: WorkspaceOutlineChildrenAppendInput): WorkspaceOutlineRecord[] {
    return this.manuscriptTransaction({ name: 'appendFormalOutlineChildren', args: [input] }, () => {
      const adoption = input.adoption
      const artifact = adoption ? this.generationArtifactForTask(adoption.taskId, 'outline_expansion') : null
      if (adoption && (!artifact || artifact.id !== adoption.artifactId || artifact.contentHash !== adoption.artifactHash
        || !artifact.schemaValid || artifact.status !== 'complete' || this.taskRun(adoption.taskId)?.status !== 'succeeded')) {
        throw new AppError('CONFLICT', '候选已采用或状态已经变化，请重新读取。', { recoverable: true })
      }
      const nodes = this.formalOutlines()
      const parent = nodes.find(node => node.legacyKey === input.parentLegacyKey)
      if (!parent || parent.revision !== input.expectedParentRevision) {
        throw new AppError('CONFLICT', '父级大纲已经变化，请重新预览后采用。', { recoverable: true })
      }
      const childType = parent.nodeType === 'summary' ? 'volume' : parent.nodeType === 'volume' ? 'stage' : parent.nodeType === 'stage' ? 'chapter' : null
      const actualKeys = nodes.filter(node => node.parentLegacyKey === parent.legacyKey).map(node => node.legacyKey).sort()
      if (JSON.stringify(actualKeys) !== JSON.stringify([...input.expectedChildKeys].sort())) {
        throw new AppError('CONFLICT', '父级下的目录已经变化，请重新预览后采用。', { recoverable: true })
      }
      if (!childType || input.children.length < 1 || input.children.length > 12
        || new Set(input.children.map(child => child.legacyKey)).size !== input.children.length
        || new Set(input.children.map(child => child.seq)).size !== input.children.length) {
        throw new AppError('VALIDATION_ERROR', '逐层采用必须包含同一层的一批新子纲。', { recoverable: true })
      }
      const projectId = String(this.projectRow()!.id)
      for (const child of input.children) {
        if (child.nodeType !== childType || child.parentLegacyKey !== parent.legacyKey) {
          throw new AppError('VALIDATION_ERROR', '子纲必须属于当前父级的下一层。', { recoverable: true })
        }
        // Include archived identities: adoption must never revive or overwrite an old author node.
        if (this.row(this.database.prepare('SELECT id FROM outline_nodes WHERE project_id = ? AND legacy_key = ?').get(projectId, child.legacyKey))
          || nodes.some(node => node.nodeType === childType && node.seq === child.seq)) {
          throw new AppError('CONFLICT', '目标大纲编号已经占用，请重新预览后采用。', { recoverable: true })
        }
      }
      const result = input.children.map((child, index) => this.writeFormalOutlineInTransaction({ ...child, sourceType: 'ai',
        ...(adoption ? { planning: { ...child.planning, metadataJson: JSON.stringify({ ...JSON.parse(child.planning?.metadataJson ?? '{}'),
          sourceTaskId: adoption.taskId, sourceArtifactId: adoption.artifactId, sourceChildIndex: index }) } } : {})
      }).outline)
      if (adoption && artifact) {
        this.updateGenerationArtifactStatus(artifact.id, 'applied', JSON.stringify({ ...JSON.parse(artifact.metadataJson),
          adoption: { keys: result.map(node => node.legacyKey), adoptedAt: this.now().toISOString() } }))
        this.prepareCandidateGenerationMirror(adoption.taskId, 'outline_expansion')
      }
      return result
    })
  }

  private writeFormalOutlineInTransaction(input: WorkspaceOutlineWriteInput): { outline: WorkspaceOutlineRecord; mirror: WorkspaceMirrorPlan; insertedVersion: boolean } {
    this.assertFormal()
    if (!this.formalOutlineReady()) throw new AppError('FEATURE_UNAVAILABLE', '大纲尚未迁入 SQLite，未执行写入。', { recoverable: true })
    if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*|chapter-[1-9]\d*)$/.test(input.legacyKey) || !Number.isSafeInteger(input.seq) || input.seq < 1 || !input.title.trim()) {
      throw new AppError('VALIDATION_ERROR', 'SQLite 大纲写入参数无效。', { recoverable: true })
    }
    if ((input.nodeType === 'summary') !== (input.legacyKey === 'total')
      || (input.nodeType === 'volume') !== input.legacyKey.startsWith('volume-')
      || (input.nodeType === 'stage') !== input.legacyKey.startsWith('stage-')
      || (input.nodeType === 'chapter') !== input.legacyKey.startsWith('chapter-')) {
      throw new AppError('VALIDATION_ERROR', '大纲身份与层级类型不一致。', { recoverable: true })
    }
    let result!: { outline: WorkspaceOutlineRecord; mirror: WorkspaceMirrorPlan; insertedVersion: boolean }
    {
      const projectId = String(this.projectRow()!.id)
      const timestamp = this.now().toISOString()
      const stored = this.row(this.database.prepare('SELECT * FROM outline_nodes WHERE project_id = ? AND legacy_key = ?').get(projectId, input.legacyKey))
      let current = stored ? this.formalOutlineRecord(input.legacyKey, true) : undefined
      if (current && current.nodeType !== input.nodeType) throw new AppError('CONFLICT', '现有大纲节点不能改成另一种层级。', { recoverable: true })
      const fileBaseline = current && stored?.status !== 'archived' && this.textAuthority() === 'files-v1'
        ? this.fileWriteBaseline(String(stored!.id), 'outline', input.sourceType === 'restore') : null
      const revision = fileBaseline ? hashText(`${input.legacyKey}\u0000${fileBaseline.title}\u0000${fileBaseline.content}`) : current?.revision
      if (input.expectedRevision && revision !== input.expectedRevision) throw new AppError('CONFLICT', '大纲已经更新，未覆盖较新的版本。', { recoverable: true })
      const nodeId = stored ? String(stored.id) : deterministicOutlineId(projectId, input.legacyKey)
      let importedExternal = false
      if (fileBaseline?.external && current) {
        if (!input.expectedRevision || input.sourceType === 'ai') throw new AppError('CONFLICT', '大纲已被外部修改，请先重新读取并核对当前稿。', { recoverable: true })
        const versionId = this.id()
        const versionNo = Number(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM outline_versions WHERE outline_node_id = ?').get(nodeId)!.n)
        this.database.prepare(`INSERT INTO outline_versions (id, outline_node_id, version_no, content, content_hash, parent_id, source_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`).run(versionId, nodeId, versionNo, this.storeText(fileBaseline.content), fileBaseline.hash, current.currentVersionId, timestamp)
        this.database.prepare("UPDATE outline_nodes SET content = '', content_hash = ?, current_version_id = ?, status = 'draft', updated_at = ? WHERE id = ?")
          .run(fileBaseline.hash, versionId, timestamp, nodeId)
        current = { ...current, content: fileBaseline.content, contentHash: fileBaseline.hash, currentVersionId: versionId, revision: revision! }
        this.fileExpectedHashes.set(fileBaseline.relativePath, fileBaseline.hash)
        importedExternal = true
      }
      const parentWasSpecified = Object.prototype.hasOwnProperty.call(input, 'parentLegacyKey')
      const effectiveParentLegacyKey = parentWasSpecified ? input.parentLegacyKey ?? undefined : current?.parentLegacyKey ?? undefined
      const parent = effectiveParentLegacyKey ? this.row(this.database.prepare(`
        SELECT nodes.id, metadata.planning_kind FROM outline_nodes nodes
        JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
        WHERE nodes.project_id = ? AND nodes.legacy_key = ? AND nodes.status <> 'archived'
      `).get(projectId, effectiveParentLegacyKey)) : undefined
      if (effectiveParentLegacyKey && !parent) throw new AppError('CONFLICT', '大纲父节点不存在，未执行写入。', { recoverable: true })
      const parentKind = parent ? String(parent.planning_kind) : null
      const preservedLegacyRoot = Boolean(current && current.parentLegacyKey === null && effectiveParentLegacyKey === undefined)
      if (!preservedLegacyRoot && ((input.nodeType === 'summary' && parentKind !== null)
        || (input.nodeType === 'volume' && parentKind !== 'summary')
        || (input.nodeType === 'stage' && parentKind !== 'volume')
        || (input.nodeType === 'chapter' && !['volume', 'stage'].includes(parentKind ?? '')))) {
        throw new AppError('VALIDATION_ERROR', '大纲父子层级不符合梗概→卷→阶段→章结构。', { recoverable: true })
      }
      const contentHash = hashText(input.content)
      const planning = normalizeOutlinePlanning(current?.planning, input.planning)
      const changed = !current || current.content !== input.content || current.title !== input.title
        || current.parentLegacyKey !== (effectiveParentLegacyKey ?? null) || current.seq !== input.seq || stored?.status === 'archived'
      let versionId = current?.currentVersionId
      if (!stored) {
        this.database.prepare(`
          INSERT INTO outline_nodes (id, project_id, parent_id, legacy_key, node_type, seq, title, content, content_hash, status, current_version_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
        `).run(nodeId, projectId, parent ? String(parent.id) : null, input.legacyKey, storageOutlineNodeType(input.nodeType), input.seq, input.title, this.storeText(input.content), contentHash, timestamp, timestamp)
        this.database.prepare(`
          INSERT INTO outline_node_metadata (
            outline_node_id, planning_kind, goal_text, entry_state_text, exit_state_text, conflict_text,
            turning_point_text, hook_text, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          nodeId, input.nodeType, planning.goalText, planning.entryStateText, planning.exitStateText,
          planning.conflictText, planning.turningPointText, planning.hookText, planning.metadataJson, timestamp, timestamp
        )
      }
      if (changed) {
        versionId = this.id()
        const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM outline_versions WHERE outline_node_id = ?').get(nodeId), 'value'))
        this.database.prepare(`INSERT INTO outline_versions (id, outline_node_id, version_no, content, content_hash, parent_id, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(versionId, nodeId, versionNo, this.storeText(input.content), contentHash, current?.currentVersionId ?? null, input.sourceType ?? 'manual', timestamp)
      }
      if (!versionId) throw this.integrityError('SQLite 大纲缺少当前版本。')
      this.database.prepare(`UPDATE outline_nodes SET parent_id = ?, node_type = ?, seq = ?, title = ?, content = ?, content_hash = ?, status = 'draft', current_version_id = ?, updated_at = ? WHERE id = ?`)
        .run(parent ? String(parent.id) : null, storageOutlineNodeType(input.nodeType), input.seq, input.title, this.storeText(input.content), contentHash, versionId, timestamp, nodeId)
      if (stored && input.planning) this.database.prepare(`
        UPDATE outline_node_metadata SET goal_text = ?, entry_state_text = ?, exit_state_text = ?, conflict_text = ?,
          turning_point_text = ?, hook_text = ?, metadata_json = ?, updated_at = ? WHERE outline_node_id = ?
      `).run(
        planning.goalText, planning.entryStateText, planning.exitStateText, planning.conflictText,
        planning.turningPointText, planning.hookText, planning.metadataJson, timestamp, nodeId
      )
      const mirror = this.prepareOutlineMirror(projectId, nodeId, input.legacyKey, versionId, input.content, contentHash, timestamp)
      result = { outline: this.formalOutlineRecord(input.legacyKey)!, mirror, insertedVersion: changed || importedExternal }
    }
    return result
  }

  writeFormalChapter(input: WorkspaceChapterWriteInput): WorkspaceChapterWriteResult {
    return this.manuscriptTransaction({ name: 'writeFormalChapter', args: [input] }, () => this.writeFormalChapterInTransaction(input))
  }

  applyWritingAgentArtifact(input: WorkspaceWritingAgentApplicationInput): WorkspaceWritingAgentApplicationResult {
    return this.manuscriptTransaction({ name: 'applyWritingAgentArtifact', args: [input] }, () => {
      this.assertFormal()
      assertBoundedIdentifier(input.taskRunId, '写作任务 ID')
      assertBoundedIdentifier(input.artifactId, '写作 Artifact ID')
      assertJsonText(input.metadataJson, 200_000, '写作采用元数据')
      if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1 || !input.title.trim() || !isSha256(input.expectedRevision)) {
        throw new AppError('VALIDATION_ERROR', '写作候选采用参数无效。', { recoverable: true })
      }
      const task = this.taskRun(input.taskRunId)
      const artifact = this.generationArtifactForTask(input.taskRunId, input.artifactType)
      if (!task || task.legacyChapterId !== input.legacyChapterId || !artifact || artifact.id !== input.artifactId || !artifact.schemaValid) {
        throw new AppError('CONFLICT', '写作候选不属于当前作品或章节。', { recoverable: true })
      }
      const allowedSource = input.artifactType === 'writing_agent_turn'
        ? task.status === 'succeeded' && artifact.status === 'complete'
        : ['paused', 'cancelled', 'failed', 'interrupted'].includes(task.status) && artifact.status === 'partial'
      const projectId = String(this.projectRow()!.id)
      const chapterRow = this.row(this.database.prepare('SELECT id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?').get(projectId, input.legacyChapterId))
      const chapter = this.formalChapterRecord(input.legacyChapterId, true)
      if (!chapter || !chapterRow) throw new AppError('NOT_FOUND', '写作候选对应章节不存在。', { recoverable: true })
      this.assertWritingArtifactProvenance(projectId, String(chapterRow.id), input.legacyChapterId, task, artifact)
      const contentHash = hashText(input.content)
      const priorApplication = this.row(this.database.prepare(`
        SELECT versions.id, versions.content_hash, versions.generation_artifact_id
        FROM body_versions versions
        JOIN chapters ON chapters.id = versions.chapter_id
        WHERE versions.source_task_run_id = ? AND chapters.project_id = ?
      `).get(input.taskRunId, projectId))
      if (artifact.status === 'applied') {
        if (!priorApplication || String(priorApplication.id) !== chapter.currentVersionId || String(priorApplication.content_hash) !== contentHash
          || String(priorApplication.generation_artifact_id) !== artifact.id) {
          throw new AppError('CONFLICT', '这份候选已经结算，不能再次改写正文。', { recoverable: true })
        }
        const timestamp = this.now().toISOString()
        const mirror = this.prepareChapterMirror(projectId, String(chapterRow.id), input.legacyChapterId, chapter.currentVersionId, chapter.title, chapter.content, chapter.contentHash, timestamp)
        return { chapter, mirror, insertedVersion: false, artifact }
      }
      if (!allowedSource || priorApplication) {
        throw new AppError('CONFLICT', '只有未采用的已完成候选或可恢复片段可以建立正文版本。', { recoverable: true })
      }
      this.updateGenerationArtifactStatus(artifact.id, 'applied', input.metadataJson)
      const written = this.writeFormalChapterInTransaction({
        legacyChapterId: input.legacyChapterId,
        title: input.title,
        content: input.content,
        reason: 'ai',
        expectedRevision: input.expectedRevision,
        sourceTaskRunId: input.taskRunId,
        generationArtifactId: artifact.id
      })
      if (!written.insertedVersion || !written.chapter.currentVersionId) {
        throw new AppError('CONFLICT', '候选没有产生新的正文版本，未记录为已采用。', { recoverable: true })
      }
      const applied = this.updateGenerationArtifactStatus(artifact.id, 'applied', JSON.stringify({
        ...JSON.parse(input.metadataJson),
        appliedBodyVersionId: written.chapter.currentVersionId,
        appliedAt: this.now().toISOString()
      }))
      return { ...written, artifact: applied }
    })
  }

  createFormalChapter(minimumId = 1): WorkspaceChapterWriteResult {
    return this.manuscriptTransaction({ name: 'createFormalChapter', args: [minimumId] }, () => {
      this.assertFormal()
      if (!Number.isSafeInteger(minimumId) || minimumId < 1 || minimumId > 1_000_000) throw new AppError('VALIDATION_ERROR', '章节保留编号无效。', { recoverable: true })
      const projectId = String(this.projectRow()!.id)
      let largest = Math.max(minimumId - 1, Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(legacy_chapter_id), 0) AS value FROM chapters WHERE project_id = ?').get(projectId), 'value')))
      // Include archived outlines and manuscripts: their stable identities may be restored later.
      for (const row of this.database.prepare("SELECT legacy_key FROM outline_nodes WHERE project_id = ? AND legacy_key LIKE 'chapter-%'").all(projectId)) {
        const match = /^chapter-([1-9]\d*)$/.exec(String(row.legacy_key))
        if (match) largest = Math.max(largest, Number(match[1]))
      }
      if (!Number.isSafeInteger(largest) || largest >= 1_000_000) throw new AppError('CONFLICT', '章节编号已达到支持范围，未创建正文。', { recoverable: true })
      return this.writeFormalChapterInTransaction({ legacyChapterId: largest + 1, title: '未命名', content: '', reason: 'manual' })
    })
  }

  startChapterFromOutline(chapterId: number, expectedRevision: string): { chapter: WorkspaceChapterRecord; created: boolean; mirror: WorkspaceMirrorPlan | null } {
    return this.manuscriptTransaction({ name: 'startChapterFromOutline', args: [chapterId, expectedRevision] }, () => {
      if (!Number.isSafeInteger(chapterId) || chapterId < 1 || !isSha256(expectedRevision)) throw new AppError('VALIDATION_ERROR', '章纲身份或版本无效。', { recoverable: true })
      const outline = this.formalOutlines().find(node => node.legacyKey === `chapter-${chapterId}`)
      if (!outline) throw new AppError('NOT_FOUND', '章纲不存在或已归档，未创建正文。', { recoverable: true })
      const projectId = String(this.projectRow()!.id)
      const stored = this.row(this.database.prepare('SELECT status FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?').get(projectId, chapterId))
      if (stored?.status === 'archived') throw new AppError('CONFLICT', '对应正文已在回收站，请先处理原稿，不能自动重建。', { recoverable: true })
      // Retrying after a lost response opens the existing chapter without replacing any written text.
      if (stored) return { chapter: this.formalChapterRecord(chapterId)!, created: false, mirror: null }
      if (outline.revision !== expectedRevision) throw new AppError('CONFLICT', '章纲已经变化，请重新读取并确认。', { recoverable: true })
      if (!outline.content.trim()) throw new AppError('CONFLICT', '请先保存非空章纲，再开始正文。', { recoverable: true })
      const result = this.writeFormalChapterInTransaction({ legacyChapterId: chapterId, title: outline.title, content: '', reason: 'manual' })
      return { chapter: result.chapter, created: true, mirror: result.mirror }
    })
  }

  private writeFormalChapterInTransaction(input: WorkspaceChapterWriteInput): WorkspaceChapterWriteResult {
    this.assertFormal()
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1 || !input.title.trim()) {
      throw new AppError('VALIDATION_ERROR', 'SQLite 章节写入参数无效。', { recoverable: true })
    }
    const timestamp = this.now().toISOString()
    let result!: WorkspaceChapterWriteResult
    {
      const project = this.projectRow()!
      const projectId = String(project.id)
      const stored = this.row(this.database.prepare(`
        SELECT id, current_body_version_id, confirmed_body_version_id, status FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?
      `).get(projectId, input.legacyChapterId))
      let current = stored ? this.formalChapterRecord(input.legacyChapterId, true) : undefined
      const fileBaseline = current && stored?.status !== 'archived' && this.textAuthority() === 'files-v1'
        ? this.fileWriteBaseline(String(stored!.id), 'body', input.reason === 'restore') : null
      const currentRevision = fileBaseline
        ? chapterRevision(input.legacyChapterId, fileBaseline.title, fileBaseline.content) : current?.revision
      if (input.expectedRevision && currentRevision !== input.expectedRevision) {
        throw new AppError('CONFLICT', current
          ? 'SQLite 中的正文已经更新，岚笺没有覆盖较新的版本。当前草稿仍保留在编辑器中。'
          : 'SQLite 中的章节已经移除，岚笺没有重新建立它。当前草稿仍保留在编辑器中。', {
          recoverable: true,
          details: { area: 'manuscript', reason: current ? 'database-change' : 'missing', chapterId: input.legacyChapterId, expectedRevision: input.expectedRevision, externalChapter: current ?? null }
        })
      }
      if (input.reason === 'ai' && fileBaseline && current?.contentHash !== fileBaseline.hash) {
        throw new AppError('CONFLICT', '当前文件尚未固定为写作基线，请先保存当前稿再重新生成候选。', { recoverable: true })
      }
      const chapterId = stored ? String(stored.id) : deterministicChapterId(projectId, input.legacyChapterId)
      let importedExternal = false
      if (fileBaseline?.external && current) {
        if (!input.expectedRevision || input.reason === 'ai') throw new AppError('CONFLICT', '正文已被外部修改，请先重新读取并核对当前稿。', { recoverable: true })
        // The exact external bytes become an explicit predecessor, so saving a
        // further edit cannot erase the author's external revision from history.
        const externalVersionId = this.id()
        const versionNo = Number(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM body_versions WHERE chapter_id = ?').get(chapterId)!.n)
        this.database.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, source_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`).run(externalVersionId, chapterId, versionNo, this.storeText(fileBaseline.content), fileBaseline.hash, current.currentVersionId, timestamp)
        this.database.prepare(`INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES (?, ?, 'manual', '外部文件修订')`)
          .run(externalVersionId, fileBaseline.title)
        this.writeDocumentChunks(projectId, chapterId, externalVersionId, fileBaseline.content, timestamp)
        this.database.prepare("UPDATE chapters SET title = ?, status = 'draft', current_body_version_id = ?, updated_at = ? WHERE id = ?")
          .run(fileBaseline.title, externalVersionId, timestamp, chapterId)
        if (!stored?.confirmed_body_version_id || stored.confirmed_body_version_id !== current.currentVersionId) {
          this.markBodyVersionDependentsStale(chapterId, current.currentVersionId, current.contentHash, externalVersionId, fileBaseline.hash, timestamp)
        }
        current = { ...current, title: fileBaseline.title, content: fileBaseline.content, contentHash: fileBaseline.hash,
          currentVersionId: externalVersionId, revision: currentRevision! }
        this.fileExpectedHashes.set(fileBaseline.relativePath, fileBaseline.hash)
        importedExternal = true
      }
      if (!stored) {
        const seq = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS value FROM chapters WHERE project_id = ?').get(projectId), 'value'))
        this.database.prepare(`
          INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, current_body_version_id, confirmed_body_version_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?)
        `).run(chapterId, projectId, input.legacyChapterId, seq, input.title, timestamp, timestamp)
        const lifecycle = initialChapterLifecycle(Boolean(input.content))
        this.database.prepare(`
          INSERT INTO chapter_workflows (chapter_id, lifecycle_status, archived_from_status, updated_at)
          VALUES (?, ?, NULL, ?)
        `).run(chapterId, lifecycle.status, timestamp)
      }
      if (Boolean(input.sourceTaskRunId) !== Boolean(input.generationArtifactId)) {
        throw new AppError('VALIDATION_ERROR', 'AI 正文版本必须同时记录任务与具体 Artifact。', { recoverable: true })
      }
      if (input.sourceTaskRunId && input.generationArtifactId) {
        if (input.reason !== 'ai' || !input.expectedRevision) throw new AppError('VALIDATION_ERROR', 'AI 来源只能用于带版本核对的 AI 正文。', { recoverable: true })
        const task = this.taskRun(input.sourceTaskRunId)
        const sourceRow = this.row(this.database.prepare('SELECT * FROM generation_artifacts WHERE id = ? AND task_run_id = ?').get(input.generationArtifactId, input.sourceTaskRunId))
        const artifact = sourceRow ? this.generationArtifactRecord(sourceRow) : null
        if (!task || !artifact || artifact.status !== 'applied') {
          throw new AppError('CONFLICT', 'AI 任务或具体候选不存在，或尚未由作者采用。', { recoverable: true })
        }
        this.assertWritingArtifactProvenance(projectId, chapterId, input.legacyChapterId, task, artifact)
      } else if (input.reason === 'ai') {
        throw new AppError('VALIDATION_ERROR', 'AI 正文版本缺少可追溯的任务与 Artifact。', { recoverable: true })
      }
      const contentHash = hashText(input.content)
      const changed = !current || current.title !== input.title || current.content !== input.content || stored?.status === 'archived'
        || (this.textAuthority() === 'files-v1' && input.reason === 'restore')
      const revisionLabel = input.label?.trim()
      if (input.label !== undefined && (!revisionLabel || revisionLabel.length > 80)) {
        throw new AppError('VALIDATION_ERROR', '版本名称应为 1 到 80 个字符。', { recoverable: true })
      }
      let versionId = current?.currentVersionId
      if (changed) {
        versionId = this.id()
        const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM body_versions WHERE chapter_id = ?').get(chapterId), 'value'))
        this.database.prepare(`
          INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, generation_artifact_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(versionId, chapterId, versionNo, this.storeText(input.content), contentHash, current?.currentVersionId ?? null, input.restoredFromVersionId ?? null, input.reason, input.sourceTaskRunId ?? null, input.generationArtifactId ?? null, timestamp)
        this.writeDocumentChunks(projectId, chapterId, versionId, input.content, timestamp)
        this.database.prepare(`INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES (?, ?, ?, ?)`).run(versionId, input.title, input.reason, revisionLabel ?? null)
        this.database.prepare(`
          UPDATE chapters SET title = ?, status = 'draft', current_body_version_id = ?, updated_at = ? WHERE id = ?
        `).run(input.title, versionId, timestamp, chapterId)
        if (!stored?.confirmed_body_version_id || stored.confirmed_body_version_id !== current?.currentVersionId) {
          this.markBodyVersionDependentsStale(
            chapterId,
            current?.currentVersionId ?? null,
            current?.contentHash ?? null,
            versionId,
            contentHash,
            timestamp
          )
        }
        this.moveLifecycleForBodyWrite(chapterId, Boolean(input.content), timestamp)
      }
      if (!versionId) throw this.integrityError('SQLite 章节缺少当前正文版本。')
      if (input.reason !== 'autosave') this.discardStagedAutosaveCheckpoints(chapterId, timestamp)
      const mirror = this.prepareChapterMirror(projectId, chapterId, input.legacyChapterId, versionId, input.title, input.content, contentHash, timestamp)
      result = { chapter: this.formalChapterRecord(input.legacyChapterId)!, mirror, insertedVersion: changed || importedExternal }
    }
    return result
  }

  private assertWritingArtifactProvenance(
    projectId: string,
    chapterId: string,
    legacyChapterId: number,
    task: WorkspaceTaskRunRecord,
    artifact: WorkspaceGenerationArtifactRecord
  ): void {
    if (task.projectId !== projectId || task.legacyChapterId !== legacyChapterId || task.taskType !== 'writing_agent'
      || artifact.taskRunId !== task.id || artifact.baseBodyVersionId !== task.baseBodyVersionId || !task.baseBodyVersionId
      || !task.contentHash) {
      throw new AppError('CONFLICT', '写作候选的任务、作品、章节或基线不一致。', { recoverable: true })
    }
    const base = this.row(this.database.prepare(`
      SELECT content, content_hash FROM body_versions WHERE id = ? AND chapter_id = ?
    `).get(task.baseBodyVersionId, chapterId))
    if (!base || String(base.content_hash) !== task.contentHash) {
      throw new AppError('CONFLICT', '写作候选绑定的正文基线不存在或指纹不一致。', { recoverable: true })
    }
    try {
      const checkpoint = JSON.parse(task.checkpointJson) as Record<string, unknown>
      const request = checkpoint.request as Record<string, unknown> | undefined
      if (checkpoint.workItemId !== this.projectRow()?.prompt_work_item_id || !request || request.chapterId !== legacyChapterId
        || typeof request.currentDraft !== 'string' || request.currentDraft !== this.readStoredText(base.content, base.content_hash)
        || hashText(request.currentDraft) !== task.contentHash) {
        throw new Error('task checkpoint scope or base mismatch')
      }
      const expectedAnchor = {
        version: 1,
        ...(request.selection !== undefined ? { selection: request.selection } : {}),
        ...(request.insertionAnchor !== undefined ? { insertionAnchor: request.insertionAnchor } : {})
      }
      const hasAnchor = request.selection !== undefined || request.insertionAnchor !== undefined
      if (!hasAnchor && artifact.selectionAnchorJson !== null) throw new Error('unexpected artifact anchor')
      if (hasAnchor) {
        if (!artifact.selectionAnchorJson) throw new Error('missing artifact anchor')
        const storedAnchor = JSON.parse(artifact.selectionAnchorJson) as Record<string, unknown>
        const allowedKeys = new Set(['version', 'selection', 'insertionAnchor'])
        if (Object.keys(storedAnchor).some((key) => !allowedKeys.has(key))
          || JSON.stringify(storedAnchor) !== JSON.stringify(expectedAnchor)) throw new Error('artifact anchor mismatch')
      }
    } catch (error) {
      throw new AppError('CONFLICT', '写作候选的作品、章节、基线或选区锚点校验失败。', { recoverable: true, cause: error })
    }
  }

  stageAutosaveCheckpoint(input: WorkspaceAutosaveCheckpointStageInput): WorkspaceAutosaveCheckpointStageResult {
    this.assertFormal()
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '自动保存章节身份无效。', { recoverable: true })
    assertBoundedIdentifier(input.clientOperationId, '自动保存操作 ID')
    assertBoundedIdentifier(input.baseBodyVersionId, '自动保存基线版本 ID')
    assertBoundedText(input.title, '章节标题', 2_000)
    if (typeof input.content !== 'string' || input.content.length > 5_000_000) throw new AppError('VALIDATION_ERROR', '自动保存正文无效或超过容量限制。', { recoverable: true })
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    const projectId = String(project.id)
    const configuredWindow = Number(project.autosave_merge_window_ms ?? WORKSPACE_AUTOSAVE_CHECKPOINT_WINDOW_MS)
    const mergeWindowMs = input.mergeWindowMs ?? configuredWindow
    if (!Number.isSafeInteger(mergeWindowMs) || mergeWindowMs < 1_000 || mergeWindowMs > 600_000) {
      throw new AppError('VALIDATION_ERROR', '自动保存版本合并窗口必须在 1000 到 600000 毫秒之间。', { recoverable: true })
    }
    const contentHash = hashText(input.content)
    const payloadHash = hashText(JSON.stringify({
      legacyChapterId: input.legacyChapterId,
      baseBodyVersionId: input.baseBodyVersionId,
      title: input.title,
      contentHash,
      mergeWindowMs
    }))
    let result!: WorkspaceAutosaveCheckpointStageResult
    this.manuscriptTransaction({ name: 'stageAutosaveCheckpoint', args: [input] }, () => {
      const existingOperation = this.row(this.database.prepare(`
        SELECT operations.payload_hash, operations.checkpoint_id
        FROM autosave_checkpoint_operations operations
        WHERE operations.project_id = ? AND operations.client_operation_id = ?
      `).get(projectId, input.clientOperationId))
      if (existingOperation) {
        if (existingOperation.payload_hash !== payloadHash) throw new AppError('CONFLICT', '自动保存操作 ID 已用于另一份内容，未覆盖原检查点。', { recoverable: true })
        const checkpoint = this.autosaveCheckpointRecord(String(existingOperation.checkpoint_id))
        if (!checkpoint) throw this.integrityError('自动保存操作指向不存在的检查点。')
        result = { checkpoint, merged: checkpoint.operationCount > 1, idempotent: true }
        return
      }
      const chapter = this.row(this.database.prepare(`
        SELECT chapters.id, chapters.current_body_version_id, chapters.confirmed_body_version_id
        FROM chapters
        WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
      `).get(projectId, input.legacyChapterId))
      if (!chapter?.current_body_version_id) throw new AppError('NOT_FOUND', '自动保存对应的章节或正文基线不存在。', { recoverable: true })
      const chapterId = String(chapter.id)
      const base = this.row(this.database.prepare('SELECT id FROM body_versions WHERE id = ? AND chapter_id = ?').get(input.baseBodyVersionId, chapterId))
      if (!base) throw new AppError('VALIDATION_ERROR', '自动保存基线不属于当前章节。', { recoverable: true })
      const currentBodyVersionId = String(chapter.current_body_version_id)
      const timestamp = this.now().toISOString()
      const conflict = currentBodyVersionId !== input.baseBodyVersionId
      let checkpointId: string
      let merged = false
      if (!conflict) {
        const mergeTarget = this.row(this.database.prepare(`
          SELECT id, content_hash FROM autosave_checkpoints
          WHERE project_id = ? AND chapter_id = ? AND base_body_version_id = ? AND status = 'staged'
            AND merge_window_ms = ? AND window_started_at <= ? AND window_ends_at >= ?
          ORDER BY window_started_at DESC LIMIT 1
        `).get(projectId, chapterId, input.baseBodyVersionId, mergeWindowMs, timestamp, timestamp))
        if (mergeTarget) {
          checkpointId = String(mergeTarget.id)
          if (mergeTarget.content_hash !== contentHash) this.supersededAutosaveTexts.add(String(mergeTarget.content_hash))
          const windowEndsAt = new Date(Date.parse(timestamp) + mergeWindowMs).toISOString()
          this.database.prepare(`
            UPDATE autosave_checkpoints SET latest_client_operation_id = ?, title = ?, content = ?, content_hash = ?,
              window_started_at = ?, window_ends_at = ?, last_staged_at = ?, updated_at = ? WHERE id = ?
          `).run(
            input.clientOperationId, input.title, this.storeText(input.content, true), contentHash,
            timestamp, windowEndsAt, timestamp, timestamp, checkpointId
          )
          merged = true
        } else {
          checkpointId = this.id()
          const windowEndsAt = new Date(Date.parse(timestamp) + mergeWindowMs).toISOString()
          this.database.prepare(`
            INSERT INTO autosave_checkpoints (
              id, project_id, chapter_id, latest_client_operation_id, base_body_version_id, title, content, content_hash,
              status, merge_window_ms, window_started_at, window_ends_at, last_staged_at,
              conflict_current_body_version_id, finalized_body_version_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?, ?, NULL, NULL, ?, ?)
          `).run(
            checkpointId, projectId, chapterId, input.clientOperationId, input.baseBodyVersionId, input.title,
            this.storeText(input.content, true), contentHash, mergeWindowMs, timestamp, windowEndsAt, timestamp, timestamp, timestamp
          )
        }
      } else {
        checkpointId = this.id()
        const windowEndsAt = new Date(Date.parse(timestamp) + mergeWindowMs).toISOString()
        this.database.prepare(`
          INSERT INTO autosave_checkpoints (
            id, project_id, chapter_id, latest_client_operation_id, base_body_version_id, title, content, content_hash,
            status, merge_window_ms, window_started_at, window_ends_at, last_staged_at,
            conflict_current_body_version_id, finalized_body_version_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conflict', ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
          checkpointId, projectId, chapterId, input.clientOperationId, input.baseBodyVersionId, input.title,
          this.storeText(input.content, true), contentHash, mergeWindowMs, timestamp, windowEndsAt, timestamp, currentBodyVersionId, timestamp, timestamp
        )
      }
      this.database.prepare(`
        INSERT INTO autosave_checkpoint_operations (
          id, project_id, chapter_id, checkpoint_id, client_operation_id, payload_hash, staged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(this.id(), projectId, chapterId, checkpointId, input.clientOperationId, payloadHash, timestamp)
      const checkpoint = this.autosaveCheckpointRecord(checkpointId)
      if (!checkpoint) throw this.integrityError('自动保存检查点暂存后无法读取。')
      if (this.textAuthority() === 'files-v1' && !conflict) {
        // Current text is durable immediately; the stable body version remains
        // the history baseline until the idle window is finalized.
        this.prepareChapterMirror(projectId, chapterId, input.legacyChapterId, currentBodyVersionId,
          input.title, input.content, contentHash, timestamp)
      }
      result = { checkpoint, merged, idempotent: false }
    })
    return result
  }

  finalizeAutosaveCheckpoint(checkpointId: string): WorkspaceAutosaveCheckpointFinalizeResult {
    this.assertFormal()
    assertBoundedIdentifier(checkpointId, '自动保存检查点 ID')
    let result!: WorkspaceAutosaveCheckpointFinalizeResult
    this.manuscriptTransaction({ name: 'finalizeAutosaveCheckpoint', args: [checkpointId] }, () => {
      const checkpoint = this.autosaveCheckpointRecord(checkpointId)
      if (!checkpoint) throw new AppError('NOT_FOUND', '自动保存检查点不存在。', { recoverable: true })
      if (checkpoint.status !== 'staged') {
        const chapter = checkpoint.status === 'finalized' ? this.formalChapterRecord(checkpoint.legacyChapterId, true) ?? null : null
        result = { checkpoint, chapter, mirror: null, insertedVersion: checkpoint.status === 'finalized' && checkpoint.finalizedBodyVersionId !== checkpoint.baseBodyVersionId }
        return
      }
      const projectId = String(this.projectRow()!.id)
      const chapterRow = this.row(this.database.prepare(`
        SELECT chapters.id, chapters.current_body_version_id
        FROM chapters WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ?
      `).get(projectId, checkpoint.legacyChapterId))
      if (!chapterRow?.current_body_version_id) throw this.integrityError('自动保存检查点对应章节缺少当前正文版本。')
      const chapterId = String(chapterRow.id)
      const currentBodyVersionId = String(chapterRow.current_body_version_id)
      const timestamp = this.now().toISOString()
      if (currentBodyVersionId !== checkpoint.baseBodyVersionId) {
        this.database.prepare(`
          UPDATE autosave_checkpoints SET status = 'conflict', conflict_current_body_version_id = ?, updated_at = ? WHERE id = ?
        `).run(currentBodyVersionId, timestamp, checkpointId)
        result = { checkpoint: this.autosaveCheckpointRecord(checkpointId)!, chapter: null, mirror: null, insertedVersion: false }
        return
      }
      const current = this.formalChapterRecord(checkpoint.legacyChapterId, true)
      if (!current) throw this.integrityError('自动保存检查点对应正文无法读取。')
      const newerCheckpoint = this.textAuthority() === 'files-v1' ? this.database.prepare(`
        SELECT content_hash, title FROM autosave_checkpoints WHERE chapter_id = ? AND id <> ?
          AND status = 'staged' AND base_body_version_id = ? AND window_started_at >= ?
        ORDER BY last_staged_at DESC LIMIT 1
      `).get(chapterId, checkpointId, checkpoint.baseBodyVersionId, checkpoint.windowEndsAt) : undefined
      if (newerCheckpoint) {
        const file = this.currentChapterFile(checkpoint.legacyChapterId)
        if (file.external || file.hash !== newerCheckpoint.content_hash || file.title !== newerCheckpoint.title) {
          throw new AppError('CONFLICT', '后续自动保存稿件已变化，未用较早检查点覆盖它。', { recoverable: true })
        }
      }
      let versionId = currentBodyVersionId
      let mirror: WorkspaceMirrorPlan | null = null
      let insertedVersion = false
      if (current.title !== checkpoint.title || current.content !== checkpoint.content) {
        versionId = this.id()
        const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM body_versions WHERE chapter_id = ?').get(chapterId), 'value'))
        this.database.prepare(`
          INSERT INTO body_versions (
            id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id,
            source_type, source_task_run_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'autosave', NULL, ?)
        `).run(versionId, chapterId, versionNo, this.storeText(checkpoint.content), checkpoint.contentHash, currentBodyVersionId, timestamp)
        this.writeDocumentChunks(projectId, chapterId, versionId, checkpoint.content, timestamp)
        this.database.prepare(`INSERT INTO body_version_metadata (version_id, title, reason) VALUES (?, ?, 'autosave')`).run(versionId, checkpoint.title)
        this.database.prepare(`UPDATE chapters SET title = ?, status = 'draft', current_body_version_id = ?, updated_at = ? WHERE id = ?`)
          .run(checkpoint.title, versionId, timestamp, chapterId)
        if (!chapterRow.confirmed_body_version_id || chapterRow.confirmed_body_version_id !== currentBodyVersionId) {
          this.markBodyVersionDependentsStale(
            chapterId,
            currentBodyVersionId,
            current.contentHash,
            versionId,
            checkpoint.contentHash,
            timestamp
          )
        }
        this.moveLifecycleForBodyWrite(chapterId, Boolean(checkpoint.content), timestamp)
        mirror = newerCheckpoint ? null : this.prepareChapterMirror(
          projectId, chapterId, checkpoint.legacyChapterId, versionId,
          checkpoint.title, checkpoint.content, checkpoint.contentHash, timestamp
        )
        insertedVersion = true
      }
      this.database.prepare(`
        UPDATE autosave_checkpoints SET status = 'finalized', conflict_current_body_version_id = NULL,
          finalized_body_version_id = ?, updated_at = ? WHERE id = ?
      `).run(versionId, timestamp, checkpointId)
      // The renderer can stage the next merge window a few milliseconds before
      // this expired checkpoint finishes. Both drafts then legitimately share
      // the old base: the newer checkpoint is the continuation of this one, not
      // an independent edit. Rebase that rollover atomically before the general
      // stale-checkpoint guard runs, otherwise normal typing becomes a false
      // recovery conflict.
      this.database.prepare(`
        UPDATE autosave_checkpoints
        SET base_body_version_id = ?, conflict_current_body_version_id = NULL, updated_at = ?
        WHERE project_id = ? AND chapter_id = ? AND id <> ? AND status = 'staged'
          AND base_body_version_id = ? AND window_started_at >= ?
      `).run(
        versionId, timestamp, projectId, chapterId, checkpointId,
        checkpoint.baseBodyVersionId, checkpoint.windowEndsAt
      )
      this.database.prepare(`
        UPDATE autosave_checkpoints SET status = 'conflict', conflict_current_body_version_id = ?, updated_at = ?
        WHERE project_id = ? AND chapter_id = ? AND id <> ? AND status = 'staged' AND base_body_version_id <> ?
      `).run(versionId, timestamp, projectId, chapterId, checkpointId, versionId)
      result = {
        checkpoint: this.autosaveCheckpointRecord(checkpointId)!,
        chapter: this.formalChapterRecord(checkpoint.legacyChapterId, true)!,
        mirror,
        insertedVersion
      }
    })
    return result
  }

  listAutosaveCheckpoints(legacyChapterId?: number): WorkspaceAutosaveCheckpointRecord[] {
    this.assertFormal()
    if (legacyChapterId !== undefined && (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1)) {
      throw new AppError('VALIDATION_ERROR', '自动保存章节身份无效。', { recoverable: true })
    }
    const projectId = String(this.projectRow()!.id)
    const rows = legacyChapterId === undefined ? this.rows(this.database.prepare(`
      SELECT checkpoints.id FROM autosave_checkpoints checkpoints
      WHERE checkpoints.project_id = ? ORDER BY checkpoints.updated_at DESC, checkpoints.id
    `).all(projectId)) : this.rows(this.database.prepare(`
      SELECT checkpoints.id FROM autosave_checkpoints checkpoints
      JOIN chapters ON chapters.id = checkpoints.chapter_id
      WHERE checkpoints.project_id = ? AND chapters.legacy_chapter_id = ?
      ORDER BY checkpoints.updated_at DESC, checkpoints.id
    `).all(projectId, legacyChapterId))
    return rows.map((row) => this.autosaveCheckpointRecord(String(row.id))).filter((record): record is WorkspaceAutosaveCheckpointRecord => Boolean(record))
  }

  discardAutosaveCheckpoint(checkpointId: string): WorkspaceAutosaveCheckpointRecord {
    this.assertFormal()
    assertBoundedIdentifier(checkpointId, '自动保存检查点 ID')
    const checkpoint = this.autosaveCheckpointRecord(checkpointId)
    if (!checkpoint) throw new AppError('NOT_FOUND', '自动保存检查点不存在。', { recoverable: true })
    if (checkpoint.status === 'discarded') return checkpoint
    if (checkpoint.status === 'finalized') throw new AppError('CONFLICT', '已经写入正文版本的自动保存检查点不能丢弃。', { recoverable: true })
    this.database.prepare(`UPDATE autosave_checkpoints SET status = 'discarded', updated_at = ? WHERE id = ?`)
      .run(this.now().toISOString(), checkpointId)
    return this.autosaveCheckpointRecord(checkpointId)!
  }

  createFactBatch(input: WorkspaceFactBatchCreateInput): WorkspaceFactBatchRecord {
    this.assertFormal()
    assertBoundedIdentifier(input.id, '事实批次 ID')
    assertBoundedIdentifier(input.bodyVersionId, '事实批次正文版本 ID')
    assertBoundedIdentifier(input.idempotencyKey, '事实批次幂等键')
    if (input.extractorTaskRunId) assertBoundedIdentifier(input.extractorTaskRunId, '事实抽取任务 ID')
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1 || !isSha256(input.contentHash)) {
      throw new AppError('VALIDATION_ERROR', '事实批次章节或正文指纹无效。', { recoverable: true })
    }
    assertJsonText(input.countsJson, 200_000, '事实批次数量摘要')
    if (!Array.isArray(input.changes) || input.changes.length > 5_000) {
      throw new AppError('VALIDATION_ERROR', '事实变化数量无效。', { recoverable: true })
    }
    const changeIds = new Set<string>()
    for (const change of input.changes) {
      assertFactChangeCreateInput(change)
      if (changeIds.has(change.id)) throw new AppError('VALIDATION_ERROR', '事实变化 ID 重复。', { recoverable: true })
      changeIds.add(change.id)
    }

    const projectId = String(this.projectRow()?.id ?? '')
    const existing = this.row(this.database.prepare('SELECT id FROM fact_batches WHERE project_id = ? AND idempotency_key = ?').get(projectId, input.idempotencyKey))
    if (existing) {
      const stored = this.factBatchRecord(String(existing.id))!
      if (!factBatchMatchesInput(stored, input)) throw new AppError('CONFLICT', '事实批次幂等键已用于另一份抽取结果。', { recoverable: true })
      return stored
    }

    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id,
        COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id) AS effective_body_version_id,
        versions.content_hash
      FROM chapters
      LEFT JOIN body_versions versions ON versions.id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (!chapter) throw new AppError('NOT_FOUND', '事实批次对应章节不存在。', { recoverable: true })
    if (chapter.effective_body_version_id !== input.bodyVersionId || chapter.content_hash !== input.contentHash) {
      throw new AppError('CONFLICT', '事实批次正文版本或指纹已经过期。', { recoverable: true })
    }
    if (input.extractorTaskRunId) {
      const task = this.row(this.database.prepare(`
        SELECT id FROM task_runs
        WHERE id = ? AND project_id = ? AND chapter_id = ? AND base_body_version_id = ? AND content_hash = ?
      `).get(input.extractorTaskRunId, projectId, String(chapter.id), input.bodyVersionId, input.contentHash))
      if (!task) throw new AppError('CONFLICT', '事实抽取任务与正文版本不匹配。', { recoverable: true })
    }

    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO fact_batches (
          id, project_id, chapter_id, body_version_id, content_hash, status,
          extractor_task_run_id, idempotency_key, counts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id, projectId, String(chapter.id), input.bodyVersionId, input.contentHash,
        input.changes.length ? 'PENDING' : 'APPROVED', input.extractorTaskRunId ?? null,
        input.idempotencyKey, input.countsJson, timestamp, timestamp
      )
      const insert = this.database.prepare(`
        INSERT INTO fact_changes (
          id, batch_id, candidate_type, subject_type, subject_id, subject_json, predicate, object_json,
          normalized_key, evidence_json, confidence, importance, change_type, review_class, decision_status,
          matched_fact_id, edited_object_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NULL, ?, ?)
      `)
      for (const change of input.changes) insert.run(
        change.id, input.id, change.candidateType, change.subjectType, change.subjectId ?? null,
        change.subjectJson, change.predicate, change.objectJson, change.normalizedKey, change.evidenceJson,
        change.confidence ?? null, change.importance, change.changeType, change.reviewClass, change.matchedFactId ?? null,
        timestamp, timestamp
      )
    })
    return this.factBatchRecord(input.id)!
  }

  listFactBatches(legacyChapterId?: number, statuses?: WorkspaceFactBatchStatus[]): WorkspaceFactBatchRecord[] {
    this.assertFormal()
    if (legacyChapterId !== undefined && (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1)) {
      throw new AppError('VALIDATION_ERROR', '事实批次章节无效。', { recoverable: true })
    }
    const selectedStatuses = statuses ?? []
    if (selectedStatuses.some((status) => !workspaceFactBatchStatuses.includes(status))) {
      throw new AppError('VALIDATION_ERROR', '事实批次状态筛选无效。', { recoverable: true })
    }
    const projectId = String(this.projectRow()?.id ?? '')
    const where = ['batches.project_id = ?']
    const params: Array<string | number> = [projectId]
    if (legacyChapterId !== undefined) {
      where.push('chapters.legacy_chapter_id = ?')
      params.push(legacyChapterId)
    }
    if (selectedStatuses.length) {
      where.push(`batches.status IN (${selectedStatuses.map(() => '?').join(', ')})`)
      params.push(...selectedStatuses)
    }
    return this.rows(this.database.prepare(`
      SELECT batches.id FROM fact_batches batches
      JOIN chapters ON chapters.id = batches.chapter_id
      WHERE ${where.join(' AND ')}
      ORDER BY batches.created_at DESC, batches.id DESC
      LIMIT 500
    `).all(...params)).map((row) => this.factBatchRecord(String(row.id))!)
  }

  decideFactChanges(input: WorkspaceFactDecisionInput): WorkspaceFactDecisionResult {
    this.assertFormal()
    assertBoundedIdentifier(input.batchId, '事实批次 ID')
    if (!Array.isArray(input.decisions) || !input.decisions.length || input.decisions.length > 1_000) {
      throw new AppError('VALIDATION_ERROR', '事实审批数量无效。', { recoverable: true })
    }
    const decisionIds = new Set<string>()
    const changeIds = new Set<string>()
    for (const decision of input.decisions) {
      assertBoundedIdentifier(decision.id, '事实审批 ID')
      assertBoundedIdentifier(decision.changeId, '事实变化 ID')
      if (!['APPROVED', 'REJECTED', 'DEFERRED'].includes(decision.decision)) throw new AppError('VALIDATION_ERROR', '事实审批决定无效。', { recoverable: true })
      if (decisionIds.has(decision.id) || changeIds.has(decision.changeId)) throw new AppError('VALIDATION_ERROR', '一次审批中存在重复决定。', { recoverable: true })
      decisionIds.add(decision.id)
      changeIds.add(decision.changeId)
      if (decision.decidedObjectJson !== undefined) assertJsonValueText(decision.decidedObjectJson, 512_000, '事实审批值')
      if (decision.decision === 'APPROVED') {
        if (!decision.sourceQuote?.trim()) throw new AppError('VALIDATION_ERROR', '批准事实必须保留正文依据。', { recoverable: true })
        assertBoundedText(decision.sourceQuote, '事实依据', 20_000)
        assertJsonText(decision.sourceSpanJson ?? '', 50_000, '事实依据位置')
      }
    }

    let createdFactIds: string[] = []
    this.transaction(() => {
      const batch = this.factBatchRecord(input.batchId)
      if (!batch) throw new AppError('NOT_FOUND', '事实批次不存在。', { recoverable: true })
      if (['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'].includes(batch.status)) {
        throw new AppError('CONFLICT', '事实批次已结束或已过期，不能继续审批。', { recoverable: true })
      }
      const body = this.row(this.database.prepare('SELECT content, content_hash FROM body_versions WHERE id = ?').get(batch.bodyVersionId))
      if (!body) throw this.integrityError('事实批次正文版本不存在。')
      const timestamp = this.now().toISOString()
      for (const decision of input.decisions) {
        const changeRow = this.row(this.database.prepare('SELECT * FROM fact_changes WHERE id = ? AND batch_id = ?').get(decision.changeId, input.batchId))
        if (!changeRow) throw new AppError('NOT_FOUND', '事实变化不属于当前批次。', { recoverable: true })
        const currentDecision = String(changeRow.decision_status) as WorkspaceFactChangeDecision
        if (currentDecision !== 'PENDING' && currentDecision !== 'DEFERRED') throw new AppError('CONFLICT', '事实变化已经完成审批。', { recoverable: true })
        const decidedObjectJson = decision.decidedObjectJson ?? String(changeRow.object_json)
        assertJsonValueText(decidedObjectJson, 512_000, '事实审批值')

        if (decision.decision === 'APPROVED') {
          const quote = decision.sourceQuote!.trim()
          if (!this.readStoredText(body.content, body.content_hash).includes(quote)) throw new AppError('CONFLICT', '批准事实的依据不在绑定的正文版本中。', { recoverable: true })
          const matchedFactId = changeRow.matched_fact_id ? String(changeRow.matched_fact_id) : null
          if (matchedFactId) {
            const successor = this.row(this.database.prepare('SELECT id FROM facts WHERE supersedes_fact_id = ? LIMIT 1').get(matchedFactId))
            if (successor) throw new AppError('CONFLICT', '匹配事实已经被后续批准事实替代，请重新抽取。', { recoverable: true })
          }
          const factId = this.id()
          const sourceId = this.id()
          this.database.prepare(`
            INSERT INTO facts (
              id, project_id, approved_change_id, primary_source_id, subject_type, subject_id,
              predicate, object_json, normalized_key, status, importance, supersedes_fact_id, approved_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?)
          `).run(
            factId, batch.projectId, decision.changeId, sourceId, String(changeRow.subject_type),
            changeRow.subject_id ? String(changeRow.subject_id) : null, String(changeRow.predicate), decidedObjectJson,
            String(changeRow.normalized_key), String(changeRow.importance), matchedFactId, timestamp, timestamp
          )
          this.database.prepare(`
            INSERT INTO fact_sources (id, fact_id, chapter_id, body_version_id, content_hash, quote, span_json, created_at)
            SELECT ?, ?, batches.chapter_id, batches.body_version_id, batches.content_hash, ?, ?, ?
            FROM fact_batches batches WHERE batches.id = ?
          `).run(sourceId, factId, quote, decision.sourceSpanJson!, timestamp, input.batchId)
          createdFactIds.push(factId)
        }

        this.database.prepare(`
          INSERT INTO fact_decisions (id, fact_change_id, decision, original_object_json, decided_object_json, decided_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(decision.id, decision.changeId, decision.decision, String(changeRow.object_json), decidedObjectJson, timestamp)
        this.database.prepare(`
          UPDATE fact_changes SET decision_status = ?, edited_object_json = ?, updated_at = ? WHERE id = ?
        `).run(decision.decision, decidedObjectJson === String(changeRow.object_json) ? null : decidedObjectJson, timestamp, decision.changeId)
      }

      const totals = this.row(this.database.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN decision_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN decision_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN decision_status = 'DEFERRED' THEN 1 ELSE 0 END) AS deferred,
          SUM(CASE WHEN decision_status = 'PENDING' THEN 1 ELSE 0 END) AS pending
        FROM fact_changes WHERE batch_id = ?
      `).get(input.batchId))!
      const total = Number(totals.total)
      const approved = Number(totals.approved)
      const rejected = Number(totals.rejected)
      const deferred = Number(totals.deferred)
      let status: WorkspaceFactBatchStatus
      if (total > 0 && approved === total) status = 'APPROVED'
      else if (total > 0 && rejected === total) status = 'REJECTED'
      else if (approved > 0 || rejected > 0) status = 'PARTIALLY_APPROVED'
      else if (deferred > 0) status = 'IN_REVIEW'
      else status = 'PENDING'
      if (!factBatchCanTransition(batch.status, status)) {
        throw new AppError('CONFLICT', `变化确认不能从 ${batch.status} 迁移到 ${status}。`, { recoverable: true })
      }
      this.database.prepare('UPDATE fact_batches SET status = ?, updated_at = ? WHERE id = ?').run(status, timestamp, input.batchId)
      this.rebuildCharacterSnapshotsInCurrentTransaction(timestamp)
    })
    return { batch: this.factBatchRecord(input.batchId)!, createdFactIds }
  }

  approvedFactsBefore(legacyChapterId: number, normalizedKeys?: string[]): WorkspaceApprovedFactRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '目标章节无效。', { recoverable: true })
    const keys = [...new Set((normalizedKeys ?? []).map((key) => key.trim()).filter(Boolean))]
    if (keys.length > 500 || keys.some((key) => key.length > 500)) throw new AppError('VALIDATION_ERROR', '批准事实筛选项无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const target = this.row(this.database.prepare('SELECT seq FROM chapters WHERE project_id = ? AND legacy_chapter_id = ? AND status <> ?').get(projectId, legacyChapterId, 'archived'))
    if (!target) throw new AppError('NOT_FOUND', '目标章节不存在。', { recoverable: true })
    const params: Array<string | number> = [projectId, Number(target.seq), Number(target.seq)]
    const keyFilter = keys.length ? `AND facts.normalized_key IN (${keys.map(() => '?').join(', ')})` : ''
    params.push(...keys)
    return this.rows(this.database.prepare(`
      WITH RECURSIVE replacements(descendant_id, ancestor_id) AS (
        SELECT id, supersedes_fact_id FROM facts WHERE supersedes_fact_id IS NOT NULL
        UNION
        SELECT replacements.descendant_id, ancestors.supersedes_fact_id
        FROM replacements JOIN facts ancestors ON ancestors.id = replacements.ancestor_id
        WHERE ancestors.supersedes_fact_id IS NOT NULL
      )
      SELECT facts.* FROM facts
      WHERE facts.project_id = ? AND facts.status = 'APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM replacements
          JOIN fact_sources successor_sources ON successor_sources.fact_id = replacements.descendant_id
          JOIN chapters successor_chapters ON successor_chapters.id = successor_sources.chapter_id
          WHERE replacements.ancestor_id = facts.id
            AND successor_chapters.status <> 'archived' AND successor_chapters.seq < ?
        )
        AND EXISTS (
          SELECT 1 FROM fact_sources sources
          JOIN chapters source_chapters ON source_chapters.id = sources.chapter_id
          WHERE sources.fact_id = facts.id AND source_chapters.status <> 'archived' AND source_chapters.seq < ?
        )
        ${keyFilter}
      ORDER BY facts.approved_at, facts.id
      LIMIT 2000
    `).all(...params)).map((fact) => {
      const sources = this.rows(this.database.prepare(`
        SELECT sources.*, chapters.legacy_chapter_id,
          CASE WHEN effective_versions.content_hash = sources.content_hash THEN 1 ELSE 0 END AS source_current
        FROM fact_sources sources
        JOIN chapters ON chapters.id = sources.chapter_id
        LEFT JOIN body_versions effective_versions ON effective_versions.id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
        WHERE sources.fact_id = ? AND chapters.status <> 'archived' AND chapters.seq < ?
        ORDER BY chapters.seq, sources.id
      `).all(String(fact.id), Number(target.seq))).map((source) => ({
        id: String(source.id),
        legacyChapterId: Number(source.legacy_chapter_id),
        bodyVersionId: String(source.body_version_id),
        contentHash: String(source.content_hash),
        quote: String(source.quote),
        spanJson: String(source.span_json),
        current: Number(source.source_current) === 1
      }))
      return {
        id: String(fact.id),
        subjectType: String(fact.subject_type),
        subjectId: fact.subject_id ? String(fact.subject_id) : null,
        predicate: String(fact.predicate),
        objectJson: String(fact.object_json),
        normalizedKey: String(fact.normalized_key),
        importance: String(fact.importance) as WorkspaceFactImportance,
        supersedesFactId: fact.supersedes_fact_id ? String(fact.supersedes_fact_id) : null,
        approvedAt: String(fact.approved_at),
        sourceCurrent: sources.every((source) => source.current),
        sources
      }
    })
  }

  chapterPlanning(legacyChapterId: number): WorkspaceChapterPlanningRecord {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) {
      throw new AppError('VALIDATION_ERROR', '章节身份无效。', { recoverable: true })
    }
    const row = this.row(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, chapters.current_body_version_id, chapters.confirmed_body_version_id,
        confirmed_versions.created_at AS body_confirmed_at,
        outlines.legacy_key AS outline_legacy_key, workflows.*
      FROM chapters
      JOIN chapter_workflows workflows ON workflows.chapter_id = chapters.id
      LEFT JOIN body_versions confirmed_versions ON confirmed_versions.id = chapters.confirmed_body_version_id
      LEFT JOIN outline_nodes outlines ON outlines.id = chapters.outline_node_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ?
    `).get(String(this.projectRow()?.id ?? ''), legacyChapterId))
    if (!row) throw new AppError('NOT_FOUND', `第 ${legacyChapterId} 章不存在`, { recoverable: true })
    return this.chapterPlanningRecord(row)
  }

  updateChapterPlanning(input: WorkspaceChapterPlanningWriteInput): WorkspaceChapterPlanningWriteResult {
    this.assertFormal()
    const current = this.chapterPlanning(input.legacyChapterId)
    let lifecycleStatus = current.lifecycleStatus
    let archivedFromStatus = current.archivedFromStatus
    if (input.lifecycleStatus) {
      if (!chapterLifecycleStates.includes(input.lifecycleStatus)) throw new AppError('VALIDATION_ERROR', '章节生命周期状态无效。', { recoverable: true })
      try {
        const transitioned = transitionChapterLifecycle({ status: current.lifecycleStatus, archivedFrom: current.archivedFromStatus }, input.lifecycleStatus)
        lifecycleStatus = transitioned.status
        archivedFromStatus = transitioned.archivedFrom
      } catch (error) {
        throw new AppError('CONFLICT', error instanceof Error ? error.message : '章节生命周期迁移无效。', { recoverable: true, cause: error })
      }
    }
    const card = normalizeWorkspaceChapterCard(current.card, input.card)
    const projectId = String(this.projectRow()!.id)
    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id, chapters.title, chapters.current_body_version_id, chapters.confirmed_body_version_id,
        current_versions.content, current_versions.content_hash,
        confirmed_versions.content_hash AS confirmed_content_hash
      FROM chapters
      LEFT JOIN body_versions current_versions ON current_versions.id = chapters.current_body_version_id
      LEFT JOIN body_versions confirmed_versions ON confirmed_versions.id = chapters.confirmed_body_version_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ?
    `).get(projectId, input.legacyChapterId))!
    let outlineNodeId: string | null | undefined
    if (input.outlineLegacyKey !== undefined) {
      if (input.outlineLegacyKey === null) outlineNodeId = null
      else {
        const outline = this.row(this.database.prepare(`
          SELECT nodes.id FROM outline_nodes nodes
          JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
          WHERE nodes.project_id = ? AND nodes.legacy_key = ? AND nodes.status <> 'archived' AND metadata.planning_kind = 'chapter'
        `).get(projectId, input.outlineLegacyKey))
        if (!outline) throw new AppError('CONFLICT', '章卡只能关联当前作品中未归档的章纲。', { recoverable: true })
        outlineNodeId = String(outline.id)
      }
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    let manuscriptMirror: WorkspaceMirrorPlan | null = null
    this.manuscriptTransaction({ name: 'updateChapterPlanning', args: [input] }, () => {
      if (outlineNodeId !== undefined) this.database.prepare('UPDATE chapters SET outline_node_id = ?, updated_at = ? WHERE id = ?').run(outlineNodeId, timestamp, String(chapter.id))
      this.database.prepare(`
        UPDATE chapter_workflows SET lifecycle_status = ?, archived_from_status = ?, card_status = ?, goal_text = ?,
          entry_state_text = ?, conflict_text = ?, pov_text = ?, narrative_distance_text = ?, exit_change_text = ?,
          hook_text = ?, card_json = ?, updated_at = ? WHERE chapter_id = ?
      `).run(
        lifecycleStatus, archivedFromStatus, card.status, card.goal, card.entryState, card.conflict,
        card.pointOfView, card.narrativeDistance, card.exitChange, card.hook,
        JSON.stringify({ beats: card.beats, characters: card.characters }), timestamp, String(chapter.id)
      )
      if (input.lifecycleStatus === 'CONFIRMED') {
        this.assertCurrentFileVersion(input.legacyChapterId)
        const content = this.readStoredText(chapter.content, chapter.content_hash)
        const contentHash = String(chapter.content_hash ?? '')
        const currentBodyVersionId = chapter.current_body_version_id ? String(chapter.current_body_version_id) : null
        if (!currentBodyVersionId || !content.trim() || !isSha256(contentHash)) {
          throw new AppError('CONFLICT', '正文为空，不能确认定稿。', { recoverable: true })
        }
        const confirmedVersionId = this.id()
        const versionNo = Number(this.scalar(this.database.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM body_versions WHERE chapter_id = ?').get(String(chapter.id)), 'value'))
        this.database.prepare(`
          INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, 'manual', NULL, ?)
        `).run(confirmedVersionId, String(chapter.id), versionNo, this.storeText(content), contentHash, currentBodyVersionId, timestamp)
        this.writeDocumentChunks(projectId, String(chapter.id), confirmedVersionId, content, timestamp)
        this.database.prepare(`
          INSERT INTO body_version_metadata (version_id, title, reason, label) VALUES (?, ?, 'manual', '确认定稿')
        `).run(confirmedVersionId, String(chapter.title))
        this.database.prepare(`
          UPDATE chapters SET status = 'confirmed', current_body_version_id = ?, confirmed_body_version_id = ?, updated_at = ? WHERE id = ?
        `).run(confirmedVersionId, confirmedVersionId, timestamp, String(chapter.id))
        const previousConfirmedId = chapter.confirmed_body_version_id ? String(chapter.confirmed_body_version_id) : null
        const previousConfirmedHash = chapter.confirmed_content_hash ? String(chapter.confirmed_content_hash) : null
        this.markBodyVersionDependentsStale(
          String(chapter.id), previousConfirmedId, previousConfirmedHash,
          confirmedVersionId, contentHash, timestamp
        )
        manuscriptMirror = this.prepareChapterMirror(
          projectId, String(chapter.id), input.legacyChapterId, confirmedVersionId,
          String(chapter.title), content, contentHash, timestamp
        )
      } else if (input.lifecycleStatus && current.lifecycleStatus === 'CONFIRMED') {
        this.database.prepare(`UPDATE chapters SET status = 'draft', updated_at = ? WHERE id = ?`).run(timestamp, String(chapter.id))
      }
      mirror = this.prepareChapterCardMirror(projectId, String(chapter.id), input.legacyChapterId, timestamp)
    })
    return { planning: this.chapterPlanning(input.legacyChapterId), mirror, manuscriptMirror }
  }

  reorderFormalChapter(legacyChapterId: number, position: number): WorkspaceMirrorPlan {
    this.assertFormal()
    const ids = this.activeChapterIds()
    const currentIndex = ids.indexOf(legacyChapterId)
    if (currentIndex < 0) throw new AppError('NOT_FOUND', `第 ${legacyChapterId} 章不存在`, { recoverable: true })
    if (!Number.isSafeInteger(position) || position < 1 || position > ids.length) {
      throw new AppError('VALIDATION_ERROR', `章序必须在 1 到 ${ids.length} 之间`, { recoverable: true })
    }
    ids.splice(currentIndex, 1)
    ids.splice(position - 1, 0, legacyChapterId)
    let plan!: WorkspaceMirrorPlan
    this.transaction(() => {
      const projectId = String(this.projectRow()!.id)
      const timestamp = this.now().toISOString()
      this.resequenceProject(projectId, ids)
      this.rebuildCharacterSnapshotsInCurrentTransaction(timestamp)
      plan = this.prepareOrderMirror(projectId, timestamp)
    })
    return plan
  }

  formalRevisions(legacyChapterId: number): WorkspaceBodyRevisionRecord[] {
    this.assertFormal()
    const chapter = this.formalChapterRecord(legacyChapterId)
    if (!chapter) throw new AppError('NOT_FOUND', `第 ${legacyChapterId} 章不存在`, { recoverable: true })
    return this.rows(this.database.prepare(`
      SELECT versions.id, versions.content, versions.content_hash, versions.created_at, versions.source_type,
             versions.source_task_run_id, versions.generation_artifact_id,
             metadata.title, metadata.reason, metadata.label,
             CASE WHEN versions.id = chapters.current_body_version_id THEN 1 ELSE 0 END AS is_current
      FROM body_versions versions
      JOIN chapters ON chapters.id = versions.chapter_id
      JOIN body_version_metadata metadata ON metadata.version_id = versions.id
      WHERE chapters.legacy_chapter_id = ?
      ORDER BY versions.version_no DESC
      LIMIT 500
    `).all(legacyChapterId)).map((row) => this.bodyRevisionRecord(row, legacyChapterId))
  }

  formalBodyVersion(legacyChapterId: number, versionId: string): WorkspaceChapterRecord {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '章节身份无效。', { recoverable: true })
    assertBoundedIdentifier(versionId, '正文版本 ID')
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, chapters.seq, metadata.title,
        versions.id AS current_body_version_id, versions.content, versions.content_hash,
        mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path
      FROM chapters
      JOIN body_versions versions ON versions.chapter_id = chapters.id
      JOIN body_version_metadata metadata ON metadata.version_id = versions.id
      JOIN mirror_entries mirrors ON mirrors.project_id = chapters.project_id
        AND mirrors.source_type = 'chapter_markdown' AND mirrors.source_id = chapters.id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND versions.id = ?
        AND chapters.status <> 'archived'
    `).get(projectId, legacyChapterId, versionId))
    if (!row) throw new AppError('NOT_FOUND', '正文版本不存在或不属于当前章节。', { recoverable: true })
    return this.chapterRecord(row)
  }

  nameCurrentFormalRevision(legacyChapterId: number, labelValue: string): WorkspaceBodyRevisionRecord {
    this.assertFormal()
    this.assertCurrentFileVersion(legacyChapterId)
    const label = labelValue.trim()
    if (!label || label.length > 80) throw new AppError('VALIDATION_ERROR', '版本名称应为 1 到 80 个字符。', { recoverable: true })
    let revision!: WorkspaceBodyRevisionRecord
    this.transaction(() => {
      const row = this.row(this.database.prepare(`
        SELECT versions.id, versions.content, versions.content_hash, versions.created_at, versions.source_type,
               versions.source_task_run_id, versions.generation_artifact_id,
               metadata.title, metadata.reason, metadata.label,
               CASE WHEN versions.id = chapters.current_body_version_id THEN 1 ELSE 0 END AS is_current
        FROM chapters
        JOIN body_versions versions ON versions.id = chapters.current_body_version_id
        JOIN body_version_metadata metadata ON metadata.version_id = versions.id
        WHERE chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
      `).get(legacyChapterId))
      if (!row) throw new AppError('NOT_FOUND', `第 ${legacyChapterId} 章还没有可命名的正式版本。`, { recoverable: true })
      this.database.prepare('UPDATE body_version_metadata SET label = ? WHERE version_id = ?').run(label, String(row.id))
      revision = this.bodyRevisionRecord({ ...row, label }, legacyChapterId)
    })
    return revision
  }

  restoreFormalRevision(legacyChapterId: number, publicRevisionId: string, expectedRevision?: string): WorkspaceChapterWriteResult {
    this.assertFormal()
    if (!/^\d{13}-[0-9a-f-]{36}$/i.test(publicRevisionId)) throw new AppError('VALIDATION_ERROR', '历史版本编号无效。', { recoverable: true })
    const versionId = publicRevisionId.slice(14)
    const row = this.row(this.database.prepare(`
      SELECT versions.id, versions.content, versions.content_hash, metadata.title
      FROM body_versions versions
      JOIN chapters ON chapters.id = versions.chapter_id
      JOIN body_version_metadata metadata ON metadata.version_id = versions.id
      WHERE chapters.legacy_chapter_id = ? AND versions.id = ?
    `).get(legacyChapterId, versionId))
    if (!row) throw new AppError('NOT_FOUND', '历史版本不存在。', { recoverable: true })
    return this.writeFormalChapter({
      legacyChapterId,
      title: String(row.title),
      content: this.readStoredText(row.content, row.content_hash),
      reason: 'restore',
      expectedRevision,
      restoredFromVersionId: versionId
    })
  }

  archiveFormalChapter(legacyChapterId: number): WorkspaceMirrorPlan {
    this.assertFormal()
    this.assertCurrentFileVersion(legacyChapterId)
    const chapter = this.formalChapterRecord(legacyChapterId)
    if (!chapter) throw new AppError('NOT_FOUND', `第 ${legacyChapterId} 章不存在`, { recoverable: true })
    let plan!: WorkspaceMirrorPlan
    this.manuscriptTransaction({ name: 'archiveFormalChapter', args: [legacyChapterId] }, () => {
      const projectId = String(this.projectRow()!.id)
      const timestamp = this.now().toISOString()
      const storedChapter = this.row(this.database.prepare('SELECT id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?').get(projectId, legacyChapterId))!
      const workflow = this.row(this.database.prepare('SELECT lifecycle_status FROM chapter_workflows WHERE chapter_id = ?').get(String(storedChapter.id)))
      if (workflow && workflow.lifecycle_status !== 'ARCHIVED') this.database.prepare(`
        UPDATE chapter_workflows SET lifecycle_status = 'ARCHIVED', archived_from_status = lifecycle_status, updated_at = ? WHERE chapter_id = ?
      `).run(timestamp, String(storedChapter.id))
      this.database.prepare(`UPDATE chapters SET status = 'archived', updated_at = ? WHERE project_id = ? AND legacy_chapter_id = ?`).run(timestamp, projectId, legacyChapterId)
      this.resequenceProject(projectId, this.activeChapterIds())
      this.rebuildCharacterSnapshotsInCurrentTransaction(timestamp)
      const mirror = this.row(this.database.prepare(`SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = 'chapter_markdown' AND source_id = ?`).get(projectId, deterministicChapterId(projectId, legacyChapterId)))
      if (!mirror) throw this.integrityError('待删除章节缺少 Markdown 镜像记录。')
      const sourceVersionId = this.id()
      const previous = this.previousMirrorState(mirror)
      this.database.prepare(`
        UPDATE mirror_entries SET source_version_id = ?, content_hash = ?, status = 'pending', last_error_code = NULL,
          previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?
      `).run(sourceVersionId, hashText(''), previous.relativePath, previous.observedHash, timestamp, String(mirror.id))
      plan = {
        action: 'delete', sourceType: 'chapter_markdown', sourceId: String(mirror.source_id), sourceVersionId,
        relativePath: String(mirror.relative_path), previousRelativePath: previous.relativePath,
        previousObservedHash: previous.observedHash, content: '', contentHash: hashText('')
      }
      this.prepareCurrentFile(plan, mirror)
      this.prepareOrderMirror(projectId, this.now().toISOString())
    })
    return plan
  }

  restoreArchivedFormalChapter(legacyChapterId: number): WorkspaceChapterWriteResult {
    this.assertFormal()
    const archived = this.formalArchivedChapters().find((chapter) => chapter.legacyChapterId === legacyChapterId)
    if (!archived) throw new AppError('NOT_FOUND', '回收站中没有这个章节。', { recoverable: true, details: { chapterId: legacyChapterId } })
    return this.manuscriptTransaction({ name: 'restoreArchivedFormalChapter', args: [legacyChapterId] }, () => {
      const projectId = String(this.projectRow()!.id)
      const activeCount = this.activeChapterIds().length
      const preferredPosition = Math.max(1, Math.min(archived.position, activeCount + 1))
      this.database.prepare(`
        UPDATE chapters SET seq = ? WHERE project_id = ? AND legacy_chapter_id = ? AND status = 'archived'
      `).run(activeCount + 1, projectId, legacyChapterId)
      const restored = this.writeFormalChapterInTransaction({
        legacyChapterId,
        title: archived.title,
        content: archived.content,
        reason: 'restore',
        expectedRevision: archived.revision
      })
      const ids = this.activeChapterIds()
      const currentIndex = ids.indexOf(legacyChapterId)
      ids.splice(currentIndex, 1)
      ids.splice(preferredPosition - 1, 0, legacyChapterId)
      const timestamp = this.now().toISOString()
      this.resequenceProject(projectId, ids)
      this.rebuildCharacterSnapshotsInCurrentTransaction(timestamp)
      this.prepareOrderMirror(projectId, timestamp)
      return { ...restored, chapter: this.formalChapterRecord(legacyChapterId)! }
    })
  }

  pendingMirrorPlans(filter?: WorkspaceMirrorPlanFilter): WorkspaceMirrorPlan[] {
    this.assertFormal()
    this.ensureCandidateGenerationMirrors()
    return this.filteredMirrorPlans(filter, true)
  }

  readableMirrorPlans(filter?: WorkspaceMirrorPlanFilter): WorkspaceMirrorPlan[] {
    this.assertFormal()
    return this.filteredMirrorPlans(filter, false)
  }

  private filteredMirrorPlans(filter: WorkspaceMirrorPlanFilter | undefined, pendingOnly: boolean): WorkspaceMirrorPlan[] {
    if (filter?.sourceTypes?.length === 0 || filter?.statuses?.length === 0) return []
    if (filter?.legacyChapterId !== undefined
      && (!Number.isSafeInteger(filter.legacyChapterId) || filter.legacyChapterId < 1)) {
      throw new AppError('VALIDATION_ERROR', '章节身份无效。', { recoverable: true })
    }
    const projectId = String(this.projectRow()!.id)
    const predicates = ['mirrors.project_id = ?']
    const parameters: Array<string> = [projectId]
    if (pendingOnly) predicates.push("mirrors.status <> 'synced'")
    if (filter?.sourceTypes?.length) {
      predicates.push(`mirrors.source_type IN (${filter.sourceTypes.map(() => '?').join(', ')})`)
      parameters.push(...filter.sourceTypes)
    }
    if (filter?.excludeSourceTypes?.length) {
      predicates.push(`mirrors.source_type NOT IN (${filter.excludeSourceTypes.map(() => '?').join(', ')})`)
      parameters.push(...filter.excludeSourceTypes)
    }
    if (filter?.sourceId !== undefined) {
      predicates.push('mirrors.source_id = ?')
      parameters.push(filter.sourceId)
    }
    if (filter?.sourceVersionId !== undefined) {
      predicates.push('mirrors.source_version_id = ?')
      parameters.push(filter.sourceVersionId)
    }
    if (filter?.legacyChapterId !== undefined) {
      predicates.push('chapters.legacy_chapter_id = ?')
      parameters.push(String(filter.legacyChapterId))
    }
    if (filter?.statuses?.length) {
      predicates.push(`mirrors.status IN (${filter.statuses.map(() => '?').join(', ')})`)
      parameters.push(...filter.statuses)
    }
    return this.rows(this.database.prepare(`
      SELECT mirrors.*, chapters.status AS chapter_status, chapters.legacy_chapter_id,
             bodies.content AS body_content, bodies.content_hash AS body_content_hash, outline_nodes.status AS outline_status,
             outline_versions.content AS outline_content, outline_versions.content_hash AS outline_content_hash
      FROM mirror_entries mirrors
      LEFT JOIN chapters ON mirrors.source_type = 'chapter_markdown' AND chapters.id = mirrors.source_id
      LEFT JOIN body_versions bodies ON bodies.id = mirrors.source_version_id
      LEFT JOIN outline_nodes ON mirrors.source_type = 'outline_markdown' AND outline_nodes.id = mirrors.source_id
      LEFT JOIN outline_versions ON outline_versions.id = mirrors.source_version_id
      WHERE ${predicates.join(' AND ')}
      ORDER BY ${pendingOnly ? 'mirrors.updated_at, mirrors.source_type, mirrors.source_id' : 'mirrors.source_type, mirrors.relative_path'}
    `).all(...parameters)).map((row) => this.mirrorPlanFromRow(row, projectId))
  }

  acknowledgeMirror(plan: WorkspaceMirrorPlan, status: WorkspaceMirrorStatus, observedHash?: string, errorCode?: string): void {
    this.assertFormal()
    if (!['pending', 'synced', 'conflict', 'failed'].includes(status)) throw new AppError('VALIDATION_ERROR', '镜像状态无效。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const current = this.row(this.database.prepare(`
      SELECT id, source_version_id FROM mirror_entries WHERE project_id = ? AND source_type = ? AND source_id = ?
    `).get(projectId, plan.sourceType, plan.sourceId))
    if (!current || current.source_version_id !== plan.sourceVersionId) return
    this.database.prepare(`
      UPDATE mirror_entries SET status = ?, observed_hash = ?, last_error_code = ?,
        previous_relative_path = CASE WHEN ? = 'synced' THEN NULL ELSE previous_relative_path END,
        previous_observed_hash = CASE WHEN ? = 'synced' THEN NULL ELSE previous_observed_hash END,
        updated_at = ? WHERE id = ?
    `).run(status, observedHash ?? null, errorCode ?? null, status, status, this.now().toISOString(), String(current.id))
  }

  assertRollbackReady(): void {
    this.assertFormal()
    const projectId = String(this.projectRow()!.id)
    const pending = Number(this.scalar(this.database.prepare(`SELECT COUNT(*) AS value FROM mirror_entries WHERE project_id = ? AND status <> 'synced'`).get(projectId), 'value'))
    if (pending) throw new AppError('CONFLICT', `仍有 ${pending} 项可读镜像尚未同步，不能退回文件模式。`, { recoverable: true, details: { area: 'workspaceDatabase', pendingMirrors: pending } })
    const recoverableCheckpoints = Number(this.scalar(this.database.prepare(`
      SELECT COUNT(*) AS value FROM autosave_checkpoints WHERE project_id = ? AND status IN ('staged', 'conflict')
    `).get(projectId), 'value'))
    if (recoverableCheckpoints) throw new AppError('CONFLICT', `仍有 ${recoverableCheckpoints} 份自动保存恢复草稿尚未处理，不能退回文件模式。`, {
      recoverable: true,
      details: { area: 'workspaceDatabase', recoverableCheckpoints }
    })
  }

  backupTo(targetPath: string): void {
    this.assertOpen()
    if (!targetPath) throw new AppError('VALIDATION_ERROR', '备份数据库目标无效。', { recoverable: true })
    this.database.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`)
  }

  reidentifyRestoredProject(projectName: string, projectManifestHash: string, workItemId: string): void {
    this.assertOpen()
    if (!projectName.trim() || !/^[0-9a-f]{64}$/.test(projectManifestHash) || !workItemId.trim()) {
      throw new AppError('VALIDATION_ERROR', '恢复副本身份无效。', { recoverable: true })
    }
    const project = this.projectRow()
    if (!project) throw this.integrityError('恢复副本缺少项目根记录。')
    const projectId = String(project.id)
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`UPDATE projects SET name = ?, legacy_manifest_hash = ?, updated_at = ? WHERE id = ?`)
        .run(projectName.trim(), projectManifestHash, timestamp, projectId)
      if (Number(project.character_state_ready ?? 0) === 1) {
        const document = this.characterState()
        const parsed = JSON.parse(document.content) as Record<string, unknown>
        const content = JSON.stringify({ ...parsed, workItemId: workItemId.trim() })
        this.database.prepare(`
          UPDATE character_state_documents
          SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
          WHERE project_id = ?
        `).run(content, hashText(content), timestamp, projectId)
        this.prepareCharacterStateMirror(projectId, timestamp)
      }
    }, 'write')
  }

  createTaskRun(input: WorkspaceTaskRunCreateInput): WorkspaceTaskRunRecord {
    // Idempotency, active-slot and continuation checks share the insertion lock;
    // another connection cannot pass the same checks before either INSERT.
    return this.transaction(() => this.createTaskRunInTransaction(input))
  }

  private createTaskRunInTransaction(input: WorkspaceTaskRunCreateInput): WorkspaceTaskRunRecord {
    this.assertOpen()
    assertBoundedIdentifier(input.id, '任务 ID')
    assertBoundedIdentifier(input.idempotencyKey, '任务幂等键')
    assertBoundedIdentifier(input.taskType, '任务类型')
    assertJsonText(input.checkpointJson, 512_000, '任务检查点')
    const initialStatus = input.initialStatus ?? 'queued'
    if (!['queued', 'resuming'].includes(initialStatus) || (initialStatus === 'resuming' && !input.parentTaskRunId)) {
      throw new AppError('VALIDATION_ERROR', '继续运行必须绑定原任务；新任务只能排队或继续。', { recoverable: true })
    }
    if (input.baseBodyVersionId) assertBoundedIdentifier(input.baseBodyVersionId, '任务正文版本 ID')
    if (input.contentHash && !isSha256(input.contentHash)) throw new AppError('VALIDATION_ERROR', '任务正文指纹无效。', { recoverable: true })
    if (input.modelConfigId && input.modelConfigId.length > 200) throw new AppError('VALIDATION_ERROR', '任务模型标识过长。', { recoverable: true })
    const taskContract = input.taskContract ?? createTaskContractSnapshot(input.taskType)
    assertTaskContractSnapshot(taskContract, input.taskType, false)
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目根记录。')
    const projectId = String(project.id)
    const chapter = input.legacyChapterId === undefined ? undefined : this.row(this.database.prepare(`
      SELECT id, current_body_version_id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ? AND status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (input.legacyChapterId !== undefined && !chapter) throw new AppError('NOT_FOUND', 'AI 任务对应的章节不存在。', { recoverable: true })
    if (input.legacyChapterId !== undefined) this.assertCurrentFileVersion(input.legacyChapterId)
    const baseBodyVersionId = input.baseBodyVersionId ?? (chapter?.current_body_version_id ? String(chapter.current_body_version_id) : null)
    if (input.baseBodyVersionId) {
      if (!chapter) throw new AppError('VALIDATION_ERROR', '只有章节任务可以绑定正文版本。', { recoverable: true })
      const base = this.row(this.database.prepare(`
        SELECT versions.content_hash FROM body_versions versions WHERE versions.id = ? AND versions.chapter_id = ?
      `).get(input.baseBodyVersionId, String(chapter.id)))
      if (!base) throw new AppError('CONFLICT', '任务正文版本不属于当前章节。', { recoverable: true })
      if (input.contentHash && base.content_hash !== input.contentHash) throw new AppError('CONFLICT', '任务正文版本与指纹不匹配。', { recoverable: true })
    }
    const existing = this.row(this.database.prepare('SELECT id FROM task_runs WHERE project_id = ? AND idempotency_key = ?').get(projectId, input.idempotencyKey))
    if (existing) {
      const stored = this.taskRun(String(existing.id))!
      const sameChapter = stored.legacyChapterId === (input.legacyChapterId ?? null)
      if (stored.taskType !== input.taskType || !sameChapter || stored.baseBodyVersionId !== baseBodyVersionId
        || stored.parentTaskRunId !== (input.parentTaskRunId ?? null)
        || stored.contentHash !== (input.contentHash ?? null) || stored.taskContract.contractHash !== taskContract.contractHash) {
        throw new AppError('CONFLICT', '任务幂等键已用于另一份请求。', { recoverable: true })
      }
      return stored
    }
    if (input.taskType === 'writing_agent' && this.database.prepare(`
      SELECT id FROM task_runs WHERE project_id = ? AND chapter_id IS ? AND task_type = 'writing_agent'
        AND status IN ('queued', 'resuming', 'preparing', 'running', 'streaming') LIMIT 1
    `).get(projectId, chapter ? String(chapter.id) : null)) {
      throw new AppError('CONFLICT', '这一章已有正在执行的写作任务，请先暂停或停止它。', { recoverable: true })
    }
    if (input.parentTaskRunId) {
      const parent = this.taskRun(input.parentTaskRunId)
      if (!parent) throw new AppError('NOT_FOUND', '重试任务的父运行不存在。', { recoverable: true })
      if (isLegacyTaskContract(parent.taskContract)) {
        throw new AppError('CONFLICT', '这条历史任务没有可验证的冻结契约；请从当前内容重新发起，避免重试扩大权限。', { recoverable: true })
      }
      if (parent.taskType !== input.taskType || parent.taskContract.contractHash !== taskContract.contractHash
        || parent.legacyChapterId !== (input.legacyChapterId ?? null) || !sameTaskContract(parent.taskContract, taskContract)) {
        throw new AppError('CONFLICT', '重试任务必须完整继承原任务的模板、输入输出结构和操作边界。', { recoverable: true })
      }
      if (initialStatus === 'resuming') {
        if (!['paused', 'interrupted'].includes(parent.status) && !taskRunHasLegacyPause(parent, String(project.prompt_work_item_id ?? ''))) {
          throw new AppError('CONFLICT', '只有已暂停或意外中断的任务可以继续。', { recoverable: true })
        }
        if (this.database.prepare('SELECT id FROM task_runs WHERE project_id = ? AND parent_task_run_id = ? LIMIT 1').get(projectId, parent.id)) {
          throw new AppError('CONFLICT', '这条任务已经续接，请打开后续运行。', { recoverable: true })
        }
      }
    }
    const timestamp = this.now().toISOString()
    this.database.prepare(`
      INSERT INTO task_runs (
        id, project_id, chapter_id, task_type, status, idempotency_key, parent_task_run_id,
        base_body_version_id, content_hash, context_package_id, model_config_id, attempt,
        checkpoint_json, error_code, error_message, started_at, ended_at, created_at, updated_at,
        template_id, template_version, template_hash, input_schema_json, output_schema_json,
        allowed_operations_json, forbidden_operations_json, task_contract_hash
      ) VALUES ($id, $projectId, $chapterId, $taskType, $initialStatus, $idempotencyKey, $parentTaskRunId,
        $baseBodyVersionId, $contentHash, NULL, $modelConfigId, $attempt, $checkpointJson,
        NULL, NULL, NULL, NULL, $createdAt, $updatedAt,
        $templateId, $templateVersion, $templateHash, $inputSchemaJson, $outputSchemaJson,
        $allowedOperationsJson, $forbiddenOperationsJson, $taskContractHash)
    `).run({
      $id: input.id,
      $projectId: projectId,
      $chapterId: chapter ? String(chapter.id) : null,
      $taskType: input.taskType,
      $initialStatus: initialStatus,
      $idempotencyKey: input.idempotencyKey,
      $parentTaskRunId: input.parentTaskRunId ?? null,
      $baseBodyVersionId: baseBodyVersionId,
      $contentHash: input.contentHash ?? null,
      $modelConfigId: input.modelConfigId ?? null,
      $attempt: input.attempt ?? 1,
      $checkpointJson: input.checkpointJson,
      $createdAt: timestamp,
      $updatedAt: timestamp,
      $templateId: taskContract.templateId,
      $templateVersion: taskContract.templateVersion,
      $templateHash: taskContract.templateHash,
      $inputSchemaJson: taskContract.inputSchemaJson,
      $outputSchemaJson: taskContract.outputSchemaJson,
      $allowedOperationsJson: taskContract.allowedOperationsJson,
      $forbiddenOperationsJson: taskContract.forbiddenOperationsJson,
      $taskContractHash: taskContract.contractHash
    })
    return this.taskRun(input.id)!
  }

  createContextPackage(input: WorkspaceContextPackageCreateInput): WorkspaceContextPackageRecord {
    this.assertOpen()
    assertBoundedIdentifier(input.id, '上下文包 ID')
    assertBoundedIdentifier(input.taskRunId, '任务 ID')
    assertBoundedIdentifier(input.compilerVersion, '上下文编译器版本')
    assertJsonText(input.contentJson, 5_000_000, '上下文包内容')
    assertJsonText(input.truncationJson, 200_000, '上下文裁剪记录')
    if (!isSha256(input.contentHash) || hashText(input.contentJson) !== input.contentHash) {
      throw new AppError('VALIDATION_ERROR', '上下文包内容指纹无效。', { recoverable: true })
    }
    if (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1 || input.tokenBudget > 2_000_000
      || !Number.isSafeInteger(input.estimatedTokens) || input.estimatedTokens < 0 || input.estimatedTokens > 2_000_000) {
      throw new AppError('VALIDATION_ERROR', '上下文包预算无效。', { recoverable: true })
    }
    const task = this.taskRun(input.taskRunId)
    if (!task || !['preparing', 'running'].includes(task.status)) {
      throw new AppError('CONFLICT', '只有准备中的 AI 任务可以冻结上下文。', { recoverable: true })
    }
    const existing = this.contextPackageForTask(input.taskRunId)
    if (existing) {
      if (existing.contentHash !== input.contentHash || existing.contentJson !== input.contentJson) {
        throw new AppError('CONFLICT', '同一任务已经冻结了不同的上下文，已拒绝覆盖。', { recoverable: true })
      }
      return existing
    }
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO context_packages (
          id, project_id, task_run_id, compiler_version, content_json, content_hash,
          token_budget, estimated_tokens, truncation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, task.projectId, input.taskRunId, input.compilerVersion, input.contentJson, input.contentHash,
        input.tokenBudget, input.estimatedTokens, input.truncationJson, timestamp)
      this.database.prepare('UPDATE task_runs SET context_package_id = ?, updated_at = ? WHERE id = ?')
        .run(input.id, timestamp, input.taskRunId)
    }, 'write')
    return this.contextPackageForTask(input.taskRunId)!
  }

  contextPackageForTask(taskRunId: string): WorkspaceContextPackageRecord | null {
    this.assertOpen()
    const row = this.row(this.database.prepare(`
      SELECT packages.* FROM context_packages packages
      JOIN task_runs runs ON runs.id = packages.task_run_id
      WHERE packages.task_run_id = ? AND runs.project_id = ?
    `).get(taskRunId, String(this.projectRow()?.id ?? '')))
    return row ? this.contextPackageRecord(row) : null
  }

  transitionTaskRun(input: WorkspaceTaskRunTransitionInput): WorkspaceTaskRunRecord {
    this.assertOpen()
    const current = this.taskRun(input.id)
    if (!current) throw new AppError('NOT_FOUND', 'AI 任务不存在。', { recoverable: true })
    if (input.checkpointJson !== undefined) assertJsonText(input.checkpointJson, 512_000, '任务检查点')
    if (input.errorCode && input.errorCode.length > 120) throw new AppError('VALIDATION_ERROR', '任务错误代码过长。', { recoverable: true })
    if (input.errorMessage && input.errorMessage.length > 1_000) throw new AppError('VALIDATION_ERROR', '任务错误说明过长。', { recoverable: true })
    if (!taskRunCanTransition(current.status, input.status)) {
      throw new AppError('CONFLICT', `AI 任务不能从 ${current.status} 迁移到 ${input.status}。`, { recoverable: true })
    }
    const timestamp = this.now().toISOString()
    const terminal = taskRunIsTerminal(input.status)
    const starts = ['resuming', 'preparing', 'running', 'streaming'].includes(input.status)
    const result = this.database.prepare(`
      UPDATE task_runs SET status = ?, checkpoint_json = ?, error_code = ?, error_message = ?,
        started_at = CASE WHEN started_at IS NULL AND ? = 1 THEN ? ELSE started_at END,
        ended_at = CASE WHEN ? = 1 AND ended_at IS NULL THEN ? WHEN ? = 0 THEN NULL ELSE ended_at END,
        updated_at = ? WHERE id = ? AND status = ?
    `).run(
      input.status, input.checkpointJson ?? current.checkpointJson,
      input.errorCode === undefined ? current.errorCode : input.errorCode,
      input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
      starts ? 1 : 0, timestamp, terminal ? 1 : 0, timestamp, terminal ? 1 : 0, timestamp, input.id, current.status
    )
    if (Number(result.changes) !== 1) throw new AppError('CONFLICT', '任务状态已变化，请查看最新运行。', { recoverable: true })
    return this.taskRun(input.id)!
  }

  taskRun(id: string): WorkspaceTaskRunRecord | null {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) return null
    const row = this.row(this.database.prepare(`
      SELECT runs.*, chapters.legacy_chapter_id
      FROM task_runs runs
      LEFT JOIN chapters ON chapters.id = runs.chapter_id
      WHERE runs.id = ? AND runs.project_id = ?
    `).get(id, String(project.id)))
    return row ? this.taskRunRecord(row) : null
  }

  recentTaskRuns(taskType: string, legacyChapterId?: number, limit = 50): WorkspaceTaskRunRecord[] {
    this.assertOpen()
    assertBoundedIdentifier(taskType, '任务类型')
    const project = this.projectRow()
    if (!project) return []
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = legacyChapterId === undefined
      ? this.database.prepare(`
          SELECT runs.*, chapters.legacy_chapter_id FROM task_runs runs
          LEFT JOIN chapters ON chapters.id = runs.chapter_id
          WHERE runs.project_id = ? AND runs.task_type = ? ORDER BY runs.created_at DESC LIMIT ?
        `).all(String(project.id), taskType, boundedLimit)
      : this.database.prepare(`
          SELECT runs.*, chapters.legacy_chapter_id FROM task_runs runs
          JOIN chapters ON chapters.id = runs.chapter_id
          WHERE runs.project_id = ? AND runs.task_type = ? AND chapters.legacy_chapter_id = ?
          ORDER BY runs.created_at DESC LIMIT ?
        `).all(String(project.id), taskType, legacyChapterId, boundedLimit)
    return this.rows(rows).map((row) => this.taskRunRecord(row))
  }

  recentProjectTaskRuns(limit = 100): WorkspaceTaskRunRecord[] {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) return []
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    return this.rows(this.database.prepare(`
      SELECT runs.*, chapters.legacy_chapter_id FROM task_runs runs
      LEFT JOIN chapters ON chapters.id = runs.chapter_id
      WHERE runs.project_id = ? ORDER BY runs.updated_at DESC, runs.created_at DESC LIMIT ?
    `).all(String(project.id), boundedLimit)).map((row) => this.taskRunRecord(row))
  }

  taskCenterTaskRuns(limit = 100): Array<WorkspaceTaskRunRecord & { hasContinuation: boolean }> {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) return []
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 100
    // Filter before limiting; a long history must not displace actionable work.
    // Continuation existence comes from all project runs, even dismissed ones.
    return this.rows(this.database.prepare(`
      WITH visible AS (
        SELECT runs.*, chapters.legacy_chapter_id,
          EXISTS (SELECT 1 FROM task_runs children
            WHERE children.project_id = runs.project_id AND children.parent_task_run_id = runs.id) AS has_continuation
        FROM task_runs runs
        LEFT JOIN chapters ON chapters.id = runs.chapter_id
        WHERE runs.project_id = ?
          AND COALESCE(json_extract(runs.checkpoint_json, '$.dismissedAt'), '') IN ('', 0)
      )
      SELECT * FROM visible
      ORDER BY CASE
        WHEN status IN ('queued', 'resuming', 'preparing', 'running', 'streaming') THEN 0
        WHEN (status = 'paused' OR (${legacyTaskPauseSql})) AND has_continuation = 0 THEN 1
        WHEN status IN ('failed', 'interrupted') THEN 2
        ELSE 3
      END, updated_at DESC, created_at DESC, id DESC
      LIMIT ?
    `).all(String(project.id), boundedLimit)).map(row => ({
      ...this.taskRunRecord(row), hasContinuation: Number(row.has_continuation) === 1
    }))
  }

  taskRunByOperationKey(key: string): WorkspaceTaskRunRecord | null {
    this.assertOpen()
    assertBoundedIdentifier(key, '任务提交标识')
    const row = this.row(this.database.prepare('SELECT id FROM task_runs WHERE project_id = ? AND idempotency_key = ?')
      .get(String(this.projectRow()?.id ?? ''), key))
    return row ? this.taskRun(String(row.id)) : null
  }

  interruptActiveTaskRuns(taskType?: string): number {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) return 0
    const timestamp = this.now().toISOString()
    const result = this.database.prepare(`
      UPDATE task_runs SET status = 'interrupted', error_code = 'APP_RESTARTED',
        error_message = '应用在任务完成前关闭；可从原请求重试。', ended_at = ?, updated_at = ?
      WHERE project_id = ? AND status IN ('queued', 'resuming', 'preparing', 'running', 'streaming')
        AND (? IS NULL OR task_type = ?)
    `).run(timestamp, timestamp, String(project.id), taskType ?? null, taskType ?? null)
    return Number(result.changes)
  }

  createGenerationArtifact(input: WorkspaceGenerationArtifactCreateInput): WorkspaceGenerationArtifactRecord {
    this.assertOpen()
    assertBoundedIdentifier(input.id, 'Artifact ID')
    assertBoundedIdentifier(input.taskRunId, '任务 ID')
    assertBoundedIdentifier(input.artifactType, 'Artifact 类型')
    if (!isSha256(input.contentHash) || hashText(input.content) !== input.contentHash) {
      throw new AppError('VALIDATION_ERROR', 'Artifact 内容指纹无效。', { recoverable: true })
    }
    if (input.content.length > 5_000_000) throw new AppError('VALIDATION_ERROR', 'Artifact 内容超过 500 万字符限制。', { recoverable: true })
    if (input.selectionAnchorJson !== undefined) assertJsonText(input.selectionAnchorJson, 100_000, '选区锚点')
    assertJsonText(input.metadataJson, 200_000, 'Artifact 元数据')
    const task = this.taskRun(input.taskRunId)
    if (!task) throw new AppError('NOT_FOUND', 'Artifact 对应的 AI 任务不存在。', { recoverable: true })
    const existing = this.row(this.database.prepare('SELECT id, content_hash, content FROM generation_artifacts WHERE task_run_id = ? AND artifact_type = ?').get(input.taskRunId, input.artifactType))
    if (existing) {
      if (existing.content_hash !== input.contentHash || existing.content !== input.content) {
        throw new AppError('CONFLICT', '同一任务已保存不同的 Artifact，已拒绝覆盖。', { recoverable: true })
      }
      return this.generationArtifactForTask(input.taskRunId, input.artifactType)!
    }
    const timestamp = this.now().toISOString()
    this.database.prepare(`
      INSERT INTO generation_artifacts (
        id, task_run_id, artifact_type, status, content, content_hash, schema_valid,
        base_body_version_id, selection_anchor_json, metadata_json, created_at, updated_at
      ) VALUES ($id, $taskRunId, $artifactType, $status, $content, $contentHash, $schemaValid,
        $baseBodyVersionId, $selectionAnchorJson, $metadataJson, $createdAt, $updatedAt)
    `).run({
      $id: input.id,
      $taskRunId: input.taskRunId,
      $artifactType: input.artifactType,
      $status: input.status,
      $content: input.content,
      $contentHash: input.contentHash,
      $schemaValid: input.schemaValid ? 1 : 0,
      $baseBodyVersionId: task.baseBodyVersionId,
      $selectionAnchorJson: input.selectionAnchorJson ?? null,
      $metadataJson: input.metadataJson,
      $createdAt: timestamp,
      $updatedAt: timestamp
    })
    return this.generationArtifactForTask(input.taskRunId, input.artifactType)!
  }

  savePartialGenerationArtifact(input: WorkspaceGenerationArtifactCreateInput): WorkspaceGenerationArtifactRecord {
    if (input.status !== 'partial') throw new AppError('VALIDATION_ERROR', '流式 Artifact 必须处于 partial 状态。', { recoverable: true })
    const existing = this.generationArtifactForTask(input.taskRunId, input.artifactType)
    if (!existing) return this.createGenerationArtifact(input)
    if (existing.status !== 'partial') throw new AppError('CONFLICT', '已经封存的流式 Artifact 不能继续写入。', { recoverable: true })
    if (!input.content.startsWith(existing.content)) throw new AppError('CONFLICT', '流式 Artifact 只能追加，不能覆盖已保存内容。', { recoverable: true })
    if (!isSha256(input.contentHash) || hashText(input.content) !== input.contentHash || input.content.length > 5_000_000) {
      throw new AppError('VALIDATION_ERROR', '流式 Artifact 内容无效。', { recoverable: true })
    }
    assertJsonText(input.metadataJson, 200_000, 'Artifact 元数据')
    this.database.prepare(`
      UPDATE generation_artifacts SET content = ?, content_hash = ?, schema_valid = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(input.content, input.contentHash, input.schemaValid ? 1 : 0, input.metadataJson, this.now().toISOString(), existing.id)
    return this.generationArtifactForTask(input.taskRunId, input.artifactType)!
  }

  completeTaskRunWithArtifact(
    taskId: string,
    checkpointJson: string,
    input: WorkspaceGenerationArtifactCreateInput
  ): { task: WorkspaceTaskRunRecord; artifact: WorkspaceGenerationArtifactRecord } {
    if (input.taskRunId !== taskId) throw new AppError('VALIDATION_ERROR', 'Artifact 与任务身份不一致。', { recoverable: true })
    return this.transaction(() => {
      const current = this.taskRun(taskId)
      if (!current || !['running', 'streaming'].includes(current.status)) {
        throw new AppError('CONFLICT', 'AI 任务已经停止，不能再提交候选。', { recoverable: true })
      }
      const artifact = this.createGenerationArtifact(input)
      const task = this.transitionTaskRun({ id: taskId, status: 'succeeded', checkpointJson, errorCode: null, errorMessage: null })
      if (task.taskType === 'idea_generation' && artifact.artifactType === 'idea_generation') {
        this.prepareCandidateGenerationMirror(task.id)
      }
      if (task.taskType === 'outline_expansion' && artifact.artifactType === 'outline_expansion') {
        this.prepareCandidateGenerationMirror(task.id, 'outline_expansion')
      }
      return { task, artifact }
    })
  }

  generationArtifactForTask(taskRunId: string, artifactType?: string): WorkspaceGenerationArtifactRecord | null {
    this.assertOpen()
    const row = artifactType ? this.row(this.database.prepare(`
      SELECT artifacts.* FROM generation_artifacts artifacts
      JOIN task_runs runs ON runs.id = artifacts.task_run_id
      WHERE artifacts.task_run_id = ? AND artifacts.artifact_type = ? AND runs.project_id = ?
      LIMIT 1
    `).get(taskRunId, artifactType, String(this.projectRow()?.id ?? ''))) : this.row(this.database.prepare(`
      SELECT artifacts.* FROM generation_artifacts artifacts
      JOIN task_runs runs ON runs.id = artifacts.task_run_id
      JOIN projects ON projects.id = runs.project_id
      WHERE artifacts.task_run_id = ? AND projects.id = ?
      ORDER BY CASE WHEN artifacts.artifact_type = 'writing_agent_turn' THEN 0 ELSE 1 END, artifacts.created_at DESC LIMIT 1
    `).get(taskRunId, String(this.projectRow()?.id ?? '')))
    return row ? this.generationArtifactRecord(row) : null
  }

  updateGenerationArtifactStatus(id: string, status: WorkspaceArtifactStatus, metadataJson: string): WorkspaceGenerationArtifactRecord {
    this.assertOpen()
    assertJsonText(metadataJson, 200_000, 'Artifact 元数据')
    const row = this.row(this.database.prepare(`
      SELECT artifacts.status, artifacts.task_run_id FROM generation_artifacts artifacts
      JOIN task_runs runs ON runs.id = artifacts.task_run_id
      WHERE artifacts.id = ? AND runs.project_id = ?
    `).get(id, String(this.projectRow()?.id ?? '')))
    if (!row) throw new AppError('NOT_FOUND', 'AI Artifact 不存在。', { recoverable: true })
    const current = String(row.status) as WorkspaceArtifactStatus
    if (status !== current && !allowedArtifactTransitions[current].includes(status)) {
      throw new AppError('CONFLICT', `Artifact 不能从 ${current} 迁移到 ${status}。`, { recoverable: true })
    }
    this.database.prepare('UPDATE generation_artifacts SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(status, metadataJson, this.now().toISOString(), id)
    const updated = this.row(this.database.prepare('SELECT * FROM generation_artifacts WHERE id = ?').get(id))
    return this.generationArtifactRecord(updated!)
  }

  recordFindingRun(input: WorkspaceFindingRunInput): WorkspaceFindingRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '检查章节无效。', { recoverable: true })
    assertBoundedIdentifier(input.bodyVersionId, '正文版本 ID')
    if (!isSha256(input.contentHash)) throw new AppError('VALIDATION_ERROR', '检查正文指纹无效。', { recoverable: true })
    if (!['deterministic', 'semantic', 'literary'].includes(input.ruleLayer)) throw new AppError('VALIDATION_ERROR', '检查层级无效。', { recoverable: true })
    if (!Array.isArray(input.findings) || input.findings.length > 200) throw new AppError('VALIDATION_ERROR', '检查结果数量无效。', { recoverable: true })
    for (const finding of input.findings) {
      assertBoundedIdentifier(finding.code, '检查代码')
      assertBoundedText(finding.title, '检查标题', 500)
      assertBoundedText(finding.rationale, '检查依据', 20_000)
      assertJsonText(finding.evidenceJson, 100_000, '检查证据')
      if (finding.suggestedAction !== undefined) assertBoundedText(finding.suggestedAction, '建议动作', 2_000)
      if (finding.confidence !== undefined && finding.confidence !== null && (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1)) {
        throw new AppError('VALIDATION_ERROR', '检查置信度无效。', { recoverable: true })
      }
      if (!['blocker', 'warning', 'suggestion'].includes(finding.severity)) throw new AppError('VALIDATION_ERROR', '检查严重性无效。', { recoverable: true })
      if (!findingSeverityMatchesLayer(input.ruleLayer, finding.severity)) {
        throw new AppError('VALIDATION_ERROR', '检查层级与严重性不匹配。', { recoverable: true })
      }
    }
    const projectId = String(this.projectRow()?.id ?? '')
    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id, chapters.current_body_version_id, versions.content_hash
      FROM chapters LEFT JOIN body_versions versions ON versions.id = chapters.current_body_version_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (!chapter || chapter.current_body_version_id !== input.bodyVersionId || chapter.content_hash !== input.contentHash) {
      throw new AppError('CONFLICT', '检查结果绑定的正文版本已经变化。', { recoverable: true })
    }
    // Persist only the product-facing finding contract. Callers may eventually
    // receive provider-specific payloads, but raw responses or model reasoning
    // must never leak into the rule-run snapshot through excess object fields.
    const persistedFindings = input.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      title: finding.title,
      rationale: finding.rationale,
      evidenceJson: finding.evidenceJson,
      ...(finding.suggestedAction === undefined ? {} : { suggestedAction: finding.suggestedAction }),
      ...(finding.confidence === undefined ? {} : { confidence: finding.confidence })
    }))
    const inputJson = JSON.stringify({ version: 1, findings: persistedFindings })
    const existingRun = this.row(this.database.prepare(`
      SELECT id FROM rule_runs
      WHERE project_id = ? AND chapter_id = ? AND body_version_id = ? AND content_hash = ?
        AND rule_layer = ? AND status = 'succeeded' AND input_json = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(projectId, String(chapter.id), input.bodyVersionId, input.contentHash, input.ruleLayer, inputJson))
    if (existingRun) return this.findingsForRun(String(existingRun.id))
    const timestamp = this.now().toISOString()
    const runId = this.id()
    this.transaction(() => {
      this.database.prepare(`
        UPDATE findings SET status = 'stale', updated_at = CASE WHEN updated_at >= ?
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ? END
        WHERE project_id = ? AND chapter_id = ? AND status IN ('open', 'accepted')
          AND (body_version_id <> ? OR content_hash <> ?)
      `).run(timestamp, timestamp, projectId, String(chapter.id), input.bodyVersionId, input.contentHash)
      this.database.prepare(`
        UPDATE findings SET status = 'stale', updated_at = CASE WHEN updated_at >= ?
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ? END
        WHERE project_id = ? AND chapter_id = ? AND rule_layer = ? AND status IN ('open', 'accepted')
      `).run(timestamp, timestamp, projectId, String(chapter.id), input.ruleLayer)
      this.database.prepare(`
        INSERT INTO rule_runs (
          id, project_id, rule_id, chapter_id, body_version_id, content_hash, rule_layer, status,
          input_json, result_json, error_code, error_message, started_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'succeeded', ?, ?, NULL, NULL, ?, ?, ?, ?)
      `).run(runId, projectId, String(chapter.id), input.bodyVersionId, input.contentHash, input.ruleLayer,
        inputJson, JSON.stringify({ findingCount: persistedFindings.length }), timestamp, timestamp, timestamp, timestamp)
      const insert = this.database.prepare(`
        INSERT INTO findings (
          id, project_id, rule_run_id, rule_id, chapter_id, body_version_id, content_hash, rule_layer,
          severity, code, title, rationale, evidence_json, suggested_action, confidence, status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `)
      for (const finding of persistedFindings) insert.run(
        this.id(), projectId, runId, String(chapter.id), input.bodyVersionId, input.contentHash, input.ruleLayer,
        finding.severity, finding.code, finding.title, finding.rationale, finding.evidenceJson,
        finding.suggestedAction ?? '', finding.confidence ?? null, timestamp, timestamp
      )
    }, 'write')
    return this.findingsForRun(runId)
  }

  listFindings(legacyChapterId?: number, statuses?: WorkspaceFindingStatus[]): WorkspaceFindingRecord[] {
    this.assertFormal()
    if (legacyChapterId !== undefined && (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1)) throw new AppError('VALIDATION_ERROR', '检查章节无效。', { recoverable: true })
    const selected = statuses ?? []
    if (selected.some((status) => !['open', 'accepted', 'ignored', 'exception', 'stale', 'fixed'].includes(status))) throw new AppError('VALIDATION_ERROR', '检查状态无效。', { recoverable: true })
    const where = ['findings.project_id = ?']
    const params: Array<string | number> = [String(this.projectRow()?.id ?? '')]
    if (legacyChapterId !== undefined) { where.push('chapters.legacy_chapter_id = ?'); params.push(legacyChapterId) }
    if (selected.length) { where.push(`findings.status IN (${selected.map(() => '?').join(', ')})`); params.push(...selected) }
    const rows = this.rows(this.database.prepare(`
      SELECT findings.*, chapters.legacy_chapter_id FROM findings
      LEFT JOIN chapters ON chapters.id = findings.chapter_id
      WHERE ${where.join(' AND ')}
      ORDER BY findings.created_at DESC, findings.id DESC LIMIT 500
    `).all(...params))
    return rows.map((row) => this.findingRecord(row))
  }

  decideFinding(input: WorkspaceFindingDecisionInput): WorkspaceFindingRecord {
    this.assertFormal()
    assertBoundedIdentifier(input.findingId, '检查记录 ID')
    if (!['accepted', 'ignored', 'exception', 'later', 'fixed'].includes(input.decision)) throw new AppError('VALIDATION_ERROR', '检查决定无效。', { recoverable: true })
    const reason = String(input.reason || '').trim()
    if (reason.length > 2_000) throw new AppError('VALIDATION_ERROR', '检查决定说明过长。', { recoverable: true })
    if (input.decision === 'exception' && !reason) throw new AppError('VALIDATION_ERROR', '标记例外时请说明原因。', { recoverable: true })
    if (input.decision === 'fixed') {
      assertBoundedIdentifier(input.resultingBodyVersionId, '修复正文版本 ID')
      if (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 100 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
        throw new AppError('VALIDATION_ERROR', '请重新读取这条检查的处理状态。', { recoverable: true })
      }
    } else if (input.resultingBodyVersionId !== undefined || input.expectedUpdatedAt !== undefined) {
      throw new AppError('VALIDATION_ERROR', '只有明确标记已修复时才能关联修复正文版本。', { recoverable: true })
    }
    // Pin both the author decision and the saved manuscript under the same write
    // lock. A UI review is not permission to silently refresh either pointer.
    this.transaction(() => {
      const projectId = String(this.projectRow()?.id ?? '')
      const row = this.row(this.database.prepare(`SELECT findings.* FROM findings WHERE findings.id = ? AND findings.project_id = ?`)
        .get(input.findingId, projectId))
      if (!row) throw new AppError('NOT_FOUND', '一致性检查记录不存在。', { recoverable: true })
      if (input.decision === 'fixed') {
        if (row.updated_at !== input.expectedUpdatedAt || !['open', 'accepted', 'stale'].includes(String(row.status))) {
          throw new AppError('CONFLICT', '这条检查的处理状态已经变化，请重新核对后再标记已修复。', { recoverable: true })
        }
        const target = this.row(this.database.prepare(`
          SELECT target.id FROM chapters c
          JOIN body_versions target ON target.id = c.current_body_version_id AND target.chapter_id = c.id
          JOIN body_versions source ON source.id = ? AND source.chapter_id = c.id
          WHERE c.id = ? AND c.project_id = ? AND c.status <> 'archived'
            AND target.id = ? AND target.version_no > source.version_no
        `).get(String(row.body_version_id), String(row.chapter_id), projectId, input.resultingBodyVersionId))
        if (!target) throw new AppError('CONFLICT', '请先保存修复后的本章正文，再核对最新版本；原检测版本、其他章节或过期版本不能作为修复结果。', { recoverable: true })
      } else if (row.status === 'stale' || row.status === 'fixed') {
        throw new AppError('CONFLICT', '这条检查已过期或已修复，请保留历史并重新检查当前正文。', { recoverable: true })
      }
      // Distinct state tokens even when two decisions share one clock millisecond.
      const previousTime = Date.parse(String(row.updated_at))
      if (!Number.isFinite(previousTime)) throw this.integrityError('一致性检查的更新时间无效。')
      const timestamp = new Date(Math.max(this.now().getTime(), previousTime + 1)).toISOString()
      const resultVersion = input.decision === 'fixed' ? input.resultingBodyVersionId : null
      this.database.prepare(`
        INSERT INTO finding_decisions (id, finding_id, decision, reason, created_at, resulting_body_version_id) VALUES (?, ?, ?, ?, ?, ?)
      `).run(this.id(), input.findingId, input.decision, reason, timestamp, resultVersion)
      this.database.prepare('UPDATE findings SET status = ?, updated_at = ?, resulting_body_version_id = ? WHERE id = ?')
        .run(input.decision === 'later' ? 'open' : input.decision, timestamp, resultVersion, input.findingId)
    }, 'write')
    const updated = this.row(this.database.prepare(`
      SELECT findings.*, chapters.legacy_chapter_id FROM findings
      LEFT JOIN chapters ON chapters.id = findings.chapter_id WHERE findings.id = ?
    `).get(input.findingId))
    return this.findingRecord(updated!)
  }

  writeSummaryVersion(input: WorkspaceSummaryVersionWriteInput): WorkspaceSummaryVersionRecord {
    this.assertFormal()
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '摘要章节无效。', { recoverable: true })
    assertBoundedIdentifier(input.bodyVersionId, '摘要正文版本 ID')
    assertBoundedText(input.content, '章节摘要', 50_000)
    if (!input.content.trim()) throw new AppError('VALIDATION_ERROR', '章节摘要不能为空。', { recoverable: true })
    if (input.sourceTaskRunId) assertBoundedIdentifier(input.sourceTaskRunId, '摘要任务 ID')
    const status = input.status ?? 'draft'
    if (!['draft', 'approved'].includes(status)) throw new AppError('VALIDATION_ERROR', '章节摘要状态无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id, chapters.current_body_version_id, versions.content_hash
      FROM chapters LEFT JOIN body_versions versions ON versions.id = chapters.current_body_version_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (!chapter || chapter.current_body_version_id !== input.bodyVersionId) throw new AppError('CONFLICT', '摘要绑定的正文版本已经变化。', { recoverable: true })
    const contentHash = hashText(input.content)
    const existing = this.row(this.database.prepare(`
      SELECT summaries.*, chapters.legacy_chapter_id FROM summary_versions summaries
      JOIN chapters ON chapters.id = summaries.chapter_id
      WHERE summaries.chapter_id = ? AND summaries.body_version_id = ? AND summaries.content_hash = ?
    `).get(String(chapter.id), input.bodyVersionId, contentHash))
    if (existing) return this.summaryVersionRecord(existing)
    const timestamp = this.now().toISOString()
    const id = this.id()
    this.transaction(() => {
      this.database.prepare(`
        UPDATE summary_versions SET status = 'stale'
        WHERE chapter_id = ? AND body_version_id <> ? AND status IN ('draft', 'approved')
      `).run(String(chapter.id), input.bodyVersionId)
      this.database.prepare(`
        INSERT INTO summary_versions (id, project_id, chapter_id, body_version_id, content, content_hash, source_task_run_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, String(chapter.id), input.bodyVersionId, input.content.trim(), contentHash, input.sourceTaskRunId ?? null, status, timestamp)
    }, 'write')
    return this.summaryVersionRecord(this.row(this.database.prepare(`
      SELECT summaries.*, chapters.legacy_chapter_id FROM summary_versions summaries
      JOIN chapters ON chapters.id = summaries.chapter_id WHERE summaries.id = ?
    `).get(id))!)
  }

  upsertModelConfig(input: WorkspaceModelConfigInput): WorkspaceModelConfigRecord {
    this.assertFormal()
    assertBoundedText(input.provider, '模型服务标识', 500)
    assertBoundedText(input.modelName, '模型名称', 500)
    assertBoundedText(input.displayName, '模型显示名称', 1_000)
    assertJsonText(input.settingsJson, 100_000, '模型参数')
    if (input.inputTokenBudget !== undefined && input.inputTokenBudget !== null && (!Number.isSafeInteger(input.inputTokenBudget) || input.inputTokenBudget < 1)) {
      throw new AppError('VALIDATION_ERROR', '模型输入预算无效。', { recoverable: true })
    }
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const existing = this.row(this.database.prepare('SELECT * FROM model_configs WHERE project_id = ? AND provider = ? AND model_name = ?').get(projectId, input.provider.trim(), input.modelName.trim()))
    const id = existing ? String(existing.id) : this.id()
    this.transaction(() => {
      if (input.isDefault) this.database.prepare('UPDATE model_configs SET is_default = 0, updated_at = ? WHERE project_id = ?').run(timestamp, projectId)
      this.database.prepare(`
        INSERT INTO model_configs (id, project_id, provider, model_name, display_name, settings_json, input_token_budget, enabled, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, provider, model_name) DO UPDATE SET display_name = excluded.display_name, settings_json = excluded.settings_json,
          input_token_budget = excluded.input_token_budget, enabled = excluded.enabled, is_default = excluded.is_default, updated_at = excluded.updated_at
      `).run(id, projectId, input.provider.trim(), input.modelName.trim(), input.displayName.trim(), input.settingsJson, input.inputTokenBudget ?? null, input.enabled === false ? 0 : 1, input.isDefault ? 1 : 0, timestamp, timestamp)
    }, 'write')
    return this.modelConfigRecord(this.row(this.database.prepare('SELECT * FROM model_configs WHERE id = ?').get(id))!)
  }

  reconcileModelConfigs(inputs: WorkspaceModelConfigInput[]): WorkspaceModelConfigRecord[] {
    return this.transaction(() => this.reconcileModelConfigsInTransaction(inputs), 'write')
  }

  private reconcileModelConfigsInTransaction(inputs: WorkspaceModelConfigInput[]): WorkspaceModelConfigRecord[] {
    this.assertFormal()
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 20) throw new AppError('VALIDATION_ERROR', '模型分配数量无效。', { recoverable: true })
    for (const input of inputs) {
      assertBoundedText(input.provider, '模型服务标识', 500)
      assertBoundedText(input.modelName, '模型名称', 500)
      assertBoundedText(input.displayName, '模型显示名称', 1_000)
      assertJsonText(input.settingsJson, 100_000, '模型参数')
      if (input.inputTokenBudget !== undefined && input.inputTokenBudget !== null && (!Number.isSafeInteger(input.inputTokenBudget) || input.inputTokenBudget < 1)) {
        throw new AppError('VALIDATION_ERROR', '模型输入预算无效。', { recoverable: true })
      }
    }
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const ids: string[] = []
    {
      this.database.prepare('UPDATE model_configs SET enabled = 0, is_default = 0, updated_at = ? WHERE project_id = ?').run(timestamp, projectId)
      for (const input of inputs) {
        const existing = this.row(this.database.prepare('SELECT id FROM model_configs WHERE project_id = ? AND provider = ? AND model_name = ?').get(projectId, input.provider.trim(), input.modelName.trim()))
        const id = existing ? String(existing.id) : this.id()
        ids.push(id)
        this.database.prepare(`
          INSERT INTO model_configs (id, project_id, provider, model_name, display_name, settings_json, input_token_budget, enabled, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, provider, model_name) DO UPDATE SET display_name = excluded.display_name, settings_json = excluded.settings_json,
            input_token_budget = excluded.input_token_budget, enabled = excluded.enabled, is_default = excluded.is_default, updated_at = excluded.updated_at
        `).run(id, projectId, input.provider.trim(), input.modelName.trim(), input.displayName.trim(), input.settingsJson, input.inputTokenBudget ?? null, input.enabled === false ? 0 : 1, input.isDefault ? 1 : 0, timestamp, timestamp)
      }
    }
    const byId = new Map(this.listModelConfigs().map((item) => [item.id, item]))
    return ids.map((id) => byId.get(id)!).filter(Boolean)
  }

  listModelConfigs(): WorkspaceModelConfigRecord[] {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    return this.rows(this.database.prepare('SELECT * FROM model_configs WHERE project_id = ? ORDER BY is_default DESC, display_name COLLATE NOCASE, id').all(projectId)).map((row) => this.modelConfigRecord(row))
  }

  replaceCharacterAliases(input: WorkspaceCharacterAliasInput): WorkspaceCharacterAliasWriteResult {
    this.assertFormal()
    assertBoundedText(input.canonicalName, '人物本名', 160)
    if (!Array.isArray(input.aliases) || input.aliases.length > 100) throw new AppError('VALIDATION_ERROR', '人物别名数量无效。', { recoverable: true })
    const canonicalName = input.canonicalName.trim()
    const normalizedName = normalizeCharacterName(canonicalName)
    if (!normalizedName) throw new AppError('VALIDATION_ERROR', '人物本名无效。', { recoverable: true })
    const aliases = [...new Map(input.aliases.map((alias) => {
      assertBoundedText(alias, '人物别名', 160)
      const name = alias.trim()
      const normalized = normalizeCharacterName(name)
      if (!normalized) throw new AppError('VALIDATION_ERROR', '人物别名无效。', { recoverable: true })
      return [normalized, name] as const
    })).entries()]
      .filter(([normalized]) => normalized !== normalizedName)
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const existing = this.row(this.database.prepare(`
      SELECT id FROM entities WHERE project_id = ? AND entity_type = 'character' AND normalized_name = ?
    `).get(projectId, normalizedName))
    const characterId = existing ? String(existing.id) : this.id()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at)
        VALUES (?, ?, 'character', ?, ?, '{}', 'approved', ?, ?)
        ON CONFLICT(project_id, entity_type, normalized_name) DO UPDATE SET canonical_name = excluded.canonical_name, updated_at = excluded.updated_at
      `).run(characterId, projectId, canonicalName, normalizedName, timestamp, timestamp)
      this.database.prepare('DELETE FROM character_aliases WHERE character_id = ?').run(characterId)
      const insert = this.database.prepare(`
        INSERT INTO character_aliases (id, project_id, character_id, alias, normalized_alias, valid_from_chapter_id, valid_to_chapter_id, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      `)
      for (const [normalizedAlias, alias] of aliases) insert.run(this.id(), projectId, characterId, alias, normalizedAlias, timestamp)
      mirror = this.prepareCharacterAliasesMirror(projectId, timestamp)
    }, 'write')
    return { aliases: this.listCharacterAliases().filter((alias) => alias.characterId === characterId), mirror }
  }

  listCharacterAliases(): WorkspaceCharacterAliasRecord[] {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    return this.rows(this.database.prepare(`
      SELECT aliases.*, entities.canonical_name FROM character_aliases aliases
      JOIN entities ON entities.id = aliases.character_id
      WHERE aliases.project_id = ? AND entities.status <> 'archived'
      ORDER BY entities.canonical_name COLLATE NOCASE, aliases.alias COLLATE NOCASE, aliases.id
    `).all(projectId)).map((row) => this.characterAliasRecord(row))
  }

  upsertEntity(input: WorkspaceEntityInput): WorkspaceEntityWriteResult {
    this.assertFormal()
    if (!['character', 'location', 'item', 'organization', 'world_rule'].includes(input.entityType)) {
      throw new AppError('VALIDATION_ERROR', '资料对象类型无效。', { recoverable: true })
    }
    assertBoundedText(input.canonicalName, '资料对象名称', 160)
    const canonicalName = input.canonicalName.trim()
    const normalizedName = normalizeCharacterName(canonicalName)
    if (!normalizedName) throw new AppError('VALIDATION_ERROR', '资料对象名称无效。', { recoverable: true })
    const profileJson = input.profileJson ?? '{}'
    assertJsonText(profileJson, 500_000, '资料对象档案')
    if (input.entityType === 'item') assertNoResourceQuantityFields(profileJson)
    const status = input.status ?? 'approved'
    if (!['candidate', 'approved', 'archived'].includes(status)) throw new AppError('VALIDATION_ERROR', '资料对象状态无效。', { recoverable: true })
    if (input.id) assertBoundedIdentifier(input.id, '资料对象 ID')
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const matching = this.row(this.database.prepare(`
      SELECT * FROM entities WHERE project_id = ? AND entity_type = ? AND normalized_name = ?
    `).get(projectId, input.entityType, normalizedName))
    if (input.id && matching && String(matching.id) !== input.id) {
      throw new AppError('VALIDATION_ERROR', '资料对象 ID 与同名对象不一致。', { recoverable: true })
    }
    const id = matching ? String(matching.id) : input.id ?? this.id()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (input.id && !matching) {
        const idOwner = this.row(this.database.prepare('SELECT project_id FROM entities WHERE id = ?').get(input.id))
        if (idOwner && String(idOwner.project_id) !== projectId) throw new AppError('VALIDATION_ERROR', '资料对象不属于当前作品。', { recoverable: true })
      }
      this.database.prepare(`
        INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, entity_type, normalized_name) DO UPDATE SET canonical_name = excluded.canonical_name,
          profile_json = excluded.profile_json, status = excluded.status, updated_at = excluded.updated_at
      `).run(id, projectId, input.entityType, canonicalName, normalizedName, profileJson, status, timestamp, timestamp)
      mirror = this.prepareStoryEntitiesMirror(projectId, timestamp)
    }, 'write')
    return { entity: this.entityRecord(this.row(this.database.prepare('SELECT * FROM entities WHERE id = ? AND project_id = ?').get(id, projectId))!), mirror }
  }

  listEntities(entityType?: WorkspaceEntityType): WorkspaceEntityRecord[] {
    this.assertFormal()
    if (entityType && !['character', 'location', 'item', 'organization', 'world_rule'].includes(entityType)) {
      throw new AppError('VALIDATION_ERROR', '资料对象类型无效。', { recoverable: true })
    }
    const projectId = String(this.projectRow()?.id ?? '')
    const statement = entityType
      ? this.database.prepare('SELECT * FROM entities WHERE project_id = ? AND entity_type = ? ORDER BY status <> \'archived\', canonical_name COLLATE NOCASE, id')
      : this.database.prepare('SELECT * FROM entities WHERE project_id = ? ORDER BY entity_type, status <> \'archived\', canonical_name COLLATE NOCASE, id')
    return this.rows(entityType ? statement.all(projectId, entityType) : statement.all(projectId)).map((row) => this.entityRecord(row))
  }

  upsertEntityRelation(input: WorkspaceEntityRelationInput): WorkspaceEntityRelationWriteResult {
    this.assertFormal()
    assertBoundedIdentifier(input.subjectEntityId, '关系主体 ID')
    assertBoundedIdentifier(input.objectEntityId, '关系客体 ID')
    if (input.subjectEntityId === input.objectEntityId) throw new AppError('VALIDATION_ERROR', '关系不能指向同一个资料对象。', { recoverable: true })
    assertBoundedText(input.predicate, '关系类型', 160)
    const predicate = input.predicate.trim()
    const notes = (input.notes ?? '').trim()
    if (notes.length > 5_000) throw new AppError('VALIDATION_ERROR', '关系说明过长。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const pair = this.rows(this.database.prepare('SELECT id FROM entities WHERE project_id = ? AND id IN (?, ?)').all(projectId, input.subjectEntityId, input.objectEntityId))
    if (pair.length !== 2) throw new AppError('VALIDATION_ERROR', '关系对象必须属于当前作品。', { recoverable: true })
    const existing = this.row(this.database.prepare(`
      SELECT * FROM entity_relations WHERE project_id = ? AND subject_entity_id = ? AND predicate = ? AND object_entity_id = ?
    `).get(projectId, input.subjectEntityId, predicate, input.objectEntityId))
    const id = existing ? String(existing.id) : this.id()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO entity_relations (id, project_id, subject_entity_id, predicate, object_entity_id, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, subject_entity_id, predicate, object_entity_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
      `).run(id, projectId, input.subjectEntityId, predicate, input.objectEntityId, notes, timestamp, timestamp)
      mirror = this.prepareStoryEntitiesMirror(projectId, timestamp)
    }, 'write')
    return { relation: this.entityRelationRecord(this.row(this.database.prepare('SELECT * FROM entity_relations WHERE id = ? AND project_id = ?').get(id, projectId))!), mirror }
  }

  listEntityRelations(entityId?: string): WorkspaceEntityRelationRecord[] {
    this.assertFormal()
    if (entityId) assertBoundedIdentifier(entityId, '资料对象 ID')
    const projectId = String(this.projectRow()?.id ?? '')
    const statement = entityId
      ? this.database.prepare('SELECT * FROM entity_relations WHERE project_id = ? AND (subject_entity_id = ? OR object_entity_id = ?) ORDER BY updated_at DESC, id')
      : this.database.prepare('SELECT * FROM entity_relations WHERE project_id = ? ORDER BY updated_at DESC, id')
    return this.rows(entityId ? statement.all(projectId, entityId, entityId) : statement.all(projectId)).map((row) => this.entityRelationRecord(row))
  }

  upsertIdea(input: WorkspaceIdeaInput): WorkspaceIdeaWriteResult {
    this.assertFormal()
    assertBoundedText(input.title, '灵感标题', 200)
    assertBoundedText(input.content, '灵感内容', 50_000)
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) throw new AppError('VALIDATION_ERROR', '灵感标题和内容都不能为空。', { recoverable: true })
    if (input.id) assertBoundedIdentifier(input.id, '灵感 ID')
    const projectId = String(this.projectRow()?.id ?? '')
    const timestamp = this.now().toISOString()
    const existing = input.id ? this.row(this.database.prepare('SELECT * FROM ideas WHERE id = ? AND project_id = ?').get(input.id, projectId)) : undefined
    if (input.id && !existing) throw new AppError('NOT_FOUND', '要修改的灵感不存在。', { recoverable: true })
    const source = input.generationSource
    if (source) {
      assertBoundedIdentifier(source.taskId, '来源任务 ID')
      if (!Number.isInteger(source.optionIndex) || source.optionIndex < 0 || source.optionIndex > 2) throw new AppError('VALIDATION_ERROR', '候选序号无效。', { recoverable: true })
      if (existing) {
        if (existing.source_task_run_id !== source.taskId || existing.source_option_index !== source.optionIndex) throw new AppError('CONFLICT', '已保存便签的生成来源不能更换。', { recoverable: true })
      } else {
        const task = this.taskRun(source.taskId)
        const artifact = this.generationArtifactForTask(source.taskId, 'idea_generation')
        if (!task || task.taskType !== 'idea_generation' || task.status !== 'succeeded' || !artifact?.schemaValid) throw new AppError('VALIDATION_ERROR', '来源必须是当前作品已成功生成的灵感候选。', { recoverable: true })
        const proposal = JSON.parse(artifact.content)
        if (!Array.isArray(proposal.options) || !proposal.options[source.optionIndex]) throw new AppError('VALIDATION_ERROR', '来源候选不存在。', { recoverable: true })
      }
    }
    const status = input.status ?? (existing ? String(existing.status) as WorkspaceIdeaStatus : 'candidate')
    if (!['candidate', 'approved', 'archived'].includes(status)) throw new AppError('VALIDATION_ERROR', '灵感状态无效。', { recoverable: true })
    const id = existing ? String(existing.id) : this.id()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (existing) {
        this.database.prepare(`
          UPDATE ideas SET title = ?, content = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?
        `).run(title, content, status, timestamp, id, projectId)
      } else {
        this.database.prepare(`
          INSERT INTO ideas (id, project_id, title, content, status, promoted_to_type, promoted_to_id, created_at, updated_at, source_task_run_id, source_option_index)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        `).run(id, projectId, title, content, status, timestamp, timestamp, source?.taskId ?? null, source?.optionIndex ?? null)
      }
      mirror = this.prepareIdeasMirror(projectId, timestamp)
    }, 'write')
    return { idea: this.ideaRecord(this.row(this.database.prepare('SELECT * FROM ideas WHERE id = ? AND project_id = ?').get(id, projectId))!), mirror }
  }

  listIdeas(status?: WorkspaceIdeaStatus): WorkspaceIdeaRecord[] {
    this.assertFormal()
    if (status && !['candidate', 'approved', 'archived'].includes(status)) throw new AppError('VALIDATION_ERROR', '灵感筛选状态无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const statement = status
      ? this.database.prepare('SELECT * FROM ideas WHERE project_id = ? AND status = ? ORDER BY updated_at DESC, id')
      : this.database.prepare("SELECT * FROM ideas WHERE project_id = ? ORDER BY status = 'archived', updated_at DESC, id")
    return this.rows(status ? statement.all(projectId, status) : statement.all(projectId)).map((row) => this.ideaRecord(row))
  }

  ideasMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'ideas_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalMaterialSourcesReady(): boolean {
    this.assertFormal()
    return Number(this.projectRow()?.material_sources_ready ?? 0) === 1
  }

  importMaterialSources(sources: WorkspaceMaterialSourceRecord[], observedMirrorHash?: string): WorkspaceMaterialSourcesWriteResult {
    this.assertFormal()
    if (this.formalMaterialSourcesReady()) return { sources: this.listMaterialSources(), mirror: null }
    assertMaterialSources(sources)
    const projectId = String(this.projectRow()!.id)
    if (this.row(this.database.prepare('SELECT id FROM material_sources WHERE project_id = ? LIMIT 1').get(projectId))) {
      throw this.integrityError('素材资料表在正式迁移前已经包含数据。')
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      for (const source of sources) this.insertMaterialSource(projectId, source)
      this.database.prepare('UPDATE projects SET material_sources_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      mirror = this.prepareMaterialSourcesMirror(projectId, timestamp, observedMirrorHash)
    }, 'write')
    return { sources: this.listMaterialSources(), mirror }
  }

  listMaterialSources(): WorkspaceMaterialSourceRecord[] {
    this.assertFormal()
    if (!this.formalMaterialSourcesReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书素材资料尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    return this.rows(this.database.prepare(`
      SELECT * FROM material_sources WHERE project_id = ? ORDER BY captured_at DESC, id
    `).all(projectId)).map((row) => this.materialSourceRecord(row))
  }

  searchMaterialSources(queryTerms: string[], pinnedSourceIds: string[] = [], limit = 200): WorkspaceMaterialSourceRecord[] {
    this.assertFormal()
    if (!this.formalMaterialSourcesReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书素材资料尚未迁入 SQLite。', { recoverable: true })
    if (!Array.isArray(queryTerms) || queryTerms.length > 96 || queryTerms.some((term) => typeof term !== 'string' || term.length < 2 || term.length > 32)) {
      throw new AppError('VALIDATION_ERROR', '素材检索词无效。', { recoverable: true })
    }
    if (!Array.isArray(pinnedSourceIds) || pinnedSourceIds.length > 200 || pinnedSourceIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 512)) {
      throw new AppError('VALIDATION_ERROR', '固定素材范围无效。', { recoverable: true })
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) throw new AppError('VALIDATION_ERROR', '素材检索上限无效。', { recoverable: true })
    const terms = [...new Set(queryTerms.map((term) => term.normalize('NFKC').trim().toLocaleLowerCase()).filter(Boolean))]
    const pinned = [...new Set(pinnedSourceIds.map((id) => id.trim()).filter(Boolean))]
    if (!terms.length && !pinned.length) return []
    const projectId = String(this.projectRow()!.id)
    const termMatches = terms.map(() => [
      'instr(lower(title), ?) > 0', 'instr(lower(excerpt), ?) > 0', 'instr(lower(user_notes), ?) > 0',
      "instr(lower(COALESCE(author, '')), ?) > 0", 'instr(lower(provider), ?) > 0'
    ].join(' OR ')).map((part) => `(${part})`)
    const pinnedMatch = pinned.length ? `id IN (${pinned.map(() => '?').join(', ')})` : ''
    const where = [...termMatches, pinnedMatch].filter(Boolean).join(' OR ')
    const parameters = [...terms.flatMap((term) => [term, term, term, term, term]), ...pinned]
    return this.rows(this.database.prepare(`
      SELECT * FROM material_sources
      WHERE project_id = ? AND (${where})
      ORDER BY captured_at DESC, id
      LIMIT ?
    `).all(projectId, ...parameters, limit)).map((row) => this.materialSourceRecord(row))
  }

  addMaterialSources(sources: WorkspaceMaterialSourceRecord[]): WorkspaceMaterialSourcesWriteResult {
    this.assertFormal()
    if (!this.formalMaterialSourcesReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书素材资料尚未迁入 SQLite。', { recoverable: true })
    assertMaterialSources(sources)
    if (!sources.length) return { sources: [], mirror: null }
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    try {
      this.transaction(() => {
        for (const source of sources) this.insertMaterialSource(projectId, source)
        mirror = this.prepareMaterialSourcesMirror(projectId, timestamp)
      }, 'write')
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new AppError('CONFLICT', '这条资料已经保存过，请直接使用已有资料卡。', { recoverable: true })
      }
      throw error
    }
    const ids = new Set(sources.map((source) => source.id))
    return { sources: this.listMaterialSources().filter((source) => ids.has(source.id)), mirror }
  }

  updateMaterialSource(source: WorkspaceMaterialSourceRecord): WorkspaceMaterialSourceWriteResult {
    this.assertFormal()
    if (!this.formalMaterialSourcesReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书素材资料尚未迁入 SQLite。', { recoverable: true })
    assertMaterialSources([source])
    const projectId = String(this.projectRow()!.id)
    const currentRow = this.row(this.database.prepare('SELECT * FROM material_sources WHERE project_id = ? AND id = ?').get(projectId, source.id))
    if (!currentRow) throw new AppError('NOT_FOUND', '这条资料不存在或已经移除，请重新选择。', { recoverable: true })
    const current = this.materialSourceRecord(currentRow)
    if (current.sourceType !== 'manual') {
      const immutable = (value: WorkspaceMaterialSourceRecord): string => JSON.stringify({
        provider: value.provider, sourceType: value.sourceType, externalId: value.externalId ?? null,
        url: value.url ?? null, author: value.author ?? null, publishedAt: value.publishedAt ?? null,
        capturedAt: value.capturedAt, excerpt: value.excerpt, references: value.references ?? [], contentHash: value.contentHash
      })
      if (immutable(current) !== immutable(source)) throw new AppError('CONFLICT', '联网采风的来源与原始摘录不能直接改写。', { recoverable: true })
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    try {
      this.transaction(() => {
        this.database.prepare(`
          UPDATE material_sources SET provider = ?, source_type = ?, external_id = ?, url = ?, normalized_url = ?, title = ?, author = ?,
            published_at = ?, captured_at = ?, updated_at = ?, excerpt = ?, user_notes = ?, references_json = ?, content_hash = ?
          WHERE project_id = ? AND id = ?
        `).run(source.provider, source.sourceType, source.externalId ?? null, source.url ?? null, normalizedMaterialUrl(source.url), source.title,
          source.author ?? null, source.publishedAt ?? null, source.capturedAt, source.updatedAt ?? timestamp, source.excerpt, source.userNotes,
          JSON.stringify(source.references ?? []), source.contentHash, projectId, source.id)
        mirror = this.prepareMaterialSourcesMirror(projectId, timestamp)
      }, 'write')
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new AppError('CONFLICT', '修改后的资料与已有资料重复，请核对后保留一份。', { recoverable: true })
      }
      throw error
    }
    return { source: this.materialSourceRecord(this.row(this.database.prepare('SELECT * FROM material_sources WHERE project_id = ? AND id = ?').get(projectId, source.id))!), mirror }
  }

  materialSourcesMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'material_sources_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalCanonicalEventsReady(): boolean {
    this.assertFormal()
    return Number(this.projectRow()?.canonical_events_ready ?? 0) === 1
  }

  importCanonicalEvents(events: WorkspaceCanonicalEventRecord[], observedMirrorHash?: string): WorkspaceCanonicalEventsWriteResult {
    this.assertFormal()
    if (this.formalCanonicalEventsReady()) return { events: this.listCanonicalEvents(), mirror: null }
    assertCanonicalEvents(events)
    const projectId = String(this.projectRow()!.id)
    if (this.row(this.database.prepare('SELECT id FROM canonical_events WHERE project_id = ? LIMIT 1').get(projectId))) {
      throw this.integrityError('正式事件表在迁移完成前已经包含数据。')
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      for (const event of events) {
        this.insertCanonicalEvent(projectId, event)
      }
      this.database.prepare('UPDATE projects SET canonical_events_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      mirror = this.prepareCanonicalEventsMirror(projectId, timestamp, observedMirrorHash)
    }, 'write')
    return { events: this.listCanonicalEvents(), mirror }
  }

  listCanonicalEvents(): WorkspaceCanonicalEventRecord[] {
    this.assertFormal()
    if (!this.formalCanonicalEventsReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书正式事件尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    return this.rows(this.database.prepare('SELECT * FROM canonical_events WHERE project_id = ? ORDER BY created_at DESC, id').all(projectId))
      .map((row) => this.canonicalEventRecord(row))
  }

  createCanonicalEvent(event: WorkspaceCanonicalEventRecord): WorkspaceCanonicalEventWriteResult {
    this.assertFormal()
    if (!this.formalCanonicalEventsReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书正式事件尚未迁入 SQLite。', { recoverable: true })
    assertCanonicalEvents([event])
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    try {
      this.transaction(() => {
        const conflict = this.listCanonicalEvents().find((item) => sameCanonicalEventSlot(item, event)
          && normalizeStoryText(item.event) !== normalizeStoryText(event.event))
        if (conflict) {
          const group = conflict.conflictGroupId || this.id()
          if (!conflict.conflictGroupId) this.database.prepare('UPDATE canonical_events SET conflict_group_id = ? WHERE project_id = ? AND id = ?').run(group, projectId, conflict.id)
          event = { ...event, conflictGroupId: group }
        }
        this.insertCanonicalEvent(projectId, event)
        this.eventVersions(projectId).captureCreated(event, timestamp)
        mirror = this.prepareCanonicalEventsMirror(projectId, timestamp)
      }, 'write')
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new AppError('CONFLICT', '相同事件候选已经存在，请核对后使用已有记录。', { recoverable: true })
      }
      throw error
    }
    return { event: this.canonicalEventRecord(this.row(this.database.prepare('SELECT * FROM canonical_events WHERE project_id = ? AND id = ?').get(projectId, event.id))!), mirror }
  }

  approveCanonicalEvent(id: string): WorkspaceCanonicalEventWriteResult {
    this.assertFormal()
    if (!this.formalCanonicalEventsReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书正式事件尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror: WorkspaceMirrorPlan | null = null
    this.transaction(() => {
      const row = this.row(this.database.prepare('SELECT * FROM canonical_events WHERE project_id = ? AND id = ?').get(projectId, id))
      if (!row) throw new AppError('NOT_FOUND', '事件候选不存在或已经移除。', { recoverable: true })
      const versions = this.eventVersions(projectId)
      versions.baseline(this.canonicalEventRecord(row), String(row.created_at))
      // The legacy ID-only action must not adopt an unseen edit of an approved event.
      if (row.status === 'approved') return
      const latest = versions.list(id).at(-1)!
      if (latest.status === 'approved') return
      const approved = versions.append(id, latest.id, { ...latest, status: 'approved', creator: 'author' }, timestamp)
      this.updateCanonicalEventProjection(projectId, id, approved, timestamp)
      mirror = this.prepareCanonicalEventsMirror(projectId, timestamp)
    }, 'write')
    return { event: this.canonicalEventRecord(this.row(this.database.prepare('SELECT * FROM canonical_events WHERE project_id = ? AND id = ?').get(projectId, id))!), mirror }
  }

  listCanonicalEventVersions(eventId: string): StoryEventVersion[] {
    this.assertFormal()
    if (this.readSchemaVersion !== undefined && this.readSchemaVersion < 38) {
      if (!this.formalCanonicalEventsReady() || !this.row(this.database.prepare('SELECT id FROM canonical_events WHERE project_id = ? AND id = ?').get(String(this.projectRow()!.id), eventId))) {
        throw new AppError('NOT_FOUND', '事件不存在于当前作品。', { recoverable: true })
      }
      return []
    }
    return this.eventVersions(String(this.projectRow()!.id)).list(eventId)
  }

  canonicalEventVersionHeads(eventId: string): StoryEventVersionHeads | null {
    this.assertFormal()
    if (this.readSchemaVersion !== undefined && this.readSchemaVersion < 38) {
      this.listCanonicalEventVersions(eventId)
      return null
    }
    const versions = this.eventVersions(String(this.projectRow()!.id))
    versions.list(eventId)
    return versions.heads(eventId)
  }

  baselineCanonicalEventVersions(): StoryEventVersion[] {
    this.assertFormal()
    return this.transaction(() => {
      const versions = this.eventVersions(String(this.projectRow()!.id))
      return this.listCanonicalEvents().map((event) => versions.baseline(event, event.createdAt))
    })
  }

  appendCanonicalEventVersion(input: AppendStoryEventVersionInput): WorkspaceCanonicalEventVersionWriteResult {
    this.assertFormal()
    assertAppendStoryEventVersionInput(input)
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    return this.transaction(() => {
      const row = this.row(this.database.prepare('SELECT * FROM canonical_events WHERE project_id = ? AND id = ?').get(projectId, input.eventId))
      if (!row) throw new AppError('NOT_FOUND', '事件不存在于当前作品。', { recoverable: true })
      this.canonicalEventRecord(row)
      const versions = this.eventVersions(projectId)
      const version = versions.append(input.eventId, input.expectedVersionId, input, timestamp)
      const heads = versions.heads(input.eventId)!
      let mirror: WorkspaceMirrorPlan | null = null
      if (version.status === 'approved' || heads.approvedVersionId === null) {
        this.updateCanonicalEventProjection(projectId, input.eventId, version, timestamp)
        mirror = this.prepareCanonicalEventsMirror(projectId, timestamp)
      }
      return { version, heads, mirror }
    })
  }

  canonicalEventsMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'canonical_events_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalCharacterStateReady(): boolean {
    this.assertFormal()
    return Number(this.projectRow()?.character_state_ready ?? 0) === 1
  }

  importCharacterState(content: string, contentHash: string, observedMirrorHash?: string): WorkspaceCharacterStateWriteResult {
    this.assertFormal()
    if (this.formalCharacterStateReady()) return { document: this.characterState(), mirror: null }
    const projectId = String(this.projectRow()!.id)
    assertCharacterStateDocument(content, contentHash, projectId)
    if (this.row(this.database.prepare('SELECT project_id FROM character_state_documents WHERE project_id = ?').get(projectId))) {
      throw this.integrityError('人物状态表在正式迁移前已经包含数据。')
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO character_state_documents (project_id, revision, content_json, content_hash, updated_at)
        VALUES (?, 1, ?, ?, ?)
      `).run(projectId, content, contentHash, timestamp)
      this.database.prepare('UPDATE projects SET character_state_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      mirror = this.prepareCharacterStateMirror(projectId, timestamp, observedMirrorHash)
    }, 'write')
    return { document: this.characterState(), mirror }
  }

  characterState(): WorkspaceCharacterStateDocument {
    this.assertFormal()
    if (!this.formalCharacterStateReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书人物状态尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const row = this.row(this.database.prepare('SELECT * FROM character_state_documents WHERE project_id = ?').get(projectId))
    if (!row) throw this.integrityError('人物状态迁移标记与正式内容不一致。')
    const content = String(row.content_json)
    const contentHash = String(row.content_hash)
    assertCharacterStateDocument(content, contentHash, projectId)
    return { content, contentHash, revision: Number(row.revision), updatedAt: String(row.updated_at) }
  }

  replaceCharacterState(expectedContentHash: string, content: string, contentHash: string): WorkspaceCharacterStateWriteResult {
    this.assertFormal()
    if (!this.formalCharacterStateReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书人物状态尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    assertCharacterStateDocument(content, contentHash, projectId)
    const current = this.characterState()
    if (current.contentHash !== expectedContentHash) throw new AppError('CONFLICT', '人物状态已被其他操作更新，请重新读取后再试。', { recoverable: true })
    if (current.contentHash === contentHash) return { document: current, mirror: null }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE character_state_documents
        SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
        WHERE project_id = ? AND content_hash = ?
      `).run(content, contentHash, timestamp, projectId, expectedContentHash)
      if (Number(changed.changes) !== 1) throw new AppError('CONFLICT', '人物状态已被其他操作更新，请重新读取后再试。', { recoverable: true })
      mirror = this.prepareCharacterStateMirror(projectId, timestamp)
    }, 'write')
    return { document: this.characterState(), mirror }
  }

  characterStateMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'character_state_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalOutlinePlanningStateReady(): boolean {
    this.assertFormal()
    return Number(this.projectRow()?.outline_planning_state_ready ?? 0) === 1
  }

  importOutlinePlanningState(content: string, contentHash: string, observedMirrorHash?: string): WorkspaceOutlinePlanningStateWriteResult {
    this.assertFormal()
    if (this.formalOutlinePlanningStateReady()) return { document: this.outlinePlanningState(), mirror: null }
    assertOutlinePlanningStateDocument(content, contentHash)
    const projectId = String(this.projectRow()!.id)
    if (this.row(this.database.prepare('SELECT project_id FROM outline_planning_state_documents WHERE project_id = ?').get(projectId))) {
      throw this.integrityError('谋篇工作流表在正式迁移前已经包含数据。')
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO outline_planning_state_documents (project_id, revision, content_json, content_hash, updated_at)
        VALUES (?, 1, ?, ?, ?)
      `).run(projectId, content, contentHash, timestamp)
      this.database.prepare('UPDATE projects SET outline_planning_state_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      mirror = this.prepareOutlinePlanningStateMirror(projectId, timestamp, observedMirrorHash)
    }, 'write')
    return { document: this.outlinePlanningState(), mirror }
  }

  outlinePlanningState(): WorkspaceOutlinePlanningStateDocument {
    this.assertFormal()
    if (!this.formalOutlinePlanningStateReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书谋篇工作流尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const row = this.row(this.database.prepare('SELECT * FROM outline_planning_state_documents WHERE project_id = ?').get(projectId))
    if (!row) throw this.integrityError('谋篇工作流迁移标记与正式内容不一致。')
    const content = String(row.content_json)
    const contentHash = String(row.content_hash)
    assertOutlinePlanningStateDocument(content, contentHash)
    return { content, contentHash, revision: Number(row.revision), updatedAt: String(row.updated_at) }
  }

  replaceOutlinePlanningState(expectedContentHash: string, content: string, contentHash: string): WorkspaceOutlinePlanningStateWriteResult {
    this.assertFormal()
    if (!this.formalOutlinePlanningStateReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书谋篇工作流尚未迁入 SQLite。', { recoverable: true })
    assertOutlinePlanningStateDocument(content, contentHash)
    const projectId = String(this.projectRow()!.id)
    const current = this.outlinePlanningState()
    if (current.contentHash !== expectedContentHash) throw new AppError('CONFLICT', '谋篇工作流已被其他操作更新，请重新读取后再试。', { recoverable: true })
    if (current.contentHash === contentHash) return { document: current, mirror: null }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE outline_planning_state_documents
        SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
        WHERE project_id = ? AND content_hash = ?
      `).run(content, contentHash, timestamp, projectId, expectedContentHash)
      if (Number(changed.changes) !== 1) throw new AppError('CONFLICT', '谋篇工作流已被其他操作更新，请重新读取后再试。', { recoverable: true })
      mirror = this.prepareOutlinePlanningStateMirror(projectId, timestamp)
    }, 'write')
    return { document: this.outlinePlanningState(), mirror }
  }

  outlinePlanningStateMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'outline_planning_state_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalAiSettingsReady(): boolean {
    this.assertFormal()
    return Number(this.projectRow()?.ai_settings_ready ?? 0) === 1
  }

  importAiSettings(content: string, contentHash: string, observedMirrorHash?: string, guard?: WorkspaceAiSettingsWriteGuard) {
    this.assertFormal()
    if (guard) this.assertAiSettingsWriteGuard(guard)
    if (this.formalAiSettingsReady()) return { document: this.aiSettings(), mirror: null }
    const models = bookModelConfigInputs(assertAiSettingsDocument(content, contentHash))
    const projectId = String(this.projectRow()!.id)
    if (this.row(this.database.prepare('SELECT project_id FROM ai_settings_documents WHERE project_id = ?').get(projectId))) {
      throw this.integrityError('AI 模型配置表在正式迁移前已经包含数据。')
    }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (guard) this.assertAiSettingsWriteGuard(guard)
      this.database.prepare(`
        INSERT INTO ai_settings_documents (project_id, revision, content_json, content_hash, updated_at)
        VALUES (?, 1, ?, ?, ?)
      `).run(projectId, content, contentHash, timestamp)
      this.database.prepare('UPDATE projects SET ai_settings_ready = 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
      this.reconcileModelConfigsInTransaction(models)
      mirror = this.prepareAiSettingsMirror(projectId, timestamp, observedMirrorHash)
    }, 'write')
    return { document: this.aiSettings(), mirror }
  }

  aiSettings() {
    this.assertFormal()
    if (!this.formalAiSettingsReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书 AI 模型配置尚未迁入 SQLite。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const row = this.row(this.database.prepare('SELECT * FROM ai_settings_documents WHERE project_id = ?').get(projectId))
    if (!row) throw this.integrityError('AI 模型配置迁移标记与正式内容不一致。')
    const content = String(row.content_json)
    const contentHash = String(row.content_hash)
    assertAiSettingsDocument(content, contentHash)
    return { content, contentHash, revision: Number(row.revision), updatedAt: String(row.updated_at) }
  }

  replaceAiSettings(expectedContentHash: string, content: string, contentHash: string, guard?: WorkspaceAiSettingsWriteGuard) {
    this.assertFormal()
    if (guard) this.assertAiSettingsWriteGuard(guard)
    if (!this.formalAiSettingsReady()) throw new AppError('FEATURE_UNAVAILABLE', '本书 AI 模型配置尚未迁入 SQLite。', { recoverable: true })
    const models = bookModelConfigInputs(assertAiSettingsDocument(content, contentHash))
    const projectId = String(this.projectRow()!.id)
    const current = this.aiSettings()
    if (current.contentHash !== expectedContentHash) throw new AppError('CONFLICT', 'AI 模型配置已被其他操作更新，请重新读取后再试。', { recoverable: true })
    if (current.contentHash === contentHash) return { document: current, mirror: null }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (guard) this.assertAiSettingsWriteGuard(guard)
      const changed = this.database.prepare(`
        UPDATE ai_settings_documents
        SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
        WHERE project_id = ? AND content_hash = ?
      `).run(content, contentHash, timestamp, projectId, expectedContentHash)
      if (Number(changed.changes) !== 1) throw new AppError('CONFLICT', 'AI 模型配置已被其他操作更新，请重新读取后再试。', { recoverable: true })
      this.reconcileModelConfigsInTransaction(models)
      mirror = this.prepareAiSettingsMirror(projectId, timestamp)
    }, 'write')
    return { document: this.aiSettings(), mirror }
  }

  private assertAiSettingsWriteGuard(guard: WorkspaceAiSettingsWriteGuard): void {
    this.assertFormal()
    const project = this.projectRow()
    const revision = this.formalAiSettingsReady() ? this.aiSettings().revision : null
    if (project?.id !== guard.projectId || revision !== guard.revision) {
      throw new AppError('CONFLICT', '作品或模型分配版本已变化，未覆盖其他分配。', { recoverable: true })
    }
    guard.assertActive()
  }

  aiSettingsMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'ai_settings_json' AND source_id = ?").get(projectId, projectId))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  formalWorkspaceConfigReady(kind: WorkspaceConfigDocumentKind): boolean {
    this.assertFormal()
    assertWorkspaceConfigKind(kind)
    if (this.readSchemaVersion !== undefined && this.readSchemaVersion < 30) return false
    const projectId = String(this.projectRow()?.id ?? '')
    return Boolean(this.row(this.database.prepare('SELECT project_id FROM workspace_config_documents WHERE project_id = ? AND kind = ?').get(projectId, kind)))
  }

  importWorkspaceConfig(kind: WorkspaceConfigDocumentKind, content: string, contentHash: string, observedMirrorHash?: string) {
    this.assertFormal()
    assertWorkspaceConfigDocument(kind, content, contentHash)
    if (this.formalWorkspaceConfigReady(kind)) return { document: this.workspaceConfig(kind), mirror: null }
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO workspace_config_documents (project_id, kind, revision, content_json, content_hash, updated_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(projectId, kind, content, contentHash, timestamp)
      mirror = this.prepareWorkspaceConfigMirror(projectId, kind, timestamp, observedMirrorHash)
    }, 'write')
    return { document: this.workspaceConfig(kind), mirror }
  }

  workspaceConfig(kind: WorkspaceConfigDocumentKind) {
    this.assertFormal()
    assertWorkspaceConfigKind(kind)
    const projectId = String(this.projectRow()!.id)
    const row = this.row(this.database.prepare('SELECT * FROM workspace_config_documents WHERE project_id = ? AND kind = ?').get(projectId, kind))
    if (!row) throw new AppError('FEATURE_UNAVAILABLE', `本书${workspaceConfigLabel(kind)}尚未迁入 SQLite。`, { recoverable: true })
    const content = String(row.content_json)
    const contentHash = String(row.content_hash)
    assertWorkspaceConfigDocument(kind, content, contentHash)
    return { content, contentHash, revision: Number(row.revision), updatedAt: String(row.updated_at) }
  }

  replaceWorkspaceConfig(kind: WorkspaceConfigDocumentKind, expectedContentHash: string, content: string, contentHash: string) {
    this.assertFormal()
    assertWorkspaceConfigDocument(kind, content, contentHash)
    const projectId = String(this.projectRow()!.id)
    const current = this.workspaceConfig(kind)
    if (current.contentHash !== expectedContentHash) throw new AppError('CONFLICT', `${workspaceConfigLabel(kind)}已被其他操作更新，请重新读取后再试。`, { recoverable: true })
    if (current.contentHash === contentHash) return { document: current, mirror: null }
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE workspace_config_documents
        SET revision = revision + 1, content_json = ?, content_hash = ?, updated_at = ?
        WHERE project_id = ? AND kind = ? AND content_hash = ?
      `).run(content, contentHash, timestamp, projectId, kind, expectedContentHash)
      if (Number(changed.changes) !== 1) throw new AppError('CONFLICT', `${workspaceConfigLabel(kind)}已被其他操作更新，请重新读取后再试。`, { recoverable: true })
      mirror = this.prepareWorkspaceConfigMirror(projectId, kind, timestamp)
    }, 'write')
    return { document: this.workspaceConfig(kind), mirror }
  }

  workspaceConfigMirror(kind: WorkspaceConfigDocumentKind): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null {
    this.assertFormal()
    assertWorkspaceConfigKind(kind)
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare("SELECT relative_path, content_hash, status FROM mirror_entries WHERE project_id = ? AND source_type = 'workspace_config_json' AND source_id = ?").get(projectId, kind))
    if (!row) return null
    return { relativePath: String(row.relative_path), contentHash: String(row.content_hash), status: String(row.status) as WorkspaceMirrorStatus }
  }

  promoteIdeaToWorldRule(ideaId: string, expectedUpdatedAt: string): WorkspaceIdeaPromotionResult {
    this.assertFormal()
    assertBoundedIdentifier(ideaId, '灵感 ID')
    assertBoundedText(expectedUpdatedAt, '灵感版本', 80)
    const projectId = String(this.projectRow()?.id ?? '')
    const current = this.row(this.database.prepare('SELECT * FROM ideas WHERE id = ? AND project_id = ?').get(ideaId, projectId))
    if (!current) throw new AppError('NOT_FOUND', '要提升的灵感不存在。', { recoverable: true })
    if (String(current.updated_at) !== expectedUpdatedAt) throw new AppError('CONFLICT', '灵感在提升前已经变化，请重新打开后确认。', { recoverable: true })
    if (current.promoted_to_id) {
      if (current.promoted_to_type !== 'world_rule') throw new AppError('CONFLICT', '这条灵感已提升为梗概，不能再次提升为世界设定。', { recoverable: true })
      const entity = this.row(this.database.prepare('SELECT * FROM entities WHERE id = ? AND project_id = ?').get(String(current.promoted_to_id), projectId))
      if (!entity) throw this.integrityError('灵感记录指向的正式设定不存在。')
      return { idea: this.ideaRecord(current), entity: this.entityRecord(entity), mirrors: [] }
    }
    const normalizedName = normalizeCharacterName(String(current.title))
    const duplicate = this.row(this.database.prepare("SELECT id FROM entities WHERE project_id = ? AND entity_type = 'world_rule' AND normalized_name = ?").get(projectId, normalizedName))
    if (duplicate) throw new AppError('CONFLICT', '已经存在同名世界设定，请先调整灵感标题，避免覆盖正式内容。', { recoverable: true })
    const timestamp = this.now().toISOString()
    const entityId = this.id()
    const profileJson = JSON.stringify({ statement: String(current.content), sourceType: 'idea', sourceIdeaId: ideaId })
    let mirrors: WorkspaceMirrorPlan[] = []
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO entities (id, project_id, entity_type, canonical_name, normalized_name, profile_json, status, created_at, updated_at)
        VALUES (?, ?, 'world_rule', ?, ?, ?, 'approved', ?, ?)
      `).run(entityId, projectId, String(current.title), normalizedName, profileJson, timestamp, timestamp)
      this.database.prepare(`
        UPDATE ideas SET status = 'approved', promoted_to_type = 'world_rule', promoted_to_id = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(entityId, timestamp, ideaId, projectId)
      mirrors = [this.prepareIdeasMirror(projectId, timestamp), this.prepareStoryEntitiesMirror(projectId, timestamp)]
    }, 'write')
    return {
      idea: this.ideaRecord(this.row(this.database.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId))!),
      entity: this.entityRecord(this.row(this.database.prepare('SELECT * FROM entities WHERE id = ?').get(entityId))!),
      mirrors
    }
  }

  promoteIdeaToSummary(ideaId: string, expectedUpdatedAt: string): { idea: WorkspaceIdeaRecord; outline: WorkspaceOutlineRecord; mirrors: WorkspaceMirrorPlan[] } {
    this.assertFormal()
    assertBoundedIdentifier(ideaId, '灵感 ID')
    assertBoundedText(expectedUpdatedAt, '灵感版本', 80)
    return this.manuscriptTransaction({ name: 'promoteIdeaToSummary', args: [ideaId, expectedUpdatedAt] }, () => {
      const projectId = String(this.projectRow()!.id)
      const current = this.listIdeas().find((idea) => idea.id === ideaId)
      if (!current) throw new AppError('NOT_FOUND', '要提升的灵感不存在。', { recoverable: true })
      if (current.updatedAt !== expectedUpdatedAt || current.status === 'archived') throw new AppError('CONFLICT', '灵感已改变或已归档，请重新打开后确认。', { recoverable: true })
      if (current.promotedToId) {
        if (current.promotedToType !== 'summary') throw new AppError('CONFLICT', '这条灵感已经提升为世界设定。', { recoverable: true })
        const outline = this.formalOutlines().find((item) => item.legacyKey === 'total')
        if (!outline) throw this.integrityError('灵感指向的正式梗概不存在。')
        return { idea: current, outline, mirrors: [] }
      }
      if (this.row(this.database.prepare("SELECT id FROM outline_nodes WHERE project_id = ? AND legacy_key = 'total'").get(projectId))) {
        throw new AppError('CONFLICT', '本书已有总纲/梗概，未覆盖。请在谋篇中编辑已有内容。', { recoverable: true })
      }
      const result = this.writeFormalOutlineInTransaction({
        legacyKey: 'total', nodeType: 'summary', seq: 1, title: current.title, content: current.content,
        planning: { metadataJson: JSON.stringify({ sourceType: 'idea', sourceIdeaId: current.id, sourceUpdatedAt: current.updatedAt }) }
      })
      const node = this.row(this.database.prepare("SELECT id FROM outline_nodes WHERE project_id = ? AND legacy_key = 'total'").get(projectId))!
      const timestamp = this.now().toISOString()
      this.database.prepare("UPDATE ideas SET status = 'approved', promoted_to_type = 'summary', promoted_to_id = ?, updated_at = ? WHERE id = ? AND project_id = ?")
        .run(String(node.id), timestamp, ideaId, projectId)
      return { idea: this.listIdeas().find((idea) => idea.id === ideaId)!, outline: result.outline,
        mirrors: [result.mirror, this.prepareIdeasMirror(projectId, timestamp)] }
    })
  }

  resourceLedger(resourceEntityId?: string): WorkspaceResourceLedgerView {
    this.assertFormal()
    if (resourceEntityId) assertBoundedIdentifier(resourceEntityId, '资源资料 ID')
    const projectId = String(this.projectRow()?.id ?? '')
    if (resourceEntityId) {
      const resource = this.row(this.database.prepare('SELECT id FROM entities WHERE id = ? AND project_id = ? AND entity_type = \'item\'').get(resourceEntityId, projectId))
      if (!resource) throw new AppError('VALIDATION_ERROR', '资源必须是当前作品中的物品资料。', { recoverable: true })
    }
    const balanceRows = this.rows(this.database.prepare(`
      SELECT entities.id AS resource_entity_id, entities.canonical_name AS resource_name,
        COALESCE(SUM(resource_ledger.delta), 0) AS quantity,
        MAX(resource_ledger.created_at) AS last_changed_at
      FROM entities
      LEFT JOIN resource_ledger ON resource_ledger.project_id = entities.project_id
        AND resource_ledger.resource_entity_id = entities.id
      WHERE entities.project_id = ? AND entities.entity_type = 'item'
        AND (? IS NULL OR entities.id = ?)
      GROUP BY entities.id, entities.canonical_name
      ORDER BY entities.status = 'archived', entities.canonical_name COLLATE NOCASE, entities.id
    `).all(projectId, resourceEntityId ?? null, resourceEntityId ?? null)).map((row) => this.resourceBalanceRecord(row))
    const entryRows = this.rows(this.database.prepare(`
      SELECT ledger.*, entities.canonical_name AS resource_name
      FROM resource_ledger ledger
      JOIN entities ON entities.id = ledger.resource_entity_id AND entities.project_id = ledger.project_id
      WHERE ledger.project_id = ? AND (? IS NULL OR ledger.resource_entity_id = ?)
      ORDER BY ledger.created_at DESC, ledger.id DESC
    `).all(projectId, resourceEntityId ?? null, resourceEntityId ?? null)).map((row) => this.resourceLedgerRecord(row))
    return { balances: balanceRows, entries: entryRows }
  }

  appendResourceLedger(input: WorkspaceResourceLedgerInput): WorkspaceResourceLedgerWriteResult {
    this.assertFormal()
    assertBoundedIdentifier(input.operationKey, '资源记账操作号')
    assertBoundedIdentifier(input.resourceEntityId, '资源资料 ID')
    if (!Number.isSafeInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 1_000_000_000) {
      throw new AppError('VALIDATION_ERROR', '资源变化量必须是非零整数，且绝对值不超过 10 亿。', { recoverable: true })
    }
    const eventId = input.eventId?.trim() || null
    const factId = input.factId?.trim() || null
    const note = input.note?.trim() || ''
    if (eventId) assertBoundedIdentifier(eventId, '来源事件 ID')
    if (factId) assertBoundedIdentifier(factId, '来源事实 ID')
    assertBoundedText(note, '记账说明', 2_000)
    const projectId = String(this.projectRow()?.id ?? '')
    const resource = this.row(this.database.prepare(`
      SELECT id, canonical_name FROM entities
      WHERE id = ? AND project_id = ? AND entity_type = 'item' AND status = 'approved'
    `).get(input.resourceEntityId, projectId))
    if (!resource) throw new AppError('VALIDATION_ERROR', '只有当前作品中“已确认”的物品资料可以记账。', { recoverable: true })
    if (factId && !this.row(this.database.prepare('SELECT id FROM facts WHERE id = ? AND project_id = ?').get(factId, projectId))) {
      throw new AppError('VALIDATION_ERROR', '来源事实不属于当前作品。', { recoverable: true })
    }
    const existing = this.row(this.database.prepare(`
      SELECT ledger.*, entities.canonical_name AS resource_name FROM resource_ledger ledger
      JOIN entities ON entities.id = ledger.resource_entity_id
      WHERE ledger.project_id = ? AND ledger.operation_key = ?
    `).get(projectId, input.operationKey))
    if (existing) {
      const record = this.resourceLedgerRecord(existing)
      if (record.resourceEntityId !== input.resourceEntityId || record.delta !== input.delta || record.eventId !== eventId || record.factId !== factId || record.note !== note) {
        throw new AppError('CONFLICT', '这次记账操作号已经用于另一笔内容，请刷新后重试。', { recoverable: true })
      }
      const balance = this.resourceLedger(input.resourceEntityId).balances[0]
      return { entry: record, balance, mirror: null, idempotent: true }
    }
    const previousQuantity = Number(this.database.prepare(`
      SELECT COALESCE(SUM(delta), 0) AS quantity FROM resource_ledger
      WHERE project_id = ? AND resource_entity_id = ?
    `).get(projectId, input.resourceEntityId)?.quantity ?? 0)
    const resultingQuantity = previousQuantity + input.delta
    if (!Number.isSafeInteger(resultingQuantity)) throw new AppError('VALIDATION_ERROR', '记账后的资源数量超出安全范围。', { recoverable: true })
    const id = this.id()
    const timestamp = this.now().toISOString()
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO resource_ledger (id, project_id, resource_entity_id, event_id, delta, resulting_quantity, fact_id, note, operation_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, input.resourceEntityId, eventId, input.delta, resultingQuantity, factId, note, input.operationKey, timestamp)
      mirror = this.prepareResourceLedgerMirror(projectId, timestamp)
    }, 'write')
    const entry = this.resourceLedgerRecord(this.row(this.database.prepare(`
      SELECT ledger.*, entities.canonical_name AS resource_name FROM resource_ledger ledger
      JOIN entities ON entities.id = ledger.resource_entity_id
      WHERE ledger.id = ? AND ledger.project_id = ?
    `).get(id, projectId))!)
    return {
      entry,
      balance: { resourceEntityId: input.resourceEntityId, resourceName: String(resource.canonical_name), quantity: resultingQuantity, isNegative: resultingQuantity < 0, lastChangedAt: timestamp },
      mirror,
      idempotent: false
    }
  }

  foreshadowLedger(status?: WorkspaceForeshadowStatus): WorkspaceForeshadowLedgerView {
    this.assertFormal()
    if (status && !['open', 'resolved', 'discarded'].includes(status)) throw new AppError('VALIDATION_ERROR', '伏笔状态无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const foreshadows = this.rows(this.database.prepare(`
      SELECT foreshadows.*, planted.legacy_chapter_id AS planted_legacy_chapter_id,
        payoff.legacy_chapter_id AS payoff_legacy_chapter_id
      FROM foreshadows
      LEFT JOIN chapters planted ON planted.id = foreshadows.planted_chapter_id
      LEFT JOIN chapters payoff ON payoff.id = foreshadows.payoff_chapter_id
      WHERE foreshadows.project_id = ? AND (? IS NULL OR foreshadows.status = ?)
      ORDER BY CASE foreshadows.status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
        foreshadows.updated_at DESC, foreshadows.id
    `).all(projectId, status ?? null, status ?? null)).map((row) => this.foreshadowRecord(row))
    const actions = this.rows(this.database.prepare(`
      SELECT actions.*, foreshadows.title AS foreshadow_title, chapters.legacy_chapter_id
      FROM foreshadow_actions actions
      JOIN foreshadows ON foreshadows.id = actions.foreshadow_id AND foreshadows.project_id = actions.project_id
      LEFT JOIN chapters ON chapters.id = actions.chapter_id
      WHERE actions.project_id = ?
      ORDER BY actions.created_at DESC, actions.id DESC
    `).all(projectId)).map((row) => this.foreshadowActionRecord(row))
    return { foreshadows, actions }
  }

  recordForeshadowAction(input: WorkspaceForeshadowActionInput): WorkspaceForeshadowActionWriteResult {
    this.assertFormal()
    assertBoundedIdentifier(input.operationKey, '伏笔操作号')
    if (!['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(input.action)) throw new AppError('VALIDATION_ERROR', '伏笔动作无效。', { recoverable: true })
    if (!['manual', 'chapter_draft', 'writing_agent'].includes(input.sourceType)) throw new AppError('VALIDATION_ERROR', '伏笔来源无效。', { recoverable: true })
    if (input.foreshadowId) assertBoundedIdentifier(input.foreshadowId, '伏笔 ID')
    if (input.legacyChapterId !== undefined && (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1)) throw new AppError('VALIDATION_ERROR', '伏笔来源章节无效。', { recoverable: true })
    const title = input.title?.trim() || ''
    const description = input.description?.trim() || ''
    const evidence = input.evidence?.trim() || ''
    if (title) assertBoundedText(title, '伏笔名称', 500)
    assertBoundedText(description, '伏笔说明', 5_000)
    assertBoundedText(evidence, '伏笔正文证据', 20_000)
    const projectId = String(this.projectRow()?.id ?? '')
    const existingActionRow = this.row(this.database.prepare(`
      SELECT actions.*, foreshadows.title AS foreshadow_title, chapters.legacy_chapter_id
      FROM foreshadow_actions actions
      JOIN foreshadows ON foreshadows.id = actions.foreshadow_id
      LEFT JOIN chapters ON chapters.id = actions.chapter_id
      WHERE actions.project_id = ? AND actions.operation_key = ?
    `).get(projectId, input.operationKey))
    if (existingActionRow) {
      const action = this.foreshadowActionRecord(existingActionRow)
      const expectedTitle = title || action.foreshadowTitle
      if (action.action !== input.action || action.foreshadowId !== (input.foreshadowId || action.foreshadowId)
        || action.foreshadowTitle !== expectedTitle || action.chapterId !== (input.legacyChapterId ?? null)
        || action.description !== description || action.evidence !== evidence || action.sourceType !== input.sourceType) {
        throw new AppError('CONFLICT', '这次伏笔操作号已经用于另一项内容，请刷新后重试。', { recoverable: true })
      }
      const foreshadow = this.foreshadowLedger().foreshadows.find((item) => item.id === action.foreshadowId)
      if (!foreshadow) throw this.integrityError('伏笔动作缺少对应的当前状态。')
      return { foreshadow, action, mirror: null, idempotent: true }
    }
    const chapter = input.legacyChapterId === undefined ? null : this.row(this.database.prepare(`
      SELECT id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ? AND status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (input.legacyChapterId !== undefined && !chapter) throw new AppError('VALIDATION_ERROR', '伏笔来源章节不属于当前作品。', { recoverable: true })
    const normalizedTitle = title ? normalizeCharacterName(title) : ''
    let foreshadowRow = input.foreshadowId
      ? this.row(this.database.prepare('SELECT * FROM foreshadows WHERE id = ? AND project_id = ?').get(input.foreshadowId, projectId))
      : normalizedTitle
        ? this.row(this.database.prepare('SELECT * FROM foreshadows WHERE project_id = ? AND normalized_title = ?').get(projectId, normalizedTitle))
        : undefined
    if (input.action === 'plant' && !title) throw new AppError('VALIDATION_ERROR', '埋设伏笔时必须填写伏笔名称。', { recoverable: true })
    if (input.action === 'plant' && foreshadowRow) throw new AppError('CONFLICT', '同名伏笔已经存在，请在原伏笔上记录推进或回收。', { recoverable: true })
    if (input.action !== 'plant' && !foreshadowRow) throw new AppError('VALIDATION_ERROR', '请先选择要推进或回收的正式伏笔。', { recoverable: true })
    if (foreshadowRow && String(foreshadowRow.status) !== 'open') throw new AppError('CONFLICT', '已回收或废弃的伏笔不能继续追加动作。', { recoverable: true })

    const timestamp = this.now().toISOString()
    const foreshadowId = foreshadowRow ? String(foreshadowRow.id) : this.id()
    const actionId = this.id()
    const chapterId = chapter ? String(chapter.id) : null
    let mirror!: WorkspaceMirrorPlan
    this.transaction(() => {
      if (!foreshadowRow) {
        this.database.prepare(`
          INSERT INTO foreshadows (id, project_id, title, normalized_title, status, planted_chapter_id, payoff_chapter_id, data_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'open', ?, NULL, '{}', ?, ?)
        `).run(foreshadowId, projectId, title, normalizedTitle, chapterId, timestamp, timestamp)
      } else {
        const nextStatus = input.action === 'resolve' ? 'resolved' : input.action === 'discard' ? 'discarded' : 'open'
        const payoffChapterId = input.action === 'resolve' ? chapterId : null
        this.database.prepare(`
          UPDATE foreshadows SET status = ?, payoff_chapter_id = CASE WHEN ? = 'resolved' THEN ? ELSE payoff_chapter_id END, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(nextStatus, nextStatus, payoffChapterId, timestamp, foreshadowId, projectId)
      }
      this.database.prepare(`
        INSERT INTO foreshadow_actions (id, project_id, foreshadow_id, chapter_id, action, description, evidence, source_type, operation_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(actionId, projectId, foreshadowId, chapterId, input.action, description, evidence, input.sourceType, input.operationKey, timestamp)
      mirror = this.prepareForeshadowLedgerMirror(projectId, timestamp)
    }, 'write')
    foreshadowRow = this.row(this.database.prepare(`
      SELECT foreshadows.*, planted.legacy_chapter_id AS planted_legacy_chapter_id,
        payoff.legacy_chapter_id AS payoff_legacy_chapter_id
      FROM foreshadows
      LEFT JOIN chapters planted ON planted.id = foreshadows.planted_chapter_id
      LEFT JOIN chapters payoff ON payoff.id = foreshadows.payoff_chapter_id
      WHERE foreshadows.id = ? AND foreshadows.project_id = ?
    `).get(foreshadowId, projectId))
    const actionRow = this.row(this.database.prepare(`
      SELECT actions.*, foreshadows.title AS foreshadow_title, chapters.legacy_chapter_id
      FROM foreshadow_actions actions
      JOIN foreshadows ON foreshadows.id = actions.foreshadow_id
      LEFT JOIN chapters ON chapters.id = actions.chapter_id
      WHERE actions.id = ? AND actions.project_id = ?
    `).get(actionId, projectId))
    return { foreshadow: this.foreshadowRecord(foreshadowRow!), action: this.foreshadowActionRecord(actionRow!), mirror, idempotent: false }
  }

  upsertRealTrialChapter(input: WorkspaceRealTrialChapterInput): WorkspaceRealTrialChapterRecord {
    this.assertFormal()
    if (!Number.isSafeInteger(input.legacyChapterId) || input.legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '试跑章节无效。', { recoverable: true })
    assertBoundedIdentifier(input.bodyVersionId, '试跑正文版本')
    const minuteValues = [input.planningMinutes, input.writingMinutes, input.aiEditingMinutes, input.factReviewMinutes]
    const countValues = [input.diffAcceptedBlocks, input.diffRejectedBlocks, input.misappliedChanges, input.falsePositiveFindings, input.usefulFindings]
    if (minuteValues.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 1_440)) throw new AppError('VALIDATION_ERROR', '试跑耗时必须是 0—1440 分钟的整数。', { recoverable: true })
    if (countValues.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 100_000)) throw new AppError('VALIDATION_ERROR', '试跑计数超出范围。', { recoverable: true })
    if (input.modelCost !== null && (!Number.isFinite(input.modelCost) || input.modelCost < 0 || input.modelCost > 1_000_000)) throw new AppError('VALIDATION_ERROR', '模型费用无效。', { recoverable: true })
    if (!Number.isSafeInteger(input.satisfaction) || input.satisfaction < 1 || input.satisfaction > 5) throw new AppError('VALIDATION_ERROR', '满意度必须是 1—5。', { recoverable: true })
    const bypassedFeatures = String(input.bypassedFeatures || '').trim()
    const notes = String(input.notes || '').trim()
    assertBoundedText(bypassedFeatures, '绕开功能', 2_000)
    assertBoundedText(notes, '试跑备注', 10_000)
    const projectId = String(this.projectRow()?.id ?? '')
    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id, chapters.current_body_version_id, versions.content_hash
      FROM chapters JOIN body_versions versions ON versions.id = chapters.current_body_version_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
    `).get(projectId, input.legacyChapterId))
    if (!chapter || String(chapter.current_body_version_id) !== input.bodyVersionId) throw new AppError('CONFLICT', '正文版本已经变化，请刷新后再记录本章试跑。', { recoverable: true })
    const chapterId = String(chapter.id)
    const automatic = this.realTrialAutomaticMetrics(projectId, chapterId)
    const automaticJson = JSON.stringify(automatic)
    const existing = this.row(this.database.prepare(`
      SELECT id, created_at FROM real_trial_chapter_records
      WHERE project_id = ? AND chapter_id = ? AND body_version_id = ?
    `).get(projectId, chapterId, input.bodyVersionId))
    const id = existing ? String(existing.id) : this.id()
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO real_trial_chapter_records (
          id, project_id, chapter_id, body_version_id, content_hash,
          planning_minutes, writing_minutes, ai_editing_minutes, fact_review_minutes,
          diff_accepted_blocks, diff_rejected_blocks, misapplied_changes,
          false_positive_findings, useful_findings, model_cost, satisfaction,
          continue_next_chapter, bypassed_features, notes, automatic_metrics_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, chapter_id, body_version_id) DO UPDATE SET
          planning_minutes = excluded.planning_minutes, writing_minutes = excluded.writing_minutes,
          ai_editing_minutes = excluded.ai_editing_minutes, fact_review_minutes = excluded.fact_review_minutes,
          diff_accepted_blocks = excluded.diff_accepted_blocks, diff_rejected_blocks = excluded.diff_rejected_blocks,
          misapplied_changes = excluded.misapplied_changes, false_positive_findings = excluded.false_positive_findings,
          useful_findings = excluded.useful_findings, model_cost = excluded.model_cost,
          satisfaction = excluded.satisfaction, continue_next_chapter = excluded.continue_next_chapter,
          bypassed_features = excluded.bypassed_features, notes = excluded.notes,
          automatic_metrics_json = excluded.automatic_metrics_json, updated_at = excluded.updated_at
      `).run(id, projectId, chapterId, input.bodyVersionId, String(chapter.content_hash),
        input.planningMinutes, input.writingMinutes, input.aiEditingMinutes, input.factReviewMinutes,
        automatic.diffAcceptedBlocks, automatic.diffRejectedBlocks, input.misappliedChanges,
        automatic.falsePositiveFindings, automatic.usefulFindings, input.modelCost, input.satisfaction,
        input.continueNextChapter ? 1 : 0, bypassedFeatures, notes, automaticJson,
        existing ? String(existing.created_at) : timestamp, timestamp)
    }, 'write')
    const row = this.row(this.database.prepare(`
      SELECT records.*, chapters.legacy_chapter_id FROM real_trial_chapter_records records
      JOIN chapters ON chapters.id = records.chapter_id WHERE records.id = ? AND records.project_id = ?
    `).get(id, projectId))
    return this.realTrialChapterRecord(row!)
  }

  listRealTrialChapters(): WorkspaceRealTrialChapterRecord[] {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const rows = this.rows(this.database.prepare(`
      SELECT records.*, chapters.legacy_chapter_id, chapters.seq
      FROM real_trial_chapter_records records
      JOIN chapters ON chapters.id = records.chapter_id
      WHERE records.project_id = ?
      ORDER BY chapters.seq, records.updated_at DESC, records.id DESC
    `).all(projectId))
    const seen = new Set<number>()
    return rows.flatMap((row) => {
      const legacyChapterId = Number(row.legacy_chapter_id)
      if (seen.has(legacyChapterId)) return []
      seen.add(legacyChapterId)
      return [this.realTrialChapterRecord(row)]
    })
  }

  upsertRealTrialConclusion(input: WorkspaceRealTrialConclusionInput): WorkspaceRealTrialConclusionRecord {
    this.assertFormal()
    if (!['continue', 'narrow', 'adjust'].includes(input.decision)) throw new AppError('VALIDATION_ERROR', '试跑结论无效。', { recoverable: true })
    const highPriorityProblems = String(input.highPriorityProblems || '').trim()
    const mediumPriorityProblems = String(input.mediumPriorityProblems || '').trim()
    const lowPriorityProblems = String(input.lowPriorityProblems || '').trim()
    const rationale = String(input.rationale || '').trim()
    const nextScope = String(input.nextScope || '').trim()
    assertBoundedText(highPriorityProblems, '高优先级问题', 4_000)
    assertBoundedText(mediumPriorityProblems, '中优先级问题', 4_000)
    assertBoundedText(lowPriorityProblems, '低优先级问题', 4_000)
    assertBoundedText(rationale, '试跑决策依据', 10_000)
    assertBoundedText(nextScope, '下一阶段范围', 10_000)
    if (!highPriorityProblems || !rationale || !nextScope) throw new AppError('VALIDATION_ERROR', '请填写高优先级问题、决策依据和下一阶段范围。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const chapterCount = Number(this.database.prepare(`
      SELECT COUNT(DISTINCT chapter_id) AS value FROM real_trial_chapter_records WHERE project_id = ?
    `).get(projectId)?.value ?? 0)
    if (chapterCount < 20) throw new AppError('CONFLICT', `完成至少 20 章记录后才能形成试跑结论；当前 ${chapterCount} 章。`, { recoverable: true })
    const chapterCountAtDecision = Math.min(30, chapterCount)
    const existing = this.row(this.database.prepare(`SELECT id, created_at FROM real_trial_conclusions WHERE project_id = ?`).get(projectId))
    const id = existing ? String(existing.id) : this.id()
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO real_trial_conclusions (
          id, project_id, chapter_count_at_decision, decision, high_priority_problems,
          medium_priority_problems, low_priority_problems, rationale, next_scope, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          chapter_count_at_decision = excluded.chapter_count_at_decision,
          decision = excluded.decision,
          high_priority_problems = excluded.high_priority_problems,
          medium_priority_problems = excluded.medium_priority_problems,
          low_priority_problems = excluded.low_priority_problems,
          rationale = excluded.rationale,
          next_scope = excluded.next_scope,
          updated_at = excluded.updated_at
      `).run(id, projectId, chapterCountAtDecision, input.decision, highPriorityProblems,
        mediumPriorityProblems, lowPriorityProblems, rationale, nextScope,
        existing ? String(existing.created_at) : timestamp, timestamp)
    }, 'write')
    return this.realTrialConclusion()!
  }

  realTrialConclusion(): WorkspaceRealTrialConclusionRecord | null {
    this.assertFormal()
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare(`SELECT * FROM real_trial_conclusions WHERE project_id = ?`).get(projectId))
    if (!row) return null
    const decision = String(row.decision)
    if (!['continue', 'narrow', 'adjust'].includes(decision)) throw this.integrityError('真实试跑结论无效。')
    return {
      id: String(row.id),
      chapterCountAtDecision: Number(row.chapter_count_at_decision),
      decision: decision as WorkspaceRealTrialConclusionRecord['decision'],
      highPriorityProblems: String(row.high_priority_problems),
      mediumPriorityProblems: String(row.medium_priority_problems),
      lowPriorityProblems: String(row.low_priority_problems),
      rationale: String(row.rationale),
      nextScope: String(row.next_scope),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  latestSummaryForChapter(legacyChapterId: number): WorkspaceSummaryVersionRecord | null {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '摘要章节无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const row = this.row(this.database.prepare(`
      SELECT summaries.*, chapters.legacy_chapter_id FROM summary_versions summaries
      JOIN chapters ON chapters.id = summaries.chapter_id
      WHERE summaries.project_id = ? AND chapters.legacy_chapter_id = ?
      ORDER BY summaries.created_at DESC LIMIT 1
    `).get(projectId, legacyChapterId))
    return row ? this.summaryVersionRecord(row) : null
  }

  chapterDerivativeStatus(legacyChapterId: number): WorkspaceChapterDerivativeStatus {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '派生状态章节无效。', { recoverable: true })
    const projectId = String(this.projectRow()?.id ?? '')
    const chapter = this.row(this.database.prepare(`
      SELECT chapters.id, chapters.current_body_version_id, versions.content_hash
      FROM chapters LEFT JOIN body_versions versions ON versions.id = chapters.current_body_version_id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? AND chapters.status <> 'archived'
    `).get(projectId, legacyChapterId))
    if (!chapter) throw new AppError('NOT_FOUND', '章节不存在。', { recoverable: true })
    const chapterId = String(chapter.id)
    const bodyVersionId = chapter.current_body_version_id ? String(chapter.current_body_version_id) : null
    const contentHash = chapter.content_hash ? String(chapter.content_hash) : null
    const count = (sql: string, ...params: Array<string | null>) => Number(this.row(this.database.prepare(sql).get(...params))?.count ?? 0)
    return {
      bodyVersionId,
      factBatches: {
        current: bodyVersionId && contentHash ? count(`SELECT COUNT(*) AS count FROM fact_batches WHERE project_id = ? AND chapter_id = ? AND body_version_id = ? AND content_hash = ? AND status <> 'STALE'`, projectId, chapterId, bodyVersionId, contentHash) : 0,
        stale: count(`SELECT COUNT(*) AS count FROM fact_batches WHERE project_id = ? AND chapter_id = ? AND status = 'STALE'`, projectId, chapterId)
      },
      summaries: {
        current: bodyVersionId ? count(`SELECT COUNT(*) AS count FROM summary_versions WHERE project_id = ? AND chapter_id = ? AND body_version_id = ? AND status IN ('draft', 'approved')`, projectId, chapterId, bodyVersionId) : 0,
        stale: count(`SELECT COUNT(*) AS count FROM summary_versions WHERE project_id = ? AND chapter_id = ? AND status = 'stale'`, projectId, chapterId)
      },
      ruleRuns: {
        current: bodyVersionId && contentHash ? count(`SELECT COUNT(*) AS count FROM rule_runs WHERE project_id = ? AND chapter_id = ? AND body_version_id = ? AND content_hash = ? AND status <> 'stale'`, projectId, chapterId, bodyVersionId, contentHash) : 0,
        stale: count(`SELECT COUNT(*) AS count FROM rule_runs WHERE project_id = ? AND chapter_id = ? AND status = 'stale'`, projectId, chapterId)
      }
    }
  }

  latestApprovedSummaryBefore(legacyChapterId: number): WorkspaceSummaryVersionRecord | null {
    return this.approvedSummariesBefore(legacyChapterId, 1)[0] ?? null
  }

  approvedSummariesBefore(legacyChapterId: number, limit = 3): WorkspaceSummaryVersionRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '目标章节无效。', { recoverable: true })
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new AppError('VALIDATION_ERROR', '近期摘要数量无效。', { recoverable: true })
    this.freezeContextFilesBefore(legacyChapterId)
    const projectId = String(this.projectRow()?.id ?? '')
    return this.rows(this.database.prepare(`
      SELECT ranked.* FROM (
        SELECT summaries.*, chapters.legacy_chapter_id, chapters.seq AS chapter_seq,
          ROW_NUMBER() OVER (PARTITION BY chapters.id ORDER BY summaries.created_at DESC, summaries.id DESC) AS summary_rank
        FROM summary_versions summaries
        JOIN chapters ON chapters.id = summaries.chapter_id
        WHERE summaries.project_id = ? AND summaries.status = 'approved'
          AND chapters.status <> 'archived'
          AND summaries.body_version_id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
          AND chapters.seq < (SELECT seq FROM chapters WHERE project_id = ? AND legacy_chapter_id = ? AND status <> 'archived')
      ) ranked
      WHERE ranked.summary_rank = 1
      ORDER BY ranked.chapter_seq DESC, ranked.created_at DESC
      LIMIT ?
    `).all(projectId, projectId, legacyChapterId, limit)).map((row) => this.summaryVersionRecord(row))
  }

  currentDocumentChunksBefore(legacyChapterId: number, limit = 400): WorkspaceDocumentChunkRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '正文分块目标章节无效。', { recoverable: true })
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) throw new AppError('VALIDATION_ERROR', '正文分块读取上限无效。', { recoverable: true })
    this.freezeContextFilesBefore(legacyChapterId)
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      const missing = this.rows(this.database.prepare(`
        SELECT chapters.id AS chapter_id,
          COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id) AS body_version_id,
          versions.content, versions.content_hash
        FROM chapters
        JOIN body_versions versions ON versions.id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
        WHERE chapters.project_id = ? AND chapters.status <> 'archived'
          AND NOT EXISTS (
            SELECT 1 FROM document_chunks chunks
            WHERE chunks.body_version_id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
          )
      `).all(projectId))
      for (const row of missing) this.writeDocumentChunks(projectId, String(row.chapter_id), String(row.body_version_id), this.readStoredText(row.content, row.content_hash), timestamp)
    })
    return this.rows(this.database.prepare(`
      SELECT chunks.*, chapters.legacy_chapter_id, chapters.seq AS chapter_position, chapters.title AS chapter_title
      FROM document_chunks chunks
      JOIN chapters ON chapters.id = chunks.chapter_id
      JOIN chapters target ON target.project_id = chapters.project_id AND target.legacy_chapter_id = ?
      WHERE chunks.project_id = ? AND chapters.status <> 'archived'
        AND chapters.seq < target.seq
        AND chunks.body_version_id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
      ORDER BY chapters.seq DESC, chunks.ordinal ASC
      LIMIT ?
    `).all(legacyChapterId, projectId, limit)).map((row) => this.documentChunkRecord(row))
  }

  searchCurrentDocumentChunksBefore(legacyChapterId: number, queryTerms: string[], limit = 400): WorkspaceDocumentChunkRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '正文检索目标章节无效。', { recoverable: true })
    if (!Array.isArray(queryTerms) || queryTerms.length > 96 || queryTerms.some((term) => typeof term !== 'string' || term.length < 2 || term.length > 32)) {
      throw new AppError('VALIDATION_ERROR', '正文检索词无效。', { recoverable: true })
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) throw new AppError('VALIDATION_ERROR', '正文检索上限无效。', { recoverable: true })
    const terms = [...new Set(queryTerms.map((term) => normalizeRetrievalText(term).trim()).filter(Boolean))]
    if (!terms.length) return []
    this.freezeContextFilesBefore(legacyChapterId)
    const projectId = String(this.projectRow()!.id)
    const timestamp = this.now().toISOString()
    this.transaction(() => {
      const missing = this.rows(this.database.prepare(`
        SELECT chapters.id AS chapter_id,
          COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id) AS body_version_id,
          versions.content, versions.content_hash
        FROM chapters
        JOIN body_versions versions ON versions.id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
        WHERE chapters.project_id = ? AND chapters.status <> 'archived'
          AND NOT EXISTS (
            SELECT 1 FROM document_chunks chunks
            WHERE chunks.body_version_id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
          )
      `).all(projectId))
      for (const row of missing) this.writeDocumentChunks(projectId, String(row.chapter_id), String(row.body_version_id), this.readStoredText(row.content, row.content_hash), timestamp)
    })
    const matches = terms.map(() => '(instr(search_content, ?) > 0 OR instr(search_title, ?) > 0)').join(' OR ')
    const parameters = terms.flatMap((term) => [term, term])
    return this.rows(this.database.prepare(`
      WITH candidates AS MATERIALIZED (
        SELECT chunks.*, chapters.legacy_chapter_id, chapters.seq AS chapter_position, chapters.title AS chapter_title,
          lanjian_retrieval_text(lanjian_manuscript_text(chunks.content, chunks.content_hash)) AS search_content,
          lanjian_retrieval_text(chapters.title) AS search_title
        FROM document_chunks chunks
        JOIN chapters ON chapters.id = chunks.chapter_id
        JOIN chapters target ON target.project_id = chapters.project_id AND target.legacy_chapter_id = ?
        WHERE chunks.project_id = ? AND chapters.status <> 'archived'
          AND chapters.seq < target.seq
          AND chunks.body_version_id = COALESCE(chapters.confirmed_body_version_id, chapters.current_body_version_id)
      )
      SELECT id, legacy_chapter_id, chapter_position, chapter_title, body_version_id,
        ordinal, content, content_hash, token_estimate, created_at
      FROM candidates WHERE (${matches})
      ORDER BY chapter_position DESC, ordinal ASC
      LIMIT ?
    `).all(legacyChapterId, projectId, ...parameters, limit)).map((row) => this.documentChunkRecord(row))
  }

  rebuildCharacterSnapshots(): WorkspaceCharacterSnapshotRecord[] {
    this.assertFormal()
    this.transaction(() => this.rebuildCharacterSnapshotsInCurrentTransaction(this.now().toISOString()))
    return this.characterSnapshotHistory()
  }

  characterSnapshotHistory(): WorkspaceCharacterSnapshotRecord[] {
    this.assertFormal()
    const projectId = String(this.projectRow()!.id)
    const snapshotCount = Number(this.scalar(this.database.prepare('SELECT COUNT(*) AS value FROM character_snapshots WHERE project_id = ?').get(projectId), 'value'))
    const factCount = Number(this.scalar(this.database.prepare("SELECT COUNT(*) AS value FROM facts WHERE project_id = ? AND subject_type = 'character' AND status = 'APPROVED'").get(projectId), 'value'))
    if (snapshotCount === 0 && factCount > 0) this.transaction(() => this.rebuildCharacterSnapshotsInCurrentTransaction(this.now().toISOString()))
    return this.rows(this.database.prepare(`
      SELECT snapshots.*, chapters.legacy_chapter_id
      FROM character_snapshots snapshots
      JOIN chapters ON chapters.id = snapshots.through_chapter_id
      WHERE snapshots.project_id = ? AND chapters.status <> 'archived'
      ORDER BY snapshots.character_id, snapshots.through_seq
    `).all(projectId)).map((row) => this.characterSnapshotRecord(row))
  }

  characterSnapshotsBefore(legacyChapterId: number): WorkspaceCharacterSnapshotRecord[] {
    this.assertFormal()
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '人物快照目标章节无效。', { recoverable: true })
    const projectId = String(this.projectRow()!.id)
    const target = this.row(this.database.prepare('SELECT seq FROM chapters WHERE project_id = ? AND legacy_chapter_id = ? AND status <> ?').get(projectId, legacyChapterId, 'archived'))
    if (!target) throw new AppError('NOT_FOUND', '人物快照目标章节不存在。', { recoverable: true })
    const snapshotCount = Number(this.scalar(this.database.prepare('SELECT COUNT(*) AS value FROM character_snapshots WHERE project_id = ?').get(projectId), 'value'))
    const factCount = Number(this.scalar(this.database.prepare("SELECT COUNT(*) AS value FROM facts WHERE project_id = ? AND subject_type = 'character' AND status = 'APPROVED'").get(projectId), 'value'))
    if (snapshotCount === 0 && factCount > 0) this.transaction(() => this.rebuildCharacterSnapshotsInCurrentTransaction(this.now().toISOString()))
    return this.rows(this.database.prepare(`
      SELECT snapshots.*, chapters.legacy_chapter_id
      FROM character_snapshots snapshots
      JOIN chapters ON chapters.id = snapshots.through_chapter_id
      WHERE snapshots.project_id = ? AND chapters.status <> 'archived' AND snapshots.through_seq < ?
        AND NOT EXISTS (
          SELECT 1 FROM character_snapshots newer
          JOIN chapters newer_chapters ON newer_chapters.id = newer.through_chapter_id
          WHERE newer.project_id = snapshots.project_id
            AND newer.character_id = snapshots.character_id
            AND newer_chapters.status <> 'archived'
            AND newer.through_seq < ?
            AND newer.through_seq > snapshots.through_seq
        )
      ORDER BY json_extract(snapshots.state_json, '$.name') COLLATE NOCASE, snapshots.character_id
      LIMIT 2000
    `).all(projectId, Number(target.seq), Number(target.seq))).map((row) => this.characterSnapshotRecord(row))
  }

  verifySnapshot(snapshot: LegacyWorkspaceSnapshot): void {
    this.assertOpen()
    this.assertConnectionSettings()
    const quick = String(this.scalar(this.database.prepare('PRAGMA quick_check').get(), 'quick_check'))
    if (quick.toLocaleLowerCase() !== 'ok') throw this.integrityError('作品数据库完整性检查未通过。')
    if (this.database.prepare('PRAGMA foreign_key_check').all().length) throw this.integrityError('作品数据库存在失效的数据关联。')
    this.verifyProjection(snapshot)
  }

  inspect(): WorkspaceDatabaseInspection {
    this.assertOpen()
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    const chapters = this.rows(this.database.prepare(`
      SELECT
        c.id, c.legacy_chapter_id, c.seq, c.title, c.status, c.current_body_version_id,
        b.content, b.content_hash,
        (SELECT COUNT(*) FROM body_versions versions WHERE versions.chapter_id = c.id) AS version_count,
        m.status AS mirror_status, m.relative_path AS mirror_relative_path
      FROM chapters c
      LEFT JOIN body_versions b ON b.id = c.current_body_version_id
      LEFT JOIN mirror_entries m ON m.project_id = c.project_id AND m.source_type = 'chapter_markdown' AND m.source_id = c.id
      WHERE c.project_id = ?
      ORDER BY c.seq
    `).all(String(project.id))).map((row) => ({
      id: String(row.id),
      legacyChapterId: Number(row.legacy_chapter_id),
      position: Number(row.seq),
      title: String(row.title),
      status: String(row.status),
      currentBodyVersionId: String(row.current_body_version_id || ''),
      currentContent: row.current_body_version_id ? this.readStoredText(row.content, row.content_hash) : '',
      currentContentHash: String(row.content_hash ?? ''),
      versionCount: Number(row.version_count),
      mirrorStatus: String(row.mirror_status || ''),
      mirrorRelativePath: String(row.mirror_relative_path || '')
    }))
    return {
      schemaVersion: Number(this.scalar(this.database.prepare('PRAGMA user_version').get(), 'user_version')),
      foreignKeys: Number(this.scalar(this.database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys')) === 1,
      journalMode: String(this.scalar(this.database.prepare('PRAGMA journal_mode').get(), 'journal_mode')),
      project: {
        id: String(project.id),
        name: String(project.name),
        storageMode: project.storage_mode as 'shadow' | 'sqlite',
        manifestHash: String(project.legacy_manifest_hash)
      },
      chapters
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private taskRunRecord(row: Record<string, unknown>): WorkspaceTaskRunRecord {
    const status = String(row.status) as WorkspaceTaskStatus
    if (!workspaceTaskStatuses.includes(status)) throw this.integrityError('AI 任务状态无效。')
    const taskContract = taskContractFromRow(row)
    assertTaskContractSnapshot(taskContract, String(row.task_type), true)
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      legacyChapterId: row.legacy_chapter_id === null || row.legacy_chapter_id === undefined ? null : Number(row.legacy_chapter_id),
      taskType: String(row.task_type),
      status,
      idempotencyKey: String(row.idempotency_key),
      parentTaskRunId: row.parent_task_run_id ? String(row.parent_task_run_id) : null,
      baseBodyVersionId: row.base_body_version_id ? String(row.base_body_version_id) : null,
      contentHash: row.content_hash ? String(row.content_hash) : null,
      contextPackageId: row.context_package_id ? String(row.context_package_id) : null,
      modelConfigId: row.model_config_id ? String(row.model_config_id) : null,
      taskContract,
      attempt: Number(row.attempt),
      checkpointJson: String(row.checkpoint_json),
      errorCode: row.error_code ? String(row.error_code) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      endedAt: row.ended_at ? String(row.ended_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private contextPackageRecord(row: Record<string, unknown>): WorkspaceContextPackageRecord {
    const contentJson = String(row.content_json)
    const contentHash = String(row.content_hash)
    if (!isSha256(contentHash) || hashText(contentJson) !== contentHash) throw this.integrityError('AI 上下文包内容校验失败。')
    assertJsonText(contentJson, 5_000_000, '上下文包内容')
    assertJsonText(String(row.truncation_json), 200_000, '上下文裁剪记录')
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      taskRunId: String(row.task_run_id),
      compilerVersion: String(row.compiler_version),
      contentJson,
      contentHash,
      tokenBudget: Number(row.token_budget),
      estimatedTokens: Number(row.estimated_tokens),
      truncationJson: String(row.truncation_json),
      createdAt: String(row.created_at)
    }
  }

  private generationArtifactRecord(row: Record<string, unknown>): WorkspaceGenerationArtifactRecord {
    const status = String(row.status) as WorkspaceArtifactStatus
    if (!workspaceArtifactStatuses.includes(status)) throw this.integrityError('AI Artifact 状态无效。')
    const content = String(row.content)
    const contentHash = String(row.content_hash)
    if (!isSha256(contentHash) || hashText(content) !== contentHash) throw this.integrityError('AI Artifact 内容校验失败。')
    return {
      id: String(row.id),
      taskRunId: String(row.task_run_id),
      artifactType: String(row.artifact_type),
      status,
      content,
      contentHash,
      schemaValid: Number(row.schema_valid) === 1,
      baseBodyVersionId: row.base_body_version_id ? String(row.base_body_version_id) : null,
      selectionAnchorJson: row.selection_anchor_json ? String(row.selection_anchor_json) : null,
      metadataJson: String(row.metadata_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private findingsForRun(runId: string): WorkspaceFindingRecord[] {
    return this.rows(this.database.prepare(`
      SELECT findings.*, chapters.legacy_chapter_id FROM findings
      LEFT JOIN chapters ON chapters.id = findings.chapter_id
      WHERE findings.rule_run_id = ? AND findings.project_id = ?
      ORDER BY findings.created_at, findings.id
    `).all(runId, String(this.projectRow()?.id ?? ''))).map((row) => this.findingRecord(row))
  }

  private findingRecord(row: Record<string, unknown>): WorkspaceFindingRecord {
    const ruleLayer = String(row.rule_layer) as WorkspaceFindingRecord['ruleLayer']
    const severity = String(row.severity) as WorkspaceFindingRecord['severity']
    const status = String(row.status) as WorkspaceFindingStatus
    if (!['deterministic', 'semantic', 'literary'].includes(ruleLayer)
      || !['blocker', 'warning', 'suggestion'].includes(severity)
      || !findingSeverityMatchesLayer(ruleLayer, severity)
      || !['open', 'accepted', 'ignored', 'exception', 'stale', 'fixed'].includes(status)) {
      throw this.integrityError('一致性检查记录状态无效。')
    }
    const evidenceJson = String(row.evidence_json)
    assertJsonText(evidenceJson, 100_000, '检查证据')
    return {
      id: String(row.id),
      runId: String(row.rule_run_id),
      legacyChapterId: Number(row.legacy_chapter_id),
      bodyVersionId: String(row.body_version_id),
      contentHash: String(row.content_hash),
      ruleLayer,
      severity,
      code: String(row.code),
      title: String(row.title),
      rationale: String(row.rationale),
      evidenceJson,
      suggestedAction: String(row.suggested_action || ''),
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      status,
      resultingBodyVersionId: row.resulting_body_version_id ? String(row.resulting_body_version_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private summaryVersionRecord(row: Record<string, unknown>): WorkspaceSummaryVersionRecord {
    const status = String(row.status) as WorkspaceSummaryVersionRecord['status']
    if (!['draft', 'approved', 'stale', 'rejected'].includes(status)) throw this.integrityError('章节摘要状态无效。')
    const content = String(row.content)
    const contentHash = String(row.content_hash)
    if (!isSha256(contentHash) || hashText(content) !== contentHash) throw this.integrityError('章节摘要内容校验失败。')
    return {
      id: String(row.id),
      legacyChapterId: Number(row.legacy_chapter_id),
      bodyVersionId: String(row.body_version_id),
      content,
      contentHash,
      sourceTaskRunId: row.source_task_run_id ? String(row.source_task_run_id) : null,
      status,
      createdAt: String(row.created_at)
    }
  }

  private modelConfigRecord(row: Record<string, unknown>): WorkspaceModelConfigRecord {
    return {
      id: String(row.id),
      projectId: row.project_id === null || row.project_id === undefined ? null : String(row.project_id),
      provider: String(row.provider),
      modelName: String(row.model_name),
      displayName: String(row.display_name),
      settingsJson: String(row.settings_json),
      inputTokenBudget: row.input_token_budget === null || row.input_token_budget === undefined ? null : Number(row.input_token_budget),
      enabled: Number(row.enabled) === 1,
      isDefault: Number(row.is_default) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private characterAliasRecord(row: Record<string, unknown>): WorkspaceCharacterAliasRecord {
    return {
      characterId: String(row.character_id),
      canonicalName: String(row.canonical_name),
      alias: String(row.alias),
      normalizedAlias: String(row.normalized_alias),
      validFromChapterId: row.valid_from_chapter_id === null || row.valid_from_chapter_id === undefined ? null : Number(row.valid_from_chapter_id),
      validToChapterId: row.valid_to_chapter_id === null || row.valid_to_chapter_id === undefined ? null : Number(row.valid_to_chapter_id),
      createdAt: String(row.created_at)
    }
  }

  private entityRecord(row: Record<string, unknown>): WorkspaceEntityRecord {
    const entityType = String(row.entity_type) as WorkspaceEntityType
    const status = String(row.status) as WorkspaceEntityRecord['status']
    if (!['character', 'location', 'item', 'organization', 'world_rule'].includes(entityType)
      || !['candidate', 'approved', 'archived'].includes(status)) {
      throw this.integrityError('资料对象包含不支持的类型或状态。')
    }
    return {
      id: String(row.id),
      entityType,
      canonicalName: String(row.canonical_name),
      normalizedName: String(row.normalized_name),
      profileJson: String(row.profile_json),
      status,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private entityRelationRecord(row: Record<string, unknown>): WorkspaceEntityRelationRecord {
    return {
      id: String(row.id),
      subjectEntityId: String(row.subject_entity_id),
      predicate: String(row.predicate),
      objectEntityId: String(row.object_entity_id),
      notes: String(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private ideaRecord(row: Record<string, unknown>): WorkspaceIdeaRecord {
    const status = String(row.status) as WorkspaceIdeaStatus
    const promotedToType = row.promoted_to_type === null || row.promoted_to_type === undefined ? null : String(row.promoted_to_type)
    if (!['candidate', 'approved', 'archived'].includes(status) || (promotedToType !== null && !['world_rule', 'summary'].includes(promotedToType))) {
      throw this.integrityError('灵感记录包含不支持的状态或提升类型。')
    }
    return {
      ...(row.source_task_run_id ? { generationSource: { taskId: String(row.source_task_run_id), optionIndex: Number(row.source_option_index) } } : {}),
      id: String(row.id),
      title: String(row.title),
      content: String(row.content),
      status,
      promotedToType: promotedToType as WorkspaceIdeaRecord['promotedToType'],
      promotedToId: row.promoted_to_id === null || row.promoted_to_id === undefined ? null : String(row.promoted_to_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private materialSourceRecord(row: Record<string, unknown>): WorkspaceMaterialSourceRecord {
    let references: WorkspaceMaterialSourceRecord['references']
    try {
      const parsed = JSON.parse(String(row.references_json)) as unknown
      if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object'
        || typeof (item as Record<string, unknown>).title !== 'string' || typeof (item as Record<string, unknown>).url !== 'string')) throw new Error('invalid references')
      references = parsed.length ? parsed as WorkspaceMaterialSourceRecord['references'] : undefined
    } catch { throw this.integrityError('素材资料的来源列表已损坏。') }
    const sourceType = String(row.source_type) as WorkspaceMaterialSourceRecord['sourceType']
    if (!['manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other'].includes(sourceType)) {
      throw this.integrityError('素材资料包含不支持的来源类型。')
    }
    return {
      id: String(row.id), provider: String(row.provider), sourceType,
      ...(row.external_id ? { externalId: String(row.external_id) } : {}),
      ...(row.url ? { url: String(row.url) } : {}), title: String(row.title),
      ...(row.author ? { author: String(row.author) } : {}),
      ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
      capturedAt: String(row.captured_at), ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
      excerpt: String(row.excerpt), userNotes: String(row.user_notes), ...(references ? { references } : {}),
      contentHash: String(row.content_hash)
    }
  }

  private insertMaterialSource(projectId: string, source: WorkspaceMaterialSourceRecord): void {
    this.database.prepare(`
      INSERT INTO material_sources (
        id, project_id, provider, source_type, external_id, url, normalized_url, title, author, published_at,
        captured_at, updated_at, excerpt, user_notes, references_json, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(source.id, projectId, source.provider, source.sourceType, source.externalId ?? null, source.url ?? null,
      normalizedMaterialUrl(source.url), source.title, source.author ?? null, source.publishedAt ?? null, source.capturedAt,
      source.updatedAt ?? null, source.excerpt, source.userNotes, JSON.stringify(source.references ?? []), source.contentHash)
  }

  private canonicalEventRecord(row: Record<string, unknown>): WorkspaceCanonicalEventRecord {
    const characters = this.rows(this.database.prepare('SELECT name FROM canonical_event_characters WHERE event_id = ? ORDER BY ordinal').all(String(row.id)))
      .map((item) => String(item.name))
    const evidenceRefs = this.rows(this.database.prepare('SELECT source_id, excerpt FROM canonical_event_evidence_refs WHERE event_id = ? ORDER BY ordinal').all(String(row.id)))
      .map((item) => ({ sourceId: String(item.source_id), excerpt: String(item.excerpt) }))
    const status = String(row.status) as WorkspaceCanonicalEventRecord['status']
    if (!characters.length || !['candidate', 'approved'].includes(status)) throw this.integrityError('正式事件记录缺少人物或有效状态。')
    const versions = this.readSchemaVersion !== undefined && this.readSchemaVersion < 38
      ? [] : this.eventVersions(String(row.project_id)).list(String(row.id))
    const selected = versions.filter((version) => version.status === 'approved').at(-1) ?? versions.at(-1)
    if (!evidenceRefs.length && !selected) {
      throw this.integrityError('旧事件记录缺少来源证据。')
    }
    const event: WorkspaceCanonicalEventRecord = {
      id: String(row.id), time: String(row.time_ref), characters, location: String(row.location_text), event: String(row.event_text),
      ...(row.result_text !== null && row.result_text !== undefined ? { result: String(row.result_text) } : {}), evidenceRefs, confidence: Number(row.confidence), status,
      ...(row.conflict_group_id ? { conflictGroupId: String(row.conflict_group_id) } : {}), createdAt: String(row.created_at),
      ...(row.approved_at ? { approvedAt: String(row.approved_at) } : {})
    }
    if (selected && (event.status !== selected.status || event.time !== selected.content.time
      || event.location !== selected.content.location || event.event !== selected.content.event
      || event.result !== selected.content.result || event.confidence !== selected.content.confidence
      || JSON.stringify(event.characters) !== JSON.stringify(selected.content.characters)
      || JSON.stringify(event.evidenceRefs) !== JSON.stringify(selected.content.evidenceRefs))) {
      throw this.integrityError('事件当前投影与不可变版本不一致，已停止读取和写入。')
    }
    return event
  }

  private insertCanonicalEvent(projectId: string, event: WorkspaceCanonicalEventRecord): void {
    this.assertLegacyEventSignatureAvailable(projectId, event.id, storyEventSignature(event))
    this.database.prepare(`
      INSERT INTO canonical_events (
        id, project_id, time_ref, location_text, event_text, result_text, confidence, status, conflict_group_id,
        event_signature, slot_signature, created_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, projectId, event.time, event.location, event.event, event.result ?? null, event.confidence, event.status,
      event.conflictGroupId ?? null, storyEventSignature(event), canonicalEventSlotSignature(event), event.createdAt, event.approvedAt ?? null)
    const character = this.database.prepare('INSERT INTO canonical_event_characters (event_id, ordinal, name, normalized_name) VALUES (?, ?, ?, ?)')
    event.characters.forEach((name, ordinal) => character.run(event.id, ordinal, name, normalizeStoryText(name)))
    const evidence = this.database.prepare('INSERT INTO canonical_event_evidence_refs (event_id, ordinal, source_id, excerpt) VALUES (?, ?, ?, ?)')
    event.evidenceRefs.forEach((item, ordinal) => evidence.run(event.id, ordinal, item.sourceId, item.excerpt))
  }

  private eventVersions(projectId: string): CanonicalEventVersions {
    return new CanonicalEventVersions(this.database, projectId, this.id)
  }

  private updateCanonicalEventProjection(projectId: string, eventId: string, version: StoryEventVersion, timestamp: string): void {
    const content = version.content
    this.assertLegacyEventSignatureAvailable(projectId, eventId, storyEventSignature(content))
    this.database.prepare(`UPDATE canonical_events SET time_ref = ?, location_text = ?, event_text = ?, result_text = ?, confidence = ?,
      status = ?, event_signature = ?, slot_signature = ?, approved_at = ? WHERE project_id = ? AND id = ?`)
      .run(content.time, content.location, content.event, content.result ?? null, content.confidence, version.status,
        storyEventSignature(content), canonicalEventSlotSignature(content), version.status === 'approved' ? timestamp : null, projectId, eventId)
    this.database.prepare('DELETE FROM canonical_event_characters WHERE event_id = ?').run(eventId)
    const character = this.database.prepare('INSERT INTO canonical_event_characters (event_id, ordinal, name, normalized_name) VALUES (?, ?, ?, ?)')
    content.characters.forEach((name, ordinal) => character.run(eventId, ordinal, name, normalizeStoryText(name)))
    this.database.prepare('DELETE FROM canonical_event_evidence_refs WHERE event_id = ?').run(eventId)
    const evidence = this.database.prepare('INSERT INTO canonical_event_evidence_refs (event_id, ordinal, source_id, excerpt) VALUES (?, ?, ?, ?)')
    content.evidenceRefs.forEach((item, ordinal) => evidence.run(eventId, ordinal, item.sourceId, item.excerpt))
  }

  private assertLegacyEventSignatureAvailable(projectId: string, eventId: string, signature: string): void {
    // Schema 39 prepares distinct identities; it does not opt legacy writers into
    // reviewed unified creation. Keep their former uniqueness rule in this lane.
    if (this.database.prepare('SELECT id FROM canonical_events WHERE project_id = ? AND event_signature = ? AND id <> ? LIMIT 1').get(projectId, signature, eventId)) {
      throw new AppError('CONFLICT', '相同事件候选已经存在，请核对后使用已有记录。', { recoverable: true })
    }
  }

  private resourceLedgerRecord(row: Record<string, unknown>): WorkspaceResourceLedgerRecord {
    const delta = Number(row.delta)
    const resultingQuantity = Number(row.resulting_quantity)
    if (!Number.isSafeInteger(delta) || delta === 0 || !Number.isSafeInteger(resultingQuantity)) {
      throw this.integrityError('资源账本包含无效的数量。')
    }
    return {
      id: String(row.id),
      operationKey: String(row.operation_key),
      resourceEntityId: String(row.resource_entity_id),
      resourceName: String(row.resource_name),
      eventId: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
      factId: row.fact_id === null || row.fact_id === undefined ? null : String(row.fact_id),
      delta,
      resultingQuantity,
      note: String(row.note),
      createdAt: String(row.created_at)
    }
  }

  private resourceBalanceRecord(row: Record<string, unknown>): WorkspaceResourceBalanceRecord {
    const quantity = Number(row.quantity)
    if (!Number.isSafeInteger(quantity)) throw this.integrityError('资源余额超出安全整数范围。')
    return {
      resourceEntityId: String(row.resource_entity_id),
      resourceName: String(row.resource_name),
      quantity,
      isNegative: quantity < 0,
      lastChangedAt: row.last_changed_at === null || row.last_changed_at === undefined ? null : String(row.last_changed_at)
    }
  }

  private foreshadowRecord(row: Record<string, unknown>): WorkspaceForeshadowRecord {
    const status = String(row.status) as WorkspaceForeshadowStatus
    if (!['open', 'resolved', 'discarded'].includes(status)) throw this.integrityError('伏笔账本包含无效状态。')
    return {
      id: String(row.id),
      title: String(row.title),
      normalizedTitle: String(row.normalized_title),
      status,
      plantedChapterId: row.planted_legacy_chapter_id === null || row.planted_legacy_chapter_id === undefined ? null : Number(row.planted_legacy_chapter_id),
      payoffChapterId: row.payoff_legacy_chapter_id === null || row.payoff_legacy_chapter_id === undefined ? null : Number(row.payoff_legacy_chapter_id),
      dataJson: String(row.data_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private foreshadowActionRecord(row: Record<string, unknown>): WorkspaceForeshadowActionRecord {
    const action = String(row.action) as WorkspaceForeshadowActionRecord['action']
    const sourceType = String(row.source_type) as WorkspaceForeshadowActionRecord['sourceType']
    if (!['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(action)
      || !['manual', 'chapter_draft', 'writing_agent'].includes(sourceType)) throw this.integrityError('伏笔动作历史包含无效类型。')
    return {
      id: String(row.id),
      operationKey: String(row.operation_key),
      foreshadowId: String(row.foreshadow_id),
      foreshadowTitle: String(row.foreshadow_title),
      chapterId: row.legacy_chapter_id === null || row.legacy_chapter_id === undefined ? null : Number(row.legacy_chapter_id),
      action,
      description: String(row.description),
      evidence: String(row.evidence),
      sourceType,
      createdAt: String(row.created_at)
    }
  }

  private realTrialAutomaticMetrics(projectId: string, chapterId: string): WorkspaceRealTrialAutomaticMetrics {
    const autosaves = this.row(this.database.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END), 0) AS finalized,
        COALESCE(SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END), 0) AS conflicts,
        COALESCE(SUM(CASE WHEN status = 'staged' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'discarded' THEN 1 ELSE 0 END), 0) AS discarded
      FROM autosave_checkpoints WHERE project_id = ? AND chapter_id = ?
    `).get(projectId, chapterId))!
    const tasks = this.row(this.database.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
        COALESCE(SUM(CASE WHEN status = 'cancelled' AND NOT (${legacyTaskPauseSql}) THEN 1 ELSE 0 END), 0) AS cancelled,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END), 0) AS interrupted,
        COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END), 0) AS retries
      FROM task_runs WHERE project_id = ? AND chapter_id = ?
    `).get(projectId, chapterId))!
    const contextEstimatedTokens = Number(this.database.prepare(`
      SELECT COALESCE(SUM(packages.estimated_tokens), 0) AS value
      FROM context_packages packages JOIN task_runs runs ON runs.id = packages.task_run_id
      WHERE packages.project_id = ? AND runs.chapter_id = ?
    `).get(projectId, chapterId)?.value ?? 0)
    const facts = this.row(this.database.prepare(`
      SELECT COUNT(changes.id) AS candidates,
        COALESCE(SUM(CASE WHEN changes.decision_status <> 'PENDING' THEN 1 ELSE 0 END), 0) AS decisions
      FROM fact_batches batches LEFT JOIN fact_changes changes ON changes.batch_id = batches.id
      WHERE batches.project_id = ? AND batches.chapter_id = ?
    `).get(projectId, chapterId))!
    const factBatchSubmittedDecisions = Number(this.database.prepare(`
      SELECT COALESCE(SUM(CASE WHEN submissions.decision_count > 1 THEN submissions.decision_count ELSE 0 END), 0) AS value
      FROM (
        SELECT COUNT(decisions.id) AS decision_count
        FROM fact_decisions decisions
        JOIN fact_changes changes ON changes.id = decisions.fact_change_id
        JOIN fact_batches batches ON batches.id = changes.batch_id
        WHERE batches.project_id = ? AND batches.chapter_id = ?
        GROUP BY batches.id, decisions.decided_at
      ) submissions
    `).get(projectId, chapterId)?.value ?? 0)
    const findingMetrics = this.row(this.database.prepare(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM((SELECT COUNT(*) FROM finding_decisions history WHERE history.finding_id = f.id)), 0) AS decisions,
        COALESCE(SUM(CASE WHEN latest.decision IN ('accepted', 'fixed') THEN 1 ELSE 0 END), 0) AS useful,
        COALESCE(SUM(CASE WHEN latest.decision = 'ignored' THEN 1 ELSE 0 END), 0) AS false_positive
      FROM findings f LEFT JOIN finding_decisions latest
        ON latest.rowid = (SELECT MAX(rowid) FROM finding_decisions WHERE finding_id = f.id)
      WHERE f.project_id = ? AND f.chapter_id = ?
    `).get(projectId, chapterId))!
    let diffAcceptedBlocks = 0
    let diffRejectedBlocks = 0
    const artifactRows = this.rows(this.database.prepare(`
      SELECT artifacts.status, artifacts.content, artifacts.metadata_json
      FROM generation_artifacts artifacts
      JOIN task_runs runs ON runs.id = artifacts.task_run_id
      WHERE runs.project_id = ? AND runs.chapter_id = ?
        AND artifacts.artifact_type = 'writing_agent_turn'
        AND artifacts.status IN ('applied', 'discarded')
    `).all(projectId, chapterId))
    for (const row of artifactRows) {
      try {
        const turn = JSON.parse(String(row.content)) as { candidate?: { diff?: Array<{ id?: unknown; kind?: unknown }> } }
        const metadata = JSON.parse(String(row.metadata_json)) as { acceptedChangeIds?: unknown; reviewedChangeIds?: unknown }
        const changeIds = new Set((turn.candidate?.diff || []).filter((block) => block.kind === 'change' && typeof block.id === 'string').map((block) => String(block.id)))
        if (!changeIds.size) continue
        if (String(row.status) === 'applied') {
          const accepted = Array.isArray(metadata.acceptedChangeIds)
            ? new Set(metadata.acceptedChangeIds.filter((id): id is string => typeof id === 'string' && changeIds.has(id)))
            : new Set<string>()
          diffAcceptedBlocks += accepted.size
          diffRejectedBlocks += Math.max(0, changeIds.size - accepted.size)
        } else if (Array.isArray(metadata.reviewedChangeIds)) {
          const reviewed = new Set(metadata.reviewedChangeIds.filter((id): id is string => typeof id === 'string' && changeIds.has(id)))
          if (reviewed.size === changeIds.size) diffRejectedBlocks += reviewed.size
        }
      } catch {
        throw this.integrityError('AI 候选核对记录损坏，无法统计真实试跑采用率。')
      }
    }
    return {
      autosaveCheckpoints: Number(autosaves.total),
      autosaveFinalized: Number(autosaves.finalized),
      autosaveConflicts: Number(autosaves.conflicts),
      autosavePending: Number(autosaves.pending),
      autosaveDiscarded: Number(autosaves.discarded),
      aiTasks: Number(tasks.total),
      aiSucceeded: Number(tasks.succeeded),
      aiCancelled: Number(tasks.cancelled),
      aiFailed: Number(tasks.failed),
      aiInterrupted: Number(tasks.interrupted),
      aiRetries: Number(tasks.retries),
      contextEstimatedTokens,
      factCandidates: Number(facts.candidates),
      factDecisions: Number(facts.decisions),
      factBatchSubmittedDecisions,
      findings: Number(findingMetrics.total),
      findingDecisions: Number(findingMetrics.decisions),
      usefulFindings: Number(findingMetrics.useful),
      falsePositiveFindings: Number(findingMetrics.false_positive),
      diffAcceptedBlocks,
      diffRejectedBlocks
    }
  }

  private realTrialChapterRecord(row: Record<string, unknown>): WorkspaceRealTrialChapterRecord {
    const automaticJson = String(row.automatic_metrics_json)
    assertJsonText(automaticJson, 20_000, '真实试跑自动指标')
    const storedAutomatic = JSON.parse(automaticJson) as Partial<WorkspaceRealTrialAutomaticMetrics>
    const automatic: WorkspaceRealTrialAutomaticMetrics = {
      autosaveCheckpoints: Number(storedAutomatic.autosaveCheckpoints ?? 0),
      autosaveFinalized: Number(storedAutomatic.autosaveFinalized ?? 0),
      autosaveConflicts: Number(storedAutomatic.autosaveConflicts ?? 0),
      autosavePending: Number(storedAutomatic.autosavePending ?? 0),
      autosaveDiscarded: Number(storedAutomatic.autosaveDiscarded ?? 0),
      aiTasks: Number(storedAutomatic.aiTasks), aiSucceeded: Number(storedAutomatic.aiSucceeded),
      aiCancelled: Number(storedAutomatic.aiCancelled), aiFailed: Number(storedAutomatic.aiFailed),
      aiInterrupted: Number(storedAutomatic.aiInterrupted), aiRetries: Number(storedAutomatic.aiRetries),
      contextEstimatedTokens: Number(storedAutomatic.contextEstimatedTokens), factCandidates: Number(storedAutomatic.factCandidates),
      factDecisions: Number(storedAutomatic.factDecisions), factBatchSubmittedDecisions: Number(storedAutomatic.factBatchSubmittedDecisions ?? 0), findings: Number(storedAutomatic.findings),
      findingDecisions: storedAutomatic.findingDecisions === undefined
        ? Number(storedAutomatic.usefulFindings ?? row.useful_findings) + Number(storedAutomatic.falsePositiveFindings ?? row.false_positive_findings)
        : Number(storedAutomatic.findingDecisions),
      usefulFindings: storedAutomatic.usefulFindings === undefined ? Number(row.useful_findings) : Number(storedAutomatic.usefulFindings),
      falsePositiveFindings: storedAutomatic.falsePositiveFindings === undefined ? Number(row.false_positive_findings) : Number(storedAutomatic.falsePositiveFindings),
      diffAcceptedBlocks: storedAutomatic.diffAcceptedBlocks === undefined ? Number(row.diff_accepted_blocks) : Number(storedAutomatic.diffAcceptedBlocks),
      diffRejectedBlocks: storedAutomatic.diffRejectedBlocks === undefined ? Number(row.diff_rejected_blocks) : Number(storedAutomatic.diffRejectedBlocks)
    }
    if (Object.values(automatic).some((value) => !Number.isSafeInteger(value) || value < 0)) throw this.integrityError('真实试跑自动指标无效。')
    return {
      id: String(row.id),
      legacyChapterId: Number(row.legacy_chapter_id),
      bodyVersionId: String(row.body_version_id),
      contentHash: String(row.content_hash),
      planningMinutes: Number(row.planning_minutes),
      writingMinutes: Number(row.writing_minutes),
      aiEditingMinutes: Number(row.ai_editing_minutes),
      factReviewMinutes: Number(row.fact_review_minutes),
      diffAcceptedBlocks: Number(row.diff_accepted_blocks),
      diffRejectedBlocks: Number(row.diff_rejected_blocks),
      misappliedChanges: Number(row.misapplied_changes),
      falsePositiveFindings: Number(row.false_positive_findings),
      usefulFindings: Number(row.useful_findings),
      modelCost: row.model_cost === null || row.model_cost === undefined ? null : Number(row.model_cost),
      satisfaction: Number(row.satisfaction),
      continueNextChapter: Number(row.continue_next_chapter) === 1,
      bypassedFeatures: String(row.bypassed_features),
      notes: String(row.notes),
      automatic,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private formalChapterRows(currentFiles = false): WorkspaceChapterRecord[] {
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    const rows = this.rows(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, chapters.seq, chapters.title, chapters.current_body_version_id,
             bodies.content, bodies.content_hash, mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path
      FROM chapters
      JOIN body_versions bodies ON bodies.id = chapters.current_body_version_id
      JOIN body_version_metadata metadata ON metadata.version_id = bodies.id
      JOIN mirror_entries mirrors ON mirrors.project_id = chapters.project_id
        AND mirrors.source_type = 'chapter_markdown' AND mirrors.source_id = chapters.id
      WHERE chapters.project_id = ? AND chapters.status <> 'archived'
      ORDER BY chapters.seq
    `).all(String(project.id)))
    return rows.map((row) => this.chapterRecord(row, currentFiles))
  }

  private formalOutlineRows(currentFiles = false): WorkspaceOutlineRecord[] {
    const project = this.projectRow()
    if (!project) throw this.integrityError('作品数据库缺少项目记录。')
    return this.rows(this.database.prepare(`
      SELECT nodes.*, parents.legacy_key AS parent_legacy_key, mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path,
        metadata.planning_kind, metadata.goal_text, metadata.entry_state_text, metadata.exit_state_text,
        metadata.conflict_text, metadata.turning_point_text, metadata.hook_text, metadata.metadata_json
      FROM outline_nodes nodes
      LEFT JOIN outline_nodes parents ON parents.id = nodes.parent_id
      JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
      JOIN outline_versions versions ON versions.id = nodes.current_version_id
      JOIN mirror_entries mirrors ON mirrors.project_id = nodes.project_id AND mirrors.source_type = 'outline_markdown' AND mirrors.source_id = nodes.id
      WHERE nodes.project_id = ? AND nodes.status <> 'archived'
      ORDER BY CASE metadata.planning_kind WHEN 'summary' THEN 0 WHEN 'volume' THEN 1 WHEN 'stage' THEN 2 ELSE 3 END, nodes.seq
    `).all(String(project.id))).map((row) => this.outlineRecord(row, currentFiles))
  }

  private formalOutlineRecord(legacyKey: string, includeArchived = false): WorkspaceOutlineRecord | undefined {
    const row = this.row(this.database.prepare(`
      SELECT nodes.*, parents.legacy_key AS parent_legacy_key, mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path,
        metadata.planning_kind, metadata.goal_text, metadata.entry_state_text, metadata.exit_state_text,
        metadata.conflict_text, metadata.turning_point_text, metadata.hook_text, metadata.metadata_json
      FROM outline_nodes nodes
      LEFT JOIN outline_nodes parents ON parents.id = nodes.parent_id
      JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
      JOIN outline_versions versions ON versions.id = nodes.current_version_id
      JOIN mirror_entries mirrors ON mirrors.project_id = nodes.project_id AND mirrors.source_type = 'outline_markdown' AND mirrors.source_id = nodes.id
      WHERE nodes.project_id = ? AND nodes.legacy_key = ? ${includeArchived ? '' : "AND nodes.status <> 'archived'"}
    `).get(String(this.projectRow()?.id ?? ''), legacyKey))
    return row ? this.outlineRecord(row) : undefined
  }

  private outlineRecord(row: Record<string, unknown>, currentFiles = false): WorkspaceOutlineRecord {
    const nodeType = String(row.planning_kind) as WorkspaceOutlineRecord['nodeType']
    const mirrorStatus = String(row.mirror_status) as WorkspaceMirrorStatus
    if (!['summary', 'volume', 'stage', 'chapter'].includes(nodeType) || !['pending', 'synced', 'conflict', 'failed'].includes(mirrorStatus)) throw this.integrityError('大纲记录状态无效。')
    const current = currentFiles && this.textAuthority() === 'files-v1' && !this.fileCommand ? this.currentFile(String(row.id), 'outline') : null
    const title = current?.title ?? String(row.title)
    const content = current?.content ?? this.readStoredText(row.content, row.content_hash)
    const contentHash = current?.hash ?? String(row.content_hash)
    if (hashText(content) !== contentHash) throw this.integrityError('大纲内容校验失败。')
    return {
      legacyKey: String(row.legacy_key), parentLegacyKey: row.parent_legacy_key ? String(row.parent_legacy_key) : null,
      nodeType, seq: Number(row.seq), title, content, contentHash,
      revision: hashText(`${row.legacy_key}\u0000${title}\u0000${content}`), currentVersionId: String(row.current_version_id),
      mirrorStatus: current ? current.external ? 'conflict' : 'synced' : mirrorStatus, mirrorRelativePath: current?.relativePath ?? String(row.mirror_relative_path),
      planning: {
        goalText: String(row.goal_text), entryStateText: String(row.entry_state_text), exitStateText: String(row.exit_state_text),
        conflictText: String(row.conflict_text), turningPointText: String(row.turning_point_text), hookText: String(row.hook_text),
        metadataJson: String(row.metadata_json)
      }
    }
  }

  private chapterPlanningRecord(row: Record<string, unknown>): WorkspaceChapterPlanningRecord {
    const lifecycleStatus = String(row.lifecycle_status) as ChapterLifecycleState
    const archivedFromStatus = row.archived_from_status ? String(row.archived_from_status) as Exclude<ChapterLifecycleState, 'ARCHIVED'> : null
    if (!chapterLifecycleStates.includes(lifecycleStatus)
      || (lifecycleStatus === 'ARCHIVED') !== Boolean(archivedFromStatus)) {
      throw this.integrityError('章节生命周期记录无效。')
    }
    const cardStatus = String(row.card_status) as WorkspaceChapterPlanningRecord['card']['status']
    if (!['empty', 'draft', 'confirmed'].includes(cardStatus)) throw this.integrityError('章卡状态无效。')
    const cardData = parseChapterCardJson(String(row.card_json))
    let card: ChapterCard
    try {
      card = normalizeChapterCard({
        goal: String(row.goal_text), entryState: String(row.entry_state_text), beats: cardData.beats,
        conflict: String(row.conflict_text), characters: cardData.characters, pointOfView: String(row.pov_text),
        narrativeDistance: String(row.narrative_distance_text), exitChange: String(row.exit_change_text), hook: String(row.hook_text)
      })
    } catch (error) {
      throw this.integrityError(error instanceof Error ? error.message : '章卡内容无效。')
    }
    return {
      legacyChapterId: Number(row.legacy_chapter_id),
      outlineLegacyKey: row.outline_legacy_key ? String(row.outline_legacy_key) : null,
      lifecycleStatus,
      archivedFromStatus,
      currentBodyVersionId: String(row.current_body_version_id ?? ''),
      confirmedBodyVersionId: row.confirmed_body_version_id ? String(row.confirmed_body_version_id) : null,
      confirmedAt: row.body_confirmed_at ? String(row.body_confirmed_at) : null,
      hasUnconfirmedChanges: Boolean(row.confirmed_body_version_id && row.current_body_version_id !== row.confirmed_body_version_id),
      card: { status: cardStatus, ...card }
    }
  }

  private moveLifecycleForBodyWrite(chapterId: string, hasBody: boolean, timestamp: string): void {
    const row = this.row(this.database.prepare('SELECT lifecycle_status, archived_from_status FROM chapter_workflows WHERE chapter_id = ?').get(chapterId))
    if (!row) throw this.integrityError('章节缺少独立写作生命周期。')
    let currentStatus = String(row.lifecycle_status) as ChapterLifecycleState
    if (currentStatus === 'ARCHIVED') {
      const restore = String(row.archived_from_status) as ChapterLifecycleState
      this.database.prepare(`UPDATE chapter_workflows SET lifecycle_status = ?, archived_from_status = NULL, updated_at = ? WHERE chapter_id = ?`)
        .run(restore, timestamp, chapterId)
      currentStatus = restore
    }
    const target = !hasBody ? currentStatus : currentStatus === 'PLANNED' ? 'DRAFTING'
      : ['REVIEWABLE', 'CONFIRMED'].includes(currentStatus) ? 'REVISING' : currentStatus
    if (target !== currentStatus) this.database.prepare(`
      UPDATE chapter_workflows SET lifecycle_status = ?, archived_from_status = NULL, updated_at = ? WHERE chapter_id = ?
    `).run(target, timestamp, chapterId)
  }

  private formalChapterRecord(legacyChapterId: number, includeArchived = false, currentFiles = false): WorkspaceChapterRecord | undefined {
    const project = this.projectRow()
    if (!project) return undefined
    const row = this.row(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, chapters.seq, chapters.title, chapters.current_body_version_id,
             bodies.content, bodies.content_hash, mirrors.status AS mirror_status, mirrors.relative_path AS mirror_relative_path
      FROM chapters
      JOIN body_versions bodies ON bodies.id = chapters.current_body_version_id
      JOIN body_version_metadata metadata ON metadata.version_id = bodies.id
      JOIN mirror_entries mirrors ON mirrors.project_id = chapters.project_id
        AND mirrors.source_type = 'chapter_markdown' AND mirrors.source_id = chapters.id
      WHERE chapters.project_id = ? AND chapters.legacy_chapter_id = ? ${includeArchived ? '' : "AND chapters.status <> 'archived'"}
    `).get(String(project.id), legacyChapterId))
    return row ? this.chapterRecord(row, currentFiles) : undefined
  }

  private chapterRecord(row: Record<string, unknown>, currentFiles = false): WorkspaceChapterRecord {
    const legacyChapterId = Number(row.legacy_chapter_id)
    const current = currentFiles && this.textAuthority() === 'files-v1' && !this.fileCommand ? this.currentChapterFile(legacyChapterId) : null
    const title = current?.title ?? String(row.title)
    const content = current?.content ?? this.readStoredText(row.content, row.content_hash)
    const mirrorStatus = String(row.mirror_status) as WorkspaceMirrorStatus
    if (!['pending', 'synced', 'conflict', 'failed'].includes(mirrorStatus)) throw this.integrityError('章节镜像状态无效。')
    return {
      legacyChapterId,
      position: Number(row.seq),
      title,
      content,
      contentHash: current?.hash ?? String(row.content_hash),
      wordCount: countWords(content),
      revision: chapterRevision(legacyChapterId, title, content),
      currentVersionId: String(row.current_body_version_id),
      mirrorStatus: current ? current.external ? 'conflict' : 'synced' : mirrorStatus,
      mirrorRelativePath: current?.relativePath ?? String(row.mirror_relative_path)
    }
  }

  private autosaveCheckpointRecord(checkpointId: string): WorkspaceAutosaveCheckpointRecord | undefined {
    const row = this.row(this.database.prepare(`
      SELECT checkpoints.*, chapters.legacy_chapter_id,
        (SELECT COUNT(*) FROM autosave_checkpoint_operations operations WHERE operations.checkpoint_id = checkpoints.id) AS operation_count
      FROM autosave_checkpoints checkpoints
      JOIN chapters ON chapters.id = checkpoints.chapter_id
      WHERE checkpoints.id = ? AND checkpoints.project_id = ?
    `).get(checkpointId, String(this.projectRow()?.id ?? '')))
    if (!row) return undefined
    const status = String(row.status) as WorkspaceAutosaveCheckpointStatus
    if (!['staged', 'finalized', 'conflict', 'discarded'].includes(status)) throw this.integrityError('自动保存检查点状态无效。')
    const content = this.readStoredText(row.content, row.content_hash)
    const contentHash = String(row.content_hash)
    if (!isSha256(contentHash) || hashText(content) !== contentHash) throw this.integrityError('自动保存检查点正文校验失败。')
    const mergeWindowMs = Number(row.merge_window_ms)
    const windowStartedAt = String(row.window_started_at)
    const windowEndsAt = String(row.window_ends_at)
    if (!Number.isSafeInteger(mergeWindowMs) || mergeWindowMs < 1_000 || mergeWindowMs > 600_000
      || Date.parse(windowEndsAt) - Date.parse(windowStartedAt) !== mergeWindowMs) {
      throw this.integrityError('自动保存检查点合并窗口无效。')
    }
    return {
      id: String(row.id),
      legacyChapterId: Number(row.legacy_chapter_id),
      clientOperationId: String(row.latest_client_operation_id),
      baseBodyVersionId: String(row.base_body_version_id),
      title: String(row.title),
      content,
      contentHash,
      status,
      mergeWindowMs,
      windowStartedAt,
      windowEndsAt,
      lastStagedAt: String(row.last_staged_at),
      conflictCurrentBodyVersionId: row.conflict_current_body_version_id ? String(row.conflict_current_body_version_id) : null,
      finalizedBodyVersionId: row.finalized_body_version_id ? String(row.finalized_body_version_id) : null,
      operationCount: Number(row.operation_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private factBatchRecord(batchId: string): WorkspaceFactBatchRecord | undefined {
    const row = this.row(this.database.prepare(`
      SELECT batches.*, chapters.legacy_chapter_id
      FROM fact_batches batches
      JOIN chapters ON chapters.id = batches.chapter_id
      WHERE batches.id = ? AND batches.project_id = ?
    `).get(batchId, String(this.projectRow()?.id ?? '')))
    if (!row) return undefined
    const status = String(row.status) as WorkspaceFactBatchStatus
    if (!workspaceFactBatchStatuses.includes(status) || !isSha256(String(row.content_hash))) throw this.integrityError('事实批次状态或指纹无效。')
    assertJsonText(String(row.counts_json), 200_000, '事实批次数量摘要')
    const changes = this.rows(this.database.prepare('SELECT * FROM fact_changes WHERE batch_id = ? ORDER BY created_at, id').all(batchId))
      .map((change) => this.factChangeRecord(change))
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      legacyChapterId: Number(row.legacy_chapter_id),
      bodyVersionId: String(row.body_version_id),
      contentHash: String(row.content_hash),
      status,
      extractorTaskRunId: row.extractor_task_run_id ? String(row.extractor_task_run_id) : null,
      idempotencyKey: String(row.idempotency_key),
      countsJson: String(row.counts_json),
      changes,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private factChangeRecord(row: Record<string, unknown>): WorkspaceFactChangeRecord {
    const decisionStatus = String(row.decision_status) as WorkspaceFactChangeDecision
    const importance = String(row.importance) as WorkspaceFactImportance
    const changeType = String(row.change_type) as WorkspaceFactChangeRecord['changeType']
    const reviewClass = String(row.review_class) as WorkspaceFactReviewClass
    if (!workspaceFactChangeDecisions.includes(decisionStatus)
      || !workspaceFactImportances.includes(importance)
      || !workspaceFactChangeTypes.includes(changeType)
      || !workspaceFactReviewClasses.includes(reviewClass)) throw this.integrityError('事实变化状态无效。')
    const confidence = row.confidence === null || row.confidence === undefined ? null : Number(row.confidence)
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw this.integrityError('事实变化置信度无效。')
    for (const [value, label, maxLength] of [
      [row.subject_json, '事实主体', 512_000],
      [row.evidence_json, '事实证据', 1_000_000]
    ] as const) assertJsonText(String(value), maxLength, label)
    assertJsonValueText(String(row.object_json), 512_000, '事实值')
    if (row.edited_object_json !== null && row.edited_object_json !== undefined) assertJsonValueText(String(row.edited_object_json), 512_000, '事实编辑值')
    return {
      id: String(row.id),
      batchId: String(row.batch_id),
      candidateType: String(row.candidate_type),
      subjectType: String(row.subject_type),
      subjectId: row.subject_id ? String(row.subject_id) : null,
      subjectJson: String(row.subject_json),
      predicate: String(row.predicate),
      objectJson: String(row.object_json),
      normalizedKey: String(row.normalized_key),
      evidenceJson: String(row.evidence_json),
      confidence,
      importance,
      changeType,
      reviewClass,
      matchedFactId: row.matched_fact_id ? String(row.matched_fact_id) : null,
      decisionStatus,
      editedObjectJson: row.edited_object_json ? String(row.edited_object_json) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private markBodyVersionDependentsStale(
    chapterId: string,
    oldBodyVersionId: string | null,
    oldContentHash: string | null,
    replacementBodyVersionId: string,
    replacementContentHash: string,
    timestamp: string
  ): void {
    if (!oldBodyVersionId || !oldContentHash || oldContentHash === replacementContentHash) return
    this.database.prepare(`
      UPDATE fact_batches SET status = 'STALE', updated_at = ?
      WHERE chapter_id = ? AND body_version_id = ? AND content_hash = ?
        AND status IN ('PENDING', 'IN_REVIEW', 'PARTIALLY_APPROVED')
    `).run(timestamp, chapterId, oldBodyVersionId, oldContentHash)
    this.database.prepare(`
      UPDATE summary_versions SET status = 'stale'
      WHERE chapter_id = ? AND body_version_id = ? AND status IN ('draft', 'approved')
    `).run(chapterId, oldBodyVersionId)
    this.database.prepare(`
      UPDATE rule_runs SET status = 'stale', updated_at = ?
      WHERE chapter_id = ? AND body_version_id = ? AND content_hash = ? AND status <> 'stale'
    `).run(timestamp, chapterId, oldBodyVersionId, oldContentHash)
    this.database.prepare(`
      UPDATE findings SET status = 'stale', updated_at = CASE WHEN updated_at >= ?
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ? END
      WHERE chapter_id = ? AND body_version_id = ? AND content_hash = ? AND status IN ('open', 'accepted')
    `).run(timestamp, timestamp, chapterId, oldBodyVersionId, oldContentHash)
    const affectedSources = this.rows(this.database.prepare(`
      SELECT sources.id AS source_id, sources.fact_id
      FROM fact_sources sources
      WHERE sources.chapter_id = ? AND sources.body_version_id = ? AND sources.content_hash = ?
    `).all(chapterId, oldBodyVersionId, oldContentHash))
    const insertImpact = this.database.prepare(`
      INSERT OR IGNORE INTO fact_source_impacts (
        id, fact_id, fact_source_id, old_body_version_id, replacement_body_version_id, impact_type, created_at
      ) VALUES (?, ?, ?, ?, ?, 'SOURCE_NO_LONGER_CURRENT', ?)
    `)
    for (const source of affectedSources) insertImpact.run(
      this.id(), String(source.fact_id), String(source.source_id), oldBodyVersionId, replacementBodyVersionId, timestamp
    )
  }

  private writeDocumentChunks(projectId: string, chapterId: string, bodyVersionId: string, content: string, timestamp: string): void {
    const chunks = chunkDocumentContent(content)
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO document_chunks (
        id, project_id, chapter_id, body_version_id, ordinal, content, content_hash, token_estimate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const fileMode = this.textAuthority() === 'files-v1'
    const object = fileMode ? new ManuscriptTextObjects(this.projectRoot).write(content) : null
    for (const [ordinal, chunk] of chunks.entries()) {
      if (object) this.referenceText({ hash: hashText(chunk.content), relativePath: object.relativePath, rangeStart: chunk.start, rangeEnd: chunk.end })
      insert.run(this.id(), projectId, chapterId, bodyVersionId, ordinal,
        fileMode ? '' : chunk.content, hashText(chunk.content), estimateDocumentTokens(chunk.content), timestamp)
    }
  }

  private documentChunkRecord(row: Record<string, unknown>): WorkspaceDocumentChunkRecord {
    const content = this.readStoredText(row.content, row.content_hash)
    const contentHash = String(row.content_hash)
    if (!isSha256(contentHash) || hashText(content) !== contentHash) throw this.integrityError('正文分块内容校验失败。')
    return {
      id: String(row.id),
      legacyChapterId: Number(row.legacy_chapter_id),
      chapterPosition: Number(row.chapter_position),
      chapterTitle: String(row.chapter_title),
      bodyVersionId: String(row.body_version_id),
      ordinal: Number(row.ordinal),
      content,
      contentHash,
      tokenEstimate: Number(row.token_estimate),
      createdAt: String(row.created_at)
    }
  }

  private rebuildCharacterSnapshotsInCurrentTransaction(timestamp: string): void {
    const projectId = String(this.projectRow()!.id)
    this.database.prepare('DELETE FROM character_snapshots WHERE project_id = ?').run(projectId)
    const facts = this.rows(this.database.prepare(`
      SELECT facts.id, facts.subject_id, facts.normalized_key, facts.predicate, facts.object_json, facts.supersedes_fact_id,
        changes.subject_json, chapters.id AS chapter_id, chapters.legacy_chapter_id, chapters.seq, chapters.status AS chapter_status
      FROM facts
      JOIN fact_sources sources ON sources.id = facts.primary_source_id
      JOIN chapters ON chapters.id = sources.chapter_id
      LEFT JOIN fact_changes changes ON changes.id = facts.approved_change_id
      WHERE facts.project_id = ? AND facts.subject_type = 'character' AND facts.status = 'APPROVED'
      ORDER BY chapters.seq, facts.approved_at, facts.id
    `).all(projectId))
    const factsById = new Map(facts.map((fact) => [String(fact.id), fact]))
    const superseded = new Set<string>()
    const activeByCharacter = new Map<string, Map<string, Record<string, unknown>>>()
    const insert = this.database.prepare(`
      INSERT INTO character_snapshots (
        id, project_id, character_id, through_chapter_id, through_seq, state_json, source_fact_set_hash, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, character_id, through_chapter_id) DO UPDATE SET
        through_seq = excluded.through_seq,
        state_json = excluded.state_json,
        source_fact_set_hash = excluded.source_fact_set_hash,
        generated_at = excluded.generated_at
    `)
    for (const fact of facts) {
      if (fact.chapter_status === 'archived') continue
      const identity = characterFactIdentity(fact)
      if (!identity) continue
      const active = activeByCharacter.get(identity.characterId) ?? new Map<string, Record<string, unknown>>()
      // Replay only facts effective at this point in story order. Later changes
      // must not erase earlier snapshots, including list-valued knowledge.
      let ancestorId = fact.supersedes_fact_id ? String(fact.supersedes_fact_id) : ''
      const visited = new Set<string>()
      while (ancestorId && !visited.has(ancestorId)) {
        visited.add(ancestorId)
        superseded.add(ancestorId)
        active.delete(ancestorId)
        const ancestor = factsById.get(ancestorId)
        ancestorId = ancestor?.supersedes_fact_id ? String(ancestor.supersedes_fact_id) : ''
      }
      if (superseded.has(String(fact.id))) continue
      active.set(String(fact.id), fact)
      activeByCharacter.set(identity.characterId, active)
      const current: DerivedCharacterSnapshotState = {
        characterId: identity.characterId,
        name: identity.name,
        throughChapterId: Number(fact.legacy_chapter_id),
        throughChapterPosition: Number(fact.seq),
        present: true,
        lastFactId: '',
        factFingerprints: []
      }
      current.lastFactId = String(fact.id)
      for (const effective of active.values()) {
        current.factFingerprints.push(`${String(effective.id)}:${String(effective.object_json)}`)
        applyApprovedCharacterFact(current, String(effective.predicate), String(effective.object_json))
      }
      const stateJson = JSON.stringify(characterSnapshotStateJson(current))
      insert.run(
        `snapshot-${hashText(`${projectId}:${identity.characterId}:${String(fact.chapter_id)}`).slice(0, 24)}`,
        projectId,
        identity.characterId,
        String(fact.chapter_id),
        Number(fact.seq),
        stateJson,
        hashText(current.factFingerprints.join('\n')),
        timestamp
      )
    }
  }

  private characterSnapshotRecord(row: Record<string, unknown>): WorkspaceCharacterSnapshotRecord {
    let state: ReturnType<typeof characterSnapshotStateJson>
    try { state = JSON.parse(String(row.state_json)) as ReturnType<typeof characterSnapshotStateJson> }
    catch { throw this.integrityError('人物快照缓存内容损坏。') }
    if (!validCharacterSnapshotState(state) || !isSha256(String(row.source_fact_set_hash))) throw this.integrityError('人物快照缓存校验失败。')
    return {
      id: String(row.id),
      characterId: String(row.character_id),
      name: state.name,
      throughChapterId: Number(row.legacy_chapter_id),
      throughChapterPosition: Number(row.through_seq),
      present: state.present,
      ...(state.location ? { location: state.location } : {}),
      ...(state.injury ? { injury: state.injury } : {}),
      ...(state.relationships?.length ? { relationships: [...state.relationships] } : {}),
      ...(state.knowledge?.length ? { knowledge: [...state.knowledge] } : {}),
      ...(state.possession ? { possession: state.possession } : {}),
      ...(state.goal ? { goal: state.goal } : {}),
      ...(state.power ? { power: state.power } : {}),
      ...(state.vitality ? { vitality: state.vitality } : {}),
      lastFactId: state.lastFactId,
      sourceFactSetHash: String(row.source_fact_set_hash),
      generatedAt: String(row.generated_at)
    }
  }

  private discardStagedAutosaveCheckpoints(chapterId: string, timestamp: string): void {
    this.database.prepare(`
      UPDATE autosave_checkpoints SET status = 'discarded', updated_at = ? WHERE chapter_id = ? AND status = 'staged'
    `).run(timestamp, chapterId)
  }

  private prepareChapterMirror(
    projectId: string,
    chapterId: string,
    legacyChapterId: number,
    versionId: string,
    title: string,
    content: string,
    contentHash: string,
    timestamp: string
  ): WorkspaceMirrorPlan {
    const relativePath = `正文/第${legacyChapterId}章-${safeMirrorTitle(title)}.md`
    const stored = this.row(this.database.prepare(`
      SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = 'chapter_markdown' AND source_id = ?
    `).get(projectId, chapterId))
    const previous = stored ? this.previousMirrorState(stored) : { relativePath: null, observedHash: null }
    if (stored) {
      this.database.prepare(`
        UPDATE mirror_entries SET source_version_id = ?, relative_path = ?, content_hash = ?, status = 'pending',
          last_error_code = NULL, previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?
      `).run(versionId, relativePath, contentHash, previous.relativePath, previous.observedHash, timestamp, String(stored.id))
    } else {
      this.database.prepare(`
        INSERT INTO mirror_entries (
          id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash,
          status, last_error_code, updated_at, previous_relative_path, previous_observed_hash
        ) VALUES (?, ?, 'chapter_markdown', ?, ?, ?, ?, NULL, 'pending', NULL, ?, NULL, NULL)
      `).run(this.id(), projectId, chapterId, versionId, relativePath, contentHash, timestamp)
    }
    const plan: WorkspaceMirrorPlan = {
      action: 'write', sourceType: 'chapter_markdown', sourceId: chapterId, sourceVersionId: versionId,
      relativePath, previousRelativePath: previous.relativePath, previousObservedHash: previous.observedHash,
      content, contentHash
    }
    this.prepareCurrentFile(plan, stored)
    return plan
  }

  private prepareOrderMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    const content = this.chapterOrderContent()
    const contentHash = hashText(content)
    const versionId = this.id()
    const relativePath = '.webnovel/manuscript/chapter-order.json'
    const stored = this.row(this.database.prepare(`
      SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = 'chapter_order_json' AND source_id = ?
    `).get(projectId, projectId))
    const previous = stored ? this.previousMirrorState(stored) : { relativePath: null, observedHash: null }
    if (stored) {
      this.database.prepare(`
        UPDATE mirror_entries SET source_version_id = ?, relative_path = ?, content_hash = ?, status = 'pending',
          last_error_code = NULL, previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?
      `).run(versionId, relativePath, contentHash, previous.relativePath, previous.observedHash, timestamp, String(stored.id))
    } else {
      this.database.prepare(`
        INSERT INTO mirror_entries (
          id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash,
          status, last_error_code, updated_at, previous_relative_path, previous_observed_hash
        ) VALUES (?, ?, 'chapter_order_json', ?, ?, ?, ?, NULL, 'pending', NULL, ?, NULL, NULL)
      `).run(this.id(), projectId, projectId, versionId, relativePath, contentHash, timestamp)
    }
    return {
      action: 'write', sourceType: 'chapter_order_json', sourceId: projectId, sourceVersionId: versionId,
      relativePath, previousRelativePath: previous.relativePath, previousObservedHash: previous.observedHash,
      content, contentHash
    }
  }

  private prepareOutlineMirror(projectId: string, nodeId: string, legacyKey: string, versionId: string, content: string, contentHash: string, timestamp: string): WorkspaceMirrorPlan {
    const relativePath = legacyKey === 'total' ? '大纲/总纲.md' : legacyKey.startsWith('volume-')
      ? `大纲/第${legacyKey.slice(7)}卷-大纲.md` : legacyKey.startsWith('stage-')
        ? `大纲/阶段纲/第${legacyKey.slice(6)}阶段-大纲.md` : `大纲/章纲/第${legacyKey.slice(8)}章.md`
    const stored = this.row(this.database.prepare(`SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = 'outline_markdown' AND source_id = ?`).get(projectId, nodeId))
    const previous = stored ? this.previousMirrorState(stored) : { relativePath: null, observedHash: null }
    if (stored) this.database.prepare(`UPDATE mirror_entries SET source_version_id = ?, relative_path = ?, content_hash = ?, status = 'pending', last_error_code = NULL, previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?`)
      .run(versionId, relativePath, contentHash, previous.relativePath, previous.observedHash, timestamp, String(stored.id))
    else this.database.prepare(`INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at, previous_relative_path, previous_observed_hash) VALUES (?, ?, 'outline_markdown', ?, ?, ?, ?, NULL, 'pending', NULL, ?, NULL, NULL)`)
      .run(this.id(), projectId, nodeId, versionId, relativePath, contentHash, timestamp)
    const plan: WorkspaceMirrorPlan = { action: 'write', sourceType: 'outline_markdown', sourceId: nodeId, sourceVersionId: versionId, relativePath, previousRelativePath: previous.relativePath, previousObservedHash: previous.observedHash, content, contentHash }
    this.prepareCurrentFile(plan, stored)
    return plan
  }

  private prepareProjectConfigMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(projectId, 'project_config_json', projectId, '.webnovel/config/project-writing.json', this.projectWritingConfigContent(), timestamp)
  }

  private preparePromptProfileMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(projectId, 'prompt_profile_json', projectId, '.webnovel/config/prompt-profile.json', this.promptProfileContent(), timestamp)
  }

  private prepareChapterCardMirror(projectId: string, chapterId: string, legacyChapterId: number, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'chapter_card_json',
      chapterId,
      `.webnovel/planning/chapter-cards/chapter-${legacyChapterId}.json`,
      this.chapterPlanningContentByChapterId(chapterId),
      timestamp
    )
  }

  private prepareCharacterAliasesMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'character_aliases_json',
      projectId,
      '.webnovel/story-state/character-aliases.json',
      this.characterAliasesContent(),
      timestamp
    )
  }

  private prepareStoryEntitiesMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'story_entities_json',
      projectId,
      '.webnovel/story-state/entities.json',
      this.storyEntitiesContent(),
      timestamp
    )
  }

  private prepareIdeasMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'ideas_json',
      projectId,
      '.webnovel/ideas/ideas.json',
      this.ideasContent(),
      timestamp
    )
  }

  private prepareMaterialSourcesMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(
      projectId,
      'material_sources_json',
      projectId,
      '.webnovel/research/sources.json',
      this.materialSourcesContent(),
      timestamp
    )
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'material_sources_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private prepareCanonicalEventsMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(projectId, 'canonical_events_json', projectId, '.webnovel/research/events.json', this.canonicalEventsContent(), timestamp)
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'canonical_events_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private prepareCharacterStateMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(projectId, 'character_state_json', projectId, '.webnovel/story-state/characters.json', this.characterStateMirrorContent(), timestamp)
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'character_state_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private characterStateMirrorContent(): string {
    return `${JSON.stringify(JSON.parse(this.characterState().content), null, 2)}\n`
  }

  private prepareOutlinePlanningStateMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(projectId, 'outline_planning_state_json', projectId, '.webnovel/planning/outline-state.json', this.outlinePlanningStateMirrorContent(), timestamp)
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'outline_planning_state_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private outlinePlanningStateMirrorContent(): string {
    return `${JSON.stringify(JSON.parse(this.outlinePlanningState().content), null, 2)}\n`
  }

  private prepareAiSettingsMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(projectId, 'ai_settings_json', projectId, '.webnovel/ai-settings.json', this.aiSettingsMirrorContent(), timestamp)
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'ai_settings_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private aiSettingsMirrorContent(): string {
    return `${JSON.stringify(JSON.parse(this.aiSettings().content), null, 2)}\n`
  }

  private prepareWorkspaceConfigMirror(projectId: string, kind: WorkspaceConfigDocumentKind, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(projectId, 'workspace_config_json', kind, workspaceConfigRelativePath(kind), this.workspaceConfigMirrorContent(kind), timestamp)
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'workspace_config_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, kind)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private workspaceConfigMirrorContent(kind: WorkspaceConfigDocumentKind): string {
    return `${JSON.stringify(JSON.parse(this.workspaceConfig(kind).content), null, 2)}\n`
  }

  private ensureCandidateGenerationMirrors(): void {
    const projectId = String(this.projectRow()!.id)
    for (const kind of ['idea_generation', 'outline_expansion'] as const) {
      const missing = this.rows(this.database.prepare(`
        SELECT runs.id FROM task_runs runs
        JOIN generation_artifacts artifacts ON artifacts.task_run_id = runs.id AND artifacts.artifact_type = ?
        LEFT JOIN mirror_entries mirrors ON mirrors.project_id = runs.project_id
          AND mirrors.source_type = ? AND mirrors.source_id = runs.id
        WHERE runs.project_id = ? AND runs.task_type = ? AND runs.status = 'succeeded' AND mirrors.id IS NULL
      `).all(kind, `${kind}_json`, projectId, kind))
      if (missing.length) this.transaction(() => {
        for (const row of missing) this.prepareCandidateGenerationMirror(String(row.id), kind)
      })
    }
  }

  private prepareCandidateGenerationMirror(taskId: string, kind: 'idea_generation' | 'outline_expansion' = 'idea_generation'): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(String(this.projectRow()!.id), `${kind}_json`, taskId,
      kind === 'idea_generation' ? `.webnovel/ideas/generations/${taskId}.json` : `.webnovel/planning/expansions/${taskId}.json`, this.candidateGenerationContent(taskId, kind), this.now().toISOString())
  }

  private candidateGenerationContent(taskId: string, kind: 'idea_generation' | 'outline_expansion' = 'idea_generation'): string {
    const task = this.taskRun(taskId)
    const artifact = this.generationArtifactForTask(taskId, kind)
    if (!task || task.taskType !== kind || task.status !== 'succeeded' || !artifact?.schemaValid) {
      throw this.integrityError('灵感候选镜像缺少完整的生成记录。')
    }
    const checkpoint = JSON.parse(task.checkpointJson)
    // Export author-facing provenance, not the full prompt/context or connection settings.
    return `${JSON.stringify({ version: 1, taskId, artifactId: artifact.id,
      contentHash: artifact.contentHash, createdAt: artifact.createdAt,
      ...(kind === 'outline_expansion' ? { request: checkpoint.request, adoption: JSON.parse(artifact.metadataJson).adoption ?? null } : {}),
      mode: checkpoint.request.mode, instruction: checkpoint.request.instruction,
      model: checkpoint.model, source: checkpoint.source, proposal: JSON.parse(artifact.content)
    }, null, 2)}\n`
  }

  private prepareResourceLedgerMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'resource_ledger_json',
      projectId,
      '.webnovel/story-state/resource-ledger.json',
      this.resourceLedgerContent(),
      timestamp
    )
  }

  private prepareForeshadowLedgerMirror(projectId: string, timestamp: string): WorkspaceMirrorPlan {
    return this.prepareJsonMirror(
      projectId,
      'foreshadow_ledger_json',
      projectId,
      '.webnovel/story-state/foreshadows.json',
      this.foreshadowLedgerContent(),
      timestamp
    )
  }

  private prepareJsonMirror(
    projectId: string,
    sourceType: 'project_config_json' | 'foundation_json' | 'prompt_profile_json' | 'chapter_card_json' | 'character_aliases_json' | 'character_state_json' | 'outline_planning_state_json' | 'ai_settings_json' | 'workspace_config_json' | 'story_entities_json' | 'ideas_json' | 'idea_generation_json' | 'outline_expansion_json' | 'resource_ledger_json' | 'foreshadow_ledger_json' | 'material_sources_json' | 'canonical_events_json',
    sourceId: string,
    relativePath: string,
    content: string,
    timestamp: string
  ): WorkspaceMirrorPlan {
    const contentHash = hashText(content)
    const sourceVersionId = contentHash
    const stored = this.row(this.database.prepare('SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = ? AND source_id = ?').get(projectId, sourceType, sourceId))
    const previous = stored ? this.previousMirrorState(stored) : { relativePath: null, observedHash: null }
    if (stored) this.database.prepare(`
      UPDATE mirror_entries SET source_version_id = ?, relative_path = ?, content_hash = ?, status = 'pending', last_error_code = NULL,
        previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?
    `).run(sourceVersionId, relativePath, contentHash, previous.relativePath, previous.observedHash, timestamp, String(stored.id))
    else this.database.prepare(`
      INSERT INTO mirror_entries (
        id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash,
        status, last_error_code, updated_at, previous_relative_path, previous_observed_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, NULL, NULL)
    `).run(this.id(), projectId, sourceType, sourceId, sourceVersionId, relativePath, contentHash, timestamp)
    return {
      action: 'write', sourceType, sourceId, sourceVersionId, relativePath,
      previousRelativePath: previous.relativePath, previousObservedHash: previous.observedHash, content, contentHash
    }
  }

  private projectWritingConfigContent(): string {
    const config = this.projectWritingConfig()
    return `${JSON.stringify({
      version: 1,
      targetWords: config.targetWords,
      genreText: config.genreText,
      audienceScale: config.audienceScale,
      defaultPov: config.defaultPov,
      writingStyle: config.writingStyle,
      chapterTargetWords: config.chapterTargetWords,
      autosaveEnabled: config.autosaveEnabled,
      autosaveDelayMs: config.autosaveDelayMs,
      autosaveMergeWindowMs: config.autosaveMergeWindowMs,
      extensions: JSON.parse(config.configJson)
    }, null, 2)}\n`
  }

  private prepareFoundationMirror(projectId: string, timestamp: string, observedMirrorHash?: string): WorkspaceMirrorPlan {
    const plan = this.prepareJsonMirror(
      projectId,
      'foundation_json',
      projectId,
      '.webnovel/config/foundation.json',
      this.foundationConfigContent(),
      timestamp
    )
    if (!observedMirrorHash || plan.previousRelativePath) return plan
    this.database.prepare(`
      UPDATE mirror_entries SET previous_relative_path = ?, previous_observed_hash = ?
      WHERE project_id = ? AND source_type = 'foundation_json' AND source_id = ?
    `).run(plan.relativePath, observedMirrorHash, projectId, projectId)
    return { ...plan, previousRelativePath: plan.relativePath, previousObservedHash: observedMirrorHash }
  }

  private foundationConfigContent(): string {
    const foundation = this.foundationConfig()
    if (!foundation) throw this.integrityError('作品数据库缺少正式创作基础配置。')
    return `${JSON.stringify(foundation, null, 2)}\n`
  }

  private promptProfileContent(): string {
    const profile = this.promptProfile()
    return `${JSON.stringify({
      version: profile.version,
      workItemId: profile.workItemId,
      genreFingerprint: profile.genreFingerprint,
      overrides: profile.overrides,
      updatedAt: profile.updatedAt
    }, null, 2)}\n`
  }

  private importPromptProfileInCurrentTransaction(projectId: string, input: LegacyWorkspacePromptProfile, timestamp: string): WorkspaceMirrorPlan | null {
    assertPromptProfileInput(input)
    if (input.mirror && hashText(input.mirror.content) !== input.mirror.contentHash) {
      throw new AppError('VALIDATION_ERROR', '作品提示词 JSON 镜像校验失败。', { recoverable: true })
    }
    this.database.prepare(`DELETE FROM prompt_templates WHERE project_id = ?`).run(projectId)
    for (const task of promptTaskTypes) {
      const content = input.overrides[task]
      if (!content) continue
      this.database.prepare(`
        INSERT INTO prompt_templates (id, project_id, task_type, name, template_text, template_hash, enabled, version,
          created_at, updated_at, system_template, input_schema_json, output_schema_json)
        VALUES (?, ?, ?, 'project-override', ?, ?, 1, 1, ?, ?, ?, '{}', '{}')
      `).run(this.id(), projectId, task, content, hashText(content), timestamp, timestamp, content)
    }
    this.database.prepare(`
      UPDATE projects SET prompt_storage_ready = 1, prompt_work_item_id = ?, prompt_genre_fingerprint = ?, prompt_updated_at = ?, updated_at = ? WHERE id = ?
    `).run(input.workItemId, input.genreFingerprint, input.updatedAt, timestamp, projectId)
    if (!input.mirror) return null
    const stored = this.row(this.database.prepare(`SELECT * FROM mirror_entries WHERE project_id = ? AND source_type = 'prompt_profile_json' AND source_id = ?`).get(projectId, projectId))
    const previous = stored ? this.previousMirrorState(stored) : { relativePath: null, observedHash: null }
    if (stored) this.database.prepare(`
      UPDATE mirror_entries SET source_version_id = ?, relative_path = ?, content_hash = ?, observed_hash = ?, status = 'pending', last_error_code = NULL,
        previous_relative_path = ?, previous_observed_hash = ?, updated_at = ? WHERE id = ?
    `).run(input.mirror.contentHash, input.mirror.relativePath, input.mirror.contentHash, input.mirror.observedHash, previous.relativePath, previous.observedHash, timestamp, String(stored.id))
    else this.database.prepare(`
      INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at, previous_relative_path, previous_observed_hash)
      VALUES (?, ?, 'prompt_profile_json', ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL)
    `).run(this.id(), projectId, projectId, input.mirror.contentHash, input.mirror.relativePath, input.mirror.contentHash, input.mirror.observedHash, timestamp)
    return {
      action: 'write', sourceType: 'prompt_profile_json', sourceId: projectId, sourceVersionId: input.mirror.contentHash,
      relativePath: input.mirror.relativePath, previousRelativePath: previous.relativePath, previousObservedHash: previous.observedHash,
      content: input.mirror.content, contentHash: input.mirror.contentHash
    }
  }

  private chapterPlanningContentByChapterId(chapterId: string): string {
    const row = this.row(this.database.prepare(`
      SELECT chapters.legacy_chapter_id, outlines.legacy_key AS outline_legacy_key, workflows.*
      FROM chapters
      JOIN chapter_workflows workflows ON workflows.chapter_id = chapters.id
      LEFT JOIN outline_nodes outlines ON outlines.id = chapters.outline_node_id
      WHERE chapters.id = ? AND chapters.project_id = ?
    `).get(chapterId, String(this.projectRow()?.id ?? '')))
    if (!row) throw this.integrityError('章卡镜像缺少正式数据。')
    const planning = this.chapterPlanningRecord(row)
    return `${JSON.stringify({
      version: 1,
      legacyChapterId: planning.legacyChapterId,
      outlineLegacyKey: planning.outlineLegacyKey,
      lifecycleStatus: planning.lifecycleStatus,
      archivedFromStatus: planning.archivedFromStatus,
      card: planning.card
    }, null, 2)}\n`
  }

  private characterAliasesContent(): string {
    const byCharacter = new Map<string, { canonicalName: string; aliases: string[] }>()
    for (const item of this.listCharacterAliases()) {
      const record = byCharacter.get(item.characterId) ?? { canonicalName: item.canonicalName, aliases: [] }
      record.aliases.push(item.alias)
      byCharacter.set(item.characterId, record)
    }
    return `${JSON.stringify({
      version: 1,
      characters: [...byCharacter.values()].map((item) => ({ canonicalName: item.canonicalName, aliases: item.aliases }))
    }, null, 2)}\n`
  }

  private storyEntitiesContent(): string {
    return `${JSON.stringify({
      version: 1,
      entities: this.listEntities().map((entity) => ({
        id: entity.id,
        type: entity.entityType,
        name: entity.canonicalName,
        profile: JSON.parse(entity.profileJson),
        status: entity.status,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
      })),
      relations: this.listEntityRelations().map((relation) => ({
        id: relation.id,
        subjectEntityId: relation.subjectEntityId,
        predicate: relation.predicate,
        objectEntityId: relation.objectEntityId,
        notes: relation.notes,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt
      }))
    }, null, 2)}\n`
  }

  private ideasContent(): string {
    return `${JSON.stringify({
      version: 1,
      authority: 'sqlite-ideas',
      notice: '灵感提升会复制到正式设定，原便签仍保留；此文件是可读镜像。',
      ideas: this.listIdeas()
    }, null, 2)}\n`
  }

  private materialSourcesContent(): string {
    return `${JSON.stringify({
      version: 1,
      authority: 'sqlite-material-sources',
      notice: '素材资料以 SQLite 为正式数据；此文件是供作者查看和备份的可读镜像。',
      sources: this.listMaterialSources()
    }, null, 2)}\n`
  }

  private canonicalEventsContent(): string {
    return `${JSON.stringify({
      version: 1,
      authority: 'sqlite-canonical-events',
      notice: '重要事件以 SQLite 为正式数据；此文件是供作者查看和备份的可读镜像。',
      events: this.listCanonicalEvents()
    }, null, 2)}\n`
  }

  private resourceLedgerContent(): string {
    const ledger = this.resourceLedger()
    return `${JSON.stringify({
      version: 1,
      authority: 'sqlite-resource-ledger',
      notice: '余额由 entries 的 delta 累加得出，请勿直接编辑 balances。',
      balances: ledger.balances,
      entries: ledger.entries
    }, null, 2)}\n`
  }

  private foreshadowLedgerContent(): string {
    const ledger = this.foreshadowLedger()
    return `${JSON.stringify({
      version: 1,
      authority: 'sqlite-foreshadow-ledger',
      notice: 'foreshadows 是当前投影，actions 是不可改删的动作历史。',
      foreshadows: ledger.foreshadows,
      actions: ledger.actions
    }, null, 2)}\n`
  }

  private previousMirrorState(stored: Record<string, unknown>): { relativePath: string | null; observedHash: string | null } {
    if (stored.status === 'synced') {
      return { relativePath: String(stored.relative_path), observedHash: stored.observed_hash ? String(stored.observed_hash) : null }
    }
    if (stored.status === 'conflict') {
      // A detected external edit is not an implicit overwrite authorization. Keep the
      // path so an exact-content reconciliation can succeed, but require ordinary
      // saves to encounter the conflict again until the author explicitly adopts it.
      return { relativePath: String(stored.relative_path), observedHash: null }
    }
    return {
      relativePath: stored.previous_relative_path ? String(stored.previous_relative_path) : String(stored.relative_path),
      observedHash: stored.previous_observed_hash ? String(stored.previous_observed_hash) : stored.observed_hash ? String(stored.observed_hash) : null
    }
  }

  private chapterOrderContent(): string {
    return `${JSON.stringify({ version: 1, chapterIds: this.activeChapterIds() }, null, 2)}\n`
  }

  private activeChapterIds(): number[] {
    const projectId = String(this.projectRow()?.id ?? '')
    return this.rows(this.database.prepare(`
      SELECT legacy_chapter_id
      FROM chapters
      WHERE project_id = ? AND status <> 'archived'
      ORDER BY seq
    `).all(projectId)).map((row) => {
      const legacyChapterId = Number(row.legacy_chapter_id)
      if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw this.integrityError('章节身份无效。')
      return legacyChapterId
    })
  }

  private resequenceProject(projectId: string, activeLegacyIds: number[]): void {
    const rows = this.rows(this.database.prepare(`SELECT id, legacy_chapter_id, status FROM chapters WHERE project_id = ? ORDER BY seq`).all(projectId))
    const byLegacyId = new Map(rows.map((row) => [Number(row.legacy_chapter_id), row]))
    if (activeLegacyIds.some((id) => !byLegacyId.has(id))) throw this.integrityError('章节重排包含未知章节。')
    const active = new Set(activeLegacyIds)
    const archived = rows.filter((row) => !active.has(Number(row.legacy_chapter_id)))
    this.database.prepare('UPDATE chapters SET seq = seq + 1000000000 WHERE project_id = ?').run(projectId)
    activeLegacyIds.forEach((legacyId, index) => {
      this.database.prepare(`UPDATE chapters SET seq = ?, updated_at = ? WHERE id = ?`).run(index + 1, this.now().toISOString(), String(byLegacyId.get(legacyId)!.id))
    })
    archived.forEach((row, index) => {
      this.database.prepare(`UPDATE chapters SET seq = ?, updated_at = ? WHERE id = ?`).run(activeLegacyIds.length + index + 1, this.now().toISOString(), String(row.id))
    })
  }

  private mirrorPlanFromRow(row: Record<string, unknown>, projectId: string): WorkspaceMirrorPlan {
    const sourceType = String(row.source_type) as WorkspaceMirrorPlan['sourceType']
    if (!['chapter_markdown', 'chapter_order_json', 'outline_markdown', 'outline_planning_state_json', 'ai_settings_json', 'workspace_config_json', 'project_config_json', 'foundation_json', 'prompt_profile_json', 'chapter_card_json', 'character_aliases_json', 'character_state_json', 'story_entities_json', 'ideas_json', 'idea_generation_json' , 'outline_expansion_json', 'resource_ledger_json', 'foreshadow_ledger_json', 'material_sources_json', 'canonical_events_json'].includes(sourceType)) throw this.integrityError('存在不支持的可读镜像类型。')
    const action = sourceType === 'chapter_markdown' && row.chapter_status === 'archived' ? 'delete' : 'write'
    const content = action === 'delete' ? '' : sourceType === 'chapter_order_json' ? this.chapterOrderContent()
      : sourceType === 'outline_markdown' ? this.readStoredText(row.outline_content, row.outline_content_hash)
        : sourceType === 'outline_planning_state_json' ? this.outlinePlanningStateMirrorContent()
        : sourceType === 'ai_settings_json' ? this.aiSettingsMirrorContent()
        : sourceType === 'workspace_config_json' ? this.workspaceConfigMirrorContent(String(row.source_id) as WorkspaceConfigDocumentKind)
        : sourceType === 'project_config_json' ? this.projectWritingConfigContent()
          : sourceType === 'foundation_json' ? this.foundationConfigContent()
            : sourceType === 'prompt_profile_json' ? this.promptProfileContent()
          : sourceType === 'chapter_card_json' ? this.chapterPlanningContentByChapterId(String(row.source_id))
            : sourceType === 'character_aliases_json' ? this.characterAliasesContent()
              : sourceType === 'character_state_json' ? this.characterStateMirrorContent()
              : sourceType === 'story_entities_json' ? this.storyEntitiesContent()
                : sourceType === 'ideas_json' ? this.ideasContent()
                : sourceType === 'material_sources_json' ? this.materialSourcesContent()
                : sourceType === 'canonical_events_json' ? this.canonicalEventsContent()
                : sourceType === 'idea_generation_json' ? this.candidateGenerationContent(String(row.source_id))
                : sourceType === 'outline_expansion_json' ? this.candidateGenerationContent(String(row.source_id), 'outline_expansion')
                : sourceType === 'resource_ledger_json' ? this.resourceLedgerContent()
                  : sourceType === 'foreshadow_ledger_json' ? this.foreshadowLedgerContent()
                    : this.readStoredText(row.body_content, row.body_content_hash)
    return {
      action,
      sourceType,
      status: String(row.status) as WorkspaceMirrorStatus,
      sourceId: String(row.source_id),
      sourceVersionId: String(row.source_version_id),
      relativePath: String(row.relative_path),
      previousRelativePath: row.previous_relative_path ? String(row.previous_relative_path) : null,
      previousObservedHash: row.previous_observed_hash ? String(row.previous_observed_hash) : null,
      content,
      contentHash: action === 'delete' ? hashText('') : String(row.content_hash || hashText(content))
    }
  }

  private bodyRevisionRecord(row: Record<string, unknown>, legacyChapterId: number): WorkspaceBodyRevisionRecord {
    const versionId = String(row.id)
    const createdAt = String(row.created_at)
    const content = this.readStoredText(row.content, row.content_hash)
    const reason = String(row.reason || row.source_type) as WorkspaceBodyRevisionRecord['reason']
    return {
      id: `${String(Date.parse(createdAt)).padStart(13, '0')}-${versionId}`,
      versionId,
      legacyChapterId,
      title: String(row.title),
      content,
      wordCount: countWords(content),
      createdAt,
      reason,
      label: row.label ? String(row.label) : null,
      isCurrent: Number(row.is_current) === 1,
      sourceTaskRunId: row.source_task_run_id ? String(row.source_task_run_id) : null,
      generationArtifactId: row.generation_artifact_id ? String(row.generation_artifact_id) : null
    }
  }

  private assertFormal(): void {
    this.assertOpen()
    if (this.storageMode() !== 'sqlite') throw new AppError('CONFLICT', '作品尚未切换为 SQLite 正式数据。', { recoverable: true })
  }

  private migrate(): void {
    let version = Number(this.scalar(this.database.prepare('PRAGMA user_version').get(), 'user_version'))
    if (version > WORKSPACE_DATABASE_SCHEMA_VERSION) {
      throw new AppError('UNSUPPORTED_PROJECT_VERSION', `作品数据库版本 ${version} 高于当前支持的 ${WORKSPACE_DATABASE_SCHEMA_VERSION}，未执行任何迁移。`, { recoverable: false })
    }
    if (version === 0) {
      const existingTables = this.rows(this.database.prepare(`
        SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).all())
      if (existingTables.length) throw new Error('database has unversioned tables')
    }
    for (const migration of migrations) {
      if (migration.version <= version) continue
      const rebuildTasks = migration.version === 36
      const rebuildConfig = migration.version === 37
      const rebuildEvents = migration.version === 39
      // SQLite's generalized ALTER TABLE procedure requires this outside BEGIN.
      // This connection is unpublished until migrate + integrity checks finish.
      if (rebuildTasks || rebuildConfig || rebuildEvents) this.database.exec('PRAGMA foreign_keys = OFF')
      try {
        this.transaction(() => {
          if (migration.version === 40) this.validateReadSchema(39)
          if (migration.version === 42) this.validateReadSchema(41)
          if (rebuildTasks) this.rebuildTaskRuns()
          else if (rebuildConfig) this.rebuildWorkspaceConfigDocuments()
          else if (rebuildEvents) this.rebuildCanonicalEventIdentities()
          else if (migration.version === 42 && hasIntermediateManuscriptSchema41(this.database)) {
            // The exact intermediate build already has all 42 tables/guards.
            // validateReadSchema above checked every definition; retain receipt
            // 41 verbatim and advance only the project schema stamp.
            this.database.exec(manuscriptTextGuardsMigrationSql.slice(0, manuscriptTextGuardsMigrationSql.indexOf('ALTER TABLE')))
          } else this.database.exec(migration.sql)
          this.database.prepare(`
            INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)
          `).run(migration.version, migration.name, this.now().toISOString(), migration.checksum)
          this.database.exec(`PRAGMA user_version = ${migration.version}`)
        }, 'migration')
      } finally {
        if (rebuildTasks || rebuildConfig || rebuildEvents) this.database.exec('PRAGMA foreign_keys = ON')
      }
      version = migration.version
    }
    this.validateSchema()
  }

  private rebuildWorkspaceConfigDocuments(): void {
    rebuildSqliteTable(this.database, { table: 'workspace_config_documents', copySql: worldMapConfigMigrationSql,
      guardsSql: worldMapConfigGuardsSql, integrityMessage: '地图配置迁移未通过关联完整性检查，旧数据已保留。' })
  }

  private rebuildTaskRuns(): void {
    rebuildSqliteTable(this.database, { table: 'task_runs', copySql: nativeTaskPauseMigrationSql,
      guardsSql: nativeTaskPauseGuardsSql, integrityMessage: '任务状态迁移未通过关联完整性检查，已保留旧数据库。' })
  }

  private rebuildCanonicalEventIdentities(): void {
    // Validate the recorded source schema within this same migration transaction.
    this.validateReadSchema(38)
    const start = canonicalEventsMigrationSql.indexOf('CREATE TABLE canonical_events (')
    const end = canonicalEventsMigrationSql.indexOf('\nCREATE INDEX', start)
    assertCanonicalEventIdentityUpgradeSource(this.database, canonicalEventsMigrationSql.slice(start, end))
    rebuildSqliteTable(this.database, { table: 'canonical_events', copySql: canonicalEventIdentityCopySql,
      guardsSql: canonicalEventIdentityGuardsSql, integrityMessage: '事件身份迁移未通过关联完整性检查，旧事件及历史已保留。' })
    assertCanonicalEventIdentitySchema(this.database)
  }

  private validateReadSchema(version: number): void {
    const stored = this.rows(this.database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all())
    const expected = migrations.filter((migration) => migration.version <= version)
    if (stored.length !== expected.length || expected.some((migration, index) =>
      Number(stored[index]?.version) !== migration.version || stored[index]?.name !== migration.name || !workspaceMigrationChecksumMatches(migration, stored[index]?.checksum))) {
      throw this.integrityError('作品数据库版本与迁移记录不一致，已停止只读核对。')
    }
    if (version >= 38) {
      this.validateSchema(version)
      return
    }
    const tables = new Set(this.rows(this.database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).map((row) => String(row.name)))
    const expectedTables = ['projects', 'mirror_entries',
      ...(version >= 24 ? ['material_sources'] : []),
      ...(version >= 25 ? ['canonical_events', 'canonical_event_characters', 'canonical_event_evidence_refs'] : []),
      ...(version >= 30 ? ['workspace_config_documents'] : [])]
    if (expectedTables.some((table) => !tables.has(table)) || (version < 38 && canonicalEventVersionTables.some((table) => tables.has(table)))) {
      throw this.integrityError('旧作品的事件结构与记录版本不一致，已停止只读核对。')
    }
  }

  private validateSchema(expectedVersion = WORKSPACE_DATABASE_SCHEMA_VERSION): void {
    const version = Number(this.scalar(this.database.prepare('PRAGMA user_version').get(), 'user_version'))
    const storedMigrations = this.rows(this.database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all())
    const tables = this.rows(this.database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all()).map((row) => String(row.name)).sort()
    const views = this.rows(this.database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'view'`).all()).map((row) => String(row.name)).sort()
    const triggers = this.rows(this.database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'trigger'`).all()).map((row) => String(row.name)).sort()
    if (version !== expectedVersion
      || migrations.filter(migration => migration.version <= expectedVersion).some((migration) => {
        const stored = storedMigrations.find((entry) => Number(entry.version) === migration.version)
        return stored?.name !== migration.name || !workspaceMigrationChecksumMatches(migration, stored.checksum)
      })
      || requiredTables.some((table) => !tables.includes(table))
      || canonicalEventVersionTables.some((table) => !tables.includes(table))
      || canonicalEventVersionTriggers.some((trigger) => !triggers.includes(trigger))
      || requiredViews.some((view) => !views.includes(view))
      || requiredAdditionalTriggers.some((trigger) => !triggers.includes(trigger))
      || requiredTriggers.some((trigger) => !triggers.includes(trigger === 'projects_schema_version_v37_after_insert' ? `projects_schema_version_v${expectedVersion}_after_insert` : trigger))) {
      throw new AppError('DATABASE_MIGRATION_FAILED', '作品数据库结构不完整或迁移记录不匹配；原稿没有改动。', {
        recoverable: false,
        details: { area: 'workspaceDatabase' }
      })
    }
    if (expectedVersion >= 39) assertCanonicalEventIdentitySchema(this.database)
    if (expectedVersion >= 40) assertEventMigrationReceiptSchema(this.database, expectedVersion)
    if (expectedVersion >= 41) assertManuscriptTextSchema(this.database, expectedVersion)
  }

  private assertConnectionSettings(): void {
    const foreignKeys = Number(this.scalar(this.database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys'))
    const journalMode = String(this.scalar(this.database.prepare('PRAGMA journal_mode').get(), 'journal_mode')).toLocaleLowerCase()
    if (foreignKeys !== 1 || journalMode !== 'wal') throw this.integrityError('作品数据库安全设置未生效。')
  }

  private verifyProjection(snapshot: LegacyWorkspaceSnapshot): void {
    const project = this.projectRow()
    if (!project || project.storage_mode !== 'shadow' || project.name !== snapshot.projectName || project.legacy_manifest_hash !== snapshot.projectManifestHash) {
      throw this.integrityError('数据库中的作品身份与导入快照不一致。')
    }
    const rows = this.rows(this.database.prepare(`
      SELECT c.legacy_chapter_id, c.seq, c.title, c.current_body_version_id, b.content, b.content_hash,
             m.status AS mirror_status, m.relative_path AS mirror_relative_path, m.source_version_id
      FROM chapters c
      LEFT JOIN body_versions b ON b.id = c.current_body_version_id
      LEFT JOIN mirror_entries m ON m.project_id = c.project_id AND m.source_type = 'chapter_markdown' AND m.source_id = c.id
      WHERE c.project_id = ? AND c.status <> 'archived'
      ORDER BY c.seq
    `).all(String(project.id)))
    if (rows.length !== snapshot.chapters.length) throw this.integrityError('数据库章节数量与导入快照不一致。')
    for (let index = 0; index < snapshot.chapters.length; index += 1) {
      const expected = snapshot.chapters[index]
      const actual = rows[index]
      const content = String(actual.content ?? '')
      if (Number(actual.legacy_chapter_id) !== expected.legacyChapterId
        || Number(actual.seq) !== expected.position
        || actual.title !== expected.title
        || !actual.current_body_version_id
        || actual.source_version_id !== actual.current_body_version_id
        || actual.content_hash !== expected.contentHash
        || content !== expected.content
        || hashText(content) !== actual.content_hash
        || !['pending', 'synced'].includes(String(actual.mirror_status))
        || actual.mirror_relative_path !== expected.mirrorRelativePath) {
        throw this.integrityError(`数据库第 ${expected.position} 个章节与导入快照不一致。`)
      }
    }
    const outlineRows = this.rows(this.database.prepare(`
      SELECT n.legacy_key, parent.legacy_key AS parent_legacy_key, metadata.planning_kind AS node_type, n.seq, n.title,
             n.current_version_id, v.content, v.content_hash,
             m.status AS mirror_status, m.relative_path AS mirror_relative_path, m.source_version_id
      FROM outline_nodes n
      LEFT JOIN outline_nodes parent ON parent.id = n.parent_id
      LEFT JOIN outline_node_metadata metadata ON metadata.outline_node_id = n.id
      LEFT JOIN outline_versions v ON v.id = n.current_version_id
      LEFT JOIN mirror_entries m ON m.project_id = n.project_id
        AND m.source_type = 'outline_markdown' AND m.source_id = n.id
      WHERE n.project_id = ? AND n.status <> 'archived'
      ORDER BY CASE metadata.planning_kind WHEN 'summary' THEN 0 WHEN 'volume' THEN 1 WHEN 'stage' THEN 2 ELSE 3 END, n.seq
    `).all(String(project.id)))
    const expectedOutlines = snapshot.outlines ?? []
    if (Number(project.outline_storage_ready) !== 1 || outlineRows.length !== expectedOutlines.length) {
      throw this.integrityError('数据库大纲数量与导入快照不一致。')
    }
    for (let index = 0; index < expectedOutlines.length; index += 1) {
      const expected = expectedOutlines[index]
      const actual = outlineRows[index]
      const content = String(actual.content ?? '')
      if (actual.legacy_key !== expected.legacyKey
        || (actual.parent_legacy_key ? String(actual.parent_legacy_key) : undefined) !== expected.parentLegacyKey
        || actual.node_type !== expected.nodeType
        || Number(actual.seq) !== expected.seq
        || actual.title !== expected.title
        || !actual.current_version_id
        || actual.source_version_id !== actual.current_version_id
        || actual.content_hash !== expected.contentHash
        || content !== expected.content
        || hashText(content) !== actual.content_hash
        || !['pending', 'synced'].includes(String(actual.mirror_status))
        || actual.mirror_relative_path !== expected.mirrorRelativePath) {
        throw this.integrityError(`数据库大纲 ${expected.legacyKey} 与导入快照不一致。`)
      }
    }
    const expectedPrompt = snapshot.promptProfile ?? emptyPromptProfile(snapshot.workItemId)
    if (Number(project.prompt_storage_ready) !== 1) throw this.integrityError('数据库提示词尚未完成影子导入。')
    const actualPrompt = this.promptProfileRecord()
    if (actualPrompt.workItemId !== expectedPrompt.workItemId
      || actualPrompt.genreFingerprint !== expectedPrompt.genreFingerprint
      || actualPrompt.updatedAt !== expectedPrompt.updatedAt
      || promptTaskTypes.some((task) => actualPrompt.overrides[task] !== expectedPrompt.overrides[task])) {
      throw this.integrityError('数据库提示词与导入快照不一致。')
    }
    const promptMirror = this.row(this.database.prepare(`
      SELECT source_version_id, relative_path, content_hash, observed_hash, status
      FROM mirror_entries WHERE project_id = ? AND source_type = 'prompt_profile_json' AND source_id = ?
    `).get(String(project.id), String(project.id)))
    if (expectedPrompt.mirror) {
      if (!promptMirror || promptMirror.source_version_id !== expectedPrompt.mirror.contentHash
        || promptMirror.relative_path !== expectedPrompt.mirror.relativePath
        || promptMirror.content_hash !== expectedPrompt.mirror.contentHash
        || promptMirror.observed_hash !== expectedPrompt.mirror.observedHash
        || !['pending', 'synced'].includes(String(promptMirror.status))) {
        throw this.integrityError('数据库提示词镜像与导入快照不一致。')
      }
    } else if (promptMirror) throw this.integrityError('数据库包含快照之外的提示词镜像。')
  }

  private currentProjectionFingerprint(): string {
    const chapterRows = this.rows(this.database.prepare(`
      SELECT c.legacy_chapter_id, c.seq, c.title, c.status, b.content_hash
      FROM chapters c LEFT JOIN body_versions b ON b.id = c.current_body_version_id
      WHERE c.status <> 'archived' ORDER BY c.seq
    `).all())
    const outlineRows = this.rows(this.database.prepare(`
      SELECT nodes.legacy_key, nodes.parent_id, metadata.planning_kind AS node_type, nodes.seq, nodes.title, nodes.status, nodes.content_hash
      FROM outline_nodes nodes
      JOIN outline_node_metadata metadata ON metadata.outline_node_id = nodes.id
      WHERE nodes.status <> 'archived'
      ORDER BY CASE metadata.planning_kind WHEN 'summary' THEN 0 WHEN 'volume' THEN 1 WHEN 'stage' THEN 2 ELSE 3 END, nodes.seq
    `).all())
    const promptRows = this.rows(this.database.prepare(`
      SELECT task_type, template_hash, enabled, version, system_template, input_schema_json, output_schema_json FROM prompt_templates
      WHERE project_id = (SELECT id FROM projects ORDER BY created_at LIMIT 1)
      ORDER BY task_type, version
    `).all())
    return hashText(JSON.stringify({ chapterRows, outlineRows, promptRows }))
  }

  private projectRow(): Record<string, unknown> | undefined {
    const projects = this.rows(this.database.prepare('SELECT * FROM projects ORDER BY created_at LIMIT 2').all())
    if (projects.length > 1) throw this.integrityError('每书数据库包含多个项目根记录。')
    return projects[0]
  }

  textAuthority(): 'legacy-sqlite' | 'files-v1' {
    const authority = this.projectRow()?.text_authority
    if (authority === 'files-v1') return authority
    if (authority === undefined || authority === 'legacy-sqlite') return 'legacy-sqlite'
    throw this.integrityError('作品文本存储模式无效。')
  }

  /** Only manuscript/version/checkpoint/chunk consumers call this adapter.
   * Structured facts, candidate artifacts and summaries keep their own contracts. */
  private readStoredText(raw: unknown, digest: unknown): string {
    const hash = String(digest)
    if (this.textAuthority() === 'legacy-sqlite') return String(raw)
    if (raw !== '' || !isSha256(hash)) throw this.integrityError('文件模式仍含旧正文或缺少文件指纹。')
    const row = this.row(this.database.prepare('SELECT * FROM manuscript_text_objects WHERE content_hash = ?').get(hash))
    if (!row) throw this.integrityError('稿件版本缺少文件引用。')
    return new ManuscriptTextObjects(this.projectRoot).read({ hash, relativePath: String(row.relative_path),
      rangeStart: row.range_start === null ? null : Number(row.range_start), rangeEnd: row.range_end === null ? null : Number(row.range_end) })
  }

  private referenceText(reference: TextObjectReference, autosaveTemporary = false): void {
    this.database.prepare(`INSERT OR IGNORE INTO manuscript_text_objects (content_hash, relative_path, range_start, range_end, autosave_temporary)
      VALUES (?, ?, ?, ?, ?)`).run(reference.hash, reference.relativePath, reference.rangeStart, reference.rangeEnd, autosaveTemporary ? 1 : 0)
    this.readStoredText('', reference.hash)
  }

  private storeText(content: string, autosaveTemporary = false): string {
    if (this.textAuthority() === 'legacy-sqlite') return content
    this.referenceText(new ManuscriptTextObjects(this.projectRoot).write(content), autosaveTemporary)
    return ''
  }

  private prepareCurrentFile(plan: WorkspaceMirrorPlan, stored?: Record<string, unknown>): void {
    if (this.textAuthority() !== 'files-v1') return
    if (!this.fileCommand) throw this.integrityError('文件稿件写入缺少可恢复操作。')
    const oldPath = stored?.relative_path ? String(stored.relative_path) : null
    const oldHash = oldPath && this.fileExpectedHashes.has(oldPath) ? this.fileExpectedHashes.get(oldPath)!
      : stored?.observed_hash ? String(stored.observed_hash) : null
    const nextHash = plan.action === 'delete' ? null : plan.contentHash
    if (nextHash === null) this.database.prepare('DELETE FROM manuscript_file_heads WHERE document_id = ?').run(plan.sourceId)
    else {
      const identity = plan.sourceType === 'chapter_markdown'
        ? this.database.prepare('SELECT title FROM chapters WHERE id = ?').get(plan.sourceId)
        : this.database.prepare('SELECT title FROM outline_nodes WHERE id = ?').get(plan.sourceId)
      const title = this.fileCommand.name === 'stageAutosaveCheckpoint' ? this.fileCommand.args[0].title : String(identity?.title ?? '')
      this.database.prepare(`INSERT INTO manuscript_file_heads (document_id, kind, relative_path, title, content_hash)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET relative_path = excluded.relative_path,
          title = excluded.title, content_hash = excluded.content_hash`)
        .run(plan.sourceId, plan.sourceType === 'chapter_markdown' ? 'body' : 'outline', plan.relativePath, title, nextHash)
    }
    if (nextHash) new ManuscriptTextObjects(this.projectRoot).write(plan.content)
    const intent: ManuscriptFileIntent = { relativePath: plan.relativePath,
      previousHash: oldPath === plan.relativePath ? oldHash : null, hash: nextHash }
    if (intent.hash !== intent.previousHash) this.fileIntents.push(intent)
    else if (!this.replayingFileCommit && (new ManuscriptCommitJournal(this.projectRoot).readCurrent(intent.relativePath)?.hash ?? null) !== intent.hash) {
      throw new AppError('CONFLICT', '稿件文件已变化或缺失，未从历史覆盖它。', { recoverable: true })
    }
    if (oldPath && oldPath !== plan.relativePath && oldHash) this.fileIntents.push({ relativePath: oldPath, previousHash: oldHash, hash: null })
    this.database.prepare(`UPDATE mirror_entries SET observed_hash = ?, status = 'synced',
      previous_relative_path = NULL, previous_observed_hash = NULL, last_error_code = NULL
      WHERE project_id = ? AND source_type = ? AND source_id = ?`).run(nextHash, String(this.projectRow()!.id), plan.sourceType, plan.sourceId)
    plan.status = 'synced'
    plan.previousRelativePath = null
    plan.previousObservedHash = null
  }

  private currentChapterFile(legacyChapterId: number): ReturnType<SqliteWorkspaceDatabase['currentFile']> {
    const row = this.database.prepare('SELECT id FROM chapters WHERE project_id = ? AND legacy_chapter_id = ?')
      .get(String(this.projectRow()!.id), legacyChapterId)
    if (!row) throw this.integrityError('当前正文缺少章节身份。')
    return this.currentFile(String(row.id), 'body')
  }

  /** Revision checks use the current file, not the last idle-history snapshot.
   * During replay, validate against the durable pre-write bytes, never the new
   * file which may already have replaced them before SQLite rolled back. */
  private fileWriteBaseline(documentId: string, kind: 'body' | 'outline', allowMissing = false): ReturnType<SqliteWorkspaceDatabase['currentFile']> | null {
    const head = this.database.prepare('SELECT * FROM manuscript_file_heads WHERE document_id = ? AND kind = ?').get(documentId, kind)
    if (!head) throw this.integrityError('稿件恢复缺少原文件身份。')
    if (!this.replayingFileCommit) {
      if (allowMissing && !new ManuscriptCommitJournal(this.projectRoot).readCurrent(String(head.relative_path))) {
        this.fileExpectedHashes.set(String(head.relative_path), null)
        return null
      }
      return this.currentFile(documentId, kind)
    }
    const intent = this.replayingFileCommit.files.find(file => file.relativePath === head.relative_path)
    if (intent?.previousHash === null && allowMissing) { this.fileExpectedHashes.set(String(head.relative_path), null); return null }
    if (!intent?.previousHash) throw this.integrityError('稿件恢复缺少保存前的文件指纹。')
    const content = new ManuscriptTextObjects(this.projectRoot).read({ hash: intent.previousHash,
      relativePath: `.webnovel/history/text/${intent.previousHash}.md`, rangeStart: null, rangeEnd: null })
    return { title: String(head.title), content, hash: intent.previousHash, relativePath: String(head.relative_path), external: intent.previousHash !== head.content_hash }
  }

  private assertCurrentFileVersion(legacyChapterId: number): void {
    if (this.textAuthority() !== 'files-v1') return
    const indexed = this.formalChapterRecord(legacyChapterId)
    if (!indexed) throw new AppError('NOT_FOUND', '正文不存在。', { recoverable: true })
    const current = this.currentChapterFile(legacyChapterId)
    if (current.hash !== indexed.contentHash || current.title !== indexed.title) {
      throw new AppError('CONFLICT', '当前稿件尚未固定为历史版本，请先保存当前稿，再执行需要版本来源的操作。', { recoverable: true })
    }
  }

  /** A version-bound context request fixes draft files into immutable history.
   * Confirmed chapters deliberately retain their approved baseline; ordinary
   * shelf/document reads never call this writable context-preparation path. */
  private freezeContextFilesBefore(legacyChapterId: number): void {
    if (this.textAuthority() !== 'files-v1') return
    if (!Number.isSafeInteger(legacyChapterId) || legacyChapterId < 1) throw new AppError('VALIDATION_ERROR', '上下文章节身份无效。', { recoverable: true })
    const chapters = this.database.prepare(`SELECT c.legacy_chapter_id FROM chapters c JOIN chapters target ON target.project_id = c.project_id
      WHERE target.legacy_chapter_id = ? AND target.status <> 'archived' AND c.status <> 'archived'
        AND c.seq < target.seq AND c.confirmed_body_version_id IS NULL ORDER BY c.seq`).all(legacyChapterId)
    for (const row of chapters) {
      const id = Number(row.legacy_chapter_id), indexed = this.formalChapterRecord(id)!, current = this.currentChapterFile(id)
      if (indexed.contentHash === current.hash && indexed.title === current.title) continue
      this.writeFormalChapter({ legacyChapterId: id, title: current.title, content: current.content,
        reason: 'manual', expectedRevision: chapterRevision(id, current.title, current.content) })
    }
  }

  private currentFile(documentId: string, kind: 'body' | 'outline'): { title: string; relativePath: string; content: string; hash: string; external: boolean } {
    const head = this.database.prepare('SELECT * FROM manuscript_file_heads WHERE document_id = ? AND kind = ?').get(documentId, kind)
    if (!head) throw this.integrityError('当前稿件缺少文件身份记录。')
    const file = new ManuscriptCommitJournal(this.projectRoot).readCurrent(String(head.relative_path))
    if (!file) throw new AppError('NOT_FOUND', '当前稿件文件缺失；没有从历史自动覆盖，可在历史中显式恢复。', { recoverable: true })
    return { ...file, title: String(head.title), relativePath: String(head.relative_path), external: file.hash !== head.content_hash }
  }

  private manuscriptTransaction<T>(command: ManuscriptCommand, operation: () => T): T {
    if (this.fileCommand) throw this.integrityError('稿件操作不能嵌套提交。')
    this.fileCommand = command
    this.fileIntents = []
    this.fileExpectedHashes.clear()
    this.supersededAutosaveTexts.clear()
    try { return this.transaction(operation) }
    finally { this.fileCommand = null; this.fileIntents = []; this.fileExpectedHashes.clear(); this.supersededAutosaveTexts.clear() }
  }

  /** Called by an explicit writable book operation, never a read-only facade. */
  recoverManuscriptCommits(): void {
    if (this.textAuthority() !== 'files-v1') return
    const journal = new ManuscriptCommitJournal(this.projectRoot)
    for (const receipt of journal.pending()) {
      if (receipt.projectId !== this.projectRow()?.id) throw this.integrityError('待恢复稿件不属于当前作品。')
      if (this.database.prepare('SELECT 1 FROM manuscript_file_commits WHERE operation_id = ? AND project_id = ?')
        .get(receipt.operationId, receipt.projectId)) { journal.finish(receipt); continue }
      const command = journal.command(receipt)
      this.replayingFileCommit = receipt
      try {
        // Each branch retains its domain validation and original AI/fact authority.
        switch (command.name) {
          case 'writeFormalChapter': this.writeFormalChapter(...command.args); break
          case 'writeFormalOutline': this.writeFormalOutline(...command.args); break
          case 'appendFormalOutlineChildren': this.appendFormalOutlineChildren(...command.args); break
          case 'applyWritingAgentArtifact': this.applyWritingAgentArtifact(...command.args); break
          case 'createFormalChapter': this.createFormalChapter(...command.args); break
          case 'startChapterFromOutline': this.startChapterFromOutline(...command.args); break
          case 'stageAutosaveCheckpoint': this.stageAutosaveCheckpoint(...command.args); break
          case 'finalizeAutosaveCheckpoint': this.finalizeAutosaveCheckpoint(...command.args); break
          case 'updateChapterPlanning': this.updateChapterPlanning(...command.args); break
          case 'archiveFormalChapter': this.archiveFormalChapter(...command.args); break
          case 'restoreArchivedFormalChapter': this.restoreArchivedFormalChapter(...command.args); break
          case 'promoteIdeaToSummary': this.promoteIdeaToSummary(...command.args); break
        }
      } finally { this.replayingFileCommit = null }
    }
  }

  private transaction<T>(operation: () => T, phase: 'write' | 'migration' = 'write'): T {
    if (phase === 'write') assertNoManuscriptMigration(this.projectRoot)
    const journal = phase === 'write' && this.textAuthority() === 'files-v1' ? new ManuscriptCommitJournal(this.projectRoot) : null
    if (journal?.pending().length && !this.replayingFileCommit) throw new AppError('CONFLICT', '稿件文件已保留，请先完成待恢复的索引更新。', { recoverable: true })
    this.database.exec('BEGIN IMMEDIATE')
    let receipt: ManuscriptCommitReceipt | null = null
    try {
      // Another process may have left a receipt while BEGIN waited for its lock.
      if (journal?.pending().length && !this.replayingFileCommit) throw new AppError('CONFLICT', '另一份稿件提交尚待恢复，未覆盖它的文件。', { recoverable: true })
      const result = operation()
      if (journal && this.fileIntents.length) {
        if (!this.fileCommand) throw this.integrityError('稿件提交缺少操作类型。')
        receipt = this.replayingFileCommit ?? journal.prepare(String(this.projectRow()!.id), this.fileCommand, this.fileIntents)
        if (this.replayingFileCommit && JSON.stringify(receipt.files) !== JSON.stringify(this.fileIntents)) {
          throw new AppError('CONFLICT', '稿件恢复时目标或内容已变化，未重放过期操作。', { recoverable: true })
        }
        journal.apply(receipt)
        this.database.prepare('INSERT INTO manuscript_file_commits (operation_id, project_id, created_at) VALUES (?, ?, ?)')
          .run(receipt.operationId, receipt.projectId, this.now().toISOString())
      } else if (journal && this.replayingFileCommit) throw this.integrityError('稿件恢复没有产生预期的文件提交。')
      this.database.exec('COMMIT')
      if (receipt) journal!.finish(receipt)
      if (journal && !journal.pending().length) this.removeSupersededAutosaveTexts()
      return result
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch { /* preserve original failure */ }
      if (error instanceof AppError) throw error
      if (phase === 'migration') throw error
      throw new AppError('STORAGE_ERROR', journal ? '稿件保存未全部完成，当前文件、历史和恢复稿均已保留，请重试索引恢复。' : '影子数据库写入失败；Markdown 和 JSON 原稿没有改动。', {
        recoverable: true,
        details: { area: 'workspaceDatabase' },
        cause: error
      })
    }
  }

  private removeSupersededAutosaveTexts(): void {
    // Only draft objects first created by this mode's merged autosaves qualify.
    // Imported history, terminal checkpoints, versions, ranges and current heads
    // remain protected by the database guard. No directory-wide garbage scan.
    if (!this.supersededAutosaveTexts.size) return
    try {
      // Hold the same cross-process SQLite write lock while checking references
      // AND unlinking. Otherwise a second process could reuse a deleted row/hash
      // between the metadata delete and unlink and lose its newly fixed history.
      this.database.exec('BEGIN IMMEDIATE')
      if (new ManuscriptCommitJournal(this.projectRoot).pending().length) { this.database.exec('ROLLBACK'); return }
      for (const hash of this.supersededAutosaveTexts) {
        const reference = this.database.prepare('SELECT * FROM manuscript_text_objects WHERE content_hash = ? AND autosave_temporary = 1').get(hash)
        if (!reference || reference.relative_path !== `.webnovel/history/text/${hash}.md` || reference.range_start !== null) continue
        new ManuscriptTextObjects(this.projectRoot).read({ hash, relativePath: String(reference.relative_path), rangeStart: null, rangeEnd: null })
        const deleted = this.database.prepare('DELETE FROM manuscript_text_objects WHERE content_hash = ? AND autosave_temporary = 1').run(hash)
        if (deleted.changes) unlinkSync(projectExistingPathSync(this.projectRoot, join(this.projectRoot, String(reference.relative_path))))
      }
      this.database.exec('COMMIT')
    } catch {
      try { this.database.exec('ROLLBACK') } catch { /* preserve committed save */ }
      // Retain a referenced/locked/corrupt draft; cleanup never changes save success.
    }
  }

  private integrityError(message: string): AppError {
    return new AppError('DATABASE_INTEGRITY_FAILED', message, {
      recoverable: false,
      details: { area: 'workspaceDatabase' }
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new AppError('STORAGE_ERROR', '作品数据库连接已经关闭。', { recoverable: true })
  }

  private row(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  }

  private rows(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  }

  private scalar(value: unknown, key: string): unknown {
    return this.row(value)?.[key]
  }
}

type DerivedCharacterSnapshotState = {
  characterId: string
  name: string
  throughChapterId: number
  throughChapterPosition: number
  present: boolean
  location?: string
  injury?: string
  relationships?: string[]
  knowledge?: string[]
  possession?: string
  goal?: string
  power?: string
  vitality?: 'alive' | 'dead'
  lastFactId: string
  factFingerprints: string[]
}

function characterFactIdentity(row: Record<string, unknown>): { characterId: string; name: string } | null {
  let name = ''
  try {
    const subject = row.subject_json ? JSON.parse(String(row.subject_json)) as { name?: unknown } : null
    if (subject && typeof subject.name === 'string') name = subject.name.trim()
  } catch { /* fall back to normalized key */ }
  if (!name) {
    const match = /^character:([^:]+):[^:]+$/.exec(String(row.normalized_key))
    if (match) {
      try { name = decodeURIComponent(match[1]).trim() } catch { name = match[1].trim() }
    }
  }
  if (!name || name.length > 120) return null
  const characterId = row.subject_id ? String(row.subject_id) : `character-${hashText(name.normalize('NFKC').toLocaleLowerCase('zh-CN')).slice(0, 16)}`
  return { characterId, name }
}

function applyApprovedCharacterFact(state: DerivedCharacterSnapshotState, predicate: string, objectJson: string): void {
  let value: unknown
  try { value = JSON.parse(objectJson) } catch { return }
  const values = factTextValues(value)
  if (predicate === 'relationship' || predicate === 'relationships') {
    state.relationships = [...new Set([...(state.relationships ?? []), ...values])]
    return
  }
  if (predicate === 'knowledge') {
    state.knowledge = [...new Set([...(state.knowledge ?? []), ...values])]
    return
  }
  const latest = values.at(-1)
  if (!latest) return
  if (predicate === 'location') state.location = latest
  else if (predicate === 'injury') state.injury = latest
  else if (predicate === 'possession') state.possession = latest
  else if (predicate === 'goal') state.goal = latest
  else if (predicate === 'power') state.power = latest
  else if (predicate === 'vitality') {
    const normalized = latest.trim().toLocaleLowerCase()
    if (['alive', '存活', '活着', '生存'].includes(normalized)) state.vitality = 'alive'
    else if (['dead', '死亡', '已死', '身亡'].includes(normalized)) state.vitality = 'dead'
  }
}

function factTextValues(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value]
  return source.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item.length > 0 && item.length <= 5_000)
}

function characterSnapshotStateJson(state: DerivedCharacterSnapshotState) {
  return {
    name: state.name,
    present: state.present,
    ...(state.location ? { location: state.location } : {}),
    ...(state.injury ? { injury: state.injury } : {}),
    ...(state.relationships?.length ? { relationships: state.relationships } : {}),
    ...(state.knowledge?.length ? { knowledge: state.knowledge } : {}),
    ...(state.possession ? { possession: state.possession } : {}),
    ...(state.goal ? { goal: state.goal } : {}),
    ...(state.power ? { power: state.power } : {}),
    ...(state.vitality ? { vitality: state.vitality } : {}),
    lastFactId: state.lastFactId
  }
}

function validCharacterSnapshotState(value: unknown): value is ReturnType<typeof characterSnapshotStateJson> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || item.present !== true
    || typeof item.lastFactId !== 'string' || !item.lastFactId || item.lastFactId.length > 200) return false
  for (const key of ['location', 'injury', 'possession', 'goal', 'power'] as const) {
    if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 5_000)) return false
  }
  for (const key of ['relationships', 'knowledge'] as const) {
    if (item[key] !== undefined && (!Array.isArray(item[key]) || item[key].length > 1_000
      || item[key].some((entry) => typeof entry !== 'string' || entry.length > 5_000))) return false
  }
  return item.vitality === undefined || item.vitality === 'alive' || item.vitality === 'dead'
}

const workspaceTaskStatuses: WorkspaceTaskStatus[] = ['queued', 'resuming', 'preparing', 'running', 'streaming', 'paused', 'succeeded', 'cancelled', 'failed', 'interrupted']
const workspaceArtifactStatuses: WorkspaceArtifactStatus[] = ['partial', 'complete', 'invalid', 'discarded', 'applied']
const workspaceFactBatchStatuses: WorkspaceFactBatchStatus[] = ['PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE']
const workspaceFactChangeDecisions: WorkspaceFactChangeDecision[] = ['PENDING', 'APPROVED', 'REJECTED', 'DEFERRED']
const workspaceFactChangeTypes: WorkspaceFactChangeRecord['changeType'][] = ['NEW', 'CHANGED', 'CONFIRMS', 'CONTRADICTS']
const workspaceFactReviewClasses: WorkspaceFactReviewClass[] = ['reviewable', 'low_value']
const workspaceFactImportances: WorkspaceFactImportance[] = ['high', 'medium', 'low']
const allowedArtifactTransitions: Record<WorkspaceArtifactStatus, WorkspaceArtifactStatus[]> = {
  partial: ['complete', 'invalid', 'discarded', 'applied'],
  complete: ['applied', 'discarded'],
  invalid: ['discarded'],
  discarded: [],
  applied: []
}

function findingSeverityMatchesLayer(
  layer: WorkspaceFindingRecord['ruleLayer'],
  severity: WorkspaceFindingRecord['severity']
): boolean {
  if (layer === 'deterministic') return severity === 'blocker' || severity === 'warning'
  if (layer === 'semantic') return severity === 'warning'
  return severity === 'suggestion'
}

function storageOutlineNodeType(nodeType: WorkspaceOutlineRecord['nodeType']): 'summary' | 'volume' | 'chapter' {
  return nodeType === 'stage' ? 'volume' : nodeType
}

function normalizeOutlinePlanning(
  current: WorkspaceOutlineRecord['planning'] | undefined,
  input: WorkspaceOutlineWriteInput['planning']
): WorkspaceOutlineRecord['planning'] {
  const next = {
    goalText: '', entryStateText: '', exitStateText: '', conflictText: '', turningPointText: '', hookText: '', metadataJson: '{}',
    ...current,
    ...input
  }
  assertBoundedText(next.goalText, '大纲目标', 20_000)
  assertBoundedText(next.entryStateText, '大纲入口状态', 20_000)
  assertBoundedText(next.exitStateText, '大纲出口状态', 20_000)
  assertBoundedText(next.conflictText, '大纲冲突', 20_000)
  assertBoundedText(next.turningPointText, '大纲转折', 20_000)
  assertBoundedText(next.hookText, '大纲钩子', 20_000)
  assertJsonText(next.metadataJson, 512_000, '大纲扩展元数据')
  return next
}

function normalizeWorkspaceChapterCard(
  current: WorkspaceChapterPlanningRecord['card'],
  input: Partial<WorkspaceChapterPlanningRecord['card']> | undefined
): WorkspaceChapterPlanningRecord['card'] {
  const status = input?.status ?? current.status
  if (!['empty', 'draft', 'confirmed'].includes(status)) throw new AppError('VALIDATION_ERROR', '章卡状态无效。', { recoverable: true })
  try {
    const normalized = normalizeChapterCard({
      goal: input?.goal ?? current.goal,
      entryState: input?.entryState ?? current.entryState,
      beats: input?.beats ?? current.beats,
      conflict: input?.conflict ?? current.conflict,
      characters: input?.characters ?? current.characters,
      pointOfView: input?.pointOfView ?? current.pointOfView,
      narrativeDistance: input?.narrativeDistance ?? current.narrativeDistance,
      exitChange: input?.exitChange ?? current.exitChange,
      hook: input?.hook ?? current.hook
    })
    return { status, ...normalized }
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', error instanceof Error ? error.message : '章卡内容无效。', { recoverable: true, cause: error })
  }
}

function parseChapterCardJson(value: string): Pick<ChapterCard, 'beats' | 'characters'> {
  try {
    const parsed = JSON.parse(value) as { beats?: unknown; characters?: unknown }
    if (!parsed || typeof parsed !== 'object'
      || (parsed.beats !== undefined && !Array.isArray(parsed.beats))
      || (parsed.characters !== undefined && !Array.isArray(parsed.characters))) throw new Error('invalid chapter card JSON')
    return { beats: (parsed.beats ?? []).map(String), characters: (parsed.characters ?? []).map(String) }
  } catch (error) {
    throw new AppError('DATABASE_INTEGRITY_FAILED', '章卡场景或人物数据损坏。', { recoverable: false, cause: error })
  }
}

function assertFactChangeCreateInput(change: WorkspaceFactChangeCreateInput): void {
  assertBoundedIdentifier(change.id, '事实变化 ID')
  assertBoundedIdentifier(change.candidateType, '事实候选类型')
  assertBoundedIdentifier(change.subjectType, '事实主体类型')
  if (change.subjectId) assertBoundedIdentifier(change.subjectId, '事实主体 ID')
  assertBoundedIdentifier(change.predicate, '事实谓词')
  if (typeof change.normalizedKey !== 'string' || !change.normalizedKey.trim() || change.normalizedKey.length > 500 || /\u0000/.test(change.normalizedKey)) {
    throw new AppError('VALIDATION_ERROR', '事实归一化键无效。', { recoverable: true })
  }
  assertJsonText(change.subjectJson, 512_000, '事实主体')
  assertJsonValueText(change.objectJson, 512_000, '事实值')
  assertJsonText(change.evidenceJson, 1_000_000, '事实证据')
  if (change.confidence !== undefined && change.confidence !== null
    && (!Number.isFinite(change.confidence) || change.confidence < 0 || change.confidence > 1)) {
    throw new AppError('VALIDATION_ERROR', '事实置信度无效。', { recoverable: true })
  }
  if (!workspaceFactImportances.includes(change.importance) || !workspaceFactChangeTypes.includes(change.changeType)
    || !workspaceFactReviewClasses.includes(change.reviewClass)) {
    throw new AppError('VALIDATION_ERROR', '事实重要性或变化类型无效。', { recoverable: true })
  }
  if (change.matchedFactId) assertBoundedIdentifier(change.matchedFactId, '匹配事实 ID')
}

function factBatchMatchesInput(stored: WorkspaceFactBatchRecord, input: WorkspaceFactBatchCreateInput): boolean {
  if (stored.id !== input.id
    || stored.legacyChapterId !== input.legacyChapterId
    || stored.bodyVersionId !== input.bodyVersionId
    || stored.contentHash !== input.contentHash
    || stored.extractorTaskRunId !== (input.extractorTaskRunId ?? null)
    || stored.countsJson !== input.countsJson
    || stored.changes.length !== input.changes.length) return false
  return stored.changes.every((change, index) => {
    const expected = input.changes[index]
    return change.id === expected.id
      && change.candidateType === expected.candidateType
      && change.subjectType === expected.subjectType
      && change.subjectId === (expected.subjectId ?? null)
      && change.subjectJson === expected.subjectJson
      && change.predicate === expected.predicate
      && change.objectJson === expected.objectJson
      && change.normalizedKey === expected.normalizedKey
      && change.evidenceJson === expected.evidenceJson
      && change.confidence === (expected.confidence ?? null)
      && change.importance === expected.importance
      && change.changeType === expected.changeType
      && change.reviewClass === expected.reviewClass
      && change.matchedFactId === (expected.matchedFactId ?? null)
  })
}

function assertOptionalPositiveInteger(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new AppError('VALIDATION_ERROR', `${label}必须是正整数。`, { recoverable: true })
}

function assertBoundedText(value: string, label: string, maxLength: number): void {
  if (typeof value !== 'string' || value.length > maxLength || /\u0000/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `${label}无效或超过 ${maxLength} 字符。`, { recoverable: true })
  }
}

function canonicalEventSlotSignature(event: Pick<WorkspaceCanonicalEventRecord, 'time' | 'location'>): string {
  return `${normalizeStoryText(event.time)}\u0000${normalizeStoryText(event.location)}`
}

function sameCanonicalEventSlot(left: WorkspaceCanonicalEventRecord, right: WorkspaceCanonicalEventRecord): boolean {
  if (canonicalEventSlotSignature(left) !== canonicalEventSlotSignature(right)) return false
  const characters = new Set(left.characters.map(normalizeStoryText))
  return right.characters.some((name) => characters.has(normalizeStoryText(name)))
}

function normalizeFoundationConfig(input: Record<string, unknown>): WorkspaceFoundationConfig {
  const sourceNotes = typeof input.sourceNotes === 'string' ? input.sourceNotes.trim() : ''
  const worldView = typeof input.worldView === 'string' ? input.worldView.trim() : ''
  assertBoundedText(sourceNotes, '作者札记', 100_000)
  assertBoundedText(worldView, '世界观', 100_000)
  return {
    creationPath: input.creationPath === 'research' ? 'research' : 'materials',
    sourceNotes,
    worldView,
    useRealms: input.useRealms === true,
    useSystem: input.useSystem === true
  }
}

function assertPromptProfileInput(input: Pick<LegacyWorkspacePromptProfile, 'version' | 'workItemId' | 'genreFingerprint' | 'overrides' | 'updatedAt'>): void {
  if (input.version !== 1 || !input.workItemId.trim() || input.workItemId.length > 500 || input.genreFingerprint.length > 64 || input.updatedAt.length > 100) {
    throw new AppError('VALIDATION_ERROR', '作品提示词身份无效。', { recoverable: true })
  }
  for (const [task, content] of Object.entries(input.overrides)) {
    if (!promptTaskTypes.includes(task as typeof promptTaskTypes[number]) || typeof content !== 'string' || !content.trim() || content.length > 50_000) {
      throw new AppError('VALIDATION_ERROR', '作品提示词内容无效。', { recoverable: true })
    }
  }
}

function emptyPromptProfile(workItemId: string): LegacyWorkspacePromptProfile {
  return { version: 1, workItemId, genreFingerprint: '', overrides: {}, updatedAt: '', mirror: null }
}

function normalizeCharacterName(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-Hans-CN')
}

function assertBoundedIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  }
}

function assertJsonText(value: string, maxLength: number, label: string): void {
  if (typeof value !== 'string' || value.length > maxLength) throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') throw new Error('object required')
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', `${label}不是有效 JSON。`, { recoverable: true, cause: error })
  }
}

function assertNoResourceQuantityFields(profileJson: string): void {
  const parsed = JSON.parse(profileJson) as Record<string, unknown>
  const reserved = new Set(['quantity', 'count', 'balance', 'stock', '数量', '余额', '库存', '持有量'])
  const conflicting = Object.keys(parsed).find((key) => reserved.has(key.trim().toLocaleLowerCase('en-US')))
  if (conflicting) {
    throw new AppError('VALIDATION_ERROR', `物品档案中的“${conflicting}”会形成第二套数量来源；请删除该字段，并在资源账本中记录初始数量。`, { recoverable: true })
  }
}

function assertJsonValueText(value: string, maxLength: number, label: string): void {
  if (typeof value !== 'string' || value.length > maxLength) throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  try { JSON.parse(value) } catch (error) {
    throw new AppError('VALIDATION_ERROR', `${label}不是有效 JSON。`, { recoverable: true, cause: error })
  }
}

function taskContractFromRow(row: Record<string, unknown>): WorkspaceTaskContractSnapshot {
  return {
    templateId: String(row.template_id ?? ''),
    templateVersion: Number(row.template_version),
    templateHash: String(row.template_hash ?? ''),
    inputSchemaJson: String(row.input_schema_json ?? ''),
    outputSchemaJson: String(row.output_schema_json ?? ''),
    allowedOperationsJson: String(row.allowed_operations_json ?? ''),
    forbiddenOperationsJson: String(row.forbidden_operations_json ?? ''),
    contractHash: String(row.task_contract_hash ?? '')
  }
}

function assertTaskContractSnapshot(contract: WorkspaceTaskContractSnapshot, taskType: string, allowLegacy: boolean): void {
  assertBoundedIdentifier(contract.templateId, '任务模板 ID')
  if (!Number.isSafeInteger(contract.templateVersion) || contract.templateVersion < 0
    || (!allowLegacy && contract.templateVersion < 1)) {
    throw new AppError('VALIDATION_ERROR', '任务模板版本无效。', { recoverable: true })
  }
  if (!isSha256(contract.templateHash) || !isSha256(contract.contractHash)) {
    throw new AppError('VALIDATION_ERROR', '任务契约指纹无效。', { recoverable: true })
  }
  const inputSchema = parseObjectJson(contract.inputSchemaJson, 200_000, '任务输入结构')
  const outputSchema = parseObjectJson(contract.outputSchemaJson, 200_000, '任务输出结构')
  const allowed = parseOperationList(contract.allowedOperationsJson, '任务允许操作')
  const forbidden = parseOperationList(contract.forbiddenOperationsJson, '任务禁止操作')
  void inputSchema; void outputSchema
  if (contract.templateVersion === 0) {
    if (!allowLegacy || contract.templateId !== `legacy:${taskType}` || contract.templateHash !== '0'.repeat(64)
      || contract.contractHash !== '0'.repeat(64) || allowed.length || forbidden.length !== 1 || forbidden[0] !== '*') {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '历史 AI 任务契约标记损坏。', { recoverable: false })
    }
    return
  }
  if (!allowed.length || !forbidden.length || allowed.some((operation) => forbidden.includes(operation) || operation === '*')) {
    throw new AppError('VALIDATION_ERROR', '任务允许与禁止操作边界无效。', { recoverable: true })
  }
  const { contractHash: _ignored, ...hashable } = contract
  if (taskContractHash(hashable) !== contract.contractHash) {
    throw new AppError(allowLegacy ? 'DATABASE_INTEGRITY_FAILED' : 'VALIDATION_ERROR', '任务契约指纹与冻结内容不匹配。', { recoverable: !allowLegacy })
  }
}

function parseObjectJson(value: string, maxLength: number, label: string): Record<string, unknown> {
  assertJsonText(value, maxLength, label)
  return JSON.parse(value) as Record<string, unknown>
}

function parseOperationList(value: string, label: string): string[] {
  if (typeof value !== 'string' || value.length > 100_000) {
    throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  }
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch (error) {
    throw new AppError('VALIDATION_ERROR', `${label}不是有效 JSON。`, { recoverable: true, cause: error })
  }
  if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)
    || new Set(parsed).size !== parsed.length) {
    throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  }
  return parsed
}

function sameTaskContract(left: WorkspaceTaskContractSnapshot, right: WorkspaceTaskContractSnapshot): boolean {
  return left.templateId === right.templateId && left.templateVersion === right.templateVersion
    && left.templateHash === right.templateHash && left.inputSchemaJson === right.inputSchemaJson
    && left.outputSchemaJson === right.outputSchemaJson && left.allowedOperationsJson === right.allowedOperationsJson
    && left.forbiddenOperationsJson === right.forbiddenOperationsJson && left.contractHash === right.contractHash
}

function assertCharacterStateDocument(content: string, contentHash: string, _projectId: string): void {
  if (typeof content !== 'string' || content.length > 64 * 1024 * 1024 || !isSha256(contentHash) || hashText(content) !== contentHash) {
    throw new AppError('VALIDATION_ERROR', '人物状态内容或校验值无效。', { recoverable: true })
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch (error) {
    throw new AppError('VALIDATION_ERROR', '人物状态不是有效 JSON。', { recoverable: true, cause: error })
  }
  const item = parsed as Record<string, unknown>
  if (!item || Array.isArray(item) || item.version !== 1 || typeof item.workItemId !== 'string' || !item.workItemId
    || !Array.isArray(item.anchors) || !Array.isArray(item.events) || !Array.isArray(item.pendingConflicts)) {
    throw new AppError('VALIDATION_ERROR', '人物状态结构或作品归属无效。', { recoverable: true })
  }
}

function assertOutlinePlanningStateDocument(content: string, contentHash: string): void {
  if (typeof content !== 'string' || content.length > 64 * 1024 * 1024 || !isSha256(contentHash) || hashText(content) !== contentHash) {
    throw new AppError('VALIDATION_ERROR', '谋篇工作流内容或校验值无效。', { recoverable: true })
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch (error) {
    throw new AppError('VALIDATION_ERROR', '谋篇工作流不是有效 JSON。', { recoverable: true, cause: error })
  }
  const item = parsed as Record<string, unknown>
  const arrays = ['assignments', 'volumes', 'chapterPlacements', 'manuscriptStarts', 'eventChapterPlacements', 'chapters', 'chapterConfirmations', 'outlineReviewAcknowledgements', 'planningConfirmations']
  if (!item || Array.isArray(item) || item.version !== 1 || !item.total || typeof item.total !== 'object' || Array.isArray(item.total)
    || arrays.some((field) => !Array.isArray(item[field]))) {
    throw new AppError('VALIDATION_ERROR', '谋篇工作流结构无效。', { recoverable: true })
  }
}

function assertAiSettingsDocument(content: string, contentHash: string): BookModelSettings {
  if (typeof content !== 'string' || !isSha256(contentHash) || hashText(content) !== contentHash) {
    throw new AppError('VALIDATION_ERROR', 'AI 模型配置内容或校验值无效。', { recoverable: true })
  }
  return parseBookModelSettings(content)
}
const workspaceConfigKinds = ['timeline', 'realms', 'power_system', 'cheat_system', 'system_ui', 'world_map'] as const

function assertWorkspaceConfigKind(kind: string): asserts kind is WorkspaceConfigDocumentKind {
  if (!workspaceConfigKinds.includes(kind as WorkspaceConfigDocumentKind)) {
    throw new AppError('VALIDATION_ERROR', '作品配置类型无效。', { recoverable: true })
  }
}

function workspaceConfigLabel(kind: WorkspaceConfigDocumentKind): string {
  return ({ timeline: '纪事时间线', realms: '境界体系', power_system: '力量体系', cheat_system: '金手指设定', system_ui: '系统界面模板', world_map: '小说地图' } as const)[kind]
}

function workspaceConfigRelativePath(kind: WorkspaceConfigDocumentKind): string {
  return `.webnovel/config/${({ timeline: 'timeline.json', realms: 'levels.json', power_system: 'power-system.json', cheat_system: 'cheat-system.json', system_ui: 'system-ui.json', world_map: 'world-map.json' } as const)[kind]}`
}

function assertWorkspaceConfigDocument(kind: WorkspaceConfigDocumentKind, content: string, contentHash: string): void {
  assertWorkspaceConfigKind(kind)
  if (typeof content !== 'string' || content.length > 8_000_000 || !isSha256(contentHash) || hashText(content) !== contentHash) {
    throw new AppError('VALIDATION_ERROR', `${workspaceConfigLabel(kind)}内容或校验值无效。`, { recoverable: true })
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch (error) {
    throw new AppError('VALIDATION_ERROR', `${workspaceConfigLabel(kind)}不是有效 JSON。`, { recoverable: true, cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('VALIDATION_ERROR', `${workspaceConfigLabel(kind)}结构无效。`, { recoverable: true })
  }
  if (kind === 'world_map') { decodeWorldMapDocument(parsed); return }
  const item = parsed as Record<string, unknown>
  const valid = kind === 'timeline' ? Array.isArray(item.events)
    : kind === 'realms' ? Array.isArray(item.levels)
      : kind === 'system_ui' ? typeof item.template === 'string' && Object.keys(item).every((key) => key === 'template')
        : item.version === 1 && typeof item.overview === 'string' && Object.keys(item).every((key) => key === 'version' || key === 'overview')
  if (!valid) throw new AppError('VALIDATION_ERROR', `${workspaceConfigLabel(kind)}结构无效。`, { recoverable: true })
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

function deterministicChapterId(projectId: string, legacyChapterId: number): string {
  return `chapter-${createHash('sha256').update(`${projectId}\u0000${legacyChapterId}`).digest('hex').slice(0, 32)}`
}

function deterministicOutlineId(projectId: string, legacyKey: string): string {
  return `outline-${createHash('sha256').update(`${projectId}\u0000${legacyKey}`).digest('hex').slice(0, 32)}`
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function chapterRevision(legacyChapterId: number, title: string, content: string): string {
  return hashText(`${legacyChapterId}\u0000${title}\u0000${content}`)
}

function countWords(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = content.match(/[A-Za-z0-9]+/g)?.length ?? 0
  return chinese + latin
}

// Adjustable starting recommendation: 1,600 characters with a short overlap
// keeps Chinese prose excerpts coherent without turning a whole chapter into one retrieval item.
function chunkDocumentContent(content: string, maxCharacters = 1_600, overlapCharacters = 160): Array<{ content: string; start: number; end: number }> {
  if (!content.trim()) return []
  const chunks: Array<{ content: string; start: number; end: number }> = []
  let start = 0
  while (start < content.length) {
    let end = Math.min(content.length, start + maxCharacters)
    if (end < content.length) {
      const floor = start + Math.floor(maxCharacters * 0.55)
      const window = content.slice(floor, end)
      const boundary = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'))
      if (boundary >= 0) end = floor + boundary + 1
    }
    const raw = content.slice(start, end)
    const chunk = raw.trim()
    if (chunk) chunks.push({ content: chunk, start: start + raw.length - raw.trimStart().length, end: start + raw.trimEnd().length })
    if (end >= content.length) break
    const next = Math.max(start + 1, end - overlapCharacters)
    start = next
  }
  return chunks
}

function estimateDocumentTokens(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const remaining = Math.max(0, content.length - chinese)
  return Math.max(1, Math.ceil(chinese + remaining / 4))
}

function safeMirrorTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function cleanupNewDatabase(path: string): Promise<void> {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) await unlink(target).catch(() => undefined)
}
