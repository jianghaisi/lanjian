# V3 event migration payload conversion

> Status: `verified-current` private pre-commit contract. Owner: `09-11-v3-unified-event-projection`, design §§3–5. No production migration transaction, consumer switch or IPC/UI acceptance is implied.

## 1. Scope / Trigger

Before issuing a confirmation token, prove that every reviewed occurrence has a supported canonical representation. Owners are `desktop/src/main/modules/timeline/domain/event-migration-payloads.ts` and `legacy-event-payload.ts`. The existing application review session retains their result with the original snapshot and decisions. Receipt reads share the interpretation of known direct fields without treating historical evidence as new authorization.

## 2. Signatures

```ts
eventMigrationDecisionsInput(plan): EventMigrationDecisionsInput
eventSourceJsonIsLossless(content, parsed): boolean
prepareEventMigrationPayloads(snapshot, plan, retainedInspection?): EventMigrationPayloads
directEventMigrationPayload(value, proposedCharacters): StoryEventVersionPayload
// Added to main-private ClaimedEventMigrationReview:
payloads: EventMigrationPayloads
```

`EventMigrationPayloads` is frozen `{ version: 1, sourceFingerprint, rows }`. Every row retains `rowIndex` and exactly one kind:

- `material`: detached, frozen original material record, including optional fields and copied references.
- `baseline`: retained canonical `eventId` and the exact supported legacy version payload; no fabricated source revision.
- `existing-version`: retained `eventId` and selected approved version ID, or latest candidate ID when no approved head exists.
- `direct`: converted content/status with no destination identity allocated yet.
- `link`: the explicitly reviewed `targetRowIndex`, including forward targets.

No environment key, schema SQL, writable database facade, public DTO or renderer route is added.

## 3. Contracts

### Whole-source and all-row proof

- Inputs are main-owned retained snapshots and decisions, never arbitrary renderer snapshots. Re-run existing all-row/group/planning/mirror decision validation and compare the complete normalized plan, including every occurrence reference. No partial page, changed reference or unsupported link is accepted.
- Reuse the same conservative JSON representation proof as link decisions. For **all four documents**, compare original text with `JSON.stringify(parsed)` after removing only whitespace outside strings. Check even empty collections and planning envelopes: a repeated final empty key must not hide previous records. Absent documents remain absent.
- Duplicate keys, rounded numbers and unprovable alternate escapes fail before a grant. This can conservatively reject equivalent Unicode/numeric spellings; never rewrite the original bytes to make them pass. Exact bytes/BOM/envelopes remain in the retained snapshot and receipt.
- Unknown fields on material/direct/canonical rows, material references or evidence references block new conversion. Error details contain only source kind, ordinal and a fixed reason; never unknown keys or values. Do not ask the author to delete unknown data automatically. Supporting another field needs an explicit interpretation in the owning contract.
- Supported source fields are the existing `WorkspaceMaterialSourceRecord` fields; nested references support `title/url`. Canonical rows support existing identity/content/status/conflict/timestamp fields plus optional `title/rawCharacters`; evidence supports `sourceId/excerpt`. Their original identity metadata and conflict flags remain in the retained snapshot for the future writer to preserve.
- Direct rows support `id/title/time/characters/location/event/result/status/confidence`. Known malformed status/confidence is already an invalid inspection row. Explicit candidate/approved status is retained, including candidate display in the private review. Absent status yields an approved **proposed payload** for later explicit adoption; constructing it does not approve or write anything. Explicit confidence, including zero, is retained; absence uses the established compatibility default of 1.
- Preserve original raw character text, ordered parsed names and repetitions; do not split Chinese conjunctions. Preserve optional title/result absence versus empty values. Do not manufacture realization, origin or evidence: new legacy direct and canonical baseline payloads have `legacy-unknown` phase/granularity/creator and no guessed revision edges.

### Canonical history and retained lifetime

- SQLite canonical occurrences require exactly their retained history inventory; file-authoritative canonical rows have no SQLite history inventory. A missing/extra/duplicate history cannot silently become a fresh baseline.
- Unversioned records remain the same identity/status/content. Versioned records must have consistent project/event identity, sequence and heads. Compare compatibility status/content to the selected approved head, or latest candidate when none is approved. A later candidate never replaces an approved payload.
- Compatibility rows may omit version-bound display fields. Keep those fields in the existing immutable version; if a compatibility row does supply them, it must agree. Mismatches block instead of overwriting history or inventing a baseline.
- Prepare and freeze all payloads **before** generating confirmation token/operation ID. Conversion failure leaves the original preview available and issues no grant. Existing re-review invalidation, expiry, scope checks and one-use claim rules remain in force. A successful claim returns the original frozen payloads alongside its original snapshot/plan.
- The future transaction must still recheck live scope/files/database/history/placements, consume the retained authorization and atomically persist sources, identities/versions, aliases, receipt/seal/module state and old-writer/mirror retirement. This converter grants no transaction or replay authority and does not allocate IDs/timestamps.

### Historical receipts

- Direct aliases must match the complete normalized historical version payload, including **status and confidence**, not merely four-field content and display metadata. Well-hashed and sealed mismatched versions still fail integrity checks.
- Existing receipt decoding retains unknown historical extensions exactly. Querying such evidence remains read-only; it does not prove those extensions are eligible for a new conversion. Unsupported-extension fixtures explicitly bypass new-grant issuance as historical SQL evidence, never as a product writer.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing/partial/forged normalized decision coverage | Existing validation/conflict; no grant |
| Unknown row/reference fields | `CONFLICT`, `unsupported-fields`, bounded source/ordinal |
| Ambiguous/lossy document JSON, including an empty parsed collection | `CONFLICT`, `json-representation`, source plus null ordinal |
| Inconsistent canonical inventory/heads/content | `CONFLICT`; original history retained |
| Invalid direct status/confidence | Blocking inspection row; confirmation fails |
| Historical target changes candidate approval or confidence | `DATABASE_INTEGRITY_FAILED`; zero repair/replay |
| Valid conversion | Frozen private payloads only; no SQLite/file writes or consumer changes |

## 5. Good / Base / Bad Cases

- Good: explicit legacy candidate with confidence zero remains candidate/zero; canonical approved content remains selected despite a newer candidate.
- Base: empty, unambiguous sources still require normal all-row review and explicit one-use confirmation.
- Bad: discard `phase`, provenance or a nested reference extension; treat a repeated empty JSON key as an empty book; normalize a candidate into approved while retaining an apparently valid receipt hash.

## 6. Tests Required

`desktop/tests/unit/timeline/event-migration-payloads.test.ts` checks metadata/absence/order, known status/confidence, unsupported row/nested fields, safe details, detached frozen payloads, existing history selection/mismatch, JSON representation, empty duplicate-key envelopes for all four sources, forged refs/partial rows, 5,000 occurrences with forward links and final-row failure, and session token allocation/claim behavior.

`event-migration-receipt.test.ts` additionally uses isolated real SQLite fixtures for unsupported historical evidence, new-grant denial with exact file manifests, well-hashed sealed approval/confidence mismatch, and valid candidate/zero-confidence recovery. Keep review/session/source/history/schema/consumer regressions, typecheck/build and installed Electron Node-mode checks. Node-mode is not visible desktop, IME, production transaction or author acceptance.

## 7. Wrong vs Correct

```ts
// Wrong: unexplained authority disappears, and a good checksum hides the change.
payload.status = 'approved'
payload.content.confidence = legacy.confidence || 1
// Correct: retain supported meaning, reject unknown fields before issuing a grant.
const payloads = prepareEventMigrationPayloads(snapshot, reviewedPlan, inspection)
// Retain with the one-use grant; the future transaction still owns live rechecks.
```
