import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import {
  assertStoryEventVersionPayload, assertStoryIdentifier, storyEventVersionPayload,
  type StoryEventVersion, type StoryEventVersionHeads, type StoryEventVersionPayload,
  type StoryRevisionRef, type StorySourceEdge
} from '../domain/story-event-version'
import type { WorkspaceCanonicalEventRecord } from '../../../core/ports/workspace-database'

export const canonicalEventVersionTables = ['canonical_event_versions', 'canonical_event_version_sources', 'canonical_event_version_seals', 'canonical_event_version_heads']
export const canonicalEventVersionTriggers = [
  ...canonicalEventVersionTables.slice(0, 3).flatMap((table) => [`${table}_no_update`, `${table}_no_delete`]),
  'canonical_event_versions_scope_guard', 'canonical_event_version_sources_scope_guard', 'canonical_event_version_seals_scope_guard',
  'canonical_event_version_heads_insert_guard', 'canonical_event_version_heads_update_guard', 'canonical_event_version_heads_no_delete'
]

const headGuard = `
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_event_versions v JOIN canonical_event_version_seals s ON s.version_id = v.id
    WHERE v.id = NEW.latest_version_id AND v.project_id = NEW.project_id AND v.event_id = NEW.event_id
      AND v.version_no = (SELECT MAX(version_no) FROM canonical_event_versions WHERE event_id = NEW.event_id)
  ) THEN RAISE(ABORT, 'invalid event latest version') END;
  SELECT CASE WHEN NEW.approved_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canonical_event_versions v JOIN canonical_event_version_seals s ON s.version_id = v.id
    WHERE v.id = NEW.approved_version_id AND v.project_id = NEW.project_id AND v.event_id = NEW.event_id
      AND json_extract(v.payload_json, '$.status') = 'approved'
      AND v.version_no = (SELECT MAX(version_no) FROM canonical_event_versions WHERE event_id = NEW.event_id AND json_extract(payload_json, '$.status') = 'approved')
  ) THEN RAISE(ABORT, 'invalid event approved version') END;
  SELECT CASE WHEN NEW.approved_version_id IS NULL AND EXISTS (
    SELECT 1 FROM canonical_event_versions WHERE event_id = NEW.event_id AND json_extract(payload_json, '$.status') = 'approved'
  ) THEN RAISE(ABORT, 'approved event head cannot be cleared') END;
`

export const canonicalEventVersionsMigrationSql = `
DROP TRIGGER projects_schema_version_v37_after_insert;
CREATE TABLE canonical_event_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  previous_version_id TEXT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(event_id, version_no)
);
CREATE TABLE canonical_event_version_sources (
  version_id TEXT NOT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  relation TEXT NOT NULL CHECK(relation IN ('derived-from', 'refines', 'realizes', 'deviates-from', 'supersedes')),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('material', 'total-outline', 'volume-outline', 'chapter-outline', 'event', 'manuscript')),
  source_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  PRIMARY KEY(version_id, ordinal)
);
CREATE TABLE canonical_event_version_seals (
  version_id TEXT PRIMARY KEY REFERENCES canonical_event_versions(id) ON DELETE RESTRICT
);
CREATE TABLE canonical_event_version_heads (
  event_id TEXT PRIMARY KEY REFERENCES canonical_events(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  latest_version_id TEXT NOT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT,
  approved_version_id TEXT NULL REFERENCES canonical_event_versions(id) ON DELETE RESTRICT
);
CREATE INDEX idx_canonical_event_versions_project_event ON canonical_event_versions(project_id, event_id, version_no);
CREATE INDEX idx_canonical_event_version_sources_ref ON canonical_event_version_sources(source_kind, source_id, source_revision);
${canonicalEventVersionTables.slice(0, 3).map((table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'event history is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'event history is append-only'); END;
`).join('')}
CREATE TRIGGER canonical_event_versions_scope_guard BEFORE INSERT ON canonical_event_versions BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_events e JOIN projects p ON p.id = e.project_id AND p.storage_mode = 'sqlite'
    WHERE e.id = NEW.event_id AND e.project_id = NEW.project_id
  ) THEN RAISE(ABORT, 'cross-project event version') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.payload_json, '$.content.evidenceRefs') evidence
    WHERE NOT EXISTS (SELECT 1 FROM material_sources s WHERE s.id = json_extract(evidence.value, '$.sourceId') AND s.project_id = NEW.project_id)
  ) THEN RAISE(ABORT, 'cross-project event version evidence') END;
  SELECT CASE WHEN NEW.version_no <> COALESCE((SELECT MAX(version_no) + 1 FROM canonical_event_versions WHERE event_id = NEW.event_id), 1)
    OR NEW.previous_version_id IS NOT (SELECT latest_version_id FROM canonical_event_version_heads WHERE event_id = NEW.event_id)
    OR (NEW.version_no > 1 AND NEW.previous_version_id IS NULL)
    THEN RAISE(ABORT, 'stale event version') END;
END;
CREATE TRIGGER canonical_event_version_sources_scope_guard BEFORE INSERT ON canonical_event_version_sources BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM canonical_event_version_seals WHERE version_id = NEW.version_id)
    THEN RAISE(ABORT, 'event sources are sealed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_event_versions v, json_each(v.payload_json, '$.sources') source
    WHERE v.id = NEW.version_id AND source.key = NEW.ordinal
      AND json_extract(source.value, '$.relation') = NEW.relation
      AND json_extract(source.value, '$.source.kind') = NEW.source_kind
      AND json_extract(source.value, '$.source.id') = NEW.source_id
      AND json_extract(source.value, '$.source.revision') = NEW.source_revision
  ) THEN RAISE(ABORT, 'event source snapshot mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_event_versions target WHERE target.id = NEW.version_id AND (
      (NEW.source_kind = 'material' AND EXISTS (SELECT 1 FROM material_sources s WHERE s.id = NEW.source_id AND s.project_id = target.project_id AND s.content_hash = NEW.source_revision))
      OR (NEW.source_kind = 'event' AND EXISTS (SELECT 1 FROM canonical_event_versions s JOIN canonical_event_version_seals sealed ON sealed.version_id = s.id WHERE s.event_id = NEW.source_id AND s.id = NEW.source_revision AND s.project_id = target.project_id AND s.id <> target.id))
      OR (NEW.source_kind = 'manuscript' AND EXISTS (SELECT 1 FROM body_versions s JOIN chapters c ON c.id = s.chapter_id WHERE c.id = NEW.source_id AND s.id = NEW.source_revision AND c.project_id = target.project_id))
      OR (NEW.source_kind IN ('total-outline', 'volume-outline', 'chapter-outline') AND EXISTS (
        SELECT 1 FROM outline_versions s JOIN outline_nodes n ON n.id = s.outline_node_id
        WHERE n.id = NEW.source_id AND s.id = NEW.source_revision AND n.project_id = target.project_id
          AND n.node_type = CASE NEW.source_kind WHEN 'total-outline' THEN 'summary' WHEN 'volume-outline' THEN 'volume' ELSE 'chapter' END
      ))
    )
  ) THEN RAISE(ABORT, 'missing or cross-project event source revision') END;
END;
CREATE TRIGGER canonical_event_version_seals_scope_guard BEFORE INSERT ON canonical_event_version_seals BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_event_versions v WHERE v.id = NEW.version_id
      AND json_type(v.payload_json, '$.sources') = 'array'
      AND json_array_length(v.payload_json, '$.sources') = (SELECT COUNT(*) FROM canonical_event_version_sources WHERE version_id = v.id)
  ) THEN RAISE(ABORT, 'incomplete event source snapshot') END;
END;
CREATE TRIGGER canonical_event_version_heads_insert_guard BEFORE INSERT ON canonical_event_version_heads BEGIN ${headGuard} END;
CREATE TRIGGER canonical_event_version_heads_update_guard BEFORE UPDATE ON canonical_event_version_heads BEGIN
  SELECT CASE WHEN NEW.event_id <> OLD.event_id OR NEW.project_id <> OLD.project_id THEN RAISE(ABORT, 'event head identity is immutable') END;
  ${headGuard}
END;
CREATE TRIGGER canonical_event_version_heads_no_delete BEFORE DELETE ON canonical_event_version_heads BEGIN SELECT RAISE(ABORT, 'event head cannot be deleted'); END;
CREATE TRIGGER projects_schema_version_v38_after_insert AFTER INSERT ON projects
BEGIN UPDATE projects SET current_schema_version = 38 WHERE id = NEW.id; END;
UPDATE projects SET current_schema_version = 38;
`

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const fail = (code: 'CONFLICT' | 'NOT_FOUND' | 'DATABASE_INTEGRITY_FAILED', message: string): never => {
  throw new AppError(code, message, { recoverable: code !== 'DATABASE_INTEGRITY_FAILED' })
}

/** Uses the owning database transaction; this adapter never starts or commits one. */
export class CanonicalEventVersions {
  constructor(private readonly database: DatabaseSync, private readonly projectId: string, private readonly id: () => string) {}

  heads(eventId: string): StoryEventVersionHeads | null {
    assertStoryIdentifier(eventId)
    this.assertEvent(eventId)
    const row = this.database.prepare('SELECT * FROM canonical_event_version_heads WHERE project_id = ? AND event_id = ?').get(this.projectId, eventId)
    return row ? { latestVersionId: String(row.latest_version_id), approvedVersionId: row.approved_version_id === null ? null : String(row.approved_version_id) } : null
  }

  list(eventId: string): StoryEventVersion[] {
    assertStoryIdentifier(eventId)
    this.assertEvent(eventId)
    const versions = this.database.prepare('SELECT * FROM canonical_event_versions WHERE project_id = ? AND event_id = ? ORDER BY version_no').all(this.projectId, eventId)
      .map((row) => this.decode(row))
    const heads = this.heads(eventId)
    const approved = versions.filter((version) => version.status === 'approved').at(-1)
    if ((versions.length === 0) !== (heads === null) || (heads && (heads.latestVersionId !== versions.at(-1)?.id || heads.approvedVersionId !== (approved?.id ?? null)))
      || versions.some((version, index) => version.version !== index + 1 || version.previousVersionId !== (versions[index - 1]?.id ?? null))) {
      fail('DATABASE_INTEGRITY_FAILED', '事件版本链或正式指针不完整。')
    }
    return versions
  }

  append(eventId: string, expectedVersionId: string | null, payload: StoryEventVersionPayload, timestamp: string): StoryEventVersion {
    const versions = this.list(eventId)
    const previous = versions.at(-1)
    if ((previous?.id ?? null) !== expectedVersionId) fail('CONFLICT', '事件已产生新版本，请重新核对后保存。')
    const normalized = storyEventVersionPayload(payload)
    normalized.sources.forEach((edge) => this.assertSource(edge.source))
    normalized.content.evidenceRefs.forEach((evidence) => {
      if (!this.database.prepare('SELECT id FROM material_sources WHERE project_id = ? AND id = ?').get(this.projectId, evidence.sourceId)) {
        fail('NOT_FOUND', '事件证据资料不存在于当前作品。')
      }
    })
    const payloadJson = JSON.stringify(normalized)
    const id = this.id()
    assertStoryIdentifier(id)
    this.database.prepare(`INSERT INTO canonical_event_versions
      (id, project_id, event_id, version_no, previous_version_id, payload_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, this.projectId, eventId, (previous?.version ?? 0) + 1, expectedVersionId, payloadJson, hash(payloadJson), timestamp)
    const insertSource = this.database.prepare(`INSERT INTO canonical_event_version_sources
      (version_id, ordinal, relation, source_kind, source_id, source_revision) VALUES (?, ?, ?, ?, ?, ?)`)
    normalized.sources.forEach((edge, ordinal) => insertSource.run(id, ordinal, edge.relation, edge.source.kind, edge.source.id, edge.source.revision))
    this.database.prepare('INSERT INTO canonical_event_version_seals (version_id) VALUES (?)').run(id)
    const approvedVersionId = normalized.status === 'approved' ? id : (this.heads(eventId)?.approvedVersionId ?? null)
    this.database.prepare(`INSERT INTO canonical_event_version_heads (event_id, project_id, latest_version_id, approved_version_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET latest_version_id = excluded.latest_version_id, approved_version_id = excluded.approved_version_id`)
      .run(eventId, this.projectId, id, approvedVersionId)
    return this.list(eventId).at(-1)!
  }

  baseline(event: WorkspaceCanonicalEventRecord, timestamp: string): StoryEventVersion {
    const existing = this.list(event.id)
    if (existing.length) return existing[0]!
    return this.append(event.id, null, {
      content: event, status: event.status, phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources: []
    }, timestamp)
  }

  captureCreated(event: WorkspaceCanonicalEventRecord, timestamp: string): StoryEventVersion {
    const sources: StorySourceEdge[] = []
    for (const evidence of event.evidenceRefs) {
      if (sources.some((edge) => edge.source.id === evidence.sourceId)) continue
      const source = this.database.prepare('SELECT content_hash FROM material_sources WHERE project_id = ? AND id = ?').get(this.projectId, evidence.sourceId)
      if (!source) throw new AppError('NOT_FOUND', '事件资料来源不存在于当前作品。', { recoverable: true })
      sources.push({ relation: 'derived-from', source: { kind: 'material', id: evidence.sourceId, revision: String(source.content_hash) } })
    }
    return this.append(event.id, null, {
      content: event, status: event.status, phase: 'legacy-unknown', granularity: 'legacy-unknown', creator: 'legacy-unknown', sources
    }, timestamp)
  }

  private assertEvent(eventId: string): void {
    if (!this.database.prepare('SELECT id FROM canonical_events WHERE project_id = ? AND id = ?').get(this.projectId, eventId)) {
      fail('NOT_FOUND', '事件不存在于当前作品。')
    }
  }

  private assertSource(source: StoryRevisionRef): void {
    let exists: unknown
    if (source.kind === 'material') {
      exists = this.database.prepare('SELECT id FROM material_sources WHERE project_id = ? AND id = ? AND content_hash = ?').get(this.projectId, source.id, source.revision)
    } else if (source.kind === 'event') {
      exists = this.database.prepare(`SELECT v.id FROM canonical_event_versions v JOIN canonical_event_version_seals s ON s.version_id = v.id
        WHERE v.project_id = ? AND v.event_id = ? AND v.id = ?`).get(this.projectId, source.id, source.revision)
      // A seal protects inserts; reading the source also verifies its retained payload and chain.
      if (exists) this.list(source.id)
    } else if (source.kind === 'manuscript') {
      exists = this.database.prepare(`SELECT v.id FROM body_versions v JOIN chapters c ON c.id = v.chapter_id
        WHERE c.project_id = ? AND c.id = ? AND v.id = ?`).get(this.projectId, source.id, source.revision)
    } else if (source.kind !== 'chapter-skeleton') {
      const kind = { 'total-outline': 'summary', 'volume-outline': 'volume', 'chapter-outline': 'chapter' }[source.kind]
      exists = this.database.prepare(`SELECT v.id FROM outline_versions v JOIN outline_nodes n ON n.id = v.outline_node_id
        WHERE n.project_id = ? AND n.id = ? AND v.id = ? AND n.node_type = ?`).get(this.projectId, source.id, source.revision, kind)
    }
    if (!exists) fail('CONFLICT', '事件来源版本不存在、已变化或不属于当前作品。')
  }

  private decode(row: Record<string, unknown>): StoryEventVersion {
    try {
      const payloadJson = String(row.payload_json)
      if (hash(payloadJson) !== row.content_hash) throw new Error('hash mismatch')
      const payload: unknown = JSON.parse(payloadJson)
      assertStoryEventVersionPayload(payload)
      const sources = this.database.prepare('SELECT * FROM canonical_event_version_sources WHERE version_id = ? ORDER BY ordinal').all(String(row.id))
        .map((edge) => ({ source: { kind: edge.source_kind, id: edge.source_id, revision: edge.source_revision }, relation: edge.relation }))
      if (JSON.stringify(sources) !== JSON.stringify(payload.sources)
        || !this.database.prepare('SELECT version_id FROM canonical_event_version_seals WHERE version_id = ?').get(String(row.id))) throw new Error('unsealed sources')
      return { ...payload, id: String(row.id), projectId: String(row.project_id), eventId: String(row.event_id), version: Number(row.version_no),
        previousVersionId: row.previous_version_id === null ? null : String(row.previous_version_id), contentHash: String(row.content_hash), createdAt: String(row.created_at) }
    } catch (error) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '事件历史内容或来源证据损坏，已停止版本写入。', { cause: error })
    }
  }
}
