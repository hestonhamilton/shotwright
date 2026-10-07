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

# --- Bypass paths, end to end ------------------------------------------------
# The 2026-10-05 audit (C7) ran gitleaks over a seeded token three ways and got
# exit 0 each time: with GITLEAKS_CONFIG exported, with a .gitleaksignore in the
# working directory, and with a `gitleaks:allow` comment on the line. These
# cases drive the REAL gate (leak-gate.sh with a prebuilt tarball, so no
# `npm pack`) over a miniature package and assert it fails anyway. The seed is
# generated here and never lands in the repo tree.

echo '==> leak-gate-selftest: the gate cannot be switched off from outside the repo'

# head reads a bounded slice BEFORE tr filters it, so no producer is left
# writing into a closed pipe — `tr | head` dies of SIGPIPE under pipefail.
seed="ghp_$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-36)"
[[ ${#seed} -eq 40 ]] || { echo 'leak-gate-selftest: could not generate a seed token' >&2; exit 2; }

# A config that parses but can never fire. If the gate honoured GITLEAKS_CONFIG,
# layer C would run under this and the seed would pass.
empty_rules="$work/empty-rules.toml"
cat >"$empty_rules" <<'TOML'
title = "selftest: a ruleset that never fires"
[[rules]]
id = "never"
regex = '''\bselftest-never-matches-[0-9]{40}\b'''
TOML

# Builds package/{README.md,package.json,dist/cli.js} with the given cli.js body
# and packs it the way npm would, so layer A sees an allowlisted file set.
make_tarball() {
  local body="$1" name="$2"
  local dir="$work/tarball-$name"
  mkdir -p "$dir/package/dist"
  printf '# probe\n' >"$dir/package/README.md"
  printf '{"name":"probe","version":"0.0.0"}\n' >"$dir/package/package.json"
  printf '%s\n' "$body" >"$dir/package/dist/cli.js"
  tar czf "$dir.tgz" -C "$dir" package
  printf '%s' "$dir.tgz"
}

# Runs the real gate quietly; echoes its exit status; captures stderr for a
# message assertion.
run_gate() {
  local tarball="$1" log="$2"
  shift 2
  set +e
  env "$@" "$root/scripts/ci/leak-gate.sh" "$tarball" >"$log" 2>&1
  local status=$?
  set -e
  printf '%s' "$status"
}

expect_gate() {
  local want="$1" tarball="$2" label="$3" needle="$4"
  shift 4
  local log got
  log="$work/gate-$(basename "$tarball" .tgz).log"
  got="$(run_gate "$tarball" "$log" "$@")"
  if [[ "$got" == "$want" ]] && { [[ -z "$needle" ]] || grep -qF -- "$needle" "$log"; }; then
    echo "  ok    exit $want on $label"
  else
    echo "  FAIL  wanted exit $want on $label, got $got${needle:+ (or missing '$needle')}" >&2
    sed 's/^/        | /' "$log" >&2
    failures=$((failures + 1))
  fi
}

clean_tgz="$(make_tarball 'export const ok = true' clean)"
seeded_tgz="$(make_tarball "const token = \"$seed\"" seeded)"
allowed_tgz="$(make_tarball "const token = \"$seed\" // gitleaks:allow" allowed)"

expect_gate 0 "$clean_tgz"  'a clean miniature tarball' 'leak gate: PASSED'
expect_gate 1 "$seeded_tgz" 'a seeded token, plain' '' \
  SHOTWRIGHT_OPERATOR_LOGIN=
expect_gate 1 "$seeded_tgz" 'a seeded token with GITLEAKS_CONFIG pointed at a ruleset that never fires' '' \
  SHOTWRIGHT_OPERATOR_LOGIN= GITLEAKS_CONFIG="$empty_rules"
expect_gate 1 "$seeded_tgz" 'a seeded token with GITLEAKS_CONFIG_TOML carrying that ruleset' '' \
  SHOTWRIGHT_OPERATOR_LOGIN= GITLEAKS_CONFIG_TOML="$(cat "$empty_rules")"
expect_gate 1 "$allowed_tgz" 'a seeded token marked gitleaks:allow' 'gitleaks:allow marker' \
  SHOTWRIGHT_OPERATOR_LOGIN=

# The ignore-file path, at the scanner level: a .gitleaksignore in the working
# directory is honoured by default, so the gate's explicit empty ignore path is
# what keeps the repo's own ignore list away from shipped files. Both halves are
# asserted so the second cannot pass vacuously.
probe="$work/ignore-probe"
mkdir -p "$probe/tree"
printf 'const token = "%s"\n' "$seed" >"$probe/tree/dist.js"
printf 'tree/dist.js:github-pat:1\n' >"$probe/.gitleaksignore"
: >"$probe/empty.gitleaksignore"
if (cd "$probe" && gitleaks dir --no-banner --redact tree >/dev/null 2>&1); then
  echo '  ok    a .gitleaksignore in the working directory suppresses the seed by default'
else
  echo '  FAIL  the default ignore path did not suppress the seed; the next assertion proves nothing' >&2
  failures=$((failures + 1))
fi
if (cd "$probe" && gitleaks dir --no-banner --redact --gitleaks-ignore-path "$probe/empty.gitleaksignore" tree >/dev/null 2>&1); then
  echo '  FAIL  the explicit empty ignore path still let the working-directory .gitleaksignore apply' >&2
  failures=$((failures + 1))
else
  echo '  ok    the explicit empty ignore path keeps the working-directory .gitleaksignore out'
fi

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "leak-gate-selftest: FAILED — $failures expectation(s) not met." >&2
  echo 'Do not weaken the assertions to make this pass. Fix the rules.' >&2
  exit 1
fi

echo '==> leak-gate-selftest: PASSED — gate demonstrated failing and demonstrated quiet'
