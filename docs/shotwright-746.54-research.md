# shotwright-746.54 — CI workflow pin skew research

- **Date / external sources read:** 2026-10-29
- **Phase:** R
- **Goal:** Make a consumer aware when its checked-in reusable-workflow release tag differs from the installed Shotwright CLI version, and give a safe, concrete fix.

## Context and premise check

The reported `0.5.0` versus `@v0.4.0` example is a historical observation, not the current repository version: `package.json` is `0.6.0` and the packaged caller template pins `@v0.6.0` (`package.json:3`; `templates/github/shotwright.yml:12-17`). The **gap remains**. `init` builds a template, plans `.github/workflows/shotwright.yml` at the Git root, and classifies *any* existing different file as “differs from the template, as expected”; dry-run renders that under “Would leave alone (yours)” (`src/init.ts:274-292,323-330,453-469,405-417`). It does not interpret the caller's `uses:` ref before reporting it (`src/init.ts:453-469`). The installed CLI can obtain its own package version from its adjacent `package.json`, and `--version` already uses that value (`src/version.ts:10-24`; `src/cli.ts:967-972`). The release process separately keeps the *packaged template* pin aligned with `package.json`; that does not update a consumer's already copied file (`scripts/sync-template-pin.mjs:2-15,28-59`; `src/init.ts:453-469`).

This is a warning about **configuration skew**, not proof that a CI run resolved a different binary. The reusable workflow installs from the consumer's lockfile and then invokes its package manager's local `shotwright run` (`.github/workflows/shotwright.yml:119-132,182-190`). Its older YAML can therefore drive the installed newer CLI. Conversely, a matching tag does not establish that the lockfile or the executed workflow commit matches; the warning must describe only what it actually compared. The design calls CI an artifacts-only integration, and the consumer template deliberately pins a release tag (`docs/design.md:34-37,143-150`; `docs/adr/0007-ci-reusable-workflow-same-owner-private.md:83-89`).

The current `init` contract accepts `--dry-run` and `--package-manager` and routes both through the same plan and formatter (`src/init.ts:84,107-123`; `src/cli.ts:955-964`). This gives a place for a diagnostic that appears in both normal and dry-run output, including when no file would change. No new invocation surface is needed.

## Prior art and current practice

All external claims below were checked on **2026-10-29**.

| Source | Current practice and relevance |
|---|---|
| [GitHub reusable-workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) | A public reusable workflow can be called by SHA, release tag, or branch. The called workflow's `github` context is associated with the **caller**. Thus `github.workflow_ref` inside the callee is not its own pin. |
| [GitHub contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) | GitHub now documents `job.workflow_ref` as the full ref of the file defining the current job, including a called reusable workflow; `job.workflow_sha` is its resolved commit. These `job.workflow_*` properties are unavailable on GitHub Enterprise Server. A callee-side check is technically possible on GitHub.com, subject to an integration test of its exact tag formatting. |
| [GitHub OIDC reusable-workflow guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-with-reusable-workflows) | The OIDC claim `job_workflow_ref` also names the callee; obtaining a token solely for this warning would add unnecessary permissions and machinery. It is distinct from the `job` context property. |
| [GitHub Dependabot version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates) and [configuration guide](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions) | Dependabot can update reusable-workflow Git refs and opens reviewable PRs when `github-actions` updates are enabled. It tracks the workflow dependency independently from npm, so this is update automation, not a guarantee of equality with the installed package. |
| [Renovate GitHub Actions manager](https://docs.renovatebot.com/modules/manager/github-actions/) | Renovate explicitly extracts job-level reusable-workflow `uses:` as dependency type `workflow`; SHA pins with version comments can be updated, while a bare SHA has no version context by default. This supports leaving update edits to established dependency bots or a human review, rather than making `init` a YAML rewriter. |
| [GitHub Actions workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) | `::warning::` creates a CI annotation if a later CI-side check is chosen. |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | A backward-compatible public feature is a minor version change once at 1.x; pre-1.0 rules are less prescriptive. This informs the release recommendation below. |

**Currency caveat:** `job.workflow_ref` is documented now, but the GitHub.com docs do not demonstrate Shotwright's exact tag call yielding `@refs/tags/vX.Y.Z`. Do not silently infer that formatting without a real reusable-workflow run. The local `init` route needs no GitHub runtime context.

## Options

| Option | Advantage | Cost / edge cases | Decision |
|---|---|---|---|
| **A. Warn from `init` for a recognizable Shotwright release tag** | Existing command, offline, both dry-run and regular output; sees the file that the consumer will edit; no workflow permission or input. | Only runs when invoked; deliberately lagging consumers see the warning on repeated `init` calls. | **Recommended** |
| B. Warn on every `run` | Visible during ordinary local capture even if no one reruns `init`. | Adds Git-root/workflow parsing to the hot path; many captures yield repeated noise; a valid local run may intentionally use a different CI policy. `run` already resolves the consumer's runner separately (`src/cli.ts:3-8`; `docs/design.md:90-98`). | Decline initially. |
| C. Add `doctor` / `check` command | Explicit audit entry point, potential future checks. | Permanent CLI API and a command users must remember; duplicates the `init` opportunity (`src/cli.ts:980-991`). | Decline until multiple real diagnostics justify it. |
| D. Warn in the reusable workflow | Every GitHub run can see its own `job.workflow_ref` and installed CLI; could annotate CI. | Old pinned workflow versions cannot gain the new check until the consumer bumps the pin, precisely the reported case. GitHub Enterprise Server lacks `job.workflow_*`; adding a step changes CI YAML (`.github/workflows/shotwright.yml:57-64,119-132`). | Cannot solve first discovery; consider later as reinforcement. |
| E. Have `init` bump the pin on request | Convenient one-step repair. | New flag and YAML mutation semantics become permanent; risks changing forks, SHA pins, comments, multiple jobs, or a consciously older CI interface. Existing `init` preserves modified managed files (`src/init.ts:453-469`). | Decline for first release. |

## Recommendation

Add a **non-failing warning to `init`**, emitted in normal and dry-run output when an existing Git-root `.github/workflows/shotwright.yml` has a job-level `uses:` of the canonical `hestonhamilton/shotwright/.github/workflows/shotwright.yml@v<full-semver>` and that tag differs from `shotwrightVersion()`. Show the observed tag, installed version, file path, and exact suggested `@v<installed-version>` replacement; tell the user to review workflow release changes before editing. Keep the exit status and file contents unchanged. The reason is visible in the current `init` output behavior (`src/init.ts:405-417,453-469,687-690`) and version source (`src/version.ts:16-24`). A warning for *any* unequal release tag is clearer than “lags” only: a newer tag paired with an older installed CLI is also skew. Wording should say “differs” rather than assert which code actually ran.

Use a small, guarded parser that examines `jobs.*.uses` in this one workflow path and rejects ambiguous shape. A line regex over all `uses:` would also see step actions; blindly replacing a textual match would be unsafe. The existing template has exactly one job-level call (`templates/github/shotwright.yml:10-17`), while `init` currently handles the entire file as user-owned once changed (`src/init.ts:453-469`). Implementation can choose a YAML parser if it is already a direct, supported dependency; if adding one just for this check, a deliberately narrow recognizer with tests and a “cannot determine” result is preferable to a false claim. Do not traverse arbitrary consumer files or reach the network. If multiple matching caller jobs exist in the known file, report each location once; if parsing is ambiguous, give no skew verdict and preserve `init`'s existing left-alone report. The plan phase should pin the parser choice and exact output through tests.

Comparison policy: compare the full release tag (`v0.6.0`, including prerelease if supported) to the installed CLI's exact version. For a canonical tag and valid installed version, equal means no warning; unequal means warning, regardless of direction. A SHA or `@main` cannot be ordered against the package version offline. A forked owner/repo has its own release policy, so do not recommend changing it to the upstream tag. A local caller, malformed ref, mixed candidates, or no caller should not produce a false skew assertion. A deliberately lagging consumer keeps control and receives a warning only when it chooses to run `init`; no suppression config or flag for this first release. Tests should cover dry-run, normal init, equal/older/newer tags, missing file, SHA, branch, fork, multiple jobs, and deliberate unchanged content. The `init` tests already exercise the managed workflow and dry-run reporting (`test/unit/init.test.ts:302-347`).

**Alternative if owner prefers broader coverage:** an informational non-failing CI annotation can compare `job.workflow_ref` with the installed binary *after install*, but it helps only callers already updated to a version containing that step. It also needs a live GitHub.com test of `job.workflow_ref` on a tagged reusable call. An update bot is the mature opt-in automation route: it proposes a reviewable workflow-ref PR, though its schedule and npm updates may produce temporary skew (GitHub Dependabot and Renovate sources above, read 2026-10-29).

## Binding surface and release impact

Recommended choice adds **no new CLI flag or command, config or manifest field, workflow input, or published export**. It changes the user-visible text of the existing `init` command; the warning is informational and exit code remains as before (`src/init.ts:687-690`; `src/cli.ts:955-964`). Under ordinary SemVer guidance, this is a backward-compatible feature and merits a **minor release**; because the package is currently `0.6.0`, propose the next `0.7.0` unless the owner's release convention batches it differently (`package.json:3`; [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html), read 2026-10-29). Adding an opt-in bump flag or a new command would also be a public CLI addition and should receive its own explicit release decision. No workflow input is justified.

## ADR decision

**No ADR warranted now.** This is a scoped diagnostic in an existing command, with no foundational dependency, storage contract, or workflow input. ADR 0007 already records why the generated caller pins a release tag (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:83-89`). The recommendation does not reverse it. No ADR number was reserved or draft written; the highest current file is `docs/adr/0026-ci-artifact-upload-policy.md` (`docs/adr/0026-ci-artifact-upload-policy.md:1-4`). If the owner instead selects automatic mutation or a binding CI policy, reconsider an ADR at that decision point; **0027** was the next free number observed on this branch on 2026-10-29, and parallel lanes must recheck before using it.

## Open questions for the owner

1. Accept the narrow `init` warning for canonical release tags, including both older and newer unequal tags, with no suppression? This is the recommended scope. A deliberately older caller remains supported operationally; the warning can be ignored.
2. Is repeated `init` warning noise in intentional-lag consumers sufficient evidence to justify a suppression setting later? Current evidence is one adoption report, so recommend waiting.
3. Is there evidence of frequent hand edits that warrants an opt-in `init` pin bump later? Recommend manual one-line edit or Dependabot/Renovate PR now; automatic mutation would need explicit behavior for forks, SHA pins, multiple callers, and comments.

## Considered and declined

- Do not call every file differing from the template “outdated”; consumer-owned workflow edits are expected (`src/init.ts:453-469`). Only a parseable canonical release tag supports the skew claim.
- Do not rewrite SHA or branch refs, fetch GitHub tags, or compare a fork to the upstream npm version. GitHub accepts those refs as intentional choices ([reusable-workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), read 2026-10-29).
- Do not introduce a failing CI gate for a review-artifact tool. The project's CI and comparison philosophy is advisory unless opted in (`docs/design.md:34-37,143-150`; `docs/adr/0022-compare-verdicts-are-review-aid.md:1-20`).
- Do not infer the callee ref from `github.workflow_ref`; GitHub associates the `github` context with the caller ([reusable-workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), read 2026-10-29). `job.workflow_ref` is the correct documented callee context on GitHub.com ([contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), read 2026-10-29).

## Research self-review

| Lens | Result |
|---|---|
| Measured or flagged | Pass: no scale or frequency estimates; the single adoption report is the evidence base. |
| Derived-value semantics | Pass: equality, older/newer, unknown ref, fork, and multiple caller semantics are explicit. Actual CI execution equivalence is not claimed. |
| Emergent structure | Pass: known file path and `jobs.*.uses` cardinality are explicit; no repository-wide search is assumed. |
| Batch / concurrency | Pass: recommendation makes no writes or network calls, so no transaction or serialization contract is introduced. |
| Inherited constraints grounded | Pass: `init` output, template pin, package version, and workflow runner were checked against current lines above. GitHub.com `job.workflow_ref` formatting remains a flagged live-test item only for the declined CI option. |

## Local verification note

`pnpm install --frozen-lockfile` was attempted first because this worktree lacks `node_modules`; pnpm exited before installation with `ERR_SQLITE_ERROR: unable to open database file` in its configured store. No implementation or tests were run in this research-only phase. No source, test, workflow, or template file was edited.

## Redteam amendments (2026-10-29)

A redteam returned "proceed with changes". Adopted:

1. **Warn only for jobs that target the current package (fix now).** A caller job can set `with.working-directory` to another package, and the reusable workflow installs and runs from there (`templates/github/shotwright.yml:21`; `.github/workflows/shotwright.yml:61`). In a monorepo, `init` in package A must not suggest changing package B's valid pin. Resolve each job's target package; warn only when it is the package `init` runs in; treat an unresolved target as unknown and say nothing. Label the comparison as the version of the CLI running `init`.
2. **One rule for several jobs.** Evaluate each eligible job independently once its target package is known. Suppress only a job whose own identity (fork, SHA pin, non-release ref) or target is ambiguous; a canonical caller beside a fork caller is still checked.
3. Automatic pin bumping stays out of scope with no bead. The proposed 0.7.0 is a release proposal; SemVer does not require it for a pre-1.0 package. External sources were re-checked 2026-10-29.
