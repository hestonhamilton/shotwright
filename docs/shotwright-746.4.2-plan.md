# E4.P Plan: Compare CLI + Paired Gallery

## Goal

Implement `shotwright compare A B` as a review-only HTML artifact that pairs two completed run manifests by exact shot name and makes visual changes findable by eyeball in under a minute. E4 ships the owner-signed-off contact-sheet triage layout with a selected-pair detail pane, attention-state ordering, exact-name pairing, visible rename limitation copy, and no pixel difference view.

Epic acceptance: two runs of the demo app with a deliberate UI change between them produce a compare gallery where the change is findable by eyeball in under a minute.

## Existing Code Grounding

The CLI currently exposes `run`, `gallery`, and `init`; `compare` is only reserved in the opening comment and is not dispatched in `main()` yet (`src/cli.ts:2`, `src/cli.ts:388`). CLI usage strings are separate constants folded into `USAGE` (`src/cli.ts:51`). `gallery` already has the parser/command/dispatch shape E4 should mirror: `parseGalleryArgs()` returns typed args (`src/cli.ts:147`), `gallery()` returns a numeric exit code (`src/cli.ts:345`), and top-level parser/command errors are caught as exit 1 (`src/cli.ts:412`).

Run output discovery must keep using config probing, because `probeOutputDir()` resolves the consumer's configured absolute output directory through Playwright list mode rather than assuming `shots-output` (`src/cli.ts:252`, `src/cli.ts:269`). Runs live below the output directory using generated basename ids (`src/runs.ts:12`, `src/runs.ts:27`), and a complete run is defined by `manifest.json` existing (`src/runs.ts:50`). `latest` is a symlink in the output directory (`src/runs.ts:55`).

`resolveGalleryRun()` already canonicalizes the output directory, resolves `latest` when the explicit id is `null`, validates explicit ids as single basenames, rejects symlink escapes, and returns `{ outputDir, runDir, runId, selectedViaLatest }` (`src/gallery/resolve.ts:43`). `validateRunId()` rejects empty strings, NUL, `/`, `\`, `.`, `%`, absolute paths, and non-basename values (`src/gallery/resolve.ts:28`). E4 must keep that surface strict: generated run basenames plus the literal CLI alias `latest` only.

The manifest already has all fields needed for side-by-side pairing: shot `name`, `spec`, `file`, `viewport`, `deviceScaleFactor`, `fullPage`, `capturedAt`, `durationMs`, `video`, and `trace` (`src/manifest.ts:19`); run-level metadata includes ids, timestamps, versions, flags, and `shots` (`src/manifest.ts:32`). Duplicate shot names are rejected at manifest assembly (`src/manifest.ts:91`) and again when the gallery model validates a manifest (`src/gallery/model.ts:147`), so compare must not add another duplicate-name validator.

`loadGalleryModel()` reads and validates `manifest.json`, validates every manifest path before reading referenced files, reads PNG metadata/data URIs, and preserves unreadable screenshots as `GalleryShot` entries with `image: null`, `imageError`, and diagnostics (`src/gallery/model.ts:295`, `src/gallery/model.ts:313`, `src/gallery/model.ts:322`). That preservation is important: a name-matched pair with one unreadable side must become compare state `not-comparable`, never `paired`.

`renderGallery()` owns the full one-run document shell, header, controls, content, footer, dialog, CSS, and script in one function (`src/gallery/render.ts:251`, `src/gallery/render.ts:286`). E4 must not refactor the shipped gallery shell. The already-pure helper surface is small: `escapeHtml()` is exported (`src/gallery/render.ts:11`); number/count formatting and viewport/DSF labels are currently pure but private (`src/gallery/render.ts:25`, `src/gallery/render.ts:50`, `src/gallery/render.ts:56`). `generateGallery()` shows the existing atomic publication pattern: render, write temp file, rename, and remove temp on failure (`src/gallery/generate.ts:20`, `src/gallery/generate.ts:27`).

The current gallery server serves only one run's `/` and `/gallery.html`, plus manifest-referenced screenshots/video/trace; it does not serve `manifest.json` (`src/gallery/server.ts:112`, `src/gallery/server.ts:122`, `src/gallery/server.ts:126`). E4 compare does not need a serving mode.

## CLI Surface

Add:

```text
Usage: shotwright compare <run-a|latest> <run-b|latest> [--config <path>]
```

Argument shape:

```ts
export interface CompareArgs {
  a: string
  b: string
  config: string
}
```

Parser rules:

- Exactly two positional run selectors are required.
- Either positional may be the literal `latest`.
- Non-`latest` positionals are not normalized or relaxed in the parser; resolution continues to use `validateRunId()` through `resolveGalleryRun()`.
- The only flag is `--config <path>`, defaulting to `shots.config.ts`.
- Duplicate `--config`, unknown flags, missing flag values, missing positionals, and extra positionals throw parser errors.
- There is no `--`, no Playwright passthrough, no `--host`, no `--port`, no `--lan`, no `--open`, and no output-path flag in E4.

Where to slot it into `src/cli.ts:51`:

- Add `CompareArgs` beside `GalleryArgs`.
- Add `COMPARE_USAGE` beside `RUN_USAGE`, `GALLERY_USAGE`, and `INIT_USAGE`.
- Include `COMPARE_USAGE` in aggregate `USAGE`.
- Add `parseCompareArgs(argv: string[]): CompareArgs` after `parseGalleryArgs()` or before it if the file is ordered by command surface.
- Add `async function compare(argv: string[]): Promise<number>` beside `gallery()`.
- Add a `cmd === 'compare'` dispatch arm in `main()` beside the existing `run`/`gallery`/`init` arms (`src/cli.ts:388`).

Command behavior:

1. Parse args.
2. If `args.config` does not exist, print `shotwright: config not found: ${args.config} — pass --config or create shots.config.ts` and return 1, matching `gallery()` (`src/cli.ts:347`).
3. Probe output dir with `probeOutputDir(args.config)`, matching gallery discovery (`src/cli.ts:351`).
4. Resolve A and B.
5. Reject identical canonical run directories before loading models.
6. Generate the compare artifact.
7. Print selected run labels and artifact path.
8. Print diagnostics to stderr if either side has unreadable screenshots/artifacts.
9. Return 0 if the compare HTML was rendered and atomically written.

Exact success output should be stable enough for tests:

```text
shotwright compare: selected A <runId> via latest (last fully passed run)
shotwright compare: selected B <runId> explicitly
shotwright compare: wrote <absolute artifact path>
```

Exit-code invariant:

- `compare` exits 0 whenever it renders and writes the artifact, regardless of unmatched shots or not-comparable pairs.
- Non-zero is reserved for usage errors, missing config, config probe failure, missing/unreadable output dir, missing run, identical run selection, missing/invalid manifest, and file write failure.
- Diagnostics from unreadable images do not make compare non-zero once the page renders, because those are represented as first-class review states.

## Run Resolution

Implement one small resolver wrapper **in the existing `src/gallery/resolve.ts`**,
beside `resolveGalleryRun()`. Do not create `src/gallery/compare-resolve.ts`: the
function is a thin two-call wrapper plus an identical-run guard, and it belongs
next to the resolution logic it delegates to. Its tests then extend the existing
`test/unit/gallery-resolve.test.ts` rather than starting a new file.

*(Redteam finding 5, accepted in part — see the Redteam Record for what was kept.)*

```ts
export interface ResolvedCompareRuns {
  outputDir: string
  a: ResolvedGalleryRun
  b: ResolvedGalleryRun
}

export function resolveCompareRuns(outputDir: string, a: string, b: string): ResolvedCompareRuns
```

Resolution algorithm:

- Convert each selector independently: selector `latest` passes `null` to `resolveGalleryRun(outputDir, null)`; otherwise pass the selector unchanged to `resolveGalleryRun(outputDir, selector)`.
- Reuse `resolveGalleryRun()` so output-dir canonicalization, latest symlink checks, single-basename validation, directory checks, and symlink-escape rejection stay identical to gallery (`src/gallery/resolve.ts:47`, `src/gallery/resolve.ts:64`, `src/gallery/resolve.ts:72`).
- After both resolve, if `a.runDir === b.runDir`, throw `shotwright compare: A and B resolve to the same run: <runId>`.
- Do not check duplicate shot names; `loadGalleryModel()` already validates and rejects them (`src/gallery/model.ts:311`, `src/gallery/model.ts:147`).
- Missing run: `resolveGalleryRun()` throws the existing missing/unreadable directory error (`src/gallery/resolve.ts:68`).
- Incomplete run with no `manifest.json`: resolution may succeed if the directory exists, but `loadGalleryModel()` then throws `shotwright gallery: invalid manifest: manifest.json could not be read...` (`src/gallery/model.ts:295`). Do not weaken this into a partial compare.
- Explicit failed runs with a published manifest are comparable, matching gallery's explicit-run language that such runs may be partial or failed (`src/cli.ts:301`).
- `latest` still means the last fully passed run because run code updates the symlink only through the run lifecycle (`src/runs.ts:55`) and gallery already labels it that way (`src/cli.ts:301`).

## Data Model

Add `src/gallery/compare-model.ts`.

Public shape:

```ts
import type { GalleryDiagnostic, GalleryModel, GalleryShot } from './model.js'

export type ComparePairState =
  | 'paired'
  | 'a-only'
  | 'b-only'
  | 'not-comparable'

export interface ComparePair {
  key: string
  state: ComparePairState
  a: GalleryShot | null
  b: GalleryShot | null
  spec: string
  order: number
  notComparableReason: string | null
}

export interface CompareCounts {
  total: number
  nameMatched: number
  comparable: number
  aOnly: number
  bOnly: number
  unmatchedByName: number
  notComparable: number
}

export interface CompareModel {
  a: GalleryModel
  b: GalleryModel
  pairs: ComparePair[]
  counts: CompareCounts
  diagnostics: GalleryDiagnostic[]
}
```

State semantics:

- `paired`: shot name exists in A and B, and both `GalleryShot.image` values are non-null.
- `a-only`: shot name exists only in A. Primary human label: `unmatched by name · A only`.
- `b-only`: shot name exists only in B. Primary human label: `unmatched by name · B only`.
- `not-comparable`: shot name exists in A and B, but A or B has `image === null`. This includes missing PNGs, corrupt PNGs, invalid PNG signatures, bad CRC, or other read failures already captured by `loadGalleryModel()` diagnostics (`src/gallery/model.ts:322`). Human label: `not comparable · unreadable image`.

Counting rules:

- `total`: all name buckets in the union of A and B shot names.
- `nameMatched`: name buckets present in **both** manifests, including `not-comparable`.
- `comparable`: count of `paired` state only — both sides present **and** both images readable.
- `aOnly`: count of `a-only`.
- `bOnly`: count of `b-only`.
- `unmatchedByName`: `aOnly + bOnly`.
- `notComparable`: count of `not-comparable`.

Invariant: `nameMatched === comparable + notComparable`, and
`total === nameMatched + unmatchedByName`. Assert both in unit tests.

**Naming is load-bearing here, do not "simplify" it back.** An earlier draft
called `nameMatched` "paired" and kept a separate `compared`. A human reading a
badge sourced from a field called `paired` will understand it as "these were
compared", which is false for a bucket whose image is unreadable on one side —
the single highest-risk false statement this feature can make. The field name is
the guard. Any user-facing count of "what was actually compared" must read from
`comparable`, never from `nameMatched`.

*(Redteam finding 2, accepted.)*

Build algorithm:

1. Traverse A shots in manifest/spec order and assign each unseen name its first stable union order.
2. Traverse B shots and assign any new name after A-only names, preserving B manifest/spec order.
3. Build maps by `entry.name`; uniqueness is assumed from manifest assembly and gallery validation (`src/manifest.ts:91`, `src/gallery/model.ts:147`).
4. For each union key, compute state by presence and image readability.
5. `spec` for paired/name-matched buckets is `a.entry.spec` unless absent, then `b.entry.spec`; for A-only/B-only use that side's spec.
6. `notComparableReason` joins side-specific `imageError` values, with side labels, when state is `not-comparable`.

Search text is **not** a model field. Compute the searchable string in the
renderer from `key` and `spec` at the point it is written into the tile's
`data-search` attribute — it has exactly one consumer and does not need to be
carried through the model.

Ordering for rendering:

- Attention states first, then spec order.
- Attention states are `not-comparable`, `a-only`, and `b-only`.
- Within attention states, sort by severity then stable union order: `not-comparable` first, then `a-only`, then `b-only`.
- Within non-attention `paired`, keep manifest/spec order by the stable union order computed above.
- Do not compute pixel equality, image dimensions equality, byte equality, perceptual score, threshold, or pass/fail.

This ordering is only a triage ordering. It must never imply a pixel verdict.

### Degenerate states — specify before implementing

These are the cases where the page is most likely to state something untrue, and
none of them were pinned in the first draft. E4.I must implement all four with
the exact copy below; the existing one-run gallery already has precedent for
handling an empty run (`src/gallery/render.ts:277`).

| Case | Condition | Required behaviour |
|---|---|---|
| **Empty compare** | `total === 0` (both runs have `shots: []`) | Render the shell, header and run facts. No sheet, no detail pane, no `selected:` badge. Body copy: **"Both runs are empty. There is nothing to compare."** |
| **No common names** | `total > 0` and `nameMatched === 0` | Render every shot as `a-only`/`b-only`. Header must NOT show a comparable count of 0 alongside language implying comparison happened. Body copy: **"These two runs share no shot names, so nothing could be paired. Every shot below is unmatched by name."** |
| **All not-comparable** | `nameMatched > 0` and `comparable === 0` | Render normally, attention-first. Body copy: **"Every name-matched pair has an unreadable image on at least one side. Nothing here was visually compared."** |
| **One side empty** | one run has `shots: []`, other does not | All shots resolve to `a-only` or `b-only`. State which run was empty by run id in the header facts. |

Rules that apply across all four:

- The `selected: <key>` badge and the detail pane are rendered **only when at
  least one pair exists**. "The first rendered pair is selected by default" is
  undefined on an empty union and must not throw.
- No degenerate state may be reported as a successful comparison, and none is an
  error: `compare` still exits 0 in every case above, because it rendered.

*(Redteam finding 3, accepted — and it named this as the single most important
missing thing in the plan.)*

## Rendering

Add `src/gallery/render-compare.ts` with:

```ts
export function renderCompare(model: CompareModel): string
```

Keep compare's CSS and JS **inside `render-compare.ts`**, separate from
`GALLERY_CSS`/`GALLERY_SCRIPT`, because the signed-off structure is a two-pane
contact sheet/detail UI while `GALLERY_SCRIPT` is written around
`.card[data-search]`, one-run filters, and one-run inspection buttons
(`src/gallery/assets.ts:167`). Do **not** create `src/gallery/compare-assets.ts`
until those assets have a second caller — a module with one importer is a file,
not a boundary.

Function boundaries:

- `renderCompare(model)`: owns the full document shell, CSP, header, controls, contact sheet, selected detail pane, footer, dialog, CSS, and JS.
- `renderHeader(model)`: run ids, counts, pairing key, ordering, manifest byte lengths, versions, flags.
- `renderControls(model)`: search input and filter chips.
- `renderSheet(model)`: ordered pair tiles grouped into `Needs eyeballs first` and `Paired context`, matching the signed-off mockup sections (`docs/shotwright-746.4.2-mockups/signed-off-composite.html:170`, `docs/shotwright-746.4.2-mockups/signed-off-composite.html:211`).
- `renderPairTile(pair, index)`: small side-by-side tile with state badge.
- `renderDetail(pair, index)`: selected side-by-side detail pane.
- `renderSideMedia(side, pair, size)`: placeholder/unavailable media for tiles and full side image for detail.
- `renderSideMeta(shot)`: viewport, DSF, full-page/cropped, duration, intrinsic dimensions/bytes if readable.
- `renderActions(pair)`: inspect/download links for each readable side only.

Helper policy:

- Reuse `escapeHtml()` verbatim from `render.ts` because it is already exported and used as the gallery escaping primitive (`src/gallery/render.ts:11`).
- Reuse number/count formatting and viewport/DSF labels by extracting only those pure helpers into a tiny shared helper module or by exporting them without changing their behavior. The current implementations are pure string formatters (`src/gallery/render.ts:25`, `src/gallery/render.ts:50`, `src/gallery/render.ts:56`).
- Copy the document shell/CSP shape into `renderCompare()` instead of creating a shared shell. `renderGallery()` currently owns the whole document in one function (`src/gallery/render.ts:286`), and E4 must avoid a shared-shell refactor that changes shipped E3 output.
- Copy/adapt visual classes from the signed-off mockup: `.topbar`, `.status`, `.badge`, `.runfacts`, `.controls`, `.board`, `.sheet`, `.grid`, `.tile`, `.thumbs`, `.detail`, `.pair-large`, `.pane`, `.media`, `.missing`, `.actions` (`docs/shotwright-746.4.2-mockups/signed-off-composite.html:61`, `docs/shotwright-746.4.2-mockups/signed-off-composite.html:80`).
- Copying CSS is correct here because the compare page is a new document with different structure; extracting a shared design system before compare exists would create unnecessary blast radius for the shipped gallery.

Required page structure from the signed-off mockup:

- Topbar eyebrow: `Compare gallery · contact sheet triage`.
- H1: `<A runId> compared with <B runId>`.
- Status badges:
  - `Review artifact · no verdicts`
  - `<N> name buckets`
  - `<N> unmatched by name` when nonzero
  - `<N> unreadable image` when nonzero
  - `selected: <first selected key>`
- Run facts:
  - A run id and shot count
  - B run id and shot count
  - Pairing key: `exact shot name`
  - Ordering: `attention states first, then spec order`
  - Manifest byte lengths
  - Version/flag summary
  - Rename copy visible
- Controls:
  - Search by name/spec.
  - Chips: `All`, `Problem states`, per-spec chips, and viewport/DSF chips where useful.
  - Copy: `The sheet surfaces unusual states first without computing whether pixels are good or bad. It labels presence, pairing, and readability only.`
- Sheet:
  - First section label: `Needs eyeballs first`.
  - Second section label: `Paired context`.
  - Header badge: `renames appear unmatched`.
- Detail pane:
  - Side-by-side A/B large media.
  - State badge.
  - Metadata and original download links for readable sides.
  - For missing/unreadable sides, show the file path and error text.
  - Include the rename limitation copy in the detail body: `A-only and B-only shots are unmatched by name. A rename appears as two unmatched buckets because manifests contain no rename lineage.`
  - Include unreadable image copy: `Unreadable images stay in the sheet with a red state and are not presented as successful visual comparisons.`

Interaction:

- The first rendered pair is selected by default.
- Clicking a tile updates the detail pane without page reload.
- Search and chips hide/show tiles.
- No difference view, swipe view, onion-skin, overlay, pixel delta, or hooks/classes/data attributes for future diff are added.
- Keep bounded image decode behavior: do not eagerly insert all overview `<img>` nodes at full size. Use data URI anchors and lazy insertion similar in spirit to the one-run gallery, whose script keeps at most three live overview images (`src/gallery/assets.ts:184`, `src/gallery/assets.ts:191`).

## Output

Write compare artifacts under the configured output directory:

```text
<outputDir>/compare/<A-run-id>__vs__<B-run-id>.html
```

Generation result shape:

```ts
export interface CompareGenerationResult {
  comparePath: string
  diagnostics: GalleryDiagnostic[]
  model: CompareModel
}
```

Add `src/gallery/generate-compare.ts`:

```ts
export function generateCompareGallery(
  outputDir: string,
  aRunDir: string,
  bRunDir: string,
): CompareGenerationResult
```

Publication rules:

- Create `<outputDir>/compare` if needed.
- Load both runs with `loadGalleryModel()`.
- Build `CompareModel`.
- Render with `renderCompare()`.
- Write atomically with a temp file in `<outputDir>/compare`, then rename to the final path, mirroring the gallery temp-write/rename pattern (`src/gallery/generate.ts:27`).
- Remove temp file on failure, matching gallery cleanup (`src/gallery/generate.ts:34`).
- Existing file at the same pair path may be overwritten atomically; compare is regenerated review output, not historical storage.

Why this location:

- Inside run B is operationally cheap but semantically wrong: neither run owns the comparison, and placing the artifact in B would imply B is the canonical "after" container even though the command compares two selected runs.
- Directly in the output root as a flat HTML file keeps it near runs but pollutes a directory currently documented as containing run-id directories plus `latest` (`docs/design.md:72`).
- A separate `<outputDir>/compare/` namespace keeps compare artifacts inside the already-gitignored review output tree while avoiding ownership by either run.
- A caller-specified path is unnecessary for E4 and adds CLI surface that would need compatibility support later.

Test consequence: `test/smoke/cli.test.ts` currently defines `runDirectories()` as every output entry except `latest` (`test/smoke/cli.test.ts:61`). If the smoke test leaves `<outputDir>/compare` behind, that helper will treat it as a run-like entry. E4.I should either remove the compare directory in that test's `finally` block or tighten the helper to only include directories containing `manifest.json`. The cheaper E4 path is cleanup in the compare smoke test.

## Page Weight

Existing single-run gallery design inlines each original PNG exactly once as a data URI (`docs/adr/0005-gallery-single-file-inline-originals.md:20`). The one-run gallery relies on bounded on-demand decode, with at most three live overview image nodes plus one inspection image (`docs/adr/0005-gallery-single-file-inline-originals.md:25`). The smoke suite already has a synthetic 60-shot gallery corpus and prints its HTML byte size (`test/smoke/cli.test.ts:626`, `test/smoke/cli.test.ts:682`).

E4 bounded acceptance check:

- Compare two existing demo smoke runs and assert the compare artifact writes successfully.
- Assert the HTML contains the contact-sheet/detail structure, the review-only copy, the exact two run ids, and the expected number of name buckets.
- Assert the number of embedded PNG data URIs equals the count of readable image sides in the model.
- Assert the generated demo compare artifact is below 8 MB. This is a bounded demo acceptance check, not a product guarantee.

Revisit threshold:

- Create a named follow-up bead when compare is needed for `>= 60` shots per side or `>= 120` readable image sides in one compare artifact.
- Suggested follow-up title: `Measure large-corpus compare payload and decide externalized mode`.
- Do not solve 70 MB in E4. Do not add a hybrid/external mode silently; ADR 0005 allows that only as a named future escape hatch if evidence requires it (`docs/adr/0005-gallery-single-file-inline-originals.md:56`).

## Test Plan

Unit tests to add:

1. `test/unit/gallery-compare-model.test.ts`
   - Builds pairs from two `GalleryModel`s.
   - Covers `paired`.
   - Covers `a-only`.
   - Covers `b-only`.
   - Covers `not-comparable` when A image is unreadable.
   - Covers `not-comparable` when B image is unreadable.
   - Asserts a `not-comparable` pair increments `nameMatched` and `notComparable`, but **not** `comparable`.
   - Asserts the counting invariants hold: `nameMatched === comparable + notComparable` and `total === nameMatched + unmatchedByName`.
   - Covers every degenerate state: empty compare, no common names, all not-comparable, one side empty.
   - Asserts unpaired labels are `unmatched by name`, not `added` or `removed`.
   - Asserts attention-first ordering: `not-comparable`, `a-only`, `b-only`, then regular paired items in spec/manifest order.
   - Asserts duplicate names are not revalidated by compare; duplicate validation remains owned by manifest/model tests (`test/unit/gallery-model.test.ts:94`).

2. `test/unit/gallery-compare-render.test.ts`
   - Renders contact sheet plus detail pane.
   - Asserts `Review artifact · no verdicts`.
   - Asserts `attention states first, then spec order`.
   - Asserts `Pairing key` is `exact shot name`.
   - Asserts rename limitation copy is visible.
   - Asserts unreadable image copy is visible.
   - Asserts no `Difference`, `threshold`, `tolerance`, `baseline`, `expected`, `pass`, or `fail` verdict vocabulary is introduced in compare-specific fields/classes/copy, except existing project copy that explicitly says no pass/fail if reused.
   - Asserts data URI count is one per readable side, and unreadable sides render as unavailable placeholders.
   - Asserts escaped hostile names/specs do not inject markup, following the existing gallery escaping test pattern (`test/unit/gallery-render.test.ts:157`).

3. `test/unit/gallery-compare-generate.test.ts`
   - Publishes `<outputDir>/compare/<A>__vs__<B>.html`.
   - Regenerates byte-identically from identical inputs in different temp roots, following the existing deterministic gallery publication test (`test/unit/gallery-render.test.ts:96`).
   - Rewrites atomically and leaves no `.compare.*.tmp` files, following the existing temp cleanup assertion for gallery (`test/unit/gallery-render.test.ts:111`).
   - Does not overwrite an existing compare file when a manifest is missing/invalid, matching gallery's no-overwrite failure behavior (`test/unit/gallery-render.test.ts:121`).
   - Returns diagnostics while still writing HTML for unreadable images.

4. `test/unit/gallery-resolve.test.ts`
   - Add `resolveCompareRuns()` tests beside existing run resolution tests (`test/unit/gallery-resolve.test.ts:48`).
   - Resolves explicit A and B run ids.
   - Resolves `latest` for either side.
   - Rejects identical canonical runs, including `latest` plus its target basename.
   - Keeps rejecting paths, dots, `%`, and separators through `validateRunId()` (`test/unit/gallery-resolve.test.ts:31`).

5. `test/unit/cli.test.ts`
   - Import `parseCompareArgs`.
   - Defaults config to `shots.config.ts`.
   - Parses `compare A B --config custom.ts`.
   - Parses `compare latest B`.
   - Rejects missing A/B, extra positionals, duplicate `--config`, unknown flags, and missing config value.
   - Asserts no `--host`, `--port`, `--lan`, or `--` passthrough behavior exists for compare.

Smoke test:

- Extend `test/smoke/cli.test.ts`.
- Use two of the four runs already created in `beforeAll`: `unfilteredRun` and `videoRun` are the cheapest useful pair because `unfilteredRun` has five shots and `videoRun` has two name-matched shots, creating paired plus unmatched-by-name states without adding setup-time runs (`test/smoke/cli.test.ts:910`, `test/smoke/cli.test.ts:920`).
- Do not add setup-time runs. The exact-four-run assertion lives inside `beforeAll` at lines 907-933, so setup-time runs would require deliberately updating that assertion (`test/smoke/cli.test.ts:907`, `test/smoke/cli.test.ts:931`).
- A compare test running after setup may create its own artifact, but the cheaper correct path is to pair existing runs and clean up `<outputDir>/compare` afterward.
- Smoke assertions:
  - `node dist/cli.js compare <unfilteredRunId> <videoRunId> --config demo/shots.config.ts` exits 0.
  - stdout contains selected A, selected B, and written path.
  - written path is `<outputDir>/compare/<A>__vs__<B>.html`.
  - HTML contains both run ids, `Review artifact · no verdicts`, `unmatched by name`, `renames appear unmatched`, and `not comparable` copy only if the chosen fixture creates unreadable images.
  - HTML contains `form-filled` and `about-desktop` as paired names because `videoRun` captures those two shots (`test/smoke/cli.test.ts:981`).
  - HTML contains unmatched names from the five-shot run.
  - HTML byte length is `< 8_000_000`.
  - No server is started; compare should terminate by itself.

Pack inventory:

- Update the smoke pack inventory to include any new `dist/gallery/compare-*.js` files. It currently asserts an exact sorted list of gallery runtime modules (`test/smoke/cli.test.ts:696`).

Verification commands for E4.I:

```bash
pnpm run test
pnpm run smoke
pnpm run lint
```

These are the existing package scripts for unit tests, smoke, and lint/type/build checks (`package.json:37`).

## Invariant Checks

E4.I diff acceptance must include these four greppable checks from E4.R:

1. `compare` exits 0 whenever it renders. Non-zero is only for usage, resolution, manifest-read/validation, identical-run, config-probe, or write failures. Existing command-level numeric return convention is visible in `gallery()` (`src/cli.ts:345`, `src/cli.ts:373`).
2. No `baseline`, `threshold`, `tolerance`, or `expected` in compare field names or CLI flags. Current manifest field names do not use that vocabulary (`src/manifest.ts:19`, `src/manifest.ts:32`).
3. Compare badges are presence/readability states: `paired`, `unmatched by name · A only`, `unmatched by name · B only`, and `not comparable · unreadable image`. There is no pass/fail verdict; current gallery precedent explicitly says pass/fail status is not embedded (`src/gallery/render.ts:301`).
4. No test asserts that a pixel-difference result controls exit status. The project design says CI artifacts fail for walkthrough/publication problems, never because pixels changed (`docs/design.md:110`).

### Check 5 — added because checks 1–4 are defeatable

The P→I redteam was asked to defeat checks 1–4 and did, with a concrete recipe:

> Emit `data-diff-score="0.93"` (or a hidden JSON blob named `visualChangeScore`),
> order the tiles by that score, label badges only `paired` / `unmatched` /
> `not comparable`, exit 0, and avoid the exact words `baseline`, `threshold`,
> `tolerance`, `expected`. Every one of checks 1–4 passes. The regenerated review
> HTML now contains and prioritises a computed pixel comparison.

Checks 1–4 constrain *vocabulary and exit status*. They do not constrain
*computation*. So:

5. **`compare` never computes a similarity measure between two images, and never
   emits one.** Concretely, and all four are checkable:
   - No compare code path reads decoded pixel data from both sides of a pair for
     the purpose of relating them. Images are read to embed and to obtain
     intrinsic dimensions, nothing else.
   - No numeric per-pair field derived from image *content* appears in the model,
     the DOM, any `data-*` attribute, or any inline JSON. Dimensions and byte
     length are metadata and are permitted; anything expressing A-relative-to-B
     is not.
   - Ordering keys are `state` and stable union order only. Grep the sort
     comparator: if it reads anything content-derived, the check fails.
   - No dependency is added for image comparison, hashing, or perceptual metrics.

This is the check that actually defends the invariant. Treat 1–4 as necessary,
5 as sufficient.

## Sequencing

1. Add `compare-model` first with focused unit tests, including every degenerate
   state. This creates reviewable behaviour before any HTML or CLI wiring.
2. Add `renderCompare()` with static fixture models and render tests.
3. **Render and LOOK at it.** Generate a real compare artifact from two of the
   demo runs already on disk, open it in a browser, and confirm the signed-off
   layout, the unreadable-image placeholder, the unmatched labelling, and each
   degenerate state. Do not proceed past this step on the strength of string
   assertions.
4. Add `generateCompareGallery()` and atomic file publication tests.
5. Add run resolution (see Run Resolution) tests and implementation.
6. Add `parseCompareArgs()` tests and implementation.
7. Wire `compare()` into `src/cli.ts` and add command-level unit/smoke assertions.
8. Update package smoke inventory for new gallery runtime modules.
9. Run unit tests, smoke, and lint.

**Step 3 is not optional and is deliberately early.** The first draft deferred
all real visual review to CLI wiring at the end, leaving string assertions as the
only check on the UI in between. That is exactly the gap this repo's own rule
targets: *an unviewed UI change does not ship*, and this project builds the tool
that makes that gate cheap, so it is held to its own standard. Concretely, string
assertions cannot catch broken data-URI insertion, a detail pane that does not
update, an empty state that throws, or a placeholder that reads as a successful
comparison. During E4.P's own mockup round, static inspection passed a layout
that was visibly broken when rendered — the failure mode is not hypothetical.

*(Redteam finding 6, accepted.)*

## Acceptance Mapping

| Step | Acceptance |
|---|---|
| 1 | Exact-name pairing, every pair state, not-comparable count rule, attention-first ordering |
| 2 | Owner-signed-off option B layout, rename limitation visible, no difference view |
| 3 | Durable compare artifact written atomically under configured output dir |
| 4 | Basenames plus `latest` only; missing/incomplete/identical runs handled |
| 5 | Exact CLI usage and parser behavior |
| 6 | `shotwright compare A B` renders and exits 0 on review states |
| 7 | Published package includes compare runtime |
| 8 | E4 invariant checks and regression coverage are enforceable |

## Risks And Rollback

Primary risk: false reporting a name-matched pair as successfully compared when one side's image is unreadable. Pin: model unit tests for `not-comparable`, render tests for unreadable copy, and smoke/unit diagnostics assertions.

Secondary risk: accidental visual-regression vocabulary or exit-code gating. Pin: parser tests exclude threshold-like flags, render tests assert review-only copy, and smoke asserts exit 0 despite unmatched states.

Output-layout risk: adding `<outputDir>/compare` extends the output tree currently documented as run directories plus `latest` (`docs/design.md:72`). Rollback is straightforward before external adoption: remove the compare directory writer and command. After users script against the path, changing it would require compatibility output or a deprecation window.

Rendering risk: shared-helper extraction could accidentally perturb `renderGallery()` output. Pin: existing deterministic gallery render tests should stay byte-identical for unchanged inputs (`test/unit/gallery-render.test.ts:96`). Do not refactor the document shell.

Payload risk: compare pages can grow roughly with readable image sides. Pin: E4 smoke checks the demo pair is bounded; large-corpus behavior becomes a named follow-up at 60-vs-60.

## ADR Needed?

**Yes — an ADR is required for the output-location convention.** This reverses
the first draft's conclusion.

The draft argued the location is "a scoped CLI artifact convention" needing no
ADR, while its own Risks section conceded that "after users script against the
path, changing it would require compatibility output or a deprecation window."
Those two statements cannot both stand. A path users script against is a public
surface, and CLAUDE.md requires ADRs at decision-time for binding choices rather
than retroactively at the epic-close gate.

The ADR must decide and record:

- The compare artifact's location and filename convention.
- **The separator.** `__vs__` is not safe as drafted: `validateRunId()`
  (`src/gallery/resolve.ts:28`) accepts any single basename, so a directory named
  `foo__vs__bar` is legal and yields the ambiguous `foo__vs__bar__vs__baz.html`.
  Generated run ids are `<timestamp>_<4hex>` and never contain `__vs__`, so this
  is only reachable via a hand-named run directory — narrow, but the ambiguity is
  free to avoid. Options: a separator that `validateRunId()` rejects, a
  subdirectory per pair, or a short deterministic hash of the two canonical run
  ids with the ids shown in-page.
- Whether `<outputDir>/compare/` is acceptable given `docs/design.md:72`
  currently documents the output tree as run directories plus `latest`.

An ADR is *additionally* required if E4.I changes the serialized manifest, adds
stable shot ids, introduces caller-configurable compare storage, adds an
external/hybrid asset mode, adds server behaviour for compare, or introduces any
pixel threshold/baseline mechanism.

*(Redteam finding 4, accepted. The finding's path-length concern is declined:
run ids are ~24 characters, so a paired filename is ~57 and nowhere near a limit.
The separator ambiguity and the ADR question are the parts with bite.)*

An ADR would become required if E4.I changes the serialized manifest, adds stable shot ids, introduces caller-configurable compare storage, adds an external/hybrid asset mode, adds server behavior for compare, or introduces any pixel threshold/baseline mechanism.

## Explicit Non-Goals

- No pixel difference view.
- No swipe, onion-skin, overlay, red/green diff, perceptual diff, or hidden hooks for those modes.
- No baselines, stored references, thresholds, tolerances, scores, expected images, or pass/fail verdicts.
- No exit-code gating based on visual differences, unmatched names, or unreadable images once HTML renders.
- No path/index run selectors beyond basenames plus `latest`.
- No duplicate-name revalidation in compare.
- No stable shot id or rename detection.
- No compare server or LAN serving mode.
- No shared document-shell refactor of `renderGallery()`.
- No large-corpus externalization/hybrid asset mode in E4.
- No caller-specified output path in E4.

## Open Questions

One, and it is deliberately deferred to E4.I's ADR rather than guessed at here:
the exact compare filename convention and separator (see **ADR Needed?**). The
location — a `compare/` namespace under the configured output dir — is settled;
the naming within it is not.

---

## Redteam Record (P→I gate)

An independent review pass examined this plan against the code with a brief to argue
against it, and to try to defeat the invariant checks. Verdict on the first
draft: **not fit to gate**. Its citation audit checked 22 references; the
substantive claims held, with several citations pointing at a function's opening
line rather than the lines carrying the behaviour (noted below). Six findings
accepted, one declined.

**Accepted and folded in:**

1. *FIX-NOW* — 93 absolute host paths in the drafted plan text, against
   `docs/design.md:38`. Scrubbed to repo-relative before commit. Worth naming as
   a pattern rather than a slip: this is the third artifact this epic where a
   delegated draft arrived with absolute machine paths; the leak gate now
   catches that. Treat path scrubbing as a required ingest step on
   every dispatched document, not as a review catch.
2. *FIX-NOW* — `paired` was semantically overloaded, counting not-comparable
   buckets. Renamed to `nameMatched` / `comparable` with a stated arithmetic
   invariant (Data Model).
3. *FIX-NOW* — empty, no-common-names, and all-not-comparable states were
   unspecified. Now a table with exact copy (Degenerate States). The redteam also
   named this as the plan's single most important omission.
4. *PRACTICAL-BITE* — the output path is user-visible lock-in and `__vs__` is
   ambiguous. ADR now required, reversing the draft's conclusion (ADR Needed?).
5. *PRACTICAL-BITE* — module split ahead of need. `CompareSide` dropped (it was
   declared and never referenced); `searchText`/`attention` dropped as
   precomputed fields with one consumer; `compare-assets.ts` and
   `compare-resolve.ts` both dropped into existing files.
6. *PRACTICAL-BITE* — sequencing deferred real visual review to the end. A
   render-and-look step is now step 3 of 9.

**Declined, with reason:** compare should not re-validate duplicate shot names.
Enforced twice already (`src/manifest.ts:91`, `src/gallery/model.ts:147`); a
third validator would duplicate policy with no reachable scenario in this repo's
usage. Recorded, not filed.

**Partially declined:** the path-length concern within finding 4. Run ids are
~24 characters, so a paired filename is ~57 — nowhere near a filesystem limit.
The separator ambiguity from the same finding was accepted.

**Kept against the redteam's objection:** the `compare-model` / `render-compare`
/ `generate-compare` module split. The redteam argued for fewer modules, but this
mirrors the existing and proven `model` / `render` / `generate` structure in
`src/gallery/`, so it is consistency with a shipped pattern rather than a novel
abstraction. The trims above remove the parts that had no such precedent.

**On the invariant checks:** the redteam was asked to defeat checks 1–4 and
succeeded. Its recipe is quoted verbatim in Invariant Checks, and check 5 was
added to close it. This is the most valuable single output of the gate — the
first four checks constrain vocabulary and exit status, not computation, and
would have let a scored diff through while every check reported green.

**Citation-precision note.** Several plan citations point at a function's
declaration line rather than the lines implementing the behaviour cited
(`resolve.ts:43` for a return shape actually at 76–81; `model.ts:322` for
preservation actually at 323–345; `generate.ts:27` for a write/rename actually at
32–35; `render.ts:301` for badge text actually at 302). The claims are true and
the target functions are correct, so these are imprecise rather than wrong, and
have been left as-is. E4.I should read the surrounding function, not the single
cited line.
