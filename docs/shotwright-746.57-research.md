# shotwright-746.57 — Output size research

Date: 2026-10-29. Phase: R. External sources below were read 2026-10-29.

## Summary and context

The adopter's 124-shot figures are the bead's reported evidence, not a corpus available in this worktree. The current code confirms the mechanism: a run holds PNGs under `shots/` and gallery generation embeds each PNG as base64 (`src/gallery/model.ts:472-489`, `src/gallery/render.ts:123-143`); compare embeds both sides and each changed diff (`src/gallery/generate-compare.ts:300-310`, `src/gallery/render-compare.ts:58-71`, `src/gallery/render-compare.ts:116-117`). Compare also writes the diff PNG as a sibling and names it in JSON (`src/gallery/generate-compare.ts:222`, `src/gallery/generate-compare.ts:268-280`). Thus a diff is stored twice too. The default pair output is flat under `compare/` (`src/gallery/generate-compare.ts:188-198`), as ADR 0009 chose (`docs/adr/0009-compare-artifact-output-path.md:34-48`). The code already prunes stale *files of the same compare stem* on regeneration (`src/gallery/generate-compare.ts:390-419`); the bead's “nothing ever cleans output” premise is true of old runs and distinct compare pairs, not same-pair stale diffs. Run enumeration excludes `compare/` (`src/runs.ts:42-47`), but there is no run retention in creation or listing (`src/runs.ts:42-83`, `src/runs.ts:96-113`).

The existing contract is stronger than “an HTML with previews”: ADR 0005 says a copied `gallery.html` contains every original screenshot and supports full review (`docs/adr/0005-gallery-single-file-inline-originals.md:20-30`, `docs/adr/0005-gallery-single-file-inline-originals.md:49-51`). The viewer's Actual pixels uses the image URI from the `data-original` link (`src/gallery/viewer.ts:200-207`, `src/gallery/viewer.ts:258-273`), and the gallery CSP permits `img-src data:` only (`src/gallery/render.ts:438-444`). ADR 0025 specifically steers toward embedded previews and against relative overview images because single-object hosting and GitHub's single-file artifact view matter (`docs/adr/0025-off-github-run-storage-is-an-opt-in-s3-compatible-publish.md:61-65`). The design still requires artifacts for human review, a thin consumer, atomic run publication, and `latest` as the last passed run (`docs/design.md:25-27`, `docs/design.md:71-82`, `src/runs.ts:116-133`). Capture writes Playwright's screenshot buffer directly to the PNG file (`src/capture.ts:188-205`); re-encoding is gallery/compare work only (`src/gallery/model.ts:472-489`, `src/gallery/pixels.ts:37-77`).

## Measured demo evidence

Commands: `pnpm run build`, then `scripts/ci/shots.sh` twice, then `node dist/cli.js compare <run-A> <run-B> --config demo/shots.config.ts`. This follows the CI shot set of five captures (`scripts/ci/shots.sh:75-111`). All five pairs were identical. A separate ignored `local/` copy of run B had one PNG negated with ffmpeg to measure a changed pair; it produced four identical and one changed pair. No tracked source or test file was edited. Bytes are decimal; projections are arithmetic replacement of base64 payloads, not generated HTML. They leave existing HTML/CSS/JS overhead and original PNG files in place. Capture content is a small static demo, so extrapolation to the reported 124-shot consumer is **ESTIMATE (unverified)**.

| Artifact | Measured bytes |
|---|---:|
| Five original PNGs | 2,178,367 |
| `gallery.html` | 2,961,336 |
| Whole run, regular files | 5,143,658 |
| Identical-pair compare HTML | 5,847,835 |
| Changed-pair compare HTML | 5,998,401 |
| Changed-pair diff PNG sibling | 221,491 |
| Changed-pair compare JSON | 3,052 |

The throwaway `local/shotwright-746.57-preview-probe.sh` used installed ffmpeg, with no package change. It encoded all five demo PNGs at widths 800 and 1280, without enlargement, in WebP and JPEG at nominal qualities 65/85 and AVIF at CRF 28/40. The JPEG mapping is an ffmpeg `-q:v` approximation, so its quality number is not codec-comparable. Full-resolution lossless WebP was also measured. `local/` is ignored (`CLAUDE.md:106`, `.gitignore:19`); the script and outputs are experimental, not deliverables. A visual inspection of the `form-filled` 800/65 and 1280/85 previews found 800/65 usable for layout but fine text visibly softer; 1280/85 retained readable labels and borders. This judgment is limited to the demo and cannot certify small defects in the adopter's UI.

| Encoding of 5 shots | Encoded bytes | Approx. base64 bytes | Projected gallery HTML | Projected identical compare HTML | Review trade-off |
|---|---:|---:|---:|---:|---|
| 800 px WebP 65 | 138,574 | 184,772 | 241,607 | 408,377 | Smallest useful overview, but text and 1 px detail soften. |
| 800 px WebP 85 | 195,782 | 261,048 | 317,883 | 560,929 | Better compression artifacts, still resolution-limited. |
| 1280 px WebP 65 | 220,824 | 294,440 | 351,275 | 627,713 | More source detail, visible lossy risk on sharp text. |
| **1280 px WebP 85** | **320,656** | **427,548** | **484,383** | **893,929** | Best reviewed preview balance on demo; roughly 84% smaller gallery if previews are the only image payload. |
| 1280 px JPEG 85 | 621,880 | 829,180 | 886,015 | 1,697,193 | Larger and less suitable around UI edges. |
| 1280 px AVIF CRF 28 | 328,984 | 438,648 | 495,483 | 916,129 | Similar size to WebP here; higher encoding complexity and weaker older-browser reach. |
| Full-size lossless WebP | 1,166,842 | 1,555,792 | 1,612,627 | 3,150,417 | Intrinsic pixels retained, but overview still decodes full-size images. |
| **1280/85 WebP + full-size lossless WebP** | **1,487,498** | **1,983,340** | **2,040,175** | **4,005,513** | Self-contained overview and exact Actual pixels; 31% gallery reduction on demo. |

The projected compare values are `38,833 + 2 × base64 bytes`; they are listed to avoid implying a produced artifact. Base64 totals include per-image padding; data-URI prefixes and markup remain in fixed overhead. The source PNGs' base64 payloads total 2,904,501 bytes. Lossless WebP decoded to the same RGBA frame MD5 as its source PNG for all five demo shots, using ffmpeg `framemd5`; that checks the experiment, not every browser decoder or transparency case. The two-source self-contained choice keeps original PNGs under each run's `shots/`, so projected whole-run regular files are about 4.22 MB versus 5.14 MB on this demo, **ESTIMATE (derived, unverified implementation)**.

AVIF CRF 40 totals 207,762 bytes at 1280 px and 122,809 at 800 px; JPEG 65 totals 486,436 and 259,311; WebP 65 at 1280 and WebP 85 at 800 are shown above. The full set is in ignored `local/`. The reported consumer totals require a repeat against that corpus in P/V; the demo's compression ratio must not be treated as the 124-shot result.

## Prior art and current practice

All links in this section were read **2026-10-29**.

- [Playwright HTML reporter](https://playwright.dev/docs/test-reporters) makes a portable *folder*, with attachments under `data/`; it can point attachments at separate storage. Its blob reporter overwrites its output directory. [Playwright `outputDir`](https://playwright.dev/docs/api/class-testconfig) is cleaned at test start and supports `preserveOutput`; that is safe for its staging area, unlike shotwright's historical run tree (`src/index.ts:63-65`, `src/index.ts:112-114`).
- [Allure attachments](https://allurereport.org/docs/attachments/) are separate files linked from the report, with previews for supported media; [Allure history](https://allurereport.org/docs/history-and-retries/) treats retained history separately from result files and documents clearing result directories. These designs keep HTML small by depending on a folder or hosted service, a different portability choice.
- [Argos SDK](https://js-sdk-reference.argos-ci.com/) uploads a screenshot directory to a hosted build; [Argos security](https://argos-ci.com/security) says it stores screenshots in S3. [Chromatic visual tests](https://www.chromatic.com/docs/visual/) capture and compare in its cloud service, while [TurboSnap](https://www.chromatic.com/docs/turbosnap/) avoids recapturing unaffected stories. They move payloads or work off the report; their baseline approval model is outside shotwright's review-first design (`docs/design.md:25-27`, `docs/adr/0024-review-based-baselines-declined.md:18-25`).
- [Storybook test-runner](https://storybook.js.org/addons/%40storybook/test-runner) offers JUnit XML reporting; [Storybook test coverage](https://storybook.js.org/docs/writing-tests/test-coverage) serves a separate coverage HTML. It does not establish a single-file screenshot report pattern to borrow.
- [MDN image formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) recommends lossless formats for screenshots/text edges and notes WebP's broad modern browser support, AVIF's newer support, and JPEG's edge artifacts. [Sharp output API](https://sharp.pixelplumbing.com/api-output/) offers lossless WebP and lossy WebP/AVIF/JPEG; [resize API](https://sharp.pixelplumbing.com/api-resize/) supports `withoutEnlargement`. [Sharp installation](https://sharp.pixelplumbing.com/install/) documents prebuilt libvips packages across major platforms and pnpm cross-platform lockfile concerns; [upstream releases](https://github.com/lovell/sharp/releases) show v0.35.5 released 2026-09-27 and active maintenance. A package implementation needs a reviewed `sharp` runtime dependency and platform CI, not a shell-out to the locally installed ffmpeg.

## Options and trade-offs

| Option | Size and review quality | Contract/operations | Verdict |
|---|---|---|---|
| A. Embedded previews only; original PNG via sibling on click | ~484 KB demo gallery at 1280/85; one-click exact original only when hosted with siblings | Breaks ADR 0005's copied-file full review; presigned single-object view cannot fetch PNG; CSP must admit `self` for image display | Decline as default; opt-in compact export could be separate later. |
| **B. Embedded 1280/85 WebP previews plus embedded full-size lossless WebP** | **~2.04 MB demo gallery (31% less); ~4.01 MB compare (31% less)**; preview is fast, Actual pixels exact | Preserves single-file full-pixel review and `img-src data:`. Source PNG files stay under `shots/` for byte-exact download/compare; the HTML's Download original must either embed PNG again (undoing savings) or use a sibling link with a clear portability label | **Recommended** for review detail first, conditional on adopter-corpus validation. |
| C. Full-size lossless WebP only | ~1.61 MB gallery (46% less), ~3.15 MB compare (46% less) | Exact pixels and self-contained, but full image decode in overview defeats the preview memory goal and keeps large phone decode cost | Fallback if preview duplication brings too little value. |
| D. Embedded original PNG with a preview | HTML grows by preview payload; preserves every old behavior | Does not solve transfer size | Decline. |
| E. Build a hosted, relative-image folder | Small HTML; full PNGs fetched as needed | Breaks single-file delivery and ADR 0025's hosting path; weak offline handoff | Decline. |

**Recommendation:** option B, with a 1280 px maximum width, WebP quality 85 preview and full-size lossless WebP inspection layer. Use the preview for cards and fit-to-window; use the embedded lossless layer for Actual pixels and pair inspection, loading it only on demand. The source PNG remains at `<run>/shots/<spec>/<name>.png`, produced unchanged; its download link can point there *when the run folder is present*. In a copied HTML, the viewer still has exact pixels, but original **PNG file bytes** are unavailable unless also embedded. This is an explicit amendment to ADR 0005's stronger “original PNG download in the copied file” promise, though the self-contained review promise remains. If the owner requires a standalone original-byte download too, B cannot reduce the gallery substantially: embedding the PNG restores most of the removed payload. The doc should state this as the owner decision, not hide it behind a UI label. Preserve the CSP `img-src data:` for displayed images (`src/gallery/render.ts:443`, `src/gallery/render-compare.ts:207`). A WebP conversion failure should fall back to inline original PNG for that shot, preserving review availability, while the PNG on disk and verdict source remain unchanged (`src/gallery/model.ts:472-489`, `src/gallery/pixels.ts:37-77`).

For compare, create `<outputDir>/compare/<A>.vs.<B>/index.html`, `compare.json`, and `diff-<n>.png`, retaining the dot separator's unambiguity (`src/gallery/resolve.ts:42-54`) and amending ADR 0009. Preserve `--output <file.html>`'s existing custom-file behavior (`src/cli.ts:80`, `src/gallery/generate-compare.ts:189-198`); its sidecar and diffs stay beside that chosen file. Continue writing diff PNGs because `compare.json` names them (`src/gallery/generate-compare.ts:268-280`), but avoid inlining a full diff **and** writing its PNG if compare HTML size matters: a small embedded preview plus optional sibling full diff would break standalone full-diff review. Prefer embedded lossless WebP diff for exact standalone inspection and a sibling PNG for machine consumers; the demo's changed diff sibling was 221,491 bytes and the HTML already carried it as base64 (`src/gallery/render-compare.ts:116-117`). Validate that choice against a many-diff adopter comparison before pinning. Compare publish must retain the staged-file, HTML-last behavior (`src/gallery/generate-compare.ts:351-389`) and avoid deleting a previous complete pair on a failed replacement.

Add a **manual** `shotwright prune --keep N` command, dry-run by default with `--apply`, scoped to the configured output directory. Count only published runs toward N, sort by run-id timestamp and then basename as `runs` already does (`src/runs.ts:25-29`, `src/runs.ts:75-82`); protect incomplete runs by default and always protect the `latest` target (`src/runs.ts:42-71`, `src/runs.ts:128-133`). Report bytes and exact paths before removal. After applying, remove managed compare directories whose sidecar names a removed run; provide `--keep-compares N` for otherwise unreferenced old pairs, defaulting to the same N. Treat explicit `--output` paths as outside management. Reject symlinked candidate directories, compare ownership mismatches, and an active run; use a prune lock and per-directory rename-to-trash followed by removal so a partially removed tree is never mistaken for a complete run. A failed deletion reports a residual trash path and exits nonzero. This keeps retention centralized in the package and avoids silent deletion during `run`. New CLI syntax and directory layout are binding; no manifest schema field or workflow input is needed. As the published package is `0.6.0` (`package.json:3`), a **minor** bump to `0.7.0` is appropriate for additive `prune` and new encoding, with explicit release-note migration for the default compare path and original-PNG link behavior. Those latter defaults are compatibility changes, so the owner may require a major bump under strict semver; this remains an open choice. No change to the `shot()` capture API or its PNG bytes is proposed.

## Open questions for the owner

1. Is an exact-pixel, self-contained viewer sufficient when a copied HTML cannot download the original **PNG bytes**, or must ADR 0005's byte-level download promise remain? This decides B versus the less compact C plus PNG, or a breaking preview-only mode.
2. Does the 1280/85 + lossless two-layer choice show enough savings and defect visibility on the adopter's 124-shot corpus, including full-page DSF 2 captures? P should benchmark transfer size, generation time, memory, text readability and a known 1 px defect before implementation.
3. Should default compare subdirectories use `index.html`, or keep `<A>.vs.<B>.html` inside the pair directory for script discoverability? How much compatibility for the old flat path is warranted?
4. Should incomplete runs remain protected by default, with a separate explicit stale-incomplete cleanup option, and should default compare retention match run retention? The recommendation is protection plus matching compare retention, but this needs owner sign-off before a destructive CLI contract lands.
5. Given default path/download behavior changes at package `0.6.0`, use a `0.7.0` minor with release notes or a strict `1.0.0` major?

## Considered and declined

Relative overview images, automatic pruning on `run`, changing capture to lossy output, dropping diff files without changing the JSON contract, and JPEG as the default were declined for the reasons above. AVIF is promising but its smaller demo results at CRF 40 are not enough to offset compatibility and encoding-cost uncertainty. No golden-diff gate or hosted baseline is proposed (`docs/design.md:25-27`, `docs/adr/0024-review-based-baselines-declined.md:18-25`).

## ADR and binding surface

An ADR is warranted: option B amends ADR 0005's original-byte guarantee; pair directories reverse ADR 0009's flat-path decision. The next free number after the highest committed ADR (`0026`) is **0027**, used in proposed `docs/adr/0027-embedded-review-images-and-compare-directories.md`. Parallel research lanes may take 0027; renumber before acceptance if so. The binding surfaces are the default compare path, CLI `prune` flags, and gallery original-download semantics. No manifest field, workflow input or published TypeScript export is recommended.

## Self-review

| Lens | Result |
|---|---|
| Measured or flagged | Pass: demo bytes measured; adopter savings explicitly unverified. |
| Derived-value semantics | Pass: projected HTML is payload replacement; retained-count meaning and missing sidecar behavior specified. |
| Emergent structure | Pass: pair directory name remains unambiguous; custom output stays file-based; `latest` is protected. |
| Batch/concurrency | Flag for P: prune lock/trash and compare replacement need deterministic crash/concurrency tests. |
| Inherited constraints grounded | Pass with owner decision pending: preview+lossless retains exact pixel review and data-only CSP, but changes copied-file PNG download. |

## Files written

`docs/shotwright-746.57-research.md` and proposed `docs/adr/0027-embedded-review-images-and-compare-directories.md`. Ignored `local/shotwright-746.57-preview-probe.sh` and generated measurements are disposable experiments.

## Redteam outcome and owner decision (2026-10-29)

A redteam returned **rework**. The draft ADR 0027 is withdrawn (not committed). The owner chose to split the work into four beads, in this order:

1. **Compare payload deduplication (this bead, rescoped).** Compare embeds A, B and each diff as data URIs (`src/gallery/render-compare.ts:58,116`). In the measured changed-pair page, repeated PNG data URIs are 2,215,756 of 5,998,401 bytes (37%); identical pairs embed the same bytes twice. Render each unique image payload once, keep clear A/B labels and both download links, keep the full diff embedded, and measure on the adopter's 124-shot comparison. No new dependency and no contract change.
2. **Gallery image encoding and ADR 0005's original-byte promise.** Option B changes ADR 0005's explicit promise that a copied gallery contains each original PNG byte stream (`docs/adr/0005-gallery-single-file-inline-originals.md:20`); that is an explicit owner decision, not a size detail. A production encoder is a dependency decision: sharp 0.35.5 declares 25 optional platform packages and about 19.1 MB unpacked on Linux x64, while ADR 0019 forbids runtime optional dependencies. In-browser canvas WebP has no lossless switch; a read-only probe measured 245 KB for 1280 px previews but 3.21 MB for full-size `quality: 1` WebP against 2.07 MB of source PNGs. Benchmark the chosen production encoder on the adopter corpus before fixing a codec.
3. **Compare pair directories.** The flat default path is a documented scripting surface (ADR 0009); moving it is a breaking change, allowed in 0.7.0 under SemVer's major-zero rule but must be marked. Pin the layout (current generation derives `index.compare.json` and `index.diff-<n>.png` from the HTML stem, `src/gallery/generate-compare.ts:189-197,244`), relative download paths, and replacement behaviour.
4. **Manual prune.** Fix-now data-loss risk in the drafted design: prune could rename a newly published run between manifest publication and the `latest` update (`src/reporter.ts:180-193`). Coordinate with run publication before implementation; defer `--keep-compares` and trash machinery until a retention test justifies them.

Premise correction: regeneration already prunes stale files of the same compare stem (`src/gallery/generate-compare.ts:390-419`); old runs and distinct pairs are what accumulate.
