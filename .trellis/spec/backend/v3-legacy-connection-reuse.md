# V3 selected legacy connection reuse

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` private application/storage contract for `09-12-v3-global-model-connections`. Not wired to main/IPC/UI; no actual author credential migration or book assignment is implied.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/legacy-connection-reuse.ts`, `desktop/src/main/modules/models/application/legacy-connection-reuse.ts`, `desktop/src/main/modules/models/adapters/legacy-connection-source.ts` and the shared [global store foundation](v3-global-model-connections.md). Implements selected legacy publishing into the app catalog, not a book migration, provider call, settings screen or default inheritance.

Uses the existing private DB/WAL snapshot mechanism from `desktop/src/main/modules/timeline/adapters/event-read-snapshot.ts` unchanged. It creates/disposes owned OS-temporary scratch files, never source DB/sidecars/mirrors. Reuse does not adopt event content or expose its migration APIs. The existing write-capable SQLite opens and `ProjectAiService.get`/legacy credential-presence getters are not suitable preview dependencies.

## 2. Signatures

```typescript
type LegacyReuseScope = { windowId: string; generation: number; bookRoot: string }
interface LegacyConnectionSource {
  identity(bookRoot: string): Promise<string>
  capture(bookRoot: string, selectedIds: string[]): Promise<LegacyConnectionSnapshot>
}
// LegacyConnectionReuseService, one instance per authorized main window:
preview(value: unknown): Promise<LegacyReusePreview>
confirm(token: unknown): Promise<LegacyReuseResult>
receipt(token: unknown): Promise<LegacyReuseResult | null>
cancel(): void
type GlobalConnectionCommitGuard = { recheck(): Promise<void>; assertActive(): void }
commit(expected: GlobalConnectionSnapshot, next: GlobalConnectionDocument,
  beforePublish?: GlobalConnectionCommitGuard): Promise<GlobalConnectionSnapshot>
```

Main supplies the scope provider, secure unique global ID/token generators, OS codec and clock. Scope is not renderer input. Its generation must change on every book-session replacement, including A → B → A; close/switch must invalidate pending authorization. The private service is not an IPC decoder substitute.

## 3. Contracts

- Preview input is exactly `{selectedIds: string[], expectedRevision: number}`. Select 1–20 unique legacy remote IDs matching `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`. Local `local:llama-cpp` is never imported as a remote connection. No paths, keys, metadata overrides or fallback IDs are accepted.
- Preview result: `{token, expiresAt, expectedRevision, connections: [{sourceConnectionId, name, baseUrl, credentialState}]}`. Result/receipt contain no key, ciphertext, source path or internal source fingerprint. `stored` is presence plus codec availability, not successful decryption/connectivity.
- Known v1/absent-version single-interface metadata requires an explicit valid `baseUrl` and maps to the historical `primary` identity. V2/V3 require a bounded connection array with explicit unique ID/name/endpoint; V3 may have no remotes. Only selected connection metadata is imported. This decoder does **not** validate or adopt shared/per-task routing profiles; full book v4 parsing is a later step.
- Read only `settings.json.projectApiKeys[canonicalBookRoot]`: historical string maps to `primary`, or use that book's exact ID-to-ciphertext map. Never search aliases/other books or use `ai`/`research` keys as fallback. Absent maps show missing; malformed selected values block. The settings envelope may contain unrelated existing fields; it is never rewritten.
- The shared bounded file reader rejects invalid UTF-8/JSON, oversize, non-file, symlink/hardlink and parent escape. It reuses exact bigint Windows file-identity checks. Ordinary JSON files are at most 4 MiB. Read absence never creates an app/catalog/source file.
- SQLite reads use a byte-verified private DB plus committed WAL copy and a query-only pinned transaction. Require supported `user_version`, one project, valid storage mode/readiness and a ready document with positive safe revision and matching SHA-256. Check document byte length before retrieving `content_json`. Shadow/pre-29/unready modules use the existing file authority without import/upgrade. A ready document wins over even a damaged mirror; corruption/future schema/readiness inconsistency must not fall back to that mirror.
- Private source identity binds canonical root plus physical directory identity. The retained fingerprint additionally binds the DB/WAL snapshot (including module state), exact file/config bytes, whole legacy settings bytes and ordered selection. Capture checks twice; confirmation and publication recheck. Unrelated DB/settings edits can conservatively invalidate the preview; do not claim fine-grained drift tolerance.
- One current preview per window, valid for 900000 ms. New preview, cancel, changed scope/generation or expiry revokes pending work. Preview never decrypts/network-calls. Confirm checks source/destination first, privately decrypts and re-encrypts selected keys, then appends distinct new global connections plus one receipt in a single app-store publication. No source changes or automatic source-book assignment.
- `reuseReceipts?` is an optional schema-1 field for compatibility with the previous connection-only foundation. Each receipt is exactly `{operationId, sourceIdentity, sourceFingerprint, connectionIds}`; operation ID matches `^reuse-[a-zA-Z0-9_-]{16,80}$`, identities/fingerprints are lowercase SHA-256, and IDs reference 1–20 unique existing global entries. At most 100 receipts and 100 total global connections. Operation IDs and claimed global IDs are unique. Existing receipts cannot be mutated/deleted; a newly appended receipt can refer only to newly added connections. No pruning or physical deletion.
- Ordinary global create/update retain receipts. A same-operation retry or completed-receipt lookup verifies current source identity and returns `{operationId, connectionIds}` without decrypting/reimporting, including after restart. Pending tokens are not durable authorization. A new explicit preview is a new operation, not automatic semantic deduplication by label/address.
- The private commit guard performs asynchronous source/scope checks before checking the latest target bytes, then a final synchronous active-scope check immediately before each rename attempt. Do not await another source operation after the last catalog check, nor omit a scope check after I/O. Existing no-guard callers retain their behavior.
- If publication succeeded but its reply was lost, a receipt survives. Report uncertain save state safely and let retry discover it; never assume every thrown/transport error means no write occurred. Original book/settings remain untouched in either outcome.

No environment variables, providers, SQL schema migrations, IPC channels or UI changes are introduced. Cross-file source checks are not a distributed transaction/CAS against arbitrary external programs. The snapshot mechanism can copy a large DB and rejects copy races; this increment does not prove large-novel latency/resource bounds. Crash-lock recovery and real main/window integration remain later gates.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Invalid selection/extra input/bound exceeded | Safe `VALIDATION_ERROR`; no publish |
| Missing selected metadata, source/destination drift, cancel/switch/expiry, inactive final scope | Safe `CONFLICT`; no pending publication |
| Bad source JSON/UTF-8/schema/readiness/hash/size/path | Safe `STORAGE_ERROR`; preserve source, no default/mirror fallback |
| Missing selected key or codec unavailable/encrypt/decrypt failure | Safe `FEATURE_UNAVAILABLE`; no fallback or partial batch |
| Global publish/read failure | Safe `STORAGE_ERROR`; inspect current state/receipt before retry |
| Unknown/foreign-source completed token | Receipt lookup returns `null`; confirm without retained authorization rejects |
| Completed same-source token | Same bounded result, zero reimport/decryption |

Fixed messages and safe codes only; original codec/filesystem/DB errors, stack/cause, source paths, ciphertext and keys do not enter results. Publication-guard failure is normalized to `CONFLICT` rather than leaking its source exception.

## 5. Good / Base / Bad Cases

- Good: preview two same-name interfaces → confirm once → two distinct global IDs plus one durable receipt; both source metadata and credentials remain byte-identical.
- Base: a book has local prose plus remote outline profiles; selecting its existing remote connections does not alter the local route or require local runtime/key access.
- Bad: inspect through a mutating DB getter, decrypt just to show presence, change the source book to shared routing during import, retry by blindly creating again, or return a pending operation's result to a switched window.

## 6. Tests Required

`legacy-connection-reuse.test.ts`: real file authority for v1/v2/v3, actual SettingsStore-produced synthetic ciphertext, private AES-GCM key use, 20-entry atomic batch, capacity/schema validation, source byte/hash preservation, cancel/expiry/switch-back/window/new-preview/restart, concurrent duplicate confirmation, slow-source target drift, final synchronous scope guard, source changes during staging, fault-before-publish and lost-reply-after-publish retry, append-only receipt preservation/tamper rejection, genuine SQLite schema-28/current with v2/v3 metadata and live WAL, bad mirror ignored for formal authority, corrupt/future/unready/shadow/oversized/hash-mismatch sources and junction escape.

V3 SQLite fixtures deliberately seed valid JSON through SQLite for source-reader coverage; they do not themselves prove the AI-document **write** validator. The later [portable book document increment](v3-book-model-settings.md) closes that v2-only validator seam using actual import/replace tests. Foundation, model/local routing, model catalog, JSON store and private snapshot regression plus typecheck/build are required. Real safeStorage, IPC, actual window generation wiring, UI/IME/accessibility, crash recovery and author acceptance remain unverified.

## 7. Wrong vs Correct

```typescript
// Wrong: write-capable open or secret-presence lookup may mutate/decrypt on preview.
const configured = await settings.projectApiKeyConfigured(root, id)
const db = await databases.openExisting(root)
// Correct: selected private read snapshot, no provider or source write path.
const source = await reader.capture(trustedScope.bookRoot, selectedIds)
// Show only allowlisted metadata; confirmation retains and rechecks this source.
```

```typescript
// Wrong: a failed response is assumed to mean publication never happened.
catch { return createTheSameConnectionsAgain() }
// Correct: retry the same operation ID; durable receipt lookup precedes new work.
return reuse.confirm(retainedToken)
```
