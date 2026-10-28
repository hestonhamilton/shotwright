# Gallery viewer arrow navigation — research (shotwright-746.44)

Date: 2026-10-28. Phase: Research. Scope recommendation: gallery only.

## Context

The design keeps review artifacts self-contained and treats comparison verdicts as review aids, not required assertions (`docs/design.md:31-47,93-107`). The gallery embeds CSS and JavaScript with a meta CSP that permits inline assets and `data:` images (`src/gallery/render.ts:439-452,503-506`); compare does the same (`src/gallery/render-compare.ts:148,195-200`). Any navigation should reuse those assets, with no external runtime or extra embedded PNG copy.

The shared viewer is a native modal `<dialog>` with a titled image surface, an actual-pixels toggle and Close control (`src/gallery/viewer.ts:24-28`). The dialog is bounded to 96vw/1400px by 94vh/1000px; its flex surface scrolls (`src/gallery/viewer.ts:6-19`). Every `data-viewer-open` button is bound to an element ID, then enabled; click reads that element's `href` or `src`, creates one viewer `<img>`, calls `showModal()`, focuses Close, awaits decode, sizes the image, and marks it ready after a frame (`src/gallery/viewer.ts:79-120`). There is no arrow-key listener or shot index today (`src/gallery/viewer.ts:94-167`).

Sizing uses intrinsic image dimensions divided by viewing device pixel ratio, fits both dimensions without upscaling, and hides the zoom control when fit equals actual (`src/gallery/viewer.ts:42-77`). Toggling records a normalized clicked or center point, resizes, and aligns that point with clamped surface scroll offsets; resize and DPR change refresh this state (`src/gallery/viewer.ts:44-93,121-153`). `actual` is reset on each open (`src/gallery/viewer.ts:103-105`). Close removes the viewer image, invalidates pending decode with `generation`, and returns focus to the opening button only if focus has not already moved elsewhere (`src/gallery/viewer.ts:155-166`). The queued-close and immediate-reopen cases already have Chromium regressions (`test/unit/gallery-browser.test.ts:552-596`).

### What “visible” means

On the gallery, each available shot has two openers in one `.card`, and the original PNG is an embedded `data:` URI on the card's `[data-original]` download link (`src/gallery/render.ts:125-150`). Cards are emitted in spec/shot order (`src/gallery/render.ts:380-397`). Search includes shot name, spec, test title and note; tags include viewport key and optional cropped status (`src/gallery/render.ts:118-124,150-156`). The active search and chip filter jointly toggle `.hidden` on cards, hide spec groups with no visible cards, and count visible cards (`src/gallery/assets.ts:244-262`). Thus the navigation set should be DOM-ordered `.card:not(.hidden)` items with an enabled viewer opener and resolvable original. “Visible” means **passes the active filters**, not currently inside the scroll viewport or decoded as a preview. Broken references render without openers and should not enter navigation (`src/gallery/render.ts:125-145`).

Overview images are created only for nearby cards, with a three-image live cap, and are removed on hiding or distance (`src/gallery/assets.ts:209-243,291-328`). Their `src` is copied from the persistent `[data-original].href` (`src/gallery/assets.ts:226-240`). The viewer resolves the persistent source on click (`src/gallery/viewer.ts:94-110`), so the next original URI is available even if its overview has never loaded or has been evicted. Decoding the next viewer image is still asynchronous and must use the existing generation guard (`src/gallery/viewer.ts:101-118`). The gallery's existing result count includes broken cards, whereas the proposed viewer count excludes cards without a usable opener (`src/gallery/assets.ts:244-258`; `src/gallery/render.ts:125-150`).

On compare, state chips hide/show entire `article.pair` elements and matching jump entries; the count is in pairs, not images (`src/gallery/render-compare.ts:19-41`). Each shot pair can contain A, B and Diff openers, with A or B absent or unreadable and Diff conditional (`src/gallery/render-compare.ts:58-66,104-122`). Original images are already in the pair markup as data URIs (`src/gallery/render-compare.ts:66,111-112`). Left/Right could mean previous/next image within the pair, or previous/next pair while preserving A/B/Diff; both need rules for missing sides. The existing pair jump links and state filters already serve pair navigation (`src/gallery/render-compare.ts:188-201`).

## Options

| Option | Benefit | Cost / ambiguity |
|---|---|---|
| **Recommended — gallery cards only** | One image per shot gives Left=previous and Right=next in filtered DOM order; reuses embedded originals (`src/gallery/render.ts:125-150`; `src/gallery/assets.ts:244-262`). | Shared viewer must show navigation controls only when opened from a gallery card; compare remains as is (`src/gallery/viewer.ts:94-120`; `src/gallery/render-compare.ts:58-66`). |
| Gallery and compare image sequence | One global rule for all openers (`src/gallery/viewer.ts:94-120`). | A→B→Diff→next A makes Left/Right change both side and pair; state filters count pairs, so “N of M” has a different unit (`src/gallery/render-compare.ts:31-39,104-122`). |
| Gallery and compare pair sequence | Keeps the compare unit aligned with filters (`src/gallery/render-compare.ts:31-39`). | Requires a rule to retain or substitute A/B/Diff across missing sides; larger implementation and test surface (`src/gallery/render-compare.ts:58-66,104-122`). |

## Recommendation

Implement gallery-only, nonwrapping navigation. Left selects the preceding filter-visible shot and Right the following one. “N of M” counts eligible shots, using one-based position; show `1 of 1` for a singleton and disable both controls at the ends. Use labelled Previous/Next buttons in the dialog for touch and mouse; make the count a polite status update. On navigation, keep the modal open and focus on the control or surface used, replace the image via its existing original link, reset zoom to fit, and update the title. On close, return focus to the **current** shot's corresponding opener (preview versus text action), subject to the existing moved-focus guard (`src/gallery/viewer.ts:103-118,155-166`; `src/gallery/render.ts:125-145`). This leaves keyboard users at the shot they reached.

When fitted, unmodified Left/Right navigate. When in actual-pixels mode, all four arrow keys pan the scrollable image surface and never navigate, even at a scroll boundary; zooming back to fit restores navigation. Do not capture modifiers or keys while an editable control has focus. Keep Escape's native close behavior and Tab's native dialog focus loop (`src/gallery/viewer.ts:24-28,155-166`). Recompute eligible cards at each navigation attempt so a filter changed programmatically while the dialog is open cannot select a hidden card; if the current card falls out of the set, disable navigation and show `— of M` until it is visible again. Normal UI filtering cannot be operated behind the modal (`src/gallery/viewer.ts:112`; `src/gallery/assets.ts:244-262`).

## Prior art and currency

Read 2026-10-28. PhotoSwipe documents Left/Right keyboard navigation, previous/next arrows, a counter, Escape, and focus restoration. This supports the affordances, not a dependency choice: [PhotoSwipe options](https://photoswipe.com/options/), [PhotoSwipe styling](https://photoswipe.com/styling/).

Read 2026-10-28. WAI-ARIA's modal dialog pattern specifies initial focus inside, a contained Tab sequence, Escape, and return to the invoking element in the ordinary case. It does not prescribe gallery arrow behavior: [WAI-ARIA APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [W3C H102](https://www.w3.org/WAI/WCAG22/Techniques/html/H102).

Read 2026-10-28. MDN documents `KeyboardEvent.key` values and calling `preventDefault()` when the handler takes over a key's default action. This supports handling arrows only in the relevant viewer mode: [MDN KeyboardEvent.key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).

Read 2026-10-28. GitHub documents image diffs as 2-up, swipe and onion-skin views, where the left/right spatial relationship already represents versions. Its documentation does **not** establish a Left/Right keyboard convention for moving between images; it is a reason to avoid inventing one for A/B/Diff here: [GitHub non-code file diffs](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files).

## Open questions for the owner

1. Confirm gallery-only scope. The owner preference supplied with this bead is the smallest coherent scope; this recommendation follows it. A kickoff preference request is pending.
2. Should a later compare bead navigate pairs while preserving A/B/Diff identity, or use a separate pair jump control? No compare behavior is proposed here.

## Self-review

| Lens | Result |
|---|---|
| Measured or flagged | Pass: no performance or scale estimate is used; the three-image cap is from `src/gallery/assets.ts:224,303`. |
| Derived-value semantics | Pass: N/M is defined for singleton, filtered, broken, and no-current-card cases. |
| Emergent structure | Pass: ordering is DOM order, cardinality is one eligible card per shot, and navigation does not wrap (`src/gallery/render.ts:380-397`). |
| Batch/concurrency | Pass: no batch or shared service; image decoding races use the existing generation token (`src/gallery/viewer.ts:101-118`). |
| Inherited constraints | Pass: inline assets/CSP, original URI, bounded overview loader, modal focus and compare pair structure checked at cited source lines. |
