#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

echo '==> verify: install dependencies'
pnpm install --frozen-lockfile

# typecheck and lint both build first (typecheck runs tsc -p tsconfig.build.json,
# lint runs publint against dist/), so the build is not a separate step here.
echo '==> verify: typecheck'
pnpm run typecheck

echo '==> verify: lint'
pnpm run lint

echo '==> verify: unit tests'
pnpm run test

# Runs on every branch, not only at release. The gate is cheap (one pack) and the
# failure it exists to catch — a host path arriving in a shipped file — is
# permanent once published, so catching it at release time is already too late to
# be comfortable.
#
# This step FAILS CLOSED when gitleaks is not installed. That is deliberate; see
# scripts/ci/leak-gate.sh. Both CI wrappers install it before calling this.
echo '==> verify: tarball leak gate'
scripts/ci/leak-gate.sh

# Proves the gate can fail, every time it runs. A gate only ever observed
# passing has not been shown to work — and this one has already regressed once,
# silently, via a config merge that suppressed /home/ detection while still
# reporting green.
echo '==> verify: leak gate self-test'
scripts/ci/leak-gate-selftest.sh

# Same reasoning, different classifier. scripts/dolt-ref-inspect.sh reads what a
# refs/dolt/data ref would disclose, and its failure mode is looking like it
# worked: a loose pattern reports more findings, and more findings reads as a
# more thorough scan. Runs offline — the self-test drives the inspector's
# --classify mode over fixed strings, so no network and no remote is touched.
echo '==> verify: dolt ref inspector self-test'
scripts/dolt-ref-inspect-selftest.sh

# Proves the dependency gate's classifiers and fallback behavior over fixed
# process results before the live check. Hermetic: no OSV, npm, or other network
# service is contacted by this self-test.
echo '==> verify: dependency vulnerability gate self-test'
scripts/ci/audit-gate-selftest.sh

# The dependency vulnerability gate (shotwright-746.23, ADR 0019). The live
# current-lock and vulnerable-canary scans use OSV online first, then one fresh
# database fallback. Every unavailable or malformed result remains blocking.
echo '==> verify: dependency vulnerability gate'
scripts/ci/audit-gate.sh

# Third instance of the same reasoning, and the one with a measured incident
# behind it: on 2026-08-02 the local Dolt backup restored to zero issues while
# every size, file-count and freshness signal said it was healthy. The checker
# that catches that has to be shown catching it. Hermetic — a stub stands in for
# ssh and the "destination" is a temp directory, so this needs no NAS and no bd.
echo '==> verify: backup checker self-test'
scripts/backup-verify-selftest.sh
