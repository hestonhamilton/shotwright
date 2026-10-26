# E11 consumer follow-up — verification

**Bead:** `shotwright-746.32.5` (E11.V) · **Epic:** `shotwright-746.32` · **Phase:** Verify · **Date:** 2026-10-26

## Method

Every repro in the [consumer brief](shotwright-746.32-consumer-brief.md), including its follow-up section, was re-run against the **packed build** of `main` at `9c04046`, which contains every E11 wave (W1–W5). This follows the packed-consumer pattern of `test/smoke/packed-cjs.test.ts`, but uses a real install instead of an extraction:

```sh
pnpm install --frozen-lockfile && pnpm build
npm pack --pack-destination local/e11v                    # shotwright-0.2.0.tgz, 53 files
cd local/e11v/consumer                                     # throwaway project: {"type":"module"}
npm install ../shotwright-0.2.0.tgz @playwright/test@1.64.1
```

The consumer reported its results against Playwright 1.64.0 and Node 24.14.1. This run used Playwright **1.64.1**, the repository's pinned version (`package.json:62`), on Node **24.16.0**, with Debian 12 and the managed Chromium headless shell 156.0.8078.4. The tarball is still versioned `0.2.0`, because the seven pending changesets under `.changeset/` are not yet versioned: six `minor` (`compare-controls`, `gallery-card-title-path`, `loaded-spec-safe-capture`, `observed-render-provenance`, `provenance-presentation`, `shot-screenshot-options`) and one `patch` (`command-errors-test-selection`). The plan's "check combined changesets" step gives one result: together they make a **0.3.0** minor release. The gallery header therefore reads `shotwright 0.2.0`, even though it runs the E11 code.

The consumer config was `defineShotsConfig({ shotsDir: 'shots', outputDir: 'shots-output', viewport: { width: 480, height: 320 }, deviceScaleFactor: 1 })`. Every command below ran from the consumer directory through `npx shotwright`, the packed bin. Host paths in the output excerpts are shortened to `…`.

## Results

| # | Item | 0.2.0 (brief) | Now | Result |
|---|---|---|---|---|
| A3 | Helper-registered table spec | every test fails, `unsupported spec match helpers/table.ts` | 2/2 pass, spec `t.shots.ts`, files `shots/t/{a,b}.png` | **PASS** |
| B1 | Duplicate shot name | both pass, second PNG overwrites, then no manifest | second test fails early, first PNG kept, failed manifest and gallery published, `latest` unchanged | **PASS** |
| A1 | Binary artifacts under `--fail-on-change` | always `changed`, exit 1 | exit 1 without `--ignore`; exit 0 with `--ignore book.shots.ts/report.xlsx`; pair stays visible as `changed · ignored for gate`; typo rejected | **PASS** |
| N2 | Card titles | no test title on cards | `table rows › a` on each card; search matches describe and test titles | **PASS** |
| N2 | Notes | n/a | not implemented, by decision (research, N2 row) | **DECLINED** (recorded) |
| A2 | `--threshold` / `--strict` | fixed at 0.1; `similar` always passes | `--threshold 0` turns `similar` into `changed`; `--strict` gates `similar`; out-of-range rejected | **PASS** |
| N1 | Artifact subpaths and traversal | `invalid shot name "sub/x.txt"` | `sub/x.txt` written to `data/paths/sub/x.txt`; `../`, inner `..` and absolute names rejected as "artifact name"; nothing escapes | **PASS** |
| D4 | Bare `playwright test -c` | refuses with a full stack trace | unchanged: exit 1, first line names `shotwright run`, followed by the stack; no run directory created | **DECLINED** (behaves as decided) |
| D3 | `require()` on the Node floor | `engines >=20`, no `require` condition | unchanged by decision. `require()` works on 22.21.0 and 24.16.0. **Node 20.x is not installed, so the floor itself was not tested** | **DECLINED**; floor untested |
| A4 | Provenance across environments | no warning | `compare.json.provenance` = `known-fields-differ` (or `unavailable`) plus a header banner; verdicts, gate and exit unchanged | **PASS** (simulated environment). No font-list hash is recorded: owner decision A4 scoped the banner to platform, distribution and the actual browser name and version, without a font digest (the brief's A4 fix proposed one, `docs/shotwright-746.32-consumer-brief.md:98`; its follow-up scopes it out, line 110-111) |
| A5 | `shot()` screenshot options | not passed through | byte-identical to `page.screenshot()` / `locator.screenshot()` with the same options; default caret is hidden | **PASS** |
| F1 | Review-based baselines | requested | declined (ADR 0024). The README "Baselines and assertions" recipe was run and is accurate | **DECLINED**; recipe **PASS** |
| D1, D2, N3 | Spot checks (out of E11 scope, `shotwright-746.32.1`) | wrong command prefix; migration guide pins `@v0.1.1`; undocumented `-g` | `shotwright compare:` prefix; D2 fixed in `docs/shotwright-746.28-migration.md:131-138`, which now describes the template as the 0.2.0 reusable workflow and shows `@v0.1.1` only as the "Before" line, `@v0.2.0` as "After"; `-g '^b$'` finds no tests, `-g 'b$'` runs `b`, as the README says | PASS (spot check) |

Gates: `pnpm run typecheck && pnpm run lint && pnpm run test` passed (21 files, 522 passed, 1 skipped: `test/unit/provenance.test.ts`, "identifies headed Chromium under a display", line 61, skipped because this host has no `DISPLAY`; see [Gates](#gates)). `pnpm run smoke` passed as well (3 files, 54 tests); see [Gates](#gates).

No product defect was found. The [Observations](#observations) section lists three non-blocking findings.

## A3 — spec identity from a helper file

Repro: `shots/helpers/table.ts` registers one `walkthrough()` per row inside `walkthrough.describe('table rows', …)`, and each test calls `shot()` and `artifact()`. `shots/t.shots.ts` calls `table(['a', 'b'])`. This wraps the helper in `walkthrough.describe('table rows', …)`, unlike the brief's verbatim helper, which calls `walkthrough()` directly. The redteam also ran the verbatim form, and it passes: exit 0, spec `verbatim.shots.ts`, files `shots/verbatim/{p,q}.png`, `titlePath` `[["p"], ["q"]]`.

```
$ npx shotwright run -- shots/t.shots.ts
  ✓  1 [shots] › shots/helpers/table.ts:5:7 › table rows › a (168ms)
  ✓  2 [shots] › shots/helpers/table.ts:5:7 › table rows › b (40ms)
  2 passed (531ms)
EXIT=0
```

Manifest excerpt: shots `{name: "a", spec: "t.shots.ts", file: "shots/t/a.png"}` and the same for `b`. Artifacts are `data/t/a.txt` and `data/t/b.txt`. Tests carry `titlePath: ["table rows", "a"]`. Neither `manifest.json` nor `gallery.html` contains the home directory (`grep -c` = 0). The same run also passes when the packed CLI runs under Node 22.21.0.

Code: `loadedSpec()` derives the spec from `TestInfo.titlePath[0]` (`src/capture.ts:46-56`). The reporter walks to the `file` suite for `titlePath` ancestors (`src/reporter.ts:73-76`).

## B1 — duplicate shot name

Repro: the brief's spec verbatim. Tests `one` and `two` each `shot(page, 'dup')`, with the default `fullyParallel: false`.

```
$ npx shotwright run -- shots/dup.shots.ts
  ✓  1 [shots] › shots/dup.shots.ts:2:1 › one (170ms)
  ✘  2 [shots] › shots/dup.shots.ts:3:1 › two (31ms)
    Error: shotwright: duplicate shot name "dup" in dup.shots.ts
        at claimShot (…/node_modules/shotwright/dist/capture.js:94:11)
shotwright: 1 shot(s) → …/shots-output/2026-10-26T22-22-40_eda2
EXIT=1
$ npx shotwright runs
2026-10-26T22-22-40_eda2  …  failed  ok  1  -
2026-10-26T22-22-32_d8dc  …  passed  ok  2  -
```

The failed run has `manifest.json`, `gallery.html`, `shots/` and `failures/`. Its manifest records `status: failed` and `runError: null`, with one shot, `dup`, and tests `one: passed` and `two: failed`. `latest` still points at the earlier passed run. Viewed, `shots/dup/dup.png` shows **x**: the first claimant's image survived.

Code: exclusive create with `O_CREAT | O_EXCL | O_NOFOLLOW` (`src/capture.ts:94`). The duplicate error is thrown at `src/capture.ts:128`, before capture (`src/capture.ts:174`).

## A1 — binary artifacts with `--fail-on-change` and `--ignore`

Repro: `shots/book.shots.ts` writes `report.xlsx` with MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Its bytes are a ZIP magic number followed by a `<dcterms:created>` element holding the current ISO timestamp. This is a **stand-in** for a workbook writer: same content, different bytes on every run. No real spreadsheet library was used. The spec also writes an identical `summary.json`, an identical `export-page` shot, and a `tint` shot (see A2). It ran twice: run A `…22-22-49_e9d9` and run B `…22-22-51_82d0`.

| Command (`npx shotwright compare A B --output ../cmp/out.html …`) | Exit | Summary line (excerpt) |
|---|---|---|
| *(none)* | 0 | `1 measured non-parity pair; identical 2, similar 1, changed 1 …; ignored non-parity 0, gated 1; report only (exit 0)` |
| `--fail-on-change` | **1** | `… ignored non-parity 0, gated 1; --fail-on-change: fail (exit 1)` |
| `--fail-on-change --ignore book.shots.ts/report.xlsx` | **0** | `1 measured non-parity pair; … changed 1 …; ignored non-parity 1, gated 0; --fail-on-change: pass` |
| `--fail-on-change --ignore book.shots.ts/repot.xlsx` | 2 | `shotwright compare: --ignore did not match an artifact: book.shots.ts/repot.xlsx` |

`compare.json` for the ignored case:

```
settings: {"threshold": 0.1, "includeAA": false, "ignore": ["book.shots.ts/report.xlsx"], "strict": false, "source": "default"}
gate:     {"measuredNonParity": 1, "ignoredNonParity": 1, "nonParity": 0, "failOnChange": true}
pairs:    report.xlsx artifact changed ignored=true | export-page shot identical | tint shot similar | summary.json artifact identical
```

The ignored pair keeps its measured `changed` state. The HTML card is badged `artifact · changed · ignored for gate` (`src/gallery/render-compare.ts:71`), and the header reads `Gate: measured non-parity 1 · ignored non-parity 1 · gated pairs 0` (screenshot `compare-ignore`). Code: the typo is rejected at `src/gallery/generate-compare.ts:112`, and the gate counts are computed at `src/gallery/generate-compare.ts:162-177`.

## N2 — card titles (notes declined)

Repro: the A3 run's gallery (`…22-22-32_d8dc/gallery.html`).

- **Titles:** each card shows `table rows › a` or `table rows › b` under the shot name (screenshots `gallery-titles-1440` and `-390`). Rendering is at `src/gallery/render.ts:118`.
- **Search** was driven with Playwright in the search box. `data-search` is set at `src/gallery/render.ts:146`.
  - `"table rows"` shows 2 cards: `a t.shots.ts table rows › a` and `b t.shots.ts table rows › b`.
  - `"rows › b"` shows 1 card.
  - `"nomatch"` shows 0 cards.
- **Notes:** a per-card note API was **declined**. The research recommendation is "Do not add a `note` option or shot field" (`docs/shotwright-746.32-research.md:21`). Nothing to verify.

## A2 — `--threshold` and `--strict`

Repro: in the same two runs, `tint` is a full-page `rgb(200,0,0)` in A and `rgb(201,0,0)` in B. The bytes differ, but no pixel exceeds the 0.1 threshold, so the pair measures `similar` (`0 / 153600 different pixels`).

| Extra flags (with A and B as above) | Exit | Summary line (excerpt) |
|---|---|---|
| `--ignore …/report.xlsx --strict` | 0 | `… similar 1, changed 1 …; ignored non-parity 1, gated 1; report only (exit 0)` |
| `--fail-on-change --ignore …/report.xlsx --strict` | **1** | `… ignored non-parity 1, gated 1; --fail-on-change: fail (exit 1)` |
| `--fail-on-change --ignore …/report.xlsx --threshold 0` | **1** | `2 measured non-parity pairs; identical 2, similar 0, changed 2 …; ignored non-parity 1, gated 1` |
| `--threshold 1.5` | 1 | `shotwright compare: --threshold must be a number between 0 and 1` |

Under `--strict`, the gate counts the similar pair without calling it measured non-parity, so "measured non-parity" stays 1. The HTML header reads `strict on` and `gated pairs 1` (screenshot `compare-strict`). Parsing is at `src/cli.ts:300-308`, and the strict condition at `src/gallery/generate-compare.ts:177`.

## N1 — artifact subpaths, including rejected traversal

Repro: `shots/paths.shots.ts` has four tests, which call `artifact('sub/x.txt')`, `artifact('../escape.txt')`, `artifact('sub/../../escape2.txt')` and `artifact('/tmp/abs.txt')`.

```
  ✓  1 [shots] › shots/paths.shots.ts:2:1 › subpath ok (1ms)
  ✘  2 [shots] › shots/paths.shots.ts:5:1 › subpath traversal (0ms)
  ✘  3 [shots] › shots/paths.shots.ts:8:1 › subpath inner traversal (1ms)
  ✘  4 [shots] › shots/paths.shots.ts:11:1 › subpath absolute (1ms)
    Error: shotwright: invalid artifact name "../escape.txt" — it has an empty or dot path segment
    Error: shotwright: invalid artifact name "sub/../../escape2.txt" — it has an empty or dot path segment
    Error: shotwright: invalid artifact name "/tmp/abs.txt" — it is absolute or drive-like
```

The run directory contains only `manifest.json`, `gallery.html`, `data/paths/sub/x.txt` and `failures/`. The manifest artifact is `{name: "sub/x.txt", file: "data/paths/sub/x.txt"}`. No `escape*.txt` exists beside the run or in the output root, and `/tmp/abs.txt` does not exist. The message now says "artifact name" (`src/capture.ts:62-68`). Symlink-swap cases were not re-run by hand; they are covered by the W1 unit and smoke pins. Likewise, these plan items were covered by existing pins and not re-run by hand: B1 late-duplicate recovery with `runError` set (W1.3, `test/unit/reporter-gallery.test.ts`), `--retries=2` claim ownership (`test/smoke/contract-consumer.test.ts`), the N2 old-v2 `[title]` fallback (`test/unit/gallery-model.test.ts`), and `shotwright-746.11` executable identity (W3a, `test/unit/provenance.test.ts`).

## D4 — bare `playwright test -c` (declined)

```
$ npx playwright test -c shots.config.ts
Error: shotwright: use `shotwright run` to execute capture specs
    at defineShotsConfig (file://…/node_modules/shotwright/dist/index.js:34:15)
    at file://…/shots.config.ts:2:16
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    … (Playwright requireOrImport / loadUserConfig / runTests frames)
EXIT=1   (12 stderr lines after npx's notices)
```

This matches the decision to decline (`docs/shotwright-746.32-research.md:23`). The early throw stays (`src/index.ts:50`), and its first line names `shotwright run`. No run directory was created: the output root still held the same five runs plus `latest`.

## D3 — `require()` and the Node floor (declined)

`engines` is `{"node": ">=20"}` (`package.json:12-14`). The exports carry only `types` and `default`, with no `require` condition. The README states the CommonJS floor `^20.19.0 || >=22.12.0` (`README.md:32-33`). This is unchanged, by decision (`docs/shotwright-746.32-research.md:22`).

The packed consumer ran `req.cjs`, which `require()`s `shotwright`, `shotwright/capture` and `shotwright/reporter`:

```
v24.16.0 function function function function   EXIT=0
v22.21.0 function function function function   EXIT=0
```

**No Node 20.x is installed on this host.** Neither the declared engine floor (20.0) nor the documented CJS floor (20.19.0, 22.12.0) was tested; only 22.21.0 and 24.16.0 were. The repository's `test/smoke/packed-cjs.test.ts` skips below the floor as well. The floor remains unverified here.

## A4 — cross-environment provenance (simulated)

Repro: run B's directory was **copied and its `manifest.json` hand-edited** to simulate a second environment. No second distribution or browser was actually used. Each copy sits under a directory named after its `runId`, because compare rejects a manifest whose `runId` does not match its directory name. This is correct validation, and it was first hit when the copy kept a different name.

- `sim/b`: `environment.distribution` set to `{id: ubuntu, versionId: 24.04}`, and the `shots` browser version set to `155.0.7999.0`.
- `sim/u`: `environment` set to `null`, and `browsers[0].executable` set to `null`.

| Compare | `compare.json` `provenance` | Header banner |
|---|---|---|
| A vs B (real, same host) | `{"status": "no-known-difference", "differences": [], "unavailable": []}` | `No known render environment difference (recorded fields only)` |
| A vs `sim/b` | `{"status": "known-fields-differ", "differences": ["distribution: debian 12 → ubuntu 24.04", "shots browser version: 156.0.8078.4 → 155.0.7999.0"], "unavailable": []}` | `Render environments differ: distribution: debian 12 → ubuntu 24.04; shots browser version: 156.0.8078.4 → 155.0.7999.0` |
| A vs `sim/u` | `{"status": "unavailable", "differences": [], "unavailable": ["B: platform unknown", "B: distribution unknown"]}` | `Render environment provenance incomplete: B: platform unknown; B: distribution unknown` |

Both simulated compares ran with `--fail-on-change --ignore book.shots.ts/report.xlsx`. They kept the same counts as the real compare (`identical 2, similar 1, changed 1; gated 0`) and exited 0, so provenance does not affect the verdicts, the gate or the exit status. The nulled executable does not appear under `unavailable`, because the executable is recorded but deliberately not compared (`src/gallery/provenance.ts:23-27`, ADR 0023). The gallery header of a real run shows `Environment: linux · debian 12` and the browser row, `shots: chromium 156.0.8078.4 · executable managed chromium_headless_shell-1248/… · SHA-256 prefix 4fa61f0ba0b4…`, which is cache-relative with no host path.

## A5 — `shot()` options produce the same bytes as `page.screenshot()`

Repro: `shots/opts.shots.ts` runs on a page with an infinite CSS rotation, a focused `<input>` and a `#secret` element. For each case it calls `shot(page, name, opts)`, then compares the written PNG with `page.screenshot({ fullPage: true, ...opts })`. As a control it also compares two back-to-back `page.screenshot()` calls with the same options.

Run 1 of 3. Runs 2 and 3 were identical except as noted below.

```
A5 defaults: shot=6972B page.screenshot=6909B identical=false | control page.screenshot x2 identical=false
A5 animations-caret-hide: shot=6195B page.screenshot=6195B identical=true | control page.screenshot x2 identical=true
A5 mask-style: shot=5073B page.screenshot=5073B identical=true | control page.screenshot x2 identical=true
A5 all-four: shot=5072B page.screenshot=5072B identical=true | control page.screenshot x2 identical=true
A5 static-defaults: identical=true
A5 static-masked: identical-to-direct=true differs-from-unmasked=true
A5 caret-default: equals-page.screenshot-default=true equals-caret-hide=true
A5 locator-style: shot=1263B locator.screenshot=1263B identical=true
```

- **`defaults`** never matches, but neither does Playwright against itself (`control … identical=false`): the rotation is running. On a static page, defaults match byte for byte (`static-defaults`).
- **`mask`/`style`** reach Playwright: `static-masked` matches the direct call and differs from the unmasked capture. The `locator` path matches `locator.screenshot()` with the same options.
- **Default caret** is preserved. `shot()` on a focused input equals both `page.screenshot()` and `caret: 'hide'`, which is the brief's specific point.
- **`all-four`** (with `caret: 'initial'`) mismatched in 1 of 6 runs. A separate probe of 12 `page.screenshot({ caret: 'initial' })` calls, 130 ms apart, gave 2 distinct hashes. The blinking caret makes Playwright's own output nondeterministic under `caret: 'initial'`; this is not a shotwright difference.

## F1 — declined; the README recipe was run

F1 (review-based baselines) is declined in [ADR 0024](adr/0024-review-based-baselines-declined.md). Each step of the README "Baselines and assertions" recipe was run.

1. **`expect.soft` + `toHaveScreenshot()` in a walkthrough.** `shots/assert.shots.ts` calls `await expect.soft(page).toHaveScreenshot('heading.png')`, then `shot(page, 'after-assertion')`.
   - First run: fails with `A snapshot doesn't exist at …/shots/assert.shots.ts-snapshots/heading-shots-linux.png, writing actual.`. This is Playwright's normal first run, which writes the baseline beside the spec, in the committed spec directory.
   - Second run: passes.
   - Third run, heading colour changed: fails with `688 pixels (ratio 0.01 of all image pixels) are different`, exit 1. Its manifest is `failed`, and `after-assertion` was **still captured**, because the assertion is soft. `latest` stayed on the second run. The failed run directory carries `failures/assert/…/heading-{actual,expected,diff}-png.png` and `error-context.md`.

   The README claim "a failed assertion does not stop later captures; the run still fails and does not advance `latest`" holds. One thing the README does not mention: the first run fails until a baseline exists.
2. **Argos.** `npx @argos-ci/cli upload "$RUN_DIR/shots"` (CLI 6.11.0) accepts `<directory>` with default glob `**/*.{png,jpg,jpeg}`, according to its `upload --help`. Without a token it exits 1 with `Missing Argos repository token 'ARGOS_TOKEN'`, which matches the README's statement that `ARGOS_TOKEN` is required. **No upload was performed** (no token); only the command shape and the token requirement were verified.
3. **Local review.** `shotwright compare <chosen-run> latest` printed `selected B … via latest (last fully passed run)` and `changed 1 … report only (exit 0)`. The same compare with the failed run copied to `../downloaded/<run-id>` and passed as a path produced identical output.

## Gallery and compare screenshots

The screenshots were rendered from `file://` with Playwright Chromium at 1440 and 390 width, full page. Each was viewed. All twelve report a horizontal overflow of `0` px. They live under `local/` (gitignored) and are not committed.

| File | What it shows |
|---|---|
| `local/e11v-gallery-titles-1440.png` | A3 run gallery. Header shows `Environment linux · debian 12` and the browser row with a cache-relative managed executable path and SHA-256 prefix. Search placeholder reads "Shot, spec, or test title". Cards `a` and `b` each show `table rows › a/b` under the name, with a `test: passed` badge. Data artifacts `a.txt` and `b.txt` are previewed. |
| `local/e11v-gallery-titles-390.png` | Same at phone width: header facts stack two per row and the browser row wraps; cards stack one per column with the title path visible. The second card's image shows the lazy "Original queued" placeholder in the static capture, which is the expected lazy-load state. |
| `local/e11v-gallery-provenance-1440.png` / `-390.png` | Run B gallery. The same environment and browser header facts; the two `book.shots.ts` cards and artifacts. |
| `local/e11v-compare-ignore-1440.png` / `-390.png` | Header reads `No known render environment difference (recorded fields only)`, `threshold 0.1 · strict off` and `Gate: measured non-parity 1 · ignored non-parity 1 · gated pairs 0 · fail-on-change on`. The `report.xlsx` card is badged `artifact · changed · ignored for gate` (red edge, measured state kept). `tint` is `shot · similar` with `0 / 153600 different pixels`. At 390 the count chips wrap onto three rows. |
| `local/e11v-compare-strict-1440.png` / `-390.png` | Same pairs. The header reads `strict on` and `gated pairs 1`. The `tint` card itself is still badged only `shot · similar` (see Observations). |
| `local/e11v-compare-provenance-differ-1440.png` / `-390.png` | Header line `Render environments differ: distribution: debian 12 → ubuntu 24.04; shots browser version: 156.0.8078.4 → 155.0.7999.0`. At 390 it wraps over three lines inside the header. |
| `local/e11v-compare-provenance-unavailable-1440.png` / `-390.png` | Header line `Render environment provenance incomplete: B: platform unknown; B: distribution unknown`. |

## Observations

These are non-blocking and are not FAILs against the plan.

1. **A strict-gated `similar` pair has no per-card marker.** Under `--strict`, the header says `gated pairs 1`, but the `tint` card's badge is only `shot · similar`. The badge appends text only for `ignored` (`src/gallery/render-compare.ts:71`), so a reviewer must infer which card is gated. To reproduce: compare any two runs with one `similar` pair, using `--strict`. The plan (W2.2) requires the header, JSON, terminal and exit, which all behave correctly.
2. **Inconsistent compare exit codes for usage errors.** An unmatched `--ignore` exits **2** (`src/cli.ts:900-903`). An out-of-range `--threshold` throws during argument parsing (`src/cli.ts:304-305`) and exits **1** through the top-level handler (`src/cli.ts:980-985`). Exit 1 is also the `--fail-on-change` failure code, so a script that runs `compare --threshold 1.5 --fail-on-change` cannot tell a bad flag from a gated change by status alone. The stderr message does distinguish them.
3. **The provenance banner is plain header text.** It renders as an ordinary `<p class="provenance">` line in the dark header (`src/gallery/render-compare.ts:121`), with the same weight as the pairing key line. It is not styled as a warning. The terminal summary does not mention provenance; README promises it only in JSON and the HTML header, so this is consistent.

## Gates

```
$ pnpm run typecheck && pnpm run lint && pnpm run test
… publint / attw esm-only: all entry points 🟢 (ESM)
 Test Files  21 passed (21)
      Tests  522 passed | 1 skipped (523)
EXIT=0
```

The one skip is the headed-Chromium test, which needs a display. Re-run under a virtual display (`xvfb-run` is available on this host):

```
$ xvfb-run -a npx vitest run test/unit/provenance.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

```
$ pnpm run smoke
 Test Files  3 passed (3)
      Tests  54 passed (54)
EXIT=0
```

```
$ bash scripts/ci/leak-gate.sh
layer A ok — 53 file(s), all covered by the allowlist
layer B (shotwright rules): no leaks found
layer C (default credential ruleset): no leaks found
leak gate: PASSED
    files:  53  (baseline 49)
```

The file-count difference from the recorded baseline is informational, not a failure.
