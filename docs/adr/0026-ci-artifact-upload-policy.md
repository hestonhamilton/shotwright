# ADR 0026 — CI artifact upload policy is selectable with short retention

- **Status:** accepted
- **Date:** 2026-10-29
- **Bead:** `shotwright-746.62`
- **Phase the decision landed in:** R (owner decision 2026-10-29, after redteam)

## Context

The reusable workflow currently uploads every resolved run directory, including failed runs, for seven days by default (`.github/workflows/shotwright.yml:34-37,179-202`). The consumer template triggers on PRs and manual dispatch (`templates/github/shotwright.yml:3-5`). This is a material cost for private consumers and a change to the artifacts-only CI contract (`docs/design.md:34-37`). Evidence and alternatives are in [`shotwright-746.62` research](../shotwright-746.62-research.md).

## Decision

Add a `workflow_call` string input `upload` with `always`, `on-failure` and `never`; reject other values. **The reusable default stays `always`, and `retention-days` stays 7**, so existing callers see no change when they bump their pinned tag (owner decision 2026-10-29). The generated caller template selects `on-failure` with `retention-days: 2` for pull requests and `always` for manual dispatch; self CI sets its policy explicitly.

`on-failure` is tied to the shot step's own outcome, not to `failure()`: upload when the `Run shotwright` step failed, the run was not cancelled, and a run directory resolved. A directory without a published `manifest.json` is still uploaded as diagnostic evidence, but the job summary labels it incomplete and does not call it a reviewable run or gallery. Upload remains a GitHub artifact, and no mode gates on image differences.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| **A (chosen): three modes, `always` default, template opts PRs into `on-failure` with 2-day retention** | Backward compatible for existing callers; new consumers get the lean policy through the template | A hand-written caller that omits the input keeps today's storage use | — |
| B: three modes, `on-failure` default, two-day retention | Lowest storage without caller action | Silently drops passing-run artifacts for every existing caller on upgrade, and gains nothing for template callers, which set the mode explicitly | Behaviour break with no benefit for generated callers |
| C: never default | Lowest storage | Failed evidence disappears without caller action | Weakens artifacts-only CI |
| D: retention only | No new workflow input | Cannot suppress frequent green uploads | Does not address run frequency |

## Consequences

- A new workflow input is a permanent copied API. The actual consumer need meets ADR 0007's bar for this cost (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:24-26,73-77`).
- A failed shot run keeps its gallery when publication succeeds; if gallery publication fails, the remaining run evidence can still upload (`src/reporter.ts:167-186`; `.github/workflows/shotwright.yml:179-202`). A setup failure before run creation has no artifact.
- A green PR produces no GitHub run artifact under the generated template; callers that omit `upload` keep uploading every run. Reviewers can use manual dispatch, an explicit caller override, or a local run. The shot result remains independent of upload policy.
- The current zipped run remains the primary artifact. A separate browser-viewable gallery needs a pushed experiment before adoption; `archive: false` accepts one file, so it cannot replace the directory upload.

## Reversal

This **amends** ADR 0007's input-surface decision because an actual private consumer has an upload-frequency problem that retention alone does not solve (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:42-44,73-77`). It does not reverse the project's artifacts-only philosophy (`docs/design.md:34-37`) or ADR 0025's deferred off-GitHub storage decision (`docs/adr/0025-off-github-run-storage-is-an-opt-in-s3-compatible-publish.md:18-45`). Revisit the default if upgraded callers demonstrate a need for every green-run artifact or the two-day window proves too short.

## Prior art and currency

All external sources read 2026-10-29.

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions): private storage allowances, shared Actions/Packages storage, and hourly GB-hour accrual.
- [actions/upload-artifact README](https://github.com/actions/upload-artifact) and [v7.0.2 release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2): retention and direct-upload behavior; the repo pins v7.0.2 (`.github/workflows/shotwright.yml:194-202`).
- [GitHub's 2026-02-26 direct-artifact changelog](https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/): one-file browser viewing, including mobile; this gallery's inline script, CSP, and large-file behavior remain unverified.
- [Apache Fineract reusable workflow](https://github.com/apache/fineract/blob/develop/.github/workflows/run-integration-test-sequentially-postgresql.yml): concrete precedent for a failure-default artifact upload with a boolean input for green runs; the proposed three-mode input additionally allows `never`.
