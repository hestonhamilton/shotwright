# E10.R — First external consumer adoption gaps

**Bead:** `shotwright-746.28.1` · **Epic:** `shotwright-746.28` · **Phase:** Research · **Date:** 2026-10-22

## 1. Context

The first external consumer is an npm Playwright package under a repository subdirectory, with approximately 250 capture specs **(consumer-reported, not remeasured)**. Its flows use login state, ordered host mutations, PNGs and data artifacts for stakeholder review and old/new parity. The brief reports reproduction on shotwright 0.1.1, `@playwright/test` 1.64.0 and Node 24.14.1 (Linux), 2026-10-22. The current upstream patch is 1.64.1 ([npm, read 2026-10-22](https://www.npmjs.com/package/%40playwright/test?activeTab=versions)). Impact ranks below follow the consumer's ordering, with G13 split into its subitems; they are priorities, not measured severity scores.

| Item | Gap in one line | Code-lane premise result | Impact rank |
|---|---|---|---|
| G1 | Config loses Playwright options | Confirmed | 1 |
| G2 | `fullyParallel: true` races ordered flows | Confirmed | 2 |
| G3 | Manifest lacks run/test outcomes | Confirmed | 3 |
| G4 | Failure evidence disappears with `.pw` | Partly confirmed | 4 |
| G5 | Global shot-name uniqueness rejects valid specs | Confirmed | 5 |
| G6 | Compare has no pixel verdict or gate | Confirmed | 6 |
| G7 | Data artifacts have no API/review surface | Confirmed | 7 |
| G8 | Bare runner drives flows before late failure | Partly confirmed | 8 |
| G9 | Trace disclosure has no warning or LAN/upload control | Partly confirmed | 9 |
| G10 | CI assumes root pnpm package and passed `latest` | Partly confirmed; `if-no-files-found: error` already exists | 10 |
| G11 | Init assumes root package and pnpm | Confirmed | 11 |
| G12 | Cannot list/select failed runs or compare external paths | Confirmed | 12 |
| G13a | Spec directory retains `.shots.ts` | Confirmed | 13a |
| G13b | Video/trace filenames are opaque IDs | Confirmed | 13b |
| G13c | Config probe prints `--list` output | Confirmed | 13c |
| G13d | No verify-before-shoot callback | Confirmed absent | 13d |
| G13e | ESM package advertises broad Node `>=20` | Partly confirmed | 13e |
| G13f | Full-page default differs from Playwright | Partly confirmed | 13f |

Preserve byte-identical captures for equivalent screenshot arguments (the brief reports 11 pilot PNG matches, **consumer measurement**), atomic manifest publication, `latest` as last **passed** run, self-contained gallery, consumer-resolved Playwright, thin consumers, artifacts-only CI by default, and the public-repository hygiene rule (`docs/design.md:33-38`, `:72-84`, `:95-113`). The design's prohibition on pixel verdict/gating (`docs/design.md:34-36`, `:110-113`) requires an explicit ADR amendment before G6 implementation.

## 2. Kickoff answers

1. **G6:** The owner requested the external-research answer. Adopt the external lane's recommendation: comparison computes verdicts, while an exit-code gate is opt-in with `--fail-on-change`. This conflicts with the current no-pixel-verdict wording in `docs/design.md:34-36`, `:110-113`; record an ADR at decision-time.
2. **G5:** Shot identity is **spec + name**, unique within a spec; compare pairs on spec + name. This is settled, not an open choice.
3. **G10/G11:** Fold working-directory WIP bead `shotwright-746.8.1` (commit `9de261c`) into this epic's G10/G11 implementation bead with widened acceptance. The code lane inspected it read-only; it is not merged here.

## 3. Findings per gap

Detailed methods, source evidence, test pins, and write surfaces remain in the two appendices: [code grounding](shotwright-746.28.1-research-code.md) and [external grounding](shotwright-746.28.1-research-external.md). The [consumer brief](shotwright-746.28-consumer-brief.md) supplies user reproductions. Source lines below are worktree-relative; linked upstream facts were read 2026-10-22 unless stated otherwise.

- **G1.** `ShotsConfigOptions` lists only selected fields (`src/index.ts:24-39`), and the factory rebuilds those fields (`src/index.ts:62-89`), contradicting “Everything not listed is passed through untouched” (`README.md:106-110`). The code lane's built-dist probe returned `G1/G2 {"fullyParallel":true}` after omitted `globalSetup`, `workers`, `timeout`. Playwright's `TestConfig` also has `globalTeardown`, `expect`, `testIgnore`, `metadata`, `preserveOutput`, and `retryStrategy` ([TestConfig](https://playwright.dev/docs/api/class-testconfig)); the `Omit` type shape is a project design, not an upstream prescription.
- **G2.** `fullyParallel: true` is fixed in `src/index.ts:65`, absent from options at `:24-39`; `test/unit/factory.test.ts:16-28` pins it. Playwright defaults to tests in one file running in order; `test.describe.configure({ mode: 'serial' })` also skips subsequent tests after failure and retries the group together ([TestConfig](https://playwright.dev/docs/api/class-testconfig), [Retries](https://playwright.dev/docs/test-retries)). The consumer's actual host interleaving was not rerun by the code lane.
- **G3.** `Manifest` has no `status`/`tests[]` and `ShotEntry` no `testId` (`src/manifest.ts:20-42`), despite sidecar test IDs at `:44-55`; assembly drops them at `:103-108`. `onTestEnd` and `onEnd` are available (`src/reporter.ts:35-41`), and gallery says status is absent (`src/gallery/render.ts:301-304`). Playwright run `FullResult.status` is `passed|failed|timedout|interrupted`; `TestResult.status` includes `timedOut` and `skipped`, plus `duration`, `errors`, and attachments. `TestCase.id` is unique **within a Playwright session**, so it is a link key, not promised cross-run identity ([Reporter](https://playwright.dev/docs/api/class-reporter), [TestResult](https://playwright.dev/docs/api/class-testresult), [TestCase](https://playwright.dev/docs/api/class-testcase)). Retries are harness-owned at zero (`src/index.ts:62-67`); `shotwright run` passes no `--retries` (`src/cli.ts:400-421`). One test has one attempt, identified by `testId`.
- **G4.** The factory stages output in `.pw` (`src/index.ts:85-87`); reporter copies video/trace only (`src/reporter.ts:35-62`) and removes `.pw` in `onExit` (`:107-110`). The precise printed dangling path was not browser-reproduced in the code lane. Playwright attaches `error-context.md` only on errors when context content exists; `outputDir` is cleaned at the start, and `preserveOutput` controls within-run retention ([source](https://github.com/microsoft/playwright/blob/main/packages/playwright/src/index.ts), [TestConfig](https://playwright.dev/docs/api/class-testconfig)).
- **G5.** Shot files already use spec/name (`src/capture.ts:74-79`); `assembleManifest` rejects bare-name duplicates at end (`src/manifest.ts:92-102`) before publish/sidecar cleanup (`src/reporter.ts:64-98`). Gallery validation and compare repeat the global-name assumption (`src/gallery/model.ts:147-154`, `src/gallery/compare-model.ts:57-72`). Use a spec/name pair for cross-run pairing and reject a same-name re-capture within one spec, even across tests; `testId` links the single attempt to its evidence (retries remain zero: `src/index.ts:66`, `src/cli.ts:417-421`).
- **G6.** The external lane’s threshold-zero wording is superseded by exact/similar semantics below. Current states are `paired`, `a-only`, `b-only`, `not-comparable` (`src/gallery/compare-model.ts:4-28`); `paired` means readable PNGs, not pixel equality (`:76-88`). `readPngModel` checks PNG structure without decoding pixels (`src/gallery/model.ts:214-277`); CLI succeeds after render (`src/cli.ts:461-488`); copy says no verdict (`src/gallery/render-compare.ts:207-245`). Playwright uses pixelmatch with default `threshold: 0.2`, whereas pixelmatch exposes pixel counts and requires equal dimensions ([snapshots](https://playwright.dev/docs/test-snapshots), [pixelmatch](https://github.com/mapbox/pixelmatch)). `odiff` reports pixel/layout differences ([README](https://github.com/dmtrKovalenko/odiff/blob/main/README.md)); `looks-same` reports `differentPixels` ([README](https://github.com/gemini-testing/looks-same)). None defines shotwright's exit policy. ADR 0009 owns `<outputDir>/compare/<A>.vs.<B>.html` (`docs/adr/0009-compare-artifact-output-path.md:35-51`).
- **G7.** Capture exports `shot` and helpers, no general `artifact` (`src/capture.ts:18-29`, `:63-101`); manifest and gallery only model shots and their video/trace (`src/manifest.ts:33-55`, `src/gallery/model.ts:109-168`, `:279-367`). `testInfo.attach(name, { body | path, contentType })` requires exactly one body or path and copies path attachments; `TestResult.attachments` records name/content type/path or body ([TestInfo](https://playwright.dev/docs/api/class-testinfo), [TestResult](https://playwright.dev/docs/api/class-testresult)). Playwright HTML reporter stores attachments under `data/` ([reporters](https://playwright.dev/docs/test-reporters)); no established workbook normaliser contract was found. HTML source must be escaped, and gallery server paths allowlisted (`src/gallery/server.ts:113-150`).
- **G8.** Without run env, the factory skips run directory and `outputDir` (`src/index.ts:57-60`, `:85-89`); only `shot()` later throws `SHOTWRIGHT_RUN_DIR is not set` (`src/capture.ts:63-70`). The code lane did not invoke the bare runner. Playwright says default `outputDir` is cleaned at start ([TestConfig](https://playwright.dev/docs/api/class-testconfig)); whether config evaluation occurs before that cleaning needs a safe isolated experiment. Probe contract is `src/index.ts:43-56`.
- **G9.** `--trace` exists (`src/cli.ts:109-145`, `:411-418`), trace ZIP is gallery-allowlisted (`src/gallery/server.ts:127-149`), and both `--host` and `--lan` can select a non-loopback bind (`src/cli.ts:212-244`). The brief measured 16 password occurrences across two trace ZIPs; **consumer measurement, not remeasured**. Trace Viewer shows network request/response headers and bodies ([Trace Viewer](https://playwright.dev/docs/trace-viewer)); a redaction option was not found in [Tracing API](https://playwright.dev/docs/api/class-tracing). Upload-artifact documents selection/retention, not content redaction ([README](https://github.com/actions/upload-artifact)).
- **G10.** Workflow inputs are only `mode` and `config-path` (`.github/workflows/shotwright.yml:3-16`); runner, Node, pnpm, and workers are fixed (`:20-65`), resolution uses passed `latest` (`:72-83`), and upload lacks a failure condition (`:117-123`). **Correction:** `if-no-files-found: error` is already present. WIP `9de261c` covers subdirectory/pnpm precheck only (code appendix G10). GitHub allows `inputs` in `runs-on`, `fromJSON` for label arrays, and job-level `defaults.run.working-directory` ([syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), [expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)); this JSON-array design is inferred from those rules. Caller `env` does **not** propagate through `workflow_call`; use declared inputs/vars and explicit secrets or `secrets: inherit` where allowed ([limits](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), [reuse](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)). GitHub favors `!cancelled()` for failure upload without cancellation resistance ([cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)). ADR 0007 permits new inputs for real consumer demand (`docs/adr/0007-ci-reusable-workflow-same-owner-private.md:73-78`). Trace recording is already controlled by `SHOTWRIGHT_TRACE` (`src/cli.ts:410-418`, `src/index.ts:68-73`); the CI `traces` input must control that run flag.
- **G11.** `planInit(cwd)` places `.github`/`.claude` under cwd (`src/init.ts:165-209`); messages hardcode pnpm (`:423-491`) and Vite example says `pnpm exec vite` (`:79-90`); README install is pnpm-only (`README.md:29-66`). npm's user-agent starts `npm/{version}` ([config](https://docs.npmjs.com/cli/using-npm/config/)); a detector documents lockfile, `packageManager`, then `devEngines.packageManager` clues ([detector](https://github.com/antfu-collective/package-manager-detector/)). Corepack reads the closest manifest's `packageManager` ([Corepack](https://nodejs.org/download/release/v17.6.0/docs/api/corepack.html)). Root workflow placement must obey init's no-overwrite rule (`src/init.ts:285-299`).
- **G12.** Gallery defaults to last-passed `latest` and errors if absent (`src/gallery/resolve.ts:50-72`); compare resolves both IDs under one outputDir (`:91-102`); no `runs` command (`src/cli.ts:64-75`, `:501-525`). A run directory exists before its manifest (`src/runs.ts:24-54`), so a manifestless directory has unknown status/count. Path-shaped selectors parse but `validateRunId` rejects them (`src/gallery/resolve.ts:35-47`). Compare output ownership is already set by ADR 0009 (`docs/adr/0009-compare-artifact-output-path.md:35-51`, `:73-78`).
- **G13a.** `shot()` puts the suffix-bearing spec in storage and manifest (`src/capture.ts:74-99`). `testMatch` accepts only `*.shots.ts` (`src/index.ts:63-65`), so stripping only that final matched suffix for storage/display is injective over matched paths; canonical `spec` stays unchanged.
- **G13b.** Reporter names video/trace by `<testId>` (`src/reporter.ts:49-60`); assembly removes the ID from shots (`src/manifest.ts:103-108`). Playwright promises [session uniqueness](https://playwright.dev/docs/api/class-testcase), not a readable attachment filename; slug collision handling is shotwright's responsibility.
- **G13c.** Probe launches `--list` (`src/cli.ts:331-353`) with inherited stdio (`:315-325`), so listing noise reaches callers. No external API claim is needed; preserve diagnostics on failure and probe no-run behavior (`src/index.ts:43-56`).
- **G13d.** The proposed marker is `checked: true` for callback completion before capture, never `verified`. `ShotOptions` only has `fullPage`, `clip`, `locator` (`src/capture.ts:23-29`); capture proceeds without a check (`:63-100`), manifest has no marker (`src/manifest.ts:20-31`). Playwright's `testInfo.attach` demonstrates callback-adjacent artifact APIs but provides no “verified shot” semantic ([TestInfo](https://playwright.dev/docs/api/class-testinfo)); this must be defined locally.
- **G13e.** Package is ESM-only (`package.json:5`, `:25-41`) with `engines.node: >=20` (`:13-15`), no `require` condition; exact minor floors were not locally matrix-tested. Node 20.19.0 and 22.12.0 made `require(esm)` unflagged; async module graphs remain unsupported ([20.19 release](https://nodejs.org/tr/blog/release/v20.19.0), [22.12 release](https://nodejs.org/en/blog/release/v22.12.0)). Node suggests `module-sync` for one synchronous ESM target ([22.12 release](https://nodejs.org/en/blog/release/v22.12.0)); an explicit `require` branch only makes sense with distinct routing. Engine metadata is consumer-facing under ADR 0010 (`docs/adr/0010-distribution-public-npm-package.md:37-41`).
- **G13f.** `shot()` defaults `fullPage` to true except clip/locator (`src/capture.ts:23-29`, `:81-87`); Playwright's page screenshot defaults it to false ([Page](https://playwright.dev/docs/api/class-page)). Keep current output behavior; document migration difference (`README.md:89-91`).

## 4. Options

**G1 — config passthrough**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** spread `Omit<PlaywrightTestConfig, HarnessOwnedKeys>` | Spread caller config, then enforce owned keys and nested capture toggles | Honors README and future Playwright fields | Must define owned set, merge `use`/reporter carefully | Medium; accepted fields become API |
| Explicit allowlist | Add requested keys one by one | Tight control | Repeats this defect on new keys | High ongoing maintenance |
| Document the spread workaround | Tell consumers to override result | No runtime change | Bypasses invariants, contradicts thin consumer | Low code cost, high user cost |

Pick typed spread because the consumer already needs multiple independent Playwright keys; explicitly own `testMatch`, `retries`, `reporter`, `use.screenshot/video/trace`, `outputDir`, and resolve `testDir` in P.

**G2 — file-local ordering**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** default false | Preserve ordered tests within a file, still allow caller override | Matches Playwright default and consumer flow | Existing parallel specs may slow | Medium behavior change |
| Option only, default true | Expose flag | Backward-compatible default | Consumer remains unsafe unless set | Low |
| Keep true | Current fixed value | No change | Breaks ordered flows | None |

Pick false because this harness serves walkthroughs where order is common; document Playwright serial failure/retry semantics separately.

**G3 — manifest outcomes**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** v2 manifest: runner `status`, `publication`, `tests[]`, shot `testId` | `status` is `FullResult.status`; `publication.gallery` and `publication.evidenceCopy` each hold `ok`/`error`; tests hold `id`, `title`, `spec`, `status`, `error`, `duration` | Outcome and publication are distinct; v1 reads with defaults | Writer/reader must land together | Medium migration |
| Additive v1 fields | Keep `manifestVersion: 1` with optional fields | Old readers may continue | Version no longer describes semantics; missing means old or incomplete | High ambiguity later |

Pick v2 because status and identity change the contract. Write v2; gallery/compare read v1 with defaults `status: unknown`, `tests: []`, `artifacts: []`, including mixed 0.1.1/0.2.0 compare. `status` is the runner’s `FullResult.status`; `publication` separately records gallery and evidence-copy success/error. Advance `latest` only for runner `passed` with both publication results good. Retries remain harness-owned at zero (`src/index.ts:66`, `src/cli.ts:417-421`); `testId` identifies the sole attempt. Release 0.2.0 (pre-1.0 minor).

**G4 — failure evidence**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** copy attachments to `failures/<spec>/<test>/` | Copy from `TestResult.attachments` before `.pw` sweep | Stable, manifest-listed, selected evidence | Must name safely and preserve printed-path usability separately | Medium layout contract |
| Keep `.pw` on failure | Retain raw runner output | Simplest; printed paths work | Unbounded/private contents, inconsistent review API | Low to reverse, high disclosure |
| Both | Copy plus raw retention | Complete debugging | Duplicate/sensitive data and size | High cleanup |

Pick selective copy to preserve review evidence; test the actual error-context path and decide whether a compatibility link or printed message is needed.

**G5 — spec + name identity (owner-settled)**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** canonical `ShotEntry.spec` + `name`, detect duplicate at `onEnd`, pair on both | Manifest/storage/compare share composite key; report assembly error and leave run incomplete | No cross-worker reservation race | Duplicate discovered late | High public identity change |
| Same key, detect in `shot()` | Atomic per-spec reservation before capture | Earlier failure | Cross-worker locking and cleanup complexity | Medium implementation; same schema cost |

Pick `onEnd` validation initially because worker-local sidecars cannot safely reserve a global key without an atomic mechanism; reject same-name re-capture within one spec, clean sidecars, and report assembly errors. With retries fixed at zero (`src/index.ts:66`, `src/cli.ts:417-421`), `testId` identifies the only attempt.

**G6 — pixel verdict and gate**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** pixelmatch + pngjs; default report, opt-in `--fail-on-change` | Decoded PNG comparison with `identical/similar/changed/size-changed/added/removed/unreadable`; `compare.json` records tool/version, threshold, `includeAA`, per-pair numbers; gate fails on every state except identical/similar | Mature API, deterministic count, explicit gate | New deps; threshold meaning needs pin | High verdict vocabulary/ADR |
| odiff | Native comparator with pixel/layout result | Built-in layout result | Binary install surface and platform proof | Medium dependency swap |
| looks-same | Perceptual comparison and diff | Useful visual tolerance | “Identical” semantics less literal; size behavior unclear | Medium |

Pick pixelmatch/pngjs for PNG-only output. `identical` means every decoded pixel equals; `similar` means raw pixels differ but pixelmatch count is zero at the recorded threshold and `includeAA`; `changed` means count > 0, with count, ratio, and dimensions. `size-changed`, `added`, `removed`, and `unreadable` are distinct. `compare.json` records tool name/version, threshold, `includeAA`, and each pair’s state and numbers. Diff PNG and `compare.json` share `<outputDir>/compare/` and `.vs.` pair stem; changed pairs sort first. Default exit is zero after successful render; `--fail-on-change` exits 1 for any pair other than `identical` or `similar`. Decode cost at 250 pairs is an **ESTIMATE (unverified)**; pin elapsed time and peak RSS with a 250-pair compare fixture. ADR must revise design’s no-verdict rule.

**G7 — non-image artifacts**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** `artifact(name, {body|path, contentType})`, `data/<spec>/<name>`, manifest `artifacts[]`; defer xlsx normaliser | Gallery lists all; inline text and pretty JSON; HTML escaped source; compare text/JSON with text diff, binary with byte equality | Mirrors Playwright API; handles consumer formats | MIME/size/path safety and comparison semantics | High schema/API; extension additive |
| Raw files without manifest | Document `$SHOTWRIGHT_RUN_DIR/data` | Small implementation | Gallery/compare blind; consumer code repeated | Low code, high user cost |
| Normaliser hook now | Add xlsx plugin contract | Semantic workbook parity | Premature API and sandboxing rules | High |

Pick typed artifacts with testId, spec/name identity, byte size and safe filename. Inline artifact sizes are an **ESTIMATE (unverified)**: cap inline content at **256 KiB (ESTIMATE, to be confirmed)**, show a truncation notice and full-file download link, and always render HTML as escaped source. Pin representative artifact sizes and MIME/path fixtures; add normalisers only with a tested consumer contract.

**G8 — bare runner guard**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** throw in factory outside run/probe/list | Stop before tests launch | Prevents side effects if config loads before cleanup | Must safely detect `--list`; cleanup order unproved | Low |
| Warn | Emit diagnostic but continue | Less disruptive | Still drives shared host and cleans results | Low |

Pick throw with explicit probe env and list allowance; isolated runner test must establish startup order.

**G9 — trace disclosure**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** README warning; effective non-loopback bind excludes trace routes unless `--include-traces`; CI `traces` defaults false | Recording off means no trace in manifest, gallery, or upload | Trace opt-in remains easy | Bind detection and recording need fixture proof | Medium CLI/workflow behavior |
| Warning only | Document sensitivity | Small | LAN and upload remain exposed by default | Low |

Key trace exclusion on effective bind address, including `--host 0.0.0.0`, `--host ::`, and `--lan`, never flag spelling (`src/cli.ts:212-244`, `src/gallery/server.ts:127-149`); `--include-traces` overrides. CI `traces: false` controls run recording through `SHOTWRIGHT_TRACE` (`src/cli.ts:410-418`, `src/index.ts:68-73`), so manifest, gallery, and upload agree. Warn that video, PNG, failure context, and data artifacts may also disclose private content.

**G10 — reusable workflow input and upload**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** named inputs + invocation run-dir file | `runs-on` JSON array via `fromJSON` (default `["ubuntu-latest"]`), `working-directory`, `package-manager` (`npm|pnpm|yarn`; default lockfile detection), `playwright-args`, boolean `traces` (default false), `retention-days`; `!cancelled()` upload of exact run and `if-no-files-found: error`; explicit app inputs/secrets | Fits consumer, failed runs, and short retention for credential-bearing artifacts | Public workflow API needs Actions proof | High copied caller contract |
| Keep fixed workflow plus consumer wrapper | Consumer runs own CI commands | Tiny package change | Violates thin-consumer goal; duplicates fixes | High drift |

Pick those named inputs and fold `shotwright-746.8.1`; do not expose arbitrary shell command, `node-version`, or `output-dir`. The consumer runs Node 24, the lane default. `shotwright run` writes final stdout line `run-dir: <path>` and the same path to `--run-dir-file <path>` (or `SHOTWRIGHT_RUN_DIR_FILE`); CI uploads exactly that directory even if publication fails (`src/index.ts:57-60`, `src/runs.ts:24-42`, `src/cli.ts:400-421`). `traces` controls recording through the run flag, not upload filtering.

**G11 — init root and manager**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** git-root discovery; package-local manager detection | Workflow/skill at repo root, config/spec under package; explicit choice then local `packageManager`, lockfile, launch user-agent | Correct subdirectory scaffold and commands | Ambiguous nested repos/lockfiles need errors | Medium scaffold paths |
| Keep cwd/pnpm | Current behavior | Simple | Workflow in wrong location and commands fail | None |

Pick root-aware init with no-overwrite preserved; set caller `working-directory` and emit npm/yarn/pnpm guidance.

**G12 — run selection and compare paths**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** `shotwright runs`; explicit `--last`; compare IDs or paths | List manifestless directory as `incomplete`/unknown count; `--last` selects newest directory with manifest and says so; downloaded-run compare | Honest partial-run display and portable artifacts | Requires directory and manifest scan | Medium CLI semantics |
| Repoint `latest` to any run | Existing commands find failure | Simple | Breaks last-passed invariant and scripts | High |

Pick `--last` distinct from `latest`: it chooses the newest manifest-bearing directory and reports that selection. `shotwright runs` lists a manifestless directory as `incomplete`, count unknown, never failed/zero (`src/runs.ts:24-54`, `src/gallery/model.ts:296-312`). The run’s final `run-dir: <path>` line and `--run-dir-file`/`SHOTWRIGHT_RUN_DIR_FILE` identify the exact CI upload even after publication failure. Default compare output remains ADR 0009’s configured `<outputDir>/compare/`, including external inputs, unless caller supplies an explicit output path.

**G13a — suffix and identity**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** canonical matched `spec`; strip only final `.shots.ts` for storage/display | Derive storage/display directory from matched path | Keeps G5 key stable; transform is injective | Layout changes | Medium output-layout change |
| Strip suffix in canonical `spec` | Change identity and storage together | One field | Changes public identity needlessly | High identity migration |

Keep canonical `spec` as matched file path and strip only its final matched `.shots.ts` suffix for storage/display. This transform is injective over `testMatch` paths (`src/index.ts:63-65`, `src/capture.ts:74-77`); no collision layer is needed.

**G13b — video/trace names**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** `<spec>/<test-title-slug>-<short-testId>` with no retry suffix | Derive evidence path from spec/title/id | Readable and collision-resistant; retain full testId in manifest | Must sanitize and handle projects | Medium path migration |
| Keep opaque ID | Retain current naming | Collision-free | Poor artifact browsing | None |

Pick readable slug with ID suffix; derive from canonical spec and record final path in manifest.

**G13d — check callback**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** optional `check` before write; `checked: true` only after callback completes before capture | Run callback before screenshot | Enforces ordering and records completion | A returned no-op is indistinguishable from an assertion | Medium API semantics |
| Keep consumer wrapper | Leave callback outside harness | No API change | Consumer must copy helper and manifest has no signal | Low |

Pick callback; filtered shots skip the check, and a thrown check leaves no PNG/sidecar; document that `checked: true` records callback completion before capture, not proof of an assertion. Pin no-op, thrown, and filtered-shot cases (`src/capture.ts:23-29`, `:63-99`).

**G13e — CJS loading and engines**

| Option | What it is | Pros | Cons | Lock-in or reversal cost |
|---|---|---|---|---|
| **Recommended** keep `engines.node >=20`; document CJS loading floor | README states `require(esm)` needs Node `^20.19 || >=22.12` | Preserves existing install range | Older Node 20 minors cannot synchronously load ESM config | Low documentation cost |
| `module-sync` condition | Route import/require to same ESM | Explicit intent | Export-map/type compatibility needs proof | Medium |
| Separate `require` CJS build | Broadest CJS loading | Supports older minors | Dual package complexity and divergent output | High |

Keep `engines.node >=20` (`package.json:13-15`). Document in README that CommonJS consumers loading the ESM config need Node `^20.19 || >=22.12` for unflagged `require(esm)`; pin a packed-package smoke test at Node 24. No engines ADR.

## 5. Recommendation

Implement G1 typed passthrough with harness-owned `retries: 0` and G2 ordered default; G3 v2 outcomes and G5 spec/name identity as one writer/reader contract; G4 selected failure attachments; G6 pixelmatch/pngjs report with opt-in gate; G7 typed data artifacts without xlsx normaliser; G8 early guard; G9 trace controls; G10/G11 portable CI and init; G12 run discovery and path compare; G13a/b/c/d/f as specified. For G13e, retain `engines.node >=20` and document the CJS loading floor. Preserve screenshot bytes and `latest` as last passed, fully published run. ADRs: G6 verdict model, and G5 identity plus manifest v2. Public package/API/workflow changes need a **minor pre-1.0 changeset** (`0.1.x` → `0.2.0`), with migration notes for manifest v1 and paths; confirm changeset mechanics in P.

### Structural finding from the redteam

R1, R6, and R7 share one cause: a run publishes state (manifest, `latest`, gallery links) before that state is final. In `onEnd`, copy failure evidence and artifacts first, generate the gallery from the in-memory manifest, **then** publish the manifest atomically, **then** flip `latest` only when runner `FullResult.status` is `passed` and publication succeeded. The gallery currently reads the published manifest (`src/gallery/model.ts:296-312`), so its generator must accept the in-memory model or private staging until publication. If gallery generation fails, still publish a manifest with `publication.gallery = { ok: false, error }`; `latest` does not move. Record evidence-copy success/error separately in `publication`. The current order publishes manifest before gallery and can advance `latest` despite gallery failure (`src/reporter.ts:47-104`); `test/unit/reporter-gallery.test.ts:86-103` pins precisely that behavior and must change; add gallery diagnostic, thrown generator, and cleanup failure fixtures. CI's trace recording choice must precede all three publication surfaces (`src/cli.ts:410-418`, `src/index.ts:68-73`), and its upload path must refer to the invocation's run directory (`src/index.ts:57-60`, `src/runs.ts:24-42`).

### Proposed implementation slicing

These are proposed beads, not created here. Each file has one owner in the parallel wave. I-contract declares cross-bead function signatures as typed stubs so all three wave beads build independently. A green end-to-end reporter→gallery fixture is the I-contract merge gate, then the parallel wave lands on that contract. UI changes in I-gallery must be viewed before shipping.

| Proposed implement bead | Scope and exclusive files | Merge gate |
|---|---|---|
| **I-contract** — writer and reader together | G1/2/3/4/5/7/8/13a/b/d foundation: `src/manifest.ts`, `src/reporter.ts`, `src/capture.ts`, `src/index.ts`, `src/gallery/model.ts` (`validateManifest` v1-read/v2-write adapter, composite key, and typed compare verdict signature stub), `package.json`, `pnpm-lock.yaml` (add pixelmatch/pngjs here); `test/unit/factory.test.ts`, `capture.test.ts`, `manifest.test.ts`, `reporter-gallery.test.ts`, `gallery-model.test.ts` | First; green end-to-end reporter→gallery fixture including v2 and v1 adapter |
| **I-gallery** — presentation and comparison | G6 verdicts with pixelmatch/pngjs, G7 rendering, G3/G4 badges, G9 effective-bind policy: `src/gallery/render.ts`, `src/gallery/render-compare.ts`, `src/gallery/compare-model.ts`, `src/gallery/generate-compare.ts`, `src/gallery/server.ts`; `test/unit/gallery-render.test.ts`, `gallery-browser.test.ts`, `gallery-compare-model.test.ts`, `gallery-compare-render.test.ts`, `gallery-compare-generate.test.ts`, `gallery-server.test.ts`, plus new `test/fixtures/compare-250-pairs.mjs` | After I-contract; runs in parallel with I-cli and I-consumer-ci |
| **I-cli** — commands and selectors | `src/cli.ts`, `src/runs.ts`, `src/gallery/resolve.ts`; `test/unit/cli.test.ts`, `runs.test.ts`, `gallery-resolve.test.ts`, `test/smoke/cli.test.ts` for `runs`/`--last`/run-dir-file, compare paths, probe stdio, and `--fail-on-change` wiring to the typed compare verdict signature stub in `src/gallery/model.ts` | After I-contract; runs in parallel with I-gallery and I-consumer-ci |
| **I-consumer-ci** — workflow and init | G10/G11; folds `shotwright-746.8.1`: `.github/workflows/shotwright.yml`, `templates/github/shotwright.yml`, `src/init.ts`, `templates/init/shots.config.ts`, `templates/skills/shots-harness/SKILL.md`, `scripts/ci/shots.sh` if needed; `test/unit/init.test.ts`, `template-pin.test.ts`, and new `test/fixtures/actions-proof/` fixtures | After I-contract; runs in parallel with I-gallery and I-cli |
| **I-docs** — release guidance | `README.md`, consolidated `.changeset/shotwright-746-28.md`, and `docs/shotwright-746.28-migration.md`; no package/lockfile edits | After parallel wave |

## 6. Considered and declined

| Redteam finding | Disposition | Resolution |
|---|---|---|
| R1 | fixed-in-doc | Runner status and publication results are distinct; finalization precedes `latest`. |
| R2 | partly accepted | Config `retries` is harness-owned at 0, but `shotwright run -- --retries N` reaches Playwright through `args.passthrough` (`src/cli.ts:417`), so a retry is still possible. Rule for P: sidecars record `retry`; assembly keeps the last attempt per (spec, name, testId) and drops earlier ones (the PNG was overwritten anyway); a same name from two different tests in one spec is the G5 duplicate error. |
| R3 | fixed-in-doc | Exact, similar, and changed states plus gate over every non-parity state. |
| R4 | fixed-in-doc | `checked: true` records callback completion, not verification. |
| R5 | fixed-in-doc | Effective non-loopback bind controls trace routes; explicit override remains. |
| R6 | fixed-in-doc | CI `traces` controls recording, so all published surfaces agree. |
| R7 | fixed-in-doc | Manifestless runs are incomplete; CI uploads its own run-dir-file path. |
| R8 | fixed-in-doc | I-contract lands v2 writer and compatible reader together. |
| R9 | plan item | v1-read/v2-write and mixed-version compare pinned; release 0.2.0. |
| R10 | fixed-in-doc | I-contract owns pixelmatch/pngjs dependency and lockfile edits. |
| R11 | plan item | 250-pair elapsed time and peak RSS fixture required; cost is ESTIMATE. |
| R12 | plan item | 256 KiB inline cap is ESTIMATE, with truncation and full download; escaped HTML. |
| R13 | declined | Keep justified CI inputs; decline `node-version` (consumer Node 24) and `output-dir` (run-dir-file). |
| R14 | declined | Matched suffix stripping is injective; no collision layer. |
| R15 | declined | Keep `engines.node >=20`; README CJS floor and Node 24 packed smoke; no engines ADR. |

Other declined options: global shot-name uniqueness or cross-worker reservation for G5; always-on G6 gate or golden baselines; G7 xlsx normaliser without a tested contract; retaining all `.pw`; repointing `latest` to failed runs; always-on trace exposure; a `require` export solely to imply CJS; and changing `shot()`'s full-page default.

## 7. Open questions

| Question | Class and resolution |
|---|---|
| Can a factory throw prevent default `test-results/` cleanup before config evaluation? | **Empirically decidable:** isolated temp consumer with sentinel file, invoke bare runner/list/probe. |
| Failure attachment names and printed `Error Context` path after copy | **Empirically decidable:** real failing Playwright fixture, verify attachment metadata and terminal path. |
| Same-spec duplicate across workers and safe attachment names | **Empirically decidable:** crafted multi-worker fixture; deterministic rejection before publishing. |
| Confirm 256 KiB inline cap and text-diff scope | **Plan pin:** representative body-size fixture; HTML always escaped source, truncation notice and download link. |
| For downloaded external runs, explicit compare output path and naming when run IDs collide | **Plan pin:** default ADR 0009 path remains; P defines optional output-path contract and collision key. |
| Secrets/base URL interface and self-mode parity on GitHub and forge | **Empirically decidable:** real Actions proof fixture and forge run. |
| Nested git roots, manager metadata/lockfile ambiguity and Yarn variant support | **Empirically decidable:** temp-repo scaffold matrix; emit ambiguity error. |
| Trace exposure for copied failure evidence | **Plan pin:** all evidence allowlisted; local trace access retained, non-loopback trace opt-in. |

## 8. Currency

The external lane had web access and read sources on **2026-10-22**. Table carried over verbatim from its currency section:

| Claim most likely to affect planning | Primary source | Date read |
|---|---|---|
| Playwright stable is 1.64.1 | [npm `@playwright/test`](https://www.npmjs.com/package/%40playwright/test?activeTab=versions) | 2026-10-22 |
| Playwright reporter statuses, output retention, screenshot behavior | [Reporter](https://playwright.dev/docs/api/class-reporter), [TestConfig](https://playwright.dev/docs/api/class-testconfig), [Page](https://playwright.dev/docs/api/class-page) | 2026-10-22 |
| Error context is markdown attachment on qualifying failure | [Playwright source](https://github.com/microsoft/playwright/blob/main/packages/playwright/src/index.ts) | 2026-10-22 |
| Pixelmatch 8.0.0; pngjs 7.0.0; odiff-bin 4.5.0; looks-same 10.0.1 | [pixelmatch](https://www.npmjs.com/package/pixelmatch?activeTab=versions), [pngjs](https://www.npmjs.com/package/pngjs?activeTab=versions), [odiff-bin](https://www.npmjs.com/package/odiff-bin?activeTab=versions), [looks-same](https://www.npmjs.com/package/looks-same?activeTab=versions) | 2026-10-22 |
| `actions/upload-artifact` current major is v7; `!cancelled()` handles failure while respecting cancellation | [Action releases](https://github.com/actions/upload-artifact/releases), [GitHub cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation) | 2026-10-22 |
| CJS `require(esm)` floors are Node 20.19 and 22.12; 23.0 was unflagged | [20.19 release](https://nodejs.org/tr/blog/release/v20.19.0), [22.12 release](https://nodejs.org/en/blog/release/v22.12.0), [23 docs](https://nodejs.org/download/release/v23.6.0/docs/api/modules.html) | 2026-10-22 |

## 9. Self-review rubric

| Lens | Result | Reason |
|---|---|---|
| Measured-or-flagged | **Pass** | Consumer scale/password/PNG counts are attributed; the code lane's tests and probe are identified; no throughput estimate is treated as measurement. |
| Derived-value semantics | **Pass** | Runner status, publication results, `checked`, exact/similar verdicts, gate states, and incomplete counts now have explicit contracts. |
| Emergent structure | **Flag** | Suffix stripping is injective; readable slug collisions and external-run output naming still need fixtures. |
| Batch/concurrency | **Flag** | Finalization order and invocation run-dir-file are pinned; duplicate detection and attachment copy still need fixture proof. |
| Inherited-constraints-grounded | **Pass** | Current code and ADR 0007/0009/0010 were checked; G6 conflict with design and WIP limits are explicit. |
