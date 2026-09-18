# V3 data authority and author safety

> Status: `verified-current`. Normative source: `docs/DATA-AUTHORITY-MATRIX.md`.

## 1. Scope / Trigger

Apply to every read, write, import, migration, candidate adoption, backup, restore, mirror, cache or settings change involving a novel project.

## 2. Authority interfaces

2026-09-18 作者已批准 `09-18-v3-file-first-manuscripts` 的正文/大纲文件权威设计，当前 implementation pending。成功迁移后的当前 Markdown 是正式文本；SQLite 只保存相关元数据/文件版本引用。下列 SQLite 内容/镜像条款仅适用旧内容模式和未改动的结构化模块。迁移未验证前不得切换真实作品；执行合同见该任务 design.md。新实现的具体接口和验证结果应随实现补入独立 spec，不能把目标标为 verified-current。

- Formally switched modules use `.webnovel/workspace.sqlite` as authority.
- Markdown/JSON are readable mirrors after formal commit, not a concurrent writable authority.
- 尚未切换的文件模式或明确未迁移模块只保留其经过验证的兼容权威。
- AI output, imports, recovery material and reports remain non-canon until an explicit, current, scoped adoption commits them.
- API credentials remain in the OS-protected application settings path and never enter project data, IPC output, logs or model context.

## 3. Contracts

- Preview and preflight are zero-write. A commit rechecks book, target, source fingerprint, expected revision and one-time authorization.
- Formal data commits before readable mirrors. Mirror failure becomes visible pending/conflict/failed state and never rolls back or overwrites committed author content.
- Accepted content evolves through append-only versions and provenance; restore creates a new version.
- Every path is project-relative after canonical containment validation. Unknown user files are preserved.
- Backup produces a verified new copy; restore publishes a new project copy and never overwrites the active book.
- Chapter deletion is recoverable inside the current work item. File authority writes a contained recovery snapshot before removing the readable manuscript file; SQLite authority archives the chapter and retains append-only body versions. The renderer receives only bounded deleted-chapter summaries. Restore rejects an active identity collision, preserves the trash item on failure, and re-enters the chapter through a new restore version or an exact recovery snapshot.

## 4. Failure behavior

On corruption, ambiguous identity, external mirror change, stale token, partial import or migration failure: stop writes, preserve exact evidence, return a safe recoverable state and require explicit review. Never convert failure into empty/default formal data.

## 5. Good / Base / Bad cases

- Good: zero-write preview → author confirms → identity/version recheck → database commit → mirror sync status.
- Base: file-mode book remains readable without an automatic migration.
- Bad: opening a book silently creates/migrates authority or a changed Markdown file overwrites SQLite.

## 6. Required verification

Use temporary isolated books. Assert source hashes and unrelated files before/after; test stale identity, stale revision, external conflict, mirror failure, interruption and recovery. Real author directories are never fixtures.

## 7. Candidate-code boundary

Current SQLite and mirror implementations may inform later V3-1 tasks, but their schemas, service names and old test counts are not promoted by this contract.

## 8. Scenario: rebind a path identity referenced by a registered mirror

### 8.1 Scope / Trigger

Apply when a migration changes a work-item path and a target file is present in `mirror_entries`. A registered Markdown/JSON file is derived state even when it contains an operational path field; it must not be patched independently from SQLite.

### 8.2 Signatures

- Authority document: `character_state_documents(project_id, revision, content_json, content_hash, updated_at)`.
- Project identity: `projects(id, prompt_work_item_id, ...)`.
- Mirror registration: `mirror_entries(project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, previous_relative_path, previous_observed_hash, updated_at)`.
- Migration plan must carry the original database/file hashes plus the exact updated authority bytes and generated mirror bytes.

### 8.3 Contracts

- Stop the application and create verified backups of both SQLite and every affected mirror before applying.
- `character_state_json`: change the path in `character_state_documents.content_json`, recompute its compact-content hash, increment `revision`, then generate the indented newline-terminated mirror from that committed document.
- `prompt_profile_json`: update the formal project/prompt identity first, then generate the readable mirror from that formal state.
- Update `source_version_id`, `content_hash`, `observed_hash`, `status` and error/previous fields together with the authority migration. `synced` is valid only when the planned mirror bytes hash to the registered `content_hash`.
- Stable project UUIDs, character payloads other than the scoped identity, chapter bodies and historical evidence remain unchanged.

### 8.4 Validation & Error Matrix

- Current file hash differs from registered `content_hash` before planning → `conflict`; preserve both sides and stop.
- Authority document hash is invalid or the expected old identity is absent → integrity failure; stop without writing.
- Registered mirror row is missing/ambiguous → conflict; do not downgrade the file to unregistered mode.
- Any database/file precondition changes between plan and apply → abort and restore the paired backups.
- Planned mirror hash equals the post-write registered hash → mark `synced`; otherwise leave a visible non-synced state.

### 8.5 Good / Base / Bad Cases

- Good: backup pair → validate old authority and mirror hashes → migrate SQLite authority → generate mirror → update registration → assert byte/hash equality.
- Base: an unregistered compatibility JSON may use its narrow schema adapter without mirror metadata updates.
- Bad: replace only `characters.json.workItemId`, or set `mirror_entries.status = 'synced'` without migrating the formal document and verifying the file bytes.

### 8.6 Tests Required

- A temporary formal project with registered prompt/character mirrors; assert the character revision increments once and only `workItemId` changes.
- Assert `character_state_documents.content_hash` matches `content_json` and every updated mirror file hash equals `content_hash = observed_hash = source_version_id` with `status = 'synced'`.
- Assert unregistered JSON behavior remains supported, and registered-hash mismatch aborts before any write.
- Real-data repair validation may report counts and hashes, but must not print author content.

### 8.7 Wrong vs Correct

```typescript
// Wrong: edits derived state and leaves SQLite + mirror_entries stale.
mirror.workItemId = migratedPath
await writeFile(charactersPath, JSON.stringify(mirror))

// Correct: migrate the formal document, derive exact mirror bytes, then
// update the registration and file as one backed-up migration unit.
const migrated = migrateCharacterAuthority(document, migratedPath)
const mirrorBytes = renderCharacterMirror(migrated)
assert(hash(mirrorBytes) === plannedMirrorHash)
```

## 9. Scenario: explicit local library root discovery

### 9.1 Scope / Trigger

Apply when migration or author configuration identifies one local directory as the application's works library. This is bounded project discovery, not permission to scan arbitrary disks.

### 9.2 Signatures

- `settings.json.libraryRoot: string | null`: canonical absolute directory explicitly supplied by migration/configuration.
- `settings.json.recentProjects: string[]`: individually registered projects, including projects outside the library root.
- `settings.json.excludedProjects: string[]`: canonical project paths the author removed from the visible shelf without deleting files.
- `ProjectService.list(): Promise<{ projects: ProjectSummary[]; continueProjectId: string | null }>`: merges registered projects with recognized direct children of `libraryRoot`, deduplicated by canonical path.

### 9.3 Contracts

- Enumerate only direct child directories of the canonical `libraryRoot`; never recurse, search drives, infer from titles or follow a child junction outside the root.
- A direct child is a project candidate only when it contains at least one existing project marker: `.webnovel`, `正文` or `大纲`.
- Merge root projects with individually registered external projects. Preserve registered shelf order first, then append undiscovered root children deterministically.
- Skip `excludedProjects`; opening/importing that exact project clears its exclusion. Removing a project from the shelf adds the exclusion so the next root scan cannot silently restore it.
- Listing is read-only for author projects. It does not create manifests, migrate storage or write discovered paths into settings.

### 9.4 Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `libraryRoot` absent in old settings | Use registered-project behavior only |
| root exists and contains recognized direct children | Merge and deduplicate them with registered external projects |
| ordinary/material-only child | Ignore it without changing files |
| configured root missing or unreadable | Safe recoverable `STORAGE_ERROR`; never return a shorter successful shelf |
| child resolves outside root or remains unreadable | Fail safely; do not follow or hide it as a complete result |
| project is explicitly removed from shelf | Persist exact exclusion; leave project files unchanged |

### 9.5 Good / Base / Bad Cases

- Good: one explicit `作品` root contains three formal projects and a materials folder; all three projects appear, materials do not, and one separately imported external project is also shown.
- Base: legacy settings have no `libraryRoot`; only their registered projects are listed.
- Bad: recursively scan `G:\`, treat folder names as project proof, mutate projects while listing, or silently return one project when the configured root cannot be read.

### 9.6 Tests Required

- Temporary-root integration: recognized siblings are discovered, registered external projects merge, canonical duplicates appear once and ordinary folders stay hidden.
- Exclusion: removing a root project keeps it hidden on the next list; importing/opening the same project clears exclusion.
- Failure: missing root and unreadable child return a safe recoverable error without absolute-path leakage.
- Migration: dry-run reports the settings mutation; apply stores canonical `libraryRoot`, initializes `excludedProjects`, creates a verified backup and leaves project databases/manuscripts untouched.

### 9.7 Wrong vs Correct

```typescript
// Wrong: visibility depends on every book retaining an individual historical path.
for (const path of settings.recentProjects) await readProject(path)

// Correct: scan only the explicitly configured root, then merge external registrations.
const rootProjects = settings.libraryRoot ? await directRecognizedChildren(settings.libraryRoot) : []
return mergeByCanonicalPath(settings.recentProjects, rootProjects)
```
