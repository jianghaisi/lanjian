# V3 local text models

> Engineering contract for `09-12-v3-local-writing-models`. Author acceptance remains in that task; no additional downloadable model is shipped by this slice.

## 1. Scope / Trigger

Applies to local writing inference, the machine model catalog, installation preparation, model routing and SQLite model projections. Product inference remains in Electron with a narrowly managed offline Python worker. The worker cannot execute assistant tools or change novel files.

## 2. Signatures

- `DesktopApi.localModels.list(): Promise<LocalModelView[]>`
- `inspect(modelId): Promise<LocalModelView>` and `cancel(modelId): Promise<boolean>`
- `AiClient.prepareCompletion/prepareToolConversation(task, model?, connectionId?, maxTokensOverride?)`
- `LocalTextProvider`: `listModels`, `ready`, `limits`, `complete`, `toolStep`.
- `ModelAssetSource.discover/prepare` and `ModelRuntimeInstaller.prepare` are injected ports. Preparation receives an AbortSignal and progress callback; no renderer-supplied URL/path/command is accepted.
- `SqliteManuscriptService.readAiSettings` reads existing authority without migration or mirror synchronization. `ProjectAiService.update` remains the explicit import/save boundary.

## 3. Contracts

- The only local connection namespace is `local:llama-cpp`; its public projection has `kind: local`, `id`, `name`, `runtimeId`, and no URL or credential fields. Remote identifiers keep the prior identifier grammar.
- The pinned catalog currently contains only `qwen3-1.7b-q8_0` / Qwen3 1.7B Q8_0. Its immutable file size, SHA-256, revision and source URL are in `desktop/src/main/modules/models/adapters/local-models/catalog.ts`.
- The writing runtime uses 8,192 context tokens, a 512-token template/instruction reserve, a suggested 2,048-token output and a 4,096-token maximum. These are a tested runtime profile, not the model's advertised maximum. Writing context compilation uses that profile; final template tokenization rejects overflow without cutting required facts.
- `maxTokensOverride` is an integer 128–4096, accepted only with the fixed local connection. Shared request decoders carry it through conversation → field/prose handoff → writing request. It never changes saved routing. Local prepared writing runs freeze their non-secret profile and bind capacity/output to the preview hash.
- V1/V2 files remain readable without rewriting. Saving a local route produces V3. Remote-only V2 replacement retains its established connection normalization. Unsupported versions, corrupt JSON and unavailable local models do not fall back to cloud defaults.
- Local writing resolution never obtains a remote key or uses HTTP. Explicit remote catalog/test requests resolve that connection even when the book default is local. Image sources exclude local text connections in both renderer and main.
- Installation state is machine data at `userData/local-models/installations.json`, separate from novel SQLite and portable routing. Listing reports previous checks plus current resource presence; each inference revalidates the exact model hash. Detection verifies text, JSON and a real tool request before marking ready.
- Existing assets and future installers use the same preparation lifecycle. There is currently no download driver and `canDownload` is false. Merely knowing the catalog URL cannot enable a download button or declare readiness.
- The hidden worker launches a verified contained **base Python executable**, not the Windows venv launcher. Its environment excludes secrets/proxies, sets offline flags and limits CPU threads. Input/output are bounded little-endian length-prefixed UTF-8 JSON frames, with ordered deltas and a terminal finish reason.
- Tools use schema-constrained model output mapped to the existing `AiToolStep`. Native chat roles are preserved; tool data is labelled separately. The original dispatcher enforces field identity, read-before-edit, scope, allowed tools and candidate adoption. The adapter never performs the requested action itself.
- Prepared text completions may accept native `completeMessages` for multi-step conversation writing, with the same frozen route/profile as ordinary completions. Do not flatten earlier assistant stories into a new user request: Qwen may echo them instead of continuing. Real author-style validation must include a fresh book, an unselected chapter, natural requests without tool-name hints, and subsequent continuation; field/tool probes alone do not cover these cases.
- The scheduler admits one active owner and one bounded waiter. A waiting cancellation cannot kill the active worker. Idle ownership transfer stops the prior resident; cancellation, work switch and shutdown stop the owned process and suppress late output.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown catalog ID, extra IPC arguments, foreign window | Reject before model activity |
| Missing assets/dependencies or bad hash | Not ready / failed detection; preserve originals |
| Explicit local output above limit | Validation error, no inference |
| Final template plus output exceeds context | `CONTEXT_LIMIT`, no successful candidate |
| Worker reports length / crashes / malformed frame | Failure; partial writing remains explicitly incomplete |
| Abort | Stop actual worker PID; never publish a successful completed result |
| Corrupt installation/settings JSON | Report error; preserve exact bytes |
| External readable mirror edit | Read formal authority; explicit save detects conflict and preserves external bytes |

## 5. Good / Base / Bad Cases

- Good: detect existing Qwen, assign it to prose, generate a local candidate with no cloud credential, review before adoption.
- Base: an unchanged remote-only book continues using its own URL, key and unknown provider model IDs.
- Bad: give Qwen a fake localhost URL/API key, inherit the cloud's 8,192 output budget, or treat an acknowledgement as successful tool execution.

## 6. Required Tests

- `model-provider-routing.test.ts`: zero local HTTP/key access, exact remote preparation, V3 persistence and missing-installation behavior.
- `local-model-contracts.test.ts`, `local-model-installation.test.ts`, `local-model-scheduler.test.ts`, `local-model-runtime.test.ts`: strict DTOs, fragmented Chinese frames, preparation failure/cancel, owner transfer, actual pipe/process cancellation and truncation.
- `writing-agent-service.test.ts`: local capacity, required context and changed-budget preview rejection.
- `sqlite-manuscript-service.test.ts`: read-only compatibility, explicit import, authority and mirror conflicts.
- Real Qwen and Electron evidence: task `research/` plus `desktop/artifacts/local-model-store/`. Performance and literary quality must be measured rather than inferred from unit tests.

## 7. Wrong vs Correct

- Wrong: serialize the whole conversation into a single user message and assume a valid JSON acknowledgement means tool support.
- Correct: preserve roles, constrain the output, and verify a real list → read → candidate chain through the application dispatcher.
- Wrong: resolve the default cloud connection before an explicit local/remote route.
- Correct: resolve the selected source first, and freeze the applicable profile for prepared work.
