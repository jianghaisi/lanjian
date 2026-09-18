# V3 Engineering Specifications

> Status: `v3-authoritative` for the routing and status rules on this page.

## Authority order

1. `docs/PRODUCT-BASELINE.md` defines the V3 product and invariants.
2. `docs/PRODUCT-ROADMAP.md` defines current V3 stage and acceptance.
3. The active V3 Trellis task defines bounded delivery requirements.
4. Only files labelled `verified-current` in this spec tree are active engineering contracts.
5. Files labelled `candidate-for-v3` are historical implementation evidence and must not drive code changes.

Code presence, tests, screenshots and old task completion never promote a candidate by themselves. A conflict returns the task to planning.

## Active indexes

- [Process-side Electron/TypeScript contracts](backend/index.md)
- [Vue renderer contracts](frontend/index.md)
- [Thinking and document-authority guides](guides/index.md)
- [Trellis project integration](trellis/index.md)

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `verified-current` | Approved V3 invariant or contract; applicable when its trigger matches |
| `candidate-for-v3` | Potentially reusable evidence; not an active contract |
| `needs-update` | Valid intent with unresolved wording, path or implementation drift |
| `superseded` | Replaced by the V3 authority chain |
| `future` | Desired behavior that belongs in a later V3 task |
| `duplicate` | Owned by another canonical spec |

## Pre-development check

- Run the Trellis preflight and state active task plus phase.
- Read the product baseline, roadmap, active task and the relevant active index above.
- Confirm every selected rule is `verified-current`; record candidate promotion in the task before relying on it.
- Treat gaps between contract and candidate code as task work, never as proof that either side is complete.

## Quality check

- Verify only paths claimed by the active task.
- Keep unknown worktree content unrecognized.
- Report the spec decision, evidence, validation and remaining gaps at handoff.
