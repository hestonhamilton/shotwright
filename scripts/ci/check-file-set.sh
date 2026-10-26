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
unsafe_names=0
blocked_types=0
count=0

# Match the content scanner's host-path and username shapes against member
# names too. The leading slash makes a relative home/name/file member look
# like the absolute path that the content rule would reject. A supplied login
# is scanned as a whole token, just as leak-gate-config.sh does for contents.
login="${SHOTWRIGHT_OPERATOR_LOGIN:-}"
if [[ -n "$login" && ! "$login" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo 'check-file-set.sh: SHOTWRIGHT_OPERATOR_LOGIN must be a plain login' >&2
  exit 2
fi
login_pattern=''
if [[ -n "$login" ]]; then
  escaped="${login//./\\.}"
  login_pattern="(^|[^[:alnum:]_])${escaped}([^[:alnum:]_]|$)"
fi

# Applied to EVERY packed file, not just dist/ and templates/: a README.md whose
# bytes are a zip is as much a payload as a disguised dist/cli.js. Read bytes
# rather than extensions: an archive named example.js is still an archive.
# Text and the image formats used by the package stay admissible.
#
# MZ alone is not a PE: a JS file may legitimately begin `MZ = 1;`. A PE is
# confirmed by the `PE\0\0` signature at the little-endian 32-bit offset stored
# at 0x3C (e_lfanew). Short files or an offset outside the file are not PEs.
is_pe() {
  local file="$1" hex="$2" b off size sig
  [[ "$hex" == 4d5a* && ${#hex} -ge 128 ]] || return 1
  b="${hex:120:8}"
  off=$((16#${b:6:2}${b:4:2}${b:2:2}${b:0:2}))
  size="$(wc -c <"$file")"
  (( off + 4 <= size )) || return 1
  sig="$(od -An -v -tx1 -j "$off" -N 4 "$file" | tr -d '[:space:]')"
  [[ "$sig" == 50450000 ]]
}

blocked_magic() {
  local hex
  hex="$(od -An -v -tx1 -N 512 "$1" | tr -d '[:space:]')"
  is_pe "$1" "$hex" && return 0
  case "$hex" in
    504b0304*|504b0506*|504b0708*|1f8b*|377abcaf271c*|fd377a585a00*|425a68*|7f454c46*|feedface*|feedfacf*|cefaedfe*|cffaedfe*|cafebabe*|bebafeca*) return 0 ;;
  esac
  [[ "${hex:514:10}" == 7573746172 ]] # tar ustar at byte offset 257
}

# -print0 so paths with spaces or newlines cannot split a record. A leak in a
# deliberately-named file is exactly the case that must not slip through.
while IFS= read -r -d '' file; do
  rel="${file#"$target"/}"
  count=$((count + 1))
  scan_name="/$rel"
  if [[ "$scan_name" =~ /home/[^/[:space:]]+/|/Users/[^/[:space:]]+/|/root/ ]] \
    || [[ "$scan_name" == *'C:\Users\'* || "$scan_name" == *'c:\Users\'* ]] \
    || [[ "$scan_name" =~ [/\\]hestonhamilton([^[:alnum:]_]|$) ]] \
    || { [[ -n "$login_pattern" ]] && [[ "$scan_name" =~ $login_pattern ]]; }; then
    unsafe_names=$((unsafe_names + 1))
    echo 'leak gate: unsafe tar member name (redacted)' >&2
  fi
  if blocked_magic "$file"; then
    blocked_types=$((blocked_types + 1))
    echo "leak gate: archive or executable bytes in a packed file (name redacted)" >&2
  fi
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

if [[ $unsafe_names -gt 0 || $blocked_types -gt 0 ]]; then
  echo "leak gate: LAYER A FAILED — $unsafe_names unsafe member name(s), $blocked_types blocked file type(s)" >&2
  exit 1
fi

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
