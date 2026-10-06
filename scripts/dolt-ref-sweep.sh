#!/usr/bin/env bash
# Sweeps every repository on a GitHub account for Dolt refs and runs
# scripts/dolt-ref-inspect.sh over each one that has them.
#
# Usage:
#   scripts/dolt-ref-sweep.sh --out <dir> [--owner <login>] [--hostnames "a b"]
#   scripts/dolt-ref-sweep.sh --out <dir> --list-only
#
# READ-ONLY. It fetches and classifies; it deletes nothing and pushes nothing.
# Deletion is gated on a proven restore and belongs to a later, separate step.
#
# ---------------------------------------------------------------------------
# Enumerates BY COMMAND, never from a stored list. shotwright-2sr.1 found nine
# repositories carrying Dolt refs on 2026-08-01; this script found ten on
# 2026-08-02. Repositories are created between runs, so a checked-in list would
# have reported the sweep complete while missing one. The count is an output,
# not an input.
#
# The bead-id prefix universe is re-derived the same way: every enumerated
# repository name is passed to the inspector as a candidate prefix. A fixed
# prefix list reports 0 bead ids for a project it has not heard of, and 0 reads
# as clean — the failure mode this whole epic exists to avoid.
#
# Output: one directory per repository under --out, each holding the inspector's
# distinct-value listings, plus sweep-summary.tsv across all of them.
#
# The listings quote ref contents verbatim, so --out must be OUTSIDE this
# repository or under the gitignored local/ scratch home. This repository is
# headed public.
set -euo pipefail

LC_ALL=C
export LC_ALL

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
inspect="$root/scripts/dolt-ref-inspect.sh"

owner=""
out_dir=""
list_only=0
hostnames="${DOLT_REF_INSPECT_HOSTNAMES:-}"

die() { echo "dolt-ref-sweep: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)     owner="${2:-}"; shift 2 ;;
    --out)       out_dir="${2:-}"; shift 2 ;;
    --hostnames) hostnames="${hostnames} ${2:-}"; shift 2 ;;
    --list-only) list_only=1; shift ;;
    -h|--help)   sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "unknown argument: $1" ;;
  esac
done

[[ -n "$out_dir" ]] || die '--out <dir> is required (put it outside this repo — the listings quote ref contents)'
[[ -x "$inspect" ]] || die "missing $inspect"
command -v gh >/dev/null 2>&1 || die 'gh is not installed'

if [[ -z "$owner" ]]; then
  owner="$(gh api user --jq .login)" || die 'could not resolve the GitHub login; pass --owner'
fi

mkdir -p "$out_dir"

echo "==> enumerating repositories for $owner"
gh repo list "$owner" --json name,visibility --limit 500 \
  --jq '.[] | "\(.name)\t\(.visibility)"' | sort > "$out_dir/repos.tsv" \
  || die 'gh repo list failed'
repo_total="$(wc -l < "$out_dir/repos.tsv" | tr -d ' ')"
echo "    $repo_total repositories"

# The prefix universe, re-derived from this enumeration.
prefixes="$(cut -f1 "$out_dir/repos.tsv" | tr '\n' ' ')"

echo '==> stage 1 across all repositories: which advertise Dolt refs'
: > "$out_dir/with-refs.tsv"
unreachable=0
while IFS=$'\t' read -r name vis; do
  if ! refs_out="$(GIT_TERMINAL_PROMPT=0 timeout 60 git ls-remote \
        "https://github.com/$owner/$name.git" 'refs/dolt/*' 'refs/heads/*dolt*' 2>/dev/null)"; then
    # Fails closed: unreachable is reported, never silently treated as "no refs".
    printf '%s\t%s\tUNREACHABLE\n' "$name" "$vis" >> "$out_dir/with-refs.tsv"
    unreachable=$((unreachable + 1))
    continue
  fi
  [[ -n "$refs_out" ]] || continue
  printf '%s\t%s\t%s\n' "$name" "$vis" \
    "$(printf '%s' "$refs_out" | awk '{print $2}' | sort -u | paste -sd, -)" >> "$out_dir/with-refs.tsv"
done < "$out_dir/repos.tsv"

with_refs="$(grep -vc 'UNREACHABLE' "$out_dir/with-refs.tsv" || true)"
echo "    $with_refs of $repo_total carry Dolt refs; $unreachable unreachable"
sed 's/^/    /' "$out_dir/with-refs.tsv"

if [[ "$unreachable" -gt 0 ]]; then
  echo "    WARNING: $unreachable repository(ies) could not be listed. The sweep is INCOMPLETE." >&2
fi

if [[ "$list_only" -eq 1 ]]; then
  echo "==> --list-only: stopping before inspection"
  exit 0
fi

echo '==> stages 2-5: inspect each repository carrying refs'
printf 'repo\tvisibility\temails\tcredentials\thost_paths\tprivate_ipv4\thostnames\tbead_ids\tcross_project\n' \
  > "$out_dir/sweep-summary.tsv"

while IFS=$'\t' read -r name vis refs; do
  [[ "$refs" == 'UNREACHABLE' ]] && continue
  echo "--- $name ($vis)"
  repo_out="$out_dir/$name"
  mkdir -p "$repo_out"
  if ! "$inspect" "https://github.com/$owner/$name.git" \
        --expect-prefix "$name" \
        --prefixes "$prefixes" \
        ${hostnames:+--hostnames "$hostnames"} \
        --out "$repo_out" > "$repo_out/report.txt" 2>&1; then
    echo "    FAILED — see $repo_out/report.txt" >&2
    printf '%s\t%s\tINSPECT-FAILED\n' "$name" "$vis" >> "$out_dir/sweep-summary.tsv"
    continue
  fi
  n() { [[ -f "$repo_out/$1.txt" ]] && wc -l < "$repo_out/$1.txt" | tr -d ' ' || echo 0; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$vis" \
    "$(n emails)" "$(n credentials)" "$(n host-paths)" "$(n private-ipv4)" \
    "$(n hostnames)" "$(n bead-ids)" "$(n cross-project)" >> "$out_dir/sweep-summary.tsv"
  echo "    done"
done < "$out_dir/with-refs.tsv"

echo
echo '==> sweep summary (DISTINCT values per category — see per-repo listings before concluding)'
column -t -s$'\t' "$out_dir/sweep-summary.tsv" 2>/dev/null || cat "$out_dir/sweep-summary.tsv"
cat <<EOF

    listings: $out_dir

    These counts are a map, not a verdict. A non-zero cell may be chunk-boundary
    fragments; a zero cell is only as good as the pattern behind it. Write the
    disposition from the listings (plan §8), not from this table.
EOF
