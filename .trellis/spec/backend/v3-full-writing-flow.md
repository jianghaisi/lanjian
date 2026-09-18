# V3 full chapter generation only

Status: current author-directed contract, task `09-12-v3-global-model-connections`, R8/AC10 (2026-09-12). This narrowly retires the generation shortcut; it does not promote all legacy writing-agent behavior or establish real-model quality acceptance.

## 1. Scope / trigger

The author requires normal application workflows for writing validation and explicitly removed fast chapter generation. Apply this contract to current book-profile projections, profile saves, writing preferences, assistant-editable fields and chapter generation. Historical candidate review evidence is immutable history, not a current preference.

## 2. Signatures

- `WorkspaceService.bookProfile(): Promise<BookProfile>`
- `WorkspaceService.saveBookProfile(input: BookProfile): Promise<BookProfile>`
- `decodeBookProfileArgs(args): [BookProfile]`, `workspace:get-book-profile`, `workspace:save-book-profile` and nested continuation-import profile DTOs.
- `WritingAgentService.prepare/run` continuation uses full prompt context and `ChapterDraftService.draft(...)`.
- `ChapterDraftService.draft(chapterId, instruction, currentDraft?, signal?, modelOverride?, options?, connectionIdOverride?, maxTokensOverride?)` keeps the existing signature, stream callback and frozen-context support.
- SQLite `projects.config_json` and file `.webnovel/config/book-profile.json` retain compatibility; no schema migration or new IPC channel.

## 3. Contracts

- New defaults and all current profile projections expose `chapterGenerationMode: 'reviewed'`. Stored `fast` or missing mode projects to reviewed in memory. No mode migration writes during a profile read. Existing unrelated storage activation rules are unchanged.
- New save input may omit the mode (defaults reviewed); if present it must equal reviewed. Reject explicit fast and malformed values at IPC and direct service boundaries before project access/mutation.
- Explicit profile save persists reviewed, preserving unknown extensions and existing revision/conflict protections. Current response validators do not advertise fast as a supported mode.
- Remove generation-mode radio controls and `AppShell.bookProfile.chapterGenerationMode` from assistant capabilities. Explain the fixed full flow; retain per-book expansion style, review strictness and explicit save.
- Chapter creation/continuation runs prerequisites and chapter contract → prose candidate → structured adherence review and, when claims are detected, fact-boundary review → deterministic completeness checks → author candidate decision. There is no fast report builder or mode-selected runtime branch.
- Prose preview/stream completion is not a successful review. Network/invalid structured response errors do not fall back to fast. Semantic or completeness failures remain failed full reports.
- Per-task routing: a frozen prose model name applies to the prose request. Without an explicit connection override, adherence and fact-boundary review resolve the book's configured review model/provider. An explicit paired model/connection override remains paired across both phases, including local inference. Regression: `full-writing-flow.test.ts`, frozen prose model versus separate review connection (writing-validation task, 2026-09-13).
- Historical `AdherenceReport.reviewMode: 'fast'` remains readable and keeps its original local-only label and conservative adoption/settlement behavior. Never relabel historical fast results as full.
- The legacy compressed-context helper may remain for compatibility tests, but current chapter drafting and continuation preparation must not select it.
- No author book mutation, API credential change or live model request is authorized merely by running this regression.

## 4. Validation & error matrix

| Condition | Result | Mode-related writes |
| --- | --- | --- |
| Old file/SQLite preference is fast or missing | Current profile reviewed | None on read |
| New save omits mode | Save reviewed | Explicit profile save only |
| New save passes fast/null/empty/unknown/non-string | `VALIDATION_ERROR` before project access | None |
| Current book-profile response contains fast | IPC result rejected | None |
| Foundation/confirmed contract unavailable | Generation blocked before AI | None |
| Review request fails or JSON stays invalid after configured repairs | Existing failure propagated; no successful candidate | None |
| Valid review rejects content, or candidate is too short | `reviewMode: 'full', passed: false` | No manuscript write |
| Historical fast candidate loaded | Original review evidence and label retained | No rewrite |

## 5. Good / base / bad cases

- Good: an old book with fast saved is opened, generates with full context and real review, then the author explicitly saves preferences as reviewed.
- Base: a newly created book has only the fixed full-flow explanation; expansion style and strictness still work by keyboard and persist per book.
- Bad: hide the radio while keeping fast default/runtime, fabricate a passing full report, or rewrite historical local checks as AI review.

## 6. Required tests

- `full-writing-flow.test.ts`: file compatibility bytes unchanged on repeated reads; invalid direct/IPC saves rejected; missing default; assistant capability removed; current DTO rejects fast; prose/review calls in all preference cases; stream still reviewed; prerequisite/cancel/network/invalid/semantic/completeness failures do not shortcut.
- `services.test.ts`: new default and legacy fast with actual full review, plus existing real loopback-client draft contract regression.
- `writing-agent-service.test.ts`: legacy fast preparation must never request compressed context; frozen-context, model/provider pairing and candidate boundaries remain covered.
- `sqlite-manuscript-service.test.ts`: old stored config and mirror unchanged on read, explicit reviewed save/reopen preserves extensions and manuscript; historical fast foreshadow settlement test remains unchanged.
- `ipc-boundary.test.ts`: current/nested profile DTOs accept reviewed; previous channel/error boundaries remain covered.
- `node scripts/full-writing-flow-smoke.mjs`: isolated real Electron new-book UI (current normal creation uses file storage), fixed explanation, keyboard preference save, old fast book reopened, explicit save, light/dark and zoom checks. SQLite is covered separately above. No real model calls; inspect screenshots. Typecheck and desktop build required.

## 7. Wrong vs correct

```ts
// Wrong: UI-only retirement leaves old books on a bypass.
if (profile.chapterGenerationMode === 'fast') return buildFastDraftReport(content)

// Correct: every new chapter candidate obtains actual review before local checks.
const reviewed = await completeStructured({ ...reviewRequest, parse: parseActualReview })
const report = applyDeterministicDraftChecks(reviewed, content, targetWords)
// Historical reports are not normalized or upgraded here.
```
