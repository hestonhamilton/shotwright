#!/usr/bin/env bash
# claude-statusline.sh — custom Claude Code status line.
#
# A self-contained replica inspired by ccstatusline (sirmalloc) and
# ClaudeCodeStatusLine (daniel3303). No npx / clone / external service:
# it reads the JSON Claude Code pipes on stdin and prints a colored,
# two-line status bar. Only dependencies are `jq` and `git`.
#
# Install: copy to ~/.claude/statusline.sh and wire it into
# ~/.claude/settings.json as the `statusLine` command.
#
# Tuning (set in the environment, e.g. via ~/.claude/settings.json env or shell):
#   CC_SL_POWERLINE=1   Use Powerline arrow separators (requires a Nerd Font).
#                       Default: 0 (plain separators, works in any font).
#   CC_SL_LINES=2       Number of lines to render (1 or 2). Default: 2.
#   CC_SL_BAR_WIDTH=12  Width of the context-usage progress bar. Default: 12.
#
# Status line JSON schema reference:
#   https://code.claude.com/docs/en/statusline

set -uo pipefail

# ---------------------------------------------------------------------------
# Read stdin (the session JSON). Bail out quietly if jq is unavailable.
# ---------------------------------------------------------------------------
input="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  printf 'statusline: jq not found\n'
  exit 0
fi

# Pull every field we use in a single jq pass, one value per line. We use
# `mapfile` rather than `read` because `read` with a whitespace IFS (tab is
# whitespace) collapses consecutive delimiters, which would silently shift
# every field left whenever an optional value (e.g. git_worktree) is empty.
# `mapfile` preserves empty lines as empty array elements. Values we display
# (model/dir/branch/session) don't contain newlines, so line-splitting is safe.
mapfile -t F < <(
  printf '%s' "$input" | jq -r '
    [ (.model.display_name // "Claude"),
      (.workspace.current_dir // .cwd // ""),
      (.workspace.project_dir // ""),
      (.workspace.git_worktree // ""),
      (.context_window.used_percentage // 0 | floor),
      (.context_window.context_window_size // 200000),
      (.context_window.total_input_tokens // 0),
      (.context_window.total_output_tokens // 0),
      (.cost.total_cost_usd // 0),
      (.cost.total_duration_ms // 0),
      (.cost.total_lines_added // 0),
      (.cost.total_lines_removed // 0),
      (.effort.level // ""),
      (.output_style.name // ""),
      (.session_name // ""),
      (.rate_limits.five_hour.used_percentage // -1),
      (.rate_limits.five_hour.resets_at // 0),
      (.rate_limits.seven_day.used_percentage // -1),
      (.rate_limits.seven_day.resets_at // 0),
      (.pr.number // 0)
    ] | .[]'
)
MODEL="${F[0]}";       CUR_DIR="${F[1]}";    PROJECT_DIR="${F[2]}"; WORKTREE="${F[3]}"
CTX_PCT="${F[4]}";     CTX_SIZE="${F[5]}";   CTX_IN="${F[6]}";      CTX_OUT="${F[7]}"
COST="${F[8]}";        DUR_MS="${F[9]}";     ADDED="${F[10]}";      REMOVED="${F[11]}"
EFFORT="${F[12]}";     OUTPUT_STYLE="${F[13]}"; SESSION_NAME="${F[14]}"
RL5_PCT="${F[15]}";    RL5_RESET="${F[16]}"; RL7_PCT="${F[17]}";    RL7_RESET="${F[18]}"
PR_NUM="${F[19]}"

# ---------------------------------------------------------------------------
# Color + separator helpers (256-color ANSI).
# ---------------------------------------------------------------------------
ESC=$'\033'
RESET="${ESC}[0m"
DIM="${ESC}[2m"
BOLD="${ESC}[1m"
fg() { printf '%s[38;5;%sm' "$ESC" "$1"; }   # foreground 256-color
bg() { printf '%s[48;5;%sm' "$ESC" "$1"; }   # background 256-color

# Palette
C_MODEL=39      # blue
C_DIR=215       # orange
C_GIT=114       # green
C_META=245      # grey
C_COST=222      # gold
C_ADD=70        # green
C_DEL=167       # red

POWERLINE="${CC_SL_POWERLINE:-0}"
LINES="${CC_SL_LINES:-2}"
BAR_WIDTH="${CC_SL_BAR_WIDTH:-12}"
SEP_GLYPH=$''   # Powerline right arrow (Nerd Font)
SEP_PLAIN="${DIM}│${RESET}"

# Pick a usage color: green < 50, yellow < 80, red otherwise.
usage_color() {
  local p="$1"
  if   [ "$p" -lt 50 ]; then printf '70'
  elif [ "$p" -lt 80 ]; then printf '178'
  else printf '167'
  fi
}

# Human-readable duration from milliseconds.
fmt_dur() {
  local ms="$1" s
  s=$(( ms / 1000 ))
  if   [ "$s" -lt 60 ]; then printf '%ds' "$s"
  elif [ "$s" -lt 3600 ]; then printf '%dm%ds' $(( s / 60 )) $(( s % 60 ))
  else printf '%dh%dm' $(( s / 3600 )) $(( (s % 3600) / 60 ))
  fi
}

# Wall-clock reset time from an epoch-seconds timestamp. Shows the local clock
# time (e.g. "3:47pm"); prefixes the weekday when the reset is not today (e.g.
# "Mon 2:00pm") so it's unambiguous when the window actually ends.
fmt_reset_clock() {
  local target="$1"
  [ -z "$target" ] || [ "$target" -le 0 ] && { printf 'now'; return; }
  if [ "$(date -d "@$target" +%Y%m%d 2>/dev/null)" = "$(date +%Y%m%d)" ]; then
    date -d "@$target" +'%-I:%M%P' 2>/dev/null
  else
    date -d "@$target" +'%a %-I:%M%P' 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# Git info (branch + dirty state + ahead/behind), computed locally.
# ---------------------------------------------------------------------------
git_segment=""
if [ -n "$CUR_DIR" ] && git -C "$CUR_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git -C "$CUR_DIR" symbolic-ref --short HEAD 2>/dev/null \
    || git -C "$CUR_DIR" rev-parse --short HEAD 2>/dev/null)"
  dirty=""
  git -C "$CUR_DIR" diff --quiet --ignore-submodules HEAD 2>/dev/null || dirty="*"
  if [ -z "$dirty" ] && [ -n "$(git -C "$CUR_DIR" status --porcelain 2>/dev/null)" ]; then
    dirty="*"   # untracked / staged-only changes
  fi
  git_segment=" ${branch}${dirty}"
  [ -n "$WORKTREE" ] && git_segment="${git_segment} ⑂${WORKTREE}"
fi

# Shorten the directory: show ~ for $HOME and keep the basename prominent.
dir_disp="${CUR_DIR/#$HOME/\~}"
dir_base="${CUR_DIR##*/}"
[ -z "$dir_base" ] && dir_base="$dir_disp"

# ---------------------------------------------------------------------------
# Render. Two modes: Powerline (background segments + arrows) or plain.
# ---------------------------------------------------------------------------
render_plain() {
  # --- Line 1: identity ---
  local l1=""
  l1+="$(fg $C_MODEL)${BOLD}${MODEL}${RESET}"
  [ -n "$EFFORT" ] && l1+=" $(fg $C_META)${DIM}(${EFFORT})${RESET}"
  l1+=" ${SEP_PLAIN} $(fg $C_DIR)📁 ${dir_base}${RESET}"
  [ -n "$git_segment" ] && l1+=" $(fg $C_GIT)${git_segment}${RESET}"
  [ "$PR_NUM" != "0" ] && l1+=" $(fg $C_META)#${PR_NUM}${RESET}"
  [ -n "$SESSION_NAME" ] && l1+=" ${SEP_PLAIN} $(fg $C_META)${SESSION_NAME}${RESET}"
  printf '%b\n' "$l1"

  [ "$LINES" -lt 2 ] && return

  # --- Line 2: usage / cost / limits ---
  local uc filled empty bar i l2=""
  uc="$(usage_color "$CTX_PCT")"
  filled=$(( CTX_PCT * BAR_WIDTH / 100 ))
  [ "$filled" -gt "$BAR_WIDTH" ] && filled="$BAR_WIDTH"
  empty=$(( BAR_WIDTH - filled ))
  bar=""
  for ((i=0;i<filled;i++)); do bar+="█"; done
  for ((i=0;i<empty;i++));  do bar+="░"; done
  l2+="$(fg "$uc")${bar} ${CTX_PCT}%${RESET}"
  l2+=" $(fg $C_META)${DIM}$(( (CTX_IN + CTX_OUT) / 1000 ))k/$(( CTX_SIZE / 1000 ))k${RESET}"

  # Cost + duration
  l2+=" ${SEP_PLAIN} $(fg $C_COST)\$$(printf '%.3f' "$COST")${RESET}"
  l2+=" $(fg $C_META)${DIM}$(fmt_dur "$DUR_MS")${RESET}"

  # Lines changed
  if [ "$ADDED" != "0" ] || [ "$REMOVED" != "0" ]; then
    l2+=" $(fg $C_ADD)+${ADDED}${RESET}$(fg $C_DEL)-${REMOVED}${RESET}"
  fi

  printf '%b\n' "$l2"

  # --- Line 3: rate-limit windows, only when Claude Code provided them. Each
  # shows usage %% plus the wall-clock time the window resets, so it's clear
  # when capacity frees up rather than how long since you-don't-know-when.
  local l3=""
  if [ "$RL5_PCT" != "-1" ]; then
    local p5 c5; p5="${RL5_PCT%.*}"; c5="$(usage_color "${p5:-0}")"
    l3+="$(fg $C_META)5h limit $(fg "$c5")${p5}%$(fg $C_META)${DIM} · resets $(fmt_reset_clock "$RL5_RESET")${RESET}"
  fi
  if [ "$RL7_PCT" != "-1" ]; then
    local p7 c7; p7="${RL7_PCT%.*}"; c7="$(usage_color "${p7:-0}")"
    [ -n "$l3" ] && l3+="   ${SEP_PLAIN}   "
    l3+="$(fg $C_META)7d limit $(fg "$c7")${p7}%$(fg $C_META)${DIM} · resets $(fmt_reset_clock "$RL7_RESET")${RESET}"
  fi
  [ -n "$l3" ] && printf '%b\n' "$l3"
}

render_powerline() {
  # Background-segment style with arrow transitions. Foreground text is
  # near-black (color 235) so it reads on the bright segment backgrounds.
  local FG=235 seg
  local out=""
  segment() { # $1=bg color $2=text  ;  appends "<text> <arrow>"
    out+="$(bg "$1")$(fg $FG) $2 ${RESET}$(fg "$1")${SEP_GLYPH}${RESET}"
  }
  segment "$C_MODEL" "${MODEL}${EFFORT:+ ${EFFORT}}"
  segment "$C_DIR" "📁 ${dir_base}"
  [ -n "$git_segment" ] && segment "$C_GIT" "${git_segment# }"
  printf '%b\n' "$out"

  [ "$LINES" -lt 2 ] && return

  local uc filled empty bar i out2=""
  uc="$(usage_color "$CTX_PCT")"
  filled=$(( CTX_PCT * BAR_WIDTH / 100 ))
  [ "$filled" -gt "$BAR_WIDTH" ] && filled="$BAR_WIDTH"
  empty=$(( BAR_WIDTH - filled ))
  bar=""
  for ((i=0;i<filled;i++)); do bar+="█"; done
  for ((i=0;i<empty;i++));  do bar+="░"; done
  out2+="$(fg "$uc")${bar} ${CTX_PCT}%${RESET}"
  out2+=" $(fg $C_COST)\$$(printf '%.3f' "$COST")${RESET}"
  out2+=" $(fg $C_META)${DIM}$(fmt_dur "$DUR_MS")${RESET}"
  [ "$ADDED" != "0" -o "$REMOVED" != "0" ] && \
    out2+=" $(fg $C_ADD)+${ADDED}${RESET}$(fg $C_DEL)-${REMOVED}${RESET}"
  printf '%b\n' "$out2"

  # Rate-limit windows with wall-clock reset times (only when provided).
  local out3=""
  if [ "$RL5_PCT" != "-1" ]; then
    local p5; p5="${RL5_PCT%.*}"
    out3+="$(fg $C_META)5h limit $(fg "$(usage_color "${p5:-0}")")${p5}%$(fg $C_META)${DIM} · resets $(fmt_reset_clock "$RL5_RESET")${RESET}"
  fi
  if [ "$RL7_PCT" != "-1" ]; then
    local p7; p7="${RL7_PCT%.*}"
    [ -n "$out3" ] && out3+="   "
    out3+="$(fg $C_META)7d limit $(fg "$(usage_color "${p7:-0}")")${p7}%$(fg $C_META)${DIM} · resets $(fmt_reset_clock "$RL7_RESET")${RESET}"
  fi
  [ -n "$out3" ] && printf '%b\n' "$out3"
}

if [ "$POWERLINE" = "1" ]; then
  render_powerline
else
  render_plain
fi
