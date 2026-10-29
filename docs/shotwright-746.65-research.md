# shotwright-746.65 — GitHub Releases for published versions (Research)

- **Date / external sources read:** 2026-10-29
- **Scope:** Research only. No release, tag, workflow, or bead state was changed.
- **Owner direction at kickoff:** The task specifies post-publish GitHub Releases, notes matching the version's `CHANGELOG.md` section, an unchanged tag-protection and template-pin contract, and backfill of `v0.6.0` only. No further preference was supplied.

## Context and premise check

Shotwright already uses Changesets to open a reviewed Version PR, but deliberately does not use `changeset publish`; a human dispatches the separate trusted-publishing workflow ([ADR 0012, lines 22–26](adr/0012-release-tooling-changesets-and-gitleaks.md); [version workflow, lines 1–15](../.github/workflows/version.yml)). The release workflow has exactly two jobs: read-only `build`, then OIDC-capable `publish`, which has no repository checkout or `contents: write` permission ([release workflow, lines 11–30](../.github/workflows/release.yml), [107–117](../.github/workflows/release.yml), [284–303](../.github/workflows/release.yml)). Its last step is `npm publish`; it has no GitHub Release step ([release workflow, lines 373–384](../.github/workflows/release.yml)).

The runbook tags the published commit *after* the real publish, protects `refs/tags/v*` against update and deletion, and verifies that the Version PR changed the reusable-workflow template pin ([runbook, lines 390–437](release-runbook.md)). The template currently pins `@v0.6.0`; its comments tell consumers to update the tag when they upgrade the npm package ([template, lines 10–17](../templates/github/shotwright.yml)). The pin synchronizer derives that tag from `package.json`, not from GitHub Releases ([pin synchronizer, lines 28–59](../scripts/sync-template-pin.mjs)). A GitHub Release therefore adds a discoverable release page and notes, but does not change what a consumer executes.

The checked-in changelog has a `## 0.6.0` section with Minor and Patch Changes and a following `## 0.5.0` boundary ([CHANGELOG, lines 1–19](../CHANGELOG.md)). Read-only checks on 2026-10-29 found the local `v0.6.0` tag points to a commit whose `package.json` says `0.6.0`; GitHub's tags API returned a tag ref, the releases list was empty, `releases/latest` returned 404, and the npm registry returned `shotwright@0.6.0`. These observations support the bead's premise; the repo-local evidence for the missing creation path is above. The GitHub API distinguishes releases from bare tags in its [release listing documentation](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28) (read 2026-10-29).

The design requires review artifacts and thin consumers ([design, lines 25–38](design.md)); this change concerns package release metadata rather than shot output. The run `latest` invariant and manifest/publication semantics ([design, lines 71–87](design.md)), screenshot bytes, gallery format, and consumer Playwright resolution are outside this decision.

## Prior art and current practice

All linked external documentation in this section was read **2026-10-29**. These are current documentation and source snapshots, not assumptions about future behavior.

| Tool or practice | Current evidence | Fit here |
|---|---|---|
| GitHub CLI | [`gh release create`](https://cli.github.com/manual/gh_release_create) accepts `--notes-file`, `--verify-tag`, `--prerelease`, and `--latest=false`. Without `--verify-tag`, it can create a missing tag from the default branch. | Directly consumes the reviewed changelog text and existing protected tag. A manual command needs repository release-write access only when the operator runs it. |
| Changesets action | [Changesets action documentation](https://github.com/changesets/action/blob/main/README.md) and [Changesets automation guide](https://github.com/changesets/changesets/blob/main/docs/automating-changesets.md) provide release creation on the *publish* path. The action's publish mode needs `contents: write` to make releases. | Shotwright invokes its version mode only ([version workflow, lines 61–88](../.github/workflows/version.yml)); adopting publish mode would replace the intentional explicit npm publish boundary in [ADR 0012, lines 22–26](adr/0012-release-tooling-changesets-and-gitleaks.md). |
| release-please | Its [README](https://github.com/googleapis/release-please/blob/main/README.md) describes a Conventional Commits based release PR that bumps versions, tags, and creates a GitHub Release when merged, while leaving package publication separate. | Duplicates the existing Changesets Version PR and moves release/tag creation ahead of shotwright's real publish. The current commit convention and release manager choice are documented in [ADR 0012, lines 34–48](adr/0012-release-tooling-changesets-and-gitleaks.md). |
| semantic-release | Its [plugin lifecycle](https://semantic-release.gitbook.io/semantic-release/usage/plugins) has commit analysis, notes, preparation, and publication stages; the [GitHub plugin](https://github.com/semantic-release/github/blob/master/README.md) publishes a Release and can attach assets. | Replaces reviewed manual versioning with commit-derived automation unless extensively customized; [ADR 0012, lines 34–48](adr/0012-release-tooling-changesets-and-gitleaks.md) already rejected that trade. |
| GitHub Release assets | GitHub [automatically supplies source archives](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases); optional binaries can be uploaded. The semantic-release GitHub plugin [supports assets](https://github.com/semantic-release/github/blob/master/README.md). | Assets are a valid precedent for distributable binaries, but the authoritative install artifact here is npm's registry tarball. |

GitHub says a release is based on a tag and can have a different date from the tag ([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), read 2026-10-29). Its UI automatically assigns `Latest` by semantic versioning unless explicitly selected ([Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), read 2026-10-29); CLI `--latest=false` makes a prerelease/backfill rule explicit ([CLI manual](https://cli.github.com/manual/gh_release_create), read 2026-10-29). The npm registry's [provenance documentation](https://docs.npmjs.com/generating-provenance-statements/) describes a link from package to source/build and says trusted publishing generates provenance automatically (read 2026-10-29); the workflow also passes `--provenance` explicitly ([release workflow, lines 373–384](../.github/workflows/release.yml)).

GitHub's [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) says creating a Release from Actions requires `contents: write` (read 2026-10-29). This is the permission that would need a third, separately scoped job if automation were chosen. GitHub [documents Dependabot updates for reusable workflow references](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions) and Renovate [classifies job-level reusable-workflow `uses:` as a `workflow` dependency backed by GitHub tags](https://docs.renovatebot.com/modules/manager/github-actions/) (both read 2026-10-29). **Inference:** creating a Release for an already existing tag should not make the reference newly runnable or alter a tag-based update; updater behavior depends on consumer configuration and tag discovery. The source-to-tag relationship remains the relevant contract ([template, lines 10–17](../templates/github/shotwright.yml)).

## Options

| Option | Benefits | Costs / risks | Verdict |
|---|---|---|---|
| **A. Add `gh release create` immediately after runbook §2.4b** | Keeps post-publish order, existing protected tag, two-job workflow, and job permissions. Uses reviewed `CHANGELOG.md` as exact notes source. Easy to backfill one version. | Human can omit the step; release page may lag npm. Requires an explicit verify and retry instruction. | **Recommended** |
| B. Add a third `release` job after `publish` | Automatic after successful npm publish; can use `contents: write` only on that job, leaving `build` read-only. | Tag is intentionally created *after* the workflow, so this job would need to create a protected tag or wait for an external tag event. It changes the two-job workflow and requires careful authorization around tag protection, token exposure, and retry after npm succeeds. | Decline for this bead. |
| C. Run Changesets action publish mode or replace it with release-please/semantic-release | Built-in release creation and rich ecosystem examples. | Reopens the version/publish architecture settled in ADR 0012 and risks changing the point where irreversible publication occurs. | Decline. |

## Recommendation and repeatable procedure

Extend `docs/release-runbook.md` §2.4b in the Plan/Implement phases: after a successful npm publish and pushed protected tag, create the GitHub Release from the **tagged commit's** `CHANGELOG.md`, using the exact `## <version>` block up to but excluding the next `## ` heading. Validate that the block exists and is nonempty before calling GitHub. Pass it through `gh release create <tag> --verify-tag --title <tag> --notes-file <file>`; do **not** let the CLI invent a tag or generate different notes. Check `gh release view <tag> --json body,isLatest,isPrerelease,tagName` against the source block and classification. If the Release exists, verify it and stop; if creation fails after the tag push, retry only the release step. The runbook should show concrete extraction and verification commands rather than leave slicing to operator judgment.

For stable versions, create the Release after a verified npm `latest` publish, mark it latest, and verify `/releases/latest` resolves to it. For versions published under `next`, add `--prerelease --latest=false`; verify the tag-specific page but do not move GitHub Latest. For the `v0.6.0` backfill, use the `v0.6.0` tag's own changelog (not a future `main`), set Latest because it is the currently published stable version, and verify the body matches that section. Backfill **only `v0.6.0`**; leave earlier tags without Releases. Since `gh release create` is a remote write, the orchestrator/operator performs it after research and implementation authorization, not in this phase.

Publish **notes only**, with no attached npm tarball or `.sha256` for this scope. The release workflow already checks the tarball hash across its jobs ([release workflow, lines 346–369](../.github/workflows/release.yml)) and keeps the tarball plus checksum as a seven-day run artifact ([release workflow, lines 275–282](../.github/workflows/release.yml)). The npm registry is the supported package channel ([design, lines 30–38](design.md)); a GitHub attachment would create a second long-lived distribution copy requiring byte-for-byte verification against the published registry package. A plain link to npm's package/provenance page may be useful context but would make the notes differ from the changelog section unless the link is itself part of that section. Revisit asset attachment only if users actually need offline or non-npm distribution. GitHub's automatic source archives are source snapshots, **not** the built npm tarball ([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), read 2026-10-29).

### Binding surface and semver

This recommendation adds no CLI flag, config field, manifest field, workflow input, published export, or consumer template change. It adds an operator procedure and public GitHub Release metadata. The procedure itself implies **no package semver bump**; each future package version continues to follow the existing Changesets version decision ([ADR 0012, lines 22–26](adr/0012-release-tooling-changesets-and-gitleaks.md)). A GitHub Release does not change a protected tag's commit or the `uses: ...@v<version>` reference ([runbook, lines 413–437](release-runbook.md); [pin synchronizer, lines 28–59](../scripts/sync-template-pin.mjs)).

### ADR judgment

**No new ADR warranted.** This is a narrow operational completion of the existing Changesets/manual publish decision in ADR 0012; it selects no new foundational component, credential path, or public package interface. Document the procedure and rationale in the runbook and this research doc. If later work moves tag/release creation into a privileged workflow job, revisit the architecture and record that decision then.

## Open questions for the owner

1. Is manual post-publish release creation acceptable, given the omission risk, or is automatic creation worth a separate design for protected-tag timing and a third job?
2. Should GitHub Latest be set explicitly for every stable publish (recommended) or left to GitHub's automatic semantic-version selection? The explicit rule also makes the one-version backfill deterministic.

Neither answer is required to implement the recommended runbook procedure; they are policy choices to confirm before changing its automation model.

## Considered and declined

- Creating a release *before* npm publish: it could advertise a version that the registry rejected; it also conflicts with the runbook's post-publish tag step ([runbook, lines 390–422](release-runbook.md)).
- `--generate-notes` or `--notes-from-tag`: the resulting body is not guaranteed to equal the Changesets changelog section ([CLI manual](https://cli.github.com/manual/gh_release_create), read 2026-10-29).
- Attaching the temporary workflow tarball or checksum by default: it adds a second distribution surface and extra artifact handoff/verification without a consumer requirement ([release workflow, lines 275–282](../.github/workflows/release.yml); [design, lines 30–38](design.md)).
- Backfilling older tags: excluded by the bead's stated scope; they remain valid tags for pinned consumers ([template, lines 10–17](../templates/github/shotwright.yml)).

## Self-review

| Lens | Result |
|---|---|
| Measured or flagged | **Pass.** Live tag, npm, and GitHub release checks are dated above. No performance or scale estimate drives the choice. |
| Derived-value semantics | **Pass.** The notes are exactly one version block bounded by the next level-two version heading; a missing/empty block aborts. Latest and prerelease classification is explicit. |
| Emergent structure | **Pass.** One Release per published tag; earlier tags intentionally remain tag-only. A Release never changes the tag ref. |
| Batch/concurrency | **Flag for Plan.** The manual sequence is publish → tag push → Release creation; retries must check whether the Release already exists and compare its body. There is no cross-service transaction. |
| Inherited constraints grounded | **Pass.** The tag, template pin, two job permissions, and changelog structure were checked in current files cited above. |

## Redteam amendments (2026-10-29)

A redteam returned "proceed with changes"; all three findings are adopted for the plan.

1. **Verify the tag's target, not only its existence.** `gh release create --verify-tag` checks only that the remote tag exists. Before creating the Release, compare the tag's peeled commit with the head SHA of the successful Release workflow run, and stop on a mismatch. A wrong-commit tag would otherwise get truthful notes for the wrong source.
2. **Mark Latest explicitly.** Stable releases pass `--latest`; prereleases (npm dist-tag `next`) pass `--prerelease --latest=false`, after confirming npm's `latest` dist-tag. The CLI otherwise chooses automatically ([gh release create](https://cli.github.com/manual/gh_release_create), read 2026-10-29).
3. **Fix the verification command.** `gh release view --json` has no `isLatest` field ([gh release view](https://cli.github.com/manual/gh_release_view), read 2026-10-29). Verify Latest by comparing the tag returned by `GET /repos/{owner}/{repo}/releases/latest` with the expected tag; use `gh release view` for body and prerelease checks.

The semantic-release comparison should cite its current documentation (https://semantic-release.org/foundation/plugins/, read 2026-10-29); the GitBook page now says it is discontinued.
