#!/usr/bin/env bash
# Layer A of the tarball leak gate — the file-set allowlist.
#
# Split out from leak-gate.sh so it can be exercised on its own against a
# constructed directory tree, with no packing and no scanner. leak-gate.sh calls
# this; it is NOT a bypass for the other layers, and nothing in CI runs it alone.
#
# Usage: check-file-set.sh <extracted-package-dir> [allowlist-file]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

target="${1:-}"
allowlist="${2:-$root/scripts/ci/expected-files.txt}"

if [[ -z "$target" ]]; then
  echo "check-file-set.sh: usage: check-file-set.sh <extracted-package-dir> [allowlist-file]" >&2
  exit 2
fi
if [[ ! -d "$target" ]]; then
  echo "check-file-set.sh: not a directory: $target" >&2
  exit 2
fi
if [[ ! -f "$allowlist" ]]; then
  echo "check-file-set.sh: allowlist not found: $allowlist" >&2
  exit 2
fi

# Read the allowlist into two arrays: exact paths, and prefixes from `dir/**`.
exact=()
prefix=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"                     # strip comments
  line="${line#"${line%%[![:space:]]*}"}" # ltrim
  line="${line%"${line##*[![:space:]]}"}" # rtrim
  [[ -z "$line" ]] && continue
  if [[ "$line" == */\*\* ]]; then
    prefix+=("${line%/\*\*}/")
  else
    exact+=("$line")
  fi
done < "$allowlist"

if [[ ${#exact[@]} -eq 0 && ${#prefix[@]} -eq 0 ]]; then
  echo "check-file-set.sh: allowlist is empty — refusing to pass everything: $allowlist" >&2
  exit 2
fi

unmatched=()
count=0

# -print0 so paths with spaces or newlines cannot split a record. A leak in a
# deliberately-named file is exactly the case that must not slip through.
while IFS= read -r -d '' file; do
  rel="${file#"$target"/}"
  count=$((count + 1))
  matched=0
  for e in "${exact[@]}"; do
    if [[ "$rel" == "$e" ]]; then matched=1; break; fi
  done
  if [[ $matched -eq 0 ]]; then
    for p in "${prefix[@]}"; do
      if [[ "$rel" == "$p"* ]]; then matched=1; break; fi
    done
  fi
  [[ $matched -eq 0 ]] && unmatched+=("$rel")
done < <(find "$target" -type f -print0 | sort -z)

if [[ ${#unmatched[@]} -gt 0 ]]; then
  echo "leak gate: LAYER A FAILED — ${#unmatched[@]} file(s) in the tarball are not covered by the allowlist" >&2
  for u in "${unmatched[@]}"; do
    echo "  unexpected: $u" >&2
  done
  echo >&2
  echo "not covered by scripts/ci/expected-files.txt — if these files are meant to" >&2
  echo "ship, add them there in the same PR that adds the files." >&2
  exit 1
fi

echo "leak gate: layer A ok — $count file(s), all covered by the allowlist"
