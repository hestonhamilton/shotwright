# shotwright-746.56 — captured page device scale factor (R + P)

## Goal and diagnosis

Record the scale of the page passed to `shot()` so a spec-created context does not inherit a misleading project label. The reported premise matches the code: the default project sets DSF 2 (`src/index.ts:98-109`), while `shot()` stores `page.viewportSize()` for the logical viewport and `info.project.use.deviceScaleFactor` for DSF (`src/capture.ts:202-209`). A page from `browser.newContext({ viewport, deviceScaleFactor: 1 })` therefore contributes its own viewport but the project's DSF. The PNG itself comes directly from the passed page or locator screenshot bytes, without conversion (`src/capture.ts:180-197`). This is a metadata defect, not a PNG scaling operation.

The shot sidecar carries both fields (`src/manifest.ts:14-29`, `src/manifest.ts:93-99`); assembly validates them and spreads the selected final-retry sidecar into the manifest without recalculating either (`src/manifest.ts:231-251`, `src/manifest.ts:303-334`). The reporter reads sidecars, builds test and media records, and calls assembly; it has no captured page from which to repair DSF (`src/reporter.ts:48-58`, `src/reporter.ts:61-93`, `src/reporter.ts:143-166`). Thus capture time is the correct ownership boundary for this value.

## Adjacent fields and downstream effects

| Field or label | Source today | Finding for this bead |
|---|---|---|
| Logical viewport / viewport chip | `page.viewportSize()` at shot time; gallery groups width, height and DSF (`src/capture.ts:207-209`, `src/gallery/render.ts:52-105`) | Page-derived already. It is the **logical viewport**, not necessarily PNG dimensions for full-page, clip or locator capture (`src/capture.ts:174-196`, `src/gallery/render.ts:161-163`). |
| DSF / gallery chip and card | Project `use.deviceScaleFactor` feeds the sidecar; gallery reads that manifest field verbatim (`src/capture.ts:208`, `src/gallery/render.ts:58-65`, `src/gallery/render.ts:154-163`) | Directly wrong for spec-created contexts; correcting the sidecar fixes the chip grouping, count and card metadata on newly generated runs. Existing run manifests remain historical records. |
| Device name and `isMobile` | `ShotEntry` has neither field, and the gallery card uses only viewport, DSF and capture kind for device-like metadata (`src/manifest.ts:14-29`, `src/gallery/render.ts:154-163`) | No additional mislabeled device or mobile field to repair. Do not infer either from viewport or project defaults. |
| Render provenance | Browser name/version/executable derive from `page.context().browser()`; configured channel derives from `info.project.use` (`src/capture.ts:198-201`, `src/provenance.ts:1-3`, `docs/adr/0023-observed-render-provenance.md:14`). Reporter aggregates the per-shot browser observation by test project (`src/manifest.ts:148-172`). | Browser identity is page-context based. Channel has the same project-configuration versus actual-page limitation, but is explicitly labelled configured by ADR 0023; it is not a DSF-like measurement to silently change (`docs/adr/0023-observed-render-provenance.md:14`, `docs/adr/0023-observed-render-provenance.md:27`). |
| Video / trace | Reporter copies test attachments and associates one media pair with the test ID; assembly assigns that pair to every shot in the test (`src/reporter.ts:92-131`, `src/manifest.ts:326-334`). | This explains the related `shotwright-746.61` wrong-page video symptom. Do not fix it here. Keep the DSF read local to the passed page; no new page-identity schema or media association should be introduced for this patch. The spec-created-context test can serve as a future fixture for that bead. |
| Compare | A/B image captions show decoded PNG pixel dimensions, and pair rendering has no logical viewport or DSF text (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:96-129`). Pairing is `(spec,name)` and image verdicts use source images (`src/gallery/compare-model.ts:217-265`). Render provenance comparison intentionally covers platform, distribution and per-project browser name/version, not DSF (`src/gallery/provenance.ts:23-28`, `src/gallery/provenance.ts:42-76`). | The bead's phrase “compare reflect it” needs an explicit display step: show each side's manifest logical viewport and DSF beside its PNG pixel dimensions. Do not fold DSF into pixel verdicts, pair identity or render-environment status. |

## Fix options

| Option | Benefits | Costs and edge cases |
|---|---|---|
| **Recommended: read `window.devicePixelRatio` through `page.evaluate()` immediately before the screenshot** | Reads the page passed to `shot()`, including a spec-created context. Works for full-page, clipped and locator screenshots because it does not infer scale from image size. Leaves screenshot options and returned bytes alone (`src/capture.ts:174-197`). | One browser round trip per captured shot. A closed page or failed evaluation fails the shot before capture; this is preferable to publishing a knowingly wrong project value. A navigation or page script that changes the reported property between evaluation and screenshot is a residual timing/trust limit. Validate finite positive output before writing (`src/manifest.ts:244-250`). |
| Derive DSF from PNG width / logical viewport width | No extra browser call; uses the captured bytes. | Wrong for full-page, clipped and locator shots, whose PNG extent need not equal the viewport (`src/capture.ts:174-196`). Even a viewport shot may have pixel rounding. Cannot infer DSF when `page.viewportSize()` is null (`src/manifest.ts:19-20`). |
| Read context options or project `use` | Cheap if a public, accurate context accessor exists. | Project `use` is the current bug (`src/capture.ts:208`). Any context-options route would need an explicit supported API and a test across spec-created contexts; do not depend on internal Playwright state for a patch. It also describes configured context scale rather than the page-observed value requested by acceptance. |

Read DSF after the existing check/filter path and before either screenshot branch (`src/capture.ts:166-196`), with no call on filtered shots. Use the supplied `page` even for a locator capture; a mismatch between a locator's owning page and the supplied page should be treated as a separate API misuse question, not silently guessed here. The test must pin that the sampled value is the one rendered by Playwright for the supported capture paths. A page already closed before capture will fail its screenshot regardless; a page that closes between the new read and screenshot should follow the current cleanup path (`src/capture.ts:219-231`). A page that closes only after successful capture can still retain the sampled metadata. No timing benchmark is needed for the patch, but the extra call should be measured if a consumer later reports capture throughput trouble.

No current Playwright behavior was needed from web search: the choice rests on the bead's requested observation, the repository's capture contract and a proposed real-browser test. The implementation must test the actual browser result before treating the observation as proven.

## Manifest and release compatibility

`deviceScaleFactor` already exists as nullable positive number in manifest v2 (`src/manifest.ts:7`, `src/manifest.ts:14-29`, `src/manifest.ts:244-250`), and readers already accept that value (`src/gallery/model.ts:112-125`). The change corrects values in new runs; it adds no field, changes no type, and needs no manifest version bump or v1 adapter edit. ADR 0021 reserves v2 for the shot `(spec,name)` identity and expanded outcome/publication contract; its reader compatibility and final-retry rules remain intact (`docs/adr/0021-shot-identity-and-manifest-v2.md:12-32`). This is a backwards-compatible bug fix: add a **patch** changeset targeting **0.5.1** from current package 0.5.0 (`package.json:2-3`, `docs/release-runbook.md:258-262`). Do not rewrite historical manifests.

## Numbered implementation plan

1. Add the capture-time page DSF observation in `src/capture.ts`, validate it as a finite positive number, and write it into the existing sidecar field. Preserve the existing screenshot call/options and raw returned bytes (`src/capture.ts:174-217`). Unit-test the source choice with project DSF 2 and page observation 1, plus failed/closed-page cleanup and filtered-shot no-call behavior; the current mock fixture pins the project to 2 (`test/unit/capture.test.ts:202-219`).
2. Extend the real Playwright contract fixture with a spec-created context using a viewport and DSF different from the project; capture a viewport shot and representative full-page, clip or locator shot. Assert manifest viewport and DSF per captured page, PNG dimensions where meaningful, and byte equality with an equivalent direct Playwright screenshot (`test/smoke/contract-consumer.test.ts:14-43`, `test/smoke/contract-consumer.test.ts:78-86`, `test/smoke/contract-consumer.test.ts:210-217`). This is the deterministic pin for page observation, timing of the read, and the byte-identical screenshot invariant. Do not use a golden image baseline.
3. Keep gallery grouping logic unchanged but extend gallery render coverage with two same-size shots at different observed DSFs: distinct chips and correct counts, cards and detail values (`src/gallery/render.ts:74-105`, `src/gallery/render.ts:154-163`; current render fixtures: `test/unit/gallery-render.test.ts:42-44`). View the generated gallery UI before shipping, per the repository UI rule (`CLAUDE.md:107-108`).
4. Add per-side logical viewport and DSF text to compare shot captions or adjacent metadata while retaining decoded pixel dimensions (`src/gallery/render-compare.ts:58-66`). Test corrected A/B labels, null/unavailable values, and unchanged pair state and counts (`src/gallery/render-compare.ts:96-129`, `src/gallery/compare-model.ts:18-38`, `src/gallery/compare-model.ts:217-265`). View the generated compare UI before shipping (`CLAUDE.md:107-108`).
5. Add a patch changeset, run `pnpm run typecheck && pnpm run lint && pnpm run test` plus the targeted real-browser smoke test, and inspect the output manifest, gallery and compare. No source or test files are changed in this R+P task.

## Risks, rollback and acceptance mapping

The main risk is that page evaluation can fail or observe a changed browsing state. The real-browser fixture in step 2 pins ordinary spec-created and screenshot cases; step 1 pins cleanup on failure. If the browser pin shows a mismatch, revise the data source before implementation rather than falling back to project config. Reverting the patch returns to the prior metadata behavior; schema and older manifests stay readable (`src/manifest.ts:14-29`, `src/gallery/model.ts:112-125`). Compare output should continue to publish through its existing staged replacement path (`src/gallery/generate-compare.ts:69-81`).

| Acceptance criterion | Steps |
|---|---|
| Manifest uses captured page DSF, including spec-created contexts | 1 and 2 |
| Gallery chips reflect captured DSF | 3 |
| Compare reflects captured DSF | 4 |
| Test covers project/context mismatch | 1 and 2 |

## Considered and declined

- Do not derive DSF from PNG dimensions: capture bounds vary by option (`src/capture.ts:174-196`).
- Do not substitute the test project or fixture page for the passed page: that is the defect (`src/capture.ts:158`, `src/capture.ts:207-209`).
- Do not add `device`, `isMobile`, page identity, or a manifest v3 field for this patch (`src/manifest.ts:14-29`, `docs/adr/0021-shot-identity-and-manifest-v2.md:12-32`).
- Do not change configured channel or render provenance comparison under this bead (`docs/adr/0023-observed-render-provenance.md:14`, `src/gallery/provenance.ts:23-28`).
- Do not change video association; `shotwright-746.61` owns that related symptom (`src/reporter.ts:92-131`, `src/manifest.ts:326-334`).
- Do not make DSF differences a compare failure: compare's gate is for measured image parity and is optional by default (`docs/adr/0022-compare-verdicts-are-review-aid.md:12-28`, `src/gallery/compare-model.ts:40-51`).

## Open questions and self-review

No owner decision is required for this scoped patch. The implementation must resolve one empirical detail through step 2: whether `window.devicePixelRatio` sampled immediately before each screenshot matches the rendered scale in the supported browser and capture modes. If that pin fails, revisit the source choice before code proceeds.

Self-review against `/rpiv`: **measured or flagged** — no unmeasured performance claim; the per-shot round trip is a mechanism, not a timing estimate. **Derived-value semantics** — DSF means the positive page-observed ratio at capture time, nullable only under the existing schema; it is per shot, including multiple contexts in one test. **Emergent structure** — chip grouping remains the `(viewport width, viewport height, DSF)` tuple (`src/gallery/render.ts:74-105`); no new structure. **Batch/concurrency** — shot sidecars remain atomic and final-retry assembly unchanged (`src/manifest.ts:106-116`, `src/manifest.ts:303-334`); compare publication remains staged (`src/gallery/generate-compare.ts:69-81`). **Inherited constraints grounded** — raw Playwright PNG bytes, v2 manifest fields, and compare's optional gate are visible in code and ADRs (`src/capture.ts:180-197`, `src/manifest.ts:14-29`, `docs/adr/0022-compare-verdicts-are-review-aid.md:12-28`).

## Redteam amendments (2026-10-29)

A plan redteam returned "proceed with changes"; both fix-now findings are adopted.

1. **Locator shots take page metadata from `locator.page()`.** The PNG comes from the locator (`src/capture.ts:180`), so sampling the supplied `page` would reproduce the mislabel when the locator belongs to another context. When `opts.locator` is set, read viewport and DSF from `opts.locator.page()`; otherwise from the supplied `page`. Do not reject a mismatch; that would be an API change in a patch. This replaces the "use the supplied `page` even for a locator capture" sentence above. Step 1 and step 2 tests cover a locator from a second context at a different DSF.
2. **Engine coverage.** The CI fixture stays Chromium (the default project is Desktop Chrome, `src/index.ts:98-109`). The V phase adds a one-off recorded check in Chromium, Firefox and WebKit: evaluated `devicePixelRatio` against PNG dimensions for a viewport shot at DSF 1 and 2, and for a locator shot. If any engine disagrees, stop and revisit the data source before shipping.
