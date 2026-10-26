# ADR 0024 — Review-based baselines declined

- **Status:** accepted
- **Date:** 2026-10-26
- **Bead:** `shotwright-746.32.12`
- **Phase the decision landed in:** I

## Context

An external consumer withdrew A1/A2 into F1: approve a run, select it as the
default comparison baseline, record accept/deny verdicts per pair, and make
`--fail-on-change` depend on those verdicts. The README's old golden-diff wording
obscured the existing opt-in compare gate. [ADR 0022](0022-compare-verdicts-are-review-aid.md)
already chose measured compare verdicts for review and rejected an always-on
golden-baseline gate. W2 shipped A1/A2's `--ignore`, `--threshold`, and `--strict`
as refinements to that existing gate.

## Decision

Decline F1 as specified. shotwright compares chosen throwaway runs and leaves
baseline approval, persistent reviewer verdicts, and verdict-aware gating to
dedicated visual review products.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Chosen: compare explicit runs with an opt-in gate | Keeps runs disposable and the review flow local | Users choose and retain any run they want to revisit | — |
| Local `baseline` pointer and `verdicts.json` | Reuses the gallery and needs little initial UI or data | Requires durable run storage, verdict identity and conflict handling | F1's default selection and per-pair decisions grow beyond a simple pointer |
| Full review-based baseline service | Automatic Git-aware baseline selection and multi-reviewer approvals | Requires storage beyond CI artifact retention and a shared review system | Different product scope, as illustrated by Argos and Chromatic |

## Consequences

- `shotwright compare` accepts any two runs, including a downloaded run path.
  `--fail-on-change` remains opt-in, with `--ignore`, `--threshold`, and `--strict`
  controlling its measured-pair gate; it does not consult reviewer verdicts.
- F1 would need persistent verdicts, Git-aware baseline selection, storage beyond
  CI artifact retention, and a multi-reviewer UI. Those make output durable and
  conflict with the project's throwaway-artifact model.
- The strongest objection is that the gallery is already a review UI and a
  local `verdicts.json` would be small. Declining this path may push teams to
  upload potentially authenticated screenshots to a hosted service. Teams must
  decide whether that service's access and retention meet their needs.
- Revisit a named `baseline` pointer only if a second consumer asks for one.
  That trigger does not pre-approve F1's verdict workflow.

## Prior art and currency

Read 2026-10-26. [Argos baseline-build documentation](https://argos-ci.com/docs/learn/platform-fundamentals/baseline-build)
says it selects the latest approved build at the branch's Git merge base; its
[CLI package documentation](https://www.npmjs.com/package/%40argos-ci/cli)
documents `ARGOS_TOKEN=<project-token> npx @argos-ci/cli upload ./screenshots`.
[Chromatic's branching and baseline guide](https://www.chromatic.com/docs/branching-and-baselines/)
describes accepted, branch-specific baselines and Git ancestry.
[reg-suit](https://github.com/reg-viz/reg-suit/blob/master/README.md) syncs
expected images from a publisher, compares, publishes results, and can notify.
[Playwright `toHaveScreenshot`](https://playwright.dev/docs/test-snapshots)
uses reference screenshots for assertions;
[`expect.soft`](https://playwright.dev/docs/test-assertions) continues execution
after a failed assertion while marking the test failed.

## Reversal

This decision retains ADR 0022's opt-in compare gate. It clarifies that
computed compare verdicts do not imply managed baselines or reviewer approvals.
