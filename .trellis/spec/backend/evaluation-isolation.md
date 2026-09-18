> V3 status: `candidate-for-v3`. This evaluation implementation is not accepted into V3; retain it only as evidence for a future V3-3 task.

# Fixed semantic evaluation isolation

## 1. Scope / Trigger

Settings can change while five semantic batches and their bounded JSON repairs are in flight. A model name alone does not identify an API; two connections can expose the same name. Keep one evaluation internally consistent without blocking the author's settings UI.

## 2. Signatures

- `AiClient.prepareCompletion(task, modelOverride?, connectionIdOverride?): Promise<PreparedAiCompletion>`
- Prepared completion exposes only `model`, `connectionId`, and `complete(instruction, draft?, systemContext?, signal?)`.
- `ConsistencyEvaluationService.run(signal, onProgress?, expectedRoot?)`; job service passes its captured `workItemId` as `expectedRoot`.
- `writeJson(path, value, beforeCommit?: () => Promise<void>)`; existing unguarded callers retain their behavior.
- Developer CLI: `node scripts/evaluate-live-consistency.mjs --check-credentials|--run-live --profile <existing-user-data> [--output-root <existing-directory>]`. Exactly one mode is required. `npm run test:live-evaluation-runner` uses only synthetic temporary fixtures.

## 3. Contracts

Clone the resolved profile. Capture credentials and endpoint only in an in-process closure; never serialize the resolved connection. Every batch and format repair uses this prepared completion. Read the configured repair count once per run. Ordinary `AiClient.complete` prepares anew on every call; streaming behavior is unchanged.

The report adds the non-secret `connectionId` to existing `anonymous-evidence-v1` metadata. Legacy reports remain readable, without inventing a connection for them. No credential, endpoint URL or raw provider error is added to the report or UI summary.

The explicit live CLI uses a separate headless Electron profile and removes `ELECTRON_RUN_AS_NODE` entirely (an empty value is insufficient on Windows). It reads formal AI settings via a read-only SQLite connection, never the migrating workspace factory. Decrypt only the configured review route. `--check-credentials` makes no HTTP request. Live mode reuses `AiClient` and the fixed evaluator, writes into a new artifact folder outside the book/profile, caps the run at ten requests and twelve minutes, and stops immediately on HTTP 401/403/429. Validate the canonical existing output parent before creating the run folder. Source-book identity is checked on every request and report commit; no author body is read or sent. No alternate API fallback.

On Windows, the Node launcher must prepare `--user-data-dir` **before Electron starts**. OSCrypt initializes from Local State before app readiness; asynchronous `app.setPath` after filesystem awaits is not reliable isolation. The private runtime receives only `os_crypt.encrypted_key` (still OS protected), never the full source profile, cookies or plaintext credentials. Delete the private runtime on child exit after validating its canonical parent and generated prefix. The source profile is never launched or modified. A fixture must prove an unrelated pre-start profile cannot decrypt, while a private profile with the protected key can; otherwise two late-set profiles can accidentally share a default encryption context and produce a false positive test.

Before preparation, after preparation, before every request/repair and before report promotion, validate current book identity and cancellation. `writeJson` stages to a unique temporary file, runs the guard immediately before each rename attempt, and removes its own staged file if the guard rejects. The rename is the commit point: cancellation after commit is not a rollback and must not erase a completed report. This is not a cross-process lock or a multi-file transaction.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| API/model/parameters changed during batches | Existing run keeps captured configuration; next run reads new settings |
| Cancelled before request or before report commit | AbortError; old report unchanged; no remaining staged report |
| Book changed during preparation, batches or before commit | Recoverable CONFLICT; neither book's report replaced |
| Provider ignores abort and returns late | Parser/run cancellation guards reject late output |
| Provider/format failure without cancellation | Existing unable-to-judge accounting remains; never invent predictions |
| CLI stored key unreadable | `CREDENTIALS_UNREADABLE`, zero HTTP requests; do not call this an API rejection |
| CLI incomplete semantic coverage | Keep truthful report/status, exit nonzero rather than claim completed evaluation |
| CLI output overlaps book/settings | Reject before creating a report directory there |

## 5. Good/Base/Bad Cases

- Good: five batches plus one JSON repair all use connection A even after same-model connection B is selected.
- Base: a later ordinary generation uses B and the newly selected parameters.
- Bad: freeze `modelFor('review')` but resolve the current API/key independently for each batch.

## 6. Tests Required

`consistency-evaluation-isolation.test.ts` uses loopback HTTP and temporary books only. Assert request URL, authorization header, model, temperature, top-p, output limit and resolution counts; mutate the same nested settings object after the first invalid response. Assert repair uses A, next generation uses B, and no secrets occur in prompts/reports. Inject cancellation at start, pre-request, late return, last batch and staged-file promotion; compare previous report bytes and temporary-file lists. Switch books at preparation, between batches, staged promotion and job-start handoff. Verify both guarded and existing unguarded JSON writes.

The CLI fixture exercises actual Electron encryption/decryption across independent profiles, zero-request credential check, five synthetic batches, immediate auth failure, ten-request malformed-response bound, incomplete exit status and protected-output rejection. Compare source DB/settings bytes and redact both stdout and report files. This verifies the runner, not real-model accuracy.

## 7. Wrong vs Correct

Wrong: `for (batch) ai.complete(..., await ai.modelFor('review'))`.

Correct: prepare once outside the loop; call the prepared closure for every request, including repairs, then publish through a guarded rename. Isolated fixture output proves routing and cancellation, not real semantic accuracy.
