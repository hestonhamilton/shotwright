# Compare header and navigation verification — shotwright-746.42

**Phase:** V · **Date:** 2026-10-28 · **HEAD:** `3bf8b8b`

## Method and evidence

The built CLI captured two real demo runs with `pnpm run demo:shots` (five shots each), generated a gallery for the first run, and compared the runs. The real compare had five identical pairs, so it cannot exercise the state filters. For those checks I used the mixed-state fixture approach allowed by the plan: copied the existing seven-state scratch inputs under `local/verify-746.42/fixture/`, added one ignored changed artifact, and invoked the **built CLI** for report-only and `--fail-on-change` compare pages. The latter exited 1 as designed after writing its page. The fixture has 11 final pairs: identical 2, similar 1, changed 4, size-changed 1, added 1, removed 1, unreadable 1. One changed artifact is ignored. These are generated HTML pages, not hand-written mockups.

Chromium opened the generated pages as `file:` URLs. `local/verify-746.42/browser.mjs` measured the four light/dark and desktop/mobile views, exercised every filter and jump link, checked a no-JavaScript context, and opened an A/B/Diff viewer image. Its measurements are in `local/verify-746.42/browser-results.json`. I **viewed each** screenshot: `fixture-desktop-light.png`, `fixture-desktop-dark.png`, `fixture-mobile-light.png`, `fixture-mobile-dark.png`, `fixture-nojs-mobile.png`, and `demo-mobile.png`, all in `local/verify-746.42/`. No product source or test file was changed in V.

## Acceptance checklist

| Plan acceptance, as amended | Verdict and evidence |
| --- | --- |
| The first 390×844 viewport shows run IDs/status, gate count, and state navigation; detailed settings remain available without script. | **PASS.** In both mobile themes, the header shows `a vs b`, A/B passed, `8 pairs would count toward the gate`, Changed 4, Other non-parity 4, and visible filter chips. Threshold, `includeAA`, and pairing key sit in the native “Run and comparison details” disclosure. The no-JS page retains that disclosure. The first card starts at y=789.17 px, inside the 844 px viewport. The real demo page with long run IDs also shows its first card at y≈688 px (`demo-mobile.png`). |
| Only positive-count states appear in the state navigation, once each; the sidecar retains all seven keys. | **PASS.** The real demo compare renders only `All 5` and `Identical 5`; its sidecar has identical 5 and six zero-valued state keys. The mixed fixture renders each of its seven positive states once. The duplicate verdict badge row is absent. |
| All is selected on load; every pair is visible and has one working, ordered `#pair-N` jump to a unique article; A/B/Diff IDs remain. | **PASS.** Chromium found 11 visible cards, `aria-pressed=true` on All, and the exact href sequence `#pair-0` through `#pair-10`, each resolving to one article. Clicking a jump set the fragment and reached its card. Generated image/viewer IDs retain the `pair-N-a`, `pair-N-b`, and `pair-N-diff` shape; the viewer opened a data image and closed with Escape. The late-unreadable generation test pins unchanged pair indices and the final Unreadable count. |
| State and Gated filters show exactly matching pairs; visible count and jump entries agree; ignored changed stays under Changed/All and strict similar joins Gated. | **PASS.** Chromium measured state card/jump counts of 2/2, 1/1, 4/4, 1/1, 1/1, 1/1, and 1/1 in state order. Strict Gated showed 8 cards and 8 jumps, including the Similar card and excluding the ignored Changed artifact. Each visible jump targeted a visible card. The result count updated from rendered cards. Filtering away the current fragment cleared it; changing the hash to a hidden pair restored All and revealed the target. The non-strict case is pinned in `test/unit/gallery-compare-browser.test.ts`. |
| Without JavaScript, all cards and native jumps remain usable, filters stay disabled, and previews/downloads remain present. | **PASS.** The no-JS context showed all 11 cards and all 11 jump entries; every filter button stayed disabled. Clicking the last jump set `#pair-10`. Embedded image previews and download links were present. `fixture-nojs-mobile.png` was viewed. |
| Generated compare remains self-contained with one inline script, no external fetches/CSP violations, and working A/B/Diff viewer. | **PASS.** The fixture page contains one inline script, zero external scripts/styles, and 20 image elements with 20 data-image sources. Browser console errors, page errors, and HTTP requests were all zero. The existing A/B/Diff viewer browser suite passed in the full unit run; Chromium additionally opened an embedded viewer image from the built page. |

## Visual observations

At 1280×800 the first pair begins at y=586.39 px in both themes; at 390×844 it begins at y=789.17 px in both themes. Filter controls end at y=470.39 and y=673.17 respectively. Document scroll width equals viewport width (1280 and 390), so neither size has horizontal overflow. The screenshots show readable text and controls in light and dark palettes. At mobile size, only the top of the first fixture card appears in the initial viewport; this satisfies the explicit “begins inside” criterion. No contrast ratio was measured or claimed.

## Redteam findings resolution

| Finding | Resolution and pin |
| --- | --- |
| Plan redteam 1: report-only summary could imply an active gate. | **Resolved** in `3bf8b8b`: report-only summary, chip, pair badge, strict sentence, and detail disclosure use conditional “would” wording. Active `--fail-on-change` uses “counted by gate.” Built CLI pages and the render/browser tests pin both modes. |
| Plan redteam 2: hiding provenance could bury a reason to doubt the comparison. | **Resolved** in `d778738`: visible status remains above the disclosure; field detail is inside it. The fixture showed “Render environment details incomplete”; the real demo showed “No known render environment difference.” Render snapshot/test pins the status. |
| Plan redteam 3: hydration can change a pair to Unreadable after sorting. | **Resolved** in `d778738`: final header/chip counts are emitted after preparation, while `pair-N` indices and order stay fixed. `test/unit/gallery-compare-generate.test.ts` pins a disappeared image becoming Unreadable in final JSON, HTML, counts, and gate; the href/article bijection is pinned in the render/browser tests. |
| Plan redteam 4: a clear-filter empty state is unreachable. | **Resolved** in `d778738` by rendering only positive-count state chips and omitting the unreachable control. Real demo page showed only Identical among states; sidecar retained zeros. |
| Implementation review: gate count diverged from rendered `isGatedPair` cards. | **Resolved** in `3bf8b8b`: header and Gated chip count derive from the same predicate as card data. `test/unit/gallery-compare-render.test.ts` checks generated-page equality, including strict similar and ignored artifacts; Chromium counted eight `data-compare-gated=true` cards and eight visible Gated cards. |
| Implementation review: report-only wording in disclosure and strict sentence. | **Resolved** in `3bf8b8b`; render test pins both exact strings and built report-only page displays them. |
| Implementation review: hashchange to a pair hidden by a filter. | **Resolved** in `3bf8b8b`; browser test and this Chromium run changed the hash to a hidden Added pair, observed All selected, and saw the target revealed. |
| Implementation review: broader redesign. | **Declined** as outside this bead. No code or test pin applies; the scoped header/navigation acceptance was measured here. |
| Orchestrator visual review: duplicate verdict badge row. | **Resolved** in `d778738`; the real demo has one positive-state chip and no `.counts` row, and the render/browser tests assert its absence. |
| Orchestrator visual review: “Would gate” / “would count toward gate” in report-only mode. | **Resolved** in `3bf8b8b`; built report-only page and tests cover summary, chip, badge, detail, and strict sentence. |
| Orchestrator visual review: result count needs `role=status`. | **Resolved** in `d778738`; Chromium measured the role on `#compare-result-count`, and the browser/render tests pin it. |

## Commands run

All commands ran from the worktree. Output excerpts omit absolute run paths and tool banners. `local/npm-cache/` was used for lint's pack step.

```text
npm_config_cache="$PWD/local/npm-cache" pnpm run typecheck && npm_config_cache="$PWD/local/npm-cache" pnpm run lint && npm_config_cache="$PWD/local/npm-cache" pnpm run test
  exit 0; typecheck/build passed; lint: Prettier clean, publint “All good!”, attw bundler and node16 ESM green
  Test Files 23 passed (23); Tests 632 passed | 1 skipped (633)
pnpm run demo:build && pnpm run demo:shots
  exit 0; demo build passed; 2 Playwright tests passed, 5 shots
pnpm run demo:shots
  exit 0; 2 Playwright tests passed, 5 shots
timeout 3 node dist/cli.js gallery <first-demo-run> --config demo/shots.config.ts
  exit 124 after “serving”; generated shots-output/<first-demo-run>/gallery.html
node dist/cli.js compare <first-demo-run> <second-demo-run> --config demo/shots.config.ts --output local/verify-746.42/demo-compare.html
  exit 0; identical 5, other states 0, gated 0; report only
node dist/cli.js compare local/verify-746.42/fixture/a local/verify-746.42/fixture/b --config demo/shots.config.ts --output local/verify-746.42/fixture-report.html --strict --ignore notes.shots.ts/ignored
  exit 0; 8 measured non-parity, 1 ignored, 8 gated; report only
node dist/cli.js compare local/verify-746.42/fixture/a local/verify-746.42/fixture/b --config demo/shots.config.ts --output local/verify-746.42/fixture-gated.html --strict --ignore notes.shots.ts/ignored --fail-on-change
  exit 1 as expected; page written, 8 gated; fail-on-change gate failed
node local/verify-746.42/browser.mjs
  exit 0; 11 cards; all filter/jump/no-JS assertions passed; 0 console errors and 0 HTTP requests
```

The first fixture CLI attempt exited 2 because the scratch artifact had a null `testId`; changing that scratch manifest field to a string made both CLI runs above succeed. No product file was edited.

## Sign-off

**Overall verdict: PASS.** All six amended plan criteria pass. The real demo capture verifies the built package and gallery path; the mixed-state fixture rendered through the built CLI supplies the states the unchanged demo cannot produce. No source or test edits, git commit, or `bd` write occurred in V.
