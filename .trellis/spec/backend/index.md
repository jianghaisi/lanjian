# V3 process-side Electron/TypeScript specifications

> Status: `verified-current`. “Backend” means the local Electron main/application/infrastructure side, never a Python, HTTP or cloud product backend.

## Active contracts

- [Model tool replay and error recovery](v3-model-tool-recovery.md)

- [Gateway references and official tool capabilities](v3-gateway-tool-capabilities.md)

- [公开发布与 Windows 安装验证](v3-public-release.md)

- [Desktop source, tests and repository layout](v3-repository-layout.md)

- [Runtime and process boundaries](v3-runtime-boundaries.md)
- [Selected GPT-SoVITS companion speech runtime](v3-companion-speech-runtime.md)
- [Library last-confirmed continue target and companion context](v3-library-continuation.md)
- [Data authority and author safety](v3-data-safety.md)
- [File-authoritative manuscripts, history references and bounded open/save paths](v3-file-manuscript-authority.md)
- [Read-only completion audit and versioned external manuscript/outline recovery](v3-mirror-recovery-audit.md)
- [Reviewed external AI revisions and atomic origin labels (private application entry)](v3-reviewed-external-revisions.md)
- [Error and privacy boundary](v3-error-privacy.md)
- [V3 verification gates](v3-verification.md)
- [V3 planning and event consistency](v3-planning-event-consistency.md)
- [V3 event migration occurrence and reference inspection](v3-event-migration-review.md)
- [V3 canonical event identity schema preparation](v3-event-identity-schema.md)
- [V3 version-bound event display metadata](v3-event-display-metadata.md)
- [V3 event migration receipt storage](v3-event-migration-receipts.md)
- [V3 event migration receipt verification and recovery queries](v3-event-migration-recovery.md)
- [V3 event migration decisions and private confirmation session](v3-event-migration-decisions.md)
- [V3 event migration payload conversion before confirmation](v3-event-migration-payloads.md)
- [V3 field assistant boundaries](v3-field-assistant.md)
- [Full chapter generation only; historical fast evidence retained](v3-full-writing-flow.md)

- [Local writing model providers](v3-local-models.md)
- [Global model connection storage foundation](v3-global-model-connections.md)
- [Selected legacy connection reuse and receipts](v3-legacy-connection-reuse.md)
- [Portable book model documents and atomic SQLite projection (v4 storage only)](v3-book-model-settings.md)
- [Read-only book model resolution and send guards](v3-book-model-resolution.md)
- [Captured-book assignment saves and separate mirror feedback](v3-book-model-assignments.md)
- [Versioned default templates and retained creation snapshots](v3-new-book-model-defaults.md)
- [Production model runtime, project initialization, explicit apply, private edits and request lifetime](v3-model-connections-integration.md) — integrates the preceding foundations; no author-book/API acceptance claim.

## Candidate evidence, not active contracts

- [V3 companion voice probes: Qwen/Kokoro evidence and isolated GPT-SoVITS public-reference audition; not a released speech service](v3-companion-voice-probe.md)

The following files preserve V1/V2 implementation detail. Their first-line status is binding: do not use a rule from them until a later V3 task promotes it.

- [Legacy directory and detailed-outline rules](directory-structure.md)
- [Legacy persistence scenarios](database-guidelines.md)
- [Legacy error scenarios](error-handling.md)
- [Legacy logging details](logging-guidelines.md)
- [Legacy quality matrix](quality-guidelines.md)
- [Semantic evaluation isolation](evaluation-isolation.md)
- [Explicit model routing](explicit-model-routing.md)
- [Finding resolution](finding-resolution.md)
- [Library outline preview](library-outline-preview.md)
- [Native task pause](native-task-pause.md)
- [Task-center history](task-center-history.md)
- [Temporal approved facts](temporal-approved-facts.md)
- [World map](world-map.md)
- [Writing agent](writing-agent.md)
- [Writing candidate rebase](writing-candidate-rebase.md)

## Before development

- Identify the V3 roadmap stage and active Trellis task.
- Read all four active contracts whose triggers match the change.
- Name exact candidate paths to promote; never infer acceptance from the 85 existing test files or current untracked code.

## Quality check

- Renderer has no raw Node/filesystem/SQLite/credential access.
- Identity, revision and containment checks fail closed before writes.
- Automated tests use isolated temporary projects; author-experience claims require the V3 task's real Electron/manual gate.
