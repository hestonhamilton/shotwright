# shotwright-746.52 — video and trace config plan

- **Phase:** Plan
- **Date:** 2026-10-29
- **Binding inputs:** `docs/shotwright-746.52-research.md:65-72` and the owner decisions recorded for this bead.

## Goal

Let consumer config branch on shotwright's `--video` and `--trace` requests, request one recorded video frame size, and retain the default project's DSF 2 while showing how to select DSF 1 for video runs. Keep capture toggles under shotwright's control (`docs/design.md:58-67`; `README.md:274-285`). No gallery, manifest, CLI flag, workflow, template, or run-publication change belongs to this feature (`docs/design.md:71-87`; `docs/shotwright-746.52-research.md:65-72`).

## Premise re-check

The bead still matches this worktree's code. `shotwright run` sets both indicators to `'1'` or `'0'` in the Playwright child before config loading (`src/cli.ts:666-683`). `defineShotsConfig` reads them for global, explicit-project, and default-project capture settings, but video is only `'on'` or `'off'`; `ShotsConfigOptions` has no `videoSize` (`src/index.ts:24-31`, `src/index.ts:84-110`). The default project remains 1440×960 at DSF 2; explicit projects cannot combine with top-level `deviceScaleFactor` (`src/index.ts:49-57`, `src/index.ts:99-109`). `shot()` writes Playwright's screenshot bytes and observes the page's pixel ratio (`src/capture.ts:180-216`), so an automatic DSF change would affect screenshot output. Existing factory tests cover the default DSF and env toggles, without a size path (`test/unit/factory.test.ts:166-180`).

The precise indicator contract is **shotwright flag intent at config evaluation**, not effective recording. A Playwright `--trace <mode>` after `--` stays passthrough; its mode does not set `SHOTWRIGHT_TRACE` (`src/cli.ts:175-192`). A shotwright `--trace` request can coexist with Playwright `--trace off`, so effective tracing can differ from the indicator (`src/cli.ts:125-158`, `src/cli.ts:669-683`). The reporter currently derives `flags.trace` from that indicator (`src/reporter.ts:155-159`); fixing this known bug belongs to `shotwright-746.67`, not this bead. The research redteam amendment requires this distinction (`docs/shotwright-746.52-research.md:65-72`).

## Numbered implementation steps

1. **Add the one public size field and pass it to all capture branches.** In `src/index.ts:24-33`, add optional `videoSize: { width: number; height: number }` to `ShotsConfigOptions`. At `src/index.ts:77-110`, omit this custom field from the object spread into Playwright config and construct one video setting: `'off'` when `SHOTWRIGHT_VIDEO !== '1'`; `'on'` when it is `'1'` and size is absent; `{ mode: 'on', size: videoSize }` when it is `'1'` and size is present. Apply that setting at global `use`, each explicit project, and the default project. Keep trace and screenshot ownership, default DSF 2, explicit-project DSF behavior, and config-probe behavior intact (`src/index.ts:35-57`, `src/index.ts:84-110`). `videoSize` is a requested recording frame size, shared by all projects; it does not set screenshot dimensions or promise that page content fills the frame (`docs/shotwright-746.52-research.md:69-72`). **Pin:** extend `test/unit/factory.test.ts:135-180` with an on/off/omitted-size matrix for global, default, and multiple explicit projects; assert the returned config has no stray top-level `videoSize`, that trace and screenshot remain owned, and that default DSF stays 2. Add a type assertion that `{ width, height }` is accepted and a wrong shape is rejected. No shotwright-only runtime validation: when video is off the size is unused, and when on Playwright validates its own video setting. A small CLI smoke case using a temporary config with a valid size should confirm the consumer's installed Playwright accepts the emitted config (`test/smoke/cli.test.ts:1055-1082`; `package.json:55-63`).

2. **Publish the indicators and the DSF recipe in consumer documentation.** At `README.md:274-314`, describe `SHOTWRIGHT_VIDEO` and `SHOTWRIGHT_TRACE` as exactly `'1'`/`'0'` in config evaluated by `shotwright run`; compare with `'1'`, and treat them as shotwright CLI flag intent. Explain that `-- --trace on` leaves the trace indicator `'0'`, while `--trace -- --trace off` leaves it `'1'` although Playwright can disable tracing (`src/cli.ts:125-158`, `src/cli.ts:175-192`, `src/cli.ts:669-683`). Document the `videoSize` shape, its requested-frame meaning, and Playwright's size choice when omitted (`src/index.ts:84-108`; `docs/shotwright-746.52-research.md:15-19`, `docs/shotwright-746.52-research.md:69-72`). Show `deviceScaleFactor: process.env.SHOTWRIGHT_VIDEO === '1' ? 1 : 2` for the default project, plus the same expression in each `project.use` for explicit projects (`src/index.ts:49-57`, `src/index.ts:99-109`; `README.md:300-314`). State that leaving it unset retains DSF 2 in the default project and that choosing DSF 1 changes screenshot pixels (`src/index.ts:99-107`; `src/capture.ts:188-216`). **Pin:** review the rendered Markdown and example syntax; use the CLI smoke case to load a temporary config containing the conditional expression, then assert DSF 1 under `--video` and 2 without it. Assert both indicator values at config-evaluation time for the two trace passthrough combinations, without treating them as effective trace or manifest values (`src/cli.ts:175-192`, `src/cli.ts:669-683`).

3. **Record the public API addition for release.** Add one `.changeset/<slug>.md` with `---`, `"shotwright": minor`, `---`, and this wording: “Let consumer configs read `SHOTWRIGHT_VIDEO` and `SHOTWRIGHT_TRACE` as shotwright flag-intent indicators, and set a shared recorded video frame size with `defineShotsConfig({ videoSize })`.” The field is new public config surface via the package root export (`src/index.ts:24-33`; `package.json:19-27`), and the existing changelog uses minor entries for additive user-facing features while reserving patch entries for clarifications and repairs (`CHANGELOG.md:3-25`; `CHANGELOG.md:28-41`). Changesets is the version/changelog mechanism (`docs/adr/0012-release-tooling-changesets-and-gitleaks.md:22-26`). **Pin:** check changeset frontmatter against `.changeset/config.json:1-10`, then run the normal lint/build checks that read package metadata (`package.json:41-53`).

These are one implementation PR's steps, with no dependency or component selection and no ADR required (`docs/shotwright-746.52-research.md:39-41`).

## V-phase checks

- Run `pnpm run typecheck && pnpm run lint && pnpm run test` (`CLAUDE.md:41-47`; `package.json:41-45`). Run the targeted CLI smoke test for the size and indicator cases from steps 1–2 (`test/smoke/cli.test.ts:1055-1082`). Record commands, results, and the acceptance checklist in `docs/shotwright-746.52-verification.md` as required by the phase contract (`CLAUDE.md:94-100`).
- Inspect an actual video artifact from the size smoke case for its requested frame dimensions, and inspect the paired shot PNG to confirm the DSF branch affects screenshot dimensions as Playwright reports. Treat encoding time and CPU claims as unverified; the research found no controlled adopter benchmark (`docs/shotwright-746.52-research.md:17-19`, `docs/shotwright-746.52-research.md:69-72`).
- Verify the run remains a review artifact, `latest` advances only on passed publication, `shot()` bytes still match Playwright screenshot bytes for the same viewport and DSF, the gallery remains self-contained, and the runner resolves the consumer's `@playwright/test` (`docs/design.md:30-38`, `docs/design.md:73-87`; `src/capture.ts:188-205`; `docs/adr/0002-playwright-peer-dependency.md:33-42`; `docs/adr/0005-gallery-single-file-inline-originals.md:20-24`). Existing tests cover those invariants; this feature must not modify their paths. If implementation unexpectedly changes demo or gallery UI, render and view it at phone and desktop widths before V sign-off (`CLAUDE.md:106-108`).

## Risks and rollback

- The documented env names become a supported consumer-config contract; changing their names or values later would break conditions in consumer configs (`src/cli.ts:669-683`). Keep the CLI assignment and test the public wording against subprocess observations.
- A requested frame can cost more encoding time and may scale page content; do not promise a DSF-specific encoder improvement or equivalence between video and screenshot pixels (`docs/shotwright-746.52-research.md:17-19`, `docs/shotwright-746.52-research.md:69-72`). A consumer can remove `videoSize` to restore Playwright's existing size choice or remove the conditional DSF override to restore its prior screenshot scale (`src/index.ts:84-108`).
- Playwright `--trace <mode>` can disagree with `SHOTWRIGHT_TRACE` and the manifest's current `flags.trace`; document intent and leave the manifest fix to `shotwright-746.67` (`src/cli.ts:175-192`; `src/reporter.ts:155-159`).
- Revert the size field, documentation, tests, and changeset together if the Playwright config smoke case fails across the supported peer range. Do not change run publication or capture bytes during rollback (`docs/design.md:73-87`; `src/capture.ts:188-205`).

## Considered and declined

- Automatic DSF 1 on video: it changes shot PNGs, while the reported DSF/encoder link remains unverified (`src/index.ts:99-107`; `src/capture.ts:188-216`; `docs/shotwright-746.52-research.md:17-19`).
- A flag callback/helper, per-project video sizes, `use.video` passthrough, and a new `--video-size` flag: each adds surface beyond the one shared field and existing child env needed here (`docs/shotwright-746.52-research.md:23-37`; `src/cli.ts:669-683`).
- Manifest flag repair or video/page linkage work: separate issues; current assembly and flags are in `src/reporter.ts:147-165`, and the research explicitly scopes linkage away (`docs/shotwright-746.52-research.md:13`, `docs/shotwright-746.52-research.md:69`).

## Acceptance mapping

| Acceptance criterion | Step and deterministic evidence |
|---|---|
| Consumer config knows when video and trace were requested | Step 2: docs plus subprocess assertions for `'1'`/`'0'`, including trace passthrough and override cases (`src/cli.ts:175-192`, `src/cli.ts:669-683`). |
| Consumer can set recorded video size | Step 1: factory matrix and Playwright smoke video with requested dimensions (`src/index.ts:24-31`, `src/index.ts:84-108`). |
| Sensible default DSF story for video runs | Step 2: retain DSF 2, document and smoke-test conditional DSF 1 (`src/index.ts:99-107`; `README.md:300-314`). |
| Covered by tests | Steps 1–2: factory and CLI smoke tests; V runs standard checks (`test/unit/factory.test.ts:135-180`; `test/smoke/cli.test.ts:1055-1082`; `package.json:41-45`). |

## Open questions

None blocking. Recommendation: accept Playwright's validation for `videoSize` when video is enabled and leave unused size inert when disabled; this keeps the API as one optional field without duplicating a peer dependency's size rules (`src/index.ts:84-108`; `docs/shotwright-746.52-research.md:35-36`).

## Self-review

- **Measured or flagged:** pass; no DSF/encoder performance claim is treated as measured (`docs/shotwright-746.52-research.md:17-19`).
- **Derived-value semantics:** pass; indicators mean shotwright flag intent at config time, including passthrough and override cases; size is one request shared by all projects and inert when recording is off (`src/cli.ts:175-192`, `src/cli.ts:669-683`; `src/index.ts:84-108`). Pinned in steps 1–2.
- **Emergent structure:** pass; no new stored structure. Explicit projects all receive the same size; the multiple-project matrix pins cardinality (`src/index.ts:90-110`).
- **Batch and concurrency:** pass; no batch or publication mutation; existing atomic `latest` rule stays intact (`docs/design.md:73-87`).
- **Inherited constraints grounded:** pass; config branches, CLI env timing, screenshot bytes, release mechanism, and trace manifest behavior were checked against the cited code and ADRs. Pins are named in each step.

## Redteam amendments (2026-10-29)

A plan redteam returned "proceed with changes" with no invariant findings. Adopted:

1. **Config-shape assertions are the deterministic size pin.** Step 1's factory tests assert the emitted `video: { mode: 'on', size }` shape on every branch. Drop the planned real-video recording and manual frame inspection; the existing video smoke case (`test/smoke/cli.test.ts:1069-1082`) remains the integration check, since `videoSize` passes a native Playwright option through.
2. **Narrow the smoke claim.** A smoke run covers the Playwright version installed in this repo only, not the consumer's or the peer range. The rollback condition reads "if the smoke case fails on the installed test version".
3. **V runs the smoke suite explicitly.** `pnpm run test` targets `test/unit` only; V also runs `pnpm run smoke` (or the exact targeted Vitest command) for the step 2 indicator and DSF cases.
