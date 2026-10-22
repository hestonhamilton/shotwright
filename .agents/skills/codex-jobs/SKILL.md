---
name: codex-jobs
description: The sanctioned contract for dispatching, awaiting, and collecting Codex companion jobs via scripts/codex-job.sh — use whenever delegating work to Codex; never hand-roll dispatch or polling.
---

# codex-jobs

Every interaction with the Codex companion goes through `scripts/codex-job.sh`,
bundled in this skill's directory (from a checkout:
`.agents/skills/codex-jobs/scripts/codex-job.sh`). Ad-hoc polling has
repeatedly missed completed jobs; each rule below encodes a failure that
actually happened.

## Dispatch

```
id=$(.agents/skills/codex-jobs/scripts/codex-job.sh dispatch --write "<prompt>")
```

- The wrapper runs every companion call from the **primary checkout** (the
  sandbox's writable root is inherited from cwd, and per-worktree registries
  hide jobs), so it is safe to invoke from any worktree. Bead worktrees live
  *inside* the primary checkout (`<repo>/<bead-id>/`), so a `--write` task can
  edit them; `.git` stays read-only and the orchestrator commits.
- **Two accounts at once:** a broker is per cwd and pins one account, so to
  drain both accounts in parallel give the second lane its own cwd. Run the
  wrapper with `CODEX_JOB_ROOT=<bead worktree> CODEX_HOME=~/.codex-accounts/tab`
  on dispatch; that lane's writable root is just that worktree (its `.git` is
  a pointer file, reads fine), and its `wait`/`status`/`result` calls need the
  same `CODEX_JOB_ROOT`. The brief then names paths relative to the worktree.
- Model and effort come from the config default (gpt-6-sol); pass `--model` /
  `--effort` only when `/codex-dispatch` says the task calls for it.
- Always `--write` for implementation, repair, and anything that must run
  `pnpm` or Playwright: read-only dispatches have no network and cannot
  install or launch browsers, and a read-only brief poisons the session for
  later tasks. Research that only reads may stay read-only, but it then has no
  web access either — say which you chose in the brief.
- The wrapper always backgrounds and prints the bare job id on stdout; the
  human-readable dispatch line goes to stderr.
- Write prompts that survive having no conversation context: bead id, worktree
  directory relative to the repo root, phase contract, acceptance criteria
  verbatim, `file:line` demanded for every claim, "flag a wrong premise rather
  than build on it", "no git commit / push / bd writes".
- Every implement or repair brief ends with `pnpm run format` (Prettier is the
  repo's formatter; `pnpm run lint` fails on unformatted code, and delegates
  left to themselves emit compressed one-line code).
- Only one Playwright-launching lane at a time across all delegates and the
  orchestrator unless each has its own worktree and output dir.

## Await

```
.agents/skills/codex-jobs/scripts/codex-job.sh wait "$id"   # background Bash; exit 0 iff completed
```

- `wait` loops the companion's `--wait` (cheap block) but trusts only
  `status --json`'s `job.status` — `--wait` exits 0 on timeout as well as
  completion and can return spuriously mid-run. Anything other than
  `completed` exits nonzero.
- **Watchers do not survive `/compact` or session restarts.** On every resume,
  first run `codex-job.sh status <id> --json` for every in-flight job before
  waiting on anything — assume armed watchers are gone.
- "No job found" from the registry does not mean the job is dead; check
  `status <id> --json` and the job process before redispatching, or you get two
  writers on one worktree.
- Never watch log mtimes, process counts, or a forwarder subagent's timeout;
  never read a subagent's raw `.output` transcript.

## Collect

```
.agents/skills/codex-jobs/scripts/codex-job.sh result "$id"
```

- Archive substantive reports under `local/` (gitignored) before acting on them.
- A completed job's report is still **reviewed, not accepted**: run the
  verification command yourself and read the diff. Grep every delegated
  document for `/home/` before it lands in `docs/`.

## Maintenance

`codex-job.sh selftest` verifies companion resolution and the status parser.
Run it after any plugin update, and test any change to the parser standalone
before relying on it — a silently broken watcher is indistinguishable from a
still-running job.
