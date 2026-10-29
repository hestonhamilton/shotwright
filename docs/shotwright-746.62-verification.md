# shotwright-746.62 — verification

- **Phase:** V
- **Date:** 2026-10-29
- **Verdict:** PASS

## Live runs

Run per plan amendments 1 and 2 (`docs/shotwright-746.62-plan.md`). A temporary branch-only caller, `.github/workflows/v-746-62.yml`, called `./.github/workflows/shotwright.yml` in `mode: self` with the template's exact expressions: `upload: ${{ github.event_name == 'pull_request' && 'on-failure' || 'always' }}` and `retention-days: ${{ github.event_name == 'pull_request' && 2 || 7 }}`. A temporary spec, `demo/shots/zz-v-746-62-fail.shots.ts`, took one shot and then failed an assertion. Both were committed separately and reverted on this branch before review.

| GitHub run | Event (mode) | `Run shotwright` | Resolve / Upload / Summary | Artifact |
|---|---|---|---|---|
| 40967762807 | pull_request (`on-failure`), failing spec present | failure | success / success / success | `v-746-62-pull_request`, 5.3 MB, created 2026-10-29T22:42Z, expires 2026-10-31T22:42Z (2 days) |
| 40968011747 | pull_request (`on-failure`), failing spec reverted | success | skipped / skipped / skipped | none |
| 40968026073 | workflow_dispatch (`always`) | success | success / success / success | `v-746-62-workflow_dispatch`, 4.3 MB, created 2026-10-29T22:44Z, expires 2026-11-05T22:44Z (7 days) |

The failed-run artifact was downloaded and inspected. It holds `manifest.json` with status `failed`, the temporary `v-746-62-before-failure` shot, `gallery.html`, `shots/` and `failures/`. The overall verdict stayed failed; upload did not change it.

## Pinned locally, not live (amendment 2)

`never`, rejection of unknown values, and the incomplete-directory summary wording are pinned by the contract assertions in `test/unit/init.test.ts`. Cancellation and the unchanged `always` missing-directory path were checked statically against the `if:` conditions in `.github/workflows/shotwright.yml`.

## Gates

`pnpm run typecheck && pnpm run lint && pnpm run test`: typecheck and lint pass; `Test Files 23 passed (23)`, `Tests 645 passed | 1 skipped (646)`. `node scripts/sync-template-pin.mjs --check`: template pin is v0.5.0.

## Not done

- The `archive: false` single-file gallery experiment (amendment 4) is outside this bead's sign-off and was not run.
- The release-pinned generated template can only be exercised after the next release, since `@v0.5.0` lacks the `upload` input (amendment 1).
