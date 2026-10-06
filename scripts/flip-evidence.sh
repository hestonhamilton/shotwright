#!/usr/bin/env bash
# Regenerates the evidence for making this repository public (shotwright-746.18.6).
#
# The committed pack — docs/shotwright-746.18.6-evidence.md — is a SNAPSHOT with a
# date on it. This script is what makes that snapshot checkable rather than
# trusted. Run it immediately before flipping and compare the digest it prints
# against the one recorded in the pack. If the digest matches, nothing that this
# evidence covers has changed since the pack was read. If it differs, something
# did, and the pack must be re-read rather than re-trusted.
#
# WHY A DIGEST RATHER THAN A PASS/FAIL: this script deliberately does NOT
# adjudicate, for the same reason scripts/dolt-ref-inspect.sh does not. Several
# categories below legitimately match — the repo is full of synthetic leak
# fixtures, because that is how its gates prove they fire. A tool that decided
# which of those were benign would be encoding a judgement that belongs in the
# pack, where a human wrote down why. So: the binary checks exit non-zero on
# failure, the pattern sweeps report distinct values, and the digest tells you
# whether the set you are looking at is the set someone already adjudicated.
#
# WHAT IS NEVER WRITTEN INTO THIS FILE: the operator's username and the
# self-hosted forge hostname. Committing either would be the exact disclosure the
# sweep exists to detect. Both are derived from the runtime environment, so this
# script is correct on any machine and discloses nothing on all of them.
#
# Usage: scripts/flip-evidence.sh [--quiet]
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 1

quiet=0
[[ "${1:-}" == '--quiet' ]] && quiet=1

failures=0
findings_file="$(mktemp)"
trap 'rm -f "$findings_file"' EXIT

say()  { [[ "$quiet" -eq 1 ]] || echo "$@"; }
head2() { say ""; say "── $* ──"; }
fail() { echo "  FAIL  $*" >&2; failures=$((failures + 1)); }
pass() { say "  ok    $*"; }

# Everything that contributes to the digest goes through this, so the digest is
# a function of FINDINGS, not of formatting or of which machine ran it.
record() { printf '%s\n' "$*" >> "$findings_file"; }

say "shotwright flip evidence — $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ---------------------------------------------------------------------------
head2 "1. Identifiers derived from this machine (never committed)"
# $HOME's basename is the operator username on every layout this repo has run on.
# $USER is checked too because they can differ.
operator_names="$(printf '%s\n%s\n' "$(basename "$HOME")" "${USER:-}" | grep -v '^$' | sort -u)"
# Remote hostnames come from the configured remotes, which is where the
# self-hosted forge lives. Both push URLs of `origin` are covered.
remote_hosts="$(git remote -v | awk '{print $2}' | sed -E 's#^[a-z+]+://##; s#^[^@]*@##; s#[:/].*$##' | grep -v '^$' | sort -u)"
# This machine's non-loopback IPv4 addresses. A test fixture once carried the
# workstation's real LAN address, which a pattern sweep cannot tell from a
# synthetic one — only the machine itself knows which address is real. `ip` is
# preferred; `hostname -I` is the fallback where iproute2 is absent.
# Container and VM bridges are skipped — the same interface families the gallery
# server's LAN filter skips. Their addresses (docker0's 172.17.0.1 above all) are
# the same on every such host, identify nobody, and are committed as fixtures;
# `hostname -I` cannot tell them apart, so the fallback checks them too.
if command -v ip >/dev/null 2>&1; then
  machine_ipv4="$(ip -4 -o addr show 2>/dev/null \
    | awk '$2 !~ /^(docker|br-|veth|virbr)/ {print $4}' | cut -d/ -f1)"
else
  machine_ipv4="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$')"
fi
machine_ipv4="$(printf '%s\n' "$machine_ipv4" | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^127\.' | sort -u)"
# grep -c, not wc -l: these strings have no trailing newline, so wc -l reports
# one fewer than there are values and reads as 0 for a single identifier — which
# looks exactly like "we failed to derive anything" while the checks below are in
# fact running.
say "  operator identifiers: $(printf '%s' "$operator_names" | grep -c .) derived"
say "  remote hostnames:     $(printf '%s' "$remote_hosts" | grep -c .) derived"
say "  machine IPv4:         $(printf '%s' "$machine_ipv4" | grep -c .) derived"
say "  (values withheld from output — they are what we are searching FOR)"

# ---------------------------------------------------------------------------
head2 "2. Full-history secret scan"
if ! command -v gitleaks >/dev/null 2>&1; then
  fail 'gitleaks is not installed. FAILS CLOSED — an unscanned history must never report clean.'
  record 'gitleaks: NOT RUN'
else
  # Take the scanned-commit count from gitleaks itself. `git rev-list --all
  # --count` answers a DIFFERENT question — it includes every remote-tracking
  # branch — and reporting it here would overstate coverage by ~50 commits while
  # looking like a measurement.
  # `--report-path -` writes the report to stdout. An earlier revision used
  # /dev/stdout, which works in a shell but captured NOTHING inside a sandbox
  # where /dev/stdout is not writable — and because the exit status was never
  # read, the script then reported "0 finding(s)" over a history gitleaks had
  # just exited 1 on (redteam 2, 2026-10-05). The exit status is the contract:
  # 0 means clean, 1 means findings, anything else means the scan did not run.
  gl_err="$(mktemp)"
  gl_out="$(gitleaks git . --redact --report-format json --report-path - 2>"$gl_err")"
  gl_status=$?
  gl_n="$(printf '%s' "$gl_out" | grep -c '"RuleID"' || true)"
  gl_commits="$(grep -oE '[0-9]+ commits scanned' "$gl_err" | head -1 || true)"
  rm -f "$gl_err"
  if [[ "$gl_status" -ne 0 && "$gl_status" -ne 1 ]]; then
    fail "gitleaks exited $gl_status — the history was NOT scanned. FAILS CLOSED."
    record 'gitleaks: NOT RUN'
  elif [[ "$gl_status" -eq 1 && "$gl_n" -eq 0 ]]; then
    fail 'gitleaks exited 1 (findings) but no report was captured. FAILS CLOSED rather than report clean.'
    record 'gitleaks: REPORT LOST'
  elif [[ "$gl_status" -eq 0 && "$gl_n" -ne 0 ]]; then
    fail "gitleaks exited 0 but the report lists $gl_n finding(s) — inconsistent, treat as not scanned."
    record 'gitleaks: INCONSISTENT'
  fi
  say "  gitleaks $(gitleaks version 2>/dev/null), ${gl_commits:-commit count unreported}: $gl_n finding(s) (exit $gl_status)"
  # Fingerprints are stable across runs, so they are what the digest carries.
  printf '%s' "$gl_out" | grep -o '"Fingerprint": *"[^"]*"' | sed 's/.*: *"//; s/"$//' | sort | while read -r fp; do
    say "    $fp"
    record "gitleaks:$fp"
  done
  [[ "$gl_n" -eq 0 ]] && record 'gitleaks: none'
fi

# ---------------------------------------------------------------------------
head2 "3. Headed-public sweep — THE IDENTIFIERS THAT MUST NOT APPEAR"
# These are binary. Unlike the pattern sweeps below there is no benign match:
# the operator's real username and the private forge hostname have no legitimate
# reason to be in a committed file or in history.
history_blob="$(git log --all -p --no-color 2>/dev/null)"
tree_blob="$(git grep -rIh '' -- . 2>/dev/null)"

check_absent() {
  local label="$1" needle="$2"
  local n_tree n_hist
  n_tree="$(printf '%s' "$tree_blob"    | grep -acF "$needle" || true)"
  n_hist="$(printf '%s' "$history_blob" | grep -acF "$needle" || true)"
  if [[ "$n_tree" -ne 0 || "$n_hist" -ne 0 ]]; then
    fail "$label appears in committed content (tree:$n_tree history:$n_hist)"
    record "PRESENT:$label"
  else
    pass "$label absent from tree and all history"
    record "absent:$label"
  fi
}

while read -r name; do
  [[ -n "$name" ]] || continue
  check_absent "operator identifier" "$name"
done <<< "$operator_names"

# The forge hostname can only be derived where the forge remote is configured —
# the primary checkout. A fresh clone from GitHub, or from a local path, has no
# such remote, and silently skipping the check there would let a clone report a
# sweep it never ran (redteam 2, 2026-10-05). So the skip is RECORDED, which
# changes the digest: a digest that matches the pack means the forge check ran.
forge_checked=0
while read -r host; do
  [[ -n "$host" ]] || continue
  # github.com is expected — it is in package.json's repository URL by design.
  [[ "$host" == 'github.com' ]] && { pass "remote hostname github.com present as expected (repository URL)"; record 'expected:github.com'; continue; }
  check_absent "remote hostname" "$host"
  forge_checked=1
done <<< "$remote_hosts"
if [[ "$forge_checked" -eq 0 ]]; then
  say "  WARN  no non-GitHub remote configured here — the forge-hostname check did NOT run."
  say "        Run this from the primary checkout, where the forge remote exists."
  record 'forge-host: NOT CHECKED'
fi

# A dotted quad is matched whole: a bare substring match would let 10.0.0.3
# fire on 10.0.0.30, and a false hit here reads exactly like a leak.
check_absent_ipv4() {
  local label="$1" address="$2"
  local pattern n_tree n_hist
  pattern="(^|[^0-9.])${address//./\\.}([^0-9.]|\\.([^0-9]|\$)|\$)"
  n_tree="$(printf '%s' "$tree_blob"    | grep -acE "$pattern" || true)"
  n_hist="$(printf '%s' "$history_blob" | grep -acE "$pattern" || true)"
  if [[ "$n_tree" -ne 0 || "$n_hist" -ne 0 ]]; then
    fail "$label appears in committed content (tree:$n_tree history:$n_hist)"
    record "PRESENT:$label"
  else
    pass "$label absent from tree and all history"
    record "absent:$label"
  fi
}

machine_checked=0
while read -r address; do
  [[ -n "$address" ]] || continue
  check_absent_ipv4 "machine IPv4 address" "$address"
  machine_checked=1
done <<< "$machine_ipv4"
if [[ "$machine_checked" -eq 0 ]]; then
  say "  WARN  no non-loopback IPv4 address derived here — the machine-address check did NOT run."
  record 'machine-ipv4: NOT CHECKED'
fi

# ---------------------------------------------------------------------------
head2 "3b. Pre-squash history is absent and identities are noreply-only (ADR 0020)"
# The history that predates the 2026-10-05 scrub was rewritten twice and the
# repository recreated each time (ADR 0020, as amended). The old root commits
# and the heads of the superseded lines are the cheapest proof that a clone
# does NOT carry that history: if any of these objects exists here, this clone
# (or something it fetched from) is a superseded line, and every removed
# string is reachable again. Checked by object presence, not by ref, because a
# stale remote-tracking ref or a stash is enough to keep the objects alive.
old_objects=(
  ad4dfd60ce4439944c14cd4e55846499ca1ae9c3  # root of the original history
  a2c983bc5506af583ca46db3f16f2fddb2718529  # root of the first rewrite (strings only)
  b4fc9a3ddb230719c181b5397f0a8023a1c7428f  # main of the first recreation
  28b470ad1da59c04ab0813b4861666fa281339ae  # first recreation, after its PR #1
)
old_present=0
for obj in "${old_objects[@]}"; do
  if git cat-file -e "${obj}^{commit}" 2>/dev/null; then
    fail "superseded commit ${obj:0:7} is present — this clone carries a pre-squash history (ADR 0020). Do not flip from it."
    old_present=1
  fi
done
if [[ $old_present -eq 1 ]]; then
  record 'old-history: PRESENT'
else
  pass "none of the ${#old_objects[@]} superseded root/head commits is an object in this clone"
  record 'old-history: ABSENT'
fi

# The public history is authored and committed under GitHub noreply identities
# only (owner decision 2026-10-05, ADR 0020 amendment). A personal address in
# any commit header would be a regression the content scanners cannot see.
foreign_ident="$(git log --all --format='%ae%n%ce' | grep -v -E '(@users\.noreply\.github\.com|^noreply@github\.com)$' | sort -u | wc -l)"
if [[ "$foreign_ident" -ne 0 ]]; then
  fail "$foreign_ident commit identit(y|ies) outside users.noreply.github.com in history — set user.email to the noreply address and rewrite (ADR 0020)"
  record "commit-identity: FOREIGN:$foreign_ident"
else
  pass 'every commit author and committer is a users.noreply.github.com identity'
  record 'commit-identity: noreply-only'
fi

# ---------------------------------------------------------------------------
head2 "4. Pattern sweep — DISTINCT VALUES, adjudicated in the pack"
# Distinct values, never counts. The first run of this procedure elsewhere
# reported "255 email hits"; the distinct set was 2 real addresses plus `strings`
# fragments. A count is not a classification.
# ANCHOR THE PATTERNS, THEN TRIM. Two failures this repo already documented, both
# reproduced here on the first attempt and both fixed:
#
#   1. UNANCHORED OCTETS. A private-IP pattern that does not pin all four octets
#      matches version strings — `10.13.1` and `10.33.0` are pnpm versions, not
#      addresses. scripts/dolt-ref-inspect.sh's header records exactly this
#      (`10\.[0-9]` matching `pnpm@10.33.0`). Addresses are therefore extracted as
#      complete dotted quads and THEN filtered to RFC1918 ranges, rather than
#      trying to express "private" and "is an address" in one pattern.
#
#   2. CAPTURED CONTEXT MANUFACTURING DUPLICATES. grep -oE has no lookbehind, so
#      the leading context class lands in the output and the same value appears as
#      `'192.168.0.42`, `/192.168.0.42` and `` `192.168.0.42 ``. Counted three
#      times, that is not a classification. Each sweep trims with a pattern of its
#      own, because what counts as leading junk differs — a home path must keep
#      its slash, an address must not.
sweep() {
  local label="$1" pattern="$2" trim="$3"
  local vals
  vals="$( { printf '%s' "$tree_blob"; printf '%s' "$history_blob"; } \
    | grep -aoE "$pattern" | sed -E "$trim" | sort -u | grep -a . )"
  local n; n="$(printf '%s' "$vals" | grep -c . || true)"
  say "  $label: $n distinct"
  if [[ "$n" -gt 0 ]]; then
    [[ "$quiet" -eq 1 ]] || printf '%s\n' "$vals" | sed 's/^/      /'
    printf '%s\n' "$vals" | while read -r v; do [[ -n "$v" ]] && record "$label:$v"; done
  fi
}

sweep 'posix-home-path' '(^|[^A-Za-z0-9_.-])/home/[a-zA-Z0-9_.-]+' 's#^[^/]*##'
sweep 'windows-profile' 'C:\\Users\\[A-Za-z0-9_.-]+'             's/^[^C]*//'
sweep 'internal-host'   '(^|[^A-Za-z0-9_.-])[a-z0-9-]+\.(local|lan|internal|home\.arpa)\b' 's/^[^a-z0-9]*//'
say "  NOTE: internal-host collides by shape with ordinary property access —"
say "  'args.lan' and 'entry.internal' are JavaScript, not hostnames. Reported"
say "  rather than guessed at; the pack adjudicates them once."

# Addresses: extract complete quads, then filter. See failure 1 above.
ipv4_vals="$( { printf '%s' "$tree_blob"; printf '%s' "$history_blob"; } \
  | grep -aoE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}([^0-9.]|$)' \
  | grep -aoE '[0-9]{1,3}(\.[0-9]{1,3}){3}' \
  | awk -F. '($1==10)||($1==192&&$2==168)||($1==172&&$2>=16&&$2<=31)' \
  | sort -u )"
ipv4_n="$(printf '%s' "$ipv4_vals" | grep -c . || true)"
say "  private-ipv4: $ipv4_n distinct  (complete quads only; loopback excluded by construction)"
if [[ "$ipv4_n" -gt 0 ]]; then
  [[ "$quiet" -eq 1 ]] || printf '%s\n' "$ipv4_vals" | sed 's/^/      /'
  printf '%s\n' "$ipv4_vals" | while read -r v; do [[ -n "$v" ]] && record "private-ipv4:$v"; done
fi

# ---------------------------------------------------------------------------
head2 "5. Board ref disposition"
# Verify by looking, never by trusting config. The control that keeps this
# deleted is machine-local and does not survive a fresh clone, so this is not a
# one-time gate — it is why this script exists to be re-run.
dolt_refs="$(git ls-remote origin 2>/dev/null | grep -i dolt || true)"
if [[ -n "$dolt_refs" ]]; then
  fail 'refs/dolt/* present on a remote:'
  printf '%s\n' "$dolt_refs" | sed 's/^/        /' >&2
  record 'dolt-refs: PRESENT'
else
  pass 'no dolt refs on any remote (git ls-remote)'
  record 'dolt-refs: absent'
fi

# ---------------------------------------------------------------------------
head2 "6. Replacement backup"
# Deletion of the board ref is only safe because this exists. Never check with
# `bd backup status`, which reported a healthy backup of an empty database for
# the life of this project (shotwright-2sr.5).
# The destination is <host>:<path> and is deliberately NOT in this repository — a
# NAS address is exactly the shape the leak gate does not catch
# (shotwright-746.18.3). The installed systemd unit carries it, so derive it from
# there for the same reason the username and forge hostname are derived: this
# script must be correct on any machine and disclose nothing on all of them.
if [[ -z "${SHOTWRIGHT_BACKUP_DEST:-}" ]]; then
  unit="$HOME/.config/systemd/user/shotwright-beads-backup.service"
  if [[ -r "$unit" ]]; then
    SHOTWRIGHT_BACKUP_DEST="$(sed -nE 's/.*SHOTWRIGHT_BACKUP_DEST=([^"]*).*/\1/p' "$unit" | head -1)"
    export SHOTWRIGHT_BACKUP_DEST
    [[ -n "$SHOTWRIGHT_BACKUP_DEST" ]] && say '  (destination read from the installed systemd unit)'
  fi
fi
# --name is the package name, not the directory basename: a clone checked out
# under any other directory name would otherwise ask the destination for a
# database it has never held and fail for the wrong reason (redteam 2).
db_name="$(node -p "require('./package.json').name" 2>/dev/null || echo shotwright)"
if [[ -x scripts/backup-verify.sh ]]; then
  if bv_out="$(scripts/backup-verify.sh --name "$db_name" 2>&1)"; then
    pass 'backup-verify.sh: healthy'
    record 'backup: healthy'
  else
    fail 'backup-verify.sh reports the off-machine backup is NOT healthy:'
    printf '%s\n' "$bv_out" | tail -5 | sed 's/^/        /' >&2
    record 'backup: UNHEALTHY'
  fi
else
  fail 'scripts/backup-verify.sh missing or not executable'
  record 'backup: CHECKER MISSING'
fi

# ---------------------------------------------------------------------------
head2 "7. What this script does NOT establish"
cat <<'LIMITS'
  - It does not adjudicate section 4. A human decided those values are fixtures;
    this only tells you whether the SET has changed.
  - Deleting refs/dolt/data removed DISCOVERABILITY, not the objects. GitHub
    retains unreachable objects and they stay reachable by SHA. Accepted
    knowingly by owner decision — re-affirm at the moment of flipping.
  - It says nothing about OTHER repos on the account that may carry refs/dolt/data
    (shotwright-uke). No repo carrying one may be made public until its own ref
    is dispositioned.
  - Hostname detection is incomplete by construction: a LAN service reached at a
    public DNS name is indistinguishable from any other domain.
  - It does not judge candid internal prose, third-party names, or non-path PII.
    Those are judgement calls and belong to a reader.
LIMITS

# ---------------------------------------------------------------------------
digest="$(sort "$findings_file" | sha256sum | cut -c1-16)"
say ""
say "══ evidence digest: $digest ══"
say "   Compare against docs/shotwright-746.18.6-evidence.md. Same digest means the"
say "   adjudicated finding set is unchanged. Different means re-read the pack."

if [[ "$failures" -ne 0 ]]; then
  echo "" >&2
  echo "flip-evidence: $failures binary check(s) FAILED — do not flip" >&2
  exit 1
fi
say ""
say "flip-evidence: all binary checks passed"
exit 0
