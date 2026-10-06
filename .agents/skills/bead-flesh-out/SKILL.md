---
name: bead-flesh-out
description: Turn a barely-formed idea bead (empty / stub / scaffold-only description) into a properly specified bead by interviewing the owner with clarifying questions, then writing the description, acceptance, type, priority, and epic home. Use when the owner has dumped a half-baked idea on the board (a one-line feature, an empty bug stub) and wants it fleshed out before it becomes actionable.
---

# bead-flesh-out

**Interactive.** The owner dropped an idea on the board with little more than a title; your job is to **ask the questions** that turn it into an actionable bead — **NOT to invent the scope yourself**. Only the owner knows what a cryptic one-liner means. Pull what context you can from the repo first, then ask the owner only what you genuinely can't infer.

> Read the `## Project config` block in CLAUDE.md for the bd umbrella and any prefix/epic scheme documented there.

## When to use vs neighbors

- **`/bead-flesh-out`** — flesh out an EXISTING stub via owner interview (this skill).
- **`/board-audit`** — grooms the WHOLE board (reparent / repriority / rewrite from context, batch closures). It rewrites the stubs it *can* infer; it hands the ones needing owner input — the bodies it marked `NEEDS OWNER DEFINITION` — to THIS skill.
- **`/bead-new`** — CREATE new beads/epics from a concept that's already understood.

## Step 1 — Pick the target(s)

- Named: `/bead-flesh-out <id>` → that bead.
- Unnamed: find the stubs — `bd list --empty-description --flat`, plus eyeball `bd list` for scaffold-only bodies (empty `## Requirements` / `## Acceptance Criteria` / `## Steps to Reproduce`), one-line dumps, and any body flagged `NEEDS OWNER DEFINITION` by a prior `/board-audit`. Confirm which to flesh out — don't batch more than a few per session; interviews are owner-attention-heavy.
- `bd show <id>` — read whatever scraps exist (title, type, half-written body, labels, parent).

## Step 2 — Gather context BEFORE asking

Don't ask what the repo already answers. Clarify early, but ask the load-bearing unknowns, not everything. For each idea:

- Guess the subsystem/epic from the title + labels. Use `bd ready` / `bd list` (and `bd children <umbrella>`) for the live epic set to find the likely home.
- Grep the code for the surface the idea touches, so your questions are concrete (e.g. "today X has modes A/B/C — does this replace those or add one?").
- Note analogous shipped beads to anchor scope.

## Step 3 — Interview (the core)

Use `AskUserQuestion` — structured options where the space is knowable, free-form ("Other" is always offered) where it isn't. **Pre-fill your best guess as the first option and ask the owner to confirm/correct**, rather than asking open-ended. Cover the bead anatomy, batched (≤4 questions per call, multiple calls if needed):

1. **Problem / motivation** — what's the pain or goal behind this? (the *why*)
2. **Desired behavior** — what should it do; what does "done" look like to you? Offer concrete behavior sketches as options when you can.
3. **Scope edges** — what's explicitly OUT / must-not?
4. **Home + shape** — which epic/subsystem; type (bug / feature / task); is this ONE bead or epic-sized?
5. **Priority** — P1 foundation / P2 daily-use / P3 nice-to-have.
6. **References** — any example site / app / screenshot to study?

Challenge baked-in assumptions: if the owner's framing smuggles in a solution, surface the underlying need before locking the shape.

## Step 4 — Synthesize + confirm + apply

Draft the bead from the answers:
- **Description**: problem → desired behavior → scope (in / out) → references. Add a DESIGN paragraph only if a concrete fix shape emerged.
- **Acceptance**: an observable outcome (what's true when done), not a task list.

Show the draft. On owner OK, apply — author the body via `--body-file` (a temp file
written with the Write tool), not a long inline `--description` a backtick would truncate;
then `bd show <id>` to confirm it landed intact. Rationale: `/beads-task-manager` →
"Multi-line field updates".

```
bd update <id> -t <bug|feature|task> -p <0-4> --parent <epic> \
  --acceptance "<observable outcome>" --body-file <tmpfile>
```

If it turned out **epic-sized**, DON'T cram it into one bead — record the decision on the stub and invoke **`/bead-new` epic** to scaffold the epic + R/P/I/V children instead.

## Boundaries (pause for confirmation)

- **DON'T invent scope the owner hasn't given** — that defeats the skill. If the owner can't answer yet, the right output is a body marked `NEEDS OWNER DEFINITION` with the candidate interpretations you offered, left for a later pass.
- **Reversible only:** `bd update`. No `bd close` without confirm (CLAUDE.md Rules) — fleshing out an idea doesn't kill it.
- **Don't over-interview:** infer what's inferable from the repo; ask only the load-bearing unknowns. A 6-question grind on a P3 nice-to-have is worse than a focused 2-question pass.
- **No secrets or PII** in bead bodies.
