#!/usr/bin/env bash
# Stop hook: block a turn whose final assistant message ends in an open
# question to the owner in prose instead of through AskUserQuestion.
#
# Reads the Stop payload, strips fenced code and quoted lines, and checks the
# tail of the message (final paragraph, or an "Open questions:" style heading
# in the last few paragraphs) with prose_question_detect.py. A hit returns
# {"decision":"block","reason":...} naming AskUserQuestion; stop_hook_active
# passes through so a second stop in the same turn is never blocked.
#
# Dials: PROSE_QUESTION_GUARD in .claude/scaffold.conf: on (block) / warn
# (systemMessage only) / off. ENFORCEMENT=warn/off also apply. Every failure
# path (no jq, no python3, unreadable JSON) falls through to allow.

set -euo pipefail

ENFORCEMENT="strict"
PROSE_QUESTION_GUARD="on"
conf="${CLAUDE_PROJECT_DIR:-.}/.claude/scaffold.conf"
# shellcheck disable=SC1090
[ -f "$conf" ] && source "$conf"

[ "${PROSE_QUESTION_GUARD:-on}" = "off" ] && exit 0
[ "$ENFORCEMENT" = "off" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

input="$(cat)"
[ -n "$input" ] || exit 0

# Already blocked once this turn: let the second stop through.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)" = "true" ]; then
  exit 0
fi

msg="$(printf '%s' "$input" | jq -r '.last_assistant_message // ""' 2>/dev/null || true)"
[ -n "$msg" ] || exit 0

hit="$(printf '%s' "$msg" | python3 "${BASH_SOURCE[0]%/*}/prose_question_detect.py" 2>/dev/null || true)"
[ -n "$hit" ] || exit 0

reason="$(printf 'The turn ends with an open question in PROSE:\n\n    %s\n\nA prose question scrolls out of the transcript and is effectively never asked (owner rule). Do one of these before stopping:\n\n  1. Ask it with the AskUserQuestion tool -- one question, 2-4 concrete options, your recommendation first.\n  2. Decide it yourself and say what you decided, then stop.\n\nIf the sentence is not actually a question for the owner (a rhetorical aside, a quoted line), reword it as a statement; this guard reads only the final paragraph.' "$hit")"

mode="$PROSE_QUESTION_GUARD"
[ "$ENFORCEMENT" = "warn" ] && mode="warn"
case "$mode" in
  warn) jq -n --arg m "ADVISORY (prose-question-guard): $reason" '{systemMessage:$m}'; exit 0 ;;
  *)    jq -n --arg r "$reason" '{decision:"block",reason:$r}'; exit 0 ;;
esac
