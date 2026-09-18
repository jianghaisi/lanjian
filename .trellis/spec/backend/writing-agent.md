> V3 status: `candidate-for-v3`. Writing-agent services, retrieval and dated smoke evidence require a V3-3 task before use.

# Writing Agent boundary

## 2026-09-07: question-driven prior-prose retrieval

### Scope / trigger

Ordinary questions about prior prose must resolve to `query` without a selected skill. Question prefixes take precedence over incidental editing verbs; an explicit `preferredSkill` still wins. This section supersedes the earlier generic-context query behavior, not the existing continuation/planning flows.

### Signatures

`WorkspaceService.promptContext[Candidates](chapterId?, task?, options?: { mode?: 'full' | 'fast'; question?: string })` and `contextFactPack(chapterId?, question?)` accept a main-owned question. No new IPC fields, arbitrary paths or database migration.

### Contract

- Query builds search text from the author's message followed by the selected text, not the entire current draft or unrelated chapter outline. Other skills retain their current context selection.
- Workspace passes that question to the existing bounded `LocalRetrievalService`. SQLite uses current-version chunks strictly before the target's display position; compatibility mode uses authoritative `DocumentService` chapters. Frozen compiled context remains the actual model input and context-preview fingerprint source.
- The answer instruction includes the selected passage as the object being checked. It asks for chapter order/title and exact short quotations, distinguishes direct action from a character's claim, and labels lack of evidence as inconclusive. Keywords and a maximum-six-excerpt fact pack are not exhaustive semantic proof.
- Query creates no prose candidate and makes one answer request, no added model search or review requests. Existing diagnostic projection writes are not manuscript writes.

### Validation / errors

- Explicit modifying skill: keep existing selected-text and approval requirements.
- Question mentioning “改写”: read-only query, unless the author explicitly chose an editing skill.
- Missing evidence: return a bounded-evidence answer, never silently generate prose or invent earlier events.
- Work switch / context hash conflict: existing typed `CONFLICT` boundaries apply.

### Good / base / bad

- Good: “前文有没有借数学笔记的情节？” finds a saved earlier borrowing scene even when the current outline discusses a different event.
- Base: selected “借我笔记的恩情” plus “这句有依据吗？” supplies both question and selection to retrieval and marks the selection as a claim, not its own proof.
- Bad: search only the outline; use future body text or superseded body chunks; answer absence as certainty; route a question to continuation.

### Required tests

- Classifier and real service call: selected/unselected Chinese questions, explicit-skill precedence, one model call, no candidate/draft invocation, selected text included in instruction.
- Real file workspace: unrelated long outline does not displace question terms; exact earlier excerpt included; current/future body excluded; chapter bodies unchanged.
- Real SQLite + Workspace + WritingAgent: actual display order rather than stable file ID, current pointer evidence, frozen context, obsolete-version absence on fresh preparation, no Markdown scan and no prose writes.
- UI acceptance: `LANJIAN_SMOKE_STORAGE_ONLY=1 LANJIAN_SMOKE_QUESTION_ONLY=1 node scripts/electron-smoke.mjs` submits through the visible composer in an isolated SQLite book; asserts succeeded query, visible chapter citation, no edit candidate, unchanged chapter bodies/versions and preserved composer. The fixture HTTP server must independently assert one actual request with prior evidence and without a unique future-body marker; inspect `question-retrieval.png`. This passes for a positive evidence case and does not prove an actual model's semantic accuracy.
- Add `LANJIAN_SMOKE_QUESTION_SCENARIO=selected` for native keyboard selection followed by a question: the actual provider instruction must contain the complete selected passage as the claim under review plus independent prior evidence. Use `missing` for a unique absent term: the delivered context must explicitly say no prior evidence matched and contain no first-chapter evidence marker. Each scenario must finish as query with no candidate, preserve all body version pointers, and provide a visible inspectable answer. Fixed fixture replies validate delivery/presentation, not semantic quality.

### Wrong vs correct

Wrong: `promptContext(chapterId, 'review')` for every question, letting unrelated outline terms determine evidence.

Correct: `promptContext(chapterId, 'review', { question: message + '\n' + selectedText })`; compile and freeze the result, then issue a single read-only response request.

## Scenario: current-chapter conversational writing Agent

### 1. Scope / Trigger

Use this boundary when the right-hand writing assistant accepts natural-language instructions for the current chapter. It is a bounded local orchestrator, not an arbitrary filesystem/shell agent and not a second source of manuscript truth.

### 2. Signatures

```ts
WritingAgentService.run(input: WritingAgentRequest): Promise<WritingAgentTurn>
DesktopApi.ai.runWritingAgent(input: WritingAgentRequest): Promise<WritingAgentTurn>
DesktopApi.ai.settleWritingAgent(turnId: string): Promise<CharacterStateView>
```

### 3. Contracts

- Skills are exactly `continue | rewrite | polish | review | query`; `preferredSkill` is optional and otherwise main resolves the skill deterministically.
- Tools are read-only projections: `currentChapter`, `chapterContract`, `contextFacts`, `consistencyGate`. No renderer-provided path, generic IPC channel, shell, or arbitrary file tool is allowed.
- `rewrite` and `polish` require `{ start, end, text }`; IPC verifies `currentDraft.slice(start, end) === text`.
- `continue` reuses `ChapterDraftService`, including confirmed ChapterContract, dynamic realms, fixed system UI template, prompt hierarchy, and structured adherence review.
- A modifying result is a candidate only. It includes `mode`, content and a SHA-256 base-draft fingerprint; renderer additionally retains the exact input draft for equality checks.
- Adoption changes only the renderer's local editor draft. Normal manuscript save/history and optional accepted-proposal character settlement remain separate operations.
- Main rechecks current work-item id and canonical project path after awaited AI work. Project changes clear all retained Agent proposals.
- Conversation and unused proposals are session-only; no second chat/manuscript database is introduced.
- Renderer presentation uses two top-level, mutually exclusive surfaces: `agent` for conversation/candidates and `checks` for fact packs, consistency and damaged-ledger evidence. Within `agent`, compose, skill selection, running, result and history are mutually exclusive views; the result view must not also render the composer or full skill list.

### 4. Validation & Error Matrix

| Condition | Result | Write |
|---|---|---|
| Unknown skill/tool field, oversized text, invalid chapter | `VALIDATION_ERROR` | none |
| Selection offsets do not reproduce exact selected text | `VALIDATION_ERROR` | none |
| Rewrite/polish without a selection | explanatory turn without candidate | none |
| Work item/path changes while AI runs | recoverable `CONFLICT` | none |
| Renderer chapter or exact base draft changes before adoption | candidate shown stale; adoption refused | none |
| Read-only review/query | answer and tool trace only | none |
| Valid modifying task | disposable candidate | none until author saves editor draft |

### 5. Good/Base/Bad Cases

- Good: author selects dialogue, asks for a more restrained rewrite, reviews before/after, then explicitly places it in the editor.
- Base: author asks a question and receives a read-only answer grounded in readable current context.
- Ordinary discussion/analysis (e.g. “请讨论已确认人物变化，不要生成正文”) resolves to read-only `query`, including an empty chapter or selected text. It must not fall through to continuation and demand a generation ChapterContract. Explicit chosen skills and recognized chapter-card planning requests keep their existing precedence. Cover the service call, absence of a candidate/draft invocation, and an actual Electron conversation, not only the classifier.
- Bad: send an arbitrary path/tool name, replace the whole chapter when no selection exists, save from main as part of generation, or apply a candidate after the author typed more text.

### 6. Tests Required

- Unit: skill routing; selection-only rewrite; no-selection zero-model response; continuation reuses a reviewed proposal.
- IPC: reject unknown skills/fields and forged selection text.
- Identity: switch work item during an awaited task and reject the late result; clear retained proposals on work-item change.
- Renderer/Electron: switch between isolated Agent/check surfaces; open the separate skill chooser; submit a real instruction; verify result, composer and skill list never share one view; display actual tool traces on demand; assert manuscript zero change before confirmation; apply once, save through the normal path, and verify accepted character evidence settlement.

### 7. Wrong vs Correct

```ts
// Wrong: opaque assistant directly overwrites the manuscript.
await chapters.update(input.chapterId, { content: await ai.complete(input.message) })

// Correct: main returns a scoped candidate; renderer verifies exact identity and baseline.
const turn = await writingAgent.run(input)
if (sameWorkAndChapter(turn) && currentDraft === submittedDraft) {
  showCandidate(turn.candidate)
}
```
