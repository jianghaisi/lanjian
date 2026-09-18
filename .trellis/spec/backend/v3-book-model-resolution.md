# V3 read-only book model resolution and provider send guards

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` for the private step 4b.1 composition only. Task `09-12-v3-global-model-connections` remains `in_progress`. No production main/IPC/UI/default inheritance or author-book onboarding is accepted by this increment.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/book-model-resolution.ts`, the optional private guard in `desktop/src/main/modules/models/domain/model-provider.ts`, `desktop/src/main/modules/models/application/book-model-resolver.ts`, the AI snapshot/book-source/private-credential infrastructure adapters, and guarded dispatch in `desktop/src/main/modules/models/application/ai-client.ts` / `desktop/src/main/modules/models/adapters/openai-compatible-text-client.ts`.

Uses the [portable book document](v3-book-model-settings.md), [global connection capability](v3-global-model-connections.md) and existing disposable SQLite snapshot mechanism. `legacy-connection-source.ts` delegates only its AI SQL query to this shared adapter; [reuse preview](v3-legacy-connection-reuse.md) retains its conservative whole-source fingerprint. No legacy project getter, write-capable database factory or SettingsStore mutation is used by this read path.

## 2. Signatures

```typescript
type BookModelRequestScope = { windowId: string; generation: number; bookRoot: string }
type ModelRequestGuard = { recheck(): Promise<void>; assertActive(): void }
// Both existing resolved local/remote types gain optional requestGuard; no shared DTO change.
new BookModelResolver(books, privateKeys, globals, secrets,
  currentScope: () => BookModelRequestScope | null)
resolve(task: AiTask, connectionIdOverride?: string): Promise<ResolvedModelConnection & { profile: ModelProfile }>
resolveConnection(connectionId: string): Promise<ResolvedModelConnection>
BookModelSourceReader.capture(bookRoot): Promise<BookModelSnapshot>
PrivateModelCredentialReader.capture(canonicalBookRoot, originalConnectionId): Promise<PrivateModelCredential>
// Infrastructure-only:
readAiAuthority(root): Promise<{ formal: boolean; value?: unknown; content?: string;
  fingerprint: string | null; documentFingerprint: string }>
```

`BookModelSnapshot` carries canonical `bookRoot`, physical `sourceIdentity`, `documentFingerprint`, parsed `settings` and `assertCurrent()`. The later [captured assignment save](v3-book-model-assignments.md) also carries `storage` (mode/schema/project/readiness/AI hash+revision, from `readAiAuthority`) and `fileHash`; these additions do not alter read authority or create a writable handle. A private key snapshot carries ciphertext plus `assertCurrent()`; it never decrypts itself. `GlobalModelCredentialReader` exposes only the existing private `list` and revision-bound `prepareCredential` capabilities, not a new IPC key getter.

## 3. Contracts

- The scope supplier is trusted synchronous main code. It must advance `generation` when the active book/window scope changes, including A→B→A. The resolver snapshots scope before asynchronous source acquisition and checks it after each stage. Renderer paths/IDs cannot supply this authority.
- Each file source capture reads twice and verifies canonical physical directory identity. A valid formal SQLite AI document wins over even an invalid readable mirror. Only schema 1 through the current version is allowed; pre-29, shadow and AI-unready states retain file authority without upgrades/imports. Impossible readiness/document combinations fail closed.
- SQL reads open only the disposable read-only snapshot. Validate the single project/mode, readiness, bounded content length, positive revision and SHA-256 before parsing. Source DB/WAL/SHM, mirrors and manuscript bytes remain unchanged by capture and recheck; temporary snapshots are disposed using the existing verified lifecycle.
- Request identity contains the physical book identity plus AI authority stamp `(schema, project ID, storage mode, readiness, AI revision/hash)` and, only for file authority, the raw file hash. Unrelated manuscript/DB changes do not revoke a prepared conversation. Legacy reuse continues to include whole DB/WAL and entire settings-file fingerprints; do not interchange these two purposes.
- Shared routing selects `shared`; per-task routing selects the named profile. An explicit override selects only a currently attached book alias or the reserved local identity; it never requires the unused default's credential. Profile sampling/budgets are copied, and unknown manually assigned model names are retained.
- Legacy v1–v3 routes remain private even when IDs start with `global-`. V4 private routes use canonical book root plus exact original ID. Selected ciphertext is rechecked independently of unrelated app settings/other-book keys. No app-default/other-book key fallback.
- V4 global routes select the exact live global ID and revision. Name/address diagnostics in the book never become a send target. Disabled, missing, keyless, corrupt or undecryptable entries stop. Unrelated global entry edits do not revoke the selected capability.
- Local resolution touches neither global catalog nor private credentials nor codec; actual local provider still enforces installation and output limits. Guarded local completion/messages/stream/tool/test dispatch obeys the same captured book scope. Existing explicit local catalog access and `withLocalProfile` behavior remain unchanged; the latter is an existing process-private frozen-profile path, not a new book-scope token.
- Remote preparation may decrypt once into the existing process-private provider closure. Every later unsent completion, native-message completion, stream, tool step and saved-connection probe runs `await guard.recheck()`, cancellation check, then final synchronous `assertActive()` immediately before provider invocation, with no intervening await. Callers without guards retain the existing frozen-provider behavior. Do not serialize resolved credentials/guards or add them to reports, model messages or IPC.
- A saved connection test snapshots its selected connection once across `/models` and minimal `/chat/completions`; rotation between probes stops the latter. Explicit draft URL changes cannot borrow a saved key. A draft providing URL, key and model needs no saved-settings read. The existing catalog-warning / actual-generation result convention and OpenAI-compatible/native tool/SSE roles are retained.

No new environment variables, dependencies, migrations, persistent files, background jobs or IPC methods. This is a best-effort pre-send state check, not cross-file CAS or JavaScript memory zeroization. A request already sent is neither replayed nor retroactively recalled when configuration changes. Production old `ProjectAiService` reads/saves and image requests are not yet replaced; captured-book save/feedback and public main/IPC/UI integration remain required.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Scope changes/null, physical book replacement, valid route or selected key/revision/endpoint changes | Recoverable `CONFLICT`; no stale dispatch |
| Bad JSON/UTF-8, unreadable/linked source, invalid DB/schema/hash/readiness | Safe `STORAGE_ERROR`; no repair/fallback |
| Valid JSON with invalid book shape, forbidden fields, invalid task or local budget | Safe `VALIDATION_ERROR` |
| Unsupported book version | Safe `FEATURE_UNAVAILABLE`; preserve source |
| Attached alias/global ID missing on preparation | Safe `NOT_FOUND`; no alternative identity search |
| Selected key missing, disabled, OS codec unavailable or decryption failure | Safe `FEATURE_UNAVAILABLE`; no dispatch |
| Abort before/during send checks | Abort propagates before provider invocation |
| Genuinely absent AI file | Unconfigured historical primary in memory only; no file creation or credential borrowing |

Fixed source/credential errors expose no keys, paths, raw database/codec errors or endpoints. Provider errors keep their existing safe mapping. Broken JSON is rejected at the bounded file reader before the book-domain decoder, hence storage error rather than shape validation error.

## 5. Good / Base / Bad Cases

- Good: A and B explicitly attach one global connection, use independent GPT/Gemini profiles, and generate through the real AiClient with only synthetic provider I/O in tests.
- Base: an unrelated manuscript edit during a prepared conversation does not revoke the selected AI authority; its own revision/key change does.
- Bad: infer global source from an ID prefix, silently refresh credentials between test probes, migrate SQLite while resolving, or claim cross-book reuse is already available in the production settings screen.

## 6. Tests Required

`global-model-routing.test.ts` composes real file/SQLite adapters and global service with AiClient, temporary books and synthetic AES-GCM/HTTP/local providers. Assert exact source-tree hashes, selected Authorization/model/native roles, absence of secrets from prepared public objects, and zero dispatch/decrypt where appropriate. Cover v1–v4, shared global A/B, ID collisions, A→B→A and window/physical-root drift, file/DB authority, corrupt/future/impossible states, selected key changes and unrelated-edit tolerance, tool-step revocation, cancellation/final synchronous checks, local isolation/limits, endpoint protection and test-probe binding, JSON streams and SSE.

Keep `global-model-connections`, `legacy-connection-reuse`, `book-model-settings`, `model-provider-routing`, `model-catalog`, `local-model-contracts`, `ai-tool-conversation`, `ai-client-stream` regressions plus service/SQLite/field/IPC tests, typecheck and desktop build. One unavailable Windows file-symlink branch is an explicit skip; existing task-external profile assertions remain reported, not weakened. UI/real-key/manual writing acceptance is still pending.

## 7. Wrong vs Correct

```typescript
// Wrong: an async helper finishes its scope check, then the caller sends after another await.
await validateOldScope()
await unrelatedWork()
return fetch(url, savedKeyRequest)
// Correct: recheck persistent state; finish with a synchronous assertion at dispatch.
await connection.requestGuard.recheck()
signal?.throwIfAborted()
connection.requestGuard.assertActive()
return fetch(url, privatePreparedRequest)
```

```typescript
// Wrong: a normal prose edit invalidates all pending AI conversations.
if (wholeDatabaseHash !== preparedHash) throw conflict()
// Correct: request validity uses the selected AI document authority;
// only legacy reuse preview deliberately retains the whole-source hash.
await bookModelSnapshot.assertCurrent()
await selectedCredential.assertCurrent()
```
