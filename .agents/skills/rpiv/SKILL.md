---
name: rpiv
description: Detect which phase (Research / Plan / Implement / Verify) the active bead is in and run that phase with the right artifact shape. Use to keep work disciplined to the R/P/I/V pattern instead of conflating phases.
---

# rpiv

Autonomous within the phase; confirm at phase-exit (handing off to the next phase's bead).

> See the doc-format convention and `## Project config` in CLAUDE.md for artifact paths and verification commands.

## Phase detection

Read the active bead's title/phase tag (`R`/`P`/`I`/`V`). If the active bead has no phase (i.e. it's an epic), refuse and ask the user to pick or create the appropriate phase child via `bead-new`.

## Phase contracts

### R — Research
- **Kickoff (required, before deep research)**: identify the highest-leverage unknowns — constraints, host/hardware reality, the owner's existing preferences/biases, scope boundaries, and any assumptions baked into the bead's framing — and surface 1–3 of them via `AskUserQuestion` *before* investing in research. Directing the research early avoids rework; treat this as a critical step, not a courtesy.
- **Stance**: challenge the assumptions in the bead's framing — don't treat a pre-supplied option list as the whole decision space. Weight maturity and documentation/example depth as a hard selection criterion; bleeding-edge tools with thin docs must clear a high bar.
- **Artifact**: `docs/<bead-id>-research.md` — markdown. (HTML is reserved for docs that need interactiveness, e.g. uiux mockups.)
- **Sections**: Context, Options (≥2, with tradeoffs), Recommendation, Open questions. Render Options as a tradeoff table and flag the pick with a recommendation badge. Record the owner's kickoff answers in the doc.
- **Allowed tools**: Read, Grep, WebFetch, WebSearch, Explore subagent, AskUserQuestion.
- **Forbidden**: writing implementation code, committing migrations, modifying configs.
- **Review before exit**: self-review the draft against the **Self-review rubric** below and record each lens pass/flag in the doc. Optionally dispatch an independent reviewer (a subagent, or `/security-review` for a security angle) as a devil's advocate — treat findings as *leads to reproduce*, not verdicts, and calibrate them to this project's real threat model.
- **Exit**: research doc committed. If the owner-accepted recommendation settles a foundational/binding decision, author its ADR now (see Boundaries → "ADR at decision-time"). Propose creating/transitioning the matching `.P` bead.

### P — Plan
- **Artifact**: `docs/<bead-id>-plan.md` — markdown.
- **Sections**: Goal, Step list (each step ≤1 PR-sized chunk), Risks + rollback, Acceptance mapping (which step satisfies which acceptance bullet). Render the Acceptance mapping as a step→bullet table.
- **Pin the assumptions**: for every load-bearing design assumption (especially a Self-review-rubric flag — an `ESTIMATE`, a derived-value semantic, a concurrency claim), name the **deterministic pin** that will validate it — a benchmark, a test, or a schema constraint — and which step lands it. A design assumption must not survive un-pinned into code.
- **Allowed**: writing the plan doc, refining the matching `.I` and `.V` bead acceptance via `bd update`.
- **Forbidden**: writing implementation code; silently "pinning" a foundational component as a default. Any unresolved component/dependency selection must be recorded as a **decision needing owner sign-off**, not a placeholder that later hardens.
- **Review before exit**: self-review against the **Self-review rubric** (incl. that every load-bearing assumption has a named pin), recording pass/flag in the doc. Optionally run an independent reviewer over the plan for premature optimization, unearned lock-in, and not-truly-PR-sized steps.
- **Exit**: plan doc committed. If the plan pins a foundational/binding component (on sign-off), author its ADR now rather than deferring to epic close (see Boundaries → "ADR at decision-time"). Surface refined `.I` acceptance for sign-off.

### I — Implement
- **Artifact**: code + tests + migrations.
- **Working contract**: the matching `.P` bead's plan doc. Quote step numbers as you complete them.
- **Forbidden**: scope expansion not in the plan; if the plan is wrong, **stop**, update the plan doc, then resume. Also forbidden: silently resolving a plan **Open Question** or hardening a soft-default component choice into code — **stop and surface it** for sign-off first.
- **Land the pins**: each deterministic pin the plan assigned to a load-bearing assumption (benchmark / test / schema constraint) must actually exist in the diff. An assumption reaching code with no pin is an exit blocker, not a follow-up.
- **Exit**: tests green locally, lint clean. Hand off to `bead-finish` for verification + commit.

### V — Verify
- **Artifact**: `docs/<bead-id>-verification.md` (stays markdown — command transcripts).
- **Sections**: Acceptance checklist (each bullet ticked or explained), Commands run (verbatim + truncated output), Observations, Sign-off.
- **Allowed**: running tests, manual UI/API exercises, reading logs.
- **Forbidden**: fixing bugs in V — bugs found during V become new beads or reopen `.I`.
- **Boundary with `bead-finish`**: this phase *produces* the verification evidence; `bead-finish` *consumes* it (cites this doc, re-running commands only to confirm still-green). Do the acceptance walk-through here, not twice.
- **Exit**: verification doc committed, parent epic eligible for close.

## Self-review rubric (run on your OWN draft, before the R/P review)

The gap that slips past a design-doc first draft is **under-specification + asymmetric rigor**: an un-grounded claim (an un-benchmarked number, an undefined derived value) sitting next to genuinely-grounded ones, where the nearby rigor *launders* the gap's credibility. A coherent doc *feels* complete; the gaps are exactly what doesn't break the narrative — so the author is worst-placed to see them. Self-check the draft against these five lenses and record each as pass/flag in the doc (a flag is fine — naming it defuses the laundering). This shrinks what a reviewer must rediscover; it does not replace one.

1. **Measured-or-flagged** — every quantitative/scale claim is backed by a measurement, or explicitly tagged `ESTIMATE (unverified)`. No bare number rides next to a benchmarked one.
2. **Derived-value semantics** — every stored/derived value has its meaning defined in the aggregate/edge case (multi-row, empty, NULL), not just the happy path.
3. **Emergent structure** — for each data structure chosen, its emergent properties are enumerated (ordering, cardinality, connectivity), not inferred from a proxy.
4. **Batch/concurrency** — every batch job or mutation specifies transactionality, atomic publish, and concurrency/serialization.
5. **Inherited-constraints-grounded** — every constraint carried in from another doc/bead/ADR is verified *implementable against the real schema/code*, not accepted as settled.

Keep it SHORT — an ignored semantic guard is worse than none. In P, each flag becomes a **deterministic pin**; in I, that pin lands (see the P/I contracts).

## Boundaries (pause for confirmation)

- Phase transitions (R→P, P→I, I→V).
- Modifying acceptance criteria on any bead.
- Creating new beads as a side effect of the current phase.
- **Touching a file shared beyond this bead's scope** (shared infra, config, a sibling
  worktree's surface). Read its current state on this branch first (`git show <branch>:<path>`)
  — a parallel branch may have set a direction yours would silently contradict.
- **Selecting or swapping any foundational component/dependency** (reverse proxy/web server, database, queue, language/framework, base image, auth model, TLS strategy). Surface the choice **and its rationale** for sign-off before baking it in, even mid-Implement.
  - **ADR at decision-time:** the moment such a decision is *signed off*, author or refresh its ADR (`docs/adr/<NNNN>-<slug>.md`, copy `docs/adr/0000-template.md`) capturing the decision + alternatives weighed + any reversal — in the same phase it lands (R recommendation, P pin, or the I moment a soft-default would otherwise harden), **not** retroactively. This decision-time write is the *primary* ADR trigger; the `/bead-finish` epic-close gate is only a backstop. A scoped, reversible choice (one endpoint's response shape) earns no ADR — document it in the phase doc instead.
