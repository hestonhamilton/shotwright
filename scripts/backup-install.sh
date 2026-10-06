#!/usr/bin/env bash
# Installs (or removes) the systemd user timer that pushes beads databases
# off-machine. See scripts/backup-push.sh for what it pushes and why.
#
# Usage:
#   scripts/backup-install.sh --dest <host>:<path> [--project <dir>]... \
#                             [--interval 30min] [--now]
#   scripts/backup-install.sh --uninstall
#   scripts/backup-install.sh --status
#
# --project may be repeated; each becomes its own step, so one database failing
# is visible as that database rather than as "the backup". Defaults to this
# repository.
#
# The unit files are GENERATED here rather than committed, because a systemd
# unit needs an absolute ExecStart path and a destination host, and this
# repository must not carry either (headed public). Same arrangement as
# scripts/forge-mirror-install.sh.
#
# ---------------------------------------------------------------------------
# WHY A TIMER AND NOT bd's OWN INTERVAL (plan section 2.2)
#
# Measured: with an off-machine destination configured and auto-backup enabled
# at a 1s interval, bd's interval mechanism wrote 8 files into the LOCAL
# `.beads/backup/` and never touched the configured destination. The two paths
# are distinct all the way down to separate entries in `repo_state.json`.
# bd's interval cannot be redirected off-machine, so the schedule has to live
# outside bd. bd's local backup is left enabled and left local: it is the source
# this timer copies from, and it also covers local database corruption, which
# the off-machine copy does not distinguish from a healthy database.
#
# Requires lingering if the timer should run while logged out:
#   loginctl enable-linger "$USER"      # enable once on the host
set -euo pipefail

interval='30min'
action='install'
run_now=0
dest=''
projects=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)      dest="${2:?--dest needs a value}"; shift 2 ;;
    --project)   projects+=("${2:?--project needs a value}"); shift 2 ;;
    --interval)  interval="${2:?--interval needs a value}"; shift 2 ;;
    --now)       run_now=1; shift ;;
    --uninstall) action='uninstall'; shift ;;
    --status)    action='status'; shift ;;
    -h|--help)   sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "backup-install: unknown argument: $1" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
service='shotwright-beads-backup.service'
timer='shotwright-beads-backup.timer'
alert='shotwright-beads-backup-alert.service'

case "$action" in
  status)
    systemctl --user status "$timer" --no-pager 2>&1 | head -12 || true
    echo '--- last run ---'
    systemctl --user status "$service" --no-pager 2>&1 | tail -20 || true
    exit 0
    ;;
  uninstall)
    systemctl --user disable --now "$timer" 2>/dev/null || true
    rm -f "$unit_dir/$service" "$unit_dir/$timer" "$unit_dir/$alert"
    systemctl --user daemon-reload
    echo "backup-install: removed $timer, $service and $alert"
    exit 0
    ;;
esac

command -v systemctl >/dev/null 2>&1 || { echo 'backup-install: systemctl not found' >&2; exit 1; }
[[ -x "$root/scripts/backup-push.sh" ]] || { echo 'backup-install: scripts/backup-push.sh is missing or not executable' >&2; exit 1; }
[[ -n "$dest" ]] || { echo 'backup-install: --dest <host>:<path> is required' >&2; exit 2; }
[[ "$dest" == *:* ]] || { echo "backup-install: --dest must be host:/path, got '$dest'" >&2; exit 2; }

[[ ${#projects[@]} -gt 0 ]] || projects=("$root")

# The verification step reads the local head with `bd`, and the systemd user
# PATH does not include ~/.local/bin, so a timed run would fail at exactly the
# step that proves the push worked. Resolved at install time and baked into the
# unit, which lives outside the repository — the path itself must not be
# committed (headed public).
bd_bin="$(command -v bd || true)"
[[ -n "$bd_bin" ]] || { echo 'backup-install: bd is not on PATH, so the installed timer could not verify its own pushes' >&2; exit 1; }
unit_path="$(dirname "$bd_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

mkdir -p "$unit_dir"

{
  cat <<UNIT
[Unit]
Description=Push beads databases off-machine (shotwright-2sr.3)
Documentation=file://$root/docs/backup.md
After=network-online.target
OnFailure=$alert

[Service]
Type=oneshot
Environment=SHOTWRIGHT_BACKUP_DEST=$dest
Environment=PATH=$unit_path
WorkingDirectory=$root
UNIT
  # One step per database. A failure names the database that failed, which is
  # the difference between "the backup is broken" and "one project is broken".
  for p in "${projects[@]}"; do
    abs="$(cd "$p" && pwd)"
    printf 'ExecStart=%s/scripts/backup-push.sh --quiet --project %s\n' "$root" "$abs"
  done
} > "$unit_dir/$service"

# An active alert, not a line in a log nobody reads (owner decision 3, plan
# section 1). A silently-failing backup is the failure mode this whole bead is
# about, so its own scheduler must not fail silently either.
cat > "$unit_dir/$alert" <<UNIT
[Unit]
Description=Beads backup FAILED — the off-machine copy is not advancing

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo "beads backup failed; run: systemctl --user status $service" | systemd-cat -t shotwright-backup -p alert'
ExecStart=-/bin/sh -c 'command -v notify-send >/dev/null && notify-send -u critical "Beads backup FAILED" "The off-machine copy is not advancing. systemctl --user status $service"'
UNIT

cat > "$unit_dir/$timer" <<UNIT
[Unit]
Description=Keep the off-machine beads backup current (shotwright-2sr.3)
Documentation=file://$root/docs/backup.md

[Timer]
OnBootSec=5min
OnUnitActiveSec=$interval
# Catches up after the machine has been asleep or off, which is exactly when
# the off-machine copy has fallen furthest behind.
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$timer"

echo "backup-install: installed $timer (every $interval, ${#projects[@]} database(s))"
systemctl --user list-timers "$timer" --no-pager 2>&1 | head -3

if [[ "$run_now" -eq 1 ]]; then
  echo '--- running once now ---'
  systemctl --user start "$service"
  systemctl --user status "$service" --no-pager 2>&1 | tail -12 || true
fi
