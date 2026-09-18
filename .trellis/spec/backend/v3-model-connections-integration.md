# V3 model connections — production integration

> Status: verified engineering integration, 2026-09-13. Task `09-12-v3-global-model-connections`. Complements the separately verified storage, reuse, book-document, resolution, assignment and default contracts. Does not claim author API connectivity, literary quality, or complete navigation acceptance.

## 1. Scope / trigger

Applies to the model runtime composition, named main/preload surface, safe book projection, explicit creation/default application, private-key management and provider lifetime. Main composes the existing store, resolver and shared per-book write coordinator. It does not migrate author books on launch or add a provider protocol. The retired `ProjectAiService` bulk connection writer is not the production settings writer.

## 2. Signatures

`registerModelConnections(ipc, userData, secrets, projects, formal, writes, local, change, settings)` uses the **same SettingsStore instance/lane** as project registration. `attach(window)`, `beginChange(preserveCreation?)`, `endChange()` and `leaveBook()` bind/revoke main-window/book generations. `app.requestSingleInstanceLock()` runs after the optional existing `LANJIAN_USER_DATA_PATH` override; a non-owning process does not register writers.

`DesktopApi.modelConnections` exposes only named operations:

- `list/create/update`, `defaults/saveDefaults`;
- `book/saveBook`, `renamePrivate/savePrivateKey`;
- `previewApply/confirmApply`, `previewReuse/confirmReuse/reuseReceipt`;
- `cancelPreviews/leaveBook`, `test/catalog/cancelTest`;
- `previewCreation/createProject/retryCreation`.

Input/result owners: `desktop/src/contracts/models/model-connections-contracts.ts`. Main validates both directions; preload uses the registered `ipc-response` decoder. Project summaries remain with the existing project decoder. No generic IPC or renderer path-to-key lookup.

## 3. Contracts

- Book edit and creation/apply tokens are process-retained UUIDs, expiring after 15 minutes. Reuse tokens have the distinct `reuse-…` grammar. Do not validate one with the other's decoder. Cancellation, window loss and book changes invalidate pending rights; successful receipts remain independently queryable under source checks.
- `book()` returns `{token, revision, bookIdentity, settings}` with no secret/presence-derived fallback. Save returns `{settings, authority, mirrorStatus}`. File/SQLite authority is captured before waiting; no loose second sync from the current book. Runtime task projections use document-derived stable global provider identities.
- Private names and private keys are separate explicitly acknowledged operations. Names use the existing guarded book writer. `SettingsStore.preparePrivateModelKeys` retains strict bounded app bytes and canonical identity; the shared settings lane rechecks them and the source immediately before atomic publication. Only the captured book/original ID changes. Metadata, other settings and existing global copies are not rewritten. Endpoint changes require a new global identity, never forwarding an old key to a new draft URL.
- `previewCreation(false)` retains the current default version and selected-reference checks. `true` explicitly creates without defaults even when the app catalog cannot be read. New roots are allocated exclusively, initialized before registration, and get copied v4 references/parameters but no keys. The legacy public `projects:create` dispatch also uses the initializer; it no longer bypasses defaults.
- Partial creation returns `{status:'partial', operationId, title, code, message, modelsWritten}`. Only a retained operation-owned root/identity can retry. Unknown existing targets are never overwritten. Already published model bytes cannot be relabelled or replaced during retry. Restart invalidates pending rights; files remain inspectable through normal opening. No recursive rollback of author folders.
- Explicit apply-default preview contains before/after and bounded differences; confirmation checks source, default and selected references. Opening/importing/restoring an existing project does not apply defaults.
- An ephemeral `global:<global-id>` choice is explicitly global and cannot collide with a legacy alias. It resolves without saving references. Local selection does not read global/private credentials or fall back to cloud. One-off public model IDs allow the extra scope prefix; saved alias grammar stays unchanged.
- `AiClient.captureRun(tasks, connectionOverride?)` keeps provider/profile/guards privately, never in IPC or task context JSON. WritingAgent keeps its captured client in a WeakMap keyed by its prepared run. Native chapter drafts, planning batches and structured repair loops use retained clients. Each unsent text/tool/image request rechecks source/credential/scope; already-sent work is not replayed with another key. Local profile wrapping retains its captured local guard without re-resolving a cloud default.
- Global tests send a bounded synthetic prompt only on explicit action. Catalog cancellation reaches the actual fetch signal. Oversized/control-character/key-containing model results are rejected, not truncated into a false complete catalog. Results contain only safe metadata, never provider reply text or credentials.
- An AI-settings bootstrap failure returns `aiSettings:null` plus `modelSettingsUnreadable`; readable manuscripts remain available. Null without this issue is invalid. UI failure is not persisted as an empty formal model document.

## 4. Validation / error matrix

| Case | Result |
| --- | --- |
| Unknown field, malformed token, secret in public result | Reject at main/preload boundary |
| Foreign window or subframe | `FEATURE_UNAVAILABLE`, no action |
| Book/default/reference drift, used token, leaving the book | `CONFLICT`, preserve inputs/data |
| Missing/disabled/unavailable credential | Explicit unavailable/not-found error; no fallback |
| Existing creation target | Reject before overwriting any target file |
| Failure after new root allocation | Partial result/recovery, not success or deletion |
| Formal commit accepted, mirror unavailable | Return success plus mirror state |
| Follow-up refresh fails after commit | Display saved result and separate refresh warning |
| Damaged optional model authority | Visible repair issue, manuscripts not hidden |

## 5. Good / base / bad cases

- Good: save one shared connection; A/B copy default v1; A-only edit; default v2; C gets v2 while A/B keep their own documents; explicit preview/confirm updates B.
- Base: no default or explicitly manual creation makes an unconfigured book; normal hand-written work requires no API key.
- Bad: borrowing another book's key, inspecting author settings as test fixtures, migrating on read, treating a provider test as literary acceptance, or treating an existing source-material folder as an operation-owned partial project.

## 6. Required tests

`model-connections-runtime.test.ts` exercises main handlers, validated preload responses, real temporary ProjectService roots, A/B/C/apply, private rotation/rename, legacy reuse, scope revocation, explicit probes, one-off choices, image guards, local zero-cloud and legacy public creation. Foundation suites cover strict files, Windows identity, revisions, SQLite authority and mirror failures. `structured-response-repair.test.ts` requires one retained provider across parser repair attempts. `workspace-bootstrap-service.test.ts` proves model failure does not remove manuscripts.

`scripts/global-model-connections-smoke.mjs` uses isolated userData/books, OS-encrypted synthetic keys and a loopback provider. It validates actual UI creation, saved files, restart, independently edited defaults, explicit apply, private reuse, keyboard/Chinese composition and reviewed light/dark/zoom frames. All non-loopback test traffic is blocked. See task `research/model-connections-integration-verification.md` for counts, first failures and remaining gates.

## 7. Wrong vs correct

Wrong: freeze prose/model name, then call a fresh settings resolver for review; or call `withLocalProfile` and re-read whatever is now the cloud default.

Correct: capture the task's clients once, retain capabilities only in process memory, and let send guards reject revoked snapshots. Correct book return-to-library revokes these rights **without** deleting the remembered-book preference.

## Scenario: Gemini native remote protocol

### 1. Scope / Trigger

Use this contract when a global connection declares `protocol: 'gemini-native'`. The provider is not OpenAI-compatible even when its service root also exposes `/v1/models`; runtime routing must follow the stored protocol, never endpoint probing or model-name guessing.

### 2. Signatures

```typescript
type RemoteModelProtocol = 'openai-compatible' | 'gemini-native'
type RemoteModelConnection = {
  kind: RemoteModelProtocol
  baseUrl: string
  apiKey: string
}
```

`GeminiNativeTextClient` implements the existing text-client `listModels`, `complete`, `completePreparedMessages` and `streamComplete` seams. A captured run retains one frozen connection/protocol for initial generation and structured-response repairs.

### 3. Contracts

- Endpoint assembly preserves an explicit terminal API version. A bare root uses `/v1beta/models`; a configured root ending in `/v1` or `/v1beta` uses that exact prefix plus `/models`. Generation appends `/{encodeURIComponent(model)}:generateContent`; stream uses `:streamGenerateContent?alt=sse`. Never produce `/v1/v1beta`.
- Send the credential in both `Authorization: Bearer` and `x-goog-api-key`. This matches multi-protocol NewAPI gateways while remaining header-only. Never place the key in a query string, URL, error or task artifact.
- Map system text to `systemInstruction`; map user/assistant history to Gemini `user`/`model` contents; map temperature, top-p and output-token limits to `generationConfig`.
- Extract only textual parts whose `thought` flag is not `true`. Ignore `thoughtSignature`, binary and unknown parts. Empty final text is an invalid provider response.
- Parse bounded JSON/SSE incrementally, honor cancellation/timeouts, cap transport bytes at 24 MiB, and reject truncation finish reasons. Tool conversations are unsupported and must fail before network I/O.
- There is no protocol, provider, model or credential fallback after a run is captured.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unsupported tool request | `FEATURE_UNAVAILABLE` before fetch |
| Malformed JSON/SSE, empty final text, oversized response | safe provider failure; no partial formal result |
| `thought:true` plus final text | expose final text only |
| Only thought/signature/binary parts | reject as empty response |
| Truncated/max-token finish reason | reject incomplete result |
| Rotation, disable, protocol/source drift before an unsent call | `CONFLICT`; no fallback send |

### 5. Good / Base / Bad Cases

- Good: native SSE contains thought chunks followed by final prose; callbacks and final result contain only prose.
- Base: one ordinary final text part completes successfully.
- Bad: send native traffic through `/v1/chat/completions`, append `/v1beta` to an already versioned gateway root, expose thought text, retry with another protocol, or silently accept a truncated chapter.

### 6. Tests Required

Use a loopback server to assert exact path, method, both authentication headers and body; assert absence of query secrets. Cover bare-root `/v1beta` and explicit `/v1`/`/v1beta` assembly, catalog, non-stream, SSE deltas, thought filtering, malformed/empty/oversized/truncated responses, cancellation and tool rejection before any request. Runtime tests must prove saved tests, captured writing runs and structured repairs retain the same native protocol.

### 7. Wrong vs Correct

```typescript
// Wrong: a Gemini model name does not make an OpenAI request native.
post(`${root}/v1/chat/completions`, { model: 'gemini-3.8-flash-high' })

// Correct: dispatch from the immutable stored protocol.
protocol === 'gemini-native'
  ? gemini.complete(capturedConnection, request)
  : openAi.complete(capturedConnection, request)
```
