# V3 portable book model documents and SQLite projection

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` for document/storage compatibility only. Task `09-12-v3-global-model-connections` remains `in_progress`; this is step 4a, not public global routing or author acceptance.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/book-model-settings.ts`, `desktop/src/main/modules/models/adapters/book-model-configs.ts`, and the accepted AI-document parsing/import/replace/model-projection hunks of `desktop/src/main/modules/models/application/project-ai-service.ts`, `desktop/src/main/modules/manuscript/application/sqlite-manuscript-service.ts` and `desktop/src/main/platform/storage/workspace-database.ts`.

The private [global store](v3-global-model-connections.md) and [legacy reuse](v3-legacy-connection-reuse.md) remain separate authorities. This increment does not invoke either during book reads/writes, wire global credentials/providers, change IPC/UI, initialize defaults or migrate author books.

## 2. Signatures

```typescript
decodeBookModelSettings(value: unknown): BookModelSettings
parseBookModelSettings(content: string): BookModelSettings
serializeBookModelSettings(value: unknown): string
defaultLegacyBookModelSettings(): LegacyBookModelSettings
referenceBookModelSettings(value: unknown): ReferencedBookModelSettings
bookModelSource(settings: BookModelSettings, connectionId: string): BookModelSource
// Infrastructure: validated portable document + pinned local catalog only.
bookModelConfigInputs(value: unknown): WorkspaceModelConfigInput[]
```

`BookModelSettings` is legacy v2/v3 or explicit-reference v4. The v1 decoder supplies historical profile defaults in memory and returns v2/v3; parsing alone never writes. `bookModelSource` consumes an already validated document and returns portable identity, not a usable credential or endpoint for a global send.

Database import/replace derives `model_configs` from the validated document inside its transaction. Schema version is unchanged. The later [captured assignment save](v3-book-model-assignments.md) adds only an optional private fourth argument for expected project/revision/scope; existing callers remain compatible. The legacy public `AiSettings` argument on the service import/replace methods is retained for caller compatibility but is not a second projection authority.

## 3. Contracts

- V2/V3 root fields: `version`, `connections`, `routingMode`, `shared`, `tasks`. Remote entries contain `id/name/baseUrl` and may carry the historical `kind: openai-compatible`; normalization drops that optional discriminator. V3 permits an empty remote list. V1/absent-version records require explicit `baseUrl`, accept only the known optional routing/profile fields, and use historical `primary` identity.
- V4 root fields: `version: 4`, `references`, `routingMode`, `shared`, `tasks`, optional `defaultRevision` (positive safe integer). Only attached aliases persist; no machine catalog or availability data.
- V4 legacy alias: `{kind: 'legacy-private', id, originalConnectionId, name, baseUrl}`. V4 global alias: `{kind: 'global', id, globalConnectionId, lastKnownName?, lastKnownBaseUrl?}`. The diagnostic fields never supply the global projection/provider address. Local uses the reserved `local:llama-cpp` profile ID, with no remote alias, URL or credential record.
- At most 100 connections/references; unique alias IDs, and unique original IDs among private aliases. Remote/alias IDs match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`; global IDs use the global-store grammar. Prefix/name/address never converts a legacy-private identity into a shared connection.
- All five profiles (shared plus outline/chapterOutline/prose/review) are validated, including inactive profiles. Fields are exactly `connectionId`, `model`, `temperature`, `topP`, `maxTokens`. Model is nonempty, trimmed, control-free and at most 500 UTF-16 units; temperature is finite 0–2, topP finite 0–1, maxTokens integer 128–128000. No string coercion or dangling remote route fallback on read. Unknown manually assigned models remain portable.
- JSON input is at most 1,000,000 UTF-16 units. Plain known-field objects only; duplicate/sparse entries, unknown task/secret/availability fields, invalid numbers and unsupported versions reject. Endpoints use the shared HTTP/S validator, excluding userinfo/query/fragment (including empty `?`/`#`). Existing normalized endpoint behavior is retained. Explicit null is not absence.
- A genuinely missing legacy file alone uses the historical unconfigured primary profile in memory. It creates no file and cannot acquire a key from another book/app default. This is not the future new-book-default initializer.
- Compatibility exception: the old v2 **explicit connection-list replacement** operation rebinds an omitted old ID to the first retained connection when no replacement profile ID was explicitly supplied. This preserves existing removal/setup behavior. It is not a read repair, global fallback or v3/local fallback; an explicit invalid choice still fails before key writes.
- Private-to-v4 conversion is an explicit pure helper, retaining original IDs; no live setter invokes it yet. The old v2/v3 public settings/provider surface rejects v4 safely instead of stripping references or downgrading it. Do not write author v4 documents until step 4b/IPC integration is accepted.
- SQLite import/replace validates content/hash, derives active profiles, and commits document/readiness, derived models and mirror plan in one `BEGIN IMMEDIATE` transaction. The existing reconciliation SQL body is shared by standalone reconciliation and this transaction; general transaction semantics and historical migration SQL/checksums are unchanged. A failing projection rolls back the entire document transaction.
- V2/V3 remote projection retains `id:baseUrl#scope`; v4 global uses `global:globalConnectionId#scope`; v4 private uses `legacy:originalConnectionId#scope`; local uses `local:llama-cpp#scope`. The book DB supplies isolation. `enabled` on this projection means selected, not machine connectivity or global-enabled state. Missing machine references remain stored, without a fabricated live endpoint.
- Known local active profiles enforce the pinned catalog output bound and project input budget as `contextTokens - maxTokens - systemReserveTokens`; no remote owner is consulted. Unknown/uninstalled portable local IDs remain stored, not marked ready. Later runtime resolution still enforces readiness/capacity.
- A ready AI document owns `syncModelConfigs`; a stale independently supplied public model list cannot replace its projection. Unmigrated legacy projection behavior remains unchanged.
- Readable mirrors retain existing two-space JSON plus final newline. Mirror hash is of those bytes, not the compact database document. External edits remain untouched; mirror conflict does not undo successful formal commit. Public separate mirror-result feedback remains step 4b.

No new schemas, dependencies, environment variables, network calls or background jobs. The existing production `ProjectAiService`/SQLite read path still opens write-capable DB adapters. The later [read-only resolver increment](v3-book-model-resolution.md) verifies source-zero-write SQLite acquisition and prepared-request revocation in a private AiClient composition. [Captured assignment saving](v3-book-model-assignments.md) now verifies private window-bound publication and independent mirror feedback. Neither is wired into main/IPC/UI; production routing remains required work.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Known v1/v2/v3 or v4 portable document | Validated in-memory form; SQLite stores supplied valid document and its derived active routes |
| Missing legacy file | Historical in-memory unconfigured defaults; no write |
| Bad shape/secret field/dangling route/invalid hash | Safe recoverable `VALIDATION_ERROR`; preserve prior document/projection |
| Unknown schema or v4 through old public routing | Safe recoverable `FEATURE_UNAVAILABLE`; no downgrade/fallback |
| File I/O failure | Safe `STORAGE_ERROR`; not empty defaults |
| Missing portable source in selector | Safe `NOT_FOUND`; no catalog/other-book search |
| Stale expected document hash | `CONFLICT`; no document/projection write |
| Known local output over limit | `VALIDATION_ERROR` before formal publication |
| Projection SQL fails during import/replace | `STORAGE_ERROR`; document/readiness/projection/mirror plan roll back together |
| External readable mirror changed | Formal replacement remains authoritative; old external bytes retained, mirror status conflict |

Parser errors include neither rejected fields, endpoint, keys/ciphertext nor raw parse causes. The existing infrastructure transaction error boundary remains responsible for redacting internal SQL causes before IPC.

## 5. Good / Base / Bad Cases

- Good: v3 local-only file → explicit save → SQLite document plus local budget projection → reopen with zero remote credential reads.
- Base: two book DBs retain the same global ID with independent GPT/Gemini profiles; missing machine connection does not erase either document.
- Bad: commit new document and then reconcile a public stale list; infer global scope from a legacy ID prefix; use diagnostic address for sending; accept a malformed file as empty defaults.

## 6. Tests Required

`book-model-settings.test.ts` covers strict parsing, all inactive slots, null/non-finite/oversize/secret rejection, v1 defaults, explicit conversion, same-model global/private/local identity, diagnostic exclusion, local budgets, genuine v1/v2/v3/v4 SQLite import/replace/reopen, stale/no-op writes, two-book independence, missing machine refs, projection-trigger rollback, external mirror preservation, public v4 refusal and formal local ProjectAiService save/reopen with zero remote keys.

Retain old `services.test.ts` explicit connection replacement/selected-provider tests, `sqlite-manuscript-service.test.ts` multi-API authority/projection tests, field preview, local/catalog, global/reuse/snapshot/JSON regressions, typecheck and desktop build. The unrelated book-profile revision and target-word assertions are recorded in task evidence, not weakened. OS symlink skips remain explicit. No real provider/author/desktop usability claim follows from these backend tests.

## 7. Wrong vs Correct

```typescript
// Wrong: a later failure leaves document and actual model projection inconsistent.
database.replaceAiSettings(expectedHash, content, hash(content))
database.reconcileModelConfigs(projectPublicSettings)
// Correct: the database method validates/derives and commits both in its one transaction.
database.replaceAiSettings(expectedHash, content, hash(content))
// Only then synchronize the readable mirror and report its independent state.
```

```typescript
// Wrong: a global-looking legacy ID selects app credentials.
if (id.startsWith('global-')) return globalCredentials(id)
// Correct: a validated document declares the source; live global resolution is a later capability.
const source = bookModelSource(document, profile.connectionId)
```
