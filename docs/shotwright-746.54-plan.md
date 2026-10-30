# shotwright-746.54 — CI workflow pin warning plan

- **Phase:** P
- **Binding input:** `docs/shotwright-746.54-research.md`, including its final Redteam amendments; owner decisions: non-failing `init` warning only, no suppression, no automatic bump, current-package jobs only, per-job evaluation.

## Goal and premise re-check

The adoption report's `0.5.0` / `@v0.4.0` values are historical: this branch declares `0.6.0` and its caller template pins `@v0.6.0` (`package.json:3`; `templates/github/shotwright.yml:12-21`). The defect remains for copied consumer files. `planInit` places the workflow at the Git root and renders its package `working-directory`; `planManagedFile` leaves an existing differing workflow alone without inspecting its `uses:` ref (`src/init.ts:274-292,323-330,453-469`). Both dry-run and normal output report that file as consumer-owned (`src/init.ts:405-429`). `shotwrightVersion()` reads the running package's `package.json`, which is the same source as `--version` (`src/version.ts:16-24`; `src/cli.ts:967-972`). The reusable workflow installs in its `working-directory` and invokes the local CLI, so tag inequality is a **configuration warning**, not evidence of which binary CI executed (`.github/workflows/shotwright.yml:18-21,61-63,125-135,182-190`).

The diagnostic belongs in `init`, without a new command or exit status. The design keeps CI artifacts and comparison advisory by default (`docs/design.md:30-37,110-120`); ADR 0007 records why the copied caller pins a release tag (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:83-89`). No ADR or foundational dependency is needed for this scoped, read-only diagnostic. Preserve `init`'s existing write and failure behavior (`src/init.ts:333-379,687-701`).

## Numbered implementation steps

Each step is smaller than one PR; together they form one implementation PR. File and line anchors below identify the current insertion or test surface, not promised line positions after editing.

1. **Recognize only supported caller jobs.** Add a private, read-only recognizer near `planInit` in `src/init.ts:249-330` (or a private sibling module imported there). Read only the existing Git-root `.github/workflows/shotwright.yml`, after the normal contained-path check at `src/init.ts:323-326`; a missing file yields no candidates. Choose a narrow YAML subset, with no new package dependency (`package.json:55-77`): identify a top-level `jobs:` mapping, each direct job key, that job's scalar `uses:`, and its direct `with.working-directory` scalar. Ignore step-level `uses:`. Accept plain, single-quoted, and double-quoted scalar forms only when their value can be decoded unambiguously; accept `.` or a literal repository-relative directory, and the reusable workflow's omitted-input default `.` (`.github/workflows/shotwright.yml:18-21`). Reject expressions, aliases, block/flow mappings, duplicate relevant keys, tabs or inconsistent indentation, and any other uncertain structure **for the affected job**. Do not discard a clear sibling job because another is ambiguous. Record job ID, source line, ref, and target directory, with no mutation. **Pin:** focused table tests in `test/unit/init.test.ts:302-347,526-594` for template shape; quoted/unquoted values; comments; step action beside job call; reordered keys; several jobs; malformed, dynamic, duplicate, or ambiguous job shapes. Assert ambiguous jobs produce no verdict while an independent valid sibling still can. No network or repository-wide search.

2. **Resolve package identity and compare full refs per job.** At `src/init.ts:274-292,323-330`, compare each recognized job's literal target against the canonical package path already computed for template rendering (`src/init.ts:285-290`). Normalize `.` and internal `.` segments from the Git root; reject absolute paths, path traversal outside the root, dynamic values, and any target that cannot be established as the current package. A literal path to another package is ineligible, even if its tag differs. If a target exists through a symlink, canonicalize it only when safely resolvable inside the Git root; otherwise mark that job unknown. Treat an omitted `working-directory` as root, per the reusable input default; this checks a root-package `init`, not a nested package. A candidate must be job-level `uses:` for exactly `hestonhamilton/shotwright/.github/workflows/shotwright.yml@v<full-semver>`; retain prerelease/build suffixes for exact string comparison. Forks, SHA pins, branches, local callers, malformed tags, and unknown targets yield no skew verdict for that job only. Compare each eligible tag to `v${shotwrightVersion()}` (`src/version.ts:16-24`): equal is silent; any unequal older **or newer** tag warns once per job. Never infer run-time equality or ordering from the tag. **Pin:** table tests in `test/unit/init.test.ts:526-594` for root/nested packages, sibling package, omitted/default `.`, quoted path, symlink alias, traversal, expression, fork/SHA/branch, prerelease, equal/older/newer, and mixed jobs. Assert the warning count equals the number of eligible unequal jobs and does not depend on job order.

3. **Render a clear warning without changing `init` actions.** Feed deterministic warning strings into `InitPlan.notices` at `src/init.ts:295-329`, preserving the existing notice display route in both CLI modes (`src/cli.ts:955-964`; `src/init.ts:386-396,722-726`). Suggested wording per job: `Warning: .github/workflows/shotwright.yml job <job-id> uses @<observed-tag>, while the shotwright CLI running init is <installed-version>. For this package, review the workflow release changes, then change that job's uses pin to @v<installed-version>.` Include the source line if available to distinguish repeated calls. This is an instruction for a manual edit, not an edit performed by `init`. Existing left-alone classification remains in place (`src/init.ts:453-469`). A skew warning must not change `classifyInitOutcome` or exit code (`src/init.ts:350-383,687-701`); existing script conflicts and actual write errors retain their existing exits. **Pin:** test `planInit` plus `dryRunInitPlan`/`applyInitPlan` and formatted output at `test/unit/init.test.ts:302-347,350-423`; assert exact warning text, job ID/path/tag/installed version/fix, exit 0 in the otherwise successful case, unchanged workflow bytes and no workflow write action, and one warning in both modes even when nothing else changes. Test the CLI notice route where suitable (`src/cli.ts:955-964`; `test/unit/cli.test.ts:1-40`) so normal output does not silently omit or double print it.

4. **Release note.** Add one `.changeset/*.md` file for package `shotwright` as a **minor** change, with proposed summary: “Warn during `shotwright init` when a current-package caller job pins a different Shotwright release than the CLI running init, and show the manual pin change.” `package.json:1-3` is pre-1.0; minor is a release proposal for a new user-visible diagnostic, not a SemVer obligation. Changesets creates version/changelog PRs (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26,34-39`); `CHANGELOG.md:3-12,14-25,86-94` uses Minor Changes for new user-facing capabilities and Patch Changes for corrections. The recent `init` conflict fix was patch (`CHANGELOG.md:9-12`), while `--version` and monorepo caller support were minor (`CHANGELOG.md:86-94`); this addition follows the latter precedent. Do not manually set `0.7.0` or edit the packaged template pin; the version workflow syncs that pin (`package.json:41-47`; `scripts/sync-template-pin.mjs:7-15,28-59`). **Pin:** inspect the new changeset's package/bump/body and run the standard release metadata checks through `pnpm run lint` (`package.json:41-47`).

## V-phase checks

- Run `pnpm run typecheck && pnpm run lint && pnpm run test` (`CLAUDE.md:41-47`; `package.json:41-45`), plus the focused `pnpm exec vitest run test/unit/init.test.ts` while developing. Run `pnpm run smoke` if the final diff changes CLI packaging or module resolution (`package.json:49-50`). Record commands and outcomes in `docs/shotwright-746.54-verification.md` per the phase contract.
- In a temporary Git-root fixture inside the worktree with root and nested packages, execute built `shotwright init --dry-run` and normal `shotwright init` against older, equal, newer, and unrelated job refs; capture stdout, exit status, and before/after workflow checksum, then remove the fixture. The deterministic unit tests above are the primary pin; the command exercise checks the actual CLI wiring (`src/cli.ts:955-964`; `src/init.ts:333-383`).
- No gallery or other UI changes are planned. If implementation adds or changes any UI, render and **view** it in V at phone and desktop widths before sign-off, as required by `CLAUDE.md:107-108`.
- Verify the published-file diff contains only scoped implementation/test/changeset files, and scan committed text for host paths, LAN addresses, usernames, and personal data (`CLAUDE.md:16-33`; `docs/design.md:38`).

## Risks and rollback

- **YAML subset misses a real custom caller:** conservative unknown means a missed warning. The parser tests name supported syntax; V should exercise at least the packaged template and a representative edited workflow. Revisit parser support only with a concrete consumer file; do not guess from a loose line regex (`templates/github/shotwright.yml:10-21`; `src/init.ts:453-469`).
- **False warning on a monorepo sibling:** per-job target resolution and current-package comparison are mandatory pins in steps 1–2, including the reusable input's `.` default (`src/init.ts:285-290`; `.github/workflows/shotwright.yml:18-21`).
- **Warning noise when a consumer deliberately lags:** it appears only on `init`, is informational, and keeps the manual edit under consumer control (`src/init.ts:405-429`; `src/cli.ts:955-964`). There is no suppression switch.
- **Rollback:** revert the recognizer/notice changes and the changeset before release; after release, a subsequent patch can remove or narrow the advisory warning. Neither path needs a workflow or consumer-file migration because this plan makes no automatic edit (`src/init.ts:453-469`).

## Considered and declined

- No automatic pin bump, opt-in bump flag, or suppression mechanism, per owner decision. `init` already preserves customized workflow files (`src/init.ts:453-469`).
- No run-time CI gate or workflow edit. An old pinned callee cannot reveal a newly added check, and the project treats CI as an artifact integration (`docs/design.md:34-37,110-120`; `docs/shotwright-746.54-research.md:33-45`).
- No new YAML dependency for one narrow read-only diagnostic; uncertainty produces no verdict. The package currently has only two direct runtime dependencies (`package.json:75-77`).
- No claim that a matching tag proves equal CI and local binaries: the reusable workflow installs the consumer dependency and runs its local binary (`.github/workflows/shotwright.yml:125-135,182-190`).

## Acceptance mapping

| Acceptance / owner decision | Step and pin |
|---|---|
| Parse the reusable-workflow `uses:` pin | 1: job-level recognizer tests, including step-level exclusions and ambiguous syntax. |
| Compare with the installed version | 2: per-job full-tag matrix against `shotwrightVersion()`. |
| Print a clear warning and fix | 3: exact output assertions in normal and dry-run modes, with manual `@v<installed-version>` action. |
| Consider automatic bump | Considered and declined above; no mutation or flag, per owner decision. |
| Covered by tests | Steps 1–3: unit matrix and CLI path; V command exercise and standard checks. |
| Non-failing, no suppression | 3: exit/status tests; no new CLI option at `src/init.ts:84,107-123`. |
| Current-package jobs only, each evaluated independently | 1–2: mixed-job and monorepo fixture tests, including unknown sibling behavior. |

## Open questions

None blocking implementation. Recommendation: use the conservative scalar/indentation subset in step 1 and expand only when a real consumer workflow demonstrates a missed supported form. Do not change the binding owner decisions during implementation (`docs/shotwright-746.54-research.md:86-92`).

## Plan self-review

| Lens | Result / deterministic pin |
|---|---|
| Measured or flagged | Pass: no performance or frequency estimate; step 1 limits reads to one known file. |
| Derived-value semantics | Pass: each job independently maps to current, other, or unknown package; equal/unequal/unknown refs are defined in steps 1–2 and pinned by the matrix. |
| Emergent structure | Pass: one known file, zero or more jobs, at most one verdict per eligible job; mixed-job tests pin cardinality and ordering independence. |
| Batch / concurrency | Pass: diagnostic is read-only, with no transaction or publish step; `init` action behavior remains as before (`src/init.ts:333-340,453-469`). |
| Inherited constraints grounded | Pass: package path and input default checked at `src/init.ts:285-290` and `.github/workflows/shotwright.yml:18-21`; CLI notice rendering and version source checked at `src/cli.ts:955-964` and `src/version.ts:16-24`. |

## Redteam amendments and owner decision (2026-10-29)

A plan redteam returned "proceed with changes". Adopted, with the owner's dependency decision:

1. **Parse with `yaml`, not a hand-rolled subset (owner decision).** Replace step 1's recognizer with the `yaml` package as an exact-version runtime dependency (2.9.1 or the version the lockfile resolves). Parse with duplicate-key checking, then read only direct `jobs.<id>.uses` and `jobs.<id>.with.working-directory`. Ambiguous jobs (expressions, non-scalar values, unrecognised refs) stay silent; clear siblings are still evaluated. Admitting it requires, in this PR: an ADR 0019 amendment with a "Prior art and currency" subsection (web-searched links and read dates: maintenance, advisories including GHSA-48c2-rrv3-qjmp fixed in 2.8.3, install size, zero dependencies), the exact-version runtime allowlist entry, and a passing OSV audit gate. No leak-gate expected-files change is needed for the dependency itself; a new compiled module would need one.
2. **A diagnostic never fails `init` (fix now).** Catch any parse or recognition error and treat it as "no verdict". Test malformed YAML and a parser-thrown error through normal and dry-run output; existing file and write errors keep their current behaviour and exit codes.
3. **Simpler path handling.** Compare a literal, contained `working-directory` with the current package's canonical path; resolve an existing symlink only to establish identity. If resolution fails or escapes the Git root, give no verdict. Keep a few representative tests, not a full matrix.
4. **Smaller CLI fixture set.** One end-to-end older-pin warning case plus an equal-pin and an unrelated-package control; the unit tests carry the matrix.
