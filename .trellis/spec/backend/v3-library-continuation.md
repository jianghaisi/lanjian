# V3 library continue-target authority

Status: current, limited adoption by `09-11-v3-companion-local-voice-and-safe-dialogue`; does not promote legacy library specs wholesale.

## 1. Scope / trigger

The author opens an older registered work and returns, but the continue card stays on the first shelf entry. Shelf registration order is not last-open order. Renderer and companion must agree without modifying manuscripts, timestamps or book ordering.

## 2. Signatures

- `ProjectService.list(): Promise<{ projects: ProjectSummary[]; continueProjectId: string | null }>`.
- Existing `projects:list` bridge: optional `continueProjectId?: string | null` for older fixture compatibility; current main always supplies it.
- `CompanionVoiceService.updateLibrary(items, continueProjectId?)`; existing opaque selector `library-current` resolves this selection in main.
- Renderer `ProjectLibrary` optional `continueProjectId`; AppShell retains the returned reference, not another persistence authority.

## 3. Contracts

Existing settings `currentProject` is the sole persisted latest confirmed project switch. Canonicalize it, compare to returned available projects with platform-aware path identity, then select that item's ID. If it is absent/unavailable/forgotten, use the first returned item; empty library returns null. Do not resurrect an entry outside the returned shelf.

Reading/listing does not write settings. Existing create/import/confirmed-switch persistence is reused; no new writer IPC, setting, localStorage record, sort or timestamp. A confirmed switch can precede editor-content loading; this is not a guarantee that later renderer bootstrap succeeded. Invalid path switch must leave the prior valid selection unchanged.

Renderer continue action/title/cover and main companion context use the same selection. Changing the selected reference invalidates the old companion session. The public voice token remains `library-current`; no raw path is accepted as a voice-session ID.

## 4. Validation / errors

- Missing optional field or null: compatible; UI/main fall back only to their returned shelf.
- Present reference: bounded nonempty string (max 32767), and a member of returned project IDs.
- Number, object, malformed or foreign reference: response decoder rejects before renderer use.
- Missing/canonicalization-failed old settings path: safe shelf fallback, not arbitrary filesystem scanning.

## 5. Good / base / bad

Good: shelf `[B, A]`, confirmed switch to A, return/relaunch -> card A and companion A; shelf stays `[B, A]`. Base: no valid last target -> B. Bad: always use `projects[0]`, reorder the shelf to repair the card, or keep a second unsynchronized recent-book record.

## 6. Required tests

`library-continuation.test.ts`: selection across fresh services/settings reload, stable ordering and byte-identical settings after list, invalid switch preservation, removed/missing/empty fallback, rejected malformed DTO. Companion service: same target, target-change invalidation.

`scripts/library-continuation-smoke.mjs`: isolated two-book native app; real card open -> editor return -> selected title; companion agrees; full process relaunch still selects A; synthetic manuscript unchanged. Wait for boot to become visible AND detach: waiting for absence before Vue mounts can falsely pass. Capture console errors as well as page errors and inspect both return and relaunch screenshots.

## 7. Wrong / correct

```ts
// Wrong: shelf order is not last confirmed switch.
const continuation = projects[0]
// Correct: main resolves the canonical saved switch against this available shelf.
const continuation = projects.find(matchesCurrentProject) ?? projects[0]
return { projects, continueProjectId: continuation?.id ?? null }
```

The existing `AppShell.vue` uses plain `<script setup>`: use JavaScript (`ref(null)`), not TS generics parsed as comparison/bitwise expressions. Typecheck/build alone does not catch that runtime ReferenceError; native render regression is mandatory.
