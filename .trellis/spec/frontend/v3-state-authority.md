# V3 renderer state and authority

> Status: `verified-current`.

## 1. Scope / Trigger

Apply when renderer state displays or edits projects, prose, outlines, events, characters, settings, AI output, recovery or long-running jobs.

## 2. State classes

- Formal projection: validated data returned from main for the current book and target.
- Author draft: local unsaved input with explicit save/recovery state.
- Candidate/preview: non-canon output carrying source, target and freshness information.
- Transient UI: modal, selection, loading, focus and panel state.

## 3. Contracts

- Keep the four classes separate; transient state never becomes a second formal store.
- Async results bind to current book, target and request generation. Dispose/ignore late results after navigation.
- Candidate adoption is explicit and remains pending until main returns a current authoritative result.
- Autosave/navigation/close flush Chinese composition safely and preserve the latest author draft on failure.
- A changed upstream version makes dependent candidates visibly stale; renderer does not silently refresh and continue an old confirmation.

## 4. Failure behavior

On load/save/conflict failure, retain last known formal projection and author draft separately, expose retry/recovery and avoid an empty-success state. Switching books clears book-scoped transient and candidate state.

## 5. Good / Base / Bad cases

- Good: local draft → explicit save pending → confirmed formal projection; failure retains draft.
- Base: no formal item displays a true empty state without creating data.
- Bad: deep watcher sends AI adoption metadata as an author edit or late response replaces another book.

## 6. Required verification

Test success, empty, failure, retry, cancellation, stale result, book switch, composition, navigation and unmount cleanup. Assert formal storage, visible state and recovery behavior together.

## 7. Feature boundary

Specific stores, components, labels and persistence keys remain task-scoped. Old frontend specs are evidence until a V3 feature task promotes them.

## 8. Desktop pet choice versus temporary visibility

`09-18-v3-desktop-pet-opt-in` accepts the existing `ArchiveCompanionBadge.vue` toolbar entry for explicit desktop-pet choice. Its named `toggle` / `hide` / `locate` commands save the main-owned enabled flag before success; disable repeated clicks while awaiting the acknowledgement and expose failures. The button explains that the choice is remembered for later work entry.

Unmount publishes only an empty `DesktopPetContext.scope`; it must not issue `hide`, which now means an explicit persistent user choice. Focus hiding and hidden presentation modes remain transient visibility rules. A fresh or legacy profile does not create a pet window until the author explicitly enables it. Verify real work entry, return to library, mouse/keyboard toggles and restart against both window existence and the stored choice; checking only a hidden DOM element is insufficient.
