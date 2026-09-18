> V3 status: `candidate-for-v3`. This old library/UI integration is pending V3-1/V3-4 entry and author validation.

# Library directory preview

2026-09-08 narrative-terminal implementation replaces the previous card-only shelf with a project → volume → chapter directory. This is a read-only preview, not a workspace bootstrap.

- `projects:library-outline-preview` accepts exactly `{ path, offset }`; preload validates its result and components use `libraryClient` through `useLibraryOutline`.
- The canonical root must match a registered recent project. Canonical path and symlink/junction containment apply to the database, WAL/SHM sidecars, planning ledger, manuscript directory and individual selected files.
- SQLite is opened with `readOnly: true`, never via the migrating database factory. No book switch, state migration, mirror synchronization, fact generation or write operation is permitted.
- Existing database corruption is an error, not permission to fall back to Markdown. Shadow mode reads file-authoritative directory metadata. Formal mode reads formal `chapters`; volume placement follows `outline_planning_state_ready` to either the formal planning document or the still-unmigrated planning file.
- Each page contains at most 60 chapters. Only that page's bounded current bodies are counted; content above 100,000 characters is not returned/counted. File mode only stats filenames and metadata and reports unknown per-chapter word count, not a made-up zero. Unknown confirmation/associations are labelled as unavailable.
- Duplicate file chapter identities cannot be opened directly from a preview. Unassigned chapters stay unassigned; malformed/ambiguous volume assignments are never guessed.
- The tree defaults to one recent project and one populated volume; projects and volumes can be selected without opening. Opening a manuscript emits a separate semantic `open-chapter(project, chapterId)` event.
- Empty declared volumes are shown for bounded volume sets. For more than 60 declared volumes only volumes represented by the current chapter page are returned. Planned chapter outlines without a manuscript continue to live in the planning view rather than being fabricated as body records.
- Async preview results are invalidated on changed requests or component disposal; a late response must not replace another book's directory.

Verification: `desktop/tests/unit/library/library-outline-preview-service.test.ts` covers SQLite authority, byte-preserving older-schema reads, 60-row pagination, unchanged mirrors, file duplicate identity, unknown facts, unregistered roots, junction escape, corrupt database failure and IPC bounds. The integrated Electron smoke must additionally click selection and a separate open action.
