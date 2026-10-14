# V3 global interfaces and book model settings

> Status: verified engineering interaction, not blanket author visual acceptance. Read with [production integration](../backend/v3-model-connections-integration.md).

## 1. Scope / trigger

Feature-local `ModelConnectionsSettings`, `ModelRoutingForm`, `ModelCreationDefaults`, and `model-connections-state.ts`. AppShell only owns library/settings/creation hooks, current safe projections and transition guards. Reuse the existing archive form controls/theme; no new visual system or library assistant.

## 2. Signatures

- Manager props: `api: ModelConnectionsApi`, `bookAvailable?`, `page?: 'connection'|'routing'`; emits `dirty`, `changed`.
- New global connection draft: `{name, protocol: 'openai-compatible'|'gemini-native', baseUrl, apiKey?}`. Protocol is required at creation and returned on every safe connection card.
- Creation preview emits `ready: ModelCreationPreview|null`; it is invalidated on refresh, checkbox change and unmount.
- `routingDraft`, `compileRouting`, `copySharedProfiles` keep drafts separate from formal settings. Source choices are explicit `global:…`, `private:…` or local, not names or list indexes.

## 3. Contracts

The library and a book open the same global manager. Shared-impact notices accompany global edits. Book task assignments and new-book defaults save separately; saving one never writes another area's draft. All five profile slots retain independent parameters, including currently inactive slots. Unknown manual model IDs are preserved.

Keys are transient password fields: never populated from reads, registered as assistant targets, put in localStorage or saved into recovery drafts. Clear is explicit. Global endpoint fields become read-only after creation. Original private names and keys have separate save buttons and remain book-private after copying a connection to the global library.

Protocol is an explicit creation-time selector, is shown on the saved card, and becomes immutable with the endpoint. Labels and endpoint help are protocol-specific. The renderer must not infer Gemini-native routing from a connection name, model name or URL.

Open/settings/default-preview operations perform local reads only. Test/catalog actions are explicit. “Stored” is not “connected”; a timestamped test is not manuscript generation success. Local store refresh does not trigger remote catalog queries.

A new test/catalog action clears the previous result before validation/dispatch. A failed or cancelled query must not leave another interface's model list visible. Successful lists name their source connection and revision; obsolete component generations cannot publish a late result.

Missing/disabled references remain visible and cannot select the first available connection automatically. One-off global choices appear beside attached/local choices and do not mutate book/default assignments. Image controls exclude local text providers.

Dirty forms block destructive navigation/window closing until saved or explicitly discarded. Failures retain drafts. A successful formal save is acknowledged before follow-up refresh; a refresh/mirror failure cannot pretend the save rolled back. Unmount clears transient keys/previews; async creation/book loads ignore obsolete generations. Returning to the library sends the explicit main-side book revocation.

## 4. Validation / error matrix

- No global entries: empty message plus add/reuse actions, no automatic default.
- Invalid/stale save: safe error and retained input; explicit re-read/discard available.
- Missing/unknown protocol on create: validation error and retained draft; no credential/network action.
- Disabled/missing source: visible unavailable choice, no implicit cloud replacement.
- Corrupt default: creation requires retry or explicit manual checkbox; never silent empty inheritance.
- Partial creation: display retained operation recovery, do not claim “created”.
- Model bootstrap error: show the model-settings repair action while leaving the manuscript visible.

## 5. Good / base / bad

Good: create shows a revision-bound summary; B still shows its saved version after default changes; author previews/explicitly applies changes to B.

Base: manually create with no default; configure AI later.

Bad: old whole-connection-table save, automatic catalog HTTP on page entry, key-return DTOs, optimistic save success, or English internal mirror-status codes as author feedback.

Bad: calling a card “Gemini” while saving an OpenAI-compatible protocol, or allowing protocol edits that reuse a credential against a different wire contract.

## 6. Required verification

Main/preload roundtrip and state tests, typecheck/build, and the isolated Electron smoke assert UI plus actual stores. Exercise keyboard/focus, Chinese composition, light/dark and 125% scaling; inspect saved frames for readable controls and no overflow. Existing general sidebar hit-target issues are separately recorded and are not accepted by using a keyboard workaround. Author literary evaluation is a separate normal-writing operation, never a synthetic fixture claim.

The smoke must create both an OpenAI-compatible synthetic connection and a Gemini-native synthetic connection, then assert protocol selection, card label and restart persistence without sending real provider traffic.

## 7. Wrong vs correct

Wrong: `await saveBook(); await refresh(); showSuccess()` makes refresh failure look like loss of the saved edit.

Correct: acknowledge the authoritative result, preserve mirror status, and report refresh failure separately with a re-read action. Never regenerate or overwrite data to make the screen appear successful.

## Library model entry (2026-10-14)

The library top bar omits the book/type search, static local-save badge and standalone model button. Keep persistence unchanged. Open the existing global model manager through settings navigation item 04, “模型设置”; writing plugins follow as 05 on desktop. Browser mode does not expose desktop model configuration. Retain the existing manager dialog, return-to-settings flow and dirty-input leave guard; do not fork model state for this entry.


## 2026-10-15: probe evidence and recovery labels

The model test panel labels a successful probe “文字测试通过”, explicitly stating that tools have not been verified. This is not a tool capability receipt or a reason to disable unknown tools. The assistant error action is “取回原要求”: it preserves any next-message draft, restores the old requirement into the composer, and sends no provider request until the author explicitly submits. Failure guidance reminds the author that completed operations remain and must be checked before resending. Preserve keyboard focus, drafts and existing navigation. Verify native error UI and text-test success using isolated profiles and loopback responses.
