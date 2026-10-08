#!/usr/bin/env bash
# Proves the OFF-MACHINE copy of a beads database actually advanced, by reading
# the destination back. Exits non-zero when it did not.
#
# Usage:
#   scripts/backup-verify.sh [--name <db>] [--project <dir>] [--max-age <seconds>]
#   scripts/backup-verify.sh --compare --local-head <h> --state <file> \
#                            --commit-known <0|1> --darc-count <n> \
#                            --now <epoch> --max-age <seconds>
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS (shotwright-2sr.3 step A4, plan sections 2.1 and 2.3)
#
# It does NOT read `bd backup status`, and that omission is the point.
#
#   * `bd backup status` reports bd's AUTOMATIC backup, which writes to a local
#     directory, under a heading that also names the off-machine destination.
#     "Last backup: 2s ago" there means the local copy is 2 seconds old. The
#     off-machine one can be arbitrarily older, and its own `Last sync` line is
#     the one nobody reads (plan section 2.3).
#   * A backup can report exit 0 having written nothing where it was meant to
#     go. That was MEASURED, not theorised: pointed at an absent `file://` path,
#     dolt recreated the whole destination tree on local disk, wrote a complete
#     backup into it, and exited 0 in 18ms (plan section 2.1). Every local
#     surface said green while the off-machine copy did not exist.
#   * Worse, and also measured (2026-08-02): bd's automatic backup — the one
#     that status line reports — restored to 0 issues and 8 commits while the
#     live database held 68 issues and 368. Its own `backup_state.json` named
#     the live head on one push and its own empty commit on the next. So that
#     file is not read here either. The state this script reads is the one
#     scripts/backup-push.sh writes, after cloning the copy and counting it.
#
# So the only honest question is "what is actually AT the destination right
# now", and the only way to answer it is to go and look. Everything below is
# that one question.
#
# WHAT IS CHECKED, and why each one is load-bearing:
#
#   1. the destination is reachable at all      — unreachable is a FAILURE, not
#                                                 a skip; see below
#   2. it holds content, not just metadata      — an empty directory with a
#                                                 stale state file next to it is
#                                                 exactly what a half-finished
#                                                 push leaves behind
#   3. its recorded commit is one THIS database — proves the destination holds
#      actually has                               our board and not some other
#                                                 project's, and that the state
#                                                 file was not simply fabricated
#   4. it recorded a non-empty board            — the empty-backup failure above
#                                                 passed every other check here
#   5. its timestamp is inside the threshold    — the backup can be genuine and
#                                                 still be from last month
#
# Check 3 is the one that would be easy to leave out and is the reason a
# corrupted-or-swapped destination cannot pass: a commit hash that this database
# has never heard of fails, no matter how fresh the file claims to be. It is
# also the check that actually caught the empty backup, on its first real run.
#
# FAILS CLOSED. If the destination cannot be reached, that is reported as a
# failure. A verifier that skips when it cannot check is a verifier that reports
# green on exactly the day the NAS is off.
#
# NO HOST NAMES OR PATHS IN THIS FILE. The destination comes from
# SHOTWRIGHT_BACKUP_DEST at runtime. This repository is public-facing, and a NAS
# address is the same shape of string the leak gate does NOT catch
# (shotwright-746.18.3).
#
# ---------------------------------------------------------------------------
# The script splits into two halves that can each be driven on their own, so
# scripts/backup-verify-selftest.sh can prove BOTH of them fail on demand
# without a NAS in the room. Same split as scripts/dolt-ref-inspect.sh
# --classify.
#
#   --probe    goes and looks at the destination, prints what it found, and
#              exits non-zero if it could not look. No database access.
#   --compare  applies the rules above to values given on the command line.
#              No network, no database.
#
# Neither half is allowed to pass by vacuum: the self-test drives a healthy
# destination and a healthy fact set through both and asserts they come back
# clean, because a probe that always errors and a rule set that always fails
# would otherwise satisfy every negative case in the suite.
set -euo pipefail

readonly DEFAULT_MAX_AGE=86400   # 24h. A daily timer that missed one run is
                                 # not yet an incident; two days is.

name=''
project=''
max_age="$DEFAULT_MAX_AGE"
mode='check'
local_head=''
state_file=''
commit_known=''
darc_count=''
now_epoch=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compare)      mode='compare'; shift ;;
    --probe)        mode='probe'; shift ;;
    --name)         name="${2:?--name needs a value}"; shift 2 ;;
    --project)      project="${2:?--project needs a value}"; shift 2 ;;
    --max-age)      max_age="${2:?--max-age needs a value}"; shift 2 ;;
    # Deliberately accepts an empty value, unlike its neighbours: "the local
    # head could not be read" is a state the rules must report on, not one the
    # argument parser should swallow.
    --local-head)   local_head="${2-}"; shift 2 ;;
    --state)        state_file="${2:?--state needs a value}"; shift 2 ;;
    --commit-known) commit_known="${2:?--commit-known needs a value}"; shift 2 ;;
    --darc-count)   darc_count="${2:?--darc-count needs a value}"; shift 2 ;;
    --now)          now_epoch="${2:?--now needs a value}"; shift 2 ;;
    -h|--help)      sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              echo "backup-verify: unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "backup-verify: FAILED — $*" >&2; exit 1; }
note() { echo "backup-verify: $*"; }

# A dolt commit hash. Validated before it is ever interpolated into SQL or
# compared, because it arrives from the DESTINATION — the one input to this
# script that is not under local control.
is_commit_hash() { [[ "$1" =~ ^[0-9a-v]{32}$ ]]; }

# ---------------------------------------------------------------------------
# The rules. Everything above this point gathers facts; this decides.
# ---------------------------------------------------------------------------
compare() {
  local head="$1" state="$2" known="$3" darcs="$4" now="$5" limit="$6"

  [[ -n "$head" ]] || fail 'the local database head commit could not be read, so there is nothing to compare the destination against'

  # 1. Something is there at all.
  [[ -s "$state" ]] || fail 'the destination has no readable backup state — nothing has landed there, or it did not finish'

  # `|| true` on both: a MISSING field is a case this function is required to
  # report on, and without it `set -o pipefail` turns grep's empty result into a
  # silent exit before the rule below can say anything. The self-test's C7 found
  # this — the checker died wordlessly on a state file with no commit in it.
  local remote_commit remote_ts
  remote_commit="$({ grep -o '"last_dolt_commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$state" \
    | sed 's/.*"\([^"]*\)"$/\1/' | head -1; } || true)"
  remote_ts="$({ grep -o '"timestamp"[[:space:]]*:[[:space:]]*"[^"]*"' "$state" \
    | sed 's/.*"\([^"]*\)"$/\1/' | head -1; } || true)"

  [[ -n "$remote_commit" ]] || fail 'the destination state names no commit — it is not a backup state file'
  is_commit_hash "$remote_commit" \
    || fail "the destination state names '$remote_commit', which is not a dolt commit hash"

  # 2. Content, not just metadata. A state file beside an empty directory is
  #    what an interrupted push leaves, and it reads as success.
  [[ "$darcs" =~ ^[0-9]+$ ]] || fail "could not count archives at the destination (got '$darcs')"
  [[ "$darcs" -gt 0 ]] \
    || fail 'the destination holds a backup state but ZERO archive files — the metadata landed and the data did not'

  # 3. It is THIS database. See the header: this is the check that makes a
  #    swapped, stale-from-elsewhere or fabricated destination fail.
  [[ "$known" == '1' ]] \
    || fail "the destination is at commit $remote_commit, which this database has never had — the destination holds some other database, or its state file is not describing what is next to it"

  # 4. It has a board in it. scripts/backup-push.sh establishes this by cloning
  #    and counting before it sends anything; this is the destination's own
  #    record of that, and the reason it is checked separately is that on
  #    2026-08-02 a 7.5MB backup of 76 archive files restored to zero issues.
  local remote_issues remote_commits
  remote_issues="$({ grep -o '"issues"[[:space:]]*:[[:space:]]*[0-9]*' "$state" | grep -o '[0-9]*$' | head -1; } || true)"
  remote_commits="$({ grep -o '"commits"[[:space:]]*:[[:space:]]*[0-9]*' "$state" | grep -o '[0-9]*$' | head -1; } || true)"
  [[ "$remote_issues" =~ ^[0-9]+$ && "$remote_commits" =~ ^[0-9]+$ ]] \
    || fail 'the destination state records no issue or commit counts — it was not written by scripts/backup-push.sh, so nothing has proven its content'
  (( remote_issues > 0 && remote_commits > 0 )) \
    || fail "the destination records $remote_issues issues and $remote_commits commits — it is an EMPTY backup, which is the 2026-08-02 failure and is invisible to every size and freshness check"

  # 5. Fresh enough.
  [[ -n "$remote_ts" ]] || fail 'the destination state carries no timestamp, so its age cannot be established'
  local remote_epoch age
  remote_epoch="$(date -u -d "$remote_ts" +%s 2>/dev/null || true)"
  [[ -n "$remote_epoch" ]] || fail "the destination timestamp '$remote_ts' could not be parsed"
  age=$(( now - remote_epoch ))
  (( age >= 0 )) || fail "the destination is timestamped $(( -age ))s in the FUTURE — clock skew or a hand-edited state file"
  (( age <= limit )) \
    || fail "the destination copy is ${age}s old, past the ${limit}s threshold — the push has been failing quietly"

  if [[ "$remote_commit" == "$head" ]]; then
    note "OK — destination is current at $remote_commit (${age}s old, $darcs archives, $remote_issues issues / $remote_commits commits)"
  else
    # Behind but genuine and inside the window: the board moves between runs, so
    # this is the ordinary healthy state, not a warning.
    note "OK — destination is at $remote_commit, a real earlier state of this database (${age}s old, $darcs archives, $remote_issues issues / $remote_commits commits); local head is $head"
  fi
}

if [[ "$mode" == 'compare' ]]; then
  compare "$local_head" "$state_file" "$commit_known" "$darc_count" \
          "${now_epoch:-$(date -u +%s)}" "$max_age"
  exit 0
fi

# ---------------------------------------------------------------------------
# Gathering the facts the rules need. One round trip for all of them: whether
# the directory exists, how many archives are in it, and its backup state.
# ---------------------------------------------------------------------------
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="${project:-$root}"
name="${name:-$(basename "$project")}"

probe() {
  local dest="${SHOTWRIGHT_BACKUP_DEST:-}"
  [[ -n "$dest" ]] || fail 'SHOTWRIGHT_BACKUP_DEST is not set — see docs/backup.md. Refusing to report on a destination nobody named.'
  [[ "$dest" == *:* ]] || fail "SHOTWRIGHT_BACKUP_DEST must be host:/path, got '$dest'"

  local ssh_cmd="${SHOTWRIGHT_BACKUP_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=10}"
  local dest_host="${dest%%:*}"
  local remote_dir="${dest#*:}/$name"

  if ! $ssh_cmd "$dest_host" "
      set -eu
      d='$remote_dir'
      [ -d \"\$d\" ] || { echo 'MISSING'; exit 0; }
      echo 'DARCS' \$(find \"\$d\" -maxdepth 1 -name '*.darc' | wc -l)
      echo 'STATE'
      cat \"\$d/shotwright-backup-state.json\" 2>/dev/null || true
    " > "$work/remote.txt" 2>"$work/err.txt"; then
    echo 'backup-verify: transport error talking to the destination:' >&2
    sed 's/^/  /' "$work/err.txt" >&2
    fail 'the destination could not be reached. This is a failure and not a skip — an unreachable backup is indistinguishable from an absent one.'
  fi

  if grep -qx 'MISSING' "$work/remote.txt"; then
    fail "there is no backup directory at the destination for '$name' — nothing has ever landed, or it was removed"
  fi
}

if [[ "$mode" == 'probe' ]]; then
  probe
  cat "$work/remote.txt"
  exit 0
fi

# The local head. `bd sql` is the sanctioned path to the database (CLAUDE.md
# forbids raw `dolt` against a running server), and dolt_log is the ground truth
# that `bd backup status` paraphrases badly.
head_json="$(bd -C "$project" sql --json -q \
  'select commit_hash from dolt_log order by date desc limit 1;' 2>/dev/null || true)"
local_head="$({ grep -o '"commit_hash"[[:space:]]*:[[:space:]]*"[^"]*"' <<<"$head_json" \
  | sed 's/.*"\([^"]*\)"$/\1/' | head -1; } || true)"
is_commit_hash "${local_head:-}" || fail "could not read the local head commit for '$name'"

probe

darc_count="$(awk '/^DARCS /{print $2; exit}' "$work/remote.txt")"
awk 'f{print} /^STATE$/{f=1}' "$work/remote.txt" > "$work/state.json"

# Does this database know the commit the destination claims? Validated first —
# it came off the wire.
commit_known=0
remote_commit="$({ grep -o '"last_dolt_commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$work/state.json" \
  | sed 's/.*"\([^"]*\)"$/\1/' | head -1; } || true)"
if is_commit_hash "${remote_commit:-}"; then
  known_json="$(bd -C "$project" sql --json -q \
    "select count(*) as n from dolt_log where commit_hash = '$remote_commit';" 2>/dev/null || true)"
  grep -q '"n"[[:space:]]*:[[:space:]]*0' <<<"$known_json" || commit_known=1
  # An unreadable answer must not read as "known".
  grep -q '"n"' <<<"$known_json" || commit_known=0
fi

note "destination: $name at ${SHOTWRIGHT_BACKUP_DEST%%:*} (path not logged — public-facing)"
compare "$local_head" "$work/state.json" "$commit_known" "${darc_count:-0}" \
        "$(date -u +%s)" "$max_age"
