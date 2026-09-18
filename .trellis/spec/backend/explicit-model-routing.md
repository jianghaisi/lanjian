> V3 status: `candidate-for-v3`. Model-routing details require a V3-3 task and current entry-path verification.

# Explicit per-request model routing

## 1. Scope / Trigger

Selecting a model in the writing assistant also selects its connection ID. An unavailable unused default credential must not block that route. This applies to model preflight, prepared completions and streaming; it does not change catalog layout or saved task assignments.

## 2. Signatures

`ProjectAiService.resolve(task: AiTask, connectionIdOverride?: string): Promise<ResolvedConnection & { profile: ModelProfile }>`

Existing `AiClient.modelFor`, `prepareCompletion`, `complete` and `streamComplete` forward their optional connection override into this resolver. No IPC or SQLite schema changes.

## 3. Contracts

- Read task sampling and configured endpoints from one `loadStored()` snapshot of the current book, using the existing SQLite/legacy authority boundary.
- Choose the override connection before decrypting any credential. Only decrypt the chosen connection's key.
- Return the chosen endpoint identity and a copied profile carrying that same connection ID; retain task temperature, topP and maxTokens. The client supplies the requested model ID without a brand allowlist.
- One-turn overrides never persist task routing or readable mirror changes. Model name alone is not route identity; use `(connectionId, model)`.
- Credentials remain process-local, not in IPC, settings mirrors, report output or request bodies.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Explicit configured route has a key; unused default has none | Chosen route works |
| Explicit connection removed | Existing actionable missing-connection error; no HTTP request |
| Chosen/default connection has no key | Existing missing-key error; no fallback |
| No override | Existing task/shared route behavior |
| Unknown brand or private model ID | Send original model ID to the explicitly selected API |

## 5. Good / Base / Bad Cases

Good: default API A lacks a credential, user selects a private model on API B, and only B receives the request. Base: no override follows normal task routing. Bad: access A's secret first, or retry another API after B is rejected without user authorization.

## 6. Tests Required

- Local HTTP integration covers preflight, frozen prepared completion, ordinary completion and SSE; assert selected path, credential, model, sampling, exact response and unchanged persisted settings.
- Missing/removed routes issue zero additional requests; no fallback.
- SQLite-authoritative configuration resolves the override without requiring default credentials or changing the JSON mirror.
- Unknown catalog entries remain in `other`; same-name entries from separate APIs retain distinct route keys.
- Existing multi-API, frozen-evaluation and writing-agent tests remain green. Fixture HTTP success is not proof of any real external provider's availability.

## 7. Wrong vs Correct

Wrong: `resolve(task)` (decrypt unused A), then `resolveConnection(B)` (second book/config read).

Correct: `resolve(task, B)` selects B and task parameters in one snapshot and reads only B's key.
