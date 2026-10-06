---
name: reset-baseline
description: After a bead's Verify is signed off and its PR is ready, land it and return the repo to a clean baseline — merge the PR, re-pull the base branch, sync bd state, prune the merged branch/worktree, and leave the primary checkout on clean main. Use once per merged bead, when the owner says "reset to baseline" / "clean up after the merge".
---

# reset-baseline

The standard post-merge landing — the completed-work counterpart to `/wind-down`
(which snapshots *in-progress* work). Autonomous within the safe/local steps;
**confirm at every push, PR merge, and branch/worktree deletion, and before
discarding any dirty file.** Several steps hit the repo's own guardrails by
design — those are confirmation points, not obstacles.

> Read `## Project config` in CLAUDE.md first (branch prefix, bd umbrella, base
> branch, verify command).

## Inputs

- Optional bead ID + PR number. Default: parse the bead from the current branch
  (`<BRANCH_PREFIX><bead-id>-…`) and find its PR via `gh pr list --head <branch>`.

## Steps

1. **Preconditions.** Verify is signed off (verification doc PASS) and the PR is
   green: run `.claude/skills/reset-baseline/scripts/preconditions.sh <#>` (checks `OPEN` / `CLEAN` / all checks
   `SUCCESS`) — proceed only on PASS. On FAIL or no `gh`, stop and check manually.
2. **Tear down any live test/verify stack** the bead stood up (e.g. a compose
   stack): remove only **derived** state (test DBs, caches, ephemeral volumes) —
   **never** source data, originals, or content-addressed stores. Confirm the
   originals still exist afterward.
3. **Merge the PR** *(confirm)*: `gh pr merge <#> --merge` (or the project's merge
   style). Don't pass `--delete-branch` when the base branch is checked out in
   another worktree — its local delete step fails there. Verify `state == MERGED`.
4. **Delete the merged remote branch** server-side (`gh api -X DELETE
   repos/<owner>/<repo>/git/refs/heads/<branch>`, or `git push origin --delete`).
5. **Re-pull the base branch** into the worktree that holds it:
   `git -C <base-wt> fetch origin <base> && git -C <base-wt> merge --ff-only FETCH_HEAD`.
6. **Sync bd state.** Confirm the bead is closed (`bd show <id>`). If the bd store
   is Dolt-backed, the board is backed up by scripts/backup-push.sh on a timer; never push the Dolt ref to git (docs/backup.md). Don't commit gitignored `.beads/` exports.
7. **Prune the merged branch + stale worktrees** *(confirm)*: `git branch -d
   <merged-branch>` (skip any still checked out in a worktree); `git worktree
   remove [--force] <stale worktrees>` (unlock locked ones first). Keep any
   grandfathered branches named in `BRANCH_GRANDFATHER`.
8. **Consolidate to baseline.** Leave the primary checkout on a clean base branch
   (`git switch <base>`; the branch hook allows base branches). Note: you
   **cannot** remove the worktree you're currently in — defer removing the
   just-merged feature worktree to after the session, or run from another worktree.
9. **Push the base branch** *(CONFIRM — gated every time)*: a direct push to the
   default branch needs explicit owner approval on each invocation.
10. **Wrap up.** Update `HANDOFF.md`/`MEMORY.md` (or `bd remember`) with the final
    topology; report what landed and what's deferred (unpushed commits, the
    session-worktree removal).

## Boundaries (pause for confirmation)

- PR merge; **any** push (especially direct to the base branch); branch or
  worktree deletion; discarding any dirty file.
- Only tear down **derived** state — never source data, originals, or
  content-addressed originals.
- Never discard uncommitted working changes without asking.
- The session's own worktree and any grandfathered branch are off-limits to deletion.
