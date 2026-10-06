#!/usr/bin/env python3
"""board-audit candidate detector.

Reads the bd board via `bd list/ready --json` and flags the structural problems
the board-audit skill (Step 2) looks for, so the human pass starts from a ranked
candidate list instead of eyeballing a raw dump. Detection only — it NEVER mutates
the board (use apply.sh for that, and closures stay owner-confirmed).

Project-agnostic: it makes no assumption about the bead-id scheme (numeric,
alpha, compound, or dotted ids all work) — categories are derived from bead
structure (parent, status, priority, type), not id shape.

Usage:
  scripts/audit.py                 # grouped human report (default)
  scripts/audit.py --json          # machine-readable {category: [candidates]}
  scripts/audit.py --category orphan,stub
  scripts/audit.py --dump          # full bodies of every non-closed bead (Step 1 survey)

Categories: stub, orphan, deferred_ready, duplicate, mispriority, shipped_suspect.
Heuristic categories (shipped_suspect, some mispriority) are flagged VERIFY — confirm
against code/git before acting.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict

# Scaffold/empty body markers — a description that is only template chrome.
SCAFFOLD_MARKERS = (
    "## requirements",
    "## acceptance criteria",
    "## steps to reproduce",
    "- [ ]",
    "1.\n2.",
)
# Words that hint a bead may already be done (heuristic only → VERIFY).
SHIPPED_HINTS = re.compile(
    r"\b(shipped|merged|landed|done|completed?|already (?:added|implemented|fixed|done)|"
    r"fixed in|implemented in|live on prod|deployed)\b",
    re.IGNORECASE,
)


def bd_json(*args: str) -> list[dict]:
    """Run a bd subcommand with --json and parse the array (empty on failure)."""
    try:
        out = subprocess.run(
            ["bd", *args, "--json"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"audit: `bd {' '.join(args)} --json` failed: {exc}", file=sys.stderr)
        return []
    out = out.strip()
    if not out:
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def is_open(rec: dict) -> bool:
    return rec.get("status") != "closed"


def norm_title(title: str) -> str:
    t = title or ""
    t = re.sub(r"^\s*\[[^\]]+\]\s*", "", t)  # drop a leading [EPIC]/[BUG] tag
    return re.sub(r"\s+", " ", t).strip().lower()


def body_is_stub(rec: dict) -> bool:
    desc = (rec.get("description") or "").strip()
    if not desc or desc.lower() in {"(none)", "none", "tbd"}:
        return True
    low = desc.lower()
    # Strip markdown headers/checkboxes and see what real prose remains.
    stripped = re.sub(r"(?m)^#+.*$", "", desc)
    stripped = re.sub(r"(?m)^\s*[-*]\s*\[[ x]\].*$", "", stripped)
    stripped = re.sub(r"(?m)^\s*\d+\.\s*$", "", stripped)
    if len(stripped.strip()) < 40 and any(m in low for m in SCAFFOLD_MARKERS):
        return True
    return False


def detect(records: list[dict], ready_ids: set[str], deferred_ids: set[str]) -> dict[str, list[dict]]:
    by_id = {r["id"]: r for r in records}
    children: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        p = r.get("parent")
        if p:
            children[p].append(r)

    out: dict[str, list[dict]] = defaultdict(list)

    def add(cat: str, rec: dict, why: str, suggest: str) -> None:
        out[cat].append(
            {"id": rec["id"], "title": rec.get("title", ""),
             "priority": rec.get("priority"), "type": rec.get("issue_type"),
             "why": why, "suggest": suggest}
        )

    # stub / empty
    for r in records:
        if is_open(r) and body_is_stub(r):
            add("stub", r, "empty or scaffold-only description",
                "rewrite body + acceptance, or mark NEEDS OWNER DEFINITION")

    # orphan — an open, non-epic bead with no parent (a quick-capture with no epic home)
    for r in records:
        if is_open(r) and not r.get("parent") and r.get("issue_type") not in ("epic", "feature"):
            add("orphan", r, "no epic parent",
                "reparent into its epic (apply.sh reparent <id> <epic>)")

    # deferred epic with a ready child
    for epic_id in deferred_ids:
        kids = children.get(epic_id, [])
        ready_kids = [k["id"] for k in kids if k["id"] in ready_ids]
        if ready_kids:
            epic = by_id.get(epic_id, {"id": epic_id, "title": "", "priority": None, "issue_type": "epic"})
            add("deferred_ready", epic,
                f"deferred but has ready children: {', '.join(ready_kids)}",
                "un-defer the epic (apply.sh undefer <id>) or defer the children")

    # duplicate titles among open beads
    seen: dict[str, list[str]] = defaultdict(list)
    for r in records:
        if is_open(r) and r.get("title"):
            seen[norm_title(r["title"])].append(r["id"])
    for title, ids in seen.items():
        if len(ids) > 1:
            for rid in ids:
                add("duplicate", by_id[rid],
                    f"shares title with {', '.join(i for i in ids if i != rid)}",
                    "fold unique content into one survivor; stage the rest as closures")

    # mis-priority
    for r in records:
        if not is_open(r):
            continue
        pr = r.get("priority")
        if body_is_stub(r) and isinstance(pr, int) and pr <= 2:
            add("mispriority", r, f"undefined/stub bead sitting at P{pr}",
                "drop to P3 parking (apply.sh priority <id> 3)")
        if r.get("issue_type") == "epic":
            kid_prs = [k["priority"] for k in children.get(r["id"], [])
                       if is_open(k) and isinstance(k.get("priority"), int)]
            if isinstance(pr, int) and kid_prs and pr > min(kid_prs):
                add("mispriority", r,
                    f"epic at P{pr} but has an open child at P{min(kid_prs)} (epic less urgent than its work)",
                    f"bump epic to P{min(kid_prs)} (apply.sh priority <id> {min(kid_prs)})")

    # shipped-but-open suspects (HEURISTIC → verify)
    for r in records:
        if not is_open(r):
            continue
        title = r.get("title", "")
        # R/P/I/V Implement-phase tasks ([*.I] …) are work-not-yet-done by definition —
        # their bodies say "implement X", which trips the hint regex as a false positive.
        if ".I]" in title:
            continue
        blob = f"{title} {r.get('description','')} {r.get('acceptance_criteria','')}"
        if SHIPPED_HINTS.search(blob):
            add("shipped_suspect", r, "text hints the work may be done (VERIFY vs code+git)",
                "grep the symbol / git log -S; if shipped, stage as a closure")

    return out


def render_human(groups: dict[str, list[dict]]) -> str:
    order = ["stub", "orphan", "deferred_ready", "duplicate", "mispriority", "shipped_suspect"]
    labels = {
        "stub": "EMPTY / STUB DESCRIPTIONS",
        "orphan": "ORPHANS (no epic parent)",
        "deferred_ready": "DEFERRED EPICS WITH READY CHILDREN",
        "duplicate": "DUPLICATE TITLES",
        "mispriority": "MIS-PRIORITY",
        "shipped_suspect": "SHIPPED-BUT-OPEN SUSPECTS (verify vs code+git)",
    }
    lines: list[str] = []
    total = 0
    for cat in order:
        items = groups.get(cat, [])
        if not items:
            continue
        total += len(items)
        lines.append(f"\n=== {labels[cat]} ({len(items)}) ===")
        for c in items:
            lines.append(f"  {c['id']}  [P{c['priority']} {c['type']}]  {c['title']}")
            lines.append(f"      why: {c['why']}")
            lines.append(f"      → {c['suggest']}")
    header = f"board-audit candidates: {total} flag(s) across {len([c for c in order if groups.get(c)])} categories"
    return header + "\n" + "\n".join(lines) if lines else header + "\n(board looks clean)"


def render_dump(records: list[dict]) -> str:
    lines: list[str] = []
    for r in sorted((x for x in records if is_open(x)), key=lambda x: x["id"]):
        lines.append(f"\n############ {r['id']}  [P{r.get('priority')} {r.get('issue_type')}]  ({r.get('status')})")
        lines.append(f"title: {r.get('title','')}")
        lines.append(f"parent: {r.get('parent') or '(none)'}")
        lines.append(f"acceptance: {r.get('acceptance_criteria') or '(none)'}")
        lines.append("description:")
        lines.append(r.get("description") or "(none)")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="board-audit candidate detector (read-only)")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--dump", action="store_true", help="print full bodies of non-closed beads (Step 1 survey)")
    ap.add_argument("--category", help="comma-separated subset to show (stub,orphan,deferred_ready,duplicate,mispriority,shipped_suspect)")
    args = ap.parse_args()

    records = bd_json("list", "--all", "--limit", "0")
    if not records:
        print("audit: no beads returned from `bd list --all --json`", file=sys.stderr)
        return 1

    if args.dump:
        print(render_dump(records))
        return 0

    ready_ids = {r["id"] for r in bd_json("ready", "--limit", "0")}
    deferred_ids = {r["id"] for r in bd_json("list", "--deferred", "--limit", "0")}

    groups = detect(records, ready_ids, deferred_ids)
    if args.category:
        want = {c.strip() for c in args.category.split(",")}
        groups = {k: v for k, v in groups.items() if k in want}

    if args.json:
        print(json.dumps(groups, indent=2))
    else:
        print(render_human(groups))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
