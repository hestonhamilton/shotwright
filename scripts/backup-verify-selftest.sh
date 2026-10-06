#!/usr/bin/env bash
# Proves scripts/backup-verify.sh can FAIL.
#
# A backup checker that has only ever been observed passing has not been shown
# to work, and this repository has already been bitten twice by exactly that:
# the leak gate's suppressed rule, which reported green while not scanning for
# host paths at all, and the measured `bd backup sync` that exited 0 in 18ms
# having written the entire backup to local disk (plan section 2.1).
#
# The acceptance criterion this file exists to satisfy is narrow and worth
# quoting, because it is easy to satisfy in appearance only:
#
#     "asserts the checker FAILS on the plan section 2.1 silent-failure
#      scenario. A verifier with no demonstrated failure case does not
#      satisfy this bullet."
#
# That is case C3 and case P2 below.
#
# BOTH halves of the checker get positive controls. That is not symmetry for its
# own sake — it is the specific defect this repo hit in shotwright-2sr.3 step
# B1, where a heredoc never reached the classifier, so every must-fire check
# read empty output and every must-not-fire check passed by vacuum. A probe that
# always errors, or a rule set that always fails, would sail through every
# negative case here. P1, C1 and C2 are what stop that.
#
# Fully hermetic: a stub stands in for ssh, the "remote" is a mktemp directory,
# and no database is touched. It runs in CI, where there is no NAS and no bd.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verify="$root/scripts/backup-verify.sh"

[[ -x "$verify" ]] || { echo 'backup-verify-selftest: scripts/backup-verify.sh is missing or not executable' >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0

# Two real-shaped dolt commit hashes. The checker validates this shape before
# it will compare or interpolate anything that came off the wire.
readonly HEAD_NOW='lnk7jagsjrbl4e37ch545qfohfasg54a'
readonly HEAD_OLD='bn7s468jl09ksiir0r08oam8d74a76j3'
readonly NOW=1785000000   # fixed clock; nothing here depends on the wall clock

# --- stubs for ssh -------------------------------------------------------
# Ignores the host and runs the command locally, so the "destination" is a
# directory in $work. The paths inside the remote command are absolute, so it
# behaves exactly as it would over a real connection.
cat > "$work/ssh-ok" <<'STUB'
#!/usr/bin/env bash
shift            # drop the host
exec bash -c "$*"
STUB

cat > "$work/ssh-down" <<'STUB'
#!/usr/bin/env bash
echo 'ssh: connect to host port 22: No route to host' >&2
exit 255
STUB
chmod +x "$work/ssh-ok" "$work/ssh-down"

# --- fixtures ------------------------------------------------------------
# A healthy destination: archives present, state file naming the current head.
healthy="$work/dest-healthy"
mkdir -p "$healthy/shotwright"
for i in 1 2 3; do : > "$healthy/shotwright/fixture$i.darc"; done
cat > "$healthy/shotwright/shotwright-backup-state.json" <<JSON
{
  "last_dolt_commit": "$HEAD_NOW",
  "timestamp": "$(date -u -d "@$((NOW - 600))" +%Y-%m-%dT%H:%M:%SZ)",
  "issues": 68,
  "commits": 368
}
JSON

# Section 2.1: the push reported success and the destination does not exist.
absent="$work/dest-absent"
mkdir -p "$absent"

state() {   # state <file> <commit> <age-seconds> [issues] [commits]
  local f="$1" commit="$2" age="$3" issues="${4-68}" commits="${5-368}"
  cat > "$f" <<JSON
{
  "last_dolt_commit": "$commit",
  "timestamp": "$(date -u -d "@$((NOW - age))" +%Y-%m-%dT%H:%M:%SZ)",
  "issues": $issues,
  "commits": $commits
}
JSON
}

# --- harness -------------------------------------------------------------
expect_pass() {
  local label="$1"; shift
  if "$@" >"$work/out.txt" 2>&1; then
    echo "  ok    $label"
  else
    echo "  FAIL  $label — the checker rejected a HEALTHY case, so every failure below proves nothing" >&2
    sed 's/^/        /' "$work/out.txt" >&2
    failures=$((failures + 1))
  fi
}

expect_fail() {
  local label="$1" want="$2"; shift 2
  if "$@" >"$work/out.txt" 2>&1; then
    echo "  FAIL  $label — the checker PASSED. This is the shape of defect it exists to catch." >&2
    sed 's/^/        /' "$work/out.txt" >&2
    failures=$((failures + 1))
  elif ! grep -qi -- "$want" "$work/out.txt"; then
    echo "  FAIL  $label — failed, but not for the stated reason (wanted /$want/)" >&2
    sed 's/^/        /' "$work/out.txt" >&2
    failures=$((failures + 1))
  else
    echo "  ok    $label"
  fi
}

probe() { SHOTWRIGHT_BACKUP_SSH="$1" SHOTWRIGHT_BACKUP_DEST="$2" "$verify" --probe --name shotwright; }

echo '==> backup-verify-selftest: the probe half — can it tell a destination is not there?'

expect_pass 'P1 positive control: a healthy destination probes clean' \
  probe "$work/ssh-ok" "nas:$healthy"

expect_fail 'P2 section 2.1: the destination directory does not exist' 'no backup directory' \
  probe "$work/ssh-ok" "nas:$absent"

expect_fail 'P3 the destination host is unreachable (must FAIL, not skip)' 'could not be reached' \
  probe "$work/ssh-down" "nas:$healthy"

expect_fail 'P4 no destination configured at all' 'is not set' \
  env -u SHOTWRIGHT_BACKUP_DEST "$verify" --probe --name shotwright

expect_fail 'P5 the destination is not in host:path form' 'must be host:/path' \
  probe "$work/ssh-ok" "$healthy"

echo '==> backup-verify-selftest: the rules — what counts as a backup that landed?'

cmp_case() {   # cmp_case <state-file> <commit-known> <darc-count> [head]
  # `${4-}` not `${4:-}` — C10 passes an EXPLICIT empty head and must keep it.
  "$verify" --compare \
    --local-head "${4-$HEAD_NOW}" \
    --state "$1" --commit-known "$2" --darc-count "$3" \
    --now "$NOW" --max-age 86400
}

state "$work/s-current.json" "$HEAD_NOW" 600
expect_pass 'C1 positive control: destination is current' \
  cmp_case "$work/s-current.json" 1 3

# The ordinary healthy state on a timer: the board moved after the last push.
state "$work/s-behind.json" "$HEAD_OLD" 3600
expect_pass 'C2 positive control: destination is behind but genuine and fresh' \
  cmp_case "$work/s-behind.json" 1 3

: > "$work/s-empty.json"
expect_fail 'C3 section 2.1: nothing landed, so there is no state to read' 'no readable backup state' \
  cmp_case "$work/s-empty.json" 1 3

state "$work/s-nodata.json" "$HEAD_NOW" 600
expect_fail 'C4 the state file landed and the data did not' 'ZERO archive files' \
  cmp_case "$work/s-nodata.json" 1 0

state "$work/s-foreign.json" "$HEAD_OLD" 600
expect_fail 'C5 the destination holds a commit this database never had' 'never had' \
  cmp_case "$work/s-foreign.json" 0 3

state "$work/s-stale.json" "$HEAD_OLD" $((8 * 86400))
expect_fail 'C6 the copy is genuine but eight days old' 'past the' \
  cmp_case "$work/s-stale.json" 1 3

printf '{ "timestamp": "2026-08-02T00:00:00Z", "issues": 68, "commits": 368 }\n' > "$work/s-nocommit.json"
expect_fail 'C7 the state names no commit' 'names no commit' \
  cmp_case "$work/s-nocommit.json" 1 3

printf '{ "last_dolt_commit": "not-a-hash", "timestamp": "2026-08-02T00:00:00Z", "issues": 68, "commits": 368 }\n' > "$work/s-junk.json"
expect_fail 'C8 the commit field is not a dolt commit hash' 'not a dolt commit hash' \
  cmp_case "$work/s-junk.json" 1 3

state "$work/s-future.json" "$HEAD_NOW" -7200
expect_fail 'C9 the destination is timestamped in the future' 'FUTURE' \
  cmp_case "$work/s-future.json" 1 3

state "$work/s-ok.json" "$HEAD_NOW" 600
expect_fail 'C10 the local head could not be read, so there is no baseline' 'nothing to compare' \
  cmp_case "$work/s-ok.json" 1 3 ''

# The 2026-08-02 failure itself: a structurally perfect backup of nothing. Every
# other rule in this file passes on it.
state "$work/s-hollow.json" "$HEAD_NOW" 600 0 8
expect_fail 'C11 the destination restores to ZERO issues (the 2026-08-02 empty backup)' 'EMPTY backup' \
  cmp_case "$work/s-hollow.json" 1 76

printf '{ "last_dolt_commit": "%s", "timestamp": "2026-08-02T00:00:00Z" }\n' "$HEAD_NOW" > "$work/s-uncounted.json"
expect_fail 'C12 the state carries no counts, so nothing proved its content' 'no issue or commit counts' \
  cmp_case "$work/s-uncounted.json" 1 3

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "backup-verify-selftest: FAILED — $failures expectation(s) not met." >&2
  echo 'Do not relax the checker to make this pass. A backup checker that cannot' >&2
  echo 'be shown failing is the thing this whole bead exists to avoid.' >&2
  exit 1
fi

echo '==> backup-verify-selftest: PASSED — checker demonstrated failing on the section 2.1 case and quiet on healthy ones'
