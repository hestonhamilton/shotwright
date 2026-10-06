---
name: bead-start
description: Claim the next ready bead (or a named one), set state to in_progress, surface acceptance criteria, create a feature branch, and scaffold the artifact path for the bead's R/P/I/V phase. Use at the start of any work session.
---

# bead-start

Autonomous within the bead; confirm at branch-name/PR/close boundaries.

> Read the `## Project config` block in CLAUDE.md first — it defines the branch prefix, bd umbrella, and doc/verification conventions this skill relies on.

## Repo facts (do not re-derive)

- Single bd database in the primary repo. `bd` auto-discovers it from any worktree via the git common-dir, so just run `bd <subcommand>` — no `-C` needed.
- Worktrees live alongside the primary repo; create them with `bd worktree create <name> --branch <BRANCH_PREFIX><bead-id>-<slug>`.

## Input

- Optional positional: a bead ID. If omitted, pick the first ready non-epic from `bd ready` (lowest available R/P/I/V phase within its epic).

## Steps

1. `bd show <id>` — read title, acceptance, deps, parent. **Confirm the chosen bead matches the user's intent** (one sentence; skip if they named it explicitly).
2. Run `.claude/skills/bead-start/scripts/start.sh <id>` — it claims the bead (`bd update --claim`), derives the canonical branch name `<BRANCH_PREFIX><bead-id>-<kebab-slug>`, maps the R/P/I/V phase to its artifact path, and prints the summary + `bd ready` minus this bead. (See `../rpiv/SKILL.md` for the phase→artifact contract; the script prints the path, `/rpiv` scaffolds the markdown doc.)
3. **Create the branch** with the name the script printed — do it **without asking**, since the branch hook enforces the convention (a bad name is caught, not silently accepted). Only pause when the script flags an empty/ambiguous slug.
4. Surface the next 3 acceptance bullets and hand off to `/rpiv` for the phase.

## Boundaries (pause for confirmation)

- Branch creation only when the slug is ambiguous (otherwise auto-named, since the hook enforces the convention).
- Any `bd close` (use `bead-finish`).
- Any `git push` or PR open.
