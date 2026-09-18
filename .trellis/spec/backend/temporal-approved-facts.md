> V3 status: `candidate-for-v3`. The product invariant is in the V3 baseline; this exact retrieval implementation awaits V3-3 verification.

# Chapter-scoped approved facts and character snapshots

## 1. Scope / Trigger

Use for approved-fact retrieval, character snapshot replay, chapter reorder/archive and upgrades that change derived-state semantics. A later approved replacement must not erase the state available when rewriting an earlier chapter.

## 2. Signatures

```ts
WorkspaceDatabase.approvedFactsBefore(legacyChapterId: number, normalizedKeys?: string[]): WorkspaceApprovedFactRecord[]
WorkspaceDatabase.characterSnapshotsBefore(legacyChapterId: number): WorkspaceCharacterSnapshotRecord[]
WorkspaceDatabase.rebuildCharacterSnapshots(): WorkspaceCharacterSnapshotRecord[]
```

Schema v32 invalidates only `character_snapshots` and advances schema bookkeeping. Existing lazy replay reconstructs snapshots from immutable facts. Do not change previously published migration checksums.

## 3. Contracts

- Resolve the target's logical `chapters.seq`; stable numeric IDs and approval timestamps are not story order. Exclude the target and future chapters.
- A replacement suppresses its ancestors only if the replacement has an active source strictly before the target. Follow transitive replacement ancestry, including when chapters have been reordered.
- Archived sources cannot provide context or suppress an earlier active fact. Keep all source and approval history; do not rewrite facts to implement this projection.
- Snapshot replay proceeds in chapter order, retaining each earlier snapshot. Maintain effective fact contributions per character; replacement removes the predecessor's contribution before replaying scalar and list-valued state. Knowledge/relationships must not retain both a replaced claim and its correction.
- Keep existing source-current/version warnings. This change does not auto-revoke approved facts on manuscript edits or change confirmed-body authority.
- A v31 nonempty snapshot cache can already be wrong. Upgrading must invalidate it even if the existing lazy rebuild's empty-cache test would otherwise not fire. No body, outline, fact, decision or readable mirror content changes.
- No new renderer contract, model request, automatic approval or writing gate.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid target ID | Existing recoverable `VALIDATION_ERROR` |
| Missing/archived target | Existing recoverable `NOT_FOUND` |
| Replacement at/after target | Predecessor remains available |
| Replacement before target | Predecessor and its replaced ancestors excluded |
| Only replacement source archived | Earlier active fact becomes available again |
| Existing v31 cache | Transactional cache invalidation, lazy reconstruction on read |

## 5. Good/Base/Bad Cases

- Good: chapter order `[20, 10, 30, 40]`; chapter 20 says wall, chapter 30 says gate. Before 10/30 use wall; before 40 use gate.
- Base: no replacements; retain current per-character accumulation and source fingerprints.
- Bad: globally exclude every fact with a successor before selecting the target chapter, or keep a nonempty cache built with that rule.

## 6. Tests Required

- Real temporary SQLite with nonmonotonic chapter IDs; assert early state before/after later approval, same-chapter replacement, scalar and knowledge-list behavior.
- Reorder a replacement before its ancestors; assert no ancestor resurrection. Archive the replacement chapter; assert earlier active state returns.
- Build v31 schema/receipts with a faulty nonempty cache, upgrade, reopen and verify early state. Compare exact immutable facts, sources, decisions, body/outline versions and readable files.
- Run service regressions, typechecks and production build. Ordinary Electron query smoke verifies the upgraded runtime but is not a temporal-state UI or real-model semantic evaluation.

## 7. Wrong vs Correct

Wrong: `NOT EXISTS (SELECT 1 FROM facts next WHERE next.supersedes_fact_id = facts.id)` globally removes history.

Correct: select facts available before the target, exclude ancestors only of replacements already available there, and replay snapshots at each historical boundary rather than replaying only globally latest facts.
