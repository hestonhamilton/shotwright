# ADR 0022 — Compare verdicts are a review aid

- **Status:** accepted
- **Date:** 2026-10-22
- **Bead:** `shotwright-746.28.4`
- **Phase the decision landed in:** I

## Context

The first external consumer uses shotwright for before/after parity and had to invoke separate pixel tools because the gallery only paired names. The previous no-verdict wording in `docs/design.md` assumed all visual differences should be reviewed without a computed summary. The E10 research and plan settle a report-by-default comparator with an opt-in exit gate; the docs bead will update the design text.

## Decision

Compare always computes seven states: `identical`, `similar`, `changed`, `size-changed`, `added`, `removed`, and `unreadable`. Exact decoded RGBA equality is `identical`; otherwise pixelmatch with recorded threshold and antialias setting distinguishes `similar` from `changed`. Every other state is non-parity. The HTML and JSON are review artifacts; process failure on non-parity is opt-in through `--fail-on-change`.

## Alternatives weighed

| Option | Pros | Cons | Why not |
|---|---|---|---|
| Pixelmatch and pngjs, report by default (chosen) | Deterministic counts, diff PNGs, mature PNG API | Decoding cost and threshold semantics must be documented | — |
| Raw PNG byte equality only | Cheap and simple | Encoding changes can hide visually identical pixels; no diff or ratio | Does not answer the consumer's parity question |
| Always fail on differences | One-step CI gate | Turns review output into a mandatory golden baseline | Conflicts with the project's review-first default |

## Consequences

- A reviewer can sort changed pairs first and inspect a diff beside the two originals.
- `compare.json` records the comparator settings, dimensions, counts, ratios, and state so a later reader can interpret the verdict.
- A zero pixelmatch count after unequal decoded bytes is `similar`, never `identical`.
- Large comparisons consume memory and time; the 250-pair fixture measures both. Output remains throwaway and is atomically replaced.
- Future tools must not silently change the seven state meanings or make the exit gate mandatory.

## Reversal

This amends the earlier no-pixel-verdict rule in `docs/design.md`. That rule kept shotwright focused on human review, but the first consumer demonstrated a distinct parity use where computed differences eliminate external shell tools. Report-by-default and an opt-in gate retain the human review workflow while answering that use case.
