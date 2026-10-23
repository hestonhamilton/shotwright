# shotwright

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
