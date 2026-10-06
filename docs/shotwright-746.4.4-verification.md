# shotwright-746.4.4 — E4.V: compare gallery verified by eyeball on a real UI change

Verified 2026-08-01 against merged `main` (`328fc9e`, PR #22). The compare
gallery itself was generated from real demo runs and rendered in headless
Chromium at 1440×1000, and the rendered page was inspected directly.

Verdict wording is deliberately narrow. An independent redteam reproduced this
verification end to end and found the first draft overclaimed in several places;
the wording below says only what the cited evidence establishes. Where something
is unproven it is labelled unproven, not softened.

## Epic acceptance — status

> Two runs of the demo app with a deliberate UI change between them produce a
> compare gallery where the change is findable by eyeball in under a minute.

**Partially established. The timing half is NOT established and requires an
owner pass.**

What this run *does* establish:

- Two runs with a deliberate UI change produce a compare gallery. Confirmed.
- The change is *visible* in that gallery, side by side and unmistakable, after
  selecting an affected pair. Confirmed by looking at the rendered page.
- Added-shot and removed-shot both render correctly on real runs. Confirmed.

What this run does **not** establish:

- **That a human finds the change in under a minute.** No person was timed. The
  first draft cited a 2.8 s scripted traversal as support; that measures
  automation navigating to a *known* target and is not evidence of human
  discovery of an *unknown* change. It has been withdrawn as support for the
  timing claim.

**Disposition (owner, 2026-08-01).** A blind owner pass on the generated artifact
was offered and **declined**; E4 closes on the tool-side evidence above with the
timing half left explicitly unproven. This is a recorded decision, not an
oversight, and it is deliberately not softened into a claim. Anyone later
treating "findable in under a minute" as an established property of this tool
should know it was never measured here.

The artifact used for that offer is reproducible from the commands below, so the
pass can be run at any time without redoing the verification.

## The deliberate change

Two edits between run A and run B, so that one run pair exercises a visual
change, an added shot, and a removed shot simultaneously.

1. **Visual change** — `demo/styles.css`, light-theme palette only. Four
   declarations, recorded in full so the edit is exactly reproducible:

   | Token | Before | After |
   |---|---|---|
   | `--accent` | `#0f766e` | `#b4530f` |
   | `--accent-strong` | `#095f59` | `#8f3f09` |
   | `--accent-soft` | `#d8eee9` | `#f7e2d2` |
   | `--accent-text` | `#075b55` | `#8a3d08` |

   Teal to orange. This is a realistic regression shape: a palette edit that
   propagates to buttons, links, focus rings and the dialog accent bar. It
   touches **only** the `:root` light block, not the `[data-theme='dark']` block.

2. **Added and removed shots** — `demo/shots/about.shots.ts`: the `390×844`
   `mobile-layout` capture was replaced with a `768×1024` `about-tablet` capture.
   `mobile-layout` is therefore removed in B and `about-tablet` added in B.

Both edits were reverted after the runs were taken. `shots-output/` is gitignored
throwaway output.

## Runs of record

```
$ pnpm run demo:shots
shotwright: 5 shot(s) → shots-output/2026-08-01T03-54-44_dc38     # run A, before
$ pnpm run demo:shots
shotwright: 5 shot(s) → shots-output/2026-08-01T03-55-13_3d62     # run B, after
```

Note `pnpm run demo:shots`, not `node dist/cli.js run` — `vite` resolves only
through pnpm's PATH, and the bare form fails with `vite: not found` and produces
an empty run.

```
$ node dist/cli.js compare 2026-08-01T03-54-44_dc38 2026-08-01T03-55-13_3d62 \
    --config demo/shots.config.ts
shotwright compare: selected A 2026-08-01T03-54-44_dc38 explicitly
shotwright compare: selected B 2026-08-01T03-55-13_3d62 explicitly
shotwright compare: wrote shots-output/compare/2026-08-01T03-54-44_dc38.vs.2026-08-01T03-55-13_3d62.html
$ echo $?
0
```

Filename is `<A>.vs.<B>.html` per ADR 0009. Exit 0 with two unmatched buckets
present, which is the exit-code invariant: compare exits 0 whenever it renders.

Artifact size **5,957,127 bytes** — that is 5.96 MB decimal (5.68 MiB), under the
shipped bound, which is a decimal `< 8_000_000` assertion
(`test/smoke/cli.test.ts:384`).

## Added-shot and removed-shot cases

Both exercised on the real run pair above, not on synthetic models. Parsed out of
the generated HTML:

| Shot | State in the artifact | Case |
|---|---|---|
| `mobile-layout` | `unmatched by name · A only` | **removed** in B |
| `about-tablet` | `unmatched by name · B only` | **added** in B |
| `about-desktop` | `paired` | |
| `form-filled` | `paired` | |
| `modal-open` | `paired` | |
| `theme-dark` | `paired` | |

Header badges: `6 name buckets`, `2 unmatched by name`, `not comparable` 0. Both
unmatched shots sort into `Needs eyeballs first`, above `Paired context`.

Neither is labelled `added` or `removed` in the UI, which is correct: manifests
carry no rename lineage, so a rename is indistinguishable from one removal plus
one addition. The page says `unmatched by name` and carries the copy *"A rename
appears as two unmatched buckets because manifests contain no rename lineage."*
This run exercised a genuine add and a genuine remove; the gallery does not claim
to know which, and should not.

An independent redteam reproduced this table from its own runs
(`2026-08-01T04-00-06_878e` / `2026-08-01T04-00-33_0153`) and matched it.

## Where the change became visible — as observed

**On first paint at 1440×1000, the accent change is not visible.** The two
attention tiles render live thumbnails; all four paired tiles — the only ones
that could show the regression — render as `Original queued · <W>×<H> intrinsic
pixels` placeholders. This is ADR 0005's bounded on-demand decode (at most three
tile pairs keep live previews). It is not an artifact of full-page screenshotting:
offscreen pairs stay queued after a full-page capture, because insertion is driven
by viewport intersection, not screenshot extent.

**Clicking a paired tile reliably loads it.** Clicking `form-filled` fills the
detail pane with both sides at full width, where teal (A) versus orange (B) is
unmistakable in the primary button, the field focus ring and the summary card.
This is the reliable path to seeing the change.

**Scrolling alone is NOT a reliable path, and the first draft was wrong to say it
was.** With four consecutive paired tiles and a three-pair live cap, scrolling to
the bottom of the sheet evicts the earlier pairs. Measured on the artifact:

```
after scrolling to the bottom of the sheet:
  about-desktop -> queued      (evicted)
  form-filled   -> queued      (evicted)
  modal-open    -> LIVE
  theme-dark    -> LIVE
```

So a reviewer who scrolls past a pair can arrive at the bottom with the pair they
wanted blank. The redteam observed the same behaviour independently. Selection,
not scrolling, is what reliably loads a pair.

`theme-dark` renders `paired` with both sides effectively identical — correctly,
since only light-theme tokens were edited. The redteam confirmed the A and B
`theme-dark` PNGs were byte-identical in its reproduction, so this is genuinely
unchanged rather than a miss being explained away. The artifact does not flag it
either way; it shows both sides and lets the eye decide. That is the intended
"review artifact · no verdicts" behaviour.

## A design tension worth naming

Attention-first ordering ranks by *presence and readability anomalies* —
`not-comparable`, then `a-only`, then `b-only`, then `paired`. A visual
regression lives by definition in a `paired` bucket, ranked **last**. Here the
changed pairs were below the fold; with a larger corpus they would be further
down. Combined with the eviction behaviour above, reaching the changed pairs is
the least-supported path through the page.

The first draft claimed this "is not fixable within E4's constraints". That was
too strong and is withdrawn. The precise statement: **ranking pairs by degree of
visual change would require computing a similarity measure, which invariant
check 5 forbids.** Navigation and layout remedies — a paired-only filter chip, a
jump link, a collapsible attention section, or revisiting the three-pair cap for
a two-image-per-tile layout — do none of that and are not forbidden. They are out
of scope for E4 as signed off, and are filed as follow-up rather than smuggled in
here.

## What this does *not* establish

- **No timed human trial**, and no blind discovery: every observation here was
  made by a reviewer who already knew which shot changed. Discovery time by
  someone who does not know is unmeasured.
- **One viewport, one browser.** Headless Chromium at 1440×1000 only. No
  phone-width or real-device review of the compare page. E3's gallery has that
  evidence; compare does not.
- **One corpus size.** Six name buckets, five shots per side. Large-corpus
  behaviour (60-vs-60, ~120 readable sides) remains a named follow-up.
- **No `not-comparable` on real captures.** Zero unreadable images occurred
  naturally. That state was exercised during E4.I against deliberately corrupted
  PNGs and is covered by unit tests; this run does not re-establish it.
- **No reproducible scroll-only path.** Which pairs remain live after scrolling
  depends on intersection order and bounded eviction, so the scroll path is
  observed, not specified.

## Invariant check 5 at the epic gate

Independently re-verified by the redteam against both the shipped source and the
DOM of a page it generated itself: **held**. The pair model carries state, the
two per-side shots, spec, stable order and an unreadability reason, and no
similarity field (`src/gallery/compare-model.ts:9`). Ordering reads only state
plus stable union order (`src/gallery/compare-model.ts:44`). PNG loading records
dimensions, byte length and a per-side data URI without relating A and B
(`src/gallery/model.ts:222`). The generated page has one script and no inline
JSON, and every `data-*` attribute is a key, search/filter tag, asset id, size
flag, or queued intrinsic dimension — nothing content-derived expressing A
relative to B.

## Verification status of the tree

On `328fc9e` plus this document's branch: typecheck clean, lint/publint clean,
unit **244/244 across 16 files**, smoke **18/18**.

One caveat on that smoke figure: the suite's `beforeAll` has now failed twice
independently — once during E4.I and once in the redteam's reproduction — with
Chromium `Unable to capture screenshot` during the video-capture setup run, which
skips all 18 tests. An immediate retry passed both times. The recorded passes are
real; the gate is flaky. Filed as follow-up.
