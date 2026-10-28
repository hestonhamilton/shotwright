# Compare navigation and header research — shotwright-746.42

## Context and current state

The compare page is generated from the manifest-backed model, consistent with the design's self-contained, phone-friendly artifact and manifest contract (`docs/design.md:75-85`). It is for review rather than golden-diff approval (`CLAUDE.md:25-30`). The prior audit flags the dense compare header and absent filter/jump navigation (`docs/shotwright-746.40.1-research.md:81-85`). The A/B/Diff viewer and `pair-N` targets are **already present**; the audit's older claim that compare has no script is stale against this branch (`src/gallery/render-compare.ts:15-23`, `src/gallery/render-compare.ts:67-78`, `src/gallery/render-compare.ts:102-104`, `src/gallery/render-compare.ts:130-136`).

The header currently shows the run IDs, each run's status, a provenance banner, pairing key, pixel threshold, `includeAA`, `strict`, measured and ignored non-parity, gated count, and `fail-on-change`. A separate row prints all seven raw state names and counts, even zero counts (`src/gallery/render-compare.ts:107-136`). There is no compare search, state control, or jump list in the emitted header or pair stream (`src/gallery/render-compare.ts:107-155`). Pair badges use raw `shot`/`artifact` plus state strings and optional `ignored for gate` / `counted by gate` (`src/gallery/render-compare.ts:70-78`). The header's `gated pairs` is a predicate count, while CLI failure occurs only when `--fail-on-change` is set and that count is positive (`src/gallery/compare-model.ts:40-52`, `src/gallery/render-compare.ts:118-126`, `src/cli.ts:947`). Call the number **pairs counted by gate**, rather than implying the page always fails.

| State / current label | How produced | Counted by gate if not ignored? |
| --- | --- | --- |
| `identical` | Equal decoded image pixels or equal artifact bytes (`src/gallery/pixels.ts:98-107`, `src/gallery/compare-model.ts:270-276`) | No (`src/gallery/compare-model.ts:45-52`) |
| `similar` | Image pixels differ, but pixelmatch finds zero pixels outside the configured threshold (`src/gallery/pixels.ts:109-125`) | Only with `strict` (`src/gallery/compare-model.ts:45-52`) |
| `changed` | Image comparison finds different pixels, or artifact bytes differ (`src/gallery/pixels.ts:113-125`, `src/gallery/compare-model.ts:270-281`) | Yes (`src/gallery/compare-model.ts:45-52`) |
| `size-changed` | Image dimensions differ (`src/gallery/pixels.ts:85-97`) | Yes (`src/gallery/compare-model.ts:45-52`) |
| `added` | Pair exists only in B (`src/gallery/compare-model.ts:230-245`) | Yes (`src/gallery/compare-model.ts:45-52`) |
| `removed` | Pair exists only in A (`src/gallery/compare-model.ts:230-245`) | Yes (`src/gallery/compare-model.ts:45-52`) |
| `unreadable` | A/B read or PNG decode fails, including a late image hydration failure (`src/gallery/compare-model.ts:253-288`, `src/gallery/pixels.ts:44-77`, `src/gallery/generate-compare.ts:296-325`) | Yes (`src/gallery/compare-model.ts:45-52`) |

`ComparePairState` has seven states; `CompareVerdict` has five, since added/removed are pairing outcomes without an image verdict (`src/gallery/model.ts:608-625`, `src/gallery/compare-model.ts:230-245`). The count object includes all seven states, including zeroes (`src/gallery/compare-model.ts:59-67`, `src/gallery/compare-model.ts:306-310`). Ignores apply to selected artifact pairs during generation and suppress their gate contribution, but do not remove their state count or card (`src/gallery/generate-compare.ts:174-186`, `src/gallery/generate-compare.ts:224-241`, `src/gallery/render-compare.ts:74-78`). `measured non-parity` excludes identical/similar regardless of ignore or strict; `ignored non-parity` is the ignored subset; `gated` uses the predicate and therefore can include similar in strict mode (`src/gallery/render-compare.ts:118-126`, `src/gallery/compare-model.ts:45-52`). These values are not interchangeable.

Pairs are assembled by spec + name key: shots first, then artifacts, with A's insertion order followed by B-only keys. The final stable order ranks changed, size-changed, unreadable, added/removed, then identical/similar; ties retain assembly order. Added and removed share a rank; identical and similar share a rank (`src/gallery/compare-model.ts:69-81`, `src/gallery/compare-model.ts:221-251`, `src/gallery/compare-model.ts:300-310`). `pair-N` is assigned after that sort, and A/B/Diff image IDs derive from the same index (`src/gallery/render-compare.ts:22-23`, `src/gallery/render-compare.ts:67-75`, `src/gallery/render-compare.ts:139-153`). The streamed generator can change a state to unreadable during hydration before it writes the header, so navigation and filter counts must be derived from the finalized model and existing indexes without changing order (`src/gallery/generate-compare.ts:296-352`).

The main gallery uses 44px pill buttons with a persistent `aria-pressed` state, a wrapping desktop chip row and horizontally scrolling mobile row. Its filter script hides cards, computes a visible result count, and shows a recoverable zero-result state (`src/gallery/assets.ts:41-67`, `src/gallery/assets.ts:155-156`, `src/gallery/assets.ts:228-263`). Compare already allows one inline script and inline CSS under its meta CSP; images remain `data:` and connections are denied (`src/gallery/render-compare.ts:102-104`, `src/gallery/render-compare.ts:130-136`). A small inline filter script fits that policy; an external search service or fetched index does not (`src/gallery/render-compare.ts:130`). The viewer openers are disabled until their script binds them, which provides the model for no-JS filter controls (`src/gallery/render-compare.ts:23`, `src/gallery/render-compare.ts:67-68`, `src/gallery/viewer.ts:1-200`).

## Visual sample

Ran `pnpm build` (`package.json:41-42`), generated a compare page with ten shot pairs spanning all seven states using the fixture shape in `test/unit/gallery-compare-render.test.ts:13-70`, and viewed screenshots at 1280×800 and 390×844 in Chromium, following the browser setup in `test/unit/gallery-compare-browser.test.ts:11-51`. Local ignored artifacts: `local/shotwright-746.42-desktop.png`, `local/shotwright-746.42-mobile.png`, and `local/shotwright-746.42-sample/compare/a.vs.b.html`. In this sample the desktop header ends at 378px and first pair starts at 442px; mobile header ends at 492px and first pair starts at 635px. Seven verdict badges appear at both widths; no horizontal document overflow was observed. These are measurements of this synthetic fixture, not general layout limits. The mobile screenshot shows the pairing/settings and gate jargon occupying more initial space than the verdict navigation; that visual observation matches the header markup (`src/gallery/render-compare.ts:125-136`).

## Options

| Option | Benefit | Cost / constraint |
| --- | --- | --- |
| **Recommended: short outcome + state chips + native jump list** | Lead with pairs counted by gate and changed/other non-parity; put run/settings/provenance in a disclosure; offer the gallery's pill idiom for filtering and native `#pair-N` links for direct navigation. | A small inline script must keep chips, result count, and jump entries in sync; links to hidden cards must be avoided. Existing CSP permits it (`src/gallery/render-compare.ts:130`, `src/gallery/assets.ts:43-67`). |
| Compact header + jump list only | Works wholly without script and costs the least markup. | Many identical/similar pairs still fill the page; it does not satisfy the requested state filtering. Existing order only moves non-parity ahead of parity (`src/gallery/compare-model.ts:69-81`). |
| Search plus grouped verdict sections | Strongest way to find a named pair. | More controls and state logic, and grouping would disrupt the existing `pair-N` order/index contract (`src/gallery/render-compare.ts:139-153`). Excess for this P3 bead. |

## Recommendation

Keep the current pair order and IDs. Show a concise, plain-language summary with **pairs counted by gate**, changed, and remaining non-parity counts first; display only nonzero verdict counts in secondary detail, while preserving zero information in the machine sidecar (`src/gallery/render-compare.ts:118-136`, `src/gallery/generate-compare.ts:248-281`). Keep run status visible; place pairing key, threshold, `includeAA`, strict, ignored/measured counts, `fail-on-change`, and lengthy provenance in native `<details>` so they remain accessible without script (`src/gallery/render-compare.ts:115-136`). The summary must say what `strict` changes when active because similar can then count toward the gate (`src/gallery/compare-model.ts:45-52`).

Use one mutually exclusive chip set: All, Gated when its count is nonzero, and each nonzero state, with human labels such as “Size changed” and “Unreadable”. Gated is a cross-cutting view, not a verdict state; ignored pairs stay in All and their state view but leave Gated (`src/gallery/compare-model.ts:45-52`, `src/gallery/compare-model.ts:59-67`). Static chip totals describe the whole compare, while a separate “X of Y pairs shown” line describes the active view, matching the gallery's distinction (`src/gallery/assets.ts:228-263`, `src/gallery/render.ts:365-379`). Render chips disabled until the inline script binds, and render all pair cards and the jump list by default. Without JS, native details and links still work. A filtered view hides nonmatching pair cards **and their jump entries**; All restores both. A clear-filter control handles the zero-result case. A `<details>` jump list of links to `#pair-N`, labelled by spec/name and state, is usable without JavaScript and avoids making many links permanently occupy the initial viewport (`src/gallery/render-compare.ts:74-75`, `src/gallery/render-compare.ts:139-153`). Avoid links to hidden cards; MDN explicitly warns against fragment links to hidden targets (see prior art below). No extra data index or dependency is needed.

## Prior art and currency

All sources read 2026-10-28.

| Claim and implication | Source |
| --- | --- |
| `aria-pressed` describes a toggle button, and a fixed label should remain stable while pressed state changes; use the gallery's fixed chip labels. | [WAI-ARIA APG button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) |
| A same-page `href="#pair-N"` is native hyperlink navigation, and a page contents list is an established in-page navigation pattern; keep jump links as anchors. | [MDN anchor element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a), [WAI in-page navigation](https://www.w3.org/WAI/tutorials/page-structure/in-page-navigation/) |
| Linking to a hidden target is incorrect; hide matching jump entries together with filtered cards, with all entries present when scripts are off. | [MDN `hidden` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden) |
| A meta CSP can govern a static page, and the current `script-src 'unsafe-inline'` allows an inline filter script; retain the current source restrictions rather than adding network access. | [MDN CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP), [MDN `script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src) |
| Reusing the gallery's chip identification helps users recognize the same function across pages. | [WCAG consistent identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification) |

## Open questions for owner

1. Should the default show all pairs (recommended, preserving the current page) or start in the Gated view? This changes what a reviewer sees on first load and whether parity pairs are initially visible (`src/gallery/render-compare.ts:139-153`).
2. Should the compact summary say “Changed” for only the `changed` state (recommended), with other non-parity states listed separately, or use “Changes” as an umbrella term? The model distinguishes all seven states and the gate predicate crosses them (`src/gallery/compare-model.ts:45-67`).

Pending owner input, the plan assumes All by default and uses exact state labels. Neither choice changes compare semantics (`src/gallery/compare-model.ts:45-81`).

## Self-review

| Lens | Result |
| --- | --- |
| Measured or flagged | Pass: pixel positions and badge count come from the described synthetic Chromium sample; no throughput or accessibility conformance claim is inferred. |
| Derived-value semantics | Pass: state counts are exhaustive, gated is cross-cutting, ignored is a subset of non-parity, and visible count is defined for empty and filtered results (`src/gallery/compare-model.ts:45-67`, `src/gallery/render-compare.ts:118-129`). |
| Emergent structure | Pass: pair ordering, tie order, shot/artifact assembly, index-derived IDs, and jump cardinality are explicit (`src/gallery/compare-model.ts:69-81`, `src/gallery/compare-model.ts:300-310`, `src/gallery/render-compare.ts:139-153`). |
| Batch/concurrency | Pass: no shared mutation is proposed; per-page filter state acts only on the rendered DOM, and generation continues to stream pair sections (`src/gallery/render-compare.ts:139-153`). |
| Inherited constraints | Pass: self-contained artifact, CSP, disabled viewer controls, and late state changes were checked against this branch (`docs/design.md:75-85`, `src/gallery/render-compare.ts:23`, `src/gallery/render-compare.ts:130-136`, `src/gallery/generate-compare.ts:296-352`). |
