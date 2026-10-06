# shotwright-746.18.16.1 — Dependency vulnerability gate research

Date: 2026-09-03

## Context

ADR 0019 installed a `pnpm audit` gate immediately before npm retired the
legacy audit endpoints used by pnpm 10. The current branch upgrades to pnpm
11.25.0, which uses npm's replacement bulk endpoint, but the half-written gate
rewrite deliberately converts an unavailable registry into exit 0 outside a
fictional `--strict` mode. That is not acceptable: success must mean a valid
audit was completed, not merely that no advisory was returned.

This Research phase treats an earlier interest in OSV-Scanner as a
candidate, not a decision. It also treats two initially proposed constraints —
whether every lane must fail closed and whether a new tool is acceptable — as
research questions rather than asking the owner to decide without evidence.

### Owner kickoff

- The owner approved an R/P/I/V chain for the repair.
- OSV-Scanner was remembered as important, but the owner explicitly asked that
  it be challenged against current external evidence at every step.
- Neither the owner nor the author is to become the sole arbiter of the two policy
  constraints. The recommendation must be grounded in current documentation and
  measured behavior, with remaining value judgments surfaced for sign-off.

### Grounded constraints

- NIST SSDF PW.4.4 recommends automated detection of known vulnerabilities in
  third-party components throughout their life cycles, not only immediately
  before release ([NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)).
- CISA's developer guidance recommends automatic vulnerability scanning for
  each committed change and separate, higher-quality scanning in the product
  build environment
  ([CISA/NSA developer guidance](https://www.cisa.gov/sites/default/files/2023-12/ESF_SECURING_THE_SOFTWARE_SUPPLY_CHAIN_DEVELOPERS.pdf)).
- `audit-ci` defaults to failing when the registry says no audit was performed;
  its documented rationale is reducing the risk of merging a vulnerable package.
  Passing that state is an explicit convenience override, not the default
  ([audit-ci README](https://github.com/IBM/audit-ci/blob/main/README.md#qa)).
- The official OSV GitHub integration demonstrates both a failing PR scan and a
  release job that cannot proceed unless its OSV scan succeeds
  ([OSV-Scanner GitHub Action](https://google.github.io/osv-scanner/github-action/)).

Together these sources support a blocking check on every change and again in the
release build. They do not require an unbounded wait: an unavailable scanner may
fail promptly and clearly. The recommended policy is therefore **fail closed in
every lane, with a measured timeout and a second fresh-data path**.

The repository constraint does not require adding an npm dependency.
OSV-Scanner publishes standalone Linux, macOS, and Windows binaries with release
checksums and SLSA provenance, and promises compatibility within a major version
for non-experimental CLI and JSON interfaces
([installation and verification](https://google.github.io/osv-scanner/installation/)).
It can follow the existing pinned-binary installer pattern used for gitleaks.

## Evidence

### Current documentation

- pnpm 11 uses `/-/npm/v1/security/advisories/bulk`; `audit.level` defaults to
  `low`, and registry errors succeed only when the explicit
  `--ignore-registry-errors` option is used
  ([pnpm audit](https://pnpm.io/cli/audit)). This contradicts the working-tree
  comment that `high` is the documented default.
- OSV-Scanner directly supports `pnpm-lock.yaml`
  ([supported lockfiles](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/)).
- Its documented exit contract distinguishes clean (`0`), findings (`1`),
  general failure (`127`), and no packages (`128`)
  ([output and return codes](https://google.github.io/osv-scanner/output/#return-codes)).
- Its configuration accepts advisory IDs from multiple namespaces, treats
  aliases together, and supports reasons and expiration dates for exceptions
  ([configuration](https://google.github.io/osv-scanner/configuration/)). This
  removes ADR 0019's stated objection that one GHSA-only allowlist cannot model
  OSV identifiers.
- OSV aggregates the GitHub Advisory Database, NVD conversions, ecosystem
  databases, and the OpenSSF malicious-packages feed; per-ecosystem databases
  are continuously exported for download
  ([OSV data sources](https://google.github.io/osv.dev/data/)).
- The API and downloadable database are distinct delivery surfaces: the API is
  served through Cloud Run/Cloud Endpoints, while GCS is the primary source for
  full vulnerability records
  ([OSV architecture](https://google.github.io/osv.dev/architecture/)). A fresh
  database download is therefore a meaningful fallback, not the same request
  repeated under another command.

### OSV-Scanner 2.5.0 regression and 2.5.1 repair

OSV-Scanner does not get a trust exemption. Version 2.5.0 had the exact failure
shape this project is guarding against: `--offline-vulnerabilities` could print
"No issues found" without loading the intended cache
([issue 2983](https://github.com/google/osv-scanner/issues/2983)). Version 2.5.1
is the current release and explicitly fixes both the cache-directory regression
and local vulnerability matching
([2.5.1 release](https://github.com/google/osv-scanner/releases/tag/v2.5.1)).

That history makes a version pin necessary but insufficient. A live canary and
package-count assertion must prove that each invocation scanned real data.

### Local experiments

All paths below are repository-relative. The downloaded 2.5.1 binary matched its
published SHA-256 checksum and reported commit `c84fa45`.

| Case | Measured result |
|---|---|
| OSV online, current `pnpm-lock.yaml` | 311 packages extracted, zero affected packages, exit 0 |
| OSV online, one-package `lodash@4.17.20` pnpm fixture | Five GHSA records found, exit 1 |
| OSV online through a dead proxy | No clean output; the external 20-second bound terminated it with exit 124 |
| OSV 2.5.1 offline with an empty cache | Missing npm database named, exit 127 |
| OSV 2.5.1 offline with a corrupt database archive | Invalid zip named, exit 127 |
| OSV 2.5.1 fresh offline download, vulnerable fixture | 212 MiB npm database downloaded in 8.8 seconds; fixture detected, exit 1 |
| OSV fresh-download mode through a dead proxy with an existing cache | Refused to reuse the cache as a fresh result; download failure named, exit 127 |
| pnpm 11.25.0 against a dead registry, retries disabled | JSON error, exit 1 |
| pnpm 11.25.0 against the live npm bulk endpoint, 15-second fetch bound | JSON timeout error, exit 1 |

The raw pnpm 11 CLI did **not** reproduce an earlier handoff's false-clean
claim. The observed current problem is narrower and still release-blocking:
pnpm 10 targets retired endpoints; pnpm 11's replacement endpoint did not answer
within 15 seconds in this experiment; and the working-tree wrapper itself turns
unavailability into success outside `--strict`. The R/P artifacts must use this
corrected diagnosis rather than repeat the earlier claim.

The OSV package count of 311 exactly matched the number of entries under the
lockfile's `packages` map. `--all-packages` exposes that denominator in JSON, so
the gate can assert it rather than trusting a shrinking scan set.

## Options

| Option | Failure and coverage behavior | Cost / fit | Verdict |
|---|---|---|---|
| **OSV-Scanner 2.5.1 CLI: online first, fresh database fallback** | Distinguishes findings from tool failure; direct pnpm-lock support; aggregated OSV data; second delivery surface on API failure. A canary and package-count check defend against false-clean regressions. | New 56 MiB CI binary, not an npm or shipped dependency. Normal online scan measured under one second; fallback downloaded 212 MiB only when needed. Portable to GitHub and Forgejo. | **Recommended** |
| pnpm 11 audit only | Current CLI failed closed in tested error cases and uses the supported bulk endpoint. Native severity and GHSA ignore policy. | No new tool, but the live endpoint exceeded 15 seconds during research and is the same availability surface that blocked the prior gate. npm/GHSA-shaped data only. | Keep pnpm 11, but do not use this as the blocking scanner. |
| `audit-ci` over pnpm | Adds retries, policy, and a default fail-on-no-audit stance. | Delegates to the same package-manager audit command and registry surface; adds an npm dev dependency or an unpinned `dlx` download without adding a data source. | Decline. |
| GitHub dependency review | Official PR-delta enforcement; useful after the public flip. | GitHub-only, PR-delta-only, unavailable to the Forgejo second-opinion lane, and not a current-tree or release replacement. | Complementary future control, not this gate. |
| Trivy filesystem scan | Supports `pnpm-lock.yaml`, offline databases, severity filters, and many ecosystems. | Much broader tool than needed; findings exit 0 unless configured otherwise. It adds another policy layer without a demonstrated advantage for this single npm lockfile. | Decline for this scope. |
| Decline a blocking gate | No external-service availability cost. | Conflicts with current NIST/CISA lifecycle guidance, leaves the privileged build dependency tree unreviewed at merge and release, and does not satisfy the original dependency-review acceptance. | Decline. |

## Recommendation

Adopt the **OSV-Scanner 2.5.1 standalone CLI** as the blocking vulnerability
scanner in the shared verify script, which makes it apply to GitHub PR/main,
Forgejo branch, and release runs. Keep the pnpm 11.25.0 upgrade because pnpm 10's
audit protocol is retired and pnpm 11 also moves load-bearing overrides into
`pnpm-workspace.yaml`; remove the half-written `pnpm audit` gate and its native
`audit:` policy rather than operating two blocking scanners against overlapping
GHSA data.

The implementation plan should pin these properties:

1. Install the exact OSV-Scanner release as a CI tool, verify its published
   checksum and reported version, and add no package dependency or install script.
2. Preserve the local zero-runtime-dependency check independently of network
   scanning.
3. Run the real lockfile scan with `--format=json --all-packages`; accept only
   exit 0 plus valid JSON plus an extracted-package count equal to the lockfile
   `packages` cardinality.
4. Run a one-package known-vulnerable pnpm fixture through the same scanner and
   require exit 1 plus a pinned expected advisory ID. This proves the parser,
   data source, matcher, and result classifier all fired.
5. Put a bounded external timeout around online scanning. **ESTIMATE
   (unverified):** 30 seconds is likely sufficient given sub-second successful
   scans, but P must replace this estimate with repeated measurements before it
   becomes code.
6. On online general failure or timeout — never on a vulnerability finding —
   retry in a fresh temporary cache with a freshly downloaded npm OSV database.
   Accept no stale-cache fallback. If both paths fail, every lane fails loudly.
7. Gate every advisory by default. OSV-Scanner has no native minimum-severity
   threshold, its official action fails on any vulnerability by default, pnpm's
   own documented default is `low`, and the current tree is clean. Exceptions
   require an ID, reason, and expiry in `osv-scanner.toml`.
8. Amend ADR 0019 at owner sign-off: reverse the OSV decline, correct the pnpm
   diagnosis and severity-default claim, retain Dependabot as remediation, and
   record GitHub dependency review as complementary after the public flip.

This is a foundational dependency choice. The owner accepted the recommendation
on 2026-09-03. ADR 0019 is amended at decision time in this Research phase;
implementation still waits for the Plan phase and its deterministic pins.

## Decision and remaining question

Owner decision on 2026-09-03:

1. **Accepted:** OSV-Scanner 2.5.1 with online-first/fresh-database fallback is
   the sole blocking vulnerability scanner in every verify and release lane.
2. **Accepted:** all known advisories block by default, with only reasoned and
   expiring ID exceptions. This replaces ADR 0019's unsupported `high`
   threshold.

One empirical question remains for Plan: the exact online timeout. It must be
measured, not selected from taste.

## Self-review

- **Measured-or-flagged — pass.** Tool size, database size, timing, package
  counts, and exit codes are measured. The only proposed timeout is explicitly
  marked `ESTIMATE (unverified)` and assigned to a Plan-phase measurement.
- **Derived-value semantics — pass.** “Clean” means valid scanner JSON, exit 0,
  and equality between extracted packages and the lockfile `packages` map. Empty,
  missing, corrupt, timed-out, and vulnerability-bearing results have distinct
  meanings.
- **Emergent structure — pass.** The lockfile is one source containing 311
  package entries; output ordering is irrelevant; advisory aliases collapse
  together; exception cardinality is zero today and additions are explicit.
- **Batch/concurrency — pass.** Scans are read-only. Any fallback database uses a
  fresh run-local temporary cache, so parallel GitHub, Forgejo, and release runs
  do not share mutable state. There is no publish from this phase.
- **Inherited-constraints-grounded — pass.** The zero-runtime-dependency shape,
  pnpm 11 override relocation, shared verify script, two CI wrappers, and release
  invocation were checked against the current branch. The prior pnpm false-clean
  claim was retested and corrected rather than inherited.
