> V3 status: `candidate-for-v3`. Task-center history is not accepted until a bounded V3-3 task verifies its current entry and storage.

# Task-center history and legal actions

## 1. Scope / Trigger

The author-facing task center must not lose an old running/paused task behind recent terminal history or offer a second continuation because its child fell outside the displayed page.

## 2. Signatures

```ts
WorkspaceDatabase.taskCenterTaskRuns(limit?: number): Array<WorkspaceTaskRunRecord & { hasContinuation: boolean }>
TaskCenterService.list(): Promise<TaskCenterItem[]>
```

The existing `recentProjectTaskRuns` remains chronological and unchanged for its other consumers. The original history projection needed no migration; schema 36 now adds [native paused/resuming semantics](native-task-pause.md). The task-center DTO exposes optional `hasContinuation: boolean`; the service always supplies it and IPC validates it when present.

## 3. Contracts

- Select only the current project's records in one query and one connection. Exclude dismissed checkpoints before limiting the page.
- Sort active tasks (including resuming) first, uncontinued native/valid legacy pauses next, failed/interrupted tasks next, then terminal history; use update/create timestamps and ID for stable ordering within a group.
- Default page size 100, bounded to 1–200. This is a bounded projection, not a claim that every historical task is returned.
- `hasContinuation` is determined from all same-project child runs, including dismissed/out-of-page children. It is not inferred from the returned list.
- A paused parent with any persisted child is view-only. History is retained and task states/artifacts/body versions are never modified by list reads.
- Migrated version-zero task contracts cannot create retries/continuations. Do not offer retry/resume (or pause on old active runs); retain view and supported stop controls. Explain the current-content entry point for starting a new task without deleting historical results.
- Renderer may label a paused task “已续接” only when `hasContinuation === true`, never merely because resume is absent. Uncontinued legacy pauses remain in attention.
- Only writing, idea generation, outline expansion and fact extraction have registered task-center actions. Unsupported kinds are view-only in every status; do not show a cancel button that has no handler.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Database/project absent | Empty list |
| Nonfinite internal page limit | Default 100 |
| Child hidden or older than page | Parent cannot resume again |
| Old live task plus many newer stopped tasks | Live task prioritized |
| Unsupported active kind | `actions: ['view']` |
| Database failure | Propagate existing error; always close connection |

## 5. Good/Base/Bad Cases

- Good: 125 newer terminal records do not hide the old running task or paused task awaiting continuation.
- Base: ordinary recent task history is unchanged by the dedicated task-center read.
- Bad: read 100 entries, remove dismissed ones afterward and search only those entries for children.

## 6. Tests Required

- Temporary formal SQLite with 125 terminal records, 20 dismissed records, old active/pause, and an out-of-page dismissed child. Assert priority, full visible page, no duplicate resume, exact task/body projections unchanged.
- Unknown kinds in active and terminal states are view-only. Single service call closes its connection.
- Desktop pause → task-center resume → completed child preserves partial text, parent relation and body revision; no duplicate resume button after completion.

## 7. Wrong vs Correct

Wrong: `recentProjectTaskRuns(100).filter(notDismissed)` and build child IDs from that page.

Correct: perform dismissal/priority selection in the database and compute same-project child existence independently of the display limit; keep task-center capabilities aligned with registered handlers.
