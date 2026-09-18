# V3 event migration receipt verification and recovery queries

> Status: `verified-current` private read contract only. Owner: `09-11-v3-unified-event-projection`, design §5. This does not enable a writer, replay, unified consumers or public IPC. Frozen schema 40 is unchanged.

## 1. Scope / Trigger

2026-09-18 supplement: direct mapped versions now match the complete normalized payload, including explicit candidate/approved status and confidence. [New conversion validation](v3-event-migration-payloads.md) blocks unknown row fields before issuing a grant; historical receipt queries continue retaining extensions without authorizing their conversion or replay.

Use when serializing reviewed evidence or querying a stored operation after reload or uncertain success. Presence-only detection still blocks new grants over any evidence. A verified historical receipt is not authorization to repeat a write or enable unified consumers.

## 2. Signatures

```ts
eventSourceFingerprint(snapshot: Omit<EventSourceSnapshot, 'fingerprint'>): string
encodeEventMigrationReceiptEvidence(snapshot: EventSourceSnapshot, plan: EventMigrationDecisionPlan): string
decodeEventMigrationReceiptEvidence(json: string): { snapshot; plan; inspection }
// Existing read-only facade only; no mutation capability:
eventMigrationReceipt(operationId?: string): EventMigrationReceipt | null
new EventMigrationReceiptService(databases, currentScope, writes).read(operationId?)

type EventMigrationReceipt = Readonly<{
  operationId: string; projectId: string; sourceFingerprint: string
  decisionFingerprint: string; committedAt: string; mappingCount: number
  sourceCounts: Readonly<{ sources: number; events: number; timeline: number }>
}>
```

No schema migration, environment key or public DTO is added. Infrastructure `readEventMigrationReceipt(database, schemaVersion, projectId, operationId?)` requires a caller-owned pinned read transaction and validated schema. Production uses the existing byte-verified private copy. Application queries must never fall back to creating/upgrading `openExisting`.

## 3. Contracts

### Retained evidence

- `source_snapshot_json` stores `{ version: 1, snapshot, decisions }`. Preserve historical scope/database, exact file base64/hash/length, authoritative document text/hash/revision, mirrors, event history, chapter catalog and fingerprint. Omit only redundant parsed document `value`/`occurrences`; reconstruct them from retained text. Unknown original source fields and BOM bytes remain intact.
- `decisions` uses the existing strict all-row input shape. Encode derives it from a reviewed normalized plan. Decode reruns occurrence/planning inspection and decision validation, including all acknowledgements. Decision hash remains SHA-256 of the normalized plan.
- Encode only serializes evidence. The future writer must consume the one-use session capability and recheck live state inside its transaction; a serialized object is not an author grant.
- Acquisition and decoding share `eventSourceFingerprint`, extracted without algorithm changes. Validate envelope/version, absence markers, canonical base64, strict UTF-8, bytes/hashes, document authority/revisions, mirror paths/statuses, event version identities/hashes/sequence/heads, chapter catalog, original fingerprint and decisions. Never open historical paths while decoding.
- Original limits remain 64 MiB aggregate input and 100,000 units. Serialized archive limit is `4 * 64 MiB + 1 MiB`, accounting for base64 and escaped text without duplicated decoded graphs. SQL checks UTF-8 byte length before fetching JSON; decode also enforces original byte/unit budgets.

### Durable query

- Missing DB, supported schema below 40, or four empty evidence tables returns null without create/upgrade. Any nonempty evidence requires exactly one same-book receipt/seal/module pointer and complete alias range. Partial, unpointed, foreign, orphaned or additional evidence fails; reads never repair it.
- Verify receipt hashes/metadata, decoded source and normalized decision hash. Every alias matches the reviewed occurrence tuple/disposition. Kept events have distinct identities; a link points to its explicitly kept target and identical version. Material identities and retained hashes match original rows and still belong to the book.
- Mapped event versions must be sealed, same-book and in intact history. Retained canonical history remains exact. An unversioned legacy canonical baseline preserves identity/status/content and unknown phase/granularity/creator without invented provenance. Direct mappings preserve reviewed character parsing, raw names/title/result and four elements, with legacy-unknown metadata.
- This does not prove arbitrary unknown legacy authority fields can be converted safely. New confirmation now requires the separate supported-field conversion proof; the future writer must consume those retained payloads, recheck live authority/status, and provide atomic commit and legacy-writer/mirror retirement.
- Later valid material edits and event approvals/versions do not invalidate a historical receipt. Compare historical target versions, never substitute current heads or require the material's latest hash to match the receipt.
- Historical root/session may differ after moving/restoring a book. Verify current scope around acquisition; never reopen the historical path. A different requested operation returns `NOT_FOUND` only after existing evidence verifies; damaged evidence cannot be hidden by querying another ID.
- Return frozen summaries with no raw source payload, root, token, model content or storage handle. Historical commit evidence does not imply current mirror synchronization or complete product migration acceptance.

### Application lifetime

Use the existing per-book coordinator and read-only facade. Check current work item/root/generation before/after acquisition and result calculation. Scope changes reject late success/errors. Always close the private snapshot. Missing capability fails closed; unknown scope/acquisition/close errors expose safe messages and keep causes private. This service is not yet registered through main/IPC/preload/UI.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing DB / old schema / empty evidence | `null`, original bytes and schema unchanged |
| Invalid operation ID | `VALIDATION_ERROR` before acquisition |
| Partial/foreign evidence, bad archive/hash/decision/alias/history | Safe `DATABASE_INTEGRITY_FAILED`; no repair/replay |
| Verified receipt, different requested operation | `NOT_FOUND` |
| Book/root/generation changed | `CONFLICT`; discard old result/error and close |
| Missing readonly capability | `FEATURE_UNAVAILABLE`; no writable fallback |
| Unknown scope/acquisition/close error | Safe `STORAGE_ERROR`; private cause |
| Later valid source/event revision or moved book | Historical receipt remains readable and unchanged |

## 5. Good / Base / Bad Cases

- Good: after a lost reply, verify the same operation and original mappings without creating a new history chain.
- Base: schema-40+ tables exist in a new book but no receipt exists.
- Bad: presence means success; retry partial evidence automatically; replace a retained candidate with today's approved head; accept arbitrary JSON solely because its outer checksum matches.

## 6. Tests Required

`event-migration-receipt.test.ts` covers zero-write absent/old/current reads; empty and partial receipts; duplicate IDs with separate/link decisions; original BOM/extensions; canonical candidate/baseline and later source/approval changes; damaged fingerprints/envelopes/decisions/aliases/history; foreign evidence; 5,000 occurrences; scope/late-error/close failures and missing port. Compare complete file manifests on successes/failures. Fixtures use checked, canonical owned OS-temp directories only.

Retain event source/review/session/schema/version/consumer regressions, typecheck and build. Installed Electron Node-mode tests validate its SQLite runtime, not visible desktop/IME acceptance. Production writer, IPC/UI and author acceptance remain open.

## 7. Wrong vs Correct

```ts
// Wrong: existence is neither success nor permission to repeat an import.
if (db.hasEventMigrationEvidence()) return { migrated: true }
// Wrong: replace historical evidence with today's head.
receipt.eventVersionId = db.canonicalEventVersionHeads(eventId).latestVersionId

// Correct: current-book, single-snapshot, zero-write verification.
const receipt = await receiptService.read(operationId)
// Null means no stored migration. Errors preserve incomplete/corrupt evidence.
// A summary does not activate consumers or repeat a write.
```
