# V3 default model templates and retained creation snapshots

> Integration follow-up (2026-09-13): the private-stage status below records this foundation's original verification boundary. Its production composition is now separately documented in [model connections integration](v3-model-connections-integration.md); do not read historical “not wired” notes as the current integration status.

> Status: `verified-current` for private step 5a only. Task `09-12-v3-global-model-connections` remains `in_progress`. This does not initialize/register a project, apply defaults to an existing book, or provide a settings UI.

## 1. Scope / Trigger

Applies to `desktop/src/main/modules/models/domain/new-book-model-defaults.ts`, `desktop/src/main/modules/models/application/new-book-model-defaults.ts`, the default-field/transition extension in `desktop/src/main/modules/models/domain/model-connections.ts` and unchanged scalar validation extracted to `desktop/src/main/modules/models/domain/model-connection-values.ts` (paths relative to the repository root). Uses the existing [global repository](v3-global-model-connections.md) and [portable book decoder](v3-book-model-settings.md). No new storage file, schema migration, OS codec, network call or book-path port.

## 2. Signatures

```typescript
type ModelDefaultTemplate = BookModelRouting & {
  version: 4; references: Array<{ kind: 'global'; id: string; globalConnectionId: string }>
}
type StoredModelDefaults = { revision: number; template: ModelDefaultTemplate | null }
// Optional additive field on existing schema-1 GlobalConnectionDocument:
newBookDefaults?: StoredModelDefaults
decodeModelDefaultTemplate(value: unknown): ModelDefaultTemplate
decodeStoredModelDefaults(value: unknown, catalogRevision: number): StoredModelDefaults
assertModelDefaultsTransition(before, after): void
new NewBookModelDefaults(repository, validateBudgets /* synchronous domain port */)
get(): Promise<ModelDefaultsView>
save({ expectedRevision, expectedCatalogRevision, template }, scopeGuard?): Promise<ModelDefaultsView>
capture(expectedRevision: number, assertActive: () => void): Promise<{
  revision: number; summary: ModelDefaultsView;
  guard: { recheck(): Promise<void>; assertActive(): void };
  copy(): Promise<ReferencedBookModelSettings | null>
}>
```

`ModelDefaultsView` denotes the inferred private view: `revision`, `catalogRevision`, a copied `template` or null, and selected global metadata `references: [{id, state: missing|enabled|disabled, name?, baseUrl?, revision?}]`. It is not a public IPC DTO or a credential/connectivity projection.

## 3. Contracts

- Absent `newBookDefaults` means revision 0 and null template. Actual edits increment its independent revision and the containing catalog revision. Ordinary connection/reuse changes preserve the template revision. Explicit clear stores `{revision: previous + 1, template: null}`; never remove that tombstone or reuse revision 0. Repeated identical saves/clears do not write or increment revisions.
- Template is strictly v4-shaped without copied `defaultRevision`; only global aliases used by at least one of the five profiles may be present. Private aliases, keys/ciphertext, last-known diagnostic endpoints, runtime availability, unknown fields/tasks, dangling/duplicate/sparse/over-100 aliases reject. Length is checked before iterating aliases. Local uses the existing reserved connection ID with no alias or key.
- Delegate all profile/ID/number rules to the portable decoder. Inject `bookModelConfigInputs` as the synchronous budget validator, checking both shared and per-task projections so an inactive known-local profile cannot carry an excessive copied budget. Unknown portable local model IDs remain valid metadata, not installed/ready claims.
- Save requires both observed default and catalog revisions. Validate every referenced global identity exists and is enabled, including aliases used only by inactive slots. Keyless or OS-unavailable entries can be selected as metadata; this service has no codec or provider. Availability/testing remains separate.
- Global document decoding allows a stored template whose machine connection is missing/disabled, so reads can show recovery state rather than erase it. Saving/capturing that selection fails closed; explicit clearing or a valid replacement is allowed. Corrupt file/shape/version is never null/absent recovery.
- Existing repository serializes, locks, checks raw bytes/revisions and atomically publishes. Default saves spread existing connections and reuse receipts; repository transition validation rejects dropped default state and forged default revisions. After an asynchronous scope check, even a no-op save rereads the fingerprint/revision before returning success.
- `capture` snapshots the exact template/revision and selected connection ID/name/address/enabled/revision. Its mandatory synchronous scope assertion is supplied by trusted main code, not renderer input. Checks occur before and after repository I/O. `copy` rechecks and returns a fresh v4 document with that `defaultRevision`, or explicit null when unconfigured. Mutating returned summaries/copies cannot alter the retained snapshot.
- Changing the default (including setting then clearing it), selected interface revision/metadata, or scope invalidates unsaved copies. Unrelated connection/settings changes do not. Previously copied values are independent; there is no live binding or automatic book write.
- Returned capability/guard stays in main memory. Future create UI must display the retained capability's summary, and the initializer must recheck its guard again immediately before publication. `copy()` alone is not a creation authorization, one-time book receipt or registration result. No cross-file CAS guarantee.

The scalar extraction prevents a decoder import cycle: global document → default template → portable book → shared scalar values. `model-connections.ts` re-exports the old scalar names/constants; their implementation is unchanged. No local catalog duplication or general settings rewrite.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Genuinely absent template | Revision 0/null, no file/book creation |
| Malformed input, private/secret/diagnostic fields, invalid budgets | Safe `VALIDATION_ERROR` before publication |
| Old expected revision/catalog, selected missing/disabled or changed, invalid scope | `CONFLICT`, preserve caller/external data |
| Bad file/JSON/schema/default state | Existing safe `STORAGE_ERROR`, no empty fallback or repair |
| Default revision drop/forgery through repository | Reject transition; no publish |
| Staging error/external change/held lock | Existing storage/conflict outcome, preserve accepted/external bytes |
| Unknown publication error | Safe `STORAGE_ERROR`, ask to reread, do not assert rollback |

## 5. Good / Base / Bad Cases

- Good: A/B copy template revision 1 with GPT outline and Gemini prose; modifying A's copied value does not modify B. A later template revision 2 is copied for C; old pending capabilities reject.
- Base: no template yields explicit unconfigured null while existing book data stays untouched. Clearing retains an increasing revision.
- Bad: delete the default field on clear; copy a private connection into another book; return a stale no-op save after an awaited guard; claim enabled means connected.

## 6. Tests Required

`new-book-model-defaults.test.ts` tests actual app-file persistence, reopen/no-op/clear, revision separation, ciphertext/receipt/unrelated-file preservation, copying/immutability, stale absence and selected/reference/scope drift, missing/disabled views, keyless/OS-unavailable selection, local inactive budgets, strict malformed inputs, raw external edits, concurrent publishers, staging failures/cleanup, stale no-op feedback and unknown error sanitization. A synthetic legacy-source port exercises the real reuse service/store preserving defaults; existing legacy suite covers actual source adapters.

Run existing global/reuse/book/assignment/routing/local suites to prove scalar extraction and additive schema compatibility, typecheck and desktop build. Existing service/IPC/field regressions retain their original assertions. A/B/C here are in-memory route copies, not an Electron create-flow test; creation/partial recovery/import/restore/apply/UI acceptance is still required.

## 7. Wrong vs Correct

```typescript
// Wrong: clearing makes an old absent preview valid again.
delete next.newBookDefaults
// Correct: clearing is a versioned change.
next.newBookDefaults = { revision: previous.revision + 1, template: null }
// Future creation uses its retained summary and rechecks at its own publication boundary.
const prepared = await defaults.capture(observedRevision, assertActiveCreationScope)
const copied = await prepared.copy()
// Do not use a current-book setter or treat this copy as a created project.
```
