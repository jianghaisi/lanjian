# V3 field assistant boundaries

> Status: `verified-current` engineering contract for `09-10-v3-global-field-assistant`; not a claim of V3-3 author acceptance.

## 1. Scope / Trigger

Applies to field-generation IPC, model context, candidate persistence and definition-save provenance. Existing writing-agent prose DTOs and formal adoption remain independent.

## 2. Signatures

The named `DesktopApi.fieldAssistant` methods are `conversation`, `conversationProgress`, `cancelConversation`, `preview`, `start`, `task`, `cancel`, `recent`, `prepareApplication`, `acknowledge`, `applicationModel` and `saveApplicationModel`.

```ts
type FieldRequest = { operationId: string; target: FieldTarget; instruction: string; model?: string; connectionId?: string; maxTokensOverride?: number }
type FieldTarget = {
  fieldId: string; instanceId: string; editorSessionId: string; workItemId: string | null
  pageId: string; label: string; revision: number; value: string | number | boolean
  options?: (string | number | boolean)[]
}
prepareApplication({ candidateId, target }): Promise<{ token: string; candidateId: string; target: FieldTarget; value: FieldValue }>
acknowledge({ token, action: 'applied' | 'undone' }): Promise<FieldCandidate>
saveBookProfile(profile: BookProfile & { revision?: string; assistantCandidateIds?: string[] }): Promise<BookProfile>
updateProjectWritingConfig(input, expectedConfigHash?: string)
```

## 3. Contracts

- For remote providers the conversation application dispatcher uses actual OpenAI-compatible `tools` / `tool_calls`; local providers may map real schema-constrained model output to the same validated AiToolStep without executing tools in the worker, while remote requests retain `tool_choice:auto` and disabled parallel calls. Tools are `list_editable_fields`, `read_field`, `edit_field`, plus book-wide `open_workspace`, `manuscript_assistant` and `write_sample`. Tool availability follows the opened book rather than the visible page. A chapterless manuscript request locates the manuscript workspace; a cross-page field request reveals an allowlisted workspace and resumes the same author request with its refreshed real targets. No arbitrary DOM/file/save/delete tool is exposed. Tool arguments, target identity, book scope and bounded rounds/context are validated in main. An edit requires a preceding read and an unchanged background. Cancel during field handoff also cancels the newly created field task.
- The static `assistant-field-catalog.ts` is the field capability allowlist. Decoder validation rejects unknown keys/targets, object payloads, oversized strings and invalid scalar types. Numbers obey range/step; enums stay within declared/current options; JSON text must decode as an object or array.
- Field discovery accepts an optional name query, defaulting to the author's current request. Matching catalog labels with known workspace destinations remain discoverable before their adapters mount. A unique unloaded match is located by the lookup tool itself, followed by the usual protected navigation and continuation; this does not fabricate another model tool call or a live target instance/value. Unrelated visible fields must not substitute for that match. Entity instances are resolved from live adapters after navigation. Reading/editing a persistent field also reveals its actual workspace first, so cross-page availability cannot conceal the operation's location from the author.
- `operationId` provides idempotency; task states are running/completed/failed/cancelled. A task binds the exact target. A candidate records before/after, dependency fingerprint, model, connection, timestamps and candidate/applied/undone status.
- Preview reads without creating tasks or migrating workspace/model configuration. `foundation(true)`, `realms(true)`, `powerSystem(true)`, `cheatSystem(true)` and project model resolution use read-only paths. The current registered field and bounded confirmed background are model data, never tool authority.
- Book requests revalidate the current work item. Application requests use application settings and a separate model client; they never inherit the previous book. Secrets remain in `SettingsStore` OS protection and are excluded from result DTOs/history/context. Remote public configuration returns only URL, model and configured state; local projections return a fixed source identity without URL/key.
- Field-generation output is exactly one JSON `value` (separate from conversational function-call messages). Additional actions/keys, wrong types and invalid enum choices fail before candidate adoption. The prompt preserves dynamic realms, fixed system templates and event dimensions.
- An unchanged field value is a failed modification, not an applicable candidate. Independent model-test stories use `write_sample` and stay in conversation, clearly labelled as unwritten to the manuscript. The sample loop preserves native chat roles, excludes exact repeated long paragraphs while retaining actual new prose, checks the requested Chinese length, and feeds deficiencies into bounded further generation. An entirely repeated answer triggers corrective retry. These checks do not certify literary quality or semantic continuity. Merely receiving model text or exhausting tool steps cannot be labelled completion. Formal chapters still follow their existing outline/storage/adoption contracts.
- `assistant:conversation-progress` returns only a bounded operation ID, step and safe status message for the current scope. It does not log prompts or manuscript content; completion/cancellation clears its ephemeral state.
- The context fingerprint is checked after generation and before apply. A live, one-time draft permit lasts 60 seconds; an applied receipt supports undo within the session. Cancellation ignores late provider output. Orphaned running tasks project as interrupted without restarting or writing from a read path.
- Manuscript handoff reveals the manuscript workspace even if a previously selected chapter is still known while another page is open. Navigation does not replace chapter/outline/storage/adoption validation.
- Candidate history is non-canon application data at `userData/field-assistant/<sha256(scope)>.json`, atomically serialized and bounded to 100 recent tasks per scope. Corruption locks this history instead of returning empty success. This history is shown beside existing writing tasks; it is not a second manuscript authority or a portable project backup.
- Field apply changes renderer drafts only. Explicit definition save uses a main-issued 64-hex revision. File mode checks original file bytes before atomic commit; SQLite checks current configuration hash inside the write transaction. No schema change is required.
- Definition source IDs (up to 50 UUIDs) must resolve to applied candidates for that book and allowed profile field. Persist bounded `fieldAssistantSources` in existing config extensions with candidate/task/field/model/times/result hash. Other field families retain application candidate receipts and their existing domain save/version mechanism; do not claim a universal formal provenance column.
- Test-only `LANJIAN_SMOKE_FIELD_WORKSPACE_ONLY=1` selects the isolated fixture provider and focused workspace scenarios. It does not configure product model routing.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Unknown field/key, wrong type or invalid constraints | Validation error before draft write |
| Wrong book/session/instance/revision/value/options or changed background | Conflict; regenerate from current target |
| Duplicate live apply permit or reused receipt | Conflict; no second application |
| Provider error/cancellation/invalid JSON | Failed/cancelled task; no formal write |
| Corrupt history | Recoverable error; preserve bytes and manuscript |
| Stale definition revision/config hash | Conflict; preserve submitted author draft |
| Missing application model | Configuration guidance; no previous-book fallback |

## 5. Good / Base / Bad Cases

- Good: preview → explicit generation → compare → current draft permit → acknowledged draft apply → original page save with revision/source IDs.
- Base: an empty book needs no chapter ID for a definition field request.
- Bad: provider JSON contains `save: true`; reject it even if `value` is otherwise valid.

## 6. Tests Required

- `assistant-conversation-service.test.ts` and `ai-tool-conversation.test.ts`: actual HTTP function protocol, list/read/edit, help, conversational ambiguity, no-chapter fields, prose dispatch, forbidden tools, cross-book rejection and cancellation during handoff.
- `field-assistant-service.test.ts`: zero-write preview, scoped candidates, idempotent application, changed dependencies, cancellation/late output, types and interrupted history.
- `assistant-field-registry.test.ts`: one target, undo and concurrent typing, IME/object replacement/book switch/unmount, failed writes.
- `field-assistant-application.test.ts`: file/SQLite revision conflicts, unrelated config retention, verified source metadata, corruption and safe DTOs, read-only model routing.
- `ipc-boundary.test.ts`: every named result uses a registered decoder; malformed requests/results cannot cross preload.
- Regress SQLite model/writing configuration and original prose artifact atomic adoption; use temporary books only.

## 7. Wrong vs Correct

### Derived definition length and retired capability (2026-09-11)

`WorkspaceService.bookProfile` projects `targetWords` from the three valid length-plan factors; `saveBookProfile` recomputes it after factor validation, ignoring a stale cached submitted total. Shared `book-length.ts` defines the calculation and total bounds (300–2,500,000,000). File/SQLite columns remain compatible caches; reading old definitions never writes or migrates them. The existing revision/source/explicit-save rules apply.

`definition.bookProfile.targetWords` is retired from the writable allowlist. New field requests and permits reject it; recorded task/candidate decoders retain this exact historical ID so an old total-word candidate cannot make all assistant history unreadable. No arbitrary unknown ID becomes allowed. The conversation explains that total length is derived and discusses which factor to adjust when the author's request does not specify one.

Wrong: preview calls a lazy migration helper, or a full profile response replaces all current renderer fields after the author continues typing.

Correct: explicit read-only sources for preview; capture the submitted revision, compare-and-swap on commit, then replace only renderer fields still matching that submitted snapshot.
