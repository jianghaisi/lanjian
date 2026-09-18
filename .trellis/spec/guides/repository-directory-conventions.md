> V3 status: `verified-current`.

# Repository Directory Conventions

Use these rules for directories owned by this Git repository and intended for version control. They do not rename or constrain author-selected project folders, `.webnovel` data, repository-external workspaces or developer-local paths.

## Default naming

- Use descriptive ASCII English names in lowercase kebab-case, such as `design-system` and `approved-reference`.
- Name a directory for one stable responsibility. Do not introduce Chinese pinyin, temporary date or sequence numbers, ambiguous abbreviations, or synonymous roots at the same layer.
- Reuse an existing canonical owner when it already fits. Repository-wide design material belongs under the root `design-system/`; legacy design references belong under `design-system/legacy/`.
- This convention governs directory names. It does not require unrelated file renames, and Markdown content may remain Chinese.

## Allowed exceptions

Exceptions are permitted when the name is required by a tool or ecosystem, including technical dot directories, fixed package/source directories, case-sensitive external conventions and third-party resources preserved verbatim. Keep the reason discoverable in the owning configuration or documentation.

Generated and ignored directories are not repository naming authorities. Do not rename them merely to satisfy this guide.

## Change checklist

Before creating or moving a directory:

1. Search for an existing owner and every reference to the old path.
2. Confirm the path is repository-owned rather than user data or local tooling state.
3. Preserve file content and authority classification during a documentation-only move.
4. Update current references, but do not rewrite archived tasks or immutable evidence as though the new path existed historically.
5. Verify the resulting path set, references, build checks appropriate to the affected layer, and exact Git scope before commit.
