---
name: codex-jobs
description: The sanctioned contract for dispatching, awaiting, and collecting Codex companion jobs via this skill's bundled codex-job.sh — use whenever delegating work to Codex; never hand-roll dispatch or polling.
---

# codex-jobs

Every interaction with the Codex companion goes through `.claude/skills/codex-jobs/scripts/codex-job.sh`,
bundled in this skill's directory. **All script paths below are written from the
repo root**, which is the CWD skills execute with — not relative to this skill's
directory. (In a checkout the file also lives at
`.agents/skills/codex-jobs/scripts/codex-job.sh`; `.claude/skills` is a symlink
to `.agents/skills`.)
Ad-hoc polling has repeatedly missed completed jobs; each rule below encodes a
failure that actually happened.

## Dispatch

```
id=$(.claude/skills/codex-jobs/scripts/codex-job.sh dispatch --write --model <model> --effort <effort> "<prompt>")
```

- The wrapper runs every companion call from the **primary repo root** (the
  sandbox's writable root is inherited from cwd, and per-worktree registries
  hide jobs), so it is safe to invoke from any worktree.
- Always pass --model and --effort explicitly (see the companion's config for the current values).
- Always `--write` for implementation/repair AND whenever the job must run
  tests: read-only dispatches have no network and cannot install deps or run
  browsers, and a read-only brief poisons the session for later tasks.
- The wrapper always backgrounds (`--background`) and prints the bare job id on
  stdout; the human-readable dispatch line goes to stderr.
- Write prompts that survive having no conversation context: bead id, phase
  contract, acceptance criteria verbatim, `file:line` demanded for every claim,
  "flag a wrong premise rather than build on it".
- Verification discipline in every implement/repair brief: `pnpm run typecheck
  && pnpm run lint && pnpm run test` (and `pnpm run smoke` when capture behavior
  changed) before reporting.

## Await

```
.claude/skills/codex-jobs/scripts/codex-job.sh wait "$id"      # run in background Bash; exit 0 iff completed
```

- `wait` loops the companion's `--wait` (cheap block) but trusts only
  `status --json`'s `job.status` — `--wait` exits 0 on timeout as well as
  completion and can return spuriously mid-run. The terminal state is named in
  the output; anything other than `completed` exits nonzero.
- **Watchers do not survive `/compact` or session restarts.** On every resume,
  first run `.claude/skills/codex-jobs/scripts/codex-job.sh status <id> --json` for every in-flight job
  before waiting on anything — assume armed watchers are gone.
- "No job found" from the registry does not mean the job is dead; check
  `status <id> --json` and the job process before redispatching, or you get two
  writers on one worktree.
- Never watch log mtimes, process counts, or the forwarder subagent's timeout;
  never read a subagent's raw `.output` transcript.

## Collect

```
.claude/skills/codex-jobs/scripts/codex-job.sh result "$id"
```

- Archive substantive reports under `local/` before acting on them.
- A completed job's report is still **reviewed, not accepted**: re-run the
  verification lanes yourself and read the diff.

## Maintenance

`.claude/skills/codex-jobs/scripts/codex-job.sh selftest` verifies companion resolution and the status
parser. Run it after any plugin update, and test any change to the parser
standalone before relying on it — a silently broken watcher is
indistinguishable from a still-running job.
