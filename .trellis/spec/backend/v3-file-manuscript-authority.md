# V3 file-authoritative manuscripts and outlines

> Status: `implementation-current`; isolated and author-book migrations plus automated checks passed. User-visible desktop acceptance remains the explicit final gate.

## 1. Scope / Trigger

Apply when creating, opening, saving, autosaving, migrating, restoring, backing up or indexing chapter-body and outline text. It does not change SQLite authority for identities, order, workflow state, facts, events, settings, task provenance or other structured modules.

## 2. Signatures

- `projects.text_authority: 'legacy-sqlite' | 'files-v1'` selects the text authority independently of `projects.storage_mode`.
- `WorkspaceDatabasePort.formalChapterIds(): number[]` returns ordered active identities without loading manuscript bodies.
- `WorkspaceDatabasePort.pendingMirrorPlans(filter?: WorkspaceMirrorPlanFilter)` and `readableMirrorPlans(filter?: WorkspaceMirrorPlanFilter)` accept `sourceTypes`, `excludeSourceTypes`, `sourceId`, `sourceVersionId`, `legacyChapterId` and `statuses`; filtering is executed in SQL before plan content is materialized.
- Current body/outline text lives in contained Markdown files registered by `manuscript_file_heads`. Immutable historical text lives under `.webnovel/history/text/<sha256>.md` and is referenced by `manuscript_text_objects`.
- `body_versions`, `outline_versions`, `outline_nodes`, `autosave_checkpoints` and `document_chunks` retain identity/hash/range/provenance metadata in file mode; their `content` column must be empty.

## 3. Contracts

- New books use `files-v1`. Existing `legacy-sqlite` books remain readable until the explicit export, hash verification, backup and mode-commit migration completes.
- A current-text save validates the expected file revision, atomically replaces only the target Markdown, then commits metadata through the durable manuscript operation journal. If metadata commit is interrupted, reopen replays that exact authorized operation; it never restores older SQLite prose over the newer file.
- Autosave makes the current file immediately readable, retains a bounded temporary history object and finalizes to one append-only formal version. A stale autosave window cannot replace a newer current file.
- Missing or invalid current files fail closed. Ordinary open never reconstructs them from SQLite/history and never returns empty text. Historical restore is explicit and creates a new current version.
- Workspace open may materialize each current body/outline once for the returned projection. Mirror synchronization, order calculation and outline/chapter joins must query only required source types or metadata; they must not read unrelated current/history text and filter afterward.
- Single-document saves use point lookup. Reorder/archive/restore/order mirrors use `formalChapterIds()` or equivalent metadata-only SQL.
- Old body/outline `mirror_entries` are compatibility/history metadata in `files-v1`; they are not write grants. General retry/rebuild/status flows exclude `chapter_markdown` and `outline_markdown` before materialization.
- Renderer and preload receive validated DTOs only; they never receive absolute paths, SQL, raw journal payloads or filesystem authority.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Current file hash/title changed since read | recoverable `CONFLICT`; preserve both current bytes and pending edit |
| Current file missing/invalid UTF-8/path escapes root | integrity/storage error; no SQLite fallback and no empty manuscript |
| File replace succeeds but metadata commit fails | keep the new file and durable receipt; replay exact metadata on reopen |
| Metadata/file reference points to missing or hash-mismatched history | `DATABASE_INTEGRITY_FAILED`; do not skip the version |
| Unknown schema-41 variant or missing schema guard | refuse upgrade; preserve database and files |
| Mirror-plan caller requests a bounded source type | SQL must omit unrelated rows before `readStoredText`/derived content runs |
| `files-v1` retry/status sees old body/outline pending mirrors | ignore them as current synchronization work; do not scan or overwrite text |
| Migration source changes after preview/export | abort before authority switch; keep verified backup and original mode |

## 5. Good / Base / Bad Cases

- Good: open a 440-chapter migrated book, read each current body/outline once, resolve order and structured mirrors from metadata-filtered queries, then edit one chapter with only that file and its metadata operation touched.
- Base: an unmigrated `legacy-sqlite` book continues through its old authority adapter without a silent open-time migration.
- Bad: call `readableMirrorPlans()` for every structured setting, materialize all body/outline history, then discard those plans in TypeScript; or compute chapter order by loading full bodies.

## 6. Tests Required

- Temporary-book migration: compare every current, archived, history and checkpoint hash; assert SQLite text columns are empty and all file references resolve.
- Failure injection: replace-before-metadata interruption, mode-commit interruption, stale file, missing current file, missing history object, unknown schema variant and repeat migration.
- Hot path: single manual/autosave save must not call `formalChapters()`; filtered mirror-plan reads must succeed even when an unrelated history object is unavailable, while selecting the damaged text plan still fails.
- Large isolated rehearsal: include a 400+ chapter book, restart/reopen, edit/autosave/finalize/restore, and record open/save latency without using an author directory as a write fixture.
- Desktop gate: launch with the normal `npm run desktop:dev`, auto-enter after loading, keep the Continue Writing landing view, preserve the full discovered library after restart, and open the large work without indefinite loading.

## 7. Wrong vs Correct

```ts
// Wrong: materializes every pending body/outline/history plan, then filters.
for (const plan of database.pendingMirrorPlans()) {
  if (!wantedTypes.includes(plan.sourceType)) continue
  await sync(plan)
}

// Correct: SQL selects only the required structured plans before content work.
for (const plan of database.pendingMirrorPlans({
  sourceTypes: wantedTypes,
  excludeSourceTypes: database.textAuthority() === 'files-v1'
    ? ['chapter_markdown', 'outline_markdown']
    : []
})) await sync(plan)

// Wrong: loads every正文 merely to generate the order file.
const ids = database.formalChapters().map(chapter => chapter.legacyChapterId)

// Correct: metadata-only ordered identity projection.
const ids = database.formalChapterIds()
```
