> V3 status: `verified-current`.

# Development Entry Gate

## 1. Scope / Trigger

Use this contract before any repository mutation when work may have started from `E:\项目\novel-project` instead of the nested Git/Trellis root. It prevents code changes from bypassing the active-task and planning gates.

## 2. Signatures

```powershell
python scripts/trellis_preflight.py --intent read
python scripts/trellis_preflight.py --intent plan
python scripts/trellis_preflight.py --intent code
python scripts/trellis_preflight.py --self-test
```

Exit codes: `0` PASS, `2` BLOCKED by workflow state, `3` gate/runtime error.

## 3. Contracts

- Repository root is derived from the script location, not the caller's working directory.
- Current task is read through `.trellis/scripts/task.py current --source`, preserving session isolation.
- The script is read-only: it never creates, starts, finishes, archives, stages, commits, resets or edits.
- `read` always permits inspection.
- `plan` requires a current task in `planning` or `in_progress`.
- `code` requires `in_progress`, `prd.md`, and either both `design.md` + `implement.md` or `task.json.meta.complexity: lightweight`.
- PASS only satisfies the entry gate. Task scope, destructive actions and commits still require their own authorization.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No current task + `read` | PASS |
| No current task + `plan`/`code` | BLOCKED, exit 2 |
| Current task is `planning` + `code` | BLOCKED, exit 2 |
| `in_progress` without `prd.md` | BLOCKED, exit 2 |
| Only one of design/implement exists | BLOCKED, exit 2 |
| No design/implement and no explicit lightweight metadata | BLOCKED, exit 2 |
| Task path outside active `.trellis/tasks/` | ERROR, exit 3 |
| Trellis script or task JSON unreadable | ERROR, exit 3 |

## 5. Good / Base / Bad Cases

- Good: an approved complex task is `in_progress` with all three artifacts; code intent passes and reports the exact task.
- Base: a conversation with no task uses read intent and passes without creating state.
- Bad: an agent starts from the outer workspace, sees no task, and edits product code anyway. Outer AGENTS and the non-zero gate result both prohibit this.

## 6. Tests Required

- `--self-test` asserts seven pure state combinations and exit decisions.
- From the inner repository, code intent reports the current in-progress task.
- From the outer workspace, invoking the same script by path resolves the inner repository and the same task.
- With a fresh context ID that has no task, read passes while plan and code block.
- Hash or Git-status comparison confirms the gate does not change product files, task JSON, runtime pointers or the index.

## 7. Wrong vs Correct

### Wrong

```text
Start in outer workspace -> assume nested project has no Trellis -> edit code
```

### Correct

```text
Read outer AGENTS -> enter/resolve nested repository -> run preflight -> read task/specs -> edit only after PASS
```
