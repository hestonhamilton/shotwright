---
name: beads-task-manager
description: Use the Beads (bd) CLI to map non-trivial work to tracked tasks, check dependencies first, and record assumptions, blockers, and next steps.
---

# beads-task-manager

Reference for the Beads (`bd`) tracker. This holds the shared knowledge the workflow
skills assume; it does not restate them. For claiming/finishing/creating/worktrees see
`/bead-start`, `/bead-finish`, `/bead-new`, `/rpiv`, `/wind-down`, and the CLAUDE.md
`## Project config` block.

## When to use beads

- Non-trivial work maps to a bead — anything spanning multiple files or systems, carrying
  dependencies or blockers, or spawning follow-up. Skip it only for trivial one-offs.
- **Search before create.** `bd ready`, `bd list --status open`, `bd show <id>` first;
  filter to avoid dumping the whole board. Extend or reference existing work over spawning
  a near-duplicate. If scope shifts, update the bead's notes, don't fork a parallel one.
- Record assumptions, blockers, and next steps on the bead so a later turn need not
  reconstruct them. A blocker belongs in the bead, not buried in chat.

## Never guess an id

After `bd create`, wait for the CLI to return the real created id before anything that
references it. Do not construct an id from the title. If create and wiring are separate
steps, re-confirm with `bd show <id>` / `bd list` before linking. A dep on a guessed id
silently mis-wires the board.

## Dependency direction (the one that bites)

`bd dep add A B` means **A depends on B** — B must finish first, B blocks A. Read it as
"A cannot proceed until B is done."

```bash
bd dep add <impl-id> <research-id>   # research blocks impl; impl waits on research
```

Always verify direction before adding. A reversed dep inverts work order and makes ready
tasks look blocked (or vice versa).

## Relationship types — pick the right one

| Relationship | Use when |
|---|---|
| `blocked-by` / `bd dep add` | A must complete before B can start — execution order |
| `--parent` | B is a constituent part of A — structural ownership (epic → child) |
| `--type=tracks` | A pillar/epic claims a task as contributing work without owning it — the Jira "Epic Link" equivalent; the task keeps its operational parent |
| `--type=related` | Loose association, no ordering or ownership |
| `--type=discovered-from` | This task was surfaced while working another |

- **Parent vs. dependency are orthogonal.** A task often has both: a parent that owns it
  and a dep that gates it. Always set `--parent` on epic children — orphans don't show in
  `bd show <parent>` and vanish from planning reviews.
- **Scope test for parenting:** parent a task under an epic only if it *only* matters
  inside that feature. Work useful regardless of the epic stays standalone (wire a dep
  instead). Cross-cutting work that serves a broader pillar gets a `tracks` link to it.
- **Notes are not dependencies.** "may be affected by X" / "see Y" is documentation. If the
  task genuinely can't be done right without Y's output, add a hard dep. When in doubt, add
  it — easier to remove than to untangle work done out of order.

## Task-type taxonomy

Natural order within a feature: **Discovery → Research → Design/Plan → Implementation →
Verification/Deploy.** Each depends on the one before. Flag any chain where an
Implementation blocks a Design/Plan — that inversion means the beads are mis-typed or
mis-ordered. (This project's epics use the R/P/I/V slice of this — see `/bead-new`.)

## Multi-line field updates

A double-quoted `--description "…"` is shell-interpreted: a **backtick** triggers command
substitution and **silently truncates the body at the first backtick**; `$(…)`, `$VAR`,
and stray quotes corrupt it too. The bead is still created — just mangled — so it's easy
to miss. For anything past a single plain sentence (code, backticks, `$`, `var(--x)`,
multi-paragraph prose):

- **Write the body to a temp file with the Write tool** (zero shell interpretation), then
  `bd create/update --body-file <file>` (works for `--acceptance-file` too). Preferred.
- Or pipe a **quoted** `<<'EOF'` heredoc via `--body-file -` (the quotes on `EOF` stop
  interpolation) — `/board-audit` uses this for its inline rewrites.

Then `bd show <id>` to confirm the body landed intact. `bd note <id> --message` /
`--append-notes` *adds* progress; `--notes` overwrites the whole field.

## Dolt-backed stores only

If your bd store is Dolt-backed: the board is backed up by scripts/backup-push.sh on a timer; never push the Dolt ref to git (docs/backup.md). Use `bd doctor --fix` only when its proposed repair
matches the confirmed discrepancy. A git-native store needs none of this. Treat
`.beads/*.jsonl` as passive export, not the primary store.
