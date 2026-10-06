#!/usr/bin/env bash
# bead-start mechanical claimer.
#
# Does the deterministic parts of claiming a bead so SKILL.md keeps only the
# judgment: read title, derive the canonical branch name + kebab slug, map the
# R/P/I/V phase to its artifact path, claim the bead, and print a compact
# summary (including `bd ready` with this bead removed). It does NOT create the
# branch — that stays a visible step under the branch hook; this only prints the
# name to create.
#
# Usage:  .claude/skills/bead-start/scripts/start.sh <bead-id>
#         (run from the repo root — that is the CWD skills execute with)
#
# Degrades gracefully if bd is missing/unreachable: prints what it can (branch
# name is derived from the id alone when the title can't be fetched).
set -uo pipefail

die() { echo "start: $*" >&2; exit 2; }

BEAD_ID="${1:-}"
[ -n "$BEAD_ID" ] || die "usage: start.sh <bead-id>"

# --- Load project config (defaults if missing) -----------------------------
BRANCH_PREFIX="feat/"
# Prefer CLAUDE_PROJECT_DIR; else walk up from this script (.../.claude/skills/bead-start/scripts).
conf=""
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "${CLAUDE_PROJECT_DIR}/.claude/scaffold.conf" ]; then
  conf="${CLAUDE_PROJECT_DIR}/.claude/scaffold.conf"
else
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  cand="${script_dir}/../../../scaffold.conf"
  [ -f "$cand" ] && conf="$cand"
fi
# shellcheck disable=SC1090
[ -n "$conf" ] && source "$conf"

# --- kebab slug: lowercase, non-alnum -> dash, collapse dashes, trim, <=60 --
slugify() {
  printf '%s' "$1" \
    | sed -E 's/^[[:space:]]*[[(][^])]*[])][[:space:]]*//' \
    | sed -E 's/^[[:space:]]*E[0-9]+\.[RPIV][[:space:]]+//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/-+/-/g; s/^-//; s/-$//' \
    | cut -c1-60 \
    | sed -E 's/-$//'
}

# --- Fetch title via bd (graceful degrade) ---------------------------------
BD_OK=1
TITLE=""
if command -v bd >/dev/null 2>&1; then
  # `bd show --json` emits an ARRAY, so a bare `.title` filter raises
  # "Cannot index array with string" rather than returning empty. Index the
  # first element, keeping the object form as a fallback in case bd changes.
  if TITLE="$(bd show "$BEAD_ID" --json 2>/dev/null | jq -r '.[0].title // .title // empty' 2>/dev/null)"; then
    :
  fi
  # Fall back to plain text output if --json/jq gave nothing. `bd show` has no
  # "Title:" line — line 1 is "<glyph> <id> [TYPE] · <title>   [<pri> · <STATUS>]".
  # Take everything after the first "·", then drop the trailing status bracket
  # (which is preceded by 2+ spaces, so a title ending in "]" survives).
  if [ -z "$TITLE" ]; then
    TITLE="$(bd show "$BEAD_ID" 2>/dev/null \
      | head -n1 \
      | sed -E 's/^[^·]*·[[:space:]]*//; s/[[:space:]]{2,}\[[^]]*\][[:space:]]*$//; s/[[:space:]]+$//')"
  fi
else
  BD_OK=0
fi

# --- Derive branch name -----------------------------------------------------
if [ -n "$TITLE" ]; then
  slug="$(slugify "$TITLE")"
  BRANCH="${BRANCH_PREFIX}${BEAD_ID}-${slug}"
else
  slug=""
  BRANCH="${BRANCH_PREFIX}${BEAD_ID}"
fi

# --- Phase -> artifact path -------------------------------------------------
# Detect phase from a trailing/leading R/P/I/V tag in the title, e.g.
# "[R] ...", "(P)", "V — ...", "... I".
PHASE=""
if [ -n "$TITLE" ]; then
  PHASE="$(printf '%s' "$TITLE" | grep -oiE '[[({ ]?\b[RPIV]\b[])} ]?' | grep -oiE '[RPIV]' | head -n1 | tr '[:lower:]' '[:upper:]')"
fi
case "$PHASE" in
  R) ARTIFACT="docs/${BEAD_ID}-research.md" ;;
  P) ARTIFACT="docs/${BEAD_ID}-plan.md" ;;
  I) ARTIFACT="(none — the matching .P plan doc is the working contract)" ;;
  V) ARTIFACT="docs/${BEAD_ID}-verification.md" ;;
  *) ARTIFACT="(phase not detected from title — set artifact per R/P/I/V)" ;;
esac

# --- Claim ------------------------------------------------------------------
CLAIM_MSG=""
if [ "$BD_OK" -eq 1 ]; then
  if bd update "$BEAD_ID" --claim >/dev/null 2>&1; then
    CLAIM_MSG="claimed (status -> in_progress, assigned to you)"
  else
    CLAIM_MSG="WARNING: 'bd update $BEAD_ID --claim' failed — claim it manually"
  fi
else
  CLAIM_MSG="SKIPPED: bd not on PATH — claim manually with 'bd update $BEAD_ID --claim'"
fi

# --- bd ready, minus this bead ---------------------------------------------
READY=""
if [ "$BD_OK" -eq 1 ]; then
  READY="$(bd ready 2>/dev/null | grep -v -F -- "$BEAD_ID" || true)"
fi

# --- Summary ----------------------------------------------------------------
echo   "== bead-start: ${BEAD_ID} =="
echo   "title:    ${TITLE:-(unavailable — bd show returned nothing)}"
[ -n "$PHASE" ] && echo "phase:    ${PHASE}"
echo   "branch:   ${BRANCH}    (to CREATE — not created here)"
echo   "artifact: ${ARTIFACT}"
echo   "claim:    ${CLAIM_MSG}"
if [ -z "$slug" ] && [ "$BD_OK" -eq 1 ]; then
  echo "note:     no title slug — confirm the branch name before creating it"
fi
echo
echo   "bd ready (this bead removed):"
if [ "$BD_OK" -eq 1 ]; then
  echo "${READY:-  (none)}"
else
  echo "  (bd unavailable)"
fi
