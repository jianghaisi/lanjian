# V3 error and privacy boundary

> Status: `verified-current`.

## 1. Scope / Trigger

Apply whenever failures cross domain/application, IPC, filesystem, database, provider, UI or diagnostic-export boundaries.

## 2. Public shape

Public failures use a stable allowlisted code, a safe user-facing message, recoverability and only bounded safe details. Internal causes retain diagnostic context locally but do not cross IPC.

## 3. Contracts

- Validate inputs before work and outputs before exposing them.
- Do not return or persist stacks, raw provider errors, prompt/body content, secret material, encrypted blobs or unrelated absolute paths.
- Cancellation, conflict, offline, unavailable credentials and validation are distinct states; they are not generic success or empty data.
- Unknown exceptions become a generic internal error while preserving the internal cause in redacted local diagnostics.
- UI success appears only after the authoritative operation confirms; a mirror warning remains visible separately.

## 4. Failure behavior

Malformed or unknown boundary data fails closed. Partial work keeps its recovery evidence and cannot be silently retried as if nothing happened. Late errors/results from another book or target cannot replace current UI state.

## 5. Good / Base / Bad cases

- Good: stable conflict code + safe explanation + explicit recheck action.
- Base: optional missing file maps to its documented absent state.
- Bad: catch-all returns `[]`, raw `Error.message`, full path, prompt or manuscript excerpt.

## 6. Required verification

Test malformed args/results, unknown exceptions, cancellation races, stale identity and redaction. Assert forbidden values are absent from IPC DTOs, logs, task records and exports.

## 7. Ownership

Feature-specific error codes and retry behavior belong to the feature's V3 task. Candidate error scenarios in older specs do not become active through this general contract.

## 8. Scenario: JSON replacement on an EFS-encrypted Windows directory

### 8.1 Scope / Trigger

Apply when the JSON settings/compatibility store stages a sibling file and Windows returns `EXDEV` while replacing an existing target. This can occur on an NTFS Encrypting File System (EFS) directory even though both paths are on the same volume. Other publisher implementations remain separate until their active task explicitly adopts this contract.

### 8.2 Signatures

- `writeJson(path, value, beforeCommit?)`: serializes writes per exact target path.
- `recoverableFileReplace(temporary, path, expectedContent, hooks?)`: EFS-only helper used by `writeJson` after the normal atomic rename reports `EXDEV`; JSON supplies a parseability validator for recovery bytes.
- Recovery file: `${path}.recovery`; it contains the last parseable JSON bytes and inherits the directory's EFS protection.

### 8.3 Contracts

- Normal filesystems continue to use sibling staging plus atomic rename; do not select the copy fallback pre-emptively.
- On `EXDEV`, preserve the current parseable target before overwriting it, re-run the stale-operation guard, copy the staged bytes, and verify the exact committed text before removing staging and recovery files.
- If replacement or verification fails, restore the recovery copy. If replacement and restoration both fail, retain both causes in an `AggregateError` locally; IPC still receives only the safe generic boundary error.
- A read may use a parseable recovery copy only when the target is absent or invalid. A valid target always remains authoritative.
- The fallback must not decrypt the directory, move settings to another root, expose credentials, or treat a failed write as success.

### 8.4 Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Normal sibling rename succeeds | Commit normally; no recovery file |
| Rename returns `EACCES`, `EBUSY` or `EPERM` | Keep bounded retry behavior |
| Rename returns `EXDEV` and target is parseable | Preserve recovery, verified copy replacement, cleanup |
| Target is invalid but recovery is parseable | Preserve recovery until a verified new target exists |
| Replacement verification fails | Restore previous JSON and report failure |
| Replacement and restoration fail | Local `AggregateError`; safe IPC error without paths or content |

### 8.5 Good / Base / Bad Cases

- Good: EFS rejects rename, the old settings are copied to recovery, exact new bytes are verified, and switching books succeeds.
- Base: ordinary NTFS uses the existing atomic rename path unchanged.
- Bad: decrypt the user's AppData directory, delete the target before staging is durable, return default settings after a truncated overwrite, or expose the raw filesystem exception over IPC.

### 8.6 Tests Required

- Unit-test successful recoverable replacement and assert exact bytes plus no leftover staging/recovery file.
- Unit-test interrupted/invalid target reads from a parseable recovery copy.
- Unit-test verification failure restores the previous exact JSON.
- Keep the concurrent same-target JSON test to assert serialization and staging cleanup.
- On Windows, perform one focused EFS integration check when the author profile is EFS-encrypted; assert project switching succeeds and no new temporary file remains. Use isolated data for automated suites.

### 8.7 Wrong vs Correct

```typescript
// Wrong: EXDEV becomes a generic click failure, or the target is deleted first.
await rename(temporary, target)

// Correct: retain normal atomic rename, but recover safely when EFS rejects it.
try { await rename(temporary, target) }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  await recoverableFileReplace(temporary, target, expectedContent, { beforeCommit })
}
```

## 9. Registered library reads are complete or explicitly failed

The project shelf is authoritative registered state. A per-project catch-all must not turn an unreadable existing work into an apparently complete shorter shelf.

- Retry bounded transient filesystem failures while reading a registered project.
- Hide an entry only after its registered root is confirmed missing; keep the settings entry as a recovery clue.
- If an existing root remains unreadable, fail the list with a safe recoverable storage error and preserve the internal cause locally. Do not expose its path or raw error across IPC.
- Regression tests cover transient recovery and persistent failure; a returned list is never a silent partial success.
