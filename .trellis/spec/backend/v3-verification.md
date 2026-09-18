# V3 process-side verification gates

> Status: `verified-current`.

## 1. Scope / Trigger

Apply before accepting any process-side implementation into V3.

## 2. Evidence levels

Use the narrowest relevant mix of typecheck, domain unit tests, adapter integration tests, IPC contract tests, build, isolated Electron flow and author/manual acceptance. A higher layer is not replaced by a larger count at a lower layer.

## 3. Contracts

- Tests use temporary project roots, injected provider/clock/ID adapters and synthetic content.
- Automated tests do not call real providers unless the task explicitly defines an isolated, credential-safe manual gate.
- Persistence tests compare authoritative data, mirrors and unrelated-file hashes before and after both success and failure.
- IPC declarations are not runtime validation; malformed inputs and results must be exercised.
- Visual, Chinese-input, focus, window, drag or accessibility claims require the corresponding real Electron/manual evidence.
- Record exact commands, scope, failures and untested risks; never report old test counts as V3 completion.

## 4. Failure behavior

A failed or unavailable required gate blocks acceptance. A retry does not erase the original failure; diagnose and retain the first evidence. Tests that assert only self-authored mocks, empty values or file existence are insufficient.

## 5. Good / Base / Bad cases

- Good: task-specific unit/integration gates plus real Electron evidence for changed desktop behavior.
- Base: docs-only contract change uses link/status/search validation and no product test claim.
- Bad: “85 tests exist” is treated as proof that all candidate features work in V3.

## 6. Required handoff

List owned files, test commands/results, spec decision, author/manual gates, untested scenarios and worktree paths deliberately excluded.

## 7. Acceptance boundary

Only the active V3 task and roadmap can declare `v3-accepted`. This spec defines evidence quality but cannot promote a feature itself.

## Developer smoke build snapshot disposal

### Scope and signature

`scripts/chronicle-build-snapshot.mjs` exposes `withChronicleBuildSnapshot(source, cache, run)`. This contract governs temporary developer build copies, not author books, model installations or historical evidence.

### Contract

The helper creates one canonical immediate child of the cache, copies the build into its `out/`, awaits `run(snapshot)` and removes that child in `finally`. The callback closes its owned Electron process before settling, including window/setup failures. Copy and launch failures also dispose the snapshot. Re-resolve and compare the exact target/parent before recursive removal; a changed junction target fails closed. Bounded Windows lock retries are allowed. Preserve both original and cleanup failures in an `AggregateError` when both occur.

### Validation and error matrix

| Situation | Required result |
| --- | --- |
| Callback succeeds | Return its value; remove only its snapshot |
| Copy/setup/test fails | Preserve failure; dispose allocated snapshot |
| Snapshot redirects to another directory | Reject cleanup; preserve redirected data |
| Original operation and cleanup both fail | Keep both errors; do not report success |

### Good / base / bad cases

- Good: `await withChronicleBuildSnapshot(out, cache, async snapshot => { const app = await launch(snapshot); try { /* checks */ } finally { await app.close() } })`.
- Base: installation caches can be deleted only under an explicitly approved, inactive path list; keep installed environments and runtime caches.
- Bad: `mkdtemp` + build copy + `app.close()` with no file disposal accumulates a complete build on every test run.

### Required checks and accounting

Run `node --test scripts/chronicle-build-snapshot.test.mjs` for real filesystem success, setup failure, copy failure, neighboring-file preservation, Windows junction containment and combined-error evidence. Exercise an isolated Electron launch/close when changing process cleanup order. Count hardlinks by actual file identity (`os.stat(path)` on Windows); do not equate recursive logical sizes with reclaimable physical storage. Report measured volume free-space change separately from estimated exclusive file data.
