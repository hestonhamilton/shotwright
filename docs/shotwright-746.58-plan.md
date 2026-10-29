# shotwright-746.58 — Compare magnitude triage plan

Phase: P. Binding input: `docs/shotwright-746.58-research.md`, including its Redteam amendments, and the owner's decisions recorded with this task. This plan covers the compare page only. Configured masking is tracked separately as `shotwright-746.66` (read-only `bd show` during P); no threshold filter is planned.

## Goal and premise re-check

Make the fraction of changed screenshot pixels visible while scanning cards and jump links, and let a reviewer order the **changed group** by that fraction. Keep the existing state-group sequence and the original order as the default. The UI remains a review aid, with no change to measured verdicts or the opt-in exit gate (`docs/design.md:32-36`; `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).

The bead's description is stale in two respects. A changed screenshot already prints `differentPixels / totalPixels` and a decimal `ratio` below its images (`src/gallery/render-compare.ts:112-115`, `src/gallery/render-compare.ts:130-134`); the sidecar already contains the ratio (`src/gallery/generate-compare.ts:268-281`). Pairs are already ranked by state, with changed first and assembly order breaking ties, rather than left wholly in manifest order (`src/gallery/compare-model.ts:69-81`, `src/gallery/compare-model.ts:300-310`). The remaining problem is that the magnitude is absent from the card heading and jump entry, and changed screenshots are not ordered by magnitude (`src/gallery/render-compare.ts:130-132`, `src/gallery/render-compare.ts:200-205`). The reported 102/124 changed pairs remain a consumer observation, not a measurement reproduced here (`docs/shotwright-746.58-research.md:5-11`).

`ratio` is pixelmatch's differing-pixel count divided by equal-sized decoded image pixels (`src/gallery/pixels.ts:98-121`). An unchanged or `similar` image has zero; size-changed and unreadable images have null; a changed data artifact has no image verdict (`src/gallery/pixels.ts:63-77`, `src/gallery/pixels.ts:88-107`, `src/gallery/compare-model.ts:253-276`). Thus only changed screenshot pairs receive a numeric percentage. A changed artifact gets the explicit text “Pixel fraction unavailable” in both scanning locations, without a fabricated zero. The percentage describes pixel area, not severity or an approval threshold (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).

## Numbered implementation steps

1. **Render a truthful scanning label.** In `src/gallery/render-compare.ts:101-135`, derive a display string from `pair.verdict.ratio` only for `kind === 'shot' && state === 'changed'`; put “N% pixels changed” beside the title while retaining the exact count/decimal paragraph at `src/gallery/render-compare.ts:112-115`. Use the same string in the jump entry at `src/gallery/render-compare.ts:200-205`. For a positive fraction below 0.1%, display `<0.1%`; otherwise display one decimal place, including `100.0%`. A changed artifact displays “Pixel fraction unavailable”; other states have no percentage label. Keep the calculation separate from gate/count logic (`src/gallery/compare-model.ts:40-52`). **Pin:** extend `test/unit/gallery-compare-render.test.ts:73-249` with deterministic 1-pixel/small-denominator, positive sub-0.1%, 100%, changed-artifact, and null-state cases; assert card and jump text agree and exact counts remain. Update the existing HTML hash snapshot only after reviewing the intentional output change (`test/unit/gallery-compare-render.test.ts:169-174`).

2. **Add the client-side sort control and stable pairing.** Add a visibly labelled native select near the state chips in `src/gallery/render-compare.ts:188-213`, with “Current order” selected by default and “Highest percentage changed first” as the other choice. Disable it in static HTML, then enable it when the inline script binds, as the filters already do (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:188-199`). Expose each pair's original model index and, for changed screenshots only, its unrounded ratio in safe numeric `data-` attributes on the card rendered at `src/gallery/render-compare.ts:130-132`; use the jump anchor's `#pair-N` at `src/gallery/render-compare.ts:200-205` as its stable identity. In the script at `src/gallery/render-compare.ts:19-50`, build a map from fragment ID to jump `<li>` and use that map for filtering instead of `entries[index]`. Reorder **within the changed state group only**: changed screenshots by unrounded ratio descending; equal ratios by original index; changed artifacts with unavailable ratios after changed screenshots, retaining their own original order. Other state groups and their internal order stay as rendered by `comparePairOrder` (`src/gallery/compare-model.ts:69-81`). Reorder the corresponding jump entries to match cards, without changing `id`, `href`, JSON pair order, or diff sidecar index (`src/gallery/render-compare.ts:116-130`, `src/gallery/generate-compare.ts:268-281`). “Current order” restores original model order. Reapply the active state filter after every sort, preserving visible count, `aria-pressed`, and hash recovery (`src/gallery/render-compare.ts:24-49`). Keep one inline script and no external fetch under the existing CSP (`src/gallery/render-compare.ts:160`, `src/gallery/render-compare.ts:207-213`). **Pin:** expand `test/unit/gallery-compare-browser.test.ts:402-554` with a deliberately out-of-order corpus containing several changed screenshots with distinct ratios, a ratio tie, a changed artifact, and at least one later state. Assert default order, descending changed-group order, stable ties, artifact placement, other-group order, matching card/jump fragment sequences, restored order, then **sort followed by changed/gated filters** and the inverse; check counts, hidden jump links, direct fragments, and hash recovery. Exercise the select by keyboard. Assert the control stays disabled and cards/jumps remain usable with JavaScript off (`test/unit/gallery-compare-browser.test.ts:530-540`).

3. **Preserve the output contract and record the release note.** Keep compare generation and JSON serialization at `src/gallery/generate-compare.ts:248-281` unchanged. Add a patch changeset for package `shotwright` (version currently `0.6.0`, `package.json:2-3`) with wording: “Show the changed-pixel percentage beside compare cards and jump links, and let reviewers sort changed pairs by highest percentage while keeping state groups and comparison results unchanged.” This is a patch because it is a compatible HTML review affordance with no public config, CLI, schema, comparator, or default gate change. The analogous compare filter/jump improvement was a patch in `CHANGELOG.md:21-25`; Changesets is the selected release mechanism (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26`, `docs/adr/0012-release-tooling-changesets-and-gitleaks.md:34-41`). **Pin:** keep the sidecar hash assertion unchanged while updating only the expected HTML hash in `test/unit/gallery-compare-render.test.ts:169-174`; compare pre/post JSON pair sequence, ratios, diff filenames, gate counts, and exit behavior using the render/generation tests at `test/unit/gallery-compare-render.test.ts:129-174` and relevant `test/unit/gallery-compare-generate.test.ts` cases. Check the changeset frontmatter and wording before handoff.

Each step is one reviewable chunk of the same compare-page change; none requires a new component or dependency. The browser order is a document-only mutation after the page loads. Compare output generation and its atomic publish path are outside these steps (`docs/adr/0009-compare-artifact-output-path.md:63-72`; `docs/adr/0022-compare-verdicts-are-review-aid.md:28-32`).

## V-phase checks

- Run `pnpm run typecheck && pnpm run lint && pnpm run test` (`package.json:42-45`; `CLAUDE.md:41-47`). Run the focused render and browser tests after the relevant edits, then the full gate once.
- Generate and **visually view** the resulting compare page in Chromium at 320 px, 390 px, and desktop 1280 px widths, in light and dark modes. Record screenshots or observations in `docs/shotwright-746.58-verification.md`. Check title/percentage hierarchy, labelled select, keyboard focus, 44 px controls, wrapping, no horizontal page overflow, and access to the first card; the current CSS has the relevant controls and narrow-width rules at `src/gallery/render-compare.ts:210-213`. This is required by the repo's viewed-UI rule (`CLAUDE.md:107-108`).
- In the browser, compare card and jump fragment order before sort, after sort, after filtering, and after restoring current order. Check all seven states remain navigable, a selected hidden fragment recovers, no-JavaScript content and links work, and no CSP or network errors arise (`test/unit/gallery-compare-browser.test.ts:451-540`).
- Inspect the generated `compare.json` and diff filenames for identical measured values and order, and confirm sort/filter do not change the gate or command exit status (`src/gallery/generate-compare.ts:248-281`; `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`). Check the artifact remains self-contained and that no consumer Playwright resolution or capture path changed (`docs/adr/0005-gallery-single-file-inline-originals.md:18-24`; `docs/design.md:58-67`).
- Check the diff for public-file leaks and scope. Only implementation-phase compare rendering/tests and a changeset should be added; no masking code belongs to this bead (`docs/shotwright-746.58-research.md:85-92`).

## Risks and rollback

- **Wrong jump link hidden after sort:** the existing index-based filter assumes parallel arrays (`src/gallery/render-compare.ts:20-35`). Fragment-ID mapping and the sort/filter browser pin in step 2 address this. Roll back the sort script/control if pairing fails; keep the static percent label if its independent render pin passes.
- **A rounded small change appears to be zero or percentage is read as severity:** the `<0.1%` rule, explicit “pixels changed” wording, and exact count paragraph address this (`src/gallery/pixels.ts:113-121`; `src/gallery/render-compare.ts:112-115`). Roll back the display formatting without changing stored ratios.
- **The sort accidentally changes durable pair order or diff references:** limit it to DOM nodes and pin the JSON/sidecar snapshot in step 3 (`src/gallery/generate-compare.ts:268-281`). Revert the HTML interaction if this invariant breaks. Generated compare files can be regenerated; they are review artifacts (`docs/design.md:34-36`).

## Considered and declined

- A percentage threshold filter: owner decision excludes it; it could hide small, meaningful changes and is optional in acceptance (`docs/shotwright-746.58-research.md:85-92`).
- A config-level default mask or compare-time ignored regions: masking belongs to `shotwright-746.66`; explicit per-shot masks already pass through screenshot capture (`src/capture.ts:25-39`, `src/capture.ts:188-205`). The follow-up should decide how a configured default is applied consistently and disclosed in manifest/gallery, while preserving byte equivalence for matching screenshot options (`docs/shotwright-746.58-research.md:85-92`).
- Model/server-side magnitude order: it would alter JSON order and diff numbering instead of only the review view (`src/gallery/compare-model.ts:300-310`; `src/gallery/generate-compare.ts:268-281`).
- A severity label, new gate rule, or approval workflow: pixel fraction does not encode importance, and measured verdicts remain review aids (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`; `docs/adr/0024-review-based-baselines-declined.md:18-22`).
- A new ADR: the sort is a scoped, reversible HTML interaction. Existing ADR 0022 already binds verdict and gate semantics (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`).

## Acceptance mapping

| Acceptance bullet / owner constraint | Step and pin |
| --- | --- |
| Each changed pair shows its changed fraction | Step 1: changed screenshots show the existing pixel ratio as a percentage; changed artifacts explicitly say no pixel fraction exists. Deterministic render cases cover both. |
| Compare page can sort by changed fraction | Step 2: native select sorts changed screenshots by unrounded fraction; browser case proves order and stable ties. |
| Group order stays; only changed group reorders | Step 2: browser case asserts all other groups and their internal order remain fixed. |
| No threshold filter | Explicitly declined; no filter control or comparator change in steps 1–3. |
| Jump links paired by fragment ID | Step 2: map links by `#pair-N`; browser case checks matching sequences after sort and filter. |
| R/P decide masking scope; follow-up if deferred | Deferred to existing bead `shotwright-746.66`; no masking implementation here. |
| UI viewed before shipping | V-phase visual review at phone and desktop widths, both themes. |

## Open questions

None for this bead. The owner's four decisions settle the scope, order, navigation identity, and masking follow-up. If implementation reveals a new semantic conflict, record it and recommend the smallest change consistent with the pins before proceeding (`CLAUDE.md:94-101`).

## Self-review against P rubric

| Lens | Result |
| --- | --- |
| Measured or flagged | Pass: 102/124 is labelled a consumer report; no performance estimate is asserted. |
| Derived-value semantics | Pass: fraction numerator/denominator, positive sub-0.1%, 100%, unavailable artifact/null states, and display-versus-sort precision are specified and pinned in step 1 (`src/gallery/pixels.ts:63-121`). |
| Emergent structure | Pass: state groups, changed-artifact placement, stable ties, default/restored order, card/jump pairing, and fixed fragments/sidecars are pinned in step 2 (`src/gallery/compare-model.ts:69-81`; `src/gallery/render-compare.ts:200-205`). |
| Batch/concurrency | Pass: sorting mutates only the open document; output publication stays in the existing generator path (`src/gallery/generate-compare.ts:291-300`). |
| Inherited constraints | Pass: existing inline/CSP, filter, gate, review-first, and self-contained contracts were checked against code and ADRs, then pinned by steps 2–3 and V (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:160`, `docs/adr/0022-compare-verdicts-are-review-aid.md:12-16`). |

## Redteam amendments (2026-10-29)

A plan redteam returned "proceed with changes". Adopted:

1. **Never round to a false 100% (fix now).** One-decimal formatting would show a 0.9999 ratio (`src/gallery/pixels.ts:113`) as `100.0%`. Show `100.0%` only for an exact ratio of 1; at the upper rounding boundary show `>99.9%`. Apply the same rule at the bottom: a nonzero ratio that rounds to `0.0%` shows `<0.1%`, so a changed pair never reads as unchanged. Pin both boundaries in the render test.
2. **Style the new select in step 2.** The existing 44 px minimum and focus rule (`src/gallery/render-compare.ts:210`) covers buttons and summaries only. Step 2 gives the sort select a 44 px target, a visible focus ring, and wrapping at narrow widths; V views it at phone and desktop widths.
3. **No extra original-index attribute.** Derive the restore-order key from the existing `pair-N` ids on cards and jump links (`src/gallery/render-compare.ts:130,200`).
4. **State the reload behaviour.** The default is "Current order"; sort state is page-local, and reloading restores the default.
