# Reviewed external revisions (private application entry)

Status: `verified-current` for the private operation and named readback only. No public adoption IPC/UI or event migration is accepted here.

## 1. Scope / Trigger

Apply when adopting a separately reviewed full-text AI editorial candidate against an existing formal body, chapter outline or volume outline. This is distinct from adopting a real in-application model Artifact and from treating a changed readable mirror as authority.

## 2. Signatures

`SqliteManuscriptService.adoptReviewedExternalRevision(workItemId, input: ReviewedExternalRevision, beforeCommit: () => Promise<void>)` accepts the exact project fingerprint, target, base version/hash, full candidate/hash, review manifest hash and external `creationMethod: 'ai'`. This is a trusted main-process API, absent from preload and IPC.

`WorkspaceChapterWriteInput.label?: string` appends a 1–80 character trimmed history label in the same existing transaction as the body version. It uses the existing metadata label column; no schema migration is introduced.

## 3. Contracts

- The caller first retains a complete review package and records the author's explicit approval for those exact candidates. This method does not manufacture approval from a manifest hash.
- Detach caller-owned input before awaiting. Validate project, target, version, source and bounded nonempty candidate; reject a candidate identical to the base.
- Serialize by work item; verify the current formal version and synced mirror. Run the caller's exact source recheck, check the mirror again, then re-read formal version/revision with no await before the write.
- Preserve identity/title/parent, append history, and never confirm chapter/outline/facts automatically. Version advancement prevents replay, including when the same text is later restored under another version ID.
- The existing storage operation is `restore`, meaning reviewed external-content adoption. Body history atomically displays `外部 AI 修订采用` plus the manifest prefix. Full external AI origin and all old/new IDs/hashes remain in the external adoption receipt; this is not an application model-generation provenance record. No synthetic Task/Artifact is created.
- Return the committed version ID and `mirrorPending` even if mirror I/O throws. A pending mirror must be retried separately, never by repeating the adoption.

## 4. Validation & Error Matrix

| Case | Result |
| --- | --- |
| Wrong project, target, candidate hash, blank/oversized/unchanged candidate | `VALIDATION_ERROR`, no content commit |
| Changed or removed base, unsynced or externally edited mirror | `CONFLICT`, preserve both sources |
| Source guard rejects | No formal adoption; retain review package |
| Author writes during source guard | Final base/revision check rejects |
| Same approval replayed after commit | Old base cannot match; reject |
| Mirror fails after commit | Return new version and pending; old history remains |

## 5. Good / Base / Bad Cases

- Good: full-text review → exact author adoption → verified backup → guarded application call → persistent per-item receipt → fresh application readback.
- Base: candidate remains outside the book until reviewed; no source type is inferred from file location.
- Bad: copy a candidate into an author mirror to manufacture a recovery conflict, relabel it as human writing, or fabricate model tasks to pass the AI Artifact guard.

## 6. Tests Required

`sqlite-manuscript-service.test.ts` exercises real isolated SQLite body/chapter/volume history and title preservation, atomic origin label, wrong scope/hash, source rejection, concurrent writer, external mirror drift and post-commit mirror failure/replay. The surrounding service regression covers ordinary saves and schema upgrades. Typecheck/build remain required. Actual book adoption is separately checked through the named body revision and outline read IPC in a fresh Electron process.

## 7. Wrong vs Correct

Wrong: call ordinary outline update using the latest version fetched at save time and claim the older reviewed candidate was still current.

Correct: retain the reviewed base version/hash, reject any intervening change and append only after the source guard passes. Storage `restore` and explicit external AI provenance are reported separately; never claim a provider generated this candidate inside the application.
