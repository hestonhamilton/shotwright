#!/usr/bin/env bash
# The tarball leak gate. Runs against the PACKED TARBALL, never the working tree.
#
# Why not the working tree: it carries local/, .env and docs/ that never ship
# (noise), and — the half that matters — it MISSES anything that reaches dist/
# through the build. Pack, extract, scan the extraction.
#
# Three layers:
#   A  file-set allowlist        scripts/ci/check-file-set.sh  (content-blind, default-deny)
#   B  shotwright-specific rules scripts/ci/gitleaks-tarball.toml
#   C  gitleaks default ruleset  (generic credential shapes, backstop under B)
#
# What this gate does NOT do is written down in docs/shotwright-746.18.2-plan.md
# section 2.5. Short version: it constrains the literal bytes of shipped files.
# It does not constrain computation, and it is not a security boundary.
#
# Usage: leak-gate.sh [path/to/prebuilt.tgz]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Pinned so a scanner whose rule engine drifts under a pinned config cannot
# change this gate's meaning silently.
#
# Confirmed against the release list on 2026-08-01: v8.30.1, published
# 2026-03-21, is the latest release.
#
# Do not take the version from the gitleaks README — its pre-commit example
# still shows 8.24.2, which was published 2025-03-22 and is over a year stale.
# Since gitleaks is feature-frozen and ships security patches only, running an
# old build forfeits the one kind of update it still receives.
GITLEAKS_PIN="8.30.1"

# Recorded baseline, re-measured on main after the four public-release changes
# landed (746.18.8 LICENSE, 746.23 audit gate, 746.18.9 README, 746.18.10
# CONTRIBUTING). Was 43 files / 42.8 kB at ea29346. LICENSE added the one new
# file and ~12 kB, all of it verbatim AGPL-3.0 text; the README rewrite added
# the remaining ~2 kB without adding a file. CONTRIBUTING.md does NOT ship.
#
# Measured on the merged tree, not on a feature branch — a size taken from a
# branch that is missing its siblings' changes is stale the moment it merges,
# which is how this number was briefly wrong. REPORTED, never asserted: a legitimate
# dist/ change moves these numbers, and a hard equality check would be edited
# away within two releases. Layer A is the check; this is situational awareness.
BASELINE_FILES=44
BASELINE_PACKED="57.2 kB"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tarball="${1:-}"
if [[ -n "$tarball" ]]; then
  [[ -f "$tarball" ]] || { echo "leak gate: no such tarball: $tarball" >&2; exit 2; }
  echo "==> leak gate: using prebuilt tarball $tarball"
else
  echo '==> leak gate: packing'
  # npm writes its file listing to stderr. Held back rather than suppressed:
  # noise here buries the gate's own verdict, but a real pack failure must still
  # be readable. The reviewable listing is a separate release-workflow step.
  if ! npm pack --pack-destination "$work" >/dev/null 2>"$work/pack.log"; then
    echo 'leak gate: npm pack failed' >&2
    cat "$work/pack.log" >&2
    exit 2
  fi
  tarball="$(find "$work" -maxdepth 1 -name '*.tgz' -print -quit)"
  [[ -n "$tarball" ]] || { echo 'leak gate: npm pack produced no tarball' >&2; exit 2; }
fi

echo '==> leak gate: extracting'
mkdir -p "$work/extract"
tar xzf "$tarball" -C "$work/extract"
pkg="$work/extract/package"
[[ -d "$pkg" ]] || { echo "leak gate: tarball has no package/ directory" >&2; exit 2; }

# --- Layer A --------------------------------------------------------------
echo '==> leak gate: layer A (file-set allowlist)'
"$root/scripts/ci/check-file-set.sh" "$pkg"

# --- Layers B and C -------------------------------------------------------
# FAIL CLOSED. A gate that skips its scan when the scanner is missing reports
# green on an unscanned tarball, which is worse than having no gate at all —
# it launders the absence of a check as the presence of a passing one.
if ! command -v gitleaks >/dev/null 2>&1; then
  cat >&2 <<EOF
leak gate: FAILED — gitleaks is not installed, so layers B and C did not run.

This is a failure, not a skip. An unscanned tarball must never report green.

  install: https://github.com/gitleaks/gitleaks/releases (pinned ${GITLEAKS_PIN})
EOF
  exit 1
fi

installed="$(gitleaks version 2>/dev/null | tr -d 'v[:space:]')"
if [[ "$installed" != "$GITLEAKS_PIN" ]]; then
  echo "leak gate: FAILED — gitleaks version mismatch: found '${installed}', pinned '${GITLEAKS_PIN}'" >&2
  echo "A different rule engine under a pinned config is a different gate. Install the pin or update GITLEAKS_PIN deliberately." >&2
  exit 1
fi

# TWO invocations, not one. Merging the shotwright rules into the default
# ruleset via [extend] suppresses the /home/ host-path detection outright — see
# the header of gitleaks-tarball.toml for the measurement. Keeping them separate
# is the fix, and it also means each layer can be reasoned about on its own.
#
# --redact so a true positive never prints the secret into a public Actions log.
# The effective config is the committed rules plus, when the operator sets
# SHOTWRIGHT_OPERATOR_LOGIN, a run-time rule for the workstation login. The
# login is never committed; see scripts/ci/leak-gate-config.sh.
config="$work/gitleaks-tarball.effective.toml"
"$root/scripts/ci/leak-gate-config.sh" "$config"

echo "==> leak gate: layer B — shotwright rules (gitleaks ${GITLEAKS_PIN})"
if [[ -n "${SHOTWRIGHT_OPERATOR_LOGIN:-}" ]]; then
  echo '    operator-login rule: on (from SHOTWRIGHT_OPERATOR_LOGIN)'
else
  echo '    operator-login rule: off (SHOTWRIGHT_OPERATOR_LOGIN unset; the committed handle rule still runs)'
fi
gitleaks dir \
  --no-banner \
  --redact \
  --config "$config" \
  "$pkg"

echo "==> leak gate: layer C — default credential ruleset (gitleaks ${GITLEAKS_PIN})"
gitleaks dir \
  --no-banner \
  --redact \
  "$pkg"

# --- Report ---------------------------------------------------------------
actual_files="$(find "$pkg" -type f | wc -l | tr -d '[:space:]')"
actual_size="$(du -h "$tarball" | cut -f1)"
echo
echo "==> leak gate: PASSED"
echo "    files:  ${actual_files}  (baseline ${BASELINE_FILES})"
echo "    packed: ${actual_size}  (baseline ${BASELINE_PACKED})"
if [[ "$actual_files" != "$BASELINE_FILES" ]]; then
  echo "    note: file count differs from the recorded baseline. Not a failure —"
  echo "          confirm the change is intended and update the baseline."
fi
