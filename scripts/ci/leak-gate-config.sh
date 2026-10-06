#!/usr/bin/env bash
# Writes the EFFECTIVE layer-B gitleaks config to the path given as $1.
#
# It starts from scripts/ci/gitleaks-tarball.toml verbatim. The committed
# username rule there matches the GitHub handle, because that is the only name
# the repository may know. The workstation login is a different string, and it
# must never be committed — so when SHOTWRIGHT_OPERATOR_LOGIN is set, one more
# rule is appended at run time that matches that login as a whole word in any
# position: login@host, /srv/<login>/..., a bare mention. It carries the same
# repository-URL and reusable-workflow carve-outs as the handle rule, so a login
# that happens to equal the handle does not fire on package.json.
#
# CI leaves the variable unset and leak-gate.sh says so in its output. The
# committed rules are the floor; this is the operator's ceiling (746.18.21.1).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="${1:?usage: leak-gate-config.sh <out-file>}"

cp "$root/scripts/ci/gitleaks-tarball.toml" "$out"

login="${SHOTWRIGHT_OPERATOR_LOGIN:-}"
[[ -n "$login" ]] || exit 0

# A login is a plain token. Anything else is refused rather than interpolated
# into a regex and a TOML file — fail closed, do not sanitise.
if [[ ! "$login" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo 'leak gate: SHOTWRIGHT_OPERATOR_LOGIN must be a plain login (letters, digits, . _ -); refusing to build a rule from it' >&2
  exit 2
fi
# Within that character set only '.' is a regex metacharacter.
escaped="${login//./\\.}"

cat >> "$out" <<EOF

# Appended at run time by scripts/ci/leak-gate-config.sh from
# SHOTWRIGHT_OPERATOR_LOGIN. This block never exists in the committed file.
[[rules]]
id = "operator-login"
description = "Operator workstation login, in any position"
regex = '''(?i)\\b${escaped}\\b'''
tags = ["shotwright", "host-path"]

  [rules.allowlist]
  description = "Repository URL and reusable-workflow reference are required content (same carve-outs as operator-username-in-path)"
  regexTarget = "line"
  regexes = [
    '''(?:github\\.com|git@github\\.com)[:/]hestonhamilton''',
    '''uses:\\s*hestonhamilton/shotwright/''',
  ]
EOF
