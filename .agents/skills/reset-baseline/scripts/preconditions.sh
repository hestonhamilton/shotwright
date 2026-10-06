#!/usr/bin/env bash
# reset-baseline PR precondition check (Step 1).
#
# Mechanical guard for "is this PR safe to land?" — the judgment (Verify signed
# off, teardown scope, merge style) stays in SKILL.md. This only answers the one
# checkable question: is the PR OPEN, mergeable-CLEAN, and are all checks green?
#
# PASS only when ALL hold:
#   - state              == OPEN
#   - mergeStateStatus   == CLEAN
#   - every statusCheckRollup entry is SUCCESS (an empty rollup = no checks = ok)
# Otherwise FAIL, naming exactly which condition tripped (not-open / not-clean /
# the failing check names).
#
# Requires `gh` (and `jq`). If `gh` is missing, exits non-zero so the skill falls
# back to a manual green-check rather than assuming PASS.
#
# Usage:  scripts/preconditions.sh <pr-number>
set -uo pipefail

die() { echo "preconditions: $*" >&2; exit 2; }

[[ $# -eq 1 && -n "${1:-}" ]] || die "usage: preconditions.sh <pr-number>"
PR="$1"

command -v gh >/dev/null 2>&1 || die "gh not found on PATH — check the PR manually (state OPEN, mergeStateStatus CLEAN, all checks SUCCESS)"
command -v jq >/dev/null 2>&1 || die "jq not found on PATH"

json="$(gh pr view "$PR" --json state,mergeStateStatus,statusCheckRollup,baseRefName 2>/dev/null)" \
  || die "gh pr view $PR failed — is the PR number right and gh authed?"

# reset-baseline lands into the base branch; a PR targeting another branch (a stacked task
# branch, the wrong base) must NOT pass. Override for a non-default base: EXPECTED_BASE=...
EXPECTED_BASE="${EXPECTED_BASE:-main}"
state="$(jq -r '.state // ""' <<<"$json")"
merge="$(jq -r '.mergeStateStatus // ""' <<<"$json")"
base="$(jq -r '.baseRefName // ""' <<<"$json")"
# Non-SUCCESS check names (checks without a conclusion, e.g. pending, count too).
failing="$(jq -r '
  [.statusCheckRollup[]? | select((.conclusion // .state // "") != "SUCCESS")
   | (.name // .context // "unnamed")] | join(", ")' <<<"$json")"

reasons=()
[[ "$state" == "OPEN"  ]] || reasons+=("not-open (state=${state:-unknown})")
[[ "$merge" == "CLEAN" ]] || reasons+=("not-clean (mergeStateStatus=${merge:-unknown})")
[[ -z "$failing"       ]] || reasons+=("failing checks: $failing")
[[ "$base" == "$EXPECTED_BASE" ]] || reasons+=("wrong base (targets '${base:-unknown}', expected '$EXPECTED_BASE' — set EXPECTED_BASE to override)")

if [[ ${#reasons[@]} -eq 0 ]]; then
  echo "PASS: PR #$PR is OPEN, CLEAN, all checks green — safe to land."
  exit 0
fi

echo "FAIL: PR #$PR is not safe to land:" >&2
for r in "${reasons[@]}"; do echo "  - $r" >&2; done
exit 1
