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

**This repository is public-facing** — no host paths, LAN IPs, usernames,
personal data, or names of the owner's private repositories in committed
files, commit messages, PR text or Release notes. Refer to a private repo as
"a consumer project".

## Project config

The human half of the project config. The executable half is
`.claude/scaffold.conf`, which the hooks source at runtime — **edit one, mirror
the other by hand.**

| Key | Value |
|---|---|
| Branch prefix | `feat/` — branches are `feat/<bead-id>-<kebab-slug>` |
| bd umbrella | `shotwright` |
| Base branch | `main` |
| Lint (on edit) | `eslint --fix` (extensions: `ts tsx js mjs cjs`); formatter is Prettier (`pnpm run format`, checked by `pnpm run lint`) |
| Verification | `pnpm run typecheck && pnpm run lint && pnpm run test` (as tooling lands; see design doc) |
| Enforcement | `strict` (off-convention branches and AI-attributed commits are blocked) |
| Prose-question guard | `on` — block a turn ending in an open prose question (`warn` advises; `off` disables) |
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
- **Never run `bd dolt push`.** It would recreate `refs/dolt/data` on the public remote.
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
- Open questions and authorization asks go through AskUserQuestion, never prose; the Stop hook blocks a turn that ends in a prose question.
- **CI runs on GitHub Actions only.** The self-hosted forge lane (ADR 0008) was
  retired on 2026-11-12. What a lane runs is defined once in `scripts/ci/*.sh`;
  a workflow wrapper only does setup, so a step belongs in the script, not the
  wrapper.
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
`/flow` drives the whole bead loop; `/delegated-orchestrator` is the session
profile that runs it with Codex (then Claude subagents) doing every slice and
Claude reviewing — start an autonomous session with it. Hooks are wired in `.claude/settings.json`
under `ENFORCEMENT=strict`.


## Beads conventions

Tasks live on this repo's beads board, under the hpc board's conventions: see
`~/heston-pc/CLAUDE.md` and `~/docs/ai-ml/beads.md`. No `bd remember`, no `bd prime`
(no hook, no primer), and no bd-managed block in this file; `bd init` and `bd setup`
would add one back.
