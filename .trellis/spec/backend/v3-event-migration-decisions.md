# V3 event migration decisions and private confirmation session

> Status: `verified-current` private pre-commit contract only. Authority: approved task `09-11-v3-unified-event-projection`, design §4. No production migration writer, receipt recovery, IPC or UI acceptance is implied. All child ACs remain open.

## 1. Scope / Trigger

2026-09-18 supplement: the [payload conversion contract](v3-event-migration-payloads.md) now runs before token allocation. Successful private claims also retain frozen `payloads`; unsupported row fields or ambiguous JSON block confirmation. Pure decision validation alone still only proves decisions, not payload conversion or a committed transaction.

`desktop/src/main/modules/timeline/domain/event-migration-decisions.ts` validates all-row decisions against one trusted [retained inspection](v3-event-migration-review.md). `desktop/src/main/modules/timeline/application/event-migration-review-session.ts` owns a bounded, ephemeral, one-use confirmation grant. It depends only on domain types and injected acquisition/scope/runtime ports. Neither module writes files/SQLite, allocates destination event IDs, approves candidates, reconciles chapter semantics or switches consumers.

The existing private snapshot reader now retains presence-only migration evidence from the same pinned DB read. That prevents issuing fresh authorization over an existing or partial receipt. It is not the integrity-verified receipt read/recovery owner. The subsequent [private receipt recovery contract](v3-event-migration-recovery.md) verifies stored operations; production writes and consumer switching remain separate unfinished work.

## 2. Signatures

```ts
// WorkspaceEventReadPort only; not a public writable facade/IPC capability.
hasEventMigrationEvidence(): boolean
// EventSourceSnapshot.database (when present):
hasMigrationEvidence: boolean

type EventMigrationDecision = {
  rowIndex: number
  disposition: 'retain-source' | 'keep-separate' | 'link-existing'
  targetRowIndex?: number
}
type EventMigrationDecisionsInput = {
  fingerprint: string
  rows: EventMigrationDecision[]
  acknowledgedGroups: number[]
  acknowledgedPlanningFindings: number[]
  acknowledgedMirrors: EventSourceKind[]
}
assertEventMigrationReviewable(snapshot: EventSourceSnapshot): void
reviewEventMigrationDecisions(snapshot: EventSourceSnapshot, input: unknown,
  retainedInspection?: EventMigrationInspection): EventMigrationDecisionPlan
eventMigrationMirrorAcknowledgements(snapshot: EventSourceSnapshot): readonly EventSourceKind[]

new EventMigrationReviewSession(
  sources: { capture(): Promise<EventSourceSnapshot> },
  currentScope: () => Promise<EventSnapshotScope>,
  runtime: { nonce(): string; sha256(content: string): string; now(): number }
)
session.preview()
session.inspection(previewId: string)
session.review(previewId: string, decisions: unknown)
session.claimConfirmation(token: string): Promise<ClaimedEventMigrationReview>
session.cancel(previewId: string): void
session.clear(): void
```

No environment key, main composition, shared DTO, preload route, renderer component or schema migration changes are introduced. Production composition must inject a cryptographically unpredictable main-owned nonce, actual SHA-256, the canonical scope owner and existing coordinated `EventSourceSnapshotService`; never renderer-supplied snapshots, hashes or scopes.

## 3. Contracts

### Pinned evidence / eligibility

- Schema <40 returns `false` without querying nonexistent receipt tables or upgrading. Schema ≥40 queries presence in the existing `eventMigrationReceiptTables` list, including receipt, alias, seal and module-pointer tables. Any row, even orphaned/foreign evidence, returns `true`. Existing exact-schema guards remain required. No receipt JSON/hash/target is decoded here.
- `database.hasMigrationEvidence` is mandatory in the private snapshot and participates in its fingerprint through database metadata. It does not distinguish pending versus completed migration. SQLite mode, known project ID and explicitly `false` evidence are required to establish a review. Absent/shadow/file-only DBs and any existing/unknown evidence fail closed; separate database conversion/recovery is not silently invoked.

### All-row decisions and acknowledgements

- Decode exact own keys at the request and each row; no enum/string/number coercion. Arrays are bounded by the existing 100,000-unit cap; indexes are nonnegative safe integers below it. Decisions must cover every inspected occurrence exactly once, not just a displayed page. The request and retained inspection fingerprints must match the original snapshot.
- Block invalid rows, blocking duplicate/evidence/reference groups and structural planning failures. Material rows require `retain-source`; existing canonical event rows require `keep-separate`, preserving their identity and status. Direct timeline rows require explicit `keep-separate` or a supported link. No decision removes evidence or promotes a candidate.
- Require exactly the set of review-severity group IDs and planning-finding indexes. Missing, duplicated, extra or stale acknowledgements fail. Stale dependencies/confirmations may be acknowledged but are not repaired, refreshed, approved or removed.
- Require exactly the mirror kinds whose retained ledger is not `synced`, or whose actual file hash differs from the ledger content hash. An absent mirror ledger alone does not create a sync warning. Acknowledgement never overwrites files or marks a mirror synced.
- Normalize output to retained row/group/finding/source-kind order, independent of input ordering. `EventMigrationDecisionPlan` is frozen, version 1, and binds `sourceFingerprint`, each `{rowIndex, ref, disposition, targetRowIndex|null}` plus the three acknowledgement lists. Each `ref` retains `{source, contentHash, ordinal, originalId}`. No final event/source ID or destination version is allocated.

### Deliberately limited link proof

- This increment supports only direct timeline occurrence → a different direct timeline occurrence explicitly kept separate in the same snapshot. No self-link, chain, cycle, absent target or canonical target. Existing canonical identity is never merged away. Cross-source/canonical-target compatibility remains unimplemented; do not report complete compatible-link support.
- Compare the complete parsed rows except the **top-level** original `id`. Object key order is immaterial; array order, nested IDs, title, raw character text, absent versus empty result, evidence, status and every unknown field must agree. No four-field signature, trimming or similarity hint grants equality.
- Before linking, prove the complete active source JSON has the same representation as `JSON.stringify(parsed)` after removing only whitespace outside strings. Duplicate keys, lossy numbers or unprovable spellings fail conservatively. Pretty-printed ordinary JSON is allowed; alternate Unicode/numeric encodings may require separate retention even if seemingly equivalent. Original BOM/bytes/unknown fields remain in the retained snapshot. Exactness is cached per source document; comparison uses iterative traversal.
- Pure `keep-separate` decisions retain evidence even when linking cannot be proved. Before grant issuance, the separate payload converter now checks every document's representation and supported row fields; an inspection/decision alone still does not prove conversion. The future writer must consume the retained proven payloads and recheck live state rather than reinterpret unknown authority/status/provenance fields.

### Session lifecycle / race ownership

- Keep **one active preview**, at most **three in-flight acquisitions**, and a fixed **15-minute** confirmation lifetime starting when preview completes. New preview invalidates old previews/grants immediately, even if the new capture fails or hits the in-flight limit. Old captures may finish but cannot publish. Expiry is checked lazily on use; there is no background memory-cleanup timer or renderer lifecycle wiring yet.
- Preview returns only private `{previewId, fingerprint, expiresAt, summary, requiredMirrorAcknowledgements}`. Private `inspection(id)` exposes existing bounded immutable pages, not raw snapshot buffers; neither is an approved IPC DTO. Every async operation checks canonical work item, root and session generation. Top-level snapshot/scope must be frozen; the trusted acquisition owns full deep freezing and hash integrity.
- Starting `review` clears any previous confirmation **before** awaiting/validating. A per-preview review sequence rejects an older concurrent review completing after a newer one. Successful review freezes the normalized plan and hashes `JSON.stringify(plan)` into a lowercase 64-character `decisionFingerprint`; token and operation ID are generated privately. Re-review does not extend expiry. Even an empty source set requires explicit review and confirmation.
- Nonces are validated identifiers of at most 160 characters. A safe monotonically increasing serial makes IDs distinct even if an injected nonce repeats within one process. Restart safety depends on cryptographically fresh production nonces, not the serial. No token/pending state survives restart.
- `claimConfirmation` matches and consumes the grant synchronously **before any await**. It then checks expiry/scope/generation, reacquires a whole snapshot and requires unchanged fingerprint/scope/evidence and unexpired authorization. Repeated/simultaneous claims cannot acquire the same grant. Failure also consumes it; cancel/clear/new-preview during reacquisition prevents late success.
- A successful claim returns frozen `{operationId, decisionFingerprint, plan, snapshot, payloads}` with the **original reviewed snapshot and proven payloads**, not refreshed replacements. This is a private pre-commit capability, **not a commit receipt or permission to bypass the transaction**. The later write owner must recheck live DB/source/head/placement state inside its write boundary; all imports, baselines, aliases, receipt/seal/module pointer and retirement of old writes/mirror plans must commit together. No filesystem/SQLite distributed atomicity is asserted.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Nonformal/absent project, existing or unknown migration evidence | `FEATURE_UNAVAILABLE`; no new DB or grant; original recovery evidence remains intact |
| Extra/missing keys, partial/duplicate/out-of-range decisions or acknowledgements | `VALIDATION_ERROR`; no plan/token publication |
| Invalid source/reference/planning state, changed fingerprint, unsupported/unequal link | `CONFLICT`; retain original snapshot; no migration writes |
| Old/replaced/used/forged token, book/root/generation change, expiry, concurrent stale completion | `CONFLICT`; matched claim consumed, no returned capability |
| Fourth overlapping capture | `CONFLICT`; older previews invalidated; in-flight slots released on completion |
| Unknown acquisition/current-scope error | Safe `STORAGE_ERROR`; raw cause stays main-private, no path/content in message |
| Invalid main hash/time/nonce capability | Safe validation/internal error; no grant publication |
| Valid claim followed by an external write | Still requires future transaction recheck; no completed migration is asserted |

The class has no public error-envelope adapter yet. Known `AppError` values propagate privately; future IPC must use the existing typed/redacted boundary, never serialize raw errors, causes, source snapshots or local paths. Runtime nonce/hash/time callbacks are trusted main-owned capabilities, not an untrusted data transport.

## 5. Good / Base / Bad Cases

- Good: two direct occurrences differing only in their top-level original IDs are explicitly linked after complete duplicate/mirror/stale-state review. All occurrences and source bytes remain present; no DB row is written.
- Base: zero occurrences in an eligible formal book still require a successful review and one-use claim. Separately retaining every valid occurrence is always distinct from automatic deduplication.
- Bad: confirm only page one; use same four-field text despite different results; link a candidate to an approved canonical event; reuse a token after cancel or a source-file edit; treat an unsealed receipt as permission to retry a new migration.

## 6. Tests Required

`event-migration-review-session.test.ts` covers exact all-row/group/finding/mirror coverage, deterministic frozen plans, every unsupported decision shape, candidate identity, equality and unknown-field/order/status/result distinctions, duplicate JSON keys/lossy numbers, cycles and malformed targets; 5,000 linked/kept occurrences with partial-page rejection; empty confirmation, plan hashing, original-snapshot identity, invalid re-review, token/expiry/book/root/generation races, three-acquisition bound, stale concurrent review, safe errors and restart/nonce behavior.

Real contained OS-temporary SQLite fixtures assert byte-for-byte DB/files preservation across preview/review/claim, BOM retention, external-file-change rejection and evidence presence changing the pinned fingerprint/blocking fresh grants. Retain source-snapshot, receipt/identity/display, planning/review/read/bootstrap/version/consumer/shadow-session regressions. Run TypeScript/build and installed Electron Node-mode tests; keep expanded neighboring failures explicit. None substitutes for the unimplemented writer fault/recovery/IPC or real desktop/Chinese-IME/author gates.

## 7. Wrong vs Correct

```ts
// Wrong: similarity and a successful preview are neither decisions nor a commit.
if (sameFourFields(a, b)) saveMergedEvent(a)
markModuleMigrated(preview.fingerprint)

// Correct: private staged review; no writer is connected by this increment.
const preview = await session.preview()
const grant = await session.review(preview.previewId, allRowDecisions)
const claimed = await session.claimConfirmation(grant.token)
// Future owner: revalidate retained payloads + live transaction state, atomically
// retire legacy writes/mirrors and persist content/aliases/receipt/seal/pointer.
// Do not expose claimed.snapshot or call an existing compatibility bulk saver.
```
