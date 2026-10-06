---
name: skill-scout
description: Summarize recent transcripts looking for noise — failed tool calls, repeated tool calls, repetitive ad-hoc sequences — and surface candidate skill ideas. Use occasionally when sessions feel friction-heavy.
---

# skill-scout

Lightweight. A read-only scan of recent session transcripts, then a short report of
where friction clustered and whether a skill could absorb it. `.claude/skills/skill-scout/scripts/scan.py` does
the mechanical detection; the judgment (is this pattern skill-shaped, or just noise?)
stays with you.

## Companion script

- **`.claude/skills/skill-scout/scripts/scan.py`** — read-only transcript analyzer. Parses `*.jsonl` sessions
  modified inside a window and counts three friction signals. Never mutates anything.
  - `scan.py --since 7d` — human summary + JSON (default window `7d`; accepts `12h`, `30m`, …).
  - `scan.py --since 7d --json` — JSON only.
  - `scan.py --dir <path>` — scan a specific transcript dir (default: this project's,
    falling back to all projects filtered by mtime).
  - Signals: **failed tool calls** (tool + error pattern + count), **repeated tool
    calls** (same tool + first-arg shape >=3 in a row), **long Bash chains** (>=6
    consecutive Bash uses with no Skill between).

## Steps

1. Run `.claude/skills/skill-scout/scripts/scan.py --since <window>` (default `7d`).
2. Interpret the counts — the numbers are raw; you supply the meaning:
   - Text-matched failures (`error`/`failed`/`denied`) over-count (tool *output* that
     merely contains the word); weight `is_error` failures and recurring tool+pattern
     pairs more heavily.
   - A repetition run or long Bash chain is a candidate only if it's the *same intent*
     re-done by hand — not incidental `cd`/`echo`/`git` plumbing.
3. Surface **0–3 candidate skill ideas**, one line each: name guess, the recurring
   pattern it would absorb, why a skill beats doing it ad hoc. Zero is a fine answer.
4. Ask the owner which (if any) to act on. Only then create or amend a SKILL.md.

## Boundaries

- Never create/edit/delete SKILL.md files without explicit owner approval.
- The scan is read-only; don't act on the raw counts — interpret first.
- Keep the report short — bullet lists, not prose. No emoji.
