# shotwright-746.58 — Compare triage by changed fraction

Research read: 2026-10-29. Phase: R. Owner kickoff was supplied by the orchestrator: favor the compare UI in this bead, evaluate masking, and leave owner choices here.

## Goal and premise check

The adoption report says 102 of 124 pairs changed because volatile content overwhelms review. That is the consumer's reported observation, not a measurement reproduced in this worktree. The goal is to make the magnitude of each measured screenshot change easy to scan and order, while keeping every pair available for human review (`docs/design.md:32-36`; `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).

Two premises have aged: compare **already prints** `differentPixels / totalPixels` and a raw decimal ratio, but below the images rather than near the card title (`src/gallery/render-compare.ts:101-115`, `src/gallery/render-compare.ts:130-134`). The JSON already writes the ratio (`src/gallery/generate-compare.ts:268-281`). Pairs are **not simply in manifest order**: the model ranks changed first, then size-changed, unreadable, added/removed, and finally identical/similar; ties retain assembly order (`src/gallery/compare-model.ts:69-81`, `src/gallery/compare-model.ts:300-310`). The remaining gap is magnitude within the changed group, especially while scanning titles or the jump list (`src/gallery/render-compare.ts:188-205`).

`ratio` means pixelmatch's counted differing pixels divided by equal-sized decoded image pixels. It is `0` for identical and similar screenshots, and `null` for size-changed or unreadable shots; added/removed pairs and changed **data artifacts** have no image verdict and thus no ratio (`src/gallery/pixels.ts:63-77`, `src/gallery/pixels.ts:88-127`, `src/gallery/compare-model.ts:230-276`, `src/gallery/generate-compare.ts:268-281`). A high fraction does not establish importance: a large random area can rank above a small but serious defect. Pixelmatch's threshold determines which pixels count, and does not define an acceptable whole-image fraction (`src/gallery/pixels.ts:113-121`; `docs/adr/0022-compare-verdicts-are-review-aid.md:14-16`).

The current page has state chips, a live visible-pair count, and a jump list; filtering hides cards and their corresponding jump entries (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:188-213`). The generated page uses inline CSS/script and embedded image data with a restrictive CSP (`src/gallery/render-compare.ts:160`, `src/gallery/render-compare.ts:207-213`). Compare's existing 44 px control minimum and narrow-screen padding are explicit (`src/gallery/render-compare.ts:210-212`).

## Prior art and current practice

All external sources below were read **2026-10-29**. These are patterns, not evidence that any product offers a specific “sort by changed fraction” control unless stated.

| Tool / source | Observed practice and implication |
| --- | --- |
| [Argos diff overview](https://argos-ci.com/diff) and [2026-03-30 tag-filter changelog](https://argos-ci.com/changelog/2026-03-30-screenshot-filters) | Argos presents a score beside a diff and offers composable tag filters. This supports a visible magnitude cue plus navigation, but its score includes normalization and clustering, so it is **not equivalent** to shotwright's pixel ratio. No exact magnitude-sort claim is inferred. |
| [Chromatic quickstart](https://www.chromatic.com/docs/quickstart/) | Changed snapshots appear in a Tests table, then a reviewer inspects baseline/new/diff and decides. This supports keeping magnitude as a triage cue, not an approval or regression verdict. Its managed-baseline workflow differs from shotwright's disposable-run model (`docs/adr/0024-review-based-baselines-declined.md:18-39`). |
| [Percy visual-testing basics](https://www.browserstack.com/docs/percy/overview/visual-testing-basics) and [matching-diff grouping](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/snapshot-grouping-with-matching-diffs) | Percy groups snapshots with matching diff geometry and allows review of individual snapshots or groups. Grouping is another way to reduce repetitive review, but requires change-shape semantics beyond the existing single fraction. No percentage-sort claim is inferred. |
| [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) and [screenshot assertion API](https://playwright.dev/docs/api/class-pageassertions) | Playwright documents a per-pixel threshold separately from `maxDiffPixelRatio` and `maxDiffPixels`, which are assertion tolerances. That distinction argues against using a page threshold filter as a new gate. Playwright's own workflow emits assertion diffs rather than a multi-pair triage page. |
| [reg-suit README](https://github.com/reg-viz/reg-suit) | reg-suit compares images and publishes an HTML report. Its public README establishes paired visual review, but does not document magnitude ordering; it offers no basis to claim that as a standard UI convention. |
| [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) | WCAG 2.2 minimum targets are 24 CSS px with exceptions. Retain the project's larger 44 px controls and visible keyboard focus; use a labelled native select for sort and the existing button semantics for state filters. |

### Masking currency

[Playwright `page.screenshot`](https://playwright.dev/docs/api/class-page#page-screenshot), [locator screenshot](https://playwright.dev/docs/api/class-locator#locator-screenshot), and [`toHaveScreenshot`](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot) document `mask: Locator[]`: matching elements are covered by a bounding-box overlay, including invisible matches, defaulting to pink `#FF00FF`; `maskColor` changes that color. A capture-time `style`/assertion `stylePath` can also hide volatile content; [Playwright's snapshot guide](https://playwright.dev/docs/test-snapshots#stylepath) documents a project-wide assertion `stylePath`. Read 2026-10-29. These are capture/assertion mechanisms, not post-hoc ignore rectangles.

Shotwright already forwards explicit per-shot `mask` and `style` to both `page.screenshot()` and `locator.screenshot()` (`src/capture.ts:25-39`, `src/capture.ts:188-204`); `maskColor` is not in `ShotOptions` (`src/capture.ts:25-39`). `defineShotsConfig` has no harness-wide mask field (`src/index.ts:24-33`). The consumer pilot recorded byte-identical `shot()` and Playwright screenshots for the same viewport and device scale factor (`docs/shotwright-746.28-consumer-brief.md:294-305`), and current capture writes the Playwright buffer directly (`src/capture.ts:188-205`). **Inference:** an implicit global capture mask changes the default bytes relative to a bare Playwright screenshot whenever a selector matches. Explicit per-shot masking is consistent with equivalence when both captures use the same options; a new global default needs a deliberate change to that contract. A compare-time ignore region would preserve capture bytes but would require a new pair-coordinate policy for differing sizes/DSF, changes to counts and diff images, and honest disclosure of excluded pixels (`src/gallery/pixels.ts:85-127`, `src/gallery/generate-compare.ts:268-281`). It should not be smuggled into this UI bead.

## Options

| Option | Benefit | Cost / constraint |
| --- | --- | --- |
| **Recommended: visible percent + client-side magnitude sort** | Put “N% pixels changed” beside the changed shot title and jump entry, and offer “Current order” / “Most changed first” in a native select. Reuses `ratio` without changing verdicts or compare JSON (`src/gallery/render-compare.ts:101-115`, `src/gallery/generate-compare.ts:268-281`). | A little inline script must reorder cards and jump entries together; IDs, diff sidecars, and state remain fixed (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:200-205`, `src/gallery/generate-compare.ts:268-281`). |
| Percent only, retain current order | Smallest static change, works without JavaScript. | Reviewers still have to scan every changed card to find larger changes (`src/gallery/compare-model.ts:69-81`). |
| Percent + sort + “changed above N%” filter | Quickly hides low-fraction screenshots in a noisy run. | Adds a second independent filter, zero-result recovery, threshold validation and explanation; can conceal small meaningful changes. A UI threshold must never feed `isGatedPair` (`src/gallery/compare-model.ts:40-52`). |
| Server/model magnitude order by default | Most changed cards appear first even without JavaScript. | Changes JSON pair order and `pair-N`/diff-file numbering, which derive from model order (`src/gallery/compare-model.ts:306-310`, `src/gallery/render-compare.ts:200-205`, `src/gallery/generate-compare.ts:268-281`). |
| Global capture mask or compare-time ignored regions | Can reduce volatile-content noise at its source. | Global mask changes default capture bytes; region exclusion changes comparator semantics and needs provenance. Both exceed this navigation-only change (`src/capture.ts:188-205`, `src/gallery/pixels.ts:113-127`). |

## Recommendation

Keep the existing model/JSON order and all seven states. For **changed screenshot** cards, place a percent in the heading area, with the exact counts retained in the body. Compute display text from the existing ratio; use enough precision that a positive change never rounds to “0%” (for example `<0.1%` for values below a tenth percent, otherwise one decimal place). State clearly that this is the fraction of pixels pixelmatch counted as different, not a severity or approval score (`src/gallery/pixels.ts:113-127`, `src/gallery/render-compare.ts:101-115`). For changed artifacts, show “Changed artifact — pixel fraction unavailable”; for size-changed, added, removed, and unreadable states, show no invented percentage (`src/gallery/compare-model.ts:230-288`, `src/gallery/pixels.ts:63-97`).

Add a native, visibly labelled sort select: **Current order** (default) and **Most pixels changed first**. Sort only the changed screenshot cards by their unrounded ratio, descending, with original model order as a stable tie-break; leave other states in their existing relative groups. Reorder the jump list in the same order while retaining each `#pair-N` ID and diff filename. Preserve the active state filter and visible count. If a selected card is hidden by a state filter, maintain the existing hash-recovery behavior. Default/current order and all cards remain usable with JavaScript disabled (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:188-213`). A static sort control should start disabled until the inline script binds, matching the existing filter controls (`src/gallery/render-compare.ts:188-199`).

Defer the optional percent threshold filter: it is not needed to satisfy sort and could hide a small meaningful change. If later requested, it must be presentation-only, compose with state filters, show “X of Y” and an explicit empty state, and never change JSON, gate counts, `--fail-on-change`, or exit status (`src/gallery/render-compare.ts:19-50`, `src/gallery/compare-model.ts:40-52`; `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`). Test the sort at desktop and 320/390 px mobile in light/dark themes, with keyboard navigation and visible focus. Keep targets at least 44 px high, wrapping controls, no horizontal page overflow, and the first card reachable without excessive header growth (`src/gallery/render-compare.ts:210-213`; `docs/shotwright-746.42-verification.md:15-24`). View the resulting UI before shipping, per `CLAUDE.md:107-108`.

**Mask scope:** defer to a follow-up bead; the orchestrator should create it after owner review, since this Research contract forbids `bd` writes. Its Research should compare (1) explicit per-shot mask convenience, including `maskColor`, (2) opt-in config mask with an explicit capture-equivalence contract revision, (3) compare-time region exclusion with measurable denominator/provenance, and (4) deterministic consumer test data. Existing per-shot `mask` and `style` are available now (`src/capture.ts:25-39`, `src/capture.ts:188-204`). An ignore region must never silently turn `changed` into `identical` or alter gate behavior without a separately accepted decision (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).

## Binding surface and versioning

Recommended scope adds HTML presentation and client-side interaction only. No CLI flag, config field, manifest field, workflow input, published export, comparator rule, or compare JSON schema changes (`src/cli.ts:80`, `src/index.ts:24-33`, `src/gallery/generate-compare.ts:250-281`, `src/gallery/model.ts:604-639`). The page's default order, fragment IDs, and sidecar naming stay stable (`src/gallery/compare-model.ts:69-81`, `src/gallery/render-compare.ts:200-205`, `src/gallery/generate-compare.ts:268-281`). Recommend a compatible **patch** for the current `0.6.0` package (`package.json:3`), yielding `0.6.1` if released alone. A future opt-in config mask or new compare option is an additive public API; recommend a **minor** `0.7.0` if released alone. Changing default capture bytes or existing ratio/gate semantics requires a separately approved compatibility decision.

## ADR assessment

**No new ADR for this bead.** This is a scoped, reversible HTML affordance over an existing ratio; ADR 0022 already binds the review-versus-gate semantics (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`, `docs/adr/0022-compare-verdicts-are-review-aid.md:28-32`). No ADR was written. The highest numbered ADR present during this research was `0026` (`docs/adr/0026-ci-artifact-upload-policy.md:1`); if the later mask work creates a binding policy, it should check the next free number at that time (currently `0027`), because other lanes may claim it.

## Open questions for the owner

1. Accept compare-page-only scope and a separate masking bead, as recommended, or broaden this bead to a capture/compare semantic change?
2. Keep only the magnitude sort now, as recommended, or also add a presentation-only percentage threshold filter? The filter must not affect gating (`src/gallery/compare-model.ts:40-52`).
3. Should “Most pixels changed first” reorder only changed screenshots (recommended), with state groups intact, or rank every comparable screenshot across states? The existing state order is deliberate (`src/gallery/compare-model.ts:69-81`).

## Considered and declined

- Do not label the fraction “severity” or use it as approval/regression judgment: pixel area is not semantic importance (`src/gallery/pixels.ts:113-127`; `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).
- Do not make a percent cutoff a new `--fail-on-change` or `--ignore` rule. `--ignore` is exact-key selection that leaves measured states intact (`src/cli.ts:80`, `docs/adr/0022-compare-verdicts-are-review-aid.md:16`).
- Do not mutate compare JSON order or rewrite diff PNG indexes for a visual sort (`src/gallery/generate-compare.ts:268-281`).
- Do not add a harness-wide default mask in this bead; the existing explicit per-shot `mask` preserves the consumer's control of capture options (`src/capture.ts:25-39`, `src/capture.ts:188-205`).

## Self-review against R rubric

| Lens | Result |
| --- | --- |
| Measured or flagged | Pass: 102/124 is identified as a consumer report, not reproduced; no performance claim or benchmark is made. |
| Derived-value semantics | Pass: ratio numerator/denominator, null states, artifacts, precision, ties, and zero are defined (`src/gallery/pixels.ts:63-127`, `src/gallery/compare-model.ts:270-276`). |
| Emergent structure | Pass: existing state groups, stable tie order, paired card/jump order, fixed IDs, and diff-index coupling are stated (`src/gallery/compare-model.ts:69-81`, `src/gallery/render-compare.ts:200-205`, `src/gallery/generate-compare.ts:268-281`). |
| Batch/concurrency | Pass: client-side sort mutates only the open document; no file publication or concurrent writer changes. Existing compare generation stages sidecars and HTML (`src/gallery/generate-compare.ts:69-74`). |
| Inherited constraints | Pass: recommendation preserves ADR 0022 gate semantics and capture buffer forwarding; mobile control constraints are in current CSS (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`, `src/capture.ts:188-205`, `src/gallery/render-compare.ts:210-213`). |

## Redteam amendments (2026-10-29)

A redteam returned "proceed with changes". Adopted:

1. **Label the sort by what it sorts (fix now).** The sort uses the pixel fraction `ratio` (`src/gallery/pixels.ts:117`), not an absolute count. The control reads "Highest percentage changed first" and its description says it sorts by fraction.
2. **Pair jump links with cards by fragment ID.** The state filter pairs cards with jump entries by array index (`src/gallery/render-compare.ts:20,32`). Reordering either list without rebuilding that mapping can hide the wrong jump link. The plan pairs them by fragment ID and pins "sort, then filter" in a browser check.
3. **Reframe the masking follow-up.** Byte equivalence with `page.screenshot()` is conditional on matching options, and `shot()` already forwards explicit masks (`src/capture.ts:174,188`). The follow-up asks whether a configured default mask is applied consistently and disclosed in the manifest and gallery, not whether the invariant must change. Filed as a separate bead.
4. **Declined:** the optional percentage threshold filter. It can hide small, meaningful changes, and the acceptance makes it optional.
5. **Wording:** Percy grouped snapshots can be inspected but not approved individually; read "inspect" where the prior-art section implies individual review decisions.
