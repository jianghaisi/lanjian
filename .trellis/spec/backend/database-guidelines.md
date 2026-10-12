> V3 status: `candidate-for-v3`. Historical V1/V2 implementation detail; not an active V3 contract. Use `v3-data-safety.md` unless a later V3 task explicitly promotes a narrower rule.

# Local persistence

- Authority is selected by the validated per-project storage mode and each migrated module's readiness gate. In SQLite formal mode, migrated data is authoritative in `.webnovel/workspace.sqlite`; Markdown/JSON are readable mirrors, not a second writable authority. File/shadow mode and explicitly unimported legacy modules retain their existing file source until a validated transition. See `docs/V2-DATA-AUTHORITY-MATRIX.md` for file roles.
- Application settings live under Electron `userData`; API keys use `safeStorage`.
- Derived search indexes, summaries and caches must be rebuildable.
- File writes validate data, write a sibling temporary file, close it, then atomically replace the target. SQLite formal writes commit their data/version/mirror plan transaction first, then synchronize files; mirror failure or external edits must not reverse or silently replace the committed formal data.
- In formal mode, a content change appends a revision and advances the current pointer atomically. Restore appends a new revision rather than overwriting history. File compatibility mode preserves its existing revision-before-replacement protocol.
- Project migrations are previewable, backed up, versioned and idempotent.
- Unknown user files are preserved. Never reorganize or delete them silently.
- All paths originate from a validated ProjectRoot and pass containment plus symlink-escape checks.
- User-requested deletion uses the OS recycle bin, not permanent unlink, unless the UI explicitly says otherwise.

## Scenario: SQLite shadow bridge before source-of-truth cutover

### 1. Scope / Trigger

- Trigger: introduce the per-book SQLite schema and prove legacy Markdown/JSON import safety before any normal open/save flow changes ownership.
- During this shadow stage, existing Markdown and JSON remain authoritative. SQLite is created only by an explicit preview/import operation and must not be opened by the ordinary workspace composition.

### 2. Signatures

```ts
interface LegacyWorkspaceSource {
  snapshot(): Promise<LegacyWorkspaceSnapshot>
}

interface WorkspaceDatabaseFactory {
  open(workItemId: string): Promise<WorkspaceDatabasePort>
}

class ShadowImportService {
  preview(): Promise<ShadowImportPreview>
  import(preview: ShadowImportPreview): Promise<ShadowImportResult>
}

class ShadowMigrationSessionService {
  preview(): Promise<SqliteShadowMigrationPreview>
  commit(token: string): Promise<SqliteShadowMigrationResult>
  clear(): void
}
```

- Database path: `<ProjectRoot>/.webnovel/workspace.sqlite`.
- Schema v1 tables: `schema_migrations`, `projects`, `chapters`, `body_versions`, `mirror_entries`, `write_operations`, `shadow_imports`.
- `body_versions` is append-only at both the application boundary and the database boundary; `body_versions_no_update` and `body_versions_no_delete` triggers are required schema objects.

### 3. Contracts

- The internal application `preview()` reads and validates the selected work item, returns target path, source fingerprint, chapter/word counts and blockers, and performs zero filesystem writes.
- Production renderer receives no fingerprint: `projects:sqlite-shadow-preview` returns a UUID token, relative target, counts, expiry and blockers. The token lasts 15 minutes, is consumed before import, is limited to three pending previews and is cleared on work-item change.
- `projects:sqlite-shadow-import` accepts exactly that UUID token. It rejects expiry, replay and cross-book reuse before opening SQLite; renderer never submits prose, hashes, absolute paths or SQL.
- `import(preview)` re-reads the entire source and rejects a stale fingerprint before opening SQLite.
- Import retains exact chapter text, stable legacy chapter IDs, logical order and canonical `正文/...md` mirror paths. It never rewrites, upgrades, renames or deletes source files.
- Import idempotency uses the source fingerprint plus current SQLite projection fingerprint. Repeating unchanged input appends zero versions; a real content change appends exactly one version for each changed chapter.
- The database runs only in Electron main/infrastructure code with `node:sqlite`, `foreign_keys=ON`, WAL and extension loading disabled. Renderer code never imports a SQLite driver.
- This section describes the historical shadow-stage boundary, not a prohibition on the implemented formal mode. Production cutover remains a separate explicit operation requiring user-visible preview, backup/rollback UX, mirror write-back and an ownership switch to `storage_mode='sqlite'`; its current contracts are documented under “SQLite-authoritative manuscript with readable mirrors” below.

### 4. Validation & Error Matrix

- malformed/duplicate chapter identity or order -> preview blocker `INVALID_PROJECT_STATE`; no database is created
- ambiguous legacy project identity -> preview blocker `CONFLICT`; no implicit migration or repair
- contained path or symlink/junction escape -> `PATH_ESCAPE`; nothing is written outside ProjectRoot
- preview/source mismatch -> `CONFLICT` before database open
- malformed token -> IPC `VALIDATION_ERROR`; expired, replayed or cross-book token -> `CONFLICT` before database open
- missing/altered schema migration or append-only trigger -> `DATABASE_MIGRATION_FAILED`; pre-existing database bytes are preserved
- failed `quick_check`, foreign key check or semantic projection verification -> `DATABASE_INTEGRITY_FAILED`; never fall back silently to partial SQLite data
- unexpected transaction failure -> rollback and `STORAGE_ERROR`; Markdown/JSON bytes remain unchanged

### 5. Good/Base/Bad Cases

- Good: preview two chapters without creating files, explicitly import, verify exact text, repeat with zero new versions, then append one version after editing one chapter.
- Base: delete only the disposable shadow database and reopen the unchanged legacy work item through the existing Markdown/JSON services.
- Bad: create SQLite during ordinary project open, treat partial imports as authoritative, or rewrite source files to make a failed import appear successful.

### 6. Tests Required

- Integration: hash every non-database project file before/after preview and import; assert byte-for-byte equality.
- Integration: assert schema version, required tables/triggers, WAL, foreign keys, exact titles/content/order and mirror paths.
- Integration: repeat unchanged import and assert zero appended versions; change one chapter and assert only its version count increments.
- Invariant: direct `UPDATE` and `DELETE` against `body_versions` fail with the append-only trigger.
- Regression: stale preview, damaged ledger, duplicate identity, ambiguous legacy identity and damaged pre-existing database all fail closed.
- Security: a `.webnovel` symlink/junction outside ProjectRoot is rejected and creates no outside database file.
- IPC/session: UUID-only decoder, no fingerprint in public preview, one-shot replay rejection, expiry and work-item switch rejection.
- Electron E2E: open from full-width Project Data settings, assert no assistant panel and unchanged workbench width, capture the centered review dialog, confirm import and verify a SQLite file header.

### 7. Wrong vs Correct

```ts
// Wrong: opening/creating SQLite before checking that the preview still describes the source.
const database = await databases.open(projectRoot)
const snapshot = await source.snapshot()
return database.importSnapshot(snapshot)

// Correct: validate twice, then create a disposable shadow projection.
const preview = await shadowImport.preview()
const snapshot = await source.snapshot()
if (snapshot.sourceFingerprint !== preview.sourceFingerprint) throw stalePreview()
const database = await databases.open(snapshot.workItemId)
return database.importSnapshot(snapshot)
```

## Scenario: consistency overview as a read-only projection

### 1. Scope / Trigger

- Trigger: UI or generation controls need one explanation of total/volume/chapter freshness, event placement and ChapterContract readiness.

### 2. Signatures

```ts
consistencyOverview(chapterId?: number): Promise<ConsistencyOverview>
buildConsistencyOverview(input: {
  workflow: WorkflowStatus
  planning: OutlinePlanningStatus
  chapterId?: number
  chapterPosition?: number
}): ConsistencyOverview
```

### 3. Contracts

- The overview is a pure projection over existing validated sources. It never owns a JSON ledger and never writes project files.
- `ready`, `attention` and `blocked` derive from planning revisions, approvals and contract fingerprints in main/domain code; renderer only displays the DTO.
- `deferred` means not applicable or not implemented. It does not block existing flows, but the UI must state that the dimension was not checked.
- Each item retains its target fact source and optional revision/fingerprint so the UI can navigate without inventing a second state.

### 4. Validation & Error Matrix

- malformed planning ledger -> existing `INVALID_PROJECT_STATE`; do not return a partial green overview
- no selected chapter -> chapter/contract items are `deferred`, not `ready`
- missing/stale confirmed dependency -> `blocked` with a concrete issue
- unavailable future character-state projection -> `deferred`; never claim character consistency passed

### 5. Good/Base/Bad Cases

- Good: a stale total outline identifies the total, chapter-outline and contract layers separately and links to planning.
- Base: a short work with no volume leaves volume `deferred` while a confirmed total + chapter contract can remain prose-ready.
- Bad: persist `consistency-status.json`, allow it to drift from `outline-state.json`, then show a stale green badge.

### 6. Tests Required

- Unit: confirmed dependencies project to ready; stale upstream returns named blockers; deferred character state never becomes ready.
- Integration: Workspace projection retains current chapter position and ChapterContract fingerprint.
- Electron E2E: render all layers, assert unimplemented copy, click a layer and reach its unique fact source.

### 7. Wrong vs Correct

```ts
// Wrong: a second writable truth that can outlive the revisions it summarizes.
await writeJson('consistency-status.json', rendererCalculatedStatus)

// Correct: validated ledgers are projected on demand by the data owner.
return buildConsistencyOverview({ workflow, planning, chapterId, chapterPosition })
```

## Scenario: versioned planning ledgers with concurrent UI mutations

### 1. Scope / Trigger

- Trigger: a project JSON ledger can be mutated by more than one IPC action, or its revision controls downstream writing gates.

### 2. Signatures

```ts
status(chapterId?: number): Promise<OutlinePlanningStatus>
assignEvent(eventId: string): Promise<OutlinePlanningStatus>
unassignEvent(eventId: string): Promise<OutlinePlanningStatus>
updateOutline(volume: OutlineVolume, content: string): Promise<OutlineUpdateResult>
updateChapterOutline(chapterId: number, content: string): Promise<ChapterOutline>
```

### 3. Contracts

- `.webnovel/planning/outline-state.json` stores `version`, total-outline `revision/hash`, event assignments and each chapter's `basedOnTotalRevision/outlineHash`.
- Event assignment accepts only an existing `approved` event. Candidate events never become outline facts.
- Mutations of one ledger are serialized in the owning service. Read-modify-write calls must not run concurrently against the same in-memory service instance.
- Existing total/章纲 files without a ledger form revision 1 as a compatibility baseline; a real later change increments the revision.

### 4. Validation & Error Matrix

- missing event -> `NOT_FOUND`
- candidate event -> `CONFLICT`
- malformed or invalid ledger JSON -> `INVALID_PROJECT_STATE`, no document write
- total hash differs from ledger -> report `externalChangeDetected=true`, increment the effective revision and mark dependent chapter outlines stale

### 5. Good/Base/Bad Cases

- Good: two approved events assigned concurrently both remain in the ledger.
- Base: an unchanged legacy book opens with its existing chapter outline still valid.
- Bad: parsing failure falls back to an empty ledger and the next save silently erases assignments.

### 6. Tests Required

- Integration: concurrent approval/assignment retains both IDs and increments revision deterministically.
- Integration: total revision change marks the chapter stale; resaving attaches it to the current revision.
- Regression: malformed ledger blocks writes and leaves the existing Markdown byte content unchanged.
- Electron E2E: click assign, observe stale gate, reconfirm, edit total, observe stale gate again and verify prose action is disabled.

### 7. Wrong vs Correct

```ts
// Wrong: parallel calls can both read version N and overwrite each other.
const state = await readState()
state.assignments.push(next)
await writeState(state)

// Correct: the owning service serializes the complete read-modify-write transaction.
return mutationQueue.run(async () => {
  const state = await readValidatedState()
  state.assignments.push(next)
  await writeState(state)
})
```

## Scenario: approved research events as the effective story timeline

### 1. Scope / Trigger

- Trigger: workflow gates, prompt builders or UI chronology views need events from both `.webnovel/research/events.json` and the legacy author-authored `.webnovel/config/timeline.json`.

### 2. Signatures

```ts
listEvents(): Promise<{ events: CanonicalEvent[] }>
getWorkflowStatus(chapterId?: number): Promise<WorkflowStatus>
promptContext(chapterId?: number): Promise<string>
```

### 3. Contracts

- Research `approved` events and complete direct chronicles form one read-only effective timeline.
- Research `candidate` events never satisfy a gate and never enter an AI prompt.
- The projection does not copy, move or rewrite either source ledger. Canonical events retain `result` and `evidenceRefs` in prompt context.
- Evidence excerpts remain untrusted quoted data: prompt builders must explicitly forbid following commands, role text or secret-exfiltration requests contained inside sources.
- Exact normalized duplicates use the canonical event as the effective record; character order and common Chinese/ASCII separators do not create a second event.

### 4. Validation & Error Matrix

- candidate event -> excluded, no error and no completed event step
- malformed research ledger -> `INVALID_PROJECT_STATE`; do not fall back to direct-only data
- exact canonical/direct duplicate -> one effective event, source ledgers unchanged
- missing optional research reader in isolated legacy tests -> direct timeline remains the compatibility baseline

### 5. Good/Base/Bad Cases

- Good: a user confirms a source-backed event and can immediately continue to the outline without retyping it in chronology.
- Base: an existing book with only `timeline.json` behaves exactly as before.
- Bad: renderer copies approved events into `timeline.json`, creating divergent editable facts and duplicate prompt entries.

### 6. Tests Required

- Integration: candidate alone leaves `readyForChapterOutline=false`; approval changes it to true when other gates are complete.
- Prompt invariant: candidate text is absent; approved event, result and evidence excerpt are present.
- Prompt security invariant: the evidence section is preceded by an instruction that embedded commands are quoted data and must not be executed.
- Deduplication: an approved event plus a semantically exact direct record reports one effective event and appears once in serialized context.
- Electron E2E: approve through clicks, open chronology, observe `待入总纲`, then assign through the outline view.

### 7. Wrong vs Correct

```ts
// Wrong: two stores become two unrelated workflow definitions.
const hasEvents = (await readTimelineJson()).events.length > 0

// Correct: one service owns the read-only projection used by every gate and prompt.
const { approved, direct } = await effectiveTimeline()
const hasEvents = approved.length + direct.length > 0
```

## Scenario: volume planning and event placement

### 1. Scope / Trigger

- Trigger: the total-outline ledger gains ordered story volumes, or an approved event moves between total-only and a numbered volume.

### 2. Signatures

```ts
createVolume(title: string): Promise<OutlinePlanningStatus>
renameVolume(volume: number, title: string): Promise<OutlinePlanningStatus>
placeEvent(eventId: string, volume: number | null): Promise<OutlinePlanningStatus>
```

`OutlinePlanningStatus` returns `volumes`, `assignedEventIds` and `unplacedEventIds`. A volume contains stable `volume`, editable `title`, `eventIds` and `origin`.

### 3. Contracts

- `.webnovel/planning/outline-state.json` keeps optional-compatible `volumes[]`; legacy version-1 ledgers without the field normalize to an empty array.
- Existing `第N卷-*.md` files are read-only projected as `origin: existing-outline`; projection never rewrites their Markdown. Renaming materializes only ledger metadata.
- New volume numbers are `max(existing files, planned volumes) + 1`; all create/rename/place mutations use the planning service's single serialization queue.
- Placing an approved event into a volume also includes it in the total outline. `volume=null` removes only its volume placement; removing it from total also clears every volume reference.
- Any real structural change advances the total revision so dependent chapter outlines become stale. Idempotent create-name checks and unchanged placements do not advance it.

### 4. Validation & Error Matrix

- empty or >120-character title -> `VALIDATION_ERROR`
- volume outside 1–1000 -> `VALIDATION_ERROR`
- duplicate normalized title -> `CONFLICT`
- missing target volume/event -> `NOT_FOUND`
- candidate event -> `CONFLICT`
- malformed/duplicate stored volume numbers -> `INVALID_PROJECT_STATE`, no write
- duplicate cross-volume event ID or a volume event absent from total assignments -> `INVALID_PROJECT_STATE`, no write

### 5. Good/Base/Bad Cases

- Good: create two volumes concurrently, receive unique ordered numbers, then move one approved event between them without duplicate total assignments.
- Base: an existing book with `第1卷-大纲.md` and no volume ledger displays that volume and preserves its exact text when renamed in planning metadata.
- Bad: renderer invents volume grouping locally, or placing an event copies its prose into a volume Markdown file.

### 6. Tests Required

- IPC: bounded titles, volume range, UUID and nullable placement decode at the boundary.
- Integration: concurrent volume creation, duplicate-name rejection, candidate rejection, move/unplace idempotency and total revision propagation.
- Compatibility: legacy ledger without `volumes` and existing volume-outline projection both open; rename leaves Markdown bytes unchanged.
- Prompt invariant: volume title and placed event ID appear in context.
- Electron E2E: type a volume title, click create, select that volume for an approved event, observe stale chapter gate and recover by saving.

### 7. Wrong vs Correct

```ts
// Wrong: two UI calls race, both choose max + 1, and one volume disappears.
const volume = Math.max(...state.volumes.map((item) => item.volume)) + 1
await save({ ...state, volumes: [...state.volumes, next(volume)] })

// Correct: number allocation and atomic ledger replacement share one mutation queue.
return serialize(async () => {
  const state = await readValidatedState()
  const effective = await effectiveVolumes(state)
  state.volumes.push(next(Math.max(0, ...effective.map((item) => item.volume)) + 1))
  await saveState(state)
})
```

## Scenario: volume outline revisions and chapter placement

### 1. Scope / Trigger

- Trigger: a numbered volume outline becomes editable, or a chapter is assigned to a volume whose outline must participate in the chapter's freshness gate.

### 2. Signatures

```ts
updateOutline(volume: number, content: string): Promise<OutlineUpdateResult>
placeChapter(chapterId: number, volume: number | null): Promise<OutlinePlanningStatus>
chapterVolumeContext(chapterId: number): Promise<{ volume: number; title: string; content: string } | null>
```

### 3. Contracts

- Each stored volume keeps `revision` and `outlineHash`; old version-1 ledgers without them normalize to revision 0 and an empty-content hash.
- `chapterPlacements[]` owns chapter-to-volume structure independently of whether that chapter already has an outline. A chapter has at most one placement.
- A chapter dependency snapshots `volume`, `basedOnVolumeRevision`, `basedOnTotalRevision` and its own outline hash when the author saves the chapter outline.
- Editing one volume advances only that volume revision. It invalidates chapter outlines placed in that volume, not unrelated volumes.
- External Markdown edits are never overwritten during status checks. A hash mismatch projects the next effective revision and marks dependent chapters stale.
- Prompt context includes the selected chapter's actual volume-outline Markdown; an unplaced chapter receives an explicit “尚未归卷” boundary.

### 4. Validation & Error Matrix

- chapter/volume outside the bounded integer range -> `VALIDATION_ERROR` at IPC
- missing manuscript chapter or target volume -> `NOT_FOUND`
- stored duplicate chapter placements/dependencies -> `INVALID_PROJECT_STATE`, no write
- placement references a missing volume during chapter-outline save -> `INVALID_PROJECT_STATE`, no Markdown write
- malformed revision/hash fields -> `INVALID_PROJECT_STATE`, no fallback to an empty ledger

### 5. Good/Base/Bad Cases

- Good: chapters 1 and 2 belong to different volumes; editing volume 1 stales chapter 1 while chapter 2 remains current.
- Base: a legacy `第1卷-大纲.md` begins at virtual revision 1 and is materialized only on an explicit planning write.
- Bad: reuse the global total revision for volume text edits, which unnecessarily invalidates every chapter in the book.

### 6. Tests Required

- IPC: nullable chapter placement accepts only bounded chapter and volume numbers.
- Integration: save two volume outlines, place two chapters, edit one volume and assert scoped staleness.
- Compatibility: old ledgers without volume revision fields remain readable.
- External edit: changing a volume Markdown file outside the app reports `externalChangeDetected` and blocks only dependent prose.
- Prompt invariant: the selected chapter receives its volume title and exact volume outline; another volume is not substituted.
- Electron E2E: write/save a volume outline, assign the current chapter, reconfirm, edit the volume, observe the prose gate, and reconfirm again.

### 7. Wrong vs Correct

```ts
// Wrong: every volume edit invalidates the whole book.
bumpTotalRevision(state)

// Correct: version the edited volume and compare only its placed chapters.
volume.revision += 1
chapter.stale = chapter.volume === volume.volume
  && chapter.basedOnVolumeRevision !== volume.revision
```

## Scenario: canonical events referenced by a chapter contract

### 1. Scope / Trigger

- Trigger: an approved canonical event is assigned below a volume, to a concrete manuscript chapter and its `ChapterContract`.

### 2. Signatures

```ts
placeEventInChapter(eventId: string, chapterId: number): Promise<OutlinePlanningStatus>
chapterEvents(chapterId: number): Promise<CanonicalEvent[]>
buildChapterContract(chapterId: number, outline: string, assignedEvents?: CanonicalEvent[]): ChapterContract
```

### 3. Contracts

- `eventChapterPlacements[]` stores `{eventId, chapterId, assignedAt, updatedAt}`. One event has at most one chapter; its chapter must have a volume placement.
- Chapter placement implies total and matching-volume placement for the event. Moving the chapter moves linked events; unplacing it clears chapter links but keeps events total-only.
- `OutlinePlanningStatus` exposes only `{eventId, chapterId}`. Renderer does not own a second mapping.
- Assigned events enter prompt context and compile to beats carrying `eventRef`. An unmatched event becomes a required beat instead of being silently omitted.

### 4. Validation & Error Matrix

- malformed event UUID/chapter number -> `VALIDATION_ERROR` at IPC
- candidate event -> `CONFLICT`
- missing event/chapter -> `NOT_FOUND`
- chapter without volume -> `CONFLICT`
- duplicate, orphan or cross-volume placement -> `INVALID_PROJECT_STATE`, no write

### 5. Good/Base/Bad Cases

- Good: one location select assigns an approved event to chapter 3; its ID is visible in status, prompt and contract.
- Base: old ledgers without `eventChapterPlacements` normalize to an empty list.
- Bad: UI says “第 3 章” while the prompt/contract only receives the volume event list.

### 6. Tests Required

- IPC rejects malformed IDs and accepts a bounded chapter.
- Integration rejects candidates and unplaced chapters; chapter move/unplace preserves hierarchy invariants.
- Contract regression proves a missing `eventRef` beat keeps `passed=false` even if the model claims success.
- Electron E2E clicks the real select option and observes “已入第 N 章契约” plus chapter-outline staleness.

### 7. Wrong vs Correct

```ts
// Wrong: renderer-only state never reaches the prose gate.
ui.eventChapter[eventId] = chapterId

// Correct: one validated projection feeds UI, prompt and contract.
await planning.placeEventInChapter(eventId, chapterId)
const contract = buildChapterContract(chapterId, outline, await planning.chapterEvents(chapterId))
```

## Scenario: non-destructive logical chapter ordering

### 1. Scope / Trigger

- Trigger: the author changes a chapter's visible order while manuscript files, outline references and revision history already use its numeric ID.

### 2. Signatures

```ts
type Chapter = { id: number; position: number; title: string; content: string; word_count: number; summary: string }
reorderChapter(chapterId: number, position: number): Promise<Chapter[]>
decodeChapterReorderArgs(args: unknown[]): [number, number]
```

### 3. Contracts

- `.webnovel/manuscript/chapter-order.json` is `{version: 1, chapterIds: number[]}` and records stable IDs in visible order.
- `id` addresses `正文/第{id}章-*.md`, `大纲/章纲/第{id}章.md`, planning references and `.webnovel/history/chapters/{id}`; `position` is a one-based projection for UI and AI wording.
- A missing ledger is a compatible base case: physical chapter IDs sort numerically and no file is written during read.
- Ledger IDs whose manuscript file was removed are ignored on projection; new physical IDs not yet recorded append in numeric order. Only an explicit reorder materializes the ledger.
- Writes are serialized and atomically replace only the order ledger. Reordering never renames, swaps or rewrites manuscript/outline/history files.

### 4. Validation & Error Matrix

- non-integer/out-of-range `chapterId` or `position` -> `VALIDATION_ERROR` at IPC.
- existing chapter with `position > chapter count` -> `VALIDATION_ERROR`, no ledger write.
- missing chapter -> `NOT_FOUND`.
- malformed JSON, wrong version, duplicate/invalid IDs -> `INVALID_PROJECT_STATE`, no fallback and no manuscript write.
- duplicate physical chapter numbers -> `INVALID_PROJECT_STATE` because stable identity is ambiguous.

### 5. Good/Base/Bad Cases

- Good: `[1,2,3]`, move stable ID 3 to position 1 -> ledger `[3,1,2]`; every original file remains byte-identical.
- Base: an old book has no ledger -> list uses `[1,2,3]` without migration; a newly created ID 4 appends after a stored `[3,1,2]`.
- Bad: rename every file and all cross-references after a drag, creating a multi-file partial-failure window.

### 6. Tests Required

- Unit/integration: order projection, position numbering, natural append and corrupt/duplicate ledger blocking.
- Data safety: compare manuscript filenames and bytes plus chapter-outline identity before/after reorder.
- Contract: `ChapterContract.chapterPosition` and prompt wording use projected position while `chapterId` remains stable.
- IPC: only two bounded integers pass.
- Electron E2E: click the real chapter-order select, assert tree/footer/list projection and final JSON ledger.

### 7. Wrong vs Correct

```ts
// Wrong: visible order changes stable storage identity.
await rename('第3章-夜访.md', '第1章-夜访.md')

// Correct: move only the stable ID in an atomic local ledger.
await documents.reorderChapter(3, 1)
// => { version: 1, chapterIds: [3, 1, 2] }
```

## Scenario: chapter-outline structural review and explicit confirmation

### 1. Scope / Trigger

- Trigger: a saved chapter outline crosses the main/renderer boundary and is about to authorize AI prose generation.

### 2. Signatures

```ts
reviewChapterOutline(chapterId: number): Promise<ChapterOutlineReview>
confirmChapterOutline(chapterId: number): Promise<OutlinePlanningStatus>
auditChapterOutline(outline: string, formalEventCount: number): ChapterOutlineAudit
```

### 3. Contracts

- `ChapterOutlineReview.status` is `missing | needs-changes | ready | confirmed | stale`; only `confirmed` opens the prose Gate.
- `.webnovel/planning/outline-state.json.chapterConfirmations[]` stores `chapterId`, `outlineHash`, total/volume revisions, sorted formal event IDs and `confirmedAt`.
- Save and confirm are separate writes. Confirmation is valid only while the outline hash, upstream revisions and chapter event IDs all match.
- C0 audit is deterministic and local; it reports ordered beat count, forbidden-item count and formal-event count without spending API tokens or rewriting author text.

### 4. Validation & Error Matrix

- missing chapter -> `NOT_FOUND`.
- empty outline, fewer than two beats, more than twelve beats, duplicate beats or no forbidden item -> blocking issue; confirm -> `CONFLICT`.
- missing four-element labels -> warning only in C0; later semantic review may strengthen this rule.
- upstream revision/event/outline hash mismatch -> `stale`, prose disabled until save and explicit reconfirmation.
- malformed/duplicate confirmation records -> `INVALID_PROJECT_STATE`, no Markdown or ledger write.

### 5. Good/Base/Bad Cases

- Good: save a two-beat outline with a forbidden item, review returns `ready`, author confirms, Gate returns ready.
- Base: an existing outline without a confirmation remains readable but cannot authorize new AI prose.
- Bad: treating save as confirmation, or trusting a renderer-only green badge after upstream facts changed.

### 6. Tests Required

- Domain: empty, beat bounds, duplicates, forbidden items and warning-only labels.
- Integration: invalid confirm rejection; ready -> confirmed; outline/upstream/event change -> stale; reconfirm restores Gate.
- Storage: legacy optional field, corrupt/duplicate records and atomic serialization.
- Electron E2E: click real save and confirm controls, then verify the confirmed strip and prose button; change upstream and verify both become blocked.

### 7. Wrong vs Correct

```ts
// Wrong: persistence silently grants generation authority.
await planning.updateChapterOutline(chapterId, outline)
return { readyForProse: true }

// Correct: save, inspect, and explicitly bind authority to the current fingerprint.
await planning.updateChapterOutline(chapterId, outline)
const review = await planning.reviewChapterOutline(chapterId)
if (review.canConfirm) await planning.confirmChapterOutline(chapterId)
```

## Scenario: version-bound planning-outline hint acknowledgement

### 1. Scope / Trigger

- Trigger: a deterministic total/volume outline audit crosses storage, main IPC, preload and renderer, and the author may acknowledge a false-positive hint.

### 2. Signatures

```ts
auditPlanningOutline(input: PlanningOutlineAuditInput): PlanningOutlineAudit
acknowledgeOutlineReview(scope: 'total' | number): Promise<OutlinePlanningStatus>
DesktopApi.outlines.acknowledgeReview(scope: 'total' | number): Promise<OutlinePlanningStatus>
```

### 3. Contracts

- `PlanningOutlineReview` contains `scope`, `status`, `issues`, metrics, a SHA-256 `fingerprint`, and optional `acknowledgedAt`.
- The fingerprint binds normalized outline content plus sorted event IDs, chapter IDs and structure keys; acknowledgement records store the same fingerprint and sorted issue codes.
- Audit is local, advisory and read-only. Save never acknowledges, acknowledgement never changes Markdown, and no API key/network is required.

### 4. Validation & Error Matrix

- unknown volume -> `NOT_FOUND`; no issues -> `CONFLICT`.
- malformed scope, fingerprint, issue code, timestamp, or duplicate scope -> `INVALID_PROJECT_STATE` before any Markdown write.
- content/event/chapter/structure change -> acknowledgement no longer matches and projected status returns `attention`.

### 5. Good/Base/Bad Cases

- Good: author saves a short intentional volume outline, acknowledges its hints, then a later chapter placement automatically reopens the review.
- Base: an old ledger has no acknowledgement array and projects normally with current hints.
- Bad: persist one global `reviewed=true`, or let a renderer badge survive after upstream structure changes.

### 6. Tests Required

- Domain: length, causal cue, event and chapter metrics with exact issue codes.
- Integration: attention -> acknowledged -> structural change -> attention; corrupt/duplicate records block without changing Markdown.
- Electron E2E: click the real acknowledgement button, edit and save, assert invalidation, then click again.

### 7. Wrong vs Correct

```ts
// Wrong: acknowledgement is detached from the reviewed data.
state.reviewed = true

// Correct: bind author intent to the exact saved content and structure.
state.outlineReviewAcknowledgements.push({ scope, fingerprint, issueCodes, acknowledgedAt })
```

## Scenario: hierarchical planning confirmation with exact-version locks

### 1. Scope / Trigger

- Trigger: a saved total or volume outline is about to become an approved upstream input for chapter-outline confirmation or AI generation.

### 2. Signatures

```ts
type PlanningScope = 'total' | `volume:${number}`
confirmPlanningOutline(scope: PlanningScope): Promise<OutlinePlanningStatus>
type PlanningConfirmation = {
  scope: PlanningScope
  fingerprint: string
  basedOnTotalFingerprint?: string
  confirmedAt: string
}
```

### 3. Contracts

- `.webnovel/planning/outline-state.json.planningConfirmations[]` is optional for old books and stores at most one record per scope.
- Saving Markdown, acknowledging a local hint and formally confirming are three distinct commands. Neither save nor acknowledgement grants downstream authority.
- A total fingerprint covers normalized content, effective total revision, formal event IDs and hierarchy structure. A volume fingerprint also covers its title, effective revision, content, assigned events and placed chapters.
- A volume confirmation binds `basedOnTotalFingerprint` to the currently confirmed total. A chapter confirmation requires current total and owning-volume confirmations.
- Renderer state is only a projection. The service re-reads and verifies exact fingerprints before every confirmation and prose Gate decision.

### 4. Validation & Error Matrix

- malformed scope or out-of-range volume number -> `VALIDATION_ERROR` at IPC.
- missing volume/content -> `NOT_FOUND` or projected `missing`; no confirmation write.
- unresolved local review issue -> `CONFLICT`; acknowledgement remains a separate explicit action.
- volume confirmation while total is not current -> `CONFLICT` with a Chinese recovery reason.
- duplicate scope, invalid SHA-256, invalid timestamp, total record with parent fingerprint, or volume record without one -> `INVALID_PROJECT_STATE`; stop before Markdown mutation.
- any matching-input change -> project the prior confirmation as `stale`; never silently refresh it.

### 5. Good/Base/Bad Cases

- Good: save total -> handle hints -> confirm total -> save/confirm volume -> confirm chapter; each approval displays the exact current version.
- Base: an old book has no `planningConfirmations`; it remains editable but downstream AI approval is closed until the author confirms.
- Bad: treat “saved once” or a global `approved=true` flag as permanent authority after title, hierarchy, event or content changes.

### 6. Tests Required

- Unit/integration: confirmation order, exact fingerprint persistence, parent fingerprint binding and stale propagation to volume/chapter.
- Corruption: duplicate scopes and malformed hashes/timestamps hard-stop writes.
- Contract/UI: DTO exposes `missing|needs-review|blocked|ready|confirmed|stale`, `canConfirm` and a non-sensitive reason.
- Electron E2E: click real acknowledgement and formal-confirm buttons; mutate an upstream input; assert stale UI, disabled chapter confirmation and successful explicit recovery.

### 7. Wrong vs Correct

```ts
// Wrong: save and hint acknowledgement accidentally authorize AI.
await saveOutline(markdown)
state.approved = true

// Correct: persist a separate exact-version, parent-bound approval.
await saveOutline(markdown)
await acknowledgePlanningReview(scope)
await confirmPlanningOutline(scope)
```

## Scenario: executable chapter state boundaries

### 1. Scope / Trigger

- Trigger: a chapter outline is parsed, confirmed, compiled into `ChapterContract`, sent to prose/review providers, or projected into the candidate-review UI.

### 2. Signatures

```ts
parseChapterOutline(outline: string): {
  requirements: string[]
  forbiddenEvents: string[]
  entryState: string
  exitState: string
  allowedFacts: string[]
}
buildChapterContract(chapterId: number, outline: string, events?: CanonicalEvent[], chapterPosition?: number): ChapterContract
```

### 3. Contracts

- The author-facing Markdown uses independent directive lines: `进入状态：...`, `退出状态：...`, `允许扩写：事实一；事实二`, and `禁止：...`.
- Boundary directive lines never compile as ordered beats. `allowedFacts` splits only on Chinese/ASCII semicolons so prose phrases containing commas remain intact.
- C0 confirmation requires all three boundary classes plus 2–12 ordered beats and at least one forbidden item. Manual editing and saving remain available when incomplete; AI confirmation/prose do not.
- The same `ChapterContract` feeds prose prompt, review prompt, local final `passed` calculation and renderer. Prose must start from `entryState`, stop at `exitState`, and introduce no persistent fact outside `allowedFacts`.
- `AdherenceReport.boundary` contains `entryRespected`, `exitReached`, and evidence. Local `passed` requires both booleans, every beat covered, and empty violations/introduced facts even if the model returns `passed:true`.

### 4. Validation & Error Matrix

- missing entry/exit/allowed facts -> C0 `needs-changes`, `canConfirm=false` with the corresponding `MISSING_*` issue.
- direct contract compilation with a missing boundary -> throw a stable Chinese error before any provider call.
- review omits/malforms `boundary` -> both booleans default false and local `passed=false`.
- review claims pass but misses a beat, exit state, or adds unauthorized facts -> local `passed=false`; candidate remains separate from manuscript.
- old outline without directives -> readable and editable, never rewritten automatically, but not authorized for new AI prose until completed and confirmed.

### 5. Good/Base/Bad Cases

- Good: chapter opens with the detective outside the inn, follows two clue beats, stops at the inn door, and only expands weather/action/emotion.
- Base: an imported old outline still opens as Markdown and displays three concrete missing-boundary messages.
- Bad: treat `进入状态` as B1, let “write vividly” authorize new relationships or clues, or trust the model's `passed` boolean.

### 6. Tests Required

- Domain: boundary directives are excluded from beats; three missing fields produce exact issue codes and `boundaryCount`.
- Prompt invariant: prose/review prompts contain entry, exit and allowed-fact sections from the same contract.
- Gate regression: missing beat or false exit state blocks a model-declared pass.
- Integration: complete boundaries allow explicit chapter confirmation; an incomplete legacy outline does not open the prose Gate.
- Electron E2E: real chapter-outline save/confirm shows `3/3 边界`; generated proposal displays entry/exit evidence and allowed facts.

### 7. Wrong vs Correct

```ts
// Wrong: a paragraph prompt leaves the stopping point implicit.
const contract = { beats, forbiddenEvents }

// Correct: start, ordered change, stop and expansion scope are executable fields.
const contract = { entryState, beats, exitState, allowedFacts, forbiddenEvents }
```

## Book work-item isolation

- `Project` is the `BookWorkItem` aggregate root. Story-facing data (sources, canonical events, world view, entities, realms, cheat-system template, outlines, manuscript, revisions and model routing) must resolve from that work item's canonical project root; it must never fall back to an application-global story store.
- Long-running jobs capture `workItemId` when they start. A project transition cancels and removes old in-memory jobs before `currentProject` changes, so a late result cannot be queried or adopted by another book.
- Tests that persist story settings must use at least two temporary books and switch back to the first. A single-project round trip is not sufficient evidence of isolation.
## Scenario: accepted prose character-state settlement

### 1. Scope / Trigger

- Trigger: AI 候选经作者采用并成功保存后，需要跨 renderer、IPC、job service、正式正文与每书状态文件结算人物变化。

### 2. Signatures

```ts
ai.settleChapterDraft(jobId: string): Promise<CharacterStateView>
workspace.getCharacterState(): Promise<CharacterStateView>
workspace.dismissCharacterConflict(conflictId: string): Promise<CharacterStateView>
CharacterStateService.settleAcceptedProposal(input): Promise<CharacterStateView>
CharacterStateService.reconcileManuscript(chapters: Chapter[], scopedChapterIds?: number[]): Promise<CharacterStateView>
CharacterStateService.dismissConflict(conflictId: string): Promise<CharacterStateView>
CharacterStateService.snapshotsBefore(chapterPosition: number): Promise<CharacterStateSnapshot[]>
parseAdherenceReview(content: string, contract: ChapterContract, candidateContent?: string): AdherenceReport
```

- Storage: `.webnovel/story-state/characters.json`, schema `version: 1`.

### 3. Contracts

- renderer 只提交 `jobId`；不得提交人物名、变化、正文路径或 `workItemId`。
- main 从 `ChapterDraftJobService` 读取 proposal，从 `DocumentService` 读取已保存正文，从正式纪事读取人物来源。
- `AdherenceReport.characterChanges[]` 只允许 `location|injury|relationship|knowledge|possession|goal|power`；每项包含 `character`, `field`, `value`, `evidence`。
- `AdherenceReport.characterConflicts[]` 只允许 `identity|motivation|arc`；每项包含 `character`, `field`, `claimedValue`, `evidence`。
- 两类 evidence 必须是候选正文的逐字子串且包含人物姓名；解析器与结算服务都重新验证，不能只信模型 JSON。
- event 必须包含 `chapterId`, `chapterPosition`, `manuscriptRevision`, `proposalId`, `evidence`, `changes`；changes 可含地点、伤势、关系、知识、关键物品、当前目标和实力/境界。
- event 的 `active` 由当前稳定章节 ID 与正文 SHA-256 是否匹配决定；snapshot 只重放 active events。冲突状态为 `pending|superseded|dismissed`。
- `dismissed` 是作者对确定性 conflict ID 所引用逐字证据的持久决定：只清除提醒，不修改正文或 anchor；后续正文重放、恢复和相同候选重复结算都不得自动重开。
- stable anchor 只允许 `id`, `name`, `sourceRefs`；身份、动机、人物弧声明写入 `pendingConflicts`，不得自动修改 anchor，也不单独改变 `passed`。
- 同名人物的全部正式来源先合并；报告没有唯一有效地点时，才回退到正文/章契中的唯一正式地点。地点、伤势、关键物品、当前目标、实力/境界是章末标量，同章多值冲突保持未知；关系与知识去重累积。关键物品不是推断出的完整背包。
- 可识别的关键物品状态统一为 `持有：物品名` / `不再持有：物品名`。连续性检查只重放 active 的已采用状态：同一规范化物品换到另一人物名下时，只有当前逐字 evidence 同时包含前后持有人姓名和明确交接动词才视为有承接；否则产生 `POSSESSION_HANDOFF` attention，不阻断写作。
- 物品交接检查不得把自由文本、代词或未写出的场外动作猜成结构化事实；明确释放只结束已知持有人，未知保持未知。它不是库存系统，也不得另建一套脱离人物状态版本链的物品权威。
- 生成显示序号为 N 的章纲/正文时，只允许注入 `snapshotsBefore(N)`；该投影只重放 `active && chapterPosition < N` 的事件。不得注入全局最新快照，防止重写旧章时泄露本章或未来结果。
- Prompt 中的人物快照是引用数据：最多 200 人，按最近章序优先；字段折叠换行并限长，且明确其中命令/提示词不得执行。
- 保存/恢复传 `[chapter], [chapter.id]`，删除传 `[], [deletedId]`，重排传完整已有章节列表且不传 scope；局部重放不得改变其他章节事件。
- 正文 mutation 先完成，随后重放派生状态。重放失败不得回滚或伪报正文失败；日志只允许稳定错误码，不能含路径、正文或异常消息。

### 4. Validation & Error Matrix

- job 不存在/未完成/不属于当前项目 -> `NOT_FOUND` 或 `CONFLICT`，不写状态。
- proposal 未通过审校或章节不匹配 -> `CONFLICT`，不写状态。
- 已保存正文不包含 proposal content -> `CONFLICT`，不写状态。
- state `workItemId` 不同、JSON 损坏、字段非法或超限 -> `INVALID_PROJECT_STATE`，保留原字节。
- 正式纪事中没有正文实际出现的人物 -> 返回当前空状态，不创建空文件。
- 人物字段不在白名单、evidence 不在正文或不含人物名 -> 丢弃该条候选；不让单条坏记录破坏整个章契报告。
- 同一正文重复结算同一冲突 -> deterministic conflict id 命中，不重复追加。
- 当前正文 hash 不匹配或章节已删除 -> 事件 `active=false`、冲突 `superseded`，历史记录保留；恢复原 hash -> 重新激活。
- conflict ID 非 `conflict-` + 24 位小写 hex -> IPC `VALIDATION_ERROR`；ID 不存在 -> `NOT_FOUND`；`superseded` -> `CONFLICT`；已 `dismissed` -> 幂等返回当前状态。
- scope 含重复、非正整数章节 ID，或 chapters 含重复 ID -> `INVALID_PROJECT_STATE`；不写人物状态。
- `snapshotsBefore` 的章序不是正安全整数 -> `INVALID_PROJECT_STATE`；不读取为写作上下文。
- 人物状态文件损坏且正文 mutation 已成功 -> 保留坏文件字节，输出安全错误码，正文结果仍成功返回。

### 5. Good/Base/Bad Cases

- Good: 作者采用已通过候选并保存；正文逐字写出沈砚停在酒馆、收起铜符、决定调查掌柜、修为稳在炼气二层 -> 写七类可用事件并在下一章上下文投影；身份声明只进入待处理冲突。
- Base: 同一正文重复保存/重复结算 -> deterministic event id 命中，事件数不增加。
- Base: 作者改写正文后又恢复旧 revision -> 原事件不重建、不复制，只从 inactive 回到 active 并按当前章序投影。
- Base: 作者认定逐字证据为误报 -> 状态变为 `dismissed`，anchor 深相等；关闭案卷仍保留未处理项。
- Base: 第 4 章开始生成 -> 快照最多重放第 1–3 章；第 4 章已有旧候选或第 5 章状态均不得注入。
- Base: 同章报告“炼气二层”和“炼气三层”且均有逐字证据 -> 本章 `power` 保持未知，不任选其一。
- Base: 陈景安持有错题本，后章由周文衡持有且证据逐字写出双方和“递给” -> 不提示；若后章只写周文衡翻开错题本 -> `POSSESSION_HANDOFF` attention，作者仍可继续写作。
- Bad: 模型声称沈砚受伤但 evidence 不在正文 -> 丢弃该变化；renderer 猜测人物变化、跨书传 job、正文已被改写或 state 文件损坏 -> 一律阻断。
- Bad: 每次自动保存读取全部章节，或直接删除 hash 不匹配事件，导致长篇卡顿且恢复旧稿无法重建状态。

### 6. Tests Required

- Unit: 采用后出场人物、证据摘录、章节位置、地点/伤势/关系/知识/关键物品/当前目标/实力与 snapshot 断言。
- Unit: 同章标量多值保持未知；`snapshotsBefore(N)` 包含此前 active 状态并排除第 N 章及未来事件。
- Unit: exact evidence 保留；虚构 evidence、非法字段和无人物名 evidence 丢弃。
- Unit: 同物品跨人物无交接产生 attention，显式交接通过，显式释放结束旧持有人；结果码通过 IPC 白名单并在 renderer 使用固定中文标签。
- Unit: 稳定声明生成 pending conflict，anchor 深相等；重复结算事件/冲突数不变。
- Unit: 改写、恢复、删除和重排分别切换 active/status/position；快照只含 active 历史。
- Unit: pending 可 dismiss、重复 dismiss 幂等、missing/superseded 拒绝、dismissed 经重放和重复结算仍保持 dismissed；anchor 深相等。
- Performance regression: scoped chapter replay leaves another chapter active and does not require its DTO。
- Security: cross-book、failed report、mismatched manuscript、damaged bytes unchanged。
- Integration/Electron: 生成→取消无状态→重试→采用→立即保存→打开人物证据案卷→点击认定误报→提醒清除；随后实际改写正文并断言旧事件 inactive、dismissed 决定保留。
- Integration: `WorkspaceService.promptContext(N)` 请求受限前章投影，包含中文七类状态和引用数据安全边界，不调用无界 `state()`。

### 7. Wrong vs Correct

#### Wrong

```ts
await desktop.characters.save(proposal.characterChanges) // renderer DTO 或模型 JSON 被直接当成事实
const context = await characterStates.state() // 全局最新快照会把当前章/未来章结果泄露给旧章重写
```

#### Correct

```ts
const report = parseAdherenceReview(rawReview, contract, candidateContent) // 先过滤逐字证据
await desktop.ai.settleChapterDraft(jobId) // main 再重读 job、正式正文与纪事后结算
await desktop.workspace.dismissCharacterConflict(conflictId) // 作者只驳回当前证据提醒，不改 anchor
await characterStates.reconcileManuscript([savedChapter], [savedChapter.id]) // 正文成功后局部重放；历史事件不删除
const priorState = await characterStates.snapshotsBefore(chapter.position) // 只把前章状态送入当前章上下文
```

## Scenario: read-only cross-chapter character continuity audit

### 1. Scope / Trigger

- Trigger: consistency overview or prose Gate needs to compare accepted character end states across chapters without creating another writable truth.

### 2. Signatures

```ts
auditCharacterContinuity(
  state: CharacterStateView | undefined,
  realms: RealmLevel[],
  throughChapter?: number
): ConsistencyFinding[]

type ConsistencyFinding = {
  code: 'LOCATION_JUMP' | 'POWER_SKIP' | 'POWER_REGRESSION' | 'UNEXPLAINED_REVIVAL'
  severity: 'blocked' | 'attention' | 'advice'
  characterId: string
  characterName: string
  fromChapter: number
  toChapter: number
  message: string
  evidence: string[]
}
```

### 3. Contracts

- `CharacterStateEvent.changes` may contain exact `vitality: 'alive'|'dead'`; `changeEvidence[field]` retains that field's accepted-prose substring. Old version-1 files may omit both fields and remain valid.
- Audit reads only `active` events at or before `throughChapter`, groups by character, and compares chapter-ordered accepted state. It never writes the character ledger, manuscript, outline or realm configuration.
- Adjacent location changes without a movement cue and unexplained realm regression are weak `attention` findings. Skipping one or more configured realm levels and dead-to-alive transitions without an explicit revival cue are `blocked` findings.
- Unknown realm text is not guessed. Explicit movement, power-loss or revival evidence suppresses the corresponding heuristic. Findings retain both previous and current evidence for author review.
- The main-process consistency projection owns severity and Gate behavior. Renderer only renders `ConsistencyItem.findings` in the existing character dossier.

### 4. Validation & Error Matrix

- malformed `vitality` or `changeEvidence` in stored JSON -> `INVALID_PROJECT_STATE`, original bytes unchanged.
- review vitality value other than exact `存活|死亡`, missing character name, or evidence absent from candidate prose -> discard that change, do not infer death from injury/unconsciousness.
- missing realm list or power value not matching an exact configured realm name -> no power finding; never fabricate level order.
- future or inactive event -> excluded from the selected chapter projection.
- weak cue (`LOCATION_JUMP`, `POWER_REGRESSION`) -> overview `attention`, prose remains allowed.
- strong contradiction (`POWER_SKIP`, `UNEXPLAINED_REVIVAL`) -> overview `blocked`, prose candidate generation denied with a concrete message.

### 5. Good/Base/Bad Cases

- Good: chapter 1 ends in an inn and chapter 2 says the character travelled to the frontier; no location finding.
- Base: legacy events have no vitality or per-field evidence; they remain readable and the audit falls back to the bounded event evidence.
- Bad: infer “dead” from “昏迷”, silently alter the realm table, or let renderer recompute severity with different rules.

### 6. Tests Required

- Unit: abrupt adjacent location jump warns; explicit travel evidence suppresses it.
- Unit: configured realm skip blocks; explained power loss suppresses regression warning.
- Unit: unexplained revival blocks; explicit revival passes; inactive and future events are ignored.
- Parser/storage: exact `存活|死亡` and per-field evidence round-trip; invalid vitality is discarded; damaged ledger is never overwritten.
- Projection: weak findings do not block prose, strong findings do, and the DTO retains evidence/chapters.
- Electron E2E: real click opens the combined “人物连续性” dossier; stable-anchor conflicts remain dismissible while semantic findings stay read-only.

### 7. Wrong vs Correct

```ts
// Wrong: ask another model to guess continuity, then write its answer as character truth.
await saveCharacterState(await aiReview(allManuscript))

// Correct: project deterministic, evidence-linked findings from accepted state only.
const findings = auditCharacterContinuity(characterState, realms.levels, chapterPosition)
return buildConsistencyOverview({ workflow, planning, characterState, realms: realms.levels, chapterPosition })
```

## Scenario: mixed-origin material library

### 1. Scope / Trigger

- Trigger: adding or changing material capture, web-research adoption, planning material gates, `SourceCard` DTOs, IPC validation, or `.webnovel/research/sources.json` persistence.

### 2. Signatures

```ts
type SourceCardCreateInput = {
  title: string
  sourceType?: 'manual' | 'web'
  provider?: string
  url?: string
  author?: string
  publishedAt?: string
  excerpt: string
  userNotes: string
  references?: Array<{ title: string; url: string }>
}

ResearchLibraryService.createSource(input: SourceCardCreateInput): Promise<SourceCard>
ResearchLibraryService.listSources(): Promise<{ sources: SourceCard[] }>
WorkspaceService.planningMaterials(): Promise<string>
```

- Storage: `.webnovel/research/sources.json`, `{ version: 1, sources: SourceCard[] }`.

### 3. Contracts

- Material origin belongs to each `SourceCard`; a whole book never chooses one exclusive route. `foundation.creationPath` remains readable/writable only for old-book compatibility and must not drive new UI or planning behavior.
- Missing `sourceType` means `manual`. `web` cards preserve a bounded provider plus at least one top-level URL or cited `references[]` entry.
- Web-research adoption creates one structured `web` card and retains cited title/HTTP(S) URL pairs. It does not append an opaque aggregate into `foundation.sourceNotes`.
- Planning context combines author notes, manual cards, and web cards with explicit provenance labels. Material text and cited pages are untrusted evidence and cannot override gates or system instructions.
- Material readiness is true when any of those three sources contains usable content. Candidate events remain non-canon until explicit approval.
- Reads return clones. Existing valid legacy source types remain readable. A malformed source ledger never falls back to an empty store before a write.

### 4. Validation & Error Matrix

- blank title or both excerpt/userNotes blank -> `VALIDATION_ERROR`, no write.
- unknown public `sourceType`, extra IPC field, non-array/over-100 references, blank title, or non-HTTP(S) citation -> IPC `VALIDATION_ERROR`.
- `web` without top-level URL and without references -> `VALIDATION_ERROR`, no write.
- duplicate normalized card URL/content hash -> `CONFLICT`, existing card preserved.
- duplicate cited URL inside one card -> keep the first citation only.
- malformed JSON, wrong version, invalid field type/size/hash -> `INVALID_PROJECT_STATE`, original bytes unchanged.

### 5. Good/Base/Bad Cases

- Good: author writes a one-line premise, saves an interview card, then adopts cited web research; all three appear in one material desk and one planning prompt.
- Base: an old book contains only `foundation.sourceNotes` or old manual cards; it opens without migration and can plan normally.
- Bad: selecting “联网采风” hides personal notes, or web adoption destroys citation URLs by pasting only a summary into author notes.

### 6. Tests Required

- Unit: manual default, web provider/references, reference URL dedupe, card duplicate rejection, and malformed ledger byte preservation.
- IPC: allow bounded manual/web payloads; reject unknown origins, extra fields, missing web evidence, and unsafe citation protocols.
- Integration: `planningMaterials`, workflow material detail, and `promptContext` contain all same-book origins and no other book data.
- Electron E2E: open one material desk containing an existing web card, create a manual card by real clicks, verify both visible provenance labels, then extract/approve an event.

### 7. Wrong vs Correct

```ts
// Wrong: one book-wide switch hides one source and erases web provenance.
foundation.creationPath = 'research'
foundation.sourceNotes += research.content

// Correct: each captured item owns its provenance and joins one book-local corpus.
await researchLibrary.createSource({
  title: `联网采风：${result.query}`,
  sourceType: 'web',
  provider: result.model,
  excerpt: result.content,
  userNotes: `检索词：${result.searchedQueries.join('、')}`,
  references: result.sources
})
```

## Scenario: adopting an automatic-planning total outline

### 1. Scope / Trigger

- Trigger: adding or changing planning-candidate adoption, preview IPC, `.webnovel/planning/automatic-planning-draft.json`, or formal outline writes.

### 2. Signatures

```ts
PlanningPackageService.previewTotalAdoption(proposalId: string): Promise<PlanningTotalAdoptionPreview>
PlanningPackageService.adoptTotal(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<{ proposal: PlanningPackageProposal; planning: OutlinePlanningStatus }>
```

### 3. Contracts

- The renderer flushes candidate autosave before preview. Main reads the stored candidate and renders the formal Markdown itself.
- Candidate autosaves are serialized and expose an awaitable queue; `flushPlanningDraftSave` waits an in-flight save and repeats when a newer edit version remains dirty. A visual `saving` flag is not a durability primitive.
- Preview returns two SHA-256 fingerprints, excerpts, character counts, current revision/confirmation and affected downstream counts; it performs no write.
- Adopt re-reads both candidate and formal outline and requires both preview fingerprints to match. It writes through `OutlinePlanningService.updateOutline('total', content)` only.
- Success persists `proposal.adoption.totalOutline = { fingerprint, adoptedAt, revision }`; old proposals may omit `adoption`.
- Adoption never confirms the outline, adopts volumes, deletes the candidate, or generates prose.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- renderer attempts to add/change adoption metadata through ordinary candidate autosave -> `CONFLICT`; only clearing the mark or preserving the exact main-written value is allowed.
- no candidate or proposal ID mismatch -> `NOT_FOUND`, no formal write.
- cross-book candidate -> `CONFLICT`, candidate/formal bytes unchanged.
- candidate or formal fingerprint changed after preview -> `CONFLICT`, no formal write.
- malformed candidate file -> `INVALID_PROJECT_STATE`, original bytes unchanged.

### 5. Good/Base/Bad Cases

- Good: author edits candidate, previews old/new plus affected chapters, confirms, and sees formal revision increment while downstream confirmations become stale.
- Base: an old candidate without adoption metadata opens unchanged and can be previewed.
- Bad: renderer sends candidate Markdown directly to the formal outline channel, or one click writes blueprint, world, characters and all volumes as a partial transaction.
- Bad: preview proceeds while the debounce save promise is still in flight merely because the timer has already fired.

### 6. Tests Required

- Unit/integration: preview causes zero writes; stale candidate and stale formal fingerprints reject; successful adoption uses exact rendered stored content, revision metadata persists, candidate remains.
- IPC: strict proposal ID and two lowercase-normalized SHA-256 values; extra/short fields reject.
- Electron E2E: edit/autosave, reopen, preview, assert formal bytes unchanged, confirm, assert formal content and adoption metadata.
- Renderer state: editing during an in-flight save must remain `dirty` after the older snapshot finishes; preview flush must observe the newest stored candidate.

### 7. Wrong vs Correct

```ts
// Wrong: trust renderer content and bypass the revision ledger.
await documents.updateOutline('total', rendererProposal.totalOutline.content)

// Correct: main re-reads, compares both preview fingerprints, then uses the one formal write path.
const preview = await planningPackages.previewTotalAdoption(proposalId)
await planningPackages.adoptTotal({ proposalId, candidateFingerprint: preview.candidateFingerprint, currentFingerprint: preview.currentFingerprint })
```

## Scenario: initializing an automatic-planning volume directory

### 1. Scope / Trigger

- Trigger: adding/changing candidate-volume initialization, the planning ledger's volume structure, or the two volume-structure IPC commands.

### 2. Signatures

```ts
PlanningPackageService.previewVolumeStructure(proposalId: string): Promise<PlanningVolumeStructurePreview>
PlanningPackageService.initializeVolumeStructure(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  totalFingerprint: string
}): Promise<{ proposal: PlanningPackageProposal; planning: OutlinePlanningStatus }>
OutlinePlanningService.initializeVolumeStructure(input: Array<{ order: number; title: string }>): Promise<OutlinePlanningStatus>
```

### 3. Contracts

- Renderer flushes the candidate before preview; main re-reads the stored proposal and requires its current total-outline adoption to match the current formal total.
- Preview is zero-write and returns `create | rename | keep`, preserved extra volumes, conflicts, downstream counts, and three SHA-256 fingerprints.
- Confirm re-reads candidate structure, formal structure, and formal total; all three fingerprints must match the preview.
- The ledger mutation creates/renames only candidate orders, preserves extra formal volumes, all event/chapter assignments, and all existing volume-outline Markdown.
- A real structure change bumps total revision exactly once; an idempotent replay does not. Success stores `adoption.volumeStructure` but does not confirm total or adopt volume content.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- candidate total not currently adopted to the exact formal total -> `CONFLICT`, no ledger write.
- non-sequential order, more than 100 volumes, blank/>120 title, duplicate candidate/final title -> `CONFLICT`, no ledger write.
- candidate/current/total changed after preview -> `CONFLICT`, no ledger write.
- ordinary renderer autosave forges or changes `volumeStructure` metadata -> `CONFLICT`; exact preservation or clearing is allowed.
- malformed/cross-book proposal or damaged planning ledger -> `INVALID_PROJECT_STATE`/`CONFLICT`, original bytes preserved.

### 5. Good/Base/Bad Cases

- Good: author adopts total, previews two candidate volumes against one old volume plus an extra third volume, initializes, retains the old volume text and extra third volume, then reconfirms total.
- Base: candidate and formal directory already match; initialization records metadata without changing revision or Markdown.
- Bad: loop over `createVolume` from renderer, write each candidate volume Markdown immediately, delete extra volumes, or auto-confirm total after structural mutation.

### 6. Tests Required

- Unit: sequential/title/duplicate validation, create/rename/keep, extra-volume preservation, existing Markdown byte preservation, one revision bump, idempotent replay.
- Service/IPC: preview zero-write, strict three-fingerprint DTO, stale candidate/formal/total rejection, adoption-metadata tamper rejection.
- Electron E2E: real-click preview and confirm; assert formal document list and total content unchanged, projected titles match candidate, total approval becomes `needs-review`, metadata persists.
- Regression: downstream outline smoke must handle a book whose volume directory already exists; it must not assume a blank planning ledger.

### 7. Wrong vs Correct

```ts
// Wrong: every create invalidates the parent confirmation and risks partial canon.
for (const volume of rendererProposal.volumes) {
  await outlines.createVolume(volume.title)
  await outlines.update(volume.order, renderVolumeOutline(volume))
}

// Correct: preview/recheck all three sources, then mutate only the ledger once.
const preview = await planningPackages.previewVolumeStructure(proposalId)
await planningPackages.initializeVolumeStructure({
  proposalId,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint,
  totalFingerprint: preview.totalFingerprint
})
```

## Scenario: adopting one automatic-planning volume outline

### 1. Scope / Trigger

- Trigger: previewing or adopting one candidate volume outline, or changing the per-volume adoption ledger/IPC contracts.

### 2. Signatures

```ts
PlanningPackageService.previewVolumeOutlineAdoption(
  proposalId: string,
  order: number
): Promise<PlanningVolumeOutlinePreview>

PlanningPackageService.adoptVolumeOutline(input: {
  proposalId: string
  order: number
  parentFingerprint: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<PlanningVolumeOutlineResult>
```

### 3. Contracts

- The formal total outline must be explicitly confirmed, and its approval fingerprint must be current.
- Candidate and formal volume directories must still match for every candidate `order/title`; preview renders the target Markdown in main and performs zero writes.
- Confirm re-reads the parent total, target candidate, and current target volume; all three fingerprints must match the preview.
- The only formal mutation is `OutlinePlanningService.updateOutline(order, renderedCandidate)` for the requested order. It invalidates that volume's old confirmation but not the parent total confirmation.
- Success stores or replaces only the target item in `adoption.volumeOutlines`; it does not adopt/confirm another volume, materialize events, create chapter outlines, or generate prose.

### 4. Validation & Error Matrix

- malformed/extra IPC field, order outside `1..100`, or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- missing candidate order, stale/unadopted structure, directory mismatch, or unconfirmed/stale parent total -> `CONFLICT`, no volume write.
- candidate/target/parent changed after preview -> `CONFLICT`, no volume write.
- ordinary autosave adds or alters a per-volume adoption record -> `CONFLICT`; exact preservation or clearing is allowed.
- damaged/cross-book proposal or planning ledger -> `INVALID_PROJECT_STATE`/`CONFLICT`; original bytes remain untouched.

### 5. Good/Base/Bad Cases

- Good: after confirming the initialized total, preview volume 1, adopt it, observe only volume 1 revision increase and its confirmation become `needs-review`; volume 2 and the total stay unchanged.
- Base: formal target already equals the rendered candidate; adoption still records the current target revision without changing unrelated state.
- Bad: send renderer Markdown directly to the document service, adopt all volumes in a loop, or auto-confirm the volume after writing it.

### 6. Tests Required

- Unit/service: parent-confirmation gate, directory equality, preview zero-write, target-only write, target revision/confirmation transition, parent and non-target preservation, metadata sorting/replacement/tamper rejection.
- IPC: exact object shape, strict order, strict normalized SHA-256 fields.
- Electron E2E: real-click total review/confirm, open one-volume preview, assert zero-write, confirm, then assert only the target Markdown and adoption record changed.
- Regression: a one-volume proposal must end at the formal-volume review action; multi-volume proposals must advance to the next unadopted volume.

### 7. Wrong vs Correct

```ts
// Wrong: renderer content bypasses parent approval and optimistic concurrency.
await outlines.updateOutline(order, rendererProposal.volumes[index].goal)

// Correct: main renders and fingerprints, then rechecks all three sources.
const preview = await planningPackages.previewVolumeOutlineAdoption(proposalId, order)
await planningPackages.adoptVolumeOutline({
  proposalId,
  order,
  parentFingerprint: preview.parentFingerprint,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint
})
```

## Scenario: adopting planning character seeds into stable anchors

### 1. Scope / Trigger

- Trigger: changing `CharacterAnchor`, planning-seed preview/adoption IPC, or the mapping between an automatic-planning proposal and `.webnovel/story-state/characters.json`.

### 2. Signatures

```ts
CharacterStateService.previewPlanningSeeds(
  proposalId: string,
  seeds: PlanningCharacterSeed[]
): Promise<PlanningCharacterSeedPreview>

CharacterStateService.adoptPlanningSeeds(input: {
  proposalId: string
  seeds: PlanningCharacterSeed[]
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<{ state: CharacterStateView; anchorFingerprint: string }>

PlanningPackageService.adoptCharacterSeeds(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<PlanningCharacterSeedResult>
```

### 3. Contracts

- Candidate `name/role/arcSeed` remains editable and non-canon until author confirmation. Main re-reads the stored proposal; renderer never supplies seed content to the write command.
- Preview performs zero writes and returns `create | enrich | update | keep`, duplicate-name conflicts, candidate/current SHA-256, and counts of existing anchors, dynamic snapshots and pending conflicts.
- Names match by `trim + NFKC + zh-CN lower-case`. Adoption reuses an existing stable ID or creates a deterministic ID, then adds a `planning:<proposalId>:<fingerprint>` source ref.
- Only anchor `name/role/arcSeed/sourceRefs` may change. Existing events, dismissed/pending conflicts, manuscript revisions and evidence are preserved; snapshots are rebuilt from those same events.
- Success stores `adoption.characterSeeds`; ordinary draft autosave may preserve or clear it but cannot add/change it.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no project read/write.
- candidate contains normalized duplicate names -> `CONFLICT`, no anchor write.
- candidate or anchor fingerprint changed after preview -> `CONFLICT`, no anchor write.
- cross-book/missing planning proposal -> `CONFLICT`/`NOT_FOUND`, no character write.
- damaged character store -> `INVALID_PROJECT_STATE`; original bytes remain untouched.
- renderer forges/changes `adoption.characterSeeds` -> `CONFLICT`; clearing after a real seed edit is allowed.

### 5. Good/Base/Bad Cases

- Good: preview one new seed plus one existing prose-derived person, confirm, create the first and enrich/update the second while retaining both persons' evidence history.
- Base: every candidate seed already matches; write records adoption metadata and leaves semantic anchor values unchanged.
- Bad: replace `characters.json` from the blueprint, create dynamic snapshots without prose evidence, or let chapter extraction overwrite `role/arcSeed`.

### 6. Tests Required

- Unit: create/enrich/update/keep, normalized duplicates, stale candidate/current fingerprints, stable ID reuse, dynamic event/snapshot/conflict preservation.
- IPC/service: strict DTO, stored-proposal re-read, adoption metadata tamper rejection and damaged-file byte preservation.
- Electron E2E: edit candidate seed, preview and assert zero write, confirm, assert anchor count/fields/source refs and zero invented events, then check the Chinese success notice.
- Regression: accepted prose after seed adoption must append/replay only dynamic state and continue referencing the same character ID.

### 7. Wrong vs Correct

```ts
// Wrong: AI blueprint replaces the character truth source and invents current state.
await writeJson(characterFile, rendererProposal.blueprint.characters)

// Correct: main re-reads the proposal and the character service preserves event history.
const preview = await planningPackages.previewCharacterSeedAdoption(proposalId)
await planningPackages.adoptCharacterSeeds({
  proposalId,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint
})
```

## Scenario: adopting an open world seed into one book foundation

### 1. Scope / Trigger

- Trigger: changing automatic-planning world-seed adoption, `FoundationData.worldView`, or the IPC path that maps a proposal into `.webnovel/config/foundation.json`.

### 2. Signatures

```ts
PlanningPackageService.previewWorldSeedAdoption(
  proposalId: string
): Promise<PlanningWorldSeedPreview>

PlanningPackageService.adoptWorldSeed(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<PlanningWorldSeedResult>

WorkspaceService.adoptPlanningWorldView(input: {
  worldView: string
  currentFingerprint: string
}): Promise<{ data: FoundationData; fingerprint: string }>
```

### 3. Contracts

- `blueprint.worldView` is an editable, open prose description rather than a complete world schema. It stays non-canon until explicit preview and confirmation.
- Preview re-reads the stored proposal and the full current `FoundationData`, performs zero writes, and fingerprints both the candidate text and the complete current foundation snapshot.
- The workspace owns one serialized foundation mutation queue shared by ordinary saves and world-seed adoption. Confirm rechecks the full foundation fingerprint inside that queue, then changes only `worldView`.
- `creationPath`, `sourceNotes`, `useRealms` and `useSystem` are preserved byte-for-value. Adoption does not create realms, write a system template, confirm outlines, create events, or generate prose.
- Success stores `adoption.worldSeed` with candidate and resulting-foundation fingerprints. Draft autosave may preserve or clear it after a candidate edit but cannot forge or alter it.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- missing/cross-book proposal -> `NOT_FOUND`/`CONFLICT`, no foundation write.
- candidate text changed after preview -> `CONFLICT`, no foundation write.
- any foundation field changed after preview -> `CONFLICT`, no foundation write; the author must preview again.
- damaged proposal/foundation JSON -> `INVALID_PROJECT_STATE`; original bytes remain untouched.
- renderer forges/changes `adoption.worldSeed` -> `CONFLICT`; clearing after a real candidate edit is allowed.

### 5. Good/Base/Bad Cases

- Good: preview a broad world seed, then adopt it while retaining the author's mixed research notes and both optional-system switches.
- Base: candidate and current world view already match; confirmation records provenance without changing other foundation fields.
- Bad: replace the entire foundation with renderer state, infer realms from free text, or require a rigid world schema before the author can continue.

### 6. Tests Required

- Service: preview zero-write; candidate/current stale protection; target-only update; preservation of notes/path/switches; metadata tamper rejection.
- IPC: exact DTO and normalized SHA-256 fields.
- Electron E2E: real-click preview and confirm, assert preview did not write, assert Chinese success notice, candidate equality and preservation of every non-world foundation field.
- Regression: direct world-view editing after adoption remains available and does not silently modify the proposal candidate.

### 7. Wrong vs Correct

```ts
// Wrong: stale renderer state can erase notes or toggle book-specific systems.
await workspace.saveFoundation({ ...rendererFoundation, worldView: candidate })

// Correct: the data owner rechecks the full snapshot and mutates one field.
const preview = await planningPackages.previewWorldSeedAdoption(proposalId)
await planningPackages.adoptWorldSeed({
  proposalId,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint
})
```

## Scenario: adopting a planning power-system overview without inventing realms

### 1. Scope / Trigger

- Trigger: changing per-book power-system overview storage, planning adoption IPC, prompt projection, or any mapping from `blueprint.powerSystem` to formal settings.

### 2. Signatures

```ts
WorkspaceService.powerSystem(): Promise<{ overview: string }>
WorkspaceService.savePowerSystem(input: { overview: string }): Promise<{ overview: string }>

PlanningPackageService.previewPowerSystemAdoption(
  proposalId: string
): Promise<PlanningPowerSystemPreview>

PlanningPackageService.adoptPowerSystem(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<PlanningPowerSystemResult>
```

### 3. Contracts

- `.webnovel/config/power-system.json` is exactly `{ version: 1, overview: string }`; no unknown fields and no future version fallback.
- The overview is open prose. Concrete realm records remain solely in `levels.json`; the activation choice remains solely in `foundation.json.useRealms`.
- Preview re-reads the stored proposal and current overview and performs zero writes. It may report realm count and the activation flag only as preserved impact information.
- Confirm rechecks candidate/current SHA-256 inside the serialized workspace mutation and writes only the overview. Empty overview is valid and means “no formal power system decided”.
- Prompt projection may include both the overview and explicit realms, but must label them as reference data and never derive levels from overview text.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- missing/cross-book proposal or changed candidate/current overview -> `NOT_FOUND`/`CONFLICT`, no write.
- malformed JSON, unknown field, wrong version, or wrong overview type -> `INVALID_PROJECT_STATE`; original bytes remain untouched.
- ordinary save against a malformed existing file -> `INVALID_PROJECT_STATE`; it must not replace the file with an empty/default record.
- renderer forges/changes `adoption.powerSystem` -> `CONFLICT`; clearing it after a real candidate edit is allowed.

### 5. Good/Base/Bad Cases

- Good: adopt “作品与舞台信用构成成长线”, retain one authored realm and `useRealms=true`, then inject both layers distinctly into writing context.
- Base: adopt an empty candidate to explicitly leave the book without a decided power system; realm records and switch remain untouched.
- Bad: split prose into guessed level names, auto-enable realms, replace `levels.json`, or conflate a cheat-system ability definition with its fixed display template.

### 6. Tests Required

- Service: missing-file base state, preview zero-write, stale candidate/current protection, overview-only write, realm/switch preservation, malformed-file byte preservation on read and ordinary save.
- IPC/planning: exact DTO, normalized SHA-256, stored-proposal re-read, adoption metadata tamper rejection.
- Prompt: overview and explicit realm table are both present when configured and remain separately labeled.
- Electron E2E: edit candidate, preview, confirm, assert Chinese success notice and verify zero change to realm records and activation flag.

### 7. Wrong vs Correct

```ts
// Wrong: model prose silently becomes concrete canon and changes the switch.
await workspace.saveRealms(parseRealmLevels(proposal.blueprint.powerSystem))
await workspace.saveFoundation({ ...foundation, useRealms: true })

// Correct: main adopts only the open overview; realms remain an author decision.
const preview = await planningPackages.previewPowerSystemAdoption(proposalId)
await planningPackages.adoptPowerSystem({
  proposalId,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint
})
```

## Scenario: adopting a cheat or special-advantage overview without changing its UI

### 1. Scope / Trigger

- Trigger: changing per-book cheat/special-advantage storage, planning adoption IPC, system-template persistence, or prompt projection for a book-specific ability.

### 2. Signatures

```ts
WorkspaceService.cheatSystem(): Promise<{ overview: string }>
WorkspaceService.saveCheatSystem(input: { overview: string }): Promise<{ overview: string }>
WorkspaceService.systemTemplate(): Promise<{ template: string }>

PlanningPackageService.previewCheatSystemAdoption(
  proposalId: string
): Promise<PlanningCheatSystemPreview>

PlanningPackageService.adoptCheatSystem(input: {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
}): Promise<PlanningCheatSystemResult>
```

### 3. Contracts

- `.webnovel/config/cheat-system.json` is exactly `{ version: 1, overview: string }`; the overview defines ability, limits and costs and may be empty.
- `.webnovel/config/system-ui.json` remains the compatible exact shape `{ template: string }`; it controls presentation only. `foundation.useSystem` is the independent activation choice.
- Preview re-reads candidate, current overview, template and foundation and performs zero writes. Confirm rechecks candidate/current fingerprints inside the overview mutation queue and writes only `overview`.
- Prompt always includes the formal ability overview. It includes the template only when `useSystem=true`; otherwise it must say that system popups are forbidden.
- Planning adoption metadata is passed to renderer state as `result.proposal.adoption`, never as the entire proposal object.

### 4. Validation & Error Matrix

- malformed/extra IPC field or non-64-hex fingerprint -> `VALIDATION_ERROR`, no filesystem access.
- missing/cross-book proposal or changed candidate/current overview -> `NOT_FOUND`/`CONFLICT`, no write.
- malformed overview JSON, unknown field, wrong version/type -> `INVALID_PROJECT_STATE`; original bytes remain untouched.
- malformed template JSON, extra field, or wrong type -> `INVALID_PROJECT_STATE`; default template must not hide corruption and ordinary save must not overwrite it.
- forged/changed `adoption.cheatSystem` -> `CONFLICT`; clearing it after a real candidate edit is allowed.

### 5. Good/Base/Bad Cases

- Good: adopt a limited supernatural hearing ability while keeping `useSystem=false` and the existing template unchanged; Prompt includes the limitation and forbids a popup.
- Base: adopt an empty overview to record that the book has no cheat or special advantage.
- Bad: infer that every advantage is a system, auto-enable the UI, generate a template from the ability text, or treat template placeholders as new powers.

### 6. Tests Required

- Service: missing-file base, preview zero-write, stale candidate/current rejection, overview-only write, template/switch preservation, malformed overview and template byte preservation.
- IPC/planning: exact DTO, normalized SHA-256, stored-proposal re-read and adoption metadata tamper rejection.
- Prompt: overview is present; disabled template text is absent and prohibition is present; enabled template remains present.
- Electron E2E: real-click preview, confirm, check Chinese notice, exact saved overview, unchanged template/foundation, metadata and final action transition.

### 7. Wrong vs Correct

```ts
// Wrong: ability adoption silently chooses a UI and overwrites the author's format.
await workspace.saveFoundation({ ...foundation, useSystem: true })
await workspace.saveSystemTemplate(renderTemplate(candidate))

// Correct: the data owner adopts only the ability overview.
const preview = await planningPackages.previewCheatSystemAdoption(proposalId)
await planningPackages.adoptCheatSystem({
  proposalId,
  candidateFingerprint: preview.candidateFingerprint,
  currentFingerprint: preview.currentFingerprint
})
```

## Scenario: enforcing foundation-first planning adoption

### 1. Scope / Trigger

Use this contract whenever a complete planning proposal is previewed or adopted into per-book canon and whenever a foundation candidate is edited or re-adopted.

### 2. Signatures

```ts
PlanningPackageService.previewTotalAdoption(proposalId: string): Promise<PlanningTotalAdoptionPreview>
PlanningPackageService.adoptTotal(input: PlanningTotalAdoptionInput): Promise<PlanningTotalAdoptionResult>
```

### 3. Contracts

- `adoption.characterSeeds`, `worldSeed`, `powerSystem`, and `cheatSystem` MUST all exist before total-outline preview or adoption.
- Proposal generation MAY still produce the complete candidate package in one job; the rule orders canon adoption, not model calls.
- Main MUST enforce the same prerequisite set during preview and confirmation. Renderer visibility is not authorization.
- Total adoption MUST preserve all foundation adoption metadata.
- Editing or re-adopting any foundation candidate MUST invalidate `totalOutline`, `volumeStructure`, and `volumeOutlines` adoption metadata without deleting formal outline or manuscript files.

### 4. Validation & Error Matrix

| Case | Result | Write |
|---|---|---|
| Any foundation adoption missing | `CONFLICT` naming missing prerequisites | none |
| All four foundations adopted | total preview/adoption may continue through existing fingerprint checks | existing transaction only |
| Foundation candidate edited | clear its own marker and all downstream adoption markers | candidate autosave only |
| Foundation re-adopted after an old total-first flow | preserve foundation markers; clear downstream markers | target foundation only |
| Forged or stale adoption metadata | existing `CONFLICT` validation | none |

### 5. Good/Base/Bad Cases

- Good: confirm four editable foundation candidates, inspect total impact, then adopt the total outline.
- Base: a complete generated proposal remains fully editable before any item enters canon.
- Bad: hide the total button in Vue but allow direct IPC to adopt it, or rewrite/delete formal outlines when a foundation changes.

### 6. Tests Required

- Service integration: each missing prerequisite blocks preview; total adoption preserves all four foundation records.
- Service integration: foundation edit/re-adoption clears only downstream adoption metadata and preserves formal document bytes.
- Electron smoke: real clicks adopt character, world, power, and cheat candidates before the total action becomes available.

### 7. Wrong vs Correct

```ts
// Wrong: UI order is treated as the only gate and previous metadata is overwritten.
proposal.adoption = { totalOutline: adoptedTotal }

// Correct: main verifies prerequisites and preserves their provenance.
assertFoundationAdoptions(proposal)
proposal.adoption = {
  ...preserveFoundationAdoptions(proposal),
  totalOutline: adoptedTotal
}
```

## Scenario: generating a full-book lightweight chapter skeleton candidate

### 1. Scope / Trigger

Use this contract after every candidate volume outline has been adopted and formally confirmed, when the author asks to generate or regenerate the editable full-book chapter skeleton.

### 2. Signatures

```ts
ChapterSkeletonService.generate(proposalId: string, signal?: AbortSignal, onProgress?: ChapterSkeletonProgress): Promise<PlanningPackageProposal>
PlanningPackageService.storeChapterSkeleton(proposalId: string, skeleton: PlanningChapterSkeletonProposal): Promise<PlanningPackageProposal>
```

### 3. Contracts

- Main MUST verify the planned volume count, adopted current volume structure, confirmed total outline, and adopted+confirmed status of every candidate volume before and after generation.
- Generation MUST run per volume and MUST NOT persist until every volume succeeds; cancellation, invalid provider output, or an upstream change leaves the prior complete candidate untouched.
- Every entry MUST contain continuous global and per-volume order plus non-empty title, core event, characters, location, and result.
- The stored candidate MUST bind the current total-outline and complete volume-plan SHA-256 fingerprints.
- The skeleton MUST NOT create or update formal chapter outlines, ChapterContracts, chapters, or manuscript files.

### 4. Validation & Error Matrix

| Case | Result | Write |
|---|---|---|
| Total or any volume is not current and confirmed | `CONFLICT` naming the missing volume | none |
| Provider returns missing fields, wrong count, or discontinuous order | `AI_RESPONSE_INVALID` | none |
| Author cancels while a volume is running | job becomes `cancelled` | none |
| Proposal/profile/upstream changes during generation | `CONFLICT` | none |
| All volumes succeed and final Gate still matches | atomically replace `chapterSkeleton` candidate | proposal only |

### 5. Good/Base/Bad Cases

- Good: generate 30 chapters for each confirmed volume, inspect the entire causal skeleton, then edit candidate fields before detailed outlines.
- Base: regenerate an existing stale skeleton; the old complete skeleton remains readable until the replacement fully succeeds.
- Bad: save each model batch immediately, create formal chapter files from the skeleton, or treat participating characters as settled character state.

### 6. Tests Required

- Unit/integration: all confirmed volumes generate continuous global and local order; effective per-book chapter-outline prompt is injected.
- Unit/integration: missing confirmation, malformed JSON, wrong chapter count, cancellation, and late upstream changes produce zero partial writes.
- IPC/persistence: reject extra fields, invalid references, duplicate normalized character names, and forged fingerprints.
- Electron smoke: click through volume confirmation and skeleton generation, verify the configured chapter count and prove formal chapter outlines are unchanged.

### 7. Wrong vs Correct

```ts
// Wrong: each volume becomes partially authoritative as soon as the provider returns.
for (const volume of volumes) await save(await generate(volume))

// Correct: collect validated candidates, recheck every upstream gate, then save once.
const chapters = await generateAndValidateEveryVolume(signal)
await assertAllVolumesStillConfirmed()
await planningPackages.storeChapterSkeleton(proposalId, { basedOn, chapters })
```

## Scenario: per-volume detailed outline candidate

### 1. Boundary

详细章纲候选属于 planning draft，不是正式 `chapter-outlines`。每次生成仅处理一卷；模型批次是传输边界，整卷才是持久化事务边界。

### 2. Required anchors

候选卷必须绑定当前总纲、目标卷纲与本卷骨架三项指纹；章序、卷内章序和标题逐项继承骨架。保存前重新读取并复核，避免长任务覆盖作者刚完成的编辑。

### 3. Contract-shaped fields

每章必须包含进入状态、2–8 个顺序节拍、退出状态、1–12 个允许事实、1–12 个禁止事件与至多 8 个伏笔动作。候选可编译为现有章纲文本，但只有单独采用事务才能写入正式章纲。

### 4. Failure matrix

| Case | Result | Write |
|---|---|---|
| 骨架过期或目标卷未确认 | `CONFLICT` | none |
| 任一批字段残缺/章号不符 | `AI_RESPONSE_INVALID` | none |
| 取消或后置指纹变化 | cancelled / `CONFLICT` | preserve prior complete volume |
| 全部批次成功且 Gate 仍有效 | replace target volume detail candidate | proposal only |

### 5. Verification

服务测试必须证明整卷仅提交一次；Electron smoke 必须真实点击并证明正式章纲集合完全不变。

## Existing TXT takeover: diagnose before canon

- TXT preview is a zero-write, one-time-token operation. Main owns decoded bytes, parsed blocks, stable `sourceIndex` values and sequence diagnostics; renderer submits only token metadata and selected indexes.
- Chinese `卷/部/篇/集` headings are structural context, never manuscript chapters. A `第 N 节` heading requires an explicit title delimiter so prose such as “第一节课过去了” cannot split the manuscript. `章/回` remain the primary chapter forms.
- Default selection is only the unique, non-empty, consecutive prefix beginning at the first detected chapter. Duplicate, skipped, reversed, empty-title or empty-body blocks remain visible and unchecked for author review.
- Commit imports only selected owned-manuscript blocks, while archiving the exact original bytes and recording the selected indexes. It never silently repairs or renumbers ambiguous source blocks.
- `material` means the author's own related notes or rough continuation: bounded manual SourceCards in the current book, exact-byte archive, zero manuscript/event writes. `external` remains reference-only and outside automatic prompt context.
- Required tests: false heading regression, duplicate/jump/reverse sequence, strict IPC bounds and unknown fields, exact archive hash, material chunking/duplicate protection, and a real Electron click asserting diagnostics, selection count and the final Chinese success state.

## Scenario: unified imported material availability for AI candidates

### 1. Scope / Trigger

When a candidate generator requires author material, the book may contain typed author notes, imported work-related TXT cards, network research cards, or any supported combination. A single form field is not the material source of truth.

### 2. Signatures

```ts
WorkspaceService.hasPlanningMaterials(): Promise<boolean>
WorkspaceService.planningMaterials(): Promise<string>
WorkspaceService.promptContext(chapterId?: number, task?: AiTask): Promise<string>
FoundationDraftService.generate(): Promise<FoundationDraftProposal>
```

### 3. Contracts

- `hasPlanningMaterials()` is true when `FoundationData.sourceNotes` is non-empty or the current work item owns at least one validated `SourceCard`.
- Candidate services use the boolean method for the availability gate and `promptContext`/`planningMaterials` for bounded content; they do not read the research ledger themselves.
- Imported `manual` cards remain evidence, not canon. A successful generation returns a candidate and performs zero formal setting writes.
- Every material lookup is scoped through the current `ProjectService` work item; cards from another book are never a fallback.

### 4. Validation & Error Matrix

| Condition | Result | Formal write |
|---|---|---|
| no note and no source card | recoverable `VALIDATION_ERROR` | none |
| manual cards only | generation allowed with cards in context | none |
| damaged source ledger | existing `INVALID_PROJECT_STATE` | none |
| provider/auth failure | mapped AI error; imported files remain intact | none |

启动 bootstrap 可以捕获 `listSources()` 的错误并返回 `researchSourcesUnreadable`，但这不是存储层的空库回退：`createSource`、`updateSource`、采风入库、规划上下文和来源事件建立仍必须重新读取同一账本并拒绝写入。不得自动删除、移动或重建作者的 `sources.json`；独立 `events.json` 继续严格读取。

### 5. Good/Base/Bad Cases

- Good: import “作品相关.txt”, generate a world candidate, review it, then explicitly adopt it.
- Base: type one author note without importing a file; candidate generation continues to work.
- Bad: check only `foundation.sourceNotes`, then tell an author who imported 20 source cards that the book has no material.

### 6. Tests Required

- Service: manual SourceCards with an empty note pass the material gate and appear in the model context.
- Safety: the returned candidate does not change `foundation.json`, realms, system UI, outlines or manuscript.
- Isolation: switching books changes the material result; no cross-book card appears in context.
- Electron click: TXT-created work item explains the candidate boundary before confirmation.

### 7. Wrong vs Correct

```ts
// Wrong: one UI field is treated as the whole material library.
if (!foundation.sourceNotes.trim()) throw noMaterial()

// Correct: the workspace owner resolves every supported per-book source.
if (!(await workspace.hasPlanningMaterials())) throw noMaterial()
const context = await workspace.promptContext(undefined, 'outline')
```

## Per-chapter detailed-outline adoption

- `大纲/章纲/第N章.md` remains the only formal outline source. `adoption.chapterOutlines[]` is provenance metadata, not a second canonical copy.
- Preview is read-only. Confirmation updates one formal Markdown file and the chapter-placement ledger in the same serialized workspace mutation.
- Placement may exist before a manuscript; adoption must never create an empty chapter body as a side effect.
- Regenerating a volume clears receipts for that volume only; editing one candidate clears that chapter receipt; upstream planning changes clear all downstream receipts while preserving formal author files.

## Scenario: legacy project migration with ambiguous book identity

### 1. Scope / Trigger

Opening a recognized `.webnovel` work item whose schema is older than the current application. Migration is never part of ordinary current-project open.

### 2. Signatures

```ts
ProjectService.migrationPreview(): Promise<ProjectMigrationPreview>
ProjectService.migrate(): Promise<ProjectMigrationResult>
```

### 3. Contracts

- Preview is zero-write and lists stable evidence-backed issues.
- `blocker` means main must refuse migration after a fresh diagnostic; renderer button state is not authority.
- Safe migration first writes an exact manifest backup, then creates only deterministic modern configuration and an append-only migration receipt.
- Manuscript, outlines and legacy configuration are never deleted or rewritten by schema migration.

### 4. Validation & Error Matrix

| Condition | Result | Write |
|---|---|---|
| current schema | direct open | none |
| folder/manifest title mismatch | `CONFLICT` | none |
| duplicate manuscript chapter number | `CONFLICT` | none |
| future schema | `UNSUPPORTED_PROJECT_VERSION` | none |
| unambiguous legacy schema | backup + migrate | manifest/config only |

### 5. Good/Base/Bad Cases

- Good: matching title, unique chapters and legacy realms copy safely while originals remain.
- Base: current Lanjian work item opens without a migration ceremony.
- Bad: resolve cross-book pollution by trusting one filename or model guess and overwrite formal outlines.

### 6. Tests Required

- Exact bytes of manifest, outline and legacy config remain unchanged after blocked migration.
- Backup bytes exactly match the pre-migration manifest.
- Repeating a successful migration is idempotent.
- A production UI exposes evidence but never a force-through action.

### 7. Wrong vs Correct

```ts
// Wrong: schema age alone authorizes writes.
if (version < current) await rewriteEverything()

// Correct: ambiguity is diagnosed again at the write boundary.
const preview = await migrationPreview()
if (!preview.canMigrate) throw conflict()
await backupThenMigrateDeterministicFields()
```

## Imported-work continuation candidates

- Completed import staging remains the evidence source for continuation analysis. Verify every staged file against its journal SHA-256 before model use.
- Existing-plot adoption is event-granular: require evidence-backed candidate content plus author-confirmed time/characters/location/event, then re-read candidate and timeline and compare both fingerprints. Use a deterministic event ID so a crash between timeline persistence and receipt persistence can be recovered without duplicating canon.
- Persist the structured candidate outside formal config, outlines, character state and manuscript. Candidate save APIs may update editable candidate text only.
- `found` and `conflict` model claims require an exact excerpt locatable in a confirmed file. Project definition, existing plot and characters are hard-gap areas; the model cannot downgrade them.
- A malformed candidate is not a missing optional file. Preserve its bytes, return a blocked read state so the work item can still open, and reject regeneration that would overwrite it.
- Imported-character adoption is person-granular. Require exact file evidence plus author-confirmed `name/role/arcSeed`, then compare the section, seed and current-anchor fingerprints at confirmation.
- A continuation character may update stable `name/role/arcSeed/sourceRefs` only. Never replace prose-derived character events, snapshots or pending conflicts with an import summary; a deterministic continuation source ref supports retry after an anchor-write/receipt-write interruption.
- Imported world-view adoption is one-field and evidence-backed. Compare the candidate digest and the full current Foundation digest, then serialize a write that replaces only `worldView`; never infer realm levels, toggle realm/system flags, or rewrite power/cheat stores from the same summary.
- Imported power-system adoption is an evidence-backed overview-only write. Compare the candidate digest and current `PowerSystemData` digest, then serialize replacement of `overview` only; never derive realm rows, toggle `useRealms`, or rewrite world/cheat/system-template stores from the same summary.
- Imported cheat/special-advantage adoption is an evidence-backed overview-only write. Compare the candidate digest and current `CheatSystemData` digest, then serialize replacement of `overview` only; never toggle `useSystem`, synthesize a display template, or rewrite world/power/realm stores from the same summary.
- Imported total-outline adoption requires all six evidence-backed continuation receipts. Bind those receipts and the current formal profile, timeline, character anchors, foundation, power and cheat facts into one prerequisite digest; compare it together with candidate and current-outline digests at commit time.
- The total-outline adoption transaction may update only the total-outline document and its revision ledger. Adoption is not confirmation: keep total approval reviewable and never create, delete or rewrite volume outlines, chapter outlines or manuscript chapters as a side effect.

## Damaged formal event ledger

- `.webnovel/research/events.json` must distinguish missing from damaged: only `ENOENT` may produce an in-memory empty store; JSON or schema failure is `INVALID_PROJECT_STATE`.
- `listEvents`, candidate creation, conflict updates and approval must reuse the same strict reader. A bootstrap `researchEventsUnreadable` projection keeps unrelated manuscript UI readable but is never a storage fallback.
- While damaged, do not overwrite, clear, move or rebuild the ledger. Direct author chronicles remain independent and must not be presented as approved source-backed events.

## Damaged outline version ledger

- `.webnovel/planning/outline-state.json` is formal revision and approval state. Validate it independently during bootstrap; do not call a composed planning projection whose downstream event failure could be mislabeled as an outline-ledger failure.
- A damaged ledger may leave manuscript and raw outline documents readable, but every planning mutation, confirmation, chapter contract and AI path must continue to fail closed. Never synthesize an empty `OutlineState` for an existing malformed file.
- File-manager assistance accepts a fixed bootstrap issue identifier only. Main maps that identifier to a fixed current-project relative path, passes it through the canonical project/link guard, and exposes no arbitrary renderer-supplied file path.

## Damaged chapter-order ledger

- `chapter-order.json` v1 is intentionally sparse: ignore recorded IDs whose files were deleted and append newly created physical IDs in memory without writing. These normal states are not corruption and must remain backward compatible.
- Existing JSON/schema corruption is `INVALID_PROJECT_STATE` with `details.area = chapterOrder`. Bootstrap may catch only that exact subtype and enumerate independent manuscript files by stable numeric ID as a read-only inventory; the inventory order has no narrative meaning.
- Duplicate physical stable IDs remain a hard failure because a strong `Chapter` projection cannot preserve both without ambiguity. Never select, rename, move or overwrite one automatically.
- While the ledger is damaged, every manuscript or ordering mutation must continue through the strict reader and fail closed. Do not repair, clear or rewrite the ledger, and do not modify title/content/history files.
- File-manager assistance follows the fixed issue-ID-to-current-project-path mapping and may reveal only `.webnovel/manuscript/chapter-order.json`.

## Chapter-scoped local fact pack

- `LocalRetrievalService` receives the current project port and `DocumentService`; it may read only saved chapters whose projected display position is before the target chapter.
- Capture canonical project path and work-item ID before the asynchronous manuscript read, then verify the path again after it. A switch during assembly is `CONFLICT`, never a partial or cross-book result.
- Query terms come from values in the current chapter outline, volume outline, assigned canonical events and pre-chapter character snapshots. Do not stringify DTOs into a keyword query.
- Each evidence item carries stable chapter ID, display position, title, manuscript SHA-256, exact excerpt, match reason and score. The final compact evidence text, including metadata, is counted against the 2400-character budget.
- The pack is disposable projection data: no model call, no persistent index and no canon write. Prompt assembly places it after all formal facts with a dedicated untrusted-manuscript boundary.
- For long books, `DocumentService.manuscriptRevision()` hashes legal chapter filename/size/high-resolution mtime plus the small chapter-order ledger. `LocalRetrievalService` may retain one in-process current-book snapshot keyed by this revision.
- A cache miss reads the complete chapter projection between two revision reads. If they differ, return a recoverable conflict and never cache or emit the mixed snapshot. The cache is not persisted and never bypasses per-evidence content SHA-256.
- Renderer-visible formal events and pre-chapter character state must be projected by `WorkspaceService` from that same verified context snapshot. Do not make the renderer rebuild canon through a second read path.
- Include stable event/person IDs, event provenance/evidence, `throughChapter` and `lastEventId`; exclude unassigned events and any character state from the current or a future chapter. Keep the DTO read-only, non-persistent and bounded to 500 events / 200 characters.

## Scenario: SQLite-authoritative manuscript with readable mirrors

### 1. Authority boundary

- `projects.storage_mode` is the only authority selector. `shadow` means current Markdown/JSON remain authoritative; `sqlite` means chapter bodies, titles, order and history are authoritative in SQLite.
- Renderer, preload and downstream writing services continue through `DocumentService`. Only main may attach `ManuscriptAuthority`; pages must not query SQLite or implement a parallel chapter repository.
- Ordinary project open may read an existing database mode but must never create, import or activate one. Shadow creation and formal activation are separate explicit ceremonies with independent 15-minute, one-use, work-item-bound UUID tokens.

### 2. Commit and mirror order

1. Validate stable chapter ID, expected SQLite revision and current storage mode.
2. In one SQLite transaction append a `body_versions` row when title/body changes, update the current pointer/order/archive state, and mark the affected mirror plan `pending` with its previous managed path/hash.
3. Commit SQLite first. Only then atomically write the Markdown body or canonical `.webnovel/manuscript/chapter-order.json`.
4. Before touching an existing mirror, compare its exact current hash to the last observed managed hash. If it changed, preserve it and mark `conflict`.
5. A mirror I/O error marks `failed`; it never rolls back or hides the committed SQLite chapter. The editor must say that the database save succeeded while the readable mirror needs attention.

### 3. History, rename and delete

- `body_versions` is append-only. Version metadata stores the title and reason that belonged to each body version; restore appends a new `restore` version rather than moving the current pointer backward.
- A title rename writes the new target first and removes the previous managed path only after its hash is proven unchanged.
- Chapter deletion archives the SQLite chapter, moves the unchanged managed Markdown file through the system trash adapter, and writes the new canonical order mirror. It does not delete body history.

### 4. Safe rollback

Rollback from `sqlite` to `shadow` is allowed only when:

- every mirror entry is `synced`;
- every active chapter mirror hash equals its current SQLite content hash;
- the set of parseable chapter files in `正文/` exactly equals the active managed mirror set;
- the canonical order JSON exactly equals the active SQLite chapter order.

If any check fails, return recoverable `CONFLICT` and keep SQLite authoritative. Successful rollback records a storage transition and changes only the mode to `shadow`; the database remains as a rebuildable shadow copy.

### 5. Schema evolution and tests

- `PRAGMA user_version` and checksum-validated `schema_migrations` must advance sequentially. Version 2 adds body-version metadata, previous mirror state and storage transitions; version 3 adds isolated AI task runs and generation artifacts. A real v1 fixture must migrate through every version in place with history intact.
- Required temporary-work-item tests cover save, rename, reorder, restore, delete/trash, external mirror conflict, manual reconciliation, rollback refusal, successful rollback, reactivation and v1→v2 migration.
- Production Electron smoke must click shadow creation, formal preview, activation and rollback, prove the settings page has no assistant sidebar or width compression, and continue through the existing desktop workflow afterward.

## Scenario: verified workspace backup and restore-as-copy

### 1. Backup contract

- Never copy an active `.webnovel/workspace.sqlite`, `-wal` or `-shm` as ordinary files. Open the current per-book database through the shared factory and execute SQLite `VACUUM INTO` to a missing staging target.
- Copy all other regular project files with their relative paths. Reject symlinks, junction escapes and special files. Record size and SHA-256 for every copied project file and the SQLite snapshot in versioned `lanjian-backup.json`.
- Scan the authoritative source files before copying and again immediately before publish. Any difference cancels the backup and removes staging; a backup is visible at its final path only after manifest, file inventory, hashes, schema, `quick_check`, foreign keys and active chapter count all agree.
- Backups live outside the current project. A sibling directory under the same parent is valid; a target inside the current project is not.

### 2. Restore contract

- Restore preview is zero-write. It bounds manifest size, file count and declared sizes, rejects invalid or duplicate relative paths, hashes the exact backup inventory and opens the snapshot read-only for integrity checks.
- A successful preview returns only a safe summary and a 15-minute, one-use, current-work-item-bound UUID. Renderer never supplies backup paths, destination paths, hashes or SQL to the commit endpoint; main owns both directory pickers.
- Commit consumes the token before writes, re-verifies the backup and its manifest fingerprint, then copies exact files into a random staging directory under the chosen destination parent.
- Restore always creates a new timestamped project copy. Rewrite only the copy's project title/updated time and matching SQLite project identity; reopen and inspect the database before atomically renaming staging to the final folder and registering it on the shelf.
- Never overwrite the source project or backup. On any copy, validation or database error, delete only the already-validated staging path and leave the current project selected and unchanged.

### 3. Required tests

- Active WAL snapshot, readable files, body-history count and absence of SQLite sidecars/secrets.
- Preview tree fingerprint unchanged before/after.
- Corruption before preview and mutation after preview both reject restoration; the token cannot be replayed and the destination stays empty.
- Successful restore proves original bytes unchanged, new state/DB title agreement, preserved storage mode/history and normal `ProjectService` import.
- Electron smoke clicks create, preview and restore, verifies the centered no-assistant modal and confirms the app opens a different new-copy path.

## Scenario: persistent writing-agent task runs and artifacts

- Store task lifecycle in `task_runs`, separate from chapter status and Artifact approval. Enforce project-scoped idempotency, chapter ownership, legal forward-only transitions, attempts and parent runs in the database port/main service rather than renderer state.
- Store complete model output in `generation_artifacts` before marking the task succeeded. Verify SHA-256 on insert and read; never overwrite a different Artifact for the same task/type.
- Applying or discarding an Artifact updates only its decision status and bounded metadata. It does not write a body version; the editor and manuscript save queue remain the only path to formal正文.
- When that editor draft is explicitly saved as an AI version, `body_versions.source_task_run_id` may reference only a succeeded same-chapter task with an applied Artifact. Validate at IPC/service level and enforce again with a schema trigger; clear pending provenance if the author reverts to the saved正文 before persistence.
- On process startup/open, convert orphaned queued/preparing/running/streaming rows to interrupted. Retry creates a child run from the frozen checkpoint request with a new operation UUID and incremented attempt.
- Graceful project switching persists cancellation; application shutdown aborts network only so the next process can truthfully classify unfinished work as interrupted.
- Required tests cover v1→v2→v3 migration, idempotency collision, illegal transitions, immutable/hash-checked Artifact, cancel, retry parentage, restart interruption, renderer recovery and real Electron stop→retry flow.

## Scenario: SQLite-authoritative outline hierarchy with readable Markdown

- Schema v6 stores total, volume and chapter outlines in `outline_nodes`; every changed outline appends an immutable `outline_versions` row and advances the node's current pointer in the same transaction.
- Stable keys are `total`, `volume-N` and `chapter-N`. Total-to-volume parentage is persisted; chapter IDs remain stable and their volume placement continues to come from the existing planning ledger until that ledger is migrated as one coherent unit.
- Shadow import scans outlines before and after the manuscript snapshot, includes outline hashes/paths in the source fingerprint, and verifies node type, parent, sequence, content/hash, version pointer and mirror record after commit.
- `projects.outline_storage_ready` is a compatibility gate. A migrated v5 formal database defaults to false and must keep Markdown outline authority; only an explicit complete import sets it true. Never replace an existing book's outlines with an empty SQLite projection.
- In formal mode, `DocumentService` remains the only outline entry point and delegates through `ManuscriptAuthority`. SQLite commits first; Markdown is a readable mirror. External mirror changes produce `conflict` without overwrite.
- Safe rollback additionally requires every active outline mirror hash and the complete managed outline Markdown inventory to match SQLite. Settings and the outline status bar expose pending/conflict/failed mirrors without adding a right-side settings panel or removing the resizable left story tree.
- Required tests cover v1→v6 migration, exact shadow import, formal reads independent of changed Markdown, version append, external conflict, retry, rollback refusal and successful file-mode recovery.

### Next-layer candidate adoption transaction

- A next-layer append checks the saved parent revision and direct-child identities inside the write transaction. Changed parent/directory means a recoverable conflict, never an implicit refreshed confirmation.
- Append only immediate children (summary→volume→stage→chapter), never grandchildren, existing identities or archived nodes. Existing manuscripts remain untouched.
- Call the internal outline writer within one outer transaction: failure on any child must roll back all new nodes, versions and mirror entries. Do not loop over public independently committed write methods.
- This database primitive is not a renderer API. Main must supply a validated, current-book candidate plan behind explicit preview/confirmation and durable adoption provenance before exposing the feature.
- Adoption writes source task/artifact/child index to node metadata and marks the Artifact applied with target keys in the same transaction, including the updated candidate JSON mirror queue. A consumed preview or an applied candidate must never allocate another batch after a lost response. File synchronization failure after commit is reported as mirror-pending, not as an uncommitted adoption.
- Allocate identities above existing and archived keys; chapter-outline allocation also reserves manuscript IDs. Preview expiry, project switching, changed directory and parent revisions reject before writes; successful adoption retains all four event dimensions in readable Markdown.

### Standalone chapter outline editing

- Formal chapter outlines can exist without manuscript rows. OutlineList exposes their identity/title/revision/parent and hasManuscript flag without including all outline text. Do not create empty manuscripts to make the tree render.
- Explicit standalone save requires an existing node, expected revision and no corresponding manuscript. Preserve parent/sequence/provenance; append the outline version and synchronize its readable mirror. A manuscript appearing since open makes standalone save conflict and hands navigation back to the existing manuscript-associated outline flow.
- Unknown or archived identities are NOT_FOUND, not empty editable documents. Mirror conflict leaves the external file untouched and returns the committed SQLite state with its mirror status.

### Explicit standalone-outline to manuscript handoff

- Reading, editing or adopting standalone outlines never creates manuscripts. An explicit start confirms the saved revision and creates the same stable chapter identity with empty content; the source outline, parent and provenance remain unchanged. Existing bodies are returned unchanged on retry; archived bodies are not resurrected.
- OutlinePlanningService owns the cross-store handoff. Persist a bounded identity/revision/volume receipt in the existing planning ledger before SQLite creation, then persist placement and receipt completion together. A retry after SQLite commit finishes the pending placement without changing body text or adding versions. A malformed receipt fails closed; a legacy missing receipt list normalizes to empty.
- Completed receipts never reapply placement. Explicit author placement (including a no-op unassignment) completes a pending receipt, so restart/retry cannot undo that choice. Do not use missing placement as unconditional permission to copy the outline parent.
- Pin the original project path for intent/final ledger writes and pass the captured work item to DocumentService before body creation. Do not send a renderer-supplied path. This handoff does not confirm chapter outlines or bypass chapter-contract checks.

### Ordinary manuscript identity allocation

- The ordinary new-chapter UI calls a no-argument chapters:create endpoint; it must not infer the next identity from its visible manuscript list. Explicitly starting an existing outline remains a separate operation.
- In SQLite mode, reserve all manuscript identities and all chapter outline keys, including archived rows, then create the new body inside the same transaction. Append its logical position independently of its stable identity. Allocation failure rolls back the new chapter and version.
- File-mode allocation serializes ordinary creation and includes manuscript filenames, standalone outline filenames and retained chapter-history directories. Missing directories are allowed; unreadable directories must not be treated as empty.
- In upgraded mixed mode (`storage_mode=sqlite`, `outline_storage_ready=0`), Markdown outlines still own their identities. DocumentService scans those filenames and retained legacy history, then supplies an internal validated minimum identity to the SQLite allocator. The allocator still reserves its own rows in-transaction. No renderer minimum/path input and no implicit outline migration are allowed.
- Test concurrent calls for distinct reserved-safe identities, not Promise result order; project-path resolution can complete in a different order. Verify archived rows and source outlines are unchanged, and exercise the real new-chapter button with a reserved outline above the last manuscript ID.
