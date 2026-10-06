#!/usr/bin/env python3
"""skill-scout transcript analyzer.

Read-only scan of Claude Code session transcripts (`*.jsonl`) for the friction
signals the skill-scout skill looks for, so the human pass starts from counted
patterns instead of eyeballing raw logs. Detection only — it NEVER mutates
anything (the transcripts are opened read-only).

Detects, over transcripts modified inside the --since window:
  (a) FAILED tool calls   — a tool_result with is_error, or text matching
                            Error|denied|failed.
  (b) REPEATED tool calls  — same tool name + first-arg shape >=3 times in a row.
  (c) LONG BASH CHAINS     — >=6 consecutive Bash tool_uses with no Skill
                            invocation between them.

Usage:
  scripts/scan.py                       # default window 7d, this project's dir
  scripts/scan.py --since 3d
  scripts/scan.py --since 12h --json    # JSON only (skip the human summary)
  scripts/scan.py --dir ~/.claude/projects/<encoded>/   # scan a specific dir

No third-party deps (stdlib only).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import time
from collections import Counter

FAIL_RE = re.compile(r"error|denied|failed", re.IGNORECASE)
DUR_RE = re.compile(r"^\s*(\d+)\s*([smhdw])\s*$", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}

REPEAT_MIN = 3   # same tool+shape this many times in a row = a repetition run
CHAIN_MIN = 6    # this many consecutive Bash uses = a long chain


def parse_since(text: str) -> float:
    """'7d' / '12h' / '30m' -> seconds. Falls back to 7d on bad input."""
    m = DUR_RE.match(text or "")
    if not m:
        return 7 * 86400.0
    return int(m.group(1)) * _UNIT_SECONDS[m.group(2).lower()]


def encoded_project_dir() -> str:
    """Claude Code encodes cwd as ~/.claude/projects/<cwd-with-/-as-->/."""
    encoded = os.getcwd().replace("/", "-")
    return os.path.join(os.path.expanduser("~/.claude/projects"), encoded)


def transcript_files(explicit_dir: str | None, cutoff: float) -> list[str]:
    """*.jsonl modified after cutoff. Prefer this project's dir; else scan all."""
    if explicit_dir:
        roots = [os.path.expanduser(explicit_dir)]
    else:
        derived = encoded_project_dir()
        roots = [derived] if os.path.isdir(derived) else sorted(
            glob.glob(os.path.join(os.path.expanduser("~/.claude/projects"), "*", ""))
        )
    files: list[str] = []
    for root in roots:
        for path in glob.glob(os.path.join(root, "*.jsonl")):
            try:
                if os.path.getmtime(path) >= cutoff:
                    files.append(path)
            except OSError:
                continue
    return sorted(set(files))


def result_text(block: dict) -> str:
    """Flatten a tool_result content (str, or list of {text:...} blocks)."""
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for item in c:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts)
    return ""


def arg_shape(tool_use: dict) -> str:
    """Normalized signature of a tool call: name + first-arg's leading token."""
    name = tool_use.get("name", "?")
    inp = tool_use.get("input")
    if not isinstance(inp, dict) or not inp:
        return name
    first_key = next(iter(inp))
    val = inp[first_key]
    if isinstance(val, str):
        token = val.strip().split()[0] if val.strip() else ""
        token = token[:48]
    elif isinstance(val, (int, float, bool)):
        token = str(val)
    else:
        token = type(val).__name__
    return f"{name}({first_key}={token})" if token else f"{name}({first_key})"


def iter_content(obj: dict):
    """Yield content blocks from a transcript record's message, if any."""
    msg = obj.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, list):
            yield from (b for b in content if isinstance(b, dict))


def scan_file(path: str, agg: dict) -> None:
    """Update aggregate counters from one transcript file."""
    tool_names: dict[str, str] = {}   # tool_use_id -> tool name
    sequence: list[str] = []          # ordered tool_use shapes (for repeats)
    bash_run = 0                      # current consecutive-Bash streak

    def flush_bash() -> None:
        nonlocal bash_run
        if bash_run >= CHAIN_MIN:
            agg["chains"].append(bash_run)
        bash_run = 0

    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(obj, dict):
                continue
            for block in iter_content(obj):
                btype = block.get("type")
                if btype == "tool_use":
                    name = block.get("name", "?")
                    tid = block.get("id")
                    if isinstance(tid, str):
                        tool_names[tid] = name
                    sequence.append(arg_shape(block))
                    # long-bash-chain tracking (Skill or any non-Bash breaks it)
                    if name == "Bash":
                        bash_run += 1
                    else:
                        flush_bash()
                elif btype == "tool_result":
                    is_err = block.get("is_error") is True
                    text = result_text(block)
                    if is_err or FAIL_RE.search(text):
                        tid = block.get("tool_use_id")
                        tname = tool_names.get(tid, "?")
                        m = FAIL_RE.search(text)
                        pat = m.group(0).lower() if m else "is_error"
                        agg["failures"][(tname, pat)] += 1
    flush_bash()

    # repetition runs: same shape >=REPEAT_MIN times in a row
    i = 0
    n = len(sequence)
    while i < n:
        j = i + 1
        while j < n and sequence[j] == sequence[i]:
            j += 1
        run = j - i
        if run >= REPEAT_MIN:
            agg["repeats"][sequence[i]] += 1
            agg["repeat_max"][sequence[i]] = max(agg["repeat_max"].get(sequence[i], 0), run)
        i = j


def build_report(agg: dict, files: list[str], window: str) -> dict:
    failures = [
        {"tool": t, "pattern": p, "count": c}
        for (t, p), c in sorted(agg["failures"].items(), key=lambda kv: -kv[1])
    ]
    repeats = [
        {"shape": s, "runs": c, "longest_run": agg["repeat_max"].get(s, 0)}
        for s, c in sorted(agg["repeats"].items(), key=lambda kv: -kv[1])
    ]
    chains = sorted(agg["chains"], reverse=True)
    return {
        "window": window,
        "transcripts_scanned": len(files),
        "failed_tool_calls": failures,
        "repeated_tool_calls": repeats,
        "long_bash_chains": {"count": len(chains), "lengths": chains},
    }


def render_human(report: dict) -> str:
    lines: list[str] = []
    lines.append(
        f"skill-scout scan · window {report['window']} · "
        f"{report['transcripts_scanned']} transcript(s)"
    )

    fails = report["failed_tool_calls"]
    lines.append(f"\nTOP FAILURE MODES ({sum(f['count'] for f in fails)} total):")
    if fails:
        for f in fails[:8]:
            lines.append(f"  {f['count']:>4}x  {f['tool']} — {f['pattern']}")
    else:
        lines.append("  (none)")

    reps = report["repeated_tool_calls"]
    lines.append(f"\nTOP REPETITION PATTERNS ({len(reps)} distinct):")
    if reps:
        for r in reps[:8]:
            lines.append(f"  {r['runs']:>4} run(s), up to {r['longest_run']} in a row  {r['shape']}")
    else:
        lines.append("  (none)")

    ch = report["long_bash_chains"]
    lines.append(f"\nLONG BASH CHAINS (>= {CHAIN_MIN} in a row): {ch['count']}")
    if ch["lengths"]:
        lines.append("  lengths: " + ", ".join(str(x) for x in ch["lengths"][:12]))

    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="skill-scout transcript analyzer (read-only)")
    ap.add_argument("--since", default="7d", help="window, e.g. 7d / 12h / 30m (default 7d)")
    ap.add_argument("--dir", help="transcript dir to scan (default: this project's)")
    ap.add_argument("--json", action="store_true", help="emit JSON only (no human summary)")
    args = ap.parse_args()

    cutoff = time.time() - parse_since(args.since)
    files = transcript_files(args.dir, cutoff)

    agg = {
        "failures": Counter(),
        "repeats": Counter(),
        "repeat_max": {},
        "chains": [],
    }
    for path in files:
        scan_file(path, agg)

    report = build_report(agg, files, args.since)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(json.dumps(report, indent=2))
        print("\n" + render_human(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
