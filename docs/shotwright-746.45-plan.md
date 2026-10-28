# shotwright-746.45 — artifact wording plan

Plan date: 2026-10-28. Research and real-gallery evidence: `docs/shotwright-746.45-research.md`. This plan specifies a P3 copy change; no implementation is in this phase.

## Goal

Make the gallery's video/trace section and both pages' relative-file warnings understandable without claiming more than the manifest proves. Preserve grouping, relative links, playable video, self-contained CSS/JS, data-image embedding, and the meta CSP (`src/gallery/render.ts:180-264`, `src/gallery/render.ts:439-506`; `src/gallery/render-compare.ts:58-120`, `src/gallery/render-compare.ts:195-201`).

## Steps

1. In one implementation PR, replace the literal and dynamic copy below in `src/gallery/render.ts` and `src/gallery/render-compare.ts`. Keep the exact path-pair key, group cardinality, HTML structure, link targets, media element, and CSP unchanged (`src/gallery/render.ts:180-264`, `src/gallery/render.ts:439-506`; `src/gallery/render-compare.ts:58-120`, `src/gallery/render-compare.ts:195-201`). Do not make compare's warning depend on the gallery-specific `siblingWarning` constant, since its page-to-run layout differs (`src/gallery/render.ts:11`; `src/gallery/render-compare.ts:74-95`).
2. Update only assertions tied to changed copy and add a focused browser assertion that the gallery section's heading, links, caption, and native video remain visible for a real video/trace pair. Use existing Chromium fixtures in `test/unit/gallery-browser.test.ts` or the demo smoke path in `test/smoke/cli.test.ts` (`test/unit/gallery-render.test.ts:371-415`; `test/unit/gallery-compare-render.test.ts:161-166`, `test/unit/gallery-compare-render.test.ts:179-230`; `test/smoke/cli.test.ts:606-610`). Where a test counts or matches HTML tags, use case-insensitive, word-bounded regexes such as `/<video\b/gi` and `/<script\b/gi` to meet the repo's CodeQL constraint; replace the existing `/<video /g` assertion if touching it (`test/unit/gallery-render.test.ts:381`).
3. Verify with `pnpm run typecheck && pnpm run lint && pnpm run test`, the relevant demo smoke case, and a Chromium view of a generated gallery with both `--video` and `--trace` (`CLAUDE.md:41-48`, `CLAUDE.md:103-108`; `src/cli.ts:78`, `src/cli.ts:144-148`). Inspect a missing-file state and a compare page with custom output placement so both warnings remain true (`test/unit/gallery-render.test.ts:389-405`; `test/unit/gallery-compare-render.test.ts:232-235`).

## String-by-string replacements

Conditions and mechanisms are detailed in `docs/shotwright-746.45-research.md`. `{n}` is the current group count; use singular/plural correctly (`src/gallery/render.ts:174-194`). “Linked” intentionally describes manifest references, including unavailable files (`src/gallery/model.ts:492-505`, `src/gallery/model.ts:566-580`).

| File:line | Condition | Old → new |
|---|---|---|
| `src/gallery/render.ts:257` | Spec with shots | `Group artifacts` → `Videos and traces` |
| `src/gallery/render.ts:260` | Spec with shots, accessible aside name | `Deduplicated artifacts for {spec}` → `Videos and traces for {spec}` |
| `src/gallery/render.ts:261` | Spec with shots | `Deduplicated artifact set(s)` → `Videos and traces` |
| `src/gallery/render.ts:262` | Spec with shots | `Exact manifest paths are shown once per shared video/trace pair.` → `Files linked from several screenshots appear once here.` |
| `src/gallery/render.ts:208` | Null/null group | `Video not captured` → `No video linked to these screenshots` |
| `src/gallery/render.ts:209` | Null/null group | `Trace not captured` → `No trace linked to these screenshots` |
| `src/gallery/render.ts:212` | Non-null pair | `shared by {n} shots by identical manifest path; test title unavailable` → `Linked from {n} screenshot` when n=1, otherwise `Linked from {n} screenshots` |
| `src/gallery/render.ts:198` | Available video/trace reference | `Download sibling video` / `Download sibling trace` → `Download video` / `Download trace` |
| `src/gallery/render.ts:200` | Unavailable video/trace reference | `Broken {kind} reference: {path}` → `{Video/Trace} file unavailable: {path}` |
| `src/gallery/render.ts:220` | Available video, accessible name | `Shared captured video` → `Recorded video for linked screenshots` |
| `src/gallery/render.ts:217` and `src/gallery/render.ts:11` | Non-null gallery pair | `Sibling-file warning: requires this gallery beside the run directory.` → `File location: Keep this gallery in its run folder to play or download video and trace files.` |
| `src/gallery/render.ts:464` | At least one video/trace reference | `Sibling artifacts grouped by identical manifest path` → `Video or trace links in this run` |
| `src/gallery/render.ts:464` | No video/trace reference | `Video and trace absent in this run` → `No videos or traces linked to screenshots` |
| `src/gallery/render.ts:477-478` | Run facts | `Video flag: On/Off` / `Trace flag: On/Off` → `Video recording requested: Yes/No` / `Trace recording requested: Yes/No` |
| `src/gallery/render.ts:501` | Every gallery | `Sibling video and trace links require this gallery beside the run directory.` → `To use video and trace links, keep this gallery in its run folder.` |
| `src/gallery/render-compare.ts:94` | Screenshot or data-artifact pair | `Sibling-file warning: Each download link requires this gallery beside the run directory for its side.` → `File location: Keep this comparison page and both run folders in their current relative locations to use download links.` |

Keep `Video unavailable: {path}` because it already describes the failed file check (`src/gallery/render.ts:221`; `src/gallery/model.ts:492-505`). Keep `Data artifacts`, its download action, failure evidence, and compare data-artifact verdict text because they describe separate material (`src/gallery/render.ts:288-346`; `src/gallery/render-compare.ts:114-120`, `src/gallery/render-compare.ts:201`). Keep `Download A/B` because the compare page already identifies the sides (`src/gallery/render-compare.ts:58-66`, `src/gallery/render-compare.ts:83-90`).

## Tests to update

| Test | Change |
|---|---|
| `test/unit/gallery-render.test.ts:371-386` | Assert one group, `Linked from 3 screenshots`, one video and trace download, and the corrected location sentence. Convert the touched video-tag match to `/<video\b/gi`. |
| `test/unit/gallery-render.test.ts:389-405` | Replace the old broken-reference copy expectation while retaining path and diagnostic assertions. |
| `test/unit/gallery-render.test.ts:408-415` | Assert the null-reference copy and new header badge. |
| `test/unit/gallery-compare-render.test.ts:166`, `test/unit/gallery-compare-render.test.ts:228-230` | Assert the new warning count and exact relative-location sentence. Keep A/B href expectations. |
| `test/smoke/cli.test.ts:606-610` | Assert the renamed run-facts fields and no-reference badge. |
| `test/unit/gallery-browser.test.ts:1-435` or `test/smoke/cli.test.ts:1056-1082` | Add one meaningful browser-level check for a generated video/trace section, especially accessible label, native video, and visible download actions. Reuse current fixtures or demo runner; do not add a copy-mirroring test for every string. |

## Acceptance mapping

| Step | Acceptance criterion |
|---|---|
| 1 | Every gallery video/trace label in the table describes linked files or the review action; the group caption does not infer a test title or identity (`src/gallery/render.ts:180-264`). |
| 1 | Gallery and compare warnings describe the actual relative-file requirement, including custom compare placement (`src/gallery/generate.ts:22-37`; `src/gallery/render-compare.ts:74-94`). |
| 1–2 | Present, absent, and unreadable reference states are distinguished in copy and tests (`src/gallery/model.ts:492-505`, `src/gallery/model.ts:566-580`; `test/unit/gallery-render.test.ts:371-415`). |
| 2–3 | A real generated video/trace section remains playable and downloadable, while pages retain their inline resources and CSP (`src/gallery/render.ts:197-229`, `src/gallery/render.ts:439-506`; `src/gallery/render-compare.ts:195-201`). |
| 2–3 | Updated tests pass; touched HTML-tag regexes use case-insensitive word boundaries (`test/unit/gallery-render.test.ts:381`; `CLAUDE.md:41-48`). |

## Risks and rollback

The main risk is semantic drift: a label may imply that a video exists when only its manifest path exists, or imply one test when multiple shots merely share paths. Pin that assumption in step 2 with the existing shared-pair and broken-file fixtures, plus an explicit one-shot caption case (`src/gallery/render.ts:180-221`; `test/unit/gallery-render.test.ts:371-405`). Another risk is inaccurate compare placement language; pin it with the custom-output test (`test/unit/gallery-compare-render.test.ts:232-235`; `src/cli.ts:369-419`). Revert the copy and matching test expectations if the browser check reveals a misleading state; no data migration or persistent format changes are involved (`src/gallery/render.ts:180-264`; `src/gallery/render-compare.ts:93-120`).

## Out of scope

No change to grouping keys, test association, model schema, video player, trace viewer, data-artifact compare verdicts, layout, CSS, scripts, CSP, or relative link generation (`src/gallery/render.ts:180-264`, `src/gallery/render.ts:439-506`; `src/gallery/render-compare.ts:58-120`, `src/gallery/render-compare.ts:195-201`). No new dependency or ADR is needed for copy-only edits.

## Open questions for the owner

1. Choose “Videos and traces” or “Recordings and traces” for the section label. Default recommendation: “Videos and traces” (`src/gallery/render.ts:197-235`).
2. Include the run-facts `Video flag` / `Trace flag` rename in this bead? Default recommendation: yes, since those values mean requested recording settings, while the badge checks actual manifest links (`src/gallery/render.ts:365`, `src/gallery/render.ts:477-478`).

These questions do not block research or the concrete copy proposal. Implementation should use the recommended text unless the owner chooses otherwise.

## Self-review

- Measured or flagged: pass; no numeric performance claim or estimate is made.
- Derived-value semantics: pass; count, null references, and unavailable files have separate wording and assertions (`src/gallery/render.ts:180-221`; `src/gallery/model.ts:492-505`).
- Emergent structure: pass; spec boundaries and first-seen grouping remain untouched (`src/gallery/model.ts:583-593`; `src/gallery/render.ts:180-194`).
- Batch/concurrency: not applicable; this is static render copy.
- Inherited constraints: pass; the steps preserve the existing CSP and self-contained pages (`src/gallery/render.ts:439-506`; `src/gallery/render-compare.ts:195-201`) and the repo's review-artifact purpose (`docs/design.md:30-38`).

## Owner-question resolution (orchestrator, 2026-10-28)

The section label is "Videos and traces", and the run-facts rename is included, with the wording amended below.

## Redteam disposition (2026-10-28) — amends the replacement table

1. **Section intro is false for single shots and no-file groups. Accepted, fix now.** The new intro describes the grouping without claiming files exist or are shared: "Screenshots that reference the same video and trace are listed together."
2. **The badge promises links that may not exist. Accepted, fix now.** It reads "Video or trace references in this run". A test covers a run where every reference is broken.
3. **"N screenshots" can overcount. Accepted, fix now.** The caption reads "Referenced by {n} shot(s) in this spec", with correct singular and plural. Tests cover a missing PNG in the group and a filtered view, where the group count is unchanged and that is still true.
4. **The run-facts rename must name its source. Accepted, fix now.**
   - The labels are "Shotwright video flag: On/Off" and "Shotwright trace flag: On/Off".
   - "Recording requested" is not used, because Playwright's `--trace retain-on-failure` passthrough leaves the manifest flag false.
   - A test covers the passthrough case.
5. **The location warning implies availability. Accepted.** It reads "File location: keep this gallery in its run folder so available video and trace links work." The same meaning applies to the footer sentence.
6. **Extra demo run is disproportionate. Accepted.** Verification uses one focused generated-page browser check and the standard gates. Before shipping, it views one generated gallery with video and trace, as the repo's viewed-UI rule requires.
