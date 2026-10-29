# shotwright-746.43 — A/B overlay modes verification

**Bead:** `shotwright-746.43` · **Phase:** V · **Date:** 2026-10-28 · **HEAD:** `5ffad66` · **Overall verdict: PASS**

## Method and evidence

`pnpm build` built the CLI. Two fresh `pnpm run demo:shots` executions each passed two Playwright tests and captured five real demo shots. Their run IDs were `2026-10-29T00-27-02_a85a` and `2026-10-29T00-27-04_f123` (UTC timestamps). I copied each run into `local/verify-746.43/` immediately after capture. In the **copy** of B, `about-desktop.png` was extended from 2880×2076 to 3040×2156 with a blue right/bottom band; the tracked demo and original captures were untouched. `node dist/cli.js compare` generated `demo-compare.html`: four identical pairs and one size-changed pair. The demo run also generated its real `gallery.html`.

For the 1000×8000 lifecycle and opposite-extents checks, I used the local colored-image fixture from `local/compare-review/` and generated a fresh `fixture-compare.html` with the **built CLI**. This fixture has a 1100×720 A versus 700×1000 B size-changed pair, exposing the checker background outside both images. The tall fixture is 600×8000 on each side. The demo compare supplies the required real-run size-changed Swipe evidence; the fixture supplies the tall and opposite-extents cases, not a substitute for the demo runs.

Chromium opened both generated compare pages as `file:` documents. I took and **looked at all 16 screenshots** under `local/verify-746.43/` (names below). The measured data are `browser-results.json`, `interactions.json`, `reset-repro.json`, and `serialization.json` in that ignored directory. No screenshot is committed. `browser.mjs`, `interactions.mjs`, and `reset-repro.mjs` are the local exercise scripts. Neither product source nor tests were edited.

## Acceptance checklist

| Plan acceptance, including dispositions | Verdict and evidence |
| --- | --- |
| Eligible shot pairs offer **Inspect A/B together**; added, removed, unreadable, and artifacts do not. | **PASS.** The real compare has five bound actions, one per readable pair; the no-JS context has five disabled actions. The render suite covers identical, changed, size-changed, added, removed, unreadable, artifact, escaping, and late hydration failure (`test/unit/gallery-compare-render.test.ts`). The fixture no-JS card shows a disabled action with both previews and downloads (`nojs-card.png`). |
| One dialog; Side by side on each open; A/B/Diff single-image path preserved. | **PASS.** Every opened case measured one `#inspection-dialog` and exactly one `aria-pressed="true"` mode. Reopen selected Side by side even after an Onion opening. A, B, and Diff each displayed its matching source while pair controls were hidden (`interactions.json`); the gallery/compare browser suites passed in the unit gate. The original slider defect and its re-verification are covered in the range criterion below. |
| Common scale and synchronized, clamped scrolling at fit and actual. | **PASS.** On the real size-changed demo pair, fit scale ratios were 0.19769/0.19770 at 1280×800 and 0.11039/0.11039 at 390×844 (delta <0.01); both panes had zero fit overflow. On the fixture at DPR 1, actual widths were exactly 1100 and 700 CSS px. At DPR 2, widths were 550 and 350 CSS px, exactly natural width / DPR. On actual mode, A scroll to its maximum `(499,162)` placed B at its clamped `(99,162)`; B→A at `(40,40)` matched; alternating same-frame writes settled both vertical offsets at 120 (`interactions.json`). The 390 px Side by side panes visibly stack A above B (`side-390x844-dark.png`). The 600×8000 fit panes also had zero overflow (`browser-results.json`). |
| Swipe and Onion skin native, keyboard-accessible ranges, including the amended per-opening reset. | **PASS after re-verification.** The original run failed because closing from Onion 70 and reopening left Onion at 70 (`reset-repro.json`, `onion-reopen-70.png`, and `interactions.json`); the previous implementation reset values before `setPairMode('side')`, which saved the old range over the reset. Commit `5ffad66` moves the reset after that mode switch. On the newly generated real demo compare, both viewports retained Swipe 35 across an Onion 70 switch within one opening, then reset both modes to 50 after Escape and reopen. Closing from Swipe 20 likewise reset both to 50. Range and visible percentage agreed in each case (`reverify-results.json`, viewed screenshots). The original 35% geometry and keyboard observations above remain valid. |
| Size-changed top-left alignment, no distortion, visible one-sided and neither-sided extensions. | **PASS.** The real demo's blue B extension and the A-only region are visible in `size-changed-swipe.png`; the 1100×720 versus 700×1000 fixture exposes the checker outside both images in `opposite-extents-swipe.png`. Both label the pair **aligned at top left**. DOM stage geometry uses the native maximum extents and the same fitted factor on A/B; the overlay starts both at stage `(0,0)`. The colored fixture's pixel assertion in `test/unit/gallery-compare-browser.test.ts` passed. |
| Self-contained page, one serialized URI per source image, CSP/no-JS truthfulness. | **PASS.** Case-insensitive, word-bounded `<img\b` and `src="data:` regex counts found exactly 10 URI-bearing source images out of 14 image elements in the demo HTML and 8 out of 12 in the fixture HTML; the other four are empty runtime viewer nodes. Every source image tag had exactly one URI-bearing `src`, and total `data:image/png;base64,` occurrences equalled the source count. The CSP still sets `default-src 'none'`, `img-src data:`, inline style/script only, and `connect-src 'none'`. Across all 13 browser page cases, there were zero page/console errors and zero HTTP(S) requests. The no-JS page had zero enabled pair actions, hidden pair controls, visible previews, and downloads (`nojs-card.png`, `interactions.json`). Exact CSP string equality and main-branch byte comparison were dropped by redteam disposition #7. |
| Reduced motion, Escape, focus return, no gallery/single-viewer regression. | **PASS.** Reduced-motion Onion at 390×844 remained readable and at 35% (`reduced-motion-onion.png`); no mode animation was required. Escape closed the dialog and restored focus to its opener; closing removed all pair image `src` values. A/B/Diff single views kept pair controls hidden (`interactions.json`). Existing gallery and compare browser suites passed in the 644-passing unit gate. |

## Visual observations

All captures below were opened and inspected. The active compare filter was **All 5** on the demo page and **All 3** on the fixture page; no filter changed while a dialog was open.

| Mode / context | Viewed screenshot(s) | Observation |
| --- | --- | --- |
| Side by side, 1280×800 light; 390×844 dark | `side-1280x800-light.png`, `side-390x844-dark.png` | Both images fit without clipping; narrow panes stack vertically and controls wrap legibly. |
| Swipe 35%, 1280×800 light; 390×844 dark | `swipe-1280x800-light.png`, `swipe-390x844-dark.png` | Boundary and 35% readout visible; B extension and checker remain distinguishable. |
| Onion skin 35%, 1280×800 light; 390×844 dark | `onion-1280x800-light.png`, `onion-390x844-dark.png` | Blended image, selected mode, and 35% readout visible. |
| Size change and opposite extents, Swipe 35% | `size-changed-swipe.png`, `opposite-extents-swipe.png` | Real demo B band and fixture one-sided/neutral regions visible. |
| 600×8000 pair, Side/Swipe 35%/Onion 35%, then reopened | `tall-side.png`, `tall-swipe.png`, `tall-onion.png`, `tall-reopened.png` | All modes rendered and reopened ready. Runtime image `src` counts were 2 on open, 4 on first overlay, 4 through switches, 0 on close, 2 on reopen. |
| Reduced motion, 390×844 dark, Onion 35% | `reduced-motion-onion.png` | Controls and blended image remain readable. |
| No JavaScript, 390×844 dark, All 5; fixture card, All 3 | `nojs.png`, `nojs-card.png` | Page and previews render; Inspect A/B together is disabled, downloads remain links, and pair controls stay hidden. |
| Reopen defect, 1280×800 light, Onion 70%, All 5 | `onion-reopen-70.png` | The previous Onion value remains visibly 70% after a fresh open. |

## Redteam findings resolution

| Finding | Resolution and pin | Verify result |
| --- | --- | --- |
| Plan #1: shared viewer state can leak between pair and single views. | Explicit `closed`/`single`/`pair` routing and cleanup in `6690b4d`; pair→single→pair, resize, and close cases in `test/unit/gallery-compare-browser.test.ts`. | PASS: A/B/Diff and pair transitions measured; one dialog. |
| Plan #2: simple scroll guard can reverse clamped panning. | Origin tracking and clamping in `6690b4d`, strengthened by same-frame reconciliation in `9d86e1d`; browser geometry tests. | PASS: `(499,162)` source→`(99,162)` follower, B→A `(40,40)`, same-frame 120/120. |
| Plan #3: 390 px layout unspecified. | Stack A then B under narrow dialog width in `6690b4d`; mobile browser test. | PASS: viewed 390×844 dark Side by side and measured panes. |
| Plan #4: Swipe clip must use stage width. | Stage-sized wrapper and clip in `6690b4d`; unequal-width geometry/pixel test. | PASS: 35% clip is 65% right inset, with exposed regions visible. |
| Plan #5: tall-shot lifecycle and release. | Open/close source cleanup in `6690b4d`, lazy overlay assignment in `9d86e1d`; tall browser case. | PASS: 8000 px open/switch/close/reopen ready, source counts 2→4→0→2. No decoded-memory count claimed. |
| Plan #6: omitted action for ineligible pairs is truthful. | Kept as planned in `6690b4d`; eligibility render tests. | PASS: ineligible cases covered by passing tests. |
| Plan #7: redundant/fragile test expectations. | Focused geometry/pixel, URI-tag, CSP policy, and no-network checks in `6690b4d`; no exact CSP or main-byte baseline assertion. | PASS: generated pages measured with case-insensitive tag regex and zero external requests. |
| Implementation review: fitted panes overflow at 390 px. | Measured-layout fit in `9d86e1d`; 1000×700 and 1000×8000 browser test. | PASS: zero overflow on demo and tall fixture at both viewport sizes. |
| Implementation review: same-frame alternating scroll desync. | Last-origin reconciliation in `9d86e1d`; same-frame browser test. | PASS: 120/120 settled offsets. |
| Implementation review (orchestrator): four images assigned `src` on open. | Lazy overlay sources in `9d86e1d`; browser source-count test. | PASS: 2 initially, 4 only after selecting overlay, 0 after close. |
| Implementation review: slider reset on every switch. | Per-mode saved values in `9d86e1d`; reset ordering and close/reopen browser assertions in `5ffad66`. | **PASS after re-verification:** within-opening retention and both Onion 70 and Swipe 20 close/reopen resets passed on the real demo compare. The initial verification's **PARTIAL / FAIL** remains documented in the prior evidence files and the section below. |

## Commands run and gate output

All commands ran from the worktree. Logs live under `local/verify-746.43/`; excerpts omit absolute tool output paths. The initial attempt to use the default compare config exited 2 (`shots.config.ts` absent at the root); rerunning with `--config demo/shots.config.ts` succeeded. The first pair of demo outputs was removed by the later smoke exercise, so I recaptured both and copied each immediately.

```text
npm_config_cache="$PWD/local/verify-746.43/npm-cache" bash -o pipefail -c 'pnpm run typecheck && pnpm run lint && pnpm run test'  exit 0
  typecheck: build and tsc --noEmit passed
  lint: ESLint, Prettier, publint, attw passed
  Test Files 23 passed (23); Tests 644 passed | 1 skipped (645)

npm_config_cache="$PWD/local/verify-746.43/npm-cache" pnpm run smoke  exit 0
  Test Files 3 passed (3); Tests 56 passed (56)
  Consumer shots:install timed out; smoke continued with the existing Chromium cache and passed.

pnpm build                         exit 0 (tsc -p tsconfig.build.json)
pnpm run demo:build                exit 0
pnpm run demo:shots               exit 0 (twice; each 2 tests passed, 5 shots)
node dist/cli.js compare <copied-demo-A> <copied-demo-B> --config demo/shots.config.ts --output local/verify-746.43/demo-compare.html  exit 0
  identical 4, size-changed 1, gated 1, report only
node dist/cli.js compare local/compare-review/a local/compare-review/b --config demo/shots.config.ts --output local/verify-746.43/fixture-compare.html  exit 0
  changed 2, size-changed 1, report only
node local/verify-746.43/browser.mjs       exit 0 (13 page cases, 14 screenshots, no page errors or external requests)
node local/verify-746.43/interactions.mjs  exit 0 (geometry, pan, keyboard, focus, single views; 1 screenshot)
node local/verify-746.43/reset-repro.mjs   exit 0 (reproduced failed reset; 1 screenshot)
```

## Re-verification (after `5ffad66`)

The original **FAIL** was observed on `9d86e1d`: after Onion 70 → Escape → reopen, Onion still showed 70, as recorded in `local/verify-746.43/reset-repro.json` and the viewed `local/verify-746.43/onion-reopen-70.png`. The fixture reproduced it in `interactions.json`. The first run also measured Swipe's 35% clip as `inset(0px 65% 0px 0px)` and Onion B opacity as `0.35` at both required sizes; Home, End, and ArrowLeft yielded 0, 100, and 99. Within-opening Swipe 35 → Onion 70 → Swipe retained 35. The reset failure came from assigning both saved values 50 before `setPairMode('side')`, which saved the old Onion range over that reset. No fix was made during the original V pass. Those original evidence files were retained. Commit `5ffad66` moved the saved-value reset after the opening mode switch and added browser assertions for close/reopen from both Onion and Swipe.

I rebuilt the CLI, then used it to regenerate `local/verify-746.43/demo-compare-reverify.html` from the two captured demo runs named above. The report still has four identical pairs and one size-changed pair. Chromium exercised the real size-changed `about-desktop` pair at 1280×800 and 390×844. In each viewport:

| Sequence or check | Re-verification result |
| --- | --- |
| Swipe 35 → Onion 70 → Swipe within one opening | Swipe range and visible readout returned to **35%**; Onion returned to **70%**. |
| Escape → reopen after Onion 70 | Side by side selected initially; Swipe and Onion range and readout each showed **50%**. Focus returned to the opener on Escape. |
| Swipe 20 → Escape → reopen | Swipe and Onion range and readout each showed **50%**. |
| Side by side fit at 390×844 | Both panes measured `356×266` client and scroll extents: **zero horizontal or vertical overflow**. The viewed screenshot shows A above B. |
| Swipe 35% on the size-changed pair | Computed clip was `inset(0px 65% 0px 0px)` at both sizes. Stage widths were 826.27 px and 356 px, with the narrower A image at 782.78 px and 337.25 px; the 35% boundary and B's added band are visible in the viewed captures. |

Evidence is `local/verify-746.43/reverify-results.json` and `reverify.log`. I opened and inspected `reverify-side-390x844.png`, `reverify-swipe-35-390x844.png`, and `reverify-onion-reopen-1280x800.png`; the other new captures are `reverify-swipe-35-1280x800.png` and `reverify-onion-reopen-390x844.png`. The browser run reported zero page or console errors. Its local driver is `local/verify-746.43/reverify.mjs`. These ignored screenshots and logs are not committed.

```text
pnpm build                                                                 exit 0
node dist/cli.js compare <copied-demo-A> <copied-demo-B> --config demo/shots.config.ts --output local/verify-746.43/demo-compare-reverify.html  exit 0
  identical 4, size-changed 1, gated 1, report only
node local/verify-746.43/reverify.mjs > local/verify-746.43/reverify.log    exit 0
npm_config_cache=local/verify-746.43/npm-cache bash -o pipefail -c 'pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run smoke'  exit 0
  typecheck: build and tsc --noEmit passed
  lint: ESLint, Prettier, publint, attw passed
  Test Files 23 passed (23); Tests 644 passed | 1 skipped (645)
  Smoke Test Files 3 passed (3); Tests 56 passed (56)
  Consumer shots:install timed out; smoke continued with the existing Chromium cache and passed.
```

## Sign-off

**PASS after `5ffad66`.** The amended per-opening reset now passes on the generated real demo compare at both viewports, including close from Onion 70 and Swipe 20. Within-opening values remain independent, the 390×844 Side by side panes fit, the size-changed Swipe 35% geometry is correct, and all required gates passed. The original failure evidence remains above and in `local/verify-746.43/`. No source or test file, git commit, or Beads record was changed during this re-verification.
