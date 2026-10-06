#!/usr/bin/env bash
# Fail-closed dependency vulnerability gate (shotwright-746.23, ADR 0019).
#
# The structured classifier lives in osv-gate.mjs. This stable shell entry point
# selects the reviewed platform hash and supplies no CI-configurable bypasses.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$#" -ne 0 ]]; then
  echo 'audit-gate.sh: this gate accepts no arguments' >&2
  exit 2
fi

# shellcheck source=scripts/ci/osv-scanner-pin.sh
source "$root/scripts/ci/osv-scanner-pin.sh"
osv_scanner_select_platform

scanner="$(command -v osv-scanner || true)"
if [[ -z "$scanner" ]]; then
  echo 'audit gate: INDETERMINATE — osv-scanner is not installed' >&2
  echo 'Run scripts/ci/install-osv-scanner.sh with a directory on PATH.' >&2
  exit 2
fi

exec node "$root/scripts/ci/osv-gate.mjs" \
  "$root" \
  "$scanner" \
  "$OSV_SCANNER_PIN" \
  "$OSV_SCANNER_SHA256"
