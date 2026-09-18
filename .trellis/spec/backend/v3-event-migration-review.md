# V3 event migration occurrence, reference and planning inspection

> Status: `verified-current` private inspection contract only, not a completed migration feature. Authority: [V3 planning and event consistency](v3-planning-event-consistency.md) and approved task `09-11-v3-unified-event-projection`.

### 1. Scope / Trigger

2026-09-18 supplement: direct-row inspection now validates optional `status` and `confidence` through the shared legacy payload owner. Explicit candidate/approved status is reported as such; absent status remains `direct-unconfirmed` in review. Unsupported extensions and whole-document JSON ambiguity are additionally blocked by [conversion before confirmation](v3-event-migration-payloads.md), not silently dropped by the inspector.

`inspectEventMigrationSources` inspects one trusted retained snapshot in the main process. It supplies bounded, immutable row/group/reference pages without allocating destination IDs or aliases, writing receipts or exposing IPC/UI. The separate [private decision/session owner](v3-event-migration-decisions.md) now validates all-row decisions and limited direct links, and consumes an ephemeral confirmation grant; this inspector itself remains non-authorizing. Current writable schema is 40 under the [receipt storage contract](v3-event-migration-receipts.md), following [identity preparation](v3-event-identity-schema.md). Its snapshot includes presence-only migration evidence, not a decoded/verified receipt or module state; inspection does not upgrade storage or gain write authority. All child acceptance gates remain open.

### 2. Signatures

```ts
inspectEventMigrationSources(snapshot: EventSourceSnapshot): {
  fingerprint: string
  summary: { rowCount: number; referenceCount: number; groupCount: number;
    invalidRowCount: number; blockedRowCount: number; blockingGroupCount: number;
    blockedReferenceCount: number; planningFindingCount: number; planningBlockingCount: number;
    inspectedUnits: number; planningCoverage: 'ledger-and-chapter-identities'; authorReviewRequired: true }
  rowsPage(offset?: number): EventMigrationReviewPage<EventMigrationReviewRow>
  groupsPage(offset?: number): EventMigrationReviewPage<EventMigrationReviewGroup>
  groupMembersPage(groupId: number, offset?: number): EventMigrationReviewPage<number>
  referencesPage(offset?: number): EventMigrationReviewPage<EventMigrationReferenceReview>
  planningFindingsPage(offset?: number): EventMigrationReviewPage<EventMigrationPlanningFinding>
}
inspectEventPlanningLedger(
  value: Record<string, unknown> | null,
  catalog: WorkspaceEventChapterCatalog,
  count: () => void,
  eventReference: (owner: { source: 'planning'; ordinal: number; path: string }, id: unknown) => void
): Array<{ path: string; code: EventPlanningFinding['code']; severity: 'blocking' | 'review' }>
// Added to the private event read facade; captured once with the other SQLite modules:
WorkspaceEventReadPort.eventChapterCatalog(): WorkspaceEventChapterCatalog
type WorkspaceEventChapterCatalog = {
  manuscripts: 'sqlite' | 'unavailable'; outlines: 'sqlite' | 'unavailable'
  entries: Array<{ kind: 'manuscript' | 'outline'; chapterId: number;
    status: 'active' | 'archived'; revision: string | null }>
}
// Extracted from SQLite compatibility validation, reused without importing a DB handle:
assertMaterialSources(values: unknown): asserts values is WorkspaceMaterialSourceRecord[]
assertCanonicalEvents(values: unknown): asserts values is WorkspaceCanonicalEventRecord[]
normalizedMaterialUrl(value?: string): string | null
```

These are private domain APIs, not runtime IPC contracts. No environment keys are added. The existing SQLite compatibility imports/writes reuse the extracted validators; ordinary research read guards retain their existing compatibility behavior.

### 3. Contracts

- Every retained source/canonical/direct occurrence becomes a row in source-kind then original-ordinal order. The reference is the tuple `{ source, contentHash, ordinal, originalId }`; review-local row/group indexes are meaningful only with the snapshot fingerprint, never stable event IDs. No invalid row is removed or given a destination proposal. `recordCheck: valid` checks the record shape/bounds, **not** its references, group conflicts, full migration eligibility or author approval.
- Validate each source/canonical record with the shared legacy storage validator on a singleton array. The existing array-level canonical signature and material ID/hash/normalized-URL uniqueness rules still govern compatibility writes; review retains duplicates and reports them instead. Explicit malformed row/reference objects fail with a safe `VALIDATION_ERROR`, not an incidental `TypeError`. Source hashes must be strings, not regex-coerced values. This is not the later unified-write validator, where content signatures will be nonunique.
- Canonical migration inspection additionally requires existing version-payload/identifier constraints without changing stored content. Direct inspection uses the same four-field/version content bounds; optional title is at most 200 characters and raw character text at most 20,000. Its proposed names split only on visible `、 , ， ; ； / |` and line breaks, trimming separator-adjacent whitespace; never split on 和/与/及, sort names or deduplicate them. Empty/more than 100 names, names over 200 characters and other invalid content block the row, without truncating or changing retained bytes. Validation-only probe status/confidence are not a proposed event version or provenance.
- Direct title/raw-character checks now reuse `assertStoryEventDisplayMetadata` before name splitting, and the validation-only version probe carries both fields. The [version-bound display contract](v3-event-display-metadata.md) owns types, exact values, absent/empty behavior and limits. Raw source `characters` is retained separately from its proposed name array; sharing validation does not allocate or adopt an event version.
- Row status distinguishes `source`, retained `candidate`/`approved`, `direct-unconfirmed`, and `invalid`. Valid event rows propose only `keep-separate`; source rows propose `retain-source`. Neither is a decision or mapping. No candidate is approved and no phase/history is reclassified.
- Repeated material/canonical IDs and material content-hash/normalized-URL collisions are blocking groups under current compatibility storage constraints. Repeated direct IDs require review and stay distinct occurrences. Normalized four-field signatures provide `possible-duplicate` hints only; same full time/place/character slot with different normalized event text provides `possible-slot-conflict`. These hints neither establish exact equality nor prove completeness of semantic conflict detection. Title/result absence, raw character order, evidence/status and unknown metadata remain in the retained snapshot for later full link validation.
- Group membership is stored once as row indexes; each row stores bounded group IDs. Pages of rows, groups, group members, references and planning findings contain at most 100 items. Invalid/negative/fractional/out-of-range offsets or group IDs reject. All exposed review-owned objects/arrays are frozen. Paging does not mark items reviewed or grant partial-page commit authority.
- Material evidence on structurally valid canonical rows resolves against **every** matching retained source occurrence, including invalid same-ID records. Report invalid reference, missing target, ambiguous target or invalid target; never choose the first valid item or normalize an ID. An event with unresolved evidence is blocked and cannot serve as a valid planning target.
- `inspectEventPlanningLedger` owns migration's complete known raw planning-field traversal and replaces the earlier partial event-reference parser; do not add a parallel third planning reader or call the ordinary lossy `normalizeState`. Ordinary planning reads/saves are unchanged. The migration owner still resolves every event reference in `assignments`, `volumes.eventIds`, `eventChapterPlacements` and `chapterConfirmations.eventIds`, preserving duplicates and exact paths. Legacy planning resolves **canonical IDs only**: a same-ID direct row neither fills a missing canonical target nor steals its chapter placement. Candidate-only, invalid or ambiguous canonical targets block, including unresolved material evidence.
- A null planning document remains absent. A present ledger requires `version: 1`, `total`, `assignments` and `chapters`; the seven other known arrays may be absent for legacy compatibility, but an explicitly malformed collection is not empty. Known row fields are checked without coercion, sorting, deduplication, repair or removal of unknown fields. Total/dependency/volume revisions are nonnegative safe integers; volume IDs are 1–1,000 and chapter IDs 1–1,000,000. Hashes are lowercase SHA-256, except total hash may be empty only at revision zero. Timestamps are non-NUL strings of at most 100 characters accepted by `Date.parse`; volume title is nonblank, non-NUL and at most 120 characters. Optional fields remain absent, not synthesized.
- All nine identity collections are indexed: assignment by event ID; volume by number; chapter placement, manuscript start, chapter dependency and chapter confirmation by chapter ID; event-chapter placement by event ID; review acknowledgement and planning confirmation by scope. Every valid identity key participates even if its row has invalid fields, so a valid row cannot conceal an invalid same-key occurrence. Repeated keys block and references to repeated/invalid targets remain ambiguous/invalid, never first-match wins. Review acknowledgements require nonempty unique issue codes matching `[A-Z][A-Z0-9_]{0,63}`. Chapter confirmation event IDs are not silently deduplicated.
- Volume event references require a total assignment. An event cannot appear twice in one volume or across volumes. Chapter placements require an existing volume. Event-chapter placements require assignment, a unique event volume and a unique chapter placement; the two volume numbers must agree. No placement is inferred from prose or free-text event time. Chapter confirmations require a recorded chapter dependency. Volume-scope confirmations/acknowledgements require an existing volume.
- The retained snapshot includes `chapterCatalog` from that **same pinned read connection**, scoped by its project ID. It reads identity, status and current version pointers only, not manuscript/outline text. Formal SQLite manuscript storage is available; outline storage is available only when its module is ready. Absent/shadow/file-only or unready modules are `unavailable`, not proven empty. No filename scan, planning-derived chapter invention, lazy adoption or separate service lookup supplies missing authority. Rows use an iterator with a 100,000-entry cap, and catalog JSON/entries also count against aggregate snapshot byte/row bounds and its fingerprint. Invalid IDs/status/version representation, or an active identity without a current version, fail with `DATABASE_INTEGRITY_FAILED`; an archived row may retain a null pointer. Current schema/history validation is unchanged; this metadata read is not a new audit of every legacy body/outline payload.
- A planned chapter can exist as an active outline before manuscript creation. Placements accept either active identity; saved dependencies and confirmations require an active outline; completed manuscript-start receipts require active manuscript identity, while incomplete starts require an active outline. Any archived identity blocks, even if its other identity remains active. Duplicate same-kind identities are ambiguous. If the required authoritative inventory is available but lacks the chapter, report `missing-chapter`; otherwise report `chapter-inventory-unavailable` rather than guessing. Unavailable file-mode identity is an explicit remaining migration blocker, not implemented support for file-only placement migration.
- Staleness is not automatic structural corruption: a saved dependency behind total/volume revision or its old volume differing from current placement yields `stale-dependency` with severity `review`; an impossible future dependency revision blocks. A chapter confirmation differing from its saved dependency hash/revisions, or a volume confirmation bound to a missing/different total confirmation fingerprint, yields `stale-confirmation` with severity `review`. Never rewrite dependencies or reconfirm on the author's behalf. Manuscript-start revision is historical and is not compared to today's body version. These checks do **not** recompute current outline content/review fingerprints or prove story semantics, full dependency freshness, compatible linking or current author approval. Coverage is `ledger-and-chapter-identities`, never `complete`; zero blocking findings cannot grant commit authority.
- A separate review budget counts source/event/direct rows, valid canonical evidence references, the planning root and all known owners, event references, issue-code entries, catalog entries and findings together, up to 100,000 units. Exceeding it fails the entire review without partial output. Invalid event rows are already blockers and their evidence arrays are not traversed. The snapshot's 64 MiB/retained-row bounds still apply; this review cap does not certify heap or Electron responsiveness. Pages remain private and may contain original IDs; a future IPC owner must build independently bounded safe summaries, not forward this API directly. `planningFindingCount` includes both severities; `planningBlockingCount` counts only structural blockers, independently of event/evidence blockers.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid individual record or representation bound | Retained invalid row with safe reason, no disposition proposal |
| Same original direct ID / similar content | Separate rows, review group, no merge or approval |
| Repeated canonical/source ID or material uniqueness collision | Blocking group, no dropped occurrence |
| Missing/ambiguous/invalid material evidence | Blocking reference; owning canonical event also blocked |
| Planning points at candidate or missing canon, even with same-ID direct event | `candidate-target` / `missing-target`; no fallback |
| Malformed relevant planning collection/owner | Explicit path finding; original planning JSON untouched |
| Invalid planning field / repeated key | `invalid-field` / `duplicate-identity`, severity `blocking` |
| Missing assignment/volume/chapter placement/dependency | Corresponding `missing-*` finding; no invented target |
| Ambiguous/invalid planning target / event and chapter volume mismatch | `ambiguous-reference` / `invalid-reference-target` / `event-volume-mismatch`, blocking |
| Planned active outline, no manuscript, not a completed manuscript start | Valid chapter identity without creating prose |
| Required chapter missing / archived / inventory unavailable / duplicate same-kind identity | `missing-chapter` / `archived-chapter` / `chapter-inventory-unavailable` / `ambiguous-chapter`, blocking |
| Active catalog identity missing current version | `DATABASE_INTEGRITY_FAILED`; source unchanged |
| Dependency ahead of current revision | `future-dependency-revision`, blocking |
| Old dependency or confirmation metadata differs | `stale-dependency` / `stale-confirmation`, review; no refresh/approval |
| Invalid retained ordinal/content hash | `INVALID_PROJECT_STATE`, no silent reindexing |
| Invalid page/group coordinate or review budget exceeded | Safe `VALIDATION_ERROR`, no partial review/write |
| All inspected records/references/ledger checks pass | Still requires compatible link decisions, current-snapshot recheck and author authorization; no semantic-consistency guarantee |

### 5. Good/Base/Bad Cases

- Good: 5,000 repeated-ID direct rows stay individually addressable in original order across every page, with linear group membership storage and no destination IDs yet.
- Base: an empty snapshot returns an empty review, still requiring author confirmation for a future empty-module transition.
- Bad: a direct event supplies a missing canonical placement, a valid same-ID source hides an invalid duplicate, or `recordCheck: valid` is treated as permission to migrate.
- Good: chapter 7 has only an active outline, belongs to volume 1 and references an approved assigned volume-1 event; it is a valid planned chapter, not realized prose.
- Bad: archived manuscript 7 plus surviving outline 7 is treated as active; or an old total dependency is silently updated just to make checks green.

### 6. Tests Required

`event-migration-review.test.ts` verifies original hash/ordinal/ID bindings, absent/empty result and unknown metadata retention, Chinese conjunction names, candidates, all duplicate categories, evidence/placement reference ambiguity, invalid rows and representation bounds, 5,000 paged duplicate/conflict occurrences, group membership cardinality, immutable pages, invalid page/group coordinates, reference-budget failure, snapshot-invariant failures and extracted compatibility validator behavior. A real contained file acquisition+review fixture asserts exact original file hashes/BOM and an absent database.

`event-planning-review.test.ts` verifies all nine collections/fields/duplicate identities, invalid same-key rows, missing relationships, cross-volume mismatch, planned versus started/archived/unknown chapters, completed start requirements, old versus impossible future dependencies, unchanged stale confirmations, retained unknown fields/order, and 5,000 placed events with all 20,000 reference edges. Malformed rows and issue-code expansion must hit the shared review budget. Real OS-temp SQLite fixtures assert one pinned facade, exact whole-book file manifest preservation, active outline before prose, body/outline revision fingerprint drift, later archive isolation, schema-25 reads without upgrades, missing active version safe failure, same-project catalog scope and unready-outline exclusion.

Rerun event/source/bootstrap/foundation and expanded storage/research/planning/map/write-lane tests, typecheck and build. File-only chapter authority, compatible explicit linking, durable transactional migration and real Electron acceptance remain later gates. Metadata-ledger checks do not close parent outline/content dependency propagation or prove timeline/outline semantic agreement.

### 7. Wrong vs Correct

```ts
// Wrong: erases ambiguity and treats content similarity as author consent.
const chosen = sources.find(source => source.id === evidence.sourceId)
if (sameSignature) mergeAndApprove()

// Correct: inspect the retained occurrences; retain every source and flag ambiguity.
const review = inspectEventMigrationSources(snapshot)
const page = review.rowsPage(0) // private, max 100; not a migration token
// Chapter identity/ledger findings are separate from semantic consistency and approval.
const planning = review.planningFindingsPage(0)
// All-row decisions, compatible link validation and transaction-time recheck still required.
```
