# shotwright-746.18.16.4 — Dependency vulnerability gate verification

Date: 2026-09-04
Implementation under review: `0304e7b`

## Acceptance checklist

- [x] **A controlled vulnerable dependency is detected.** Both the hermetic
  orchestration matrix and live scans of the one-package `lodash@4.17.20`
  fixture exited as a finding and reported the pinned
  `GHSA-35jh-r3h4-6jhm` advisory. A current-tree finding does not enter the
  availability fallback.
- [x] **The current tree is reviewed and clean.** Online and freshly downloaded
  database scans each extracted all 311 entries in the lockfile's `packages`
  map, reported zero findings, and ran with zero policy exceptions.
- [x] **Unavailable advisory sources cannot report success.** The hermetic
  matrix proved one unavailable online path retries one isolated fresh-database
  pair, while two unavailable paths finish `INDETERMINATE` and nonzero.
- [x] **Malformed or incomplete responses cannot report success.** Malformed
  JSON on both paths, an empty result, wrong source, wrong/zero denominator,
  duplicate package, no-package exit, timeout, exit/result disagreement, and a
  missing or wrong canary all finished nonzero.
- [x] **The zero-runtime-dependency invariant is enforced before scanning.** An
  absent or empty `dependencies` map passed; a named runtime dependency failed
  before scanner identity or network work. The real manifest has no runtime
  dependencies or lifecycle install scripts.
- [x] **Both CI providers and the release lane enforce the shared policy.** The
  Forgejo run for `0304e7b` is green (`verify` and `shots`), and GitHub Release
  dry-run `33938034433` passed the shared gate and skipped the real publish.
  GitHub `verify` run `33938350718`, triggered by PR #53, also passed on the
  exact implementation commit. Its log records the same scanner identity,
  311-package clean result, zero exceptions, and live canary detection.
- [x] **ADR 0019 and the original dependency-review bead match the measured
  result.** ADR 0019 records OSV-Scanner 2.5.1 as the all-lane blocking gate,
  Dependabot as remediation, all-advisory default-deny policy, fresh-database
  fallback, and the public-flip boundary for alerts/security updates. The
  original review acceptance is independently met by the tool decision and the
  repeated clean current-tree review. `shotwright-746.23` remains open pending
  final Verify sign-off and owner approval to close it.

## Commands run

### Hermetic adversarial matrix

```bash
scripts/ci/audit-gate-selftest.sh
```

Truncated output:

```text
ok    corrupt scanner download is rejected before installation
ok    runtime dependency names are reported as a policy failure
ok    clean JSON requires exit 0 and the exact denominator
ok    findings fail regardless of severity metadata
ok    current classifier marks malformed JSON indeterminate
ok    current classifier marks wrong package count indeterminate
ok    online error uses one isolated fresh-database pair
ok    two unavailable sources fail indeterminate
ok    malformed output on both paths never becomes clean
ok    runtime dependency fails before scanner identity or network
==> audit-gate-selftest: PASSED
```

All 46 reported checks passed: three shell-level platform/integrity checks and
43 Node policy, classifier, deadline, and orchestration checks.

### Reviewed scanner install and live online pair

```bash
scripts/ci/install-osv-scanner.sh local/verify-bin
env PATH="$PWD/local/verify-bin:$PATH" scripts/ci/audit-gate.sh
```

The installer fetched the Linux amd64 asset, verified the repository-pinned
official checksum, and installed OSV-Scanner 2.5.1. The live gate reported:

```text
ok: zero runtime dependencies; 0 active exceptions
ok: pnpm lockfile schema 9.0 with 311 packages
ok: OSV-Scanner 2.5.1 matches the reviewed checksum
ok: 311 current packages clean; live canary detected
==> audit gate: PASSED
```

The independently installed `local/verify-bin` copy was also used by the full
lane below.

### Real fresh-database pair from an empty cache

```bash
mktemp -d local/osv-verify-cache.XXXXXX
mktemp -d local/osv-verify-output.XXXXXX
env OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=local/osv-verify-cache.lBW03c \
  local/verify-bin/osv-scanner scan source \
  --format=json --all-packages --verbosity=error \
  --config osv-scanner.toml \
  --offline-vulnerabilities --download-offline-databases \
  --lockfile pnpm-lock.yaml \
  > local/osv-verify-output.JAQUDy/current.json
set +e
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=local/osv-verify-cache.lBW03c \
  local/verify-bin/osv-scanner scan source \
  --format=json --all-packages --verbosity=error \
  --config /dev/null --offline-vulnerabilities \
  --lockfile test/fixtures/audit-gate/vulnerable/pnpm-lock.yaml \
  > local/osv-verify-output.JAQUDy/canary.json
canary_status=$?
set -e
printf 'canary_exit=%s\n' "$canary_status"
test "$canary_status" -eq 1
node --input-type=module -e '
import { readFileSync } from "node:fs"
import {
  classifyCanary,
  classifyCurrent,
  readPnpmLockPackageCount,
} from "./scripts/ci/osv-gate.mjs"
const count = readPnpmLockPackageCount(readFileSync("pnpm-lock.yaml", "utf8"))
const current = classifyCurrent({
  code: 0,
  stdout: readFileSync("local/osv-verify-output.JAQUDy/current.json", "utf8"),
}, "pnpm-lock.yaml", count)
const canary = classifyCanary({
  code: 1,
  stdout: readFileSync("local/osv-verify-output.JAQUDy/canary.json", "utf8"),
}, "test/fixtures/audit-gate/vulnerable/pnpm-lock.yaml")
console.log(JSON.stringify({ count, current, canary }, null, 2))
'
```

The cache began empty and grew to 213 MiB. Classification through the production
functions reported `packageCount: 311`, current `kind: clean` with zero
findings, and canary `kind: detected`, one package, including
`GHSA-35jh-r3h4-6jhm`. The canary command exited 1 as required.

### Lane wiring and package surface

```bash
rg -n "install-osv-scanner\.sh|scripts/ci/verify\.sh" \
  .github/workflows/verify.yml .forgejo/workflows/ci.yml \
  .github/workflows/release.yml scripts/ci/verify.sh
if rg -n "pnpm audit|known-advisories\.txt|--strict|^[[:space:]]*audit:" \
  .github .forgejo scripts package.json pnpm-workspace.yaml; then
  exit 1
else
  echo 'no retired audit mechanism in executable policy surfaces'
fi
node --input-type=module -e '
import { readFileSync } from "node:fs"
const manifest = JSON.parse(readFileSync("package.json", "utf8"))
const lifecycle = Object.keys(manifest.scripts ?? {})
  .filter((name) => /^(pre|post)?install$/.test(name))
console.log(JSON.stringify({
  runtimeDependencies: Object.keys(manifest.dependencies ?? {}),
  lifecycleInstallScripts: lifecycle,
  packageManager: manifest.packageManager,
}, null, 2))
'
```

Each of the three workflow wrappers installs OSV-Scanner and calls the shared
verify script. No executable policy surface retains the retired audit mechanism.
The manifest reported no runtime dependencies, no install lifecycle scripts,
and `pnpm@11.25.0`.

### Full local verification lane

The first unchanged run reached `attw`, where its internal `npm pack` could not
write npm's sandbox-read-only default cache (`EROFS`). Re-running with only that
cache redirected to the gitignored scratch area exercised the same repository
code:

```bash
env npm_config_cache="$PWD/local/npm-cache" \
  PATH="$PWD/local/verify-bin:$PATH" \
  scripts/ci/verify.sh
```

Truncated output:

```text
Done in 205ms using pnpm v11.25.0
All good!
Test Files  17 passed (17)
Tests  275 passed (275)
leak gate: layer A ok — 44 file(s), all covered by the allowlist
==> leak gate: PASSED
==> audit-gate-selftest: PASSED
ok: 311 current packages clean; live canary detected
==> audit gate: PASSED
==> backup-verify-selftest: PASSED
```

Typecheck, ESLint, publint, package-type checks, the unit suite, packed-file
allowlist, both leak layers, and all gate self-tests passed.

### Forgejo and GitHub Release

With the machine-local Forgejo environment loaded as documented in the
gitignored operator runbook:

```bash
scripts/forge-ci-status.sh 0304e7bbbf1af66a485cf7fa1799eea64624d32d
gh workflow run release.yml \
  --ref feat/shotwright-746.18.16-upgrade-pnpm-11 \
  -f dist-tag=next -f dry-run=true
gh run watch 33938034433 --exit-status --interval 5
```

Forgejo reported `GREEN: run #46: verify=success, shots=success`. GitHub Release
run `33938034433` completed successfully in 1m31s. Its log showed the reviewed
scanner install, 311 clean packages, the live canary, the packed tarball leak
gate, `DRY RUN — nothing is uploaded.`, and a skipped real `Publish` step.

### GitHub Verify

After owner approval to open PR #53:

```bash
gh pr checks 53 --watch --interval 5
```

GitHub `verify` run `33938350718` passed in 1m30s at implementation commit
`0304e7b`. Its log showed:

```text
==> install-osv-scanner: OSV-Scanner 2.5.1 installed
==> audit-gate-selftest: PASSED
ok: zero runtime dependencies; 0 active exceptions
ok: pnpm lockfile schema 9.0 with 311 packages
ok: OSV-Scanner 2.5.1 matches the reviewed checksum
ok: 311 current packages clean; live canary detected
==> audit gate: PASSED
```

## Observations

- “Clean” is jointly established by scanner exit, JSON structure, exact source,
  311/311 denominator equality, zero findings, and the vulnerable live canary;
  no single proxy carries the result.
- Vulnerable and indeterminate outcomes are both blocking but remain distinct:
  a validated finding is final, while an indeterminate online result receives
  exactly one complete retry through a fresh database. The tests demonstrated
  that neither condition can print a success banner.
- The standalone scanner does not alter the npm dependency graph or packed
  surface. The release tarball remained 44 allowlisted files with no leaks.
- Dependabot's npm version updates are configured now. Alerts and security
  updates remain explicitly dependent on the public flip or GitHub Code
  Security, as ADR 0019 states.
- No production defect was found. The one local `EROFS` was caused by the
  verifier sandbox's npm cache location and disappeared when the cache alone was
  redirected to a writable gitignored directory.

## Sign-off

**PASS.** Every acceptance case is independently satisfied. The local full lane,
Forgejo run #46, GitHub Release dry-run `33938034433`, and GitHub `verify` run
`33938350718` agree on the approved fail-closed policy and the clean current
tree. No production fixes were made during Verify.
