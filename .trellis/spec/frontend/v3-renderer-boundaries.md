# V3 renderer and preload boundaries

> Status: `verified-current`.

## 1. Scope / Trigger

Apply to Vue views/components/composables, renderer bootstrap, shared DTO use and preload-facing calls.

## 2. Ownership and interfaces

Renderer presents state and captures author intent. It calls a named typed desktop client backed by preload. Main/application owns filesystem, SQLite, credentials, canonical identity and side effects.

Physical paths: `desktop/src/renderer/app/` owns the shell and boot, `renderer/features/<feature>/` owns feature UI/state/clients, and `renderer/ui/` owns reusable controls. Preload is `desktop/src/preload/`; shared contracts are `desktop/src/contracts/`. See [repository layout](../backend/v3-repository-layout.md).

## 3. Contracts

- No renderer import or access to Node, Electron runtime, filesystem, SQL, shell, credentials or a generic IPC method.
- Cross-process input and output are runtime validated at the boundary; TypeScript types alone are insufficient.
- Components emit semantic intent and do not invent formal IDs, revisions, fingerprints or adoption receipts.
- Author text remains distinct from AI candidates, previews, reports and transient controls.
- Visual decisions come from the active V3 UI task; old selectors, labels, screens and images are candidate evidence only.
- `AppShell.vue` composes views; `app/use-workspace-controller.js` connects explicit module ports and shared lifecycle. Feature state/actions belong to `features/<feature>/composables/`; new business logic must not be added to the shell or composition wiring.
- Preserve live refs and request/book generations when extracting closures. Shared view scopes are shallow reactive records of the original refs; do not copy draft values. Template `ref="name"` bindings must be explicitly returned from a controller even when they do not occur in a template expression. Verify focus, editor handles, quick-open and dialogs through the actual UI.
- Vue multi-statement event attributes require explicit statement separators. Formatting must be followed by SFC compilation and a real build; TypeScript alone does not compile JavaScript template expressions.
- Renderer-owned public assets that must work in both Vite development and packaged Electron must resolve from `document.baseURI` (for example `new URL('live2d/model.json', document.baseURI).href`). Do not use root-absolute `/live2d/...` or `/vendor/...` URLs: under packaged `file://` pages they resolve toward the filesystem root and silently break production-only media loading.

## 4. Failure behavior

Malformed response, stale identity or persistence failure keeps the author's current draft visible, reports a safe recoverable state and blocks navigation that would orphan unsaved content. Never show success before main confirms.

## 5. Good / Base / Bad cases

- Good: component → feature composable/client → named preload method → validated result.
- Base: unavailable optional capability has a truthful disabled/empty state.
- Bad: component calls `ipcRenderer`, reads a project path or writes candidate content into formal state optimistically.

## 6. Required verification

Run typecheck and focused composable/component tests. Changed cross-process behavior also needs IPC decoder tests. Changed author interaction requires a real Electron check appropriate to the risk. Public media used by desktop UI must be proven `data-ready`/loaded in the built `file://` renderer, not only under the Vite development server.

## 7. Known candidate gaps

The renderer is tracked as a candidate product baseline. Its shell, feature views, state and actions now have separate ownership; this structural verification does not establish acceptance of every component or screen.
