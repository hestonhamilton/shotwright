---
name: gen-agent-prompt
description: generate a self-contained agent prompt file for a beads task so an agent can execute it without the full conversation.
---

# gen-agent-prompt

Autonomous within the prompt; confirm before writing prompts for beads outside the named/ready set.

> Read the `## Project config` block in CLAUDE.md first — it defines the branch prefix, bd umbrella, and verification command this skill references.

Write a `.agents/prompts/<bead-id>.md` file that lets a research or implementation
agent execute a bead without the full conversation context. The prompt carries its own
research summary, precise spec, and a mandatory "When Done" block.

## When to apply

- User names a bead: "write a prompt for <bead-id>".
- User asks for the next unblocked bead's prompt, or to continue after one closes.

## Step 1 — Identify target bead(s)

If named, use it. Otherwise `bd ready` and pick the lowest available R/P/I/V phase.
Skip epics; work only on leaf beads. To run **several** beads concurrently, don't
hand-pick a set here — defer to `/parallel-dispatcher`, which selects a
collision-free (disjoint-write-surface) set and calls this skill per bead.

## Step 2 — Load bead context

For the target and every dependency: `bd show <id>`. Read the description, acceptance,
deps, and phase. Then pull each dependency's notes — `bd note`/the NOTES section of
`bd show <dep-id>` is where prior R/P agents record findings, and it is the source of
truth for the prompt's "Prior Research Summary". Do not paraphrase away concrete values
(slugs, algorithms, field names, counts, exact strings).

## Step 3 — Read only necessary code

Read only code the agent will touch or must match: the schema for an entity, one or two
existing files of the same pattern, the exact signature of a utility it will call. Read
narrow; expand only if a specific gap appears. Do not read the whole codebase.

## Step 4 — Write the prompt file

Path: `.agents/prompts/<bead-id>.md`.

Structure (adapt sections to the bead's phase):

```markdown
# {Phase} Agent Prompt — {Title} ({bead-id})

You are a {research/implementation/verification} agent. Your job: {one sentence}.
Work on branch `<BRANCH_PREFIX><bead-id>-<slug>` (create it if absent).

Read prior research first:
{bash: bd show <dep-id> for each dependency}

## Prior Research Summary
{Distilled dependency notes — specific values, algorithms, field names, counts. Precise.}

## What to Build / What to Research
{Concrete spec: file paths, function signatures, steps. For R: questions, sources, output shape.}

## Acceptance Criteria
- [ ] Verifiable checklist items (copied/tightened from the bead)
- [ ] Verification command passes (see `## Project config`) — implementation beads

## Notes
{Non-obvious decisions, intentional exclusions, likely failure modes.}

## When Done   (MANDATORY)
{bash: verify against acceptance, then hand off to /bead-finish — commit (no co-author),
push, close/hand off. Do NOT skip this block.}
```

## Writing rules

- **Prior Research Summary must be specific.** Copy exact values from dependency notes;
  vague summaries make agents guess and produce wrong output.
- **File paths and function signatures are exact** — copy from schema/existing code.
- **Do not invent scope.** If the bead says "out of scope: X", the prompt must not spec X.
  If you spot a misalignment with the bead's framing, surface it as a **Note**, don't
  silently change the spec.
- **One level deep.** Every prompt must instruct the agent to do the work directly and
  **not** spawn its own sub-agents, so cost and progress stay observable.
- **The "When Done" block is mandatory** and routes through `bead-finish` for the
  verify/commit/push/close discipline (no `Co-Authored-By` trailers). Without it agents
  skip the close/push step.

## Step 5 — Confirm and offer next

Report the path(s) written. Run `bd ready` and, if new beads unblocked, ask whether to
continue or wait for the current bead to close.

## Boundaries (pause for confirmation)

- Writing prompts for beads outside the named or ready set.
- Any `bd close`, `git push`, or PR open (the agent executing the prompt handles these
  via `bead-finish`).
