#!/usr/bin/env bash
# Installs (or removes) the systemd user timer that keeps the forge's `main`
# current. See scripts/forge-mirror.sh for why this exists and why it is a local
# timer rather than a GitHub Action or a Forgejo pull-mirror.
#
# Usage:
#   scripts/forge-mirror-install.sh [--interval 10min] [--now]
#   scripts/forge-mirror-install.sh --uninstall
#   scripts/forge-mirror-install.sh --status
#
# The unit files are GENERATED here rather than committed, because a systemd
# unit needs an absolute ExecStart path and this repository must not carry host
# paths (headed public). The path is taken from wherever this script is run
# from, so a worktree installs a timer pointing at that worktree.
#
# Requires lingering if the timer should run while logged out:
#   loginctl enable-linger "$USER"      # enable once on the host
set -euo pipefail

interval='10min'
action='install'
run_now=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)  interval="${2:?--interval needs a value}"; shift 2 ;;
    --now)       run_now=1; shift ;;
    --uninstall) action='uninstall'; shift ;;
    --status)    action='status'; shift ;;
    -h|--help)   sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "forge-mirror-install: unknown argument: $1" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
service='shotwright-forge-mirror.service'
timer='shotwright-forge-mirror.timer'

case "$action" in
  status)
    systemctl --user status "$timer" --no-pager 2>&1 | head -12 || true
    echo '--- last run ---'
    systemctl --user status "$service" --no-pager 2>&1 | tail -15 || true
    exit 0
    ;;
  uninstall)
    systemctl --user disable --now "$timer" 2>/dev/null || true
    rm -f "$unit_dir/$service" "$unit_dir/$timer"
    systemctl --user daemon-reload
    echo "forge-mirror-install: removed $timer and $service"
    exit 0
    ;;
esac

command -v systemctl >/dev/null 2>&1 || { echo 'forge-mirror-install: systemctl not found' >&2; exit 1; }
[[ -x "$root/scripts/forge-mirror.sh" ]] || { echo 'forge-mirror-install: scripts/forge-mirror.sh is missing or not executable' >&2; exit 1; }

mkdir -p "$unit_dir"

cat > "$unit_dir/$service" <<UNIT
[Unit]
Description=Mirror shotwright main to the self-hosted forge (shotwright-ffj)
Documentation=file://$root/scripts/forge-mirror.sh
After=network-online.target

[Service]
Type=oneshot
ExecStart=$root/scripts/forge-mirror.sh --quiet
WorkingDirectory=$root
# Advisory lane (ADR 0008) — a failure here must be visible in the journal but
# must never escalate into anything that interrupts work.
Nice=10
UNIT

cat > "$unit_dir/$timer" <<UNIT
[Unit]
Description=Keep the self-hosted forge current with GitHub main (shotwright-ffj)
Documentation=file://$root/scripts/forge-mirror.sh

[Timer]
OnBootSec=2min
OnUnitActiveSec=$interval
# Catches up after the machine has been asleep or off, which is when the forge
# is most likely to be behind.
Persistent=true
AccuracySec=30s

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$timer"

echo "forge-mirror-install: installed $timer (every $interval)"
systemctl --user list-timers "$timer" --no-pager 2>&1 | head -3

if [[ "$run_now" -eq 1 ]]; then
  echo '--- running once now ---'
  systemctl --user start "$service"
  sleep 2
  systemctl --user status "$service" --no-pager 2>&1 | tail -8 || true
fi
