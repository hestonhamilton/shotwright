# shotwright-746.57 — Compare image payload deduplication plan

Date: 2026-10-29. Phase: P. Scope: the owner's item 1 in `docs/shotwright-746.57-research.md` §“Redteam outcome and owner decision.” The encoding, pair-directory and prune decisions belong to 746.68–70 (`docs/shotwright-746.57-research.md`, same section).

## Goal

A copied compare HTML must display every available A, B and full diff image while serializing each distinct PNG payload once. Preserve A/B identity, both sibling-file download links, the single viewer, Inspect A/B together, side-by-side, swipe, onion skin and Actual pixels. Keep the `img-src data:` CSP and current compare JSON, verdicts, pair order, output paths and publication sequence (`src/gallery/render-compare.ts:67-71,116-132,207`; `src/gallery/viewer.ts:40-46,109-163,257-285,317-354`; `src/gallery/generate-compare.ts:188-198,268-280,345-389`). This is a render/storage change, not a comparison policy change: verdicts stay a review aid with optional gating (`docs/design.md:30-36`; `docs/adr/0022-compare-verdicts-are-review-aid.md:14-16`).

The research's older preview, relative-image, pair-directory and prune proposals are superseded for this bead by the owner decision (`docs/shotwright-746.57-research.md`, §“Redteam outcome and owner decision”). The self-contained image promise and embedded-image hosting rationale remain relevant (`docs/adr/0005-gallery-single-file-inline-originals.md:20-24,48-51`; `docs/adr/0025-off-github-run-storage-is-an-opt-in-s3-compatible-publish.md:61-65`). Run publication remains atomic and `latest` means the last passed run (`docs/design.md:71-87`); capture PNG bytes stay the direct Playwright screenshot buffer (`src/capture.ts:188-205`).

## Premise re-check and image consumers

The premise is current: `shotMedia` writes each side's `shot.image.dataUri` into its card `<img>`, including two identical sources for an identical pair; each diff's full PNG is a separate data URI (`src/gallery/render-compare.ts:58-71,116-118`). The generator hydrates both sides and the diff per pair, writes a streamed body, then clears their in-memory payloads (`src/gallery/generate-compare.ts:291-340`). A and B labels and separate download links come from the two figures, with sibling run-file hrefs; they must remain separate even if payload IDs match (`src/gallery/render-compare.ts:67-71,79-81,130-132`). Artifact downloads are a different path and remain untouched (`src/gallery/render-compare.ts:83-99,119-122`).

| Consumer | Current source and required behavior |
|---|---|
| Card / no JavaScript | The A, B and Diff figures hold inline `<img>` elements; disabled viewer buttons leave those images and download links usable (`src/gallery/render-compare.ts:67-71,116-118,130-132`). |
| Single viewer / Actual pixels | An opener resolves its card image by ID; `showSource` copies that image's URI into a dialog `<img>`, whose natural dimensions drive fit and Actual pixels (`src/gallery/viewer.ts:199-211,257-285,307-315`). |
| Inspect A/B together | The pair button names the two card image IDs; the viewer copies their `src` values into two dialog images (`src/gallery/render-compare.ts:123-128`; `src/gallery/viewer.ts:317-345`). |
| Pair modes | Side-by-side shows two `<img>` panes; swipe and onion skin reuse the pair sources in overlay `<img>` nodes, with natural dimensions and top-left alignment (`src/gallery/viewer.ts:109-163,317-349`). |
| Downloads | A and B links point to their original sibling PNG files and stay independently labeled; a copied page retains embedded viewing but those links still require the run folders (`src/gallery/render-compare.ts:67-71,98-99`). |

## Design

Use one *declarative SVG definition* per unique PNG byte sequence in the HTML. Each definition is an `<image id="payload-<sha256>" href="data:image/png;base64,...">` with its intrinsic PNG width and height, inside an inert, zero-size `<svg><defs>`. Each A/B/diff figure contains its own labeled `<svg role="img" aria-label="..." viewBox="0 0 width height"><use href="#payload-<sha256>"></use></svg>`. Keep the existing figure labels, button IDs, data-name, alt-equivalent text and sibling download anchors. A and B may reference the same definition, but they remain distinct figures and viewer actions. Emit a definition at the first encounter in pair order, before its first `<use>`, then retain only the digest key in a page-wide `Set`; do not retain a page-wide URI map. A PNG's encoded bytes map one-to-one to its base64 text, so SHA-256 over the PNG buffer (or its canonical base64 text) can key the payload; use the same algorithm for screenshots and diffs. A same-byte image reused across *different* pairs must also deduplicate. Digest IDs contain only hex and are safe for fragment references. Keep escape rules on human text and attributes (`src/gallery/render-compare.ts:5,67-71,116-132`).

This preserves a visible static card with JavaScript disabled: `<use>` resolves the embedded definition without script, and the download links stay ordinary anchors. A local Chromium probe using the current CSP rendered a definition-backed card with JavaScript both enabled and disabled; the probe is exploratory, so the implementation must pin this in browser tests across the supported test browsers. The dialog can resolve a card's `data-payload-id` to its definition's data URI only when opened, then continue using ordinary dialog `<img>` elements. Limit the change to compare-specific viewer source resolution; gallery's existing `data-original` path must continue to work (`src/gallery/viewer.ts:234-237,257-273,307-320`). Once resolved, the pair-mode and Actual pixels calculations keep using image natural dimensions (`src/gallery/viewer.ts:109-163,199-211,317-354`). Avoid placing image data in executable script or CSS. The CSP remains byte-for-byte the current compare policy (`src/gallery/render-compare.ts:207`).

The generator's pair callback currently performs late read-failure accounting before rendering and releases each hydrated payload afterward (`src/gallery/generate-compare.ts:296-340`). The shared definition registry belongs to the renderer's stream; it emits only successful image payloads after preparation. Unreadable and missing sides retain existing placeholders and never acquire a dangling `<use>` (`src/gallery/render-compare.ts:58-66,123-129`; `src/gallery/generate-compare.ts:310-335`). Keep the body spool, HTML-last publish, same-stem stale-file pruning and sidecar construction intact (`src/gallery/generate-compare.ts:291-389,390-419`). Empty comparisons have no definitions. Definition order follows first use; pair order and counts are untouched (`src/gallery/render-compare.ts:200-213,216-232`).

## Demo size baseline and target

A fresh compare of the existing five-shot demo run against an ignored copy with `form-filled.png` changed produced four identical pairs and one changed pair. Command shape: `node dist/cli.js compare <demo-run-A> <demo-run-B> --config demo/shots.config.ts --output <ignored-output>.html`. The generated page is **5,809,699 bytes**. A scan of complete `data:image/png;base64,` tokens found **11 references, seven distinct payloads, and 2,215,844 repeated URI bytes**. Subtracting only repeated URI bytes gives **3,593,855 bytes**, or **38.1% smaller**; this is a *lower-bound payload projection*, not a generated after artifact. SVG definitions, `<use>` wrappers and IDs add bytes; the actual after size must be measured from the implemented generator in I/V. The earlier research's changed-pair page was 5,998,401 bytes with 2,215,756 repeated PNG data-URI bytes (37%); its different changed PNG explains why that overall byte count differs (`docs/shotwright-746.57-research.md`, §“Measured demo evidence” and §“Redteam outcome and owner decision”). Neither demo ratio predicts the adopter's 124-shot result.

## Steps and deterministic pins

1. **Shared compare payload rendering (one PR-sized implementation).** Extend the compare renderer's per-page stream to emit one data-URI SVG definition per SHA-256 content key and use fragment references in the A/B/diff cards (`src/gallery/render-compare.ts:58-71,101-132,136-160,216-232`). Feed prepared pair payloads through the existing generator callback without changing comparison logic, ordering, JSON or HTML-last publication (`src/gallery/generate-compare.ts:268-280,291-389`). **Pin:** generated-HTML tests extract data-URI payloads, compare their decoded SHA-256 multiset with the input's unique PNG bytes, assert every digest occurs once, every `<use>` resolves, and record `Buffer.byteLength` before/after for the same fixture. Explicit cases: an identical pair has one embedded PNG referenced by A and B; a changed pair has its distinct A, B and full diff each once; shared payloads across pairs deduplicate; missing/unreadable and empty pairs emit no broken references. Assert compare JSON equality, pair order, counts, verdicts, output paths and unchanged CSP. Existing generator/render tests provide the insertion points (`test/unit/gallery-compare-render.test.ts:190-201`; `test/unit/gallery-compare-generate.test.ts:268-279`).
2. **Viewer and browser behavior (same implementation PR).** Add compare-card source resolution to the shared viewer without altering gallery source handling (`src/gallery/viewer.ts:234-237,257-285,307-354`). Keep buttons initially disabled and enable them only after usable source resolution. **Pin:** extend the existing browser suite to verify static A/B/diff render with JavaScript disabled, no external image request or CSP violation, keyboard/open/close, separate downloads, single-viewer Actual pixels, and Inspect A/B in side-by-side, swipe and onion skin at differing dimensions and DSF. The existing browser suite already exercises those controls (`test/unit/gallery-compare-browser.test.ts:11-75,173-198,244-318`); add a real rendered-pixel assertion for `<use>` rather than checking only DOM presence. Run `pnpm run typecheck && pnpm run lint && pnpm run test` (`CLAUDE.md:25-32`).
3. **Measured verification and release note (V artifact and same PR changeset).** Generate the same demo compare before and after and record exact HTML byte counts, data-URI counts, SHA-256 uniqueness, percent change and test command in `docs/shotwright-746.57-verification.md`. The orchestrator supplies the adopter's 124-shot A/B corpus; generate its comparison with both versions and record the same measurements and output pair counts. View the generated page at phone and desktop widths, with JavaScript enabled and disabled, including a changed pair's diff and all viewer modes; record observations. Add a `patch` Changeset describing smaller self-contained compare pages, consistent with the existing compare presentation fixes under Patch Changes (`CHANGELOG.md:21-26`) and the required Changesets release flow (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-25,36-39`). **Pin:** V records the generated artifacts' actual `stat`/`Buffer.byteLength` values and screenshot or inspection evidence, rather than a demo extrapolation.

## Risks and rollback

- SVG `<use>`/`<image>` rendering could differ across browsers or be constrained by CSP. Step 2's no-JS rendered-pixel and CSP tests are the gate. If the supported browsers fail, stop and revise this plan before selecting a script-only representation; preserve the original inline renderer as rollback (`src/gallery/render-compare.ts:58-71,116-118,207`; `test/unit/gallery-compare-browser.test.ts:11-38`).
- A content registry might accidentally retain full data URIs, defeating streaming memory behavior. Step 1 retains digest keys only and tests a multi-pair corpus; the current release callback bounds hydrated payload lifetime to one pair (`src/gallery/generate-compare.ts:296-340`).
- A digest collision is theoretically possible. SHA-256 is an identifier for PNG bytes, not a verdict input; a forced-collision fixture can be accommodated by verifying byte equality or a disambiguating suffix if this becomes a practical concern. This does not change the decoded-pixel comparison (`src/gallery/generate-compare.ts:216-223,268-280`).
- Moving the data URI from `<img src>` to an SVG definition changes the viewer's source lookup and accessibility tree. Step 2 pins dialog behavior, A/B labels, image names, rendered static cards and downloads (`src/gallery/render-compare.ts:67-71,123-132`; `src/gallery/viewer.ts:257-273,317-354`).
- Rollback is a revert of the renderer and compare-specific viewer adapter; leave JSON, PNG siblings, paths, compare options and publication logic unchanged (`src/gallery/generate-compare.ts:188-198,244-280,345-389`).

## Considered and declined

| Approach | Reason |
|---|---|
| Relative original PNGs | Break copied-page and single-object review; requires a different CSP and belongs outside this bead (`docs/adr/0005-gallery-single-file-inline-originals.md:20-24`; `docs/adr/0025-off-github-run-storage-is-an-opt-in-s3-compatible-publish.md:61-65`). |
| JavaScript-only template or store | A disabled-script page would lose visible cards, unlike the present HTML (`src/gallery/render-compare.ts:67-71,116-118`). |
| Re-encode or downscale screenshots | Changes the image-byte and original-download contract; assigned to 746.68 (`docs/shotwright-746.57-research.md`, §“Redteam outcome and owner decision”). |
| Pair directories or retention | Output-path and deletion contracts are assigned to 746.69 and 746.70; same-stem regeneration already prunes stale compare files (`src/gallery/generate-compare.ts:188-198,390-419`). |
| New runtime image dependency | PNG data and Node hashing already suffice (`src/gallery/model.ts:472-489`; `src/gallery/generate-compare.ts:253-254`). |

## Acceptance mapping

| Acceptance bullet | Steps / evidence |
|---|---|
| Each distinct payload once; A/B labels, both downloads, viewer and pair modes preserved | 1's byte-uniqueness and structure tests; 2's browser tests (`src/gallery/render-compare.ts:58-71,116-132`; `src/gallery/viewer.ts:257-285,317-354`). |
| Demo and adopter 124-shot before/after size | Baseline above; 1's byte-count fixture; 3's exact generated-artifact measurements. The adopter corpus is supplied in V. |
| Page viewed at phone and desktop widths | 3's V walkthrough, with enabled and disabled JavaScript (`CLAUDE.md:107-108`; `test/unit/gallery-compare-browser.test.ts:11-38`). |
| Covered by tests | 1's generated-HTML and invariant tests; 2's browser controls, CSP and no-JS rendering tests. |

## Open questions

- **Supported-browser SVG behavior:** local Chromium exploratory rendering succeeded, but the full supported-browser/no-JS/CSP result is unresolved. Recommendation: use the Step 2 browser gate before accepting SVG as the implementation shape; revise the plan if it fails.
- **Adopter measurement:** the 124-shot corpus is absent from this worktree (`docs/shotwright-746.57-research.md`, §“Summary and context”). Recommendation: orchestrator supplies an access-controlled local copy for V, and V reports actual bytes without committing any consumer data.

## Self-review

| Lens | Result and pin |
|---|---|
| Measured or flagged | Demo baseline measured; after size is explicitly a projection. Steps 1 and 3 pin actual bytes. |
| Derived-value semantics | Unique means SHA-256 of complete PNG payload bytes across A, B and diff for the whole page; empty pages have zero definitions. Step 1 pins both. |
| Emergent structure | Definitions appear once in first-use order, may have multiple `<use>` references, and every reference resolves. Step 1 pins cardinality and connectivity. |
| Batch and concurrency | The stream is one render per compare; no new shared state or file mutation. Existing HTML-last replacement stays intact. Step 1 pins generated sidecar/path invariants (`src/gallery/generate-compare.ts:291-389`). |
| Inherited constraints grounded | The existing CSP, self-contained image requirement and gallery viewer path are identified above; Step 2 pins actual browser behavior. |

## Redteam rework and owner decision (2026-10-29)

A plan redteam returned **rework**; the owner chose the minimal version. This section **replaces the SVG `<defs>`/`<use>` design and steps 1–2 above**; step 3's measurement and changeset stand.

**Value, restated.** On the adopter's reported compare (124 shots: 102 changed, 1 size-changed, 21 identical; 168 MB), about 350 images are embedded (248 sources plus 102 diffs). At most 21 source payloads are redundant within identical pairs: about 6% if diffs average the same size, a ceiling of 8.5% if diffs are negligible, so roughly 10–14 MB. It may be less, because pixel-identical PNGs can have different bytes. The demo's 38% is not an adopter target.

**Minimal design.**
1. **Share only byte-equal pairs (fix now).** `identical` means equal decoded pixels (`src/gallery/pixels.ts:99`), not equal PNG bytes. Render one shared image only when the A and B PNG **bytes** are equal; byte-distinct pairs, even pixel-identical ones, keep both embedded sources as today.
2. **One ordinary `<img>`.** A byte-equal pair renders one figure labelled "A and B identical (same file)", using the existing `<img>` markup and `.images img` sizing (`src/gallery/render-compare.ts:210`), with both original download links kept. Inspect A/B together, Actual pixels, Side by side, Swipe and Onion skin point both sides at that one source. The viewer's source lookup (`src/gallery/viewer.ts:257`) needs at most a small change, and no change for the gallery.
3. **Nothing page-wide.** No SHA registry, cross-pair deduplication, SVG, or collision handling. Revisit only if a measurement shows material cross-pair repeats.
4. **Pins.** A generated-HTML test: a byte-equal pair embeds one data URI; a pixel-identical but byte-different pair still embeds two; changed and size-changed pairs are unchanged; compare JSON, pair order, counts, verdicts and CSP are byte-for-byte unchanged. Browser tests: the shared figure renders with JavaScript disabled, and every viewer mode works with both sides on one source.
5. **Measurement gate.** V records before/after bytes on the demo and on an adopter-scale comparison, plus the count of byte-equal pairs. Acceptance is restated on the bead to match this scope.
