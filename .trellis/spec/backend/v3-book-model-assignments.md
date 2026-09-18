# V3 captured-book model assignment saves

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` for private step 4b.2 only. Task `09-12-v3-global-model-connections` remains `in_progress`. No production main/IPC/UI/default initialization or author-book write is accepted here.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/book-model-assignments.ts`, `desktop/src/main/modules/models/application/book-model-assignments.ts`, `desktop/src/main/modules/models/adapters/book-model-assignment-store.ts` and the bounded model-save/snapshot/database/mirror seams they use. Reuses [portable documents](v3-book-model-settings.md), [read-only source snapshots](v3-book-model-resolution.md), the existing per-book write coordinator and atomic text writer. No new store, schema, network, secret getter or public DTO.

## 2. Signatures

```typescript
new BookModelAssignments(books, writer, globals /* list only */, currentScope)
read(): Promise<{ settings: BookModelSettings; revision: string;
  save(input: unknown): Promise<{
    settings: BookModelSettings; contentHash: string; revision: number | null;
    authority: 'files' | 'sqlite'; mirrorStatus: WorkspaceMirrorStatus | 'not-applicable';
    scope: { windowId: string; generation: number; bookIdentity: string }
  }> }>
applyBookModelAssignment(current, input): { settings: BookModelSettings; globalRevisions: Map<string, number> }
BookModelAssignmentWriter.save(source, settings, guard): Promise<BookModelAssignmentCommit>
// Optional narrow infrastructure entry; current existing formal database only.
WorkspaceDatabaseFactory.openModelSettingsWrite?(bookRoot): Promise<WorkspaceDatabasePort>
// Existing AI import/replace gain an optional fourth argument:
type WorkspaceAiSettingsWriteGuard = { projectId: string; revision: number | null; assertActive(): void }
atomicWriteText(path, content, beforeReplace?: () => Promise<void>, assertActive?: () => void): Promise<void>
```

The returned `save` closure is retained in main memory, never serialized. It owns one captured scope/source/baseline, not whatever book is current when a queue drains. Successful use consumes it; conflicts preserve caller input for an explicit reread/retry. Source snapshots additionally carry mode/schema/project/readiness/AI hash+revision and original file hash, not a writable database handle.

## 3. Contracts

- Input has only `routingMode`, `shared`, `tasks`, `globalReferences`, `globalRevisions`; at least one of the first four is present. Profiles are bounded partial patches of `connectionId/model/temperature/topP/maxTokens`. Validate every final active and inactive slot with the portable owner and enforce known active local budgets before publication.
- `globalReferences`, if present, explicitly replaces the global aliases with at most 100 `{id, globalConnectionId}` entries and converts the document to v4. Preserve private aliases/original IDs, other task parameters and copied `defaultRevision`. No private CRUD, diagnostic endpoint injection, key fields or default revision override. Omitting the list preserves existing aliases.
- Require exact `{id, revision}` evidence for all selected active global identities and newly attached/retargeted global aliases, even inactive new attachments. Existing inactive missing aliases can remain while a user repairs the active route. Local/private-only active saves with no new globals do not read the catalog.
- Validate selected global existence/enabled/revision and metadata on rechecks. Saving a keyless or OS-unavailable connection's assignment is allowed; it is not a credential/readiness/connectivity test. No decryption or app-store mutation.
- Capture trusted window/book generation before reads; recheck source, scope and references before queue work and publication. A→B→A is stale. All composed file/formal writers must share the same `WorkspaceWriteCoordinator` instance. File publication runs the asynchronous recheck and a final synchronous scope assertion on every rename retry.
- SQLite writes use only the current-schema, existing formal database entry; never `openExisting`/migration/create as a fallback. Before and inside the existing document transaction, check project, AI revision/hash and synchronous scope. An explicit first model save may import an unready current-schema document and its projection together. Historical schema SQL/checksums/general transaction behavior are unchanged.
- After acceptance, return the original book's committed document/hash/revision directly. Never reread the current book for feedback. Formal AI document, projection and mirror plan commit atomically; mirror publication/acknowledgement is a separate outcome. Post-commit scope/source drift leaves pending mirror work, external target changes yield conflict, mirror I/O/status/ack failures yield failed. Connection cleanup failure cannot undo a known accepted commit.
- The guarded AI mirror rechecks book identity, current formal hash/revision and external target hash before atomic replacement; synchronous scope check occurs immediately before rename. These checks do not claim an atomic cross-file CAS against uncooperative external processes. A check-to-OS-operation interval remains.
- Unknown writer errors become a safe storage error asking for reread/verification, without asserting rollback. Existing structured errors remain distinct. No raw path, provider body, key, ciphertext or stack is returned. Public integration must discard replies whose captured window/book generation no longer matches its view.

Production `ProjectAiService` setters and main's loose follow-up sync are unchanged and must be replaced in the later public integration. Do not infer that the author-facing settings screen now uses this capability. New-book defaults and actual writer/image guard retention remain subsequent gates.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid patch/alias/evidence/budget | `VALIDATION_ERROR`, no model publication |
| Stale source/scope/global revision, disabled/missing selected global | `CONFLICT`, no pre-commit model publication |
| Invalid source/readiness state | Existing safe source `STORAGE_ERROR`, no repair |
| Old SQLite schema or missing bounded writer | `FEATURE_UNAVAILABLE`, no automatic upgrade/fallback |
| Database vanished or project/revision changed | `CONFLICT` |
| Projection SQL failure | `STORAGE_ERROR`; document/projection/plan transaction rolls back |
| Unknown writer exception | Safe `STORAGE_ERROR`; reread to establish outcome |
| Formal accepted, mirror conflicts/fails or scope moves | Successful captured result plus `conflict` / `failed` / `pending` |

## 5. Good / Base / Bad Cases

- Good: read A, choose an existing global Gemini alias for prose, preserve private GPT outline slots, save A and report its authoritative revision separately from its mirror.
- Base: a local-only repair retains inactive unavailable references and copied default revision without consulting global credentials.
- Bad: resolve the current book inside a queued setter; throw a generic save failure after an accepted DB commit; use diagnostic address as provider authority.

## 6. Tests Required

`book-model-assignments.test.ts` uses real temporary files and SQLite: files/formal-ready/formal-unready/shadow roundtrip, private-slot/key/app/other-book/manuscript preservation, zero-write reads, input immutability, consumed capability, same-lane concurrency, queued switches, A→B→A/window/source/global drift, exact global evidence, local budgets, current-schema writer refusal, transaction rollback, late synchronous scope rejection, staged external edit, post-commit mirror conflict/switch/ack/cleanup failure and safe unknown errors. Assert the late mirror edit injection actually fired before accepting that test.

Retain source/global/reuse/document/atomic/queue/JSON regressions and existing SQLite/service/field/IPC checks. OS-dependent skips and existing unrelated failures must be reported, not weakened. Backend tests/builds are not Electron interaction or real API acceptance.

## 7. Wrong vs Correct

```typescript
// Wrong: both queued destination and feedback can drift to another book.
queue.run(async () => { await save(currentBook()); return read(currentBook()) })
// Correct: the private capability carries the original source and expected revision.
const edit = await assignments.read()
const result = await edit.save(patch)
// Future UI checks result.scope before applying feedback; mirrorStatus is independent.
```
