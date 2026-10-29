# shotwright-746.52 — video and trace config research

- **Phase:** Research
- **Date:** 2026-10-29
- **Bead:** `shotwright-746.52`

## Context and goal

Let a consumer react to `shotwright run --video` and `--trace`, choose the recorded video dimensions, and make the device scale factor (DSF) choice explicit without unexpectedly changing screenshots. Consumer config should stay thin and the harness should retain control of capture toggles (`CLAUDE.md:16-30`; `docs/design.md:58-67`). The design treats screenshots as review artifacts, not golden assertions, and publishes `latest` only after a passed run (`docs/design.md:30-36`, `docs/design.md:73-87`).

**Premise check.** The bead is accurate on this branch. `run` places `SHOTWRIGHT_VIDEO` and `SHOTWRIGHT_TRACE` as `'1'`/`'0'` into the Playwright child environment before spawning it (`src/cli.ts:669-683`). `defineShotsConfig` reads them, but writes only string `'on'`/`'off'`, including at the global, explicit-project, and default-project levels (`src/index.ts:84-108`). Its public options omit `use.video` and `use.trace`, and the current docs say these belong to the harness (`src/index.ts:24-31`; `README.md:274-297`). The default project sets viewport 1440×960 and DSF 2; explicit projects own their DSF and cannot combine with top-level `deviceScaleFactor` (`src/index.ts:49-57`, `src/index.ts:98-109`; `README.md:300-314`). Existing tests establish the env toggles and default DSF, but no video-size path (`test/unit/factory.test.ts:166-180`). `shot()` passes through Playwright's screenshot bytes and records the observed pixel ratio, so changing DSF changes the underlying capture dimensions (`src/capture.ts:180-217`). The manifest already records video and trace flag booleans, so this feature need not change its schema (`src/reporter.ts:147-159`).

**Scope interaction.** `shotwright-746.61` concerns which page receives a video in multi-context specs. This research only chooses config exposure and dimensions. Changing `use.video` size does not establish correct page-to-video linkage: Playwright associates a video with each page, and manually created contexts require explicit closing ([Playwright Videos](https://playwright.dev/docs/videos), read 2026-10-29; compare the current artifact assembly in `src/reporter.ts:147-165`). Keep that linkage bead independent.

## Prior art and current practice

All external sources below were read **2026-10-29**. Playwright Test's [video guide](https://playwright.dev/docs/videos) and [TestOptions.video reference](https://playwright.dev/docs/api/class-testoptions#test-options-video) document string modes and `{ mode, size }`. Video is off by default; `'on'` records every test. An unspecified size follows the CSS viewport, scaled down to fit within 800×800; if viewport is not configured, it defaults to 800×450. The image is scaled down as needed. Thus shotwright's 1440×960 viewport currently implies a 800×533-ish recording (the exact integer result is an **estimate**, not measured), regardless of the DSF 2 screenshot size (`src/index.ts:98-107`). Playwright also says larger frame sizes and frame rates use more encoding CPU ([TestOptions.video](https://playwright.dev/docs/api/class-testoptions#test-options-video), read 2026-10-29). The current runner source installed from the locked 1.64.1 package passes `video.size` to `browser.newContext({ recordVideo })` separately from the ordinary context options; this supports treating video dimensions and DSF as distinct knobs (local dependency inspection, version pinned in `package.json:54-61`; Playwright's public [Browser.newContext recordVideo reference](https://playwright.dev/docs/api/class-browser#browser-new-context-option-record-video), read 2026-10-29).

Playwright's [emulation guide](https://playwright.dev/docs/emulation) treats DSF as browser/device emulation, while its [video guide](https://playwright.dev/docs/videos) describes recording size through the video option. There is no documented promise that DSF 2 doubles the encoded video's frame dimensions. DSF 2 can still increase page rendering and screenshot work; a recording-size setting directly controls video frame dimensions. A [Playwright video quality issue](https://github.com/microsoft/playwright/issues/31424) (opened 2024, re-read 2026-10-29) reports CPU and quality pressure for larger Chromium recordings, but does not isolate DSF as the cause. A [2025 Playwright frame-timing issue](https://github.com/microsoft/playwright/issues/35776) likewise points to recording sensitivity under load, without establishing a DSF-specific threshold. No controlled adopter benchmark was available in this research. The statement that 2× “stresses the webm encoder” is therefore an adopter observation to test, not a general default-setting fact.

Comparable mature tools expose recording separately from display setup. [Cypress video configuration](https://docs.cypress.io/app/guides/screenshots-and-videos) makes video opt-in and documents encoding cost; its [configuration reference](https://docs.cypress.io/app/references/configuration) exposes viewport sizing separately. Playwright itself supplies the closest model: one boolean/mode to decide whether to record and an optional size to set frame dimensions ([Playwright Videos](https://playwright.dev/docs/videos), read 2026-10-29). This supports a small shotwright size option while preserving `--video` as the recording switch.

## Options

| Option | Benefit | Cost and risk | Verdict |
|---|---|---|---|
| **Document `SHOTWRIGHT_VIDEO`/`SHOTWRIGHT_TRACE` as read-only run-config API; add `videoSize` to `defineShotsConfig`** | Uses flags already set before config evaluation (`src/cli.ts:669-683`), keeps CLI ownership of modes (`src/index.ts:84-108`), one typed field for a static size, no second flag parser | Consumers needing run-dependent DSF use an env comparison in their config; env values become supported API | **Recommended** |
| `defineShotsConfig((flags) => options)` plus `videoSize` | Typed flags; one callback can choose DSF and size | New factory overload and config-evaluation semantics; more API for two existing booleans; still needs a size field | Viable if avoiding environment variables is a firm public-API policy |
| `defineShotsConfig({ video: { size } })` | Closely mirrors Playwright video shape | Ambiguous next to harness-owned `use.video`; invites requests for `mode` that conflict with CLI ownership (`README.md:274-282`) | Decline for now |
| Allow `use.video`/`use.trace` passthrough | Native Playwright API | A consumer can override the CLI, while run flags and manifest still report only CLI intent (`src/index.ts:84-108`; `src/reporter.ts:155-159`) | Decline |
| Add `--video-size` CLI flag | Per-run flexibility | New parser surface and flag placement rules; a stable project-level size already belongs in config (`src/cli.ts:78`, `docs/adr/0006-shotwright-flags-parse-after-separator.md:40-50`) | Decline until a concrete per-run use case |

## Recommendation

1. Publicly define `SHOTWRIGHT_VIDEO` and `SHOTWRIGHT_TRACE` as **read-only indicators while `shotwright run` evaluates the consumer config**. Values are exactly `'1'` or `'0'`; compare explicitly with `'1'`. Do not encourage setting them externally: the CLI overwrites both in its child env (`src/cli.ts:669-683`). Example: `deviceScaleFactor: process.env.SHOTWRIGHT_VIDEO === '1' ? 1 : 2`. Document that the default project and each explicit project need their own DSF expression (`src/index.ts:49-57`, `src/index.ts:98-109`). A helper or callback is unnecessary for the current two booleans; the env names are already in the config process.
2. Add a typed, optional top-level `videoSize: { width: number; height: number }` to `ShotsConfigOptions`. When `--video` is on, use `{ mode: 'on', size: opts.videoSize }` in every config/project branch; when off, retain `'off'`. Omitting `videoSize` should continue to delegate size selection to Playwright. Define whether invalid dimensions should fail early in the Plan phase and test both default and explicit projects (`src/index.ts:24-31`, `src/index.ts:84-108`; [Playwright TestOptions.video](https://playwright.dev/docs/api/class-testoptions#test-options-video), read 2026-10-29). The field is a package-level constant for all projects; project-specific sizes remain an open extension if a consumer demonstrates need.
3. Preserve DSF 2 for the default project. The bead's DSF 1 request is supported through the documented flag expression. Automatically switching DSF on `--video` would alter screenshot dimensions and visual rendering in a run whose screenshots are still primary review artifacts (`src/index.ts:98-107`; `src/capture.ts:180-217`; `CLAUDE.md:24-30`). The external evidence establishes video-size/CPU cost, not a harmful DSF-2 default. A controlled paired run could revisit this decision by comparing video frame dimensions, encoder CPU/time, video bytes, and screenshot dimensions at DSF 1 and 2 with the same viewport and `videoSize` ([Playwright TestOptions.video](https://playwright.dev/docs/api/class-testoptions#test-options-video), read 2026-10-29).

**Binding surface and versioning.** This promotes two existing env names to documented consumer-config API and adds one published `defineShotsConfig` option/type (`src/index.ts:24-33`; package root export in `package.json:19-25`). It does **not** propose a new CLI flag, manifest field, workflow input, or export path (`src/cli.ts:78`; `src/reporter.ts:155-159`; `package.json:19-36`). It is additive but public. From current package `0.6.0` (`package.json:2-3`), release as **0.7.0** under the pre-1.0 minor-for-feature policy; a patch would understate the new API. If the project release policy differs, settle that in Plan.

**ADR.** None warranted: no foundational dependency or architecture is selected. This is a reversible, scoped config field and documentation of existing run indicators. Existing ownership is already in `docs/design.md:58-62`; the research and later Plan can record the precise API. The highest numbered ADR in this worktree is `0026`; no number is reserved.

## Open questions for the owner

1. Accept the recommended env indicators as supported config-time API, or require a typed callback/helper despite the extra surface?
2. Accept one `videoSize` for all projects, or is there a real multi-project case needing sizes per project now?
3. Preserve default DSF 2 and document the conditional DSF 1 override, pending a paired benchmark, or authorize a default change based on the adopter's observation alone?

The research proceeded with the orchestrator's starting stance; no kickoff answers were requested.

## Considered and declined

- Mirroring Playwright's entire `video` object: exposes mode/fps/annotation knobs beyond the bead and weakens harness ownership (`src/index.ts:84-108`; `README.md:280-282`).
- Changing screenshot scale solely to ease recording: makes a video flag change PNG pixels (`src/capture.ts:180-217`).
- Writing video dimensions to the manifest in this bead: the existing manifest records requested flags and artifact links, not encoded media metadata (`src/reporter.ts:147-159`; `src/manifest.ts:20-25`, `src/manifest.ts:84`).

## Self-review

- **Measured or flagged:** pass; the only computed 800×533-ish dimension is marked estimate; DSF/encoder causality remains unverified.
- **Derived-value semantics:** pass; the proposed env values mean CLI request at config time, including `'0'` when disabled; `videoSize` is one shared recording bound, absent means Playwright default. It says nothing about whether a file is ultimately retained or correctly linked.
- **Emergent structure:** pass; no new stored structure. Explicit projects receive the same size; one video may be associated with each page by Playwright, with linkage deferred to `shotwright-746.61`.
- **Batch and concurrency:** pass; no batch job or publishing behavior changes. Existing run publication remains governed by `docs/design.md:73-87`.
- **Inherited constraints grounded:** pass; CLI env timing, config overrides, screenshot capture, and manifest flag behavior were checked against `src/cli.ts:669-683`, `src/index.ts:84-108`, `src/capture.ts:180-217`, and `src/reporter.ts:147-159`.

## Redteam amendments (2026-10-29)

A redteam returned "proceed with changes". Adopted:

1. **Define the indicators precisely (fix now).** `SHOTWRIGHT_VIDEO` and `SHOTWRIGHT_TRACE` report shotwright's CLI flag intent at config evaluation, not effective recording. shotwright deliberately passes `-- --trace on` to Playwright without setting the indicator (`src/cli.ts:175-192`), and Playwright's own `--trace off` can override a shotwright `--trace` request. Document the passthrough exception and test both combinations. The related manifest mismatch (`flags.trace` derived from the indicator, `src/reporter.ts:155-159`) is filed as a separate bug.
2. **Drop the weak citation.** Playwright issue #35776 concerns frame timestamps and does not support the DSF/encoder premise; remove it from the DSF rationale. The adopter's encoder observation stays explicitly unverified.
3. **Describe `videoSize` as the requested frame size.** Playwright may scale the page image to fit it; do not promise that content fills the frame or matches screenshot pixels.
4. Smallest change confirmed: document the indicators, add one optional size field, and show a conditional DSF override in consumer docs. Minor changeset for the new config field.
