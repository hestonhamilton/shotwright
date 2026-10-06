# 6. shotwright flags are recognized after `--`, and init output derives from one outcome value

Date: 2026-07-30
Status: accepted
Bead: `shotwright-746.6.3`
Phase the decision landed in: I

## Context

Two defect families recurred across every phase of E6 — ten defects in total —
and both were being repaired instance by instance rather than at the cause.

**Family A — the `--` collision (4 defects).** `shotwright run` treats `--` as
its Playwright passthrough boundary (`src/cli.ts:49-51`). `pnpm run <script> --
<args>` forwards the **literal** `--` into the script command (measured, pnpm
10.13.1; `docs/shotwright-746.6.1-research.md` §2). So the separator a pnpm user
reaches for by reflex is exactly the token that takes shotwright's own flags
away from shotwright. It produced a wrong command in a merged verification doc
(`shotwright-746.9`) and three more in the E6 plan draft — including one on the
epic's acceptance path. Documentation was tried first (research §2), then a
runtime warning (E6.I). Both are mitigations that leave the trap in place: the
user still has to know the rule, and four separate artifacts written by people
holding that rule still got it wrong.

**Family B — init output incoherence (6 defects).** `init`'s headline, body
sections, notices, and exit code were each derived independently from the plan
by separate string builders. Nothing tied them together, so each new state was a
fresh opportunity for two views of the same state to disagree: a headline saying
`updated scaffold` when zero files were written; `+4 entries` for three ignore
patterns; a failed action listed as `Not attempted`; next steps telling a
non-vite consumer to run a command their config cannot yet satisfy; an
indentation notice for a file explicitly left unchanged; `already set up —
nothing to change` printed directly above `Needs your review`.

Every one of Family B is the same shape. That is a structural property, not six
coincidences, and example-based tests only ever cover the states someone
remembered to enumerate.

## Decision

**A. shotwright's own flags are recognized wherever they appear, including
after `--`.** `--only` and `--video` are reclaimed from the passthrough with a
warning, so the form users naturally type does what they obviously meant.

`--trace` is deliberately **excluded from unconditional reclamation**, because
Playwright genuinely has `--trace <mode>` (verified: `playwright test --help`
lists `--trace <mode>` with choices `on`/`off`/…). After `--`, `--trace`
followed by a Playwright trace-mode value stays passthrough — the user meant
Playwright's; a bare `--trace` is reclaimed as shotwright's boolean, with a
warning. Playwright has no `--only` (only `--only-changed`) and no `--video`, so
those two carry no such ambiguity.

**B. `init`'s user-visible output derives from a single `InitOutcome` value.**
One discriminated union is computed once from the plan and result; the headline,
the next-steps list, and the exit code are all total functions of it. Adding a
state without handling it everywhere is a compile error, not a wrong sentence.
Notices are attached to the action that justifies them, so a notice cannot
outlive the write it describes.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| A (chosen): reclaim shotwright flags after `--`, carve out ambiguous `--trace` | Removes the trap; documented contract unchanged; wrong form still does the right thing | A Playwright flag sharing a shotwright name could never be forwarded | — |
| Warning only (previous E6.I behaviour) | Simple, honest, no contract change | Trap remains; four artifacts already fell in while their authors knew the rule | Mitigation, not a fix |
| Documentation only | Zero code | Already failed, repeatedly and measurably | Disproven by this epic |
| Replace `--` with `--pw-args="…"` | Eliminates the collision outright | Breaking change to a published CLI contract; abandons a near-universal Unix convention | Cost exceeds the problem |
| B alternative: keep ad-hoc builders, add more tests | No refactor | Tests only cover remembered states; six defects escaped exactly that way | Treats symptom |

## Consequences

- **Easy:** the wrong-but-natural invocation now works. A new init state cannot
  ship with a headline, next-steps list, and exit code that disagree — the type
  checker refuses it. One table-driven coherence test replaces the accumulated
  example tests.
- **Hard / accepted:** shotwright's flag names are now effectively reserved
  against Playwright's. If Playwright ever adds `--only` or `--video`, consumers
  could not forward them, and this ADR would need revisiting. `--trace`'s
  carve-out means one flag behaves differently from its siblings after `--` —
  the inconsistency is deliberate and must stay documented in the generated
  `SKILL.md`.
- **Future work must not silently undo:** the derivation of headline / next
  steps / exit code from a single outcome value. Reintroducing an independently
  computed headline restores Family B wholesale. Likewise, adding a new
  shotwright flag requires checking it against `playwright test --help` for a
  name collision before it is reclaimed after `--`.

## Reversal

Does not supersede an earlier ADR. It does supersede the *approach* recorded in
`docs/shotwright-746.6.1-research.md` §2 and `docs/shotwright-746.6.2-plan.md`
§0, both of which treated the `--` collision as a hazard to document and warn
about. That reasoning stopped holding when the defect recurred three more times
inside the very artifacts written to prevent it — including the plan whose own
§0 states the rule. A rule that its own authors cannot follow is a design
problem, not a documentation problem.
