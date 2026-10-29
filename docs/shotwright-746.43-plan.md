# shotwright-746.43 — compare A/B overlay modes plan

Phase: Plan · 2026-10-28. Owner decisions: dialog-only option B, Side by side / Swipe / Onion skin, Side by side on every open, top-left native-coordinate alignment for size changes. The mockup is an interaction sketch, not a sizing specification (`docs/shotwright-746.43-mockups/option-b-dialog.html:1-3`; `docs/shotwright-746.43-research.md:31-33`).

## Goal

Add pair inspection to the existing shared dialog, leaving A/B/Diff card previews and the separate Diff image viewer intact (`src/gallery/render-compare.ts:111-120`, `src/gallery/viewer.ts:25-29`). Compare remains a self-contained review artifact with optional parity gating; no new assertion or gate semantics follow from these display modes (`docs/design.md:34-38`, `src/gallery/render-compare.ts:195-200`).

## Step list

1. **Render one truthful entry point per eligible pair.** In `src/gallery/render-compare.ts:96-123`, render a button labelled **Inspect A/B together** only when `pair.kind === 'shot'`, `pair.state !== 'unreadable'`, and both rendered sides have a readable `image` with a data URI. State is an explicit part of eligibility because an unreadable verdict can arise while both manifest sides still exist (`src/gallery/compare-model.ts:253-288`). Put stable references to the existing `pair-N-a` and `pair-N-b` images on the button; escape any pair name used in attributes. Render it `disabled` until the shared script binds. Omit it for added, removed, unreadable, and artifact pairs: the existing missing/error text already explains why a side cannot be inspected, while a disabled button would add a redundant stop to every such card (`src/gallery/render-compare.ts:58-66,114-122`). Keep both original preview buttons, downloads, Diff preview, pair anchors, filters, and verdict display. **Tests:** `test/unit/gallery-compare-render.test.ts:62-138` covers presence for readable identical/changed/size-changed pairs, absence for each ineligible kind/state and a late hydration read failure, escaping, and exactly one serialized URI per source image element. Count tags only with case-insensitive word-bounded patterns such as `/<img\b/gi` and `/<script\b/gi`.

2. **Extend the single shared dialog with a compare state.** In `src/gallery/viewer.ts:25-49,125-151,172-180,216-229`, add a hidden compare control group and a compare surface inside `#inspection-dialog`; keep the single-image surface and its existing code path. Bind eligible pair buttons alongside the existing `data-viewer-open` buttons. On each pair open, clear prior pair state, choose Side by side, reset Swipe and Onion skin ranges to 50%, reset to fit, set A/B title and dimension labels, copy `.src` from the two existing card `<img>` nodes into runtime images, await both decodes, then mark the dialog ready after layout. If either decode fails, show a plain unavailable message and keep mode/zoom controls disabled for that opening; do not substitute one side. Hide compare controls and restore the single-image surface whenever A, B, or Diff opens. Continue using the existing `showModal()`, Escape close, opener-focus return, and generation token to discard stale async work (`src/gallery/viewer.ts:125-151,216-229`). Render new controls hidden or disabled before binding so a no-JS page promises no interaction. **Tests:** `test/unit/gallery-compare-browser.test.ts:11-111` opens pair then A/B/Diff and back, checks one dialog in the DOM, the correct controls and focus, an image-decode failure, no-JS disabled entry points, and unchanged single-image behavior. Existing gallery viewer regressions remain in `test/unit/gallery-browser.test.ts:773-930`.

3. **Implement common fit/actual geometry and Side by side panning.** In `src/gallery/viewer.ts:50-100` and its CSS at `src/gallery/viewer.ts:2-23`, treat intrinsic image coordinates as the alignment space. At viewing DPR `d`, actual CSS sizes are `(naturalWidth/d, naturalHeight/d)` for both images. Side by side fit uses one factor `s = min(1, A-pane width/A-actual width, A-pane height/A-actual height, B-pane width/B-actual width, B-pane height/B-actual height)`; both dimensions on both images multiply by exactly `s`. Actual pixels uses `s = 1`. Each pane scrolls independently but a scroll from either pane writes its `(scrollLeft, scrollTop)` to the other, clamped to that pane's own maximum; guard reciprocal scroll events. Restore common fit on open. Resize and DPR changes recompute both sizes and preserve a meaningful shared viewport anchor where possible. Keep the existing single-image click anchor and gallery Previous/Next path untouched (`src/gallery/viewer.ts:62-100,102-124,153-170,182-215`). In compare, the labelled Fit/Actual button is the zoom action; image clicks and slider interactions do not toggle zoom. **Tests:** real Chromium in `test/unit/gallery-compare-browser.test.ts:11-111` uses a tall, different-width pair at DPR 1 and 2. Assert both rendered scale ratios differ by at most 0.01, fit has no pane overflow when both images fit, actual width is `naturalWidth / devicePixelRatio` within 1 CSS px, and scrolling A by `(x,y)` sets B to the same clamped offsets within 1 px; repeat B→A and at an unequal-content edge. Wait for the dialog ready state or measured geometry, never a fixed delay. Re-run `test/unit/gallery-browser.test.ts:789-930` for single-image anchoring and resize.

4. **Add Swipe and Onion skin in the compare surface.** In `src/gallery/viewer.ts:2-29,31-100`, place A and B on one stage whose native-coordinate size is `(max(A width,B width), max(A height,B height))`; position each image at stage `(0,0)` and apply the same fit/actual factor to both. Overlay fit uses `min(1, viewport width/stage actual width, viewport height/stage actual height)`; actual uses factor `1`. Do not stretch one side to the other's dimensions. Use a visible neutral/checker stage background wherever neither image covers the stage; any extension covered by only one image must remain visible. Show **aligned at top left** beside the A/B dimensions when sizes differ, including in overlay modes. Use a labelled native `<input type="range" min="0" max="100">` for each mode, with a live visible percentage. Swipe clips the B layer from its right edge in stage coordinates: 35% reveals B in the left 35% of the stage width, including when B is narrower. Onion skin maps the range to B opacity (`35` → `0.35`); A stays fully opaque below it. Mode buttons have stable labels and `aria-pressed` with exactly one true state. Switching modes retains fit/actual but resets the mode-specific scroll position to the top-left, a simple predictable rule. No transition is required; if one is added, respect `prefers-reduced-motion`. **Tests:** real Chromium checks 0/35/100% swipe and onion settings by computed clip/opacity plus pixel sampling of a small colored fixture, native keyboard Arrow/Home/End, visible output, button pressed states, size-changed geometry and uncovered area, resize, and no accidental zoom on range input. Inspect generated desktop and narrow screenshots in light/dark and reduced-motion contexts before Verify sign-off (`CLAUDE.md:107-108`).

5. **Pin self-containment and run gates.** In `test/unit/gallery-compare-render.test.ts:62-138` and `test/unit/gallery-compare-browser.test.ts:11-111`, generate the same fixed compare input with the main-branch renderer before the implementation and record its `data:image/png;base64,` count; assert the changed renderer's count is equal, with one URI-bearing `src` per A/B/Diff source image element. Identical sides may have identical URI text, so count occurrences rather than unique values. The existing renderer emits each source image once and the viewer copies its runtime source (`src/gallery/render-compare.ts:58-66,111-112`, `src/gallery/viewer.ts:125-139`); the staged generator hydrates and releases pair bytes in order (`src/gallery/generate-compare.ts:296-340`). Assert the exact meta CSP remains unchanged, no external resource request or CSP console error occurs on a generated `file:` page, and previews/downloads remain visible without JavaScript (`src/gallery/render-compare.ts:195-200`, `test/unit/gallery-compare-browser.test.ts:93-110`). Run `pnpm run typecheck && pnpm run lint && pnpm run test`; then visually review the generated compare dialog in real Chromium as required by `CLAUDE.md:107-108`. No new dependency or second dialog.

## Deterministic pins, risks, and rollback

| Load-bearing assumption / risk | Pin | Rollback |
| --- | --- | --- |
| Pair eligibility follows actually rendered readable images, including late file loss (`src/gallery/generate-compare.ts:308-329`). | Step 1 render tests plus Step 2 failed-decode browser case. | Remove the pair action for failed cases; preserve original A/B controls. |
| One factor gives the same scale in unequal panes; scroll offsets clamp rather than silently diverge. | Step 3 DPR, geometry, both-direction, and edge tests. | Revert compare geometry and controls together; single-image path remains. |
| Top-left layering exposes size changes without stretching and percentages refer to the full stage width. | Step 4 size-changed pixel and stage-geometry assertions. | Revert overlay mode UI while keeping separate A/B/Diff views. |
| Runtime images do not duplicate serialized image bytes or violate CSP. | Step 5 same-input main count, exact CSP, no-network browser checks. | Revert pair entry and compare viewer path together. |
| Compare changes do not disturb gallery keyboard navigation, click anchoring, or focus return. | Steps 2–3 focused regressions from `test/unit/gallery-browser.test.ts:773-930` and new pair focus checks. | Restore shared viewer state transitions before release. |

No persistent value, transaction, or concurrent service is added: pair state exists only while the dialog is open. A compare stage has exactly two source images, ordered A below B; the card still has its original A/B/Diff images (`src/gallery/render-compare.ts:58-66,111-120`). The plan makes no memory-use claim: runtime decoded images may add memory even when serialized URI count stays fixed (`docs/shotwright-746.43-research.md:21`).

## Acceptance mapping

| Acceptance | Steps | Measurable evidence |
| --- | --- | --- |
| Eligible pairs have **Inspect A/B together**; added/removed/unreadable/artifacts do not. | 1–2 | One enabled action per eligible pair after bind; zero on ineligible cards; disabled before bind/no-JS. |
| One dialog; Side by side default on every open; A/B/Diff single-image path preserved. | 2–3 | One `#inspection-dialog`; repeated opens reset mode; original A/B/Diff and gallery viewer tests pass. |
| Same scale and synchronized, clamped scrolling at fit and actual. | 3 | Scale delta ≤0.01; each destination offset equals `min(source offset, destination max)` within 1 CSS px in both directions. |
| Swipe and Onion skin have native, keyboard-accessible ranges. | 4 | At 35%, B occupies left 35% of stage width in Swipe and has 0.35 opacity in Onion; 0/100 endpoints, Arrow/Home/End, labels and pressed state pass. |
| Size-changed pairs align at native top-left with visible uncovered region. | 3–4 | A/B start at common `(0,0)` within 1 px; no per-side aspect distortion; a one-sided extension remains visible; an opposite-extents fixture exposes neutral background outside both images; label reads **aligned at top left**. |
| Self-contained, no byte duplication, unchanged CSP, no-JS truthfulness. | 1–2, 5 | `data:` URI count equals main for same input; exact CSP equality; zero external requests/CSP errors; actions disabled until bound. |
| Reduced motion, Escape, focus return, no regressions. | 2–5 | No required animation; reduced-motion browser check; Escape closes and focuses opener; existing gallery browser suite passes. |

## Prior art and currency

The following external guidance informs UI behavior; repo implementation details are pinned above.

- [GitHub's image diff documentation](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files) (read 2026-10-28) documents 2-up, swipe, and onion skin views and dimension display. Side by side as default is the owner's choice, not a browser requirement.
- [MDN range input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range) (read 2026-10-28) documents native range semantics; [WAI-ARIA APG slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) (read 2026-10-28) lists Arrow, Home, and End keyboard interaction. A native labelled input avoids a custom slider widget.
- [WAI-ARIA APG button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) (read 2026-10-28) specifies `aria-pressed` for toggle buttons and stable labels; [MDN dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) (read 2026-10-28) documents `showModal()`, Escape, and focus behavior.
- [MDN `clip-path`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/clip-path) (read 2026-10-28) documents `inset()` clipping and percentage values relative to the reference box; the plan pins the stage as that box in Step 4.
- [WCAG 2.2 dragging movements understanding](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) (read 2026-10-28) supports a non-drag path for a movable boundary; a range input supplies keyboard and single-pointer operation.

## Out of scope

Card-level overlays; a second dialog; freeform zoom or gesture controls; per-pair saved mode; image registration, stretching, canvas export, or diff generation; changes to verdicts, gate policy, downloads, gallery navigation, CSP, and package dependencies (`docs/shotwright-746.43-research.md:45-47`, `docs/design.md:34-38`).

## Self-review

| Lens | Result |
| --- | --- |
| Measured or flagged | Pass: thresholds above are acceptance tolerances, not measured performance claims; byte equality uses the same input on main and this branch. Runtime memory remains unmeasured. |
| Derived-value semantics | Pass: actual CSS size, common fit factor, clamped offsets, stage width, range percentage, and missing-side behavior are defined and pinned in Steps 1, 3, and 4. |
| Emergent structure | Pass: one pair action references exactly two existing source nodes; one dialog shows one active state; Diff remains separate. Steps 1, 2, and 5 pin cardinality. |
| Batch/concurrency | Pass: no batch mutation; the existing generation token rejects late decodes, and Step 2 tests a failed decode (`src/gallery/viewer.ts:125-151`). |
| Inherited constraints | Pass: shared viewer, renderer, generator, CSP, browser tests, and headed-public/viewed-UI rules were checked in the cited files; Steps 2 and 5 pin them. |

## Redteam disposition (2026-10-28) — amends the steps above

1. **Shared viewer state can leak across modes — accepted.** Step 2 introduces an explicit viewer mode, `single | pair | closed`.
   - Resize, DPR, zoom toggle, image click, gallery navigation and close all route by mode.
   - Every transition clears `image`, pointer/anchor state, navigation state and pair images.
   - A test covers pair → single → pair, including a resize and a queued close event.
2. **A simple scroll guard can reverse clamped panning — accepted.** Synchronized scroll distinguishes user-originated from programmatic scroll events. The initiating pane's offset is never overwritten by the follower's clamped echo. A test checks the settled offsets after A is scrolled beyond B's maximum and B is then panned.
3. **The 390 px layout is unspecified — accepted; orchestrator decision.** Below 600 px of dialog width, the Side by side panes stack vertically: A above B, each roughly half the surface height. They keep the common scale and synchronized scroll. Fit uses each pane's actual box. The layout is visually inspected and tested at 390 px.
4. **Swipe needs a stage-sized clipping box — accepted.** B sits unscaled at `(0,0)` inside a stage-sized wrapper, and the clip is applied to the wrapper. Percentages are therefore of the stage width. Tests cover unequal widths at 35% and 100%.
5. **Tall-shot memory has no release criterion — accepted.**
   - The same two runtime images are reused across mode switches.
   - Their `src` is removed when the dialog closes or a single image opens.
   - Verification opens an 8000 px-tall pair in Chromium and confirms open, mode switch, close and reopen succeed.
   - No fixed decoded-copy count is claimed.
6. **Omitting the action is truthful — accepted as written (decline the change).**
7. **Trim redundant and fragile tests — accepted.**
   - Use DOM geometry and computed style for percentages, and one interior pixel check for layering.
   - Check the generated page for exactly one serialized `data:` URI per source image element and no external requests.
   - Add focused DPR and single-viewer regression cases.
   - Exact CSP string equality and the main-branch byte baseline are dropped. A CSP check that it still forbids network and allows only inline script/style and `data:` images remains.
   - Visual review stays the UI gate.
