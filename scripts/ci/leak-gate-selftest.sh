#!/usr/bin/env bash
# Proves the leak gate can FAIL.
#
# A gate only ever observed passing has not been shown to work. This runs the
# real scanner against the real config over a synthetic tree, and asserts:
#
#   * each layer-B rule fires on a seeded leak of its own shape, AND
#   * none of them fire on the three strings that legitimately appear in a
#     correct tarball.
#
# The second half is the one that decays quietly. E9.R section 3.1 measured a
# naive scan being wrong three times on a clean tree; a gate that is wrong three
# times per release gets weakened or switched off by the third release. So the
# false-positive behaviour is asserted, not assumed.
#
# Wired into scripts/ci/verify.sh so it runs wherever the gate runs, rather than
# being a one-time manual check recorded in prose.
#
# Everything is written under a mktemp dir. No seed string ever lands in the repo
# tree, and scripts/ is not in `files` so this file never ships.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo 'leak-gate-selftest: FAILED — gitleaks is not installed, so the gate could not be proven.' >&2
  echo 'This is a failure, not a skip: an unproven gate must not report green.' >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The committed rules alone, whatever the operator's shell has exported.
config="$work/effective-base.toml"
SHOTWRIGHT_OPERATOR_LOGIN='' "$root/scripts/ci/leak-gate-config.sh" "$config"

failures=0

# Runs gitleaks over a one-file tree and echoes the rule ids it reported.
scan_for_rules() {
  local content="$1"
  local dir="$work/case-$2"
  mkdir -p "$dir"
  printf '%s\n' "$content" > "$dir/probe.txt"
  gitleaks dir --no-banner --redact --config "$config" \
    --report-format json --report-path "$dir/report.json" "$dir" >/dev/null 2>&1 || true
  if [[ -s "$dir/report.json" ]]; then
    # Rule ids only; avoids depending on jq being present.
    # `|| true` because "no findings" is a legitimate result here and would
    # otherwise fail the pipeline under `set -o pipefail`, taking the whole
    # script down before it could report anything.
    { grep -o '"RuleID": *"[^"]*"' "$dir/report.json" \
      | sed 's/.*"RuleID": *"\([^"]*\)".*/\1/' \
      | sort -u; } || true
  fi
}

expect_fires() {
  local rule="$1" content="$2" label="$3"
  local got
  got="$(scan_for_rules "$content" "fire-$rule")"
  if grep -qx "$rule" <<<"$got"; then
    echo "  ok    $rule fires on $label"
  else
    echo "  FAIL  $rule did NOT fire on $label — the gate would let this ship" >&2
    echo "        rules that did fire: ${got:-<none>}" >&2
    failures=$((failures + 1))
  fi
}

expect_silent() {
  local content="$1" label="$2" tag="$3"
  local got
  got="$(scan_for_rules "$content" "silent-$tag")"
  if [[ -z "$got" ]]; then
    echo "  ok    clean on $label"
  else
    echo "  FAIL  fired on $label, which is legitimate content — this is how a gate gets disabled" >&2
    echo "        rules that fired: $got" >&2
    failures=$((failures + 1))
  fi
}

echo '==> leak-gate-selftest: each layer-B rule fires on its own shape'
expect_fires host-path-posix   'const out = "/home/someone/projects/shotwright/dist"' 'a POSIX home path'
expect_fires host-path-windows 'const out = "C:\Users\someone\AppData\Local"'         'a Windows profile path'
expect_fires private-ipv4      'const host = "192.168.77.13"'                          'an RFC1918 address'
# Deliberately under /srv/ rather than /home/, so this asserts the username rule
# itself rather than being caught by host-path-posix first.
expect_fires operator-username-in-path 'cacheDir: "/srv/hestonhamilton/build"'         'the username in path position'

echo '==> leak-gate-selftest: no rule fires on legitimate tarball content'
expect_silent 'const url = "http://127.0.0.1:4173/"'                                      'the loopback gallery bind' loopback
expect_silent '"url": "git+https://github.com/hestonhamilton/shotwright.git"'              'package.json repository.url' repourl
expect_silent 'uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main'      'the reusable-workflow reference' uses

echo '==> leak-gate-selftest: the operator-login rule exists only when the login is supplied'
expect_silent 'user: probeuser@workstation' 'a login the gate was not told about' login-unset

config="$work/effective-login.toml"
SHOTWRIGHT_OPERATOR_LOGIN=probeuser "$root/scripts/ci/leak-gate-config.sh" "$config"
expect_fires operator-login 'user: probeuser@workstation'          'login@host with the login supplied'
expect_fires operator-login 'cacheDir: "/srv/probeuser/build"'     'the login in path position'
expect_silent 'const name = "probeusers"'                            'a longer word containing the login' login-word

# A login equal to the handle must inherit the handle rule's carve-outs.
config="$work/effective-handle.toml"
SHOTWRIGHT_OPERATOR_LOGIN=hestonhamilton "$root/scripts/ci/leak-gate-config.sh" "$config"
expect_silent '"url": "git+https://github.com/hestonhamilton/shotwright.git"'         'repository.url when the login equals the handle' login-repourl
expect_silent 'uses: hestonhamilton/shotwright/.github/workflows/shotwright.yml@main' 'the uses: reference when the login equals the handle' login-uses

if SHOTWRIGHT_OPERATOR_LOGIN='a b;c' "$root/scripts/ci/leak-gate-config.sh" "$work/bad.toml" 2>/dev/null; then
  echo '  FAIL  leak-gate-config.sh accepted a login that is not a plain token' >&2
  failures=$((failures + 1))
else
  echo '  ok    a login that is not a plain token is refused'
fi

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "leak-gate-selftest: FAILED — $failures expectation(s) not met." >&2
  echo 'Do not weaken the assertions to make this pass. Fix the rules.' >&2
  exit 1
fi

echo '==> leak-gate-selftest: PASSED — gate demonstrated failing and demonstrated quiet'
