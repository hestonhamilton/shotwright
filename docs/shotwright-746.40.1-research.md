# Gallery viewer UX — research (shotwright-746.40.1)

Read and observed: 2026-10-28. Scope: generated gallery and compare gallery. This is research only; no implementation or bead state changed.

## Context and owner direction

The owner wants direct screenshot opening, clearer inspection wording, a useful initial view of large shots, and an audit of both generated pages. The existing self-contained gallery and inline CSP are binding constraints (`src/gallery/render.ts:438-445`, `src/gallery/render-compare.ts:128-132`); `src/gallery/server.ts:147-170` serves allowlisted files. No dependency is needed for the proposed interaction. The owner supplied the main tradeoff: a tall full-page shot cannot be both fully visible and legible at once. No additional kickoff preference was supplied, so the recommendation below preserves both overview and detail modes.

### Reproduction and visual evidence

I attempted `pnpm run build`; pnpm's automatic install failed opening its store SQLite database before the script ran. The same build command's compiler was run directly as `../../node_modules/.bin/tsc -p tsconfig.build.json` and passed. I generated two synthetic but genuine Playwright PNG captures from a 1280 CSS px page (each 1280×8021 intrinsic px), generated a gallery from each manifest, and rendered a compare model from both runs. The A and B pages differ in section background color; the compare model reported one `similar` shot. The captures and six gallery/page screenshots are under `local/`; these are ignored research evidence, not deliverables. The sample has no real test records, videos, or traces, so those states were assessed from code.

At 1440×900, clicking `.media` left the dialog closed; clicking the separate inspect button opened it. The image measured 1280×8021 CSS px in a 1380×779 scroll surface. At 390×844 the dialog stayed within the viewport but the 1280px image was horizontally clipped. Evidence: `local/gallery-desktop.png`, `local/gallery-mobile.png`, `local/gallery-dialog-desktop.png`, `local/gallery-dialog-mobile.png`, `local/compare-desktop.png`, `local/compare-mobile.png`. The tall gallery image starts below the first mobile viewport because the run facts take most of that viewport (`src/gallery/render.ts:465-480`, `src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:159-170`).

## Problems and options

### 1. Open a screenshot by clicking its preview

Verified: the card's `.media` is an ordinary `div` (`src/gallery/render.ts:125-132`); a loaded image is appended to it (`src/gallery/assets.ts:220-235`). Only `[data-inspect]` buttons receive open handlers (`src/gallery/render.ts:136-143`, `src/gallery/assets.ts:306-325`). The owner's premise is correct.

| Option | Tradeoff |
| --- | --- |
| **Recommended:** make the preview a semantic button or equivalent image-opening control, sharing one open function with the text action | Direct mouse, touch, Enter and Space activation; explicit accessible name and focus. Must keep lazy loading and the 3-image live cap (`src/gallery/assets.ts:203-236`, `src/gallery/assets.ts:267-303`). |
| Add a click listener to `.media` | Small patch, but a `div` needs keyboard semantics, focus style and label to be a real control. |
| Keep the separate action only | No change; fails the owner's discoverability goal. |

Use a `zoom-in` cursor when opening the preview, and preserve a visible text control for users who do not infer the image action. Do not make the download link's behavior ambiguous (`src/gallery/render.ts:139-143`).

### 2. Rename the action and dialog

Verified: card button `Inspect 1:1` (`src/gallery/render.ts:138`), initial dialog title `1:1 inspection` (`src/gallery/render.ts:488`), and dynamic title suffix `— 1:1 inspection` (`src/gallery/assets.ts:314`). With a fitted default, these labels would also become factually wrong.

Ranked action labels: **1. “View full screenshot”** (recommended: states the object and purpose); **2. “Open screenshot”** (short but less clear that a larger view opens); **3. “Inspect screenshot”** (workmanlike, but less concrete). Recommended dialog title: **“{shot name} — Screenshot”**. The zoom control should say **“Actual pixels”** in fit mode and **“Fit to window”** in pixel mode, with state exposed by a pressed button or its changing action label. Avoid the unqualified “1:1”: it can mean image pixels per CSS pixel, capture CSS scale, or physical display pixels.

| Option | Tradeoff |
| --- | --- |
| **Recommended:** name the open action “View full screenshot” and name scale only on the scale control | Label remains true in both zoom modes and works with preview click. |
| “View larger” | Short but false when a small image is not upscaled. |
| Keep “Inspect 1:1” | Misleading once the initial image fits the dialog. |

### 3. Default scale and actual-pixel toggle

Verified: the dialog is constrained to `min(96vw, 1400px)` × `min(94vh, 1000px)`; the surface scrolls and the image has no maximum size (`src/gallery/assets.ts:142-150`). The script assigns intrinsic width and height, opens the native modal, and focuses Close (`src/gallery/assets.ts:314-325`). The sample demonstrated both vertical and mobile horizontal scrolling.

| Option | Tradeoff |
| --- | --- |
| **Recommended:** default to **fit within the available image surface, capped at intrinsic size**, then offer “Actual pixels” / “Fit to window” | Shows the whole composition without scrolling on open; a tall 1280×8021 page becomes too small to read, so the zoom control must be obvious and quick. Zoom can return to the same overview. |
| Fit width, capped at intrinsic size | Keeps tall-page text legible and avoids horizontal scrolling, but the 8021px example still needs extensive vertical scrolling; does not meet the stated overview goal. Could be a later third mode if reviewers repeatedly need it. |
| Start at actual pixels | Best detail fidelity, but reproduces the observed clipping and two-axis scrolling on narrow screens. |

Fit should use the smaller of available-width/image-width, available-height/image-height, and 1. Resize/reorientation must recompute it. “Actual pixels” should mean **one intrinsic PNG pixel per CSS pixel** and be labelled as such in help text; it is not guaranteed to be one physical display pixel. Playwright's screenshot default `scale: 'device'` captures one image pixel per device pixel, while `scale: 'css'` captures one per CSS pixel ([Playwright Page screenshot API](https://playwright.dev/docs/api/class-page), read 2026-10-28). Thus a DSF=2 capture of a 1280 CSS px viewport can be 2560 image px wide; showing it at 2560 CSS px is 2× the captured CSS layout size. A capture-layout-size mode would instead display image width / recorded DSF CSS px, subject to `scale: 'css'`, clips and locator shots; it should not be conflated with actual pixels (`src/gallery/render.ts:53-67`, `src/gallery/render.ts:139-155`). Browser `devicePixelRatio` also changes with screen and page zoom ([MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio), read 2026-10-28). If precise physical pixel mapping is a future requirement, measure the viewing browser's ratio and name that separate mode; do not promise it in this epic.

For tall screenshots, fitted overview is a navigation state, not a reading state. Switch to actual pixels around the clicked point if feasible, retain scroll position while resizing, and expose a persistent labelled toggle. A click on the image may toggle zoom, but the dedicated button is required for keyboard and touch discoverability. Use `zoom-in` / `zoom-out` cursors only when that click actually toggles scale. Escape closes and returns focus to the invoker; arrow navigation between shots is a useful later enhancement if it can follow currently filtered visible cards without surprising the reviewer (`src/gallery/assets.ts:238-261`, `src/gallery/assets.ts:327-351`).

## Current prior art and standards

All links below were read 2026-10-28. These products establish interaction patterns, not a mandate to add their dependencies or baseline approval workflows.

| Claim | Source and implication |
| --- | --- |
| PhotoSwipe starts at `fit` (without upscaling beyond original), supports a secondary zoom level, and lets a click zoom. | [PhotoSwipe zoom levels](https://photoswipe.com/adjusting-zoom-level/), [click actions](https://photoswipe.com/click-and-tap-actions/) (read 2026-10-28). Supports fit first, then an explicit detail state; its default secondary zoom is *not* necessarily exact 1:1, so specify our own actual-pixel behavior. |
| PhotoSwipe's lightbox opens from image links and has zoom and arrow controls; its docs caution against very large images. | [PhotoSwipe methods](https://photoswipe.com/methods/), [styling](https://photoswipe.com/styling/), [getting started](https://photoswipe.com/getting-started/) (read 2026-10-28). Useful affordance precedent, but a large dependency conflicts with embedded galleries and 8021px shots. |
| Storybook separates story navigation/search from canvas zoom; Chromatic offers an “Inspect snapshot” entry to its inspector. | [Storybook Browse Stories](https://storybook.js.org/docs/8/get-started/browse-stories), [Chromatic quickstart](https://docs.chromatic.com/docs/quickstart/) (read 2026-10-28). These document discoverable zoom/inspection, not a specific fit default. |
| Playwright's HTML report opens a test detail on click, with image attachments in the detail view; its docs do not establish a screenshot zoom default. | [Playwright reporters](https://playwright.dev/docs/test-reporters), [Trace Viewer](https://playwright.dev/docs/trace-viewer) (read 2026-10-28). Treat this as a click-to-detail precedent only. |
| Argos advertises “Smart zoom”, synced zoom, and side-by-side review; GitHub offers 2-up by default plus swipe and onion skin for image diffs. | [Argos visual testing](https://argos-ci.com/visual-testing), [GitHub non-code files](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files) (read 2026-10-28). These support a compare-view mode decision; neither source establishes a fit/1:1 default for this gallery. |
| A modal moves focus inside, traps Tab, closes on Escape, and normally restores focus to its opener. Native `<dialog>` supports those mechanics. | [WAI-ARIA APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [W3C H102](https://www.w3.org/WAI/WCAG22/Techniques/html/H102) (read 2026-10-28). Preserve the current native dialog and focus restoration (`src/gallery/render.ts:487-490`, `src/gallery/assets.ts:323-335`). |
| WCAG 2.2 AA requires 24×24 CSS px targets (with exceptions), visible keyboard focus, 4.5:1 normal text contrast, 3:1 meaningful control-state contrast, and reflow at 320 CSS px for non-exempt content. | [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible), [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast), [1.4.10](https://www.w3.org/WAI/WCAG21/Understanding/reflow) (read 2026-10-28). The gallery's 44px rule exceeds 2.5.8, but the compare page needs its own control audit (`src/gallery/assets.ts:22-25`, `src/gallery/render-compare.ts:128-131`). |

## Gallery and compare audit

Severity is a UX triage judgement, not a measured WCAG failure. The `local/` image names identify inspected screenshots; code-only states are marked as such. The sample's tall compare images are tiny in their fixed-height columns (`src/gallery/render-compare.ts:131`), as visible in `compare-desktop.png`.

| Finding | Code | Evidence | Severity | Triage and reason |
| --- | --- | --- | --- | --- |
| Preview has no open affordance; separate action is below the image and “1:1” is obscure. | `src/gallery/render.ts:125-143`; `src/gallery/assets.ts:306-325` | `gallery-desktop.png`; click measurement above | High | **Fix in this epic**: owner's primary path and wording request. |
| Natural-size modal needs two-axis scrolling for tall/mobile captures. | `src/gallery/assets.ts:142-150`, `src/gallery/assets.ts:314-325` | `gallery-dialog-desktop.png`, `gallery-dialog-mobile.png`; 1280×8021 versus 1380×779 | High | **Fix in this epic**: fit overview plus actual-pixel toggle. |
| Run facts occupy the initial 390px viewport; the first shot is below the fold. | `src/gallery/render.ts:465-480`; `src/gallery/assets.ts:49-55`, `src/gallery/assets.ts:159-170` | `gallery-mobile.png` | Medium | **Fix in this epic**: collapse or subordinate diagnostics after a compact status/shot count, while preserving details. |
| Search can hide every card and spec without a “no matches” message or reset control; Escape clears, but the shortcut help may be out of view. | `src/gallery/assets.ts:238-261`, `src/gallery/assets.ts:342-350`; `src/gallery/render.ts:478-484` | Code inspection | Medium | **Fix in this epic**: show result count and empty filtered state near controls. |
| Mobile filter chips scroll horizontally without a visible edge cue. | `src/gallery/assets.ts:159-165`; `src/gallery/render.ts:367-378` | `gallery-mobile.png` | Low | **Fix in this epic**: add label/scroll hint or wrap where feasible; verify at 320px. |
| Metadata uses 12px chips and abbreviations (“DSF”, “derived”); precise run timestamps wrap into narrow columns. | `src/gallery/assets.ts:53-55`, `src/gallery/assets.ts:108-110`; `src/gallery/render.ts:59-67`, `src/gallery/render.ts:145-166`, `src/gallery/render.ts:465-475` | `gallery-mobile.png` | Medium | **Fix in this epic**: spell out scale and move verbose provenance to details; keep intrinsic dimensions near the image. |
| Compare's fixed 420px preview height makes 8021px full-page shots unreadable; image has no enlargement or zoom control. | `src/gallery/render-compare.ts:14-22`, `src/gallery/render-compare.ts:65-76`, `src/gallery/render-compare.ts:131` | `compare-desktop.png`, `compare-mobile.png` | High | **Fix in this epic**: share image viewer behavior for A/B/diff where possible; preserve side identity. |
| Compare has 2-up-ish auto-fit columns, but no swipe/onion overlay or synchronized zoom, limiting pixel-level comparison. | `src/gallery/render-compare.ts:65-76`, `src/gallery/render-compare.ts:131` | `compare-desktop.png` | Medium | **Separate bead**: interaction model and synchronization need dedicated design and tests; GitHub/Argos precedent above. |
| Compare header is dense with machine terms; every verdict count is shown including zeros; no search/filter or jump navigation for many pairs. | `src/gallery/render-compare.ts:105-132`, `src/gallery/compare-model.ts:59-80`, `src/gallery/compare-model.ts:300-310` | `compare-mobile.png` | Medium | **Fix in this epic**: surface changed/gated counts first, group details, and provide state filter or anchors. |
| Compare uses no script and its images are plain `img`; keyboard access stops at download links. The gallery already uses a native modal and focus styles. | `src/gallery/render-compare.ts:14-22`, `src/gallery/render-compare.ts:128-132`; `src/gallery/assets.ts:22-25` | Code inspection | Medium | **Fix in this epic** if compare enlargement is included: semantic opener, visible focus, Esc/restore. |
| Empty compare writes a header and count badges with no explicit “no pairs” explanation. Gallery has a no-shots state but its copy also mentions an active filter even when there are zero manifest shots. | `src/gallery/render-compare.ts:125-132`, `src/gallery/render-compare.ts:135-151`; `src/gallery/render.ts:407-413` | Code inspection | Low | **Fix in this epic**: precise empty copy; distinguish no manifest shots from no filter results. |
| “Group artifacts”, “Deduplicated artifact sets”, and the sibling warning lead with implementation terminology. | `src/gallery/render.ts:196-216`, `src/gallery/render.ts:253-263` | `gallery-desktop.png` for group link; code inspection for expanded section | Low | **Separate bead**: content design can be considered with broader artifact review, after image work. |
| No assertion that contrast fails: current gallery tokens and compare palette have not been measured across light/dark states. | `src/gallery/assets.ts:3-15`; `src/gallery/render-compare.ts:129-131` | `gallery-desktop.png`, `compare-desktop.png` (light only) | Low | **Decline as a defect claim** until computed-color contrast measurement; include light/dark 1.4.3/1.4.11 check in verification. |

## Test impact and validation pins

- `test/unit/gallery-browser.test.ts:265-335` asserts the current `[data-inspect]` path, native dialog, Escape restoration, 44px targets, and bounded overview loading. Extend it to click the preview, Enter/Space activate it, verify focus restoration to the actual invoker, assert fit dimensions for a genuinely tall image, toggle to actual pixels and back, and check 390px and 320px reflow. Its existing `tall-aspect` image is only 24×96 (`test/unit/gallery-browser.test.ts:158-181`); use a materially large image so scroll behavior is exercised.
- `test/unit/gallery-browser.test.ts:345-365` protects against a queued close event stealing focus. Preserve that race check when both preview and text button can open the dialog. `test/unit/gallery-browser.test.ts:378-435` covers placeholder/fallback behavior; preserve it when the preview becomes interactive.
- `test/unit/gallery-render.test.ts:319` asserts no-shots copy. Add semantic opener, clear labels, and filtered-empty markup assertions there, while checking that the inlined CSP and one embedded original remain intact (`src/gallery/render.ts:438-445`, `src/gallery/render.ts:139-143`).
- `test/unit/gallery-compare-render.test.ts` and `test/unit/gallery-compare-generate.test.ts` cover compare markup/output; add viewer accessibility and empty-pair assertions. `test/unit/gallery-compare-model.test.ts` should remain focused on pairing/verdict semantics (`src/gallery/compare-model.ts:207-310`), unless navigation order needs model support.
- Verification should capture both light and dark palettes, 320/390px and desktop, normal and tall shots, DSF=1 and DSF=2, and no-JS fallback. Measure text/control contrast rather than inferring it from palette variables. Confirm the generated page remains self-contained and honors the existing CSP (`src/gallery/render.ts:443-450`, `src/gallery/render-compare.ts:128-132`).

## Open questions for owner

1. Should the compare viewer's A/B/diff enlargement and compact compare header be in this epic's implementation, or should compare receive a dedicated follow-up? The audit recommends the basic enlargement here and synchronized overlay modes later.
2. Is fit-contain with a visible actual-pixel toggle the desired tall-page default, or should full-page captures open fit-width while shorter captures open fit-contain? The recommendation is uniform fit-contain for predictable overview.
3. Should arrow keys advance among currently visible gallery shots in this epic? Recommended as a follow-up after image opening, scale and focus behavior are stable.

## Self-review

- **Measured-or-flagged — pass:** size and viewport claims above are measured from the synthetic browser run; severity is explicitly judgement.
- **Derived-value semantics — pass:** fit and actual-pixel meanings, including DSF and viewer DPR, are defined; compare state is reported from the generated sample only.
- **Emergent structure — pass:** filter visibility and compare pair order are grounded in `src/gallery/assets.ts:238-261` and `src/gallery/compare-model.ts:69-80`.
- **Batch/concurrency — not applicable:** no batch mutation or publish design is proposed in this phase.
- **Inherited constraints — pass:** inline CSS/JS and CSP are verified in `src/gallery/render.ts:438-450` and `src/gallery/render-compare.ts:128-132`; native dialog and bounded image loading are verified in `src/gallery/assets.ts:203-236` and `src/gallery/assets.ts:306-335`.

## Owner decisions and redteam disposition

Owner decisions, 2026-10-28 (recorded on `shotwright-746.40`):

1. The viewer opens every shot **fitted whole** to the image surface, never larger than actual pixels. One control toggles to actual pixels and back, and so does clicking the image, anchored at the clicked point. The owner chose this knowing that a 1280×8021 page fits at about 10% scale.
2. The open action reads **"View full screenshot"**. The in-viewer toggle reads **"Actual pixels"** / **"Fit to window"**.
3. Scope covers items 1–3 on the gallery, plus the same viewer for compare A/B/diff images, plus three small fixes: a no-match search state with a visible-card count, precise empty-state copy, and "DSF" spelled out. These become separate beads: collapsing the mobile run facts, reworking the compare header (state filters, jump links to the existing `pair-N` anchors), swipe/onion overlay with synced zoom, arrow-key shot navigation, and the artifact-section terminology.

Redteam (fresh delegate, 2026-10-28) disposition:

- **Tall-shot default should be fit-width — declined.** The owner decided this with the tradeoff stated.
- **Meaning of "actual pixels" at DSF=2 — accepted, resolved here.** Actual pixels means one image pixel per *device* pixel of the viewing screen: displayed CSS width = intrinsic width ÷ `window.devicePixelRatio`. On a 2× screen this equals the captured layout size of a DSF=2 shot. On a 1× screen it is the only size that shows every captured pixel. Fit is capped at the same size, so nothing is ever upscaled past the captured pixels. Because it is measured from the live browser, it stays true under browser zoom, which changes `devicePixelRatio`. No recorded-DSF lookup is needed, so missing DSF metadata cannot make the label false.
- **Compare enlargement requires script and a CSP change — accepted.** Compare adopts the gallery's existing inline-script CSP mechanism rather than inventing a new one. The plan must name the exact CSP delta and keep the page self-contained. The viewer must reuse each pair's embedded image source, never adding a second copy of the bytes.
- **Loading invariant — accepted.** The preview control must open the viewer even when its overview image has been evicted. The viewer reuses the embedded URI, and closing removes its image node (current behaviour, `src/gallery/assets.ts:327-329`).
- **Scope creep — accepted.** This matches owner decision 3.
- **Filtered counts — accepted.** The new count reports visible cards and is labelled as such. The static chip totals keep their meaning. Zero matches and zero shots get different copy.
- **Fixed 65px header subtraction breaks on wrapped titles — accepted** as a fix in this epic, using a flex/grid dialog layout (`src/gallery/assets.ts:149`).
- **Compare anchors already exist — accepted** as a wording correction to the audit row on compare navigation.
