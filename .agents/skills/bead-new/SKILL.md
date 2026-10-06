---
name: bead-new
description: Create new beads following the established R/P/I/V + dependency-wiring convention. Use when scope evolves, a new feature epic is needed, or you want to add R/P/I/V children to an existing epic.
---

# bead-new

Autonomous within the chain conventions; confirm before mass creation (>4 beads in one batch).

> Read the `## Project config` block in CLAUDE.md for the bd umbrella name and any prefix scheme documented there.

## Conventions

- Umbrella: see `## Project config` (bd umbrella).
- Epic acceptance is **observable** — what's true when closed, not what was done.
- Each implementation epic has 4 R/P/I/V children chained `R → P → I → V` via `blocked-by`.
- Dependency wiring: epics `blocked-by` their prerequisite epics; children `blocked-by` the previous phase.
- **Every bead carries at least one label** — see Labels below.

## Labels

Set labels on the **parent** epic (`-l/--labels`, comma-separated); children inherit them
automatically (unless `--no-inherit-labels`), so phase children don't need their own unless
they diverge. Use both kinds where they apply:

- **App / area** (almost always required): where the work lives. Mirror an existing label
  exactly (`bd label list-all`) — don't coin a synonym. Use a shared/cross-cutting label
  when the work isn't app-specific.
- **Cross-cutting theme** (add when relevant): e.g. `modernization`, `security`, `auth`,
  `db`, `tooling`, `brand`.

Any bead spun off mid-phase (a V-phase bug, a discovered follow-up) must be labelled too.

## Inputs

- A new epic concept (`bead-new epic <one-line title>`), or
- An existing epic ID to expand with R/P/I/V children (`bead-new rpiv <epic-id>`), or
- A free-form feature idea — interpret it, propose a slot, confirm before creating.

## Steps — epic creation

1. List sibling epics (`bd children <umbrella>`) to find the next slot and avoid collisions.
2. Identify prerequisite epics from the open set (`bd ready` + `bd list`); wire `blocked-by`.
3. Draft a description (scope, in/deferred) and an outcome-focused acceptance criterion.
4. Show the user the draft. On confirmation:
   ```
   bd create "[EPIC] <Title>" \
     --type epic --priority <0|1|2> --parent <umbrella> \
     --deps "blocked-by:<id1>,blocked-by:<id2>" \
     --description "<desc>" --acceptance "<acc>" --silent
   ```

## Steps — R/P/I/V children expansion

1. Confirm parent epic ID and its acceptance criteria.
2. Draft 4 children with per-phase acceptance (research committed; plan committed; code+tests merged; manual verification recorded).
3. Show the 4 drafts. On confirmation, create them in order and wire `blocked-by` between consecutive phases.

## Description text — author via `--body-file`

For anything past a single plain sentence, don't inline it in `--description "…"` — a
backtick there triggers command substitution and silently truncates the bead. Write the
body to a temp file with the Write tool, then `bd create/update --body-file <file>`, and
`bd show <id>` to confirm it landed intact. Full rationale: `/beads-task-manager` →
"Multi-line field updates".

## Boundaries (pause for confirmation)

- Creating more than 4 beads in one batch.
- Closing or modifying existing beads.
