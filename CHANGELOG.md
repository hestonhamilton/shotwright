# shotwright

## 0.5.0

### Minor Changes

- 6690b4d: Inspect two screenshots together in the compare dialog with side by side, swipe, and onion skin views. Size changes remain aligned at the top left for visual review.
- 5b9ed24: Open gallery and compare screenshots in a fitted viewer with actual device pixel zoom. Add visible search result counts, recoverable empty states, and clear device scale wording.

### Patch Changes

- 1188900: Clarify gallery video and trace labels, including missing links and file placement. Comparison pages now explain where linked downloads must remain.
- d778738: Make compare galleries easier to scan with a concise outcome summary, state filters, and links to each pair. Keep comparison settings and provenance details available in a disclosure.
- fc55436: Navigate filtered gallery screenshots with arrow keys or Previous and Next buttons. The viewer shows the current position and returns focus to the screenshot last viewed.
- cdfaa52: Collapse run facts on narrow gallery screens so the first screenshot is visible sooner. Keep search and viewport filters disabled when JavaScript is unavailable.

## 0.4.0

### Minor Changes

- 8c043e9: ## Upgrading from 0.3.0
  
  - `shotwright run` and `--list` now refuse a config that combines explicit
    `projects` with harness top-level `viewport` or `deviceScaleFactor`, which
    were previously ignored; move those values into each `project.use`. `runs`,
    `gallery` and `compare` still read existing runs from such a config. Pass
    `projects: base.projects` to retain project-level `grep`/`grepInvert` when
    adapting a base config. With the default `shots` project, its device settings
    take precedence over `use.viewport` and `use.deviceScaleFactor`.
  - Every shot `check` now runs under `--only`, including when its capture is
    filtered out. This reverses 0.3.0's skipped filtered checks: audit expensive
    or state-changing checks and checks that read earlier PNGs the filter may omit.
    A failed check fails the test without writing that shot's PNG or sidecar.
  - Node 20 and Node 22.0–22.11 are no longer supported. Upgrade to Node
    `>=22.12.0`. npm's `engines` check warns by default and refuses installation
    only with `engine-strict`. This remains an ESM-only package; synchronous
    CommonJS `require()` can load its exports from Node 22.12.0 only while the
    module graph has no top-level `await`.
  
  ## Additions
  
  - Add optional per-shot `note` text to `shot()`. Notes appear on gallery cards
    and in search, with escaped text, bounded keyboard-scrollable cards, and an
    edge shadow when they overflow. Notes do not change shot identity or compare
    results; older galleries ignore the new field.
  - Copy path artifacts in bounded chunks. A source that cannot be opened leaves
    the prior retry artifact in place; a failed copy removes its incomplete
    destination claim.
  - Document Playwright's `test.info().outputPath()` scratch workflow for
    generated artifacts: inspect and publish the same source path before the
    test ends. The reporter removes the run scratch directory on ordinary exit.

## 0.3.0

### Minor Changes

- 36e7cb3: Add exact artifact ignore, configurable compare threshold, strict similar gating, and separate measured, ignored, and gated counts.
- b6e172c: `shotwright compare` exit codes now follow the diff(1) convention: 1 means only "a gated pair remains under `--fail-on-change`", and 2 means any error, both usage errors (invalid or out-of-range `--threshold`, duplicate or unknown flags, wrong number of run selectors, unmatched `--ignore`) and runtime failures (missing config, unknown or unreadable run, both selectors resolving to the same run, an `--output` inside a compared run). Previously argument and runtime errors exited 1, indistinguishable from a gated change. Scripts that treated any non-zero status as "changed" should check for 1 specifically.
- 3af9741: Show full test title paths on gallery cards and include them in card search.
- dc6b87c: Use loaded spec identity for helper-registered tests, allow safe nested artifact names, preserve claimed screenshot bytes, and record test title paths and structural run errors.
- ea01a97: Record observed platform, browser, and Linux Chromium executable identity in the manifest without changing consumer launch arguments.
- 4e9b49b: Show recorded render provenance in gallery and compare headers, and add advisory provenance to compare JSON.
- e7916fe: Pass animation, caret, mask, and screenshot style options through `shot()` to Playwright page and locator captures without changing omitted-option defaults.

### Patch Changes

- cdb110c: Label command errors with the command that failed, including shared config probe
  and run selection failures. Clarify test and shot selection in the README and
  remove a stale workflow template version from the migration guide.
- f283d4b: The compare page now follows the viewer's dark-mode setting.
- ec7cde3: `shotwright compare` no longer leaves a half-published output when it replaces an existing page. Before, if renaming one output file into place failed after another had already been replaced, the new HTML could sit beside a stale `compare.json` (or stale diff PNGs) while the command exited 2. Now each replaced file is backed up first and restored if a later rename fails, so the previous output stays whole. If a restore itself fails, the error names exactly which files hold the new output. The HTML is now published last on both the replacing and the first-write paths. On filesystems without hard links, the backup is a copy. A failure to prune stale diff PNGs after a complete publish is now reported as a diagnostic rather than an error (a file a concurrent run already removed is not reported), so the `wrote` line and the gate verdict (exit 0 or 1) still print.
- ec098f9: Both gallery pages now end with a one-line footer, `Generated by shotwright <version> · <license> · source: <url>`, read from the package's own package.json (or `source: not recorded` when it names no http(s) repository), so a fork that serves a modified gallery has one obvious place to offer its source (AGPL-3.0 section 13). Nothing is fetched; the URL is a plain link.
- 60c7a6f: Compare cards for pairs that count toward the gate are now badged `counted by gate` (and strict-gated `similar` cards get a distinct edge colour), derived from the same predicate as the header's gated count.

## 0.2.0

### Minor Changes

- 474e5c8: Add `shotwright --version` (and `-v`), which prints the installed package version. It helps with bug reports and with checking which version pnpm actually resolved.
- f2e3064: Add compare and gallery review controls. `shotwright compare --fail-on-change` exits 1 when any shot or artifact pair is not identical or similar; without it, compare still exits 0 after writing the page, and every run now prints the gate verdict with each state's count. `shotwright compare --output <file.html>` places the page anywhere outside the two compared runs, with its `compare.json` and diff PNGs beside it. Two runs with the same directory name now compare under a stem carrying a short digest of each run path instead of being refused. `shotwright gallery --include-traces` serves Playwright traces on a non-loopback bind such as `--lan`, which otherwise withholds them. An unreadable screenshot now gets the same reason in the gallery placeholder and in the compare pair.
- 6640422: Add invocation run directory reporting, run discovery, and selectors for failed and downloaded runs.
- 80c8e91: Make the reusable CI workflow work with npm, pnpm, or yarn packages in repository subdirectories. Upload the current invocation's run directory after failed captures, with trace recording off by default. `shotwright init` now places workflow and skill files at the containing Git root and prints commands for the selected package manager.
- b2c6b68: Record run and test outcomes in manifest v2, retain failed-run evidence, allow shot names to repeat across specs, and add `artifact()` and `shot({ check })` for data and verified capture flows. Existing v1 run manifests remain readable; capture paths now omit the `.shots.ts` suffix.
- 8a54b7d: Add seven-state screenshot and artifact comparison with diff PNGs, `compare.json`, run and test outcome badges, failure evidence and capped data previews. Local gallery serving permits traces on loopback; other binds require an explicit override.
  
  A 250-pair fixture using 390×844, 1280×720 and 1440×960 PNGs measured 8,936 ms generation time, 2,467,946,496 bytes peak RSS, and 6,975,407 output HTML bytes on the implementation worktree (2026-10-22). These are measurements, not limits.
- c3daa6e: Document the 0.2.0 migration for ordered Playwright flows, manifest v2 and
  legacy v1 reads, retained failure evidence, spec-scoped shot identity, data
  artifacts, seven-state comparisons with an opt-in parity gate, run discovery,
  trace controls, and nested npm/pnpm/yarn consumers. See the
  [0.2.0 migration guide](../docs/shotwright-746.28-migration.md) for changed
  paths, mixed-run behavior, commands, and compatibility notes.

### Patch Changes

- 77ee642: Allow comparing two external run paths when the configured output directory is
  missing. Without `--output`, write the comparison beside run A in `compare/`.
  Refuse to overwrite an existing page there unless its sidecar identifies the
  same run pair; use `--output` to choose another file.

## 0.1.1

### Patch Changes

- cc7a73d: Gallery: closing the 1:1 inspection dialog no longer pulls keyboard focus back
  to the Inspect button when focus has already moved elsewhere, for example to
  the search box after pressing `/` straight after Escape.

## 0.1.0

### Patch Changes

- a7df4f1: First release. `shotwright run` captures screenshots, videos and traces from
  `*.shots.ts` walkthroughs; `shotwright gallery` builds a self-contained review
  page and serves it on loopback; `shotwright compare` renders two runs side by
  side; `shotwright init` installs the config, scripts, CI workflow and the
  `shots-harness` agent skill into a consuming project.
