# V3 event migration receipt storage

> Status: `verified-current` structural contract only. Authority: approved slice 2, `09-11-v3-unified-event-projection`, design §4.2. Empty schema preparation is not author confirmation or completed migration. All child ACs remain open.

## 1. Scope / Trigger

Schema 40 prepares same-project source-occurrence aliases, immutable migration receipts, seals and a single module-transition pointer. This SQL contract introduces no application writer, receipt read API, authorization token, consumer switch or real-book transition. The subsequent [private decision/session contract](v3-event-migration-decisions.md) adds only presence detection to the pinned snapshot and blocks new grants over any existing evidence. Integrity-verified private receipt queries are specified in [receipt recovery](v3-event-migration-recovery.md). Presence detection still cannot reopen a unified book; production writes, consumer switching and public recovery UI remain unimplemented.

Migrations 1–39 and old event payload hashes remain frozen. Writable startup validates schema 39 before applying migration 40 in the existing caller-owned `BEGIN IMMEDIATE` transaction. It installs empty tables, records migration 40 and advances project/user schema versions, without importing sources, baselining events, generating receipts or changing readiness/mirrors. Read-only opening of supported old versions never upgrades them. Atomicity is per migration, not across the historical migration chain.

## 2. Signatures

```ts
WORKSPACE_DATABASE_SCHEMA_VERSION = 40
// migration 40: immutable-event-migration-receipts
eventMigrationReceiptsMigrationSql: string
eventMigrationReceiptTables: readonly [
  'event_migration_receipts', 'event_migration_source_aliases',
  'event_migration_receipt_seals', 'event_module_transitions'
]
assertEventMigrationReceiptSchema(database: DatabaseSync): void
```

`desktop/src/main/modules/timeline/adapters/event-migration-receipt-schema.ts` owns the frozen SQL and exact schema-definition checks. `desktop/src/main/platform/storage/workspace-database.ts` only registers migration 40, validates its source schema and conditionally checks new definitions for versions ≥40. Existing migrations 36/37/39 retain their guarded rebuild owner. No renderer/shared contracts or environment keys are added.

## 3. Contracts

All four tables are `STRICT`. Identity keys are explicitly `NOT NULL`; foreign keys use `ON DELETE RESTRICT`. Basic length/NUL/hash/count constraints are storage backstops, not the complete domain identifier/semantic validator. Supported SQLite behavior was checked against [CREATE TABLE](https://www.sqlite.org/lang_createtable.html), [STRICT tables](https://www.sqlite.org/stricttables.html) and [triggers](https://www.sqlite.org/lang_createtrigger.html), and exercised in isolated runtime tests.

| Table | Retained fields and constraints |
| --- | --- |
| `event_migration_receipts` | PK `operation_id` (1–200 chars, no NUL); `project_id`; lowercase 64-character `source_fingerprint`, `decision_fingerprint`, `source_snapshot_hash`; exact object JSON `source_snapshot_json`; integer `mapping_count` 0–100,000; nonempty `committed_at`. New receipt requires SQLite-mode project with no existing module transition. |
| `event_migration_source_aliases` | PK `(operation_id, ordinal)`; `project_id`; `source_kind` sources/events/timeline; lowercase 64-character `source_hash`; integer `source_ordinal` 0–99,999; nonempty `original_id` ≤200 chars, no NUL; disposition retain-source/keep-separate/link-existing; one typed target described below. UNIQUE `(project_id, source_kind, source_hash, source_ordinal)` preserves occurrence identity. |
| `event_migration_receipt_seals` | PK `operation_id`, `project_id`; same-project receipt with exactly its declared mapping count. |
| `event_module_transitions` | PK `project_id`, UNIQUE `operation_id` referencing a same-project sealed receipt; project must still be SQLite-mode. This is independent of `canonical_events_ready`. |

Targets:

- `sources` requires `retain-source`, nonnull `material_source_id`/`material_content_hash`, null event columns. Material FK must exist in the same project with the supplied **current** hash at insertion. Later material edits do not alter the historical retained hash; FK prevents deleting the referenced identity.
- `events`/`timeline` require `keep-separate` or `link-existing`, nonnull `event_id`/`event_version_id`, null material columns. Both identity/version FKs remain protected. Version must be same-project, sealed, owned by that event and selected by `coalesce(approved_version_id, latest_version_id)` at insertion. A new candidate cannot replace an approved head in the map; a candidate-only event remains unapproved. Later head changes do not rewrite the mapped version.
- Original IDs and textual content are **not** unique. A nonunique `(project_id, source_kind, original_id)` index supports reverse lookup; any future resolver must preserve multiple matches and reject ambiguity instead of choosing the first. Only trusted all-row review can establish retained canonical IDs, complete source compatibility and legal explicit links.

Every alias must belong to its same-project unsealed receipt and satisfy `0 <= ordinal < mapping_count`. Unique ordinals plus exact count at seal imply the declared range has no gaps. No alias can be appended after sealing. All receipt/alias/seal/transition updates and deletes are rejected. Insert guards also reject conflicts on **every** PK/UNIQUE key before insertion, blocking `INSERT OR REPLACE` even when `recursive_triggers=OFF`; do not rely on delete triggers alone.

### Deliberately not yet guaranteed

SQL verifies the **declared** mapping set, not that the snapshot contains every real occurrence, that fingerprints match their payloads, or that the author authorized compatible decisions. Snapshot JSON is an opaque exact envelope here; the schema does not compute SHA-256, enforce the complete retained snapshot shape or apply the 64 MiB input budget. It cannot authenticate provenance, distinguish real canonical versus imported identities by ID text, or prove timeline/outline semantic consistency.

Before enabling a production writer, the application must validate the retained snapshot/hash and all occurrences/decisions, preserve canonical identities and source bytes, apply domain limits, bind root/book/session/revisions, consume a one-use token, and recheck every source/head/placement inside the write boundary. Event/source creation, aliases, receipt, seal, module pointer, legacy-writer retirement and old mirror-plan retirement must commit **together**. Unsealed or unpointed receipts must never be reported as completed author migration. A unique operation key enables future recovery; this increment does not implement idempotent application retries or lost-reply handling.

No public code currently writes these rows. Merely creating tables or hand-inserting a SQL fixture must not switch compatibility consumers. Unified readers and legacy-write guards must be implemented before any real module pointer is published.

## 4. Validation & Error Matrix

| Condition | Required outcome |
| --- | --- |
| Missing/corrupt schema-39 guard/checksum before upgrade | Existing integrity/migration error; no schema-40 ledger or tables committed |
| Occupied new table or failure after DDL/ledger/before commit | Existing migration error; complete rollback of migration 40, retain original data |
| Missing or weakened required table/index/trigger body in schema 40 | `DATABASE_INTEGRITY_FAILED`, safe message; no automatic repair |
| Malformed hashes/counts/JSON, NULL key, target mismatch | SQLite constraint/trigger abort, no row inserted |
| Wrong project, unsealed/missing/unselected version, stale material hash | SQLite scope-guard abort |
| Incomplete receipt or premature/foreign/nonformal transition | No seal/transition; existing rows retained |
| Duplicate operation/occurrence/pointer, UPDATE/DELETE/REPLACE | Abort, immutable evidence retained |
| Later material/head revision | Old receipt target remains historical evidence, not current content authority |

Raw SQL errors are infrastructure/test evidence only; future named application/IPC operations must map them to safe typed errors without leaking snapshot JSON or local paths.

## 5. Good / Base / Bad Cases

- Good: two retained occurrences with the same original ID have different source ordinals and both survive. A sealed receipt binds immutable mapped version IDs and a same-book pointer; subsequent event versions leave it intact.
- Base: fresh schema 40 has zero receipts/aliases/seals/transitions. An explicitly reviewed empty migration may eventually write a zero-count receipt, seal and pointer in one authorized transaction; zero events alone is not confirmation.
- Bad: deriving author consent from schema version, treating matching counts as semantic completeness, auto-linking identical text, using REPLACE for retry, exposing arbitrary SQL/target IDs to the renderer, or switching readers before legacy writes/mirrors are retired.

## 6. Tests Required

`event-migration-receipt-schema.test.ts`: fresh preparation; schema-39 upgrade with all old rows/history/definitions/files preserved; readonly-39 file manifest unchanged; complete and empty synthetic receipt reopen; gaps/missing mappings/scope/readiness; repeated original IDs; same-book current material hash and later-history preservation; sealed approved/candidate target selection; unsealed target rejection; all four immutable tables and alternate UNIQUE REPLACE conflicts with recursive triggers off; malformed bounds/NUL/BLOB/JSON; caller transaction rollback after each receipt stage; migration failure after DDL/ledger/before commit; missing/weak guards/indexes; damaged predecessor and occupied table preservation; 5,000 individually mapped occurrences with indexed reverse lookup; frozen migrations 1–39.

Fixtures use canonical owned OS-temp directories; validate exact ownership before cleanup. Raw receipt fixtures intentionally do not pretend to be reviewed snapshots. Rerun prior event/read/bootstrap/version/schema/display and expanded persistence/planning/map/write-lane suites, typecheck/build, and installed Electron Node-mode. Runtime SQL evidence is not visible UI, author acceptance or completed migration. Detailed results and remaining failures belong in the receipt checkpoint (private local evidence: `../../tasks/09-11-v3-unified-event-projection/research/receipt-schema-verification.md`; omitted from the source snapshot).

## 7. Wrong vs Correct

```ts
// Wrong: schema availability or a partial write is not a completed author migration.
// if (schemaVersion >= 40) return { migrated: true }
// INSERT OR REPLACE INTO event_migration_receipts ...

// Correct: only ordinary empty structural preparation is implemented here.
assertEventMigrationReceiptSchema(database)
// Future reviewed writer must own ONE transaction containing content + all aliases
// + receipt seal + module pointer + retirement of legacy writes/mirror plans.
// Future receipt reader must validate that full retained evidence, never replay it.
```
