# shotwright-746.57 — Verification

Date: 2026-10-29. Phase: V. Verdict: **PASS**.

## Acceptance checklist

- [x] A byte-equal pair uses one labelled figure and one embedded PNG. The branch selects sharing by equal PNG data URIs, independently of the `identical` verdict (`src/gallery/render-compare.ts:145-156`). Decoded-pixel equality defines that verdict (`src/gallery/pixels.ts:98-107`). The four-case test proves that a pixel-identical but byte-distinct pair retains two PNGs, a changed pair retains three including its full diff, and a size-changed pair retains two (`test/unit/gallery-compare-render.test.ts:27-97`). The generated demo had two byte-equal pairs and nine embedded PNG URIs on HEAD versus eleven on `main`.
- [x] A/B labels, separate original download links, and all viewer modes work. The shared card keeps both side metadata and links (`src/gallery/render-compare.ts:80-93`); Inspect A/B points both sides at the shared image (`src/gallery/render-compare.ts:145-155`). Playwright opened the shared image alone, Inspect A/B, Side by side, Swipe, Onion skin, and Actual pixels at 390 px and 1440 px in light and dark. Both link targets matched their respective run PNG bytes. The changed pair's full diff opened at its natural width of 2880 px. Browser evidence is in `local/shotwright-746.57-verify/browser-results.json` and the `demo-*.png` screenshots in that directory. The automated browser test also covers these controls (`test/unit/gallery-compare-browser.test.ts:11-86`).
- [x] A static view works without JavaScript. At 390 px and 1440 px, Playwright loaded one shared image at natural width 2880 px and found both download links; screenshots: `local/shotwright-746.57-verify/demo-390-nojs.png` and `demo-1440-nojs.png`. The normal browser runs reported no page or console errors. The CSP source is unchanged (`src/gallery/render-compare.ts:234`), and the generated page still contains `img-src data:`. The original `<img>` remains in the static figure (`src/gallery/render-compare.ts:93`).
- [x] Compare JSON, verdicts, order, and CSP are unchanged. For both corpora, the generated JSON files were equal after normalizing only the expected diff filename stem (`main.diff-*.png` versus `head.diff-*.png`); their counts, pair sequence, and verdicts matched. The demo counts were three `identical` (including one byte-distinct pair), one `changed`, and one `size-changed`; the synthetic counts were 20 `identical` and 100 `changed`. The only implementation change is compare rendering (`git diff main...HEAD --stat`); comparison logic and JSON generation remain in `src/gallery/generate-compare.ts:235-280`.
- [x] Before/after sizes and byte-equal counts were measured on the demo and a **synthetic adopter-scale** corpus. Exact UTF-8 HTML byte counts:

  | Corpus | Pairs | Byte-equal | `main` bytes | HEAD bytes | Saved |
  |---|---:|---:|---:|---:|---:|
  | Demo PNGs, four behaviors plus one extra equal pair | 5 | 2 | 7,383,011 | 5,886,613 | 1,496,398 (20.27%) |
  | Synthetic adopter scale, demo PNGs and perturbed copies | 120 | 20 (16.7%) | 221,717,668 | 210,676,648 | 11,041,020 (4.98%) |

  The synthetic corpus reuses the five demo PNGs; 100 B files have a changed 20×20 pixel block. It is not consumer data or a prediction of actual consumer savings. Corpus construction and raw measurements are in `local/shotwright-746.57-verify/run.mjs` and the two `results.json` files. The older plan's page-wide SVG design was superseded by its final owner-decision section (`docs/shotwright-746.57-plan.md`, “Redteam rework and owner decision”).
- [x] Covered by tests. The new render test covers byte versus pixel identity, changed and size-changed pairs, links, JSON, and CSP (`test/unit/gallery-compare-render.test.ts:27-97`); the new browser test covers the static card and shared viewer (`test/unit/gallery-compare-browser.test.ts:11-86`). All quality gates passed.

## Commands run

```text
pnpm run build
  $ tsc -p tsconfig.build.json

cd local/shotwright-746.57-verify/main && ../../../node_modules/.bin/tsc -p tsconfig.build.json
  exit 0

node local/shotwright-746.57-verify/run.mjs
  demo: 5 pairs, 2 byte-equal, 7,383,011 → 5,886,613 bytes
  synthetic: 120 pairs, 20 byte-equal, 221,717,668 → 210,676,648 bytes

node local/shotwright-746.57-verify/browser.mjs
  390/1440 px × light/dark: one shared card image; both links match; same pair sources; side, swipe, onion and Actual pixels work; no errors
  390/1440 px without JS: one rendered shared image and two links

npm_config_cache=local/npm-cache pnpm run typecheck && npm_config_cache=local/npm-cache pnpm run lint && npm_config_cache=local/npm-cache pnpm run test
  typecheck: passed
  lint, Prettier, publint, attw: passed
  Test Files 23 passed (23); Tests 658 passed | 1 skipped (659)
```

## Observations

The bead premise still matches `main`: separate A and B `<img>` elements each embed the data URI, and changed pairs embed a full diff (`git show main:src/gallery/render-compare.ts`, `shotMedia` and `renderPair`). The branch changes only the byte-equal presentation (`src/gallery/render-compare.ts:73-94,145-159`). A pixel-identical, byte-distinct demo pair has the `identical` verdict but retains both images, so verdict identity does not control sharing.

The demo uses full-size screenshots and has 40% byte-equal pairs; its 20.27% reduction should not be applied to larger comparisons. The synthetic corpus has the requested roughly 17% byte-equal rate and saves 4.98%. The visual screenshots were inspected at phone and desktop widths; the shared image, labels, pair surfaces, and no-JS static card were legible in both color schemes.

## Sign-off

**PASS.** Every acceptance criterion is met by the reviewed HEAD. No implementation files were changed during V. The only tracked addition from this phase is this verification report; the generated comparisons, baseline export, scripts, and screenshots remain under ignored `local/`.
