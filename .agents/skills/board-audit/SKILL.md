---
name: board-audit
description: Audit the bead board to reorganize, reprioritize, rewrite, and prune tasks — detect stub/empty descriptions, duplicates, shipped-but-open beads, orphan beads with no epic, deferred epics with ready children, and mis-priorities; apply the non-destructive fixes directly and batch closures for one owner confirmation. Use when the board has drifted (loose quick-capture beads piling up, stale in-progress flags, unclear priorities) and you want it groomed.
---

# board-audit

Re-grooms the whole bd board in one pass. **Non-destructive** changes (rewrite description, reparent, repriority, un-defer) apply **directly** — they're reversible. **Closures** (shipped / duplicate / dead) collect into **one batch for owner confirmation**: never `bd close` without confirm (CLAUDE.md Rules).

This is reorg only — it does NOT render an HTML roadmap. If a rendered board snapshot is wanted, that's a separate one-off.

> Read the `## Project config` block in CLAUDE.md for the bd umbrella name, branch prefix, and verification command referenced below.

## Companion scripts

Two helpers live in `scripts/` (run from the skill dir, or by absolute path). They do the mechanical parts; the judgment (what's really shipped, how to rewrite a body, what to close) stays with you.

- **`.claude/skills/board-audit/scripts/audit.py`** — read-only candidate detector. Parses `bd … --json` and flags the Step 2 checklist (stub/empty, orphan, deferred-epic-with-ready-children, duplicate title, mis-priority, shipped-but-open suspects). Never mutates.
  - `audit.py` — grouped human report · `--json` — machine-readable · `--category stub,orphan` — subset · `--dump` — full bodies of every non-closed bead (the Step 1 survey).
  - High-confidence categories (orphan, deferred_ready, mispriority) are directly actionable; `shipped_suspect` is a heuristic → **verify vs code+git** before acting.
- **`.claude/skills/board-audit/scripts/apply.sh`** — applies the **non-destructive** Step 4 fixes. **Dry-run by default** (prints the `bd` commands); add `--commit` to execute.
  - `apply.sh reparent <id> <epic>` · `priority <id> <0-4>` · `undefer <id>` · `defer <id> <when>`
  - `apply.sh [--commit] --plan fixes.txt` — batch (one op per line; `#` inline comments ok).
  - `apply.sh closures closes.txt` — **prints** `bd close` commands only (one `<id> <reason>` per line); it never runs them (confirm gate). Body **rewrites** stay manual (`bd update --body-file -` heredoc, Step 4) — multi-line bodies aren't wrapped.

## Output

- A reorganized bd board (the source of truth: priorities, parents, descriptions, states fixed).
- An audit report to the owner: structural problems found, changes applied (with counts), closures awaiting confirm, beads needing owner input.

## Step 1 — Survey

- `bd ready` — what's actionable now.
- `bd list` (open + deferred tree) and `bd list --all --flat --limit 0` (incl. closed) for the full shape. **`--limit 0` is required** — `bd list` defaults to 50, so without it a large board only shows its first page. (`audit.py` already passes `--limit 0` internally.)
- Cross-check `HANDOFF.md` "Current focus" / any in-progress table against actual bd state — those flags go stale (a bead HANDOFF calls in-progress is often already closed/shipped).
- Dump full bodies of every non-closed bead to a scratch file and READ it — judgment needs the bodies, not just titles:
  ```bash
  .claude/skills/board-audit/scripts/audit.py --dump > /tmp/bead_audit_dump.txt
  wc -l /tmp/bead_audit_dump.txt   # then Read it
  ```

## Step 2 — Detect (the audit checklist)

Run `.claude/skills/board-audit/scripts/audit.py` for a ranked candidate list, then eyeball the `--dump` for what heuristics can't catch (real-but-thin bodies, intent drift). audit.py flags six categories: **empty/stub description**, **duplicate**, **shipped-but-open**, **orphan** (no `--parent`), **deferred-epic-with-ready-children**, and **mis-priority** (see its output / `--help`).

Judgment the script can't encode:
- Two populations usually emerge — well-structured chain/epic beads (mostly fine, **don't churn**) and loose quick-captures (the mess). Spend your attention on the latter.
- **Shipped-but-open** is a text guess — VERIFY against code + git before trusting it.
- Scaffold-only bodies (`## Requirements` / `## Acceptance Criteria` stubs) read as non-empty to `--empty-description`; catch those by eyeballing the dump.

## Step 3 — Investigate the ambiguous

For every "maybe shipped" / "still valid?" bead, check the real env, not the bead text:

- code: grep the named handler/file/symbol; `git log --oneline -S '<marker>' -- <path>` finds the commit that added it.
- external/prod-only state (gitignored configs, deploy markers, on-host files) can't be verified from the repo — leave the bead open and note "external state, unverifiable from repo".
- delegate batch verification to a subagent when there are many, but re-validate the findings before acting on them.

## Step 4 — Apply the non-destructive fixes (directly)

- **Rewrite** stub/empty descriptions. PRESERVE any real owner content — restructure + enrich, don't discard. Heredoc keeps apostrophes safe:
  ```bash
  bd update <id> -t <bug|feature|task> -p <0-4> --parent <epic> \
    --acceptance "<observable outcome>" --body-file - <<'EOF'
  <multi-line description; add a DESIGN paragraph when the fix shape is known>
  EOF
  ```
- **Re-parent** orphans into their epic: `--parent <epic>`. Re-parenting to a CLOSED epic is fine — the data model stays correct even though `bd list` won't nest it visibly.
- **Re-prioritize**: parking/undefined → P3; real bugs/features keep P2; foundation → P1. Bump an epic to match its highest active child.
- **Un-defer** epics with active/ready children: `bd update <epic> --defer ""`.
- For the mechanical reparent/priority/undefer/defer fixes, `.claude/skills/board-audit/scripts/apply.sh` batches them safely: write the ops to a plan file (`reparent <id> <epic>` / `priority <id> <n>` / `undefer <id>` / `defer <id> <when>`), preview with `.claude/skills/board-audit/scripts/apply.sh --plan fixes.txt`, then `.claude/skills/board-audit/scripts/apply.sh --commit --plan fixes.txt`. (Rewrites stay manual — the heredoc above.)
- A bead you genuinely cannot scope (owner-only intent you can't decode) — DON'T invent. Write a PLACEHOLDER body marked `NEEDS OWNER DEFINITION` with candidate interpretations to confirm, set P3.

## Step 5 — Batch closures for confirmation

Collect every proposed close (shipped, duplicate, dead) into ONE list and present it with a reason per bead. For a duplicate, fold any unique content into the survivor first. `.claude/skills/board-audit/scripts/apply.sh closures closes.txt` (one `<id> <reason>` per line) prints the exact `bd close` commands for review — it never runs them. On owner confirm, run them:
```bash
bd close <id> -r "shipped PR #NN (<sha>) | duplicate of <id> | dead: <why>"
```

## Step 6 — Report

Summarize: structural problems found, changes applied (counts by kind), closures awaiting confirm, beads needing owner input. Flag that `HANDOFF.md` likely needs a refresh (`/handoff-update`) since priorities/next-up moved.

## Boundaries (pause for confirmation)

- **Confirm before any `bd close`** (CLAUDE.md Rules). Everything else (rewrite / reparent / repriority / un-defer) is reversible → apply directly.
- **Don't create new epics unprompted** — propose them in the report; epic creation is `/bead-new`'s job.
- **Don't churn intentional parking-lot deferrals.** Read the body: "OPEN option, not a commitment", owner-dated DEFER decisions, and "gated on X existing first" are deliberate — leave them deferred.
- **No secrets or sensitive data in bead bodies** (CLAUDE.md Rules) — don't paste credentials, tokens, or private data while rewriting.
