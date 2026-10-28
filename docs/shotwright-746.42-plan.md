# Compare header and navigation plan — shotwright-746.42

## Goal

Make a generated compare page readable and navigable when it has many pairs, while retaining the existing model order, `pair-N` anchors, A/B/Diff viewer, self-contained HTML, and gate semantics (`src/gallery/compare-model.ts:45-81`, `src/gallery/render-compare.ts:67-78`, `src/gallery/render-compare.ts:130-153`). The page remains a human review artifact (`CLAUDE.md:25-30`). This plan assumes the initial view is All pending the owner choice recorded in `docs/shotwright-746.42-research.md`.

## Numbered implementation steps

1. **Reshape the header and count presentation in `src/gallery/render-compare.ts`.** Keep run IDs and A/B status visible. Lead with an explicit “N pairs counted by gate” and nonzero changed/other non-parity summary; do not label a gate count as a failure unless `failOnChange` is active. Put provenance, pairing key, threshold, `includeAA`, strict, measured/ignored counts, and `fail-on-change` in native `<details>` with a plain-language summary. Show only nonzero verdict badges in a secondary row, with human-facing labels; the sidecar's complete count object stays unchanged (`src/gallery/render-compare.ts:107-136`, `src/gallery/generate-compare.ts:248-281`). Handle zero pairs with the existing message (`src/gallery/render-compare.ts:136`). Pin the strict-mode wording to `isGatedPair`, where similar joins the gate only under strict, and preserve ignored-pair behavior (`src/gallery/compare-model.ts:45-52`).

2. **Add state controls and jump navigation in `src/gallery/render-compare.ts`.** Render one chip set, using the main gallery's 44px pill and `aria-pressed` idiom: All, Gated if positive, and one chip for each nonzero state (`src/gallery/assets.ts:43-67`, `src/gallery/render.ts:365-379`). Render chips as `disabled` until a new inline filter script binds, following the viewer opener convention (`src/gallery/render-compare.ts:23`, `src/gallery/viewer.ts:94-97`). Give each pair safe static state/gated data and a matching `#pair-N` entry in a native `<details>` jump list. Labels include spec, name, and human state; escape model strings with `escapeHtml` as existing pair headings do (`src/gallery/render-compare.ts:74-78`). Keep entries in the already sorted `model.pairs` order; derive IDs from `entries()` and do not sort a second time (`src/gallery/compare-model.ts:300-310`, `src/gallery/render-compare.ts:139-153`). Render All and all jump entries when JavaScript is absent. Use inline CSS within the existing style block; wrap chips on mobile so their availability is evident (`src/gallery/render-compare.ts:130-136`).

3. **Bind filter behavior in the existing inline script path in `src/gallery/render-compare.ts`.** Select one active chip at a time. On selection, set `aria-pressed`, hide pair cards and their corresponding jump entries by the same predicate, and update “X of Y pairs shown” from actual visible cards. All restores every pair and jump entry; Gated uses the rendered `isGatedPair` result, not a list of state names (`src/gallery/compare-model.ts:45-52`). Static chip totals remain whole-model counts. Provide a clear-filter control for a zero-result view and keep the existing zero-pair message distinct. Preserve one inline script, `default-src 'none'`, `img-src data:`, `connect-src 'none'`, and no external resources (`src/gallery/render-compare.ts:102-104`, `src/gallery/render-compare.ts:130-136`). If the URL fragment points to a pair hidden by a later filter action, clear or replace that fragment before hiding it; direct `#pair-N` load starts in All. No network or storage is needed.

4. **Add focused assertions and view the UI.** In `test/unit/gallery-compare-render.test.ts`, extend the seven-state fixture and add assertions for zero-free visible badges, precise gated/strict/ignored totals, escaped jump labels, one unique href per pair matching its article ID and model order, disabled controls, and unchanged `compare.json` counts. Update the expected HTML digest only; the JSON digest should remain stable (`test/unit/gallery-compare-render.test.ts:13-70`, `test/unit/gallery-compare-render.test.ts:95-150`). In `test/unit/gallery-compare-browser.test.ts`, add a mixed-state page and assert initial All, chip totals and `aria-pressed`, filtered visible/result/jump counts, Gated excluding ignored and including similar only in strict mode, native link scroll to the matching pair, no hidden jump destinations, and All restoration. In a no-JS context assert all cards and links remain visible and chips stay disabled, alongside the existing A/B/Diff viewer/no-network checks (`test/unit/gallery-compare-browser.test.ts:11-101`). Run `pnpm run typecheck && pnpm run lint && pnpm run test` (`package.json:41-47`). Render a multi-state page, view at 1280×800 and 390×844 in light and dark modes, and record screenshots/observations in verification, honoring the repo's viewed-UI rule (`CLAUDE.md:107-108`).

## Exact acceptance criteria

- The first compare viewport at 390×844 shows run IDs/status, the gate count, and the state navigation without requiring the reviewer to read raw threshold/`includeAA`/pairing settings. Detail remains available without script (`src/gallery/render-compare.ts:115-136`).
- Visible verdict badges contain only states with count greater than zero; every state with a positive count is represented once, and the sidecar still contains all seven state keys (`src/gallery/compare-model.ts:59-67`, `src/gallery/compare-model.ts:306-310`, `src/gallery/generate-compare.ts:265-281`).
- All is selected on load and all pair cards are visible. Every pair has exactly one working jump href to its existing unique `pair-N` article, in model order, and every model pair keeps the same A/B/Diff IDs (`src/gallery/render-compare.ts:22-23`, `src/gallery/render-compare.ts:67-75`, `src/gallery/render-compare.ts:139-153`).
- Selecting a state shows exactly pairs in that state; selecting Gated shows exactly pairs for which `isGatedPair` is true. The visible count and jump entries match visible cards. Ignored changed pairs remain available under Changed and All; similar enters Gated only with strict (`src/gallery/compare-model.ts:45-52`).
- With JavaScript disabled, every pair and native jump link remains usable, while filter buttons remain disabled; A/B/Diff previews and download links remain present (`src/gallery/render-compare.ts:23`, `src/gallery/render-compare.ts:67-78`, `test/unit/gallery-compare-browser.test.ts:90-96`).
- Generated compare remains one self-contained HTML page with no external script/style/image fetches and no CSP violations; existing A/B/Diff viewer browser checks stay green (`src/gallery/render-compare.ts:102-104`, `src/gallery/render-compare.ts:130-136`, `test/unit/gallery-compare-browser.test.ts:39-99`).

## Risks, deterministic pins, and rollback

| Assumption / risk | Deterministic pin | Rollback |
| --- | --- | --- |
| Gate and state overlap correctly, including strict similar and ignored artifacts (`src/gallery/compare-model.ts:45-52`, `src/gallery/generate-compare.ts:224-241`). | Steps 1 and 4 use mixed-state strict/non-strict and ignored-artifact fixture assertions against `isGatedPair`. | Revert summary/filter derivation together; leave model and sidecar unchanged. |
| Index-based links match the final streamed output after a late unreadable transition (`src/gallery/generate-compare.ts:296-352`). | Step 4 asserts href/article bijection on a generated page whose image fails hydration, plus final header/chip counts. | Build navigation only from finalized model during header emission; do not renumber cards. |
| Filtered navigation never links to a hidden card. | Step 4 browser assertion checks each visible jump target is visible after every chip selection and after All restoration. | Remove dynamic jump pruning only together with filters; native All jump list remains valid. |
| Mobile controls and disclosure fit without horizontal page overflow. | Step 4 records 390×844 and 1280×800 screenshots plus geometry/no-overflow assertions. | Use wrapping chip layout and shorter labels; retain the native details list. |
| Inline filtering preserves CSP and no-JS behavior (`src/gallery/render-compare.ts:130-136`). | Step 4 browser console/request checks with scripts on/off and static disabled-state assertions. | Remove the filter script and chips as a unit; keep static summary and native jump list. |

No concurrent or persistent mutation is added: generation writes the current page and sidecar; filter state lives in one browser document (`src/gallery/generate-compare.ts:345-369`, `src/gallery/render-compare.ts:139-153`). No new dependency or data schema is proposed.

## Acceptance mapping

| Acceptance | Steps |
| --- | --- |
| Compact, truthful header and nonzero counts | 1, 4 |
| State and Gated chips with synchronized visible count | 2–4 |
| Pair jump links preserve order and work without JS | 2–4 |
| Self-contained CSP, existing viewer, and mobile visual review | 3–4 |

## Deliberately out of scope

Swipe/onion overlay and synchronized zoom belong to shotwright-746.43. This plan adds no viewer modes or image comparison behavior (`src/gallery/render-compare.ts:67-78`). It also does not add text search, change verdict or gate logic, reorder pairs, change sidecar format, or add a dependency (`src/gallery/compare-model.ts:45-81`, `src/gallery/generate-compare.ts:248-281`).

## Open questions for owner

1. Initial filter: All (planned) or Gated? The current page presents all pairs (`src/gallery/render-compare.ts:139-153`).
2. Compact count wording: “Changed” for only the changed state (planned) or a broader “Changes” total? The model has seven distinct states (`src/gallery/compare-model.ts:59-67`).

## Self-review

| Lens | Result |
| --- | --- |
| Measured or flagged | Pass: viewport sizes are acceptance fixtures; no performance estimate is presented. |
| Derived-value semantics | Pass: chip totals are static whole-model counts; visible count is filtered cardinality; Gated is the predicate count, including strict similar and excluding ignored (`src/gallery/compare-model.ts:45-52`). |
| Emergent structure | Pass: one article and one jump entry per final sorted pair; index and order remain fixed (`src/gallery/compare-model.ts:300-310`, `src/gallery/render-compare.ts:139-153`). |
| Batch/concurrency | Pass: DOM state is per page; generation uses the existing ordered stream and final header path (`src/gallery/generate-compare.ts:296-352`). |
| Inherited constraints | Pass: self-contained CSP, disabled-before-binding pattern, and viewed-UI requirement are pinned in Steps 2–4 (`src/gallery/render-compare.ts:23`, `src/gallery/render-compare.ts:130-136`, `CLAUDE.md:107-108`). |

## Owner-question resolution (orchestrator, 2026-10-28)

Both open questions take the recommended answer; neither changes compare semantics. Default view is **All**. The summary uses exact state labels: "Changed" means only the `changed` state.

## Redteam disposition (2026-10-28)

1. **Report-only runs can imply an active gate — accepted, fix now.** Without `--fail-on-change` the CLI is report-only (`src/cli.ts:448`). Step 1's summary says "N pairs would count toward the gate" when `failOnChange` is off, and "N pairs counted by gate" only when it is on; Step 4 tests both.
2. **Hiding provenance can bury a reason to doubt the comparison — accepted.** Keep a short visible provenance status (e.g. environments differ / incomplete, `src/gallery/provenance.ts:10`) in the header; only field-level detail moves into the disclosure.
3. **Final state order is not always true — accepted; premise corrected.** Sorting happens before streaming (`src/gallery/compare-model.ts:306`), and hydration can later turn a parity pair unreadable without re-sorting (`src/gallery/generate-compare.ts:305`). The research's ranking claim holds only at sort time. Step 4's late-failure test asserts index and jump order are unchanged and the late pair is counted under Unreadable.
4. **Clear-filter empty state is unreachable — accepted, removed.** Only positive-count chips render, so no chip can yield zero cards. Drop the clear-filter control and filtered-zero branch from Step 3; keep the existing zero-pair message.
