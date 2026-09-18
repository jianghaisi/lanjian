# V3 planning and timeline state

> Status: `verified-current` design contract. Approved by the timeline consistency parent; renderer implementation and desktop acceptance belong to later slices. Slice 1 adds no UI or preload channel.

## 1. Scope / Trigger

Apply when presenting versioned events, outline dependency status, migration, adoption impacts or prose settlement. Reuse the four state classes from `v3-state-authority.md`.

## 2. Signatures and display boundary

The later named/decoded bridge returns book/target identity, exact source revision summaries, event approval/phase/granularity, preview freshness and impact findings. Version lists and evidence are bounded; never expose SQLite queries, filesystem paths or a generic source resolver. Concrete bridge signatures are owned by their implementation slice.

## 3. Contracts

- Time views are projections over one formal event identity/version model. Filtering macro/detail/planned/realized does not copy data or create another editable store.
- `approved` means accepted by the author; it does not mean already happened. Unknown legacy phase must be visible rather than guessed.
- Local author drafts, model event proposals, adoption previews and formal events remain separate. Save, adopt and confirm retain distinct outcomes.
- A newer candidate does not replace the approved event projection or make its consumers stale; show the pending proposal separately from the unchanged approved revision.
- A joint chapter/event preview shows the selected changes and affected artifacts before author adoption. Success appears after the authoritative transaction, with mirror sync reported separately.
- A current adopted chapter may still require formal confirmation. An origin link back to that chapter does not make it stale.
- Upstream review points to a possible conflict and its evidence; it does not silently rewrite the total or volume outline.
- Book/target switch and a new preview generation invalidate old buttons/tokens; late responses cannot replace another book's draft.
- Draft editing and reading remain available when AI generation is blocked by a stale dependency, except where the owning data is corrupt.

## 4. Validation & Error Matrix

| State | Display/action |
| --- | --- |
| No event versions yet | Truthful compatibility/empty state; no implicit migration |
| Stale preview | Keep candidate; offer fresh preview; old adoption disabled |
| Unresolved legacy identity/source | Show migration review reason; preserve original data |
| Planned but approved event | Show approved plan, never realized styling |
| Adoption committed / mirror pending | Formal success plus separate sync status |
| Corruption / failed read | Keep draft and safe prior projection; no empty-success |

## 5. Good / Base / Bad Cases

- Good: author views event v2 with its source outline version and decides whether to review affected chapters.
- Base: legacy chronology remains readable with an explicit compatibility label.
- Bad: renderer copies approved candidate text into three separate timeline arrays and auto-saves them as facts.

## 6. Tests Required

Later UI slices: empty/legacy/current/stale, cancellation, book switch, rejected partial selection, conflict/retry, Chinese composition, focus/keyboard and persisted outcome. Real Electron verifies chapter expansion remains current and that planned/realized views retain one identity chain. No UI acceptance is claimed in slice 1.

## 7. Wrong vs Correct

```ts
// Wrong
event.realized = event.approval === 'approved'

// Correct
// Display approval and story phase as independent authoritative fields.
```

## Planning document navigation (2026-09-18)

`runOutlineNavigation(label, read)` captures the work-item ticket and monotonic navigation generation. `read` produces a commit closure; only a successful, still-current read commits target IDs, buffer, saved baseline and mode together. Chapter selection applies the same checks before assigning manuscript/chapter-outline buffers. Include all formal and standalone outline drafts in the source snapshot so edits made during a slow read cannot be overwritten. Same-document clicks preserve the draft and invalidate older pending requests.

`prepareOutlineLeave()` rejects active Chinese composition or an in-flight save. Dirty formal outlines offer continue-editing, explicit discard, or save-before-leave; rejected saves keep the old target and text. Standalone outlines retain their existing guarded save/recovery workflow. Save replies advance the submitted saved baseline without replacing later typing. Workspace switches and page exits invalidate pending reads.

- Read failure: previous document remains current; the failed target is named and retry is available.
- Late response after another target/page/book: no commit, selection or error publication.
- Template insertion: `PlainTextEditor.insertText(text): boolean` makes one undoable transaction at the selection; refuses read-only/composing state, never saves or confirms.
- New chapter: use existing `chapters.create`, visibly stating that the chapter also enters the manuscript directory; then open its empty outline. Existing standalone outlines use their existing get/update/start API, with no renderer-invented identity.
- 卷概览 is a read-only projection, with no second editable summary or confirmation. 章节安排 edits planning candidates; it neither confirms a formal skeleton nor writes prose. Keep save/adopt/confirm labels distinct and next-stage dependencies truthful.

Wrong: set `selectedVolume` before awaiting `outlines.get(volume)`, then let any reply overwrite `volumeOutline`. Correct: capture identity, guard draft departure, read, verify ticket/generation/source draft, and then commit all document fields together.

Regression evidence must include native row clicks, 440-chapter search, non-55 membership, standalone/stage entry, cancel/save failure, IME, delayed reads, restart and light/dark zoom geometry. Passing engineering checks is not author visual acceptance.
