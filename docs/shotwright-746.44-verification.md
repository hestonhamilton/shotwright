# Gallery arrow navigation verification

**Bead:** `shotwright-746.44` · **Phase:** V · **Date:** 2026-10-28 · **HEAD:** `7a88f5c`

## Method and evidence

I built the package and demo, then ran `pnpm run demo:shots` twice with the built CLI. Each run passed two walkthroughs and recorded five real Chromium screenshots. `shotwright gallery` generated the first run's page; `shotwright compare` compared the two runs and reported five identical pairs. To inspect a real Diff dialog, I copied those captures into two ignored fixture runs, gave the first shot the same long title in both manifests, recolored only its B PNG, and ran the built compare CLI again. That comparison reported one changed pair and four identical pairs. This is the fixture approach for a differing run, because the unmodified demo runs were identical. The pages, fixture, scripts, logs, measurements, and screenshots are under `local/verify44/` or `shots-output/` and are ignored by git.

Chromium opened the generated HTML as local files at 1280×800 and 320×640, plus 320×800 and 1280×800 touch contexts. `browser-results.json` and `extra-browser.json` contain the measured states. All nine screenshots below were opened and visually inspected. Each row states the active gallery search and chip, or compare state filter; `all` means no search and the All chip/filter.

| Screenshot (under `local/verify44/`) | Active search/filter | Visual observation |
| --- | --- | --- |
| `gallery-desktop-all.png` | Search empty; All | Five-shot count and filters are readable. |
| `gallery-desktop-middle.png` | Search empty; All | `2 of 5`, Previous, Next, Actual pixels, and Close fit in the header; image is fitted. |
| `gallery-desktop-search-modal-open.png` | Search `modal-open`; All | Singleton reads `1 of 1`; both navigation buttons are disabled. |
| `gallery-320-all-fit.png` | Search empty; All | Header wraps within the dialog; all buttons, count, help, and image surface remain visible. |
| `gallery-320-all-actual.png` | Search empty; All | Actual-pixels mode retains the controls and scrollable inspection surface. The sampled part of this image is mostly blank background. |
| `gallery-320-coarse-all.png` | Search empty; All | Keyboard sentence is absent; general zoom help remains. |
| `gallery-1280-coarse-all.png` | Search empty; All | Keyboard sentence is absent at wide touch width too. |
| `compare-desktop-all-a.png` | Compare filter All | A opens normally; no gallery navigation controls or keyboard sentence. |
| `compare-320-all-long-title-diff.png` | Compare filter All | Long Diff title wraps; Close and the image surface remain visible and usable. |

Across these browser contexts, page errors, console errors, and HTTP requests were all **0**. Both generated page types have a meta CSP containing `img-src data:` and `connect-src 'none'`, no external script tags, and exactly one inline viewer-script marker. The gallery has two inline scripts total; compare has one.

## Acceptance checklist

| Plan criterion, including Redteam disposition | Verdict and evidence |
| --- | --- |
| Three or more shots navigate in DOM order by buttons and fitted Left/Right, without wrapping; end buttons disable. | **PASS.** On the real gallery with search `home` plus chip `viewport-0`, Chromium found `form-filled`, `modal-open`, `theme-dark` in order; opening the middle gave `2 of 3`, Right gave `3 of 3`, and final Next was disabled (`extra-browser.json`). With no filter, opening the second of five gave `2 of 5`; Left reached `1 of 5` with Previous disabled, and Next returned to the second (`browser-results.json`). The targeted Chromium test also exercises button and key boundaries. |
| Search plus viewport/cropped chip limits navigation to eligible visible cards; singleton and broken cards behave correctly; overview presence does not affect eligibility. | **PASS.** The real search `home` plus `viewport-0` yielded exactly the three named cards. Search `modal-open` plus All yielded one card, `1 of 1`, with both buttons disabled. The broken-reference Chromium fixture has three cards but navigates `1 of 2` directly to `2 of 2`; the test removes a destination `.overview-image` and still navigates to it (`test/unit/gallery-browser.test.ts`, targeted run 22/22). Thus the `2 of 2` count applies only to the broken-card fixture; the unfiltered real gallery is `1..5 of 5`. |
| Destination title and original `data:` URI update, reach ready, reset to fit, and stale decodes cannot replace a later shot. | **PASS.** The real second shot reached `data-viewer-state="ready"`, displayed `mobile-layout — Screenshot`, and its image `src` equaled that card's `[data-original]` URI (`browser-results.json`). The targeted Chromium test asserts title, source, ready, fitted reset, and a delayed decode overtaken by a newer selection. |
| Actual-pixels arrows remain native for panning; fitted arrows navigate; gallery-only keyboard help is fine-pointer-only; Escape and Tab stay correct. | **PASS.** At 320 px, a focused actual-pixels surface moved from `scrollLeft=500` to `536` on Right while position remained `1 of 5`; the fitted Right action changed the selected shot (`extra-browser.json`, `browser-results.json`). The keyboard sentence was visible with a fine pointer and hidden in both 320 and 1280 px coarse contexts. Escape returned focus to the opener; the existing modal Tab and same-task close/reopen Chromium tests passed in the targeted run. The accepted Redteam rule is native scrolling, with no fixed pan increment. |
| Polite position status changes once per completed selection and not for a blocked boundary action. | **PASS.** The Chromium test observes the `aria-live="polite"` status: zero mutations for Left at the first shot and exactly one for the following completed Right selection. The real pages expose the same status element (`test/unit/gallery-browser.test.ts`; targeted run 22/22). |
| Close returns to the current shot's matching preview or text opener unless focus moved elsewhere; same-task protections hold. | **PASS.** Real-page Escape after navigating back to the second card focused its preview (`browser-results.json`). The targeted Chromium test exercises both preview and text opener kinds after navigation, plus the existing same-task close/reopen cases. |
| Compare A/B/Diff, filters and jump links remain usable; gallery controls/help are absent or hidden; pages retain self-contained CSP/no-JS behavior. | **PASS.** The two-run CLI compare succeeded, and the changed-image fixture produced a Diff. Chromium opened A on the real compare and Diff on the fixture; controls were hidden, gallery help was empty, and the 320 px long-title Diff retained Close and a nonzero image surface. The targeted compare browser suite opens A/B/Diff, checks state filters and jump links, and passed. JavaScript-disabled Chromium found zero enabled viewer openers and hidden navigation controls on both page types. The CSP and network checks are above. |

## Redteam findings resolution

| Finding | Resolution and pin |
| --- | --- |
| Plan 1: new controls need a truthful no-JS state. | Accepted. Previous, Next, and status start hidden; buttons start disabled. No-JS Chromium measured hidden controls and zero enabled viewer openers on gallery and compare. Implementation `fc55436`; no-JS browser tests in the 22/22 targeted run. |
| Plan 2: zoomed arrows should use native scrolling. | Accepted. Actual mode does not intercept arrows; measured Right scroll `500 → 536` with unchanged shot. Fitted mode navigated. Implementation `fc55436`; zoomed-key browser test. |
| Plan 3: stale `— of M` state is unnecessary. | Accepted. No stale-state contract remains; navigation recomputes visible eligible cards on each action. Plan reconciliation `7a88f5c`; filtered-order browser test. |
| Plan 4: narrow compare layout needs direct inspection. | Accepted. Viewed `compare-320-all-long-title-diff.png`; Chromium measured Close within the dialog and a positive-size image surface. Implementation `fc55436`; this V inspection. |
| Plan 5: duplicate browser cases should be trimmed. | Accepted. Focused navigation, decode, zoom, no-JS, and compare cases run alongside existing regressions. Implementation `fc55436`; targeted suites 22/22. |
| Implementation review 1: keyboard sentence appeared in compare. | Fixed in `7a88f5c`. Real compare and fixture Diff exposed empty gallery help; compare Chromium regression checks A/B/Diff. |
| Implementation review 2: keyboard sentence appeared for coarse pointers. | Fixed in `7a88f5c`. Viewed both coarse screenshots and measured hidden help at 320 and 1280 px; coarse-pointer browser test. |
| Implementation review 3: live position was written more than once. | Fixed in `7a88f5c`. MutationObserver browser assertion pins one write per selection and zero at a blocked boundary. |
| Implementation review 4: broken-card exclusion lacked a test. | Added in `7a88f5c`. Three-card fixture proves navigation `1 of 2 → 2 of 2`, skipping the broken middle card. |
| Implementation review 5: plan acceptance needed reconciliation. | `7a88f5c` reconciled the plan's steps and acceptance with all Redteam dispositions; this checklist verifies that amended contract. |
| Declined count concern: `2 of 2` might be wrong. | Refuted by separate populations: real unfiltered gallery has five eligible cards (`1..5 of 5`), while the broken fixture has two eligible cards among three results. Pinned by real Chromium measurements and the broken-card test in `7a88f5c`. |
| Declined focus/close-return concerns. | Exercised successfully. Real Escape returned to the current preview; both opener kinds and same-task close/reopen are pinned by Chromium tests from `fc55436` and the existing suite. |

## Commands run

Commands ran from this worktree. Logs are under `local/verify44/`; output excerpts omit absolute run directories and tool banners.

```text
npm_config_cache="$PWD/local/verify44/npm-cache" pnpm run typecheck && pnpm run lint && pnpm run test   exit 0
  typecheck: build and tsc --noEmit passed
  lint: Prettier "All matched files use Prettier code style!"; publint "All good!"; ESM checks green
  test: 23 files passed; 638 passed, 1 skipped

pnpm run build                                  exit 0
pnpm run demo:build                             exit 0
pnpm run demo:shots                             exit 0, twice (2 walkthroughs and 5 shots each)
timeout 5 node dist/cli.js gallery <run-A> --config demo/shots.config.ts   exit 124 (server generated the page, then timeout stopped it)
node dist/cli.js compare <run-A> <run-B> --config demo/shots.config.ts --output local/verify44/compare-demo-final.html   exit 0
  identical 5; changed 0
node dist/cli.js compare local/verify44/fixture-a local/verify44/fixture-b --config demo/shots.config.ts --output local/verify44/compare-fixture.html   exit 0
  identical 4; changed 1; gated 1
node local/verify44/browser.mjs <gallery> <compare> <fixture-compare>   exit 0
  9 screenshots; page errors 0; console errors 0; HTTP requests 0
pnpm exec vitest run test/unit/gallery-browser.test.ts test/unit/gallery-compare-browser.test.ts   exit 0
  2 files passed; 22 tests passed
pnpm run smoke                                exit 0
  3 files passed; 56 tests passed
```

The smoke run reported that its consumer `playwright install chromium` invocation timed out and continued with the existing browser cache; the full smoke suite still passed.

## Observations and sign-off

The real demo's five shots and the changed-image compare fixture satisfy the navigation and narrow Diff checks. The screenshots show no clipped dialog controls. The fixture changes only ignored verification data, not product code. **Overall verdict: PASS — all seven amended acceptance criteria pass.** No `src/` or `test/` file was changed in V; no git commit or Beads write was made.
