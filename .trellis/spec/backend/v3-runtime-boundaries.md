# V3 runtime and process boundaries

> Status: `verified-current`. Sources: V3 product baseline, project Trellis gate, Electron security invariants, and static candidate-code evidence.

## 1. Scope / Trigger

Apply when adding or changing Electron lifecycle, IPC, filesystem, SQLite, model-provider, background-job or preload behavior.

## 2. Ownership and interfaces

- Under `desktop/src/main/modules/<feature>/`, `domain/` contains pure models, invariants and ports; no Electron, Vue or adapter imports. `application/` contains use cases and orchestration through domain ports; `adapters/` contains feature-specific filesystem/provider adapters.
- `desktop/src/main/platform/`: shared filesystem, SQLite, encryption and process adapters; `main/core/`: stable cross-module ports/errors/coordinators.
- `desktop/src/main/bootstrap/`: Electron composition, window lifecycle and named IPC registration. Existing large-entry extraction is still pending; do not add unrelated business logic there.
- `desktop/src/preload/`: the narrow typed bridge; it exposes no generic channel invocation.
- `desktop/src/contracts/`: runtime-validated cross-process DTO and event contracts.
- Long work may use a worker/utility process only through a bounded application port; its existence is not assumed.

Dependency direction is outer adapters → application → domain. Renderer may import shared types but never Electron/Node runtime modules.

Physical layout, commands and migration verification are defined in [repository layout](v3-repository-layout.md). The directory migration preserves existing dependency edges; aggregate contract extraction and existing shared pure-domain imports remain follow-up work.

## 3. Contracts

- Latest author override (2026-09-12): selected GPT-SoVITS speech is app-session resident. Ordinary cancel/settings/blur/close/work/idle/writing handoff cannot unload it. Cancel discards old output and permits only the already-submitted bounded inference to drain while retaining its execution lease; no backlog/history/audio cache. A disabled speech option blocks new loads/requests; an existing engine remains until exit. Text residency remains governed by the old rules below. Main shutdown stops both; genuine crashes/protocol failures remain failures. Owner-scoped writing cleanup must not clear a draining speech lease. This overrides the earlier speech teardown clauses only, not security or author-data isolation.

- V3 is a local Electron/TypeScript application. Do not add a Python/FastAPI/LangGraph product backend, local HTTP gateway, product login, cloud project store or remote telemetry runtime. The author-approved companion voice and local writing inference exception allows a dedicated offline inference child (including an isolated Python environment), owned by Electron and connected only by a bounded private pipe. It has no novel storage/write/tool port, inherited credentials, renderer-selected executable, listening socket or autostart daemon; load on demand, cancel on scope change, release on close/idle/exit. This does not authorize a general Python backend.
- Windows use `contextIsolation: true`, `nodeIntegration: false` and sandboxing. Deny unexpected navigation, window creation and permissions.
- Companion text residency: closing its chat UI ends conversation/playback, not already-idle text weights. Keep text for up to 600000ms since completed inference; work entry, shutdown or writing handoff unloads text; active text cancellation terminates its owned process. Speech follows the app-session override above. Neither policy permits a daemon, network listener or retained conversation data.
- Companion text and speech profiles are independently optional. The persisted preload option permits bounded silent preparation of enabled profiles when the library mounts beneath the application's opening overlay. Latest author override: the overlay awaits actual preparation, then shows ready feedback and a 3-second completion; an explicit skip bypasses only model waiting, never core failures or saved model settings. It must not load disabled profiles, install an OS startup service or periodically defeat text's idle lease. Disabling text stops its process; disabling speech blocks new loads/synthesis and discards old output but retains an already-loaded engine until exit. Preset-only mode has no inference/model-install prerequisite; speech-only mode may read those presets without Qwen. See `v3-companion-speech-runtime.md` for named configuration/preparation contracts and cancellation tests.
- Every IPC operation has a fixed name, argument decoder, result decoder and scoped application operation. No generic filesystem, SQL, shell or provider channel.
- Project operations derive targets from a canonical project root and check lexical plus real-path/junction containment before access or commit.
- Existing untracked Electron code is candidate evidence only; new work must identify the exact entry path it accepts into V3.

## 4. Failure behavior

Unknown channels, malformed DTOs, missing identity, path escape, stale revision and unavailable services fail closed before side effects. A late result cannot write after task, book or target identity changes.

## 5. Good / Base / Bad cases

- Good: named IPC → validated application use case → injected port → validated result.
- Base: optional file absent returns a documented empty state without creating it.
- Bad: renderer passes an arbitrary path/channel/query; main casts it and writes directly.

## 6. Required verification

Run typecheck and focused domain/adapter/IPC tests. Security-sensitive window changes require a real Electron check for sandbox, navigation, permission and bridge exposure. Filesystem tests use temporary roots and include Windows junction/symlink escape cases.

## 7. Known candidate gaps

The Electron runtime is tracked as a candidate baseline, but it still contains very large composition and adapter files. Tracking closes the path-reconciliation gap; it does not accept those monoliths as the V3 architecture or promote their embedded business behavior.

## 8. Independent desktop pet requires a saved user choice

Task-scoped author override: `09-18-v3-desktop-pet-opt-in` (2026-09-18). `DesktopPetPreferencesStore` stores `{ enabled: boolean, preferences, position }` in main-owned `userData/desktop-pet.json`. Missing files and legacy records with exactly `{ preferences, position }` mean `enabled: false`; reading does not write a migration or discard existing appearance/position. An invalid enabled value, unknown field or malformed file raises a safe storage error and preserves the file.

`attachDesktopPet` keeps the persisted choice separate from transient `DesktopPetState.open`. A nonempty work scope may restore a saved true choice; an empty scope hides it without writing. Mode, focus, task updates and work loading cannot opt in. No pet BrowserWindow or its renderer is created for a disabled profile. Existing `toggle` / `hide` / `locate` and explicit native pet close persist the choice through the same serialized store queue before acknowledging success. Appearance and deferred position writes carry the latest enabled value. A save failure retains the prior choice and visible state; owner disposal and late saves cannot create a new window.

- Good: fresh work entry creates no pet; toolbar opt-in saves true; library return hides temporarily; next work entry restores it.
- Base: a legacy scale/position record reads unchanged with false and is upgraded only on an explicit save.
- Bad: `context.mode !== 'hidden'` authorizes opening, or unmount sends the user `hide` command and silently erases the remembered choice.

Verification: `desktop-pet-policy.test.ts` covers legacy round-trip, zero-write reads and invalid flags; `desktop-pet-window.test.ts` covers zero-window default, temporary scope/focus hiding, re-entry/restart, pending/failed saves and serialized appearance updates. `scripts/desktop-pet-opt-in-smoke.mjs` uses an isolated profile, actual work navigation, toolbar mouse/keyboard input, disk preference reads and restart checks. This does not change the library companion or speech runtime policies.
