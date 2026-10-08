#!/usr/bin/env bash
# Backs a beads database up off-machine over ssh, having first PROVEN that the
# thing being sent actually contains the board.
#
# Usage:
#   scripts/backup-push.sh [--project <dir>] [--name <db>] [--quiet]
#
# Requires SHOTWRIGHT_BACKUP_DEST=<host>:<absolute-path> in the environment.
# Run on a schedule by the systemd user timer scripts/backup-install.sh writes.
# Safe to run by hand at any time: it reads the database and writes only to its
# own staging directory and to the destination.
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
# own commit on the next. So each run clones the staging copy and counts issues,
# dependencies and commits against the live database before a byte is sent. It
# costs a few seconds and it is the only check that would have caught this.
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

command -v dolt >/dev/null 2>&1 \
  || die 'dolt is not on PATH, and without it the content of a backup cannot be proven before it is sent'

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

# --- prove the staging copy actually contains the board -------------------
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dolt clone "file://$staging" "$work/proof" >/dev/null 2>&1 \
  || die "the staged backup for '$name' could NOT be cloned — it is not restorable, and nothing was sent"

got="$(cd "$work/proof" && dolt sql -r csv -q \
  'select (select count(*) from issues) as issues,
          (select count(*) from dependencies) as deps,
          (select count(*) from dolt_log("--all")) as commits;' 2>/dev/null | tail -1 || true)"
IFS=, read -r got_issues got_deps got_commits <<<"$got"

[[ "$got_issues" =~ ^[0-9]+$ ]] \
  || die "could not read the restored copy of '$name' — the backup cloned but its tables did not answer"

# The board can move between the live query and the sync, so the restored copy
# may legitimately be AHEAD. It may never be behind, and it may never be empty:
# that is the measured failure this check exists for.
(( got_issues > 0 )) \
  || die "the staged backup for '$name' restores to ZERO issues while the live database has $live_issues. This is the 2026-08-02 empty-backup failure. NOTHING WAS SENT."
(( got_issues >= live_issues && got_commits >= live_commits )) \
  || die "the staged backup for '$name' restores to $got_issues issues / $got_commits commits, BEHIND the live $live_issues / $live_commits. The sync did not capture the current database. Nothing was sent."

log "restore proof: $got_issues issues, $got_deps dependencies, $got_commits commits — matches live"

# Our own state file. bd's `backup_state.json` is written by the automatic path
# and was measured naming a commit its own content did not contain, so what the
# destination gets is what THIS script verified, one line per fact.
cat > "$work/$STATE_FILE" <<JSON
{
  "database": "$name",
  "last_dolt_commit": "$live_head",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": $got_issues,
  "dependencies": $got_deps,
  "commits": $got_commits,
  "proved_by": "clone-and-count before push (scripts/backup-push.sh)"
}
JSON

# --- snapshot: content first, pointers last ------------------------------
snap="$work/snapshot"
mkdir -p "$snap"

snapshot_taken=0
for attempt in 1 2 3; do
  before="$(sha256sum "$staging/manifest" | cut -d' ' -f1)"
  # --link-dest hardlinks when the snapshot lands on the same filesystem as the
  # staging copy and silently falls back to copying when it does not. Both
  # happen here: by hand the temp dir is usually co-located, under the systemd
  # timer it is not.
  rsync -a --delete --link-dest="$staging" \
    --exclude manifest --exclude LOCK --exclude "$STATE_FILE" \
    "$staging/" "$snap/"
  after="$(sha256sum "$staging/manifest" | cut -d' ' -f1)"
  if [[ "$before" == "$after" ]]; then
    cp "$staging/manifest" "$snap/manifest"
    cp "$work/$STATE_FILE" "$snap/$STATE_FILE"
    snapshot_taken=1
    break
  fi
  log "the staging copy advanced while snapshotting (attempt $attempt) — retrying"
done
[[ "$snapshot_taken" -eq 1 ]] \
  || die 'the staging copy kept advancing across three snapshot attempts'

archives="$(find "$snap" -name '*.darc' | wc -l)"
(( archives > 0 )) || die 'the snapshot contains no archives — refusing to push a manifest with no content behind it'

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
