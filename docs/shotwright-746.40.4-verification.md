# E13 gallery viewer verification

**Bead:** `shotwright-746.40.4` · **Epic:** `shotwright-746.40` · **Phase:** V · **Date:** 2026-10-28 · **HEAD:** `7357f2c`

## Method and evidence

Two real Playwright captures of the built demo ran through `pnpm run demo:shots --config local/verify/shots.config.ts`, using the temporary spec `local/verify/specs/verify.shots.ts`. The only difference between run A (`2026-10-28T16-04-31_9127`) and B (`2026-10-28T16-04-34_1bf0`) was the background color of the appended long page. Each run recorded two shots: `tall-full-page` at 2,560×16,566 intrinsic pixels with `fullPage: true`, and `normal-dsf2` at 2,560×1,600 with `fullPage: false`; both were captured at a 1,280×800 viewport and device scale factor 2. Both runs passed their one Playwright test. The generated galleries are in `local/verify/runs/<run-id>/gallery.html`; the real comparison is `local/verify/compare.html`. The compare reported one changed tall pair, one identical normal pair, and a diff image for the changed pair. The scratch config, spec, browser scripts, captures, logs, and reports are all under ignored `local/verify/`.

Playwright opened the generated HTML as `file:` pages at 1,440×900, 390×844, and 320×640, each in light and dark color schemes. It captured 55 screenshots under `local/verify/`; I viewed all 51 main captures in `contact-1.jpg` through `contact-6.jpg` and viewed the four extra captures directly. The browser measurements are in `browser-results.json` and `extras-results.json`. `timeout 3` stopped each temporary gallery server after it generated HTML (exit 124, expected); both gallery logs say `serving`. The compare command exited 0. An initial scratch web-server command resolved its Vite config from the scratch directory and failed; correcting the temporary config to invoke Vite from the worktree root yielded the two passing runs. No product source or test file was edited.

## Epic acceptance checklist

| Acceptance (verbatim) | Verdict and evidence |
| --- | --- |
| Clicking a card's screenshot opens the full-size viewer (keyboard-accessible equivalent preserved). | **Pass for opening.** The tall preview click, focused-preview Enter, and the separate text button each opened the dialog; Escape restored focus to the exact invoker. Evidence: `gallery-fit-desktop-light.png`, `gallery-enter-desktop-light.png`, `gallery-action-desktop-light.png`; `browser-results.json` activation and gallery cases. |
| The viewer control and dialog are labelled in plain language. | **Pass.** The action reads “View full screenshot”; the dialog title names the screenshot; the toggle reads “Actual pixels” and then “Fit to window.” At 320 px the title and controls wrap onto separate lines without clipping. Evidence: `gallery-fit-mobile320-light.png`, `gallery-actual-mobile320-dark.png`. |
| A screenshot larger than the viewport opens fitted to the available dialog area with no scrolling, at the largest scale that fits (never upscaled past 1:1); a toggle reaches true 1:1 pixels. | **Pass** (click-anchor defect found here, fixed and re-verified — see "Defect resolution"). For the 2,560×16,566 image at viewing DPR 1, desktop fit measured 116.516×754 CSS px inside a 1,380×754 surface; `scrollHeight=clientHeight=754` and `scrollWidth=clientWidth=1380`. At 390 px, fit was 100.281×649 inside 372×649; at 320 px, 67.984×440 inside 305×440. Actual mode measured 2,560 CSS px wide at viewing DPR 1 and 1,280 CSS px wide at DPR 2, exactly `naturalWidth / devicePixelRatio`. Actual mode scrolls and the button returns to fit. Evidence: `gallery-fit-desktop-light.png`, `gallery-fit-mobile390-light.png`, `gallery-fit-mobile320-light.png`, `gallery-dpr1-actual.png`, `gallery-dpr2-actual.png`, `browser-results.json`. The click-anchor deviation is below. |
| Audit findings are recorded in the R doc; fixed items are verified by rendering a real gallery and viewing it (an unviewed UI change does not ship). | **Pass with defects recorded.** `docs/shotwright-746.40.1-research.md` contains the audit and owner decisions. Real gallery and compare HTML were generated from the two passing Playwright runs and all 55 browser screenshots were viewed. A/B/Diff each opened and restored focus at all six size/palette combinations; the no-match state read `0 of 2 shots shown` and Clear search restored `2 of 2`. Evidence: `compare-a-fit-desktop-light.png`, `compare-b-fit-mobile390-dark.png`, `compare-diff-fit-mobile320-light.png`, `gallery-no-match-desktop-light.png`. |
| typecheck, lint, test green. | **Pass.** The chained typecheck/lint/test commands exited 0. Smoke and leak gate also exited 0; output tails below. |

## Visual observations and browser checks

- **Gallery light/dark:** `gallery-desktop-light.png` and `gallery-desktop-dark.png` show distinct readable palettes, with the status and filter controls visible. At 390 and 320 px (`gallery-mobile390-light.png`, `gallery-mobile320-dark.png`), the run facts and long browser value occupy the first viewport, pushing shots below the fold. The dates wrap inside their columns without clipping. This is the existing mobile-run-facts follow-up, not a newly introduced viewer failure. Visual legibility was inspected; no WCAG contrast ratio is claimed because computed foreground/background pairs were not measured.
- **Viewer:** The 16,566 px page is necessarily tiny in fitted overview, but its full length is visible without surface scrolling in `gallery-fit-desktop-light.png`, `gallery-fit-mobile390-dark.png`, and `gallery-fit-mobile320-light.png`. The dialog header and help remain legible at 320 px. Actual mode (`gallery-actual-desktop-light.png`, `gallery-actual-mobile320-light.png`) gives readable page detail and scrolls. The 320 px resize capture `gallery-actual-resized-320.png` retained 2,560 CSS px image width and the prior scroll offsets (`left=569`, `top=7898`). The Enter capture shows a visible focus ring on Close. The click-zoom capture shows actual pixels, but the measured anchor is offset (defect below).
- **Compare:** `compare-desktop-light.png` and `compare-desktop-dark.png` show the three distinct A, B, and red Diff previews. At 320 px (`compare-mobile320-light.png`, `compare-mobile320-dark.png`), the long run-ID heading wraps over several lines and dominates the first viewport; it does not clip. A/B/Diff fitted dialogs have no surface scrollbar; for example at 320 px the B image was 67.672×438 CSS px inside a 438 px-high surface. The diff title wraps and both controls remain visible (`compare-diff-fit-mobile320-light.png`). The compact compare header is already separate follow-up work.
- **No JavaScript and portability:** `nojs-gallery-mobile390.png`, `nojs-gallery-downloads.png`, `nojs-compare-mobile390.png`, and `nojs-compare-downloads.png` show the static metadata/previews and visible downloads. Gallery had four disabled viewer openers and two downloads; compare had five disabled viewer openers and four downloads. The gallery has a truthful `<noscript>` explanation; its separate Load screenshot button issue is below. Copies of each HTML file in `local/verify/isolated/` opened their embedded viewer image without sibling files (both `naturalWidth=2560`). Downloads still refer to sibling files where applicable.
- Across all browser contexts, recorded CSP console errors: **0**; page errors: **0**; requests outside `file:` or `data:`: **0**. The generated pages remained self-contained for viewing embedded screenshots.

## Defects found during V

| Severity | Reproduction and evidence | Disposition |
| --- | --- | --- |
| **Medium — click anchor misses the clicked point.** | Open `tall-full-page` at 1,440×900, viewing DPR 1, then click the center of its fitted image at `(719.992, 495.391)` CSS px. After `data-viewer-state="ready"`, that same image fraction lands at `(740.797, 503.391)`: **+20.805 px horizontal, +8 px vertical**, outside the plan's ±1 px anchor criterion. The surface scroll is `(569, 7898)`, so this is not an edge clamp. Reproduced in `local/verify/extras.mjs`; data in `extras-results.json`, visual state in `gallery-anchor-verified.png`. | Reopen the implementation bead or file a focused defect bead. Verify phase made no code change. The fit and button-toggle acceptance remains green, but owner-decided click anchoring needs correction before full sign-off. |
| **Low — no-JS Load screenshot action remains enabled.** | Open the gallery with `javaScriptEnabled:false`, scroll to the first card (`nojs-gallery-downloads.png`), and click “Load screenshot.” It is presented as an enabled button but cannot load an overview. Viewer openers are disabled and the nearby no-JS warning accurately states overview loading requires JavaScript. | Include in an implementation correction or a separate small follow-up. Original download works. |

The five already filed follow-up beads are `shotwright-746.41`, `.42`, `.43`, `.44`, and `.45`. Their owner-decided topics are mobile run-fact hierarchy, compact compare header/navigation, synchronized overlay comparison, arrow-key shot navigation, and artifact-section terminology. The click-anchor and no-JS Load screenshot findings above are additional V findings; no `bd` command was run to alter the board.

## Commands run and gate output

Commands below ran from the worktree. Full logs are under `local/verify/`. The local npm cache prefix kept pack/install scratch out of the root partition. The transcript excerpts omit tool banner lines and run-directory absolute paths.

```text
pnpm run demo:build                                      exit 0
VERIFY_VARIANT=A pnpm run demo:shots --config local/verify/shots.config.ts   exit 0
  1 passed (1.7s); shotwright: 2 shot(s)
VERIFY_VARIANT=B pnpm run demo:shots --config local/verify/shots.config.ts   exit 0
  1 passed (1.6s); shotwright: 2 shot(s)
timeout 3 node dist/cli.js gallery <run-A> --config local/verify/shots.config.ts  exit 124 (served, then stopped)
timeout 3 node dist/cli.js gallery <run-B> --config local/verify/shots.config.ts  exit 124 (served, then stopped)
node dist/cli.js compare <run-A> <run-B> --config local/verify/shots.config.ts --output local/verify/compare.html  exit 0
  1 measured non-parity pair; identical 1, changed 1, gated 1
node local/verify/browser.mjs                         exit 0
  51 screenshots; CSP errors 0; other network requests 0; page errors 0
node local/verify/extras.mjs                          exit 0
  4 further screenshots; click-anchor assertion recorded as failed; isolated gallery/compare images decoded

npm_config_cache="$PWD/local/verify/npm-cache" pnpm run typecheck  exit 0
  $ pnpm run build && tsc --noEmit
  $ tsc -p tsconfig.build.json
npm_config_cache="$PWD/local/verify/npm-cache" pnpm run lint       exit 0
  All matched files use Prettier code style!
  All good!
  bundler: 🟢; node16 (from ESM): 🟢
npm_config_cache="$PWD/local/verify/npm-cache" pnpm run test       exit 0
  Test Files 23 passed (23)
  Tests 630 passed | 1 skipped (631)
npm_config_cache="$PWD/local/verify/npm-cache" pnpm run smoke      exit 0
  Test Files 3 passed (3)
  Tests 56 passed (56)
npm_config_cache="$PWD/local/verify/npm-cache" pnpm run leak-gate  exit 0
  layer A ok — 55 files; layers B and C: no leaks found; PASSED
  file count 55 versus baseline 53 (gate labels this a non-failure)
```

## Sign-off

The epic's primary open, labelling, fit, actual-pixel, compare, rendered-viewing, and quality-gate checks passed on real artifacts. **Full Verify sign-off is withheld** for the measured click-anchor miss against the accepted plan, plus the lower-severity no-JS Load screenshot issue. No source, test, commit, push, or board change was made in V.

## Defect resolution and re-verification (HEAD `bde6497`)

Both V defects went back to implementation (`shotwright-746.40.3`, commit `bde6497`) and were re-measured against the same real runs.

- **Click anchor.** Root cause: Chromium reports fractional coordinates on `pointerup` but rounds `click.clientX/Y` to whole CSS pixels. Going from fit to actual pixels on this shot is a ~22× scale change, so up to half a pixel of rounding becomes up to ~11 px per axis after the zoom. That rounding produced the measured +20.8 / +8 px. The viewer now anchors on the fractional `pointerup` position of a trusted click on the image, and falls back to the click coordinates otherwise. This was quantization, not layout drift: the old code was self-consistent with the rounded coordinate. A new regression test in `test/unit/gallery-browser.test.ts` clicks at the centre and at an off-centre point on a wide, far-below-1 fit. It failed against `7357f2c` with `deltaX: 20.8046875, deltaY: 8` and passes after the fix. Re-running `local/verify/extras.mjs` on regenerated HTML measured target `(719.992, 495.391)` → landed `(719.797, 495.391)`, an offset of **−0.195 / 0 px**, within ±1 px.
- **No-JS Load screenshot.** The button now renders `disabled` and the gallery script enables it when it binds. The regenerated real gallery contains `class="action load-action" type="button" disabled`. The no-JS unit test asserts all 60 load buttons stay disabled. In `extras-results.json`, the `nojs-*.disabled` key counts *enabled* openers (`[data-viewer-open]:not([disabled])`); its value of 0 is the expected result.
- Gates at `bde6497`: `pnpm run typecheck && pnpm run lint && pnpm run test` exit 0 (631 passed, 1 skipped), and `pnpm run smoke` passed (56). The gallery and compare browser suites passed 15/15 in each of three consecutive runs.

**Verdict: all epic acceptance criteria pass.** Remaining work is the five follow-up beads listed above.
