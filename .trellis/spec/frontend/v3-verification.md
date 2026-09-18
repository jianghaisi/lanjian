# V3 renderer verification gates

> Status: `verified-current`.

## 1. Scope / Trigger

Apply before accepting renderer, preload-facing or desktop interaction changes into V3.

## 2. Test layers

Use typecheck/build, pure state/composable tests, component interaction tests, IPC contract tests and isolated real Electron/manual checks according to the changed boundary.

## 3. Contracts

- Cover loading, empty, error, success and recovery without fabricated formal data.
- Test Chinese composition, keyboard/focus restoration, reduced motion and accessibility when affected.
- A persistence interaction asserts both visible outcome and authoritative result; DOM text alone is not success.
- Layout tests use supported window/zoom states and inspect actual hit targets and overflow; screenshots are evidence only after visual review.
- Fixtures are isolated from author books, settings and credentials.
- Old UI smoke selectors and screenshots do not become V3 gates until a V3 UI task accepts them.

## 4. Failure behavior

Missing required desktop/manual evidence blocks the corresponding claim. Preserve first failure diagnostics; do not weaken product behavior or author settings to satisfy an obsolete fixture.

## 5. Good / Base / Bad cases

- Good: focused component/IPC checks plus a real Electron interaction for the changed flow.
- Base: non-visual renderer refactor proves unchanged behavior with focused tests and build.
- Bad: static screenshot, hard-coded sample or programmatic click is reported as author acceptance.

## 6. Required handoff

Report viewport/zoom/input conditions, exact scenario, persistence result, screenshots/manual decision when required and excluded candidate files.

## 7. Acceptance boundary

Only the active V3 task can select visual references and acceptance criteria. This generic gate never approves a particular old design.

## 8. Theme selector scope and rendered evidence

In Vue scoped CSS, put the complete global selector inside `:global(...)` when a theme rule must reach a component beneath the document root. `:global(:root[data-theme="moye"]) .works-watermark` compiles to a rule on `:root` alone, incorrectly applying artwork opacity/filter/blending to the whole page. Use `:global(:root[data-theme="moye"] .works-watermark)` instead.

- Regression tests compile the actual SFC styles with `@vue/compiler-sfc` and assert that themed selectors retain their component target.
- The library Electron check asserts root `opacity: 1`, `filter: none`, `mix-blend-mode: normal`, transparent card bodies and dark artwork styles separately.
- Save and reject a blank screenshot as failure (`approved-reference-blank-screenshot`); never report passing theme verification from descendant computed colors alone, or bypass a blank frame with unchecked capture fallbacks. Review the actual saved frame before claiming visual verification.

## 9. Cards inside animated collapse wrappers

Current task-scoped library correction (2026-09-13): `LibraryArchiveHero` renders the confirmed `project` through the existing book cover and four semantic actions. No data/IPC contract changes. Different titles must not change its height at a fixed viewport/zoom. Give the hero an explicit responsive `block-size` (currently `clamp(19rem,38cqb,20rem)`, compact-height variant15.5rem); a child's `flex-basis` has no sizing authority after its parent becomes an ordinary block/grid wrapper.

`ProjectLibrary` overview collapse uses `grid-template-rows: minmax(0,1fr)` / `minmax(0,0fr)` with a `min-block-size:0` clipped inner wrapper. It must not cap expanded content with a guessed `max-block-size`. Preserve `inert`/visibility and restore actual all-works-button focus after the real transition. Core book title, chapter, counts, meter, last-edit time and all four action hit targets must remain within the card/overview. Long titles may wrap to two lines with a full title hint; chapter ellipsis retains its full hint. Compact mode may omit decorative copy, not the last-edit timestamp.

- Unit: project titles/counts remain independently projected, unknown counts stay unknown, full-text hints escape author content, four entry semantics and hover feedback unchanged.
- Native: use isolated synthetic books, two contrasting titles plus a long-title case, six-digit word counts; compare actual hero/overview/content bounds across window sizes and80/100/125% zoom, three themes, then test collapse/return height and focus. Check ancestors as well as the button: a child can fit itself while its outer wrapper cuts it off.
- Test-window identity is stable: use the BrowserWindow belonging to the tested page, not `getAllWindows()[0]`, whose order changes when a work opens its detached pet. Assert requested zoom/size against actual renderer viewport.
- Native screenshots must cover `innerWidth * devicePixelRatio` by `innerHeight * devicePixelRatio`; Electron zoom can invalidate a runner's cached clip. Capture the owned `webContents`, validate dimensions/nonempty image and inspect the frame. This is not permission to accept a blank/cropped screenshot because geometry passed.

Wrong: fix clipping by increasing one arbitrary max-height or changing stored book titles/zoom preferences. Correct: establish one definite responsive card box, constrain its real text/cover, and animate its parent's measured content without a competing cutoff.

## Continue-writing remains the default overview

Author override in `09-18-v3-file-first-manuscripts`: regardless of project count, start with the single continue-writing hero and the collection below. Only the explicit “全部作品” action expands the collection view. Project loading, passive refresh and boot completion must never set `allWorksExpanded` from the count. Returning to overview stays there. Boot readiness enters the library automatically, without a “现在进入” button. The renderer never scans or rewrites storage; the main-side library projection enumerates only the explicitly configured root under `v3-data-safety.md`.

Passive shelf reconciliation is ordered and non-destructive: only the newest in-flight read may update the renderer, and after a successful shelf has loaded a later passive result cannot silently reduce its project count. A smaller list may be committed only after an explicit removal operation such as “从书架移除” or “移入回收站”. A full application start may still reflect projects removed outside the application because it begins with no loaded shelf snapshot.

- Good: three works load, the count is 03 and the continue hero remains; “全部作品” expands on click.
- Base: one valid project keeps the continue card; zero projects keeps the true empty/create state.
- Bad: deriving expansion from `projects.length`, or hiding two works merely to keep the single hero.
- Regression: `allWorksExpanded` starts false; only `showAllWorks` sets true; return sets false. Verify count and view independently.
- Runtime regression: after `03` is visible, an older or smaller passive refresh cannot overwrite it with `01`; explicit forget/trash still commits the reduced shelf.

## Development build and launch must not overlap

The local Electron app loads `out/main`, `out/preload` and `out/renderer` as one release unit. `electron-vite build` writes those targets sequentially in place, so starting Electron before the build command exits can load a mixed generation and leave a false initial renderer snapshot even after the remaining files finish writing.

- Build and launch are serialized: wait for the complete desktop build exit code before starting or restarting Electron.
- A real-window verification reads both the preload result and rendered state from the same running page. For the library, assert `window.novelDesktop.projects.list().projects`, the displayed count and card titles together.
- If source/service diagnostics disagree with an already-running window, compare process creation time with output modification times, stop that instance, and retest from one completed build before changing data or UI logic.
- Wrong: rebuild into `out/` while the author starts the same checkout, then treat the mixed instance as proof of lost works. Correct: finish the build, start once, verify IPC and DOM in that exact window.
