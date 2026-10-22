# E10 code grounding: first external consumer gaps

## Method

Read the consumer brief, README, design, ADR titles and relevant ADRs (0001, 0002, 0005, 0007, 0009, 0010), all requested source, templates, workflow, package metadata, and unit tests in this worktree. Inspected WIP commit `9de261c` read-only with `git show`. Ran a Node ESM one-off against built `dist/` (output below). Ran `pnpm run typecheck && pnpm run lint && pnpm run test`; the first lint attempt failed because npm's default cache was read-only. Re-ran the same gate chain with `NPM_CONFIG_CACHE="$PWD/local/npm-cache"`; it passed, including `Test Files 18 passed (18)` and `Tests 359 passed (359)`. Browser and GitHub Actions behavior are inferred from code and fixtures; no browser or CI job was launched. Source references below are worktree-relative. The brief's consumer measurements are reported as claims from that brief, not remeasured here.

One-off actual output:

```text
G1/G2 {"fullyParallel":true}
G5 shotwright: duplicate shot name "dup" (in a.shots.ts and b.shots.ts) — shot names must be unique within a run
G3 {}
```

The `G3 {}` line is JSON serialization of a check for run status, tests, and shot testId; all were `undefined`. The attempted G12 parse produced no error because parsing accepts selectors; resolution rejects paths.

## G1 — config passthrough

- **Premise:** confirmed. `ShotsConfigOptions` enumerates fields at `src/index.ts:24-39`; construction picks only those at `src/index.ts:62-89`, while README promises untouched passthrough at `README.md:106-110`. The one-off output above shows omitted `globalSetup`, `workers`, and `timeout`.
- **Repro:** one-off output above; this proves config loss without launching a browser.
- **Write surface:** `src/index.ts` (`ShotsConfigOptions`, `defineShotsConfig`), `README.md`, `test/unit/factory.test.ts`. Shares config factory with G2, G8, G13 probe; README with G2/G9/G11/G13.
- **Pinned tests:** `test/unit/factory.test.ts:16-60` checks present invariants and `use`/webServer passthrough; extend for other Playwright keys. `test/unit/cli.test.ts:251-299` pins probe behavior.
- **Constraint:** preserve `testMatch`, `retries`, reporter, capture toggles, run output (`src/index.ts:64-87`); consuming projects remain thin (`docs/design.md:95-97`). Decide whether `testDir` is harness-owned too.

## G2 — parallel execution

- **Premise:** confirmed: `fullyParallel: true` at `src/index.ts:65`; no option in `ShotsConfigOptions` (`src/index.ts:24-39`).
- **Repro:** one-off output above shows `fullyParallel:true` even when false was passed. Actual host interleaving was not exercised.
- **Write surface:** `src/index.ts` (`ShotsConfigOptions`, `defineShotsConfig`), `README.md`, `test/unit/factory.test.ts`; shared with G1/G8/G13 probe.
- **Pinned tests:** `test/unit/factory.test.ts:16-28` asserts current invariants, including parallel setting; change it.
- **Constraint:** ordered specs fit the runner design (`docs/design.md:33`); recommend documenting serial failure semantics without assuming globally serial execution.

## G3 — run and test outcomes

- **Premise:** confirmed. `Manifest` lacks status/tests and `ShotEntry` lacks testId (`src/manifest.ts:20-42`), though sidecars carry it (`src/manifest.ts:44-55`); assembly discards it (`src/manifest.ts:103-108`). Reporter receives `onTestEnd` and `onEnd` status but saves only artifact paths (`src/reporter.ts:35-38`, `src/reporter.ts:64-78`). Gallery explicitly says status absent (`src/gallery/render.ts:301-304`).
- **Repro:** one-off `G3 {}` above. A shot followed by a failure was not browser-run.
- **Write surface:** `src/manifest.ts` (`ShotEntry`, `Manifest`, `ShotSidecar`, `AssembleInput`, `assembleManifest`), `src/reporter.ts` (`ShotwrightReporter`), `src/index.ts` (type exports), `src/gallery/model.ts` (`validateManifest`, `GalleryModel`), `src/gallery/render.ts` (`renderGallery`), `src/gallery/render-compare.ts` (`renderCompare`), `src/gallery/compare-model.ts` (`CompareModel`), README, tests. Shared with G4/G5/G6/G7/G12/G13 video/G13 verify.
- **Pinned tests:** `test/unit/manifest.test.ts:38-94`, `test/unit/reporter-gallery.test.ts:57-105`, `test/unit/gallery-model.test.ts`, `test/unit/gallery-render.test.ts`, `test/unit/gallery-compare-render.test.ts`. Existing manifest v1 validation (`src/gallery/model.ts:129-168`) requires a version/compatibility decision.
- **Constraint:** atomic manifest publication at `src/runs.ts:44-49` and latest only on passed result at `src/reporter.ts:90-98` must hold. `docs/design.md:82-84` makes manifest the contract; ADR 0001 says layout/manifest changes are public API (`docs/adr/0001-package-on-test-runner.md:39-41`). Define outcomes for retries, skipped tests, crashes and partial manifests.

## G4 — failure evidence removed

- **Premise:** confirmed for `.pw` cleanup: config stages there (`src/index.ts:85-87`), reporter copies only video/trace found on `onTestEnd` (`src/reporter.ts:35-38`, `src/reporter.ts:49-62`), and `onExit` removes all `.pw` (`src/reporter.ts:107-110`). Playwright's printed path and attachment content are inferred, not reproduced here.
- **Repro:** code plus `test/unit/reporter-gallery.test.ts:71-105`; no browser launched.
- **Write surface:** `src/reporter.ts` (`ShotwrightReporter`), `src/manifest.ts` (`Manifest`, test/failure artifact types), `src/gallery/model.ts` (`validateManifest`, `GalleryModel`), `src/gallery/render.ts` (`renderGallery`), `src/gallery/server.ts` (`buildGalleryAllowlist`) if serving failures, tests. Shared with G3/G7/G9/G13 video.
- **Pinned tests:** `test/unit/reporter-gallery.test.ts:57-105`, `test/unit/manifest.test.ts:61-94`, `test/unit/gallery-server.test.ts` allowlist tests.
- **Constraint:** keep atomic manifest and cleanup semantics (`src/reporter.ts:94-109`); retained failure evidence also needs trace access policy (G9).

## G5 — shot identity

- **Premise:** confirmed. Files already use spec/name (`src/capture.ts:74-79`), while assembly rejects global name duplicates only at end (`src/manifest.ts:92-102`), before publish and sidecar cleanup (`src/reporter.ts:64-98`). Gallery validation also rejects global duplicates (`src/gallery/model.ts:147-154`); compare keys only by name (`src/gallery/compare-model.ts:57-72`).
- **Repro:** one-off `G5` error above. The source ordering proves a thrown assembly leaves sidecars and no manifest/gallery for that run.
- **Write surface:** `src/manifest.ts` (`assembleManifest`, `ShotEntry`), `src/gallery/model.ts` (`validateManifest`), `src/gallery/compare-model.ts` (`ComparePair`, `buildCompareModel`), `src/gallery/render-compare.ts` (`renderCompare`), `src/capture.ts` (`shot`) only if duplicate-within-spec is checked at capture, README, tests. Shared with G3/G6/G7/G13 spec suffix.
- **Pinned tests:** `test/unit/manifest.test.ts:53-60`, `test/unit/gallery-model.test.ts`, `test/unit/gallery-compare-model.test.ts:84-222`, `test/unit/gallery-compare-render.test.ts`.
- **Constraint:** owner settled spec + name identity, unique within spec. Preserve rename hints (`src/gallery/render-compare.ts:346`) and manifest contract (`docs/design.md:82-84`). Same-spec duplicate across workers needs an atomic reservation strategy if early failure is desired.

## G6 — compare computation and surface only

- **Premise:** confirmed for missing visual verdict. Model states are `paired`, `a-only`, `b-only`, `not-comparable` (`src/gallery/compare-model.ts:4-28`); `paired` means both PNGs readable (`src/gallery/compare-model.ts:76-88`). Counts track pairability/unmatched names, not pixel equality (`src/gallery/compare-model.ts:103-121`). `readPngModel` validates PNG structure and builds a data URI, without decoding pixels (`src/gallery/model.ts:214-277`). CLI returns success for generated compare absent diagnostics (`src/cli.ts:461-488`). Header says no verdicts (`src/gallery/render-compare.ts:207-245`).
- **Repro:** source inspection and `test/unit/gallery-compare-model.test.ts:84-222`; no pixel comparison executed. No decision on verdict semantics here; external research lane owns it.
- **Write surface:** `src/gallery/compare-model.ts` (`ComparePairState`, `ComparePair`, `CompareCounts`, `CompareModel`, `buildCompareModel`, `comparePairOrder`), `src/gallery/model.ts` (`readPngModel`, `GalleryModel`), `src/gallery/generate-compare.ts` (`generateCompareGallery`), `src/gallery/render-compare.ts` (`renderCompare`), `src/cli.ts` (`CompareArgs`, `parseCompareArgs`, compare command), `package.json` if a decoder is added, tests. Shared with G3/G5/G7/G12.
- **Pinned tests:** `test/unit/gallery-compare-model.test.ts:84-222`, `test/unit/gallery-compare-render.test.ts`, `test/unit/gallery-compare-generate.test.ts`, `test/unit/cli.test.ts:210-240`.
- **Constraint:** an opt-in verdict or fail-on-change conflicts with broad no-golden-gate wording at `docs/design.md:34-36`, `docs/design.md:110-113`, `README.md:16-20`; align any decision with that wording and ADR 0009 output path (`docs/adr/0009-compare-artifact-output-path.md:35-51`).

## G7 — non-image artifacts

- **Premise:** confirmed. Public capture exports only `shot`, `walkthrough`, filtering and validators (`src/capture.ts:18-29`, `src/capture.ts:63-101`); manifest has only shots (`src/manifest.ts:33-42`), and gallery model reads only PNG/video/trace (`src/gallery/model.ts:109-168`, `src/gallery/model.ts:279-367`).
- **Repro:** source-only; a non-image write would be outside the manifest because there is no sidecar type for it (`src/manifest.ts:44-55`).
- **Write surface:** `src/capture.ts` (new `artifact`, options/validation), `src/manifest.ts` (`Manifest`, artifact sidecar/types, `assembleManifest`), `src/reporter.ts` (`ShotwrightReporter`), `src/gallery/model.ts` (`validateManifest`, `GalleryModel`), `src/gallery/render.ts` (`renderGallery`), `src/gallery/server.ts` (`buildGalleryAllowlist`), `src/gallery/compare-model.ts` (`buildCompareModel`), `src/gallery/render-compare.ts` (`renderCompare`), `src/gallery/generate-compare.ts` (`generateCompareGallery`), README and tests. Shares broadest surface with G3/G4/G5/G6/G9.
- **Pinned tests:** `test/unit/capture.test.ts`, `test/unit/manifest.test.ts`, `test/unit/gallery-model.test.ts`, `test/unit/gallery-render.test.ts`, `test/unit/gallery-server.test.ts`, `test/unit/gallery-compare-model.test.ts`, `test/unit/gallery-compare-render.test.ts`.
- **Constraint:** manifest is the contract (`docs/design.md:82-84`); consumers stay thin (`docs/design.md:95-97`). HTML must be rendered as escaped source, and downloaded files must pass the server allowlist (`src/gallery/server.ts:113-150`). Workbook normalisation semantics remain undecided.

## G8 — bare Playwright invocation

- **Premise:** confirmed in code. Without run env, no run directory is made (`src/index.ts:57-60`), config `outputDir` is unset (`src/index.ts:85-89`), and `shot()` throws only when reached (`src/capture.ts:63-70`). Whether Playwright cleans the default `test-results/` is an upstream behavior cited by the brief, not browser-tested here.
- **Repro:** `test/unit/capture.test.ts:11-39` checks the late error; source confirms no factory guard. No potentially destructive bare runner invocation.
- **Write surface:** `src/index.ts` (`defineShotsConfig`), `src/cli.ts` (`probeOutputDir` and probe env convention if changed), `test/unit/factory.test.ts`, `test/unit/cli.test.ts`, `test/unit/capture.test.ts`. Shares config/probe with G1/G2/G13 probe.
- **Pinned tests:** `test/unit/factory.test.ts:60-113`, `test/unit/capture.test.ts:11-39`, `test/unit/cli.test.ts:251-299`.
- **Constraint:** config probe must still evaluate safely (`src/index.ts:43-56`); Playwright `--list` must remain available. A factory throw cannot protect files Playwright cleans before config evaluation unless runner order is verified.

## G9 — trace exposure

- **Premise:** partly confirmed. CLI enables trace with `--trace` (`src/cli.ts:109-145`, `src/cli.ts:411-418`), gallery allowlist serves referenced trace ZIP (`src/gallery/server.ts:127-149`), `--lan` binds wildcard (`src/cli.ts:242-243`), and CI uploads the run (`.github/workflows/shotwright.yml:117-123`). The reported password count is from the brief and was not remeasured; Playwright trace contents need upstream/browser evidence. Videos may contain screen-displayed secrets, but have a different exposure mechanism.
- **Repro:** source and existing server tests; no credential-bearing browser trace created.
- **Write surface:** `src/cli.ts` (`GalleryArgs`, `parseGalleryArgs`, `gallery`), `src/gallery/server.ts` (`buildGalleryAllowlist`, `startGalleryServer`), `.github/workflows/shotwright.yml`, `templates/github/shotwright.yml` if exposing upload control, `README.md`, `templates/skills/shots-harness/SKILL.md`, tests. Shares server with G4/G7 and workflow with G10/G11.
- **Pinned tests:** `test/unit/gallery-server.test.ts` trace allowlist tests, `test/unit/cli.test.ts:137-208`, `test/unit/init.test.ts:252-295`, `test/unit/template-pin.test.ts`.
- **Constraint:** `--lan` currently permits referenced trace files (`src/gallery/server.ts:127-149`); disabling them must not break local access unexpectedly. CI default should remain artifacts-only (`docs/design.md:108-113`).

## G10 — reusable workflow portability and failed-run upload

- **Premise:** confirmed for current branch. Workflow has only `mode` and `config-path` inputs (`.github/workflows/shotwright.yml:3-16`), fixed runner/Node/pnpm/workers (`.github/workflows/shotwright.yml:20-45`, `.github/workflows/shotwright.yml:54-65`), and resolves `latest` after a successful run step (`.github/workflows/shotwright.yml:72-83`); upload lacks `always()` (`.github/workflows/shotwright.yml:117-123`). Existing `if-no-files-found: error` is already explicit, so that subclaim is refuted. Caller workflow already forwards GitHub's inherited secrets context by reusable-workflow mechanism only if caller supplies `secrets: inherit`; template does not (`templates/github/shotwright.yml:1-21`). Arbitrary `env` is not a `workflow_call` context passthrough.
- **Repro:** code inspection; GitHub Actions behavior not re-run. WIP `9de261c` adds `working-directory`, `defaults.run.working-directory`, a package.json/pnpm metadata precheck, pnpm cache path, absolute upload path, and proof fixtures in `proof/`; read-only `git show` confirmed these. It still requires pnpm/packageManager/pnpm lock, uses ubuntu-latest/Node 24/workers 1, selects passed `latest`, and has no failed-run upload, generic output-dir, args, retention, or credential/environment interface. Its self mode may be affected by subdir defaults; test before reuse. The proof branch is not merged into this worktree.
- **Write surface:** `.github/workflows/shotwright.yml`, `templates/github/shotwright.yml`, `scripts/ci/shots.sh` only if shared self/consumer execution changes, `src/cli.ts` (`run`/run listing if used for resolution), `src/runs.ts` (`isCompleteRun`/new selection helper), `src/manifest.ts` (`Manifest.status` from G3), README, tests. Shares workflow/template with G9/G11; runs/manifest with G3/G12.
- **Pinned tests:** `test/unit/template-pin.test.ts`, `test/unit/init.test.ts:252-295`, `test/unit/cli.test.ts:25-145`, `test/unit/runs.test.ts:14-94`. Workflow needs a real Actions proof fixture; unit tests cannot validate its contexts.
- **Constraint:** ADR 0007 explicitly chose a narrow input surface and says expand only for real consumer demand (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:35-45`, `docs/adr/0007-ci-reusable-workflow-same-owner-private.md:73-78`); this consumer is such demand. Template must stay release-tag pinned (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:83-89`). Failed-run upload must distinguish newest attempted run from `latest` (last passed), preserve atomic manifest semantics, and avoid uploading stale prior artifacts. `docs/design.md:110-113` says artifacts-only CI.

## G11 — init in subdirectory / package manager

- **Premise:** confirmed. `planInit(cwd)` writes `.github` and `.claude` relative to cwd (`src/init.ts:165-209`), and follow-up text hardcodes pnpm (`src/init.ts:423-491`). Vite scaffold command also says `pnpm exec vite` (`src/init.ts:79-90`). README install is pnpm-only (`README.md:29-66`).
- **Repro:** existing `test/unit/init.test.ts:286-295` checks planned workflow path; no consumer repository was written.
- **Write surface:** `src/init.ts` (`planInit`, `formatInitResult`, `InitPlan`, `applyInitPlan`), `src/cli.ts` (`init`), `templates/github/shotwright.yml`, `templates/init/shots.config.ts` if scaffold wording changes, `README.md`, `test/unit/init.test.ts`. Shared with G10/G9 workflow and G13 ESM docs.
- **Pinned tests:** `test/unit/init.test.ts:49-90`, `test/unit/init.test.ts:216-295`, `test/unit/init.test.ts:447-460`; path-aware tests should cover root/subdir, symlink and outside-repo cases.
- **Constraint:** avoid writing a root workflow outside the consumer's intended repo; current init's no-overwrite policy (`src/init.ts:285-299`) and thin-consumer rule (`docs/design.md:95-97`) matter. Caller needs G10 working-directory support.

## G12 — run discovery and cross-directory compare

- **Premise:** confirmed. Gallery defaults to `latest` and errors if absent (`src/gallery/resolve.ts:50-72`); compare resolves both selectors under one output directory (`src/gallery/resolve.ts:91-102`); CLI has no `runs` command (`src/cli.ts:64-75`, `src/cli.ts:501-525`). Parser accepts path-shaped strings, but `validateRunId` rejects them at resolution (`src/gallery/resolve.ts:35-47`).
- **Repro:** source plus `test/unit/gallery-resolve.test.ts:71-110`; no filesystem runs were created for this review.
- **Write surface:** `src/cli.ts` (`parseGalleryArgs`, `parseCompareArgs`, `gallery`, `compare`, command dispatch), `src/gallery/resolve.ts` (`resolveGalleryRun`, `resolveCompareRuns`, `validateRunId`, `ResolvedGalleryRun`), `src/runs.ts` (new enumeration), `src/gallery/generate-compare.ts` (`generateCompareGallery`), `src/manifest.ts` (`Manifest.status`), README, tests. Shares with G3/G6/G10.
- **Pinned tests:** `test/unit/gallery-resolve.test.ts:28-110`, `test/unit/cli.test.ts:137-240`, `test/unit/gallery-compare-generate.test.ts`, `test/unit/runs.test.ts`.
- **Constraint:** `latest` must retain last-passed meaning (`src/reporter.ts:90-93`); `--last` needs explicit status/partial-run semantics. ADR 0009 fixes default compare output under one outputDir (`docs/adr/0009-compare-artifact-output-path.md:35-51`); path-based comparisons need a named output ownership rule. Ignore `compare/` while enumerating runs (`docs/adr/0009-compare-artifact-output-path.md:73-78`).

## G13a — spec suffix in shot directory

- **Premise:** confirmed. `shot` derives spec including filename suffix (`src/capture.ts:74-77`), and same value enters manifest (`src/capture.ts:89-99`).
- **Repro:** source-only; `shots/<spec>/<name>.png` literal is explicit at `src/capture.ts:77`.
- **Write surface:** `src/capture.ts` (`shot`, `validateSpecPath`), `src/manifest.ts` (`ShotEntry.spec` if identity meaning changes), `src/gallery/model.ts` (`validateManifest`), README, tests. Shares with G5 identity and G7 capture.
- **Pinned tests:** `test/unit/capture.test.ts:40-67`, `test/unit/manifest.test.ts:42-60`, `test/unit/gallery-model.test.ts`.
- **Constraint:** stripping `.shots.ts` can collide with another spec path in unusual filename layouts; define canonical spec identity separately from display path before changing the public output layout (`docs/design.md:72-84`, ADR 0001 `docs/adr/0001-package-on-test-runner.md:39-41`).

## G13b — opaque video/trace names

- **Premise:** confirmed. Reporter writes `video/<testId>` and `trace/<testId>` (`src/reporter.ts:49-60`); manifest records paths but removes testId from shot (`src/manifest.ts:103-108`).
- **Repro:** source-only; existing `test/unit/manifest.test.ts:61-94` pins artifact path propagation.
- **Write surface:** `src/reporter.ts` (`ShotwrightReporter`), `src/manifest.ts` (`ShotEntry`, `Manifest`), `src/gallery/model.ts` (`validateManifest`), `src/gallery/render.ts` (`renderGallery`), tests. Shared with G3/G4/G9.
- **Pinned tests:** `test/unit/manifest.test.ts:61-94`, `test/unit/reporter-gallery.test.ts`, `test/unit/gallery-render.test.ts`.
- **Constraint:** slug collision across tests/projects/retries must be resolved; keep stable testId in manifest. Current gallery notes test title unavailable (`src/gallery/render.ts:201`).

## G13c — config probe noise

- **Premise:** confirmed from implementation. `probeOutputDir` launches Playwright `--list` (`src/cli.ts:331-353`), and the default probe uses `stdio: 'inherit'` (`src/cli.ts:315-325`), so runner listing reaches terminal. The exact quoted listing depends on Playwright version.
- **Repro:** code plus `test/unit/cli.test.ts:251-299` dependency-injected probe; no real probe invoked.
- **Write surface:** `src/cli.ts` (`ConfigProbeDependencies`, `probeOutputDir`/`invokeProbe`), `test/unit/cli.test.ts`; shared with G8/G12 and G1/G2 config behavior.
- **Pinned tests:** `test/unit/cli.test.ts:251-335`.
- **Constraint:** retain useful failure diagnostics and probe's no-run-dir behavior (`src/index.ts:43-56`).

## G13d — verify-before-shoot hook

- **Premise:** confirmed absence. `ShotOptions` has only fullPage/clip/locator (`src/capture.ts:23-29`); `shot` captures immediately after validation/filter (`src/capture.ts:63-100`). Manifest has no verification marker (`src/manifest.ts:20-31`).
- **Repro:** source-only; a fake `Page` unit test could prove callback order once designed, but is unnecessary to establish absence.
- **Write surface:** `src/capture.ts` (`ShotOptions`, `shot`), `src/manifest.ts` (`ShotSidecar`, `ShotEntry`, `assembleManifest`), `src/gallery/model.ts` (`validateManifest`), `src/gallery/render.ts` (`renderGallery`), README, tests. Shares with G3/G7/G13a.
- **Pinned tests:** `test/unit/capture.test.ts`, `test/unit/manifest.test.ts`, `test/unit/gallery-model.test.ts`, `test/unit/gallery-render.test.ts`.
- **Constraint:** clarify whether `--only` skips the check and whether a thrown check leaves no file/sidecar. Avoid implying verification for captures made without the hook.

## G13e — ESM and Node engine range

- **Premise:** partly confirmed. Package is ESM-only (`package.json:5`, `package.json:25-41`) and advertises Node `>=20` (`package.json:13-15`); no `require` condition exists. The exact Node minor-version boundary asserted by the brief is an upstream runtime fact, not checked against local source. Current `attw --profile esm-only` (`package.json:44-49`) deliberately validates ESM shape.
- **Repro:** package inspection only; no multi-version Node matrix run.
- **Write surface:** `package.json` (`engines.node`, `exports`, scripts), `tsconfig.build.json` and build outputs only if a CommonJS condition is chosen, `README.md`, `test/unit/template-pin.test.ts` or a new package smoke test. Shares README with G1/G9/G11; no direct source overlap otherwise.
- **Pinned tests:** no existing unit test checks CommonJS loading; current lint's `attw --profile esm-only` is the release-facing check.
- **Constraint:** ADR 0010 public npm distribution (`docs/adr/0010-distribution-public-npm-package.md:37-41`) makes engine metadata consumer-facing. Do not promise a `require` branch without packaging proof.

## G13f — full-page default

- **Premise:** confirmed for shotwright: `ShotOptions` documents true (`src/capture.ts:23-29`) and `shot` computes true unless clip/locator (`src/capture.ts:81-87`). The Playwright default assertion comes from the brief, not local source.
- **Repro:** source-only; capture comparison needs browser fixtures for byte identity, which the brief reports but this lane did not remeasure.
- **Write surface:** `README.md` migration notes; `src/capture.ts` (`ShotOptions`, `shot`) only if behavior changes, `test/unit/capture.test.ts` if adding a default test. Shares README with G1/G2/G9/G11/G13e.
- **Pinned tests:** no unit test pins the image default; current `test/unit/capture.test.ts` covers errors only.
- **Constraint:** preserve byte-identical screenshot output for equivalent arguments (consumer brief, final section) and existing documented `fullPage` default (`README.md:89-91`); documentation is the requested fix.

## Write-surface matrix

This maps likely implementation touchpoints, not an authorization to change them in this research bead. Test files mirror the corresponding production rows.

| File | G-items |
|---|---|
| `src/index.ts` | G1, G2, G3 type exports, G8, G13c probe contract |
| `src/capture.ts` | G5 optional early check, G7, G13a, G13d, G13f only if behavior changes |
| `src/manifest.ts` | G3, G4, G5, G7, G10 status dependency, G12 status dependency, G13a, G13b, G13d |
| `src/reporter.ts` | G3, G4, G7, G12 latest semantics, G13b |
| `src/runs.ts` | G3 atomic publish, G10, G12 |
| `src/cli.ts` | G6, G8, G9, G10, G11, G12, G13c |
| `src/init.ts` | G11 |
| `src/gallery/model.ts` | G3, G4, G5, G6, G7, G13a, G13b, G13d |
| `src/gallery/compare-model.ts` | G3, G5, G6, G7 |
| `src/gallery/generate-compare.ts` | G6, G7, G12 |
| `src/gallery/render-compare.ts` | G3, G5, G6, G7 |
| `src/gallery/render.ts` | G3, G4, G7, G13b, G13d |
| `src/gallery/server.ts` | G4, G7, G9 |
| `.github/workflows/shotwright.yml` | G9, G10 |
| `templates/github/shotwright.yml` | G9, G10, G11 |
| `templates/init/shots.config.ts` | G11 |
| `templates/skills/shots-harness/SKILL.md` | G9 |
| `package.json` | G6 optional decoder, G13e |
| `README.md` | G1, G2, G3, G5, G6, G7, G9, G10, G11, G12, G13a, G13d, G13e, G13f |
| `test/unit/factory.test.ts` | G1, G2, G8 |
| `test/unit/capture.test.ts` | G7, G8, G13a, G13d, G13f |
| `test/unit/manifest.test.ts` | G3, G4, G5, G7, G13a, G13b, G13d |
| `test/unit/reporter-gallery.test.ts` | G3, G4, G5, G13b |
| `test/unit/gallery-model.test.ts` | G3, G5, G7, G13a, G13b, G13d |
| `test/unit/gallery-render.test.ts` | G3, G4, G7, G13b, G13d |
| `test/unit/gallery-server.test.ts` | G4, G7, G9 |
| `test/unit/gallery-compare-model.test.ts` | G3, G5, G6, G7 |
| `test/unit/gallery-compare-render.test.ts` | G3, G5, G6, G7 |
| `test/unit/gallery-compare-generate.test.ts` | G6, G7, G12 |
| `test/unit/gallery-resolve.test.ts` | G12 |
| `test/unit/cli.test.ts` | G6, G8, G9, G10, G12, G13c |
| `test/unit/init.test.ts` | G9, G10, G11 |
| `test/unit/runs.test.ts` | G3, G10, G12 |
| `test/unit/template-pin.test.ts` | G9, G10, G13e |

## Premise-check summary

| Item | Result | Why |
|---|---|---|
| G1 | Confirmed | Factory drops unlisted Playwright fields. |
| G2 | Confirmed | Factory forces `fullyParallel: true`. |
| G3 | Confirmed | No run/test outcome or shot testId in manifest. |
| G4 | Partly | `.pw` is always removed; exact Playwright failure attachments were not browser-proved. |
| G5 | Confirmed | Global duplicate check runs during manifest assembly. |
| G6 | Confirmed | Compare computes pairing/readability only, no pixel verdict. |
| G7 | Confirmed | Capture and manifest expose no general artifact API. |
| G8 | Partly | Late `shot()` failure and unset outputDir confirmed; upstream cleanup order untested. |
| G9 | Partly | Exposure path confirmed; credential count/content unmeasured here. |
| G10 | Partly | Current limitations confirmed; `if-no-files-found` is already explicit, and WIP covers subdir/pnpm precheck only. |
| G11 | Confirmed | Init paths and commands are cwd/pnpm based. |
| G12 | Confirmed | `latest` default, no listing, one-root compare. |
| G13a | Confirmed | Spec suffix is part of directory. |
| G13b | Confirmed | Reporter names artifacts by testId. |
| G13c | Confirmed | Probe inherits Playwright stdout/stderr. |
| G13d | Confirmed | No check option or verified marker. |
| G13e | Partly | ESM/engine metadata confirmed; Node minor boundary not checked. |
| G13f | Partly | shotwright default confirmed; upstream default/byte equality not rerun. |

## Open questions

1. What manifest version/compatibility policy governs added status, tests, artifacts and spec-qualified shot identity for existing 0.1.1 runs?
2. For G3, which result is authoritative with retries, skipped tests, interrupted runs, and failed manifest assembly? Should incomplete runs be listed but not served?
3. For G4/G9, should failed-run `.pw` be retained wholesale or selectively copied, and should local gallery trace access differ from LAN access?
4. For G5/G13a, is `spec` the filename identity or the suffix-stripped storage/display key? How should same-spec duplicates across workers fail deterministically?
5. For G7, what text/JSON size limits, MIME allowlist, HTML escaping, and workbook normaliser contract keep gallery output safe and self-contained?
6. For G10, how will the reusable workflow pass caller credentials/base URL, choose a failed run without stale artifacts, and retain self-mode parity on both CI providers?
7. For G12, where is a compare artifact written when input runs are in unrelated directories, while retaining ADR 0009's default path?
8. For G13d, should a filtered-out shot invoke the check, and what exactly does `verified` mean if a callback returns without an assertion?
9. Which Node LTS versions are actually supported by the distributed ESM package, verified in a consumer matrix?

## Research self-review

- **Measured or flagged:** pass; direct one-off output is quoted, external/browser claims marked unmeasured.
- **Derived-value semantics:** flag for future plan: run/test status with retries and partial runs, shot verification, and artifact comparison need definitions.
- **Emergent structure:** flag for future plan: spec/name collisions and cross-directory compare ownership need deterministic keys.
- **Batch/concurrency:** flag for future plan: atomic manifest publication and cross-worker shot reservations must be pinned.
- **Inherited constraints grounded:** pass; compare philosophy, thin consumers, latest meaning, manifest atomicity, byte fidelity, and ADR 0007/0009/0010 checked against current source.
