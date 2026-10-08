#!/usr/bin/env bash
# Brings the self-hosted forge's `main` up to whatever GitHub's `main` is.
#
# Usage:
#   scripts/forge-mirror.sh [--quiet]
#
# Run on a schedule by the systemd user timer that scripts/forge-mirror-install.sh
# installs. Safe to run by hand at any time, from any branch, mid-rebase — it
# only fetches and pushes refs, and never touches the working tree, the index, or
# the checked-out branch.
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS (shotwright-ffj)
#
# `origin` carries two push URLs, GitHub and the forge, so a local `git push`
# reaches both. But pull requests are MERGED ON GITHUB. That advances
# `origin/main` server-side with no local push involved, and nothing then
# carries the merge commit to the forge.
#
# The dual-push design silently assumes every advance of `main` originates
# locally. Under a PR workflow that assumption is false for EVERY merge, so the
# forge does not drift occasionally — it drifts by construction, once per merged
# PR, and further the more the project uses PRs. It was corrected by hand after
# each of the ~9 merges before this script existed.
#
# ADR 0008 keeps the forge as a standby second opinion on CI. A lane permanently
# behind `main` is not a second opinion: it is either not running, or running
# against code nobody is shipping, and its green is misleading. The lane is
# advisory and gates nothing, which is precisely why the drift went unnoticed.
#
# WHY A LOCAL TIMER, and not a GitHub Action or a Forgejo pull-mirror
#
#   * The forge is CO-LOCATED WITH THIS MACHINE (ADR 0013). So a timer here
#     has IDENTICAL availability to the forge itself — if this machine is down
#     there is no forge to be stale. That equivalence is what makes the obvious
#     objection to a local timer ("it depends on a machine being up") not apply.
#   * A GitHub Action would need the forge reachable from the public internet AND
#     a forge push credential stored at GitHub. Both are new exposure for a lane
#     that gates nothing.
#   * A Forgejo pull-mirror makes the mirrored repo mirror-managed, which
#     conflicts with the dual-push that currently gives feature branches
#     immediate forge CI. Fixing drift by delaying every branch is a bad trade.
#
# WHAT IS AND IS NOT MIRRORED — decided in shotwright-ffj:
#
#   * `main`  — yes. This is the drift the bead is about.
#   * tags    — yes. The release path is tag-driven, so a forge without tags
#               cannot offer a second opinion on a release.
#   * dolt data (`refs/dolt/*`) — NO, deliberately. ADR 0013 disqualified the
#               forge as a backup host because it is co-located with the machine
#               it would be backing up. Mirroring the board here would add a
#               copy that dies with the original, which ADR 0013 calls worse
#               than none because it is believed.
#   * feature branches — not here. The dual-push URL already delivers those
#               immediately, which is better than this timer's interval.
#
# NO HOST NAMES IN THIS FILE. The forge URL is derived at runtime from git
# config, never hardcoded. This repository is public-facing, and the forge
# hostname is exactly the shape of string the leak gate does NOT catch — it is
# not a host path, a private IP, or a username (shotwright-746.18.3).
set -euo pipefail

quiet=0
[[ "${1:-}" == '--quiet' ]] && quiet=1

log() { [[ "$quiet" -eq 1 ]] || echo "forge-mirror: $*"; }
die() { echo "forge-mirror: $*" >&2; exit 1; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $root"

# Resolve the forge push URL by elimination: every push URL on `origin` that is
# not GitHub. Keeps the hostname out of this file and out of the repo.
mapfile -t push_urls < <(git remote get-url --push --all origin 2>/dev/null || true)
forge_url=''
for url in "${push_urls[@]}"; do
  [[ "$url" == *github.com* ]] && continue
  if [[ -n "$forge_url" ]]; then
    die 'origin has more than one non-GitHub push URL — cannot tell which is the forge'
  fi
  forge_url="$url"
done
[[ -n "$forge_url" ]] || die 'no non-GitHub push URL on origin — nothing to mirror to'

fetch_url="$(git remote get-url origin)"

log 'fetching main and tags from the upstream remote'
git fetch --quiet --tags "$fetch_url" '+refs/heads/main:refs/remotes/origin/main' \
  || die 'fetch failed — not mirroring a state that could not be read'

upstream_sha="$(git rev-parse refs/remotes/origin/main)"

# Nothing to do is the common case on a 10-minute timer. Check before pushing so
# the ordinary run is one network round trip, not two.
forge_sha="$(git ls-remote "$forge_url" refs/heads/main 2>/dev/null | awk '{print $1}' || true)"
if [[ "$forge_sha" == "$upstream_sha" ]]; then
  log "already current at ${upstream_sha:0:7}"
  exit 0
fi

log "forge at ${forge_sha:0:7}, upstream at ${upstream_sha:0:7} — mirroring"
git push --quiet --follow-tags "$forge_url" "refs/remotes/origin/main:refs/heads/main" \
  || die 'push to the forge failed'

# VERIFY, do not trust the exit code. This whole repository has spent the week
# on checks that report success without having done anything (the leak gate's
# suppressed rule, the backup that recreated its destination on local disk), and
# a mirror that reports green while the forge sits behind would be the same
# defect in a third place.
after_sha="$(git ls-remote "$forge_url" refs/heads/main 2>/dev/null | awk '{print $1}' || true)"
[[ "$after_sha" == "$upstream_sha" ]] \
  || die "push reported success but the forge is at ${after_sha:0:7}, not ${upstream_sha:0:7}"

log "forge now at ${upstream_sha:0:7}"
