# CLAUDE.md — shotwright

Instructions for Claude (and any other agent) working in this repo or its worktrees.

**`AGENTS.md` is a symlink to this file** (`shotwright-746.24`). Editing either
edits both, and they cannot drift. Before that, `AGENTS.md` was generic beads
boilerplate carrying *none* of the rules below — not the headed-public
invariant, not the AI-attribution ban, not R/P/I/V, not the raw-`dolt`
prohibition. Agents that read `AGENTS.md` rather than this file were never
given those rules; a recurring class of defect (absolute host paths in delegated
documents) was a missing instruction, not a model quirk. The managed Beads
block near the end still describes the two files as independent and unsymlinked
— that text is bd-generated boilerplate, it is regenerated with a hash, and it
is now wrong here.

## What shotwright is

A centralized Playwright UI-walkthrough harness, distributed as an npm package:
consuming projects (the first consumers and future apps) install it and keep
only thin config plus their own `*.shots.ts` specs. It produces screenshots,
videos, and traces for human review, generates a self-contained gallery, compares
runs, and ships an artifacts-only CI workflow. `README.md` has the philosophy;
`docs/design.md` is the design source of truth.

Two principles that shape most decisions:

1. **Review artifacts, not assertions.** Output is throwaway, regenerated,
   gitignored. No golden-diff gating — that is a different tool's philosophy.
2. **Consumers stay thin.** Anything a second project would copy-paste belongs
   in the package (or its `templates/`), not in the consumer.

**Repo visibility: private, headed public** — no host paths, LAN IPs, usernames,
or personal data in committed files.

## Project config

The human half of the project config. The executable half is
`.claude/scaffold.conf`, which the hooks source at runtime — **edit one, mirror
the other by hand.**

| Key | Value |
|---|---|
| Branch prefix | `feat/` — branches are `feat/<bead-id>-<kebab-slug>` |
| bd umbrella | `shotwright` |
| Base branch | `main` |
| Lint (on edit) | `eslint --fix` (extensions: `ts tsx js mjs cjs`) |
| Verification | `pnpm run typecheck && pnpm run lint && pnpm run test` (as tooling lands; see design doc) |
| Enforcement | `strict` (off-convention branches and AI-attributed commits are blocked) |
| Beads | `on` — shared Dolt sql-server, prefix `shotwright` |
| Knowledge | `HANDOFF.md` only (session-ephemeral, gitignored, ≤100 lines) |

## Beads

One bd database on the shared Dolt sql-server (127.0.0.1:3308). `bd`
auto-discovers the workspace from any worktree — run `bd <subcommand>` with no `-C`.

- **The off-machine backup is `scripts/backup-push.sh` on a systemd user timer,
  and it is the ONLY copy of the board** (ADR 0016, ADR 0017 — there is no
  off-site copy, deliberately). It restores and counts the copy before sending
  it. Check it with `scripts/backup-verify.sh`, never with `bd backup status`,
  which reported a healthy backup of an empty database for the life of this
  project (`shotwright-2sr.5`). Runbook: `docs/backup.md`.
  **`refs/dolt/data` on GitHub is no longer the backup** — it is scheduled for
  deletion at `shotwright-2sr.4` and pushing to it is not a session-close step.
  JSONL export is deliberately off.
- **Never run `bd dolt push`.** It would recreate `refs/dolt/data` on the public remote. The managed block below still describes that sync; it is wrong here.
- **Never run raw `dolt` CLI commands** while the server is running — use `bd dolt …`.
- Worktrees: `bd worktree create worktrees/<bead-id> --branch feat/<bead-id>-<slug>`
  (the `--branch` flag is required under strict enforcement).
- **`.beads/interactions.jsonl` is untracked here, diverging from bd's default**
  (owner decision 2026-08-01). bd tracks it by design — it is absent from
  `.beads/.gitignore`, which is what makes it tracked — but every bd command
  rewrites it, so it sat permanently dirty and was hand-excluded from commit
  after commit. The ignore lives in the **root** `.gitignore`, not
  `.beads/.gitignore`, because bd owns the latter. If it reappears in `git
  status`, that is the divergence being undone by a bd upgrade or
  `bd doctor --fix` — re-untrack it rather than committing it.

## Rules

- **No AI attribution on commits or PRs** (no `Co-Authored-By`, no "Generated
  with Claude Code"). A hook blocks it; do not work around it.
- Confirm before `git push`, PR merge, `bd close`, or any destructive git op.
- **CI runs on GitHub, and on the self-hosted forge as a standby second opinion
  (`shotwright-746.14`, ADR 0008).** One `git push` reaches both remotes —
  `origin` carries two push URLs. What each lane runs is defined once in
  `scripts/ci/*.sh`; the two wrappers differ only in setup, so a step added to one
  belongs in the script, not the wrapper. Read a branch's forge status with
  `scripts/forge-ci-status.sh <sha>`; it fails closed and treats "no runs" as
  not-green. **It is advisory — nothing gates merges on it.** Setup and
  troubleshooting: `local/forge-ci.md` (gitignored).
- Work under the **R/P/I/V** phase contract (`/rpiv`); `/flow` drives the loop.
- **R/P docs are inputs, not gospel.** Implementation findings that contradict
  them are normal — settle them by experiment when empirically decidable,
  otherwise raise to the operator *at the point of deviation*. A second defect
  of the same shape means stop patching instances and name the cause.
- **Docs are markdown by default** (`docs/<id>-research.md`, `-plan.md`, ADRs from
  `docs/adr/0000-template.md`). Self-contained HTML is reserved for docs that
  genuinely need interactiveness or visual structure (e.g. uiux mockups).
- **ADRs at decision-time** for foundational/binding choices (`docs/adr/`);
  the `/bead-finish` epic-close gate is the backstop.
- `HANDOFF.md` is session-ephemeral: gitignored, ≤100 lines, only the "you are
  here" position and immediate runway. Durable facts go to `docs/` or beads.
- Secrets and `.env` stay out of git; `local/` is the gitignored scratch home.
- **An unviewed UI change does not ship** — this repo builds the tool that makes
  that gate cheap; hold it to its own standard when demo/gallery UI changes.

## Skills

Workflow skills live in `.agents/skills/` (surfaced via the `.claude/skills`
symlink), invoked as `/<name>`; their descriptions are listed automatically.
`/flow` drives the whole bead loop. Hooks are wired in `.claude/settings.json`
under `ENFORCEMENT=strict`.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
