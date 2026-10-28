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

expect_pass_with() {
  local label="$1" want="$2"; shift 2
  expect_pass "$label" "$@"
  if ! grep -Fq -- "$want" "$work/out.txt"; then
    echo "  FAIL  $label — missing expected output: $want" >&2
    failures=$((failures + 1))
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

# A real-shaped manifest references exactly one archive. Its field sequence
# and single archive/size pair were confirmed against a disposable bd backup.
echo '==> backup-verify-selftest: proven archive trees and legacy rollout'
tree="$work/proven/shotwright"
mkdir -p "$tree" "$work/bin"
archive='cg4djr5shs66anukobq4p366p5mkrif5.darc'
printf '5:__DOLT__:rq80sggfoo49kg5668thl7p93eckpg4b:dt2f9tunuufhp90fps55k1vuj68a46t4:00000000000000000000000000000000:%s:488\n' "${archive%.darc}" > "$tree/manifest"
printf 'disposable archive bytes\n' > "$tree/$archive"
digest="$($verify --digest "$tree")"
state "$tree/shotwright-backup-state.json" "$HEAD_NOW" 600
python3 - "$tree/shotwright-backup-state.json" "$digest" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, encoding='utf-8') as stream:
    state = json.load(stream)
state['working_set_proof'] = 'restore-matched'
state['archive_tree_sha256'] = sys.argv[2]
with open(path, 'w', encoding='utf-8') as stream:
    json.dump(state, stream)
PY
expect_pass_with 'D1 clean proven copy' 'WORKING root and status matched a disposable restore' \
  "$verify" --compare --local-head "$HEAD_NOW" --state "$tree/shotwright-backup-state.json" \
  --commit-known 1 --darc-count 1 --remote-digest "$digest" --now "$NOW"
expect_fail 'D2 changed destination bytes' 'digest differs' \
  "$verify" --compare --local-head "$HEAD_NOW" --state "$tree/shotwright-backup-state.json" \
  --commit-known 1 --darc-count 1 --remote-digest "$(printf '%064d' 0)" --now "$NOW"

cp "$tree/shotwright-backup-state.json" "$work/proven-state.json"
python3 - "$tree/shotwright-backup-state.json" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, encoding='utf-8') as stream:
    state = json.load(stream)
del state['archive_tree_sha256']
with open(path, 'w', encoding='utf-8') as stream:
    json.dump(state, stream)
PY
expect_fail 'D3 malformed new proof' 'malformed new proof' \
  "$verify" --compare --local-head "$HEAD_NOW" --state "$tree/shotwright-backup-state.json" \
  --commit-known 1 --darc-count 1 --now "$NOW"
cp "$work/proven-state.json" "$tree/shotwright-backup-state.json"

expect_pass_with 'D4 legacy copy passes existing checks with warning' 'legacy copy: working-set coverage unproven' \
  cmp_case "$work/s-current.json" 1 3
expect_fail 'D5 legacy copy still fails existing checks' 'ZERO archive files' \
  cmp_case "$work/s-current.json" 1 0

expect_pass 'D6 canonical tree accepts its manifest and archive' "$verify" --digest "$tree"
printf 'tamper\n' >> "$tree/$archive"
changed="$($verify --digest "$tree")"
[[ "$changed" != "$digest" ]] || { echo '  FAIL  D7 altered archive bytes kept the digest' >&2; failures=$((failures + 1)); }
echo '  ok    D7 altered archive bytes change the digest'
cp "$tree/manifest" "$work/manifest-good"
printf 'disposable archive bytes\n' > "$tree/$archive"
sed 's/:488$/:489/' "$work/manifest-good" > "$tree/manifest"
changed_manifest="$($verify --digest "$tree")"
[[ "$changed_manifest" != "$digest" ]] || { echo '  FAIL  D8 valid manifest change kept the digest' >&2; failures=$((failures + 1)); }
echo '  ok    D8 valid manifest change changes the digest'
cp "$work/manifest-good" "$tree/manifest"
rm "$tree/$archive"
expect_fail 'D9 missing archive' 'missing or extra entries' "$verify" --digest "$tree"
printf 'disposable archive bytes\n' > "$tree/$archive"
printf 'extra' > "$tree/extra.darc"
expect_fail 'D10 extra archive' 'missing or extra entries' "$verify" --digest "$tree"
rm "$tree/extra.darc"
rm "$tree/$archive"
ln -s manifest "$tree/$archive"
expect_fail 'D11 non-regular archive' 'non-regular entry' "$verify" --digest "$tree"

# Drive the exact observation parser used by push. The clean fixtures below
# preserve the field sets and envelopes captured from real bd SQL and a real
# restored Dolt CLI query; only the hashes have been replaced.
push="$root/scripts/backup-push.sh"
source <(sed -n '/^normalize_observation() {/,/^}/p' "$push")
cat > "$work/clean-bd.json" <<'JSON'
[{"branch":"main","commits":984,"deps":247,"head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","issues":162,"staged":null,"status":null,"table_name":null,"working_root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]
JSON
cat > "$work/clean-cli.json" <<'JSON'
{"rows":[{"branch":"main","commits":984,"deps":247,"head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","issues":162,"working_root":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}
JSON
normalize_observation "$work/clean-bd.json" > "$work/clean-bd.normal"
normalize_observation "$work/clean-cli.json" > "$work/clean-cli.normal"
if ! cmp -s "$work/clean-bd.normal" "$work/clean-cli.normal"; then
  echo '  FAIL  D12a real-shaped clean bd and CLI rows normalize differently' >&2
  failures=$((failures + 1))
else
  echo '  ok    D12a real-shaped clean bd and CLI rows normalize identically'
fi
python3 - "$work/clean-cli.json" "$work/partial-status.json" "$work/extra-field.json" <<'PY'
import json,sys
row=json.load(open(sys.argv[1],encoding='utf-8'))['rows'][0]
partial=dict(row,table_name=None)
extra=dict(row,unexpected=None)
for path,value in ((sys.argv[2],partial),(sys.argv[3],extra)):
    with open(path,'w',encoding='utf-8') as stream: json.dump({'rows':[value]},stream)
PY
if normalize_observation "$work/partial-status.json" >"$work/partial.normal" 2>&1; then
  echo '  FAIL  D12b partially missing status fields were accepted' >&2
  failures=$((failures + 1))
else
  echo '  ok    D12b partially missing status fields are rejected'
fi
if normalize_observation "$work/extra-field.json" >"$work/extra.normal" 2>&1; then
  echo '  FAIL  D12c unknown extra field was accepted' >&2
  failures=$((failures + 1))
else
  echo '  ok    D12c unknown extra field is rejected'
fi
# Disposable bd SQL and a restored Dolt CLI both emitted (config, 0, modified).
# These next rows deliberately vary one value at a time to test inequality.
observation() { # observation <file> <root> <table-or-null> <status-or-null>
  python3 - "$@" <<'PY'
import json,sys
path,root,table,status=sys.argv[1:]
row={'branch':'main','working_root':root,'issues':1,'deps':0,'commits':77,
     'head':'lnk7jagsjrbl4e37ch545qfohfasg54a','table_name':None if table=='null' else table,
     'staged':None if table=='null' else 0,'status':None if status=='null' else status}
with open(path,'w',encoding='utf-8') as stream: json.dump([row],stream)
PY
}
observation "$work/source.json" "$HEAD_NOW" config modified
normalize_observation "$work/source.json" > "$work/source.normal"
observation "$work/omitted.json" "$HEAD_OLD" null null
normalize_observation "$work/omitted.json" > "$work/omitted.normal"
[[ "$(cat "$work/source.normal")" != "$(cat "$work/omitted.normal")" ]] \
  || { echo '  FAIL  D12 omitted working row/root passed observation equality' >&2; failures=$((failures + 1)); }
observation "$work/changed-root.json" "$HEAD_OLD" config modified
normalize_observation "$work/changed-root.json" > "$work/changed-root.normal"
[[ "$(cat "$work/source.normal")" != "$(cat "$work/changed-root.normal")" ]] \
  || { echo '  FAIL  D13 changed WORKING root passed observation equality' >&2; failures=$((failures + 1)); }
observation "$work/changed-status.json" "$HEAD_NOW" config added
normalize_observation "$work/changed-status.json" > "$work/changed-status.normal"
[[ "$(cat "$work/source.normal")" != "$(cat "$work/changed-status.normal")" ]] \
  || { echo '  FAIL  D14 changed status passed observation equality' >&2; failures=$((failures + 1)); }
echo '  ok    D12–D14 omitted row, changed root, and changed status break the push equality gate'

# Full checker path, still hermetic: bd and ssh are both stubs. The bd JSON
# envelopes and fields below were checked against disposable bd SQL output.
# It exercises the post-proof local-status warning and remote digest round trip.
cat > "$work/bin/bd" <<'BDSTUB'
#!/usr/bin/env bash
case "$*" in
  *'from dolt_log where commit_hash'*) echo '[{"n":1}]' ;;
  *'from dolt_log order by date'*) echo '[{"commit_hash":"lnk7jagsjrbl4e37ch545qfohfasg54a"}]' ;;
  *'from dolt_status'*)
    [[ "${FAKE_STATUS_FAIL:-0}" == 0 ]] || exit 1
    if [[ "${FAKE_DIRTY:-0}" == 1 ]]; then
      echo '[{"table_name":"config","staged":0,"status":"modified"}]'
    else
      echo '[]'
    fi ;;
  *) exit 1 ;;
esac
BDSTUB
chmod +x "$work/bin/bd"
unlink "$tree/$archive"
printf 'disposable archive bytes\n' > "$tree/$archive"
printf '%s:%s:488\n' "$(cat "$work/manifest-good")" "${archive%.darc}" > "$tree/manifest"
expect_fail 'D11a duplicate archive reference' 'duplicate archive references' "$verify" --digest "$tree"
cp "$work/manifest-good" "$tree/manifest"
mkdir "$tree/extra-directory"
expect_fail 'D11b extra directory' 'missing or extra entries' "$verify" --digest "$tree"
rmdir "$tree/extra-directory"
full_check() {
  PATH="$work/bin:$PATH" FAKE_DIRTY="$1" SHOTWRIGHT_BACKUP_SSH="$work/ssh-ok" \
    SHOTWRIGHT_BACKUP_DEST="nas:$work/proven" \
    "$verify" --project "$work/fakeproject" --name shotwright --max-age 99999999
}
expect_pass_with 'D15 full clean proven copy' 'destination bytes match that snapshot' full_check 0
sed 's/:488$/:489/' "$work/manifest-good" > "$tree/manifest"
expect_fail 'D15a full verifier rejects a valid changed manifest' 'digest differs' full_check 0
cp "$work/manifest-good" "$tree/manifest"
if grep -Fq 'WARNING — local Dolt working set is dirty now' "$work/out.txt"; then
  echo '  FAIL  D15 clean local status emitted the dirty warning' >&2
  failures=$((failures + 1))
fi
expect_pass_with 'D16 full dirty proven copy warns with exit 0' \
  'backup-verify: WARNING — local Dolt working set is dirty now; this check proves the recorded snapshot, which may differ from the current working set.' full_check 1
unreadable_check() { FAKE_STATUS_FAIL=1 full_check 0; }
expect_fail 'D16a unreadable local status fails before an OK claim' 'could not read the current local' unreadable_check
if grep -Fq 'backup-verify: OK' "$work/out.txt"; then
  echo '  FAIL  D16a emitted OK before discovering unreadable local status' >&2
  failures=$((failures + 1))
fi
printf tamper >> "$tree/$archive"
expect_fail 'D17 full checker rejects altered destination bytes' 'digest differs' full_check 0
expect_fail 'D18 full checker fails on transport loss' 'could not be reached' \
  env PATH="$work/bin:$PATH" SHOTWRIGHT_BACKUP_SSH="$work/ssh-down" \
    SHOTWRIGHT_BACKUP_DEST="nas:$work/proven" \
    "$verify" --project "$work/fakeproject" --name shotwright --max-age 99999999
mkdir -p "$work/remote-no-python"
cat > "$work/remote-no-python/python3" <<'NO_PYTHON'
#!/usr/bin/env bash
exit 127
NO_PYTHON
cat > "$work/ssh-no-python" <<'SSH_NO_PYTHON'
#!/usr/bin/env bash
shift
export PATH="$REMOTE_NO_PY:$PATH"
exec bash -c "$*"
SSH_NO_PYTHON
chmod +x "$work/remote-no-python/python3" "$work/ssh-no-python"
expect_fail 'D18a remote Python preflight gives a clear diagnostic' 'python3 >= 3.8 is required' \
  env PATH="$work/bin:$PATH" REMOTE_NO_PY="$work/remote-no-python" \
    SHOTWRIGHT_BACKUP_SSH="$work/ssh-no-python" SHOTWRIGHT_BACKUP_DEST="nas:$work/proven" \
    "$verify" --project "$work/fakeproject" --name shotwright --max-age 99999999

# Exercise the real producer gate. These command stubs are the seam: bd never
# starts or connects to a server, Dolt only creates a disposable proof directory,
# and rsync/ssh can reach only $work. No production override is needed.
echo '==> backup-verify-selftest: hermetic push publication gate'
pbin="$work/push-bin"
pstage="$work/push-staging/disposable"
pdest="$work/push-dest"
mkdir -p "$pbin" "$pstage" "$work/push-tmp" "$work/push-project"
cp "$work/manifest-good" "$pstage/manifest"
printf 'disposable archive bytes\n' > "$pstage/$archive"
printf 'future staging metadata\n' > "$pstage/future-metadata"
cp "$work/clean-bd.json" "$work/push-source.json"
cp "$work/clean-cli.json" "$work/push-restored.json"
cat > "$pbin/bd" <<'BDPUSH'
#!/usr/bin/env bash
case "$*" in
  *'backup status'*) echo "$PUSH_STAGE" ;;
  *'backup sync'*) : ;;
  *'dolt_hashof_db()'*) cat "$PUSH_SOURCE" ;;
  *'select (select count(*) from issues)'*) echo '[{"issues":162,"deps":247,"commits":984,"head":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]' ;;
  *'from dolt_log where commit_hash'*) echo '[{"n":1}]' ;;
  *'select commit_hash from dolt_log order by date'*) echo '[{"commit_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]' ;;
  *'select table_name, staged, status from dolt_status'*) echo '[]' ;;
  *) echo "unexpected bd call: $*" >&2; exit 1 ;;
esac
BDPUSH
cat > "$pbin/dolt" <<'DOLTPUSH'
#!/usr/bin/env bash
case "$1" in
  backup)
    [[ "$2" == restore ]] || exit 1
    mkdir -p "$PWD/$4" ;;
  sql)
    if [[ "${PUSH_MISMATCH:-0}" == 1 ]]; then
      sed 's/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/00000000000000000000000000000000/' "$PUSH_RESTORED"
    else
      cat "$PUSH_RESTORED"
    fi ;;
  *) exit 1 ;;
esac
DOLTPUSH
cat > "$pbin/rsync" <<'RSYNCPUSH'
#!/usr/bin/env bash
args=()
while (($#)); do
  if [[ "$1" == -e ]]; then shift 2; continue; fi
  if [[ "$1" == nas:* ]]; then args+=("${1#nas:}"); else args+=("$1"); fi
  shift
done
/usr/bin/rsync "${args[@]}"
RSYNCPUSH
chmod +x "$pbin/bd" "$pbin/dolt" "$pbin/rsync"
push_case() {
  env PATH="$pbin:$PATH" TMPDIR="$work/push-tmp" \
    PUSH_STAGE="$pstage" PUSH_SOURCE="$work/push-source.json" \
    PUSH_RESTORED="$work/push-restored.json" PUSH_MISMATCH="$1" \
    SHOTWRIGHT_BACKUP_STAGING="$work/push-staging" \
    SHOTWRIGHT_BACKUP_DEST="nas:$pdest" SHOTWRIGHT_BACKUP_SSH="$work/ssh-ok" \
    "$push" --project "$work/push-project" --name disposable
}
expect_fail 'D19 mismatched restore blocks the real push' 'source changed or backup omitted data' push_case 1
if [[ -e "$pdest/disposable" || -e "$pstage/shotwright-backup-state.json" ]]; then
  echo '  FAIL  D19 created state or published after a mismatched restore' >&2
  failures=$((failures + 1))
else
  echo '  ok    D19 no new state and no publication'
fi
expect_pass_with 'D20 unknown staging metadata does not block a push' 'destination bytes match that snapshot' push_case 0
if [[ ! -f "$pdest/disposable/shotwright-backup-state.json" || -e "$pdest/disposable/future-metadata" ]]; then
  echo '  FAIL  D20 did not publish the selected archive tree' >&2
  failures=$((failures + 1))
else
  echo '  ok    D20 published only manifest and referenced archives'
fi

if [[ $failures -gt 0 ]]; then
  echo >&2
  echo "backup-verify-selftest: FAILED — $failures expectation(s) not met." >&2
  echo 'Do not relax the checker to make this pass. A backup checker that cannot' >&2
  echo 'be shown failing is the thing this whole bead exists to avoid.' >&2
  exit 1
fi

echo '==> backup-verify-selftest: PASSED — checker demonstrated failing on the section 2.1 case and quiet on healthy ones'
