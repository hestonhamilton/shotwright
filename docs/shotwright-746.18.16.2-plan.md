# shotwright-746.18.16.2 — Dependency vulnerability gate repair plan

Date: 2026-09-03
Status: proposed; implementation requires owner approval

## Goal

Replace the unavailable/fail-open `pnpm audit` wrapper with one dependency
vulnerability gate whose green result proves all of the following:

1. the package still has zero runtime dependencies;
2. the exact reviewed OSV-Scanner binary ran;
3. every package in the current pnpm lockfile was extracted;
4. current dependencies have no unexcepted known vulnerability;
5. the same invocation path detects a pinned known-vulnerable canary; and
6. unavailable, malformed, empty, partial, or stale advisory data cannot become
   a clean result.

The gate must block the shared verify lane used by GitHub PR/main, Forgejo
branches, and release. It must add no npm dependency or install script and must
preserve pnpm 11.25.0 plus the two load-bearing resolution overrides.

The owner already approved the foundational choices in
[`shotwright-746.18.16.1` Research](shotwright-746.18.16.1-research.md) and
[ADR 0019](adr/0019-dependency-vulnerability-review.md): OSV-Scanner 2.5.1 is
the sole blocking vulnerability scanner; every lane fails closed; all known
advisories block by default; exceptions require an ID, reason, and expiry; and
the local zero-runtime-dependency assertion remains independent of advisory
availability.

## Grounded implementation constraints

- OSV-Scanner's stable v2 CLI and JSON interface support `pnpm-lock.yaml`,
  `--all-packages`, explicit config overrides, distinct result/error exits, and
  a downloadable offline database
  ([usage](https://google.github.io/osv-scanner/usage/),
  [supported lockfiles](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/),
  [output](https://google.github.io/osv-scanner/output/),
  [offline mode](https://google.github.io/osv-scanner/usage/offline-mode/)).
- `osv-scanner.toml` supports ID exceptions, reasons, dates, and alias-aware
  suppression. OSV makes the metadata optional; this repository's policy makes
  all three fields mandatory
  ([configuration](https://google.github.io/osv-scanner/configuration/)).
- Release binaries have published checksums and SLSA provenance, and interfaces
  within major version 2 are promised to remain compatible
  ([installation](https://google.github.io/osv-scanner/installation/)). The
  implementation pins reviewed hashes in-repository instead of downloading a
  binary and its trust decision from the same release at runtime.
- The OSV API and downloadable GCS database are separate delivery surfaces. The
  latter is an actual fallback, not the same request retried under another name
  ([architecture](https://google.github.io/osv.dev/architecture/),
  [data exports](https://google.github.io/osv.dev/data/)).
- Version 2.5.0 had a false-clean offline-cache regression; 2.5.1 fixed it. The
  live canary and package denominator therefore remain mandatory even with an
  exact version pin
  ([2.5.1 release](https://github.com/google/osv-scanner/releases/tag/v2.5.1)).
- Lifecycle guidance supports blocking checks on committed changes and another
  scan in the product build; the shared verify script is therefore the single
  policy location for all three wrappers
  ([NIST SSDF PW.4.4](https://csrc.nist.gov/pubs/sp/800/218/final),
  [CISA/NSA developer guidance](https://www.cisa.gov/sites/default/files/2023-12/ESF_SECURING_THE_SOFTWARE_SUPPLY_CHAIN_DEVELOPERS.pdf)).

## Deterministic pins

| Load-bearing assumption | Pin or invariant | Deterministic proof | Lands in |
|---|---|---|---|
| Scanner identity | OSV-Scanner `2.5.1`; the gate rejects a missing binary or any other reported version | Installer verifies the downloaded bytes and reported version; gate repeats the version check; self-test substitutes missing and wrong-version executables | Steps 2–3 |
| Release integrity | Hard-code the official 2.5.1 SHA-256 for Linux amd64 `f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be`, Linux arm64 `3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d`, Darwin amd64 `9f89beb6c3d784893cb1cae0a3d56c529bfe91075418c2f9440c45b79654198b`, and Darwin arm64 `75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054` | Installer hashes the asset before installing it; unsupported OS/architecture fails | Step 2 |
| Online latency | 30-second external process deadline for each scan | 20 consecutive current-lock scans measured min 0.606 s, p50 0.644 s, p95 0.717 s, max 0.724 s, mean 0.652 s; the pin is more than 40 times the measured maximum; fake-scanner self-test proves deadline handling without waiting 30 seconds | Step 3 |
| Fresh fallback latency | 120-second external deadline for database download plus the first offline scan; subsequent same-run canary scan gets 30 seconds | A fresh npm database measured 212 MiB and 8.8 seconds, giving the download path more than 13 times the measured duration; Verify reruns the real fresh-download experiment | Steps 3 and 5 |
| Current-tree coverage | Pin pnpm lockfile schema `9.0`; use `--format=json --all-packages`; require exactly one lockfile result whose source is the requested real path and whose package count equals the top-level `packages` cardinality derived from that same lockfile | Current baseline is 311 versus 311; a strict dependency-free reader rejects an absent/different schema or malformed `packages` map; fixtures cover quoted/scoped keys, equal, zero, missing, malformed, duplicate-source, and off-by-one cases | Step 3 |
| Advisory detection | Commit a pnpm lockfile containing only `lodash@4.17.20`; require scanner exit 1 and [`GHSA-35jh-r3h4-6jhm`](https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm) in either a result ID or aliases | OSV currently records that lodash versions before 4.17.21 are affected; the real canary runs on every verify; fixture JSON also drives the classifier hermetically | Steps 1 and 3 |
| Current finding semantics | Exit 0 plus structurally valid, complete, vulnerability-free JSON is clean; exit 1 with a current-tree finding is a policy failure; all other exits or invalid output are indeterminate | Hermetic matrix covers clean, findings, malformed/empty JSON, no packages, wrong source, wrong denominator, timeout, exit 127, and exit 128 | Step 3 |
| Source unavailability | Indeterminate online results retry the complete current+canary pair once with `--offline-vulnerabilities --download-offline-databases` in a newly created empty cache; findings never trigger fallback; no second fallback exists | Fake scanner records call order and cache identity; tests prove online finding skips fallback, online failure/fresh fallback passes, and two failed paths fail | Step 3 |
| Freshness | Set `OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY` to a new run-local temporary directory and require the download flag on the first fallback scan; never inspect or reuse a user/runner cache | Self-test preloads a sentinel in the ordinary cache and proves it is never read; real Verify experiment starts from an empty temporary cache | Steps 3 and 5 |
| Exception policy | Only canonical `[[IgnoredVulns]]` records are accepted; each must contain one nonempty `id`, one nonempty `reason`, and one future `ignoreUntil = YYYY-MM-DD`; reject duplicates, expired entries, unknown keys/sections, and all `PackageOverrides` | Policy fixtures cover an empty file, valid future exception, missing fields, expiry today/past, duplicate IDs, unknown keys, and package-wide suppression | Steps 1 and 3 |
| Canary independence | The canary is scanned with an explicit empty temporary config, never the production exception file | A fixture that adds the canary ID to production exceptions still must detect the canary | Step 3 |
| Severity | Do not parse or threshold severity; any unignored vulnerability is blocking | Finding fixtures span records with and without severity and all fail identically | Step 3 |
| Runtime package shape | `package.json.dependencies` must be absent or empty before any scanner/network work | Fixtures prove empty/absent passes and each named runtime dependency fails with its name in the diagnostic | Step 3 |
| pnpm state | Keep `packageManager: pnpm@11.25.0`; keep only the brace-expansion and nanoid overrides in `pnpm-workspace.yaml`; remove native `audit:` policy | Frozen install plus lockfile checks; review confirms no `pnpm audit` invocation remains | Steps 1 and 5 |
| Lane coverage | `.github/workflows/verify.yml`, `.forgejo/workflows/ci.yml`, and `.github/workflows/release.yml` install the same pin and call `scripts/ci/verify.sh`; the gate appears once in that shared script | Static lane search, local full verify, GitHub check, Forgejo status, and release dry run | Steps 2, 4, and 5 |
| Shipped surface | Scanner remains a standalone CI tool; no new package dependency, lifecycle script, or packed file | Manifest diff, `pnpm install --frozen-lockfile`, package file-set check, and `npm pack --dry-run` | Steps 1 and 5 |

The timeout figures are operational constraints, not claims about guaranteed
network speed. Exceeding either deadline is an indeterminate result and therefore
a failing lane unless the other fresh source completes validly. A future timeout
change must carry new measurements in the change record.

## Step list

### 1. Normalize package-manager and policy inputs

Implementation bead: `shotwright-746.18.16.3`. This step is a portion of one
implementation PR.

- Keep the existing pnpm 11.25.0 manifest and lockfile upgrade.
- Keep `pnpm-workspace.yaml` as the pnpm 11 home for the two existing
  `overrides`; remove its unsupported high-only native audit policy.
- Replace `scripts/ci/known-advisories.txt` with a root `osv-scanner.toml` whose
  initial exception set is empty and whose comments document the required
  `id`/`reason`/`ignoreUntil` shape.
- Add a minimal, manually authored pnpm lockfile fixture for
  `lodash@4.17.20`. Do not add lodash to the repository manifest or install it.
- Reopen `shotwright-746.23` before relying on its original acceptance record;
  leave it open until Verify records and triages the replacement current-tree
  review.

Proof at this step: pnpm resolves both existing overrides from the workspace
file; the fixture contains exactly one package; manifests contain no new
dependency or install script; the policy validator cases are ready for Step 3.

### 2. Install one exact scanner in every lane

Implementation bead: `shotwright-746.18.16.3`. This step is a portion of the
same implementation PR.

- Add `scripts/ci/install-osv-scanner.sh`, following the existing gitleaks
  installer's centralization pattern but using the four hard-coded hashes above.
- Put `OSV_SCANNER_PIN="2.5.1"` and the four hashes in one sourceable
  `scripts/ci/osv-scanner-pin.sh`; have both installer and gate source it so an
  update cannot silently drift.
- Support Linux and Darwin on amd64 and arm64; fail on every other pair.
- Download the single unarchived release binary, verify its SHA-256 before
  installation, set executable permissions, and require the installed binary to
  report exactly 2.5.1.
- Call the installer from GitHub verify, Forgejo verify, and GitHub release setup
  beside the existing gitleaks setup, using the same PATH directory.

Proof at this step: correct asset/hash selection for all four supported pairs,
corrupt-download rejection, reported-version mismatch rejection, and a real
install on the current Linux architecture.

### 3. Replace the wrapper with a classified, bounded two-source gate

Implementation bead: `shotwright-746.18.16.3`. This is the main portion of the
same implementation PR.

- Replace the half-written `pnpm audit` logic in `scripts/ci/audit-gate.sh`; do
  not preserve its `--strict` split or any path that maps unavailable data to
  success.
- Keep the shell entry point for package-script compatibility and put structured
  orchestration/classification in a dependency-free Node module under
  `scripts/ci/`. Node supplies portable child-process deadlines and JSON parsing
  without assuming GNU `timeout`, `jq`, Python, or an undeclared TOML package.
- Before locating the scanner or touching the network, validate zero runtime
  dependencies and the canonical exception schema.
- Check scanner version, then scan the current lockfile online with the
  production config. Accept clean only after exit, JSON shape, source path,
  denominator, and finding checks all agree.
- Scan the canary online with an explicit empty config. Require exit 1, one
  extracted package, and the pinned GHSA in the result ID/aliases.
- Treat a validated current-tree finding as final failure and do not retry it.
  Treat timeout, tool/general/no-package exit, invalid JSON, incomplete
  extraction, or missing canary as indeterminate and retry the entire pair once
  through a fresh offline-database cache.
- In fallback, download the database during the current-tree scan, then use only
  that same run-local database for the canary. Any invalid result or second-path
  error fails loudly and nonzero. Always remove temporary outputs/cache.
- Rebuild `scripts/ci/audit-gate-selftest.sh` around fixed package, policy, JSON,
  and fake-scanner fixtures. Exercise the production classifier and orchestration
  seams rather than reimplementing their decisions in the test.

Proof at this step: the full deterministic matrix in the pins table. Tests must
also assert diagnostics distinguish `VULNERABLE` from `INDETERMINATE`, name the
failing source/path, and never print a success banner after either condition.

### 4. Wire, document, and remove the retired mechanism

Implementation bead: `shotwright-746.18.16.3`. This completes the same
implementation PR.

- Run the hermetic audit-gate self-test and then the live gate from
  `scripts/ci/verify.sh`. The live gate remains in the shared script, so PR,
  Forgejo, and release semantics cannot diverge.
- Remove all `pnpm audit`, high-threshold, `--strict`, and
  `known-advisories.txt` references. Update `.github/dependabot.yml` comments and
  `docs/release-runbook.md` with the OSV installer, all-advisory policy,
  exception schema, canary, fallback, and operator diagnostics.
- Check ADR 0019 against the implementation. Its decision already landed in R;
  amend it in I only if an empirical implementation finding changes the accepted
  architecture, and surface any non-empirical deviation to the owner first.
- Preserve package script name `audit-gate` unless a repository search proves it
  has no compatibility value; its implementation changes, not its public name.

Proof at this step: repository searches find one shared live invocation, one
shared self-test invocation, three installer call sites, no native audit policy,
and no stale description of release-only fail-closed behavior.

### 5. Verify the repair and record the current review

Verify bead: `shotwright-746.18.16.4`. Verification is a separate review phase;
production changes discovered here require returning to I rather than silently
editing through V.

- Run the new hermetic self-test, policy fixtures, real online current+canary
  pair, and a real fresh-database current+canary pair from an empty cache.
- Reproduce the failure cases with controlled fake scanner responses: unavailable
  online plus valid fresh fallback; both sources unavailable; current finding;
  malformed output; wrong/zero package count; absent canary; missing binary; and
  wrong version.
- Run `pnpm install --frozen-lockfile`, the repository verification command, the
  packed-file-set check, and disclosure scans. Confirm the current dependency
  review remains 311 extracted packages, zero unexcepted findings, and zero
  policy exceptions, or triage and record any new result at execution time.
- After an approved push, require both the GitHub verify check and
  `scripts/forge-ci-status.sh <sha>` to be green. Exercise the release workflow's
  dry-run before treating release-lane coverage as verified.
- Append evidence to the relevant beads, close `shotwright-746.23` only with
  owner confirmation, and use `/bead-finish` for the phase/epic closure protocol.

The current package count is recorded evidence, not a permanent literal in the
gate. Dependency updates legitimately change it; equality with the lockfile's
derived cardinality is the permanent invariant.

## Risks and rollback

| Risk | Containment | Rollback |
|---|---|---|
| OSV API outage blocks work | One bounded attempt followed by a separately hosted, freshly downloaded database; clear source-specific diagnostics | Re-run after either source recovers. Do not restore a fail-open exit or bypass release; changing the availability policy requires a new owner-approved ADR amendment. |
| Both OSV delivery surfaces are unavailable | Deadlines cap the worst-case sequence at 210 seconds plus bounded process overhead; the lane fails explicitly | Retry later. An emergency publish exception is an operator action outside this plan, never an automatic green result. |
| A scanner regression returns empty/partial data | Exact version/hash, current denominator, source identity, and live vulnerable canary must all agree | Pin a grounded fixed release and update hashes/canary evidence. Reverting to 2.5.0 is prohibited by its known false-clean regression. |
| The canary advisory changes aliases or is withdrawn | Match the stable GHSA in either ID or aliases and print the observed records on failure | Replace the fixture/advisory only after checking current OSV and authoritative advisory records; never weaken the requirement to “some finding.” |
| Exception syntax becomes a broad suppression path | Accept only canonical ID records with future expiry; reject package overrides and unknown keys; scan canary with empty config | Remove the exception. If OSV changes its config schema, fail until the strict validator is deliberately updated from current documentation. |
| Hard-coded release hashes make upgrades manual | Version and four hashes change together in one reviewable location; version assertion catches partial edits | Revert the entire version/hash update to the last verified pin, not only one field. |
| Offline database download increases bandwidth | Use it only after an indeterminate online path and never persist it between runs | Accept the failed lane and retry online later; do not reuse a stale cache to manufacture availability. |
| The uncommitted pnpm-audit rewrite obscures ownership | Replace affected files explicitly from the approved design; preserve unrelated working-tree changes and review the final diff by path | Before commit, compare each touched path against `516ca04` and the implementation plan; restore only a specific accidental hunk, never the whole dirty tree. |

Rollback means returning to the last sound, non-publishing state. The previous
`pnpm audit` wrapper is not a valid rollback target because its endpoint and
fail-open behavior are the defect being repaired.

## Acceptance mapping

| Acceptance requirement | Plan coverage | Evidence required before closure |
|---|---|---|
| Parent: decide whether “could not determine” differs from “advisories found,” and in which lanes | Step 3 makes both nonzero but distinct: a finding fails immediately; indeterminate retries once through a fresh source, then fails. Step 4 applies this to every lane with no release-only mode. | Hermetic call-order/exit matrix plus green GitHub, Forgejo, and release dry-run evidence |
| P: owner-approved plan committed at the required path | This document; owner confirmation is the P→I gate | Documentation checks, owner approval, then a docs-only commit |
| P: each step no larger than one PR | Steps 1–4 together define one implementation PR; Step 5 is the separate Verify phase and does not absorb production fixes | Diff review confirms scope has not expanded beyond this epic |
| P: risks, rollback, and every load-bearing assumption are explicit | Deterministic pins and Risks/rollback sections | Plan self-review and owner sign-off |
| I: implement deterministic pins without expanding shipped runtime surface | Steps 1–3 | Installer/gate/self-test results, manifest and tarball review |
| I: unavailable or malformed advisory data cannot succeed cleanly | Step 3 | Online/fallback fault matrix; no success banner in invalid cases |
| I: known findings fail under recorded policy | Steps 1 and 3 | Current-finding fixtures, all-severity fixtures, exception-schema cases |
| I: zero-runtime-dependency invariant remains enforced | Step 3 | Absent/empty/nonempty dependency fixtures, checked before scanner calls |
| I: ADR 0019 is amended and current tree is reviewed/triaged | ADR amendment landed in R; Steps 4–5 verify implementation agreement and record the live review | ADR diff check; package/finding/exception counts in Verify evidence |
| I: repository quality gates pass | Step 5 | Standard verification command and package/disclosure checks |
| Original `shotwright-746.23`: actual current-tree review and tool decision, with flip-dependent work explicit | Research and ADR contain the tool decision; Step 5 repeats and records the review; Dependabot's flip boundary remains documented | Reopened bead notes contain live counts and accepted/declined mechanisms before owner-approved closure |

## Plan self-review

- **Measured or flagged — pass.** Online timing uses 20 samples; fallback size
  and duration use the measured fresh download. The 30/120-second values are
  explicit operational margins and have deterministic timeout tests. Current
  package/advisory counts are labeled execution-time evidence, not invariants.
- **Derived-value semantics — pass.** Clean requires agreement among process
  exit, valid JSON, exact source, lockfile-derived denominator, exception policy,
  and canary. Findings and indeterminate states have different control flow and
  diagnostics even though both ultimately block.
- **Emergent structure — pass.** Package count is derived from the lockfile,
  result order is irrelevant, advisory ID aliases are searched as a set, and
  exception cardinality may grow only through canonical dated records. The gate
  does not hard-code today's 311 packages.
- **Batch/concurrency — pass.** Each job uses its own temporary output and fresh
  fallback cache; parallel GitHub, Forgejo, and release runs share no mutable
  scanner state. Cleanup is per process, and no phase publishes.
- **Inherited constraints grounded — pass.** The plan preserves the measured
  pnpm 11 override relocation, standalone-tool package shape, shared verify
  topology, dual CI providers, release dry run, headed-public disclosure rule,
  and owner-confirmation gates. It replaces rather than rationalizes the
  uncommitted fail-open wrapper.
