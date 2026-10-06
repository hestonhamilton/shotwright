#!/usr/bin/env bash
# Reads a `refs/dolt/data` ref on a git remote and classifies what is in it,
# using nothing but git and coreutils — no database, no `dolt` binary, and no
# clone of the working tree. That is the point: it answers "what would someone
# who found this ref be able to read?", so it must use only what such a person
# has.
#
# Usage:
#   scripts/dolt-ref-inspect.sh <git-remote-url> [options]
#   scripts/dolt-ref-inspect.sh --classify <strings-file> [options]
#
# Options:
#   --expect-prefix <p>  Bead-id prefix this ref is supposed to carry. Any other
#                        known prefix found is reported as cross-project leakage.
#   --out <dir>          Where to write the full distinct-value listings.
#                        Default: a fresh mktemp dir, printed at the end.
#   --list-cap <n>       Distinct values printed inline per category (default 40).
#                        The full set always goes to --out.
#   --hostnames "a b c"  Extra hostname substrings to search for. Also read from
#                        $DOLT_REF_INSPECT_HOSTNAMES. See "Hostnames" below.
#   --prefixes "a b c"   Bead-id prefix universe to match against, replacing the
#                        built-in list. scripts/dolt-ref-sweep.sh passes the
#                        enumerated repository names, so cross-project detection
#                        covers projects this script has never heard of. A fixed
#                        list reports 0 bead ids for an unknown project, and 0
#                        reads as clean. Without --prefixes the built-in list is
#                        `shotwright beads`, plus any prefixes in the environment
#                        variable $DOLT_REF_INSPECT_PREFIXES (space-separated,
#                        appended).
#
# `--classify` runs stages 4–5 over a file of already-extracted strings. It is
# how scripts/dolt-ref-inspect-selftest.sh drives the real classifier over
# synthetic input, so the self-test proves *this* code rather than a copy of it.
#
# ---------------------------------------------------------------------------
# Two corrections, both found the hard way in shotwright-2sr.1 §4.1, both
# asserted by the self-test. Do not undo either to make output tidier.
#
#   1. REPORT DISTINCT VALUES, NOT COUNTS. The first run of this procedure
#      reported "255 email hits". The distinct set was 2 real addresses plus
#      `strings` fragments split across .darc chunk boundaries. A count is not a
#      classification: 255 and 2 lead to different decisions, and only one of
#      them is true.
#
#   2. ANCHOR THE PATTERNS. A private-IP pattern of `10\.[0-9]` matched
#      `pnpm@10.33.0`. A bead-id pattern of `[a-z][a-z0-9]{2,}-[0-9a-z]{2,}`
#      matched UUID fragments and reported them as foreign project prefixes.
#      Loose patterns manufacture findings, and a manufactured finding costs the
#      same review time as a real one. All four octets are anchored here; bead
#      ids are anchored to a known prefix list.
#
# Hostnames: detection is INCOMPLETE BY CONSTRUCTION and the report says so.
# `.local`/`.lan`/`.internal`/`.home.arpa` are matched by suffix, but a LAN
# service reached at a public DNS name is indistinguishable from any other
# domain without knowing which names are the operator's. shotwright-746.18.3
# measured exactly this: the leak gate did not catch a self-hosted forge
# hostname, because it is not a host path, a LAN IP, or a username. Pass those
# names in via --hostnames or $DOLT_REF_INSPECT_HOSTNAMES rather than committing
# them — this repository is headed public.
#
# What this script does NOT do: adjudicate. Third-party names, financial or
# personal content, and candid internal prose are judgement calls (plan §7).
# The report points at the full extracted-strings file and says a human must
# read it. A script that scored those categories would be inventing authority it
# does not have.
set -euo pipefail

LC_ALL=C
export LC_ALL

# Bead-id prefixes known to the script. Correction 2: ids are matched only
# against these, never against a generic <word>-<word> shape. Extra prefixes come
# from $DOLT_REF_INSPECT_PREFIXES (space-separated) and are appended.
KNOWN_PREFIXES=(shotwright beads)
if [[ -n "${DOLT_REF_INSPECT_PREFIXES:-}" ]]; then
  read -r -a _extra_prefixes <<< "$DOLT_REF_INSPECT_PREFIXES"
  KNOWN_PREFIXES+=("${_extra_prefixes[@]}")
fi

remote=""
strings_file=""
expect_prefix=""
out_dir=""
list_cap=40
extra_hostnames="${DOLT_REF_INSPECT_HOSTNAMES:-}"

die() { echo "dolt-ref-inspect: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --classify)      strings_file="${2:-}"; shift 2 ;;
    --expect-prefix) expect_prefix="${2:-}"; shift 2 ;;
    --out)           out_dir="${2:-}"; shift 2 ;;
    --list-cap)      list_cap="${2:-}"; shift 2 ;;
    --hostnames)     extra_hostnames="${extra_hostnames} ${2:-}"; shift 2 ;;
    --prefixes)      read -r -a KNOWN_PREFIXES <<< "${2:-}"; shift 2 ;;
    -h|--help)       sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)              die "unknown option: $1" ;;
    *)               [[ -n "$remote" ]] && die "unexpected argument: $1"; remote="$1"; shift ;;
  esac
done

[[ -n "$remote" || -n "$strings_file" ]] || die 'need a git remote URL, or --classify <strings-file>'
[[ -z "$strings_file" || -r "$strings_file" ]] || die "cannot read --classify file: $strings_file"

if [[ -z "$out_dir" ]]; then
  out_dir="$(mktemp -d -t dolt-ref-inspect.XXXXXX)"
fi
mkdir -p "$out_dir"

work="$(mktemp -d -t dolt-ref-work.XXXXXX)"
trap 'rm -rf "$work"' EXIT

# --- stages 1-4: advertise, fetch, enumerate, extract -----------------------
#
# Skipped entirely in --classify mode, which starts at stage 5.

ref_bytes=0
ref_objects=0
refs_present=""

if [[ -z "$strings_file" ]]; then
  echo "==> stage 1: advertise check — $remote"
  # Fails closed: a remote that cannot be reached is not a remote with no refs.
  if ! git ls-remote "$remote" 'refs/dolt/*' 'refs/heads/*dolt*' > "$work/refs.txt" 2> "$work/lsremote.err"; then
    echo "  FAILED to reach the remote:" >&2
    sed 's/^/    /' "$work/lsremote.err" >&2
    die 'cannot classify what cannot be listed'
  fi

  if [[ ! -s "$work/refs.txt" ]]; then
    echo '  no dolt refs advertised'
    echo
    echo "RESULT: no refs/dolt/* or dolt-shaped branch on this remote. Nothing to classify."
    exit 0
  fi

  refs_present="$(awk '{print $2}' "$work/refs.txt" | sort -u | paste -sd, -)"
  sed 's/^/  /' "$work/refs.txt"

  echo "==> stage 2: fetch into a bare repo (no database, no dolt binary)"
  git init --quiet --bare "$work/bare"
  fetch_specs=()
  while read -r _sha refname; do
    [[ -n "$refname" ]] && fetch_specs+=("+${refname}:${refname}")
  done < "$work/refs.txt"
  git -C "$work/bare" fetch --quiet "$remote" "${fetch_specs[@]}" \
    || die 'fetch failed — the ref is advertised but could not be retrieved'
  echo "  fetched: $refs_present"

  echo "==> stage 3: enumerate"
  : > "$work/tree.txt"
  while read -r _sha refname; do
    git -C "$work/bare" ls-tree -r -l "$refname" 2>/dev/null >> "$work/tree.txt" || true
  done < "$work/refs.txt"

  if [[ ! -s "$work/tree.txt" ]]; then
    die 'refs fetched but no tree entries — unexpected ref shape, inspect by hand'
  fi

  ref_objects="$(wc -l < "$work/tree.txt" | tr -d ' ')"
  ref_bytes="$(awk '{ s += $4 } END { print s+0 }' "$work/tree.txt")"
  echo "  $ref_objects objects, $ref_bytes bytes"
  echo '  by extension:'
  awk '{ n = $NF; ext = (n ~ /\./) ? n : "(none)"; sub(/.*\./, "", ext);
         c[ext]++; b[ext] += $4 }
       END { for (e in c) printf "    %-10s %6d objects  %12d bytes\n", e, c[e], b[e] }' \
    "$work/tree.txt" | sort

  echo "==> stage 4: extract strings from every blob"
  strings_file="$work/strings.txt"
  : > "$strings_file"
  awk '$2 == "blob" { print $3 }' "$work/tree.txt" | sort -u | while read -r blob; do
    git -C "$work/bare" cat-file blob "$blob" | strings -n 6 >> "$strings_file" || true
  done
  echo "  $(wc -l < "$strings_file" | tr -d ' ') strings extracted"
fi

# --- stage 5: classify ------------------------------------------------------
#
# Correction 1 lives here: every category reports its DISTINCT set. The count
# printed is the count of distinct values, and the full set is always written to
# --out even when the inline listing is capped.

echo "==> stage 5: classify (distinct values, not hit counts)"

# report <slug> <label> <note>  — reads matches on stdin.
#
# Runs in a pipeline, so it is in a subshell and cannot update a counter in the
# parent. Distinct counts are accumulated through a file instead; getting this
# wrong would silently report "0 distinct hits" in the summary while the
# per-category sections showed findings.
: > "$work/counts.txt"
report() {
  local slug="$1" label="$2" note="${3:-}"
  local file="$out_dir/$slug.txt"
  sort -u > "$file"
  local n
  n="$(wc -l < "$file" | tr -d ' ')"
  echo "$n" >> "$work/counts.txt"
  echo
  echo "  --- $label ---"
  if [[ -n "$note" ]]; then
    echo "      $note"
  fi
  if [[ "$n" -eq 0 ]]; then
    echo "      0 distinct — no findings"
    return 0
  fi
  echo "      $n distinct:"
  head -n "$list_cap" "$file" | sed 's/^/        /'
  if [[ "$n" -gt "$list_cap" ]]; then
    echo "        … and $((n - list_cap)) more — full set: $file"
  fi
}

grep_o() { grep -Eoh -e "$1" "$strings_file" 2>/dev/null || true; }

# PII — email addresses.
grep_o '[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}' \
  | report emails 'Email addresses (PII)' \
    'Fragments split across .darc chunk boundaries appear here too — read the set, do not count it.'

# Credentials — real token shapes. Deliberately narrow: a false positive here
# costs the same review time as a real one.
{
  grep_o '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}'
  grep_o 'github_pat_[A-Za-z0-9_]{20,}'
  grep_o 'AKIA[0-9A-Z]{16}'
  grep_o 'xox[baprs]-[A-Za-z0-9-]{10,}'
  grep_o 'npm_[A-Za-z0-9]{30,}'
  grep_o 'sk-[A-Za-z0-9_-]{20,}'
  grep_o '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # Connection strings carrying an inline password.
  grep_o '[a-z][a-z0-9+.-]*://[A-Za-z0-9._%-]+:[^@/[:space:]]+@[A-Za-z0-9.-]+'
} | report credentials 'Credentials (real token shapes)'

# Credential-SHAPED prose, reported separately. R found 26 of these and 0 real
# credentials; merging the two categories would have read as 26 credentials.
grep_o '[^[:space:]]*([Tt]oken|[Ss]ecret|[Pp]assword|[Aa][Pp][Ii][_-]?[Kk]ey)[^[:space:]]*' \
  | report credential-prose 'Credential-shaped strings (prose ABOUT secrets, not secrets)' \
    'Expected to be non-empty on any issue tracker. Non-zero here is not a leak.'

# Host paths.
#
# Deliberately NOT tightened with a minimum path depth or length. Measured on
# the live shotwright ref: this fires on `/Users/e`, a chunk-split fragment of a
# bead note that says "/Users/ and /root/ unaffected" — prose about host paths,
# not a host path. Suppressing it would need a length floor, and a length floor
# would also suppress `/home/operat`, a truncated *real* leak. Between
# reporting a fragment a human dismisses in one second and hiding a truncated
# leak, only one of those errors matters. Asserted in the self-test.
{
  grep_o '/(home|Users|root)/[A-Za-z0-9._-]+[A-Za-z0-9._/-]*'
  grep_o '[A-Za-z]:\\Users\\[A-Za-z0-9._-]+[A-Za-z0-9._\\-]*'
} | report host-paths 'Host paths (username / machine layout)' \
    'Chunk-boundary fragments land here too, including fragments of prose ABOUT paths. Read the set.'

# Private-range IPv4. Correction 2: all four octets anchored, and the match is
# bounded so `pnpm@10.33.0` — three components — cannot match.
grep_o '(^|[^0-9A-Za-z.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9A-Za-z.]|$)' \
  | grep -Eo '(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]{1,3}\.[0-9]{1,3})' \
  | report private-ipv4 'Private-range IPv4 (all four octets anchored)' || true

# LAN-suffix hostnames, plus any operator hostnames passed in at runtime.
{
  grep_o '[A-Za-z0-9][A-Za-z0-9.-]*\.(local|lan|internal|home\.arpa)'
  for h in $extra_hostnames; do
    grep -Foh -- "$h" "$strings_file" 2>/dev/null || true
  done
} | report hostnames 'LAN / operator hostnames' \
    'INCOMPLETE BY CONSTRUCTION: a LAN service on a public DNS name looks like any other domain. Pass known names via --hostnames.'

# Bead ids, per known prefix. Correction 2: anchored to the prefix list, so a
# UUID fragment cannot be reported as a foreign project.
# Longest first, so a hyphenated prefix wins the alternation over `beads`. Names
# are reduced to the [a-z0-9-] a bd prefix can actually contain, which also
# means nothing reaching the regex needs escaping.
prefix_alt="$(printf '%s\n' "${KNOWN_PREFIXES[@]}" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9-]//g' \
  | grep -E '^[a-z][a-z0-9-]*$' \
  | awk '{ print length, $0 }' | sort -rn -k1,1 -k2,2 | cut -d' ' -f2- \
  | paste -sd'|' -)"
[[ -n "$prefix_alt" ]] || die 'no usable bead-id prefixes — --prefixes reduced to nothing'
grep_o "(^|[^A-Za-z0-9-])($prefix_alt)-[0-9a-z]+(\.[0-9]+)*" \
  | grep -Eo "($prefix_alt)-[0-9a-z]+(\.[0-9]+)*" \
  | report bead-ids 'Bead ids (known prefixes only)' || true

# Cross-project leakage: ids whose prefix is not the one this ref should carry.
if [[ -n "$expect_prefix" ]]; then
  if [[ -s "$out_dir/bead-ids.txt" ]]; then
    grep -Ev "^${expect_prefix}-" "$out_dir/bead-ids.txt" || true
  fi | report cross-project "Cross-project bead ids (expected prefix: $expect_prefix)" \
      'Non-empty means one project'"'"'s ref carries another project'"'"'s board.'
fi

# --- what this script cannot decide ----------------------------------------

full_strings="$out_dir/strings.txt"
cp "$strings_file" "$full_strings"

cat <<EOF

  --- Not classified here (judgement, plan §7) ---
      Third-party names, financial or personal content, and candid internal
      prose are not scored by this script. It has no basis to adjudicate them,
      and a category scored badly reads as a category cleared.
      Read them: $full_strings

==> summary
    remote:        ${remote:---classify mode}
    refs:          ${refs_present:-n/a}
    ref size:      ${ref_bytes} bytes across ${ref_objects} objects
    strings:       $(wc -l < "$full_strings" | tr -d ' ')
    distinct hits: $(awk '{ s += $1 } END { print s+0 }' "$work/counts.txt") (across all classified categories; see per-category above)
    listings:      $out_dir

    This is input to a disposition (plan §8), not a disposition. Deletion is
    gated on a proven restore and is out of scope for this script — it reads.
EOF
