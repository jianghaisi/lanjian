# V3 planning and event consistency

> Status: `verified-current` contract. Authority: V3 product baseline and approved `09-10-v3-timeline-outline-consistency`. Slice 1 owns event version/source foundations only; later-slice behavior below is required design, not a completion claim.

## 1. Scope / Trigger

Apply to event creation/approval/versioning, chronology migration, outline source dependencies, chapter-detail adoption and body-derived settlement. All work remains book-local. Read the V3 data safety and runtime contracts before implementation.

## 2. Signatures and records

- Stable event ID identifies an event, never a mutable content signature or chapter display position.
- An event version identifies immutable content, approval state, granularity, story phase, source creator, evidence and exact source revisions.
- A story revision reference binds `{ kind, id, revision }` inside one authoritative project. Cross-project IDs or a missing revision are invalid.
- Provenance relations include `derived-from`, `refines`, `realizes`, `deviates-from`, `supersedes`; they describe origin and evolution. A separate dependency manifest selects which revisions govern freshness.
- A dependency result distinguishes `current`, `stale`, `untracked` and `upstream-review-required`; no renderer flag authorizes writes.

Slice-1 internal database port (runtime implementation is verified by the child task):

```ts
listCanonicalEventVersions(eventId: string): StoryEventVersion[]
canonicalEventVersionHeads(eventId: string): StoryEventVersionHeads | null
baselineCanonicalEventVersions(): StoryEventVersion[]
appendCanonicalEventVersion(input: AppendStoryEventVersionInput): WorkspaceCanonicalEventVersionWriteResult
```

The append result is `{ version, heads: { latestVersionId, approvedVersionId }, mirror }`. The approved head is nullable until an author-approved version exists. `mirror` is a pending post-commit sync plan or `null`, not evidence that a file was already written. An event with no versions yet returns an empty version list and null heads; an unknown event ID is a safe not-found failure.

`AppendStoryEventVersionInput` binds `eventId`, `expectedVersionId`, content, approval status, story phase, granularity, creator and exact source refs. `expectedVersionId` compares the latest stored version head, including a pending candidate, inside the write transaction; it does not compare only the last approved head. The internal method receives trusted application decisions; it is not an author-approval UI or public IPC. Future IPC must bind a one-time reviewed preview rather than expose free-form authority flags.

Source revision meanings: material = exact content hash; event = immutable event version ID; outline/body = persisted version ID. A retained historical outline/body/event version may be a valid origin even after its head moves; origin validity does not prove current freshness. Material has no append-only source version owner yet: a new versioned material link must match its available hash, and later reads preserve that historic hash. Legacy evidence retains its original source ID/excerpt without guessing a material hash at baseline time. The domain can describe chapter-skeleton refs, but this slice rejects them at persistence until formal skeleton versions exist. Missing or unsupported refs are never retained as if verified.

Schema 38 extends the existing canonical event authority with `canonical_event_versions`, `canonical_event_version_sources`, `canonical_event_version_seals` and `canonical_event_version_heads`; it leaves earlier migration checksums unchanged. A version payload hash binds its ordered evidence and origin references. Sources must exactly match the payload and are sealed before a head may reference that version; after sealing, INSERT as well as UPDATE/DELETE of sources is rejected. No renderer API is added in this slice.

Schema 39 now removes only canonical content-signature uniqueness, preserving rows, rowids, history, dependencies and all earlier migration checksums. It prepares distinct equal-content identities; it does not perform reviewed content migration or mark modules ready. Legacy create/adoption keeps explicit duplicate rejection. Load the [identity schema contract](v3-event-identity-schema.md) for the guarded rebuild, old/current read checks and rollback/runtime evidence.

The later slice-2 [display metadata contract](v3-event-display-metadata.md) adds optional version-bound `title` and `rawCharacters` to the existing immutable payload, without changing schema 39 or old absent-field JSON/hashes. Shared validation also governs direct migration review. Legacy compatibility rows/mirrors remain limited views; unified consumers and reviewed content migration are not completed by these fields.

Current writable schema 40 adds empty source-alias/receipt/seal/module-pointer tables under the [receipt storage contract](v3-event-migration-receipts.md). Same-book target/version, mapping-count and append-only guards are structural backstops only. The [private decision/session contract](v3-event-migration-decisions.md) adds all-row decisions, limited links and a one-use pre-commit grant, not the reviewed writer, verified receipt reader or consumer switch. Migrations 1–39 are unchanged; readonly-39 inspection never upgrades.

## 3. Contracts

### Event identity, history and approval

- Append-only content versions and provenance retain prior values; restore creates a new version. A head pointer may reference only a version of the same event and project.
- Candidate existence grants no formal authority. Explicit approval preserves candidate history and creates/selects an approved revision inside one transaction.
- Append concurrency compares `latestVersionId`, including pending candidates. Formal projections and later freshness propagation compare `approvedVersionId`; candidate-only appends do not invalidate an artifact that consumes the unchanged approved revision.
- Plan approval never proves realization in prose. Story phase (`planned`, `realized`, `deviated`) and approval (`candidate`, `approved`) are different dimensions.
- Legacy records whose origin, phase or granularity cannot be proven retain `legacy-unknown`; migration never invents manuscript evidence.
- Binding an event as a new version's source verifies that source's retained history, payload hash and head/chain integrity; a present ID plus seal is not sufficient evidence of intact content.
- Refining a macro event may create linked child events. Do not replace one macro identity with every small scene or discard its boundaries.

### Compatibility and migrations

- Schema upgrade may install empty structures, but opening/previewing a book does not baseline versioned event history or merge legacy direct chronology.
- Version-1 baseline of existing canonical rows is an explicit, idempotent transaction. Preserve IDs, characters in source order, exact four-dimension text, optional result, status and evidence excerpts.
- Slice-2 read separation supersedes the slice-1 compatibility evidence: `ResearchLibraryService.listSources/listEvents/searchSources` and `WorkspaceService.timeline` must not call lazy imports or mirror synchronization. Legacy explicit-write preparation can still import compatible rows, without treating that import as author consent for unified-module migration or a version baseline.
- Baseline does not change legacy event mirrors or outline/body bytes. Converting `timeline.json` into the unified event authority requires the later slice's author-reviewed migration.
- Existing create/approve writes capture their event history in the same transaction and retain compatible results. Failure leaves no partial version, source edge or pointer update.
- The legacy ID-only approve entry is idempotent for an already-approved canonical identity. It must not approve a newer unseen candidate behind that projection; revision-bound adoption of such a change belongs to an explicit reviewed write.
- For versioned events, the compatible canonical row must exactly match the selected approved version (or latest candidate when no approved version exists), including ordered characters/evidence and an explicitly empty result. A projection/history mismatch blocks formal reads and further appends; head existence alone does not authorize missing evidence.

### Chapter/outline integration — later slices

- The creative hierarchy remains total → volume → full-book skeleton → chapter outline → prose. Macro, detailed planned and realized timelines are projections of the same event axis.
- Artifact dependency manifests contain exact revisions actually used for generation/review. Gate and prompt consume the same manifest and source revisions.
- Adoption previews chapter outline plus selected event changes; one transaction commits outline version, event versions, provenance and dependencies. The new chapter binds the new event versions and remains current, but still needs its separate formal confirmation.
- Provenance does not imply freshness dependency. A new event may cite the adopted chapter for origin while that chapter consumes the event content; this must not become a recursive invalidation cycle.
- A proposed chapter cannot retain a material planned event which the author rejected from the joint adoption. Rebuild the reviewed candidate or block the inconsistent selection; never silently grant canon to leftover prose.
- Source changes propagate only through explicit dependencies. A new event must also be checked against affected chronology/entity scopes so omitted ID links cannot falsely prove no conflict. Unknown impact remains a review item, not a green success.
- Deterministic checks cover explicit ordering, IDs, revisions and structured constraints. Free-text causal or character contradictions need model/author review; model output remains a candidate. No algorithm claims complete semantic proof.
- Story chronology, narration order and knowledge availability are distinct. Rewriting an early narrated chapter must not inject later acquired knowledge merely because a timestamp sorts earlier.

### Realization — later slices

- Actual-event candidates bind exact manuscript versions and quotations; approval links them to planned events by realization/deviation or records genuinely new events.
- Retain the plan revision when actual outcomes differ. A change to the source manuscript invalidates derived settlement, preserving its history.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Invalid field, enum, reference or bounds | Reject before mutation with safe validation error |
| Stale expected latest version or write-preview/dependency snapshot | Conflict; zero partial writes; a retained historical origin is not itself a stale-write conflict |
| Missing source revision / wrong project or event | Fail closed; no dangling source/head |
| Candidate head used as approved | Reject; no formal projection change |
| Version/source UPDATE or DELETE | Database invariant rejects mutation |
| Corrupt history / mismatched version content | Safe integrity failure, never empty-success |
| Baseline repeated with unchanged legacy records | Same baseline/history, no duplicates |
| Later direct-chronology mirror conflict | Preserve source and request migration review |
| Mirror fails after formal event commit | Keep formal history and report sync failure separately |

## 5. Good / Base / Bad Cases

- Good: approve a candidate and query both the original candidate and approved history; exact old source excerpts are still available.
- Base: opening a pre-version book leaves event rows and mirror bytes unchanged; an explicit baseline can preserve its unknown phase.
- Bad: advance the total-outline revision for every new scene, mark every chapter stale, or mark an approved plan as already realized.
- Later-slice good: chapter 12 introduces a child event within its macro boundary; joint adoption binds its new version. A conflicting change to chapter 20's consumed event affects chapter 20 and its actual dependents, not every chapter by position.

## 6. Tests Required

Slice 1: pure validation; fresh schema and old-schema upgrade; explicit baseline/idempotency; create→approve history; expected-version conflict; missing/cross-project source; update/delete/head guards; injected rollback; retained candidate status; original mirror/text bytes; corruption and reopen checks. Run typecheck and production build.

Later slices must additionally verify chapter/event atomic adoption, transitive dependency scope, no self-stale, rejected event selection, new-event chronology conflicts, narrative/knowledge ordering and body-version invalidation through real Electron flows. These gates remain unfulfilled by schema-only tests.

## 7. Wrong vs Correct

```ts
// Wrong: provenance alone creates an invalidation cycle.
dependencies.add(event.originChapter)
totalRevision++ // Every small scene invalidates the whole book.

// Correct: origins and inputs have separate purposes.
event.sources = verifiedOriginRefs
chapter.dependencies = confirmedInputsAtCommit
// Later propagation consumes only explicit, scoped dependency edges.
```

## 8. Slice-2 increment: source-preserving event reads

### 1. Scope / Trigger

Applies to the dedicated timeline/research read entries, the new SQLite event-inspection port and aggregate bootstrap's event/source/timeline preservation boundary. Compatibility getters now synchronize only their own mirror scope, so opening a book does not flush pending event mirrors through chapter/configuration reads. This does **not** make the entire bootstrap zero-write: unrelated modules still open writable connections and maintain their own compatibility data. Migration authorization, receipts, unified consumers and IPC remain unimplemented; slice-2 AC1 is still open. Section 9 adds the private retained source acquisition foundation, not migration/generation integration.

### 2. Signatures

```ts
WorkspaceDatabaseFactory.openEventReadOnly?(workItemId: string): Promise<WorkspaceEventReadPort | null>
SqliteManuscriptService.readMaterialSources(workItemId: string): Promise<SourceCard[] | null>
SqliteManuscriptService.readCanonicalEvents(workItemId: string): Promise<CanonicalEvent[] | null>
SqliteManuscriptService.readTimelineConfig(workItemId: string): Promise<{ content: string; contentHash: string } | null>

// Internal service helper; scope is mandatory, never implicitly whole-book.
type MirrorSyncScope = 'all' | { sourceTypes: readonly WorkspaceMirrorPlan['sourceType'][]; sourceId?: string }
syncPending(workItemId: string, database: WorkspaceDatabasePort, scope: MirrorSyncScope): Promise<void>
```

The port exposes only schema/project identity, readiness, source/event/history/config reads, mirror **records** and idempotent close. It is a frozen facade, not the underlying write-capable database object. A missing optional adapter capability fails closed; never fall back to `openExisting`.

### 3. Contracts

- A missing database returns null and stays absent. A nonformal/unready module returns null for its existing contained legacy file authority; a ready-but-empty module returns an empty value, not null. Ready SQLite data wins over a missing or externally edited JSON mirror; reads do not repair, acknowledge or overwrite that mirror.
- Inspection validates the recorded migration chain without applying it. Pre-38 canonical history is empty/null only for an existing same-book event, never invented by a read. Current-schema reads retain history/seal/projection validation. Earlier migration SQL/checksums are unchanged.
- SQLite `readOnly` can still create WAL sidecars. `event-read-snapshot.ts` instead copies DB plus any WAL into an owned OS-temporary directory, verifies source-before/copied/source-after SHA-256 and size, then opens only that private copy read-only. Do not open the author DB just to discover its journal mode. Never discard WAL or use an immutable-file assumption on a live source.
- Validate final DB/WAL/journal paths and their real containment, not just their parent folder. A nonempty rollback journal is a recovery conflict, not an instruction to recover or delete it.
- Acquisition waits in the existing same-book write lane; this grants no write capability. A changing acquisition may retry at most three fresh attempts. This is **initial read acquisition only**, not permission to refresh a reviewed commit's fingerprint or retry a write.
- Close removes only the known private snapshot files, once. Unknown scratch contents are preserved; cleanup failure can leave local scratch data. No credentials are copied; the local DB can contain novel text, so scratch paths/content must not cross IPC or logs. This is not a verified-backup/distributed-atomicity API.
- Legacy timeline row types are checked without normalization or deduplication. Duplicate IDs, whitespace, explicitly empty result and unknown row fields remain intact. Invalid JSON/row types fail rather than becoming an empty timeline or being overwritten by ordinary save.
- Individual source/event reads currently acquire separate snapshots. They are not yet the single retained request snapshot required by migration and generation; later use cases must read all governing records through one port and bind the result to the current work item.
- Compatibility mirror scope is explicit at every `syncPending` call. Chapter reads select `chapter_markdown` / `chapter_order_json`; AI settings, outline-planning state and character state select only their respective mirror types. `workspaceConfig(kind)` also matches `sourceId === kind`: filtering by `workspace_config_json` alone would still flush timeline during a realm read. Legacy source/event write-preparation getters select only their respective type; dedicated read entries never invoke this helper.
- Opening a book preserves event/source/timeline readiness, rows, versions, mirror states and original JSON bytes, including missing files, external edits and existing pending/conflict/failed states. It neither retries nor acknowledges those event mirrors. Explicit legacy write/recovery operations retain their existing whole-book synchronization where already present (`deleteChapter`, `restoreChapter`, `startPlannedChapter`, activation, mirror retry/rebuild and rollback); this increment does not widen those operations or claim they are reads. No public IPC or environment option is added.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing DB and no recovery sidecars | Null; no DB, directory or mirror creation |
| Unsupported/newer schema | `UNSUPPORTED_PROJECT_VERSION`; no upgrade |
| Migration checksum/identity/history corruption | Safe integrity/migration failure; no empty success |
| Copy race, orphan WAL, nonempty rollback journal | `CONFLICT`; no source cleanup or recovery |
| Final file/sidecar/parent escapes project | `PATH_ESCAPE` before opening that target |
| Missing read adapter | `FEATURE_UNAVAILABLE`; no writable fallback |
| Corrupt legacy JSON or timeline row type | `INVALID_PROJECT_STATE`; original bytes retained |
| Book switched during a successful read | `CONFLICT`; late value rejected |
| Unselected event mirror is pending/conflict/failed | Preserve status and source bytes; no sync attempt from sibling getter |
| Legacy source/event JSON is malformed during bootstrap | Preserve bytes/readiness; existing named `researchSourcesUnreadable` / `researchEventsUnreadable` issue, not silent empty-success |

### 5. Good / Base / Bad Cases

- Good: approved schema-25 event stays readable with no event versions and the same schema/file hashes.
- Base: ready event DB plus externally edited JSON returns DB events without touching the external text or mirror status.
- Aggregate good: first and repeated book loads leave all three pending event/source/timeline mirrors untouched; an explicit mirror retry still synchronizes them without creating event history.
- Bad: reading an empty old book marks its event module migrated, recreates a missing mirror, or treats a candidate as approved.

### 6. Tests Required

`event-read-boundary.test.ts` covers absent/old/current authority, exact source hashes, live committed WAL and invisible uncommitted rows, copy/sidecar races, recovery conflicts, path escape, cleanup idempotence, missing capability, book change, write-lane serialization and 5,000 retained source occurrences. For a live Windows writer, raw SHM bytes are OS-locked: assert DB/WAL bytes plus SHM metadata/directory membership; all non-live fixtures hash every source file. Retain foundation/bootstrap/timeline and expanded persistence/consumer regression. A small DB timing sample is not large-novel responsiveness or paged-migration acceptance.

`event-bootstrap-boundary.test.ts` composes actual database-backed project identity, shared write lane, document/configuration/research/planning services and bootstrap. Test cold/warm loads, missing/edited mirrors, pending/conflict/failed states, file/unmigrated SQLite authority, absent ledgers and malformed research ledgers. Assert original event-file bytes, readiness, event/source/config records and version history, plus successful explicit mirror retry. Do not use a whole-DB-byte invariant here: unrelated compatibility modules still write. Provider fakes in the existing bootstrap unit tests are not a substitute for this real-storage boundary, nor is this service test a real Electron acceptance test.

### 7. Wrong vs Correct

```ts
// Wrong: may upgrade, import or create source-side WAL/SHM during inspection.
const db = await factory.openExisting(book)
await service.materialSources(book) // legacy write-preparation entry

// Correct: optional read capability is checked by the service, with no fallback.
const sources = await service.readMaterialSources(book)
// null selects the retained legacy source; [] means a ready, empty formal module.

// Wrong: realm reads also match timeline when only the mirror type is selected.
await this.syncPending(book, db, { sourceTypes: ['workspace_config_json'] })
// Correct: compatibility configuration repair stays within the requested kind.
await this.syncPending(book, db, { sourceTypes: ['workspace_config_json'], sourceId: kind })
```

## 9. Slice-2 increment: retained event-source acquisition

### 1. Scope / Trigger

The private `EventSourceSnapshotService` and `LocalEventSourceSnapshotReader` prepare one retained source read for the private review owner. They are not wired to renderer/IPC or generation yet and grant no migration/approval authority. Current writable schema is 40; retained reads never upgrade old databases. Receipt/module evidence has presence-only integration, not a verified receipt or lifecycle state. All slice acceptance gates remain open.

### 2. Signatures

```ts
type EventSnapshotScope = { workItemId: string; root: string; generation: number }
EventSourceSnapshotService.capture(): Promise<EventSourceSnapshot>
EventSourceSnapshotPort.capture(scope: EventSnapshotScope): Promise<EventSourceSnapshot>
decodeEventSourceDocument(kind: EventSourceKind, content: string | null):
  Pick<EventSourceDocument, 'value' | 'occurrences'>
```

The application receives a trusted scope provider and the existing shared write coordinator. `root` must already be canonical (including Windows short-name resolution); `generation` is a nonnegative safe integer owned by the calling application session, not a renderer grant. No environment keys or public channel are introduced.

### 3. Contracts

- Wait in the same-book lane, recheck scope after the wait and after success/failure, and reject a changed work item/root/generation. Late errors from the old scope become `CONFLICT`. Acquisition does not refresh a reviewed token or retry a mutation.
- Retain four fixed contained files: research `sources.json` / `events.json`, config `timeline.json`, and planning `outline-state.json`. Store exact base64 bytes, SHA-256 and length, distinguishing absence (`null`) from present empty bytes. Raw content and absolute roots remain main-process private; no logs/IPC export of this snapshot.
- Open exactly one event read facade for all SQLite source/event/timeline/planning records and canonical version/head chains. The acquisition adds `formalOutlinePlanningStateReady`, `outlinePlanningState`, `outlinePlanningStateMirror` and the subsequent `eventChapterCatalog` metadata read. Ready SQLite modules win over their mirrors, including malformed/externally edited mirrors; unready/shadow/absent modules use retained file authority. There is no union, lazy import, version baseline or mirror acknowledgement. Chapter identity inventory has no file fallback: unavailable inventory remains explicit; its complete contract is in [migration inspection](v3-event-migration-review.md).
- Decode the retained active buffer, using strict UTF-8 (BOM retained in raw evidence). JSON object envelopes and known collection arrays are required. Every source/canonical/direct row retains its original ordinal, ID when present and raw parsed value, including duplicates, unknown fields and malformed individual rows. Whole planning JSON and revision/hash are retained without normalization. **Envelope decoding is not row eligibility, reference validation, placement validation or approval**; later review must classify all rows and block invalid ones. Raw bytes remain authoritative evidence for duplicate JSON keys or numeric values not represented exactly by JavaScript.
- Rehash files after SQLite acquisition and reject edits, appearance or removal rather than refreshing the retained buffers. All SQLite rows are pinned together; a later external DB update does not alter that snapshot. The reviewed commit must separately recheck live DB revisions/content inside its transaction. No distributed filesystem/SQLite atomicity or external-writer lock is claimed.
- `WorkspaceEventReadPort.hasEventMigrationEvidence()` retains `database.hasMigrationEvidence` in that same read and fingerprint. Schema <40 returns false without upgrading; schema ≥40 returns true for any row in the four receipt tables. This presence check blocks fresh review over partial/existing evidence; it is not verified receipt recovery. See the [decision/session contract](v3-event-migration-decisions.md).
- Fingerprint binds scope, schema/project/mode, selected authority/content hashes/revisions, original file hashes and missing markers, mirror summaries, full retained event history/heads and chapter catalog availability/identities/status/version pointers. It includes the full planning document hash so placement changes cannot disappear from the fingerprint; chapter archive or body/outline revision drift also changes it. Candidate versions remain candidates; no phase or realization is invented.
- Bounds: 64 MiB across retained raw files plus selected SQLite document JSON, version JSON and chapter catalog JSON; 100,000 selected source/event/direct occurrences plus retained versions and catalog entries. A file is stat-checked and streamed with a limit-plus-one read cap; over-limit means failure, never truncation. Planning relationships remain inside the byte-bounded raw document during acquisition and are separately counted/validated by migration review. Existing SQLite document/history getters materialize their data before this aggregate size check; the new catalog uses a bounded iterator. This is a retained-input bound, **not** a verified heap/large-database responsiveness guarantee.
- Successful results are recursively frozen, with iterative traversal so unknown nested metadata is not recursively reserialized merely to fingerprint it. The physical DB/WAL copy cost and private scratch cleanup limits from section 8 still apply.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No database or optional file | Retained absence, no directory/file creation |
| Missing read capability | `FEATURE_UNAVAILABLE`, no writable fallback |
| Noncanonical root / scope generation changes / files change | `CONFLICT`, no snapshot adopted and no source write |
| Malformed active UTF-8/JSON/envelope | `INVALID_PROJECT_STATE`, safe source-kind details only |
| Malformed mirror of a ready module | Retain exact bytes, read SQLite; not extra input or silent repair |
| Invalid individual legacy row | Retain ordinal/raw value for later blocking review; no `canCommit` claim |
| Byte or occurrence bound exceeded | `VALIDATION_ERROR`, whole acquisition fails without truncation |
| Containment escape | `PATH_ESCAPE` before reading that target |
| Schema/history corruption | Existing read-facade integrity failure, no legacy fallback |

### 5. Good / Base / Bad Cases

- Good: two same-ID timeline rows with different result presence both survive; a placement-only revision changes the snapshot fingerprint while event history stays unchanged.
- Base: schema-25 approved canon has empty version history and null heads, with identical source DB/files after acquisition.
- Bad: normalize duplicate rows, merge an externally edited mirror into SQLite, or present an envelope-decoded row as migration-ready/approved.

### 6. Tests Required

`event-source-snapshot.test.ts`: one facade open; absent/current/schema-25 authority; exact DB/WAL/file hashes; original BOM/whitespace/unknown fields/result absence; frozen snapshot; event candidate/approved history; placement revision; pinned SQLite under a later writer; edited/appeared/removed files; malformed active input; retained invalid rows; global count/byte limits; 5,000 occurrences; junction escape; unavailable adapter; same-root session replacement and queued acquisition. Assert race hooks actually execute so unrelated early `CONFLICT` errors cannot make tests falsely green. Retain dedicated event/bootstrap/foundation regression, typecheck and production build. Real Electron, reviewed mapping/commit and large-DB resource gates remain required later.

### 7. Wrong vs Correct

```ts
// Wrong: independently acquired values can be mixed; normalization loses evidence.
const events = deduplicate(await library.listEvents())
const timeline = await workspace.timeline()

// Correct: keep this private snapshot intact for a later bounded review owner.
const snapshot = await eventSources.capture()
// Every occurrence still needs eligibility/reference checks and an author decision.
// Never send snapshot.files, raw content or scope.root directly through IPC.
```

## 10. Slice-2 occurrence and reference inspection

The executable private row/group/reference/ledger review contract is maintained in [V3 event migration inspection](v3-event-migration-review.md). Load that spec for migration inspection or its callers. It adds immutable bounded pages, source/legacy-planning references, known planning-field/placement checks and same-snapshot chapter identities. It distinguishes structural blockers from retained stale dependencies/confirmations. This is **not** outline-content semantic consistency, file-only chapter authority, author authorization or migration completion.
