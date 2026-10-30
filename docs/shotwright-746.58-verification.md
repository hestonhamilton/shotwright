# shotwright-746.58 — verification

Phase: V. Implementation reviewed: `7f7bc06`. Verdict: **PASS**.

## Acceptance checklist

- [x] Each changed screenshot shows its pixel fraction in both the card heading and jump entry; changed artifacts say “Pixel fraction unavailable.” The exact pixel count and raw ratio remain below the screenshot (`src/gallery/render-compare.ts:19-31`, `src/gallery/render-compare.ts:149-152`, `src/gallery/render-compare.ts:167-175`, `src/gallery/render-compare.ts:242-247`). A crafted generated page showed 1/10000 as `<0.1%`, 9999/10000 as `>99.9%`, and only 10000/10000 as `100.0%`. The render test also pins a null ratio (`test/unit/gallery-compare-render.test.ts:73-108`).
- [x] The native select sorts changed screenshots by their unrounded ratio, with equal ratios resolved by original pair index, and puts changed artifacts after them. It restores the original order and leaves other state groups in place (`src/gallery/render-compare.ts:39-55`, `src/gallery/render-compare.ts:168-172`; `test/unit/gallery-compare-browser.test.ts:556-662`). The browser drive confirmed sorting, filtering in both orders, reload, and matching card/jump fragment sequences at 320, 390, and 1440 px in both color schemes (`local/shotwright-746.58/drive.log`).
- [x] Masking was deferred to `shotwright-746.66`, as the plan records (`docs/shotwright-746.58-plan.md:3`, `docs/shotwright-746.58-plan.md:66-69`). Read-only `bd show shotwright-746.66` confirmed the follow-up exists. The optional percentage threshold filter was explicitly declined in the plan (`docs/shotwright-746.58-plan.md:66-67`).

## Plan and amendment review

| Plan item | Evidence | Result |
| --- | --- | --- |
| Step 1, scanning labels and honest boundaries | One formatter feeds headings and jumps; counts remain visible (`src/gallery/render-compare.ts:19-31`, `src/gallery/render-compare.ts:149-175`, `src/gallery/render-compare.ts:242-247`). Render tests cover small, near-complete, exact-complete, null, and artifact cases (`test/unit/gallery-compare-render.test.ts:73-108`, `test/unit/gallery-compare-render.test.ts:269-277`). | Pass |
| Step 2, changed-group sort and stable navigation | Sort uses `pair-N` identity and a fragment-to-jump map; filter uses that map (`src/gallery/render-compare.ts:34-86`). Browser test covers distinct ratios, tie, artifact, later state, keyboard use, hash recovery, no-JS, and reload (`test/unit/gallery-compare-browser.test.ts:556-669`). Manual drive additionally checked each available chip after sorting and filter then sort (`local/shotwright-746.58/drive.log`). | Pass |
| Step 3, unchanged output contract and patch note | The implementation commit changes only compare rendering, two compare tests, and one changeset. JSON mapping and diff index remain in the generator (`src/gallery/generate-compare.ts:248-281`); the prior JSON hash is retained while only the HTML hash changed (`test/unit/gallery-compare-render.test.ts:210-214`). The changeset declares a patch and describes the UI affordance (`.changeset/compare-magnitude-triage.md:1-5`). | Pass |
| Amendments: false-100 guard, styled select, no added original-index attribute, reload default | Guards are in the formatter (`src/gallery/render-compare.ts:23-30`). The select has a 44 px minimum, focus outline, and wrapping (`src/gallery/render-compare.ts:252`); it starts disabled with “Current order” selected (`src/gallery/render-compare.ts:255`). Sorting derives the original index from `pair-N` (`src/gallery/render-compare.ts:39-46`). Manual reload restored that order (`local/shotwright-746.58/drive.log`). | Pass |

The bead's original premise is partly stale: raw `differentPixels / totalPixels` and ratio were already present on screenshot cards, and pairs were already grouped by state rather than left wholly in manifest order (`docs/shotwright-746.58-plan.md:7-9`; `src/gallery/render-compare.ts:149-152`; `src/gallery/compare-model.ts:69-80`, `src/gallery/compare-model.ts:300-310`). The remaining scanning and magnitude-order problem is addressed here.

## Commands run

```text
pnpm run typecheck && pnpm run lint && pnpm run test
  typecheck: pass
  lint: stopped in attw while its `npm pack` subprocess lacked a writable npm cache (exit 3)

npm_config_cache=local/npm-cache pnpm run typecheck && npm_config_cache=local/npm-cache pnpm run lint && npm_config_cache=local/npm-cache pnpm run test
  typecheck: pass
  lint: eslint, Prettier, build, publint, and attw pass
  test: 23 files passed; 658 tests passed, 1 skipped

node local/shotwright-746.58/drive.mjs > local/shotwright-746.58/drive.log 2>&1
  exit 0; all recorded browser checks passed

node local/shotwright-746.58/check-states.mjs > local/shotwright-746.58/check-states.log 2>&1
  exit 0; all seven state chips showed exactly their matching card and jump
```

`node_modules` was present before verification, so no install was needed. The `attw` report listed only its explicitly ignored legacy Node/CJS resolutions; its supported ESM and bundler resolutions were green.

## Browser observations

The crafted compare page and its sidecar are in `local/shotwright-746.58/compare/`. The drive script and complete check log are in `local/shotwright-746.58/`. Screenshots are `light|dark-{320,390,1440}-{default,sorted}.png` plus `no-js-390.png` there. I viewed `light-390-sorted.png`, `dark-1440-default.png`, `dark-320-sorted.png`, and `no-js-390.png`. The percentage label sits with the title, the select is readable and visibly focused, controls wrap on phones, the first card remains accessible, and no page overflow was measured. The no-JS screenshot retains the labels and a disabled select. Browser checks found no script, CSP-console, or external-network errors (`local/shotwright-746.58/drive.log`); the generated page uses inline CSS and script with a restrictive CSP (`src/gallery/render-compare.ts:202`, `src/gallery/render-compare.ts:249-255`).

The sidecar kept model order `tiny, mid, near, full, note, same`, with ratios `0.0001, 0.4, 0.9999, 1, null, 0` and diff names tied to indices 0–3 (`local/shotwright-746.58/drive.log`; `src/gallery/generate-compare.ts:268-281`). DOM sorting changed the card and jump order only; the gate stayed at five changed pairs on the generated page (`src/gallery/render-compare.ts:40-55`, `src/gallery/generate-compare.ts:265-281`). The main browser drive checked `changed`, `gated`, `identical`, and `all` chips. A separate crafted page checked every one of the seven state chips and confirmed its one visible card had the same fragment as its one visible jump (`local/shotwright-746.58/check-states.log`); existing render coverage names all seven verdict states (`test/unit/gallery-compare-render.test.ts:216-226`). The existing navigation test also checks hidden-fragment recovery (`test/unit/gallery-compare-browser.test.ts:499-525`), and the new sort test repeats it after sorting (`test/unit/gallery-compare-browser.test.ts:651-659`).

The reviewed commit adds no capture path, consumer Playwright resolution, masking, gate, or generator changes. No absolute host paths, LAN addresses, or personal data appeared in its changed public files. Verification artifacts remain under ignored `local/`; only this report is intended for the next commit.

## Sign-off

**PASS.** Acceptance criteria and the numbered plan, including amendments, are satisfied. The orchestrator can commit this verification report; this V pass made no source or test edits and did not commit, push, close, or write to Beads.
