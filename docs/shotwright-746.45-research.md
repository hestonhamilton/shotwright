# shotwright-746.45 — gallery artifact wording research

Read and observed: 2026-10-28. Scope is the gallery's video/trace section and the related relative-file warning on both generated pages. This is research only; no source, test, or bead state changed.

## Context and mechanism

The gallery is a review artifact, not an assertion gate (`docs/design.md:30-38`), and its screenshot images and CSS/JS stay inline under a meta CSP while video uses a relative file URL (`src/gallery/render.ts:439-450`, `src/gallery/render.ts:501-506`). Compare likewise keeps its screenshots and script inline (`src/gallery/render-compare.ts:195-201`). The public repository cannot acquire host paths or personal data (`CLAUDE.md:16-33`).

The brief's instruction to read `src/gallery/model.ts` for group formation needs a correction: that file loads and caches artifact references by relative path and gathers shots by spec (`src/gallery/model.ts:552-593`); **`artifactGroups` in `src/gallery/render.ts:174-195` forms the displayed groups**. Within each spec, it keys each shot by the exact pair `[video path or null, trace path or null]`, counts matching shots, and retains first-seen order. A pair of null paths also forms one group. File availability does not affect the key (`src/gallery/render.ts:180-194`; `src/gallery/model.ts:566-580`). A displayed group therefore means that its screenshots **reference the same video/trace path pair**. It does not establish one test: grouping does not inspect `testId` or title (`src/gallery/render.ts:180-194`; `src/gallery/model.ts:41-46`). Playwright records video and trace per test run in this demo, but that is an observed producer pattern, not the grouping contract (`demo/shots.config.ts:4-14`; `src/gallery/render.ts:180-194`).

“Sibling” in the UI means a file reached through a relative URL, not an embedded file. The gallery emits video/trace paths relative to `gallery.html` in the run folder (`src/gallery/render.ts:35-45`, `src/gallery/render.ts:197-220`, `src/gallery/render.ts:439-445`); compare builds paths from its page to the A and B run folders (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:74-94`). The current gallery warning says “beside the run directory,” but the gallery is generated **inside** that directory (`src/gallery/generate.ts:22-37`; `src/gallery/render.ts:217`). Compare can also be written to a caller-chosen location, so its current “beside” wording is too rigid (`src/gallery/render-compare.ts:74-94`; `src/cli.ts:369-419`). “Video not captured” is stronger than the model knows: a null manifest reference means **no video is linked to those shots**, independent of the run flag (`src/gallery/model.ts:41-46`, `src/gallery/model.ts:566-580`; `src/gallery/render.ts:205-210`, `src/gallery/render.ts:365`, `src/gallery/render.ts:477-478`).

## Real gallery observation

I built the package and ran the demo with `node dist/cli.js run --video --trace --config demo/shots.config.ts`, with the repository's `node_modules/.bin` on `PATH` so the demo web server command could find Vite (`package.json:48-51`; `demo/shots.config.ts:4-14`; `src/cli.ts:78`, `src/cli.ts:144-148`). The first attempt without that PATH adjustment failed before capture because `vite` was not found; the second and the full run passed. The full run produced five shots across two specs; the three home shots all referenced one video path and one trace path. The generated page rendered one video group for them, and Chromium reported the video ready to play. Screenshot: `local/shotwright-746.45-artifacts-shared-video-trace.png` (ignored local evidence). A filtered two-shot run also produced video and trace links; screenshot: `local/shotwright-746.45-artifacts-video-trace.png`. These observations agree with the key and count logic in `src/gallery/render.ts:180-194` and the native video markup in `src/gallery/render.ts:218-229`.

## Inventory and proposed copy

“Condition” means when the page emits the text. The replacement is a recommendation for the later implementation, not an edit here. Dynamic values are shown in braces. This inventories the literal and generated user-visible copy about videos, traces, artifact groups, relative files, and data artifacts; general screenshot and compare verdict wording remains outside this bead.

| Current string and source | What appears / condition | What is true | Proposed wording | Test assertion |
|---|---|---|---|---|
| `Group artifacts` — `src/gallery/render.ts:257` | Spec-header jump link; every spec with shots | Jumps to that spec's video/trace section, including all-null groups (`src/gallery/render.ts:252-264`). | `Videos and traces` | None found |
| `Deduplicated artifacts for {spec}` — `src/gallery/render.ts:260` | Aside accessible name; every spec with shots | Names the same section (`src/gallery/render.ts:252-264`). | `Videos and traces for {spec}` | None found |
| `Deduplicated artifact set(s)` — `src/gallery/render.ts:261` | Section heading; singular/plural based on pair count | Pair count is a rendering detail (`src/gallery/render.ts:180-194`). | `Videos and traces` | None found |
| `Exact manifest paths are shown once per shared video/trace pair.` — `src/gallery/render.ts:262` | Intro; every spec with shots | Exact path pairs render once, including null/null (`src/gallery/render.ts:180-194`). | `Files linked from several screenshots appear once here.` | None found |
| `Video not captured` / `Trace not captured` — `src/gallery/render.ts:208-209` | One all-null group for a spec or subset of its shots | Neither file is referenced for those shots (`src/gallery/render.ts:180-210`). | `No video linked to these screenshots` / `No trace linked to these screenshots` | `test/unit/gallery-render.test.ts:408-415` |
| `shared by {n} shots by identical manifest path; test title unavailable` — `src/gallery/render.ts:212` | Caption for each non-null pair | Exactly {n} shots in this spec reference that pair; the renderer did not derive a title (`src/gallery/render.ts:180-194`). | `Linked from {n} screenshot(s)` | `test/unit/gallery-render.test.ts:371-386` |
| `Download sibling video` / `Download sibling trace` — `src/gallery/render.ts:197-202` | Download action for an available referenced file | Relative URL to a file in this run folder (`src/gallery/render.ts:35-45`, `src/gallery/render.ts:197-202`). | `Download video` / `Download trace` | Trace: `test/unit/gallery-render.test.ts:385` |
| `Broken {video/trace} reference: {path}` — `src/gallery/render.ts:199-200` | Missing/unreadable referenced file, in place of its download action | Reference exists but `containedFile` fails (`src/gallery/model.ts:492-505`). | `{Video/Trace} file unavailable: {path}` | Video: `test/unit/gallery-render.test.ts:389-405` |
| `Shared captured video` — `src/gallery/render.ts:220` | Video element accessible name if video is available | Video path may be linked from one or several shots (`src/gallery/render.ts:180-194`). | `Recorded video for linked screenshots` | None found |
| `Video unavailable: {path}` — `src/gallery/render.ts:221` | Video player fallback for an unavailable reference | File failed loading/containment check (`src/gallery/model.ts:492-505`). | Keep: `Video unavailable: {path}` | `test/unit/gallery-render.test.ts:399` |
| `Sibling-file warning:` + `requires this gallery beside the run directory` — `src/gallery/render.ts:11`, `src/gallery/render.ts:217` | Warning per non-null gallery group | Relative media links need the gallery in its run folder (`src/gallery/render.ts:35-45`, `src/gallery/render.ts:197-220`; `src/gallery/generate.ts:22-37`). | `File location: Keep this gallery in its run folder to play or download video and trace files.` | `test/unit/gallery-render.test.ts:386` |
| `Sibling artifacts grouped by identical manifest path` — `src/gallery/render.ts:464` | Header badge when any shot has a non-null video or trace path (`src/gallery/render.ts:365`) | Says references exist, not that files are readable (`src/gallery/model.ts:492-505`). | `Video or trace links in this run` | None found |
| `Video and trace absent in this run` — `src/gallery/render.ts:464` | Header badge when no shot has either reference (`src/gallery/render.ts:365`) | Does not prove no files were recorded or that no data/failure artifacts exist (`src/gallery/render.ts:288-346`). | `No videos or traces linked to screenshots` | `test/unit/gallery-render.test.ts:415`; `test/smoke/cli.test.ts:610` |
| `Video flag` / `Trace flag`, `On` / `Off` — `src/gallery/render.ts:477-478` | Run-facts fields; always | These are manifest capture settings, not file-presence indicators (`src/gallery/render.ts:365`, `src/gallery/render.ts:477-478`). | `Video recording requested` / `Trace recording requested`, `Yes` / `No` | `test/smoke/cli.test.ts:606-607` |
| `Sibling video and trace links require this gallery beside the run directory.` — `src/gallery/render.ts:501` | Footer, even with no video/trace references | Relative links work only while gallery/run relative placement is preserved (`src/gallery/render.ts:35-45`, `src/gallery/render.ts:197-220`). | `To use video and trace links, keep this gallery in its run folder.` | None found |
| `Data artifacts for {spec}`, `Data artifacts`, `Download full file` — `src/gallery/render.ts:325-328` | Separate named data files, if manifest has entries for spec | These are independently captured data artifacts, not video/trace groups (`src/gallery/render.ts:288-328`; `src/gallery/model.ts:546-554`). | Keep; section is outside the group-wording change. | None found |
| `Failure evidence`, `No copied files` — `src/gallery/render.ts:331-346` | Failure files section when failures exist | Not video/trace grouping (`src/gallery/render.ts:331-346`). | Keep. | None found |
| `Sibling-file warning: Each download link requires this gallery beside the run directory for its side.` — `src/gallery/render-compare.ts:93-95` with `src/gallery/render.ts:11` | Every screenshot pair and every data-artifact pair (`src/gallery/render-compare.ts:91-120`) | Relative downloads target the A/B run folders; custom output is allowed (`src/gallery/render-compare.ts:74-94`; `src/cli.ts:369-419`). | `File location: Keep this comparison page and both run folders in their current relative locations to use download links.` | `test/unit/gallery-compare-render.test.ts:166`, `test/unit/gallery-compare-render.test.ts:228-230` |
| `Download A` / `Download B` — `src/gallery/render-compare.ts:66`, `src/gallery/render-compare.ts:88` | Screenshot and data-artifact download links when that side exists | A/B are identified in the pair and header (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:83-90`, `src/gallery/render-compare.ts:118-120`). | Keep; naming is concise and accurate. | `test/unit/gallery-compare-render.test.ts:161-165`, `test/unit/gallery-compare-render.test.ts:179-230` |
| `{artifact} · {state}`, `MIME: {type}`, `Diff shown pretty-printed...`, `no matching screenshots or artifacts to compare` — `src/gallery/render-compare.ts:114-120`, `src/gallery/render-compare.ts:201` | Data-artifact pair badge/detail, JSON diff note, and empty-pair state respectively | These concern compare's separate manifest data artifacts and byte comparison (`src/gallery/compare-model.ts:222-310`; `src/gallery/render-compare.ts:114-120`). | Keep; changing compare verdict vocabulary exceeds this P3 bead. | `test/unit/gallery-compare-render.test.ts:179-230` covers pair links |

## Options

| Approach | Tradeoff |
|---|---|
| **Recommended — copy-only changes in both renderers** | Small diff; corrects false location/absence implications and implementation terms, while retaining current grouping and controls (`src/gallery/render.ts:180-264`; `src/gallery/render-compare.ts:93-120`). |
| Rename and restructure groups around test titles | Could explain the common Playwright producer pattern, but the current group key does not establish test identity and v1 may have no title (`src/gallery/render.ts:180-194`; `src/gallery/model.ts:41-46`). Requires model/UI work beyond P3 polish. |
| Keep technical wording and add a glossary | Avoids changing tests, but leaves the first visible label and heading implementation-led (`src/gallery/render.ts:257-262`). |

## Recommendation

Use the copy-only option. Name what a reviewer can do (“Videos and traces”; “Download video”), say **linked from screenshots** where the manifest is the evidence, and state the relative-location requirement directly. Avoid claiming one test, actual capture absence, or file readability from the presence of a manifest reference (`src/gallery/render.ts:180-220`, `src/gallery/render.ts:365`; `src/gallery/model.ts:492-505`).

## Prior art and currency

Read 2026-10-28. [Playwright recording options](https://playwright.dev/docs/test-use-options) document video/trace capture as test options and describe modes that record or retain files differently. This supports keeping run flags distinct from linked-file presence; the local distinction is visible in `src/gallery/render.ts:365`, `src/gallery/render.ts:477-478`.

Read 2026-10-28. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) documents a downloaded trace ZIP as an opening path. “Download trace” is thus a useful action label for the existing ZIP link (`src/gallery/render.ts:197-202`), without promising an inline viewer.

Read 2026-10-28. [MDN video element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video) documents native controls and `preload="metadata"`; the gallery uses both (`src/gallery/render.ts:218-220`). The copy change needs no player or CSP change.

Read 2026-10-28. [MDN relative links](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Creating_links) explains that links resolve against the document location; [MDN download attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a) explains the same-origin/data restrictions. These support a location warning about preserving the existing page-to-file layout (`src/gallery/render.ts:35-45`; `src/gallery/render-compare.ts:74-94`).

Read 2026-10-28. [W3C Understanding 2.4.6](https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels) says headings and labels should describe topic or purpose. “Videos and traces” describes the section that `src/gallery/render.ts:260-264` actually renders more directly than its grouping algorithm.

## Open questions for the owner

1. Is “Videos and traces” the preferred shared heading/link, or would “Recordings and traces” better match reviewer vocabulary? Recommendation: “Videos and traces,” which matches the two file types displayed (`src/gallery/render.ts:197-235`).
2. Should the run-facts labels change with this bead? Recommendation: yes, because “flag” plus “On” can be mistaken for file presence while the badge is reference-based (`src/gallery/render.ts:365`, `src/gallery/render.ts:477-478`).

## Self-review

- Measured or flagged: pass; the five-shot and three-shot observations came from the recorded demo run, and no performance estimate is used.
- Derived-value semantics: pass; null references, group cardinality, and availability are distinguished (`src/gallery/render.ts:180-210`; `src/gallery/model.ts:492-505`).
- Emergent structure: pass; first-seen ordering and spec boundary are named (`src/gallery/render.ts:180-194`; `src/gallery/model.ts:583-593`).
- Batch/concurrency: not applicable to copy-only rendering.
- Inherited constraints: pass; self-contained pages, CSP, review purpose, and public-path rule were checked against `src/gallery/render.ts:439-506`, `src/gallery/render-compare.ts:195-201`, `docs/design.md:30-38`, and `CLAUDE.md:16-33`.
