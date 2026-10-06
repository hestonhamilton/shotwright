#!/usr/bin/env bash
# parallel-dispatcher: set up ONE agent's isolated workspace.
#
# Given a bead you have already judged parallel-safe (disjoint write surface, no
# collision with the in_progress set — see SKILL.md), this does the mechanical
# wiring: resolve the base checkout, derive the branch, mint a unique actor,
# create the bead's worktree+branch, and claim the bead as that actor. It does
# NOT pick beads — that judgment stays in the skill.
#
# Usage:
#   scripts/dispatch.sh <bead-id> [slug]
#
#   <bead-id>  the ready bead to dispatch (one bead per call).
#   [slug]     optional kebab slug; derived from the bead title when omitted.
#
# Besides bd it uses git and jq only. bd is run from the base checkout (the
# primary worktree that holds the shared bd DB). If bd is missing or unreachable
# it degrades to printing the plan instead of hard-failing.
set -euo pipefail

die()  { echo "dispatch: $*" >&2; exit 2; }
warn() { echo "dispatch: $*" >&2; }

[[ $# -ge 1 ]] || die "usage: dispatch.sh <bead-id> [slug]"
bead_id="$1"
slug_in="${2:-}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repo"

# --- Base checkout: first/main entry of the worktree list (holds the bd DB) ---
BASE_CHECKOUT="$(git worktree list --porcelain | awk '/^worktree / { print $2; exit }')"
[[ -n "$BASE_CHECKOUT" ]] || die "could not resolve base checkout"
cd "$BASE_CHECKOUT"

# --- Config: BRANCH_PREFIX from scaffold.conf (default feat/) -----------------
conf="$BASE_CHECKOUT/.claude/scaffold.conf"
if [[ -f "$conf" ]]; then
  # shellcheck disable=SC1090
  source "$conf"
fi
BRANCH_PREFIX="${BRANCH_PREFIX:-feat/}"

# --- Helpers -----------------------------------------------------------------
# Lowercase, non-alnum -> hyphen, squeeze, trim, truncate ~60 chars.
slugify() {
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  s="${s:0:60}"
  printf '%s' "${s%-}"
}

# 6 hex chars from /dev/urandom without assuming openssl; RANDOM/$$ as a fallback.
mint_actor() {
  local hex=""
  hex="$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')" || hex=""
  if [[ -z "$hex" ]]; then
    hex="$(hexdump -n3 -e '3/1 "%02x"' /dev/urandom 2>/dev/null)" || hex=""
  fi
  if [[ -z "$hex" ]]; then
    hex="$(printf '%06x' "$(( (RANDOM << 15 ^ RANDOM ^ $$) & 0xffffff ))")"
  fi
  printf 'agent:claude:%s' "$hex"
}

have_bd() { command -v bd >/dev/null 2>&1; }

# --- Derive slug + branch ----------------------------------------------------
slug=""
if [[ -n "$slug_in" ]]; then
  slug="$(slugify "$slug_in")"
elif have_bd; then
  title="$(bd show "$bead_id" --json 2>/dev/null | jq -r '.title // .issue.title // empty' 2>/dev/null || true)"
  [[ -n "$title" ]] && slug="$(slugify "$title")"
fi
if [[ -z "$slug" ]]; then
  warn "no slug given and could not derive one from the bead title — using 'wip'"
  slug="wip"
fi
branch="${BRANCH_PREFIX}${bead_id}-${slug}"

actor="$(mint_actor)"

# --- bd absent/unreachable: print the plan and stop, don't hard-fail ---------
if ! have_bd; then
  warn "bd not found on PATH — printing plan only; run these once bd is available:"
  cat <<EOF
  bead:    $bead_id
  branch:  $branch
  actor:   $actor
  base:    $BASE_CHECKOUT
  # bd worktree create $bead_id --branch $branch
  # BEADS_ACTOR=$actor bd update $bead_id --claim
EOF
  exit 0
fi
if ! bd show "$bead_id" >/dev/null 2>&1; then
  warn "bd is present but '$bead_id' is not reachable (unknown id or bd DB error)."
  warn "planned branch=$branch actor=$actor base=$BASE_CHECKOUT — resolve bd, then re-run."
  exit 0
fi

# --- Create the worktree+branch, then claim as this actor --------------------
# Use `bd worktree create` (NOT raw `git worktree add`): it shares the base bd
# DB with the new worktree; a hook denies the raw form.
if ! bd worktree create "$bead_id" --branch "$branch"; then
  die "bd worktree create failed for $bead_id ($branch)"
fi

if ! BEADS_ACTOR="$actor" bd update "$bead_id" --claim; then
  # Claim lost — most likely another operator claimed $bead_id between selection and here.
  # Do NOT report a successful dispatch or emit a launch command for work we don't own.
  die "claim failed for $bead_id (already claimed?) — NOT dispatched. A worktree was created at
  branch '$branch'; remove it if unwanted:  bd worktree remove $branch"
fi

# Resolve the new worktree path from git's view of the branch.
wt_path="$(git worktree list --porcelain \
  | awk -v b="refs/heads/$branch" '/^worktree / { p=$2 } $0 == "branch " b { print p; exit }')"
[[ -n "$wt_path" ]] || wt_path="(see: git worktree list)"

# --- Report ------------------------------------------------------------------
cat <<EOF

Dispatched $bead_id
  worktree: $wt_path
  branch:   $branch
  actor:    $actor

Launch an agent here: cd '$wt_path' && BEADS_ACTOR='$actor' <run agent on $bead_id>
EOF
