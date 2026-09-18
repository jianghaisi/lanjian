# V3 authority audit and external manuscript/outline recovery

> Status: verified-current for the narrow storage and IPC contracts below. Task: `09-12-v3-monster-girls-authority-repair`. Desktop recovery was exercised in an isolated Electron book; five reviewed author-book drafts were subsequently adopted through application services and re-read through a fresh Electron process. This is not whole-novel review or author UI acceptance. No schema migration is introduced.

## 1. Scope / Trigger

Use for completion audits and explicit recovery of externally edited Markdown in a SQLite-authoritative book. A readable mirror, nonempty body, confirmed current body and completed novel are different states. This does not promote all historical manuscript/planning code.

## 2. Signatures

- `npm run audit:book -- <project-root> [--expected-chapters N]`, backed by `auditBook(root, { expectedChapters? })` in `scripts/book-authority-audit.cjs`.
- `WorkspaceDatabaseFactory.openRecoveryReadOnly(root)` returns only `storageMode`, `formalOutlineReady`, `formalChapters`, `formalOutlines`, `readableMirrorPlans`, `close`. No write-capable fallback.
- `novelDesktop.chapters.previewExternalMirror(chapterId)` / `adoptExternalMirror(token)`.
- `novelDesktop.chapterOutlines.previewExternalMirror(chapterId)` / `adoptExternalMirror(token)`.
- Named IPC: `chapters:preview-external-mirror`, `chapters:adopt-external-mirror`, `chapter-outlines:preview-external-mirror`, `chapter-outlines:adopt-external-mirror`. Main derives paths from the current book and chapter; renderer never sends a file path.

## 3. Contracts

Preview uses `stableEventReadSnapshot` and a private SQLite connection with `readOnly`, `query_only`, validated schema and no migration or mirror acknowledgement. Opening the source SQLite directly with `readOnly` can still create WAL sidecars. Current recovery supports schema 39 through the application's current schema; older/unknown structures fail without upgrading. The read facade refactor retains existing event-read boundaries.

Preview authorization lives only in process memory for 15 minutes, binding the book root, chapter identity, current formal version and external hash. Adoption serializes book writes, rechecks authorization and expiration inside that operation and before commit, validates current book before committing, and appends exactly one `restore` version. Original versions remain readable. A used token is removed immediately after formal commit, before mirror synchronization. Neither body nor outline recovery confirms a chapter or settles facts.

Outline preview DTO: `{ token: UUIDv4, chapterId: positive integer, sqliteContent: string, externalContent: string, expiresAt: ISO date }`; each full text is bounded at 2,000,000 characters. Outline adoption DTO: `{ outline: PlannedChapterOutline, previousOutlineVersionId: string, importedExternalHash: SHA256, mirrorPending: boolean }`. The outline decoder is the existing `workflowIpcValueDecoders['outlines:get-planned-chapter']`; registering only TypeScript types is insufficient.

Body adoption keeps its prior DTO and adds optional `mirrorPending` for compatibility; the current implementation always returns a boolean. Database success with a mirror conflict/failure is successful formal recovery with `mirrorPending: true`, never an instruction to repeat adoption. If a reply is lost, re-read the current version/content/history before any fresh recovery request.

The public `ChapterRevision.id` is the existing 13-digit creation timestamp plus `-` plus the internal body-version UUID. Recovery receipts use the internal version ID. Readback checks must validate that public shape and compare its UUID component as well as the content hash; comparing the complete public ID directly to a body-version UUID falsely reports missing history. This does not change either contract.

Outline adoption retains current title, parent and sequence and updates content through the existing outline version method. The comparison panel shows complete texts, preserves unsaved author input, disables adoption while the outline draft is dirty, invalidates late results on book/target/unmount, and returns keyboard focus after cancellation. Body recovery preserves input added while adoption is pending and does not reload an unrelated unsaved outline.

The audit reports authority, schema, active/archived counts, nonempty current bodies, confirmed current bodies, empty/missing bodies, outline coverage and observed versus recorded mirror states. Trim BOM/whitespace for emptiness; count actual identities, not `440 - empty`. An archived missing mirror is separate from an active missing manuscript. `ok` measures storage/structural reconciliation; `completeNovel` is always `null` with an explicit semantic/author-review limitation. No model or credential access, formal confirmation, schema upgrade or mirror refresh occurs in an audit.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Preview content equals formal content | `CONFLICT`, no persistent write or implicit acknowledgement |
| Missing file/chapter, NUL or oversized content | Safe `NOT_FOUND` / `VALIDATION_ERROR`, no preview write |
| Unrecognized storage/schema, corrupt database, escaped path | Fail closed; no empty success or write-capable fallback |
| Wrong book, expired/replayed token, changed formal version or external hash | `CONFLICT`; no new manuscript/outline version |
| Formal commit succeeds but mirror changes/fails | Return committed version and `mirrorPending: true`; keep external bytes and consumed token |
| Malformed cross-process response | Result decoder rejects it before renderer use |
| Unsaved outline or late navigation result | Preserve draft; disable adoption or ignore obsolete response |

## 5. Good / Base / Bad Cases

- Good: 440 active chapters, 160 nonempty formal bodies, 3 external body drafts → report each count independently; prepare concrete comparisons before adoption.
- Base: a file-authority book remains a file-authority audit. Current confirmations are unknown rather than fabricated.
- Bad: count BOM as prose; treat a stale `synced` ledger as proof of matching files; import on preview; replay after mirror failure; infer novel completion from file counts.

## 6. Tests Required

- `node --test scripts/book-authority-audit.test.cjs`: formal versus external counts, BOM/whitespace, missing/duplicate/archived identities, unsupported/corrupt storage, containment, source bytes and directory entries unchanged.
- `sqlite-manuscript-service.test.ts`: preview source bytes including live WAL/SHM unchanged; old schema not upgraded; equal/invalid branches; version history; expiration; duplicate/concurrent token; changed book/formal/external source; committed mirror failure.
- `mirror-recovery-ipc.test.ts` and `ipc-boundary.test.ts`: actual result channel decoding and malformed DTO rejection.
- `event-read-boundary.test.ts`: shared private read facade retains no-write event guarantees.
- `workspace-backup-service.test.ts`: uncheckpointed formal data and externally changed body/outline survive backup and new-copy restore.
- `node scripts/mirror-recovery-smoke.mjs`: real Electron preview/cancel/adopt/restart, Chinese draft retention, keyboard focus, visible result plus formal records/history. Screenshots are reviewed separately; this is not OS IME or author visual acceptance.

## 7. Wrong vs Correct

Wrong: `withFormalMutation(root, db => { db.acknowledgeMirror(...); return preview })` — merely opening a comparison changes author storage.

Correct: read a validated private snapshot, return a memory token, then run an explicit version-bound adoption. Consume the token after formal commit even if the mirror remains pending. Keep the formal commit result distinct from mirror synchronization and from chapter confirmation.
