# Lanjian · 岚笺

[简体中文](README.md) · [Development](docs/DEVELOPMENT.md) · [Project structure](docs/PROJECT-STRUCTURE.md) · [Roadmap](docs/PRODUCT-ROADMAP.md)

**A local desktop workspace for long-form fiction.**

Lanjian brings story definitions, research, worldbuilding, event timelines, layered outlines and manuscripts into one workspace. Authors can write manually or configure models to produce suggestions they can review, revise or discard.

> **Status: V3 is under active development and validation.** This repository contains a source snapshot, not a fully accepted V3 release or a stable installer. The application currently has a primarily Chinese interface; these READMEs provide bilingual project documentation.

## Writing workflow

```text
Story definition and research → Worldbuilding
                                      ↓
Master outline → Volume outlines → Chapter plans → Chapter outlines → Prose
        ↕                   Versioned event timeline                    ↕
                              Review and author approval
```

- **Library and manuscripts:** local projects, document imports, chapter editing, saves, history and recovery.
- **Planning and events:** layered outlines and events described by time, characters, location and outcome.
- **Worldbuilding:** characters, relationships, power levels, ability boundaries and fixed system-message templates.
- **AI assistance:** model connections, per-book routing, context, generation tasks, diffs and explicit adoption.
- **Supporting tools:** character state, consistency review, maps, a writing companion and optional local inference.

Saving a draft, adopting a suggestion and formally confirming content are distinct operations. Successful generation alone does not turn an AI suggestion into authoritative prose or story facts. See the [product baseline](docs/PRODUCT-BASELINE.md) and [roadmap](docs/PRODUCT-ROADMAP.md) for scope and acceptance status.

## Getting started

Development and desktop regression checks currently target **Windows**. Use **Node.js 24 LTS and npm**. No separate backend server is required. Core editing and remote model calls do not require Python.

```powershell
git clone https://github.com/jianghaisi/lanjian.git
cd lanjian/desktop
npm ci
npm run desktop:dev
```

Access to the private repository requires an authorized GitHub account. Configure your own model connection when needed; creating projects and writing manually do not require an API key. Optional local inference and speech require separate runtimes and model weights, which are not included.

If first launch reports that speech or local models are unavailable, choose “跳过等待，进入作品库” (skip the wait and enter the library) to continue writing. Configure those optional features later.

## Validation and builds

Run from `desktop/`:

```powershell
npm run typecheck
npm run check:architecture
npm run test:desktop
npm run desktop:build
```

`npm run desktop:dist` produces a Windows NSIS installer under `desktop/release/`. This work does not establish support for other operating systems, signed installers or every real-model configuration.

Use an isolated output directory when an author is running the normal application:

```powershell
npx electron-vite build --outDir out-refactor-check
node scripts/directory-layout-smoke.mjs out-refactor-check
node scripts/refactor-workflow-smoke.mjs out-refactor-check
```

These checks use temporary profiles and synthetic books. See [development instructions](docs/DEVELOPMENT.md) for the opt-in smoke build and additional commands.

## Architecture

```text
desktop/
├─ src/
│  ├─ main/
│  │  ├─ bootstrap/   Lifecycle, windows and service composition
│  │  ├─ modules/     Feature rules, use cases, adapters and IPC
│  │  ├─ platform/    Files, SQLite, processes and private settings
│  │  └─ core/        Shared ports and bounded write coordination
│  ├─ preload/        Restricted named bridge
│  ├─ renderer/
│  │  ├─ app/         Shell, navigation, layout and composition
│  │  ├─ features/    Feature views, state and actions
│  │  ├─ ui/          Reusable controls
│  │  └─ assets/      Styles and visual resources
│  └─ contracts/      Feature DTOs, validation and pure shared rules
├─ tests/             Unit, integration and isolated desktop scenarios
├─ scripts/           Development and verification tools
├─ public/            Static runtime resources
└─ licenses/          Third-party notices
docs/                  Product, architecture and maintenance documents
```

Features include `library`, `worldbuilding`, `planning`, `timeline`, `manuscript`, `characters`, `world-map`, `assistant`, `review`, `models` and `companion`. The [structure guide](docs/PROJECT-STRUCTURE.md) and [architecture document](docs/ARCHITECTURE.md) describe responsibilities and dependency rules.

## Data and privacy

- Books live in author-selected directories; application settings live in Electron's user-data directory.
- File-authoritative workspaces keep current prose and outlines in Markdown, with structured records and file references in SQLite. Legacy books retain their actual storage mode until explicitly migrated.
- Windows use sandboxing and context isolation. Renderer code uses named preload APIs instead of direct filesystem or plaintext credential access.
- Online model and research requests send the required request content to the configured provider. Local storage does not make those requests offline.
- Author manuscripts, credentials, backups, model weights, runtime screenshots and private task history are excluded from this upload.

See [data authority and recovery boundaries](docs/DATA-AUTHORITY-MATRIX.md). Renaming the source directories does not migrate application identity or user data. The historical internal package name `frontend` remains for compatibility.

## Licenses and assets

No open source license has been selected for Lanjian. Uploading a private source repository does not grant additional redistribution rights. Dependencies retain their own licenses; Live2D Cubism Core has separate terms. See [third-party notices](desktop/licenses/THIRD-PARTY-NOTICES.md) and [asset provenance](desktop/src/renderer/assets/visuals/ASSET_SOURCES.md).

The initial snapshot excludes a reference photograph and its derivative textures whose distribution conditions remain unresolved. A working cover fallback is included, and the author's local originals are preserved.
