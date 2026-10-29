# shotwright-746.56 — Verify

## Acceptance checklist

- [x] New manifest entries use the captured page's observed scale. `shot()` selects the locator owner when present, reads its viewport and `window.devicePixelRatio`, validates the scale, and writes both fields to the sidecar (`src/capture.ts:180-216`). Manifest validation accepts the finite positive value (`src/manifest.ts:244-250`).
- [x] A spec-created context with DSF 1 while the project page has DSF 2 is covered by a real Playwright test. It checks viewport, full-page, locator from the other context, project-page metadata, PNG dimensions, and raw byte equality (`test/fixtures/contract-consumer/shots/options.shots.ts:60-90`, `test/smoke/contract-consumer.test.ts:46-69`). The targeted smoke test passed.
- [x] Gallery chips, cards, and details use the recorded field, including distinct chips for equal logical viewports with different scales (`src/gallery/render.ts:52-65`, `src/gallery/render.ts:74-105`, `src/gallery/render.ts:154-163`, `test/unit/gallery-render.test.ts:105-129`). The generated gallery was opened and visually checked; its fixture run displayed `320×240 · Device scale factor 1 · 3` and `1440×960 · Device scale factor 2 · 1`.
- [x] Compare captions show each side's logical viewport and scale beside PNG pixel dimensions; absent values render as unavailable (`src/gallery/render-compare.ts:58-71`). The unit test checks different A/B scales, nulls, and unchanged identical verdicts (`test/unit/gallery-compare-render.test.ts:13-67`). A generated comparison was opened and visually checked.
- [x] Redteam amendment 2's three-engine empirical pin is complete (Firefox measured by the orchestrator re-run below). Original delegate note: Chromium and WebKit match at both scales. Firefox 157.0 was installed, but it exited before a page opened with `Could not find profile folder`, including with a precreated profile under `local/`. Firefox DPR and PNG scale therefore remain unmeasured. This is an environment/browser-launch limitation, not a measured DPR disagreement.

## Engine measurements

The throwaway `local/shotwright-746.56-engines.mjs` script uses a 320×240 viewport and a 120×60 CSS element. The last column is a locator on a page in a second context with the opposite DSF. PNG sizes below are decoded dimensions.

| Engine | Context DSF | Reported DPR | Viewport PNG | Element CSS | Locator PNG | Other-context locator PNG |
|---|---:|---:|---|---|---|---|
| Chromium | 1 | 1 | 320×240 | 120×60 | 120×60 | 240×120 (DSF 2) |
| Chromium | 2 | 2 | 640×480 | 120×60 | 240×120 | 120×60 (DSF 1) |
| WebKit | 1 | 1 | 320×240 | 120×60 | 120×60 | 240×120 (DSF 2) |
| WebKit | 2 | 2 | 640×480 | 120×60 | 240×120 | 120×60 (DSF 1) |
| Firefox | 1 | 1 | 320×240 | 120×60 | 120×60 | 240×120 (DSF 2) |
| Firefox | 2 | 2 | 640×480 | 120×60 | 240×120 | 120×60 (DSF 1) |

No engine's DPR disagreed with its PNG scale. The Firefox rows come from an orchestrator re-run of the same script outside the delegate sandbox, where Firefox launched normally (2026-10-29).

## Plan review and commands run

| Plan step | Evidence and result |
|---|---|
| 1 — capture observation, validation, cleanup, filtered shots | Implemented at `src/capture.ts:167-187` and `src/capture.ts:205-239`; unit pins at `test/unit/capture.test.ts:223-299`. Screenshot calls and direct byte write remain at `src/capture.ts:188-205`. |
| 2 — real consumer context and raw bytes | Implemented at `test/fixtures/contract-consumer/shots/options.shots.ts:60-90` and asserted at `test/smoke/contract-consumer.test.ts:46-69`; targeted smoke passed. |
| 3 — gallery grouping and visual check | Grouping remains the viewport/scale tuple at `src/gallery/render.ts:74-105`; test at `test/unit/gallery-render.test.ts:105-129`; generated UI inspected. |
| 4 — compare labels, nulls, verdict stability, visual check | Implemented at `src/gallery/render-compare.ts:58-71`; test at `test/unit/gallery-compare-render.test.ts:13-67`; generated UI inspected. |
| 5 — patch changeset and gates | Changeset at `.changeset/captured-page-scale.md:1-5`; gates and targeted smoke passed. The full three-engine amendment remains unverified because Firefox could not launch. |

Commands and relevant output (paths shortened to repository-relative names):

```text
pnpm exec playwright install firefox webkit
  Interrupted after no progress; the current Firefox revision was absent.
PLAYWRIGHT_BROWSERS_PATH=local/ms-playwright PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=15000 timeout 45s pnpm exec playwright install firefox
  Firefox 157.0 (v1555) downloaded successfully.
node local/shotwright-746.56-engines.mjs
  Chromium and WebKit: four measured rows above.
  Firefox: browserType.launch failed; Could not find profile folder.
pnpm run typecheck && pnpm run lint && pnpm run test
  typecheck passed; lint stopped at attw's npm pack because npm cache was unavailable.
npm_config_cache=local/npm-cache pnpm run typecheck && npm_config_cache=local/npm-cache pnpm run lint && npm_config_cache=local/npm-cache pnpm run test
  exit 0; typecheck passed; lint: All good!; test: 23 files passed, 653 tests passed, 1 skipped.
pnpm run build && pnpm exec vitest run test/smoke/contract-consumer.test.ts -t 'records the spec-created page and locator scale'
  exit 0; 1 test passed, 17 skipped.
CONTRACT_OUTPUT_DIR="$PWD/local/verify-output" node dist/cli.js run --config test/fixtures/contract-consumer/shots.config.ts -- --grep 'spec-created context scale follows'
  exit 0; 1 test passed, 4 shots; repeated to produce two runs for compare.
CONTRACT_OUTPUT_DIR="$PWD/local/verify-output" node dist/cli.js compare $(find local/verify-output -mindepth 1 -maxdepth 1 -type d | sort) --config test/fixtures/contract-consumer/shots.config.ts --output local/verify-compare.html
  exit 0; 4 identical pairs, report only.
```

## Observations and sign-off

The reported premise matched the pre-fix implementation documented in `docs/shotwright-746.56-plan.md:5-7`; the diff corrects the capture-side metadata source (`src/capture.ts:180-216`). No implementation gap was found against the acceptance criteria or numbered plan steps. The generated gallery and comparison were visually inspected from the local fixture runs. Unit and targeted browser tests pass, and the two engines that launched agree on DPR and PNG scale.

**PASS.** All acceptance criteria are met. Chromium, WebKit and Firefox each report a `devicePixelRatio` equal to PNG scale at DSF 1 and 2, including locators from a second context. The delegate's original FAIL was an incomplete check caused by a sandbox-only Firefox launch failure; the orchestrator re-run completed it. No source or test files were modified in this Verify phase.
