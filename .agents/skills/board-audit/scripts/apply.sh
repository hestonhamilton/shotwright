#!/usr/bin/env bash
# board-audit fix applier.
#
# Executes the board-audit skill's NON-DESTRUCTIVE Step 4 fixes (reparent /
# priority / undefer / defer) — reversible, so safe to apply directly. Dry-run by
# default: it PRINTS the bd commands; pass --commit to actually run them.
#
# Closures are NEVER run here. The `closures` subcommand only PRINTS the
# `bd close ...` commands for the owner to confirm + run (CLAUDE.md Rules: confirm
# before any bd close). Rewriting a body is left to `bd update --body-file -`
# directly (multi-line heredoc; see SKILL.md Step 4) — not wrapped here.
#
# Usage:
#   single op (dry-run):   scripts/apply.sh reparent <id> <epic>
#   single op (execute):   scripts/apply.sh --commit priority <id> 3
#   batch from a plan:     scripts/apply.sh --plan fixes.txt           # dry-run
#                          scripts/apply.sh --commit --plan fixes.txt  # execute
#   stage closures:        scripts/apply.sh closures closes.txt        # prints only
#
# Plan file (one op per line; '#' comments and blank lines ignored):
#   reparent <id> <epic>
#   priority <id> <0-4>
#   undefer  <id>
#   defer    <id> <when>     # e.g. +30d, tomorrow, 2026-07-01
#
# Closures file (one per line):  <id> <reason text...>
set -euo pipefail

COMMIT=0
PLAN=""

die() { echo "apply: $*" >&2; exit 2; }
need_bd() { command -v bd >/dev/null 2>&1 || die "bd not found on PATH"; }

# Run or echo one bd invocation depending on --commit.
run_bd() {
  if [[ "$COMMIT" -eq 1 ]]; then
    echo "+ bd $*"
    bd "$@"
  else
    echo "DRY-RUN: bd $*"
  fi
}

# Translate one plan verb into a bd command.
apply_op() {
  local verb="$1"; shift
  case "$verb" in
    reparent) [[ $# -eq 2 ]] || die "reparent needs <id> <epic>"; run_bd update "$1" --parent "$2" ;;
    priority) [[ $# -eq 2 ]] || die "priority needs <id> <0-4>"; run_bd update "$1" -p "$2" ;;
    undefer)  [[ $# -eq 1 ]] || die "undefer needs <id>";        run_bd update "$1" --defer "" ;;
    defer)    [[ $# -eq 2 ]] || die "defer needs <id> <when>";   run_bd update "$1" --defer "$2" ;;
    *) die "unknown op '$verb' (want: reparent|priority|undefer|defer)" ;;
  esac
}

cmd_plan() {
  local file="$1"
  [[ -f "$file" ]] || die "plan file not found: $file"
  local n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"                       # strip trailing comment
    [[ -z "${line// }" ]] && continue        # skip blank
    # shellcheck disable=SC2086
    apply_op $line                           # word-split intentional
    n=$((n + 1))
  done < "$file"
  echo "---"
  if [[ "$COMMIT" -eq 1 ]]; then echo "applied $n op(s)."; else echo "$n op(s) previewed. Re-run with --commit to apply."; fi
}

# closures: PRINT ONLY — never executes bd close (owner-confirm gate).
cmd_closures() {
  local file="$1"
  [[ -f "$file" ]] || die "closures file not found: $file"
  echo "# Proposed closures — review, then run these yourself after owner confirm:"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Only skip FULL-LINE comments / blanks — reasons legitimately contain '#'
    # (e.g. "shipped PR #90 (sha)"), so do NOT strip inline.
    [[ -z "${line// }" ]] && continue
    [[ "${line#"${line%%[![:space:]]*}"}" == \#* ]] && continue
    local id reason
    id="${line%% *}"
    reason="${line#* }"
    [[ "$id" == "$reason" ]] && reason="(no reason given — add one)"
    printf 'bd close %s -r %q\n' "$id" "$reason"
  done < "$file"
  echo "# (apply.sh never runs bd close itself — CLAUDE.md: confirm before any bd close.)"
}

main() {
  need_bd
  local args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --commit) COMMIT=1; shift ;;
      --plan)   PLAN="${2:-}"; [[ -n "$PLAN" ]] || die "--plan needs a file"; shift 2 ;;
      -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
      *) args+=("$1"); shift ;;
    esac
  done

  if [[ -n "$PLAN" ]]; then
    cmd_plan "$PLAN"; return
  fi
  [[ ${#args[@]} -ge 1 ]] || { sed -n '2,40p' "$0"; exit 0; }

  case "${args[0]}" in
    closures) [[ ${#args[@]} -eq 2 ]] || die "closures needs a file"; cmd_closures "${args[1]}" ;;
    reparent|priority|undefer|defer) apply_op "${args[@]}" ;;
    *) die "unknown command '${args[0]}'" ;;
  esac
}

main "$@"
