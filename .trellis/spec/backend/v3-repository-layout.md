> V3 status: `verified-current` for repository layout only; no additional feature-acceptance claim.

# Desktop repository layout

## 1. Scope / Trigger

Apply when adding or moving desktop source, tests, resource workers, build entries, or workspace integration paths.

## 2. Signatures

- Root: `lanjian/`; application package: `desktop/`.
- Entries: `src/main/bootstrap/index.ts`, `src/preload/index.ts`, `src/renderer/app/main.js` and `src/renderer/app/desktop-pet.ts`.
- `npm run typecheck`; `npm run desktop:build`; `npm run test:desktop`.
- `npm run check:architecture` runs checker regression fixtures and checks import resolution, forbidden directions, native dependencies reachable from sandboxes, and runtime cycles.
- `node scripts/test-desktop.mjs --list` lists recursively discovered unit/integration `.test.ts` files and fails if none exist.
- `electron-vite build --outDir out-directory-check` isolates verification output from the author's running `out/`.
- After that build, `node scripts/directory-layout-smoke.mjs out-directory-check` checks worker bytes, sandbox/contextIsolation, named preload IPC and the ready library using a temporary profile.

## 3. Contracts

- Main business code belongs to `src/main/modules/<feature>/{domain,application,adapters,runtime}` as needed. Preserve domain/application/adapter dependency roles.
- Renderer business code belongs to `src/renderer/features/<feature>/`; boot, global shell/navigation/theme belong to `renderer/app`; genuinely reusable UI belongs to `renderer/ui`.
- `src/contracts` contains typed/validated cross-process contracts. Renderer must never import Node/Electron runtime, filesystem, SQLite or credentials.
- Tests belong to business groups in `tests/unit`, to cross-module `tests/integration`, or to opt-in Electron `tests/smoke`; no tests in a generic production services folder.
- Keep Python worker sources and emitted runtime worker paths aligned in electron.vite.config.ts. Build output remains `out/main`, `out/preload`, `out/renderer`.
- Directory renames do not authorize changing appId, npm name, userData, OS encryption context or author project paths.
- Outer AGENTS and Codex bridge must resolve the current repository. Retarget only verified junctions; never recurse into a junction for cleanup.
- Preserve unrelated staged changes; migration manifests and original-byte backups live in the owning task research directory.
- `bootstrap/index.ts` owns lifecycle; `create-desktop-runtime.ts` owns typed composition; feature `runtime/ipc.ts` receives explicit dependencies. Shared validated registration belongs to `platform/ipc/`, never a reverse feature dependency on bootstrap.
- `contracts/index.ts` and `contracts/ipc.ts` are compatibility export surfaces. DTO/API/decoder implementation belongs to each business contract group. Pure rules shared by renderer and main live in contracts, with compatibility re-exports where required to preserve callers and error-class identity.
- Development scenarios belong to `tests/smoke/`. `__LANJIAN_DEV_SCENARIOS__` is false in ordinary builds and true only in the dev server or `--mode smoke`; normal release output must omit the scenario driver. `npm run test:smoke` opts into that build mode.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Destination exists or leaves workspace | Abort move without overwriting |
| Source changed by another active task | Coordinate and preserve latest bytes |
| Open process holds old directory | Request normal shutdown; do not force-close unsaved author work |
| Test glob discovers no files | Exit nonzero; never report a green empty suite |
| Old path embedded in a script/string | Update the exact runtime path and verify its execution context |

## 5. Good / Base / Bad Cases

- Good: move a model use case and update its imports, typed contracts, tests and build/resource references together.
- Base: keep an existing aggregate source file under the proper runtime layer until its separately reviewed internal split.
- Bad: move files while leaving test globs or embedded component loaders pointing to the removed tree.

## 6. Tests Required

Compare test discovery before/after, run typecheck and build, run relevant/full regression proportional to moved scope, and launch an isolated built Electron with a temporary userData. Verify preload availability, renderer readiness and worker asset presence; preserve original pre-existing failures separately. `scripts/refactor-workflow-smoke.mjs <output>` exercises synthetic creation, settings, Chinese manuscript save, quick-open refs, named history, import preview, feature navigation and reopening without author data. Public exports and registered channels must remain compatible during internal extraction.

## 7. Wrong vs Correct

Wrong: `tsx --test electron/main/services/*.test.ts` after moving that folder.

Correct: `node scripts/test-desktop.mjs`, with a checked discovered-file list and nonzero exit when discovery is empty.

See [project structure](../../../docs/PROJECT-STRUCTURE.md).
