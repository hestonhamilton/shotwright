# Artifact wording verification

**Bead:** `shotwright-746.45` · **Phase:** V · **Date:** 2026-10-28 · **HEAD:** `1edb73b`

## Method and evidence

Built the CLI, then captured a real five-shot demo run with `--video --trace` (`2026-10-28T23-42-24_79f2`). A second real run with `--only about --video --trace` produced one shot (`2026-10-28T23-42-39_3b05`). The built CLI compared them into the custom path `local/verify-746.45/compare.html`: four removed, one identical. This is the two-run approach, not the fixture compare approach. The first run's gallery is `shots-output/2026-10-28T23-42-24_79f2/gallery.html`. Both runs passed their two Playwright tests. Chromium opened both generated pages as `file:` pages at 1280×900; it also opened the gallery at 390×844. A built gallery renderer generated single-shot absent and broken-reference pages from a copy of a real shot's manifest and PNG. Measurements are in `local/verify-746.45/browser-results.json`.

Chromium captured five screenshots under `local/verify-746.45/`. I opened and looked at each: `gallery-desktop.png`, `gallery-mobile.png`, `compare-desktop.png`, `absent.png`, and `broken.png`. The gallery section, warning, and downloads were visible at both desktop and mobile widths; mobile body scroll width equalled the 390 px viewport. The one-sided comparison showed only Download A and its location warning. The absent state showed two count-neutral labels. The broken state showed a reference badge and an unavailable-file explanation. No page errors were recorded.

## Acceptance checklist

| Plan acceptance criterion, as amended | Verdict and evidence |
| --- | --- |
| Every gallery video/trace label describes linked files or the review action; group caption does not infer a test title or identity. | **PASS.** The real gallery shows “Videos and traces,” “Referenced by 2 shots in this spec,” “Download video,” “Download trace,” and the grouping sentence. A single-shot broken-reference fixture shows “Referenced by 1 shot in this spec”; the null fixture shows “No video referenced” and “No trace referenced.” The three-shot grouping test asserts one pair and one download per kind (`test/unit/gallery-render.test.ts`). Screenshots: `gallery-desktop.png`, `absent.png`, `broken.png`. |
| Gallery and compare warnings describe the actual relative-file requirement, including custom compare placement. | **PASS.** The real gallery says to keep it in its run folder so available links work. The custom-output compare says to keep the comparison page in the same position relative to the run folders it links to. Its one-sided removed pair had one Download A, no Download B, and a relative href resolving to an existing PNG. The corresponding one-sided custom-output unit case pins the wording (`test/unit/gallery-compare-render.test.ts`). Screenshots: `gallery-desktop.png`, `compare-desktop.png`. |
| Present, absent, and unreadable references are distinguished in copy and tests. | **PASS.** The real gallery's two video and two trace files are present, linked and displayed as references. The single-shot null fixture renders “No video referenced” and “No trace referenced” with no video element. The broken fixture renders “Video file unavailable: video/missing.webm” and “Video unavailable: video/missing.webm,” with no video element; the badge still says references. The unit test asserts the missing/unreadable diagnostic. Screenshots: `gallery-desktop.png`, `absent.png`, `broken.png`. |
| A real generated video/trace section remains playable and downloadable, while pages retain inline resources and CSP. | **PASS.** Chromium found two visible native videos with controls in the real gallery. On the first, it played for at least 1.2 seconds: `readyState=4`, `currentTime=1.2073`, `duration=2.16`, `paused=false`, and no media error. Its video and trace download hrefs resolved to existing files. The gallery had one inline style, two inline scripts, and one CSP meta tag; compare had one inline style, one inline script, and one CSP meta tag. Both had zero page errors. Screenshots: `gallery-desktop.png`, `gallery-mobile.png`, `compare-desktop.png`. |
| Updated tests pass; touched HTML-tag regexes use case-insensitive word boundaries. | **PASS.** The chained typecheck, lint, and unit suite exited 0: 23 files passed, 638 tests passed, one skipped. The touched video-tag assertions use `/<video\b/gi` or `/<video\b/i`; the compare article test uses `/<article\b.../i` (`test/unit/gallery-render.test.ts`, `test/unit/gallery-compare-render.test.ts`). |

## Redteam findings resolution

| Finding | Resolution and pin |
| --- | --- |
| Plan redteam 1: section intro falsely implies shared or present files for a single shot or no-file group. | Count-neutral grouping sentence, visible in `absent.png` and `gallery-desktop.png`; implemented in `1188900`, amended in `1edb73b`. The one-shot null test in `test/unit/gallery-render.test.ts` pins the empty state. |
| Plan redteam 2: badge promises links when every reference is broken. | Badge says “Video or trace references in this run”; the broken fixture shows it without a download. Implemented in `1188900`; broken-reference unit case asserts it. |
| Plan redteam 3: “N screenshots” overcounts when PNGs are missing or views are filtered. | Caption says “Referenced by N shots in this spec.” Implemented in `1188900`; the missing-PNG plus filtered-view test asserts a two-shot count. |
| Plan redteam 4: run-facts rename must name its source and account for Playwright trace passthrough. | “Shotwright video flag” and “Shotwright trace flag” appear in the real gallery. Implemented in `1188900`; the passthrough unit case pins the Off value and smoke assertions pin both labels. |
| Plan redteam 5: gallery location warning implies unavailable links will work. | Warning qualifies “available video and trace links”; visible in `gallery-desktop.png` and `broken.png`. Implemented in `1188900`; the grouped-pair unit test pins the sentence. |
| Plan redteam 6: extra demo run would be disproportionate. | The plan's focused generated-page check is pinned by `test/unit/gallery-browser.test.ts` in `1188900`. This Verify request specifically required two real runs for compare; both were generated and measured here. |
| Implementation review 1: single-shot labels imply multiple shots. | `1edb73b` changed the null labels to “No video referenced” and “No trace referenced,” and the accessible video name to “Recorded video.” The single-shot null unit case and `absent.png` pin the result. |
| Implementation review 2: compare location sentence is false for one-sided pairs or custom output. | `1edb73b` refers only to folders linked by the page. The one-sided custom-output unit case and real `compare-desktop.png` pin it; the measured Download A href resolves, with no Download B. |
| Implementation review 3: placeholder video browser test cannot establish playback; capitalization mismatch. | `1edb73b` narrowed `test/unit/gallery-browser.test.ts` to markup, controls, accessible name, and visible downloads and aligned both pages' “File location: Keep” capitalization. Manual playback on a real WebM above supplies the separate playback proof. |

## Commands run and gate output

Commands ran from the worktree. Full logs are in `local/verify-746.45/`; excerpts omit printed host paths.

```text
npm_config_cache="$PWD/local/npm-cache" bash -o pipefail -c 'pnpm run typecheck && pnpm run lint && pnpm run test'   exit 0
  typecheck: build and tsc --noEmit passed
  lint: Prettier “All matched files use Prettier code style!”; publint “All good!”; ESM checks green
  test: 23 files passed; 638 passed, 1 skipped
pnpm build                                                          exit 0
pnpm run demo:shots --video --trace                                  exit 0; 2 passed, 5 shots
pnpm run demo:shots --only about --video --trace                     exit 0; 2 passed, 1 shot
node dist/cli.js compare shots-output/2026-10-28T23-42-24_79f2 shots-output/2026-10-28T23-42-39_3b05 --config demo/shots.config.ts --output local/verify-746.45/compare.html
                                                                    exit 0; removed 4, identical 1
node local/verify-746.45/browser.mjs                                 exit 0; five screenshots, playback measured
npm_config_cache="$PWD/local/npm-cache" pnpm run smoke               exit 0; 3 files, 56 passed
  consumer shots:install timed out invoking playwright install chromium; suite used existing browser cache
```

## Observations and sign-off

The generated section uses native video controls and keeps one artifact pair per spec. The compare warning is visible on each one-sided pair and accurately names relative placement. Visual inspection found no clipping in the artifact sections or warning at the measured desktop and mobile widths. The real gallery's native video was black in the initial screenshot before playback; playback was confirmed separately by Chromium's media state and time advance. Smoke passed using the existing browser cache after its consumer installation probe timed out. No source or test files were changed in Verify.

**Overall verdict: PASS.** All five amended acceptance criteria, the full quality gates, and smoke passed. No source, test, commit, or Beads write occurred in Verify.
