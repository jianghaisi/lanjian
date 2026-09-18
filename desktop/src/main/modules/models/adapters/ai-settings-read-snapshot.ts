import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../core/ports/workspace-database'
import { MAX_MODEL_CONNECTION_BYTES } from '../domain/model-connections'
import { bookModelSourceUnavailable, type BookModelStorage } from '../domain/book-model-resolution'
import { stableEventReadSnapshot } from '../../timeline/adapters/event-read-snapshot'

export async function modelBookIdentity(bookRoot: string): Promise<string> {
  if (!isAbsolute(bookRoot)) throw bookModelSourceUnavailable()
  const root = await realpath(bookRoot), info = await stat(root, { bigint: true })
  if (!info.isDirectory()) throw bookModelSourceUnavailable()
  return modelSourceHash(JSON.stringify([process.platform === 'win32' ? root.toLowerCase() : root, String(info.ino), String(info.birthtimeNs)]))
}

type AiAuthority = {
  storage: BookModelStorage
  formal: boolean; value?: unknown; content?: string
  /** Whole DB/WAL bytes for conservative legacy reuse previews. */
  fingerprint: string | null
  /** AI authority only; unrelated manuscript changes do not revoke a request. */
  documentFingerprint: string
}

/** Opens only a disposable read-only snapshot, never the source DB or a migration factory. */
export async function readAiAuthority(root: string): Promise<AiAuthority> {
  const snapshot = await stableEventReadSnapshot(root)
  if (!snapshot) return { formal: false, fingerprint: null, documentFingerprint: 'no-database',
    storage: { mode: 'files', schemaVersion: null, projectId: null, ready: false, contentHash: null, revision: null } }
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(snapshot.path, { readOnly: true, allowExtension: false })
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN;')
    const version = database.prepare('PRAGMA user_version').get()?.user_version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > WORKSPACE_DATABASE_SCHEMA_VERSION) throw bookModelSourceUnavailable()
    const rows = database.prepare('SELECT id, storage_mode FROM projects LIMIT 2').all()
    if (rows.length !== 1 || typeof rows[0].id !== 'string' || !rows[0].id || !['shadow', 'sqlite'].includes(String(rows[0].storage_mode))) throw bookModelSourceUnavailable()
    const project = rows[0]
    const storage: BookModelStorage = { mode: project.storage_mode === 'sqlite' ? 'sqlite' : 'files',
      schemaVersion: version, projectId: project.id as string, ready: false, contentHash: null, revision: null }
    const stamp = (ready: number | null, revision?: number, contentHash?: string) => modelSourceHash(JSON.stringify([version, project.id, project.storage_mode, ready, revision, contentHash]))
    if (version < 29) return { formal: false, fingerprint: snapshot.sourceFingerprint, documentFingerprint: stamp(null), storage }
    const ready = database.prepare('SELECT ai_settings_ready FROM projects WHERE id = ?').get(project.id!)?.ai_settings_ready
    if (ready !== 0 && ready !== 1) throw bookModelSourceUnavailable()
    const entries = database.prepare('SELECT revision, length(CAST(content_json AS BLOB)) AS content_bytes, content_hash FROM ai_settings_documents WHERE project_id = ? LIMIT 2').all(project.id!)
    if (ready === 0 || project.storage_mode === 'shadow') {
      if (entries.length || ready !== 0) throw bookModelSourceUnavailable()
      return { formal: false, fingerprint: snapshot.sourceFingerprint, documentFingerprint: stamp(ready), storage }
    }
    if (entries.length !== 1) throw bookModelSourceUnavailable()
    const entry = entries[0]
    if (typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision) || entry.revision < 1
      || typeof entry.content_bytes !== 'number' || entry.content_bytes < 1 || entry.content_bytes > MAX_MODEL_CONNECTION_BYTES) throw bookModelSourceUnavailable()
    const content = database.prepare('SELECT content_json FROM ai_settings_documents WHERE project_id = ?').get(project.id!)?.content_json
    if (typeof content !== 'string' || entry.content_hash !== modelSourceHash(content)) throw bookModelSourceUnavailable()
    const value: unknown = JSON.parse(content)
    return { formal: true, value, content, fingerprint: snapshot.sourceFingerprint, documentFingerprint: stamp(ready, entry.revision, entry.content_hash as string),
      storage: { ...storage, ready: true, contentHash: entry.content_hash as string, revision: entry.revision } }
  } finally { try { database?.close() } finally { snapshot.dispose() } }
}

export function modelSourceHash(value: string): string { return createHash('sha256').update(value).digest('hex') }
