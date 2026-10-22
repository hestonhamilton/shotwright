---
name: delegated-orchestrator
description: Run a session as a pure orchestrator — push every research/implementation slice to the two Codex accounts until their limits drain, then to Claude subagents by effort level; keep Claude as impartial reviewer; gate each R/P/I/V transition behind a redteam. Use to start an autonomous work session, or when told to "orchestrate", "delegate", "use both Codex accounts", or "stay the reviewer".
---

# delegated-orchestrator

A session profile, not a one-shot. Once invoked it holds for the rest of the
session, layered **over** `/flow` — `/flow` decides *what* moves, this decides
*who does it*. Read `## Project config` and `## Rules` in CLAUDE.md first.

## The one rule

**You do not write the code you review.** Every substantive slice — grounding
surveys, research docs, implementation, refactors, test authoring, redteams —
goes to a delegate. Your job is to spec the work, judge the result, and own
the merge.

Claude may only write: bead/board updates, phase docs *synthesized from*
delegate findings, commit messages, PR bodies, skill/CLAUDE.md text, and edits
under ~10 lines that a delegate's diff missed on review. Anything bigger goes
back to the delegate with the correction. If you catch yourself opening an
editor on the slice's own source files, stop — that is the impartiality gone,
and a re-dispatch is cheaper than a self-review.

## Who does the work: Codex first, then Claude by effort

1. **Codex** (`/codex-jobs`, model/effort per `/codex-dispatch`) until both
   accounts are walled.
2. **Claude subagents** once Codex is drained — same briefs, same review:
   - `Explore` for read-only grounding surveys.
   - `general-purpose` with `model: opus` for research docs, plans, redteams,
     cross-cutting or tricky implementation.
   - `general-purpose` with `model: sonnet` for well-specified or mechanical
     slices: renames, boilerplate, test fixes, running checks and summarising.
   Give each subagent the worktree path and the same "no commit, no host
   paths, flag a wrong premise" contract as a Codex brief.

Working solo is the thing that needs a reason, not delegating.

## Drain both accounts

Two Codex homes exist: `heston` (`~/.codex`, the OS default) and `tab`
(`~/.codex-accounts/tab`). Capacity is the budget; spend it.

```
codex-acct                      # which account this shell is on
codex-acct usage                # live 5h + 7d limits for every account
codex-acct pick                 # the account the tier waterfall would choose now
```

- Dispatch on the live account. When it hits a 5h or 7d wall (the job log says
  "You've hit your usage limit"; `status` shows `failed`), switch and continue
  from the diff the dead run left — never from scratch.
- **Switching is a broker restart, not an env var.** The companion keeps one
  long-lived `app-server-broker` per cwd that reads `CODEX_HOME` once at
  spawn. Confirm no job is running on this cwd (`codex-job.sh status --all`),
  then `codex-acct restart`, then dispatch with `CODEX_HOME=<home>` set on the
  `codex-job.sh dispatch` call; the respawned broker inherits it. One cwd
  carries one account at a time, so the two accounts drain in sequence.
- `usage` reads each account's own token, so it can report an expired token
  for an account that is healthy. Treat that as "unknown", switch once, retry.
- Both homes carry a hand-mirrored `[sandbox_workspace_write]` table. The
  writable root of a `--write` task is the cwd the wrapper runs from (the
  primary checkout), which contains every `<bead-id>/` worktree; `.git` stays
  read-only, so **the orchestrator commits**, never the delegate.

## Dispatching

Every Codex call goes through `.agents/skills/codex-jobs/scripts/codex-job.sh`
(`/codex-jobs`). Never hand-roll dispatch or polling, and never use the
`codex:codex-rescue` forwarder for orchestration work — it blocks a Claude
subagent on the run and cannot poll.

Write the prompt so it survives having no conversation context: bead id, the
worktree directory (relative to the repo root — the delegate's cwd is the
primary checkout) and the rule that nothing outside it is touched, the phase
contract (research = no `src/` edits; implement = code against the committed
plan, step numbers quoted), the acceptance criteria verbatim, `file:line` for
every claim, "flag a wrong premise rather than build on one", and "do not run
`git commit`, `git push`, `bd close` or any `bd` write".

**Headed-public ingest, mechanically.** Delegates emit absolute host paths
(`/home/<user>/...`) as their default citation format; reviewers demonstrably
miss them. Before any delegated document lands in `docs/`, grep it for
`/home/`, LAN IPs and usernames and rewrite to repo-relative paths. Every
brief also says so, but the grep is the gate.

**Delegation must not route around the R grounding gate.** A research brief
that only asks "read this repo" comes back fully repo-grounded and stale on
the outside, and it *reads* complete. Every R brief demands web search of the
current docs, issues and changelog of whatever the design leans on (Playwright,
GitHub Actions, Node, npm), with link + date per claim, and a plain "WEB
ACCESS: none" line if the delegate had none. Verify the returned doc contains
it; if not, the grounding pass is yours to dispatch separately before the R
doc is written.

## Redteam gates

At **every** R/P/I/V transition, before the artifact is committed and before
the next phase is dispatched, send the artifact to a fresh delegate briefed to
argue against it. Fresh, not the author. One redteam per transition; never
iterate redteams against each other.

Standing brief, on top of anything phase-specific:

- **Over-engineering.** What here does not need to exist? Which abstraction
  has one implementation, which option never changes, which layer is
  scaffolding for a consumer that does not exist yet? Consumers stay thin;
  anything a second project would copy-paste belongs in the package.
- **Unearned lock-in.** What does this make expensive to reverse — a
  dependency, a manifest field, a CLI flag, a workflow input, a published
  export — and was that cost argued for, or assumed? Public API and manifest
  shape are versioned; say what bump the change needs.
- **Wrong premise.** Is the problem statement still true against the code as it
  is *now*?
- **The invariants.** Review artifacts, not assertions (no golden-diff gating
  by default; `docs/design.md`); run directories publish atomically and
  `latest` means last *passed* run; `shot()` output stays byte-identical to
  `page.screenshot()` for the same viewport and DSF; the gallery stays
  self-contained; the consumer's own `@playwright/test` is resolved, never
  `npx`; headed-public (no host paths, IPs, usernames in committed files).
- **False reporting.** Where could this make the tool claim something untrue —
  a status that outlives its cause, a manifest that lists a shot from a test
  that failed without saying so, a compare state that is computed but wrong?

Triage with the fix-now bar: fix now only what would make the software report
something false, lose data, or violate an invariant. Everything else must pass
a practical-bite test — a concrete scenario reachable in this repo's or a real
consumer's actual usage — to become a bead; otherwise record it as
considered-and-declined in the phase doc. Do not fix the rest now, and do not
drop it either.

A second defect of the same shape across redteam rounds means the cause is
structural: stop patching instances, name the cause, and raise it.

## Autonomy

Run without check-ins. Claim beads, dispatch, review, run the verification
command yourself (`pnpm run typecheck && pnpm run lint && pnpm run test`),
commit, take the next slice.

CLAUDE.md's gates still bind: confirm before `git push`, PR merge, `bd close`,
or any destructive git op — batch those asks so one answer covers a wave. An
unviewed gallery or compare change does not ship: render it and look.

Stop and `AskUserQuestion` (2–4 options, with a recommendation) only for a
genuine fork: a foundational component or dependency choice, an unresolved plan
Open Question, a redteam finding that changes a bead's acceptance, or two
readings of the task that lead to materially different work. Record the answer
on the bead. Everything else is a judgment call you already have the standing
to make.

Report failures as failures. A red check, a delegate run that returned
garbage, a verification lane you skipped — say so plainly with the output. The
value of an impartial reviewer is exactly zero if it grades generously.
