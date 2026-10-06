#!/usr/bin/env bash
# session-state.sh — compact snapshot of repo + bead state for a work session.
#
# Prints ONE block covering: current branch, working-tree dirty state, recent
# commits, recently closed beads, and the top of the ready queue. `/handoff-update`
# and `/wind-down` both call it (path: .claude/skills/handoff-update/scripts/
# session-state.sh) so the model doesn't hand-re-emit the same git/bd probes.
#
# git is REQUIRED — the script exits non-zero if it's missing or we're not in a
# repo. Every bd section is BEST-EFFORT: if bd is absent or its backend is
# unreachable, that section prints a one-line note and the script still succeeds.
# Depends only on git, bd, and jq (jq optional — bd sections fall back to raw bd
# output when it's absent).
#
# Usage: .claude/skills/handoff-update/scripts/session-state.sh   (no args)
set -uo pipefail

READY_LIMIT=5
CLOSED_LIMIT=5

section() { printf '\n== %s ==\n' "$1"; }
note()    { printf '(%s)\n' "$1"; }

# --- git (required) ------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "session-state: git not found on PATH" >&2
  exit 2
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "session-state: not inside a git repository" >&2
  exit 2
fi

section "Branch"
branch="$(git branch --show-current)"
printf '%s\n' "${branch:-(detached HEAD)}"

section "Working tree"
dirty="$(git status --short)"
if [[ -n "$dirty" ]]; then
  printf '%s\n' "$dirty"
else
  note "clean"
fi

section "Recent commits"
git log --oneline -5 2>/dev/null || note "no commits yet"

# --- bd (best-effort) ----------------------------------------------------
# Probe once: classify bd as ok / missing / down, then guard both bd sections.
bd_status="ok"
if ! command -v bd >/dev/null 2>&1; then
  bd_status="missing — skipped"
elif ! bd ready >/dev/null 2>&1; then
  bd_status="backend unreachable — skipped"
fi

section "Recently closed beads"
if [[ "$bd_status" != "ok" ]]; then
  note "bd $bd_status"
else
  closed_json="$(bd list --status closed --json 2>/dev/null || true)"
  if command -v jq >/dev/null 2>&1 \
     && [[ -n "$closed_json" ]] \
     && printf '%s' "$closed_json" | jq -e 'type=="array"' >/dev/null 2>&1; then
    parsed="$(printf '%s' "$closed_json" | jq -r --argjson n "$CLOSED_LIMIT" \
      'sort_by(.closed_at // .updated_at // .created_at // "") | reverse
       | .[0:$n] | .[]
       | "\(.id // "?")  \(.title // "")"' 2>/dev/null || true)"
    if [[ -n "$parsed" ]]; then
      printf '%s\n' "$parsed"
    else
      note "no recently closed beads"
    fi
  else
    # No jq (or unexpected shape): fall back to raw bd text output.
    raw="$(bd list --status closed 2>/dev/null | head -n "$CLOSED_LIMIT" || true)"
    if [[ -n "$raw" ]]; then
      printf '%s\n' "$raw"
    else
      note "no recently closed beads (or bd list --status unsupported)"
    fi
  fi
fi

section "Ready queue (top $READY_LIMIT)"
if [[ "$bd_status" != "ok" ]]; then
  note "bd $bd_status"
else
  ready="$(bd ready 2>/dev/null | head -n "$READY_LIMIT" || true)"
  if [[ -n "$ready" ]]; then
    printf '%s\n' "$ready"
  else
    note "ready queue empty"
  fi
fi
