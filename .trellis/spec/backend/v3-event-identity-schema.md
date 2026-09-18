# V3 canonical event identity schema preparation

> Status: `verified-current` structural contract only. Authority: approved slice 2, `09-11-v3-unified-event-projection`, and [planning/event consistency](v3-planning-event-consistency.md). Schema readiness is not author-approved content migration.

## 1. Scope / Trigger

Schema 39 permits independent canonical identities with identical content. The previous table-level `UNIQUE(project_id, event_signature)` prevents the approved keep-separate decision even when IDs differ. Remove only that uniqueness, retaining an indexed signature for compatibility lookup. Never edit migrations 1–38, normalize retained content, deduplicate rows or manufacture historical versions to accomplish this structural change.

Normal writable database preparation installs 39 through the existing numbered migration owner, then the separate [receipt storage increment](v3-event-migration-receipts.md) advances to current schema 40. Dedicated event preview remains read-only, accepts supported old schemas and never upgrades them. Migration 39 itself creates no aliases, module-transition marker, durable review receipt, author token, lifecycle/order state, display payload fields or public route. Every slice-2 acceptance criterion remains open.

## 2. Signatures

```ts
// Current WORKSPACE_DATABASE_SCHEMA_VERSION = 40; this contract freezes migration 39.
// Checksummed migration 39: distinct-canonical-event-identities
canonicalEventIdentityCopySql: string
canonicalEventIdentityGuardsSql: string
assertCanonicalEventIdentityUpgradeSource(db: DatabaseSync, expectedSql: string): void
assertCanonicalEventIdentitySchema(db: DatabaseSync): void
rebuildSqliteTable(db: DatabaseSync, input: {
  table: 'task_runs' | 'workspace_config_documents' | 'canonical_events'
  copySql: string; guardsSql: string; integrityMessage: string
}): void
```

These are trusted infrastructure functions, not author-controlled SQL or IPC commands. `WorkspaceDatabase.migrate()` owns connection settings, `BEGIN IMMEDIATE`, ledger insertion, `user_version`, commit/rollback and final restoration of foreign keys. The three private rebuild callers for migrations 36, 37 and 39 use the same helper; its input is frozen implementation SQL, never raw event fields.

## 3. Contracts

### Exact identity and history preservation

- Keep all 13 existing canonical columns and constraints except the content-signature uniqueness. Explicitly copy `rowid` as well, preserving sparse row IDs and implicit iteration behavior. Do not insert defaults, rebuild IDs or recompute signature/content values.
- Add ordinary, nonunique, nonpartial index `idx_canonical_events_project_signature` on exactly `(project_id, event_signature)` in that order. Current-schema validation checks its shape and rejects any two-column unique index on that pair, including reversed order. Other custom indexes remain unchanged; their arbitrary write restrictions are not a promise that every future operation is possible.
- The actual old table SQL must match the frozen migration-25 definition, ignoring only whitespace and a final semicolon. Unknown columns/constraints are blockers, not permission to discard extensions. Current schema 39 also checks the entire expected table definition, not just table presence. Equivalent manually rewritten SQL may be rejected conservatively.
- Preserve every source/evidence/character row, immutable version payload/hash, sealed source, version head, incoming foreign key and explicit index/trigger/view definition. No candidate becomes approved; approved and newer candidate heads remain separate.
- Update the project schema-version trigger and existing project version to 39. Existing event/history module readiness flags and mirror rows remain untouched. A schema-25 database can therefore reach structural version 39 while its event-version module is still unready and has no invented baseline.
- Migrations 1–38 retain their exact SQL/name/checksum registry. The test's golden SHA-256 over that ordered checksum registry is `ab314148eeab108aeb9de3ae32cd4272f91916261d51883cc5b0581d0a047c0b`.

### Atomic rebuild, not rename-first

The helper uses create-copy-drop-rename, preserving dependency definitions and checking foreign keys before commit, following SQLite's generalized table-change procedure. It deliberately never renames the original table first, which can retarget incoming references. [SQLite ALTER TABLE guidance](https://www.sqlite.org/lang_altertable.html#otheralter)

```text
foreign_keys OFF → BEGIN IMMEDIATE → validate schema 38 and original table
→ retain/drop views and triggers → create/copy replacement → drop old table
→ rename replacement → restore exact definitions → install v39 guards
→ foreign_key_check + validate identity shape → ledger + user_version → COMMIT
failure → ROLLBACK; finally → foreign_keys ON
```

All views and triggers are retained, including indirect/custom dependencies; target-table explicit indexes are also retained. Names are quoted, definitions are replayed unchanged, and original relative definition order is retained within views/indexes/triggers. Restoration or foreign-key errors abort the numbered migration. Automatic primary-key indexing remains part of the replacement table definition.

The helper rejects enabled foreign keys before DDL. Transaction ownership is enforced by its three private callers: Node 22.14.0 and the checked Electron Node 24 runtime do **not** expose the `isTransaction` property declared by newer installed Node types. Do not add a runtime dependency on that unavailable property. Never call the helper outside the migration owner's transaction.

Atomicity is **per numbered migration**, not across the entire historical upgrade chain. If 36–38 commit before 39 fails, those earlier successful schema upgrades are not rolled back. No content migration takes place in this path.

### Preserve the legacy write lane

Removing SQL uniqueness must not silently expand existing create/edit semantics. Within existing write transactions, private `assertLegacyEventSignatureAvailable(projectId, eventId, signature)` checks the same project and signature excluding that event's ID. `insertCanonicalEvent` and `updateCanonicalEventProjection` invoke it before their respective row write. Collision is a safe `CONFLICT`; failed version adoption rolls back its history/head/source writes too. Existing bulk compatibility validation remains unchanged.

Future reviewed migration needs a distinct, explicitly validated write owner for keep-separate identities. Do not bypass legacy guards globally or present the raw SQL test fixture as an implemented migration API. Old schema-38 reads still run their complete schema-38 validation; raising the current constant must not downgrade them to table-presence checks.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Valid fresh/old database, normal writable preparation | Install 39; preserve rows/history/readiness/mirror evidence |
| Read-only acquisition of valid schema 38 | No upgrade and no source/mirror mutation |
| Required old guard/checksum missing or changed | `DATABASE_INTEGRITY_FAILED`; do not repair evidence |
| Unknown old/current canonical table shape or conflicting signature uniqueness | `DATABASE_INTEGRITY_FAILED`; no deletion of unknown structure |
| Missing, unique, partial or wrong-column current signature index | `DATABASE_INTEGRITY_FAILED` on read; no repair |
| Helper invoked with foreign keys enabled | `DATABASE_MIGRATION_FAILED` before DDL |
| Copy, dependency restoration, guard, ledger, commit or FK-check failure | Propagate failure through existing migration boundary; roll back this migration and restore FK enforcement |
| Legacy create/adoption would duplicate another event signature | Safe `CONFLICT`; no partial event/version/mirror changes |
| Separate equal-content raw fixture IDs with independent history | Both survive reopen; no merge or automatic approval |

Unknown table/index-name collisions may originate as SQLite errors and use existing connection/migration error handling; do not expose raw SQL or paths through a new boundary. No IPC error contract is added here.

## 5. Good / Base / Bad Cases

- Good: sparse row IDs 11 and 73, approved history plus a newer candidate, cross-version sources, custom incoming FK and indirect views survive exactly; custom triggers still execute afterward.
- Base: fresh schema 39 has zero event/version rows; schema 25 upgrades without an automatic version baseline or module adoption.
- Bad: a custom extra column, occupied replacement-table name, bad checksum or colliding unique index blocks instead of dropping evidence. A copy-stage FK violation or restoration failure cannot leave a partly rebuilt authority.

## 6. Tests Required

`desktop/tests/unit/timeline/event-identity-schema.test.ts` currently has 25 tests covering fresh/25/38/current versions; complete schema/table rows, sparse rowids and original files; custom quoted definitions and incoming FKs; immutable sources/seals/heads; equal-content separate identities; compatibility collision rollback; actually executed failure hooks at five stages plus FK failure; malformed old/current shape/index checks; repeated upgrade; frozen prior checksums and 5,000 retained events.

Regress the existing event foundation, native-task pause rebuild, world-map, read/snapshot/review/bootstrap/timeline and broader SQLite/planning/write-lane suites when changing the helper or version checks. The v35-upgrade schema assertion accepts only the explicit canonical DDL delta and retains all other exact comparisons. Test both standalone Node and the installed Electron's Node/SQLite runtime. Node-mode success is not visible Electron UI, author acceptance, reviewed content migration or long-book responsiveness acceptance.

Fixtures must remain synthetic, canonical OS-temp roots with validated ownership before cleanup. Do not open author books to prove a migration. Record failures before fixes, expanded unrelated failures, exact commands and index-preservation evidence in the task receipt. See schema checkpoint (private local evidence: `../../tasks/09-11-v3-unified-event-projection/research/identity-schema-verification.md`; omitted from the source snapshot).

## 7. Wrong vs Correct

```ts
// Wrong: change a historical checksum, collapse matching text, or invent approval.
// oldMigration.sql = oldMigration.sql.replace('UNIQUE (...)', '')
// events = uniqueBy(events, event => event.eventText)
// if (schemaVersion === 39) moduleMigrated = true

// Correct: append a checksummed structural migration; preserve evidence exactly.
// migrate() has already disabled foreign keys and opened BEGIN IMMEDIATE.
assertCanonicalEventIdentityUpgradeSource(db, frozenCanonicalTableSql)
rebuildSqliteTable(db, {
  table: 'canonical_events', copySql: canonicalEventIdentityCopySql,
  guardsSql: canonicalEventIdentityGuardsSql, integrityMessage: '事件外键完整性检查失败。'
})
assertCanonicalEventIdentitySchema(db)
// migrate() records and commits this numbered migration; reviewed content work is separate.
```

Optional version-bound display metadata is covered by the separate [display contract](v3-event-display-metadata.md); it requires no schema change. Schema 40 adds empty alias/receipt/module tables only. Remaining approved work includes their production write/read integration, lifecycle/order, complete author decisions and one-use authorization, commit-time source/head/placement rechecks, approved-head consumers, reviewed writers, mirror recovery, typed IPC/UI and real desktop/author validation. None is inferred from structural schema readiness.
