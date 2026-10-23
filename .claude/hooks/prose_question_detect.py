#!/usr/bin/env python3
"""Detector for prose-question-guard.sh.

Reads an assistant message on stdin. Prints the offending line when the message
ends with an open question to the owner, nothing otherwise. Regex only.
"""

from __future__ import annotations

import re
import sys

# A heading that opens a parked list of questions; the list itself follows.
OPEN_LIST_RE = re.compile(
    r"^\W{0,4}(open\s+questions?|outstanding(\s+questions?)?|questions?\s+for\s+you|"
    r"decisions?\s+(needed|for\s+you)|your\s+call|needs?\s+(your|an?\s+owner)\s+"
    r"(decision|call|ok|input))\b",
    re.I,
)
# A "Waiting on you:" style heading with lines under it. Requires you/your/the
# owner after the verb, so "Waiting on the render" is a status line, not an ask.
WAITING_HEADING_RE = re.compile(
    r"^\W{0,4}(what\s+)?(i['\u2019]?m\s+|i\s+am\s+|still\s+)?"
    r"((waiting|blocked)\s+(on|for)|awaiting|pending(\s+on)?)\s+(from\s+)?"
    r"(you|your\s+\w+|the\s+owner)(\s+from\s+you)?\W{0,4}$",
    re.I,
)
# Phrases that are a question to the reader whatever the punctuation.
ASK_RE = re.compile(
    r"\b(want\s+me\s+to|shall\s+i|should\s+i|would\s+you\s+(like|prefer|rather)|"
    r"do\s+you\s+(want|prefer)|let\s+me\s+know\s+(which|if|whether|what|how|when)|"
    r"which\s+(do|would)\s+you\s+prefer|if\s+you('d|\s+would)\s+rather|"
    r"your\s+call|up\s+to\s+you|say\s+the\s+word|tell\s+me\s+(which|whether|if))\b",
    re.I,
)
# Shapes that look like an ask but are reporting, so they must not fire.
NOT_ASK_RE = re.compile(
    # "per your call" references a decision already made; "X is your call"
    # is a pending decision and stays blocked.
    r"\bper\s+your\s+call\b"
    # "a digest that will tell me if ..." has a tool as subject, not the owner.
    # Imperative "Tell me which to start" is untouched.
    r"|\b(will|can|would|could|should|to|it|that)\s+(\w+\s+){0,2}tells?\s+me\b",
    re.I,
)
FENCE_RE = re.compile(r"^\s*(```|~~~)")


def strip_code(text: str) -> str:
    out: list[str] = []
    fenced = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        out.append(line)
    return "\n".join(out)


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def unquoted(line: str) -> str:
    """Drop quoted spans: `code`, "..." and > blockquotes are not asks."""
    if line.lstrip().startswith(">"):
        return ""
    line = re.sub(r"`[^`]*`", "", line)
    line = re.sub(r"\"[^\"]*\"", "", line)
    line = re.sub(r"“[^”]*”", "", line)
    return line


def last_sentence(paragraph: str) -> str:
    text = " ".join(unquoted(ln) for ln in paragraph.splitlines()).strip()
    text = re.sub(r"[*_]+", "", text)
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    return parts[-1].strip() if parts else ""


def detect(message: str) -> str | None:
    paras = paragraphs(strip_code(message))
    if not paras:
        return None
    tail = paras[-1]
    # A parked list under an "Open questions:" style heading in the last three
    # paragraphs.
    for p in paras[-3:]:
        first = p.splitlines()[0]
        if OPEN_LIST_RE.match(unquoted(first).strip()):
            return first.strip()
        # Something must sit under the heading: its own lines, or a paragraph
        # after it ("**Waiting on you**", a blank line, then the bullets).
        under = len(p.splitlines()) > 1 or p is not tail
        if under and WAITING_HEADING_RE.match(unquoted(first).strip()):
            return first.strip()
    for ln in tail.splitlines():
        cleaned = NOT_ASK_RE.sub(" ", unquoted(ln))
        if ASK_RE.search(cleaned):
            return ln.strip()
    final = last_sentence(tail)
    if final.endswith("?"):
        return final
    return None


def main() -> int:
    hit = detect(sys.stdin.read())
    if hit:
        sys.stdout.write(hit[:300] + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
