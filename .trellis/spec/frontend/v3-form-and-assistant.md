# V3 forms, guidance and field assistant

> Status: `verified-current` engineering contract for `09-10-v3-workspace-consistency-and-assistant`. Visual author acceptance and real-provider trial remain separate gates.

## 1. Scope / Trigger

Apply when editing authoring forms, their assistant adapters, the single guidance entry or storage feedback. Preserve the author's prose typography preferences.

## 2. Signatures

```ts
type FieldBinding = {
  id: string; read(): string | number | boolean; write(value: string | number | boolean): void
  identity?(): unknown; label?(): string; options?(): (string | number | boolean)[]
  reveal?(): Promise<boolean>; available?(): boolean
}
registerAssistantField(binding: FieldBinding, element?: HTMLElement, persistent?: boolean)
updateFieldScope(workItemId: string | null, pageId: string, pageLabel: string): void
applyFieldDraft(key: string, candidate: FieldCandidate): Promise<UndoReceipt>
WorkspaceGuidancePopover.toggle(trigger: HTMLElement): Promise<void>
```

`ArchiveFormField` provides label/help/error slots; `ArchiveAction` supplies semantic variants and a native default button type. Definition fields live in `BookDefinitionForm`.

## 3. Contracts

- Use `--form-text`, `--form-help`, `--form-heading`, `--form-control-height` and semantic action variants. Alias fields align at the control row; help occupies its own row. Below the form container breakpoint, fields stack without clipping.
- One `GlobalAssistantHost` serves every page inside an opened work, including zero-chapter books. The library and its new-book/appearance forms do not mount the host; returning to the library closes it. It preserves the existing prose/check/task slots. The current page's editable fields are registered explicitly; the book premise also has one persistent, guarded cross-page adapter.
- Assistant field operations reveal the target workspace before reading/generating, including the persistent premise. When a field task starts, scroll its live registered element into view and focus it; do not synthesize edits or save content. A persistent premise uses its visible counterpart for focus while retaining the bound candidate identity. The conversation shows progress and remains cancellable during generation.
- Native `v-assist-field` receives explicit getters/setters. It never discovers a write path from HTML or synthesizes input events. CodeMirror uses one editor transaction with the document key as identity. Repeated rows use object identity, never array index.
- Every literal `v-assist-field` ID must exist in `assistantFieldCatalog`. Direct programmatic registration rejects an unknown ID and includes that ID in the developer-facing error. The Vue directive fails closed for assistant access but leaves the ordinary author input usable, marking it with `data-assistant-field-error="unregistered"`; an optional assistant adapter must never abort workspace mounting or strand the loading overlay.
- Adapters must perform the same draft invalidation/dirty bookkeeping as manual editing. Numeric selects keep numbers. Author approvals, credentials, paths, measured evaluations and formal assignments are excluded. Model instructions and candidate approvals do not recursively target themselves.
- One conversation composer replaces target search, target selection and fields/prose category switches. The model calls book-wide tools to infer the target. A validated `open_workspace` result uses the existing protected navigation path and automatically resumes the same goal after refreshing real field targets. The original model, output budget and author instruction stay fixed; repeated destinations and stale scopes stop with a visible error. A send-preview preference rechecks the newly loaded context before sending it. Ambiguity is resolved with a short conversational question. Alt+Enter on a field opens the host with an optional focus hint. If the field is inside a native dialog, teleport the host into that dialog so it remains interactive in the top layer.
- `manuscript_assistant` routes into the existing writing pipeline through the embedded WritingAgentPanel. Hide its duplicate composer, retain candidates/context/recovery and forward quick actions to the single composer. Reject handoff if chapter, prose, selection, anchor or page changed during intent resolution.
- Independent test stories appear as conversation samples and cannot be mistaken for saved manuscript text or edits to the premise. Show the real scoped loop status (target lookup, generation, length completion or repetition repair), retain the stop action, and stop progress polling on completion, cancellation or unmount. A missing formal task store is a visible blocker rather than a silently successful prose handoff.
- Compare before/after, then explicitly apply one field. This is a draft change; normal save, candidate adoption and search/replace actions stay separate. Existing auto-saving author editors/preferences retain their normal behavior.
- Before applying and undoing, compare book, session, instance, page, revision, value, options and composition state. Wait for Vue's update before recording the undo snapshot. Failed preference writes cannot report successful application. Further manual edits invalidate assistant undo.
- Preserve the existing “发送前核对” preference: when enabled, the first send expands a read-only preview of the conversation, eligible inputs and related backgrounds; a changed request, draft or model requires a fresh preview. Prose handoff retains the original context confirmation and selection controls.
- Definitions save a captured form snapshot with main-issued revision and candidate IDs. Update only draft fields still equal to their submitted values; consume only the submitted source IDs after confirmed save. Concurrent typing and newer source IDs survive.
- Guidance has one topbar trigger beside the brand, one animated nonmodal panel and a focus-mode trigger. Escape/close restores focus; outside click closes without stealing focus. Close on scope change, use actual trigger bounds, constrain to the viewport and honor reduced motion.
- “本地” belongs to the bottom storage status. It does not imply all forms are saved. The definition and manuscript show their own confirmed save/dirty/error states.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| No chapters | Field assistant stays available |
| Multiple matching fields | Ask a conversational clarification; do not pick an arbitrary row |
| Target removed/replaced, book switched or IME active | Refuse apply and preserve current draft |
| User types while generating | Candidate remains comparable but cannot overwrite newer input |
| Save fails or revision conflicts | Keep draft; show an error rather than saved |
| Native modal open | Host is in modal top layer; close removes its portal target |
| Literal field ID missing from the reviewed catalog | Source/registry test fails; runtime does not register assistant access and the ordinary input remains usable |

## 5. Good / Base / Bad Cases

- Good: from world view ask to modify the core premise, compare, apply to the revealed definition, then save explicitly; the unsaved audience note remains intact.
- Base: returning to the library unmounts and closes the assistant. An empty opened book can still edit its definition.
- Bad: changing a candidate's world view leaves its previously adopted outline marked fresh, or changing a number select stores a string.

## 6. Tests Required

- `node scripts/audit-assistant-fields.mjs`: scan every Vue template; report all native/editor bindings as registered, semantic group, protected or wrapper. Fail for unclassified fields. This script must not generate product adapters or the allowlist.
- Registry tests: one-field update, identity changes, IME, undo/manual typing, failed writes and source consumption.
- Registry source contract: scan every Vue literal `v-assist-field` ID against the imported runtime catalog. Assert zero missing IDs and exact rejection diagnostics for direct unreviewed registration.
- Electron checks: 18 theme/window/zoom alias layouts; guidance keyboard/focus/outside/toggle and actual definition save; representative typed fields, editor transactions, library exclusion and empty-book assistant.
- Preserve the existing prose agent, task recovery and manuscript history tests.

## 7. Wrong vs Correct

### Definition length plan (2026-09-11 author correction)

Number controls use a compact width that fits the supported digits and native spinner; labels/help can occupy wider grid columns. Definition genre selectors and canonical names have bounded text widths; narrative fields keep their writing space. Length inputs group together and wrap by the actual editor container, including when the assistant is open.

Total words is an `output`, not an input or an assistant target. Use shared `calculateBookLength` for volumes × chapters per volume × words per chapter, with total chapters and an explicit automatic-calculation label. Empty or invalid factors show a pending result, never NaN or zero. Manual typing, AI draft application and undo all update the same computed projection. This projection does not trigger persistence; explicit definition save remains the only write.

Wrong: `document.querySelector(selector).value = modelOutput`, or an AI callback that sets a planning field but omits its invalidation handler.

Correct: register the semantic field with an explicit callback; for example `write: value => { chapter.entryState = String(value); markPlanningChapterDetailEdited(chapter.chapter) }`. The main allowlist, current snapshot and normal domain save still validate the change.

Wrong: rename a form adapter in a Vue template without adding/reusing its reviewed catalog ID; the directive exception can interrupt `nextTick()` during chapter reveal and leave a completed workspace behind its loading overlay.

Correct: reuse the catalog ID for the same semantic draft (for example both new-volume entry points use `AppShell.volumeDraft`), and let the literal-ID regression test prove every mounted adapter is reviewed.
