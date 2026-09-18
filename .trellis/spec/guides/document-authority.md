> V3 status: `verified-current`.

# V3 Document Authority Guide

Use this checklist before turning repository documentation into requirements or implementation instructions.

## Resolve the Role First

- [ ] Read `docs/PRODUCT-BASELINE.md` for the only current version: V3.
- [ ] Read `docs/PRODUCT-ROADMAP.md` for V3 stage and V3 acceptance status.
- [ ] Use `docs/DOCUMENT-AUTHORITY-MATRIX.md` to classify any other document before relying on it.
- [ ] Treat a Trellis PRD as task-scoped. If it conflicts with the product baseline, return to planning and update the upstream decision first.
- [ ] Treat date-stamped implementation reports, screenshots and test receipts as evidence for their named scope, not as global completion claims.
- [ ] Treat `.trellis/spec/` as executable engineering guidance only after checking the relevant index and any recorded reconciliation status.
- [ ] Treat every V1/V2 artifact as `legacy/superseded` and every unreviewed current-tree artifact as `candidate-for-v3` until a V3 task explicitly promotes it.

## Conflict Checks

- [ ] Do not infer authority from the newest filename or timestamp.
- [ ] Do not let a visual reference override data safety, save/recovery or author-confirmation contracts.
- [ ] Do not let current code silently redefine product intent; record the mismatch as a Trellis task.
- [ ] Do not write future design as though it is already implemented.
- [ ] When the user changes direction, persist it in the product baseline and roadmap before implementation continues.
- [ ] Do not infer V3 acceptance from old task status, checkboxes, test counts, filenames or runtime reachability alone.

## Required Outcome

Before editing code, be able to state:

1. which product-baseline rule the work serves;
2. which roadmap stage and Trellis task own it;
3. which architecture/spec contracts apply;
4. which documents are evidence only or superseded;
5. whether any conflict requires returning to planning.

This prevents the previous failure mode where broad, long-running task logs and newer UI documents silently became competing product specifications.
