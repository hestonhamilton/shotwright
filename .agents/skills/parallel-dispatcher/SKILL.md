---
name: parallel-dispatcher
description: Operator-side planner for running 2+ agents concurrently on disjoint write surfaces — compare ready beads against the in-progress set, enforce one-task/one-worktree/one-branch, run bd from the base checkout, and produce dispatch-ready assignments.
---

# parallel-dispatcher

You are the operator-side planner for parallel agent work. Pick beads that can
move at once without branch collisions, bd confusion, or overlapping write
surfaces, then emit a safe dispatch plan. You do not implement the beads — you
decide which run together and hand each to a workspace.

> Read `## Project config` in CLAUDE.md first (branch prefix, bd umbrella,
> `ENFORCEMENT`, `BEADS`), plus `AGENTS.md` / `HANDOFF.md` for the write surfaces
> in flight.

## Use this skill when

- The user wants 2 or more agents working at once.
- You need to compare `bd ready` candidates against the `in_progress` set and
  produce a safe worktree + branch plan before dispatch.

## Non-negotiable rules

- Only dispatch beads that already exist and are returned by `bd ready` — unless
  the user explicitly names a specific bead.
- Compare every candidate against the current `in_progress` set before
  recommending it; reject any that collide (see below).
- One bead per agent · one worktree per bead · one branch per bead.
- Run all `bd` commands (show, claim, notes) from the base checkout, not from
  inside a worktree — one operator view, no actor confusion. All code edits,
  tests, commits, and pushes happen in the bead's worktree.

## Selecting parallel-safe beads

- Prefer highest-priority ready beads with **disjoint write surfaces**, clear
  acceptance criteria, and no unresolved plan Open Questions.
- Reject candidates blocked by the current `in_progress` set even if `bd ready`
  lists them as individually ready.

Before pairing two beads, enumerate **this project's high-contention write
surfaces** — shared files and modules many features touch (type/constant
modules, cross-cutting handlers or routers, schema/migration files, config,
top-level docs). Two are unsafe in parallel if they likely write the same file,
feature slice, or surface from that list, or if one changes a contract the other
depends on. When in doubt, serialize: a false "safe" is a merge conflict; a false
"unsafe" only costs some concurrency.

## Wiring each workspace

Once a bead passes selection above, hand it to `.claude/skills/parallel-dispatcher/scripts/dispatch.sh <bead-id>`
(one call per bead). It does the mechanics you'd otherwise hand-wire: resolves
the base checkout, derives the branch (`<BRANCH_PREFIX><bead-id>-<slug>`, prefix
from `.claude/scaffold.conf`), mints a unique `BEADS_ACTOR`, creates the worktree
with `bd worktree create` (never raw `git worktree add` — a hook denies it),
claims the bead as that actor, and prints the worktree path, branch, actor, and a
launch hint. Pass a second arg to override the slug; if `bd` is
absent/unreachable it prints the plan instead of failing. It wires only the bead
you already chose — it encodes none of the judgment above.

## Dispatch output

When asked for candidates, return:

- the current `in_progress` beads with their likely write surfaces;
- 2–3 parallel-safe ready candidates and why each is safe **now**;
- for each: the `.claude/skills/parallel-dispatcher/scripts/dispatch.sh` output (worktree path, branch, actor) plus
  its agent prompt — produce that prompt by handing the bead to `/gen-agent-prompt`;
- the candidates you rejected and why.

## Boundaries (pause for confirmation)

- Dispatching a bead the user did not name, when selection is ambiguous.
- Any `bd update --claim` the user has not asked you to perform (dispatch.sh
  claims as it wires — don't run it on a bead the user hasn't greenlit).
- Any `git push`, PR open, or `bd close` — those belong to the per-bead agent's
  `/bead-finish`, not the dispatcher.
- Pairing two beads whose write surfaces you cannot confidently call disjoint —
  serialize and say so.
