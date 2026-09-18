> V3 status: `verified-current`.

# Trellis Project Integration Specifications

- [Development entry gate](entry-gate.md)

## Pre-Development Checklist

- Run `python scripts/trellis_preflight.py --intent code` from any location when preparing to edit this repository.
- Stop on BLOCKED or ERROR; repair task state through the documented Trellis workflow.
- Keep project-owned rules outside generated `<!-- TRELLIS:START -->` blocks.

## Quality Check

- Run the preflight self-test.
- Exercise read/plan/code against the current session from both the repository and outer workspace.
- Confirm the gate did not modify task files, runtime pointers, the Git index, or product sources.
