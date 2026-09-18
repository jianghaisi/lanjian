# V3 Vue renderer specifications

> Status: `verified-current`. This index defines renderer engineering boundaries, not a visual design or proof of feature completion.

## Active contracts

- [Desktop source, tests and repository layout](../backend/v3-repository-layout.md)

- [Renderer and preload boundaries](v3-renderer-boundaries.md)
- [Renderer state and authority](v3-state-authority.md)
- [External manuscript/outline comparison, adoption and draft preservation](../backend/v3-mirror-recovery-audit.md)
- [V3 renderer verification](v3-verification.md) — includes card/collapse-container sizing and native zoom screenshot checks.
- [V3 planning and timeline state](v3-planning-timeline-state.md)
- [V3 workspace navigation hierarchy](v3-workspace-navigation.md)
- [V3 forms, guidance and field assistant](v3-form-and-assistant.md)
- [Fixed full-writing-flow preferences and historical report semantics](../backend/v3-full-writing-flow.md)
- [V3 companion dialogue overlay](v3-companion-dialogue-overlay.md)
- [Companion startup readiness override only](approved-loading.md#current-v3-companion-startup-override-2026-09-12) — narrow current-task reuse; other historical loading decisions below it are not promoted wholesale.

- [Local model store and assignments](v3-local-model-settings.md)
- [Global interfaces, independent assignments and new-book default interaction](v3-model-connections.md)

## Candidate evidence, not active contracts

- [Legacy directory target](directory-structure.md)
- [Legacy component rules](component-guidelines.md)
- [Legacy composable rules](hook-guidelines.md)
- [Legacy state scenarios](state-management.md)
- [Legacy type rules](type-safety.md)
- [Legacy renderer quality matrix](quality-guidelines.md)
- [Narrative terminal](narrative-terminal.md)
- [Desktop pet](desktop-pet.md)
- [Old approved loading visuals](approved-loading.md)
- [Library recent metadata](library-recent-metadata.md)
- [Character atlas](character-atlas.md)
- [Outline storage feedback](outline-storage-feedback.md)

These files remain searchable evidence. Their old labels, selectors, layouts, tests and completion language have no V3 force until a later task explicitly promotes them and, where visual, obtains author acceptance.

## Before development

- Start from the V3 product result, not an old screen or component name.
- Keep author text and formal state outside transient view state.
- Use only the named typed preload surface; no renderer filesystem, raw IPC or credentials.

## Quality check

- Loading, empty, error, success and recovery states are truthful.
- Chinese input, focus, keyboard, reduced motion and save/recovery are tested in proportion to risk.
- A visual or desktop interaction is not `v3-accepted` without the task's explicit author/manual gate.
