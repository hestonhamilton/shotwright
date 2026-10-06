# shotwright-746.2.2 — E2.P Plan: demo app implementation

- **Doc:** plan (P phase)
- **Bead:** shotwright-746.2.2 · parent epic shotwright-746.2 (E2 Demo app)
- **Date:** 2026-07-29
- **Inputs:** [research](shotwright-746.2.1-research.md) · [ADR 0004](adr/0004-demo-vite-toolchain.md) · [ADR 0002](adr/0002-playwright-peer-dependency.md) · [ADR 0003](adr/0003-tsc-only-build.md)
- **Status:** committed 2026-07-29 after the P-transition redteam gate (one pass;
  ledger below)
- **Provenance:** planned and redteamed by delegated agents;
  synthesized and verified by the reviewer. Raw reports archived outside the repo.

## Goal

Replace the two-page placeholder with a framework-free, Vite-served demo producing five review captures across two specs. Preserve the package’s tsc-only build and public Node `>=20` contract while proving demo types, the multi-page production build, fresh-clone execution, filtering, parallel manifest assembly, video, and trace independently.

## Premise audit — no contradiction found

The signed-off research matches the current tree:

- The demo is still served by the custom Node server (`demo/serve.mjs:1-37`), and `shots.config.ts` invokes it with unconditional server reuse (`demo/shots.config.ts:9-13`).
- The two pages remain placeholders (`demo/index.html:9-14`, `demo/about.html:9-13`).
- Demo config/spec imports point directly at `dist` (`demo/shots.config.ts:4`, `demo/shots/home.shots.ts:1`, `demo/shots/about.shots.ts:1`).
- Root typecheck excludes demo TS (`tsconfig.json:14`), while the package build intentionally emits only `src` (`tsconfig.build.json:7-9`).
- Bare self-references resolve through `dist` declarations in the exports map (`package.json:19-31`), creating the anticipated build-before-typecheck ordering requirement.
- The smoke test currently executes one unfiltered run without a worker argument (`test/smoke/cli.test.ts:22-28`) and expects three shots (`test/smoke/cli.test.ts:43-49`).
- The CLI already transports `--only`, `--video`, `--trace`, and Playwright passthrough arguments (`src/cli.ts:23-47`, `src/cli.ts:76-86`); no CLI change is needed.
- The config factory already maps video/trace environment flags and passes `webServer` through (`src/index.ts:44-71`); no public API change is needed.

## Measurements and runtime budget

Measurements were made on Linux, Node 24.16.0, Playwright 1.62.0, and the already-locked Vite 8.1.5 (`pnpm-lock.yaml:774-777`).

| Measurement | Wall time |
|---|---:|
| Current unchanged `pnpm run smoke`—build plus one three-shot run (`package.json:41`) | **1.917 s** |
| Unfiltered current CLI run, `--workers=2` | **0.99 s** |
| Standalone current `--only` run | **0.97 s** |
| Current video-only run spanning both specs | **1.04 s** |
| Current trace-only run spanning both specs | **1.01 s** |
| Four-run CLI subtotal | **4.01 s** |
| Cold Vite 8.1.5 process, `--force`, start to first successful HTTP response | **0.111 s** |
| Vite’s own reported readiness | **0.072 s** |

Vite’s measured HTTP readiness uses about 0.19% of Playwright’s documented 60-second default web-server allowance (`docs/shotwright-746.2.1-research.md:47-49`). No explicit timeout override is warranted.

The projected final smoke time is **ESTIMATE (unverified): 5–7 seconds**, based on the measured 4.01-second matrix plus existing build/Vitest overhead and two additional PNGs. The same-host implementation budget is **10 seconds**. Step 2 must record the final wall time; exceeding 10 seconds triggers profiling, not removal or recombination of required matrix runs. Video and trace runs will each use `--only` to capture exactly two cross-spec shots.

## Resolved planning decisions

### Scripts and verification composition

Only two new public scripts are added:

- `demo:shots`: sanctioned fresh-clone capture entry; builds `dist`, then runs the built CLI.
- `demo:build`: standalone multi-page production-build gate.

There is no `demo:dev` wrapper and no CI-specific alias. Playwright invokes `vite dev` directly, while `reuseExistingServer: !process.env.CI` supplies the CI distinction. The existing gate trio remains exactly:

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
```

Demo verification remains separate and follows it:

```bash
pnpm run demo:build
pnpm run smoke
```

Fresh-clone verification is (note `CI=1` — see redteam finding A1: without it,
`reuseExistingServer` lets a Vite server from *another checkout* serve the run,
silently certifying a clone whose own demo is broken):

```bash
pnpm install
pnpm exec playwright install chromium
CI=1 pnpm run demo:shots
```

The bare `pnpm run demo:shots` (reuse enabled) remains the sanctioned *local
convenience* entry point; the *proof* run always sets `CI=1`.

### Exact `package.json` diff

```diff
   "scripts": {
     "build": "tsc -p tsconfig.build.json",
-    "typecheck": "tsc --noEmit",
+    "typecheck": "pnpm run build && tsc --noEmit",
     "lint": "eslint . && pnpm run build && publint",
     "test": "vitest run test/unit",
-    "smoke": "pnpm run build && vitest run test/smoke"
+    "smoke": "pnpm run build && vitest run test/smoke",
+    "demo:build": "vite build --config demo/vite.config.ts",
+    "demo:shots": "pnpm run build && node dist/cli.js run --config demo/shots.config.ts"
   },
@@
     "typescript": "^5.8.3",
     "typescript-eslint": "^8.38.0",
+    "vite": "~8.1.5",
     "vitest": "^4.1.0"
```

`pnpm-lock.yaml` gains Vite in the root importer but should retain the existing 8.1.5 resolution rather than add a duplicate resolution (`pnpm-lock.yaml:35-37`, `pnpm-lock.yaml:774-777`, `pnpm-lock.yaml:1557-1565`).

### Demo typecheck

Use the root config, not `tsconfig.demo.json`:

```diff
-  "include": ["src/**/*.ts", "test/**/*.ts"]
+  "include": ["src/**/*.ts", "test/**/*.ts", "demo/**/*.ts"]
```

`typecheck` builds declarations before the no-emit pass because demo’s bare `shotwright` imports resolve through `package.json` exports into `dist` (`package.json:19-31`). `tsconfig.build.json` continues overriding the include with `src/**/*.ts`, so demo files never enter the package build (`tsconfig.build.json:9`).

## Demo page and DOM contract

### Routes and captures

| Route/spec | Capture | State and deterministic pin |
|---|---|---|
| `/` · home | `form-filled` | Both labeled fields filled; default full-page capture |
| `/` · home | `modal-open` | Summary dialog open; locator capture of the dialog |
| `/` · home | `theme-dark` | Dialog closed; dark theme enabled; full-page capture |
| `/about.html` · about | `about-desktop` | Default 1440×960 viewport |
| `/about.html` · about | `mobile-layout` | Same page after `setViewportSize({ width: 390, height: 844 })` |

### Required semantic DOM

| Spec locator | Required markup/behavior |
|---|---|
| `getByLabel('Project name')` | `<label for="project-name">Project name</label>` associated with an `<input id="project-name">` |
| `getByLabel('Review focus')` | `<label for="review-focus">Review focus</label>` associated with a `<textarea id="review-focus">` |
| `getByRole('button', { name: 'Review summary' })` | Button calls `dialog.showModal()` after copying the current field values into the summary |
| `getByRole('dialog')` | Native `<dialog aria-labelledby="review-summary-title">`; no hand-built dialog role |
| `getByRole('button', { name: 'Close' })` | Button closes the native dialog |
| `getByRole('button', { name: 'Use dark theme' })` | Toggles `document.documentElement.dataset.theme`, updates `aria-pressed`, and changes its visible label to “Use light theme” |
| About layout | Desktop grid collapses to one column at `max-width: 600px`; no JS viewport sniffing |

`demo/demo.js` must contain only deterministic local interactions: form-to-dialog copy, native dialog open/close, and theme toggle. No network calls, persistence, timers, randomness, transitions, or external assets.

`demo/styles.css` is shared by both pages. `demo/index.html` loads it plus `demo.js`; `demo/about.html` loads only the stylesheet.

## Exact planned configuration and specs

### `demo/vite.config.ts`

```ts
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: demoRoot,
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL('index.html', import.meta.url)),
        about: fileURLToPath(new URL('about.html', import.meta.url)),
      },
    },
  },
})
```

### `demo/shots.config.ts` diff

```diff
 // shotwright's own shots config — runs the demo specs against the built package
-// (dist/, not src/) so the smoke exercises exactly what consumers install.
+// through its public exports (dist/, not src/), exactly as consumers do.

-import { defineShotsConfig } from '../dist/index.js'
+import { defineShotsConfig } from 'shotwright'

 export default defineShotsConfig({
   shotsDir: 'shots',
   use: { baseURL: 'http://127.0.0.1:4173' },
   webServer: {
-    command: 'node serve.mjs', // webServer cwd defaults to the config file's dir
+    command: 'vite dev',
     url: 'http://127.0.0.1:4173/',
-    reuseExistingServer: true,
+    reuseExistingServer: !process.env.CI,
   },
 })
```

### `demo/shots/home.shots.ts`

```ts
import { shot, walkthrough } from 'shotwright/capture'

walkthrough('home states', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Project name').fill('Shotwright demo')
  await page.getByLabel('Review focus').fill('Modal and dark theme states')
  await shot(page, 'form-filled')

  await page.getByRole('button', { name: 'Review summary' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  await shot(page, 'modal-open', { locator: dialog })

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await shot(page, 'theme-dark')
})
```

### `demo/shots/about.shots.ts`

```ts
import { shot, walkthrough } from 'shotwright/capture'

walkthrough('about layouts', async ({ page }) => {
  await page.goto('/about.html')
  await shot(page, 'about-desktop')

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, 'mobile-layout')
})
```

## Step list

### 1. Land the Vite serving, build, and demo-type boundary

File-level changes:

- **Create:** `demo/vite.config.ts` with the exact configuration above.
- **Modify:** `demo/shots.config.ts` with the exact diff above.
- **Modify:** `demo/shots/home.shots.ts` and `demo/shots/about.shots.ts` to use bare `shotwright/capture` imports only; retain their existing three-shot behavior until Step 2.
- **Delete:** `demo/serve.mjs`.
- **Modify:** `tsconfig.json` to include `demo/**/*.ts`.
- **Modify:** `package.json` with the exact scripts/dependency diff above.
- **Modify:** `pnpm-lock.yaml` through `pnpm install`; add Vite to the root importer without adding a second Vite resolution.
- **No change:** `tsconfig.build.json`, `src/cli.ts`, or `src/index.ts`.

Green checkpoint:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run demo:build
pnpm run smoke
CI=1 pnpm run demo:shots
pnpm pack --pack-destination local/ && ! tar -tzf local/shotwright-*.tgz | grep -q '^package/demo' && rm local/shotwright-*.tgz
```

*(Amended during Step 1: pnpm 10 has no `pack --dry-run`; a real pack to
gitignored `local/` plus a negated tarball grep is the supported equivalent —
the command succeeds only when no `demo/` path is packed, and cleans up.)*

At this checkpoint, the existing smoke inventory remains three shots, but it runs through Vite and bare self-references. `demo:build` must produce both `demo/dist/index.html` and `demo/dist/about.html`. The pack dry-run must continue excluding `demo/`, consistent with the current `files` contract (`package.json:15-18`), and the public engine remains `>=20` (`package.json:11-13`).

### 2. Land the five-state demo, living-documentation specs, and four-run smoke matrix

File-level changes:

- **Modify:** `demo/index.html` with the labeled form, summary dialog, close control, and theme button from the DOM contract.
- **Modify:** `demo/about.html` with semantic about-page content and the responsive grid.
- **Create:** `demo/styles.css`.
- **Create:** `demo/demo.js`.
- **Modify:** `eslint.config.mjs` with a `files: ['demo/**/*.js']` browser-globals override; the current global configuration supplies only Node globals (`eslint.config.mjs:5-12`).
- **Modify:** `demo/shots/home.shots.ts` to the exact final content above.
- **Modify:** `demo/shots/about.shots.ts` to the exact final content above.
- **Modify:** `test/smoke/cli.test.ts` to execute and validate all four independent runs.

Green checkpoint and final verification:

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run demo:build
test -f demo/dist/index.html
test -f demo/dist/about.html
time pnpm run smoke
```

Then validate the fresh-clone contract from an explicitly created disposable
checkout, with `CI=1` so an occupied port fails loudly instead of silently
borrowing another checkout's server (redteam A1, demonstrated empirically):

```bash
git clone <repo> /tmp-scratch/shotwright-freshclone && cd /tmp-scratch/shotwright-freshclone
pnpm install
pnpm exec playwright install chromium
CI=1 pnpm run demo:shots
```

The fresh-clone run’s latest manifest must contain exactly the five planned
shots. Before the run, no process may hold port 4173.

## Smoke test change plan

Retain the current manifest-version, run-id, Playwright-version, PNG-signature, viewport/DSF, `latest`, and staging-cleanup coverage (`test/smoke/cli.test.ts:35-77`), but apply it through a reusable `runCli()` helper.

The helper will:

1. Invoke the built CLI with `encoding: 'utf8'`, retaining the current 180-second child timeout (`test/smoke/cli.test.ts:24-28`).
2. Identify exactly one new run directory after each invocation.
3. Parse its manifest and assert its manifest version and flags.
4. Validate every manifest PNG exists and has the PNG signature.
5. Assert `latest` points to that run immediately after the invocation.
6. Assert `.sidecar`, `.pw`, and `.manifest.tmp` are absent.
7. Track run IDs and finally assert exactly four run directories exist.

Required runs and exact cardinalities:

| Run | CLI-specific arguments | Manifest shots, in sorted order | PNGs | Distinct videos | Distinct traces |
|---|---|---|---:|---:|---:|
| Unfiltered | `-- --workers=2` | `about-desktop`, `mobile-layout`, `form-filled`, `modal-open`, `theme-dark` grouped by `about.shots.ts` then `home.shots.ts` | **5** | **0** | **0** |
| Standalone only | `--only theme-dark` | `theme-dark` | **1** | **0** | **0** |
| Video only | `--only form-filled,about-desktop --video` | `about-desktop`, `form-filled` | **2** | **2** | **0** |
| Trace only | `--only theme-dark,mobile-layout --trace` | `mobile-layout`, `theme-dark` | **2** | **0** | **2** |

Additional assertions:

- Unfiltered stdout matches `Running 2 tests using 2 workers`. This proves two-worker capacity, not actual temporal overlap.
- Unfiltered flags are `{ only: [], video: false, trace: false }`.
- Standalone-only flags are `{ only: ['theme-dark'], video: false, trace: false }`. Successful `theme-dark` capture proves the walkthrough continued through filtered form/modal shots because filtering returns only from `shot()`, not from the test (`src/capture.ts:31-39`, `src/filter.ts:11-13`).
- Video flags are `{ only: ['form-filled', 'about-desktop'], video: true, trace: false }`; both entries have non-null, distinct video paths pointing to existing files, and both traces are null.
- Trace flags are `{ only: ['theme-dark', 'mobile-layout'], video: false, trace: true }`; both entries have non-null, distinct trace paths pointing to existing files, and both videos are null.
- `form-filled` records viewport 1440×960, DSF 2, and `fullPage: true`.
- `modal-open` records `fullPage: false`.
- `about-desktop` records viewport 1440×960.
- `mobile-layout` records viewport 390×844.
- Artifact uniqueness is asserted across the two specs because reporter association is keyed per Playwright test ID (`src/reporter.ts:33-59`) and copied into distinct manifest paths (`src/manifest.ts:102-113`).

## ASSUMPTIONS

| ID | Load-bearing assumption | Deterministic pin | Lands |
|---|---|---|---|
| A1 | Vite 8.1.x works as a root dev tool without changing the public Node floor | `pnpm install --frozen-lockfile`; lock diff shows one direct importer entry and retained 8.1.5 resolution; `pnpm run demo:build` | Step 1 |
| A2 | Vite starts within Playwright’s 60-second allowance | Pre-plan cold measurement: first HTTP response **0.111 s**; repeat through `CI=1 pnpm run demo:shots` | Measurement + Step 1 |
| A3 | Config-root handling works from both Playwright’s demo cwd and root `demo:build` invocation | Explicit `root: demoRoot`; Step 1 smoke plus both built-HTML existence checks | Step 1 |
| A4 | Both production HTML entries are built | Explicit `rolldownOptions.input`; assert `demo/dist/index.html` and `demo/dist/about.html` | Steps 1–2 |
| A5 | Bare self-referencing demo imports remain type-safe on a fresh tree | `typecheck` builds first; root no-emit check includes demo; disposable fresh-clone sequence | Step 1 + final verification |
| A6 | `pnpm run demo:shots` propagates the Vite binary into Playwright’s web-server child | `CI=1 pnpm run demo:shots` and disposable fresh-clone sequence (`CI=1`, port 4173 free — reuse disabled so the proof cannot borrow another checkout's server) | Step 1 |
| A7 | The semantic labels, buttons, and native dialog behave coherently | Final home walkthrough succeeds using only the pinned semantic locators; exact three home manifest entries | Step 2 |
| A8 | The modal is an element capture rather than a full-page capture | `modal-open.fullPage === false` plus real PNG check | Step 2 |
| A9 | Inline viewport mutation is preserved in manifest metadata | `about-desktop.viewport === 1440×960`; `mobile-layout.viewport === 390×844` | Step 2 |
| A10 | `--only` suppresses writes without stopping the walkthrough | Standalone `theme-dark` run yields one shot after all earlier home interactions execute | Step 2 |
| A11 | Video and trace switches work independently across both specs | Separate two-shot video-only and trace-only runs; exact flags, null opposites, two distinct artifact paths/files | Step 2 |
| A12 | Parallel capacity still produces one sorted, valid manifest | Unfiltered `--workers=2`; stdout capacity assertion; exact five-shot sorted inventory | Step 2 |
| A13 | Four runs remain acceptably fast | Measured analogous subtotal **4.01 s**; final `time pnpm run smoke` must record against the **10 s** same-host budget | Step 2 |
| A14 | The demo remains repository-only and does not alter consumer installation | `pnpm pack --dry-run` excludes `demo/`; `engines.node` remains `>=20` | Step 1 |
| A15 | Responsive output is reviewable without introducing golden assertions | Real 390×844 PNG plus required human inspection beside `about-desktop`; no pixel-diff gate | Step 2/final verification |

## Acceptance mapping

| Step | Bead acceptance bullet satisfied |
|---|---|
| P-phase exit | Save and commit this document as `docs/shotwright-746.2.2-plan.md`. |
| Steps 1–2 + §ASSUMPTIONS | “every assumption pinned to a verification step” |
| §Resolved planning decisions + §DEFERRED | “open questions resolved or explicitly deferred” |

## Self-review rubric

| Lens | Verdict | Note |
|---|---|---|
| Measured-or-flagged | **pass** | Baseline, four-run subtotal, and cold readiness are measured. Final 5–7-second runtime is explicitly marked `ESTIMATE`; Step 2 replaces it with a measurement. |
| Derived-value semantics | **pass** | Exact manifest cardinalities, ordering, flags, viewport values, null artifact opposites, and per-test artifact uniqueness are stated for every run. |
| Emergent structure | **pass** | Four run directories, `latest` movement, five unique global shot names, sorted spec grouping, and artifact-path cardinalities are explicit. |
| Batch/concurrency | **pass with scoped deferral** | `--workers=2` and stdout prove capacity; actual interleaving is not claimed. |
| Inherited-constraints-grounded | **pass** | Vite version/runtime, exports-based type ordering, package-only build include, public engine, artifact exclusion, and existing CLI/config flag plumbing are tied to current files and concrete gates. |

## DEFERRED

- **Actual worker interleaving evidence:** stdout proves two-worker capacity only. Worker-ID sidecars or overlap timestamps would change the core capture contract and are unnecessary for E2 (`docs/shotwright-746.2.1-research.md:158-163`).
- **Second mobile Playwright project:** deferred until the manifest and output layout gain a project/device dimension; current paths and global names would collide (`docs/shotwright-746.2.1-research.md:83-87`).
- **Capturing the production bundle through `vite preview`:** deferred unless a production-only bundler defect is observed; any future preview run must disable server reuse (`docs/adr/0004-demo-vite-toolchain.md:52-54`).
- **CI workflow wiring:** E7 owns reusable artifact-only CI integration (`docs/design.md:128-129`). E2 supplies scripts that work under the standard `CI` environment.
- **Consumer demo scaffolding:** E6 owns `templates/` and `init`; this demo remains repository-only (`docs/adr/0004-demo-vite-toolchain.md:33-35`).
- **Golden/pixel assertions:** deliberately outside shotwright’s review-artifact philosophy (`docs/design.md:32-37`). Final captures still require human inspection.

## Redteam ledger

Gate run 2026-07-29, one pass (per convention). Findings:

- **A1 — fixed in this doc:** the fresh-clone proof as originally drafted could
  falsely pass. Demonstrated empirically: with reuse enabled and a Vite server
  running from a *different* checkout, a run configured with an impossible
  server command still passed and published a manifest — Playwright reused the
  foreign server. The proof sequence now creates an explicit disposable clone
  and runs `CI=1 pnpm run demo:shots` with port 4173 verified free.
- **A2 — fixed in this doc:** agent session metadata (session id/resume
  footer) must be stripped before promoting any agent-authored report into
  tracked docs — repo is private but headed public. Stripped here; standing
  convention for all phase promotions.

Axes that survived attack (verified in a scratch install, not by inspection):
executability of the exact diffs (`typecheck`, `demo:build`, `CI=1 demo:shots`,
`smoke` all pass; both built HTML entries produced), PATH propagation to the
webServer child from every sanctioned `pnpm run` entry, build-before-typecheck
gate semantics, smoke-matrix cardinalities (no pairwise substring collisions in
the five shot names), capture determinism, and scope.

Considered and declined (no practical bite): pinning Playwright's exact
`using 2 workers` stdout sentence as risky API surface (version is locked and
output piped — stable here); shared pnpm/browser caches making the fresh-clone
proof "non-cold" (caches don't substitute source files; the server-reuse hole
above was the real defect and is fixed).

## Risks + rollback — ranked by blast radius

1. **High — self-reference/typecheck ordering breaks every quality run or fresh clone.** The root exports target `dist`, so a no-build typecheck would fail. Step 1 pins build-before-typecheck and the disposable fresh-clone sequence. If root inclusion exposes an irreducible compiler conflict, rollback only the typecheck mechanism to a composed `tsconfig.demo.json` command while retaining one `pnpm run typecheck` entry point.

2. **High — video/trace artifacts associate with the wrong spec.** That would corrupt review evidence while appearing successful. Separate cross-spec video and trace runs assert distinct existing artifact paths and null opposite flags. Roll back Step 2’s smoke refactor as a unit if association evidence is ambiguous; do not weaken the matrix.

3. **Medium — Vite cwd/root configuration serves or builds the wrong directory.** Explicit `root`, pinned routes, strict port, smoke navigation, and built-file checks detect it. Roll back Step 1 atomically by restoring `serve.mjs` only if ADR 0004 is formally reversed.

4. **Medium — local server reuse hides a port collision or CI unexpectedly reuses a process.** `strictPort` turns collisions into failures and `!process.env.CI` disables reuse in CI. The recovery is to terminate the conflicting local process; do not add a fallback port because baseURL and capture evidence must remain deterministic.

5. **Medium — expanded smoke runtime becomes disproportionate.** The projected suite is 5–7 seconds against a 10-second same-host budget. Video/trace already capture only two shots each; if the budget is exceeded, profile browser/server startup before changing required coverage.

6. **Low — browser JS linting is missed by the existing Node-only globals.** The scoped `demo/**/*.js` browser-globals override and unchanged `eslint .` gate catch this without relaxing rules elsewhere.

7. **Low — responsive or dark-theme captures are technically valid but visually poor.** Manifest and PNG checks cannot judge composition. Final verification must inspect all five images, especially the desktop/mobile pair and locator-cropped dialog; rollback is isolated to Step 2’s HTML/CSS/JS.
