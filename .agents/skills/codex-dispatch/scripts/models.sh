#!/usr/bin/env bash
# Print the listed models in a Codex home's models cache: slug, default
# reasoning level, supported levels. The cache is what the local CLI last
# fetched; a slug missing from it can still be accepted (SKILL.md says how to
# probe one), so read this as "what the CLI knows", not "what is allowed".
#
#   scripts/models.sh            # ~/.codex
#   CODEX_HOME=~/.codex-accounts/tab scripts/models.sh
set -euo pipefail
cache="${CODEX_HOME:-$HOME/.codex}/models_cache.json"
[ -r "$cache" ] || { echo "models.sh: no cache at $cache (run any codex command first)" >&2; exit 1; }
printf 'fetched: %s\n' "$(jq -r '.fetched_at // "?"' "$cache")"
jq -r '
  .models[]
  | select(.visibility == "list")
  | "\(.slug)\tdefault=\(.default_reasoning_level // "?")\tlevels=\([.supported_reasoning_levels[]?.effort] | join(","))"
' "$cache" | column -t -s $'\t'
