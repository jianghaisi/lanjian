> V3 status: `candidate-for-v3`. “Completed” below is a legacy implementation term and does not mean V3 acceptance.

# Completed writing candidate rebase

## 1. Scope / Trigger

Author editing while waiting for AI must not invalidate an entire completed prose candidate. This flow applies to completed prose candidates; chapter-card adoption and incomplete-stream adoption retain their separate protections.

## 2. Signatures

- `buildWritingAgentApplication(task, input)` is shared, pure candidate interpretation and formatting. Main separately validates the baseline fingerprint from the persisted task.
- `rebaseWritingAgentText(base, current, candidate, choices?)` returns merged preview, conflict blocks and unresolved count. Choices are `current | candidate` per generated conflict ID.
- `WritingAgentArtifactApplicationInput.rebase?: { choices: Record<string, 'current' | 'candidate'> }`; no renderer-supplied merged manuscript. Existing `expectedRevision` binds the comparison.

## 3. Contracts

Renderer flushes the latest manuscript before opening a native modal comparison. Closing preserves the candidate and returns to writing. No conflicts are preselected; confirmation is disabled until all overlapping regions have a decision. Unchanged or disjoint changes preserve both sides. Identical changes are not doubled.

Main reconstructs the selected candidate from the persisted Artifact, not the renderer preview. Inside the per-book write queue it verifies active book and latest SQLite revision, then independently computes the merge. The new body version, provenance and Artifact applied status still commit in one transaction; Markdown synchronization follows. Merged prose must not reuse the old candidate's passed review as fresh character-settlement approval.

The existing bounded semantic diff is refined character-wise for changed blocks up to 500 characters, so a common automatic indentation does not create a false content conflict. Actual conflicts expand to complete sentences for readable decisions; never ask an author to choose fragments of Chinese words. Large ambiguous spans use conservative review rather than expensive unbounded alignment. The shown conflict region is the complete region affected by its choice; no model is called to decide for the author. Copy reactive decision arrays and maps into plain data before IPC; a preview stored in a Vue ref must not pass its Proxy across structured clone.

## 4. Validation & Error Matrix

- Wrong book/chapter, damaged candidate fingerprint, stale saved revision: recoverable CONFLICT; no write.
- Current prose differs from task baseline without explicit rebase request: CONFLICT, candidate retained.
- Overlap with missing/unknown decisions: reject before commit.
- Extra rebase fields, output prose, invalid choice names/values, over 500 choices: IPC rejection.
- Another edit after preview: close stale preview and require another comparison; never replay choices against a new revision.

## 5. Good/Base/Bad Cases

Good: author adds a final paragraph while AI rewrites an earlier sentence; both survive. Base: no later edit uses ordinary adoption. Bad: delete the stale flag and write `oldDraft + candidate`, losing the new paragraph.

## 6. Tests Required

Unit: independent edits, overlapping replacement, concurrent insertion/deletion, identical edits, automatic indentation, bounded large text, invalid choices. SQLite integration: reject unreviewed/stale adoption, preserve the author version in history, commit one new AI version with source Artifact and readable mirror. Electron: real editor input after candidate generation, close/reopen comparison with zero adoption, explicit conflict choices, visible confirmation, save/history/mirror/readback.

## 7. Wrong vs Correct

Wrong: `disabled = task.baseDraft !== currentDraft` forever, or merely remove that guard.

Correct: use draft change as a reason to open comparison; recompute in main against the checked current revision, commit only author-chosen output. Keep the old task's baseline immutable.
