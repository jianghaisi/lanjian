> V3 status: `candidate-for-v3`. Finding schemas, UI projections and tests are historical evidence pending a V3-3 task.

# Explicit Finding Resolution

- `accepted` means an author intends to fix a problem, not that it was fixed. Only an explicit `fixed` decision records a repair version.
- Schema 35 preserves original Finding evidence and append-only decisions. Old rows migrate with a null repair link; never infer a historical repair from prose changes.
- A fixed decision supplies `resultingBodyVersionId` and `expectedUpdatedAt`. Under the same write transaction, the target must be a newer current body version of the same unarchived chapter/project and the decision token must still match. Decision timestamps are strictly monotonic even within one clock millisecond.
- Further current-body changes invalidate `fixed` to `stale`, retaining the previous repair reference and all decisions. The record is not an exemption for a fresh Finding with the same rule code, nor permission to modify semantic facts.
- UI history is a bounded read-only projection (maximum 500 records) from one scoped database connection. It must not write mirrors, read the entire manuscript collection or silently fall back to empty when SQLite fails. File mode has no formal Finding history.
- Chapter projections bind the initial body snapshot to checks and the final history; work-item or version drift returns a recoverable conflict rather than mixing old evidence and new body versions.
- Count author review actions from actual `finding_decisions`, not mutable Finding statuses. Automatic invalidation is not an author action. For usefulness/false-positive measures, use each Finding's latest real decision.

Verification: `finding-resolution.test.ts`, `finding-history-projection.test.ts`, shared IPC boundary tests and the isolated `LANJIAN_SMOKE_FINDING_RESOLUTION_ONLY=1` desktop scenario. Author manuscripts are never fixtures.
