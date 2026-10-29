# shotwright-746.43 — compare overlay and synchronized zoom research

Read 2026-10-28. Phase: Research and UI mockups. No implementation decision is made here.

## Context and current interaction

The gallery is a review artifact, with parity gating opt-in, and the repository is public (`docs/design.md:34-38`). The generated compare page has a meta CSP allowing inline CSS and script and `data:` images while forbidding network connections (`src/gallery/render-compare.ts:195`). Its pair cards show A, B and, when available, Diff in a responsive grid; previews are capped at 420 CSS px high (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:111-120`, `src/gallery/render-compare.ts:198`). Cards also expose state filters and jump links (`src/gallery/render-compare.ts:19-50`, `src/gallery/render-compare.ts:176-201`). The audit explicitly deferred swipe/onion overlay and synchronized zoom (`docs/shotwright-746.40.1-research.md:81-82`).

Each available A/B preview opens the shared single-image dialog; Diff opens the same dialog when generated (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:111-112`, `src/gallery/viewer.ts:172-180`). The dialog starts fitted, offers Actual pixels, and uses the clicked point as a zoom anchor (`src/gallery/viewer.ts:67-100`, `src/gallery/viewer.ts:182-194`). In this implementation, Actual pixels is intrinsic image width divided by the viewing browser's device pixel ratio, so one image pixel maps to one viewing-device pixel (`src/gallery/viewer.ts:50`, `src/gallery/viewer.ts:67-79`, `src/gallery/viewer.ts:25-28`). Previous/Next is gallery-card navigation only: compare cards use `.pair`, while eligibility selects `.card`, and the dialog hides navigation when no gallery card is found (`src/gallery/viewer.ts:102-124`, `src/gallery/viewer.ts:172-180`).

## Edge cases and image-byte cost

| Pair condition | Current behavior | Proposed overlay behavior |
|---|---|---|
| Both readable, same dimensions | Two A/B previews; Diff when computed (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:111-120`). | Enable side by side, swipe and onion. Preserve separate A/B identity and Diff access. |
| Size changed | Verdict has both dimensions but no pixel count or diff PNG (`src/gallery/pixels.ts:85-97`); captions show each side's dimensions (`src/gallery/render-compare.ts:58-66`). | Enable A/B overlay, align **top-left in native image coordinates**, never stretch either to make edges coincide. Use a canvas sized to the larger width and height; uncovered area shows a checker or neutral background. State the alignment in the UI. Shared fit scale must be the same for both images. |
| Added or removed | Model assigns one-sided state (`src/gallery/compare-model.ts:232-245`); missing side is rendered as “no shot” (`src/gallery/render-compare.ts:58-61`). | Keep the available image viewable; disable overlay modes with a short reason. |
| Unreadable | Decoder/read errors produce unreadable state (`src/gallery/compare-model.ts:253-288`, `src/gallery/pixels.ts:43-77`); a late render read can also clear the image and mark unreadable (`src/gallery/generate-compare.ts:308-329`). | Preserve the readable preview and error. Disable overlay if either source image is absent. Do not infer comparison from the surviving side. |
| Artifact pair | Pair kind can be `artifact` and renders text/downloads instead of screenshots (`src/gallery/compare-model.ts:18-27`, `src/gallery/render-compare.ts:114-120`). | No image modes. |

Generation hydrates each pair's A/B image data URIs immediately before rendering and clears them after its section is written (`src/gallery/generate-compare.ts:296-340`). It writes pair chunks to a staged body, then copies that body into the final self-contained HTML (`src/gallery/generate-compare.ts:351-369`). Each available A/B URI currently appears once as an image `src`, and the Diff PNG appears once if present (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:111-112`). **Overlay markup must not serialize either URI again.** Create overlay images at runtime and assign `overlayImg.src = sourceImg.src`, or clone the existing DOM image; the shared viewer already follows this pattern for one image (`src/gallery/viewer.ts:125-139`). This keeps HTML source bytes roughly unchanged apart from controls and script. It does **not** guarantee zero additional runtime memory: extra DOM images and decoded bitmap surfaces may still cost memory. A CSS layout that reuses/moves existing nodes would reduce that risk but complicates focus and restoration. Verify generated HTML contains one data URI per side and inspect a tall pair in Chromium before implementation sign-off.

## Options

| Location | Interaction and tradeoff |
|---|---|
| **A — inline pair card** | Mode switcher replaces the A/B/Diff grid in each eligible card. Immediate and discoverable; a 420 px capped preview remains weak for pixel inspection, and each card gains controls. [Mockup A](shotwright-746.43-mockups/option-a-inline.html). |
| **B — viewer dialog (recommended)** | Keep the existing compact A/B/Diff cards; opening a pair offers side by side, swipe and onion plus shared fit/actual zoom. Uses the viewer's existing inspection purpose and avoids controls repeated down the page. Requires a clear “Inspect A/B together” action and compare-specific dialog behavior. [Mockup B](shotwright-746.43-mockups/option-b-dialog.html). |
| **C — both** | Quick overlay in the card plus full inspection in the dialog. Most discoverable, but duplicate mode state, controls and responsive behavior increase P3 scope. [Mockup C](shotwright-746.43-mockups/option-c-both.html). |

For dialog **side by side**, synchronized zoom means A and B get the **same scale**, and panning either pane applies the **same horizontal and vertical scroll offset** to the other. At fit, choose one common scale that lets both fit their respective panes, capped at actual size; at Actual pixels, use the existing intrinsic-pixel/device-pixel scale (`src/gallery/viewer.ts:50`, `src/gallery/viewer.ts:67-79`). If one pane has less scrollable content, its offset clamps at its edge while the larger pane continues. Overlay modes use one shared viewport, one scale, and top-left aligned layers. The mockups illustrate the interaction; their SVG dimensions and simplified zoom are visual placeholders, not a sizing specification.

Use a labelled native `<input type="range">` for swipe position and onion B opacity, with visible percentages and keyboard focus. Arrow keys, Home and End should work via native range behavior; mode buttons must expose selection, and Escape should close the dialog. Avoid gesture-only functionality. No animation is needed; any optional transition must obey reduced-motion preference. The existing dialog already uses `showModal()`, a labelled title, focus return and Escape close behavior (`src/gallery/viewer.ts:25-29`, `src/gallery/viewer.ts:141-150`, `src/gallery/viewer.ts:216-229`). If the dialog is selected, do not let its image click-to-zoom conflict with a slider or panning action (`src/gallery/viewer.ts:182-194`).

## Prior art and currency

All links read 2026-10-28.

- [GitHub image diffs](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files) document 2-up as default, plus swipe and onion skin, and explicitly show dimensions when size changes. This supports keeping a side by side default and dimension labels.
- [Argos Review](https://argos-ci.com/review) describes split/overlay views and zoom/pan that stay synchronized. This is the clearest precedent for common scale and offset, although its service workflow is broader than this local artifact.
- [Chromatic Diff Inspector](https://www.chromatic.com/docs/diff-inspector/) documents unified and split views, strobing and zoom inspection. [BrowserStack Percy visual analysis](https://www.browserstack.com/docs/test-companion/visual-analysis) lists overlay for stacked snapshot review. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) documents screenshot comparison generation, but does not establish a report UI slider; do not claim it does.
- [MDN range input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range) supports a native labelled slider; [MDN `clip-path`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/clip-path) documents clipping for swipe reveal. [WAI APG slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) gives keyboard expectations; [WCAG 2.2 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) motivates a single-pointer/keyboard path rather than drag-only control.
- [`img-comparison-slider`](https://github.com/sneas/img-comparison-slider) is a small MIT-licensed comparison component ([license](https://github.com/sneas/img-comparison-slider/blob/master/LICENSE)). It proves the pattern is established; its package and styling would add a dependency to a page that currently embeds all of its CSS and JS (`src/gallery/render-compare.ts:195-200`). Prefer native range plus a few inline styles and script lines.

## Recommendation and scope

Choose **B**, with side by side as default and swipe/onion as explicit modes, all in the compare dialog. Keep Diff independently viewable in the existing single-image viewer. This fits the P3 polish scope and preserves the card's quick scanning layout (`src/gallery/render-compare.ts:111-120`). Deliberately exclude freeform zoom percentages, pinch gestures, image registration, blink/strobe mode, saved per-pair mode state, and any dependency. No verdict or gate behavior changes (`docs/design.md:34-36`).

## Self-review

- Measured or flagged: no byte-size or runtime-memory saving is claimed without measurement; HTML URI cardinality follows the renderer and needs a generated-output check.
- Derived-value semantics: shared scale/offset, clamping, and one-sided/size-changed cases are defined above.
- Emergent structure: each pair has at most one A and one B model side; the optional Diff is separate (`src/gallery/compare-model.ts:18-27`, `src/gallery/render-compare.ts:111-120`).
- Batch/concurrency: this research proposes no batch mutation; current pair hydration/release is sequential (`src/gallery/generate-compare.ts:296-340`).
- Inherited constraints: CSP, viewer sizing, and case-specific renderer behavior were checked in code (`src/gallery/render-compare.ts:195`, `src/gallery/viewer.ts:67-79`, `src/gallery/render-compare.ts:58-66`).

## Decision points for the owner

1. **Where should modes live?** Recommend dialog only (B); choose inline (A) or both (C) if card-level comparison matters more than density.
2. **Which modes ship?** Recommend side by side, swipe and onion; retain Diff as its separate image.
3. **What is the default?** Recommend side by side on every open, with explicit A/B labels and dimensions.
4. **For size-changed pairs, is top-left alignment acceptable?** Recommend yes, with unfilled area visible and no scaling to force a match.
