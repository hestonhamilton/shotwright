#!/usr/bin/env bash
# Proves scripts/dolt-ref-inspect.sh classifies correctly — including the two
# ways its first draft was wrong.
#
# The classifier's failure mode is looking like it worked: a loose pattern
# reports more findings, and more findings reads as a more thorough scan. Only a
# fixed input with a known answer distinguishes "found everything" from "matched
# anything". So this drives the REAL script via its --classify mode over
# synthetic strings files, and asserts three things:
#
#   1. Each category fires on a seeded value of its own shape. A classifier that
#      cannot fire is not a classifier.
#
#   2. Neither of shotwright-2sr.1 §4.1's two measured false positives comes
#      back:
#        * `pnpm@10.33.0` must NOT be reported as a private-range IPv4. The
#          original pattern `10\.[0-9]` matched it.
#        * a UUID fragment must NOT be reported as a bead id. The original
#          pattern `[a-z][a-z0-9]{2,}-[0-9a-z]{2,}` matched it and reported it as
#          a foreign project prefix.
#
#   3. DISTINCT VALUES, NOT COUNTS. Given one address repeated 255 times — the
#      exact shape of R's first wrong answer — the report must say 1, not 255.
#      This is the assertion most likely to be quietly broken by a later "just
#      print the hit count, it's simpler" change, and it is the one that changed
#      a conclusion.
#
# No seeded value is a real address, host path, or credential; nothing here is
# sensitive, and scripts/ does not ship in the package tarball.
set -euo pipefail

LC_ALL=C
export LC_ALL

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
inspect="$root/scripts/dolt-ref-inspect.sh"
# "other" stands in for a sibling project's prefix; extra prefixes come from the env.
export DOLT_REF_INSPECT_PREFIXES="other"

[[ -x "$inspect" ]] || { echo "dolt-ref-inspect-selftest: FAILED — $inspect is missing or not executable" >&2; exit 1; }

work="$(mktemp -d -t dolt-ref-selftest.XXXXXX)"
trap 'rm -rf "$work"' EXIT

failures=0

# classify <case-name> <extra args...>  — reads strings on stdin, runs the real
# script, and leaves the listings in $work/<case-name>/out.
#
# Deliberately does NOT echo the output path: `out="$(classify x)" <<'EOF'`
# does not deliver the heredoc to the command substitution, so every must-fire
# check silently read an empty listing. Caught by this self-test on its first
# run — and it would have passed had it only contained must-NOT-fire checks,
# which is the reason each of those blocks carries a positive control.
classify() {
  local name="$1"; shift
  local dir="$work/$name"
  mkdir -p "$dir"
  cat > "$dir/strings.in"
  "$inspect" --classify "$dir/strings.in" --out "$dir/out" "$@" > "$dir/report.txt" 2>&1 \
    || { echo "  FAIL  $name: inspect exited non-zero" >&2; sed 's/^/        /' "$dir/report.txt" >&2; failures=$((failures + 1)); }
}

# expect_listed <category-file> <value> <label>
expect_listed() {
  local file="$1" value="$2" label="$3"
  if [[ -f "$file" ]] && grep -qxF "$value" "$file"; then
    echo "  ok    reported $label"
  else
    echo "  FAIL  did NOT report $label ($value) — a category that cannot fire is not a check" >&2
    echo "        listing was: $( [[ -f "$file" ]] && tr '\n' ' ' < "$file" || echo '<file absent>')" >&2
    failures=$((failures + 1))
  fi
}

# expect_absent <category-file> <value> <label>
expect_absent() {
  local file="$1" value="$2" label="$3"
  if [[ ! -f "$file" ]] || ! grep -qF "$value" "$file"; then
    echo "  ok    did not report $label"
  else
    echo "  FAIL  reported $label ($value) — a manufactured finding costs the same review time as a real one" >&2
    failures=$((failures + 1))
  fi
}

# expect_distinct_count <category-file> <n> <label>
expect_distinct_count() {
  local file="$1" want="$2" label="$3"
  local got=0
  [[ -f "$file" ]] && got="$(wc -l < "$file" | tr -d ' ')"
  if [[ "$got" -eq "$want" ]]; then
    echo "  ok    $label: $got distinct"
  else
    echo "  FAIL  $label: expected $want distinct, got $got" >&2
    failures=$((failures + 1))
  fi
}

echo '==> dolt-ref-inspect-selftest: every category fires on its own shape'
classify fires --expect-prefix shotwright <<'SEEDS'
contact: someone@example.invalid for the handover
outDir = "/home/operator/projects/thing/dist"
cacheDir: "C:\Users\operator\AppData\Local\thing"
db host is 192.168.77.13 on the lab segment
secondary at 10.4.2.9 and 172.20.5.6
the nas answers to vault.local and to shed.internal
GITHUB_TOKEN=ghp_0123456789abcdefghijABCDEFGHIJ0123
aws key AKIAABCDEFGHIJKLMNOP in the old runbook
postgres://svcuser:hunter2@db.example.invalid/appdb
closes shotwright-746.18.3 and blocks other-42
we should rotate the deploy token before the flip
SEEDS
out="$work/fires/out"

expect_listed "$out/emails.txt"       'someone@example.invalid'                    'an email address'
expect_listed "$out/host-paths.txt"   '/home/operator/projects/thing/dist'         'a POSIX host path'
expect_listed "$out/host-paths.txt"   'C:\Users\operator\AppData\Local\thing'      'a Windows profile path'
expect_listed "$out/private-ipv4.txt" '192.168.77.13'                              'a 192.168/16 address'
expect_listed "$out/private-ipv4.txt" '10.4.2.9'                                   'a 10/8 address'
expect_listed "$out/private-ipv4.txt" '172.20.5.6'                                 'a 172.16/12 address'
expect_listed "$out/hostnames.txt"    'vault.local'                                'a .local hostname'
expect_listed "$out/hostnames.txt"    'shed.internal'                              'an .internal hostname'
expect_listed "$out/credentials.txt"  'ghp_0123456789abcdefghijABCDEFGHIJ0123'     'a GitHub token'
expect_listed "$out/credentials.txt"  'AKIAABCDEFGHIJKLMNOP'                       'an AWS access key id'
expect_listed "$out/credentials.txt"  'postgres://svcuser:hunter2@db.example.invalid' 'a connection string with an inline password'
expect_listed "$out/bead-ids.txt"     'shotwright-746.18.3'                        'a known-prefix bead id'
expect_listed "$out/cross-project.txt" 'other-42'                                  'a cross-project bead id'

# Prose about secrets must land in its own category, not among the credentials.
# R measured 26 of these and 0 real credentials; one merged category would have
# read as 26 credentials and changed the disposition.
expect_absent "$out/credentials.txt" 'rotate' 'prose about a token as a credential'
if [[ -s "$out/credential-prose.txt" ]]; then
  echo '  ok    credential-shaped prose reported separately'
else
  echo '  FAIL  credential-shaped prose was not reported at all — the separation is the point' >&2
  failures=$((failures + 1))
fi

echo '==> dolt-ref-inspect-selftest: the two measured false positives stay dead'
# The positive controls on the first two lines are load-bearing: a classifier
# that reports nothing at all would satisfy every must-NOT-fire check below.
classify anchoring --expect-prefix shotwright <<'SEEDS'
control 10.99.42.7 is a genuine private address
control shotwright-999 is a genuine bead id
packageManager: "pnpm@10.33.0"
engines node >=20.11.0 and vite 10.2.3.4.5 in a changelog
runId 3f9a1c2e-4b7d-11ee-be56-0242ac120002 from the trace
sessionKey 829adda7-5fc1-416f-82b6-cfbb83fa6e48
version 172.10.0.1 is not an address either
SEEDS
out="$work/anchoring/out"

expect_listed "$out/private-ipv4.txt" '10.99.42.7'    'the private-IP positive control'
expect_listed "$out/bead-ids.txt"     'shotwright-999' 'the bead-id positive control'

# `10\.[0-9]` matched pnpm@10.33.0 in R's first run. Four anchored octets do not.
expect_absent "$out/private-ipv4.txt" '10.33.0'   'pnpm@10.33.0 as a private IP'
# 172.10 is outside 172.16/12 — the range boundary, not just the shape.
expect_absent "$out/private-ipv4.txt" '172.10.0.1' 'an out-of-range 172.x address'
expect_distinct_count "$out/private-ipv4.txt" 1 'private IPv4 (the control only)'

# `[a-z][a-z0-9]{2,}-[0-9a-z]{2,}` matched UUID fragments and called them
# foreign project prefixes.
expect_absent "$out/bead-ids.txt"      '4b7d' 'a UUID fragment as a bead id'
expect_absent "$out/cross-project.txt" '5fc1' 'a UUID fragment as a cross-project leak'
expect_distinct_count "$out/bead-ids.txt" 1 'bead ids (the control only)'

echo '==> dolt-ref-inspect-selftest: truncated fragments are still reported'
# `strings` splits values across .darc chunk boundaries, so a real leak can
# arrive truncated. Measured on the live shotwright ref: the host-path category
# reports `/Users/e`, a fragment of a bead note ABOUT paths — harmless, and
# visibly harmless to anyone reading the set. The tempting fix is a minimum path
# length, which would also drop the truncated real leak seeded below. Asserted
# here so that fix cannot be made quietly.
classify truncated <<'SEEDS'
/Users/e
/home/operat
SEEDS
out="$work/truncated/out"
expect_listed "$out/host-paths.txt" '/home/operat' 'a truncated real host path'
expect_listed "$out/host-paths.txt" '/Users/e'       'a short fragment (the cost of the above)'

echo '==> dolt-ref-inspect-selftest: distinct values, not hit counts'
# R reported "255 email hits" where the distinct set was 2 addresses plus
# chunk-boundary fragments. Same shape, known answer.
{
  for _ in $(seq 255); do echo 'repeated@example.invalid mentioned again'; done
  echo 'other@example.invalid'
} | classify distinct
out="$work/distinct/out"
expect_distinct_count "$out/emails.txt" 2 '255 mentions of 2 addresses'

echo '==> dolt-ref-inspect-selftest: a clean ref reports clean'
classify clean --expect-prefix shotwright <<'SEEDS'
the gallery renders a compare sheet for each run
screenshots videos and traces are regenerated every time
SEEDS
out="$work/clean/out"
for cat in emails credentials host-paths private-ipv4 hostnames bead-ids; do
  expect_distinct_count "$out/$cat.txt" 0 "$cat on clean prose"
done

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "dolt-ref-inspect-selftest: FAILED — $failures expectation(s) not met." >&2
  echo 'Do not loosen the patterns to make this pass. A looser pattern reports more and means less.' >&2
  exit 1
fi

echo '==> dolt-ref-inspect-selftest: PASSED — classifier demonstrated firing, demonstrated quiet, and demonstrated distinct'
