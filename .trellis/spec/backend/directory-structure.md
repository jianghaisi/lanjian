> V3 status: `candidate-for-v3`. The layer sketch is evidence, while the appended feature transaction is not V3-accepted. Use `v3-runtime-boundaries.md`.

# Directory structure

The following sketch records the pre-migration layer model. Current physical paths and commands are defined in [repository layout](v3-repository-layout.md); historical feature acceptance below is unchanged.

```text
electron/
├─ domain/           pure models, invariants, ports; no Electron/Node/Vue imports
├─ application/      use cases, jobs, context/search orchestration
├─ infrastructure/   filesystem, AI HTTP, safeStorage, logs, trash adapters
├─ main/             Electron lifecycle and IPC composition only
├─ preload/          narrow named API only
├─ worker/           generation/index/extraction long tasks
└─ shared/           validated DTO and event contracts
```

Dependency direction is `main/preload/infrastructure → application → domain`. Domain never imports an outer layer. Renderer never imports `electron/**` runtime modules; type-only imports from `shared` are allowed.

Do not create a Python backend, local HTTP server, generic IPC gateway, or renderer filesystem helper.

Project file adapters must derive every path from a canonical `realpath` project root. Check lexical containment first, then compare the real path of an existing target or the nearest existing parent of a new target. `path.isAbsolute()` and string-prefix checks alone do not stop symlink or Windows junction escapes.

## Scenario: detailed outline candidate → one formal chapter outline

### 1. Scope / Trigger

Use this transaction after a per-volume detailed-outline candidate exists and its target formal volume outline is current and confirmed. Adoption is deliberately per chapter.

### 2. Signatures

```ts
PlanningPackageService.previewChapterDetailAdoption(proposalId: string, chapterId: number): Promise<PlanningChapterDetailAdoptionPreview>
PlanningPackageService.adoptChapterDetail(input: PlanningChapterDetailAdoptionInput): Promise<PlanningChapterDetailAdoptionResult>
OutlinePlanningService.updateChapterOutline(chapterId: number, content: string, plannedVolume?: number): Promise<OutlinePlanningStatus>
```

### 3. Contracts

- `desktop/src/main/modules/planning/domain/planning-chapter-detail.ts` owns the deterministic candidate-to-Markdown compiler; generation, preview, and adoption MUST share it.
- Preview MUST read current facts and perform zero writes. Renderer submits IDs, never authoritative outline text.
- Confirmation MUST re-read the total outline, target volume outline, candidate, and current formal chapter outline, then compare every preview fingerprint before writing.
- A successful transaction MUST update exactly the selected formal chapter outline and its planned-volume relationship. It MUST NOT create a manuscript, touch another chapter, auto-confirm the outline, start AI, or bypass ChapterContract.
- Main/application owns the transaction; preload only exposes named typed methods and renderer only holds the disposable preview.

### 4. Validation & Error Matrix

| Case | Result | Write |
|---|---|---|
| Candidate missing/stale or target volume not adopted+confirmed | `CONFLICT` | none |
| Unknown fields, invalid hash, or candidate not referenced by proposal | `VALIDATION_ERROR` | none |
| Any preview fingerprint changed before confirmation | `CONFLICT` | none |
| All checks remain current | update selected outline + placement + receipt | one chapter only |

### 5. Good/Base/Bad Cases

- Good: preview chapter 12, inspect current/candidate impact, confirm, then separately review the new formal outline.
- Base: the chapter has no manuscript yet; establish its planned-volume relationship without creating an empty body file.
- Bad: accept a renderer-provided Markdown body, apply a whole volume at once, or treat the adoption receipt as author approval.

### 6. Tests Required

- Unit/integration: preview performs zero writes; success writes one chapter; stale upstream, candidate, or current outline rejects before mutation.
- IPC/persistence: reject extra fields, invalid/duplicate receipts, forged hashes, and receipts without a matching detail candidate.
- Electron click: actually open preview and confirm, then assert the selected outline changed, every other outline and manuscript stayed unchanged, and the chapter remains `needs-review`.

### 7. Wrong vs Correct

```ts
// Wrong: renderer text becomes authority and an entire volume is overwritten.
await outlines.replaceVolume(payload.volume, payload.chapters)

// Correct: main recompiles one stored candidate and rechecks the preview token.
const preview = await previewChapterDetailAdoption(payload.proposalId, payload.chapterId)
assertPreviewStillCurrent(preview, payload)
await outlines.updateChapterOutline(payload.chapterId, preview.candidate.content, preview.volume.order)
```
