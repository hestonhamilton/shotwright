#!/usr/bin/env bash

# Never expose the forge token if tracing was enabled by the caller.
set +x
set -euo pipefail

readonly program="${0##*/}"
readonly expected_jobs=(verify shots)

fail() {
  printf '%s: %s\n' "$program" "$*" >&2
  exit 1
}

if (( $# != 1 )); then
  printf 'Usage: %s <sha>\n' "$program" >&2
  exit 2
fi

sha="${1,,}"  # the forge reports lowercase; an uppercase argument must still match
readonly sha
if [[ ! "$sha" =~ ^[[:xdigit:]]{40}$ ]]; then
  fail "SHA must be exactly 40 hexadecimal characters"
fi

for variable in SHOTWRIGHT_FORGE_API SHOTWRIGHT_FORGE_REPO SHOTWRIGHT_FORGE_TOKEN; do
  if [[ -z "${!variable:-}" ]]; then
    fail "required environment variable $variable is unset or empty"
  fi
done

# Reject a placeholder token before spending a request on it (shotwright-746.15).
#
# The runbook documents the export as `SHOTWRIGHT_FORGE_TOKEN=...   # see below`,
# with the real value described in prose underneath. Extracting the exports by
# grepping `export SHOTWRIGHT_FORGE_*` out of that runbook therefore sets the
# token to three literal dots — and the forge answers a bad token with 401,
# identical to what a revoked token returns.
#
# That cost a bug report reading "the token appears stale, revoked, or
# superseded" when the token was live the whole time. Prose telling the next
# person to be careful would not have prevented it; failing on the shape does.
if [[ "$SHOTWRIGHT_FORGE_TOKEN" == *...* || ! "$SHOTWRIGHT_FORGE_TOKEN" =~ ^[[:alnum:]_-]{20,}$ ]]; then
  fail "SHOTWRIGHT_FORGE_TOKEN does not look like a forge token — it is probably the
       runbook's placeholder rather than a real value. A bad token returns 401,
       which is indistinguishable from a revoked one, so this fails early instead.
       Source the real token; see 'Reading status' in local/forge-ci.md."
fi

readonly page_size=50
page=1
fetched=0
total_count=''

tmpdir="$(mktemp -d)" || fail "could not create a temporary directory"
readonly tmpdir
readonly page_file="$tmpdir/page.json"
readonly tasks_file="$tmpdir/tasks.jsonl"
trap 'rm -rf -- "$tmpdir"' EXIT
: >"$tasks_file"

while :; do
  # The token goes in via --config on stdin, never as an argument: anything in
  # argv is readable from `ps` by any user on the host.
  if ! printf 'header = "Authorization: token %s"\n' "$SHOTWRIGHT_FORGE_TOKEN" |
    curl --disable --config - --fail --silent --show-error \
    --header 'Accept: application/json' \
    --get \
    --data-urlencode "page=$page" \
    --data-urlencode "limit=$page_size" \
    "$SHOTWRIGHT_FORGE_API/repos/$SHOTWRIGHT_FORGE_REPO/actions/tasks" >"$page_file"; then
    fail "could not fetch task inventory page $page"
  fi

  if ! page_metadata="$({ python3 - "$page_file" "$tasks_file" <<'PY'
import json
import sys

page_path, tasks_path = sys.argv[1:]

try:
    with open(page_path, encoding="utf-8") as page_file:
        payload = json.load(page_file)
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid JSON response: {error}")

total_count = payload.get("total_count")
tasks = payload.get("workflow_runs")
if (
    isinstance(total_count, bool)
    or not isinstance(total_count, int)
    or total_count < 0
):
    raise SystemExit("response has an invalid total_count")
if not isinstance(tasks, list):
    raise SystemExit("response has no workflow_runs list")
if any(not isinstance(task, dict) for task in tasks):
    raise SystemExit("response contains a non-object task record")

with open(tasks_path, "a", encoding="utf-8") as tasks_file:
    for task in tasks:
        print(json.dumps(task, separators=(",", ":")), file=tasks_file)

print(f"{total_count}\t{len(tasks)}")
PY
  } 2>"$tmpdir/json-error")"; then
    json_error="$(<"$tmpdir/json-error")"
    fail "invalid task inventory page $page: $json_error"
  fi

  IFS=$'\t' read -r page_total page_count <<<"$page_metadata"
  if [[ -z "$total_count" ]]; then
    total_count="$page_total"
  elif (( page_total != total_count )); then
    fail "task inventory changed while paging: total_count was $total_count, then $page_total on page $page"
  fi

  fetched=$((fetched + page_count))
  if (( fetched == total_count )); then
    break
  fi
  if (( fetched > total_count )); then
    fail "task inventory exceeded total_count: fetched $fetched of $total_count records"
  fi
  if (( page_count == 0 )); then
    fail "short task inventory: fetched $fetched of $total_count records"
  fi

  (( page += 1 ))
done

python3 - "$tasks_file" "$sha" "${expected_jobs[@]}" <<'PY'
from collections import Counter
import json
import sys

tasks_path, sha, *expected_jobs = sys.argv[1:]
expected = set(expected_jobs)

with open(tasks_path, encoding="utf-8") as tasks_file:
    tasks = [json.loads(line) for line in tasks_file]

task_ids = []
for task in tasks:
    task_id = task.get("id")
    if isinstance(task_id, bool) or not isinstance(task_id, int) or task_id <= 0:
        raise SystemExit("NOT GREEN: task inventory contains an invalid task id")
    task_ids.append(task_id)

duplicate_ids = sorted(
    task_id for task_id, count in Counter(task_ids).items() if count > 1
)
if duplicate_ids:
    raise SystemExit(
        "NOT GREEN: task inventory contains duplicate task ids: "
        + ", ".join(str(task_id) for task_id in duplicate_ids)
    )

matching = [
    task
    for task in tasks
    if task.get("workflow_id") == "ci.yml" and task.get("head_sha") == sha
]
if not matching:
    raise SystemExit(
        f"NOT GREEN: no tasks for exact SHA {sha} in workflow ci.yml; "
        "the commit may never have reached the forge"
    )

for task in matching:
    run_number = task.get("run_number")
    if (
        isinstance(run_number, bool)
        or not isinstance(run_number, int)
        or run_number <= 0
    ):
        raise SystemExit("NOT GREEN: matching task has an invalid run_number")

newest_run = max(task["run_number"] for task in matching)
selected = [task for task in matching if task["run_number"] == newest_run]

for task in selected:
    if not isinstance(task.get("name"), str):
        raise SystemExit(
            f"NOT GREEN: run #{newest_run} contains a task with an invalid job name"
        )

name_counts = Counter(task["name"] for task in selected)
missing = sorted(expected - name_counts.keys())
extra = sorted(name_counts.keys() - expected)
duplicates = sorted(name for name, count in name_counts.items() if count > 1)

# A job that has not started yet is simply absent from the task list, so an
# in-flight run looks identical to a workflow that never declared the job.
# Both are not-green, but reporting a pending run as a broken inventory sends
# the reader to fix a workflow that is fine. If anything is still moving, say so.
in_flight = sorted(
    task["name"] for task in selected if task.get("status") in ("running", "waiting")
)
if missing and in_flight:
    raise SystemExit(
        f"NOT GREEN: run #{newest_run} is still in progress "
        f"({', '.join(in_flight)} running; {', '.join(missing)} not started yet)"
    )

if missing or extra or duplicates:
    problems = []
    if missing:
        problems.append("missing jobs: " + ", ".join(missing))
    if extra:
        problems.append("extra jobs: " + ", ".join(extra))
    if duplicates:
        problems.append(
            "duplicate jobs: "
            + ", ".join(f"{name} ({name_counts[name]} records)" for name in duplicates)
        )
    raise SystemExit(
        f"NOT GREEN: run #{newest_run} job inventory is not exact: "
        + "; ".join(problems)
    )

jobs = {task["name"]: task for task in selected}
for job_name in expected_jobs:
    status = jobs[job_name].get("status")
    if status != "success":
        raise SystemExit(
            f"NOT GREEN: run #{newest_run} job {job_name} has status "
            f"{status!r} (expected 'success')"
        )

summary = ", ".join(f"{name}=success" for name in expected_jobs)
print(f"GREEN: run #{newest_run}: {summary}")
PY
