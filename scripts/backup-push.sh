#!/usr/bin/env bash
# Backs a beads database up off-machine over ssh, having first PROVEN that the
# thing being sent actually contains the board.
#
# Usage:
#   scripts/backup-push.sh [--project <dir>] [--name <db>] [--quiet]
#
# Requires SHOTWRIGHT_BACKUP_DEST=<host>:<absolute-path> in the environment.
# Run on a schedule by the systemd user timer scripts/backup-install.sh writes.
# Safe to run by hand at any time: it observes the database, refreshes its own
# staging directory, and publishes only after a disposable restore proof.
#
# ---------------------------------------------------------------------------
# WHY THIS SHAPE (shotwright-2sr.3, owner decision 2026-08-02)
#
# The board's only copy is a Dolt ref in a GitHub repository headed for public.
# That ref has to go, and it cannot go until a replacement exists and has been
# restored from.
#
# The plan (ADR 0014) called for a Dolt remotesapi endpoint on the NAS. The
# owner replaced it with plain rsync-over-ssh: the machine already has ssh to
# the NAS and bd already knows how to write a Dolt backup, so a backup server is
# a component with no job. Recorded as ADR 0016.
#
# That substitution keeps what ADR 0014 was actually protecting against, which
# is worth spelling out because the reason is NOT "network good, files bad":
#
#   Plan section 2.1 measured `bd backup sync` against an ABSENT `file://` path
#   — the unmounted-NAS case — and got exit 0, "Backup synced in 18ms", and a
#   fresh status line. Dolt had recreated the destination on local disk and
#   written a complete backup into it. Green forever, on the same disk as the
#   thing being backed up.
#
#   That needs a local path that can be silently conjured. `rsync -e ssh` has
#   none: if the host is down, ssh exits non-zero and rsync writes nothing
#   anywhere. There is no local directory standing in for the destination.
#
# WHY THE CONTENT IS PROVEN ON EVERY RUN, AND NOT AT DRILL TIME
#
# Because the obvious source was empty and nothing said so. MEASURED 2026-08-02,
# restoring the first pushed copy back into a fresh database:
#
#   `.beads/backup/` — bd's AUTOMATIC backup, the one `bd backup status` reports
#   every 15 minutes as seconds old — restored cleanly to 0 issues, 0
#   dependencies and 8 commits. The live database at that moment had 68 issues,
#   104 dependencies and 368 commits. 7.5 MB and 76 archive files of schema and
#   nothing else.
#
# The MANUAL path — `bd backup init <dir>` then `bd backup sync` — restored to
# 68 / 104 / 368, an exact match. So the mechanism is sound and only the
# automatic path is broken. This script therefore drives the manual path into a
# staging directory it owns, and ignores `.beads/backup/` entirely.
#
# Every check that does not read the CONTENT passes on that empty backup: file
# count, byte size, freshness, and bd's own `backup_state.json`, whose
# `last_dolt_commit` named the live head on one push and the empty database's
# own commit on the next. Each run restores a snapshot and compares its WORKING
# root and status with one post-sync source observation before a byte is sent.
#
# WHY THE COPY IS SNAPSHOTTED BEFORE IT IS SENT
#
# A Dolt backup is content-addressed: the `.darc` archives are immutable and
# `manifest` is the single mutable pointer at them. A copy is consistent exactly
# when its manifest is no NEWER than its content. So content is staged first and
# the pointer second, and the same order is repeated on the wire — a connection
# dropped mid-push leaves the destination pointing at its previous complete
# state rather than at chunks that never arrived.
#
# NO HOST NAMES OR PATHS IN THIS FILE (public-facing). The destination comes
# from the environment; the systemd unit carrying it is generated at install
# time and lives outside the repository.
set -euo pipefail

project=''
name=''
quiet=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project="${2:?--project needs a value}"; shift 2 ;;
    --name)    name="${2:?--name needs a value}"; shift 2 ;;
    --quiet)   quiet=1; shift ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         echo "backup-push: unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { [[ "$quiet" -eq 1 ]] || echo "backup-push: $*"; }
die() { echo "backup-push: FAILED — $*" >&2; exit 1; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="${project:-$root}"
name="${name:-$(basename "$project")}"

dest="${SHOTWRIGHT_BACKUP_DEST:-}"
[[ -n "$dest" ]] || die 'SHOTWRIGHT_BACKUP_DEST is not set — see docs/backup.md'
[[ "$dest" == *:* ]] || die "SHOTWRIGHT_BACKUP_DEST must be host:/path, got '$dest'"
dest_host="${dest%%:*}"
remote_dir="${dest#*:}/$name"

ssh_cmd="${SHOTWRIGHT_BACKUP_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=10}"

# Staging lives outside the repository: it is machine state, not project state,
# and one of the databases backed up here is not this project at all.
staging_root="${SHOTWRIGHT_BACKUP_STAGING:-${XDG_STATE_HOME:-$HOME/.local/state}/beads-backup}"
staging="$staging_root/$name"
readonly STATE_FILE='shotwright-backup-state.json'

command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1 \
  || die 'python3 >= 3.8 is required'
command -v dolt >/dev/null 2>&1 \
  || die 'dolt is not on PATH, and without it the content of a backup cannot be proven before it is sent'
command -v sha256sum >/dev/null 2>&1 \
  || die 'sha256sum is not on PATH, and without it the staging manifest cannot be checked for changes'

# --- ask the live database what it holds ---------------------------------
# `bd sql` is the sanctioned path (CLAUDE.md forbids raw `dolt` against the
# running server). Only the scratch clone below uses `dolt`, and it operates on
# its own temporary directory, never on the server's data.
live_json="$(bd -C "$project" sql --json -q \
  'select (select count(*) from issues) as issues,
          (select count(*) from dependencies) as deps,
          (select count(*) from dolt_log("--all")) as commits,
          (select commit_hash from dolt_log order by date desc limit 1) as head;' 2>/dev/null || true)"

field() { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"\?[^,\"}]*" <<<"$live_json" \
  | sed 's/.*:[[:space:]]*"\?//' | head -1; } || true; }

live_issues="$(field issues)"; live_deps="$(field deps)"
live_commits="$(field commits)"; live_head="$(field head)"

[[ "$live_head" =~ ^[0-9a-v]{32}$ ]] || die "could not read the live head commit for '$name' — is the bd server up?"
[[ "$live_issues" =~ ^[0-9]+$ && "$live_commits" =~ ^[0-9]+$ ]] \
  || die "could not read row counts for '$name'"
log "live: $live_issues issues, $live_deps dependencies, $live_commits commits, head ${live_head:0:12}"

# --- refresh the staging copy via bd's MANUAL path ------------------------
mkdir -p "$staging"
configured="$(bd -C "$project" backup status 2>/dev/null | grep -c "$staging" || true)"
if [[ "$configured" -eq 0 ]]; then
  log "pointing bd's backup destination at the staging directory (first run for '$name')"
  bd -C "$project" backup init "$staging" >/dev/null \
    || die "could not configure a backup destination for '$name'"
fi

bd -C "$project" backup sync >/dev/null \
  || die "bd backup sync failed for '$name'"
[[ -f "$staging/manifest" ]] || die "bd backup sync reported success and wrote no manifest to the staging directory for '$name'"

# --- one post-sync observation, including an empty status result ----------
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

proof_query='SELECT active_branch() AS branch, dolt_hashof_db() AS working_root,
  (SELECT COUNT(*) FROM issues) AS issues,
  (SELECT COUNT(*) FROM dependencies) AS deps,
  (SELECT COUNT(*) FROM dolt_log("--all")) AS commits,
  (SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1) AS head,
  s.table_name, s.staged, s.status
  FROM (SELECT 1) AS one_row LEFT JOIN dolt_status AS s ON TRUE
  ORDER BY s.table_name, s.staged, s.status'
bd -C "$project" sql --json -q "$proof_query" >"$work/source.json" 2>/dev/null \
  || die 'could not observe the source after sync'

normalize_observation() {
  python3 - "$1" <<'PY'
import json
import re
import sys

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key] = value
    return result

try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        rows = json.load(stream, object_pairs_hook=unique)
    if isinstance(rows, dict) and set(rows) == {'rows'}:
        rows = rows['rows']
    if not isinstance(rows, list) or not rows:
        raise ValueError('missing observation rows')
    scalars = ('branch', 'working_root', 'issues', 'deps', 'commits', 'head')
    first = tuple(rows[0][key] for key in scalars)
    if not isinstance(first[0], str) or not first[0] or not re.fullmatch(r'[0-9a-v]{32}', first[1]):
        raise ValueError('missing branch or WORKING root')
    if any(type(value) is not int or value < 0 for value in first[2:5]) or not re.fullmatch(r'[0-9a-v]{32}', first[5]):
        raise ValueError('malformed counts')
    tuples = []
    status_fields = {'table_name', 'staged', 'status'}
    for row in rows:
        fields = set(row)
        if fields not in (set(scalars), set(scalars) | status_fields):
            raise ValueError('missing or extra field')
        if tuple(row[key] for key in scalars) != first:
            raise ValueError('disagreeing scalar fields')
        # The Dolt CLI omits all three null columns on a clean LEFT JOIN row;
        # bd SQL includes them. Only the complete omission means empty status.
        item = (tuple(row[key] for key in ('table_name', 'staged', 'status'))
                if status_fields <= fields else (None, None, None))
        if item == (None, None, None):
            if len(rows) != 1:
                raise ValueError('mixed empty status')
        elif not isinstance(item[0], str) or not item[0] or type(item[1]) is not int or item[1] not in (0, 1) or not isinstance(item[2], str) or not item[2]:
            raise ValueError('malformed status tuple')
        else:
            tuples.append(item)
    print(json.dumps({'branch': first[0], 'working_root': first[1], 'issues': first[2], 'deps': first[3], 'commits': first[4], 'head': first[5], 'status': sorted(tuples)}, sort_keys=True))
except (OSError, ValueError, KeyError, TypeError, UnicodeError) as error:
    sys.exit('invalid observation: ' + str(error))
PY
}
normalize_observation "$work/source.json" >"$work/source.normal" 2>/dev/null \
  || die 'could not validate the post-sync source observation'

# --- snapshot: content first, pointers last ------------------------------
snap="$work/snapshot"
mkdir -p "$snap"

snapshot_taken=0
for attempt in 1 2 3; do
  before="$(sha256sum "$staging/manifest" | cut -d' ' -f1)"
  # --list-archives uses the verifier's manifest parser and checks referenced
  # files. Staging can contain Dolt metadata that is not part of the backup.
  "$root/scripts/backup-verify.sh" --list-archives "$staging" >"$work/files" \
    || die 'staging manifest or referenced archive is incomplete or malformed — nothing was sent'
  rm -rf "$snap"
  mkdir -p "$snap"
  # --link-dest hardlinks when the snapshot lands on the same filesystem as the
  # staging copy and silently falls back to copying when it does not. Both
  # happen here: by hand the temp dir is usually co-located, under the systemd
  # timer it is not.
  rsync -a --from0 --files-from="$work/files" --link-dest="$staging" \
    "$staging/" "$snap/" \
    || die 'could not snapshot the referenced archive files — nothing was sent'
  after="$(sha256sum "$staging/manifest" | cut -d' ' -f1)"
  if [[ "$before" == "$after" ]]; then
    cp "$staging/manifest" "$snap/manifest"
    snapshot_taken=1
    break
  fi
  log "the staging copy advanced while snapshotting (attempt $attempt) — retrying"
done
[[ "$snapshot_taken" -eq 1 ]] \
  || die 'the staging copy kept advancing across three snapshot attempts'

archives="$(find "$snap" -name '*.darc' | wc -l)"
(( archives > 0 )) || die 'the snapshot contains no archives — refusing to push a manifest with no content behind it'

# Dolt restore creates an oldgen directory in its input archive. Read a byte
# checked disposable copy so the publishable snapshot stays a canonical tree.
archive_digest="$("$root/scripts/backup-verify.sh" --digest "$snap")" \
  || die 'the snapshot archive tree is incomplete or malformed — nothing was sent'
rsync -a "$snap/" "$work/restore-source/" \
  || die 'could not copy the snapshot for restore — nothing was sent'
restore_digest="$("$root/scripts/backup-verify.sh" --digest "$work/restore-source")" \
  || die 'the disposable restore input is incomplete — nothing was sent'
[[ "$restore_digest" == "$archive_digest" ]] \
  || die 'the disposable restore input differs from the snapshot — nothing was sent'
if ! (cd "$work" && dolt backup restore "file://$work/restore-source" proof >/dev/null 2>&1); then
  die "the snapshot for '$name' could not be restored — nothing was sent"
fi
(cd "$work/proof" && dolt sql -r json -q "$proof_query" >"$work/restored.json" 2>/dev/null) \
  || die 'could not query the restored snapshot — nothing was sent'
normalize_observation "$work/restored.json" >"$work/restored.normal" 2>/dev/null \
  || die 'could not validate the restored snapshot observation — nothing was sent'
cmp -s "$work/source.normal" "$work/restored.normal" \
  || die 'source changed or backup omitted data'

# Counts are lower bounds from before sync; the WORKING root and status above
# are exact equality checks from the post-sync observation.
read -r got_issues got_deps got_commits post_head < <(python3 - "$work/source.normal" <<'PY'
import json
import sys
row = json.load(open(sys.argv[1], encoding='utf-8'))
print(row['issues'], row['deps'], row['commits'], row['head'])
PY
)
(( got_issues > 0 )) \
  || die "the staged backup for '$name' restores to ZERO issues while the live database has $live_issues. NOTHING WAS SENT."
(( got_issues >= live_issues && got_commits >= live_commits )) \
  || die "the staged backup for '$name' is BEHIND the live issue or commit count. Nothing was sent."
log "restore proof: $got_issues issues, $got_deps dependencies, $got_commits commits; WORKING root and status match"

# bd's backup_state.json belongs to the automatic path. This producer-authored
# state describes the exact snapshot just restored and hashed.
cat > "$snap/$STATE_FILE" <<JSON
{
  "database": "$name",
  "last_dolt_commit": "$post_head",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": $got_issues,
  "dependencies": $got_deps,
  "commits": $got_commits,
  "working_set_proof": "restore-matched",
  "archive_tree_sha256": "$archive_digest"
}
JSON

# --- push: content first, pointers second --------------------------------
$ssh_cmd "$dest_host" "mkdir -p '$remote_dir'" \
  || die 'could not create the destination directory — the host is unreachable or the path is not writable'

rsync_opts=(-a -e "$ssh_cmd")

# Until the second pass lands, the destination still describes its previous
# complete state.
rsync "${rsync_opts[@]}" --exclude manifest --exclude "$STATE_FILE" \
  "$snap/" "$dest_host:$remote_dir/" \
  || die 'the content pass failed — the destination still points at its previous backup'

rsync "${rsync_opts[@]}" --delete "$snap/" "$dest_host:$remote_dir/" \
  || die 'the pointer pass failed — the destination has the new content but still points at the old manifest'

# --- read it back, do not trust the exit code ----------------------------
log 'verifying the destination by reading it back'
"$root/scripts/backup-verify.sh" --name "$name" --project "$project" \
  || die 'the push reported success and the destination did not verify'

log "$name is backed up off-machine ($archives archives)"
