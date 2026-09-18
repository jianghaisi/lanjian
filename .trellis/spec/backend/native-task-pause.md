> V3 status: `candidate-for-v3`. The V2 pause model and exact schema belong to a future V3-3 task.

# Native writing-task pause and resuming children

## 1. Scope / trigger

V2 §7.2 requires persisted PAUSED / RESUMING. New writing tasks must not encode pause as cancelled. Old valid checkpoints are read-compatible, not rewritten. This is a writing workflow capability, not a promise that every task type supports pause.

## 2. Signatures

```ts
WorkspaceTaskRunCreateInput.initialStatus?: 'queued' | 'resuming'
taskRunHasLegacyPause(task: ScopedTaskRecord, expectedWorkItemId: string): boolean
WritingAgentTaskService.pause(taskId: string): Promise<WritingAgentTask>
WritingAgentTaskService.resume(taskId: string, operationId: string): Promise<WritingAgentTask>
```

Use the main-owned public work-item ID (currently the resolved project path / `projects.prompt_work_item_id`) for checkpoint identity. It is **not** `task_runs.project_id`, the internal SQLite UUID. Internal FK scope must still match independently. Never relax the path check to any non-empty identifier.

## 3. Contracts

- New runs start queued; a continuation starts resuming, then preparing/running/streaming. A provider request is restarted, not resumed at a network byte offset. Keep the frozen contract and parent/attempt chain.
- Paused retains partial text, is not counted as cancelled, has no success timestamp, and releases the active same-chapter slot. Only explicit cancellation or same-state metadata updates may change that parent; it never becomes succeeded.
- Startup interrupts queued/resuming/preparing/running/streaming writing rows, never paused parents. An interrupted continuation can itself receive a continuation child.
- Writing-task creation checks idempotency first, then same-project/chapter active ownership and parent continuation ownership under one BEGIN IMMEDIATE transaction. SQL insertion guards protect callers that bypass the port. An old duplicate-active history is preserved by migration rather than silently deleted.
- Exact operation-key lookup and child existence are not capped by the UI history page. A new operation cannot create a second resuming child of the same parent.
- Legacy pause requires cancelled + writing_agent + valid version-one checkpoint + expected public work-item identity + matching positive chapter + text request fields. A bare phase string is not evidence.
- A paused writing partial can enter the existing explicit adoption flow, with unchanged body baseline/hash/selection/current revision checks. Active resumptions and read-only answers cannot be adopted as prose. No pause/resume action writes formal manuscript text.
- Task center projects native status directly; parent with a persisted child is view-only history. Unsupported task kinds remain view-only for resuming. Idea/outline projections reject unsupported states rather than widening their business capability.

## 4. Validation / errors

| Condition | Outcome |
| --- | --- |
| Same operation and request | Return prior run, no new provider request |
| Existing same-chapter active writing run | CONFLICT, no second run |
| Wrong parent book/chapter/contract or second continuation | CONFLICT, no run |
| Orphan resuming at startup | INTERRUPTED; parent remains paused |
| Late provider output after pause | Ignore formal completion and retain saved partial |
| Forged legacy checkpoint | Not projected as paused; resume rejected |
| Migration failure | Schema/rows/ledger rollback; foreign keys reenabled |

## 5. Migration boundary

Schema 36 uses the database factory's explicit rebuild branch. Do **not** execute the exported SQL string alone: FK disabling, transaction ownership, exact trigger/view/index preservation, foreign-key checks and finally restoration are part of the migration. Versions 1–35 and their checksums remain unchanged. Copy historical rows verbatim; do not relabel old paused checkpoints or manufacture provenance.

## 6. Required tests

- Matrix for all native transitions; paused is not terminal/succeeded.
- Real v35 database with incoming FKs, custom views (including indirect references), triggers/indexes and history. Success preserves data and relations; injected failure rolls back everything and restores FK enforcement.
- Real public-path identity accepted; another book, internal UUID or wrong chapter rejected for legacy pause and new artifact adoption.
- Duplicate operations and child ownership beyond 50 recent records; same-chapter active slot atomicity; paused releases slot.
- Buffered fragment, provider ignoring abort, restart recovery, unchanged non-task tables.
- IPC paused/resuming decode, task-center active/all interaction, companion quiet/thinking states.
- Isolated native Electron clicks and SQL transition audit, exact unchanged body/revision/version. Service reconstruction plus renderer reopening must not be described as a process-restart test.
- Full-process proof uses `LANJIAN_SMOKE_STORAGE_ONLY=1`, `LANJIAN_SMOKE_NATIVE_TASK_PAUSE_ONLY=1`, `LANJIAN_SMOKE_NATIVE_PAUSE_COLD=1` with `node scripts/electron-smoke.mjs`. The seed process exits 74 only after native pause and durable assertions. The launcher waits for its exit, then starts a distinct Electron PID with the same disposable profile and `LANJIAN_SMOKE_NATIVE_PAUSE_COLD_PHASE=verify`. Verification skips migration and all body/settings/task seeding, binds only the previously frozen loopback fixture endpoint, and requires zero new requests until explicit Continue. Missing checkpoint, wrong PID, missing SQL audit, bind failure or state/body/mirror mismatch fails. Never point this harness at author data; this proves persisted pause across process exit, not power-loss durability or resuming the original network stream.

## 7. Wrong vs correct

Wrong: save cancelled and just display paused; detect duplicate child from the latest 50 tasks; compare a public path with internal UUID; let an animation delay stand in for actual restoring work.

Correct: durable native pause, transactional resuming child, exact scoped history and existing approval flow. Real screenshots and computed contrast catch visible problems that service tests cannot.
