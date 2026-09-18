# V3 global model connection storage foundation

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` for the private storage/application foundation only. Task: `09-12-v3-global-model-connections`, still `in_progress`. This is not acceptance of cross-book reuse or a usable settings screen.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/model-connections.ts`, `desktop/src/main/modules/models/application/model-connections-service.ts`, `desktop/src/main/modules/models/adapters/model-connections-store.ts` and the guarded text-write seam in `desktop/src/main/platform/storage/atomic-file.ts` (paths relative to the repository root). Product authority: `docs/PRODUCT-BASELINE.md` and `docs/DATA-AUTHORITY-MATRIX.md`.

The app owns connection metadata and protected credentials, independently of any book. This foundation makes no provider/catalog call and has no IPC/main composition, live book assignment or renderer integration. Subsequent [selected legacy reuse](v3-legacy-connection-reuse.md) adds a private reader/session and optional strict append-only receipts. [Portable book documents](v3-book-model-settings.md) and [read-only resolution](v3-book-model-resolution.md) privately compose references/SQLite/AiClient. [Versioned default templates](v3-new-book-model-defaults.md) add an optional strict default field and retained creation snapshot, but no actual ProjectService initialization/registration or UI yet. No current production file is silently migrated.

## 2. Signatures

```typescript
interface GlobalConnectionRepository {
  read(): Promise<GlobalConnectionSnapshot>
  commit(expected: GlobalConnectionSnapshot, next: GlobalConnectionDocument,
    beforePublish?: { recheck(): Promise<void>; assertActive(): void }): Promise<GlobalConnectionSnapshot>
}
interface ModelConnectionSecrets {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}
// ModelConnectionsService(repository, secrets, newId)
list(): Promise<GlobalConnectionsView>
create(value: unknown): Promise<GlobalConnectionsView>
update(value: unknown): Promise<GlobalConnectionsView>
prepareCredential(id: string, expectedConnectionRevision: number): Promise<{
  connectionId: string
  connectionName: string
  protocol: 'openai-compatible' | 'gemini-native'
  baseUrl: string
  assertCurrent(): Promise<void>
  use<T>(send: (apiKey: string) => Promise<T>): Promise<T>
}>
// Optional guard is run before every rename attempt, including Windows retries.
atomicWriteText(path: string, content: string, beforeReplace?: () => Promise<void>): Promise<void>
```

`ModelConnectionsStore` accepts only a trusted absolute, already-existing app `userData` root, plus an optional private publisher for deterministic failure tests. Never supply a renderer-selected directory. The secret interface is structurally compatible with the existing settings codec; the OS adapter has not yet been wired into this service.

## 3. Contracts

- File: `userData/global-model-connections.json`. Root: `{version: 1, revision, connections, reuseReceipts?, newBookDefaults?}`. Entry: `{id, name, protocol?, baseUrl, enabled, revision, encryptedApiKey?}`. Missing `protocol` is a legacy `openai-compatible` row and remains absent on read or unrelated writes; every newly created row stores an explicit protocol. No plaintext key, book content, book path or diagnostics fields. Receipt/default contracts are owned by their linked specs; ordinary edits preserve both.
- Limits: 100 entries; 4 MiB UTF-8 file; name 80 UTF-16 code units; endpoint 2048; input key 4096; ciphertext 16384. IDs match `^global-[a-zA-Z0-9][a-zA-Z0-9_-]{0,72}$`. Revisions are safe nonnegative integers, with entry revisions starting at 1 and not exceeding the document revision.
- Strict plain-object/allowed-own-field validation; no coercion, sparse entries, duplicate IDs or unknown schema/fields. Input names/URLs are normalized; stored values must already be normalized. HTTP/HTTPS only; reject userinfo, query and fragment, including trailing `?`/`#`. Ciphertext must have bounded base64 syntax; syntax alone does not prove decryptability.
- Create: `{expectedRevision, name, protocol, baseUrl, apiKey?}`. `protocol` is exactly `openai-compatible` or `gemini-native`; it is not inferred from names, URLs or model IDs. Update: `{expectedRevision, id, connectionRevision, name?, enabled?, apiKey?, clearApiKey?}`; at least one effective requested field, and setting plus clearing a key is invalid. Protocol and endpoint are immutable. There is no physical deletion API. Equal names/addresses do not merge identities. Main must provide the ID generator; no name-derived identity.
- An actual edit increments document and edited-entry revisions; a no-op update does not write. The repository independently rejects deletion, endpoint mutation and forged transition revisions. Encryption completes before metadata/ciphertext publish together. Keyless metadata may be saved when encryption is unavailable.
- Public view: `{revision, connections: [{id, name, protocol, baseUrl, enabled, revision, credentialState}]}` only. The effective legacy protocol is projected explicitly. `missing` means no ciphertext, `unavailable` means codec availability failed, and `stored` means ciphertext exists and the codec reports available. Neither `stored` nor `enabled` proves connectivity or successful decryption. Listing never decrypts or writes.
- Private snapshots carry a raw-byte SHA-256 fingerprint (`null` for an absent file), not a UI authorization token. Reads reject corrupt/future/oversized/invalid-UTF-8 data rather than return defaults. The file must be an ordinary single-link file; link/path identity checks use exact bigint inode values.
- Commits snapshot caller inputs, serialize within an instance, acquire an exclusive `.lock`, compare revision plus raw fingerprint, then stage/sync/replace. The normal path uses rename. On Windows, an existing EFS-encrypted target may report `EXDEV` even within one directory; the bounded fallback first creates and syncs an exclusive encrypted `.efs-backup`, removes the old target, exclusively copies and syncs the staged file, then removes staging and backup. A fallback failure attempts to restore and sync the backup; if restoration cannot finish, the backup is retained. Reads fail closed whenever such a backup marker exists, so an interrupted replacement can never project revision 0 or silently overwrite authority. The optional private source guard runs first, then canonical root/raw target fingerprint are checked, then a synchronous active-scope check precedes every replacement attempt. Cleanup only removes the lock identity this operation created. A pre-existing or replacement lock is never stolen. A lost reply after publication is uncertain completion, not proof of rollback; reuse retries inspect the durable receipt.
- A prepared credential freezes endpoint, entry revision and ciphertext privately. Each `use` rechecks these plus enabled/existence before decryption and invoking a trusted main-only sender; rotation, disable or same-revision external key/endpoint drift rejects. An unrelated connection edit does not revoke it. There is no global fallback. This capability must not cross IPC or be treated as a key-export function.
- No new environment variables, DB migrations, network listeners or dependencies.

Storage limits: the lock coordinates cooperating writers; it is not a filesystem CAS against hostile/uncooperative programs. A check-to-replacement race remains possible outside that protocol. Crash locks and interrupted EFS backup markers are retained and currently block reads/writes; explicit recovery UI is pending. The EFS fallback necessarily has a bounded remove/copy window protected by a synced recovery copy; do not describe it as rename-atomic. Do not claim parent-directory fsync/power-loss durability, arbitrary main-code secrecy, or JavaScript memory zeroization. An already-invoked sender is not retroactively cancelled by later key rotation.

## 4. Validation & Error Matrix

| Condition | Result | Required preservation |
| --- | --- | --- |
| File absent in valid app root | Empty revision 0 projection | No directory/file/lock created by read |
| Relative/missing root, bad JSON/UTF-8/schema, oversized or linked target | Safe `STORAGE_ERROR` | Do not repair, reset or follow linked target |
| Invalid create/update, over-limit catalog | Safe `VALIDATION_ERROR` | No credential encryption or write after validation rejection |
| Stale doc/entry revision, changed raw snapshot, held lock | Safe `CONFLICT` | Old/external target and foreign lock preserved |
| Selected ID absent | Safe `NOT_FOUND` | No search through other connections/books |
| Disabled/keyless, codec unavailable/throws/returns bad protected value | Safe `FEATURE_UNAVAILABLE` | No send; failed encryption leaves prior state intact |
| Prepared entry changes/disappears | Safe `CONFLICT` | No decrypt or invocation of stale sender |
| Create protocol missing/unknown, or update attempts protocol mutation | Safe `VALIDATION_ERROR` | No encryption, write or network call |
| Publish/read failure or invalid repository transition | Safe `STORAGE_ERROR` | Prior committed target remains; no raw cause exposed |

Errors use `AppError` with `recoverable: true`, fixed user-facing messages and no secret/path/endpoint/raw codec cause. Provider callback errors remain inside the private application boundary; future public callers must apply the existing error/privacy contract rather than forward them as DTOs.

## 5. Good / Base / Bad Cases

- Good: save a synthetic encrypted connection, reopen it through a new store, list safe metadata without decryption, then privately use its exact current credential.
- Base: no connections yet, or a keyless/disabled entry; listing still works and a send is explicitly unavailable.
- Bad: edit an existing global endpoint, expose ciphertext in an IPC result, use a caught parse error as empty defaults, steal a crash lock, or assume the new foundation already changes existing book routing.
- Bad: infer protocol from a connection name/model ID, or rewrite a legacy row merely to add its effective default.

## 6. Tests Required

`desktop/tests/unit/models/global-model-connections.test.ts` exercises strict decoders, absence/reopen, limits, public secret exclusion, injected AES-GCM/codec failures, identity isolation, lifecycle and stale prepared use, same/cross-instance writes, raw drift, publish failure, linked targets, foreign/replacement locks, interrupted EFS backup fail-closed behavior, and old text/binary atomic callers. Assert exact target/source bytes and zero provider/decrypt calls on rejected paths, not merely file existence.

Windows gotcha: path `lstat` may return `dev = 0` while handle `fstat` returns the volume serial for the same file. Compare exact bigint inode and allow that Windows-only device discrepancy; do not drop inode checks or use rounded Number inode IDs. Encrypted save/reopen and replacement-lock preservation are regressions for this issue. These checks and bounded JSON reads now live in `desktop/src/main/modules/models/adapters/model-connection-file.ts`; codec sanitization lives in `desktop/src/main/modules/models/application/model-connection-secrets.ts`, shared with reuse.

The Windows file-symlink case is an explicit test skip when the OS returns `EPERM`; hardlink coverage is separate and must pass. Tests use temporary roots and a synthetic cipher, not the author's app profile or OS credentials. Related atomic consumers plus model-routing regressions, typecheck and desktop build are required. OS safeStorage, actual IPC/provider integration, UI, crash-recovery controls and author experience remain later gates, not proven by these tests. Shared scalar/record validators now live unchanged in `desktop/src/main/modules/models/domain/model-connection-values.ts`, re-exported here, to avoid a global/default/book decoder cycle.

## 7. Wrong vs Correct

```typescript
// Wrong: corruption becomes an empty authority, inviting destructive overwrite.
try { return await loadFile() } catch { return emptyGlobalConnections() }
// Correct: only a genuinely absent file returns revision 0; other failures block writes.
if (fileMissingInValidatedRoot) return { document: emptyGlobalConnections(), fingerprint: null }
throw safeStorageError()
```

```typescript
// Wrong: cache a plaintext key or combine it with an edited draft endpoint.
send(draft.baseUrl, previouslyDecryptedKey)
// Correct: retain a main-only capability bound to the immutable stored endpoint.
const prepared = await service.prepareCredential(selectedId, observedRevision)
await prepared.use(key => send(prepared.baseUrl, key))
```
