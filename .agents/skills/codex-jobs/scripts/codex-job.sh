#!/usr/bin/env bash
# Sanctioned wrapper for the Codex companion CLI. Contract and rationale: the
# SKILL.md one directory up. Never hand-roll dispatch or polling — every ad-hoc
# variant of this loop has already failed at least once.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage:
  codex-job.sh dispatch [task flags] "<prompt>"   # background dispatch; prints job id on stdout
  codex-job.sh wait <job-id>                      # block until terminal; exit 0 iff completed
  codex-job.sh status [<job-id>] [--json]         # passthrough to companion status
  codex-job.sh result <job-id>                    # passthrough to companion result
  codex-job.sh selftest                           # verify companion resolution + status parser
EOF
  exit 2
}

companion_path() {
  # Version directory changes on plugin updates; always resolve the newest.
  ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null \
    | sort -V | tail -1
}

repo_root() {
  # The job registry is keyed by cwd and the sandbox's writable root is
  # inherited from it, so every companion call runs from the primary repo root
  # — this makes wait/status/result work from any worktree.
  dirname "$(git rev-parse --path-format=absolute --git-common-dir)"
}

companion() {
  local p
  p=$(companion_path)
  [ -n "$p" ] || { echo "codex-job.sh: codex-companion.mjs not found" >&2; exit 3; }
  (cd "$(repo_root)" && node "$p" "$@")
}

parse_status() {
  # stdin: `status <id> --json` output. stdout: the job.status value.
  python3 -c "import json,sys; print(json.load(sys.stdin)['job']['status'])"
}

job_status() {
  companion status "$1" --json 2>/dev/null | parse_status 2>/dev/null || echo unknown
}

cmd=${1:-}
case "$cmd" in
  dispatch)
    shift
    [ $# -ge 1 ] || usage
    out=$(companion task --background "$@")
    echo "$out" >&2
    id=$(grep -oE '(task|review|adv)-[a-z0-9]+-[a-z0-9]+' <<<"$out" | head -1)
    [ -n "$id" ] || { echo "codex-job.sh: no job id in dispatch output" >&2; exit 4; }
    echo "$id"
    ;;
  wait)
    id=${2:-}; [ -n "$id" ] || usage
    while :; do
      # --wait exits 0 on timeout AND completion, and can return spuriously
      # mid-run; it is only a cheap block. job.status is the authority.
      companion status "$id" --wait --timeout-ms 590000 >/dev/null 2>&1 || true
      s=$(job_status "$id")
      case "$s" in
        running|pending|unknown) sleep 5 ;;
        completed) echo "$id: completed"; exit 0 ;;
        *) echo "$id: $s"; exit 1 ;;
      esac
    done
    ;;
  status)
    shift
    companion status "$@"
    ;;
  result)
    id=${2:-}; [ -n "$id" ] || usage
    companion result "$id"
    ;;
  selftest)
    p=$(companion_path)
    [ -n "$p" ] || { echo "FAIL: companion not found"; exit 1; }
    echo "companion: $p"
    got=$(printf '{"job":{"status":"completed"}}' | parse_status)
    [ "$got" = "completed" ] || { echo "FAIL: parser returned '$got'"; exit 1; }
    got=$(printf 'not json' | parse_status 2>/dev/null || echo unknown)
    [ "$got" = "unknown" ] || { echo "FAIL: bad-input path returned '$got'"; exit 1; }
    echo "selftest: OK"
    ;;
  *)
    usage
    ;;
esac
