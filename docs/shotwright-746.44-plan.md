# Gallery viewer arrow navigation — plan (shotwright-746.44)

Date: 2026-10-28. Phase: Plan. Recommendation: gallery only, subject to the scope question in `docs/shotwright-746.44-research.md`.

## Goal

Move between filter-visible gallery shots inside the existing modal with Left/Right or labelled Previous/Next buttons, while preserving zoom/pan and focus behavior. The gallery already supplies persistent original `data:` links and a filter-driven `.hidden` state (`src/gallery/render.ts:125-150`; `src/gallery/assets.ts:244-262`); the shared viewer currently opens one source at a time (`src/gallery/viewer.ts:94-120`).

## Step list

1. **Add gallery-scoped navigation to the shared viewer.** In `src/gallery/viewer.ts`, extend the dialog header with Previous and Next buttons and an `N of M` status, sized/wrapped within the existing flex header (`src/gallery/viewer.ts:6-18,24-28`). Determine the active gallery card from the clicked opener; enumerate DOM-ordered `.card:not(.hidden)` items that have a usable `[data-original]` and enabled opener (`src/gallery/render.ts:125-150`; `src/gallery/assets.ts:244-262`). The same source resolver should serve open and navigation, retaining the existing `generation` decode guard and ready state (`src/gallery/viewer.ts:79-120`). Hide the controls/status for compare openers, which have no `.card` ancestor (`src/gallery/render-compare.ts:58-66,111-120`). Recompute the set on each action; disable at nonwrapping ends and when the current card is no longer eligible. Reset each newly selected shot to fit, update title and one-based count, and retain keyboard focus in the dialog. Track the same opener kind on each selected card so Close returns to the currently viewed shot's preview or text button, without overriding focus that moved elsewhere (`src/gallery/viewer.ts:103-118,155-166`; `src/gallery/render.ts:125-145`). No new image bytes or external assets.

2. **Define keyboard and pan priority.** In `src/gallery/viewer.ts`, listen for Left/Right only while the gallery viewer is open and fitted; ignore modifier chords, editable targets and repeated keydown for shot navigation. In actual-pixels mode, do not intercept arrow keys: the focused inspection surface scrolls natively, including at an edge, without changing shots. Preserve Escape and Tab (`src/gallery/viewer.ts:18,24-28,39-77,121-132,155-166`). Put the keyboard rule in a gallery-only help element, hidden for coarse pointers at every viewport width. If there is no zoomable overflow, `actual` is false by current sizing behavior (`src/gallery/viewer.ts:59-71`).

3. **Prove behavior in real Chromium.** Extend `test/unit/gallery-browser.test.ts` using its generated multi-shot and large-image galleries (`test/unit/gallery-browser.test.ts:470-532,599-696`). Cover combined search/viewport filter order and boundaries, both opener kinds with focus return, count/title/source updates, a broken reference between viewable shots, zoomed Left/Right without navigation, and rapid navigation while decode is pending. Assert one position status mutation per completed selection and none for a blocked boundary key. Confirm the gallery-only keyboard help appears for fine pointers and is hidden for coarse pointers. Add a compare regression in `test/unit/gallery-compare-browser.test.ts` confirming A/B/Diff still open, navigation controls stay hidden, and the keyboard sentence is absent (`test/unit/gallery-compare-browser.test.ts:11-95`). Keep CSP/no-network and no-JS checks (`test/unit/gallery-compare-browser.test.ts:39-95`). Visually inspect gallery and compare dialogs at 320 px. If any HTML tag is counted or matched in tests, use case-insensitive, word-bounded regexes such as `/<script\b/gi`.

4. **Verify the UI and project gates.** Run the targeted Chromium tests, then `pnpm run typecheck && pnpm run lint && pnpm run test` per `CLAUDE.md:40-46`. Manually view the generated gallery at desktop and narrow widths before shipping, because UI changes require visual review (`CLAUDE.md:92-93`). Confirm gallery and compare output still have one inline viewer script and meta CSP with `img-src data:` (`src/gallery/render.ts:439-452,503-506`; `src/gallery/render-compare.ts:148,195-200`).

## Exact acceptance criteria

- In a gallery with at least three shots, opening the middle shot shows `2 of 3`; Left reaches the first and Right reaches the third in DOM order. Buttons and keys have the same nonwrapping behavior. The first Previous and final Next are disabled.
- Search plus a viewport/cropped chip restricts navigation to exactly eligible cards without `.hidden`; a filtered singleton shows `1 of 1` and both navigation buttons disabled. Broken-image cards are excluded, even though the gallery result count includes them. The navigation set is unaffected by whether `.overview-image` exists (`src/gallery/assets.ts:209-243,244-262`; `src/gallery/render.ts:125-150`).
- Each navigation shows the destination's name and original `data:` URI, reaches `data-viewer-state="ready"`, resets to fitted size, and never leaves an older decode's image or title visible after a newer navigation (`src/gallery/viewer.ts:79-120`).
- In actual-pixels mode, arrow keys are not intercepted; the focused inspection surface pans through native scrolling and arrows never change shots, including at a boundary. Fitted Left/Right navigate again. The keyboard sentence appears only for gallery dialogs with fine pointers and is hidden for coarse pointers at every width. Escape closes; Tab remains in the modal (`src/gallery/viewer.ts:18,24-28,59-77`).
- The polite position status changes once per completed selection and does not change for a blocked boundary key.
- Close returns focus to the current shot's matching opener, unless another element already took focus; the same-task close/reopen protections remain green (`src/gallery/viewer.ts:155-166`; `test/unit/gallery-browser.test.ts:552-596`).
- Compare A/B/Diff opening, state filters and jump links remain unchanged; gallery navigation controls are absent or hidden there, and compare help has no gallery keyboard sentence (`src/gallery/render-compare.ts:19-49,58-66,111-122,188-201`). Generated pages stay self-contained under their existing CSPs (`src/gallery/render.ts:439-452`; `src/gallery/render-compare.ts:148,195-200`).

## Acceptance mapping

| Step | Acceptance bullets |
|---|---|
| 1 | 1, 2, 3, 6, 7 |
| 2 | 4 |
| 3 | 1–7, pinned by Chromium assertions |
| 4 | 4, 6, 7, project gates and viewed UI |

## Risks and rollback

The two gallery openers per card could produce duplicate positions or an unexpected focus target; enumerate cards, not openers, and keep opener kind (`src/gallery/render.ts:125-145`). Async decode could race rapid navigation; increment `generation` per destination and assert only the latest reaches ready (`src/gallery/viewer.ts:79-118`). Native scrolling requires focus on the inspection surface; the gallery-only help explains this. Rollback is the viewer change and its browser tests; no stored data or migration is involved.

## Out of scope

- Compare-page image/pair navigation and A/B/Diff semantics (`src/gallery/render-compare.ts:58-66,104-122`).
- Swipe gestures, image preloading, wraparound, thumbnails, history/URL changes, and persisted position. The current viewer has only per-open image state (`src/gallery/viewer.ts:37-41,94-120`).
- Changing gallery filters or overview loading; both already expose the required visibility and original source (`src/gallery/assets.ts:209-262,291-328`).
- Golden-image gating; this project treats captures as human review artifacts (`docs/design.md:31-47`).

## Open questions for the owner

1. Confirm gallery-only scope. This plan adopts the smallest coherent behavior from the research recommendation; the kickoff preference request is pending.
2. If compare navigation is wanted later, choose whether Left/Right traverses images within each pair or traverses pairs while retaining side identity (`src/gallery/render-compare.ts:58-66,104-122`).

## Self-review and deterministic pins

| Lens | Result / pin |
|---|---|
| Measured or flagged | Pass: no performance estimate or fixed pan increment. |
| Derived-value semantics | Pass: filtered, singleton, and broken-reference count meanings are explicit; Step 3 tests each. |
| Emergent structure | Pass: card DOM order, one position per card and nonwrapping bounds; Step 3 tests both opener kinds and boundary states. |
| Batch/concurrency | Pass: no batch or service; Step 3 rapid-navigation test pins decode generation ordering. |
| Inherited constraints | Pass: Step 3–4 pin CSP, no-network, no-JS, focus race, and bounded overview behavior against current code. |

## Owner-question resolution (orchestrator, 2026-10-28)

1. Scope is the gallery only; the bead title names the gallery viewer.
2. Compare navigation is deferred, and the question of which axis Left/Right should move along is left open for whoever picks it up.

## Redteam disposition (2026-10-28)

1. **New controls need a truthful no-JS state. Accepted, fix now.** Previous, Next and the position status render `hidden` and `disabled`. Only a bound gallery opener reveals and enables them. Step 3 tests the no-JS output of both pages.
2. **Zoomed arrow rule replaces native scrolling. Accepted.** In fitted mode, intercept Left/Right only, for shot navigation. In actual-pixels mode, do not intercept arrows: the focused surface scrolls natively, and the help text tells users to focus the image to pan. The 40 px pan step and its ±1 px test are dropped. Step 3 instead asserts that Left/Right in actual mode do not change the shot.
3. **The `— of M` stale state is over-engineering. Accepted.** Removed, along with its browser case. Eligibility is recomputed on each navigation action, and nothing claims live updates from outside DOM changes.
4. **Narrow compare layout needs a direct check. Accepted.** Verification visually inspects a long-title Diff dialog at 320 px and confirms Close and the image surface remain usable.
5. **Trim duplicate browser cases. Accepted.** Step 3 adds only focused cases:
   - filtered order, count and boundaries;
   - both opener kinds, with focus returning to the current shot;
   - navigation while a decode is pending;
   - zoomed keys;
   - compare controls hidden.
   Existing regressions run through the normal gates.

Steps and acceptance reconciled with the disposition on 2026-10-28.
